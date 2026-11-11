import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { notesApi } from "./server/apiPlugin";

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, path.resolve(__dirname, "../.."), ""),
    ...loadEnv(mode, __dirname, ""),
  };
  const apiKey = env.XAI_API_KEY || process.env.XAI_API_KEY || "";

  return {
    plugins: [
      react(),
      notesApi(apiKey),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.svg", "apple-touch-icon.png", "icons/*.png"],
        manifest: {
          name: "JotBox — notes without the typing",
          short_name: "JotBox",
          description: "Notes from meetings, seminars, and lectures — without the typing.",
          theme_color: "#f5f4ef",
          background_color: "#f5f4ef",
          display: "standalone",
          orientation: "any",
          scope: "/",
          start_url: "/",
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
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: "StaleWhileRevalidate",
              options: { cacheName: "google-fonts-stylesheets" },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "google-fonts-webfonts",
                expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
          ],
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
