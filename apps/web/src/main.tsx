import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { loadSampleSessions } from "./lib/seed";
import { applyStoredTheme } from "./lib/theme";
import "./index.css";

applyStoredTheme();

if (new URLSearchParams(window.location.search).has("demo")) {
  loadSampleSessions();
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element missing");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
