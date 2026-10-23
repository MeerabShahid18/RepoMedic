# Architecture

## Runtime layout

```text
Next.js dashboard :3000
       │ JSON + Server-Sent Events
       ▼
Express / TypeScript harness :4000 (127.0.0.1 only)
       ├── Zod request/model validation
       ├── registered bounded repository tools
       ├── Ollama local HTTP API :11434 (gemma4:e4b only)
       ├── optional MongoDB/Mongoose execution history
       └── fixed Node test process in a temporary working copy
```

`frontend/src/app/page.tsx` owns the dashboard and live run view. `backend/src/server.ts` defines the HTTP and SSE surface. `backend/src/harness.ts` owns lifecycle, tool orchestration, approvals, copies, and test evidence. `backend/src/tools.ts` implements the registry and path restrictions. `backend/src/ollama.ts` sends a single bounded structured request to the local Ollama API. `backend/src/persistence.ts` activates Mongoose only when `MONGODB_URI` is set.

## Controlled lifecycle

```text
CREATED → ANALYZING → INVESTIGATING → DIAGNOSING → PATCH_PROPOSED
                                                   │ human approval
                                                   ▼
                                                TESTING → VERIFIED | FAILED
                         invalid proposal ───────→ NEEDS_REVIEW
```

Runs are kept in process memory for the initial local setup; if MongoDB is configured, run state/events are also upserted to `execution_runs` and up to 100 records are loaded at startup. A server restart marks interrupted nonterminal inference/test runs `FAILED` rather than assuming completion. Model calls are globally serialized in a single process. Model calls have a bounded timeout and at most one retry; response structure is checked with Zod and file paths are checked against the tool allowlist.

The model receives up to four source/test excerpts, each capped at 12 KB, plus bounded project metadata and the issue report. Ollama generation uses a 4,096-token context, 1,400-token output ceiling, low temperature, and non-streaming response to keep behavior and memory bounded.

## Patch and test evidence

The model proposes full contents for at most two existing `src/*.js` files. RepoMedic validates the candidate paths, confirms targets are regular files under the sample root, and displays before/after content. It does not write into the source repo. Only after the approval endpoint is called does it update the run's temporary copy and invoke:

```text
node --test test/users.test.js
```

The child process is spawned without a shell, receives a minimal environment, is terminated after the configured maximum of 30 seconds (15 seconds by default), and has combined output capped at 30 KB. The UI records exact command, exit code, timeout, output, and timestamps. `VERIFIED` requires exit code 0 and no timeout.

## API

The OpenAPI 3.1 contract lives in `backend/openapi.yaml`.

- `GET /api/health` — local Ollama/model availability and optional persistence status.
- `GET /api/repos` — the allowlisted repository catalog.
- `GET /api/tools` — registered agent tool descriptions.
- `GET /api/runs` / `GET /api/runs/{id}` — run history/detail.
- `POST /api/runs` — validate and enqueue an issue (`202`).
- `GET /api/runs/{id}/events` — SSE replay + live progress.
- `POST /api/runs/{id}/approve` — explicit approval, apply in copy, run tests.

## Low-memory choices

- No Docker, MongoDB, or background queue is required.
- The UI and API run as the only required local services; Ollama is already installed.
- Analysis context, file inventory, response, retry, test duration, and test output are capped.
- Model calls run sequentially; no parallel generation or model downloads.
- Optional Mongoose uses a one-connection pool and stays disabled when its URI is absent.
- The model's native runner/GPU choices are left to the existing Ollama installation; RepoMedic does not assume GPU acceleration.
