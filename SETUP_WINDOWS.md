# Windows setup and verification

RepoMedic targets a low-resource, single-user Windows laptop. Only Node.js, npm, and the already-installed local Ollama runtime/model are required. MongoDB is optional; Docker and another model download are not needed.

## 1. Verify prerequisites

Run PowerShell from the project root:

```powershell
node --version
npm --version
ollama list
```

The model list must contain the exact name `gemma4:e4b`. Check that the local API also lists it:

```powershell
$tags = Invoke-RestMethod -Uri 'http://localhost:11434/api/tags' -TimeoutSec 5
$tags.models | Select-Object name, size
if (-not ($tags.models.name -contains 'gemma4:e4b')) { throw 'gemma4:e4b is not installed in this Ollama instance.' }
```

Try genuine local inference directly, without downloading another model:

```powershell
$body = @{
  model = 'gemma4:e4b'
  prompt = 'Reply with exactly: RepoMedic local inference ready'
  stream = $false
  options = @{ num_ctx = 2048; num_predict = 40; temperature = 0 }
} | ConvertTo-Json -Depth 5
$result = Invoke-RestMethod -Method Post -Uri 'http://localhost:11434/api/generate' -ContentType 'application/json' -Body $body -TimeoutSec 180
$result.response
```

This direct smoke test is distinct from a RepoMedic run. RepoMedic health checks the local API and each analysis records `genuine-local` only after it receives and validates a model response.

## 2. Install and run

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Keep that terminal open. Visit `http://localhost:3000`. The API binds to `127.0.0.1:4000`; Ollama uses `http://localhost:11434`. For a no-model presentation, switch to **Guided demo** in the UI. This is scripted and explicitly labeled; approval still triggers a real test process.

To build and execute the automated backend tests:

```powershell
npm test
npm run build
```

## 3. Inspect resource usage

Ollama may temporarily use substantial RAM while loading the 7.5B quantized model. RepoMedic does not start multiple inferences at once and does not assume GPU acceleration.

```powershell
Get-Process ollama*, node -ErrorAction SilentlyContinue |
  Select-Object Name, Id, CPU, @{Name='WorkingSetMB';Expression={[math]::Round($_.WorkingSet64 / 1MB, 0)}}

Get-CimInstance Win32_OperatingSystem |
  Select-Object @{Name='FreePhysicalMemoryMB';Expression={[math]::Round($_.FreePhysicalMemory / 1024, 0)}},
                @{Name='TotalVisibleMemoryMB';Expression={[math]::Round($_.TotalVisibleMemorySize / 1024, 0)}}
```

If available memory is critically low, close other applications before starting a real inference. Avoid opening multiple analysis runs: they queue sequentially, but their temporary working copies remain available for run history.

## Optional MongoDB history

Without a Mongo URI, execution history is stored in memory and disappears when the backend restarts. If a local MongoDB instance is already available, set this in `.env`:

```text
MONGODB_URI=mongodb://127.0.0.1:27017/repomedic
```

Restart the backend. Startup logs and `GET /api/health` report whether persistence is active. If the configured database cannot connect, startup fails explicitly rather than silently pretending history is durable.

## Troubleshooting

- **`model-missing` or `unavailable`:** start Ollama, run `ollama list`, and confirm the exact `gemma4:e4b` tag and `http://localhost:11434/api/tags`.
- **Inference error:** no provider fallback is attempted. Check Ollama process/memory availability, and retry once enough memory is free.
- **Port already in use:** change `PORT` in `.env` for the backend or edit the frontend `--port 3000` script; also update CORS/API origin settings as needed.
- **Test timeout:** the run is marked failed/not verified. Inspect the exact output and timeout; RepoMedic never labels it verified.
- **Generated proposal requires review:** the patch failed a path/reference/shape constraint. It was not applied.
