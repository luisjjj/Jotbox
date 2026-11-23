import { handleOrgs } from "../server/api/orgs.mjs";
import { guard } from "../server/api/http.mjs";

export default guard((req, res) => {
  const search = new URL(req.url || "/", "http://localhost").searchParams;
  const path = search.get("orgPath") || "";
  search.delete("orgPath");
  const rest = search.toString();
  req.url = `${path ? `/api/orgs/${path}` : "/api/orgs"}${rest ? `?${rest}` : ""}`;
  return handleOrgs(req, res);
});
