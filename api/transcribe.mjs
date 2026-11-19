import { handleLiveTranscribe, handleTranscribe } from "../server/api/ai.mjs";
import { handleTranscribeJob } from "../server/api/jobs.mjs";
import { guard } from "../server/api/http.mjs";

export const config = { api: { bodyParser: false } };

export default guard((req, res) => {
  const search = new URL(String(req.url || ""), "http://jotbox.local").searchParams;
  if (search.get("action") === "job") return handleTranscribeJob(req, res);
  const live = search.get("live") === "1";
  return live ? handleLiveTranscribe(req, res) : handleTranscribe(req, res);
});
