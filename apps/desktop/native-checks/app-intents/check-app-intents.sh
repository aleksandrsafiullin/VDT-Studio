#!/bin/bash
set -euo pipefail

sources="$(cd "$(dirname "$0")" && pwd -P)"
repo="$(git -C "$sources" rev-parse --show-toplevel)"
evidence="$(cd "${1:?Pass an existing empty receipt directory}" && pwd -P)"
mode="${2:-full}"
[[ "$mode" == full || "$mode" == --abi-only ]]
[[ -z "$(ls -A "$evidence")" && "$(uname -sm)" == "Darwin arm64" ]]
for volume in "$repo" "$evidence" /private/tmp; do
  df -Pk "$volume" | tee -a "$evidence/free-space.txt" |
    awk 'NR == 2 {if ($4 >= 10485760) available=1} END {exit !available}'
done
volume="$(df -Pk "$repo" | awk 'NR == 2 {sub(/^.*[0-9]+% +/, ""); print}')"
[[ "$volume" == /Volumes/* ]]
owned="$(mktemp -d "$volume/vdt-x03-check.XXXXXX")"
touch "$owned/.vdt-x03-owned"
cleanup() {
  if [[ -f "$owned/.vdt-x03-owned" ]] && ! lsof -t +D "$owned" >/dev/null 2>&1; then
    du -sh "$owned" >> "$evidence/cleanup.log"
    find "$owned" -xdev -depth -delete
    echo "Removed owned App Intents compiler and test scratch." >> "$evidence/cleanup.log"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$owned/tmp" "$owned/module-cache" "$owned/framework-metadata" "$owned/host-metadata"
export TMPDIR="$owned/tmp/"
cd "$owned"
shasum -a 256 "$sources/"*.swift "$sources/check-app-intents.sh" > "$evidence/source-sha256.txt"
swiftc=(xcrun --sdk macosx swiftc -swift-version 6 -warnings-as-errors -module-cache-path "$owned/module-cache")
boundary="$sources/VDTIntentBoundary.swift"
intents="$sources/VDTAppIntents.swift"
"${swiftc[@]}" --version > "$evidence/swift-version.txt" 2>&1
"${swiftc[@]}" -target arm64-apple-macos14.0 -typecheck "$boundary" "$intents" > "$evidence/typecheck.log" 2>&1
echo "Public Swift App Intents conformance and macOS 14 build floor passed typecheck." >> "$evidence/typecheck.log"
"${swiftc[@]}" -target arm64-apple-macos14.0 -parse-as-library "$boundary" "$sources/VDTIntentBoundaryTests.swift" \
  -o "$owned/intents-tests" > "$evidence/boundary-compile.log" 2>&1
"$owned/intents-tests" | tee "$evidence/boundary-tests.log"
"${swiftc[@]}" -target arm64-apple-macos14.0 -parse-as-library "$boundary" "$sources/VDTIntentNativeHost.swift" \
  "$sources/VDTIntentNativeHostTests.swift" -o "$owned/intent-native-host-tests" > "$evidence/native-host-compile.log" 2>&1
"$owned/intent-native-host-tests" | tee "$evidence/native-host-tests.log"
nm -g "$owned/intent-native-host-tests" | awk '/_vdt_app_intents_/' > "$evidence/native-host-link-symbols.txt"
[[ "$(wc -l < "$evidence/native-host-link-symbols.txt" | tr -d " ")" == 4 ]]
if [[ "$mode" == --abi-only ]]; then exit 0; fi

printf '%s\n' '["AppIntent","AppIntentsPackage"]' > "$owned/protocols.json"
printf '%s\n' "$intents" "$boundary" > "$owned/framework-sources.list"
printf '%s\n' "$owned/VDTAppIntentsPrototype.swiftconstvalues" > "$owned/framework-consts.list"
compile=( -target arm64-apple-macos26.0 -parse-as-library -whole-module-optimization -c
  -const-gather-protocols-list "$owned/protocols.json" )
"${swiftc[@]}" "${compile[@]}" -module-name VDTAppIntentsPrototype \
  -o "$owned/VDTAppIntentsPrototype.o" -emit-module -emit-module-path "$owned/VDTAppIntentsPrototype.swiftmodule" \
  -emit-const-values-path "$owned/VDTAppIntentsPrototype.swiftconstvalues" \
  "$boundary" "$intents" > "$evidence/framework-metadata-compile.log" 2>&1

cat > "$owned/VDTHostPackage.swift" <<'SWIFT'
import AppIntents
import VDTAppIntentsPrototype

struct VDTHostPackage: AppIntentsPackage {
    static var includedPackages: [any AppIntentsPackage.Type] { [VDTAppIntentsPackage.self] }
}
SWIFT
"${swiftc[@]}" "${compile[@]}" -module-name VDTHost -I "$owned" \
  -o "$owned/VDTHost.o" -emit-const-values-path "$owned/VDTHost.swiftconstvalues" \
  "$owned/VDTHostPackage.swift" > "$evidence/host-metadata-compile.log" 2>&1
printf '%s\n' "$owned/VDTHostPackage.swift" > "$owned/host-sources.list"
printf '%s\n' "$owned/VDTHost.swiftconstvalues" > "$owned/host-consts.list"
toolchain="$(dirname "$(dirname "$(xcrun --find swiftc)")")"
sdk="$(xcrun --sdk macosx --show-sdk-path)"
xcode_build="$(xcodebuild -version | awk '/Build version/ {print $3}')"
extract=(xcrun appintentsmetadataprocessor --toolchain-dir "$toolchain" --sdk-root "$sdk"
  --xcode-version "$xcode_build" --platform-family macOS --deployment-target 26.0 --target-triple arm64-apple-macos26.0)
"${extract[@]}" --output "$owned/framework-metadata" --module-name VDTAppIntentsPrototype \
  --source-file-list "$owned/framework-sources.list" --swift-const-vals-list "$owned/framework-consts.list" \
  > "$evidence/framework-metadata-extraction.log" 2>&1
printf '%s\n' "$owned/framework-metadata/Metadata.appintents/extract.actionsdata" > "$owned/framework-metadata.list"
"${extract[@]}" --output "$owned/host-metadata" --module-name VDTHost \
  --source-file-list "$owned/host-sources.list" --swift-const-vals-list "$owned/host-consts.list" \
  --metadata-file-list "$owned/framework-metadata.list" > "$evidence/host-metadata-extraction.log" 2>&1
ditto "$owned/framework-metadata" "$evidence/framework-metadata"
ditto "$owned/host-metadata" "$evidence/host-metadata"
fixture="$sources/VDTIntentHostFixture.swift"
app="$owned/VDT Intent Host Fixture.app"
bundle_id="com.vdtstudio.validation.intent-host"
executable="$app/Contents/MacOS/VDTIntentHostFixture"
resources="$app/Contents/Resources"
mkdir -p "$(dirname "$executable")" "$resources"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>VDTIntentHostFixture</string>
  <key>CFBundleIdentifier</key><string>$bundle_id</string>
  <key>CFBundleName</key><string>VDT Intent Host Fixture</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
</dict>
</plist>
PLIST
printf '%s\n' "$boundary" "$intents" "$fixture" > "$owned/app-sources.list"
printf '%s\n' "$owned/VDTIntentHostFixture.swiftconstvalues" > "$owned/app-consts.list"
"${swiftc[@]}" -target arm64-apple-macos14.0 -parse-as-library -whole-module-optimization \
  -module-name VDTIntentHostFixture -const-gather-protocols-list "$owned/protocols.json" \
  -emit-const-values-path "$owned/VDTIntentHostFixture.swiftconstvalues" \
  "$boundary" "$intents" "$fixture" -o "$executable" > "$evidence/app-compile.log" 2>&1
xcrun vtool -show-build "$executable" > "$evidence/app-build-version.txt"
xcrun appintentsmetadataprocessor --toolchain-dir "$toolchain" --sdk-root "$sdk" \
  --xcode-version "$xcode_build" --platform-family macOS --deployment-target 14.0 --target-triple arm64-apple-macos14.0 \
  --output "$resources" --module-name VDTIntentHostFixture \
  --source-file-list "$owned/app-sources.list" --swift-const-vals-list "$owned/app-consts.list" \
  > "$evidence/app-metadata-extraction.log" 2>&1
ditto "$resources/Metadata.appintents" "$evidence/app-metadata/Metadata.appintents"
plutil -lint "$app/Contents/Info.plist" > "$evidence/app-plist.log"
cp "$app/Contents/Info.plist" "$evidence/app-info.plist"

identity="${VDT_MACOS_SIGNING_IDENTITY:--}"
if [[ "$identity" == "-" ]]; then
  codesign --force --sign - --options runtime "$app" > "$evidence/app-signing.log" 2>&1
else
  [[ "$identity" =~ ^[0-9A-Fa-f]{40}$ ]]
  security find-identity -v -p codesigning | awk -v hash="$identity" \
    '$2 == hash && /Developer ID Application/ {found = 1} END {exit !found}'
  codesign --force --sign "$identity" --options runtime --timestamp=none "$app" > "$evidence/app-signing.log" 2>&1
fi
codesign --verify --deep --strict --verbose=2 "$app" >> "$evidence/app-signing.log" 2>&1
codesign --display --verbose=4 "$app" > "$evidence/app-signature.txt" 2>&1
"$executable" --self-check | tee "$evidence/app-in-process.log"

python3 - "$owned/framework-metadata/Metadata.appintents" "$owned/host-metadata/Metadata.appintents" "$owned/VDTAppIntentsPrototype.swiftconstvalues" "$resources/Metadata.appintents" <<'PY' > "$evidence/metadata-contract.json"
import json
from pathlib import Path
import sys

expected = {
    "OpenVDTStudioIntent", "ShowVDTVoiceControlsIntent", "ShowVDTStatusIntent",
    "RequestVDTStopListeningIntent", "OpenVDTPendingReviewIntent",
}

def checked_metadata(directory):
    data = json.loads((directory / "extract.actionsdata").read_bytes())
    assert set(data["actions"]) == expected
    assert not any(data[name] for name in ("autoShortcuts", "entities", "queries", "assistantIntents"))
    for action in data["actions"].values():
        assert action["parameters"] == []
        assert action["openAppWhenRun"] and action["supportedModes"] == 2
        assert action["allowedTargets"] == [{"type": 1}]
        assert action["authenticationPolicy"] == 2 and action["isAuthPolExplicit"]
        assert action["outputFlags"] == 4
    return {"actions": sorted(data["actions"]), "generator": data["generator"]}

framework, host, constants, app = map(Path, sys.argv[1:])
package = next(
    item for item in json.loads(constants.read_bytes())
    if item["typeName"] == "VDTAppIntentsPrototype.VDTAppIntentsPackage"
)
host_package = json.loads((host / "extract.packagedata").read_bytes())
assert host_package["includes"] == [package["mangledTypeName"]]
host_actions = json.loads((host / "extract.actionsdata").read_bytes())
assert not any(host_actions[name] for name in ("actions", "autoShortcuts", "entities", "queries", "assistantIntents"))
print(json.dumps({
    "framework": checked_metadata(framework),
    "signedAppExecutable": checked_metadata(app),
    "hostIncludedPackage": package["typeName"],
    "hostDefinesOwnActions": False,
}, indent=2))
PY
