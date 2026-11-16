import { z } from "zod";
import { query } from "./pg.mjs";
import { hashPassword, token, tokenHash, verifyPassword } from "./passwords.mjs";
import {
  appUrlFor,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from "./email.mjs";
import {
  HttpError,
  assertSameOrigin,
  clientIp,
  isSecureRequest,
  parseCookies,
  readJson,
  requireMethod,
  sendJson,
  serializeCookie,
  userAgent,
} from "./http.mjs";

const COOKIE = "jotbox_session";
const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;
const RESET_MINUTES = 60;

const registerSchema = z.object({
  name: z.string().trim().max(80, "Name is too long.").optional().default(""),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  password: z.string().min(8, "Use at least 8 characters.").max(200, "Password is too long."),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  password: z.string().min(1, "Enter your password.").max(200),
});

const forgotSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
});

const resetSchema = z.object({
  token: z.string().trim().min(20, "That reset link is not valid.").max(300),
  password: z.string().min(8, "Use at least 8 characters.").max(200, "Password is too long."),
});

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name || "",
    createdAt: row.created_at ? new Date(row.created_at).getTime() : undefined,
  };
}

function validationMessage(result) {
  return result.error?.issues?.[0]?.message || "Check the details and try again.";
}

async function countAttempts(kind, key, minutes) {
  const result = await query(
    `select count(*)::int as count
       from auth_attempts
      where kind = $1 and key = $2 and created_at > now() - ($3::int * interval '1 minute')`,
    [kind, key, minutes],
  );
  return result.rows[0]?.count ?? 0;
}

async function recordAttempt(kind, key) {
  await query("insert into auth_attempts (kind, key) values ($1, $2)", [kind, key]);
  if (Math.random() < 0.05) {
    await query("delete from auth_attempts where created_at < now() - interval '2 days'");
  }
}

async function clearAttempts(kind, key) {
  await query("delete from auth_attempts where kind = $1 and key = $2", [kind, key]);
}

