import crypto from "node:crypto";
import { z } from "zod";
import { currentSession, requireSession } from "./auth.mjs";
import { isProUser } from "./billing.mjs";
import { assertSameOrigin, HttpError, readJson, requireMethod, sendJson } from "./http.mjs";
import { query } from "./pg.mjs";
import { token, tokenHash } from "./passwords.mjs";

/**
 * Google Calendar, Microsoft Outlook, and Jira connections.
 *
 * OAuth state is single use and expires after ten minutes. Provider tokens
 * are encrypted with AES-256-GCM before they touch Postgres, and the callback
 * never grants a JotBox session: the customer must already be signed in.
 */

const PROVIDERS = ["google", "outlook", "jira"];
const LABELS = {
  google: "Google Calendar",
  outlook: "Microsoft Outlook",
  jira: "Jira",
};
const STATE_MINUTES = 10;
const TOKEN_SKEW_MS = 60_000;

const providerSchema = z.enum(PROVIDERS);
const connectSchema = z.object({ provider: providerSchema });
const disconnectSchema = z.object({ provider: providerSchema });
const handoffSchema = z.object({
  sessionId: z.string().uuid(),
  actionIds: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  projectKey: z.string().trim().min(2).max(40).regex(/^[A-Za-z][A-Za-z0-9_]+$/),
  issueType: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z][A-Za-z0-9 _-]*$/)
    .default("Task"),
  includeContext: z.boolean().default(true),
});

function publicBase() {
  return (process.env.JOTBOX_PUBLIC_URL || "https://jotbox-eight.vercel.app").replace(/\/+$/, "");
}

function encryptionKey() {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new HttpError(503, "Integrations are not configured on this deployment yet.");
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new HttpError(503, "INTEGRATIONS_ENCRYPTION_KEY must be 32 bytes, base64 or hex.");
  }
  return key;
}

export function integrationEncryptionReady() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptIntegrationSecret(value) {
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptIntegrationSecret(payload) {
  const key = encryptionKey();
  const [version, ivRaw, tagRaw, dataRaw] = String(payload).split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !dataRaw) {
    throw new HttpError(500, "A saved connection could not be read. Reconnect the app.");
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataRaw, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new HttpError(500, "A saved connection could not be read. Reconnect the app.");
  }
}

function microsoftTenant() {
  const raw = process.env.MICROSOFT_TENANT_ID?.trim() || "common";
  return /^[A-Za-z0-9.-]+$/.test(raw) ? raw : "common";
}

function providerConfig(provider) {
  const base = publicBase();
  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
    return {
      provider,
      label: LABELS.google,
      clientId,
      clientSecret,
      configured: Boolean(clientId && clientSecret),
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      redirectUri: `${base}/api/integrations/google/callback`,
      scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.readonly"],
      tokenFormat: "form",
      authParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    };
  }
  if (provider === "outlook") {
    const clientId = process.env.MICROSOFT_CLIENT_ID?.trim() || "";
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim() || "";
    const tenant = microsoftTenant();
    return {
      provider,
      label: LABELS.outlook,
      clientId,
      clientSecret,
      configured: Boolean(clientId && clientSecret),
      authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      redirectUri: `${base}/api/integrations/outlook/callback`,
      scopes: ["offline_access", "User.Read", "Calendars.Read"],
      tokenFormat: "form",
      authParams: { response_mode: "query", prompt: "select_account" },
    };
  }
  const clientId = process.env.ATLASSIAN_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET?.trim() || "";
  return {
    provider: "jira",
    label: LABELS.jira,
    clientId,
    clientSecret,
    configured: Boolean(clientId && clientSecret),
    authorizeUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    redirectUri: `${base}/api/integrations/jira/callback`,
    scopes: ["read:jira-work", "write:jira-work", "read:me", "offline_access"],
    tokenFormat: "json",
    authParams: { audience: "api.atlassian.com", prompt: "consent" },
  };
}

