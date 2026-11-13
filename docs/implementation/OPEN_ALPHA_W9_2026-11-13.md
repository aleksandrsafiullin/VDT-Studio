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

## Bundled third-party notices

The inspected signed Mac diagnostic app staged Node and VDT Studio licenses.
Its traced web resources included Next, React, and React DOM package files
without the upstream package license files. The installed SheetJS input for
the bundled parser worker also supplies its own license text. The Tauri
application includes Rust dependencies resolved from the desktop Cargo lock.
The Windows storage addon build invokes `rustc` directly and has no separate
Cargo dependency graph.

`scripts/collect-third-party-notices.mjs OUTPUT_DIR RUST_TARGET` reads
the candidate's installed pnpm virtual store and locked, offline,
platform-filtered desktop Cargo metadata. The pnpm inventory conservatively
includes build and development dependencies, including inputs that can be
embedded in generated chunks. The Cargo inventory can include build
dependencies. Neither set is an exact redistribution or linkage manifest.
The collector preserves discovered upstream bytes in
`THIRD-PARTY-NOTICES/texts/<sha256>.txt`; `inventory.json` indexes original
relative paths and package metadata. It also preserves the libvips package's
upstream README licensing table as supplemental text.

The collector also indexes byte-preserved supplemental notices by ecosystem,
package, version, source URL and SHA-256. `@next/env@15.5.28` ships in the
traced runtime. It now gets the root license from the exact Next release
commit and the original license texts for its pinned bundled dotenv and
dotenv-expand versions. The `objc2` family uses the root upstream licensing
statement at the exact registry crate VCS revisions, and `alloc-stdlib`
uses the root license from its registry VCS revision. The pinned `selectors`
source lacks a root license file and explicitly identifies MPL 2.0 in its
source header, so its supplement is Mozilla's published MPL 2.0 text.

The Mac runtime also ships `client-only@0.0.1` and
`@img/sharp-libvips-darwin-arm64@1.3.4`. The published `client-only` package
declares MIT and points to the React issue tracker, with no upstream revision
or copyright statement in the package metadata or source. All three
published files match the [pinned Next vendored copy](https://github.com/vercel/next.js/tree/195cd6a714086ee0e442cb551da376ad71f37035/packages/next/src/compiled/client-only)
byte for byte. That directory provides no separate notice. The inventory
retains that metadata and leaves its text list empty rather than assigning
an unverified notice. The pinned Mac libvips package includes the wrapper
project's root license, the bundled package README licensing table, and the
libvips 8.18.7 root and bundled libnsgif license texts. The official npm
tarball for `@img/sharp-win32-x64@0.35.5` matches the pnpm lockfile SHA-512
and includes the libvips DLLs. Its `versions.json` matches the Mac
libvips build versions, including libvips 8.18.7. The Windows package
therefore receives the same version-pinned upstream libvips notices and
its own packaged README licensing table. Full per-component
notice review and the applicable source and redistribution obligations for
embedded native libraries remain pending separately. Empty lists for
packages present only in the conservative build inventory do not show a
missing runtime notice.

On Node 24.15.0, the focused collector fixture passed and an offline Mac
collection from the checkout succeeded. The fixture checks deterministic
inventory output, byte preservation, hash deduplication, nested notice files,
explicit Cargo license paths, empty notice lists and version-specific supplemental hashes. The Mac collection had a nonempty notice list for every resolved external Cargo package. No installer was
rebuilt by this audit. The temporary collector output was cleaned.

### Embedded libvips release evidence

The 8c60019 Mac application's traced runtime contains the platform package
manifest and `libvips-cpp.8.18.7.dylib`. The corresponding Windows x64 input
is the lockfile-verified Sharp package inspected above. Both are mapped to
the exact [upstream third-party notice](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/THIRD-PARTY-NOTICES.md)
in addition to the package README and already indexed root and libnsgif
license files.

The [official v1.3.4 npm workspace archive](https://github.com/lovell/sharp-libvips/releases/tag/v1.3.4)
matched published SHA-256
`a40fc59e3aa3635177613fa63f29ceecb28b5ad99e7919def47a61f6ca06f0ee`.
Its Darwin ARM64 and Windows x64 package directories supplied
`README.md` and `versions.json` as the notice and component inventory.
They contained no separate per-component license files or source offer.
The [pinned Windows packaging script](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/build/win.sh)
uses the [8.18.7 x64 static web ZIP](https://github.com/libvips/build-win64-mxe/releases/tag/v8.18.7).
That ZIP matched published SHA-256
`a736af61d3b46499760efa606e469cb14e060445b1f6fd36a1fa2e75009e1197`
and supplied a root `LICENSE` with the binaries and headers. Its archive
file list contained no separate component notice or source offer.

The tables name licenses but do not supply individual texts for the
following other reported components:

- aom, libarchive, cairo, cgif, expat, fontconfig, freetype, fribidi, glib,
  harfbuzz, highway, lcms, libexif, libffi, libheif and libimagequant.
- libpng, librsvg, libtiff, libultrahdr, libwebp, libxml2, mozjpeg,
  pango, pixman, proxy-libintl and zlib-ng.

The component-level text, corresponding source or offer, and any applicable
relinking or redistribution materials for the actual binaries remain a
release review item. The source repository, build scripts and upstream
component version table are available as provenance. A rebuilt installer
containing the added supplemental notice was outside this audit. The two
focused collector tests passed; the temporary archives were removed.

The coordinator's next-candidate correction disables Next image optimization
and excludes Sharp platform packages from standalone tracing. The application
has no `next/image` or Sharp runtime imports and serves its SVG directly. The
artifact verifier requires the disabled configuration and rejects remaining
Sharp/libvips runtime resources; the Windows compiled-server check verifies
the static SVG still returns 200 and the authenticated optimizer endpoint 404.
Both real package trees must pass before treating the embedded-library gap as
inapplicable to the next candidate. The conservative dependency notice inventory
may still describe these build inputs. This does not change the retained
8c60019 packages or claim legal clearance for their embedded binaries.
