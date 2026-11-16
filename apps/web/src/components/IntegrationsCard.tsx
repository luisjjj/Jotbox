import { useEffect, useRef, useState } from "react";
import { AlertCircle, CalendarDays, ListChecks, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import { toast } from "react-hot-toast";
import {
  api,
  ApiError,
  type IntegrationProvider,
  type IntegrationProviderStatus,
  type IntegrationsStatus,
} from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";

const PROVIDER_META: Record<
  IntegrationProvider,
  { blurb: string; Icon: typeof CalendarDays }
> = {
  google: {
    blurb: "See your next meetings, then start notes in one tap.",
    Icon: CalendarDays,
  },
  outlook: {
    blurb: "Pull meeting times from your Microsoft work calendar.",
    Icon: Mail,
  },
  jira: {
    blurb: "Send session action items straight into your Jira project.",
    Icon: ListChecks,
  },
};

const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  google: "Google Calendar",
  outlook: "Microsoft Outlook",
  jira: "Jira",
};

const CALLBACK_MESSAGES: Record<string, { tone: "success" | "error"; text: (label: string) => string }> = {
  connected: { tone: "success", text: (label) => `${label} connected.` },
  denied: { tone: "error", text: (label) => `${label} connection was cancelled.` },
  expired: { tone: "error", text: () => "That connection link expired. Try again." },
  error: { tone: "error", text: (label) => `${label} could not be connected. Try again.` },
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function StatusChip({ row }: { row: IntegrationProviderStatus }) {
  if (row.needsReconnect) {
    return (
      <span className="chip border-transparent bg-rec-soft text-rec">
        <AlertCircle className="h-3 w-3" />
        Reconnect
      </span>
    );
  }
  if (row.connected) {
    return (
      <span className="chip border-transparent bg-accent-soft text-accent">
        <ShieldCheck className="h-3 w-3" />
        Connected
      </span>
    );
  }
  if (!row.configured) {
    return <span className="chip text-muted">Setup needed</span>;
  }
  return <span className="chip text-muted">Not connected</span>;
}

export function IntegrationsCard() {
  const [status, setStatus] = useState<IntegrationsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<IntegrationProvider | null>(null);
  const [confirmProvider, setConfirmProvider] = useState<IntegrationProviderStatus | null>(null);
  const callbackHandled = useRef(false);

  const load = async () => {
    try {
      setStatus(await api.integrations());
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (callbackHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("integration") as IntegrationProvider | null;
    const result = params.get("status");
    if (!provider || !result) return;
    callbackHandled.current = true;
    const message = CALLBACK_MESSAGES[result];
    if (message) {
      const text = message.text(PROVIDER_LABELS[provider] ?? "That app");
      if (message.tone === "success") toast.success(text);
      else toast.error(text);
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("integration");
    url.searchParams.delete("status");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [status]);

  const connect = async (provider: IntegrationProvider) => {
    setBusy(provider);
    try {
      const { authUrl } = await api.connectIntegration(provider);
      window.location.assign(authUrl);
    } catch (error) {
      toast.error(error instanceof ApiError && error.status === 402 ? "Connections are part of Pro." : errorText(error));
      setBusy(null);
    }
  };

  const disconnect = async (provider: IntegrationProvider) => {
    setBusy(provider);
    try {
      setStatus(await api.disconnectIntegration(provider));
      toast.success("Disconnected");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(null);
      setConfirmProvider(null);
    }
  };

  const planLocked = status ? !status.pro : false;

  return (
    <>
      <section className="card mt-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-ink">Connected apps</h2>
            <p className="mt-1 max-w-[52ch] text-[13.5px] leading-5 text-muted">
              Connect your calendar to see what is next, and Jira to turn action items into tickets. You can disconnect any time.
            </p>
          </div>
          {planLocked && (
            <span className="chip text-muted">
              <Lock className="h-3 w-3" />
              Pro
            </span>
          )}
        </div>

        {status && !status.encryptionReady && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-rec-line bg-rec-soft px-3 py-2.5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-rec" />
            <p className="text-[13px] leading-5 text-soft">
              Connections are not set up on this deployment yet. Ask JotBox to finish setup.
            </p>
          </div>
        )}

        {loading ? (
          <div className="mt-4 grid place-items-center rounded-xl border border-line bg-raised-2 p-6">
            <Loader2 className="h-4 w-4 animate-spin text-faint" />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised-2">
            {status?.providers.map((row) => {
              const meta = PROVIDER_META[row.provider];
              const canConnect = status.pro && status.encryptionReady && row.configured;
              const actions = (
                <div className="flex flex-none items-center gap-2">
                  {row.connected ? (
                    <>
                      {(row.needsReconnect || !row.configured) && (
                        <button
                          type="button"
                          className="btn btn-line btn-sm"
                          disabled={busy === row.provider || !canConnect}
                          onClick={() => void connect(row.provider)}
                        >
                          {busy === row.provider ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Reconnect
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm text-muted"
                        disabled={busy === row.provider}
                        onClick={() => setConfirmProvider(row)}
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-line btn-sm"
                      disabled={!canConnect || busy === row.provider}
                      onClick={() => void connect(row.provider)}
                    >
                      {busy === row.provider ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Connect
                    </button>
                  )}
                </div>
              );
              return (
                <li key={row.provider} className="px-3.5 py-3.5">
                  <div className="flex items-start gap-3">
                    <span className="grid h-9 w-9 flex-none place-items-center rounded-xl border border-line bg-raised text-soft">
                      <meta.Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[14.5px] font-medium text-ink">{row.label}</p>
                        <StatusChip row={row} />
                      </div>
                      <p className="mt-0.5 text-[12.5px] leading-4 text-faint sm:truncate">
                        {row.connected
                          ? row.siteName
                            ? `${row.siteName}${row.accountLabel ? ` · ${row.accountLabel}` : ""}`
                            : row.accountLabel || "Connected to your JotBox account."
                          : meta.blurb}
                      </p>
                    </div>
                    <div className="hidden flex-none sm:block">{actions}</div>
                  </div>
                  <div className="mt-2.5 flex justify-end sm:hidden">{actions}</div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-4 text-faint">
          <ShieldCheck className="mt-px h-3 w-3 flex-none" />
          Access tokens are encrypted at rest. JotBox only reads meeting times and creates the Jira tickets you pick.
        </p>

        {planLocked && (
          <p className="mt-2 text-[12.5px] text-faint">
            Calendar and Jira connections are part of Pro.
          </p>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(confirmProvider)}
        title={`Disconnect ${confirmProvider?.label ?? "this app"}?`}
        description="JotBox will stop reading from or writing to this app. You can connect it again later."
        confirmLabel="Disconnect"
        tone="danger"
        onConfirm={() => confirmProvider && void disconnect(confirmProvider.provider)}
        onCancel={() => setConfirmProvider(null)}
      />
    </>
  );
}
