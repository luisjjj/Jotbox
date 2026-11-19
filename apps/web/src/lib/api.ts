import type { Session, TranscriptLine } from "./types";
import type { SpeakerMatch } from "./speakers";
import type { DashboardRole } from "./roles";

export interface CloudUser {
  id: string;
  email: string;
  name: string;
  role: DashboardRole | null;
  onboardedAt?: number | null;
  createdAt?: number;
}

export type OrgRole = "owner" | "admin" | "manager" | "member";
export type CaptureVisibility = "private" | "department" | "organisation";
export type CaptureSensitivity = "standard" | "confidential";

export type BillingPlanStatus = "active" | "attention" | "non-renewing" | "cancelled" | "completed";

export interface EnterpriseInvite {
  company: string;
  contactEmail: string;
  contactName: string;
  seats: number;
  priceUsd: number;
  notes: string;
  checklist: Record<string, boolean>;
  accepted: boolean;
  acceptedAt: number | null;
  openedAt: number | null;
  createdAt: number;
  expiresAt: number;
  signedInEmail: string | null;
}

export interface PartnerReferral {
  email: string;
  joinedAt: number;
  status: string;
  payments: number;
  grossKobo: number;
  commissionKobo: number;
  lastPaidAt: number | null;
}

export interface PartnerPayment {
  reference: string;
  amountKobo: number;
  commissionKobo: number;
  currency: string;
  paidAt: number;
  email: string;
}

export interface PartnerPayout {
  id: string;
  amountKobo: number;
  currency: string;
  paidAt: number;
  note: string;
}

export interface PartnerDashboard {
  partner: { name: string; slug: string; commissionPercent: number; link: string };
  stats: {
    currency: string;
    signups: number;
    paying: number;
    active: number;
    grossKobo: number;
    commissionKobo: number;
    paidOutKobo: number;
    balanceKobo: number;
  };
  referrals: PartnerReferral[];
  payments: PartnerPayment[];
  payouts: PartnerPayout[];
}

export type IntegrationProvider = "google" | "outlook" | "jira";
export interface IntegrationProviderStatus {
  provider: IntegrationProvider;
  label: string;
  configured: boolean;
  connected: boolean;
  accountLabel: string;
  siteName: string;
  connectedAt: number | null;
  needsReconnect: boolean;
  scopes: string;
}

export interface IntegrationsStatus {
  pro: boolean;
  encryptionReady: boolean;
  providers: IntegrationProviderStatus[];
}

export interface CalendarEvent {
  id: string;
  provider: "google" | "outlook";
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  attendees: string[];
  joinUrl: string | null;
  webUrl: string | null;
  description: string;
}

