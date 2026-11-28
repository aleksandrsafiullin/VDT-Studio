# Ollama Model Agent context and output budget

L03 bounds the native Ollama Model Agent request before inference. For supported structured turns, the provider sends the current checkpoint and evidence once, with the original brief and relevant immutable opening context. The ordinary transport path remains for unrecognized prompt shapes. The request gets a focused Skill or calculated-tree instruction set when the existing generic construction prompt applies. Existing specialist structural and workspace prompts retain their instructions.

The projection preserves exact user answers, constraints, Skill pin and read receipts, current revision, stable graph IDs, data and research lineages, manual reconciliation and failed writes. It uses the current readable graph and existing table-encoded subtree results, stage-specific native format, tool guides and previously cached confirmed knowledge. Fields already present in an exact current Skill read are omitted from the cache copy without changing the source receipt or any cache-only fields. It keeps the atomically validated input-value and sibling batches. The original Gateway action schemas and verification still govern writes. The budget hook can set only messages, context size and output reserve on the admitted model request. It does not change endpoints, reasoning, credentials or the native format schema.

The host requests the smallest of 4,096, 8,192 and 16,384 context tokens that fits a planning estimate, including the serialized request and its native response grammar, provider framing allowance and output reserve. Estimation uses roughly one token per three ASCII bytes or two non-ASCII bytes with a 64-token allowance. This rule is a budget filter and cannot reproduce Ollama tokenization. The provider-reported prompt token count and raw wire sizes remain separate metrics. Default or thinking-enabled runs reserve up to 4,096 output tokens, including hidden thinking. Reasoning-Off Skill stages reserve up to 768, small tool stages up to 1,024 and wider action batches up to 3,072. At the largest window, an Off batch may reserve 2,048 or 1,024 tokens to preserve the full evidence. If the combined wire estimate still exceeds 16K, a native format up to 48 KiB within a 96 KiB wire ceiling can use the largest window when the separate message estimate and output reserve fit. The response format remains intact. Smaller caller caps take precedence. The Skill reserve accommodates the required Russian opening and structured action together.

Oversize requests fail before dispatch. When Ollama reports a prompt token count that exhausts the reserved context, processing stops before any tool action. Output marked truncated is discarded before parsing. If the initial window can grow, the host can retry once with the same approved input and format under the original deadline. The retry uses a bounded larger reserve when the output limit caused truncation. At the cap, the user can narrow the scope and start from the saved draft. No partial batch is applied.

## Comparison method

The live comparison replays the exact pinned synthetic Russian Load & Haul brief from [L01](APPLE_LOCAL_AI_OLLAMA_BASELINE_2026-11-25.md). It uses the same sealed source `f96c84f5d0ee4c372a48950827d2f511cb9e32fb`, with only the L03 budget hook and report instrumentation applied in an isolated source archive. Explicit reasoning Off keeps the wire choice matched to L01. Run admission uses fresh disposable workspaces and one installed model at a time. Model digests, effective request limits, actual sizes, resource conditions and terminal outcomes are in the redacted `l03/` artifacts.

The 300-second deadline is an observation cap. Failure to reopen an independently accepted tree remains a failed completion observation. Latency can be compared as accepted completion only after an equivalent verified result is available. Call counts at the cap describe progress and use distinct denominators when the provider emits fewer completed turns.

## 9B Off, cold

| Measurement | L01 | L03 |
|---|---:|---:|
| First serialized request, bytes | 43,273 | 14,264 |
| Second serialized request, bytes | 72,332 | 37,964 |
| First completed prompt, observed tokens | 7,987 | 2,687 |
| First content from run submission, s | 159.084 | 57.165 |
| First completed validated decision, s | 213.295 | 133.327 |
| First completed prompt evaluation, s | 154.309 | 51.675 |
| First completed generation, s | 54.212 | 76.106 |
| Inference calls / completed engine exchanges | 2 / 1 | 2 / 1 |
| Verified library finish / attempted | 0 / 1 | 0 / 1 |

The first and second requests shrank by 67.0% and 47.5%. L03 requested an 8,192-token window with a 768-token output reserve for the first turn and a 16,384-token window with a 3,072-token reserve for the second. It retained the same first native format schema at 1,533 bytes and the second schema at 12,034 bytes. The first prompt's planning estimate was 5,243 input tokens and the second's was 13,143. The first validated action read the pinned Skill. Both samples were cancelled at the cap after one completed action with no project mutation or saved revision. L03 began at lower measured CPU load, with a one-minute load average of 4.20 versus 27.34 at L01 admission. The wire reduction is measured. The wall-time difference combines multiple causes and gives no accepted completion speed result.


## 4B Off, cold

| Measurement | L01 | L03 initial candidate |
|---|---:|---:|
| First serialized request, bytes | 43,273 | 14,264 |
| First completed prompt, observed tokens | 7,990 | 2,688 |
| First content from run submission, s | 112.206 | 33.515 |
| First completed validated decision, s | 149.714 | 70.570 |
| First completed prompt evaluation, s | 100.445 | 28.030 |
| First completed generation, s | 37.491 | 37.041 |
| Inference calls / completed engine exchanges | 3 / 2 | 1 / 1 |
| Verified library finish / attempted | 0 / 1 | 0 / 1 |

The first L03 call used an 8,192-token window and 768-token output reserve. It was a successful pinned Skill read. The next projected request was rejected by the initial fixed 3,072-token reserve and conservative 16K estimate, before Ollama received it. The run reached recovery required after 71.621 seconds with no saved mutations. L03 retains this failed attempt. The correction deduplicates exact cached Skill fields from an admitted current read and tries a smaller batch reserve at 16K before reporting overflow. The corrected source also supports one bounded larger-window retry if a received turn turns out to be truncated or exceeds its context reserve.


## 4B Off, warm correction

The corrected, resident replay read the pinned Skill and committed one decomposition-plan revision. It used 14,264 and 35,081 bytes on its two provider calls, with 2,682 and 5,194 observed prompt tokens. The request after the confirmed plan again reached recovery required before dispatch, at 259.040 seconds. The full-wire estimate was conservative relative to observed message token counts. A final deterministic correction measures messages and native grammar separately and retains both within their respective bounds. It has no live acceptance result yet. This warm sample is a diagnostic follow-up to the cold attempt. None of these three candidates finished a calculable library tree for independent business review.

The focused test suite covers exact current and original scope, zero-valued nodes, quoted facts and Skill pin/read receipts, atomic batches, manual reconciliation, provider identity and reasoning unchanged by the hook, the 4K/8K/16K ladder, schema budget, separate grammar fallback and refusal of partial output. An independent code review accepted the deterministic envelope contract. Live held-out quality, repeated cold/warm acceptance, a 4K library run and an equivalent verified completion time remain untested. The observed wire reductions do not establish fewer calls to a finished tree.
