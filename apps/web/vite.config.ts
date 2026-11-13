import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { notesApi } from "./server/apiPlugin";

const SERVER_ENV = [
  "DATABASE_URL",
  "DATABASE_URL_OWNER",
  "APP_DB_PASSWORD",
  "GROQ_API_KEY",
  "GROQ_STT_MODEL",
  "GROQ_NOTES_MODEL",
  "GROQ_MEMORY_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_NOTES_MODEL",
  "OPENROUTER_MEMORY_MODEL",
  "WHISPER_BASE_URL",
  "WHISPER_API_KEY",
  "WHISPER_MODEL",
  "XAI_API_KEY",
  "XAI_STT_MODEL",
  "XAI_NOTES_MODEL",
  "XAI_MEMORY_MODEL",
  "JOTBOX_AI_MOCK",
  "JOTBOX_AI_TONE",
  "JOTBOX_MEMORY_TEMPERATURE",
  "JOTBOX_MEMORY_MAX_TOKENS",
  "JOTBOX_STT_LANGUAGE",
  "JOTBOX_NOTES_TEMPERATURE",
  "JOTBOX_NOTES_MAX_TOKENS",
  "JOTBOX_AI_NO_RATE_LIMIT",
  "JOTBOX_PUBLIC_URL",
  "PAYSTACK_SECRET_KEY",
  "PAYSTACK_PLAN_CODE",
  "PAYSTACK_PRO_AMOUNT_NGN",
  "JOTBOX_USD_TO_NGN",
];

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, path.resolve(__dirname, "../.."), ""),
    ...loadEnv(mode, __dirname, ""),
  };
  for (const name of SERVER_ENV) {
    if (env[name] !== undefined && process.env[name] === undefined) process.env[name] = env[name];
  }

  return {
    plugins: [
      react(),
      notesApi(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: [
          "favicon.svg",
          "favicon.ico",
          "favicon-16.png",
          "favicon-32.png",
          "favicon-48.png",
          "apple-touch-icon.png",
          "icons/*.png",
          "fonts/*.woff",
        ],
        manifest: {
          name: "JotBox: the notes are written while you listen",
          short_name: "JotBox",
          description: "Notes from meetings, seminars, and lectures without the typing.",
          theme_color: "#f5f4ef",
          background_color: "#f5f4ef",
          display: "standalone",
          orientation: "any",
          scope: "/",
          start_url: "/app",
          icons: [
            {
              src: "/icons/icon-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/icons/icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/icons/icon-maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "/favicon.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/api\//],
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@jotbox/config": path.resolve(__dirname, "../../packages/config/src/index.ts"),
      },
    },
    server: {
      port: 3100,
      host: true,
      watch: {
        ignored: ["**/.*.tmpdir/**", "**/.shots/**"],
      },
    },
    preview: {
      port: 3101,
    },
  };
});
