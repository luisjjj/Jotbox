import type { Session } from "./types";

export interface CloudUser {
  id: string;
  email: string;
  name: string;
  createdAt?: number;
}

export type OrgRole = "owner" | "admin" | "manager" | "member";
export type CaptureVisibility = "private" | "department" | "organisation";
export type CaptureSensitivity = "standard" | "confidential";

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
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
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
};
