import { handleLiveTranscribe, handleTranscribe } from "../server/api/ai.mjs";
import { guard } from "../server/api/http.mjs";

export const config = { api: { bodyParser: false } };

export default guard((req, res) => {
  const live = new URL(String(req.url || ""), "http://jotbox.local").searchParams.get("live") === "1";
  return live ? handleLiveTranscribe(req, res) : handleTranscribe(req, res);
});
