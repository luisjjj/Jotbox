import { handleOnboarding } from "../server/api/onboarding.mjs";
import { guard } from "../server/api/http.mjs";

export default guard((req, res) => handleOnboarding(req, res));
