#!/bin/bash
set -euo pipefail

sources="$(cd "$(dirname "$0")" && pwd -P)"
stage="$(cd "${1:?Pass an existing empty App Intents staging directory}" && pwd -P)"
[[ -z "$(ls -A "$stage")" && "$(uname -sm)" == "Darwin arm64" ]]
for volume in "$stage" "${TMPDIR:-/private/tmp}"; do
  if ! df -Pk "$volume" | awk 'NR == 2 { if ($4 >= 10485760) ok = 1 } END { exit !ok }'; then
    echo "The App Intents compiler requires 10 GiB free on $volume." >&2
    exit 1
  fi
done

sdk_version="$(xcrun --sdk macosx --show-sdk-version)"
if [[ "${sdk_version%%.*}" -lt 27 ]]; then
  echo "App Intents qualification requires macOS SDK 27 or later." >&2
  exit 1
fi
toolchain="$(dirname "$(dirname "$(xcrun --find swiftc)")")"
sdk="$(xcrun --sdk macosx --show-sdk-path)"
xcode_version="$(xcodebuild -version | awk '/Build version/ {print $3}')"
target="arm64-apple-macos14.0"
module="VDTStudioAppIntents"
inputs=("$sources/VDTIntentBoundary.swift" "$sources/VDTIntentNativeHost.swift" "$sources/VDTAppIntents.swift")
mkdir "$stage/module-cache"
printf '%s\n' '["AppIntent","AppIntentsPackage"]' > "$stage/protocols.json"
printf '%s\n' "${inputs[@]}" > "$stage/sources.list"
printf '%s\n' "$stage/$module.swiftconstvalues" > "$stage/consts.list"

xcrun --sdk macosx swiftc -swift-version 6 -warnings-as-errors -target "$target" \
  -module-name "$module" -module-cache-path "$stage/module-cache" -parse-as-library -whole-module-optimization -c \
  -const-gather-protocols-list "$stage/protocols.json" -emit-const-values-path "$stage/$module.swiftconstvalues" \
  -o "$stage/$module.o" "${inputs[@]}"
xcrun appintentsmetadataprocessor --toolchain-dir "$toolchain" --sdk-root "$sdk" \
  --xcode-version "$xcode_version" --platform-family macOS --deployment-target 14.0 \
  --target-triple "$target" --output "$stage" --module-name "$module" \
  --source-file-list "$stage/sources.list" --swift-const-vals-list "$stage/consts.list"
node --input-type=module - "$stage/Metadata.appintents/extract.actionsdata" <<'JS'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const metadata = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.deepEqual(Object.keys(metadata.actions).sort(), [
  "OpenVDTPendingReviewIntent", "OpenVDTStudioIntent", "RequestVDTStopListeningIntent",
  "ShowVDTStatusIntent", "ShowVDTVoiceControlsIntent"
]);
for (const field of ["autoShortcuts", "entities", "queries", "assistantIntents"]) {
  assert.equal(Object.keys(metadata[field]).length, 0);
}
for (const action of Object.values(metadata.actions)) {
  assert.deepEqual(action.parameters, []);
  assert.equal(action.openAppWhenRun, true);
  assert.equal(action.supportedModes, 2);
  assert.deepEqual(action.allowedTargets, [{ type: 1 }]);
  assert.equal(action.authenticationPolicy, 2);
  assert.equal(action.isAuthPolExplicit, true);
  assert.equal(action.outputFlags, 4);
}
JS
printf '%s\n' "$toolchain/lib/swift/macosx" > "$stage/swift-runtime-path.txt"
