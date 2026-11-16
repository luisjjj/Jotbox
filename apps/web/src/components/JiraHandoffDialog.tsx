import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, ExternalLink, Loader2, Send } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import clsx from "clsx";
import { Modal } from "./Modal";
import { Select } from "./Select";
import { api, ApiError, type JiraHandoffLink, type JiraHandoffResult, type JiraProjectList } from "@/lib/api";
import type { Session } from "@/lib/types";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "JotBox could not reach Jira.";
}

export function JiraHandoffDialog({
  session,
  open,
  existing,
  onClose,
  onHandedOff,
}: {
  session: Session;
  open: boolean;
  existing: JiraHandoffLink[];
  onClose: () => void;
  onHandedOff: (links: JiraHandoffLink[]) => void;
}) {
  const actions = session.notes?.actions ?? [];
  const [data, setData] = useState<JiraProjectList | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<{ text: string; pro?: boolean; setup?: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [projectKey, setProjectKey] = useState("");
  const [issueType, setIssueType] = useState("Task");
  const [includeContext, setIncludeContext] = useState(true);
  const [busy, setBusy] = useState(false);

  const handedOff = useMemo(() => new Map(existing.map((link) => [link.actionId, link])), [existing]);
  const selectable = actions.filter((action) => !handedOff.has(action.id));

  useEffect(() => {
    if (!open) return;
    setProblem(null);
    setData(null);
    setBusy(false);
    setSelected(
      new Set(
        actions
          .filter((action) => !action.done && !existing.some((link) => link.actionId === action.id))
          .map((action) => action.id),
      ),
    );
    setLoading(true);
    api
      .jiraProjects()
      .then((list) => {
        setData(list);
        setProjectKey(list.projects[0]?.key ?? "");
        setIssueType(list.issueTypes.includes("Task") ? "Task" : list.issueTypes[0] ?? "Task");
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 402) {
          setProblem({ text: "Sending actions to Jira is part of Pro.", pro: true });
        } else if (error instanceof ApiError && error.status === 404) {
          setProblem({ text: "Jira is not connected yet. Connect it on your account page first.", setup: true });
        } else {
          setProblem({ text: errorText(error) });
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session.id]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!projectKey || selected.size === 0) return;
    setBusy(true);
    try {
      const result: JiraHandoffResult = await api.jiraHandoff({
        sessionId: session.id,
        actionIds: [...selected],
        projectKey,
        issueType,
        includeContext,
      });
      const links = [...result.created, ...result.existing];
      onHandedOff(links);
      if (result.created.length > 0) {
        toast.success(result.created.length === 1 ? "Ticket created in Jira" : `${result.created.length} tickets created in Jira`);
      }
      if (result.failed.length > 0) {
        toast.error(
          result.failed.length === 1
            ? "One action could not be sent. Check Jira and try again."
            : `${result.failed.length} actions could not be sent. Try again.`,
        );
        setSelected(new Set(result.failed.map((item) => item.actionId)));
      } else {
        onClose();
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 402) {
        setProblem({ text: "Sending actions to Jira is part of Pro.", pro: true });
      } else {
        toast.error(errorText(error));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="Send actions to Jira"
      description={
        data
          ? `${data.site.name || "Jira"} · pick the actions and a project. Each action becomes one ticket.`
          : "Turn this session's action items into Jira tickets."
      }
      wide
    >
      {loading ? (
        <div className="grid place-items-center rounded-xl border border-line bg-raised-2 p-8">
          <Loader2 className="h-5 w-5 animate-spin text-faint" />
        </div>
      ) : problem ? (
        <div className="rounded-xl border border-line bg-raised-2 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-rec" />
            <div>
              <p className="text-[14.5px] leading-6 text-soft">{problem.text}</p>
              <Link
                to="/account"
                className="btn btn-line btn-sm mt-3"
                onClick={onClose}
              >
                {problem.pro ? "See plans" : "Open account settings"}
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="label">Actions</p>
            {actions.length === 0 ? (
              <p className="rounded-xl border border-line bg-raised-2 px-3.5 py-3 text-[13.5px] text-muted">
                This session has no action items yet.
              </p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised-2">
                {actions.map((action) => {
                  const link = handedOff.get(action.id);
                  const checked = selected.has(action.id);
                  return (
                    <li key={action.id} className="flex items-start gap-3 px-3.5 py-3">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={checked || Boolean(link)}
                        disabled={Boolean(link) || busy}
                        className="action-box mt-0.5"
                        data-done={checked || Boolean(link)}
                        onClick={() => toggle(action.id)}
                        aria-label={`${checked ? "Remove" : "Add"} ${action.text}`}
                      >
                        {(checked || link) && <Check className="h-3 w-3" strokeWidth={3} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={clsx("text-[14.5px] leading-5", link ? "text-muted" : "text-soft")}>{action.text}</p>
                        <p className="mt-0.5 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-faint">{action.owner}</p>
                      </div>
                      {link && (
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="chip flex-none border-transparent bg-accent-soft text-accent"
                        >
                          {link.key}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {selectable.length === 0 && actions.length > 0 && (
              <p className="mt-2 text-[12.5px] text-faint">Every action here is already in Jira.</p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="jira-project">
                Project
              </label>
              <Select
                id="jira-project"
                value={projectKey}
                onChange={setProjectKey}
                disabled={busy || !data?.projects.length}
                options={(data?.projects ?? []).map((project) => ({
                  value: project.key,
                  label: `${project.key} · ${project.name}`,
                }))}
              />
              {data && data.projects.length === 0 && (
                <p className="mt-1.5 text-[12.5px] text-rec">No projects found for this Jira account.</p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="jira-issue-type">
                Ticket type
              </label>
              <Select
                id="jira-issue-type"
                value={issueType}
                onChange={setIssueType}
                disabled={busy}
                options={(data?.issueTypes ?? ["Task"]).map((type) => ({ value: type, label: type }))}
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-raised-2 px-3.5 py-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 flex-none accent-[var(--accent)]"
              checked={includeContext}
              onChange={(event) => setIncludeContext(event.target.checked)}
              disabled={busy}
            />
            <span className="text-[13.5px] leading-5 text-soft">
              Add a short note about where this came from, plus a link back to the session.
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <p className="text-[12.5px] text-faint">
              {selected.size === 0 ? "Choose at least one action." : `${selected.size} selected`}
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-line btn-sm" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void submit()}
                disabled={busy || selected.size === 0 || !projectKey}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Send to Jira
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
