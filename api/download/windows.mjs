import { handleDownloadWindows } from "../../server/api/download.mjs";
import { guard } from "../../server/api/http.mjs";

export default guard((req, res) => handleDownloadWindows(req, res));
