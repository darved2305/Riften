import { useState, useEffect, useRef, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
import {
  Mark,
  Chip,
  Status,
  Empty,
  Button,
  Field,
  Modal,
  DiffText,
  nodeTypes,
  EvaluationMetrics,
} from "./ui";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Command,
  Database,
  Ellipsis,
  ExternalLink,
  FileText,
  FlaskConical,
  Folder,
  GitCompareArrows,
  Home,
  Inbox,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  MessageSquare,
  Network,
  PanelLeftClose,
  PanelRightOpen,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
  AlertCircle,
  CheckCircle2,
  Clock,
  Building2,
  CornerDownLeft,
} from "lucide-react";
import { api, post, patch, label, time, preferences } from "./api";

type Item = Record<string, any>;
type Page =
  | "Home"
  | "Overview"
  | "Regulatory sources"
  | "Change explorer"
  | "Impact graph"
  | "Impact replay"
  | "Reviews & actions"
  | "Model Lab";
const nav = [
  { name: "Home", icon: Home },
  { name: "Overview", icon: LayoutDashboard },
  { name: "Regulatory sources", icon: BookOpen },
  { name: "Change explorer", icon: GitCompareArrows },
  { name: "Impact graph", icon: Network },
  { name: "Impact replay", icon: Play },
  { name: "Reviews & actions", icon: CheckCheck },
  { name: "Model Lab", icon: FlaskConical },
] as const;

