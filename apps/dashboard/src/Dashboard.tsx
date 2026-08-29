import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Advisory = {
  id: string;
  aliases?: string[];
  url?: string | null;
  severity: string;
  affectedRange?: string | null;
  fixedVersion: string | null;
};

type Usage = {
  workspaceId: string;
  section: string;
  declared: string;
  resolved: string | null;
  update: {
    type: "major" | "minor" | "patch";
    firstNewerVersion?: string;
    behindSince?: string | null;
    behindDays: number | null;
  } | null;
  deprecation: {
    isDeprecated: boolean;
    message: string | null;
  } | null;
  security: {
    vulnerable: boolean;
    advisories: Advisory[];
  } | null;
};

type Dependency = {
  name: string;
  ecosystem?: "npm";
  latest: string | null;
  usages: Usage[];
  versionMismatch: {
    declared: boolean;
    resolved: boolean;
  };
};

type Summary = {
  externalDependencyCount: number;
  externalUsageCount: number;
  availableUpdateCount: number;
  majorUpdateCount: number;
  routineUpdateCount: number;
  vulnerableUsageCount: number;
  deprecatedUsageCount: number;
  declaredVersionMismatchCount?: number;
  resolvedVersionMismatchCount?: number;
};

type Project = {
  id: string;
  name: string;
  repository?: string | null;
  scan?: {
    status: "success" | "partial" | "failed";
    errors: { stage: string; message: string }[];
  };
  node?: {
    packageManager: "pnpm" | "npm";
    monorepo: boolean;
  } | null;
  workspaces: {
    id: string;
    name: string | null;
    path: string;
    manifestPath?: string;
    version?: string | null;
  }[];
  internalDependencies: {
    fromWorkspaceId: string;
    toWorkspaceId: string;
    declared?: string;
  }[];
  dependencies: Dependency[];
  summary: Summary;
};

type Snapshot = {
  schemaVersion?: number;
  scannedAt: string;
  projects: Project[];
};

type Changes = {
  schemaVersion?: number;
  from?: string | null;
  to?: string;
  baseline: boolean;
  projects: { id: string; events: { type: string }[] }[];
};

type HistoryEntry = {
  date: string;
  scannedAt?: string;
  summary: Summary;
};

type HistoryIndex = {
  schemaVersion?: number;
  projects: Record<string, HistoryEntry[]>;
};

type View =
  | ["home"]
  | ["project" | "workspaces" | "history", string]
  | ["dependency", string, string];

type SortKey = "name" | "resolved" | "latest" | "status" | "workspaces";
type SortOrder = "asc" | "desc";
type FilterMode = "all" | "attention" | "security" | "major" | "routine" | "deprecated" | "mismatch";

export function Dashboard() {
  const [data, setData] = useState<{
    snapshot: Snapshot;
    changes: Changes;
    history: HistoryIndex;
  } | null>(null);
  const [view, setView] = useState<View>(["home"]);
  const [error, setError] = useState<string | null>(null);
  const helpDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    Promise.all([
      get<Snapshot>(dataUrl("current.json")),
      get<Changes>(dataUrl("changes.json")),
      get<HistoryIndex>(dataUrl("history-index.json")),
    ])
      .then(([snapshot, changes, history]) =>
        setData({ snapshot, changes, history }),
      )
      .catch((e) => setError(String(e)));
  }, []);

  const project =
    view[0] === "home"
      ? null
      : data?.snapshot.projects.find((p) => p.id === view[1]) ?? null;

  // Global Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isInputActive = activeTag === "input" || activeTag === "textarea";

      if (e.key === "?" && !isInputActive) {
        e.preventDefault();
        if (helpDialogRef.current?.open) {
          helpDialogRef.current.close();
        } else {
          helpDialogRef.current?.showModal();
        }
        return;
      }

      if (e.key === "Escape") {
        if (helpDialogRef.current?.open) {
          helpDialogRef.current.close();
          return;
        }
        if (view[0] === "dependency" && project) {
          setView(["project", project.id]);
          return;
        }
      }

      if (isInputActive) return;

      if (e.key === "h" || e.key === "0") {
        setView(["home"]);
        return;
      }

      if (project) {
        if (e.key === "1") {
          setView(["project", project.id]);
        } else if (e.key === "2") {
          setView(["workspaces", project.id]);
        } else if (e.key === "3") {
          setView(["history", project.id]);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view, project]);

  if (error) {
    return (
      <main className="state-container">
        <div className="cmd-prompt">
          <span>$ watchtower --status</span>
        </div>
        <p style={{ color: "var(--color-red)", marginTop: "12px" }}>
          [ERROR] Failed to load scan dataset: {error}
        </p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="state-container">
        <div className="cmd-prompt">
          <span>$ watchtower --init</span>
          <span className="cmd-cursor" />
        </div>
        <p className="text-muted" style={{ marginTop: "12px" }}>
          Loading snapshot telemetry…
        </p>
      </main>
    );
  }

  return (
    <main className="shell">
      <Header
        snapshot={data.snapshot}
        project={project}
        view={view}
        setView={setView}
        onOpenHelp={() => helpDialogRef.current?.showModal()}
      />
      {view[0] === "home" && (
        <Home
          snapshot={data.snapshot}
          changes={data.changes}
          setView={setView}
        />
      )}
      {view[0] === "project" && project && (
        <ProjectPage project={project} setView={setView} />
      )}
      {view[0] === "dependency" && project && (
        <DependencyPage
          project={project}
          name={view[2]}
          setView={setView}
        />
      )}
      {view[0] === "workspaces" && project && (
        <Workspaces project={project} setView={setView} />
      )}
      {view[0] === "history" && project && (
        <History project={project} index={data.history} />
      )}

      {/* Modern Dialog for Help & Shortcuts */}
      <dialog
        ref={helpDialogRef}
        className="help-dialog"
        onClick={(e) => {
          if (e.target === helpDialogRef.current) {
            helpDialogRef.current?.close();
          }
        }}
      >
        <div className="term-section-header">
          <h3 className="term-section-title">
            <span className="sec-prefix">$</span> WATCHTOWER SHORTCUTS
          </h3>
          <button
            className="filter-clear-btn"
            onClick={() => helpDialogRef.current?.close()}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>
        <p className="text-muted" style={{ fontSize: "12px", margin: "8px 0" }}>
          Terminal hotkeys for fast keyboard-driven navigation:
        </p>
        <table className="shortcuts-table">
          <tbody>
            <tr>
              <td><span className="kbd-badge">1</span></td>
              <td>Switch to Project Overview</td>
            </tr>
            <tr>
              <td><span className="kbd-badge">2</span></td>
              <td>Switch to Workspaces Tree</td>
            </tr>
            <tr>
              <td><span className="kbd-badge">3</span></td>
              <td>Switch to History Ledger</td>
            </tr>
            <tr>
              <td><span className="kbd-badge">0</span> / <span className="kbd-badge">h</span></td>
              <td>Return to Projects Home</td>
            </tr>
            <tr>
              <td><span className="kbd-badge">/</span></td>
              <td>Focus Search Filter</td>
            </tr>
            <tr>
              <td><span className="kbd-badge">[</span> / <span className="kbd-badge">]</span></td>
              <td>Previous / Next Dependency in Inspection</td>
            </tr>
            <tr>
              <td><span className="kbd-badge">Esc</span></td>
              <td>Go Back or Close Modal</td>
            </tr>
            <tr>
              <td><span className="kbd-badge">?</span></td>
              <td>Toggle This Help Menu</td>
            </tr>
          </tbody>
        </table>
        <div style={{ textAlign: "right", marginTop: "16px" }}>
          <button
            className="term-back-btn"
            onClick={() => helpDialogRef.current?.close()}
          >
            [Close Esc]
          </button>
        </div>
      </dialog>
    </main>
  );
}