export function buildIntegrationAuthUrl(provider, state) {
  const config = providerConfig(provider);
  if (!config.configured) {
    const hint =
      provider === "google"
        ? "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"
        : provider === "outlook"
          ? "MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET"
          : "ATLASSIAN_CLIENT_ID and ATLASSIAN_CLIENT_SECRET";
    throw new HttpError(503, `${config.label} is not configured on this deployment. Add ${hint}.`);
  }
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  for (const [key, value] of Object.entries(config.authParams)) url.searchParams.set(key, value);
  return url.toString();
}

async function tokenRequest(config, params) {
  const isJson = config.tokenFormat === "json";
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": isJson ? "application/json" : "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: isJson ? JSON.stringify(params) : new URLSearchParams(params),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    const reason = data?.error_description || data?.error || `token exchange returned ${response.status}`;
    throw new HttpError(502, `Could not finish connecting ${config.label}: ${reason}`);
  }
  return data;
}

function exchangeParams(config, code) {
  const params = {
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
  };
  if (config.tokenFormat === "form" && config.provider === "outlook") params.scope = config.scopes.join(" ");
  return params;
}

function refreshParams(config, refreshToken) {
  const params = {
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
  };
  if (config.tokenFormat === "form" && config.provider === "outlook") params.scope = config.scopes.join(" ");
  return params;
}

async function jsonFetch(url, init, label, timeout = 15_000) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const reason =
      data?.error?.message || data?.error_description || data?.message || `request returned ${response.status}`;
    throw new HttpError(response.status === 401 ? 401 : 502, `${label}: ${reason}`);
  }
  return data;
}

