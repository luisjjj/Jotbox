import { handleEnhance } from "../server/api/ai.mjs";
import { guard } from "../server/api/http.mjs";

export default guard((req, res) => handleEnhance(req, res));
