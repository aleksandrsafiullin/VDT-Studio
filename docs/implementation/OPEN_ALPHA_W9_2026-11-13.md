# W9 GitHub delivery preparation

Status: **prepared for coordinator review; release closure remains pending W6**.
This slice implements the preparatory part of W9/RA-11 in the
[remediation plan](OPEN_ALPHA_REMEDIATION_PLAN_2026-11-13.md). It does not accept or
publish either installer. The shared checkout started at
`4fc92513f8df347620edff982ce25d11bcac5cc5`; other agents' edits were preserved.

## User-visible change

The README previously started with detailed implementation updates and reached
Quickstart after more than 300 lines. There were no issue templates. Contributor
instructions said the production dependency audit currently failed, even though
the current readiness audit recorded a pass.

The README now opens with a short product description, Mac/Windows availability,
a first-project workflow and a feedback link. Both public installer gates remain
explicitly pending. Source development is separate from desktop installation,
and public hosted deployment is outside the release scope. Existing technical
notes and the Quickstart anchor remain available below the new entry point.

## Changed files

| File | Change |
| --- | --- |
| [`README.md`](../../README.md) | Product/get-app/first-project/feedback entry, source-support limits and a link to delivery instructions. Clarifies that a bundled Node runtime can satisfy the alpha without a separate user installation. |
| [`CONTRIBUTING.md`](../../CONTRIBUTING.md) | Fresh-candidate dependency-audit requirement replaces the stale failure claim; source platform limits, evidence/cleanup expectations and public-report guidance are explicit. |
| [`bug_report.yml`](../../.github/ISSUE_TEMPLATE/bug_report.yml) | Build, platform, reproducible steps, expected/actual impact, optional AI configuration and reviewed diagnostic evidence. |
| [`feedback.yml`](../../.github/ISSUE_TEMPLATE/feedback.yml) | User goal, friction and desired improvement, with a public-content review before submission. |
| [`github-delivery.md`](../release/github-delivery.md) | Local assembly and review of the exact accepted installers, W5 metadata/verifier contract, W6 evidence and publication handoff. |
| [`github-prerelease-template.md`](../release/github-prerelease-template.md) | Local release-body template with explicit unresolved identity, asset, support and acceptance placeholders. |

No executable product behavior, workflow YAML, root release metadata, repository
settings or provider certification changed in this slice. No tag, release, issue,
comment, commit or push was created.

## Integration contracts

W5 supplied the native artifact verifier/metadata contract used in the delivery
guide: `scripts/verify-native-alpha-artifact.mjs OUTPUT_DIR --source-commit FULL_SHA`,
per-platform package JSON, `SOURCE_COMMIT`, `SHA256SUMS` and
`native-artifact-verification.json`. This document records that agreed interface;
it does not claim the pending verifier or any native package ran in W9.

Unsigned CI validation and package `qualification: "unverified"` cannot be used
as installed-app acceptance. W9 finalization must take both installers from W6,
preserve their exact bytes and correlate their hashes, version and full source
commit. Public evidence must be sanitized and usable without local ignored
`output/` links. The release body is deliberately incomplete until those inputs
exist.

W4 proposed **Settings → Help & feedback**, **Prepare diagnostic report**,
**Diagnostic report preview** and **Download diagnostics**. The README currently
describes diagnostic export conditionally so it does not promise a control before
its implementation is accepted. The coordinator should replace that sentence with
the verified labels when integrating W4. Export and opening the issue form must
not submit data automatically.

## Verification

Run with Node `24.15.0` and pnpm `10.33.2`:

```text
pnpm docs:verify
git diff --check
python3 output/release/audits/2026-11-13-w9.FQkyfj/validate-delivery.py
```

The documentation gate passed (31 required documents). The diff whitespace check
passed. The retained validation script parses the YAML through Ruby's standard
YAML library, checks required form fields, supported input types, unique IDs and
labels, boolean validations and checkbox options, then verifies local Markdown
targets and whitespace in the changed documents. Both forms passed: eight bug
inputs and five feedback inputs. See the local
[validation evidence](../../output/release/audits/2026-11-13-w9.FQkyfj).

The forms follow GitHub's documented
[issue form syntax](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)
and [validation rules](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/common-validation-errors-when-creating-issue-forms).
Local structural validation is not a claim that GitHub's rendered form was tested:
the changes were not pushed and no test issue was submitted. Existing unit/native
suites were not rerun for this documentation/template-only slice.

## Remaining acceptance and shared-document proposals

RA-11 remains open until both platforms have accepted installers, exact checksums,
OS/provider support rows, signed/trust evidence, clean install/upgrade results,
public evidence and a completed release body. A clean-clone workflow on every
claimed development OS and public-download verification after an authorized
publication also remain pending. No Windows or current-candidate Mac installation
was performed in W9.

The coordinator owns these follow-up integrations:

- Add the delivery guide to the documentation map and the operational release
  documents. Align `RELEASE.md` and `release-checklist.md` with W5's actual native
  commands and evidence boundaries; keep generic production requirements distinct
  from this bounded feedback alpha.
- Update readiness/roadmap status to record W9 preparation, without closing RA-11.
  Keep W7/W8 platform support pending until their own acceptance passes.
- Integrate W4's verified labels and diagnostic fields into the README and final
  release body. Update the user-facing desktop guide with actual accepted OS
  versions, assets and upgrade instructions when W6 supplies them.

Documentation impact: user onboarding, contributor guidance, feedback templates
and release delivery preparation. No schema, runtime or provider contract changes.

No build, test database, browser installation or large temporary artifact was
created. The small retained audit directory contains the local validation scripts
and results; there are no owned build artifacts to clean.
