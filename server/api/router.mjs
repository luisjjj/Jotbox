import { handleHealth } from "./health.mjs";
import {
  handleForgotPassword,
  handleLogin,
  handleLogout,
  handleMe,
  handleRegister,
  handleResetPassword,
  handleUpdateProfile,
} from "./auth.mjs";
import { handleCaptures } from "./captures.mjs";
import { handleOrgs } from "./orgs.mjs";
import { handleAssist, handleEnhance, handleLiveTranscribe, handleTranscribe } from "./ai.mjs";
import { handleBilling } from "./billing.mjs";
import { handleShare } from "./share.mjs";
import { handleDownloadWindows } from "./download.mjs";
import { handleOnboarding } from "./onboarding.mjs";
import { handleIntegrationCallback, handleIntegrations } from "./integrations.mjs";

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
  if (pathname === "/api/auth/profile") {
    await handleUpdateProfile(req, res);
    return true;
  }
  if (pathname === "/api/auth/forgot-password") {
    await handleForgotPassword(req, res);
    return true;
  }
  if (pathname === "/api/auth/reset-password") {
    await handleResetPassword(req, res);
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
    const live = new URL(req.url || "/", "http://localhost").searchParams.get("live") === "1";
    await (live ? handleLiveTranscribe(req, res) : handleTranscribe(req, res));
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
  if (pathname === "/api/download/windows") {
    await handleDownloadWindows(req, res);
    return true;
  }
  if (pathname === "/api/onboarding" || pathname.startsWith("/api/onboarding/")) {
    const token = pathname.startsWith("/api/onboarding/")
      ? decodeURIComponent(pathname.slice("/api/onboarding/".length))
      : "";
    if (token) req.url = `/api/onboarding?token=${encodeURIComponent(token)}`;
    await handleOnboarding(req, res);
    return true;
  }
  if (pathname === "/api/integrations") {
    await handleIntegrations(req, res);
    return true;
  }
  if (/^\/api\/integrations\/(google|outlook|jira)\/callback$/.test(pathname)) {
    await handleIntegrationCallback(req, res);
    return true;
  }
  return false;
}
