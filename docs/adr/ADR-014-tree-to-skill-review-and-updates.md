# ADR-014: Reviewable tree-to-skill creation and updates

- Date: 2026-11-03
- Status: Implemented local V1 workflow; independent code reviews passed

## Product decision

An open tree exposes **Work with skills** in Context. This separate workflow
contains **Save as new skill** and **Update used skill**. Excel export keeps its
existing action. Settings → Skills remains the single working-file library.

The workflow opens a reviewable, unsaved draft. New-skill instructions can be
edited before an explicit library save or portable SKILL.md download. An update
shows separate proposed changes, their reasons, before/after text and supporting
tree nodes. The user chooses and edits accepted changes before saving a new
version. Closing or cancelling cannot publish a draft.

This explicitly amends ADR-010's external-editor-only UI decision for generated
draft/proposal review. It does not add a general filesystem manager or replace
the user's external editor. The earlier Settings → Skills → From this VDT
creation path remains compatible.

Trees using universal fallback guidance create a new thematic skill. The
tree-update workflow cannot specialize the shared universal skill. Other
editable working skills remain governed by their declared applicability.

## Authoring boundary

The author receives bounded semantic tree context: structure, original formulas,
units and modelling descriptions/assumptions. Dedicated baseline/scenario values,
dataset rows and source paths are excluded. Text remains untrusted source data;
the prompt cannot execute a node's instructions or grant new tools.

Creation generalizes the modelling method, required inputs, applicability and
checks. Update authoring compares the exact Context-pinned version, the latest
working guidance and the tree. A missing branch is not a request to remove
general guidance. Project exceptions and speculative generalizations require
human review.

The existing selected API/local/CLI provider performs inference through the
registered agent-decision transport. Only the expected author output is admitted;
no returned tool executes. No provider/model is silently substituted. Original
executable topology is host-attached only after deterministic validation, with
numeric source defaults omitted. Generated prose is never a certified domain
method merely because its schema validates.

Local/CLI author preparation allows up to 300 seconds; remote API preparation
retains 90 seconds. Both create and update use one shared budget for provider
execution and caller/deadline cancellation, with a 330-second route lifetime.
The review dialog displays real elapsed time and the captured maximum wait;
Cancel remains available. Deadline exhaustion reports a safe HTTP 504 separately
from cancellation or invalid model output. These author-specific budgets do not
change chat, Suggested KPI or global runtime limits. See
[the follow-up evidence](../implementation/SKILL_AUTHOR_LOCAL_TIMEOUT_2026-11-03.md).

## Update ownership and conflicts

An update proposal owns exact latest working Markdown and its file hash, the
latest admitted immutable version/content hash, and the source pin's version,
content hash and selection revision. Model changes must have unambiguous,
nonoverlapping anchors. Only selected changes are applied; unrelated guidance
and package resources are preserved. Metadata and executable topology are not
model-authored patches.

Draft preparation grants no publication authority. Saving rechecks VDT ownership,
the pin and current library/file identity. Stale versions, changed selections,
deleted/invalid files and competing edits fail instead of replacing newer work
or recreating removed files. A no-op must not manufacture another version.
Rejected managed saves must not leave a phantom latest immutable version. If
history became visible before a final filesystem check failed, the matching
working file is preserved and an explicit HTTP 503 outcome is reported. An
unreadable publication outcome also preserves working bytes rather than risking
destructive compensation; neither case is automatically retried.

Accepted publication appends an immutable local V1 version. It does not mutate
the source tree, reselect its Context skill or replace bytes already pinned by
other trees/runs. The browser fences late results to the captured tree, semantic
source and selection; changed context requires regeneration.

## Scope and qualification

All operations retain trusted-local/same-origin bounded request guards. The
feature does not introduce a native command, sidecar resource, new model task
schema, autonomous publisher or V2 repository/read-receipt/grant protocol.
Filesystem working-file and history publication remain local V1; no crash-atomic
two-file transaction or general process-loss recovery is claimed.

Implementation/review evidence and remaining limits are recorded in
[the execution plan](../implementation/SKILL_WORKFLOW_2026-11-03.md).
Deterministic provider fixtures establish workflow contracts separately from
live model quality. Packaged-native and Windows/Linux qualification remain
separate, and the overall production/release status is unchanged.
