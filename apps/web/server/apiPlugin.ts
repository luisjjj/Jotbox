import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
// @ts-expect-error shared Node handlers are plain ESM, outside the Vite TS project
import { handleCoreApi } from "../../../server/api/router.mjs";

export function notesApi(): Plugin {
  const handle = async (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const pathname = (req.url ?? "").split("?")[0];
    if (!pathname.startsWith("/api/")) {
      next();
      return;
    }
    try {
      if (await handleCoreApi(req, res)) {
        return;
      }
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
      const message = error instanceof Error ? error.message : "Request failed";
      res.statusCode = Number.isFinite(status) ? status : 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: message.slice(0, 400) }));
    }
  };

  return {
    name: "jotbox-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next);
      });
    },
  };
}

