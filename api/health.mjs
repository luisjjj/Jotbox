import { handleHealth } from "../server/api/health.mjs";
import { guard } from "../server/api/http.mjs";

export default guard((req, res) => handleHealth(req, res));