async function profileFor(provider, accessToken, site) {
  if (provider === "google") {
    const data = await jsonFetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}` } },
      "Google",
    );
    return { label: data.email || data.name || "Google account", externalId: data.sub || "", metadata: {} };
  }
  if (provider === "outlook") {
    const data = await jsonFetch(
      "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
      { headers: { Authorization: `Bearer ${accessToken}` } },
      "Microsoft Outlook",
    );
    return {
      label: data.mail || data.userPrincipalName || data.displayName || "Microsoft account",
      externalId: data.id || "",
      metadata: {},
    };
  }
  const metadata = {
    cloudId: site?.id || "",
    siteUrl: site?.url || "",
    siteName: site?.name || "",
  };
  let label = site?.name || site?.url || "Jira site";
  try {
    const me = await jsonFetch(
      "https://api.atlassian.com/me",
      { headers: { Authorization: `Bearer ${accessToken}` } },
      "Jira",
    );
    label = me.email || me.name || label;
  } catch {
    // The site name is still a useful label when the profile scope is limited.
  }
  return { label, externalId: site?.id || "", metadata };
}

async function jiraSite(accessToken) {
  const sites = await jsonFetch(
    "https://api.atlassian.com/oauth/token/accessible-resources",
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
    "Jira",
  );
  const site = Array.isArray(sites) ? sites[0] : null;
  if (!site?.id) throw new HttpError(502, "No Jira site is available for this account.");
  return site;
}

async function saveConnection(userId, provider, tokens, profile) {
  const expiresAt = tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000) : null;
  const access = encryptIntegrationSecret(tokens.access_token);
  const refresh = tokens.refresh_token ? encryptIntegrationSecret(tokens.refresh_token) : "";
  await query(
    `insert into integration_connections
       (user_id, provider, account_label, external_id, metadata, access_token, refresh_token, scope, token_type, expires_at)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
     on conflict (user_id, provider) do update set
       account_label = excluded.account_label,
       external_id = excluded.external_id,
       metadata = excluded.metadata,
       access_token = excluded.access_token,
       refresh_token = coalesce(nullif(excluded.refresh_token, ''), integration_connections.refresh_token),
       scope = excluded.scope,
       token_type = excluded.token_type,
       expires_at = excluded.expires_at,
       updated_at = now()`,
    [
      userId,
      provider,
      profile.label || "",
      profile.externalId || "",
      JSON.stringify(profile.metadata || {}),
      access,
      refresh,
      tokens.scope || "",
      tokens.token_type || "Bearer",
      expiresAt,
    ],
  );
}

async function connectionFor(userId, provider) {
  const result = await query(
    `select id, user_id, provider, account_label, external_id, metadata, access_token, refresh_token,
            scope, token_type, expires_at, created_at, updated_at
       from integration_connections
      where user_id = $1 and provider = $2
      limit 1`,
    [userId, provider],
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, `${LABELS[provider]} is not connected yet.`);
  return row;
}

async function accessTokenFor(row) {
  const config = providerConfig(row.provider);
  if (!config.configured) {
    throw new HttpError(503, `${config.label} is not configured on this deployment.`);
  }
  if (row.expires_at && new Date(row.expires_at).getTime() > Date.now() + TOKEN_SKEW_MS) {
    return decryptIntegrationSecret(row.access_token);
  }
  if (!row.refresh_token) {
    throw new HttpError(401, `${config.label} needs to be reconnected.`);
  }
  try {
    const tokens = await tokenRequest(config, refreshParams(config, decryptIntegrationSecret(row.refresh_token)));
    const access = encryptIntegrationSecret(tokens.access_token);
    const refresh = tokens.refresh_token ? encryptIntegrationSecret(tokens.refresh_token) : row.refresh_token;
    const expiresAt = tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000) : null;
    await query(
      `update integration_connections
          set access_token = $2, refresh_token = $3, scope = coalesce(nullif($4, ''), scope),
              expires_at = $5, updated_at = now()
        where id = $1`,
      [row.id, access, refresh, tokens.scope || "", expiresAt],
    );
    row.access_token = access;
    row.refresh_token = refresh;
    row.expires_at = expiresAt;
    return tokens.access_token;
  } catch {
    await query(
      `update integration_connections
          set metadata = metadata || '{"needsReconnect": true}'::jsonb, updated_at = now()
        where id = $1`,
      [row.id],
    ).catch(() => undefined);
    throw new HttpError(401, `${config.label} needs to be reconnected.`);
  }
}

function clampDays(value) {
  const days = Number.parseInt(String(value ?? "7"), 10);
  if (!Number.isFinite(days)) return 7;
  return Math.min(14, Math.max(1, days));
}

function truncate(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function toTimestamp(value) {
  if (!value?.dateTime) return Number.NaN;
  const raw = value.dateTime;
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw}Z`);
}

async function googleEvents(accessToken, start, end) {
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", start.toISOString());
  url.searchParams.set("timeMax", end.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "25");
  const data = await jsonFetch(
    url,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "Google Calendar",
  );
  return (data.items || [])
    .filter((item) => item.status !== "cancelled")
    .map((item) => {
      const allDay = Boolean(item.start?.date);
      const startMs = Date.parse(item.start?.dateTime || `${item.start?.date}T00:00:00Z`);
      const endMs = Date.parse(item.end?.dateTime || `${item.end?.date}T00:00:00Z`);
      const join =
        item.hangoutLink ||
        item.conferenceData?.entryPoints?.find((entry) => entry.uri)?.uri ||
        null;
      return {
        id: `google:${item.id}`,
        provider: "google",
        title: item.summary || "Untitled event",
        start: startMs,
        end: Number.isFinite(endMs) ? endMs : startMs,
        allDay,
        attendees: (item.attendees || [])
          .map((person) => person.displayName || person.email)
          .filter(Boolean)
          .slice(0, 20),
        joinUrl: join,
        webUrl: item.htmlLink || null,
        description: truncate(item.description || "", 400),
      };
    })
    .filter((event) => Number.isFinite(event.start));
}