function Header({
  snapshot,
  project,
  view,
  setView,
  onOpenHelp,
}: {
  snapshot: Snapshot;
  project: Project | null;
  view: View;
  setView: (v: View) => void;
  onOpenHelp: () => void;
}) {
  const dateStr = new Date(snapshot.scannedAt)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  return (
    <header className="term-header">
      <div className="term-topbar">
        <button
          className="term-brand"
          onClick={() => setView(["home"])}
          aria-label="Watchtower home"
        >
          <span className="prompt-sym">▶</span>
          <span>WATCHTOWER</span>
          <span className="text-dim">v0.1.0</span>
        </button>

        <div className="term-sysinfo">
          <button className="help-btn" onClick={onOpenHelp} title="Keyboard shortcuts (?)">
            <span>[?] SHORTCUTS</span>
          </button>
          <span className="status-dot" />
          <span>SYS_OK</span>
          <span className="text-dim">|</span>
          <span>SCAN: {dateStr} UTC</span>
        </div>
      </div>

      {project && (
        <nav className="term-nav" aria-label="Project Navigation">
          <button
            className={`term-nav-btn ${view[0] === "project" ? "active" : ""}`}
            onClick={() => setView(["project", project.id])}
            aria-label="Overview tab"
          >
            <span className="key-hint">[1]</span>
            <span>OVERVIEW</span>
          </button>
          <button
            className={`term-nav-btn ${view[0] === "workspaces" ? "active" : ""}`}
            onClick={() => setView(["workspaces", project.id])}
            aria-label="Workspaces tab"
          >
            <span className="key-hint">[2]</span>
            <span>WORKSPACES ({project.workspaces.length})</span>
          </button>
          <button
            className={`term-nav-btn ${view[0] === "history" ? "active" : ""}`}
            onClick={() => setView(["history", project.id])}
            aria-label="History tab"
          >
            <span className="key-hint">[3]</span>
            <span>HISTORY</span>
          </button>
        </nav>
      )}
    </header>
  );
}

