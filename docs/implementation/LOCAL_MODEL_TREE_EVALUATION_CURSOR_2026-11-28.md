# VDT Studio local model evaluation for Cursor

Suite LT v1 · 28 November 2026 · 10 cases

## Assignment

Run these cases through the ordinary VDT Studio workflow using the real local Apple model and the installed Ollama models. Cursor operates and evaluates the app. VDT Studio's selected local model makes the business decisions and builds the tree. Deliver a comparison of what each model completed, where each attempt stopped, and which formulas and saved trees were correct.

Read the repository's AGENTS.md first. Use an isolated VDT Studio profile on the project's SSD. Use English in notes, evidence and the handoff. Preserve the language of each user message. Leave application code, prompts, built-in Skills and the evaluation cases frozen throughout the comparison. If instrumentation is needed, use an observation-only runner under the run's evidence directory and record its exact changes. Use the ordinary Supervisor, Gateway, approvals, saved revisions and finish checks. Keep all activity in the disposable workspace.

## Model matrix and execution order

| Row | Provider and model | Preflight |
| --- | --- | --- |
| APPLE | Apple on-device, `SystemLanguageModel.default` | On an eligible Apple Silicon Mac with the system model ready, use a clean VDT profile with no provider preference. For its first case capture the app selecting Apple automatically before the first request. Use the app's actual provider binding. |
| O4 | Ollama, `qwen3.5:4b-q4_K_M` | Choose this existing local model through the app. Record the reported name, model digest and loopback endpoint. |
| O9 | Ollama, `qwen3.5:9b-q4_K_M` | Choose this existing local model through the app. Record the reported name, model digest and loopback endpoint. |

If a named asset is missing, mark that row `BLOCKED`. A different installed model may run as a separately labelled row with its own identity. If automatic Apple selection fails on the eligible clean profile, record that outcome separately. If the exact Apple route is available by ordinary explicit selection, run the comparison in another fresh profile and label the selection explicit. Keep provider settings stable within each row and let models load normally. Record cold or warm when observed, reported context and output budgets, reasoning setting, OS build, hardware, RAM, app revision, launch surface and local network conditions. Keep research off and the VDT Studio chat outcome on Automatic. Use the same portable settings on all rows and document native differences. Keep the Skill picker untouched for every attempt.

1. Start with LT01, LT02A and LT07 on every available model. This is nine first attempts if all three rows are ready. Start Apple with LT01 once its local capability is ready. Run shared-hardware inference serially to avoid competing for memory.
2. Complete the remaining eligible cases on every row, including LT02B as a separate fresh project. Continue independent cases after a failure. Give each case one scored first attempt. Use the same observation limit on every row for a given case. The suggested active limits are 5 minutes for Small, 8 for Medium and 12 for Large. Start at first submit and pause only for tester interaction. Record any earlier provider deadline, then cancel via the app at the limit and capture the last verified state.
3. Rerun LT02A and LT07 once per available model in fresh profiles or projects, rotating model order if practical. Also rerun one representative unexpected failure if time permits. Keep all first results. Report retries and repeatability separately.
4. LT09 is a separate Russian-language result. Capture a capability rejection such as `unsupported_locale` as `BLOCKED` for that row. Keep it separate from semantic failures after live inference. Keep the paired English cases identical across providers.
5. Record offline evidence at its actual scope. A verified network-denied local process, a loopback-only Ollama route and a clean signed installation on a fully disconnected Mac are separate evidence classes. Never disconnect a remote operator without a local handoff. Source-based tests, signed installation and physical speech have independent acceptance. This suite concerns typed editing.

Use existing repository mechanisms where applicable. [Evaluation contract](../AGENT_EVALUATION.md), [workspace evidence and authored Skill setup](../../eval/agent-autonomy/WORKSPACE_JOURNEYS.md), [Ollama baseline](APPLE_LOCAL_AI_OLLAMA_BASELINE_2026-11-25.md), [Ollama isolation](APPLE_LOCAL_AI_OLLAMA_RESIDENCY_2026-11-25.md).

## Operator procedure

