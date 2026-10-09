import React, {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowUpRight,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code2,
  FileText,
  FlaskConical,
  GitBranch,
  Layers3,
  LayoutDashboard,
  Loader2,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Waypoints,
  X,
  XCircle,
} from "lucide-react";
import { api, setCSRF } from "./api";
import "./style.css";
type Data = any;
const icons = {
  overview: LayoutDashboard,
  projects: Box,
  scenarios: Layers3,
  runs: Activity,
  changes: GitBranch,
  schedules: Clock,
  settings: Settings2,
};
const names = {
  overview: "Overview",
  projects: "Projects",
  scenarios: "Scenarios",
  runs: "Regression",
  changes: "Changes",
  schedules: "Schedules",
  settings: "Settings",
};
const date = (v: string) =>
  v
    ? new Date(v).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const duration = (n: number) =>
  n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`;
function useRoute() {
  const [route, set] = useState(location.hash.slice(1) || "overview");
  useEffect(() => {
    const cb = () => set(location.hash.slice(1) || "overview");
    window.addEventListener("hashchange", cb);
    return () => window.removeEventListener("hashchange", cb);
  }, []);
  return route;
}
function useData(url: string | null, revision = 0, poll = false) {
  const [data, set] = useState<Data>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () =>
      url &&
      api(url)
        .then((d) => {
          if (active) {
            set(d);
            setError("");
          }
        })
        .catch((e) => active && setError(e.message));
    set(null);
    load();
    const timer = poll ? setInterval(load, 3000) : undefined;
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [url, revision, poll]);
  return { data, error };
}
function Badge({ value }: { value: string }) {
  return (
    <span className={"badge " + value}>
      {value?.replaceAll("_", " ") || "pending"}
    </span>
  );
}
function Empty({
  icon: Icon = FlaskConical,
  title,
  children,
  action,
}: {
  icon?: any;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={30} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Loading() {
  return (
    <div className="loading">
      <Loader2 size={20} className="spin" />
      Loading workspace…
    </div>
  );
}
function Button({
  children,
  onClick,
  kind = "",
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: string;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={"button " + kind}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", key);
    const prev = document.activeElement as HTMLElement;
    const el = document.querySelector<HTMLElement>(
      ".modal input,.modal button",
    );
    el?.focus();
    return () => {
      window.removeEventListener("keydown", key);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
      >
        <div className="section-title">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={close}
          >
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function Field({
  label,
  name,
  type = "text",
  value,
  placeholder,
  required = true,
}: {
  label: string;
  name: string;
  type?: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="field">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        placeholder={placeholder}
        required={required}
        autoComplete={type === "password" ? "new-password" : "off"}
      />
    </label>
  );
}
function Auth({ done }: { done: () => void }) {
  const { data } = useData("/setup/status");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const b = Object.fromEntries(new FormData(e.currentTarget));
      const r = await api(data.required ? "/setup" : "/sessions", "POST", b);
      setCSRF(r.csrf);
      done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <div className="auth-story">
        <div className="brand">
          <span className="brandmark">
            <Check size={24} />
          </span>
          verity
        </div>
        <h1>
          Every change
          <br />
          deserves evidence.
        </h1>
        <p>
          Understand your application. Review the scenarios. Run the regression
          with confidence.
        </p>
        <div className="auth-flow">
          <span>
            <Waypoints />
            Discover
          </span>
          <span>
            <Layers3 />
            Review
          </span>
          <span>
            <ShieldCheck />
            Verify
          </span>
        </div>
        <small>Your local AI testing workspace</small>
      </div>
      <div className="auth-form">
        {!data ? (
          <Loading />
        ) : (
          <form onSubmit={submit}>
            <span className="subtle">Verity workspace</span>
            <h2>{data.required ? "Set up your workspace" : "Welcome back"}</h2>
            <p>
              {data.required
                ? "Create the owner account for this local installation."
                : "Sign in to continue testing your applications."}
            </p>
            {data.required && <Field name="name" label="Your name" />}
            <Field name="email" label="Email address" type="email" />
            <Field name="password" label="Password" type="password" />
            {data.required && (
              <>
                <Field
                  name="setupToken"
                  label="Installation setup token"
                  type="password"
                />
                <p className="hint">
                  Use SETUP_TOKEN from the .env file generated by setup. Choose
                  a password with at least 12 characters.
                </p>
              </>
            )}
            {error && (
              <div role="alert" className="error-box">
                {error}
              </div>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <ShieldCheck size={17} />
              )}{" "}
              {data.required ? "Create workspace" : "Sign in"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
function App() {
  const [user, setUser] = useState<Data>(undefined),
    [rev, setRev] = useState(0),
    [projectId, setProjectId] = useState(
      localStorage.getItem("verity.project") || "",
    ),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState("");
  const route = useRoute(),
    [section, itemId] = route.split("/");
  const currentSection = section in names ? section : "overview";
  const projects = useData(user ? "/projects" : null, rev).data;
  const health = useData(user ? "/health/details" : null, rev, true).data;
  const refresh = () => setRev((v) => v + 1);
  const session = () =>
    api("/me")
      .then((u) => {
        setCSRF(u.csrf);
        setUser(u);
      })
      .catch(() => setUser(null));
  useEffect(() => {
    session();
  }, []);
  useEffect(() => {
    if (projects?.length && !projects.some((p: Data) => p.id === projectId)) {
      setProjectId(projects[0].id);
      localStorage.setItem("verity.project", projects[0].id);
    }
  }, [projects]);
  useEffect(() => {
    setError("");
    setNotice("");
  }, [route]);
  async function act(fn: () => Promise<any>, message = "Saved") {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      setNotice(message);
      refresh();
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const choose = (id: string) => {
    setProjectId(id);
    localStorage.setItem("verity.project", id);
  };
  async function loadDemo() {
    const r = await act(
      () => api("/demo", "POST", {}),
      "Demo connected. Review the authored scenarios before running.",
    );
    if (r) {
      choose(r.projectId);
      location.hash = "projects/" + r.projectId;
    }
  }
  if (user === undefined) return <Loading />;
  if (!user) return <Auth done={session} />;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="#overview" className="brand">
          <span className="brandmark">
            <Check size={23} />
          </span>
          verity<span className="edition">local</span>
        </a>
        <div className="workspace-label">
          <span className="workspace-symbol">M</span>
          <div>
            My workspace<small>Application testing</small>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {Object.entries(names).map(([key, label]) => {
            const Icon = icons[key as keyof typeof icons];
            return (
              <a
                href={"#" + key}
                key={key}
                className={currentSection === key ? "active" : ""}
              >
                <Icon size={19} />
                <span>{label}</span>
                {key === "runs" && health?.worker?.activeRuns > 0 && (
                  <span className="nav-count">{health.worker.activeRuns}</span>
                )}
              </a>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="runtime">
            <span
              className={"dot " + (health?.worker?.healthy ? "good" : "warn")}
            />
            {health?.worker?.healthy
              ? "Local runner ready"
              : "Runner unavailable"}
          </div>
          <div className="account">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <div>
              {user.name}
              <small>{user.role}</small>
            </div>
            <button
              title="Sign out"
              aria-label="Sign out"
              onClick={() =>
                act(async () => {
                  await api("/sessions", "DELETE");
                  setUser(null);
                }, "")
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{names[currentSection as keyof typeof names]}</strong>
          </div>
          <div className="topbar-right">
            <span
              className={
                "provider " + (health?.inferenceVerified ? "connected" : "")
              }
            >
              <span className="dot" />
              {health?.inferenceVerified ? "Codex connected" : "Codex setup"}
            </span>
            <span className="local-note">Localhost</span>
            <button
              className="icon-button"
              aria-label="Refresh workspace"
              onClick={refresh}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        <main className="main">
          {error && (
            <div className="error-box" role="alert">
              <XCircle size={18} />
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <CheckCircle2 size={17} />
              {notice}
              <button
                onClick={() => setNotice("")}
                aria-label="Dismiss message"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {currentSection === "overview" && (
            <Overview
              rev={rev}
              projects={projects}
              health={health}
              connect={() => setModal("project")}
              demo={loadDemo}
              busy={busy}
            />
          )}
          {currentSection === "projects" && !itemId && (
            <>
              <Heading
                title="Connected projects"
                subtitle="A clear view of every application you test."
                action={
                  <Button
                    onClick={() => setModal("project")}
                    disabled={user.role !== "owner"}
                  >
                    <Plus size={17} />
                    Connect project
                  </Button>
                }
              />
              <ProjectList projects={projects} choose={choose} />
              <div className="demo-callout">
                <FlaskConical size={24} />
                <div>
                  <h3>Explore with Gather</h3>
                  <p>
                    Use our owned demo application to see real tests catch
                    controlled defects.
                  </p>
                </div>
                <Button
                  kind="secondary"
                  onClick={loadDemo}
                  disabled={busy || user.role !== "owner"}
                >
                  Connect demo
                </Button>
              </div>
            </>
          )}
          {currentSection === "projects" && itemId && (
            <ProjectDetail
              id={itemId}
              rev={rev}
              act={act}
              busy={busy}
              choose={choose}
              user={user}
            />
          )}
          {["scenarios", "changes", "schedules"].includes(currentSection) && (
            <div className="project-picker">
              <label htmlFor="activeProject">Project</label>
              <select
                id="activeProject"
                value={projectId}
                onChange={(e) => choose(e.target.value)}
              >
                {!projects?.length && (
                  <option value="">Connect a project first</option>
                )}
                {projects?.map((p: Data) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {currentSection === "scenarios" && (
            <Scenarios
              projectId={projectId}
              rev={rev}
              act={act}
              busy={busy}
              user={user}
            />
          )}
          {currentSection === "runs" &&
            (itemId ? (
              <RunDetail
                id={itemId}
                rev={rev}
                act={act}
                busy={busy}
                user={user}
              />
            ) : (
              <Runs rev={rev} />
            ))}
          {currentSection === "changes" && (
            <Changes
              projectId={projectId}
              rev={rev}
              act={act}
              busy={busy}
              user={user}
            />
          )}
          {currentSection === "schedules" && (
            <Schedules
              projectId={projectId}
              rev={rev}
              act={act}
              busy={busy}
              user={user}
            />
          )}
          {currentSection === "settings" && (
            <Settings
              rev={rev}
              act={act}
              busy={busy}
              health={health}
              user={user}
            />
          )}
        </main>
        <footer className="footer">
          <span>Evidence you can trace. Results you can trust.</span>
          <span>Verity · Local MVP</span>
        </footer>
      </div>
      {modal === "project" && (
        <Modal title="Connect a web application" close={() => setModal("")}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = Object.fromEntries(new FormData(e.currentTarget));
              const r = await act(
                () =>
                  api("/projects", "POST", {
                    name: form.name,
                    baseUrl: form.baseUrl,
                    description: form.description,
                    allowedOrigins: String(form.allowedOrigins || "")
                      .split(/\s+/)
                      .filter(Boolean),
                  }),
                "Application connected",
              );
              if (r) {
                setModal("");
                choose(r.id);
                location.hash = "projects/" + r.id;
              }
            }}
          >
            <Field
              label="Project name"
              name="name"
              placeholder="Customer portal"
            />
            <Field
              label="Application URL"
              name="baseUrl"
              type="url"
              placeholder="http://127.0.0.1:8080"
            />
            <label className="field">
              Additional allowed origins
              <textarea
                name="allowedOrigins"
                placeholder="https://api.example.test (one origin per line)"
              />
            </label>
            <label className="field">
              Description
              <textarea
                name="description"
                placeholder="What does this application do?"
              />
            </label>
            <p className="hint">
              Connect an application you own or are authorized to test. Use a
              dedicated test environment and accounts.
            </p>
            <div className="form-actions">
              <Button kind="secondary" onClick={() => setModal("")}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Connect project
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function Heading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
function ProjectList({
  projects,
  choose,
}: {
  projects: Data;
  choose: (s: string) => void;
}) {
  if (!projects) return <Loading />;
  if (!projects.length)
    return (
      <Empty title="Your first project starts here">
        Connect a web application or load the owned Gather demo.
      </Empty>
    );
  return (
    <div className="project-list">
      {projects.map((p: Data) => (
        <a
          key={p.id}
          className="project-row"
          href={"#projects/" + p.id}
          onClick={() => choose(p.id)}
        >
          <span className="project-icon">
            <Box size={22} />
          </span>
          <div>
            <h3>{p.name}</h3>
            <p>{p.description || "Web application"}</p>
          </div>
          <span className="project-case-count">{p.case_count} scenarios</span>
          <ChevronRight size={19} />
        </a>
      ))}
    </div>
  );
}
function Overview({ rev, projects, health, connect, demo, busy }: Data) {
  const { data, error } = useData("/overview", rev, true);
  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <Loading />;
  return (
    <>
      <Heading
        title="Regression overview"
        subtitle="Keep your next release in sight."
        action={
          <Button onClick={connect}>
            <Plus size={17} />
            Connect project
          </Button>
        }
      />
      <div className="stat-strip">
        <div>
          <span>Connected projects</span>
          <strong>{data.stats.projects}</strong>
        </div>
        <div>
          <span>Scenarios in library</span>
          <strong>{data.stats.cases}</strong>
        </div>
        <div>
          <span>Approved for testing</span>
          <strong>{data.stats.approved}</strong>
        </div>
        <div>
          <span>Runs in progress</span>
          <strong>
            {data.stats.active}
            <span className="live-line" />
          </strong>
        </div>
      </div>
      {!projects?.length ? (
        <div className="getting-started">
          <div>
            <span className="large-icon">
              <Waypoints size={32} />
            </span>
            <h2>Turn your application into a test plan.</h2>
            <p>
              Start with its URL and requirements. Verity maps the reachable
              workflows, drafts scenarios, and runs the tests you approve.
            </p>
            <div className="inline-actions">
              <Button onClick={connect}>Connect your application</Button>
              <Button kind="secondary" onClick={demo} disabled={busy}>
                Try the Gather demo
              </Button>
            </div>
          </div>
          <ol className="journey">
            <li>
              <span>1</span>
              <div>
                <b>Connect & discover</b>
                <small>Map the pages and controls</small>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <b>Generate & review</b>
                <small>Ground expectations in requirements</small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <b>Run & verify</b>
                <small>See browser evidence for every result</small>
              </div>
            </li>
          </ol>
        </div>
      ) : (
        <>
          <div className="section-title">
            <h2>Recent regression runs</h2>
            <a href="#runs">
              View all runs <ArrowUpRight size={15} />
            </a>
          </div>
          <RunTable runs={data.recent} />
          <div className="section-title">
            <h2>Your applications</h2>
            <a href="#projects">
              Manage projects <ArrowUpRight size={15} />
            </a>
          </div>
          <ProjectList projects={projects} choose={() => {}} />
        </>
      )}
      <div className="environment-strip">
        <span>
          <span
            className={"dot " + (health?.worker?.healthy ? "good" : "warn")}
          />
          {health?.worker?.healthy
            ? "Browser worker available"
            : "Start the local worker"}
        </span>
        <span>
          <ShieldCheck size={16} />
          PostgreSQL persistence
        </span>
        <span>
          <Code2 size={16} />
          Local Codex adapter
        </span>
        <span>
          <Clock size={16} />
          Schedules run while this app is open
        </span>
      </div>
    </>
  );
}
function RunTable({ runs }: { runs: Data[] }) {
  return !runs.length ? (
    <Empty icon={Activity} title="No regression runs yet">
      Approve scenarios in your project to start the first run.
    </Empty>
  ) : (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Application / Run</th>
            <th>Scenarios</th>
            <th>Lifecycle</th>
            <th>Verdict</th>
            <th>Started</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>
                <a className="table-link" href={"#runs/" + r.id}>
                  {r.project_name}
                  <small>{r.id.slice(0, 8)}</small>
                </a>
              </td>
              <td>{r.case_count}</td>
              <td>
                <Badge value={r.state} />
              </td>
              <td>
                <Badge value={r.verdict} />
              </td>
              <td className="muted">{date(r.created_at)}</td>
              <td>
                <a href={"#runs/" + r.id} aria-label="Open run">
                  <ChevronRight size={18} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function ProjectDetail({ id, rev, act, busy, choose, user }: Data) {
  const { data, error } = useData("/projects/" + id, rev, true);
  const [tab, setTab] = useState("overview"),
    [modal, setModal] = useState(""),
    [build, setBuild] = useState<Data>(null);
  useEffect(() => {
    choose(id);
    api("/demo/build")
      .then(setBuild)
      .catch(() => {});
  }, [id, rev]);
  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <Loading />;
  const env = data.environments[0],
    approved = data.cases.filter(
      (c: Data) => c.status === "approved" && !c.archived,
    );
  async function run() {
    const r = await act(
      () =>
        api("/runs", "POST", {
          projectId: id,
          environmentId: env.id,
          trace: true,
          ...(env.base_url.includes("4174") && build
            ? { expectedBuild: build.id }
            : {}),
        }),
      "Regression queued",
    );
    if (r) location.hash = "runs/" + r.runId;
  }
  return (
    <>
      <a href="#projects" className="back-link">
        Projects <ChevronRight size={14} />
      </a>
      <Heading
        title={data.project.name}
        subtitle={data.project.description}
        action={
          <div className="inline-actions">
            <Button
              kind="secondary"
              onClick={() => {
                choose(id);
                location.hash = "scenarios";
              }}
            >
              Review scenarios
            </Button>
            <Button
              onClick={run}
              disabled={busy || !approved.length || user.role === "viewer"}
            >
              <Play size={16} />
              Run regression
            </Button>
          </div>
        }
      />
      <div className="project-meta">
        <span>
          <span className="dot good" /> {env.name}
        </span>
        <a href={env.base_url} target="_blank" rel="noreferrer">
          {env.base_url}
          <ArrowUpRight size={14} />
        </a>
        <span>{approved.length} approved scenarios</span>
      </div>
      <div className="tabs">
        {["overview", "application map", "requirements", "access"].map((t) => (
          <button
            key={t}
            className={t === tab ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <>
          <div className="workflow-grid">
            <div className="workflow-step">
              <Waypoints />
              <h3>Discover application</h3>
              <p>Observe pages and controls with a bounded browser crawl.</p>
              <select aria-label="Discovery role" id="discoveryRole">
                <option value="">Signed out</option>
                {data.secrets.map((s: Data) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
              <Button
                kind="secondary"
                disabled={busy || user.role === "viewer"}
                onClick={() =>
                  act(
                    () =>
                      api("/environments/" + env.id + "/discoveries", "POST", {
                        roleRef:
                          (
                            document.getElementById(
                              "discoveryRole",
                            ) as HTMLSelectElement
                          ).value || null,
                        maxPages: 8,
                        paths: env.base_url.includes("4174")
                          ? ["/feed", "/profile", "/search", "/comments"]
                          : [],
                      }),
                    "Discovery queued",
                  )
                }
              >
                Analyze application
              </Button>
            </div>
            <div className="workflow-step">
              <Sparkles />
              <h3>Generate scenarios</h3>
              <p>
                Draft new cases from the latest discovery and your requirements.
              </p>
              <input
                aria-label="Generation focus"
                id="generationFocus"
                placeholder="Focus, e.g. profile validation"
              />
              <Button
                kind="secondary"
                disabled={
                  busy ||
                  !data.requirements.length ||
                  !data.discoveries.some(
                    (d: Data) => d.state === "completed",
                  ) ||
                  user.role === "viewer"
                }
                onClick={() =>
                  act(
                    () =>
                      api("/projects/" + id + "/generations", "POST", {
                        count: 5,
                        focus: (
                          document.getElementById(
                            "generationFocus",
                          ) as HTMLInputElement
                        ).value,
                      }),
                    "AI generation queued",
                  )
                }
              >
                Generate with Codex
              </Button>
            </div>
            <div className="workflow-step">
              <ShieldCheck />
              <h3>Approve & execute</h3>
              <p>
                Confirm expectations before tests interact with your
                application.
              </p>
              <div className="approval-summary">
                <strong>{approved.length}</strong> ready to run
              </div>
              <Button
                kind="secondary"
                onClick={() => {
                  choose(id);
                  location.hash = "scenarios";
                }}
              >
                Open scenario library
              </Button>
            </div>
          </div>
          {env.base_url.includes("4174") && (
            <div className="demo-callout">
              <FlaskConical size={26} />
              <div>
                <h3>Presentation build: {build?.mode || "checking"}</h3>
                <p>
                  Buggy mode introduces profile persistence, empty-post
                  validation, and edit-button visibility defects. Existing
                  reports remain unchanged.
                </p>
              </div>
              <Button
                kind="secondary"
                disabled={busy || user.role !== "owner"}
                onClick={() =>
                  act(
                    () =>
                      api("/demo/mode", "POST", {
                        mode: build?.mode === "buggy" ? "fixed" : "buggy",
                      }),
                    "Demo build changed",
                  )
                }
              >
                {build?.mode === "buggy"
                  ? "Switch to fixed build"
                  : "Enable known defects"}
              </Button>
            </div>
          )}
          <div className="section-title">
            <h2>Generation activity</h2>
            <span className="muted">Real provider requests</span>
          </div>
          {!data.generations.length ? (
            <p className="muted padded">
              No AI generations yet. Gather’s initial examples are authored demo
              scenarios.
            </p>
          ) : (
            data.generations.map((g: Data) => (
              <div className="activity-row" key={g.id}>
                <Sparkles size={18} />
                <div>
                  <b>
                    {g.result_ids.length
                      ? `${g.result_ids.length} scenarios drafted`
                      : "Scenario generation"}
                  </b>
                  <small>
                    {date(g.created_at)}
                    {g.model ? " · " + g.model : ""}
                  </small>
                  {g.error && <p className="error-text">{g.error}</p>}
                  {g.questions.map((q: string, i: number) => (
                    <p className="hint" key={i}>
                      {q}
                    </p>
                  ))}
                </div>
                <Badge value={g.state} />
              </div>
            ))
          )}
        </>
      )}
      {tab === "application map" && (
        <>
          <div className="section-title">
            <h2>Observed pages</h2>
            <span className="muted">
              Navigation coverage, not total application coverage
            </span>
          </div>
          {!data.discoveries.length ? (
            <Empty icon={Waypoints} title="No discovery snapshot yet">
              Run application analysis from the overview.
            </Empty>
          ) : (
            data.discoveries.map((d: Data) => (
              <section className="discovery" key={d.id}>
                <div className="section-title">
                  <span>
                    {date(d.created_at)} · {d.pages.length} pages
                  </span>
                  <Badge value={d.state} />
                </div>
                {d.error && <p className="error-text">{d.error}</p>}
                <div className="map-grid">
                  {d.pages.map((p: Data, i: number) => (
                    <details key={i}>
                      <summary>
                        <Waypoints size={16} />
                        <b>{p.headings?.[0] || p.title}</b>
                        <span>{p.path}</span>
                      </summary>
                      <p>{p.controls.length} observed controls</p>
                      {p.controls.map((c: Data, j: number) => (
                        <div className="control-row" key={j}>
                          <span>{c.tag}</span>
                          {c.label || c.text || c.testId || c.type}
                        </div>
                      ))}
                    </details>
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}
      {tab === "requirements" && (
        <>
          <div className="section-title">
            <h2>Expected behavior</h2>
            <Button
              kind="secondary"
              onClick={() => setModal("requirement")}
              disabled={user.role === "viewer"}
            >
              <Plus size={16} />
              Add requirement
            </Button>
          </div>
          {data.requirements.length ? (
            data.requirements.map((r: Data) => (
              <details className="requirement" key={r.id}>
                <summary>
                  <FileText size={18} />
                  <strong>{r.title}</strong>
                  <span>Revision {r.revision}</span>
                </summary>
                <p>{r.body}</p>
                <small>Source {r.id}</small>
              </details>
            ))
          ) : (
            <Empty icon={FileText} title="Define what should happen">
              Requirements give AI scenarios an expected result to verify.
            </Empty>
          )}
        </>
      )}
      {tab === "access" && (
        <>
          <div className="section-title">
            <h2>Test account roles</h2>
            <Button
              kind="secondary"
              disabled={user.role !== "owner"}
              onClick={() => setModal("secret")}
            >
              <Plus size={16} />
              Add test account
            </Button>
          </div>
          <p className="hint">
            Credentials are encrypted locally and resolved only for the selected
            environment. Use synthetic test accounts.
          </p>
          {data.secrets.map((s: Data) => (
            <div className="activity-row" key={s.id}>
              <ShieldCheck size={20} />
              <div>
                <b>{s.name}</b>
                <small>Encrypted login configuration</small>
              </div>
              <Badge value="configured" />
            </div>
          ))}
        </>
      )}
      {modal === "requirement" && (
        <Modal title="Add a requirement" close={() => setModal("")}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const b = Object.fromEntries(new FormData(e.currentTarget));
              const r = await act(
                () => api("/projects/" + id + "/requirements", "POST", b),
                "Requirement saved",
              );
              if (r) setModal("");
            }}
          >
            <Field label="Requirement title" name="title" />
            <label className="field">
              Expected behavior
              <textarea
                name="body"
                required
                rows={6}
                placeholder="Describe the workflow, validation rules, and expected results."
              />
            </label>
            <Button type="submit" disabled={busy}>
              Save requirement
            </Button>
          </form>
        </Modal>
      )}
      {modal === "secret" && (
        <Modal title="Configure a test account" close={() => setModal("")}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await act(
                () =>
                  api(
                    "/environments/" + env.id + "/secrets",
                    "POST",
                    Object.fromEntries(new FormData(e.currentTarget)),
                  ),
                "Test account saved",
              );
              if (r) setModal("");
            }}
          >
            <Field label="Role name" name="name" placeholder="editor" />
            <div className="two-columns">
              <Field label="Login email" name="email" />
              <Field label="Password" name="password" type="password" />
            </div>
            <Field label="Login page path" name="loginPath" value="/login" />
            <div className="two-columns">
              <Field
                label="Email field label"
                name="emailLabel"
                value="Email"
              />
              <Field
                label="Password field label"
                name="passwordLabel"
                value="Password"
              />
            </div>
            <Field
              label="Sign-in button name"
              name="submitName"
              value="Sign in"
            />
            <Button type="submit" disabled={busy}>
              Save encrypted account
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
function Scenarios({ projectId, rev, act, busy, user }: Data) {
  const { data } = useData(projectId ? "/projects/" + projectId : null, rev);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [focus, setFocus] = useState(""),
    [editing, setEditing] = useState(false),
    [json, setJson] = useState(""),
    [history, setHistory] = useState<Data>(null),
    [newCase, setNewCase] = useState(false);
  useEffect(() => {
    setSelected(new Set());
    setFocus("");
    setHistory(null);
  }, [projectId]);
  if (!projectId)
    return (
      <Empty title="Choose a project first">
        Connect an application to build its scenario library.
      </Empty>
    );
  if (!data) return <Loading />;
  const cases = data.cases.filter(
    (c: Data) =>
      !c.archived &&
      (filter === "all" || c.status === filter) &&
      (c.title + " " + c.module).toLowerCase().includes(query.toLowerCase()),
  );
  const current = data.cases.find((c: Data) => c.id === focus) || cases[0];
  const writable = user.role !== "viewer";
  async function approveSelected() {
    await act(async () => {
      for (const c of cases.filter((c: Data) => selected.has(c.id)))
        await api("/case-versions/" + c.id + "/approvals", "POST", {
          hash: c.hash,
        });
      setSelected(new Set());
    }, "Selected scenarios approved");
  }
  async function run() {
    const ids = data.cases
      .filter((c: Data) => selected.has(c.id) && c.status === "approved")
      .map((c: Data) => c.id);
    const r = await act(
      () =>
        api("/runs", "POST", {
          projectId,
          environmentId: data.environments[0].id,
          ...(ids.length ? { versionIds: ids } : {}),
        }),
      "Regression queued",
    );
    if (r) location.hash = "runs/" + r.runId;
  }
  return (
    <>
      <Heading
        title="Scenario library"
        subtitle="Review what matters. Approve exactly what will run."
        action={
          <div className="inline-actions">
            <Button
              kind="secondary"
              disabled={!writable || !data.requirements.length}
              onClick={() => {
                setNewCase(true);
                setJson(
                  JSON.stringify(
                    {
                      title: "New scenario",
                      module: "General",
                      priority: "normal",
                      roleRef: null,
                      requirementIds: [data.requirements[0].id],
                      preconditions: "Describe required test data",
                      steps: [
                        {
                          op: "navigate",
                          target: null,
                          value: null,
                          path: "/",
                        },
                        {
                          op: "assertVisible",
                          target: {
                            kind: "role",
                            value: "Expected heading",
                            role: "heading",
                          },
                          value: null,
                          path: null,
                        },
                      ],
                      cleanup: [],
                      retrySafe: false,
                    },
                    null,
                    2,
                  ),
                );
              }}
            >
              Add scenario
            </Button>
            <Button
              onClick={run}
              disabled={
                busy ||
                !writable ||
                !data.cases.some((c: Data) => c.status === "approved")
              }
            >
              <Play size={16} />
              Run approved
            </Button>
          </div>
        }
      />
      <div className="toolbar">
        <label className="search-input">
          <Search size={17} />
          <input
            placeholder="Search scenarios or modules"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter scenario status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {[
            "all",
            "draft",
            "ready",
            "approved",
            "needs_review",
            "rejected",
          ].map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <span className="muted">{cases.length} scenarios</span>
        <a
          className="text-link"
          href={"/api/v1/projects/" + projectId + "/export"}
        >
          Export CSV
        </a>
      </div>
      {selected.size > 0 && (
        <div className="selection-bar">
          <b>{selected.size} selected</b>
          <span>
            Confirm each selected scenario’s expectations before approval.
          </span>
          <Button
            kind="secondary"
            disabled={busy || !writable}
            onClick={approveSelected}
          >
            Approve reviewed selection
          </Button>
        </div>
      )}
      {!cases.length ? (
        <Empty title="No scenarios match">
          Add requirements, discover your application, and generate scenarios
          from the project overview.
        </Empty>
      ) : (
        <div className="scenario-workbench">
          <div className="scenario-list">
            <div className="list-header">
              <input
                type="checkbox"
                aria-label="Select all visible scenarios"
                checked={
                  cases.length > 0 &&
                  cases.every((c: Data) => selected.has(c.id))
                }
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? new Set(cases.map((c: Data) => c.id))
                      : new Set(),
                  )
                }
              />
              <span>Scenario / Module</span>
            </div>
            {cases.map((c: Data) => (
              <div
                className={
                  "scenario-row " + (current?.id === c.id ? "selected" : "")
                }
                key={c.id}
              >
                <input
                  type="checkbox"
                  aria-label={"Select " + c.title}
                  checked={selected.has(c.id)}
                  onChange={(e) => {
                    const n = new Set(selected);
                    e.target.checked ? n.add(c.id) : n.delete(c.id);
                    setSelected(n);
                  }}
                />
                <button
                  onClick={() => {
                    setFocus(c.id);
                    setEditing(false);
                    setHistory(null);
                  }}
                >
                  <span className="scenario-title">{c.title}</span>
                  <span className="scenario-info">
                    {c.module}
                    <span>v{c.version}</span>
                    <Badge value={c.status} />
                  </span>
                </button>
              </div>
            ))}
          </div>
          {current && (
            <section className="case-inspector">
              <div className="inspector-top">
                <Badge value={current.priority} />
                <span className="subtle">
                  {current.origin === "ai"
                    ? "AI generated"
                    : current.origin === "demo-authored"
                      ? "Authored demo example"
                      : "Authored scenario"}
                </span>
              </div>
              <h2>{current.title}</h2>
              <p className="preconditions">
                {current.definition.preconditions}
              </p>
              <div className="case-meta">
                <span>
                  Login role <b>{current.definition.roleRef || "Signed out"}</b>
                </span>
                <span>
                  Sources <b>{current.source_ids.length} requirements</b>
                </span>
                <span>
                  Revision <b>{current.version}</b>
                </span>
              </div>
              <ol className="test-steps">
                {current.definition.steps.map((s: Data, i: number) => (
                  <li
                    key={i}
                    className={s.op.startsWith("assert") ? "assertion" : ""}
                  >
                    <span className="step-number">{i + 1}</span>
                    <div>
                      <strong>{s.op.replace(/([A-Z])/g, " $1")}</strong>
                      <p>
                        {s.target?.value || s.path || "Current page"}
                        {s.value !== null && (
                          <span className="expected-value">
                            {s.value || "(empty)"}
                          </span>
                        )}
                      </p>
                    </div>
                    {s.op.startsWith("assert") && <ShieldCheck size={17} />}
                  </li>
                ))}
              </ol>
              <div className="inspector-actions">
                <Button
                  disabled={busy || !writable || current.status === "approved"}
                  onClick={() =>
                    act(
                      () =>
                        api(
                          "/case-versions/" + current.id + "/approvals",
                          "POST",
                          { hash: current.hash },
                        ),
                      "Scenario approved",
                    )
                  }
                >
                  <Check size={16} />
                  Approve version {current.version}
                </Button>
                <Button
                  kind="secondary"
                  disabled={!writable}
                  onClick={() => {
                    setEditing(true);
                    setJson(JSON.stringify(current.definition, null, 2));
                  }}
                >
                  Edit
                </Button>
                <button
                  className="text-button"
                  disabled={!writable}
                  onClick={() =>
                    act(
                      () =>
                        api(
                          "/case-versions/" + current.id + "/review",
                          "POST",
                          { status: "rejected" },
                        ),
                      "Scenario rejected",
                    )
                  }
                >
                  Reject
                </button>
              </div>
              <div className="inspector-footer">
                <button
                  className="text-button"
                  onClick={async () =>
                    setHistory(
                      await api("/cases/" + current.case_id + "/history"),
                    )
                  }
                >
                  Version history
                </button>
                <button
                  className="text-button danger"
                  disabled={!writable}
                  onClick={() =>
                    act(
                      () =>
                        api("/cases/" + current.case_id + "/archive", "POST", {
                          archived: true,
                        }),
                      "Scenario archived",
                    )
                  }
                >
                  Archive
                </button>
              </div>
              {history && (
                <div className="version-history">
                  {history.map((v: Data) => (
                    <details key={v.id}>
                      <summary>
                        Version {v.version} · {v.status} · {date(v.created_at)}
                      </summary>
                      <pre>{JSON.stringify(v.definition, null, 2)}</pre>
                    </details>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
      {(editing || newCase) && (
        <Modal
          title={newCase ? "Add a scenario" : "Edit scenario definition"}
          close={() => {
            setEditing(false);
            setNewCase(false);
          }}
        >
          <p className="hint">
            Use the restricted JSON action schema. Saving creates a new draft
            version that must be approved again.
          </p>
          <label className="field">
            Definition
            <textarea
              className="code-editor"
              rows={20}
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
          </label>
          <Button
            disabled={busy}
            onClick={async () => {
              const r = await act(
                () =>
                  newCase
                    ? api(
                        "/projects/" + projectId + "/cases",
                        "POST",
                        JSON.parse(json),
                      )
                    : api("/cases/" + current.case_id, "PATCH", {
                        definition: JSON.parse(json),
                        expectedVersion: current.version,
                      }),
                "Draft version saved",
              );
              if (r) {
                setEditing(false);
                setNewCase(false);
              }
            }}
          >
            Save draft
          </Button>
        </Modal>
      )}
    </>
  );
}
function Runs({ rev }: Data) {
  const { data } = useData("/runs", rev, true);
  return (
    <>
      <Heading
        title="Regression history"
        subtitle="Every run keeps its approved scenarios, attempts, and evidence."
      />
      {data ? <RunTable runs={data} /> : <Loading />}
    </>
  );
}
function RunDetail({ id, rev, act, busy, user }: Data) {
  const { data, error } = useData("/runs/" + id, rev, true);
  const [focus, setFocus] = useState(""),
    [onlyFailed, setOnlyFailed] = useState(false);
  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <Loading />;
  const r = data.run,
    terminal = ["completed", "errored", "cancelled"].includes(r.state);
  const passed = data.cases.filter((c: Data) => c.outcome === "passed").length,
    failed = data.cases.filter((c: Data) => c.outcome === "failed").length,
    finished = data.cases.filter((c: Data) => c.state === "completed").length;
  const shown = onlyFailed
    ? data.cases.filter((c: Data) => c.outcome && c.outcome !== "passed")
    : data.cases;
  const current =
    data.cases.find((c: Data) => c.id === focus) ||
    shown.find((c: Data) => c.outcome === "failed") ||
    shown[0];
  const attempts = data.attempts.filter(
    (a: Data) => a.run_case_id === current?.id,
  );
  async function rerun() {
    const out = await act(
      () =>
        api("/runs", "POST", {
          projectId: r.project_id,
          environmentId: r.environment_id,
          versionIds: r.manifest.cases.map((c: Data) => c.id),
          trace: r.manifest.trace,
        }),
      "Rerun queued",
    );
    if (out) location.hash = "runs/" + out.runId;
  }
  return (
    <>
      <a href="#runs" className="back-link">
        Regression history <ChevronRight size={14} />
      </a>
      <Heading
        title={"Run " + id.slice(0, 8)}
        subtitle={date(r.created_at) + " · " + r.trigger + " trigger"}
        action={
          <div className="inline-actions">
            <a
              className="button secondary"
              href={"/api/v1/runs/" + id + "/export?format=html"}
            >
              <FileText size={16} />
              Export report
            </a>
            {terminal ? (
              <Button onClick={rerun} disabled={busy || user.role === "viewer"}>
                <RefreshCw size={16} />
                Run again
              </Button>
            ) : (
              <Button
                kind="secondary"
                onClick={() =>
                  act(
                    () => api("/runs/" + id + "/cancellation", "POST", {}),
                    "Cancellation requested",
                  )
                }
                disabled={busy || user.role === "viewer"}
              >
                <Square size={14} />
                Cancel run
              </Button>
            )}
          </div>
        }
      />
      <div className="run-summary">
        <div className="run-verdict">
          <span className={"verdict-icon " + r.verdict}>
            {r.verdict === "passed" ? (
              <CheckCircle2 size={32} />
            ) : r.verdict === "failed" ? (
              <XCircle size={32} />
            ) : (
              <Activity size={32} />
            )}
          </span>
          <div>
            <h2>
              {r.verdict === "pending"
                ? "Regression in progress"
                : r.verdict === "passed"
                  ? "All selected scenarios passed"
                  : r.verdict === "failed"
                    ? "Regression found failures"
                    : "Results need investigation"}
            </h2>
            <span>
              <Badge value={r.state} /> <Badge value={r.verdict} />
            </span>
          </div>
        </div>
        <div className="run-counts">
          <div>
            <strong>{passed}</strong>
            <span>Passed</span>
          </div>
          <div>
            <strong className="error-text">{failed}</strong>
            <span>Failed</span>
          </div>
          <div>
            <strong>
              {finished}/{data.cases.length}
            </strong>
            <span>Completed</span>
          </div>
        </div>
      </div>
      <div className="case-ribbon" aria-label="Scenario outcomes">
        {data.cases.map((c: Data) => (
          <button
            key={c.id}
            title={c.title + ": " + (c.outcome || c.state)}
            className={c.outcome || c.state}
            onClick={() => setFocus(c.id)}
            aria-label={c.title}
          />
        ))}
      </div>
      <div className="run-context">
        <span>
          Build identity <Badge value={r.build_status} />
        </span>
        <span>{r.build_before?.id || "Not configured"}</span>
        <span>Chromium · 1280 × 800</span>
        <span>Selected-suite coverage only</span>
      </div>
      {r.error && <div className="error-box">{r.error}</div>}
      <div className="section-title">
        <h2>Execution evidence</h2>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={onlyFailed}
            onChange={(e) => setOnlyFailed(e.target.checked)}
          />
          Show issues only
        </label>
      </div>
      <div className="scenario-workbench run-workbench">
        <div className="scenario-list">
          {shown.map((c: Data) => (
            <button
              className={
                "run-case-row " + (current?.id === c.id ? "selected" : "")
              }
              key={c.id}
              onClick={() => setFocus(c.id)}
            >
              {c.outcome === "passed" ? (
                <CheckCircle2 className="success-text" size={18} />
              ) : c.outcome === "failed" ? (
                <XCircle className="error-text" size={18} />
              ) : c.state === "running" ? (
                <Loader2 size={18} className="spin" />
              ) : (
                <Clock size={18} />
              )}
              <span>
                {c.title}
                <small>{c.outcome || c.state}</small>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
          {!shown.length && <p className="padded muted">No issues to show.</p>}
        </div>
        <section className="case-inspector">
          {current ? (
            <>
              <h2>{current.title}</h2>
              {!attempts.length && (
                <p className="muted">
                  {terminal
                    ? "No browser attempt was completed."
                    : "Waiting for a browser slot."}
                </p>
              )}
              {attempts.map((a: Data) => (
                <div className="attempt" key={a.id}>
                  <div className="section-title">
                    <b>Attempt {a.number}</b>
                    <span>
                      <Badge value={a.state} /> {duration(a.duration_ms)}
                    </span>
                  </div>
                  <small className="muted">
                    {a.assertions} assertions reached · Cleanup{" "}
                    {a.cleanup_ok === null
                      ? "pending"
                      : a.cleanup_ok
                        ? "complete"
                        : "incomplete"}
                  </small>
                  {a.error && <pre className="failure-message">{a.error}</pre>}
                  <ol className="test-steps">
                    {a.steps.map((s: Data, i: number) => (
                      <li
                        key={i}
                        className={s.state === "failed" ? "failed-step" : ""}
                      >
                        <span className="step-number">{i + 1}</span>
                        <div>
                          <strong>{s.op}</strong>
                          <p>{s.expected}</p>
                        </div>
                        {s.state === "passed" ? (
                          <Check size={16} />
                        ) : (
                          <X size={16} />
                        )}
                      </li>
                    ))}
                  </ol>
                  {data.artifacts
                    .filter((f: Data) => f.attempt_id === a.id && !f.deleted_at)
                    .map((f: Data) =>
                      f.kind === "screenshot" ? (
                        <a
                          key={f.id}
                          href={"/api/v1/artifacts/" + f.id + "/content"}
                          target="_blank"
                          rel="noreferrer"
                          className="evidence-image"
                        >
                          <img
                            src={"/api/v1/artifacts/" + f.id + "/content"}
                            alt={"Browser evidence for " + current.title}
                          />
                          <span>
                            Open browser screenshot <ArrowUpRight size={14} />
                          </span>
                        </a>
                      ) : (
                        <a
                          key={f.id}
                          className="button secondary"
                          href={"/api/v1/artifacts/" + f.id + "/content"}
                        >
                          Download Playwright trace
                        </a>
                      ),
                    )}
                </div>
              ))}
            </>
          ) : (
            <p className="muted">Select a scenario to inspect its evidence.</p>
          )}
        </section>
      </div>
      <details className="event-log">
        <summary>Run event timeline</summary>
        {[...data.events].reverse().map((e: Data) => (
          <div key={e.seq}>
            <time>{date(e.created_at)}</time>
            <b>{e.type}</b>
            <span>
              {e.payload.outcome || e.payload.title || e.payload.verdict || ""}
            </span>
          </div>
        ))}
      </details>
    </>
  );
}
function Changes({ projectId, rev, act, busy, user }: Data) {
  const { data } = useData(projectId ? "/projects/" + projectId : null, rev);
  if (!projectId)
    return (
      <Empty icon={GitBranch} title="Connect a project to compare changes" />
    );
  if (!data) return <Loading />;
  return (
    <>
      <Heading
        title="Change analysis"
        subtitle="Connect code changes to the scenarios that need attention."
      />
      <div className="integration-label">
        <GitBranch size={18} />
        <strong>Local Git</strong>
        <span>GitHub App integration is not configured</span>
      </div>
      <div className="two-columns align-start">
        <section className="form-panel">
          <h2>Repository connection</h2>
          <p className="hint">
            Read commit metadata and changed paths. Application code is not
            executed.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const b = Object.fromEntries(new FormData(e.currentTarget));
              await act(
                () =>
                  api("/projects/" + projectId + "/repository", "POST", {
                    path: b.path,
                    modulePaths: JSON.parse(String(b.modulePaths)),
                  }),
                "Local repository connected",
              );
            }}
          >
            <Field
              label="Repository directory"
              name="path"
              value={data.project.repo_path || ""}
              placeholder="/Users/you/projects/customer-portal"
            />
            <label className="field">
              Module path mappings
              <textarea
                name="modulePaths"
                rows={5}
                defaultValue={JSON.stringify(
                  data.project.module_paths,
                  null,
                  2,
                )}
              />
            </label>
            <p className="hint">
              Map scenario modules to file prefixes, for example{" "}
              {JSON.stringify({ Profile: "src/profile/" })}. Unknown or shared
              changes select the full suite.
            </p>
            <Button
              type="submit"
              kind="secondary"
              disabled={busy || user.role !== "owner"}
            >
              Save connection
            </Button>
          </form>
        </section>
        <section className="form-panel">
          <h2>Compare revisions</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await act(
                () =>
                  api(
                    "/projects/" + projectId + "/changes",
                    "POST",
                    Object.fromEntries(new FormData(e.currentTarget)),
                  ),
                "Change analysis complete",
              );
            }}
          >
            <Field label="Base revision" name="base" value="HEAD~1" />
            <Field label="Head revision" name="head" value="HEAD" />
            <Button
              type="submit"
              disabled={
                busy || !data.project.repo_path || user.role === "viewer"
              }
            >
              Analyze changes
            </Button>
          </form>
        </section>
      </div>
      <div className="section-title">
        <h2>Change history</h2>
      </div>
      {data.changes.length ? (
        data.changes.map((c: Data) => (
          <section className="change-result" key={c.id}>
            <div className="section-title">
              <b>
                {c.base_sha.slice(0, 8)} → {c.head_sha.slice(0, 8)}
              </b>
              <span>{date(c.created_at)}</span>
            </div>
            <p>{c.reason}</p>
            <div className="file-list">
              {c.files.map((f: string) => (
                <div key={f}>
                  <FileText size={15} />
                  {f}
                </div>
              ))}
              {!c.files.length && <p>No changed files.</p>}
            </div>
            <div className="inline-actions">
              <span>{c.selection.length} suggested scenarios</span>
              <Button
                kind="secondary"
                disabled={busy || !c.selection.length || user.role === "viewer"}
                onClick={async () => {
                  const r = await act(
                    () =>
                      api("/runs", "POST", {
                        projectId,
                        environmentId: data.environments[0].id,
                        versionIds: c.selection,
                      }),
                    "Selected regression queued",
                  );
                  if (r) location.hash = "runs/" + r.runId;
                }}
              >
                Run suggested scenarios
              </Button>
            </div>
          </section>
        ))
      ) : (
        <Empty icon={GitBranch} title="No comparisons yet">
          Connect a repository and compare two commits.
        </Empty>
      )}
    </>
  );
}
function Schedules({ projectId, rev, act, busy, user }: Data) {
  const { data } = useData(projectId ? "/projects/" + projectId : null, rev);
  const all = useData("/schedules", rev, true).data;
  if (!projectId)
    return (
      <Empty icon={Clock} title="Connect a project to schedule regression" />
    );
  if (!data || !all) return <Loading />;
  const approved = data.cases.filter(
    (c: Data) => c.status === "approved" && !c.archived,
  );
  return (
    <>
      <Heading
        title="Scheduled regression"
        subtitle="Keep a regular check on your approved workflows."
      />
      <div className="info-banner">
        <Clock size={19} />
        <span>
          Your computer and the local app must remain running. Missed runs are
          skipped and recorded.
        </span>
      </div>
      <div className="two-columns align-start">
        <section className="form-panel">
          <h2>Save a regression suite</h2>
          <p>
            {approved.length} current approved scenarios are available in this
            project.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const b = Object.fromEntries(new FormData(e.currentTarget));
              await act(
                () =>
                  api("/suites", "POST", {
                    projectId,
                    name: b.name,
                    versionIds: approved.map((c: Data) => c.id),
                  }),
                "Suite saved with immutable scenario versions",
              );
            }}
          >
            <Field
              label="Suite name"
              name="name"
              placeholder="Release regression"
            />
            <Button
              type="submit"
              kind="secondary"
              disabled={busy || !approved.length || user.role === "viewer"}
            >
              Save approved suite
            </Button>
          </form>
          <p className="hint">
            When scenarios change, save a new suite. Schedules will not silently
            adopt unreviewed changes.
          </p>
        </section>
        <section className="form-panel">
          <h2>Create schedule</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const b = Object.fromEntries(new FormData(e.currentTarget));
              await act(
                () =>
                  api("/schedules", "POST", {
                    ...b,
                    projectId,
                    environmentId: data.environments[0].id,
                  }),
                "Schedule created",
              );
            }}
          >
            <Field
              label="Schedule name"
              name="name"
              placeholder="Morning regression"
            />
            <label className="field">
              Approved suite
              <select name="suiteId" required>
                {data.suites.map((s: Data) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.version_ids.length} cases
                  </option>
                ))}
              </select>
            </label>
            <div className="two-columns">
              <Field label="Cron expression" name="cron" value="0 9 * * 1-5" />
              <Field label="Timezone" name="timezone" value="Asia/Kolkata" />
            </div>
            <p className="hint">
              Default: 9:00 AM, Monday through Friday. For a demo, */5 * * * *
              runs every five minutes.
            </p>
            <Button
              type="submit"
              disabled={busy || !data.suites.length || user.role === "viewer"}
            >
              Create schedule
            </Button>
          </form>
        </section>
      </div>
      <div className="section-title">
        <h2>Schedules</h2>
      </div>
      {data.schedules.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Recurrence</th>
                <th>Next run</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.schedules.map((s: Data) => (
                <tr key={s.id}>
                  <td>
                    <b>{s.name}</b>
                    <small>{s.timezone}</small>
                  </td>
                  <td>{s.cron}</td>
                  <td>{date(s.next_fire)}</td>
                  <td>
                    <Badge value={s.enabled ? "active" : "paused"} />
                  </td>
                  <td>
                    <button
                      className="text-button"
                      disabled={user.role === "viewer"}
                      onClick={() =>
                        act(
                          () =>
                            api("/schedules/" + s.id, "PATCH", {
                              enabled: !s.enabled,
                            }),
                          s.enabled ? "Schedule paused" : "Schedule resumed",
                        )
                      }
                    >
                      {s.enabled ? "Pause" : "Resume"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon={Clock} title="No schedules yet">
          Create a suite and choose when it should run.
        </Empty>
      )}
      <details className="event-log">
        <summary>Recent schedule events</summary>
        {all.fires.map((f: Data) => (
          <div key={f.id}>
            <time>{date(f.scheduled_at)}</time>
            <Badge value={f.state} />
            <span>{f.reason || ""}</span>
            {f.run_id && <a href={"#runs/" + f.run_id}>Open run</a>}
          </div>
        ))}
      </details>
    </>
  );
}
function Settings({ rev, act, busy, health, user }: Data) {
  const { data } = useData("/usage", rev),
    members = useData(user.role === "owner" ? "/members" : null, rev).data;
  const [tab, setTab] = useState("runtime");
  if (!data) return <Loading />;
  return (
    <>
      <Heading
        title="Workspace settings"
        subtitle="Manage local services, access, and usage."
      />
      <div className="tabs">
        {[
          "runtime",
          "plans & usage",
          ...(user.role === "owner" ? ["members"] : []),
        ].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "runtime" && (
        <>
          <section className="form-panel">
            <div className="section-title">
              <div className="inline-actions">
                <Sparkles size={23} />
                <h2>Codex connection</h2>
              </div>
              <Badge
                value={
                  health?.provider?.authenticated ? "signed_in" : "unavailable"
                }
              />
            </div>
            <p>
              The app uses the locally installed Codex CLI and your saved login.
              AI requests require internet and available account quota.
            </p>
            <dl className="details-list">
              <div>
                <dt>Installed version</dt>
                <dd>{health?.provider?.version || "Unavailable"}</dd>
              </div>
              <div>
                <dt>Inference verified</dt>
                <dd>
                  {health?.inferenceVerified
                    ? date(health.inferenceVerified)
                    : "Not yet verified"}
                </dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{health?.provider?.model || "CLI default"}</dd>
              </div>
              <div>
                <dt>Browser worker</dt>
                <dd>
                  {health?.worker?.healthy
                    ? "Ready · two execution slots"
                    : "Unavailable"}
                </dd>
              </div>
              <div>
                <dt>Database</dt>
                <dd>{health?.database || "Checking"}</dd>
              </div>
            </dl>
            <Button
              kind="secondary"
              disabled={busy || user.role !== "owner"}
              onClick={() =>
                act(
                  () => api("/provider/check", "POST", {}),
                  "Inference connection verified",
                )
              }
            >
              <RefreshCw size={16} />
              Verify AI connection
            </Button>
          </section>
          <div className="info-banner">
            <ShieldCheck size={19} />
            <span>
              This installation is for local development. Hosted deployment
              requires product inference access, production identity, and
              commercial integration configuration.
            </span>
          </div>
        </>
      )}
      {tab === "plans & usage" && (
        <>
          <div className="billing-banner">
            <FlaskConical size={25} />
            <div>
              <h2>Billing demonstration</h2>
              <p>
                No money is charged. Plans and usage limits are enforced
                locally; payment state changes are simulated.
              </p>
            </div>
            <Badge value="demo" />
          </div>
          <div className="usage-grid">
            {Object.entries(data.limits)
              .filter(([k]) =>
                ["browserMinutes", "aiRequests", "storageBytes"].includes(k),
              )
              .map(([k, limit]: [string, any]) => {
                const used =
                    data.usage.find((v: Data) => v.metric === k)?.amount || 0,
                  reserved =
                    data.reserved.find((v: Data) => v.metric === k)?.amount ||
                    0;
                return (
                  <section key={k} className="usage-item">
                    <h3>
                      {k === "browserMinutes"
                        ? "Browser minutes"
                        : k === "aiRequests"
                          ? "AI requests"
                          : "Artifact storage"}
                    </h3>
                    <strong>
                      {k === "storageBytes"
                        ? (used / 1024 ** 2).toFixed(1) + " MB"
                        : Number(used).toFixed(k === "browserMinutes" ? 1 : 0)}
                    </strong>
                    <span>
                      of{" "}
                      {k === "storageBytes" ? limit / 1024 ** 3 + " GB" : limit}{" "}
                      this month
                    </span>
                    <progress max={limit} value={used} />
                    {reserved > 0 && (
                      <small>{reserved} reserved for queued work</small>
                    )}
                  </section>
                );
              })}
          </div>
          <section className="form-panel">
            <h2>Simulate subscription changes</h2>
            <form
              className="inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                await act(
                  () =>
                    api(
                      "/billing/simulations",
                      "POST",
                      Object.fromEntries(new FormData(e.currentTarget)),
                    ),
                  "Demo subscription updated; no payment made",
                );
              }}
            >
              <label className="field">
                Plan
                <select name="plan" defaultValue={data.subscription.plan}>
                  <option value="starter">Starter · 2 projects</option>
                  <option value="studio">Studio · 10 projects</option>
                </select>
              </label>
              <label className="field">
                State
                <select name="state" defaultValue={data.subscription.state}>
                  {[
                    "trial",
                    "active",
                    "past_due",
                    "cancel_scheduled",
                    "cancelled",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {s.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" disabled={busy || user.role !== "owner"}>
                Apply simulation
              </Button>
            </form>
          </section>
        </>
      )}
      {tab === "members" && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Email</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {members?.map((m: Data) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{m.email}</td>
                    <td>
                      <Badge value={m.role} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="form-panel">
            <h2>Add a local member</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const r = await act(
                  () =>
                    api(
                      "/members",
                      "POST",
                      Object.fromEntries(new FormData(form)),
                    ),
                  "Local account created",
                );
                if (r) form.reset();
              }}
            >
              <div className="two-columns">
                <Field name="name" label="Name" />
                <Field name="email" label="Email" type="email" />
              </div>
              <div className="two-columns">
                <Field
                  name="password"
                  label="Temporary password (12+ characters)"
                  type="password"
                />
                <label className="field">
                  Role
                  <select name="role">
                    <option value="viewer">Viewer · read only</option>
                    <option value="maintainer">
                      Maintainer · manage testing
                    </option>
                  </select>
                </label>
              </div>
              <p className="hint">
                This creates a local account. It does not send an invitation
                email.
              </p>
              <Button type="submit" disabled={busy}>
                Create member
              </Button>
            </form>
          </section>
        </>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