function Home({
  snapshot,
  changes,
  setView,
}: {
  snapshot: Snapshot;
  changes: Changes;
  setView: (v: View) => void;
}) {
  const eventCount = changes.projects.flatMap((p) => p.events).length;
  const totalPkgs = snapshot.projects.reduce(
    (acc, p) => acc + p.summary.externalDependencyCount,
    0,
  );
  const totalSec = snapshot.projects.reduce(
    (acc, p) => acc + p.summary.vulnerableUsageCount,
    0,
  );
  const totalMaj = snapshot.projects.reduce(
    (acc, p) => acc + p.summary.majorUpdateCount,
    0,
  );
  const totalDep = snapshot.projects.reduce(
    (acc, p) => acc + p.summary.deprecatedUsageCount,
    0,
  );

  return (
    <>
      <div className="cmd-banner">
        <span className="cmd-prompt">
          $ watchtower projects --summary
        </span>
        <span className="cmd-cursor" />
      </div>
      <p className="cmd-subtitle">
        {changes.baseline
          ? "[BASELINE] Initial baseline scan loaded."
          : `[CHANGELOG] ${eventCount} change event${eventCount === 1 ? "" : "s"} recorded since previous snapshot.`}
      </p>

      <div className="metrics-ribbon">
        <div className="metric-cell">
          <span className="metric-label">MONITORED PROJECTS</span>
          <span className="metric-val">{snapshot.projects.length}</span>
        </div>
        <div className="metric-cell">
          <span className="metric-label">EXTERNAL PACKAGES</span>
          <span className="metric-val">{totalPkgs}</span>
        </div>
        <div className={`metric-cell ${totalSec > 0 ? "alert-sec" : ""}`}>
          <span className="metric-label">SECURITY ADVISORIES</span>
          <span className="metric-val">{totalSec}</span>
        </div>
        <div className={`metric-cell ${totalMaj > 0 ? "alert-warn" : ""}`}>
          <span className="metric-label">MAJOR UPDATES</span>
          <span className="metric-val">{totalMaj}</span>
        </div>
        <div className={`metric-cell ${totalDep > 0 ? "alert-warn" : ""}`}>
          <span className="metric-label">DEPRECATED</span>
          <span className="metric-val">{totalDep}</span>
        </div>
      </div>

      <div className="term-section">
        <div className="term-section-header">
          <h2 className="term-section-title">
            <span className="sec-prefix">&gt;</span> TARGET PROJECTS
          </h2>
          <span className="term-section-note">
            Select a project to inspect dependency graph & audit report
          </span>
        </div>

        <div className="projects-grid">
          {snapshot.projects.map((p) => {
            const hasSec = p.summary.vulnerableUsageCount > 0;
            const hasMaj = p.summary.majorUpdateCount > 0;
            const hasDep = p.summary.deprecatedUsageCount > 0;

            return (
              <div
                key={p.id}
                className="project-row-card"
                onClick={() => setView(["project", p.id])}
                role="button"
                tabIndex={0}
                aria-label={`Open project ${p.name}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setView(["project", p.id]);
                  }
                }}
              >
                <div className="project-row-name">
                  <strong>
                    <span className="row-arrow">›</span> {p.name}
                  </strong>
                  <small>
                    {p.node?.packageManager ?? "npm"}{" "}
                    {p.node?.monorepo ? "monorepo" : "standalone"} ·{" "}
                    {p.workspaces.length} workspace
                    {p.workspaces.length === 1 ? "" : "s"}
                  </small>
                </div>

                <div className="project-row-stats">
                  <span className={`stat-flag ${hasSec ? "has-sec" : ""}`}>
                    SEC: {p.summary.vulnerableUsageCount}
                  </span>
                  <span className={`stat-flag ${hasMaj ? "has-maj" : ""}`}>
                    MAJ: {p.summary.majorUpdateCount}
                  </span>
                  <span className="stat-flag">
                    ROUTINE: {p.summary.routineUpdateCount}
                  </span>
                  <span className={`stat-flag ${hasDep ? "has-dep" : ""}`}>
                    DEP: {p.summary.deprecatedUsageCount}
                  </span>
                  {(p.summary.declaredVersionMismatchCount ||
                    p.summary.resolvedVersionMismatchCount) ? (
                    <span className="badge badge-mismatch">
                      MISMATCH: {p.summary.declaredVersionMismatchCount ?? 0}/
                      {p.summary.resolvedVersionMismatchCount ?? 0}
                    </span>
                  ) : null}
                </div>

                <div style={{ textAlign: "right" }}>
                  <span className="text-secondary" style={{ fontSize: "12px" }}>
                    {p.summary.externalDependencyCount} packages
                  </span>
                  <span className="row-arrow" style={{ marginLeft: "8px" }}>
                    →
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function ProjectPage({
  project,
  setView,
}: {
  project: Project;
  setView: (v: View) => void;
}) {
  const [filterText, setFilterText] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut '/' to focus search input
  useEffect(() => {
    const handleSlash = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleSlash);
    return () => window.removeEventListener("keydown", handleSlash);
  }, []);

  const attention = useMemo(
    () => project.dependencies.filter((d) => hasAttention(d)),
    [project.dependencies],
  );
  const routine = useMemo(
    () => project.dependencies.filter((d) => d.usages.some(isRoutine)),
    [project.dependencies],
  );
  const mismatches = useMemo(
    () =>
      project.dependencies.filter(
        (d) => d.versionMismatch.declared || d.versionMismatch.resolved,
      ),
    [project.dependencies],
  );

  return (
    <>
      <div className="cmd-banner">
        <span className="cmd-prompt">
          $ watchtower audit --project={project.id}
        </span>
        <span className="cmd-cursor" />
      </div>
      <p className="cmd-subtitle">
        {project.name} · {project.node?.packageManager ?? "npm"}{" "}
        {project.node?.monorepo ? "monorepo" : "package"} ·{" "}
        {project.workspaces.length} workspaces · {project.summary.externalUsageCount}{" "}
        usages
      </p>

      {/* Quick Filter Chips Ribbon */}
      <div className="filter-chips-ribbon" role="toolbar" aria-label="Filter dependencies by category">
        <span className="filter-chips-label">FILTER:</span>
        <button
          className={`filter-chip-btn ${filterMode === "all" ? "active" : ""}`}
          onClick={() => setFilterMode("all")}
          aria-pressed={filterMode === "all"}
        >
          ALL ({project.dependencies.length})
        </button>
        <button
          className={`filter-chip-btn ${filterMode === "attention" ? "active" : ""}`}
          onClick={() => setFilterMode("attention")}
          aria-pressed={filterMode === "attention"}
        >
          ATTENTION ({attention.length})
        </button>
        <button
          className={`filter-chip-btn ${filterMode === "security" ? "active" : ""}`}
          onClick={() => setFilterMode("security")}
          aria-pressed={filterMode === "security"}
          style={{ color: project.summary.vulnerableUsageCount > 0 ? "var(--color-red)" : undefined }}
        >
          SECURITY ({project.summary.vulnerableUsageCount})
        </button>
        <button
          className={`filter-chip-btn ${filterMode === "major" ? "active" : ""}`}
          onClick={() => setFilterMode("major")}
          aria-pressed={filterMode === "major"}
          style={{ color: project.summary.majorUpdateCount > 0 ? "var(--color-amber)" : undefined }}
        >
          MAJOR ({project.summary.majorUpdateCount})
        </button>
        <button
          className={`filter-chip-btn ${filterMode === "routine" ? "active" : ""}`}
          onClick={() => setFilterMode("routine")}
          aria-pressed={filterMode === "routine"}
        >
          ROUTINE ({routine.length})
        </button>
        <button
          className={`filter-chip-btn ${filterMode === "deprecated" ? "active" : ""}`}
          onClick={() => setFilterMode("deprecated")}
          aria-pressed={filterMode === "deprecated"}
          style={{ color: project.summary.deprecatedUsageCount > 0 ? "#fb923c" : undefined }}
        >
          DEPRECATED ({project.summary.deprecatedUsageCount})
        </button>
        <button
          className={`filter-chip-btn ${filterMode === "mismatch" ? "active" : ""}`}
          onClick={() => setFilterMode("mismatch")}
          aria-pressed={filterMode === "mismatch"}
          style={{ color: mismatches.length > 0 ? "var(--color-purple)" : undefined }}
        >
          MISMATCHES ({mismatches.length})
        </button>
      </div>

      {filterMode === "all" && !filterText ? (
        <>
          <Section
            title="Needs Attention"
            prefix="[!]"
            note="Security advisories, deprecations, major version jumps, and version mismatches."
          >
            <AttentionDependenciesTable
              project={project}
              dependencies={attention}
              setView={setView}
            />
          </Section>

          <Section
            title="Routine Updates"
            prefix="[~]"
            note="Minor and patch updates with no reported vulnerabilities."
          >
            <RoutineDependenciesTable
              project={project}
              dependencies={routine}
              setView={setView}
            />
          </Section>

          <Section
            title="All Dependencies"
            prefix="[*]"
            note={`${project.summary.externalDependencyCount} external packages in dependency graph (${project.summary.availableUpdateCount} updates available).`}
          >
            <AllDependenciesTable
              project={project}
              dependencies={project.dependencies}
              setView={setView}
              filterText={filterText}
              setFilterText={setFilterText}
              filterMode={filterMode}
              searchInputRef={searchInputRef}
            />
          </Section>
        </>
      ) : (
        <Section
          title={
            filterMode === "attention"
              ? "Needs Attention Filter"
              : filterMode === "security"
                ? "Security Advisories Filter"
                : filterMode === "major"
                  ? "Major Updates Filter"
                  : filterMode === "routine"
                    ? "Routine Updates Filter"
                    : filterMode === "deprecated"
                      ? "Deprecated Packages Filter"
                      : filterMode === "mismatch"
                        ? "Version Mismatches Filter"
                        : "Filtered Dependencies"
          }
          prefix="[*]"
          note="Showing filtered subset of dependency inventory."
        >
          <AllDependenciesTable
            project={project}
            dependencies={project.dependencies}
            setView={setView}
            filterText={filterText}
            setFilterText={setFilterText}
            filterMode={filterMode}
            searchInputRef={searchInputRef}
          />
        </Section>
      )}
    </>
  );
}

function AttentionDependenciesTable({
  project,
  dependencies,
  setView,
}: {
  project: Project;
  dependencies: Dependency[];
  setView: (v: View) => void;
}) {
  if (dependencies.length === 0) {
    return (
      <div className="empty-state">
        <span className="badge badge-ok">[OK]</span> No items requiring
        attention in this snapshot.
      </div>
    );
  }

  return (
    <div className="table-wrapper">
      <table className="term-table" aria-label="Dependencies requiring attention">
        <thead>
          <tr>
            <th style={{ width: "160px" }}>STATUS</th>
            <th>PACKAGE</th>
            <th>RESOLVED</th>
            <th>TARGET</th>
            <th>WORKSPACES</th>
            <th>AUDIT SUMMARY</th>
          </tr>
        </thead>
        <tbody>
          {dependencies.map((d) => {
            const hasSec = d.usages.some((u) => u.security?.vulnerable);
            const hasDep = d.usages.some((u) => u.deprecation?.isDeprecated);
            const hasMaj = d.usages.some((u) => u.update?.type === "major");
            const hasMis =
              d.versionMismatch.declared || d.versionMismatch.resolved;

            const resolvedList = [
              ...new Set(
                d.usages.map((u) => u.resolved).filter(Boolean) as string[],
              ),
            ];
            const resolvedStr = resolvedList.length
              ? resolvedList.join(", ")
              : "unresolved";

            const secUsage = d.usages.find((u) => u.security?.vulnerable);
            const depUsage = d.usages.find((u) => u.deprecation?.isDeprecated);
            const majUsage = d.usages.find((u) => u.update?.type === "major");

            return (
              <tr
                key={d.name}
                className="clickable-row"
                onClick={() => setView(["dependency", project.id, d.name])}
                tabIndex={0}
                aria-label={`Inspect ${d.name}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setView(["dependency", project.id, d.name]);
                  }
                }}
              >
                <td>
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    {hasSec && <span className="badge badge-sec">SECURITY</span>}
                    {hasDep && <span className="badge badge-dep">DEPRECATED</span>}
                    {hasMaj && !hasSec && (
                      <span className="badge badge-major">MAJOR</span>
                    )}
                    {hasMis && !hasSec && (
                      <span className="badge badge-mismatch">MISMATCH</span>
                    )}
                  </div>
                </td>
                <td>
                  <div className="row-pkg-name">
                    <span className="row-arrow">›</span>
                    <span>{d.name}</span>
                    <CopyButton text={d.name} />
                  </div>
                </td>
                <td className="version-current">{resolvedStr}</td>
                <td className="version-target">
                  {secUsage?.security?.advisories[0]?.fixedVersion ? (
                    <span className="badge badge-sec">
                      fix: {secUsage.security.advisories[0].fixedVersion}
                    </span>
                  ) : (
                    d.latest ?? "—"
                  )}
                </td>
                <td className="text-muted">
                  {d.usages.map((u) => u.workspaceId).join(", ")}
                </td>
                <td style={{ fontSize: "11px" }}>
                  {hasSec && secUsage?.security ? (
                    <span style={{ color: "var(--color-red)" }}>
                      {secUsage.security.advisories.map((a) => a.id).join(", ")}
                    </span>
                  ) : hasDep && depUsage?.deprecation?.message ? (
                    <span style={{ color: "var(--color-amber)" }}>
                      {depUsage.deprecation.message.slice(0, 60)}
                      {depUsage.deprecation.message.length > 60 ? "…" : ""}
                    </span>
                  ) : hasMaj && majUsage?.update ? (
                    <span className="text-secondary">
                      major upgrade {majUsage.resolved ?? "?"} →{" "}
                      {d.latest ?? "?"}
                    </span>
                  ) : hasMis ? (
                    <span style={{ color: "var(--color-purple)" }}>
                      {d.versionMismatch.declared && "declared mismatch "}
                      {d.versionMismatch.resolved && "resolved mismatch"}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RoutineDependenciesTable({
  project,
  dependencies,
  setView,
}: {
  project: Project;
  dependencies: Dependency[];
  setView: (v: View) => void;
}) {
  if (dependencies.length === 0) {
    return (
      <div className="empty-state">
        <span className="badge badge-ok">[OK]</span> No routine updates pending.
      </div>
    );
  }

  return (
    <div className="table-wrapper">
      <table className="term-table" aria-label="Routine dependency updates">
        <thead>
          <tr>
            <th style={{ width: "100px" }}>TYPE</th>
            <th>PACKAGE</th>
            <th>RESOLVED</th>
            <th>LATEST</th>
            <th>BEHIND</th>
            <th>WORKSPACES</th>
          </tr>
        </thead>
        <tbody>
          {dependencies.map((d) => {
            const usageWithUpdate = d.usages.find((u) => u.update);
            const updateType = usageWithUpdate?.update?.type ?? "patch";
            const behindDays = usageWithUpdate?.update?.behindDays;

            const resolvedList = [
              ...new Set(
                d.usages.map((u) => u.resolved).filter(Boolean) as string[],
              ),
            ];
            const resolvedStr = resolvedList.length
              ? resolvedList.join(", ")
              : "unresolved";

            return (
              <tr
                key={d.name}
                className="clickable-row"
                onClick={() => setView(["dependency", project.id, d.name])}
                tabIndex={0}
                aria-label={`Inspect ${d.name}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setView(["dependency", project.id, d.name]);
                  }
                }}
              >
                <td>
                  <span
                    className={`badge ${updateType === "minor" ? "badge-minor" : "badge-patch"}`}
                  >
                    {updateType}
                  </span>
                </td>
                <td>
                  <div className="row-pkg-name">
                    <span className="row-arrow">›</span>
                    <span>{d.name}</span>
                    <CopyButton text={d.name} />
                  </div>
                </td>
                <td className="version-current">{resolvedStr}</td>
                <td className="version-target">{d.latest ?? "—"}</td>
                <td className="text-muted">
                  {behindDays != null ? `+${behindDays}d` : "—"}
                </td>
                <td className="text-muted">
                  {d.usages.map((u) => u.workspaceId).join(", ")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AllDependenciesTable({
  project,
  dependencies,
  setView,
  filterText,
  setFilterText,
  filterMode,
  searchInputRef,
}: {
  project: Project;
  dependencies: Dependency[];
  setView: (v: View) => void;
  filterText: string;
  setFilterText: (t: string) => void;
  filterMode: FilterMode;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  const filtered = useMemo(() => {
    let list = dependencies;

    // Apply category filter mode
    if (filterMode === "attention") {
      list = list.filter(hasAttention);
    } else if (filterMode === "security") {
      list = list.filter((d) => d.usages.some((u) => u.security?.vulnerable));
    } else if (filterMode === "major") {
      list = list.filter((d) => d.usages.some((u) => u.update?.type === "major"));
    } else if (filterMode === "routine") {
      list = list.filter((d) => d.usages.some(isRoutine));
    } else if (filterMode === "deprecated") {
      list = list.filter((d) => d.usages.some((u) => u.deprecation?.isDeprecated));
    } else if (filterMode === "mismatch") {
      list = list.filter(
        (d) => d.versionMismatch.declared || d.versionMismatch.resolved,
      );
    }

    // Apply text search
    if (filterText.trim()) {
      const term = filterText.toLowerCase();
      list = list.filter(
        (d) =>
          d.name.toLowerCase().includes(term) ||
          d.usages.some((u) => u.workspaceId.toLowerCase().includes(term)),
      );
    }

    // Apply Sorting
    return list.slice().sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name);
      } else if (sortKey === "resolved") {
        const resA = a.usages[0]?.resolved ?? "";
        const resB = b.usages[0]?.resolved ?? "";
        cmp = resA.localeCompare(resB);
      } else if (sortKey === "latest") {
        const latA = a.latest ?? "";
        const latB = b.latest ?? "";
        cmp = latA.localeCompare(latB);
      } else if (sortKey === "workspaces") {
        cmp = a.usages.length - b.usages.length;
      } else if (sortKey === "status") {
        const scoreA = getStatusScore(a);
        const scoreB = getStatusScore(b);
        cmp = scoreA - scoreB;
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [dependencies, filterMode, filterText, sortKey, sortOrder]);

  return (
    <>
      <div className="filter-bar">
        <span className="filter-prompt">$ grep</span>
        <input
          ref={searchInputRef}
          type="search"
          aria-label="Filter packages"
          className="filter-input"
          placeholder="type / to search package or workspace..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        {filterText && (
          <button
            className="filter-clear-btn"
            onClick={() => setFilterText("")}
            aria-label="Clear filter"
          >
            ✕
          </button>
        )}
        <span className="filter-count" aria-live="polite">
          {filtered.length} / {dependencies.length} packages
        </span>
      </div>

      <div className="table-wrapper">
        <table className="term-table" aria-label="All external dependencies">
          <thead>
            <tr>
              <th
                className="sortable"
                onClick={() => handleSort("name")}
                aria-sort={sortKey === "name" ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
              >
                PACKAGE {sortKey === "name" && <span className="sort-arrow">{sortOrder === "asc" ? "▲" : "▼"}</span>}
              </th>
              <th
                className="sortable"
                onClick={() => handleSort("resolved")}
                aria-sort={sortKey === "resolved" ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
              >
                RESOLVED {sortKey === "resolved" && <span className="sort-arrow">{sortOrder === "asc" ? "▲" : "▼"}</span>}
              </th>
              <th
                className="sortable"
                onClick={() => handleSort("latest")}
                aria-sort={sortKey === "latest" ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
              >
                LATEST {sortKey === "latest" && <span className="sort-arrow">{sortOrder === "asc" ? "▲" : "▼"}</span>}
              </th>
              <th
                className="sortable"
                onClick={() => handleSort("status")}
                aria-sort={sortKey === "status" ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
              >
                STATUS {sortKey === "status" && <span className="sort-arrow">{sortOrder === "asc" ? "▲" : "▼"}</span>}
              </th>
              <th
                className="sortable"
                onClick={() => handleSort("workspaces")}
                aria-sort={sortKey === "workspaces" ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
              >
                WORKSPACES {sortKey === "workspaces" && <span className="sort-arrow">{sortOrder === "asc" ? "▲" : "▼"}</span>}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">
                  No dependencies match current filter criteria.
                </td>
              </tr>
            ) : (
              filtered.map((d) => {
                const hasSec = d.usages.some((u) => u.security?.vulnerable);
                const hasDep = d.usages.some((u) => u.deprecation?.isDeprecated);
                const majUsage = d.usages.find((u) => u.update?.type === "major");
                const minUsage = d.usages.find((u) => u.update?.type === "minor");
                const patUsage = d.usages.find((u) => u.update?.type === "patch");

                const resolvedList = [
                  ...new Set(
                    d.usages.map((u) => u.resolved).filter(Boolean) as string[],
                  ),
                ];
                const resolvedStr = resolvedList.length
                  ? resolvedList.join(", ")
                  : "unresolved";

                let statusBadge = (
                  <span className="badge badge-ok">UP TO DATE</span>
                );
                if (hasSec) {
                  statusBadge = <span className="badge badge-sec">SECURITY</span>;
                } else if (hasDep) {
                  statusBadge = <span className="badge badge-dep">DEPRECATED</span>;
                } else if (majUsage) {
                  statusBadge = <span className="badge badge-major">MAJOR</span>;
                } else if (minUsage) {
                  statusBadge = <span className="badge badge-minor">MINOR</span>;
                } else if (patUsage) {
                  statusBadge = <span className="badge badge-patch">PATCH</span>;
                }

                return (
                  <tr
                    key={d.name}
                    className="clickable-row"
                    onClick={() => setView(["dependency", project.id, d.name])}
                    tabIndex={0}
                    aria-label={`Inspect ${d.name}`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        setView(["dependency", project.id, d.name]);
                      }
                    }}
                  >
                    <td>
                      <div className="row-pkg-name">
                        <span className="row-arrow">›</span>
                        <span>{d.name}</span>
                        <CopyButton text={d.name} />
                      </div>
                    </td>
                    <td className="version-current">{resolvedStr}</td>
                    <td className="version-target">{d.latest ?? "—"}</td>
                    <td>{statusBadge}</td>
                    <td className="text-muted">
                      {d.usages.length} (
                      {d.usages.map((u) => u.workspaceId).join(", ")})
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DependencyPage({
  project,
  name,
  setView,
}: {
  project: Project;
  name: string;
  setView: (v: View) => void;
}) {
  const allDeps = project.dependencies;
  const currentIndex = allDeps.findIndex((x) => x.name === name);
  const d = allDeps[currentIndex];

  const prevDep = currentIndex > 0 ? allDeps[currentIndex - 1] : null;
  const nextDep =
    currentIndex >= 0 && currentIndex < allDeps.length - 1
      ? allDeps[currentIndex + 1]
      : null;

  // Keyboard navigation for Prev/Next Dependency
  useEffect(() => {
    const handleDepCycle = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === "input" || activeTag === "textarea") return;

      if (e.key === "[" && prevDep) {
        setView(["dependency", project.id, prevDep.name]);
      } else if (e.key === "]" && nextDep) {
        setView(["dependency", project.id, nextDep.name]);
      }
    };
    window.addEventListener("keydown", handleDepCycle);
    return () => window.removeEventListener("keydown", handleDepCycle);
  }, [prevDep, nextDep, project.id, setView]);

  if (!d) {
    return (
      <div className="state-container">
        <button
          className="term-back-btn"
          onClick={() => setView(["project", project.id])}
        >
          ← BACK TO {project.name.toUpperCase()}
        </button>
        <p style={{ color: "var(--color-red)" }}>
          [NOT FOUND] Dependency &quot;{name}&quot; is not registered in this project.
        </p>
      </div>
    );
  }

  const hasSec = d.usages.some((u) => u.security?.vulnerable);
  const hasDep = d.usages.some((u) => u.deprecation?.isDeprecated);
  const hasMismatch =
    d.versionMismatch.declared || d.versionMismatch.resolved;

  const quickInstallCmd = `${project.node?.packageManager ?? "pnpm"} add ${d.name}@${d.latest ?? "latest"}`;

  return (
    <>
      <div className="action-toolbar">
        <button
          className="term-back-btn"
          onClick={() => setView(["project", project.id])}
          aria-label="Back to project overview"
        >
          ← BACK TO {project.name.toUpperCase()} [Esc]
        </button>

        <div className="nav-cycle-group">
          <button
            className="nav-cycle-btn"
            disabled={!prevDep}
            onClick={() => prevDep && setView(["dependency", project.id, prevDep.name])}
            title={prevDep ? `Previous: ${prevDep.name} ([)` : "No previous"}
          >
            ← PREV ([)
          </button>
          <span className="text-dim" style={{ fontSize: "11px", margin: "0 4px" }}>
            {currentIndex + 1} / {allDeps.length}
          </span>
          <button
            className="nav-cycle-btn"
            disabled={!nextDep}
            onClick={() => nextDep && setView(["dependency", project.id, nextDep.name])}
            title={nextDep ? `Next: ${nextDep.name} (])` : "No next"}
          >
            NEXT (]) →
          </button>
        </div>
      </div>

      <div className="cmd-banner">
        <span className="cmd-prompt">
          $ watchtower inspect {project.id} --pkg={d.name}
        </span>
        <span className="cmd-cursor" />
      </div>
      <p className="cmd-subtitle">
        Package: {d.name} · Ecosystem: {d.ecosystem ?? "npm"} · Referenced in{" "}
        {d.usages.length} workspace{d.usages.length === 1 ? "" : "s"}
      </p>

      <div className="quick-install-bar">
        <div>
          <span className="text-muted">UPGRADE COMMAND: </span>
          <code className="quick-install-cmd">{quickInstallCmd}</code>
        </div>
        <CopyButton text={quickInstallCmd} label="COPY CMD" />
      </div>

      <div className="inspect-header-box">
        <div className="inspect-stat">
          <span className="inspect-stat-label">LATEST STABLE</span>
          <span className="inspect-stat-val" style={{ color: "var(--color-cyan)" }}>
            {d.latest ?? "Unavailable"}
          </span>
        </div>
        <div className="inspect-stat">
          <span className="inspect-stat-label">SECURITY STATUS</span>
          <span className="inspect-stat-val">
            {hasSec ? (
              <span className="badge badge-sec">VULNERABLE</span>
            ) : (
              <span className="badge badge-ok">CLEAN</span>
            )}
          </span>
        </div>
        <div className="inspect-stat">
          <span className="inspect-stat-label">DEPRECATION</span>
          <span className="inspect-stat-val">
            {hasDep ? (
              <span className="badge badge-dep">DEPRECATED</span>
            ) : (
              <span className="badge badge-neutral">ACTIVE</span>
            )}
          </span>
        </div>
        <div className="inspect-stat">
          <span className="inspect-stat-label">VERSION MISMATCH</span>
          <span className="inspect-stat-val">
            {hasMismatch ? (
              <span className="badge badge-mismatch">
                {d.versionMismatch.declared ? "DECLARED " : ""}
                {d.versionMismatch.resolved ? "RESOLVED" : ""}
              </span>
            ) : (
              <span className="badge badge-neutral">NONE</span>
            )}
          </span>
        </div>
      </div>

      <Section
        title="Workspace Usages & Telemetry"
        prefix="[#]"
        note="Declared ranges, lockfile resolutions, upgrade delta, and vulnerability advisories per workspace."
      >
        {d.usages.map((u) => {
          return (
            <article
              className="usage-card"
              key={`${u.workspaceId}-${u.section}`}
            >
              <div className="usage-card-top">
                <div className="usage-ws-info">
                  <span className="usage-ws-name">{u.workspaceId}</span>
                  <span className="usage-section-tag">{u.section}</span>
                </div>
                <div>
                  {u.update ? (
                    <span
                      className={`badge ${
                        u.update.type === "major"
                          ? "badge-major"
                          : u.update.type === "minor"
                            ? "badge-minor"
                            : "badge-patch"
                      }`}
                    >
                      {u.update.type.toUpperCase()} UPDATE AVAILABLE
                    </span>
                  ) : (
                    <span className="badge badge-ok">UP TO DATE</span>
                  )}
                </div>
              </div>

              <div className="usage-versions-grid">
                <div>
                  <span className="text-muted" style={{ fontSize: "11px" }}>
                    DECLARED RANGE:
                  </span>
                  <div style={{ fontWeight: 600 }}>{u.declared}</div>
                </div>
                <div>
                  <span className="text-muted" style={{ fontSize: "11px" }}>
                    RESOLVED VERSION:
                  </span>
                  <div style={{ fontWeight: 600 }}>
                    {u.resolved ?? "unresolved"}
                  </div>
                </div>
                <div>
                  <span className="text-muted" style={{ fontSize: "11px" }}>
                    UPDATE TELEMETRY:
                  </span>
                  <div>
                    {u.update ? (
                      <span>
                        target: {u.update.firstNewerVersion ?? d.latest} (
                        {u.update.behindDays != null
                          ? `${u.update.behindDays} days behind`
                          : "unknown"}
                        )
                      </span>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-muted" style={{ fontSize: "11px" }}>
                    BEHIND SINCE:
                  </span>
                  <div>
                    {u.update?.behindSince
                      ? new Date(u.update.behindSince)
                          .toISOString()
                          .slice(0, 10)
                      : "—"}
                  </div>
                </div>
              </div>

              {u.security?.vulnerable && u.security.advisories.length > 0 && (
                <div className="advisory-alert-box">
                  <div className="advisory-alert-title">
                    <span>[!]</span>
                    <span>
                      OSV SECURITY ADVISORY (
                      {u.security.advisories.length}{" "}
                      {u.security.advisories.length === 1
                        ? "VULNERABILITY"
                        : "VULNERABILITIES"}
                      )
                    </span>
                  </div>
                  {u.security.advisories.map((a) => (
                    <div className="advisory-item" key={a.id}>
                      <div>
                        <span className="advisory-id">{a.id}</span>
                        {a.aliases && a.aliases.length > 0 && (
                          <span className="text-dim" style={{ marginLeft: "6px" }}>
                            ({a.aliases.join(", ")})
                          </span>
                        )}
                        <span
                          className={`badge ${
                            a.severity === "critical" || a.severity === "high"
                              ? "badge-sec"
                              : "badge-major"
                          }`}
                          style={{ marginLeft: "8px" }}
                        >
                          {a.severity}
                        </span>
                      </div>
                      <div className="advisory-details">
                        {a.affectedRange && (
                          <span>range: {a.affectedRange} · </span>
                        )}
                        <span>
                          fixed in:{" "}
                          <strong>{a.fixedVersion ?? "unspecified"}</strong>
                        </span>
                      </div>
                      {a.url && (
                        <div>
                          <a
                            className="advisory-link"
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            [open advisory ↗]
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {u.deprecation?.isDeprecated && (
                <div className="dep-alert-box">
                  <strong>[!] DEPRECATION WARNING:</strong>
                  <span>
                    {u.deprecation.message ?? "Marked deprecated by author."}
                  </span>
                </div>
              )}
            </article>
          );
        })}
      </Section>
    </>
  );
}

function Workspaces({
  project,
  setView,
}: {
  project: Project;
  setView: (v: View) => void;
}) {
  const [filter, setFilter] = useState("");

  const filteredWorkspaces = useMemo(() => {
    if (!filter.trim()) return project.workspaces;
    const term = filter.toLowerCase();
    return project.workspaces.filter(
      (w) =>
        (w.name ?? "").toLowerCase().includes(term) ||
        w.path.toLowerCase().includes(term) ||
        project.dependencies.some(
          (d) =>
            d.usages.some((u) => u.workspaceId === w.id) &&
            d.name.toLowerCase().includes(term),
        ),
    );
  }, [project.workspaces, project.dependencies, filter]);

  return (
    <>
      <div className="cmd-banner">
        <span className="cmd-prompt">
          $ watchtower workspaces --project={project.id}
        </span>
        <span className="cmd-cursor" />
      </div>
      <p className="cmd-subtitle">
        {project.workspaces.length} workspace
        {project.workspaces.length === 1 ? "" : "s"} ·{" "}
        {project.internalDependencies.length} internal links ·{" "}
        {project.summary.externalUsageCount} external dependencies
      </p>

      <div className="filter-bar">
        <span className="filter-prompt">$ filter</span>
        <input
          type="search"
          aria-label="Filter workspaces"
          className="filter-input"
          placeholder="filter workspace name, path, or package..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {filter && (
          <button
            className="filter-clear-btn"
            onClick={() => setFilter("")}
            aria-label="Clear filter"
          >
            ✕
          </button>
        )}
      </div>

      <div className="term-section">
        {filteredWorkspaces.length === 0 ? (
          <div className="empty-state">No workspaces match the query.</div>
        ) : (
          filteredWorkspaces.map((w) => {
            const deps = project.dependencies.filter((d) =>
              d.usages.some((u) => u.workspaceId === w.id),
            );
            const internal = project.internalDependencies.filter(
              (d) => d.fromWorkspaceId === w.id,
            );

            return (
              <article className="workspace-node" key={w.id}>
                <div className="workspace-node-header">
                  <div className="workspace-title">
                    <span className="text-dim">├──</span>
                    <span>{w.name ?? w.id}</span>
                    {w.version && (
                      <span className="badge badge-neutral">v{w.version}</span>
                    )}
                  </div>
                  <div className="workspace-path">
                    <span>path: {w.path}</span>
                    {w.manifestPath && (
                      <span className="text-dim"> ({w.manifestPath})</span>
                    )}
                  </div>
                </div>

                {internal.length > 0 ? (
                  <div className="internal-deps-list">
                    <span className="text-muted">internal links:</span>
                    {internal.map((link) => (
                      <span
                        key={link.toWorkspaceId}
                        className="internal-dep-tag"
                      >
                        → {link.toWorkspaceId}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-dim" style={{ fontSize: "11px" }}>
                    └── internal links: (none)
                  </div>
                )}

                <div>
                  <div className="text-muted" style={{ fontSize: "11px", marginBottom: "4px" }}>
                    └── external dependencies ({deps.length}):
                  </div>
                  <div className="ws-deps-tags">
                    {deps.map((d) => {
                      const hasSec = d.usages.some(
                        (u) => u.workspaceId === w.id && u.security?.vulnerable,
                      );
                      const hasMaj = d.usages.some(
                        (u) => u.workspaceId === w.id && u.update?.type === "major",
                      );

                      return (
                        <button
                          key={d.name}
                          className="ws-dep-btn"
                          onClick={() =>
                            setView(["dependency", project.id, d.name])
                          }
                          aria-label={`Inspect ${d.name} in ${w.name ?? w.id}`}
                          style={{
                            borderColor: hasSec
                              ? "var(--color-red-border)"
                              : hasMaj
                                ? "var(--color-amber-border)"
                                : undefined,
                            color: hasSec
                              ? "var(--color-red)"
                              : hasMaj
                                ? "var(--color-amber)"
                                : undefined,
                          }}
                        >
                          {d.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </>
  );
}

function History({
  project,
  index,
}: {
  project: Project;
  index: HistoryIndex;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [archived, setArchived] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const entries = index.projects[project.id] ?? [];

  useEffect(() => {
    if (!selected && entries.length > 0) {
      setSelected(entries[entries.length - 1].date);
    }
  }, [entries, selected]);

  useEffect(() => {
    if (!selected) return;
    const [year, month] = selected.split("-");
    setLoading(true);
    get<Snapshot>(dataUrl(`history/${year}/${month}/${selected}.json`))
      .then((snap) => {
        setArchived(snap);
        setLoading(false);
      })
      .catch(() => {
        setArchived(null);
        setLoading(false);
      });
  }, [selected]);

  const selectedEntry = entries.find((e) => e.date === selected);
  const archivedProject = archived?.projects.find((p) => p.id === project.id);

  return (
    <>
      <div className="cmd-banner">
        <span className="cmd-prompt">
          $ watchtower history --project={project.id}
        </span>
        <span className="cmd-cursor" />
      </div>
      <p className="cmd-subtitle">
        Historical audit logs and snapshots timeline ({entries.length} snapshot
        {entries.length === 1 ? "" : "s"} recorded)
      </p>

      <div className="history-layout">
        <div className="history-list">
          <div className="term-section-header">
            <h3 className="term-section-title">
              <span className="sec-prefix">&gt;</span> SNAPSHOT LEDGER
            </h3>
          </div>

          {entries
            .slice()
            .reverse()
            .map((e) => {
              const isSel = selected === e.date;
              return (
                <button
                  key={e.date}
                  className={`history-row-btn ${isSel ? "selected" : ""}`}
                  onClick={() => setSelected(e.date)}
                  aria-pressed={isSel}
                >
                  <div className="history-row-top">
                    <span>
                      {isSel ? ">" : " "} {e.date}
                    </span>
                    <span className="text-muted" style={{ fontSize: "11px" }}>
                      {e.summary.externalDependencyCount} pkgs
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <span
                      className={`badge ${e.summary.vulnerableUsageCount > 0 ? "badge-sec" : "badge-neutral"}`}
                    >
                      SEC: {e.summary.vulnerableUsageCount}
                    </span>
                    <span
                      className={`badge ${e.summary.majorUpdateCount > 0 ? "badge-major" : "badge-neutral"}`}
                    >
                      MAJ: {e.summary.majorUpdateCount}
                    </span>
                    <span className="badge badge-neutral">
                      UPDATES: {e.summary.availableUpdateCount}
                    </span>
                  </div>
                </button>
              );
            })}
        </div>

        <div className="history-inspector">
          <div className="term-section-header">
            <h3 className="term-section-title">
              <span className="sec-prefix">#</span> SNAPSHOT INSPECTOR:{" "}
              {selected ?? "NONE"}
            </h3>
            <span className="term-section-note">
              {loading ? "Loading snapshot…" : "Archive record"}
            </span>
          </div>

          {selectedEntry ? (
            <>
              <div className="metrics-ribbon">
                <div className="metric-cell">
                  <span className="metric-label">PACKAGES</span>
                  <span className="metric-val">
                    {selectedEntry.summary.externalDependencyCount}
                  </span>
                </div>
                <div
                  className={`metric-cell ${selectedEntry.summary.vulnerableUsageCount > 0 ? "alert-sec" : ""}`}
                >
                  <span className="metric-label">SECURITY</span>
                  <span className="metric-val">
                    {selectedEntry.summary.vulnerableUsageCount}
                  </span>
                </div>
                <div
                  className={`metric-cell ${selectedEntry.summary.majorUpdateCount > 0 ? "alert-warn" : ""}`}
                >
                  <span className="metric-label">MAJOR</span>
                  <span className="metric-val">
                    {selectedEntry.summary.majorUpdateCount}
                  </span>
                </div>
                <div className="metric-cell">
                  <span className="metric-label">ROUTINE</span>
                  <span className="metric-val">
                    {selectedEntry.summary.routineUpdateCount}
                  </span>
                </div>
              </div>

              {archivedProject && (
                <div className="term-section">
                  <div className="text-muted" style={{ fontSize: "12px" }}>
                    [SNAPSHOT DATA] Project &quot;{archivedProject.name}&quot; recorded{" "}
                    {archivedProject.summary.externalUsageCount} dependency usages
                    across {archivedProject.workspaces.length} workspaces on this date.
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">No historical snapshot selected.</div>
          )}
        </div>
      </div>
    </>
  );
}

function Section({
  title,
  prefix,
  note,
  children,
}: {
  title: string;
  prefix?: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="term-section">
      <div className="term-section-header">
        <h2 className="term-section-title">
          <span className="sec-prefix">{prefix ?? ">"}</span> {title}
        </h2>
        {note && <span className="term-section-note">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [text],
  );

  return (
    <button
      className={`copy-pill ${copied ? "copied" : ""}`}
      onClick={handleCopy}
      title={`Copy "${text}"`}
      aria-label={`Copy ${text}`}
    >
      {copied ? "COPIED ✓" : label ?? "copy"}
    </button>
  );
}

function isRoutine(u: Usage) {
  return !!u.update && u.update.type !== "major" && !u.security?.vulnerable;
}

function hasAttention(d: Dependency) {
  return (
    d.usages.some(
      (u) =>
        u.security?.vulnerable ||
        u.deprecation?.isDeprecated ||
        u.update?.type === "major",
    ) ||
    d.versionMismatch.declared ||
    d.versionMismatch.resolved
  );
}

function getStatusScore(d: Dependency): number {
  if (d.usages.some((u) => u.security?.vulnerable)) return 1;
  if (d.usages.some((u) => u.deprecation?.isDeprecated)) return 2;
  if (d.usages.some((u) => u.update?.type === "major")) return 3;
  if (d.usages.some((u) => u.update?.type === "minor")) return 4;
  if (d.usages.some((u) => u.update?.type === "patch")) return 5;
  return 6;
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url}`);
  return r.json() as Promise<T>;
}

function dataUrl(filePath: string): string {
  return `${import.meta.env.BASE_URL}data/${filePath}`;
}
