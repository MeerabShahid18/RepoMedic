import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inferWithOllama } from "./ollama";
import { persistRun } from "./persistence";
import { modelResultSchema, type ModelResult, type RunRequest, type RunState } from "./schemas";
import { getRepoTool, resolveRepoPath, validatePatch } from "./tools";

export interface PatchPreview {
  path: string;
  before: string;
  after: string;
}

export interface TestEvidence {
  command: string;
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  passed: boolean;
  startedAt: string;
  completedAt: string;
}

export interface RunEvent {
  id: string;
  runId: string;
  type: "state" | "progress" | "result" | "error";
  state: RunState;
  message: string;
  at: string;
  data?: unknown;
}

export interface ExecutionRun {
  id: string;
  repositoryId: string;
  bugReport: string;
  mode: "ollama" | "demo";
  state: RunState;
  createdAt: string;
  updatedAt: string;
  model: string;
  inference: "pending" | "genuine-local" | "demo-scripted" | "failed";
  analysis?: Omit<ModelResult, "changes"> & { changes?: never };
  patch?: PatchPreview[];
  testEvidence?: TestEvidence;
  error?: string;
  workDirectory?: string;
  events: RunEvent[];
}

const allowedTransitions: Record<RunState, RunState[]> = {
  CREATED: ["ANALYZING", "FAILED"],
  ANALYZING: ["INVESTIGATING", "FAILED"],
  INVESTIGATING: ["DIAGNOSING", "FAILED"],
  DIAGNOSING: ["PATCH_PROPOSED", "NEEDS_REVIEW", "FAILED"],
  PATCH_PROPOSED: ["TESTING", "NEEDS_REVIEW"],
  TESTING: ["VERIFIED", "FAILED"],
  VERIFIED: [],
  FAILED: [],
  NEEDS_REVIEW: []
};

export function canTransition(from: RunState, to: RunState): boolean {
  return allowedTransitions[from].includes(to);
}

const runs = new Map<string, ExecutionRun>();
const listeners = new Map<string, Set<(event: RunEvent) => void>>();
const approvalsInProgress = new Set<string>();
let inferenceQueue: Promise<void> = Promise.resolve();

const repoRoot = (): string => {
  return path.resolve(__dirname, "../../demo-repo");
};

function emit(run: ExecutionRun, type: RunEvent["type"], message: string, data?: unknown): void {
  const event: RunEvent = {
    id: randomUUID(),
    runId: run.id,
    type,
    state: run.state,
    message,
    at: new Date().toISOString(),
    ...(data === undefined ? {} : { data })
  };
  run.events.push(event);
  run.updatedAt = event.at;
  void persistRun(run);
  for (const listener of listeners.get(run.id) ?? []) listener(event);
}

function transition(run: ExecutionRun, next: RunState, message: string): void {
  if (!canTransition(run.state, next)) {
    throw new Error(`Invalid harness transition: ${run.state} -> ${next}`);
  }
  run.state = next;
  emit(run, "state", message);
}

function snapshot(run: ExecutionRun): Omit<ExecutionRun, "workDirectory" | "events"> & { events: RunEvent[] } {
  const { workDirectory: _workDirectory, ...publicRun } = run;
  return { ...publicRun, events: [...run.events] };
}

async function prepareWorkingCopy(runId: string, root: string): Promise<string> {
  const files = await getRepoTool("list_files").execute(root, { limit: 200 }) as string[];
  const destination = path.join(os.tmpdir(), "repomedic-ai", "runs", runId);
  await mkdir(destination, { recursive: true });
  for (const file of files) {
    const source = resolveRepoPath(root, file);
    const target = resolveRepoPath(destination, file);
    const sourceInfo = await lstat(source);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) continue;
    await mkdir(path.dirname(target), { recursive: true });
    const content = await readFile(source);
    if (content.byteLength > 50_000) continue;
    await writeFile(target, content);
  }
  return destination;
}

function demoResult(): ModelResult {
  return {
    summary: "The user lookup returns the wrong user for numeric IDs.",
    rootCause: "The route's lookup uses the requested ID as an array index. IDs are one-based and may not match array positions, so `/api/users/2` can return the third entry or no result.",
    confidence: 0.96,
    references: [
      { path: "src/users.js", reason: "The lookup implementation treats an ID as an array offset." },
      { path: "test/users.test.js", reason: "The regression test expects the user whose ID is 2." }
    ],
    changes: [{
      path: "src/users.js",
      content: `const users = [
  { id: 1, name: "Ada" },
  { id: 2, name: "Grace" }
];

function findUser(id) {
  return users.find((user) => user.id === Number(id));
}

module.exports = { findUser };
`
    }],
    regressionTest: `test("finds a user by their ID rather than their array position", () => {
  assert.equal(findUser("2").name, "Grace");
});`
  };
}