- Freeze this file, the app revision and effective Skill catalog before starting. Record SHA-256 for this file, exact per-turn user text and effective Skill content or catalog snapshot. For LT04 record the created Skill IDs, versions and content hashes. On a dirty checkout preserve a source manifest or equivalent diff reference alongside the commit ID.
- Start each attempt with a new VDT and chat, with no prior answers or Skill pin. A root-only draft is permitted when the app requires it. Record the initial saved head and graph. Open a new profile for the Apple default check and use separate storage for LT04 so its two Skills never enter the other cases.
- Send only the fenced user message for that case through the ordinary text composer. Where a scripted answer is listed, send it only after the corresponding material question. Capture the question and checkpoint before answering. Keep expected formulas, probe values, model-to-model comparisons and case labels outside the app. For an unexpected material question, record it verbatim, assess whether the original brief resolves it and stop that branch unless the case lists a matching answer. Record ordinary product approval separately. For an approval request, review the exact proposal and current revision, approve a valid in-scope proposal normally, and preserve the evidence of the decision. If a proposal is wrong, capture and decline it. Give no corrective hints.
- After the terminal response, inspect the saved model and independently reopen it through normal storage. Prefer an actual app or source runtime restart when feasible and record how it reopened. Compare the head, graph digest, formulas, input states, units, reporting basis and relationship evidence with the saved artifact and finish receipt. For failures and timeouts, reopen the last saved checkpoint and report any partial mutation. For LT02A/B and LT04 compare the before-answer graph against the initial one and record any method selection or write that occurred while the business fact was open.
- Compute the evaluator's expected values outside the app. Run each probe independently from the reopened baseline, changing only the described input or inputs. Use the editor on a disposable copy, a non-committing factor probe, or a read-only replay of the reopened project with `calculateGraph(project, { overrides })` from vdt-core. Record the actual node IDs and the values returned by the calculator. Avoid asking the model to grade its own result. For deferred inputs first prove all were blank after reopen. Only then apply the baseline measurements in a copy. For the percentage case normalize to a decimal fraction before comparison. Compare finite numbers with absolute tolerance 0.000001 or relative tolerance 0.000001, whichever is larger.
- Reference shapes below count the root as tier 1 and count unique semantic KPI roles. Accept equivalent expressions and meaningful alternative arrangements. For Large cases, require substantial grouping across three or four tiers, with the channel or generator subtotal and its intermediate relationship inspectable. Check both visual hierarchy and formula dependencies. Do not give credit for decorative depth, hidden constants that should be inputs, duplicated editable facts, or an unrelated branch used as a driver.
- If a legitimate format repair happens naturally, record the field path, initial rejection, model repair or decline, accepted result and any later dispatch. A successful targeted repair keeps the untouched arguments intact. An invalid correction or decline must leave the rejected action undispatched. Record absence as `NOT_OBSERVED` for this diagnostic. Keep any injected fixture or direct-helper replay separate from live model scores.

## Test cases

Sections labelled Oracle are for evaluation only. All numeric inputs described as measured are fixture data from the user.

| Case | Complexity and reference shape | Primary check |
| --- | --- | --- |
| LT01 | Small · 6 KPIs · 3 tiers | Clear built-in Skill, editable measured net contribution |
| LT02A | Small · 5 KPIs · 3 tiers | Clarify first, serial relationship, blank inputs |
| LT02B | Small · 5 KPIs · 3 tiers | Same question, independent outputs and a different formula |
| LT03 | Medium · 7 KPIs · 3 tiers | Weighted rate, denominator, zero handling |
| LT04 | Small · 5 KPIs · 3 tiers | Authored Skill choice after clarifying record overlap |
| LT05 | Small · 6 KPIs · 3 tiers | No matching specialist, nonnegative procurement shortfall |
| LT06 | Medium · 11 KPIs · 4 tiers | Confirmed serial production, time losses, non-bottleneck probe |
| LT07 | Large · 19 KPIs · 4 tiers | Independent generator branches and measured zero |
| LT08 | Large · 20 KPIs · 4 tiers | Shared editable inputs across revenue and cost branches |
| LT09 | Medium · 7 KPIs · 3 tiers | Russian dialogue and editable person-hour inputs |

### LT01 · Monthly pop-up store contribution

**User message**

~~~text
Build an editable factor tree for this month's contribution from our pop-up store, in USD. We completed 100 orders at an average of USD 42 per order before payment fees and packaging. Payment fees totaled USD 120 and packaging totaled USD 380. Those are the only two costs in this contribution measure. Keep the measured drivers editable.
~~~

**Oracle.** Gross sales = orders × average price. Contribution = gross sales − fees − packaging. Expect `finance.revenue_profit` after an actual catalog read and a brief explanation in English. No material question is required. Baseline USD **3,700**. Independently change orders to 125 → **4,750** and fees to 0 → **3,820**. Keep the monthly reporting basis and USD per order scale.

