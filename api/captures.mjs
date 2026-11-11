import { handleCaptures } from "../server/api/captures.mjs";
import { guard } from "../server/api/http.mjs";

export default guard((req, res) => handleCaptures(req, res));

