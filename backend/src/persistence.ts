import type { Model } from "mongoose";
import { z } from "zod";
import type { ExecutionRun } from "./harness";

const persistedRunSchema = z.object({
  id: z.string(),
  repositoryId: z.literal("demo-express"),
  bugReport: z.string().max(2000),
  mode: z.enum(["ollama", "demo"]),
  state: z.enum(["CREATED", "ANALYZING", "INVESTIGATING", "DIAGNOSING", "PATCH_PROPOSED", "TESTING", "VERIFIED", "FAILED", "NEEDS_REVIEW"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  model: z.string(),
  inference: z.enum(["pending", "genuine-local", "demo-scripted", "failed"]),
  analysis: z.object({
    summary: z.string(),
    rootCause: z.string(),
    confidence: z.number(),
    references: z.array(z.object({ path: z.string(), reason: z.string() })),
    regressionTest: z.string()
  }).optional(),
  patch: z.array(z.object({ path: z.string(), before: z.string(), after: z.string() })).optional(),
  testEvidence: z.object({
    command: z.string(),
    exitCode: z.number().nullable(),
    output: z.string(),
    timedOut: z.boolean(),
    passed: z.boolean(),
    startedAt: z.string(),
    completedAt: z.string()
  }).optional(),
  error: z.string().optional(),
  workDirectory: z.string().optional(),
  events: z.array(z.object({
    id: z.string(),
    runId: z.string(),
    type: z.enum(["state", "progress", "result", "error"]),
    state: z.enum(["CREATED", "ANALYZING", "INVESTIGATING", "DIAGNOSING", "PATCH_PROPOSED", "TESTING", "VERIFIED", "FAILED", "NEEDS_REVIEW"]),
    message: z.string(),
    at: z.string(),
    data: z.unknown().optional()
  }))
});

let runModel: Model<Record<string, unknown>> | undefined;
let queue: Promise<void> = Promise.resolve();
let persistenceError: string | null = null;

export async function initializePersistence(): Promise<ExecutionRun[]> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) return [];
  const mongoose = await import("mongoose");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000, maxPoolSize: 1 });
  const schema = new mongoose.Schema({}, {
    strict: false,
    versionKey: false,
    collection: "execution_runs"
  });
  runModel = mongoose.model<Record<string, unknown>>("RepoMedicExecution", schema);
  const records = await runModel.find().sort({ updatedAt: -1 }).limit(100).lean().exec();
  const restored: ExecutionRun[] = [];
  for (const record of records) {
    const parsed = persistedRunSchema.safeParse(record);
    if (parsed.success) {
      const run = parsed.data;
      if (["CREATED", "ANALYZING", "INVESTIGATING", "DIAGNOSING", "TESTING"].includes(run.state)) {
        run.state = "FAILED";
        run.error = "Backend restarted during this run; no further test result was recorded.";
        run.updatedAt = new Date().toISOString();
        run.events.push({
          id: `restart-${run.id}`,
          runId: run.id,
          type: "error",
          state: "FAILED",
          message: run.error,
          at: run.updatedAt
        });
      }
      restored.push(run);
    }
  }
  return restored;
}

export function persistRun(run: ExecutionRun): Promise<void> {
  if (!runModel) return Promise.resolve();
  const record = {
    id: run.id,
    repositoryId: run.repositoryId,
    bugReport: run.bugReport,
    mode: run.mode,
    state: run.state,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    model: run.model,
    inference: run.inference,
    analysis: run.analysis,
    patch: run.patch,
    testEvidence: run.testEvidence,
    error: run.error,
    workDirectory: run.workDirectory,
    events: run.events
  };
  queue = queue.then(async () => {
    await runModel?.updateOne({ id: run.id }, { $set: record }, { upsert: true }).exec();
  }).catch((error: unknown) => {
    persistenceError = error instanceof Error ? error.message : "Unknown MongoDB persistence error.";
    console.error("RepoMedic MongoDB persistence failed:", persistenceError);
  });
  return queue;
}

export function getPersistenceStatus(): { enabled: boolean; error: string | null } {
  return { enabled: Boolean(runModel), error: persistenceError };
}
