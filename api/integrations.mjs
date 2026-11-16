import { guard } from "../server/api/http.mjs";
import { handleIntegrations } from "../server/api/integrations.mjs";

export default guard((req, res) => handleIntegrations(req, res));