export interface CalendarFeed {
  connected: boolean;
  events: CalendarEvent[];
  warnings: { provider: IntegrationProvider; label: string; message: string }[];
  window: { start: number; end: number; days: number };
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

export interface JiraProjectList {
  site: { name: string; url: string };
  projects: JiraProject[];
  issueTypes: string[];
}

export interface JiraHandoffLink {
  actionId: string;
  key: string;
  url: string;
  createdAt?: number;
}

export interface JiraHandoffResult {
  created: JiraHandoffLink[];
  existing: JiraHandoffLink[];
  failed: { actionId: string; message: string }[];
  site: { name: string; url: string };
}

export interface BillingPricing {
  usd: number;
  naira: number;
  ngnPerUsd: number;
  currency: string;
  interval: string;
}

export interface BillingSubscription {
  planKey: string;
  status: BillingPlanStatus;
  currency: string;
  amount: number;
  interval: string;
  nextPaymentAt: number | null;
  periodEnd: number | null;
  startedAt: number | null;
  cancelledAt: number | null;
  reconciledAt: number | null;
}

export type Plan = "free" | "pro" | "enterprise";

export interface BillingUsage {
  unlimited: boolean;
  usedSeconds: number;
  limitSeconds: number | null;
  remainingSeconds: number | null;
  periodStart: number | null;
  periodEnd: number | null;
}

export interface BillingStatus {
  configured: boolean;
  plan: Plan;
  subscription: BillingSubscription | null;
  pricing: BillingPricing;
  usage: BillingUsage;
  payment?: string;
}

export interface CheckoutSession {
  authorizationUrl: string;
  reference: string;
  pricing: BillingPricing;
}

export interface Organisation {
  id: string;
  name: string;
  role: OrgRole;
  departmentId: string | null;
  departmentName?: string | null;
  retentionDays: number;
  memberCount: number;
  departmentCount: number;
  captureCount: number;
  createdAt: number;
}

export interface OrgDepartment {
  id: string;
  name: string;
  memberCount: number;
  createdAt: number;
}

export interface OrgMember {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  departmentId: string | null;
  departmentName: string | null;
  joinedAt: number;
}

export interface OrgShare {
  id: string;
  title: string;
  kind: "meeting" | "seminar" | "lecture" | "voice";
  visibility: CaptureVisibility;
  sensitivity: CaptureSensitivity;
  departmentId: string | null;
  departmentName: string | null;
  createdAt: number;
  grantUserIds: string[];
}

export interface OrgAuditEvent {
  id: number;
  action: string;
  metadata: Record<string, unknown>;
  captureId: string | null;
  actorName: string;
  actorEmail: string;
  createdAt: number;
}

export interface OrgDetail {
  org: {
    id: string;
    name: string;
    role: OrgRole;
    departmentId: string | null;
    retentionDays: number;
    createdAt: number;
    memberCount: number;
    departmentCount: number;
    captureCount: number;
  };
  departments: OrgDepartment[];
  members: OrgMember[];
  shares: OrgShare[];
  audit: OrgAuditEvent[];
}

export interface MemorySource {
  id: string;
  title: string;
  kind: string;
  date: string;
  department: string | null;
  sensitivity: CaptureSensitivity;
  owner: string;
}

export interface MemoryAnswer {
  answer: string;
  timeline: { date: string; title: string; text: string; sourceIds: string[] }[];
  recorded: { text: string; sourceIds: string[] }[];
  inferences: { text: string; basis: string }[];
  reasonMissing: boolean;
  reasonNote: string;
  sources: MemorySource[];
  scope: {
    role: OrgRole;
    retentionDays: number;
    considered: number;
    used: number;
    provider: string;
    model: string;
  };
}

export interface MemoryChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface SharedCaptureView {
  id: string;
  title: string;
  kind: Session["kind"];
  status: Session["status"];
  createdAt: number;
  durationSec: number;
  notes: Session["notes"];
  transcript: Session["transcript"];
  visibility: CaptureVisibility;
  sensitivity: CaptureSensitivity;
  departmentId: string | null;
  departmentName: string | null;
  ownerName: string;
}

export interface ShareLink {
  id: string;
  hint: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  views: number;
}

export interface PublicShare {
  id: string;
  title: string;
  kind: Session["kind"];
  status: Session["status"];
  createdAt: number;
  durationSec: number;
  notes: Session["notes"];
  transcript: Session["transcript"];
  participants: NonNullable<Session["participants"]>;
  ownerName: string;
  expiresAt: number | null;
}

export interface ShareInput {
  captureId: string;
  visibility: CaptureVisibility;
  sensitivity: CaptureSensitivity;
  departmentId?: string | null;
  grantUserIds?: string[];
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const AUTH_EXPIRED_EVENT = "jotbox:auth-expired";

function authExpired(path: string) {
  if (typeof window === "undefined") return;
  const route = path.split("?")[0];
  if (route === "/api/auth/login" || route === "/api/auth/register" || route === "/api/auth/me") return;
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError("Could not reach JotBox. Check your connection.", 0);
  }

  if (response.status === 401) authExpired(path);