async function issueSession(userId, req, res) {
  await query("delete from auth_sessions where expires_at < now()");
  const raw = token();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  await query(
    `insert into auth_sessions (user_id, token_hash, user_agent, ip, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [userId, tokenHash(raw), userAgent(req), clientIp(req), expiresAt],
  );
  res.setHeader(
    "Set-Cookie",
    serializeCookie(COOKIE, raw, {
      maxAge: SESSION_SECONDS,
      secure: isSecureRequest(req),
      sameSite: "Lax",
      path: "/",
    }),
  );
}

export async function currentSession(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw || raw.length < 20) return null;
  const result = await query(
    `select s.id as session_id, s.user_id, s.expires_at, u.id, u.email, u.name, u.created_at
       from auth_sessions s
       join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()
      limit 1`,
    [tokenHash(raw)],
  );
  const row = result.rows[0];
  if (!row) return null;

  await query(
    "update auth_sessions set last_seen_at = now() where id = $1 and last_seen_at < now() - interval '1 hour'",
    [row.session_id],
  );
  return { sessionId: row.session_id, user: publicUser(row) };
}

export async function requireSession(req) {
  const session = await currentSession(req);
  if (!session) throw new HttpError(401, "Sign in to continue.");
  return session;
}

export async function handleRegister(req, res) {
  requireMethod(req, ["POST"]);
  assertSameOrigin(req);
  const parsed = registerSchema.safeParse(await readJson(req, 20_000));
  if (!parsed.success) throw new HttpError(400, validationMessage(parsed));

  const ip = clientIp(req);
  const registrations = await countAttempts("register_ip", ip, 60);
  if (registrations >= 30) throw new HttpError(429, "Too many sign-up attempts. Try again in an hour.");
  await recordAttempt("register_ip", ip);

  const { email, password, name } = parsed.data;
  const passwordHash = await hashPassword(password);

  let user;
  try {
    const inserted = await query(
      `insert into users (email, name, password_hash)
       values ($1, $2, $3)
       returning id, email, name, created_at`,
      [email, name, passwordHash],
    );
    user = publicUser(inserted.rows[0]);
  } catch (error) {
    if (error?.code === "23505") {
      throw new HttpError(409, "An account with that email already exists.");
    }
    throw error;
  }

  await issueSession(user.id, req, res);
  await sendWelcomeEmail(user).catch((error) => {
    console.error("[jotbox-auth] welcome email failed", error instanceof Error ? error.message : error);
  });
  sendJson(res, 201, { user });
}

export async function handleLogin(req, res) {
  requireMethod(req, ["POST"]);
  assertSameOrigin(req);
  const parsed = loginSchema.safeParse(await readJson(req, 20_000));
  if (!parsed.success) throw new HttpError(400, validationMessage(parsed));

  const { email, password } = parsed.data;
  const key = `${clientIp(req)}|${email}`;
  const failures = await countAttempts("login", key, 15);
  if (failures >= 10) {
    throw new HttpError(429, "Too many sign-in attempts. Try again in a few minutes.");
  }

  const found = await query(
    "select id, email, name, password_hash, created_at from users where email = $1 limit 1",
    [email],
  );
  const row = found.rows[0];
  const valid = row ? await verifyPassword(password, row.password_hash) : false;

  if (!row || !valid) {
    await recordAttempt("login", key);
    throw new HttpError(401, "Email or password is incorrect.");
  }

  await clearAttempts("login", key);
  await issueSession(row.id, req, res);
  sendJson(res, 200, { user: publicUser(row) });
}

export async function handleLogout(req, res) {
  requireMethod(req, ["POST"]);
  assertSameOrigin(req);
  const raw = parseCookies(req)[COOKIE];
  if (raw) {
    await query("delete from auth_sessions where token_hash = $1", [tokenHash(raw)]);
  }
  res.setHeader(
    "Set-Cookie",
    serializeCookie(COOKIE, "", {
      maxAge: 0,
      secure: isSecureRequest(req),
      sameSite: "Lax",
      path: "/",
    }),
  );
  res.statusCode = 204;
  res.end();
}

export async function handleMe(req, res) {
  requireMethod(req, ["GET"]);
  const session = await currentSession(req);
  if (!session) {
    sendJson(res, 200, { user: null });
    return;
  }
  sendJson(res, 200, { user: session.user });
}

export async function handleForgotPassword(req, res) {
  requireMethod(req, ["POST"]);
  assertSameOrigin(req);
  const parsed = forgotSchema.safeParse(await readJson(req, 20_000));
  if (!parsed.success) throw new HttpError(400, validationMessage(parsed));

  const { email } = parsed.data;
  const ip = clientIp(req);
  const ipAttempts = await countAttempts("forgot_ip", ip, 60);
  if (ipAttempts >= 20) throw new HttpError(429, "Too many reset requests. Try again in an hour.");
  await recordAttempt("forgot_ip", ip);

  const emailAttempts = await countAttempts("forgot_email", email, 60);
  const found = await query("select id, email, name from users where email = $1 limit 1", [email]);
  const user = found.rows[0];
  if (user && emailAttempts < 5) {
    await recordAttempt("forgot_email", email);
    await query("update password_resets set used_at = now() where user_id = $1 and used_at is null", [user.id]);
    const raw = token();
    await query(
      `insert into password_resets (user_id, token_hash, expires_at)
       values ($1, $2, now() + ($3::int * interval '1 minute'))`,
      [user.id, tokenHash(raw), RESET_MINUTES],
    );
    const link = appUrlFor(`/reset-password?token=${encodeURIComponent(raw)}`);
    await sendPasswordResetEmail(user, link, RESET_MINUTES).catch((error) => {
      console.error("[jotbox-auth] reset email failed", error instanceof Error ? error.message : error);
    });
    await query("delete from password_resets where expires_at < now() - interval '7 days'");
  }

  sendJson(res, 200, {
    message: "If that email has a JotBox account, a reset link is on its way.",
  });
}

export async function handleResetPassword(req, res) {
  requireMethod(req, ["POST"]);
  assertSameOrigin(req);
  const parsed = resetSchema.safeParse(await readJson(req, 20_000));
  if (!parsed.success) throw new HttpError(400, validationMessage(parsed));

  const found = await query(
    `select r.id as reset_id, u.id, u.email, u.name
       from password_resets r
       join users u on u.id = r.user_id
      where r.token_hash = $1
        and r.used_at is null
        and r.expires_at > now()
      limit 1`,
    [tokenHash(parsed.data.token)],
  );
  const row = found.rows[0];
  if (!row) {
    throw new HttpError(400, "This reset link has expired or was already used. Ask for a new one.");
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await query("update users set password_hash = $2, updated_at = now() where id = $1", [row.id, passwordHash]);
  await query("update password_resets set used_at = now() where id = $1", [row.reset_id]);
  await query("delete from auth_sessions where user_id = $1", [row.id]);
  await sendPasswordChangedEmail(row).catch((error) => {
    console.error("[jotbox-auth] password changed email failed", error instanceof Error ? error.message : error);
  });

  sendJson(res, 200, {
    message: "Your password is changed. Sign in with the new one.",
  });
}
