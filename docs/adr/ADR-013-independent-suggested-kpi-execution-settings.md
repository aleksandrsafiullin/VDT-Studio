# ADR-013: Independent Suggested KPI model and reasoning

- Status: accepted decision; integrated verification recorded separately
- Date: 2026-11-02
- Amends ADR-008 preparation settings and ADR-012 harness selection. It does not
  change Gateway, formula, transaction, explicit Apply or release authority.

## Decision

Suggested KPI has its own model and reasoning preferences under Settings →
Execution mode. It uses the selected connection. The initial model choice is
Same as chat; choosing another model never changes the conversation model.
Preferences belong to the connection source, including its endpoint or runner,
and reasoning choices belong to the selected Smart model.

Reasoning is explicitly Off by default. It is not inherited from chat. Available
levels come from the selected model's actual capabilities. Off is a request to
disable reasoning, not an absent override or an alias for Low. When a provider
cannot establish or accept an explicit Off control, preparation must explain
the limitation before inference. The user may explicitly choose Provider
default or a supported model/level. There is no hidden reasoning fallback.

The resolved model and reasoning choice participate in the prepared execution
identity. Metadata admission, completion and action-time revalidation use the
same choice. A setting change invalidates preparation/cache identity and cannot
retarget an in-flight request or make a stale proposal eligible for Apply.
Reasoning controls never grant tool, executable, endpoint or environment
authority.

Smart HTTP admission reuses the strict direct-Host reconciliation for Next's
local URL reconstruction: actual Host and Origin must agree, both authorities
must be local on the same port, and cross-site requests are rejected. Forwarded
headers cannot create that authority. Global remote-origin policy is unchanged.

The value is carried through existing HTTP, paired runner and private desktop
paths. Adapters map it to their provider's native controls; unsupported values
fail with a concrete reason. An ordinary non-reasoning model does not need a
fabricated thinking parameter when its metadata proves that property.

## Reused architecture

The existing declaration registry and shared ACP stdio session remain the
integration port. The six additional presets are Kimi Code, Mistral Vibe, Kilo
Code, Qwen Code, Grok Build and Pi. Pi uses its documented RPC command/event
protocol behind the common session interface. New preset definitions and Pi
session shapes follow the OpenDesign approach, adapted to the current official
CLIs and VDT's denied-native-tools checkpoint policy.

Sources: [OpenDesign registry](https://github.com/nexu-io/open-design/blob/12d970eacc8971150e3c76470d2a9afe16dc2ed1/apps/daemon/src/runtimes/registry.ts),
[ACP expectations](https://github.com/nexu-io/open-design/blob/12d970eacc8971150e3c76470d2a9afe16dc2ed1/docs/new-agent-runtime-acp.md),
[Pi definition](https://github.com/nexu-io/open-design/blob/12d970eacc8971150e3c76470d2a9afe16dc2ed1/apps/daemon/src/runtimes/defs/pi.ts).
Older fallback model lists and permissive tool approval flags are not an
executable compatibility contract for VDT.

## Qualification

Integration, deterministic fixtures, browser checks and independent code review
are separate evidence from live subscription eligibility, provider semantics,
native packaging and platform certification. New providers remain experimental
until the relevant evidence exists. The separate read-only Smart task retains
its input/output bounds, deadline, confirmed cancellation and explicit Apply.

See [Harness connections](../HARNESS_CONNECTIONS.md) for the current setup and
qualification boundary.
