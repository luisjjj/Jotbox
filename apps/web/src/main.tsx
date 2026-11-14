import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { loadSampleSessions } from "./lib/seed";
import { applyStoredTheme } from "./lib/theme";
import IslandPage from "./pages/IslandPage";
import "./index.css";

applyStoredTheme();

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
