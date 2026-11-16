import { handleForgotPassword } from "../../server/api/auth.mjs";
import { guard } from "../../server/api/http.mjs";

export default guard((req, res) => handleForgotPassword(req, res));
