import { handleBilling } from "../server/api/billing.mjs";
import { guard } from "../server/api/http.mjs";

export const config = { api: { bodyParser: false } };

export default guard((req, res) => handleBilling(req, res));
