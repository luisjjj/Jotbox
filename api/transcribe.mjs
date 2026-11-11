import { handleTranscribe } from "../server/api/ai.mjs";
import { guard } from "../server/api/http.mjs";

export const config = { api: { bodyParser: false } };

export default guard((req, res) => handleTranscribe(req, res));
