# VDT Studio {{VERSION}} — feedback alpha

<!-- Local authoring template only. Do not publish with unresolved placeholders.
Use the exact W6-qualified installers, not a rebuild. Complete both platform rows.
Remove this comment only after the coordinator accepts the delivery package. -->

VDT Studio helps you build, calculate and compare Value Driver Trees. This alpha
is intended for feedback on the workflows listed below.

Source: `{{FULL_COMMIT_SHA}}` · Build: `{{BUILD_IDENTITY}}`

## Install

| Platform | Tested OS versions and architecture | Installer asset | SHA-256 |
| --- | --- | --- | --- |
| Mac | {{MAC_TESTED_OS_AND_ARCHITECTURE}} | {{MAC_VERSIONED_ASSET_LINK}} | `{{MAC_INSTALLER_SHA256}}` |
| Windows | {{WINDOWS_TESTED_OS_AND_ARCHITECTURE}} | {{WINDOWS_VERSIONED_ASSET_LINK}} | `{{WINDOWS_INSTALLER_SHA256}}` |

The apps include their runtime. You do not need Node, pnpm, Rust or a separately
started local runner. AI features may require the selected provider's account,
official CLI or local model service; manual modeling does not require AI setup.

{{EXACT_MAC_INSTALL_AND_UPGRADE_STEPS_FROM_ACCEPTANCE}}

{{EXACT_WINDOWS_INSTALL_AND_UPGRADE_STEPS_FROM_ACCEPTANCE}}

{{RECORDED_SIGNATURE_TRUST_BEHAVIOR_AND_ANY_SUPPORTED_PREREQUISITES}}

Checksums and provenance: {{CHECKSUM_MANIFEST_AND_NOTICES_LINKS}}

## Start with a small model

1. Create a project and VDT, then give the root KPI a unit and reporting period.
2. Add inputs and formulas, review model warnings and compare a scenario.
3. Save a milestone in **Versions**, close the VDT and reopen it.
4. For AI assistance, open **Settings → Execution mode** and configure one of the
   combinations qualified below. Review proposed changes before using the result.

Projects are local. Requests to a cloud provider use that provider's service.

## What was accepted

{{LINK_TO_SANITIZED_ACCEPTANCE_SUMMARY_FOR_THESE_EXACT_INSTALLER_HASHES}}

| OS/architecture | Provider, model and reasoning | Accepted workflows | Known limitations |
| --- | --- | --- | --- |
| {{PLATFORM}} | {{MANUAL_OR_EXACT_AI_CONFIGURATION}} | {{MEASURED_WORKFLOWS}} | {{LIMITATIONS_OR_NONE_OBSERVED_WITH_SCOPE}} |

{{CLEAN_INSTALL_UPGRADE_PERSISTENCE_RECOVERY_AND_FILE_IMPORT_RESULTS}}

{{LIVE_ATTEMPT_COUNTS_FAILURES_LATENCY_AND_EXPERIMENTAL_COMBINATIONS}}

## Known limitations

{{USER_VISIBLE_LIMITATIONS_AND_RECOVERY_ACTIONS}}

Only the platforms and workflows listed above are qualified. Public hosted
deployment is outside this release.

## Send feedback

Open [a bug report or workflow suggestion](https://github.com/aleksandrsafiullin/VDT-Studio/issues/new/choose).
Include the version/build, OS/architecture, reproduction steps and expected versus
actual behavior. For AI issues, include the provider, model and reasoning setting.

{{ACCEPTED_HELP_AND_DIAGNOSTIC_EXPORT_UI_PATH}}

Preview any diagnostic export before attaching it. Issues are public: exclude
credentials, private projects, raw prompts/source files, personal paths and
unreviewed logs or screenshots. A small synthetic example is sufficient.
