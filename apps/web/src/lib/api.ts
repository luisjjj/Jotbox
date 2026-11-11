import type { Session } from "./types";

export interface CloudUser {
  id: string;
  email: string;
  name: string;
  createdAt?: number;
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
    throw new ApiError("Could not reach the JotBox server. Check your connection.", 0);
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
};
