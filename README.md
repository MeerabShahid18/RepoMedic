# RepoMedic AI — From Bug Report to Verified Fix

RepoMedic is a local-first maintenance assistant for tracing a bug report to a reviewable patch and real test evidence. **A proposal is never applied until a person approves it.** The hackathon MVP includes a responsive Next.js dashboard, an Express/TypeScript model harness, the local `gemma4:e4b` Ollama integration, an optional MongoDB history adapter, and a tiny Express sample repository with a reproducible lookup bug.

## What works in this MVP

- Next.js, React, TypeScript, Tailwind CSS, Express, and Zod.
- Genuine local inference through `http://localhost:11434` using the exact `gemma4:e4b` model. No hosted AI and no silent model fallback.
- Explicit deterministic **Guided demo** mode, labeled as mock/scripted and not presented as AI inference.
- State machine, structured model response validation, bounded retry, one-at-a-time model calls, run activity, and SSE progress.
- Registered read-only tools for file listing, safe file reads, literal code search, and project metadata.
- Patch path/content validation and an explicit human approval gate.
- A real, fixed Node test command on a separate working copy with time, output, and file-size limits.
- Captured command, exit code, output, timeout, and timestamps; only a successful process can mark the run verified.
- MongoDB/Mongoose persistence is optional. With no `MONGODB_URI`, there is no database service requirement and run history is in memory.
- OpenAPI document: [backend/openapi.yaml](./backend/openapi.yaml).

## Quick start (Windows PowerShell)

Requirements: Node.js 20+ and npm; Ollama with `gemma4:e4b` already installed. MongoDB and Docker are not required.

```powershell
ollama list
Invoke-RestMethod -Uri 'http://localhost:11434/api/tags'
Copy-Item .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`. The backend listens only on `127.0.0.1:4000`. The default analysis mode is genuine local inference. The API reports a clear error if Ollama or the exact model is unavailable. Choose **Guided demo** to demonstrate the approval and test flow without model inference; the executed regression test remains real.

For detailed verification and laptop resource commands, see [SETUP_WINDOWS.md](./SETUP_WINDOWS.md). For a repeatable presentation, see [DEMO_GUIDE.md](./DEMO_GUIDE.md).

## API and operational docs

- [SKILLS.md](./SKILLS.md): tool contracts and instructions for coding agents.
- [ARCHITECTURE.md](./ARCHITECTURE.md): components, workflow, and resource budget.
- [SECURITY.md](./SECURITY.md): trust boundaries, limitations, and local safety controls.
- [TEST_REPORT.md](./TEST_REPORT.md): exact validation performed and evidence.
- API base URL: `http://127.0.0.1:4000/api`.

## Sample bug

The sample service looks up users by array position instead of user ID. The bundled `node --test test/users.test.js` test fails against the original source and passes after the correct approved patch. To run the sample Express service independently, install its dependency from `demo-repo` and start it:

```powershell
Push-Location .\demo-repo
npm install
npm start
Pop-Location
```

Then request `http://localhost:5050/api/users/2`.

## Scope and limitations

This is a deliberately bounded MVP: only the bundled sample repository is registered; analysis patches only existing `src/*.js` files; the UI's suggested regression assertion is not silently inserted or executed; history is memory-only unless MongoDB is explicitly configured. The test runner operates in a disposable copy and does not invoke a shell, but **it is not a Windows security sandbox**. Do not point it at untrusted repositories. See [SECURITY.md](./SECURITY.md) before extending repository support.
