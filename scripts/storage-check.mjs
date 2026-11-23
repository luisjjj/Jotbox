// Uploads, reads, and deletes a small object so a new bucket can be trusted
// before a real recording depends on it.
import {
  deleteAudioObject,
  getAudio,
  headAudio,
  putAudio,
  storageConfig,
} from "../server/api/storage.mjs";

const CONTENT = Buffer.from("jotbox storage check");

async function main() {
  const config = storageConfig();
  if (!config) {
    console.error("Audio storage is not configured. Set one of each pair:");
    for (const pair of [
      "R2_BUCKET or S3_BUCKET",
      "R2_ACCESS_KEY_ID or S3_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY or S3_SECRET_ACCESS_KEY",
      "R2_ACCOUNT_ID, R2_ENDPOINT or S3_ENDPOINT",
    ]) {
      console.error(`  ${pair}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Bucket: ${config.bucket} (${config.region})`);
  console.log(`Endpoint: ${new URL(config.endpoint).host}`);

  const key = `checks/storage-check-${Date.now()}.txt`;
  await putAudio(key, CONTENT, "text/plain");
  const head = await headAudio(key);
  if (!head || head.bytes !== CONTENT.length) {
    throw new Error("The uploaded object did not report the right size.");
  }
  const back = await getAudio(key);
  if (!back.body.equals(CONTENT)) {
    throw new Error("The object came back with different bytes.");
  }
  await deleteAudioObject(key);
  const leftover = await headAudio(key);
  if (leftover) throw new Error("The object still exists after delete.");

  console.log("Round trip ok: put, head, get, delete.");
}

main().catch((error) => {
  console.error(`Storage check failed: ${error?.message || error}`);
  if (error?.detail) console.error(String(error.detail).slice(0, 300));
  process.exitCode = 1;
});