### LT02A and LT02B · Packing capacity with an open relationship

**Initial user message for both cases**

~~~text
Build an editable factor tree for the site's sustainable packing capacity in cartons per hour. The first operation is tracked by the number of running packing heads and the cartons per hour each running head can handle. For the second operation we track its total capacity directly in cartons per hour. Both are on the same steady-state basis. I will enter the three measurements later.
~~~

**LT02A user answer, after the relationship question**

~~~text
They handle the same cartons. Every carton goes through the first operation and then the second. There is no bypass, loss, rework, buffering effect, or shared-resource constraint on the stated steady-state basis.
~~~

**LT02B user answer, after the relationship question**

~~~text
They are two independent packing streams. Each can run at the same time and deliver its own nonoverlapping cartons to the same site output boundary. Cartons from one stream never pass through the other. There is no shared-resource constraint.
~~~

**Oracle.** Before the answer, ask whether the same cartons pass through both operations or the operations deliver independent outputs. Reading candidates is allowed. Selection and graph mutation wait for the answer. Expect `operations.process_capacity` with a read receipt and localized explanation after clarification. Both saved structures contain three editable blanks. First-operation capacity = running heads × capacity per head. The second value is direct. LT02A root = minimum, LT02B root = sum. After reopen use 3 heads, 40 cartons/h/head and 90 cartons/h → **90 / 210 cartons/h**, respectively. Independently change heads to 4 → **90 / 250** and second-operation capacity to 150 → **120 / 270**. A question about missing measurements does not settle the relationship.

### LT03 · Service response within target

**User message**

~~~text
Build an editable tree for the percent of valid support requests our two sites answered within the response target this week. A request belongs to exactly one site and the counts use the same weekly cohort. North received 100 valid requests and answered 90 within target. South received 50 valid requests and answered 20 within target. Within-target requests are part of each site's received count. Report the rate for all valid requests across both sites.
~~~

**Oracle.** One company numerator (90 + 20), one denominator (100 + 50), four editable counts, and one root. Expect consistent fraction-to-percentage conversion. Baseline **73⅓%** (fraction **11/15**). Set South received to 100 → **55%**. On a separate copy set all four counts to 0 → the rate is **unavailable** with a divide-by-zero or undefined-ratio diagnostic. A business explanation may call out the empty denominator. Zero percent or a stale rate fails this probe. No reason to ask which averaging method to use.

### LT04 · Museum accession registers with possible overlap

**Public setup.** In the disposable local Skill library, publish the following two synthetic Skills through the normal authoring path or its existing fixture setup. Store the description and full content exactly. Keep the built-in catalog available. Capture the effective user-authored IDs, versions and hashes. Run this setup only for LT04. If the authored library cannot be set up or read, record a blocker before inference.

| Skill title | Description | Content |
| --- | --- | --- |
| Accession desk reconciliation | Unique museum accession identifiers across the physical Intake and Review desk registers. | Count only accession IDs the desk entered in the two registers this week. Ask whether an accession ID can occur in both registers before choosing the calculation. For a confirmed overlap use the sum of both register counts less the number of shared identifiers. For disjoint registers the overlap is zero. Exclude public catalogue publishing receipts. |
| Public catalogue delivery receipts | Successful delivery receipts from the public catalogue publication ledger. | Count delivered catalogue records only once per destination using successful publication receipts. Deduplicate repeated deliveries for each accession and destination. A publication ledger and destination are required. Intake and Review desk registers are outside this method. |

**Initial user message**

~~~text
Build an editable model for the number of distinct accession IDs our museum desk logged this week. There were 120 IDs in the Intake register and 90 in the Review register. The KPI covers what the desk recorded, regardless of whether the record was ever published to the public catalogue.
~~~

**User answer, after the overlap question**

~~~text
Yes. Sometimes the same accession ID is entered in both registers. This week 35 distinct IDs appeared in both. Within each register an ID counts at most once.
~~~

**Oracle.** Ask if the same accession can occur in both desk registers. Wait before committing the method or editing the graph. Select the authenticated **Accession desk reconciliation** Skill and explain the fit. Never treat the alternate Skill's publication destination as an input. Reference roles are unique accessions, gross registrations, Intake, Review and overlap. Root = Intake + Review − overlap. Baseline **175**. Change overlap to 55 → **155**, or to 0 → **210**. The exact authored receipt and root formula must survive reopen.

### LT05 · Additional mounting kits to buy

**User message**