export default function App() {
  const qc = useQueryClient();
  const [page, setPage] = useState<Page>(
    nav.some(n => n.name === preferences.getItem("riften-page")) ? preferences.getItem("riften-page") as Page : "Home",
  );
  const [wid, setWid] = useState(
    new URLSearchParams(window.location.search).get("workspace") ||
      preferences.getItem("riften-workspace") ||
      "",
  );
  const [assessmentId, setAssessmentId] = useState(
    preferences.getItem("riften-assessment") || "",
  );
  const [ruleDraft, setRuleDraft] = useState<Item | null>(null);
  const [changeId, setChangeId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [modal, setModal] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null,
  );
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Item | null>(null);
  const [asking, setAsking] = useState(false);
  const [composer, setComposer] = useState("");
  const [mode, setMode] = useState("Investigate");
  const [modelMenu, setModelMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedNode, setSelectedNode] = useState<Item | null>(null);
  const [graphFilter, setGraphFilter] = useState("all");
  const [selectedTask, setSelectedTask] = useState<Item | null>(null);
  const [recordView, setRecordView] = useState(false);
  const [replaySelected, setReplaySelected] = useState("");
  const [labTab, setLabTab] = useState("Alignment");
  const [labResult, setLabResult] = useState<Item | null>(null);
  const [baseModels, setBaseModels] = useState<Item[]>([]);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const accessQ = useQuery({ queryKey: ["access"], queryFn: () => api("/access"), refetchInterval: 60000 });
  const readOnly = accessQ.data?.public_demo && !accessQ.data?.editing_allowed;
  useEffect(() => {
    if (readOnly && modal && modal !== "owner") setModal("owner");
  }, [modal, readOnly]);
  const workspaceQ = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api("/workspaces"),
    refetchInterval: 10000,
  });
  const ws: Item[] = workspaceQ.data || [];
  const current = ws.find((x) => x.id === wid);
  useEffect(() => {
    if (ws.length && !ws.some((x) => x.id === wid)) setWid(ws[0].id);
  }, [workspaceQ.data]);
  useEffect(() => {
    preferences.setItem("riften-page", page);
    setSearch("");
  }, [page]);
  useEffect(() => {
    preferences.setItem("riften-workspace", wid);
    if (wid) {
      const url = new URL(window.location.href);
      url.searchParams.set("workspace", wid);
      window.history.replaceState(null, "", url);
    }
    setSelectedNode(null);
    setSelectedTask(null);
    setAnswer(null);
    setVersionId("");
  }, [wid]);
  useEffect(() => {
    setRuleDraft(null);
  }, [changeId, assessmentId]);
  useEffect(() => {
    preferences.setItem("riften-assessment", assessmentId);
    setChangeId("");
  }, [assessmentId]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPage("Home");
        setTimeout(() => composerRef.current?.focus(), 30);
      }
      if (e.key === "Escape") {
        setAssistantOpen(false);
        setModelMenu(false);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => {
    if (toast && !toast.error) {
      const t = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const overviewQ = useQuery({
    queryKey: ["overview", wid],
    queryFn: () => api("/overview?workspace_id=" + wid),
    enabled: !!wid,
  });
  const sourcesQ = useQuery({
    queryKey: ["sources", wid],
    queryFn: () => api("/sources?workspace_id=" + wid),
    enabled: !!wid,
  });
  const assessmentsQ = useQuery({
    queryKey: ["assessments", wid],
    queryFn: () => api("/assessments?workspace_id=" + wid),
    enabled: !!wid,
  });
  const assessments: Item[] = assessmentsQ.data || [];
  useEffect(() => {
    if (assessments.length && !assessments.some((a) => a.id === assessmentId))
      setAssessmentId(assessments[0].id);
    if (!assessments.length && assessmentsQ.isSuccess) setAssessmentId("");
  }, [assessmentsQ.data]);
  const assessmentQ = useQuery({
    queryKey: ["assessment", assessmentId],
    queryFn: () => api("/assessments/" + assessmentId),
    enabled: !!assessmentId && assessments.some((a) => a.id === assessmentId),
    refetchInterval: (q) =>
      q.state.data?.status === "analyzing" ? 2500 : false,
  });
  const entitiesQ = useQuery({
    queryKey: ["entities", wid],
    queryFn: () => api("/entities?workspace_id=" + wid),
    enabled: !!wid,
  });
  const graphQ = useQuery({
    queryKey: ["graph", wid],
    queryFn: () => api("/graph?workspace_id=" + wid),
    enabled: !!wid,
  });
  const replayQ = useQuery({
    queryKey: ["replays", wid],
    queryFn: () => api("/replays?workspace_id=" + wid),
    enabled: !!wid,
  });
  const tasksQ = useQuery({
    queryKey: ["tasks", wid],
    queryFn: () => api("/tasks?workspace_id=" + wid),
    enabled: !!wid,
  });
  const labQ = useQuery({
    queryKey: ["lab", wid],
    queryFn: () => api("/model-lab?workspace_id=" + wid),
    enabled: !!wid,
    refetchInterval: page === "Model Lab" ? 30000 : false,
  });
  const sources: Item[] = sourcesQ.data || [];
  const versions = sources.flatMap((s) =>
    s.versions.map((v: Item) => ({ ...v, title: s.title, document: s })),
  );
  const versionQ = useQuery({
    queryKey: ["version", versionId],
    queryFn: () => api("/versions/" + versionId),
    enabled: !!versionId,
  });
  const historyQ = useQuery({
    queryKey: ["fetch-history", versionQ.data?.document_id],
    queryFn: () => api("/sources/" + versionQ.data.document_id + "/history"),
    enabled: !!versionQ.data?.document_id,
  });
  const a: Item | undefined = assessmentQ.data;
  const changes: Item[] = a?.changes || [];
  const change = changes.find((c) => c.id === changeId) || changes[0];
  const tasks: Item[] = tasksQ.data || [];
  const entities: Item[] = entitiesQ.data || [];
  const replays: Item[] = replayQ.data || [];
  const replay = replays.find((r) => r.id === replaySelected) || replays[0];
  const lab = labQ.data;
  useEffect(() => {
    if (page !== "Model Lab" || !lab || readOnly) return;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      const pending = new Set([
        "QUEUED",
        "PROCESSING",
        "RUNNING",
        "TRAINING",
        "ALIGNING",
        "PENDING",
      ]);
      const calls: Promise<any>[] = [];
      for (const j of lab.jobs || [])
        if (j.remote_id && pending.has(j.status))
          calls.push(post("/model-lab/jobs/" + j.id + "/refresh"));
      for (const d of lab.deployments || [])
        if (["DEPLOYING", "UNDEPLOYING"].includes(d.status))
          calls.push(post("/model-lab/deployments/" + d.id + "/refresh"));
      for (const e of lab.evaluations || [])
        if (pending.has(e.status))
          calls.push(post("/model-lab/evaluations/" + e.id + "/refresh"));
      if (calls.length) {
        const results = await Promise.allSettled(calls);
        const failure = results.find((r) => r.status === "rejected");
        if (failure?.status === "rejected")
          setToast({
            text: "Status polling failed: " + String(failure.reason),
            error: true,
          });
        await qc.invalidateQueries({ queryKey: ["lab", wid] });
      }
      inFlight = false;
    }, 15000);
    return () => clearInterval(timer);
  }, [page, lab, wid, qc, readOnly]);
  const nodeDetailsQ = useQuery({
    queryKey: ["node-details", selectedNode?.id],
    queryFn: () => api("/graph/nodes/" + selectedNode?.id),
    enabled:
      page === "Impact graph" &&
      !!selectedNode?.id &&
      !!graphQ.data?.nodes.some((n: Item) => n.id === selectedNode.id),
  });
  const activePath = new Set<string>();
  if (selectedNode?.id) {
    const descendants = new Set<string>([selectedNode.id]),
      ancestors = new Set<string>([selectedNode.id]);
    for (let i = 0; i < (graphQ.data?.nodes.length || 0); i++)
      for (const e of graphQ.data?.edges || []) {
        if (!e.verified) continue;
        if (descendants.has(e.source_id)) descendants.add(e.target_id);
        if (ancestors.has(e.target_id)) ancestors.add(e.source_id);
      }
    for (const id of [...descendants, ...ancestors]) activePath.add(id);
  }
  const connected = lab?.deployments?.some(
    (d: Item) => d.status === "DEPLOYED",
  );
  const filtered = (items: Item[], field = "name") =>
    items.filter((i) =>
      String(i[field] || "")
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const refresh = () => qc.invalidateQueries();
  async function act(fn: () => Promise<any>, message?: string, close = true) {
    setBusy(true);
    try {
      const result = await fn();
      await refresh();
      if (message) setToast({ text: message });
      if (close) setModal("");
      return result;
    } catch (e) {
      setToast({ text: (e as Error).message, error: true });
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function ask(q = question) {
    if (!q.trim()) return;
    if (readOnly) { setModal("owner"); return; }
    setAsking(true);
    setAssistantOpen(true);
    try {
      const result = await post("/assistant", {
        workspace_id: wid,
        question: q,
        assessment_id: assessmentId || null,
      });
      setAnswer(result);
      setQuestion("");
      await refresh();
    } catch (e) {
      setAnswer({ error: (e as Error).message });
    } finally {
      setAsking(false);
    }
  }
  function openAssessment(id: string) {
    setAssessmentId(id);
    setPage("Change explorer");
  }
  async function command() {
    const text = composer.trim().toLowerCase();
    if (!text) return;
    if (mode === "Compare versions" || text.includes("compare")) {
      setModal("compare");
      return;
    }
    if (text.includes("unresolved")) {
      setPage("Reviews & actions");
      return;
    }
    if (text.includes("analyz")) {
      if (!assessmentId) {
        setModal("compare");
        return;
      }
      const r = await act(
        () => post("/assessments/" + assessmentId + "/analyze"),
        "Analysis started",
        false,
      );
      if (r) setPage("Change explorer");
      return;
    }
    if (text.includes("affected") || text.includes("replay")) {
      setPage("Impact replay");
      return;
    }
    await ask(composer);
  }
  const error =
    workspaceQ.error ||
    overviewQ.error ||
    sourcesQ.error ||
    assessmentsQ.error ||
    (page === "Impact graph"
      ? graphQ.error
      : page === "Reviews & actions"
        ? tasksQ.error
        : page === "Model Lab"
          ? labQ.error
          : page === "Regulatory sources"
            ? versionQ.error
            : null);
  const pageLoading =
    overviewQ.isLoading ||
    sourcesQ.isLoading ||
    assessmentsQ.isLoading ||
    (page === "Impact graph" && graphQ.isLoading) ||
    (page === "Impact replay" && (entitiesQ.isLoading || replayQ.isLoading)) ||
    (page === "Reviews & actions" && tasksQ.isLoading);
  const toolbar = (title: string, description: string, actions?: ReactNode) => (
    <div className="page-heading">
      <div>
        <div className="eyebrow">WORKSPACE / {title.toUpperCase()}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
  const assessmentSelect = (
    <select
      aria-label="Selected assessment"
      value={assessmentId}
      onChange={(e) => setAssessmentId(e.target.value)}
    >
      {assessments.length ? (
        assessments.map((x) => (
          <option key={x.id} value={x.id}>
            {x.title} · {time(x.created_at)}
          </option>
        ))
      ) : (
        <option value="">No assessments</option>
      )}
    </select>
  );

  return (
    <div className={"app " + (collapsed ? "sidebar-collapsed" : "")}>
      <aside className="sidebar">
        <div className="brand">
          <Mark small />
          <strong>Riften</strong>
          <button
            className="icon-btn collapse"
            title="Collapse navigation"
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelLeftClose size={15} />
          </button>
        </div>
        <div className="workspace-switch">
          <span className="workspace-icon">
            <Building2 size={15} />
          </span>
          <select
            aria-label="Workspace"
            value={wid}
            onChange={(e) => {
              if (e.target.value === "new") setModal("workspace");
              else setWid(e.target.value);
            }}
          >
            <option value="" disabled>
              Select workspace
            </option>
            {ws.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
            <option value="new">+ New workspace</option>
          </select>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(({ name, icon: Icon }, i) => (
            <button
              key={name}
              onClick={() => setPage(name)}
              className={"nav-item " + (page === name ? "active" : "")}
              title={name}
            >
              <Icon size={16} />
              <span>{name}</span>
              {name === "Reviews & actions" &&
              overviewQ.data?.metrics.open_tasks > 0 ? (
                <span className="nav-count">
                  {overviewQ.data.metrics.open_tasks}
                </span>
              ) : name === "Home" ? (
                <kbd>⌘ K</kbd>
              ) : null}
              {i === 1 && <></>}
            </button>
          ))}
        </nav>
        <div className="sidebar-section">
          <div className="nav-label">
            REGULATORY LIBRARY{" "}
            <button
              className="icon-btn"
              title="Import source"
              onClick={() => (wid ? setModal("upload") : setModal("workspace"))}
            >
              <Plus size={13} />
            </button>
          </div>
          {sources.length ? (
            sources.slice(0, 4).map((s) => (
              <button
                className="library-item"
                key={s.id}
                onClick={() => {
                  setPage("Regulatory sources");
                  setVersionId(s.versions[0]?.id || "");
                }}
              >
                <ChevronRight size={11} />
                <Folder size={14} />
                <span>{s.title}</span>
              </button>
            ))
          ) : (
            <span className="sidebar-note">
              Your imported sources appear here.
            </span>
          )}
        </div>
        <div className="sidebar-bottom">
          <button
            className="assistant-link"
            aria-label="Riften Assistant"
            onClick={() => setAssistantOpen(!assistantOpen)}
          >
            <Sparkles size={15} />
            <span>Riften Assistant</span>
            <PanelRightOpen size={14} />
          </button>
          <div className="operator">
            <span className="avatar">L</span>
            <div>
              <strong>Local reviewer</strong>
              <small>Single-operator workspace</small>
            </div>
            <span className="local-dot" title="Local workspace" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <select
              className="mobile-workspace"
              aria-label="Mobile workspace"
              value={wid}
              onChange={(e) =>
                e.target.value === "new"
                  ? setModal("workspace")
                  : setWid(e.target.value)
              }
            >
              <option value="" disabled>
                Select workspace
              </option>
              {ws.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
              <option value="new">+ New workspace</option>
            </select>
            {collapsed && (
              <button
                className="icon-btn"
                title="Expand navigation"
                onClick={() => setCollapsed(false)}
              >
                <PanelRightOpen size={16} />
              </button>
            )}
            <span>{current?.name || "Workspace"}</span>
            <ChevronRight size={12} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-actions">
            {accessQ.data?.public_demo && (
              <Button onClick={async () => {
                if (readOnly) setModal("owner");
                else { await post("/access/logout"); await qc.invalidateQueries({queryKey:["access"]}); }
              }}>{readOnly ? "Owner access" : "Lock editing"}</Button>
            )}
            <span className={"connection " + (connected ? "online" : "")}>
              <span className="dot" />
              {connected ? "Nugen aligned model" : "Local workspace"}
            </span>
            <button
              className="icon-btn"
              title="Refresh workspace data"
              onClick={() =>
                act(
                  async () => {
                    await refresh();
                  },
                  "Workspace refreshed",
                  false,
                )
              }
            >
              <RefreshCw size={15} />
            </button>
            <span className="divider" />
            <Button onClick={() => setAssistantOpen(!assistantOpen)}>
              <Sparkles size={14} />
              Assistant
            </Button>
          </div>
        </header>
        <main className={page === "Home" ? "home-main" : "content-main"}>
          {readOnly && <div className="demo-banner"><span>Public demo · Explore saved sources, assessments and replay results. Editing and live model requests require owner access.</span></div>}
          {error && (
            <div className="error-banner">
              <AlertCircle size={16} />
              Backend request failed: {(error as Error).message}
              <Button onClick={() => refresh()}>Retry</Button>
            </div>
          )}
          {workspaceQ.isLoading ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              Connecting to workspace…
            </div>
          ) : !wid ? (
            <div className="onboarding">
              <Mark />
              <h1>Your compliance workspace.</h1>
              <p>
                Create a workspace, bring your sources, and trace a change
                <br />
                through to the records and decisions it affects.
              </p>
              <Button primary onClick={() => setModal("workspace")}>
                <Plus size={15} />
                Create workspace
              </Button>
              <small>Stored locally. No invented records or activity.</small>
            </div>
          ) : pageLoading ? (
            <div className="loading">
              <LoaderCircle className="spin" size={17} />
              Loading workspace records?
            </div>
          ) : (
            <>
              {page === "Home" && (
                <>
                  <div className="home-center">
                    <div className="home-greeting">
                      <Mark />
                      <h1>What needs your attention?</h1>
                      <p>Start with a change. Follow its impact.</p>
                    </div>
                    <div className="composer-group">
                      <div className="composer">
                        <textarea
                          aria-label="Regulatory analysis command"
                          ref={composerRef}
                          value={composer}
                          onChange={(e) => setComposer(e.target.value)}
                          placeholder="Ask about a regulation, compare versions, or investigate a change…"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              command();
                            }
                          }}
                        />
                        <div className="composer-controls">
                          <button
                            className="icon-btn"
                            title="Import a source"
                            onClick={() => setModal("upload")}
                          >
                            <Plus size={17} />
                          </button>
                          <div className="model-selector">
                            <button
                              className="model-picker"
                              aria-expanded={modelMenu}
                              aria-label="Select aligned model"
                              onClick={() => setModelMenu(!modelMenu)}
                            >
                              <span
                                className={
                                  "dot " + (connected ? "green-dot" : "")
                                }
                              />
                              {labQ.isLoading
                                ? "Checking model?"
                                : connected
                                  ? "Nugen aligned"
                                  : labQ.isError
                                    ? "Model status unavailable"
                                    : "Connect Nugen"}
                              <ChevronDown size={12} />
                            </button>
                            {modelMenu && (
                              <div className="model-menu">
                                <div className="section-label">
                                  WORKSPACE MODEL
                                </div>
                                {lab?.deployments
                                  ?.filter((d: Item) => d.status === "DEPLOYED")
                                  .map((d: Item) => (
                                    <button
                                      key={d.id}
                                      onClick={() => setModelMenu(false)}
                                    >
                                      <Check size={13} />
                                      <span>
                                        {lab.jobs.find(
                                          (j: Item) => j.id === d.job_id,
                                        )?.request.base_model_id ||
                                          "Aligned model"}
                                        <small>{d.model_id}</small>
                                      </span>
                                    </button>
                                  ))}
                                {!connected && (
                                  <p>No deployed aligned model.</p>
                                )}
                                <button
                                  onClick={() => {
                                    setPage("Model Lab");
                                    setModelMenu(false);
                                  }}
                                >
                                  <FlaskConical size={13} />
                                  <span>Manage in Model Lab</span>
                                  <ArrowRight size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                          <select
                            aria-label="Interaction mode"
                            value={mode}
                            onChange={(e) => setMode(e.target.value)}
                          >
                            <option>Investigate</option>
                            <option>Compare versions</option>
                          </select>
                          <button
                            className="send"
                            title="Run command"
                            disabled={!composer.trim() || busy}
                            onClick={command}
                          >
                            {busy ? (
                              <LoaderCircle size={15} className="spin" />
                            ) : (
                              <ArrowUp size={15} />
                            )}
                          </button>
                        </div>
                      </div>
                      <div className="recent-projects">
                        <div className="section-label">
                          RECENT ASSESSMENTS
                          <span>{assessments.length} saved</span>
                        </div>
                        {assessments.length ? (
                          <div className="recent-grid">
                            {assessments.slice(0, 3).map((x) => (
                              <button
                                className="assessment-card"
                                key={x.id}
                                onClick={() => openAssessment(x.id)}
                              >
                                <span className="card-top">
                                  <BookOpen size={15} />
                                  <ArrowRight size={14} />
                                </span>
                                <strong>{x.title}</strong>
                                <Status value={x.status} />
                                <small>
                                  India <span>·</span> {time(x.created_at)}
                                </small>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="recent-empty">
                            <GitCompareArrows size={18} />
                            <span>
                              No assessments yet. Compare two versions to begin.
                            </span>
                            <button onClick={() => setModal("compare")}>
                              Compare versions <ArrowRight size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="suggestions">
                      <button
                        onClick={() => {
                          setComposer("Analyze the latest uploaded amendment.");
                          composerRef.current?.focus();
                        }}
                      >
                        Analyze the latest amendment <ArrowRight size={12} />
                      </button>
                      <button onClick={() => setPage("Impact replay")}>
                        Which records are affected? <ArrowRight size={12} />
                      </button>
                      <button onClick={() => setPage("Reviews & actions")}>
                        Unresolved changes <ArrowRight size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="home-lower">
                    <section>
                      <div className="section-title">
                        <h3>Regulatory library</h3>
                        <button onClick={() => setPage("Regulatory sources")}>
                          View all <ArrowRight size={13} />
                        </button>
                      </div>
                      {sources.length ? (
                        sources.slice(0, 3).map((s) => (
                          <button
                            className="source-row"
                            key={s.id}
                            onClick={() => {
                              setPage("Regulatory sources");
                              setVersionId(s.versions[0]?.id);
                            }}
                          >
                            <span className="file-icon">
                              <FileText size={17} />
                            </span>
                            <div>
                              <strong>{s.title}</strong>
                              <small>
                                {s.authority} · {s.versions.length} versions
                              </small>
                            </div>
                            <ChevronRight size={14} />
                          </button>
                        ))
                      ) : (
                        <div className="compact-empty">
                          <p>Build your source of truth.</p>
                          <Button onClick={() => setModal("upload")}>
                            <Upload size={14} />
                            Import documents
                          </Button>
                          <button
                            className="text-link"
                            disabled={busy}
                            onClick={() =>
                              act(
                                () =>
                                  post("/demo/regulation", {
                                    workspace_id: wid,
                                  }),
                                "Official RBI annex imported",
                              )
                            }
                          >
                            Or import the authentic RBI example{" "}
                            <ArrowRight size={12} />
                          </button>
                        </div>
                      )}
                    </section>
                    <section>
                      <div className="section-title">
                        <h3>Workspace activity</h3>
                        <Activity size={14} />
                      </div>
                      <div className="activity-list">
                        {(overviewQ.data?.activity || [])
                          .slice(0, 4)
                          .map((x: Item) => (
                            <div className="activity-item" key={x.id}>
                              <span className="activity-dot" />
                              <div>
                                <p>{x.action}</p>
                                <small>{time(x.created_at)}</small>
                              </div>
                            </div>
                          ))}
                      </div>
                    </section>
                  </div>
                  <div className="home-foot">
                    <ShieldCheck size={12} />
                    Source evidence stays attached to every assessment.
                    <span>Local review model</span>
                  </div>
                </>
              )}

              {page === "Overview" && (
                <>
                  {toolbar(
                    "Overview",
                    "A current view of your persisted regulatory work.",
                    <Button onClick={() => setModal("compare")}>
                      <Plus size={14} />
                      New assessment
                    </Button>,
                  )}
                  <div className="metrics-strip">
                    {Object.entries(overviewQ.data?.metrics || {}).map(
                      ([key, value]) => (
                        <button
                          key={key}
                          onClick={() =>
                            setPage(
                              key === "sources"
                                ? "Regulatory sources"
                                : key === "open_tasks"
                                  ? "Reviews & actions"
                                  : key === "records" ||
                                      key === "affected_records"
                                    ? "Impact replay"
                                    : "Change explorer",
                            )
                          }
                        >
                          <span>{label(key)}</span>
                          <strong>{String(value)}</strong>
                        </button>
                      ),
                    )}
                  </div>
                  <div className="overview-grid">
                    <section className="panel">
                      <div className="section-title">
                        <h3>Assessment queue</h3>
                        <span>{assessments.length} total</span>
                      </div>
                      {assessments.length ? (
                        <table>
                          <thead>
                            <tr>
                              <th>Assessment</th>
                              <th>Status</th>
                              <th>Created</th>
                            </tr>
                          </thead>
                          <tbody>
                            {assessments.map((x) => (
                              <tr
                                key={x.id}
                                onClick={() => openAssessment(x.id)}
                                tabIndex={0}
                                onKeyDown={(e) =>
                                  e.key === "Enter" && openAssessment(x.id)
                                }
                              >
                                <td>
                                  <BookOpen size={14} />
                                  {x.title}
                                </td>
                                <td>
                                  <Status value={x.status} />
                                </td>
                                <td>{time(x.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <Empty
                          title="No assessments to review"
                          action={
                            <Button onClick={() => setModal("compare")}>
                              Compare versions
                            </Button>
                          }
                        >
                          Start by comparing two stored regulatory versions.
                        </Empty>
                      )}
                    </section>
                    <section className="panel">
                      <div className="section-title">
                        <h3>Verified task dates</h3>
                        <Clock size={14} />
                      </div>
                      {overviewQ.data?.deadlines.length ? (
                        overviewQ.data.deadlines.map((t: Item) => (
                          <button
                            className="deadline-row"
                            key={t.id}
                            onClick={() => {
                              setPage("Reviews & actions");
                              setSelectedTask(t);
                            }}
                          >
                            <div>
                              <strong>{t.title}</strong>
                              <small>Reviewer-specified due date</small>
                            </div>
                            <Chip>{t.due_date}</Chip>
                          </button>
                        ))
                      ) : (
                        <Empty icon={Clock} title="No upcoming task dates">
                          Dates appear when a reviewer sets them. Unknown
                          regulatory dates are left blank.
                        </Empty>
                      )}
                    </section>
                    <section className="panel">
                      <div className="section-title">
                        <h3>Detected change types</h3>
                        <span>Clause comparisons</span>
                      </div>
                      {overviewQ.data?.change_types.length ? (
                        <div className="bar-chart">
                          {overviewQ.data.change_types.map((x: Item) => (
                            <div key={x.name}>
                              <span>{label(x.name)}</span>
                              <div>
                                <i
                                  style={{
                                    width:
                                      Math.max(
                                        3,
                                        (x.count /
                                          Math.max(
                                            ...overviewQ.data.change_types.map(
                                              (t: Item) => t.count,
                                            ),
                                          )) *
                                          100,
                                      ) + "%",
                                  }}
                                />
                              </div>
                              <b>{x.count}</b>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <Empty title="No change distribution">
                          This chart is calculated from stored changes.
                        </Empty>
                      )}
                    </section>
                    <section className="panel">
                      <div className="section-title">
                        <h3>Audit activity</h3>
                      </div>
                      {(overviewQ.data?.activity || [])
                        .slice(0, 7)
                        .map((x: Item) => (
                          <div className="activity-item" key={x.id}>
                            <span className="activity-dot" />
                            <div>
                              <p>{x.action}</p>
                              <small>
                                {time(x.created_at)} · {x.actor}
                              </small>
                            </div>
                          </div>
                        ))}
                    </section>
                  </div>
                </>
              )}

              {page === "Regulatory sources" && (
                <>
                  {toolbar(
                    "Regulatory sources",
                    "Original documents, extracted passages, and version history.",
                    <>
                      <Button onClick={() => setModal("url")}>
                        <Link2 size={14} />
                        Official URL
                      </Button>
                      <Button primary onClick={() => setModal("upload")}>
                        <Plus size={14} />
                        Import source
                      </Button>
                    </>,
                  )}
                  <div className="list-toolbar">
                    <div className="search-field">
                      <Search size={14} />
                      <input
                        aria-label="Search regulatory sources"
                        placeholder="Find a regulation or authority…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <span>
                      {sources.length} sources · {versions.length} versions
                    </span>
                    <Button onClick={() => setModal("compare")}>
                      <GitCompareArrows size={14} />
                      Compare versions
                    </Button>
                  </div>
                  <div
                    className={
                      "source-layout " + (versionId ? "with-inspector" : "")
                    }
                  >
                    <section className="panel source-list">
                      {sources.length ? (
                        filtered(sources, "title").map((s) => (
                          <div key={s.id} className="source-group">
                            <div className="source-group-title">
                              <span className="file-icon">
                                <BookOpen size={17} />
                              </span>
                              <div>
                                <strong>{s.title}</strong>
                                <small>
                                  {s.authority} · {s.jurisdiction}
                                </small>
                              </div>
                              {s.url && (
                                <button
                                  className="icon-btn"
                                  title="Check official URL now"
                                  disabled={busy}
                                  onClick={() =>
                                    act(
                                      () => post("/sources/" + s.id + "/check"),
                                      "Source check saved",
                                      false,
                                    )
                                  }
                                >
                                  <RefreshCw size={14} />
                                </button>
                              )}
                              <button
                                className="icon-btn"
                                title="Add version"
                                onClick={() => {
                                  setVersionId(s.versions[0]?.id);
                                  setModal("upload-version");
                                }}
                              >
                                <Plus size={15} />
                              </button>
                            </div>
                            {s.versions.map((v: Item) => (
                              <button
                                className={
                                  "version-row " +
                                  (versionId === v.id ? "selected" : "")
                                }
                                key={v.id}
                                onClick={() => setVersionId(v.id)}
                              >
                                <span className="tree-branch" />
                                <FileText size={14} />
                                <span>
                                  {v.label}
                                  <small>
                                    {time(v.created_at)} ·{" "}
                                    {v.text.split(/\s+/).filter(Boolean).length}{" "}
                                    extracted words
                                  </small>
                                </span>
                                <Status value={v.status} />
                                <ChevronRight size={13} />
                              </button>
                            ))}
                          </div>
                        ))
                      ) : (
                        <Empty
                          icon={BookOpen}
                          title="Start with an original source"
                          action={
                            <div className="empty-actions">
                              <Button
                                primary
                                onClick={() => setModal("upload")}
                              >
                                <Upload size={14} />
                                Upload document
                              </Button>
                              <Button
                                disabled={busy}
                                onClick={() =>
                                  act(
                                    () =>
                                      post("/demo/regulation", {
                                        workspace_id: wid,
                                      }),
                                    "Official RBI circular imported",
                                  )
                                }
                              >
                                Import RBI example
                              </Button>
                            </div>
                          }
                        >
                          Upload PDF, DOCX or TXT. Or fetch an authentic
                          historical RBI amendment with its published
                          before-and-after annex.
                        </Empty>
                      )}
                    </section>
                    {versionId && (
                      <aside className="inspector source-inspector">
                        <div className="inspector-head">
                          <h3>Source details</h3>
                          <button
                            className="icon-btn"
                            aria-label="Close source details"
                            onClick={() => setVersionId("")}
                          >
                            <X size={16} />
                          </button>
                        </div>
                        {versionQ.isLoading ? (
                          <div className="loading">
                            <LoaderCircle className="spin" />
                          </div>
                        ) : (
                          versionQ.data && (
                            <>
                              <div className="inspector-body">
                                <Status value={versionQ.data.status} />
                                <h2>{versionQ.data.label}</h2>
                                <p>{versionQ.data.provenance}</p>
                                {versionQ.data.error && (
                                  <div className="notice amber">
                                    <AlertCircle size={15} />
                                    {versionQ.data.error}
                                  </div>
                                )}
                                <dl>
                                  <dt>Authority</dt>
                                  <dd>
                                    {
                                      versions.find((v) => v.id === versionId)
                                        ?.document.authority
                                    }
                                  </dd>
                                  <dt>Legal status</dt>
                                  <dd>{label(versionQ.data.legal_status)}</dd>
                                  <dt>Established effective date</dt>
                                  <dd>
                                    {versionQ.data.effective_date ||
                                      "Not established"}
                                  </dd>
                                  <dt>SHA-256</dt>
                                  <dd className="mono hash">
                                    {versionQ.data.content_hash}
                                  </dd>
                                </dl>
                                <div className="inline-actions">
                                  <a
                                    className="btn"
                                    href={
                                      "/api/versions/" + versionId + "/original"
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <ArrowDownToLine size={13} />
                                    Original
                                  </a>
                                  {versionQ.data.document.url && (
                                    <a
                                      className="btn"
                                      href={versionQ.data.document.url}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <ExternalLink size={13} />
                                      Official source
                                    </a>
                                  )}
                                </div>
                                <Button
                                  disabled={busy || !connected}
                                  onClick={() =>
                                    act(
                                      () =>
                                        post(
                                          "/versions/" +
                                            versionId +
                                            "/embeddings",
                                        ),
                                      "Passage embeddings persisted",
                                      false,
                                    )
                                  }
                                >
                                  <Database size={13} />
                                  Index passages with Nugen
                                </Button>
                                <div className="section-label spaced">
                                  EXTRACTED PASSAGES
                                </div>
                                {versionQ.data.sections.map((s: Item) => (
                                  <details className="passage" key={s.id}>
                                    <summary>
                                      {s.reference}
                                      {s.page ? " · Page " + s.page : ""}
                                      <ChevronDown size={12} />
                                    </summary>
                                    <p>{s.text}</p>
                                  </details>
                                ))}
                                <div className="section-label spaced">
                                  ON-DEMAND FETCH HISTORY
                                </div>
                                {historyQ.data?.length ? (
                                  historyQ.data.map((h: Item) => (
                                    <div className="fetch-row" key={h.id}>
                                      <Status value={h.status} />
                                      <small>{time(h.created_at)}</small>
                                      {h.error && <p>{h.error}</p>}
                                    </div>
                                  ))
                                ) : (
                                  <p>No URL checks recorded.</p>
                                )}
                              </div>
                            </>
                          )
                        )}
                      </aside>
                    )}
                  </div>
                </>
              )}

              {page === "Change explorer" && (
                <>
                  {toolbar(
                    "Change explorer",
                    "Inspect the exact amendment, then review its interpretation.",
                    <>
                      <Button onClick={() => setModal("compare")}>
                        <Plus size={14} />
                        Compare
                      </Button>
                      {a && (
                        <a
                          className="btn"
                          href={"/api/assessments/" + a.id + "/export"}
                          download
                        >
                          <ArrowDownToLine size={14} />
                          Export
                        </a>
                      )}
                    </>,
                  )}
                  {!a ? (
                    <Empty
                      icon={GitCompareArrows}
                      title="Every impact starts with a change"
                      action={
                        <Button primary onClick={() => setModal("compare")}>
                          Compare document versions
                        </Button>
                      }
                    >
                      Choose two stored versions. Riften preserves both passages
                      and their source references.
                    </Empty>
                  ) : (
                    <>
                      <div className="assessment-toolbar">
                        {assessmentSelect}
                        <Status value={a.status} />
                        <span className="grow" />
                        <Button
                          primary
                          disabled={busy || a.status === "analyzing"}
                          onClick={() =>
                            act(
                              () => post("/assessments/" + a.id + "/analyze"),
                              "Nugen analysis started",
                              false,
                            )
                          }
                        >
                          {a.status === "analyzing" ? (
                            <LoaderCircle className="spin" size={14} />
                          ) : (
                            <Sparkles size={14} />
                          )}
                          Analyze with Nugen
                        </Button>
                      </div>
                      {a.error && (
                        <div className="error-banner">
                          <AlertCircle size={15} />
                          {a.error}
                        </div>
                      )}
                      <div className="pipeline">
                        {a.pipeline.map((p: Item, i: number) => (
                          <span
                            key={i}
                            className={
                              p.status === "complete" ? "complete" : ""
                            }
                          >
                            {p.status === "complete" ? (
                              <CheckCircle2 size={12} />
                            ) : p.status === "failed" ? (
                              <AlertCircle size={12} />
                            ) : (
                              <span className="dot" />
                            )}
                            {p.stage}
                            {i < a.pipeline.length - 1 && (
                              <ChevronRight size={12} />
                            )}
                          </span>
                        ))}
                      </div>
                      {!changes.length ? (
                        <Empty
                          icon={CheckCircle2}
                          title="No textual changes detected"
                        >
                          The stored passages match. No meaningful differences
                          were submitted for interpretation.
                        </Empty>
                      ) : (
                        <>
                          <div className="change-tabs">
                            {changes.map((c, i) => (
                              <button
                                key={c.id}
                                className={
                                  change?.id === c.id ? "selected" : ""
                                }
                                onClick={() => setChangeId(c.id)}
                              >
                                <span>{String(i + 1).padStart(2, "0")}</span>
                                {c.new_section?.reference ||
                                  c.old_section?.reference}
                                <Chip>{label(c.classification)}</Chip>
                              </button>
                            ))}
                          </div>
                          <div className="comparison-workspace">
                            <section className="clause-panel">
                              <div className="clause-heading">
                                <span className="version-dot old" />
                                <strong>Original provision</strong>
                                <small>{a.old_version.label}</small>
                              </div>
                              <div className="clause-content">
                                <div className="section-label">
                                  {change.old_section?.reference ||
                                    "NO PRIOR CLAUSE"}
                                </div>
                                <p>
                                  <DiffText
                                    oldText={change.old_section?.text || ""}
                                    newText={change.new_section?.text || ""}
                                    side="old"
                                  />
                                </p>
                                {!change.old_section && (
                                  <p className="muted">
                                    Newly introduced provision.
                                  </p>
                                )}
                              </div>
                              <div className="clause-footer">
                                <FileText size={12} />
                                <a
                                  href={
                                    "/api/versions/" +
                                    a.old_version_id +
                                    "/original"
                                  }
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open stored original{" "}
                                  <ExternalLink size={11} />
                                </a>
                              </div>
                            </section>
                            <section className="clause-panel">
                              <div className="clause-heading">
                                <span className="version-dot new" />
                                <strong>Updated provision</strong>
                                <small>{a.new_version.label}</small>
                              </div>
                              <div className="clause-content">
                                <div className="section-label">
                                  {change.new_section?.reference ||
                                    "CLAUSE REMOVED"}
                                </div>
                                <p>
                                  <DiffText
                                    oldText={change.old_section?.text || ""}
                                    newText={change.new_section?.text || ""}
                                    side="new"
                                  />
                                </p>
                                {!change.new_section && (
                                  <p className="muted">
                                    This provision is absent in the selected
                                    updated version.
                                  </p>
                                )}
                              </div>
                              <div className="clause-footer">
                                <FileText size={12} />
                                <a
                                  href={
                                    "/api/versions/" +
                                    a.new_version_id +
                                    "/original"
                                  }
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open stored update <ExternalLink size={11} />
                                </a>
                              </div>
                            </section>
                            <aside className="interpretation">
                              <div className="inspector-head">
                                <h3>
                                  <Sparkles size={14} />
                                  Interpretation
                                </h3>
                                <Status value={change.analysis_status} />
                              </div>
                              <div className="inspector-body">
                                <Chip tone="violet">
                                  {label(change.classification)}
                                </Chip>
                                {change.textual_finding && (
                                  <>
                                    <h3>Verified textual finding</h3>
                                    <p>{change.textual_finding}</p>
                                  </>
                                )}
                                <h3>Nugen draft interpretation</h3>
                                {change.analysis_status === "needs_review" && (
                                  <div className="notice amber">
                                    <AlertCircle size={14} />
                                    Independent checks flagged this
                                    interpretation. Review the source before
                                    relying on it.
                                  </div>
                                )}
                                <p>
                                  {change.explanation ||
                                    "Textual difference detected. Run Nugen analysis for a source-grounded interpretation. This classification is a lexical suggestion."}
                                </p>
                                <dl>
                                  <dt>Clause matching</dt>
                                  <dd>{change.match_method}</dd>
                                  <dt>Business area</dt>
                                  <dd>
                                    {change.business_area || "Not interpreted"}
                                  </dd>
                                  <dt>Updated version effective date</dt>
                                  <dd>
                                    {a.new_version.effective_date ||
                                      "Not established"}
                                  </dd>
                                </dl>
                                <div className="section-label spaced">
                                  SOURCE EVIDENCE
                                </div>
                                {change.evidence.map((e: Item) => (
                                  <details className="evidence" key={e.id}>
                                    <summary>
                                      <FileText size={12} />
                                      {e.origin === "source"
                                        ? "Stored source passage"
                                        : "Verified model quote"}
                                      <ChevronDown size={12} />
                                    </summary>
                                    <blockquote>{e.quote}</blockquote>
                                    <button
                                      className="text-link"
                                      onClick={() => {
                                        setVersionId(e.version_id);
                                        setPage("Regulatory sources");
                                      }}
                                    >
                                      Inspect source <ArrowRight size={12} />
                                    </button>
                                  </details>
                                ))}
                                {change.unresolved.length > 0 && (
                                  <div className="notice amber">
                                    <AlertCircle size={14} />
                                    <div>
                                      <strong>Requires attention</strong>
                                      {change.unresolved.map(
                                        (x: string, i: number) => (
                                          <p key={i}>{x}</p>
                                        ),
                                      )}
                                    </div>
                                  </div>
                                )}
                                <div className="section-label spaced">
                                  REVIEW DECISION
                                </div>
                                <Status value={change.status} />
                                <div className="review-actions">
                                  <Button onClick={() => setModal("review")}>
                                    Record decision
                                  </Button>
                                  <Button onClick={() => setModal("task")}>
                                    <Plus size={13} />
                                    Action
                                  </Button>
                                </div>
                                <button
                                  className="text-link"
                                  onClick={() => setPage("Impact replay")}
                                >
                                  Inspect operational impact{" "}
                                  <ArrowRight size={12} />
                                </button>
                                <p className="fine-print">
                                  Model interpretation is advisory. Source
                                  matching verifies quotations, not legal
                                  correctness.
                                </p>
                              </div>
                            </aside>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {page === "Impact graph" && (
                <>
                  {toolbar(
                    "Impact graph",
                    "Follow verified dependencies from a regulation to an operational consequence.",
                    <>
                      <Button onClick={() => setModal("entity")}>
                        <Plus size={14} />
                        Add entity
                      </Button>
                      <Button primary onClick={() => setModal("link")}>
                        <Link2 size={14} />
                        Map dependency
                      </Button>
                    </>,
                  )}
                  <div className="list-toolbar">
                    <div className="search-field">
                      <Search size={14} />
                      <input
                        aria-label="Search graph"
                        placeholder="Find a node…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <span>
                      {graphQ.data?.nodes.length || 0} nodes ·{" "}
                      {graphQ.data?.edges.length || 0} relationships
                    </span>
                    <select
                      aria-label="Filter graph by kind"
                      id="graph-filter"
                      onChange={(e) => setGraphFilter(e.target.value)}
                      value={graphFilter}
                    >
                      <option value="all">All entities</option>
                      <option value="record">Operational records</option>
                    </select>
                  </div>
                  <div className="graph-layout">
                    <div className="graph-canvas">
                      {graphQ.data?.nodes.length ? (
                        <ReactFlow
                          key={wid + search + graphFilter}
                          nodes={graphQ.data.nodes
                            .filter(
                              (n: Item) =>
                                (graphFilter === "all" ||
                                  n.kind === graphFilter) &&
                                (!search ||
                                  n.label
                                    .toLowerCase()
                                    .includes(search.toLowerCase())),
                            )
                            .map((n: Item, i: number) => {
                              const level = [
                                "regulation",
                                "requirement",
                                "policy",
                                "process",
                                "control",
                                "record",
                                "action",
                              ].indexOf(n.kind);
                              const siblings = graphQ.data.nodes.filter(
                                (x: Item) => x.kind === n.kind,
                              );
                              return {
                                id: n.id,
                                type: "riften",
                                width: 210,
                                height: 92,
                                position: {
                                  x: level * 260,
                                  y:
                                    siblings.findIndex(
                                      (s: Item) => s.id === n.id,
                                    ) * 125,
                                },
                                data: {
                                  label: n.label,
                                  kind: n.kind,
                                  impacted: activePath.has(n.id),
                                },
                                style: {
                                  opacity:
                                    selectedNode?.id && !activePath.has(n.id)
                                      ? 0.35
                                      : 1,
                                },
                                selected: n.id === selectedNode?.id,
                              };
                            })}
                          edges={graphQ.data.edges.map((e: Item) => ({
                            id: e.id,
                            source: e.source_id,
                            target: e.target_id,
                            style: {
                              stroke:
                                selectedNode?.id &&
                                activePath.has(e.source_id) &&
                                activePath.has(e.target_id)
                                  ? "#a48ab8"
                                  : selectedNode?.id
                                    ? "#eee9f2"
                                    : e.verified
                                      ? "#b8accf"
                                      : "#d8d8d8",
                              strokeWidth: 1.2,
                              strokeDasharray: e.verified ? undefined : "4 3",
                            },
                            type: "smoothstep",
                          }))}
                          nodeTypes={nodeTypes}
                          nodesDraggable={false}
                          fitView={!!search || graphFilter !== "all"}
                          defaultViewport={{ x: 20, y: 80, zoom: 0.68 }}
                          minZoom={0.2}
                          maxZoom={1.5}
                          onNodeClick={(_, n) =>
                            setSelectedNode(
                              graphQ.data.nodes.find(
                                (x: Item) => x.id === n.id,
                              ),
                            )
                          }
                          onConnect={(c) => {
                            setSelectedNode({ id: c.source, target: c.target });
                            setModal("link");
                          }}
                        >
                          <Background gap={24} size={1} color="#e6e5e9" />
                          <Controls showInteractive={false} />
                          <MiniMap pannable zoomable nodeColor="#e9e3f3" />
                        </ReactFlow>
                      ) : (
                        <Empty
                          icon={Network}
                          title="A graph built from your relationships"
                        >
                          Import a regulation or create an internal policy,
                          process, control, or record. Map dependencies with a
                          reason.
                        </Empty>
                      )}
                      <div className="graph-legend">
                        <span className="dot violet-dot" />
                        Verified dependency
                        <span className="legend-line" />
                        Proposed or unverified
                      </div>
                    </div>
                    <aside className="inspector">
                      <div className="inspector-head">
                        <h3>Dependency details</h3>
                        <Network size={14} />
                      </div>
                      {selectedNode &&
                      graphQ.data.nodes.some(
                        (n: Item) => n.id === selectedNode.id,
                      ) ? (
                        <div className="inspector-body">
                          <Chip tone="violet">{selectedNode.kind}</Chip>
                          <h2>{selectedNode.label}</h2>
                          {selectedNode.entity_id && (
                            <>
                              <p>
                                {entities.find(
                                  (e) => e.id === selectedNode.entity_id,
                                )?.description ||
                                  "Created or imported organizational entity."}
                              </p>
                              <pre>
                                {JSON.stringify(
                                  entities.find(
                                    (e) => e.id === selectedNode.entity_id,
                                  )?.attributes,
                                  null,
                                  2,
                                )}
                              </pre>
                              {entities.find(
                                (e) => e.id === selectedNode.entity_id,
                              )?.synthetic && (
                                <Chip tone="amber">Synthetic test record</Chip>
                              )}
                            </>
                          )}
                          {selectedNode.change_id && (
                            <Button
                              onClick={() => {
                                if (nodeDetailsQ.data?.change?.assessment_id)
                                  setAssessmentId(
                                    nodeDetailsQ.data.change.assessment_id,
                                  );
                                setChangeId(selectedNode.change_id);
                                setPage("Change explorer");
                              }}
                            >
                              Inspect changed clause <ArrowRight size={12} />
                            </Button>
                          )}
                          {nodeDetailsQ.data?.evidence?.map((e: Item) => (
                            <details className="evidence" key={e.id}>
                              <summary>
                                Source evidence <ChevronDown size={12} />
                              </summary>
                              <blockquote>{e.quote}</blockquote>
                            </details>
                          ))}
                          {nodeDetailsQ.data?.document?.url && (
                            <a
                              className="btn"
                              href={nodeDetailsQ.data.document.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink size={12} />
                              Official source
                            </a>
                          )}
                          {nodeDetailsQ.data?.task && (
                            <Button
                              onClick={() => {
                                setSelectedTask(nodeDetailsQ.data.task);
                                setPage("Reviews & actions");
                              }}
                            >
                              Inspect remediation action{" "}
                              <ArrowRight size={12} />
                            </Button>
                          )}
                          <div className="section-label spaced">
                            CONNECTED RELATIONSHIPS
                          </div>
                          {graphQ.data.edges
                            .filter(
                              (e: Item) =>
                                e.source_id === selectedNode.id ||
                                e.target_id === selectedNode.id,
                            )
                            .map((e: Item) => (
                              <div className="relationship" key={e.id}>
                                <strong>
                                  {
                                    graphQ.data.nodes.find(
                                      (n: Item) =>
                                        n.id ===
                                        (e.source_id === selectedNode.id
                                          ? e.target_id
                                          : e.source_id),
                                    )?.label
                                  }
                                </strong>
                                <p>{e.rationale}</p>
                                <Status
                                  value={e.verified ? "accepted" : "unreviewed"}
                                />
                                <button
                                  className="text-link danger"
                                  onClick={() =>
                                    act(
                                      () =>
                                        api("/graph/edges/" + e.id, {
                                          method: "DELETE",
                                        }),
                                      "Relationship removed",
                                      false,
                                    )
                                  }
                                >
                                  Remove mapping
                                </button>
                              </div>
                            ))}
                          <Button onClick={() => setModal("link")}>
                            <Link2 size={13} />
                            Map dependency
                          </Button>
                        </div>
                      ) : (
                        <Empty icon={Network} title="Select a connected object">
                          Inspect the entity, relationship rationale, and source
                          trail. Pan and zoom to explore.
                        </Empty>
                      )}
                    </aside>
                  </div>
                </>
              )}

              {page === "Impact replay" && (
                <>
                  {toolbar(
                    "Impact replay",
                    "Apply a verified change to imported records. Inspect every outcome.",
                    <>
                      <Button onClick={() => setModal("import-records")}>
                        <Upload size={14} />
                        Import records
                      </Button>
                      <Button onClick={() => setModal("entity")}>
                        <Plus size={14} />
                        Add entity
                      </Button>
                    </>,
                  )}
                  <div className="tab-bar">
                    <button
                      className={!recordView ? "active" : ""}
                      onClick={() => setRecordView(false)}
                    >
                      Replay workspace
                    </button>
                    <button
                      className={recordView ? "active" : ""}
                      onClick={() => setRecordView(true)}
                    >
                      Organizational records{" "}
                      <Chip>
                        {entities.filter((x) => x.kind === "record").length}
                      </Chip>
                    </button>
                  </div>
                  {recordView ? (
                    <>
                      <div className="list-toolbar">
                        <div className="search-field">
                          <Search size={14} />
                          <input
                            aria-label="Search records"
                            placeholder="Find an operational record…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </div>
                        <a
                          className="text-link"
                          href="/sample-records.csv"
                          download
                        >
                          Download synthetic CSV template{" "}
                          <ArrowDownToLine size={12} />
                        </a>
                      </div>
                      <div className="panel">
                        {entities.length ? (
                          <table>
                            <thead>
                              <tr>
                                <th>Name / ID</th>
                                <th>Type</th>
                                <th>Provenance</th>
                                <th>Attributes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filtered(entities).map((e) => (
                                <tr key={e.id}>
                                  <td>
                                    <strong>{e.name}</strong>
                                    <small>
                                      {e.external_id || e.id.slice(0, 8)}
                                    </small>
                                  </td>
                                  <td>
                                    <Chip>{e.kind}</Chip>
                                  </td>
                                  <td>
                                    {e.synthetic ? (
                                      <Chip tone="amber">
                                        Synthetic test data
                                      </Chip>
                                    ) : (
                                      "User-created / imported"
                                    )}
                                  </td>
                                  <td>
                                    <details>
                                      <summary>Inspect fields</summary>
                                      <pre>
                                        {JSON.stringify(e.attributes, null, 2)}
                                      </pre>
                                      <p>{e.description}</p>
                                    </details>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <Empty
                            icon={Database}
                            title="Bring your operational records"
                            action={
                              <Button
                                onClick={() => setModal("import-records")}
                              >
                                Import CSV or JSON
                              </Button>
                            }
                          >
                            No records are created automatically. Synthetic
                            examples are provided as a separate downloadable
                            file.
                          </Empty>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      {a ? (
                        <>
                          <div className="assessment-toolbar">
                            {assessmentSelect}
                            <select
                              aria-label="Changed requirement"
                              value={change?.id || ""}
                              onChange={(e) => setChangeId(e.target.value)}
                            >
                              {changes.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.new_section?.reference ||
                                    c.old_section?.reference}{" "}
                                  · {label(c.classification)}
                                </option>
                              ))}
                            </select>
                            <span className="grow" />
                            <Button onClick={() => setModal("rule")}>
                              <ShieldCheck size={14} />
                              {change?.requirement?.verified
                                ? "Review approved rule"
                                : "Verify rule"}
                            </Button>
                            <Button
                              primary
                              disabled={busy || !change?.requirement?.verified}
                              onClick={async () => {
                                const r = await act(
                                  () =>
                                    post("/changes/" + change.id + "/replay"),
                                  "Record evaluation saved",
                                  false,
                                );
                                if (r) setReplaySelected(r.id);
                              }}
                            >
                              <Play size={14} />
                              Run replay
                            </Button>
                          </div>
                          <div className="rule-comparison">
                            <div>
                              <span className="section-label">
                                PREVIOUS CONDITION
                              </span>
                              <strong>
                                {change?.requirement?.rule
                                  ? `${label(change.requirement.rule.field)} ${{ lte: "?", lt: "<", gte: "?", gt: ">" }[change.requirement.rule.operator as "lte" | "lt" | "gte" | "gt"]} ${Number(change.requirement.rule.old_value).toLocaleString("en-IN")}`
                                  : "No verified executable condition"}
                              </strong>
                              <p>
                                {change?.old_section?.reference} ·{" "}
                                {a.old_version.label}
                              </p>
                            </div>
                            <ArrowRight size={18} />
                            <div>
                              <span className="section-label">
                                UPDATED CONDITION
                              </span>
                              <strong>
                                {change?.requirement?.rule
                                  ? `${label(change.requirement.rule.field)} ${{ lte: "?", lt: "<", gte: "?", gt: ">" }[change.requirement.rule.operator as "lte" | "lt" | "gte" | "gt"]} ${Number(change.requirement.rule.new_value).toLocaleString("en-IN")}`
                                  : "Formalization requires human review"}
                              </strong>
                              <p>
                                {change?.new_section?.reference} ·{" "}
                                {a.new_version.label}
                              </p>
                            </div>
                            <Status
                              value={
                                change?.requirement?.verified
                                  ? "accepted"
                                  : "unreviewed"
                              }
                            />
                          </div>
                          <div className="notice">
                            <ShieldCheck size={15} />
                            <span>
                              Only verified dependency paths are evaluated.
                              Unconnected records and missing evidence stay
                              explicit. Applicability and contract dates must be
                              confirmed before importing a positive
                              applicability flag.
                            </span>
                          </div>
                        </>
                      ) : (
                        <Empty
                          icon={Play}
                          title="Compare a policy before replaying it"
                          action={
                            <Button onClick={() => setModal("compare")}>
                              Compare versions
                            </Button>
                          }
                        >
                          Replay requires a stored amendment, an approved
                          condition, and operational records.
                        </Empty>
                      )}
                      {replays.length ? (
                        <>
                          <div className="section-title spaced">
                            <h3>Evaluation results</h3>
                            <select
                              aria-label="Replay history"
                              value={replay?.id}
                              onChange={(e) =>
                                setReplaySelected(e.target.value)
                              }
                            >
                              {replays.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {time(r.created_at)} · {r.results.length}{" "}
                                  records
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="replay-counts">
                            {[
                              "requires_review",
                              "evidence_gap",
                              "unconnected",
                              "no_action",
                            ].map((s) => (
                              <span key={s}>
                                <strong>
                                  {
                                    replay.results.filter(
                                      (r: Item) => r.outcome === s,
                                    ).length
                                  }
                                </strong>
                                {label(s)}
                              </span>
                            ))}
                          </div>
                          <div className="panel">
                            <table>
                              <thead>
                                <tr>
                                  <th>Operational record</th>
                                  <th>Previous</th>
                                  <th>Updated</th>
                                  <th>Outcome / explanation</th>
                                  <th>Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {replay.results.map((r: Item) => (
                                  <tr key={r.id}>
                                    <td>
                                      <strong>{r.record.name}</strong>
                                      <small>
                                        {r.record.external_id}
                                        {r.record.synthetic
                                          ? " · Synthetic"
                                          : ""}
                                      </small>
                                      <details>
                                        <summary>Input snapshot</summary>
                                        <pre>
                                          {JSON.stringify(
                                            r.record_snapshot,
                                            null,
                                            2,
                                          )}
                                        </pre>
                                      </details>
                                    </td>
                                    <td>
                                      <Status value={r.old_result} />
                                    </td>
                                    <td>
                                      <Status value={r.new_result} />
                                    </td>
                                    <td>
                                      <Chip
                                        tone={
                                          r.outcome === "requires_review"
                                            ? "amber"
                                            : "neutral"
                                        }
                                      >
                                        {label(r.outcome)}
                                      </Chip>
                                      <p className="table-description">
                                        {r.explanation}
                                      </p>
                                    </td>
                                    <td>
                                      <Button
                                        onClick={() => {
                                          setSelectedNode({
                                            entity_id: r.entity_id,
                                            change_id: changes.find(
                                              (c) =>
                                                c.requirement?.id ===
                                                replay.requirement_id,
                                            )?.id,
                                          });
                                          setModal("task");
                                        }}
                                      >
                                        <Plus size={12} />
                                        Review
                                      </Button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : (
                        a && (
                          <Empty
                            icon={Play}
                            title="Ready for a reproducible replay"
                            action={
                              <Button onClick={() => setModal("rule")}>
                                Inspect the condition
                              </Button>
                            }
                          >
                            Verify the rule, import records, and map their
                            dependency paths. Each run preserves a snapshot of
                            its rule and record inputs.
                          </Empty>
                        )
                      )}
                    </>
                  )}
                </>
              )}

              {page === "Reviews & actions" && (
                <>
                  {toolbar(
                    "Reviews & actions",
                    "Decisions, evidence, and remediation owned by a local reviewer.",
                    <Button
                      primary
                      onClick={() => {
                        setSelectedNode(null);
                        setModal("task");
                      }}
                    >
                      <Plus size={14} />
                      Create action
                    </Button>,
                  )}
                  <div className="list-toolbar">
                    <div className="search-field">
                      <Search size={14} />
                      <input
                        aria-label="Search actions"
                        placeholder="Find an action…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <span>
                      {tasks.filter((t) => t.status !== "done").length}{" "}
                      outstanding ·{" "}
                      {tasks.filter((t) => t.status === "done").length}{" "}
                      completed
                    </span>
                  </div>
                  <div className="task-layout">
                    <section className="panel">
                      {tasks.length ? (
                        <table>
                          <thead>
                            <tr>
                              <th>Action</th>
                              <th>Status</th>
                              <th>Priority</th>
                              <th>Owner</th>
                              <th>Due</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filtered(tasks, "title").map((t) => (
                              <tr
                                key={t.id}
                                className={
                                  selectedTask?.id === t.id ? "selected" : ""
                                }
                                tabIndex={0}
                                onKeyDown={(e) =>
                                  e.key === "Enter" && setSelectedTask(t)
                                }
                                onClick={() => setSelectedTask(t)}
                              >
                                <td>
                                  <CheckCheck size={14} />
                                  <strong>{t.title}</strong>
                                </td>
                                <td>
                                  <Status value={t.status} />
                                </td>
                                <td>
                                  <Chip
                                    tone={
                                      t.priority === "high"
                                        ? "amber"
                                        : "neutral"
                                    }
                                  >
                                    {t.priority}
                                  </Chip>
                                </td>
                                <td>{t.assignee}</td>
                                <td>{t.due_date || "Not set"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <Empty
                          icon={CheckCheck}
                          title="No remediation actions yet"
                          action={
                            <Button onClick={() => setModal("task")}>
                              Create an action
                            </Button>
                          }
                        >
                          Turn an identified impact into a review task, or
                          create a task directly.
                        </Empty>
                      )}
                    </section>
                    {selectedTask && (
                      <aside className="inspector">
                        <div className="inspector-head">
                          <h3>Action details</h3>
                          <button
                            className="icon-btn"
                            aria-label="Close action details"
                            onClick={() => setSelectedTask(null)}
                          >
                            <X size={16} />
                          </button>
                        </div>
                        <div className="inspector-body">
                          <Status
                            value={
                              tasks.find((t) => t.id === selectedTask.id)
                                ?.status || selectedTask.status
                            }
                          />
                          <h2>{selectedTask.title}</h2>
                          <dl>
                            <dt>Assigned label</dt>
                            <dd>{selectedTask.assignee}</dd>
                            <dt>Priority</dt>
                            <dd>{selectedTask.priority}</dd>
                            <dt>Reviewer-set due date</dt>
                            <dd>{selectedTask.due_date || "Not set"}</dd>
                            <dt>Linked change</dt>
                            <dd>
                              {selectedTask.change_id || "No linked change"}
                            </dd>
                            <dt>Linked record</dt>
                            <dd>
                              {entities.find(
                                (e) => e.id === selectedTask.entity_id,
                              )?.name || "No linked record"}
                            </dd>
                          </dl>
                          <h3>Supporting evidence</h3>
                          <p>
                            {selectedTask.evidence ||
                              "No task-specific evidence attached yet."}
                          </p>
                          <Button onClick={() => setModal("task-update")}>
                            Update status & add comment
                          </Button>
                          <div className="section-label spaced">
                            APPROVAL & ACTIVITY HISTORY
                          </div>
                          {(
                            tasks.find((t) => t.id === selectedTask.id)
                              ?.history || []
                          ).map((h: Item) => (
                            <div className="activity-item" key={h.id}>
                              <span className="activity-dot" />
                              <div>
                                <p>{h.action}</p>
                                {h.detail.comment && (
                                  <blockquote>{h.detail.comment}</blockquote>
                                )}
                                <small>
                                  {time(h.created_at)} · {h.actor}
                                </small>
                              </div>
                            </div>
                          ))}
                        </div>
                      </aside>
                    )}
                  </div>
                </>
              )}

              {page === "Model Lab" && (
                <>
                  {toolbar(
                    "Model Lab",
                    "Inspect the actual Nugen lifecycle, requests, and results.",
                    <>
                      <Status
                        value={
                          connected
                            ? "DEPLOYED"
                            : lab?.configured
                              ? "configured"
                              : "not connected"
                        }
                      />
                      <Button
                        onClick={() =>
                          act(
                            async () => {
                              const r = await api("/model-lab/base-models");
                              setBaseModels(r.models);
                              return r;
                            },
                            "Supported models fetched",
                            false,
                          )
                        }
                      >
                        <RefreshCw size={14} />
                        Discover models
                      </Button>
                    </>,
                  )}
                  <div className="notice">
                    <FlaskConical size={15} />
                    <span>
                      One alignment per workspace. Paid creation calls are never
                      retried automatically. Training and evaluation results
                      below are raw Nugen responses.
                    </span>
                  </div>
                  <div className="tab-bar">
                    {[
                      "Alignment",
                      "Inference",
                      "Evaluation",
                      "Request history",
                    ].map((t) => (
                      <button
                        key={t}
                        className={labTab === t ? "active" : ""}
                        onClick={() => setLabTab(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  {labTab === "Alignment" && (
                    <>
                      <div className="lab-grid">
                        <section className="panel">
                          <div className="section-title">
                            <h3>Alignment documents</h3>
                            <Button
                              onClick={() => setModal("alignment-upload")}
                            >
                              <Upload size={13} />
                              Prepare upload
                            </Button>
                          </div>
                          {lab?.jobs.filter((j: Item) => j.kind === "document")
                            .length ? (
                            lab.jobs
                              .filter((j: Item) => j.kind === "document")
                              .map((j: Item) => (
                                <div className="lab-job" key={j.id}>
                                  <FileText size={16} />
                                  <div>
                                    <strong>
                                      {j.request.origin ||
                                        versions.find(
                                          (v) => v.id === j.request.version_id,
                                        )?.label ||
                                        "Alignment corpus"}
                                    </strong>
                                    <code>
                                      {j.remote_id || "Submission pending"}
                                    </code>
                                    <Status value={j.status} />
                                    {j.error && (
                                      <p className="error-text">{j.error}</p>
                                    )}
                                  </div>
                                  <button
                                    className="icon-btn"
                                    title="Refresh document processing status"
                                    onClick={() =>
                                      act(
                                        () =>
                                          post(
                                            "/model-lab/jobs/" +
                                              j.id +
                                              "/refresh",
                                          ),
                                        "Document status refreshed",
                                        false,
                                      )
                                    }
                                  >
                                    <RefreshCw size={14} />
                                  </button>
                                </div>
                              ))
                          ) : (
                            <Empty
                              icon={Upload}
                              title="No alignment corpus connected"
                            >
                              Upload extracted text of at least 500 words, or
                              connect the live setup run from this checkout.
                            </Empty>
                          )}
                        </section>
                        <section className="panel">
                          <div className="section-title">
                            <h3>Alignment project</h3>
                            <Button
                              onClick={() => setModal("alignment")}
                              disabled={lab?.jobs.some(
                                (j: Item) => j.kind === "alignment",
                              )}
                            >
                              <Plus size={13} />
                              Align model
                            </Button>
                          </div>
                          {lab?.jobs
                            .filter((j: Item) => j.kind === "alignment")
                            .map((j: Item) => (
                              <div className="model-project" key={j.id}>
                                <span className="model-art">
                                  <FlaskConical size={25} />
                                </span>
                                <h2>Riften domain alignment</h2>
                                <Status value={j.status} />
                                <dl>
                                  <dt>Base model</dt>
                                  <dd>{j.request.base_model_id}</dd>
                                  <dt>Alignment ID</dt>
                                  <dd className="mono">{j.remote_id}</dd>
                                  <dt>Aligned model ID</dt>
                                  <dd className="mono">
                                    {j.model_id || "Not returned yet"}
                                  </dd>
                                </dl>
                                {j.error && (
                                  <p className="error-text">{j.error}</p>
                                )}
                                <div className="inline-actions">
                                  <Button
                                    onClick={() =>
                                      act(
                                        () =>
                                          post(
                                            "/model-lab/jobs/" +
                                              j.id +
                                              "/refresh",
                                          ),
                                        "Alignment refreshed",
                                        false,
                                      )
                                    }
                                  >
                                    <RefreshCw size={13} />
                                    Refresh status
                                  </Button>
                                  <Button
                                    primary
                                    disabled={
                                      j.status !== "READY" ||
                                      lab.deployments.some(
                                        (d: Item) => d.job_id === j.id,
                                      ) ||
                                      busy
                                    }
                                    onClick={() =>
                                      act(
                                        () =>
                                          post(
                                            "/model-lab/jobs/" +
                                              j.id +
                                              "/deploy",
                                          ),
                                        "Deployment requested",
                                        false,
                                      )
                                    }
                                  >
                                    <Play size={13} />
                                    Deploy
                                  </Button>
                                </div>
                                <details>
                                  <summary>
                                    Inspect raw alignment response
                                  </summary>
                                  <pre>
                                    {JSON.stringify(j.response, null, 2)}
                                  </pre>
                                </details>
                              </div>
                            ))}
                          {!lab?.jobs.some(
                            (j: Item) => j.kind === "alignment",
                          ) && (
                            <Empty
                              icon={FlaskConical}
                              title="A specialized model for this workspace"
                              action={
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    act(
                                      () =>
                                        post("/model-lab/adopt-local-run", {
                                          workspace_id: wid,
                                        }),
                                      "Live setup run connected",
                                    )
                                  }
                                >
                                  Connect existing local live run
                                </Button>
                              }
                            >
                              A live setup run can be adopted once. Otherwise
                              prepare documents and create a single alignment.
                            </Empty>
                          )}
                        </section>
                        <section className="panel">
                          <div className="section-title">
                            <h3>Deployment</h3>
                            <span>Aligned models only</span>
                          </div>
                          {lab?.deployments.length ? (
                            lab.deployments.map((d: Item) => (
                              <div className="deployment" key={d.id}>
                                <span className="model-art">
                                  <Network size={22} />
                                </span>
                                <Status value={d.status} />
                                <code>{d.model_id}</code>
                                {d.response.error && (
                                  <p className="error-text">
                                    {d.response.error}
                                  </p>
                                )}
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    act(
                                      () =>
                                        post(
                                          "/model-lab/deployments/" +
                                            d.id +
                                            "/refresh",
                                        ),
                                      "Deployment status refreshed",
                                      false,
                                    )
                                  }
                                >
                                  <RefreshCw size={13} />
                                  Refresh deployment
                                </Button>
                                <p className="fine-print">
                                  Only DEPLOYED can serve inference. No
                                  base-model fallback.
                                </p>
                                <details>
                                  <summary>Deployment response</summary>
                                  <pre>
                                    {JSON.stringify(d.response, null, 2)}
                                  </pre>
                                </details>
                              </div>
                            ))
                          ) : (
                            <Empty icon={Network} title="No model deployment">
                              Deployment becomes available after alignment is
                              READY.
                            </Empty>
                          )}
                        </section>
                      </div>
                      {baseModels.length > 0 && (
                        <section className="panel spaced">
                          <div className="section-title">
                            <h3>Supported base models</h3>
                            <span>Live discovery</span>
                          </div>
                          <table>
                            <thead>
                              <tr>
                                <th>Model</th>
                                <th>Parameters</th>
                                <th>Alignment</th>
                                <th>Inference</th>
                              </tr>
                            </thead>
                            <tbody>
                              {baseModels.map((m) => (
                                <tr key={m.model_id}>
                                  <td>{m.model_id}</td>
                                  <td>{m.parameters}</td>
                                  <td>
                                    {m.alignment_ready
                                      ? "Available"
                                      : "Unavailable"}
                                  </td>
                                  <td>
                                    {m.inference_ready
                                      ? "Available"
                                      : "Not deployed"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </section>
                      )}
                    </>
                  )}
                  {labTab === "Inference" && (
                    <div className="lab-console-grid">
                      <section className="panel">
                        <div className="section-title">
                          <h3>Aligned inference console</h3>
                          <Chip tone="violet">Nugen API</Chip>
                        </div>
                        <form
                          className="console-form"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            const r = await act(
                              () =>
                                post("/model-lab/inference", {
                                  workspace_id: wid,
                                  prompt: f.get("prompt"),
                                }),
                              undefined,
                              false,
                            );
                            if (r) setLabResult(r);
                          }}
                        >
                          <Field label="Prompt">
                            <textarea
                              name="prompt"
                              required
                              minLength={3}
                              rows={7}
                              defaultValue="What changed in RBI section 7(a)(iii) for individual domestic term deposits, and what must a reviewer verify before applying it?"
                            />
                          </Field>
                          <Button
                            primary
                            type="submit"
                            disabled={!connected || busy}
                          >
                            {busy ? (
                              <LoaderCircle size={14} className="spin" />
                            ) : (
                              <Play size={14} />
                            )}
                            Run aligned inference
                          </Button>
                        </form>
                        <div className="section-title">
                          <h3>Embeddings & reranking</h3>
                        </div>
                        <form
                          className="console-form"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            const r = await act(
                              () =>
                                post("/model-lab/retrieval", {
                                  workspace_id: wid,
                                  text: f.get("text"),
                                  mode: f.get("mode"),
                                }),
                              undefined,
                              false,
                            );
                            if (r) setLabResult(r);
                          }}
                        >
                          <Field label="Query or text">
                            <input
                              name="text"
                              required
                              minLength={3}
                              placeholder="Premature withdrawal for individual deposits"
                            />
                          </Field>
                          <Field label="Operation">
                            <select name="mode">
                              <option value="embeddings">
                                Generate embedding
                              </option>
                              <option value="rerank">
                                Rerank stored passages
                              </option>
                            </select>
                          </Field>
                          <Button type="submit" disabled={!connected || busy}>
                            Run Nugen retrieval request
                          </Button>
                        </form>
                      </section>
                      <section className="panel">
                        <div className="section-title">
                          <h3>Response</h3>
                          <span>Persisted request result</span>
                        </div>
                        {labResult ? (
                          <div className="console-output">
                            {labResult.answer && <p>{labResult.answer}</p>}
                            <pre>
                              {JSON.stringify(
                                labResult.run?.response ||
                                  labResult.response ||
                                  labResult,
                                null,
                                2,
                              )}
                            </pre>
                          </div>
                        ) : (
                          <Empty icon={Command} title="Run a real request">
                            The response and token usage will appear here.
                            Failed calls are preserved in request history.
                          </Empty>
                        )}
                      </section>
                    </div>
                  )}
                  {labTab === "Evaluation" && (
                    <>
                      <div className="notice amber">
                        <AlertCircle size={15} />
                        <span>
                          Evaluation uses Nugen credits. Create a five-question
                          benchmark once, then compare the aligned model with a
                          supported base model. Scores appear only after Nugen
                          returns results.
                        </span>
                      </div>
                      <div className="lab-grid">
                        <section className="panel">
                          <div className="section-title">
                            <h3>Benchmark</h3>
                            <Button
                              disabled={
                                busy ||
                                lab?.jobs.some(
                                  (j: Item) => j.kind === "benchmark",
                                ) ||
                                !lab?.jobs.some(
                                  (j: Item) =>
                                    j.kind === "document" &&
                                    j.status === "READY",
                                )
                              }
                              onClick={() => setModal("benchmark")}
                            >
                              Create benchmark
                            </Button>
                          </div>
                          {lab?.jobs
                            .filter((j: Item) => j.kind === "benchmark")
                            .map((j: Item) => (
                              <div className="model-project" key={j.id}>
                                <code>{j.remote_id}</code>
                                <Status value={j.status} />
                                <Button
                                  onClick={() =>
                                    act(
                                      () =>
                                        post(
                                          "/model-lab/jobs/" +
                                            j.id +
                                            "/refresh",
                                        ),
                                      "Benchmark refreshed",
                                      false,
                                    )
                                  }
                                >
                                  Refresh
                                </Button>
                                <pre>{JSON.stringify(j.response, null, 2)}</pre>
                              </div>
                            ))}
                          {!lab?.jobs.some(
                            (j: Item) => j.kind === "benchmark",
                          ) && (
                            <Empty title="No benchmark generated">
                              No accuracy or improvement scores are claimed.
                            </Empty>
                          )}
                        </section>
                        <section className="panel">
                          <div className="section-title">
                            <h3>Base vs aligned</h3>
                            <Button
                              disabled={
                                busy ||
                                lab?.evaluations.length > 0 ||
                                !lab?.jobs.some(
                                  (j: Item) =>
                                    j.kind === "benchmark" &&
                                    j.status === "READY",
                                )
                              }
                              onClick={() => setModal("evaluation")}
                            >
                              Run comparison
                            </Button>
                          </div>
                          {lab?.evaluations.map((ev: Item) => (
                            <div className="model-project" key={ev.id}>
                              <code>{ev.remote_id}</code>
                              <Status value={ev.status} />
                              <Button
                                onClick={() =>
                                  act(
                                    () =>
                                      post(
                                        "/model-lab/evaluations/" +
                                          ev.id +
                                          "/refresh",
                                      ),
                                    "Evaluation refreshed",
                                    false,
                                  )
                                }
                              >
                                Refresh results
                              </Button>
                              <EvaluationMetrics result={ev.response.results} />
                              <details>
                                <summary>Inspect raw provider results</summary>
                                <pre>
                                  {JSON.stringify(ev.response, null, 2)}
                                </pre>
                              </details>
                            </div>
                          ))}
                          {!lab?.evaluations.length && (
                            <Empty
                              icon={FlaskConical}
                              title="No evaluation results"
                            >
                              A deployed aligned model is not evidence of
                              improved performance. Run a comparison to measure
                              it.
                            </Empty>
                          )}
                        </section>
                      </div>
                    </>
                  )}
                  {labTab === "Request history" && (
                    <section className="panel">
                      {lab?.inferences.length ? (
                        <table>
                          <thead>
                            <tr>
                              <th>Purpose / created</th>
                              <th>Model</th>
                              <th>Status</th>
                              <th>Usage / payload</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lab.inferences.map((run: Item) => (
                              <tr key={run.id}>
                                <td>
                                  <strong>{label(run.purpose)}</strong>
                                  <small>{time(run.created_at)}</small>
                                </td>
                                <td>
                                  <code>{run.model_id}</code>
                                </td>
                                <td>
                                  <Status value={run.status} />
                                </td>
                                <td>
                                  {run.error && (
                                    <p className="error-text">{run.error}</p>
                                  )}
                                  <details>
                                    <summary>
                                      {run.response?.usage
                                        ? run.response.usage.total_tokens +
                                          " tokens"
                                        : "Inspect request and response"}
                                    </summary>
                                    <pre>
                                      {JSON.stringify(
                                        {
                                          request: run.request,
                                          response: run.response,
                                          error: run.error,
                                        },
                                        null,
                                        2,
                                      )}
                                    </pre>
                                  </details>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <Empty title="No inference requests yet">
                          Successful and failed Nugen requests are recorded
                          here.
                        </Empty>
                      )}
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>

      {assistantOpen && (
        <aside className="assistant-panel">
          <div className="inspector-head">
            <h3>
              <Sparkles size={15} />
              Riften Assistant
            </h3>
            <button
              className="icon-btn"
              aria-label="Close assistant"
              onClick={() => setAssistantOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="assistant-context">
            <span className="dot violet-dot" />
            {a ? "Context: " + a.title : "Workspace sources"}
            <small>Aligned Nugen inference · Read only</small>
          </div>
          <div className="assistant-messages">
            {asking ? (
              <div className="loading">
                <LoaderCircle size={16} className="spin" />
                Retrieving sources and asking Nugen…
              </div>
            ) : answer ? (
              <>
                {answer.error ? (
                  <div className="notice amber">
                    <AlertCircle size={16} />
                    {answer.error}
                  </div>
                ) : (
                  <>
                    <div className="answer">
                      <Sparkles size={15} />
                      <p>{answer.answer}</p>
                    </div>
                    <div className="section-label spaced">
                      RESOLVED CITATIONS
                    </div>
                    {answer.sources.map((s: Item) => (
                      <details key={s.section_id} className="evidence">
                        <summary>
                          {s.reference}
                          <ChevronDown size={12} />
                        </summary>
                        <blockquote>{s.text}</blockquote>
                        <button
                          className="text-link"
                          onClick={() => {
                            setVersionId(s.version_id);
                            setPage("Regulatory sources");
                            setAssistantOpen(false);
                          }}
                        >
                          Inspect stored source <ArrowRight size={12} />
                        </button>
                      </details>
                    ))}
                    {!answer.sources.length && (
                      <p className="fine-print">
                        The model supplied no resolvable citation. Treat this
                        answer as unverified.
                      </p>
                    )}
                    <p className="fine-print">{answer.verification}</p>
                    <details>
                      <summary>Retrieved source inventory</summary>
                      <pre>
                        {JSON.stringify(answer.retrieved_sources, null, 2)}
                      </pre>
                    </details>
                  </>
                )}
              </>
            ) : (
              <Empty icon={MessageSquare} title="Investigate with context">
                Ask what changed, which evidence is missing, or why a record
                needs review. Answers use retrieved workspace passages.
              </Empty>
            )}
          </div>
          <form
            className="assistant-composer"
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
          >
            <textarea
              aria-label="Ask Riften Assistant"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about this workspace…"
              rows={3}
            />
            <div>
              <span>
                {connected
                  ? "Aligned model connected"
                  : "Deploy an aligned model in Model Lab"}
              </span>
              <button
                className="send"
                disabled={asking || !wid || question.length < 3}
                title="Send question"
              >
                <ArrowUp size={14} />
              </button>
            </div>
          </form>
        </aside>
      )}
      {toast && (
        <div
          className={"toast " + (toast.error ? "error" : "")}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{toast.text}</span>
          <button
            className="icon-btn"
            title="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {modal === "owner" && (
        <Modal title="Owner access" close={() => setModal("")} busy={busy} submit="Unlock editing"
          onSubmit={async (f) => {
            await act(async () => {
              await post("/access/login", {token:f.get("token")});
              await qc.invalidateQueries({queryKey:["access"]});
            }, "Owner access unlocked for four hours");
          }}>
          <p>This demo is open for exploration. The owner key unlocks changes and paid Nugen requests for this browser.</p>
          <Field label="Owner key"><input name="token" type="password" required autoFocus autoComplete="current-password" /></Field>
        </Modal>
      )}
      {modal === "workspace" && (
        <Modal
          title="Create workspace"
          close={() => setModal("")}
          busy={busy}
          submit="Create workspace"
          onSubmit={async (f) => {
            const r = await act(
              () => post("/workspaces", { name: f.get("name") }),
              "Workspace created",
            );
            if (r) setWid(r.id);
          }}
        >
          <Field label="Organization or workspace name">
            <input
              name="name"
              autoFocus
              required
              maxLength={160}
              placeholder="Your organization"
            />
          </Field>
          <p className="fine-print">
            Local, single-operator workspace. No collaborators or private
            records are added automatically.
          </p>
        </Modal>
      )}
      {(modal === "upload" || modal === "upload-version") && (
        <Modal
          title={
            modal === "upload-version"
              ? "Add document version"
              : "Import regulatory source"
          }
          close={() => setModal("")}
          busy={busy}
          submit="Import document"
          onSubmit={async (f) => {
            f.set("workspace_id", wid);
            if (modal === "upload-version") {
              const v = versions.find((v) => v.id === versionId);
              if (v) f.set("document_id", v.document_id);
            }
            const r = await act(() =>
              api("/sources/upload", { method: "POST", body: f }),
            );
            if (r) {
              setVersionId(r.id);
              setPage("Regulatory sources");
              setToast({
                text: r.duplicate
                  ? "Duplicate content. Existing version opened."
                  : r.status === "failed"
                    ? "Import preserved with parsing error. Inspect source details."
                    : "Document imported.",
              });
            }
          }}
        >
          <Field label="Source title">
            <input
              name="title"
              required
              maxLength={300}
              defaultValue={
                modal === "upload-version"
                  ? versions.find((v) => v.id === versionId)?.title
                  : ""
              }
              placeholder="Regulation or policy title"
            />
          </Field>
          <Field label="Version label">
            <input
              name="label"
              required
              maxLength={160}
              placeholder="Issued version, date, or internal version"
            />
          </Field>
          <Field label="Original document">
            <input type="file" name="file" required accept=".txt,.pdf,.docx" />
          </Field>
          <p className="fine-print">
            PDF, DOCX or UTF-8 TXT, up to 4 MB hosted or 15 MB locally. Scanned
            pages are flagged for manual review. No OCR text is invented.
          </p>
        </Modal>
      )}
      {modal === "url" && (
        <Modal
          title="Import official URL"
          close={() => setModal("")}
          busy={busy}
          submit="Fetch official document"
          onSubmit={async (f) => {
            const r = await act(
              () =>
                post("/sources/url", {
                  workspace_id: wid,
                  url: f.get("url"),
                  title: f.get("title"),
                  label: f.get("label"),
                }),
              "Official source imported",
            );
            if (r) {
              setPage("Regulatory sources");
              setVersionId(r.id);
            }
          }}
        >
          <Field label="Title">
            <input name="title" required maxLength={300} />
          </Field>
          <Field label="Official HTTPS URL">
            <input
              name="url"
              type="url"
              required
              placeholder="https://rbi.org.in/…"
            />
          </Field>
          <Field label="Version label">
            <input name="label" defaultValue="Official URL import" required />
          </Field>
          <div className="notice">
            <ShieldCheck size={15} />
            Only RBI and SEBI domains are allowed. Redirects and remote access
            restrictions are not bypassed.
          </div>
        </Modal>
      )}
      {modal === "compare" && (
        <Modal
          title="Compare regulatory versions"
          close={() => setModal("")}
          busy={busy}
          submit="Create comparison"
          onSubmit={async (f) => {
            const r = await act(
              () =>
                post("/assessments", {
                  workspace_id: wid,
                  old_version_id: f.get("old"),
                  new_version_id: f.get("new"),
                }),
              "Comparison saved",
            );
            if (r) openAssessment(r.id);
          }}
        >
          <Field label="Original version">
            <select
              name="old"
              required
              defaultValue={
                versions.filter((v) => v.status === "ready")[0]?.id || ""
              }
            >
              <option value="" disabled>
                Select original
              </option>
              {versions
                .filter((v) => v.status === "ready")
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title} / {v.label}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Updated version">
            <select
              name="new"
              required
              defaultValue={
                versions.filter((v) => v.status === "ready")[1]?.id || ""
              }
            >
              <option value="" disabled>
                Select update
              </option>
              {versions
                .filter((v) => v.status === "ready")
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title} / {v.label}
                  </option>
                ))}
            </select>
          </Field>
          <p className="fine-print">
            Match clauses, preserve differences, then submit for Nugen
            interpretation. Documents with unresolved extraction errors cannot
            be compared.
          </p>
          {versions.length < 2 && (
            <Button onClick={() => setModal("upload")}>
              Import another version
            </Button>
          )}
        </Modal>
      )}
      {modal === "review" && change && (
        <Modal
          title="Record review decision"
          close={() => setModal("")}
          busy={busy}
          onSubmit={async (f) => {
            await act(
              () =>
                patch("/changes/" + change.id + "/review", {
                  status: f.get("status"),
                  note: f.get("note"),
                }),
              "Review decision saved",
            );
          }}
        >
          <Field label="Decision">
            <select name="status">
              <option value="accepted">Accept interpretation</option>
              <option value="needs_review">Needs further review</option>
              <option value="rejected">Reject interpretation</option>
            </select>
          </Field>
          <Field label="Reason and supporting evidence">
            <textarea name="note" required minLength={5} rows={5} />
          </Field>
          <p className="fine-print">
            Recorded as Local reviewer. Accepting an interpretation does not
            approve an executable replay rule.
          </p>
        </Modal>
      )}
      {modal === "entity" && (
        <Modal
          title="Add organizational entity"
          close={() => setModal("")}
          busy={busy}
          onSubmit={async (f) => {
            await act(
              () =>
                post("/entities", {
                  workspace_id: wid,
                  kind: f.get("kind"),
                  name: f.get("name"),
                  description: f.get("description"),
                  attributes: JSON.parse(String(f.get("attributes") || "{}")),
                  synthetic: f.has("synthetic"),
                }),
              "Entity created",
            );
          }}
        >
          <Field label="Type">
            <select name="kind">
              <option value="policy">Internal policy</option>
              <option value="process">Business process</option>
              <option value="control">Control</option>
              <option value="record">Operational record</option>
            </select>
          </Field>
          <Field label="Name">
            <input name="name" required maxLength={300} />
          </Field>
          <Field label="Description / evidence">
            <textarea name="description" rows={3} />
          </Field>
          <Field label="Structured attributes (JSON)">
            <textarea
              className="mono"
              name="attributes"
              defaultValue="{}"
              rows={4}
            />
          </Field>
          <label className="check-field">
            <input type="checkbox" name="synthetic" />
            Synthetic demonstration entity
          </label>
        </Modal>
      )}
      {modal === "link" && (
        <Modal
          title="Map a dependency"
          close={() => setModal("")}
          busy={busy}
          submit="Save verified relationship"
          onSubmit={async (f) => {
            await act(
              () =>
                post("/graph/edges", {
                  source_id: f.get("source"),
                  target_id: f.get("target"),
                  rationale: f.get("rationale"),
                  verified: true,
                }),
              "Dependency mapped",
            );
          }}
        >
          <Field label="Upstream source">
            <select
              name="source"
              required
              defaultValue={selectedNode?.id || ""}
            >
              <option value="" disabled>
                Select upstream object
              </option>
              {graphQ.data?.nodes.map((n: Item) => (
                <option key={n.id} value={n.id}>
                  {n.kind}: {n.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Dependent object">
            <select
              name="target"
              required
              defaultValue={selectedNode?.target || ""}
            >
              <option value="" disabled>
                Select dependent object
              </option>
              {graphQ.data?.nodes.map((n: Item) => (
                <option key={n.id} value={n.id}>
                  {n.kind}: {n.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Evidence and relationship rationale">
            <textarea
              name="rationale"
              required
              minLength={10}
              rows={4}
              placeholder="Explain why this object depends on the upstream requirement."
            />
          </Field>
          <div className="notice">
            <ShieldCheck size={15} />
            Saving explicitly verifies this mapping as the local reviewer.
            Replay traverses only verified paths. No automatic relationships are
            inferred.
          </div>
        </Modal>
      )}
      {modal === "import-records" && (
        <Modal
          title="Import operational records"
          close={() => setModal("")}
          busy={busy}
          submit="Validate & import"
          onSubmit={async (f) => {
            f.set("workspace_id", wid);
            f.set("synthetic", String(f.has("synthetic")));
            await act(
              () => api("/entities/import", { method: "POST", body: f }),
              "Records imported",
            );
            setRecordView(true);
          }}
        >
          <Field label="CSV or JSON file">
            <input name="file" type="file" accept=".csv,.json" required />
          </Field>
          <Field label="Field mapping (source column → target attribute)">
            <textarea
              name="mapping"
              className="mono"
              defaultValue="{}"
              rows={3}
            />
          </Field>
          <p className="fine-print">
            Required columns: external_id, name. Other columns become typed
            attributes. Blank fields remain unknown. The whole import is
            rejected if any row is invalid.
          </p>
          <label className="check-field">
            <input name="synthetic" type="checkbox" />
            These are synthetic test records
          </label>
          <a className="text-link" href="/sample-records.csv" download>
            Download clearly labeled synthetic template{" "}
            <ArrowDownToLine size={12} />
          </a>
        </Modal>
      )}
      {modal === "rule" && change && (
        <Modal
          wide
          title="Verify executable rule"
          close={() => setModal("")}
          busy={busy}
          submit="Approve bounded rule"
          onSubmit={async (f) => {
            try {
              await act(
                () =>
                  api("/changes/" + change.id + "/rule", {
                    method: "PUT",
                    body: JSON.stringify({
                      rule: JSON.parse(String(f.get("rule"))),
                      verification_note: f.get("note"),
                    }),
                  }),
                "Replay rule verified",
              );
            } catch (e) {
              setToast({ text: (e as Error).message, error: true });
            }
          }}
        >
          <div className="notice amber">
            <ShieldCheck size={16} />
            <span>
              Review both source passages, applicability, units, inclusive
              boundary, and expected evidence. This approves a local assessment
              rule. It does not establish binding law.
            </span>
          </div>
          <div className="rule-source">
            <small>Original</small>
            <p>{change.old_section?.text || "No original clause"}</p>
            <small>Updated</small>
            <p>{change.new_section?.text || "No updated clause"}</p>
          </div>
          <Button
            disabled={busy || !connected}
            onClick={async () => {
              const r = await act(
                () => post("/changes/" + change.id + "/propose-rule"),
                undefined,
                false,
              );
              if (r) {
                setRuleDraft(r.rule);
                setToast({ text: r.warning });
              }
            }}
          >
            <Sparkles size={13} />
            Propose condition with Nugen
          </Button>
          <Field label="Bounded condition JSON">
            <textarea
              key={JSON.stringify(ruleDraft)}
              name="rule"
              className="mono"
              rows={15}
              required
              defaultValue={JSON.stringify(
                ruleDraft ||
                  change.requirement?.rule || {
                    field: "amount_inr",
                    operator: "lte",
                    old_value: 0,
                    new_value: 0,
                    scope: [],
                    expect: { field: "evidence_present", value: true },
                    note: "Reviewer must replace this template with a source-supported condition.",
                  },
                null,
                2,
              )}
            />
          </Field>
          <Field label="Independent verification note">
            <textarea
              name="note"
              required
              minLength={20}
              rows={3}
              placeholder="Explain source support, applicability, units, and unresolved exclusions."
            />
          </Field>
          <label className="check-field">
            <input type="checkbox" required />I have reviewed this rule against
            the source and confirmed its scope.
          </label>
        </Modal>
      )}
      {modal === "task" && (
        <Modal
          title="Create remediation action"
          close={() => setModal("")}
          busy={busy}
          submit="Create action"
          onSubmit={async (f) => {
            await act(
              () =>
                post("/tasks", {
                  workspace_id: wid,
                  title: f.get("title"),
                  change_id: f.get("change") || null,
                  entity_id: f.get("record") || null,
                  assignee: f.get("assignee"),
                  priority: f.get("priority"),
                  due_date: f.get("due") || null,
                  evidence: f.get("evidence"),
                }),
              "Review action created",
            );
          }}
        >
          <Field label="Action">
            <input
              name="title"
              required
              minLength={3}
              maxLength={300}
              placeholder="Describe the concrete review or remediation"
            />
          </Field>
          <div className="form-grid">
            <Field label="Assigned label">
              <input name="assignee" defaultValue="Local reviewer" required />
            </Field>
            <Field label="Priority">
              <select name="priority">
                <option>medium</option>
                <option>high</option>
                <option>low</option>
              </select>
            </Field>
          </div>
          <Field label="Due date, if established">
            <input name="due" type="date" />
          </Field>
          <Field label="Linked change">
            <select
              name="change"
              defaultValue={selectedNode?.change_id || change?.id || ""}
            >
              <option value="">No linked change</option>
              {changes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.new_section?.reference || c.old_section?.reference} ·{" "}
                  {label(c.classification)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Linked operational record">
            <select name="record" defaultValue={selectedNode?.entity_id || ""}>
              <option value="">No linked record</option>
              {entities
                .filter((e) => e.kind === "record")
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Supporting evidence / next steps">
            <textarea name="evidence" rows={4} />
          </Field>
          <p className="fine-print">
            Assignee is a local label, not a user account or notification
            recipient.
          </p>
        </Modal>
      )}
      {modal === "task-update" && selectedTask && (
        <Modal
          title="Update review action"
          close={() => setModal("")}
          busy={busy}
          submit="Record update"
          onSubmit={async (f) => {
            await act(
              () =>
                patch("/tasks/" + selectedTask.id, {
                  status: f.get("status"),
                  comment: f.get("comment"),
                }),
              "Action updated",
            );
          }}
        >
          <Field label="Status">
            <select
              name="status"
              defaultValue={tasks.find((t) => t.id === selectedTask.id)?.status}
            >
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </select>
          </Field>
          <Field label="Reviewer comment / completion evidence">
            <textarea name="comment" required minLength={3} rows={5} />
          </Field>
        </Modal>
      )}
      {modal === "alignment-upload" && (
        <Modal
          title="Prepare Nugen document"
          close={() => setModal("")}
          busy={busy}
          submit="Upload extracted plain text"
          onSubmit={async (f) => {
            await act(
              () =>
                post("/model-lab/documents", {
                  workspace_id: wid,
                  version_id: f.get("version"),
                }),
              "Nugen document submitted",
            );
          }}
        >
          <Field label="Extracted source version">
            <select name="version" required>
              <option value="" disabled>
                Select a version
              </option>
              {versions
                .filter((v) => v.status === "ready")
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} · {v.text.split(/\s+/).length} words
                  </option>
                ))}
            </select>
          </Field>
          <p>
            Only extracted plain text is sent to Nugen. Originals remain
            separate. Documents under 500 words are refused.
          </p>
        </Modal>
      )}
      {modal === "alignment" && (
        <Modal
          title="Create one Nugen alignment"
          close={() => setModal("")}
          busy={busy}
          submit="Start alignment"
          onSubmit={async (f) => {
            await act(
              () =>
                post("/model-lab/align", {
                  workspace_id: wid,
                  alignment_name: f.get("name"),
                  base_model_id: f.get("model"),
                  document_ids: f.getAll("documents"),
                }),
              "Alignment requested",
            );
          }}
        >
          <div className="notice amber">
            <AlertCircle size={15} />
            This uses Nugen credits. Exact cost is not exposed by the current
            API. This workspace permits one alignment.
          </div>
          <Field label="Project name">
            <input
              name="name"
              required
              defaultValue="Riften regulatory obligations"
            />
          </Field>
          <Field label="Supported base model">
            <select name="model" required>
              {baseModels
                .filter((m) => m.alignment_ready && !m.available_on_request)
                .map((m) => (
                  <option key={m.model_id} value={m.model_id}>
                    {m.model_id} ({m.parameters})
                  </option>
                ))}
            </select>
          </Field>
          {!baseModels.length && (
            <Button
              onClick={() =>
                act(
                  async () => {
                    const r = await api("/model-lab/base-models");
                    setBaseModels(r.models);
                  },
                  "Models discovered",
                  false,
                )
              }
            >
              Discover supported models
            </Button>
          )}
          <Field label="Ready alignment documents">
            <select name="documents" multiple required>
              {lab?.jobs
                .filter(
                  (j: Item) => j.kind === "document" && j.status === "READY",
                )
                .map((j: Item) => (
                  <option key={j.id} value={j.remote_id}>
                    {j.remote_id}
                  </option>
                ))}
            </select>
          </Field>
          <label className="check-field">
            <input type="checkbox" required />
            Authorize this one alignment using account credits.
          </label>
        </Modal>
      )}
      {modal === "benchmark" && (
        <Modal
          title="Create five-question benchmark"
          close={() => setModal("")}
          busy={busy}
          submit="Generate benchmark"
          onSubmit={async (f) => {
            await act(
              () =>
                post("/model-lab/benchmark", {
                  workspace_id: wid,
                  document_id: f.get("document"),
                }),
              "Benchmark generation requested",
            );
          }}
        >
          <Field label="Ready document">
            <select name="document" required>
              {lab?.jobs
                .filter(
                  (j: Item) => j.kind === "document" && j.status === "READY",
                )
                .map((j: Item) => (
                  <option key={j.id} value={j.remote_id}>
                    {j.remote_id}
                  </option>
                ))}
            </select>
          </Field>
          <p>
            Five Nugen-generated questions from the selected source corpus.
            Generated tests are not independent legal validation.
          </p>
          <label className="check-field">
            <input type="checkbox" required />
            Use Nugen credits for this benchmark.
          </label>
        </Modal>
      )}
      {modal === "evaluation" && (
        <Modal
          title="Evaluate base vs aligned"
          close={() => setModal("")}
          busy={busy}
          submit="Start evaluation"
          onSubmit={async (f) => {
            await act(
              () =>
                post("/model-lab/evaluations", {
                  workspace_id: wid,
                  benchmark_id: f.get("benchmark"),
                  baseline_model_id: f.get("baseline") || null,
                }),
              "Evaluation requested",
            );
          }}
        >
          <Field label="Benchmark">
            <select name="benchmark" required>
              {lab?.jobs
                .filter(
                  (j: Item) => j.kind === "benchmark" && j.status === "READY",
                )
                .map((j: Item) => (
                  <option key={j.id} value={j.remote_id}>
                    {j.remote_id}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Baseline model">
            <input name="baseline" defaultValue="Qwen/Qwen2.5-1.5B-Instruct" />
          </Field>
          <label className="check-field">
            <input type="checkbox" required />
            Use Nugen credits for this one comparison.
          </label>
        </Modal>
      )}
    </div>
  );
}
