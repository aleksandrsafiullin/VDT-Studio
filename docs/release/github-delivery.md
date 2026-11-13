# GitHub feedback-release delivery

This guide prepares one reviewable GitHub prerelease containing the accepted Mac
and Windows applications. It does not declare a candidate ready or publish it.
The [readiness assessment](../implementation/OPEN_ALPHA_READINESS_2026-11-13.md)
and [remediation plan](../implementation/OPEN_ALPHA_REMEDIATION_PLAN_2026-11-13.md)
define the current gates. Both desktop platforms are required for that scope.

The repository is already public. At the 13 November audit, GitHub Releases had
no entries and the release workflow listed CLI assets only. A source archive,
CLI tarball, successful static desktop test or unsigned CI build is not an
accepted end-user installer.

## Prepare the local handoff

Use a new candidate directory. Keep the per-platform output intact and assemble
the delivery package from W6's accepted bytes; do not rebuild an installer while
preparing publication. Record all filenames, including version and architecture,
from the actual package metadata.

The handoff needs these artifacts:

| Artifact | Required contents |
| --- | --- |
| Mac installer | The accepted `VDT-Studio-<version>-arm64.dmg`, or another explicitly accepted architecture, with signature/notarization evidence. |
| Windows installer | The accepted `VDT-Studio-<version>-x64-setup.exe`, or another explicitly accepted architecture, with signature/trust evidence. |
| Per-platform metadata | `macos-package.json` / `windows-package.json`, `SOURCE_COMMIT`, `SHA256SUMS` and `native-artifact-verification.json` from the packaging/verifier path. |
| Delivery manifest and checksums | Exact app version and full source commit, platform/architecture, installer names, byte sizes and SHA-256 hashes; all installers must resolve to the same source commit. |
| Public acceptance summary | Tested OS versions, clean install and upgrade results, storage/recovery checks, advertised provider/model/reasoning matrix and per-attempt outcomes, remaining limitations, reviewer and candidate identity. |
| Provenance and notices | Applicable dependency/SBOM and third-party license notices, including bundled runtimes and any separately distributed resources. Keep the MIT license. |
| Release body | Completed [prerelease template](github-prerelease-template.md), linking the real assets and public acceptance summary. |

W5's native artifact verifier runs on the corresponding native host:

```text
node scripts/verify-native-alpha-artifact.mjs OUTPUT_DIR --source-commit FULL_SHA
```

The strict result checks the actual packaged runtime/resources and trust evidence.
The `--allow-unsigned-validation` option is for validation artifacts and cannot
authorize the public release. The package metadata's `qualification: "unverified"`
is intentional: artifact integrity/trust and installed-app/live acceptance are
separate. W6 must supply the latter for the exact hashes; do not convert the field
to a pass merely because static or source tests succeeded.

## Match the claims to the evidence

The public support matrix needs one row per OS/architecture and advertised
provider/model/reasoning combination. It must distinguish manual workflows,
connection checks, live generation/editing, Smart, file import and recovery.
Mac evidence does not certify Windows. The configured minimum OS is not evidence
that the application was tested there.

Before marking the handoff ready:

- Check that the commit, app version and diagnostic build identity agree across
  source, both installers, checksums and the release body. Record source state;
  do not turn a dirty working tree into an apparent commit-only release.
- Download/copy the staged installer bytes into clean native environments and
  complete W6 acceptance without preinstalled developer runtimes. Record native
  trust prompts, cold offline launch, persistence, upgrade, recovery and process
  cleanup.
- Verify source quickstart from a clean clone on every OS claimed for development.
  A Windows build host without a usable project-storage workflow does not pass.
- Recompute each staged asset hash and compare it with the accepted manifest.
  Collect the same accepted files for later upload; keep any rebuilt candidate
  separate and repeat its required acceptance.
- Retain failed attempts, skipped tests and experimental provider combinations
  in the acceptance record. Do not advertise an unsupported combination because
  it appears in a picker or connects successfully.
- Review the public evidence for credentials, private projects, raw prompts,
  source-file contents, personal paths and identifying screenshots. Publish a
  concise sanitized summary; ignored local `output/` paths are not public links.
- Resolve every placeholder in the release body and verify its installer links,
  support table, upgrade instructions, known limitations and feedback destination.

Do not require testers to disable security controls, install a development toolchain
or erase their profile as part of normal installation/recovery. If an operation
cannot meet the supported-user workflow, retain a named blocker.

## First-use and feedback path

The README starts with platform availability, then a short manual-modeling path
and optional provider setup. Keep that entry point current when a release is
accepted: replace the pending status with actual versioned assets and tested OS
versions. Preserve the separate source quickstart and deeper implementation notes.

Use the [issue chooser](https://github.com/aleksandrsafiullin/VDT-Studio/issues/new/choose)
for bugs and workflow feedback. The bug form asks for build identity, platform,
reproduction, expected/actual behavior, optional AI configuration and reviewed
evidence. A diagnostic file remains local until the user deliberately attaches it;
neither generating a report nor opening the issue form submits it.

## Final handoff to the coordinator

Return the local candidate directory, exact manifest/checksums, completed release
body, public evidence files and verification command results. State **ready for
publication review** only after both accepted installers and all required evidence
are present. Otherwise return **HOLD** with the unresolved artifact/platform gates.

The owner directs publication separately. Do not create a tag/release, change
repository settings or send issues/comments as part of preparing this handoff.
After an authorized publication, verify the public download links and compare
downloaded hashes against this same accepted manifest before announcing availability.
