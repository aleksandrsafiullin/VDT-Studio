# AI response contract repair, 2026-11-11

This repairs existing agents and Smart preparation. No new tool/provider,
publication or automatic Apply is authorized.

## Confirmed causes

Live `gpt-5-nano` returned `USD per item`, accepted by the output schema but
rejected by the unit parser. A subsequent reply added `/month` to a period total.
The legacy tool registry supplied property names without types/bounds; the
in-product catalog also discarded deeply nested constraints. Semantic typing
restarted selected/hover inference for each edit. Generic errors concealed the
specific validation/provider failure. Original GPT-5 mini/nano cards now omit
effort metadata, leaving only Provider default, which can exceed Smart's deadline.
Ordinary API completions also used Zod only after inference without transmitting
that response schema. JSON mode alone did not tell the model its decision or
question shape. A live nano agent reproduced repeated schema-invalid questions.
Cursor also produced malformed JSON inside `callsJson` strings on large batches.
Its ordinary v2 decision prompt/schema now uses canonical nested objects/arrays;
the reader still admits historical flat responses. Codex strict-output and Smart
task schemas retain their existing representations.
Legacy decision prompts also incorrectly included checkpoint `action_batch`,
`run.request_finish` and receipt instructions, despite exposing only the
`call_tool`/`call_tools`/`ask_user`/`finish` decision schema. Protocol-specific
instructions now share argument/validation duties without mixing envelopes or
waiting for an unavailable finish receipt. Checkpoint engines keep their own
unchanged control protocol.

## Model and host responsibilities

Preparation v15 supplies `responseContract` through every API/CLI/paired/local
path. It uses shared validator limits, the unit parser and recipe resolver:

- JSON/group, size, AST, reference, coefficient and effective-factor requirements.
- Exact target dimensions/scales/period, machine-unit grammar and spelling aliases.
- Eligible recipes with resolved child units and exact keys/concepts/formulas.
  Unit compatibility alone does not establish business applicability.

Trusted execution regenerates the contract, upgrades historical task envelopes
and rejects caller modifications. The response schema also constrains machine
unit syntax and group IDs. The graph keeps its 24 KiB allowance independently
of fixed requirements/schema/instructions, within the unchanged 192 KiB final
envelope and existing selected-Skill content allowance.

Ordinary agents receive full argument JSON Schemas derived from their actual Zod
validators, including nested types, required fields, enums and numeric/string/
array/record bounds. Result-dependent calls must wait for the preceding tool
result; batching cannot guess skill/node IDs. Procedural/business requirements
remain in the shared prompts and tool descriptions.
API and Ollama adapters now also transmit full Zod response contracts in their
system instructions when no explicit provider wire schema has been supplied.
Existing explicit wire schemas remain authoritative; local validation is kept.
Legacy ordinary decisions now share the existing hierarchy/context/file-scope
instructions. User-value writeback receives the exact grounding prerequisites
before inference, with quote lengths shared by prompt and validator. Converted
values cannot be disguised as literal user facts or estimated to evade grounding.
The existing derived-root finish requirement is shared with the prompt too:
source facts belong in input leaves and the root references those drivers.
Derived outputs do not need user-supplied literal quotes. A constant-only result
is not a completed VDT, even when its arithmetic happens to be correct.

The live haulage test's automatic respondent also had defects: grouped questions
received one answer, underscore-separated hour IDs could receive `5 haul trucks`,
and a payload multiplier received tonnes. Its synthetic respondent now fills all
fields in their requested units, distinguishes these quantities and refuses
unknown numeric fields. Automatic patch Apply is explicit only for this owned
in-process synthetic fixture; production approval policy is unchanged.

Identity, credential authority, freshness, process cleanup, revision/CAS,
transactions, numerical reconciliation and explicit Apply are host-owned checks.
The model must not fabricate their metadata. Supplying requirements does not
make model output trusted or guarantee business reasoning quality.

## Execution changes

