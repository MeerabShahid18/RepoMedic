# Demo guide

## One-minute setup

From the project root in PowerShell:

```powershell
ollama list
npm install
npm run dev
```

Open `http://localhost:3000`. The sample report is prefilled: `GET /api/users/2 returns 404 even though a user with ID 2 exists.`

## Reliable guided presentation (no model dependency)

1. Select **Guided demo**. The UI explicitly says the diagnosis and patch are fixed scripted demo data, not model output.
2. Select **Start analysis**. Watch the state machine and live activity advance. The app lists/read-inspects the real sample repository and prepares a run-specific working copy.
3. Review the root cause, file references, full before/after replacement, and suggested regression assertion. The UI states that the suggested assertion itself was not inserted or executed.
4. Select **Approve patch & run test**. This is the required human approval action.
5. Inspect the actual `node --test test/users.test.js` command, process exit code, output, and timestamps. The test is run by Node on a copy after applying the approved patch. A passing real test shows `VERIFIED`; no result is mocked.

## Genuine local model presentation

Keep the mode set to **Local model**. The backend first checks the local Ollama service and then sends the bounded prompt to exactly `gemma4:e4b`. A successful analysis is marked **Genuine local inference**. Ollama/model errors are shown explicitly; switch to demo mode only if a deterministic presentation is preferred. It never falls back silently.

On an 8 GB system, allow time for the existing model to load and avoid launching parallel presentations. RepoMedic serializes local model calls.

## Reproduce the bug before the fix

In a separate PowerShell terminal:

```powershell
Push-Location .\demo-repo
node --test test/users.test.js
Pop-Location
```

The assertion for ID `2` fails on the original code because it indexes the array by the ID. The approved demo correction uses an ID comparison. After a RepoMedic run, the original `demo-repo/src/users.js` remains unchanged; the accepted change and verification belong only to that run's temporary copy.

## What to point out to judges

- AI inference, scripted demo content, proposed source changes, and actual test evidence have separate labels.
- The patch requires an explicit approval; an analysis run alone cannot write the source tree.
- Tool registration is inspectable at `GET http://127.0.0.1:4000/api/tools`.
- Progress is observable over SSE at `/api/runs/{id}/events`.
- The test runner uses a fixed no-shell command and records process output/exit status. Explain that a working copy is not a true OS sandbox and arbitrary untrusted repos are intentionally unsupported.