~~~text
Build an editable planning tree for next week's mounting-kit purchases. The east gallery needs 40 kits for planned installations and the west gallery needs 25. We are holding 5 additional kits as a reserve for the whole building. Inspection found 48 serviceable kits in storage, interchangeable between galleries. Order only the uncovered need. If stock covers everything, the order is zero. All quantities are whole kits.
~~~

**Oracle.** Gross requirement = East + West + reserve. Order = maximum of zero and requirement minus usable stock. Expected baseline **22 kits**. Set stock to 80 → **0**. Set reserve to 0 from the baseline → **17**. Under the stock built-in catalog, search/read as applicable and conclude no specialist supplies this method. Explicitly applicable general decomposition guidance is acceptable if its actual content supports the approach. An admitted, evidenced gap can also pass. A fabricated specialist or a gap recorded without exploring a plausible exact candidate fails. Freeze and record the effective catalog. If it contains an exact specialist for this case, mark the gap assertion blocked by that environment and grade the tree separately.

### LT06 · Finished clinic kit production

**User message**

~~~text
Build an editable tree for the good clinic kits our plant can finish in a typical week. The same kits go through forming and then assembly. There is no bypass, storage smoothing, rework, or other loss between the two operations. Each runs no faster than its stated rate during usable hours. Forming is scheduled for 60 hours, has 8 hours of downtime, and forms 25 kits per usable hour. Assembly is scheduled for 50 hours, has 5 hours of downtime, and assembles 24 kits per usable hour. We expect 30 fully assembled kits to fail final inspection each week. Count only kits that pass inspection.
~~~

**Oracle.** Effective hours are scheduled hours minus downtime. Stage capacities are **1,300** and **1,080 kits/week**. Gross finished volume is their minimum. Good volume subtracts final rejects once, producing **1,050**. Raise forming rate to 30 → **1,050**. Set assembly downtime to 0 → **1,170**. Model both schedules and both rates independently. Exclude any unstated availability rates or extra losses. The reference may combine effective hours into each stage formula rather than making two extra KPI nodes.

### LT07 · Weekly net electricity across three generators

**User message**

~~~text
Build an editable, grouped factor tree for net electricity delivered this week by generators A, B and C. They supply independent feeders. Their net exports are all counted at the site boundary and never overlap. Each generator makes electricity at the stated kW while it is actually running. The site's figures for each generator are listed as scheduled hours, outage hours inside that schedule, output while running in kW, and electricity consumed onsite before the boundary in kWh. A has 40, 4, 25, and 10. B has 32, 2, 20, and 0. C has 24, 4, 15, and 20. Keep each generator and the calculation of its operating hours visible as you drill down.
~~~

**Oracle.** One site root plus three distinct generator groups. Each group's six roles are net electricity, running hours, kW, onsite kWh, scheduled hours and outage hours. Net = running hours × output kW − onsite consumption. A **890**, B **600**, C **280**, site **1,770 kWh**. B's zero consumption is a measured zero. Change B outages to 7 hours → **1,670** while A/C are unchanged. Change C onsite consumption to 0 → **1,790** while A/B are unchanged. Keep kW distinct from kWh and document the weekly grain. The graph must contain actual grouping and editable inputs across four reference tiers.

### LT08 · Weekly contribution across three order channels

**User message**

~~~text
Build an editable factor tree for weekly order contribution in USD. We have Direct, Partner and Corporate channels with disjoint orders. Show each channel's revenue and variable fulfilment cost. Within a channel, both calculations use the very same completed-order count. Direct completed 100 orders with USD 38 net revenue and USD 12 fulfilment cost per order. Partner completed 60 at USD 30 and USD 9 per order. Corporate completed 20 at USD 100 and USD 25 per order. Deduct USD 900 of shared weekly support costs once at company level. Keep the channel breakdown and its editable quantities and rates.
~~~

**Oracle.** One root, common support cost, three channel contributions and two calculated components per channel. Each channel has exactly one editable count referenced by its revenue and fulfilment formulas and separate editable prices/costs per order. Expected channel contributions **2,600 / 1,260 / 1,500**, company **4,460 USD**. Set Direct orders to 150 → **5,760**, with both Direct components moving. Set Corporate orders to 0 → **2,960**, with both Corporate components zero. Set shared cost to 1,200 → **4,160**, with the three subtotals unchanged. A valid shared reference or equivalent single-input graph passes. Two editable copies of the same order count fail even when the baseline matches. Expect an appropriate finance Skill and a brief explanation.

