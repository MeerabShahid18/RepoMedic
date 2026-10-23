# Security and safety

## Implemented controls

- API binds to loopback (`127.0.0.1`), disables `X-Powered-By`, uses Helmet, restricts CORS to the configured local frontend origin, and limits JSON bodies to 32 KB.
- Repository selection is an ID from a static registry, not a client-supplied filesystem path. This MVP registers only `demo-express`.
- Read tools reject absolute/traversal paths, check canonical paths and symlinks, restrict file types, and bound file count, file size, and search output.
- Model endpoint configuration is restricted to HTTP loopback. Redirects are rejected. The exact configured model is sent to Ollama; there is no provider or model fallback.
- Bug report and model response use Zod validation. Model-referenced files must be in the listed inventory; patch paths are restricted to existing `src/*.js` files.
- Patch validation does not write. An explicit user approval is required to apply the patch to that run's temporary copy.
- Tests use a fixed Node executable and fixed arguments without a shell; time and output are capped. The original sample checkout is not changed by approval.
- Model calls are sequential. API run state and transitions are observable, and invalid proposals/errors do not become success-shaped verification.

## Important limitation: not an OS sandbox

The fixed test runner prevents model-controlled command strings and keeps writes out of the source checkout, but Node test code is still executable code running as the current Windows user. A disposable copy is **not** a security boundary against malicious JavaScript. This demo must not be pointed at untrusted repositories. Before enabling arbitrary repository imports, add a real isolation layer (for example, a dedicated restricted account or appropriately hardened container/VM) and test its filesystem, network, process, CPU, memory, and cleanup boundaries. Docker is not required or assumed by this MVP.

The demo sample itself is editable by the local user. The test runner is intended for this tiny, trusted bundled fixture. Do not claim it safely executes arbitrary third-party tests.

## Data handling and AI provenance

In genuine mode, only the bounded issue report, metadata, and selected source/test excerpts are sent to the configured loopback Ollama API. Nothing is sent to a hosted model by RepoMedic. A malicious Ollama URL is rejected. The UI labels genuine local inference separately from deterministic demo mode. Demo mode does not contact any model.

Execution history is memory-only by default. Setting `MONGODB_URI` explicitly enables MongoDB persistence; use a local database with appropriate access control. Patch proposals and captured test output may contain source data. Clear MongoDB records and run directories (`$env:TEMP\repomedic-ai\runs`) according to your data-retention needs.

Test output and repository text are untrusted and are displayed as text, not interpreted as HTML. Do not copy commands from model output and run them.

## Remaining hardening before production

This hackathon MVP has no user authentication or multi-user authorization, no per-user tenant isolation, no distributed job lock, no durable external audit log, no automated cleanup scheduler for temporary run copies, and no Windows Job Object resource quota. It is intended for a single-user local demo, not an internet-facing deployment. Add CSRF/auth controls and an OS-enforced sandbox before exposing it beyond loopback or supporting third-party repositories.
