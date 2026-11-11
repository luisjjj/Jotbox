import { Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "@/auth/AuthProvider";
import { AppShell } from "@/components/AppShell";
import { CloudSync } from "@/components/CloudSync";
import { EngineProvider } from "@/engine/SessionEngine";
import AccountPage from "@/pages/Account";
import FloatPage from "@/pages/FloatPage";
import Home from "@/pages/Home";
import Landing from "@/pages/Landing";
import Library from "@/pages/Library";
import Listen from "@/pages/Listen";
import NotFound from "@/pages/NotFound";
import SessionPage from "@/pages/SessionPage";
import Settings from "@/pages/Settings";

export default function App() {
  return (
    <AuthProvider>
      <EngineProvider>
        <CloudSync />
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              background: "var(--raised)",
              color: "var(--ink)",
              border: "1px solid var(--line)",
              borderRadius: "12px",
              fontSize: "13px",
              boxShadow: "var(--shadow-md)",
            },
            success: {
              iconTheme: { primary: "var(--accent)", secondary: "var(--accent-ink)" },
            },
            error: {
              iconTheme: { primary: "var(--rec)", secondary: "#fff8f6" },
            },
          }}
        />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route element={<AppShell />}>
            <Route path="app" element={<Home />} />
            <Route path="listen" element={<Listen />} />
            <Route path="library" element={<Library />} />
            <Route path="session/:id" element={<SessionPage />} />
            <Route path="float" element={<FloatPage />} />
            <Route path="settings" element={<Settings />} />
            <Route path="account" element={<AccountPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </EngineProvider>
    </AuthProvider>
  );
}
