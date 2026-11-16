#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const venvPython =
  process.platform === "win32" ? join(here, ".venv", "Scripts", "python.exe") : join(here, ".venv", "bin", "python");
const python = existsSync(venvPython) ? venvPython : "python";
const result = spawnSync(python, process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status ?? 1);
