import { handleHealth } from "./health.mjs";
import { handleLogin, handleLogout, handleMe, handleRegister } from "./auth.mjs";
import { handleCaptures } from "./captures.mjs";
import { handleOrgs } from "./orgs.mjs";
import { handleAssist, handleEnhance, handleTranscribe } from "./ai.mjs";
import { handleBilling } from "./billing.mjs";
import { handleShare } from "./share.mjs";

/**
 * Shared dispatcher for the Vite dev/preview server. The Vercel deployment
 * uses one function per route instead, but the handlers are identical.
 */
export async function handleCoreApi(req, res) {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;

  if (pathname === "/api/health") {
    await handleHealth(req, res);
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
  if (pathname === "/api/orgs" || pathname.startsWith("/api/orgs/")) {
    await handleOrgs(req, res);
    return true;
  }
  if (pathname === "/api/transcribe") {
    await handleTranscribe(req, res);
    return true;
  }
  if (pathname === "/api/enhance") {
    await handleEnhance(req, res);
    return true;
  }
  if (pathname === "/api/assist") {
    await handleAssist(req, res);
    return true;
  }
  if (pathname === "/api/share" || pathname.startsWith("/api/share/")) {
    await handleShare(req, res);
    return true;
  }
  if (pathname === "/api/billing" || pathname.startsWith("/api/billing/")) {
    await handleBilling(req, res);
    return true;
  }
  return false;
}
