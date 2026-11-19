import { handleCaptures } from "../server/api/captures.mjs";
import { guard } from "../server/api/http.mjs";

// Audio uploads and job polling read the raw request stream themselves.
export const config = { api: { bodyParser: false } };

export default guard((req, res) => handleCaptures(req, res));

