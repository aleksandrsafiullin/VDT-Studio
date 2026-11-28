#!/usr/bin/env python3
"""Probe the native speech helper without opening a microphone or playing sound."""

import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import wave

SOURCE = Path(__file__).with_name("apple-voice-helper.swift")


def invoke(binary, request, env, timeout=25):
    completed = subprocess.run(
        [str(binary)], input=json.dumps(request).encode(), capture_output=True,
        timeout=timeout, check=True, env=env,
    )
    return json.loads(completed.stdout), len(completed.stderr)


def pcm_wave(samples):
    output = io.BytesIO()
    with wave.open(output, "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(16_000)
        stream.writeframes(samples)
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    scratch_root = Path(tempfile.gettempdir())
    if shutil.disk_usage(scratch_root).free < 10 * 1024**3:
        raise SystemExit("Apple voice probe requires at least 10 GiB of free scratch space.")
    sdk = subprocess.check_output(["xcrun", "--show-sdk-path"], text=True).strip()
    sdk_version = subprocess.check_output(["xcrun", "--show-sdk-version"], text=True).strip()
    flags = ["-parse-as-library", "-swift-version", "6", "-target", "arm64-apple-macos14.0"]
    receipt = {
        "schemaVersion": 1,
        "sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        "sdk": sdk_version,
        "osBuild": subprocess.check_output(["sw_vers", "-buildVersion"], text=True).strip(),
        "productVersion": subprocess.check_output(["sw_vers", "-productVersion"], text=True).strip(),
        "captureStarted": False,
        "audioPlayed": False,
        "requestedAssetDownload": False,
        "networkEgressMeasured": False,
    }
    with tempfile.TemporaryDirectory(prefix="vdt-apple-voice-sdk.", dir=scratch_root) as temporary:
        scratch = Path(temporary)
        binary = scratch / "apple-voice-helper"
        modules = scratch / "modules"
        environment = {**os.environ, "TMPDIR": str(scratch)}
        subprocess.run(["xcrun", "swiftc", *flags, "-sdk", sdk, "-module-cache-path", str(modules),
                        str(SOURCE), "-o", str(binary)], check=True, timeout=90, env=environment)
        load_commands = subprocess.check_output(["otool", "-l", str(binary)], text=True).split("Load command ")
        receipt["build"] = {
            "target": flags[-1],
            "speechWeakLinked": any("LC_LOAD_WEAK_DYLIB" in item and "/Speech.framework/" in item for item in load_commands),
            "bytes": binary.stat().st_size,
        }
        status, stderr = invoke(binary, {"operation": "status"}, environment)
        if status.get("status") != "ok":
            raise SystemExit("Apple voice readiness failed.")
        receipt["readiness"] = status["recognition"]
        receipt["metadataStderrBytes"] = stderr
        voices = status.get("installedVoices", [])
        receipt["availableVoiceCounts"] = {
            locale: sum(voice["locale"].split("-")[0] == locale for voice in voices)
            for locale in sorted(item["locale"] for item in status["recognition"])
        }
        invalid, _ = invoke(binary, {"operation": "status", "arguments": ["unexpected"]}, environment)
        receipt["malformedRequest"] = invalid["status"]
        missing_consent, _ = invoke(binary, {
            "operation": "install_asset", "locale": "en", "systemLocale": "en-US",
        }, environment)
        stale_locale, _ = invoke(binary, {
            "operation": "install_asset", "locale": "en", "systemLocale": "stale-test-locale", "confirmed": True,
        }, environment)
        receipt["assetSetupDenials"] = {"missingConsent": missing_consent["status"], "staleLocale": stale_locale["status"]}
        receipt["preview"] = []
        receipt["recognition"] = []
        for locale in ("en", "ru"):
            voice = next((voice for voice in voices if voice["quality"] == 1 and ".compact." in voice["id"]
                          and voice["locale"].split("-")[0] == locale), None)
            if voice:
                preview, stderr = invoke(binary, {
                    "operation": "preview", "locale": locale, "voiceId": voice["id"],
                    "ratePercent": 100, "volumePercent": 70,
                }, env=environment)
                audio = base64.b64decode(preview.get("waveformBase64", ""), validate=True)
                receipt["preview"].append({
                    "locale": locale, "status": preview["status"], "waveBytes": len(audio),
                    "hasRIFF": audio.startswith(b"RIFF") and audio[8:12] == b"WAVE", "stderrBytes": stderr,
                })
            else:
                receipt["preview"].append({"locale": locale, "status": "no_compact_system_voice"})
                audio = b""
            readiness = next(item["status"] for item in status["recognition"] if item["locale"] == locale)
            if readiness == "installed" and audio:
                sample = scratch / ("%s-preview.wav" % locale)
                sample.write_bytes(audio)
                converted = scratch / ("%s-converted.wav" % locale)
                subprocess.run(["/usr/bin/afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(sample),
                                str(converted)], check=True, timeout=20, capture_output=True, env=environment)
                with wave.open(str(converted), "rb") as stream:
                    audio = pcm_wave(stream.readframes(stream.getnframes()))
                fixture = "synthesized_preview"
            else:
                audio = pcm_wave(bytes(16_000))
                fixture = "silent_gate_control"
            recognized, stderr = invoke(binary, {
                "operation": "recognize", "locale": locale, "audioBase64": base64.b64encode(audio).decode(),
            }, env=environment)
            text = recognized.get("text", "").lower()
            expected = ("production", "stages") if locale == "en" else ("план", "этап")
            receipt["recognition"].append({
                "locale": locale, "fixture": fixture, "status": recognized["status"], "stderrBytes": stderr,
                "expectedWordsMatched": all(word in text for word in expected),
            })
    receipt["scratchRemoved"] = not scratch.exists()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    print("Wrote", args.output)


if __name__ == "__main__":
    main()