Known currency codes normalize case consistently (`Usd` = `USD`). Opaque atoms
remain case-sensitive; no scale or currency conversion is inferred. Speculative
work waits 350 ms after semantic edits; explicit Retry bypasses that delay.
Stale-output and confirmed-cleanup ownership rules remain enforced. Fixed safe
error codes distinguish truncation, refusal, auth/quota/rate/model failures and
formula/unit rejection without echoing upstream errors or secrets.

The exact original GPT-5/mini/nano aliases and 2025-08-07 snapshots use the
[documented family effort levels](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5)
after selected-card identity verification. Future/private IDs gain no inferred
support. Unsupported Off stays visible; named effort/default choices remain
explicit. One-call budgets and no-repair/no-fallback Smart execution remain.

## Evidence boundary

Tests cover contract forwarding/tampering, resolved recipes, unit spelling,
typing bursts/Retry, stale replies, nested tool schemas and safe errors.
Unit-suite concurrency is bounded to two workers to avoid fixture process/SQLite
startup starvation on the QA Mac; deadline and cleanup assertions are retained.
Live `gpt-5-nano` Low returned all four net-revenue factors and passed actual
selected-provider preparation/materialization. Minimal also produced a formally
valid two-factor response that omitted deductions; it is not quality acceptance.
On the repaired ordinary-agent protocol, live Cursor `composer-2.5` and Codex
`gpt-5.6-luna` each completed the same natural-language net-revenue case without
operator answers or an upfront formula/tool sequence. Both retained all four
quoted source inputs, calculated 4,900 USD and passed independent changes to
quantity, price, discount and refunds. This is one case through the runtime and
real CLI transports, not installed native UI or provider-wide qualification.
Nano / Low did not complete the full-agent case; it repeatedly sought user
confirmation or retained a constant result and remains unqualified for this path.

The final source release aggregate passed: 3,565 unit tests, three known expected
failures, eleven skipped cases, production build, security audit, provider/task
contracts, release bundle/SBOM and clean offline CLI installation. All 151 browser
tests passed without flaky retries. Desktop shell/sidecar and documentation checks
passed. Full-agent, natural-business and packaged/native qualification remain
distinct. Final run results and limitations are recorded in the local release
audit at `output/release/audits/2026-11-11-ai-repair.UERTFM/ACCEPTANCE.md`.
The CLI clean-install verifier copies its tarball to its own short temporary
path, avoiding pnpm store-filename `ENAMETOOLONG` errors on deep APFS audit paths.

## Nano full-agent follow-up

The original compatibility run repeatedly tried to write the derived answer
as a literal root formula or value. An initial missing-root-value diagnostic
survived successful structural validation and was repeated in every decision.
An empty builder was also advertised as a current project, with draft-only
tools still offered. Follow-up traces exposed routine plan confirmations,
invalid one-call plural envelopes, a completion truncated entirely in
reasoning, and missing guidance on unit-price units and formula syntax.

The decision context now carries the current construction prerequisite and
the actual draft root ID. Full tool schemas remain available for tools that can
run at that stage; the registry enforces their draft prerequisite. The graph
validation history remains available for audit, while superseded errors and
expected unfinished-root feedback are removed from active decision guidance.
The model is told to derive the requested output from source inputs and use
the existing approval flow. One otherwise valid call in the plural wire
envelope is normalized to a single call; malformed arguments are not repaired
by guessing. The legacy mutation and finish paths reject a standalone root
for a new driver tree. Ordinary reasoning-agent decisions have a bounded
4,096-token implicit allowance and a specific incomplete-output failure path;
the selected effort and Smart budgets are unchanged.

The OpenAI-compatible compatibility adapter sends one fresh observation
instead of retaining obsolete observations. Strict tool batches use a native
array of typed call items, rather than a second JSON array inside a string.
Each encoded argument object is checked before normalization. The exact
registered question schema is supplied alongside the question wire field;
malformed questions cannot become synthesized user prompts. Bounded literal
quotes are collected by the same helper as local Model Agent observations.
This helps the model choose an exact source phrase without assigning it to
a node or transforming its value. Unit diagnostics identify operand repair
as the next step, without changing any unit automatically.

