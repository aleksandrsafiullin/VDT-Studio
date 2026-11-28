#!/bin/bash
set -euo pipefail

stage="$(cd "${1:?Pass prepared App Intents stage}" && pwd -P)"
contents="$(cd "${2:?Pass qualification app Contents directory}" && pwd -P)"
binary="$contents/MacOS/vdt-studio-desktop"
[[ -f "$binary" && -d "$contents/Resources" && ! -e "$contents/Resources/Metadata.appintents" ]]
nm -gU "$binary" | xcrun swift-demangle > "$stage/linked-symbols.txt"
for symbol in available attach update detach; do
  grep -Eq " T _vdt_app_intents_${symbol}$" "$stage/linked-symbols.txt"
done
for action in OpenVDTPendingReviewIntent OpenVDTStudioIntent RequestVDTStopListeningIntent ShowVDTStatusIntent ShowVDTVoiceControlsIntent; do
  grep -Fq "type metadata for VDTStudioAppIntents.$action" "$stage/linked-symbols.txt"
done
ditto "$stage/Metadata.appintents" "$contents/Resources/Metadata.appintents"
