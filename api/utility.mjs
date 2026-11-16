import { handleForgotPassword, handleResetPassword } from "../server/api/auth.mjs";
import { handleDownloadWindows } from "../server/api/download.mjs";
import { handleHealth } from "../server/api/health.mjs";
import { guard, HttpError } from "../server/api/http.mjs";
import { handleOnboarding } from "../server/api/onboarding.mjs";

// One function for the small routes keeps the Hobby plan under 12 functions.
export default guard((req, res) => {
  const search = new URL(req.url || "/", "http://localhost").searchParams;
  const route = search.get("route");

  if (route === "health") return handleHealth(req, res);
  if (route === "download") {
    req.url = "/api/download/windows";
    return handleDownloadWindows(req, res);
  }
  if (route === "forgot") return handleForgotPassword(req, res);
  if (route === "reset") return handleResetPassword(req, res);
  if (route === "onboarding") {
    const token = search.get("token") || "";
    req.url = `/api/onboarding?token=${encodeURIComponent(token)}`;
    return handleOnboarding(req, res);
  }
  throw new HttpError(404, "Not found.");
});
