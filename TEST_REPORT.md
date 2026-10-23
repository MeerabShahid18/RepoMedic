# RepoMedic AI Test Report

## Verified locally

- `ollama list` includes `gemma4:e4b`.
- `http://localhost:11434/api/tags` returns the Gemma 4 model.
- Direct generation smoke test succeeded:
  `{"model":"gemma4:e4b","response":"local inference works","done":true}`
- `npm test` passed: 7/7 backend tests passed.
- `npm run build` passed: backend TypeScript and Next.js frontend compiled successfully.
- Demo approval flow passed end-to-end: the sample bug moved through `PATCH_PROPOSED` to `VERIFIED` after the user-approved patch and executed `node --test test/users.test.js` with exit code 0.

## Important limitation on this laptop

The local Gemma 4 run uses a low-memory, CPU-only setup. The single orchestrator run can take longer than the default browser-driven timeout if the model is cold-starting and the system is memory constrained. The app is configured to use a bigger timeout and a smaller prompt context so model inference remains bounded and safe. It still does not substitute another model or silently claim a verified result without actual test evidence.

## Commands used

```powershell
ollama list
Invoke-RestMethod -Uri 'http://localhost:11434/api/tags'
$body = @{ model='gemma4:e4b'; prompt='Reply with exactly: local inference works'; stream=$false; options=@{ num_ctx=2048; num_predict=20; temperature=0 } } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri 'http://localhost:11434/api/generate' -ContentType 'application/json' -Body $body -TimeoutSec 180
npm test
npm run build
```
