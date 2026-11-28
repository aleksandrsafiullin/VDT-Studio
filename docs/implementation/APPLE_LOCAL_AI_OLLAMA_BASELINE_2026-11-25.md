# Ollama compatibility baseline, 25 November 2026

L01 measures the existing local Model Agent route at `f96c84f5d0ee4c372a48950827d2f511cb9e32fb`. It uses archived source, disposable storage and an observation-only interceptor in the measurement process. Route handlers execute directly under Node 24. These timings cover admission, inference and durable runtime work, and exclude Next.js HTTP transport, browser rendering, speech and interaction latency.

The Mac reports Apple M3, 16 GiB, macOS 27.0.1 build 26A434 and macOS SDK 27.2. Node is v24.15.0. The installed Ollama server reported 0.40.16 and `cloud.disabled=false`. Every inference request used the fixed loopback daemon, a pinned local model from its installed catalog and redirects disabled. This is compatibility evidence. Offline release qualification remains untested.

| Installed model | Quantization | Catalog digest |
|---|---|---|
| `qwen3.5:4b-q4_K_M` | Q4_K_M | `d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04` |
| `qwen3.5:9b-q4_K_M` | Q4_K_M | `56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90` |

## Cases

- The library replay preserves the exact Russian Excavation brief, blank-root graph, 60-step budget, permission to use editable assumptions, automatic patching and research Off from the [historical 35-node run](../AI_HARNESS.md#local-library-completion-evidence-2026-10-17). It explicitly pins `mining.load_and_haul` v1, which the prior run selected autonomously. Fresh project and VDT IDs prevent reuse of the old revision. The input remains local. The helper records its hash and the selected Skill version. The shared benchmark's two-fleet topology predicate applies to its own fixture and therefore cannot certify this graph. The pinned local route also carries unverified admission and is ineligible for the shared benchmark qualification.
- The direct greeting probe isolates the Ollama transport. It requests exactly `Привет!` or `Hello!` with temperature 0, 16,384 requested context tokens, and 256 maximum output tokens. A sample passes only when the complete visible content matches the literal greeting. A timeout or literal mismatch stays in the denominator. The first sample can pay prompt or context setup costs even when the model is resident. Warm and cold describe observed presence in `/api/ps` before the request. The probe does not unload or prewarm models. It does not characterize editor or voice latency.

## Direct greeting observations

| Model / reasoning | Language / residency | Exact matches / attempts | Accepted wall time, median and range | Other outcomes |
|---|---|---:|---|---|
| 4B Off | RU / warm | 3/3 | 1.247 s, 0.702–10.134 s | First sample had a 9.830 s wait for visible content and 0.801 ms reported model load |
| 4B Off | EN / warm | 0/3 | — | Three completed responses differed from the literal target. Wall time was 0.291–0.836 s |
| 4B On | RU / warm | 0/3 | — | Three 20 s timeouts before visible content |
| 4B On | EN / warm | 0/3 | — | Three 20 s timeouts before visible content |
| 4B Default | RU / warm | 0/3 | — | Three 20 s timeouts before visible content |
| 4B Default | EN / warm | 0/3 | — | Three 20 s timeouts before visible content |
| 9B Off | RU / cold | 0/1 | — | Completed with a literal mismatch after 12.194 s, including 10.649 s reported load |
| 9B Off | RU / warm | 0/2 | — | Two completed responses differed from the literal target. Wall time was 1.090–1.119 s |
| 9B Off | EN / warm | 3/3 | 0.862 s, 0.577–1.274 s | GPU reported for the resident model |

The 4B On and Default cohorts and 9B Off overlapped an offline Rust build. The 9B Off cohort observed 14% free memory and 6,030 MiB swap after its final request, versus 24% and 4,157 MiB before the cohort. These observations describe shared-system pressure under concurrent work. Three cold greetings per language, 9B On/Default and a clean idle comparison remain untested.

## Pinned library observations

The comparison budget was 300 seconds per serial run, with a fresh workspace and pinned Skill for each sample. The cold 4B Off run timed out at 300.055 s and cancellation was confirmed. The first model content appeared at 112.206 s and the first completed validated engine exchange at 149.714 s from admission. Two complete decisions read the pinned Skill and compiled its recipe. Neither committed a mutation, and the third inference was cancelled. There was no saved revision or verified finish. This is 0/1 for the configuration at the observation cap.

The two complete 4B calls spent 100.445 s and 72.622 s in prompt evaluation, versus 37.491 s and 27.083 s in generation. Actual prompt counts were 7,990 and 13,151 tokens. Serialized requests measured 43,273 and 75,266 bytes, of which 1,533 and 12,034 bytes respectively were the request's format schema. The transport sent `think=false`, 16,384 context tokens and a 4,096-token output limit on all three calls. Cold load was 8.562 s. These durations overlap their total API durations and the observation wall time. The model reported GPU placement after loading. The host started with 6,956 MiB swap and 14% free memory during concurrent compilation. The samples cannot support a 2× performance claim or identify an idle-hardware bound.

The cold 9B Off run timed out at 300.040 s and cancellation was confirmed. The first model content appeared at 159.084 s and the first completed validated exchange at 213.295 s. That decision read the pinned Skill. The next inference was cancelled. There were no mutations, saved revisions or verified finish, for 0/1 at the cap. The first request was 43,273 bytes with a 1,533-byte format schema and 7,987 evaluated prompt tokens. Ollama reported 4.433 s load, 154.309 s prompt evaluation and 54.212 s generation. The daemon reported GPU placement at 16,384 context tokens. The system started the case at about 3,538 MiB swap and a one-minute load average of 27.34, then finished at 3,714 MiB swap and load average 5.37. A concurrent compile overlapped the start of the run.

Three independent samples per library configuration, warm library runs, library On/Default, a completed independent semantic assessment and a matched latency comparison remain untested. The two formal timeouts stay in the denominator, and the preserved historical completion has its own environment and measurement boundary. Further application-level coverage for Revenue, EBITDA, scoped corrections and physical voice has independent acceptance cases.

Durable operation and revision receipts are the authoritative library counts. Some nested timing summaries in the general benchmark omit structured supervisor work in this baseline. Read the per-call observations and `receiptMetrics` before using the general benchmark's counters.

## Reading the evidence

The individual JSON files and the combined `baseline-runs.csv` and `baseline-calls.csv` are in `output/apple-local-ai-voice-2026-11-25/l01/`. Quantities without evidence are JSON null or blank CSV cells. Outputs contain sizes, times, counters, identifiers for public model and Skill variants, and result codes. The interceptor forwards original response bytes unchanged and retains no content or thinking text.

- Durations from Ollama are divided by 1,000,000. Its total, load, prompt-evaluation and generation timers each retain their API meaning. Provider timers, call wall time, host receipt intervals, and end-to-end wall time overlap, so they are not added. Tool and save durations separately use the union of each receipt type's observed intervals.
- Serialized request and schema bytes are measured from the actual outgoing API request. Requested context and output budget come directly from request parameters. Active context length, residency and placement use `/api/ps`. Reported VRAM is a placement indicator on shared-memory hardware. Prompt and output token counts come from terminal frames. Exact serialized token count before evaluation, cache hits and queue time remain unknown where unavailable. Header-to-content time includes server and client overhead.
- First content is measured at the interceptor; the first completed engine exchange is the first durable validated-decision proxy. Start to first inference includes general host admission and setup. Neither the host queue interval nor a distinct repair interval is inferred from a remainder. Repeat rejection codes, applied proposals, mutation receipts, persisted revision outcomes and finish receipt state remain separate.
- The two rehearsal starts are preserved in `library-shakedowns.json`. Both were intentionally cancelled after measurement-export issues were found, and are outside the planned comparison cohorts.

## Reproduce

Archive the sealed source into a unique disposable directory. Link the frozen tree's package-local `node_modules` symlink structure to the installed dependency store while keeping `@vdt-studio` workspace references relative to the archived sources. Copy `scripts/measure-ollama-baseline.mjs` and `scripts/agent-build-benchmark.mjs` into that tree. Run from the archive and give the loopback daemon one inference owner at a time.

```sh
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
export VDT_APP_MODE=development_web
export VDT_DATA_DIR="$PWD/disposable-data"
export VDT_HARNESS_CONFIG="$VDT_DATA_DIR/harness.json"
export TSX_TSCONFIG_PATH="$PWD/apps/web/tsconfig.json"

node --import tsx scripts/measure-ollama-baseline.mjs \
  "$historical_evidence_dir" "$artifact_dir/library-4b-off-1.json" \
  qwen3.5:4b-q4_K_M off 300000 1
node --import tsx scripts/measure-ollama-baseline.mjs \
  greeting "$artifact_dir/greeting-4b-off.json" qwen3.5:4b-q4_K_M off 20000 1
node --import tsx scripts/measure-ollama-baseline.mjs \
  csv "$artifact_dir" "$artifact_dir/baseline"
```

The historical directory is the path in the [October evidence inventory](../AI_HARNESS.md#local-library-completion-evidence-2026-10-17). The replay consumes `autonomous-qwen35-library-v2-start-request.json` and `autonomous-qwen35-library-v2-create-request.json`, whose file SHA-256 digests are `02e75086be5380afa68f00f75b60bc8128e79480fd0fb8742bd6293f9043d59b` and `07b913f771faea5790c7190f22eff0bcaa47f874722fd58d2fb57a4e42e7986c`. Pass `on` for explicit thinking, `default` to omit the toggle, and `qwen3.5:9b-q4_K_M` for the second installed variant. Keep each result path unique. The sampled processes exclusively used the installed daemon and left its lifecycle and configuration untouched.
