import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { loadSampleSessions } from "./lib/seed";
import { applyStoredTheme } from "./lib/theme";
import "./lib/posthog";
import IslandPage from "./pages/IslandPage";
import "./index.css";

applyStoredTheme();

if (import.meta.env.PROD) {
  const MIN_CHECK_GAP_MS = 60_000;
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      let lastCheck = 0;
      const check = () => {
        if (document.visibilityState !== "visible") return;
        const now = Date.now();
        if (now - lastCheck < MIN_CHECK_GAP_MS) return;
        lastCheck = now;
        void registration.update();
      };
      document.addEventListener("visibilitychange", check);
      window.addEventListener("online", check);
    },
  });
}

if (new URLSearchParams(window.location.search).has("demo")) {
  loadSampleSessions();
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element missing");
}

// The desktop overlay renders the island on its own, so no auth, engine or
// cloud sync side effects run in the transparent window.
const bare = window.location.pathname.replace(/\/+$/, "") === "/island";

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {bare ? (
      <IslandPage />
    ) : (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )}
  </React.StrictMode>,
);