async function outlookEvents(accessToken, start, end) {
  const url = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
  url.searchParams.set("startDateTime", start.toISOString());
  url.searchParams.set("endDateTime", end.toISOString());
  url.searchParams.set("$select", "id,subject,start,end,attendees,onlineMeeting,webLink,bodyPreview,isAllDay");
  url.searchParams.set("$orderby", "start/dateTime");
  url.searchParams.set("$top", "25");
  const data = await jsonFetch(
    url,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        Prefer: 'outlook.timezone="UTC"',
      },
    },
    "Microsoft Outlook",
  );
  return (data.value || [])
    .map((item) => {
      const startMs = toTimestamp(item.start);
      const endMs = toTimestamp(item.end);
      return {
        id: `outlook:${item.id}`,
        provider: "outlook",
        title: item.subject || "Untitled event",
        start: startMs,
        end: Number.isFinite(endMs) ? endMs : startMs,
        allDay: Boolean(item.isAllDay),
        attendees: (item.attendees || [])
          .map((person) => person.emailAddress?.name || person.emailAddress?.address)
          .filter(Boolean)
          .slice(0, 20),
        joinUrl: item.onlineMeeting?.joinUrl || null,
        webUrl: item.webLink || null,
        description: truncate(item.bodyPreview || "", 400),
      };
    })
    .filter((event) => Number.isFinite(event.start));
}

export async function integrationStatus(userId) {
  const [connections, pro] = await Promise.all([
    query(
      "select provider, account_label, metadata, scope, updated_at from integration_connections where user_id = $1",
      [userId],
    ),
    isProUser(userId),
  ]);
  const byProvider = new Map(connections.rows.map((row) => [row.provider, row]));
  return {
    pro,
    encryptionReady: integrationEncryptionReady(),
    providers: PROVIDERS.map((provider) => {
      const config = providerConfig(provider);
      const row = byProvider.get(provider);
      return {
        provider,
        label: config.label,
        configured: config.configured,
        connected: Boolean(row),
        accountLabel: row?.account_label || "",
        siteName: row?.metadata?.siteName || "",
        connectedAt: row?.updated_at ? new Date(row.updated_at).getTime() : null,
        needsReconnect: Boolean(row?.metadata?.needsReconnect),
        scopes: row?.scope || config.scopes.join(" "),
      };
    }),
  };
}

async function connect(user, body) {
  if (!(await isProUser(user.id))) {
    throw new HttpError(402, "Calendar and Jira connections are part of Pro.");
  }
  if (!integrationEncryptionReady()) {
    throw new HttpError(503, "Integrations are not configured on this deployment yet.");
  }
  const provider = body.provider;
  const config = providerConfig(provider);
  if (!config.configured) {
    throw new HttpError(503, `${config.label} is not configured on this deployment yet.`);
  }
  const state = token();
  await query(
    "delete from integration_oauth_states where user_id = $1 and (expires_at < now() - interval '1 day' or used_at < now() - interval '1 day')",
    [user.id],
  );
  await query(
    `insert into integration_oauth_states (user_id, provider, state_hash, expires_at)
     values ($1, $2, $3, now() + interval '${STATE_MINUTES} minutes')`,
    [user.id, provider, tokenHash(state)],
  );
  return { authUrl: buildIntegrationAuthUrl(provider, state) };
}

async function disconnect(userId, provider) {
  await query("delete from integration_connections where user_id = $1 and provider = $2", [userId, provider]);
  await query("delete from integration_oauth_states where user_id = $1 and provider = $2", [userId, provider]);
  return integrationStatus(userId);
}

