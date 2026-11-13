import { handleAssist } from "../server/api/ai.mjs";
import { guard } from "../server/api/http.mjs";

export const config = { api: { bodyParser: false } };

export default guard((req, res) => handleAssist(req, res));
