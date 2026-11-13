# W5: Release gates and artifact evidence

**Status: tooling implemented; final release qualification pending.** This work does not publish an artifact or change the target platform scope.

- Vitest runs test files serially. Existing per-request deadlines and assertions are unchanged.
- The desktop candidate workflow can build Mac and Windows for the same SHA, verify the builder's application resources, and retain installers, checksums, metadata, and logs. This is an unsigned, manually dispatched build job. Tag-triggered release source verification retains evidence and has read-only repository permission. Neither workflow publishes.
- The artifact verifier ties installer checksum, archived source identity, embedded Node version, sidecar/skills hashes and the traced parser worker to the candidate output. It checks platform trust separately from installed application and live provider qualification. The Windows resource check examines the pre-installer staging application; validating what the installer actually lays down still requires a clean install. Archive packaging fixes the full SHA, version, dirty=false, and packaging timestamp across build metadata. CLI package assembly copies and checks the W2 parser worker and manifest.
- Mac build staging and package caches stay under the owned stage on the output volume. The Mac builder retains its target OS floor; GitHub's Mac runner selection does not certify the supported minimum.

Evidence in `output/release/audits/2026-11-13-w5/`:

- Node 24: `pnpm exec vitest run packages/local-runner/src/server/harness-matrix.test.ts --reporter=dot` twice, **44/44** each (`harness-matrix-ssd-{1,2}.log`). The initial run placed TMPDIR inside the checkout, which correctly triggered the Smart CLI host ownership guard; the repeats used an owned SSD directory outside the checkout. No fixture assertions or timeout values were changed.
- `pnpm exec vitest run scripts/verify-ci-workflows.test.ts scripts/verify-desktop-shell.test.ts scripts/verify-native-alpha-artifact.test.ts scripts/copy-parser-worker.test.ts scripts/windows-packaged-runtime.test.ts --reporter=dot`: **35/35** (`focused-final.log`).
- `pnpm desktop:sidecar:verify`, `pnpm docs:verify`, the workflow contract verifier, and `git diff --check` passed. The [W8 native ownership fixture](OPEN_ALPHA_W8_2026-11-13.md) ran separately on Windows x64.
- No heavy release gate or native installer build was started by this workstream. The coordinator owns integrated gate scheduling and clean install/provider qualification. Keep release HOLD until both signed, same-commit installers and required native results exist.

New focused-test and Rust target staging use owned SSD temporary directories. Owned local staging and its Node compile caches were removed after checks. Retained evidence consists of small logs and the exact isolated CI probe patch.

## Mac candidate preparation

The host has one valid Developer ID Application identity for Aleksandr Safiullin (team N3WCVK74UD), and Xcode supplies `notarytool`. The packager can select that identity automatically. No notarization profile was configured in the current process, and Apple submission credentials have not been validated. The existing Mac QA VM's path and OS version have yet to be confirmed. The visible SSD UTM guest is the separate Windows Arm environment.

1. Freeze the reviewed source SHA after the integration gate. Create empty installer output and build directories on Corsair-SSD and check free space on both volumes. Set `VDT_NATIVE_BUILD_ROOT` to the owned build directory. Confirm the configured Keychain profile with `xcrun notarytool history --keychain-profile "$VDT_MACOS_NOTARY_PROFILE"` before attempting signed distribution.
2. Run `scripts/package-macos-alpha.sh EMPTY_OUTPUT_DIR FULL_SHA` with Node 24 and the notarization profile available. Run `pnpm desktop:artifact:verify EMPTY_OUTPUT_DIR --source-commit FULL_SHA`. Preserve the DMG, checksum, manifest, verification report and sanitized notarization result. Deliver the same DMG bytes to QA.
3. Confirm the Mac QA guest location, available disk space, OS and architecture. Work in a disposable guest snapshot or a fresh guest account on the SSD and leave the existing user profile and VM baseline intact. Verify the DMG checksum, signature, stapled ticket and Gatekeeper behavior on the downloaded artifact. Cold-start offline with no developer runtime available and record manual modeling, persistence across relaunch and clean exit.
4. Exercise upgrade in a separate disposable guest profile seeded from a copy of an alpha.0 profile. Record source-file hashes, representative values and formulas before the upgrade and compare after reopen, recalculation and download. Run the platform/provider cases only in the exact installed candidate. Record the actual OS build and keep the macOS 14 minimum unqualified until tested on that OS.


## Alpha.2 build dispatch

- Regenerated and verified the sidecar under Node v24.15.0. The full manifest is in `output/release/audits/2026-11-13-w5/alpha2-sidecar.log`. Runtime bundle SHA-256 is `94cbea24902462622c083488cbdead0955a46d180e844791674b6fd4cc8c9447`; skill library SHA-256 is `1562aed227033c5f0fa43898e56405352e9ccfe31daba0d12160b62f9b912969`. Freeze the source only after pending integration fixes are reviewed. If sidecar inputs change, regenerate again before freezing.
- Use the same full SHA in the local Mac command and the Windows candidate workflow. Before invoking the Mac entrypoint from a shared checkout, compare it with the frozen blob using `git show FULL_SHA:scripts/package-macos-alpha.sh | cmp - scripts/package-macos-alpha.sh`. For Windows, dispatch `package-desktop.yml` for the frozen candidate ref with `platform=windows`, then check the returned run's `headSha` before accepting any artifacts. Preserve each run's logs, source identity and installer checksums.
- The candidate workflow produces an unsigned Windows validation installer. Release distribution needs an Authenticode signing identity available on the build host and signed-package verification. Keep the validation result attached to its exact checksum. macOS can build a Developer ID signed package locally, but distribution qualification needs a working notarization profile. Use the W6 matrix for actual install and upgrade cases after both builders complete.


The maintained Windows native storage gate is `.github/workflows/windows-storage-native.yml`.
It reuses the tested disposable standard-user helper and captures both
34-test native regression output and the literal 65-vector evidence. It runs
on pull requests and main and is dispatchable against an exact candidate ref.
The repository workflow's first full run is pending the final matrix fixes.

The signed arm64 diagnostic DMG from `64e12277ee5d4a9f7a0d10b987d5bde9119a8821` passed disk image, Developer ID, and packaged resource verification. Its SHA-256 is `30998987394a04fdc79e249e778b865b0e7e70eb2010eadeec9568186cf1c2dc`. The SSD output is `/Volumes/Corsair-SSD/vdt-alpha2-mac-64e122-lRsUIh/artifact`. This candidate is unnotarized and has no installed qualification. The outer shell returned 1 after packaging completed because the wrapper assigned zsh's read-only `status` variable. Use `build_rc=$?` in the next wrapper. Independent artifact verification passed after the packaging script cleaned its temporary source and Cargo directories.