  if (response.status === 204) return undefined as T;

  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new ApiError(data?.error ?? "The request could not be completed.", response.status);
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: CloudUser | null }>("/api/auth/me"),
  login: (input: { email: string; password: string }) =>
    request<{ user: CloudUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  register: (input: { name: string; email: string; password: string }) =>
    request<{ user: CloudUser }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateProfile: (role: DashboardRole) =>
    request<{ user: CloudUser }>("/api/auth/profile", {
      method: "POST",
      body: JSON.stringify({ role }),
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  forgotPassword: (email: string) =>
    request<{ message: string }>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resetPassword: (input: { token: string; password: string }) =>
    request<{ message: string }>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getOnboarding: (token: string) =>
    request<{ invite: EnterpriseInvite }>(`/api/onboarding/${encodeURIComponent(token)}`),
  checkOnboardingStep: (token: string, step: string, done: boolean) =>
    request<{ checklist: Record<string, boolean> }>("/api/onboarding", {
      method: "POST",
      body: JSON.stringify({ token, action: "check", step, done }),
    }),
  acceptOnboarding: (token: string) =>
    request<{ accepted: boolean; acceptedAt: number; acceptedByEmail: string | null }>("/api/onboarding", {
      method: "POST",
      body: JSON.stringify({ token, action: "accept" }),
    }),
  listCaptures: async () => (await request<{ sessions: Session[] }>("/api/captures")).sessions,
  saveCapture: (session: Session) =>
    request<{ id: string }>("/api/captures", {
      method: "POST",
      body: JSON.stringify({ session }),
    }),
  deleteCapture: (id: string) =>
    request<void>(`/api/captures?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  listOrgs: async () => (await request<{ orgs: Organisation[] }>("/api/orgs")).orgs,
  createOrg: async (name: string) =>
    (await request<{ org: Organisation }>("/api/orgs", { method: "POST", body: JSON.stringify({ name }) })).org,
  getOrg: (id: string) => request<OrgDetail>(`/api/orgs/${encodeURIComponent(id)}`),
  updateOrg: (id: string, input: { name?: string; retentionDays?: number }) =>
    request<{ org: Organisation }>(`/api/orgs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  createDepartment: (orgId: string, name: string) =>
    request<{ department: OrgDepartment }>(`/api/orgs/${encodeURIComponent(orgId)}/departments`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  addMember: (orgId: string, input: { email: string; role: OrgRole; departmentId?: string | null }) =>
    request<{ member: OrgMember }>(`/api/orgs/${encodeURIComponent(orgId)}/members`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateMember: (orgId: string, userId: string, input: { role?: OrgRole; departmentId?: string | null }) =>
    request<{ member: OrgMember }>(
      `/api/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  removeMember: (orgId: string, userId: string) =>
    request<void>(`/api/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    }),
  shareCapture: (orgId: string, input: ShareInput) =>
    request<{ share: OrgShare }>(`/api/orgs/${encodeURIComponent(orgId)}/captures`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  unshareCapture: (orgId: string, captureId: string) =>
    request<void>(
      `/api/orgs/${encodeURIComponent(orgId)}/captures/${encodeURIComponent(captureId)}`,
      { method: "DELETE" },
    ),
  getSharedCapture: (orgId: string, captureId: string) =>
    request<{ capture: SharedCaptureView }>(
      `/api/orgs/${encodeURIComponent(orgId)}/captures/${encodeURIComponent(captureId)}`,
    ),
  getAudit: async (orgId: string) =>
    (await request<{ audit: OrgAuditEvent[] }>(`/api/orgs/${encodeURIComponent(orgId)}/audit`)).audit,
  queryMemory: (orgId: string, question: string, history: MemoryChatTurn[] = []) =>
    request<MemoryAnswer>(`/api/orgs/${encodeURIComponent(orgId)}/memory`, {
      method: "POST",
      body: JSON.stringify({ question, history }),
    }),
  listShareLinks: async (captureId: string) =>
    (
      await request<{ links: ShareLink[] }>(
        `/api/share?captureId=${encodeURIComponent(captureId)}`,
      )
    ).links,
  createShareLink: (captureId: string, days: number) =>
    request<{ link: ShareLink; token: string; url: string }>("/api/share", {
      method: "POST",
      body: JSON.stringify({ captureId, days }),
    }),
  revokeShareLink: (id: string) =>
    request<{ id: string }>(`/api/share?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  getPublicShare: (token: string) =>
    request<{ capture: PublicShare }>(`/api/share?token=${encodeURIComponent(token)}`),
  getPartnerDashboard: (token: string) =>
    request<PartnerDashboard>(`/api/referrals/${encodeURIComponent(token)}`),
  billingStatus: () => request<BillingStatus>("/api/billing"),
  reconcileBilling: () => request<BillingStatus>("/api/billing?action=reconcile"),
  startCheckout: () =>
    request<CheckoutSession>("/api/billing?action=checkout", {
      method: "POST",
      headers: { "Idempotency-Key": `checkout:${crypto.randomUUID()}` },
    }),
  verifyCheckout: (reference: string) =>
    request<BillingStatus>("/api/billing?action=verify", {
      method: "POST",
      body: JSON.stringify({ reference }),
    }),
  cancelSubscription: () =>
    request<BillingStatus>("/api/billing?action=cancel", { method: "POST" }),
  integrations: () => request<IntegrationsStatus>("/api/integrations"),
  connectIntegration: (provider: IntegrationProvider) =>
    request<{ authUrl: string }>("/api/integrations?action=connect", {
      method: "POST",
      body: JSON.stringify({ provider }),
    }),
  disconnectIntegration: (provider: IntegrationProvider) =>
    request<IntegrationsStatus>("/api/integrations?action=disconnect", {
      method: "POST",
      body: JSON.stringify({ provider }),
    }),
  calendarUpcoming: (days = 7) =>
    request<CalendarFeed>(`/api/integrations?action=calendar&days=${days}`),
  jiraProjects: () => request<JiraProjectList>("/api/integrations?action=jira-projects"),
  jiraHandoff: (input: {
    sessionId: string;
    actionIds: string[];
    projectKey: string;
    issueType: string;
    includeContext: boolean;
  }) =>
    request<JiraHandoffResult>("/api/integrations?action=jira-handoff", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  sessionHandoffs: async (sessionId: string) =>
    (
      await request<{ handoffs: JiraHandoffLink[] }>(
        `/api/integrations?action=handoffs&sessionId=${encodeURIComponent(sessionId)}`,
      )
    ).handoffs,
  suggestSpeakers: (input: {
    title: string;
    kind: Session["kind"];
    participants: string[];
    transcript: TranscriptLine[];
  }) =>
    request<{ matches: SpeakerMatch[] }>("/api/assist", {
      method: "POST",
      body: JSON.stringify({ mode: "names", ...input }),
    }),
};
