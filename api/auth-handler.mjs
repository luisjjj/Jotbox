import { handleLogin, handleLogout, handleMe, handleRegister, handleUpdateProfile } from "../server/api/auth.mjs";
import { guard, HttpError } from "../server/api/http.mjs";

const handlers = {
  register: handleRegister,
  login: handleLogin,
  logout: handleLogout,
  me: handleMe,
  profile: handleUpdateProfile,
};

// One function for the auth routes keeps room for the integration endpoints
// under the Hobby plan's 12-function limit.
export default guard((req, res) => {
  const action = new URL(req.url || "/", "http://localhost").searchParams.get("action") || "";
  const handler = handlers[action];
  if (!handler) throw new HttpError(404, "Not found.");
  req.url = `/api/auth/${action}`;
  return handler(req, res);
});