The final live test used the application's compatibility provider adapter
with the original natural requests, exact nano model and fresh in-memory
drafts. The complete net-revenue case did not pass on Low. It constructed
four inputs but retained a price unit without its denominator, then
returned rejected tool arguments. Medium exhausted the 4,096-token
allowance on its second call and paused without a duplicate request.
Low correctly asked for the missing selling price in the separate
missing-fact case; it retained the supplied quantity and left price and
root result unknown. Two additional Smart runs ended in unit rejection
and a timeout. All attempts are retained in
`output/release/audits/2026-11-11-nano-agent.VSXxbp/VERIFICATION.md`.
These are runtime/transport checks; a native Mac installer and broad
model qualification are outside this follow-up.

## Native arguments and explicit source units

In the public OpenAI Model Agent route, the provider returned HTTP 400 for
the open `args` record in the strict turn schema. JSON mode then accepted
responses with invalid plan fields. The direct API now projects the pinned
tool catalog into a strict schema and restores the canonical action batch
before the Supervisor checks it. The same strict percent validation applies
to the working observation and final receipt for newly generated trees.
The first strict live run proposed questions for the empty root and facts
already present in the request. Direct construction turns now retain the
original brief, expose the current construction stage and review proposed
questions once before delivering them.
The next natural run produced a valid plan with a reused model-authored call
ID. The adapter now derives call IDs from the confirmed exchange and call
position, as the native local transport does.
The next result calculated 4,900 USD with an inline refund literal. Direct
new-tree verification now reports a quoted monetary literal with no sourced
input in the root dependency tree. The model receives the exact quote before
it can request a receipt.

The failed nano trace carried an exact price quote, while the driver unit
was an unconstrained currency string. The strict response covered batch
items, with their arguments serialized as text. It could therefore admit a
well-formed envelope whose inner arguments were malformed or used fields
from a different tool.

The OpenAI-compatible adapter now projects the admitted closed builder
schemas into structured argument objects keyed by tool name. Native
questions and finish decisions use the registered response shapes. Other
tools keep their encoded argument representation. The tool registry and
the existing mutation and finish validators remain the authorities for
actual execution. The schema projection uses nullable optional fields as
required by [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat).

Quoted numeric observations retain explicit currency per-item and percent units.
Dollar wording inherits USD only when the brief specifies USD or the
quote identifies US dollars. Filling a new, empty input created by this
run can complete a provisional currency or percent unit from the exact quote.
The value, source note and unit are part of the same reviewable mutation.
The first two recalculations returned 4,900 USD with a stale or missing plan.
A subsequent run had a consistent plan but treated the quoted 10% as a
fraction of 10, producing −54,500 USD. The finish gate for a new tree now
requires a consistent plan and checks percent scaling. Both validations are
sent in the current model observation, and the strict response omits finish
while they report blocking errors.

After the percentage repair, a live run calculated the correct total but kept
both a subtotal and its inputs directly under the root. New typed runs now
record a plan before adding factors and use the existing planned-parent and
layer checks. The schema also exposes native arguments for branch reparenting
and redundant-node removal. These repairs use the existing mutation review.
When the graph projection is complete, the schema binds existing-node fields
to actual node IDs and batch fills to unresolved leaves. The next decision
gets the current plan and graph so it can observe new IDs before using them.
The model gets each native argument shape in the response format and the
full textual shape for each encoded tool.

Smart API recipe choices are constrained to the compatible recipes in the
response contract. Each recipe branch fixes the formula, factor identities,
units and group length. A custom branch still uses its model-authored
formula and the same validation rules. Envelope sizing includes the API
schema. The successful live results and earlier failed samples are
preserved in the local verification report.

On the final build, the public Model Agent completed the original retail
request and a separate guided case on `gpt-5-nano` Low. Each produced a
four-leaf plan, a verified result of 4,900 USD and a finish receipt. Four
independent source changes reproduced the expected values in each graph.
The guided request specified layout and node IDs. The original request
remained unchanged. A separate attempt on the final build asked for redundant
confirmation. An earlier writeback labelled the quoted 10% as `decimal`.
The first-fill mutation now resolves that provisional label to `%`.
