import { handleMe } from "../../server/api/auth.mjs";
import { guard } from "../../server/api/http.mjs";

export default guard((req, res) => handleMe(req, res));

