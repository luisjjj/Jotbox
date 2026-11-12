import { handleOrgs } from "../../../server/api/orgs.mjs";
import { guard } from "../../../server/api/http.mjs";

export default guard((req, res) => handleOrgs(req, res));