async function boundedRead(root: string, file: string): Promise<string> {
  const content = await getRepoTool("read_file").execute(root, { path: file }) as string;
  return content.slice(0, 12_000);
}

async function captureTest(workDirectory: string): Promise<TestEvidence> {
  const startedAt = new Date().toISOString();
  const timeoutMs = Math.min(Math.max(Number(process.env.TEST_TIMEOUT_MS) || 15_000, 1000), 30_000);
  const maxOutput = 30_000;
  const outputParts: string[] = [];
  let outputSize = 0;
  let timedOut = false;
  const child = spawn(process.execPath, ["--test", "test/users.test.js"], {
    cwd: workDirectory,
    shell: false,
    windowsHide: true,
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const append = (chunk: Buffer): void => {
    if (outputSize >= maxOutput) return;
    const text = chunk.toString("utf8").slice(0, maxOutput - outputSize);
    outputParts.push(text);
    outputSize += text.length;
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  }).finally(() => clearTimeout(timer));
  const output = outputParts.join("");
  return {
    command: "node --test test/users.test.js",
    exitCode,
    output,
    timedOut,
    passed: exitCode === 0 && !timedOut,
    startedAt,
    completedAt: new Date().toISOString()
  };
}

export function createRun(input: RunRequest): ExecutionRun {
  const id = randomUUID();
  const run: ExecutionRun = {
    id,
    repositoryId: input.repositoryId,
    bugReport: input.bugReport,
    mode: input.mode,
    state: "CREATED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model: input.mode === "ollama" ? (process.env.OLLAMA_MODEL ?? "gemma4:e4b") : "Demo mode (no model)",
    inference: "pending",
    events: []
  };
  runs.set(id, run);
  emit(run, "state", "Run created; approval will be required before any patch is applied.");
  inferenceQueue = inferenceQueue.then(() => analyze(run)).catch((error: unknown) => {
    if (run.state !== "FAILED" && run.state !== "NEEDS_REVIEW") {
      run.inference = "failed";
      run.error = error instanceof Error ? error.message : "Unexpected harness failure.";
      transition(run, "FAILED", run.error);
      emit(run, "error", run.error);
    }
  });
  return run;
}

async function analyze(run: ExecutionRun): Promise<void> {
  const root = repoRoot();
  transition(run, "ANALYZING", "Preparing a bounded, read-only repository inspection.");
  run.workDirectory = await prepareWorkingCopy(run.id, root);
  const files = await getRepoTool("list_files").execute(root, { limit: 100 }) as string[];
  const metadata = await getRepoTool("project_metadata").execute(root, {}) as unknown;
  emit(run, "progress", `Read-only inventory: ${files.length} permitted files and project metadata.`);
  transition(run, "INVESTIGATING", "Reading selected source and regression-test context.");
  const candidates = files.filter((file) => /^(src\/|test\/)/.test(file)).slice(0, 4);
  const context = await Promise.all(candidates.map(async (file) => ({
    path: file,
    content: await boundedRead(root, file)
  })));
  emit(run, "progress", `Provided ${context.length} bounded file excerpts (12 KB each maximum) to the analysis stage.`);
  transition(run, "DIAGNOSING", run.mode === "ollama"
    ? "Sending one sequential, structured request to the configured local Ollama model."
    : "Using the clearly labeled deterministic demo fixture; no model inference will occur.");
  const result = run.mode === "ollama"
    ? await inferWithOllama({ bugReport: run.bugReport, files: context, metadata })
    : demoResult();
  const validated = modelResultSchema.parse(result);
  let permittedPaths: string[];
  try {
    permittedPaths = await validatePatch(root, validated.changes);
  } catch (error) {
    run.error = error instanceof Error ? error.message : "The proposed patch did not pass validation.";
    transition(run, "NEEDS_REVIEW", `The model proposal was not applied: ${run.error}`);
    emit(run, "error", run.error);
    return;
  }
  const references = validated.references.filter((reference) => files.includes(reference.path));
  if (references.length !== validated.references.length) {
    run.error = "The model referenced files outside the registered repository inventory.";
    transition(run, "NEEDS_REVIEW", `The model proposal requires manual review: ${run.error}`);
    emit(run, "error", run.error);
    return;
  }
  const patch: PatchPreview[] = [];
  for (let index = 0; index < validated.changes.length; index += 1) {
    const change = validated.changes[index];
    if (!change) continue;
    const before = await boundedRead(root, permittedPaths[index]);
    if (before === change.content) throw new Error(`Proposed content is unchanged: ${change.path}`);
    patch.push({ path: change.path, before, after: change.content });
  }
  run.inference = run.mode === "ollama" ? "genuine-local" : "demo-scripted";
  run.analysis = {
    summary: validated.summary,
    rootCause: validated.rootCause,
    confidence: validated.confidence,
    references,
    regressionTest: validated.regressionTest
  };
  run.patch = patch;
  transition(run, "PATCH_PROPOSED", "A patch proposal is ready. It has not been applied; explicit approval is required.");
  emit(run, "result", "Analysis and patch proposal are ready.", { analysis: run.analysis, inference: run.inference, patch });
}

export async function approveAndTest(id: string): Promise<ExecutionRun> {
  const run = runs.get(id);
  if (!run) throw new Error("Run not found.");
  if (run.state !== "PATCH_PROPOSED" || !run.patch || !run.workDirectory || approvalsInProgress.has(id)) {
    throw new Error("Only a proposed patch can be approved, and it can be approved only once.");
  }
  approvalsInProgress.add(id);
  try {
  const root = repoRoot();
  await validatePatch(run.workDirectory, run.patch.map(({ path: filePath, after }) => ({
    path: filePath,
    content: after
  })));
  for (const change of run.patch) {
    await writeFile(resolveRepoPath(run.workDirectory, change.path), change.after, "utf8");
  }
  transition(run, "TESTING", "Patch approved and applied only to this run's disposable working copy; starting the fixed regression test command.");
  try {
    run.testEvidence = await captureTest(run.workDirectory);
    emit(run, "progress", `Test process exited with ${run.testEvidence.exitCode}; output captured (${run.testEvidence.output.length} characters).`, run.testEvidence);
    if (run.testEvidence.passed) {
      transition(run, "VERIFIED", "The allowlisted test process ran and passed on the approved working copy.");
    } else {
      transition(run, "FAILED", run.testEvidence.timedOut
        ? "The regression test timed out; the change is not verified."
        : "The regression test failed; the change is not verified.");
    }
  } catch (error) {
    run.error = error instanceof Error ? error.message : "Test process failed to start.";
    transition(run, "FAILED", `Could not complete the test process: ${run.error}`);
    emit(run, "error", run.error);
  }
  return run;
  } finally {
    approvalsInProgress.delete(id);
  }
}

export function getRun(id: string): ExecutionRun | undefined {
  return runs.get(id);
}

export function listRuns(): Array<ReturnType<typeof snapshot>> {
  return [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(snapshot);
}

export function publicSnapshot(run: ExecutionRun): ReturnType<typeof snapshot> {
  return snapshot(run);
}

export function subscribe(id: string, listener: (event: RunEvent) => void): () => void {
  const set = listeners.get(id) ?? new Set();
  set.add(listener);
  listeners.set(id, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(id);
  };
}

export function getRunEvents(id: string): RunEvent[] {
  return runs.get(id)?.events ?? [];
}

export function restoreRuns(records: ExecutionRun[]): void {
  for (const record of records) {
    if (record && typeof record.id === "string" && typeof record.state === "string" && Array.isArray(record.events)) {
      runs.set(record.id, record);
    }
  }
}

export function registeredRepository() {
  return {
    id: "demo-express",
    name: "RepoMedic Sample API",
    description: "A tiny Express service with a reproducible user-ID lookup bug.",
    pathLabel: "bundled sample (read-only source; isolated working copies)"
  };
}

export function getToolCatalog() {
  return [
    ...(["list_files", "read_file", "search_code", "project_metadata"] as const).map((name) => {
      const tool = getRepoTool(name);
      return { name: tool.name, description: tool.description, access: "read-only" };
    }),
    {
      name: "validate_patch",
      description: "Validate each model-proposed replacement against the src/*.js allowlist; never applies it.",
      access: "validation-only"
    },
    {
      name: "run_approved_tests",
      description: "After explicit approval, execute only node --test test/users.test.js in a disposable copy.",
      access: "fixed-command"
    }
  ];
}
