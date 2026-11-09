#!/bin/bash
set -euo pipefail

if (( $# < 1 || $# > 2 )); then
  echo "Usage: scripts/package-macos-alpha.sh EMPTY_OUTPUT_DIR [GIT_REF]" >&2
  exit 2
fi
[[ "$(uname -sm)" == "Darwin arm64" ]]
[[ "$(node -p 'process.versions.node.split(".")[0]')" == 24 ]]
repo="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
output="$(cd "$1" && pwd -P)"
test -z "$(ls -A "$output")"
commit="$(git -C "$repo" rev-parse --verify "${2:-HEAD}^{commit}")"
internal_root="${TMPDIR:-/private/tmp}"
for volume in "$output" "$internal_root"; do
  if ! df -Pk "$volume" | awk 'NR == 2 { if ($4 >= 10485760) ok = 1 } END { exit !ok }'; then
    echo "The native build requires 10 GiB free on $volume." >&2
    exit 1
  fi
done

identity="${VDT_MACOS_SIGNING_IDENTITY:-}"
if [[ -z "$identity" ]]; then
  identity="$(security find-identity -v -p codesigning | awk '/Developer ID Application/ {print $2}')"
fi
if [[ ! "$identity" =~ ^[0-9A-Fa-f]{40}$ ]] || ! security find-identity -v -p codesigning |
    awk -v hash="$identity" '$2 == hash && /Developer ID Application/ { found = 1 } END { exit !found }'; then
  echo "Set VDT_MACOS_SIGNING_IDENTITY to one Developer ID Application certificate fingerprint." >&2
  exit 1
fi

stage="$(mktemp -d "$output/.vdt-stage.XXXXXX")"
cargo_stage=""
cleanup() {
  # Both paths were created by mktemp for this foreground build only.
  if [[ -n "$cargo_stage" ]]; then find "$cargo_stage" -xdev -depth -delete; fi
  find "$stage" -xdev -depth -delete
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cargo_stage="$(mktemp -d "$internal_root/vdt-native-cargo.XXXXXX")"
mkdir "$stage/source" "$stage/data"
git -C "$repo" archive "$commit" | tar -xf - -C "$stage/source"
cd "$stage/source"
version="$(node -p 'require("./apps/desktop/package.json").version')"
export CI=true CARGO_TARGET_DIR="$cargo_stage/target"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}" CARGO_INCREMENTAL=0
export NEXT_TELEMETRY_DISABLED=1 VDT_NEXT_STANDALONE=1
export VDT_DATA_DIR="$stage/data" VDT_APP_MODE=desktop NEXT_PUBLIC_VDT_APP_MODE=desktop
unset VDT_NEXT_DIST_DIR VDT_DESKTOP_SELF_CONTAINED_SIDECAR
corepack pnpm install --frozen-lockfile
corepack pnpm desktop:sidecar:prepare
corepack pnpm desktop:verify
corepack pnpm build:web
web="apps/web"
for resource in public .next/static .next/server/chunks/static; do
  # Standalone tracing omits some Webpack migration resources.
  ditto "$web/$resource" "$web/.next/standalone/apps/web/$resource"
done

node_archive="node-v24.22.2-darwin-arm64"
curl --fail --silent --show-error --location --retry 2 \
  "https://nodejs.org/dist/v24.22.2/$node_archive.tar.xz" -o "$stage/$node_archive.tar.xz"
(
  cd "$stage"
  printf '1f5ac075be50bed4780ea3be19a007fda95ea4d527d28d76d0b91de47d915115  %s.tar.xz\n' "$node_archive" |
    shasum -a 256 -c -
  tar -xJf "$node_archive.tar.xz" -- "$node_archive/bin/node" "$node_archive/LICENSE"
)

(
  cd apps/desktop
  corepack pnpm exec tauri icon ../web/public/favicon.svg --output "$stage/icons"
  mkdir -p src-tauri/icons
  cp "$stage/icons/icon.png" "$stage/icons/icon.icns" src-tauri/icons/
  corepack pnpm exec tauri build --bundles app --no-sign --ci --target aarch64-apple-darwin -- --locked
)
app="$CARGO_TARGET_DIR/aarch64-apple-darwin/release/bundle/macos/VDT Studio.app"
contents="$app/Contents"
mkdir "$contents/Helpers"
install -m 755 "$stage/$node_archive/bin/node" "$contents/Helpers/node"
install -m 644 "$stage/$node_archive/LICENSE" "$contents/Resources/LICENSE-Node.txt"
install -m 644 LICENSE "$contents/Resources/LICENSE-VDT-Studio.txt"
install -m 644 apps/desktop/packaged-web.cjs "$contents/Resources/packaged-web.cjs"
ditto --norsrc --noextattr "$web/.next/standalone" "$contents/Resources/web"
test -x "$contents/Resources/sidecars/vdt-local-runtime"
node --input-type=module - "$contents/Resources/web" <<'JS'
import { readdirSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
const root = realpathSync(process.argv[2]);
for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
  const item = join(entry.parentPath, entry.name);
  if (entry.isSymbolicLink() && !realpathSync(item).startsWith(root + sep)) {
    throw new Error(`Bundle link escapes the traced web tree: ${item}`);
  }
  if ([".env", ".vdt", ".npmrc", ".git"].includes(entry.name) || entry.name.startsWith(".env.")) {
    throw new Error(`Unexpected private bundle resource: ${item}`);
  }
}
JS
while IFS= read -r -d '' code; do
  codesign --force --sign "$identity" --options runtime --timestamp "$code"
done < <(find "$contents/Resources/web" -type f \( -name '*.node' -o -name '*.dylib' \) -print0)
codesign --force --sign "$identity" --options runtime --timestamp --identifier com.vdtstudio.desktop.node \
  --entitlements apps/desktop/src-tauri/NodeEntitlements.plist "$contents/Helpers/node"
"$contents/Helpers/node" --version
codesign --force --sign "$identity" --options runtime --timestamp \
  --entitlements apps/desktop/src-tauri/Entitlements.plist "$app"
codesign --verify --deep --strict --verbose=2 "$app"

disk_name="VDT-Studio-$version-arm64.dmg"
mkdir "$stage/disk"
ditto "$app" "$stage/disk/VDT Studio.app"
ln -s /Applications "$stage/disk/Applications"
hdiutil create -quiet -srcfolder "$stage/disk" -volname "VDT Studio $version" -fs HFS+ -format UDZO "$stage/$disk_name"
codesign --force --sign "$identity" --timestamp --identifier com.vdtstudio.desktop.alpha-disk "$stage/$disk_name"
codesign --verify --strict --verbose=2 "$stage/$disk_name"
hdiutil verify "$stage/$disk_name"
ditto "$app" "$output/VDT Studio.app"
mv "$stage/$disk_name" "$output/$disk_name"
(
  cd "$output"
  shasum -a 256 "$disk_name" > SHA256SUMS
  printf '%s\n' "$commit" > SOURCE_COMMIT
)
