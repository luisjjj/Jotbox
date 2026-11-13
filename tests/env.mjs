import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function loadEnv() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return process.env.DATABASE_URL || null;
}
