import cors from "cors";
import express, { type Request, type Response } from "express";
import helmet from "helmet";
import path from "node:path";
import { z } from "zod";
import {
  approveAndTest,
  createRun,
  getRun,
  getRunEvents,
  getToolCatalog,
  listRuns,
  publicSnapshot,
  registeredRepository,
  restoreRuns,
  subscribe
} from "./harness";
import { getPersistenceStatus, initializePersistence } from "./persistence";
import { getLocalOllamaBaseUrl } from "./ollama";
import { runRequestSchema } from "./schemas";

import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const app = express();
const port = Number(process.env.PORT) || 4000;
const webOrigin = process.env.WEB_ORIGIN || "http://127.0.0.1:3000";
const allowedOrigins = new Set([webOrigin, "http://localhost:3000", "http://127.0.0.1:3000"]);
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin))
}));
app.use(express.json({ limit: "32kb" }));

function routeRunId(request: Request, response: Response): string | null {
  const id = request.params.id;
  if (typeof id !== "string") {
    response.status(400).json({ error: "A single run ID is required." });
    return null;
  }
  return id;
}

app.get("/api/health", async (_request, response) => {
  const model = process.env.OLLAMA_MODEL ?? "gemma4:e4b";
  try {
    const base = getLocalOllamaBaseUrl();
    const ollamaResponse = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!ollamaResponse.ok) throw new Error(`Ollama returned HTTP ${ollamaResponse.status}.`);
    const tags = z.object({ models: z.array(z.object({ name: z.string() })) }).parse(await ollamaResponse.json());
    const installed = tags.models.some((item) => item.name === model);
    response.json({
      status: "ok",
      ollama: installed ? "ready" : "model-missing",
      model,
      inferenceMode: "local-only",
      persistence: getPersistenceStatus(),
      message: installed ? `${model} is available locally.` : `${model} is not listed by the local Ollama service. No substitute will be used.`
    });
  } catch (error) {
    response.json({
      status: "ok",
      ollama: "unavailable",
      model,
      inferenceMode: "local-only",
      persistence: getPersistenceStatus(),
      message: error instanceof Error ? error.message : "Cannot reach local Ollama."
    });
  }
});

app.get("/api/repos", (_request, response) => response.json({ repositories: [registeredRepository()] }));
app.get("/api/tools", (_request, response) => response.json({ tools: getToolCatalog() }));
app.get("/api/runs", (_request, response) => response.json({ runs: listRuns() }));

app.post("/api/runs", (request, response) => {
  const parsed = runRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid run request.", details: parsed.error.flatten() });
    return;
  }
  try {
    const run = createRun(parsed.data);
    response.status(202).json({ run: publicSnapshot(run) });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not start run." });
  }
});

app.get("/api/runs/:id", (request, response) => {
  const id = routeRunId(request, response);
  if (!id) return;
  const run = getRun(id);
  if (!run) {
    response.status(404).json({ error: "Run not found." });
    return;
  }
  response.json({ run: publicSnapshot(run) });
});

app.get("/api/runs/:id/events", (request: Request, response: Response) => {
  const id = routeRunId(request, response);
  if (!id) return;
  const run = getRun(id);
  if (!run) {
    response.status(404).json({ error: "Run not found." });
    return;
  }
  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.flushHeaders();
  const send = (event: unknown) => response.write(`data: ${JSON.stringify(event)}\n\n`);
  for (const event of getRunEvents(run.id)) send(event);
  const unsubscribe = subscribe(run.id, send);
  const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 15_000);
  request.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
});

app.post("/api/runs/:id/approve", async (request, response) => {
  const id = routeRunId(request, response);
  if (!id) return;
  try {
    const run = await approveAndTest(id);
    response.json({ run: publicSnapshot(run) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not approve patch.";
    response.status(message === "Run not found." ? 404 : 409).json({ error: message });
  }
});

app.use((_request, response) => response.status(404).json({ error: "Not found." }));
app.use((error: unknown, _request: Request, response: Response, _next: express.NextFunction) => {
  console.error("Unhandled API error:", error);
  response.status(500).json({ error: "An unexpected API error occurred." });
});

void initializePersistence().then((history) => {
  restoreRuns(history);
  app.listen(port, "127.0.0.1", () => {
    console.log(`RepoMedic API listening on http://localhost:${port}`);
    console.log(`Repository registry: ${registeredRepository().id}`);
    console.log(`MongoDB history persistence: ${getPersistenceStatus().enabled ? "enabled" : "disabled (in-memory history)"}`);
  });
}).catch((error: unknown) => {
  console.error("RepoMedic could not initialize configured MongoDB persistence:", error);
  process.exitCode = 1;
});
