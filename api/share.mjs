import { handleShare } from "../server/api/share.mjs";
import { guard } from "../server/api/http.mjs";

export const config = { api: { bodyParser: false } };

export default guard((req, res) => handleShare(req, res));
