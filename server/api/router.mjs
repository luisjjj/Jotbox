import { handleHealth } from "./health.mjs";
import { handleLogin, handleLogout, handleMe, handleRegister } from "./auth.mjs";
import { handleCaptures } from "./captures.mjs";

/**
 * Shared dispatcher for the Vite dev/preview server. The Vercel deployment
 * uses one function per route instead, but the handlers are identical.
 */
export async function handleCoreApi(req, res, { ai = false } = {}) {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;

  if (pathname === "/api/health") {
    await handleHealth(req, res, { ai });
    return true;
  }
  if (pathname === "/api/auth/register") {
    await handleRegister(req, res);
    return true;
  }
  if (pathname === "/api/auth/login") {
    await handleLogin(req, res);
    return true;
  }
  if (pathname === "/api/auth/logout") {
    await handleLogout(req, res);
    return true;
  }
  if (pathname === "/api/auth/me") {
    await handleMe(req, res);
    return true;
  }
  if (pathname === "/api/captures") {
    await handleCaptures(req, res);
    return true;
  }
  return false;
}
