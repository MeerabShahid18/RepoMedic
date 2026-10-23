"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";

type RunState = "CREATED" | "ANALYZING" | "INVESTIGATING" | "DIAGNOSING" | "PATCH_PROPOSED" | "TESTING" | "VERIFIED" | "FAILED" | "NEEDS_REVIEW";
type RunEvent = { id: string; type: string; state: RunState; message: string; at: string };
type Patch = { path: string; before: string; after: string };
type TestEvidence = { command: string; exitCode: number | null; output: string; timedOut: boolean; passed: boolean; startedAt: string; completedAt: string };
type Run = {
  id: string;
  state: RunState;
  mode: "ollama" | "demo";
  model: string;
  inference: string;
  bugReport: string;
  createdAt: string;
  updatedAt: string;
  analysis?: { summary: string; rootCause: string; confidence: number; references: Array<{ path: string; reason: string }>; regressionTest: string };
  patch?: Patch[];
  testEvidence?: TestEvidence;
  error?: string;
  events: RunEvent[];
};

type Health = { ollama: "ready" | "model-missing" | "unavailable"; model: string; message: string };

async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status}).`);
  return data as T;
}

function StatePill({ state }: { state: RunState }) {
  const label = state === "PATCH_PROPOSED" ? "AWAITING APPROVAL" : state.replaceAll("_", " ");
  return <span className={`state-pill state-${state.toLowerCase()}`}><i />{label}</span>;
}

function Metric({ icon, value, label }: { icon: string; value: string; label: string }) {
  return <div className="metric"><span className="metric-icon">{icon}</span><div><strong>{value}</strong><span>{label}</span></div></div>;
}

export default function Home() {
  const [report, setReport] = useState("GET /api/users/2 returns 404 even though a user with ID 2 exists.");
  const [mode, setMode] = useState<"ollama" | "demo">("ollama");
  const [health, setHealth] = useState<Health | null>(null);
  const [repository, setRepository] = useState<{ id: string; name: string; description: string } | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const activeRun = runs.find((run) => run.id === activeId) ?? null;
  const terminal = useMemo(() => activeRun && ["VERIFIED", "FAILED", "NEEDS_REVIEW"].includes(activeRun.state), [activeRun]);

  const refreshRun = useCallback(async (id: string) => {
    try {
      const data = await responseJson<{ run: Run }>(await fetch(`${API}/api/runs/${id}`));
      setRuns((current) => [data.run, ...current.filter((run) => run.id !== id)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not refresh execution.");
    }
  }, []);

  useEffect(() => {
    void Promise.all([
      fetch(`${API}/api/health`).then((res) => res.json()).then(setHealth),
      fetch(`${API}/api/repos`).then((res) => res.json()).then((data) => setRepository(data.repositories[0] ?? null)),
      fetch(`${API}/api/runs`).then((res) => res.json()).then((data) => setRuns(data.runs))
    ]).catch((reason) => setError(reason instanceof Error ? reason.message : "Cannot connect to the RepoMedic API."));
  }, []);

  useEffect(() => {
    if (!activeId || terminal) return;
    const stream = new EventSource(`${API}/api/runs/${activeId}/events`);
    stream.onmessage = () => void refreshRun(activeId);
    stream.onerror = () => {
      if (stream.readyState === EventSource.CLOSED) setError("Live progress disconnected. Refresh the run to see its latest status.");
    };
    return () => stream.close();
  }, [activeId, terminal, refreshRun]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (report.trim().length < 12 || busy) return;
    setError("");
    setBusy(true);
    try {
      const data = await responseJson<{ run: Run }>(await fetch(`${API}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryId: repository?.id ?? "demo-express", bugReport: report, mode })
      }));
      setActiveId(data.run.id);
      setRuns((current) => [data.run, ...current.filter((run) => run.id !== data.run.id)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start analysis.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!activeRun || busy) return;
    setError("");
    setBusy(true);
    try {
      const data = await responseJson<{ run: Run }>(await fetch(`${API}/api/runs/${activeRun.id}/approve`, { method: "POST" }));
      setRuns((current) => [data.run, ...current.filter((run) => run.id !== data.run.id)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not run the approved patch.");
    } finally {
      setBusy(false);
    }
  }

  async function copyReport() {
    if (!activeRun?.testEvidence) return;
    await navigator.clipboard.writeText(activeRun.testEvidence.output || "(No test output.)");
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#"><span className="brand-mark">+</span><span>repomedic<span className="brand-ai">.ai</span><small>ENGINEERING INTELLIGENCE</small></span></a>
        <div className="side-label">WORKSPACE</div>
        <button className="side-link selected"><span className="side-icon">▦</span>Bug triage<span className="nav-dot" /></button>
        <button className="side-link" onClick={() => document.getElementById("history")?.scrollIntoView({ behavior: "smooth" })}><span className="side-icon">◷</span>Run history</button>
        <div className="sidebar-bottom">
          <div className="privacy-card"><span className="privacy-lock">◈</span><strong>Private by design</strong><p>Inference stays on this machine. Your code is never sent to a hosted AI.</p><span className="privacy-status"><i /> LOCAL RUNTIME</span></div>
          <div className="profile"><div className="avatar">RM</div><div><strong>Local workspace</strong><span>Personal instance</span></div><span className="more">•••</span></div>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> <strong>Bug triage</strong></div>
          <div className="top-actions">
            <span className={`runtime ${health?.ollama === "ready" ? "runtime-ready" : ""}`}><i />{health?.ollama === "ready" ? "OLLAMA CONNECTED" : "OLLAMA OFFLINE"}</span>
            <button className="help-button" title="This is a local-only development instance.">? <span>Help</span></button>
          </div>
        </header>
        <div className="content">
          <div className="heading-row">
            <div><div className="eyebrow"><span className="eyebrow-line" /> LOCAL-FIRST CODE MAINTENANCE</div><h1>From bug report to<br /><span>verified fix.</span></h1><p className="intro">Trace the cause. Review the patch. Prove the fix with a real test run.</p></div>
            <div className="hero-stamp"><div className="stamp-cross">+</div><span>REVIEW<br />BEFORE APPLY</span></div>
          </div>

          <div className="metrics">
            <Metric icon="⌘" value="01" label="registered repository" />
            <Metric icon="◉" value={health?.ollama === "ready" ? "READY" : "CHECK"} label="local model runtime" />
            <Metric icon="✓" value="HUMAN" label="patch approval required" />
          </div>

          <div className="workspace-grid">
            <section className="panel report-panel">
              <div className="panel-heading"><div><span className="step-index">01</span><div><h2>Describe the bug</h2><p>Give the agent a focused, reproducible issue.</p></div></div><span className="panel-symbol">↗</span></div>
              <form onSubmit={submit}>
                <label className="field-label" htmlFor="repo">TARGET REPOSITORY</label>
                <button type="button" id="repo" className="repo-select" aria-label="Selected repository">
                  <span className="repo-avatar">R</span><span className="repo-copy"><strong>{repository?.name ?? "Loading repository…"}</strong><small>{repository?.description ?? "Registered sample repository"}</small></span><span className="repo-badge">DEMO REPO</span><span className="chevron">⌄</span>
                </button>
                <label className="field-label report-label" htmlFor="bug-report">BUG REPORT <span>REQUIRED</span></label>
                <textarea id="bug-report" value={report} onChange={(event) => setReport(event.target.value)} maxLength={2000} placeholder="What happened? What did you expect?" />
                <div className="textarea-meta"><span>Be specific about the observed and expected behavior.</span><span>{report.length}/2000</span></div>
                <label className="field-label mode-label">ANALYSIS MODE</label>
                <div className="mode-switch">
                  <button type="button" className={mode === "ollama" ? "mode-option active" : "mode-option"} onClick={() => setMode("ollama")}><span className="radio">{mode === "ollama" && <i />}</span><span><strong>Local model</strong><small>{health?.model ?? "gemma4:e4b"} · Ollama</small></span><span className="mode-real">REAL INFERENCE</span></button>
                  <button type="button" className={mode === "demo" ? "mode-option active" : "mode-option"} onClick={() => setMode("demo")}><span className="radio">{mode === "demo" && <i />}</span><span><strong>Guided demo</strong><small>Fixed, deterministic sample proposal</small></span><span className="mode-demo">MOCK</span></button>
                </div>
                {mode === "demo" && <div className="demo-notice">Demo mode does not call an AI model. Tests are still executed for real after approval.</div>}
                {error && <div className="error-banner" role="alert">{error}</div>}
                <button className="primary-button" disabled={busy || report.trim().length < 12 || !repository} type="submit">
                  {busy && !activeRun ? <span className="spinner" /> : <span>Start analysis <b>→</b></span>}
                </button>
              </form>
              <div className="safety-note"><span>⌑</span>Read-only inspection <i /> Bounded context <i /> No shell access</div>
            </section>

            <section className="panel pipeline-panel">
              <div className="panel-heading"><div><span className="step-index">02</span><div><h2>Execution pipeline</h2><p>Controlled steps. Observable evidence.</p></div></div><span className="pipeline-count">STATE MACHINE</span></div>
              <div className="pipeline-list">
                {[
                  ["01", "Repository inspection", "Bounded, read-only file tools", "ANALYZING"],
                  ["02", "Root-cause analysis", "Local Gemma inference · JSON output", "DIAGNOSING"],
                  ["03", "Patch proposal", "Validated · waits for your approval", "PATCH_PROPOSED"],
                  ["04", "Regression test", "Fixed command · isolated working copy", "TESTING"]
                ].map(([number, title, detail, state], index) => {
                  const isCurrent = activeRun && activeRun.state === state;
                  const isDone = activeRun && (["INVESTIGATING", "DIAGNOSING", "PATCH_PROPOSED", "TESTING", "VERIFIED"].includes(activeRun.state) && index === 0 ||
                    ["PATCH_PROPOSED", "TESTING", "VERIFIED"].includes(activeRun.state) && index === 1 ||
                    ["TESTING", "VERIFIED"].includes(activeRun.state) && index === 2 ||
                    activeRun.state === "VERIFIED" && index === 3);
                  return <div className={`pipeline-step ${isCurrent ? "step-current" : ""} ${isDone ? "step-done" : ""}`} key={state}>
                    <div className="step-track"><span>{isDone ? "✓" : number}</span>{index < 3 && <i />}</div>
                    <div className="step-text"><strong>{title}</strong><small>{detail}</small></div>
                    <span className={`step-state ${isDone ? "done" : isCurrent ? "current" : ""}`}>{isDone ? "DONE" : isCurrent ? "RUNNING" : "QUEUED"}</span>
                  </div>;
                })}
              </div>
              <div className="pipeline-footer"><span className="lock-icon">⌑</span><div><strong>Approval gate enabled</strong><p>Proposed changes stay unapplied until you approve them.</p></div><span className="toggle-on"><i /></span></div>
            </section>
          </div>

          {activeRun && <section className="panel results-panel" aria-live="polite">
            <div className="panel-heading result-heading"><div><span className="step-index">03</span><div><h2>Analysis &amp; evidence</h2><p>Execution <code>{activeRun.id.slice(0, 8)}</code> · {activeRun.mode === "ollama" ? `Genuine local inference · ${activeRun.model}` : "Deterministic demo · no model inference"}</p></div></div><StatePill state={activeRun.state} /></div>
            {activeRun.analysis ? <>
              <div className="diagnosis"><div className="diagnosis-icon">⌕</div><div><span className="field-label">SUSPECTED ROOT CAUSE <span className="confidence">{Math.round(activeRun.analysis.confidence * 100)}% CONFIDENCE</span></span><h3>{activeRun.analysis.summary}</h3><p>{activeRun.analysis.rootCause}</p></div></div>
              <div className="references"><span className="field-label">EVIDENCE REFERENCES</span>{activeRun.analysis.references.map((reference) => <div className="reference" key={reference.path}><code>{reference.path}</code><span>{reference.reason}</span></div>)}</div>
              {activeRun.patch?.map((patch) => <div className="patch-block" key={patch.path}>
                <div className="patch-title"><span className="field-label">PROPOSED REPLACEMENT</span><code>{patch.path}</code></div>
                <div className="code-panes"><div><div className="code-label removed">− EXISTING</div><pre>{patch.before}</pre></div><div><div className="code-label added">+ PROPOSED</div><pre>{patch.after}</pre></div></div>
              </div>)}
              {activeRun.analysis.regressionTest && <div className="regression"><div><span className="field-label">SUGGESTED REGRESSION ASSERTION</span><small>Suggestion only — not added to or executed as a test.</small></div><pre>{activeRun.analysis.regressionTest}</pre></div>}
              {activeRun.state === "PATCH_PROPOSED" && <div className="approval-bar"><div><strong>Review the proposed replacement above</strong><span>Approval applies it only to a temporary working copy, then runs the fixed test.</span></div><button className="approve-button" disabled={busy} onClick={approve}>{busy ? <><span className="spinner" /> Running…</> : <>Approve patch &amp; run test <b>→</b></>}</button></div>}
            </> : <div className="empty-analysis"><span className="loader-ring" /><div><strong>{activeRun.state === "FAILED" ? "Analysis could not be completed" : "Analyzing repository…"}</strong><p>{activeRun.error ?? "Reading selected files and preparing the structured model request."}</p></div></div>}
            {activeRun.testEvidence && <div className={`test-evidence ${activeRun.testEvidence.passed ? "test-passed" : "test-failed"}`}>
              <div className="test-evidence-top"><div><span className="field-label">ACTUAL TEST EXECUTION</span><h3>{activeRun.testEvidence.passed ? "Regression test passed" : activeRun.testEvidence.timedOut ? "Test timed out" : "Regression test failed"}</h3></div><span className="exit-code">EXIT {activeRun.testEvidence.exitCode ?? "—"}</span></div>
              <div className="command-line"><span>$</span><code>{activeRun.testEvidence.command}</code><button onClick={copyReport}>{copied ? "COPIED" : "COPY OUTPUT"}</button></div>
              <pre className="test-output">{activeRun.testEvidence.output || "(The test process produced no output.)"}</pre>
              <div className="evidence-foot"><span>Started {new Date(activeRun.testEvidence.startedAt).toLocaleTimeString()}</span><span>Finished {new Date(activeRun.testEvidence.completedAt).toLocaleTimeString()}</span><strong>{activeRun.testEvidence.passed ? "VERIFIED · REAL PROCESS" : "NOT VERIFIED"}</strong></div>
            </div>}
            <div className="event-log"><span className="field-label">RUN ACTIVITY</span>{activeRun.events.map((item) => <div className="event-row" key={item.id}><time>{new Date(item.at).toLocaleTimeString()}</time><StatePill state={item.state} /><span>{item.message}</span></div>)}</div>
          </section>}

          <section className="history-section" id="history">
            <div className="history-title"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Execution history</h2></div><span>{runs.length.toString().padStart(2, "0")} RUNS</span></div>
            {runs.length === 0 ? <div className="history-empty">Your analysis runs and verification evidence will appear here.</div> : runs.slice(0, 5).map((run) => <button className={`history-row ${run.id === activeId ? "history-active" : ""}`} key={run.id} onClick={() => { setActiveId(run.id); void refreshRun(run.id); }}>
              <span className={`history-symbol ${run.state === "VERIFIED" ? "history-ok" : run.state === "FAILED" ? "history-bad" : ""}`}>{run.state === "VERIFIED" ? "✓" : run.state === "FAILED" ? "!" : "⌕"}</span><span className="history-copy"><strong>{run.bugReport}</strong><small>{new Date(run.createdAt).toLocaleString()} · {run.mode === "ollama" ? "Gemma 4 E4B" : "Demo mode"}</small></span><StatePill state={run.state} /><span className="history-arrow">→</span>
            </button>)}
          </section>

          <footer><span>REPOMEDIC AI <i /> BUILT FOR RESPONSIBLE SOFTWARE MAINTENANCE</span><span>LOCAL-FIRST <i /> HUMAN-APPROVED <i /> EVIDENCE-BASED</span></footer>
        </div>
      </section>
    </main>
  );
}