async function calendar(userId, search) {
  if (!(await isProUser(userId))) {
    throw new HttpError(402, "Calendar is part of Pro. Upgrade to see your next meeting in JotBox.");
  }
  const days = clampDays(search.get("days"));
  const start = new Date();
  const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const connections = await query(
    "select id, provider, account_label, metadata, access_token, refresh_token, scope, token_type, expires_at from integration_connections where user_id = $1 and provider in ('google', 'outlook')",
    [userId],
  );
  const events = [];
  const warnings = [];
  for (const row of connections.rows) {
    try {
      const accessToken = await accessTokenFor(row);
      const items = row.provider === "google" ? await googleEvents(accessToken, start, end) : await outlookEvents(accessToken, start, end);
      events.push(...items);
    } catch (error) {
      const reconnect = error?.status === 401;
      if (reconnect) {
        await query(
          "update integration_connections set metadata = metadata || '{\"needsReconnect\": true}'::jsonb where id = $1",
          [row.id],
        ).catch(() => undefined);
      }
      console.warn("[jotbox-integrations] calendar", row.provider, error?.message || error);
      warnings.push({
        provider: row.provider,
        label: LABELS[row.provider],
        message: reconnect
          ? `${LABELS[row.provider]} needs reconnecting. Open account settings to reconnect it.`
          : `${LABELS[row.provider]} could not be read just now. Try again shortly.`,
      });
    }
  }
  events.sort((a, b) => a.start - b.start);
  return {
    connected: connections.rows.length > 0,
    events: events.slice(0, 40),
    warnings,
    window: { start: start.getTime(), end: end.getTime(), days },
  };
}

async function jiraContext(userId) {
  if (!(await isProUser(userId))) {
    throw new HttpError(402, "Jira handoff is part of Pro. Upgrade to send actions to Jira.");
  }
  const row = await connectionFor(userId, "jira");
  const accessToken = await accessTokenFor(row);
  const metadata = row.metadata || {};
  if (!metadata.cloudId) throw new HttpError(400, "Reconnect Jira to choose a site.");
  return {
    row,
    accessToken,
    cloudId: metadata.cloudId,
    siteUrl: metadata.siteUrl || "",
    siteName: metadata.siteName || "",
  };
}

