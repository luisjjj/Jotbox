import { handleOrgs } from "../server/api/orgs.mjs";
import { guard } from "../server/api/http.mjs";

export default guard((req, res) => {
  const search = new URL(req.url || "/", "http://localhost").searchParams;
  const path = search.get("orgPath") || "";
  req.url = path ? `/api/orgs/${path}` : "/api/orgs";
  return handleOrgs(req, res);
});