### LT09 · Трудозатраты на монтаж в выставочных залах

**User message**

~~~text
Построй редактируемое дерево KPI для еженедельных трудозатрат на монтаж новых экспонатов в двух залах. Северная команда установила 18 экспонатов, средние трудозатраты составили 1,5 человеко-часа на экспонат. Южная команда установила 12 экспонатов, в среднем по 0,75 человеко-часа. Экспонаты не пересекаются между залами. Считаем только монтаж за эту неделю, без демонтажа и доставки. Оставь количества и трудозатраты на один экспонат редактируемыми.
~~~

**Oracle.** Each hall's effort = installations × person-hours per installation. Total = both hall efforts. Expected **36 person-hours**. Set South installations to 0 → **27**. Set North installations to 25 → **46.5**. The model should preserve the Russian decimal meaning and reply in Russian. There is no missing business fact in the brief. Generic guidance or a substantiated specialist gap is acceptable under the built-in catalog.

## Scoring and report

Use a separate score for each real attempt. Mark provider capability and infrastructure blockers separately from the behavior of a model that received a request. Apply the same rules to all rows.

| Dimension | Points | Evidence required |
| --- | ---: | --- |
| Business scope and dialogue | 20 | 10 for the correct KPI boundary and period, 10 for handling the material question and wait correctly or proceeding without a redundant question in clear cases. |
| Skill method | 15 | 5 for discovery and relevant reads, 5 for the evidence-backed method or allowed gap and its order, 5 for a brief appropriate-language explanation. |
| Editable tree | 25 | 10 for essential roles and editable measurements, 10 for hierarchy and operative dependencies, 5 for units, measurement provenance and blank/zero semantics. |
| Calculation and sensitivity | 25 | 10 for baseline or a correctly incomplete structural baseline plus its post-reopen measurement result. Split the remaining 15 equally across the listed independent probes. |
| Finish and persistence | 15 | 5 for the real finish receipt appropriate to the delivery, 5 for reopen and matching saved artifact, 5 for a factually supported final response and a complete approval/evidence chain. |

Use `PASS` when the score is at least 90 and the hard gates below hold. Use `FAIL` when complete evidence demonstrates a wrong outcome or missed gate. Use `TIMEOUT` for unfinished attempts at the cap. Use `BLOCKED` for a missing prerequisite that prevented the attempt or a specific assertion, and `INCONCLUSIVE` when evidence cannot resolve a verdict. Give affected subchecks their own status. Record a partial score on unsuccessful inference only where the evidence permits it. Blocked and inconclusive cases have their own counts. Retain failures and timeouts in the denominator for cases that reached model inference.

**Hard gates.** Use the exact bound real local model. Require the correct business relationship and appropriate Skill or evidenced gap, including an unchanged graph and no committed Skill while the required answer is pending. Require correct essential dependencies, inputs, units and results for the baseline and all specified probes. Require ordinary approvals and a verified finish tied to the exact reopened result. A mathematically valid tree that answers a different business question, an invented measurement, or a write before required clarification fails even if the final root happens to match. For blank cases, assess the saved structure at the structural finish and supply measurements later as evaluator probes.

Store results under a new `output/local-model-tree-eval/<run-id>/` on the repository SSD. Keep evidence per model, case and attempt. Use the following report columns.

| Model/digest | Case/attempt | Status/score | Question and read/selection/gap evidence | Pre-answer/Saved/Reopened head | Root, tiers and matched roles | Baseline and observed probes | Timings and terminal stage | Failure cause and evidence path |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

- Keep exact requests/answers, transcript, action and approval receipts, observed identity, saved and reopened project data or snapshots, independent role-to-ID mapping, probe results, error details and cancellation confirmation. Use relative artifact paths in the report. Exclude credentials and unrelated user data. Capture first response, question, first committed change and verified finish timings when available. Distinguish observed evidence from inference when naming a failure cause.
- Summarize first-attempt pass counts by model, complexity and case, plus repeatability on LT02A and LT07. Report the paired LT02A/B outcomes together. Separate infrastructure, model or adapter format, Skill choice, business question, formula/unit, storage and finish failures. Report latency on matched completed cases and the number of timeouts. Include one concrete reason and evidence link for every unsuccessful case.
- Mark remaining coverage in the report. Keep test-fixture, live-source, signed-install and physical-audio evidence separate. Leave release decisions to the owner reviewing the results. Remove only owned temporary profiles and build artifacts after collecting the evidence and waiting for child processes to exit. Record cleanup and any retained large files.