async function jiraRequest(context, path, init = {}) {
  const base = `https://api.atlassian.com/ex/jira/${context.cloudId}/rest/api/3`;
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${context.accessToken}`,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data?.errorMessages?.join(" ") || data?.message || `Jira returned ${response.status}.`;
    throw new HttpError(response.status === 401 ? 401 : 502, message);
  }
  return data;
}

async function jiraProjects(userId) {
  const context = await jiraContext(userId);
  const data = await jiraRequest(context, "/project/search?maxResults=50&orderBy=name");
  const projects = (data?.values || []).map((project) => ({
    id: String(project.id),
    key: project.key,
    name: project.name,
  }));
  return {
    site: { name: context.siteName, url: context.siteUrl },
    projects,
    issueTypes: ["Task", "Story", "Bug"],
  };
}

export function jiraIssuePayload({ action, session, projectKey, issueType = "Task", includeContext = true }) {
  const content = [
    {
      type: "paragraph",
      content: [{ type: "text", text: action.text }],
    },
  ];
  if (action.owner) {
    content.push({
      type: "paragraph",
      content: [{ type: "text", text: `Owner: ${action.owner}` }],
    });
  }
  if (includeContext) {
    if (session.notes?.summary) {
      content.push({
        type: "paragraph",
        content: [{ type: "text", text: `From the JotBox notes for ${session.title}: ${truncate(session.notes.summary, 1200)}` }],
      });
    } else {
      content.push({
        type: "paragraph",
        content: [{ type: "text", text: `From the JotBox notes for ${session.title}.` }],
      });
    }
    content.push({
      type: "paragraph",
      content: [{ type: "text", text: `Open the session: ${publicBase()}/session/${session.id}` }],
    });
  }
  return {
    fields: {
      project: { key: projectKey },
      summary: truncate(action.text, 240),
      issuetype: { name: issueType },
      description: { type: "doc", version: 1, content },
      labels: ["jotbox"],
    },
  };
}

async function jiraHandoff(userId, body) {
  const context = await jiraContext(userId);
  const result = await query("select id, title, notes, created_at from captures where id = $1 and user_id = $2", [
    body.sessionId,
    userId,
  ]);
  const session = result.rows[0];
  if (!session) throw new HttpError(404, "That session could not be found.");
  const actions = Array.isArray(session.notes?.actions) ? session.notes.actions : [];
  const wanted = new Set(body.actionIds);
  const selected = actions.filter((action) => wanted.has(action.id));
  if (!selected.length) throw new HttpError(400, "Choose at least one action to send.");

  const prior = await query(
    `select action_id, external_key, external_url, created_at
       from integration_handoffs
      where user_id = $1 and provider = 'jira' and session_id = $2`,
    [userId, body.sessionId],
  );
  const priorByAction = new Map(prior.rows.map((row) => [row.action_id, row]));
  const created = [];
  const existing = [];
  const failed = [];

  for (const action of selected) {
    const already = priorByAction.get(action.id);
    if (already) {
      existing.push({
        actionId: action.id,
        key: already.external_key,
        url: already.external_url,
        createdAt: new Date(already.created_at).getTime(),
      });
      continue;
    }
    try {
      const issue = await jiraRequest(context, "/issue", {
        method: "POST",
        body: JSON.stringify(
          jiraIssuePayload({
            action,
            session,
            projectKey: body.projectKey,
            issueType: body.issueType,
            includeContext: body.includeContext,
          }),
        ),
      });
      const key = issue?.key;
      if (!key) throw new HttpError(502, "Jira did not return an issue key.");
      const siteUrl = context.siteUrl.replace(/\/+$/, "");
      const url = siteUrl ? `${siteUrl}/browse/${key}` : issue.self || "";
      await query(
        `insert into integration_handoffs (user_id, session_id, action_id, provider, external_key, external_url)
         values ($1, $2, $3, 'jira', $4, $5)
         on conflict (user_id, provider, session_id, action_id) do nothing`,
        [userId, body.sessionId, action.id, key, url],
      );
      created.push({ actionId: action.id, key, url });
    } catch (error) {
      failed.push({ actionId: action.id, message: error?.message || "Jira refused the issue." });
    }
  }

  return {
    created,
    existing,
    failed,
    site: { name: context.siteName, url: context.siteUrl },
  };
}

async function listHandoffs(userId, sessionId) {
  const parsed = z.string().uuid().safeParse(sessionId);
  if (!parsed.success) throw new HttpError(400, "That session is not valid.");
  const owns = await query("select 1 from captures where id = $1 and user_id = $2", [parsed.data, userId]);
  if (!owns.rows[0]) throw new HttpError(404, "That session could not be found.");
  const rows = await query(
    `select action_id, provider, external_key, external_url, created_at
       from integration_handoffs
      where user_id = $1 and session_id = $2
      order by created_at`,
    [userId, parsed.data],
  );
  return {
    handoffs: rows.rows.map((row) => ({
      actionId: row.action_id,
      provider: row.provider,
      key: row.external_key,
      url: row.external_url,
      createdAt: new Date(row.created_at).getTime(),
    })),
  };
}

export async function handleIntegrations(req, res) {
  const session = await requireSession(req);
  const search = new URL(req.url || "/", "http://localhost").searchParams;
  const action = search.get("action") || "list";

  if (action === "list") {
    requireMethod(req, ["GET"]);
    sendJson(res, 200, await integrationStatus(session.user.id));
    return;
  }

  if (action === "connect") {
    requireMethod(req, ["POST"]);
    assertSameOrigin(req);
    const parsed = connectSchema.safeParse(await readJson(req, 5_000));
    if (!parsed.success) throw new HttpError(400, "Choose a supported app.");
    sendJson(res, 200, await connect(session.user, parsed.data));
    return;
  }

  if (action === "disconnect") {
    requireMethod(req, ["POST"]);
    assertSameOrigin(req);
    const parsed = disconnectSchema.safeParse(await readJson(req, 5_000));
    if (!parsed.success) throw new HttpError(400, "Choose a supported app.");
    sendJson(res, 200, await disconnect(session.user.id, parsed.data.provider));
    return;
  }

  if (action === "calendar") {
    requireMethod(req, ["GET"]);
    sendJson(res, 200, await calendar(session.user.id, search));
    return;
  }

  if (action === "jira-projects") {
    requireMethod(req, ["GET"]);
    sendJson(res, 200, await jiraProjects(session.user.id));
    return;
  }

  if (action === "jira-handoff") {
    requireMethod(req, ["POST"]);
    assertSameOrigin(req);
    const parsed = handoffSchema.safeParse(await readJson(req, 200_000));
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || "Choose actions and a Jira project.");
    }
    sendJson(res, 200, await jiraHandoff(session.user.id, parsed.data));
    return;
  }

  if (action === "handoffs") {
    requireMethod(req, ["GET"]);
    sendJson(res, 200, await listHandoffs(session.user.id, search.get("sessionId") || ""));
    return;
  }

  throw new HttpError(404, "That integration action is not supported.");
}

function callbackRedirect(res, path) {
  res.statusCode = 302;
  res.setHeader("Location", `${publicBase()}${path}`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end();
}

function safeProvider(value) {
  return PROVIDERS.includes(value) ? value : "google";
}

// The Vercel callback rewrite drops the provider path segment, so on a denial
// recover it from the state row instead of labelling every failure Google.
async function providerFromState(state, fallback) {
  if (!state) return fallback;
  try {
    const row = await query("select provider from integration_oauth_states where state_hash = $1", [tokenHash(state)]);
    return safeProvider(row.rows[0]?.provider || fallback);
  } catch {
    return fallback;
  }
}

export async function handleIntegrationCallback(req, res) {
  requireMethod(req, ["GET"]);
  const url = new URL(req.url || "/", "http://localhost");
  const pathProvider = safeProvider(url.pathname.split("/")[3] || "");
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const providerError = url.searchParams.get("error");

  if (providerError) {
    const deniedProvider = await providerFromState(state, pathProvider);
    callbackRedirect(res, `/account?integration=${deniedProvider}&status=denied`);
    return;
  }
  if (!state || !code) {
    callbackRedirect(res, `/account?integration=${pathProvider}&status=error&reason=missing`);
    return;
  }

  let provider = pathProvider;
  try {
    const consumed = await query(
      `update integration_oauth_states
          set used_at = now()
        where state_hash = $1 and used_at is null and expires_at > now()
        returning user_id, provider`,
      [tokenHash(state)],
    );
    const stateRow = consumed.rows[0];
    if (!stateRow) {
      callbackRedirect(res, `/account?integration=${provider}&status=expired`);
      return;
    }
    provider = safeProvider(stateRow.provider);

    const session = await currentSession(req);
    if (!session || session.user.id !== stateRow.user_id) {
      callbackRedirect(res, `/auth?next=${encodeURIComponent(`/account?integration=${provider}`)}`);
      return;
    }

    const config = providerConfig(provider);
    if (!config.configured) {
      callbackRedirect(res, `/account?integration=${provider}&status=error&reason=config`);
      return;
    }
    const tokens = await tokenRequest(config, exchangeParams(config, code));
    const site = provider === "jira" ? await jiraSite(tokens.access_token) : null;
    const profile = await profileFor(provider, tokens.access_token, site);
    await saveConnection(session.user.id, provider, tokens, profile);
    callbackRedirect(res, `/account?integration=${provider}&status=connected`);
  } catch (error) {
    console.error("[jotbox-integrations]", provider, error?.message || error);
    callbackRedirect(res, `/account?integration=${provider}&status=error&reason=exchange`);
  }
}
