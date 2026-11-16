import { guard } from "../server/api/http.mjs";
import { handleIntegrationCallback } from "../server/api/integrations.mjs";

export default guard((req, res) => handleIntegrationCallback(req, res));
