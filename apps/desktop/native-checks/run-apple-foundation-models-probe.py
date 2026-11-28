#!/usr/bin/env python3
"""Compile and run the A01 Swift probe. The evidence contains fixed case IDs and metrics."""
import argparse
import datetime
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import tempfile
import time

SOURCE = pathlib.Path(__file__).with_name("apple-foundation-models-probe.swift").resolve()
MIN_FREE = 10 * 1024**3
LIVE_CASES = [
    ("guided_first_in_child", "guided_en"),
    ("guided_warm_1", "guided_en"),
    ("guided_warm_2", "guided_en"),
    ("guided_ru", "guided_ru"),
    ("tokens", "tokens"),
    ("dynamic_schema", "dynamic_schema"),
    ("proposal", "proposal"),
    ("tool", "tool"),
    ("stream", "stream"),
    ("cancel", "cancel"),
    ("after_cancel", "guided_en"),
    ("timeout", "timeout"),
    ("after_timeout", "guided_en"),
    ("overflow", "overflow"),
    ("after_overflow", "guided_en"),
]


def command(args):
    return subprocess.run(args, check=True, text=True, capture_output=True, timeout=120).stdout.strip()


def run_frames(executable, requests, timeout):
    started = time.monotonic()
    try:
        result = subprocess.run(
            [str(executable)],
            input="".join(json.dumps(request) + "\n" for request in requests),
            text=True,
            capture_output=True,
            timeout=timeout,
        )
        frames = [json.loads(line) for line in result.stdout.splitlines()]
        return {
            "status": "ok" if result.returncode == 0 else "child_failed",
            "childExitCode": result.returncode,
            "elapsedMs": round((time.monotonic() - started) * 1000, 3),
            "stderrBytes": len(result.stderr.encode()),
            "frames": frames,
        }
    except subprocess.TimeoutExpired as error:
        # subprocess.run kills and waits for the owned child. Keep complete replies only.
        lines = (error.stdout or b"").decode().splitlines()
        frames = []
        for line in lines:
            try:
                frames.append(json.loads(line))
            except json.JSONDecodeError:
                break
        return {"status": "parent_deadline_killed_child", "frames": frames}


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--load-note", default="none recorded")
    options = parser.parse_args()
    if shutil.disk_usage(tempfile.gettempdir()).free < MIN_FREE:
        raise SystemExit("A01 compile skipped. The scratch volume has less than 10 GiB free.")
    if options.output.exists():
        raise SystemExit("Choose a new receipt path.")
    options.output.parent.mkdir(parents=True, exist_ok=True)
    receipt = {
        "schemaVersion": 1,
        "startedUtc": utc_now(),
        "loadNote": options.load_note,
        "os": command(["sw_vers", "-productVersion"]),
        "osBuild": command(["sw_vers", "-buildVersion"]),
        "sdk": command(["xcrun", "--sdk", "macosx", "--show-sdk-version"]),
        "swift": command(["xcrun", "swiftc", "--version"]).splitlines()[0],
        "model": "SystemLanguageModel.default",
        "modelInternalRevision": None,
        "sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        "mode": "live" if options.live else "metadata_only",
    }
    sdk_version = tuple(int(part) for part in receipt["sdk"].split(".")[:2])
    sdk_defines = []
    if sdk_version >= (26, 4):
        sdk_defines += ["-D", "VDT_AFM_SDK_26_4"]
    if sdk_version >= (27, 0):
        sdk_defines += ["-D", "VDT_AFM_SDK_27"]
    with tempfile.TemporaryDirectory(prefix="vdt-afm-a01-") as temp:
        scratch = pathlib.Path(temp)
        binary = scratch / "afm-probe"
        target = "arm64-apple-macos14.0"
        compile_flags = ["-parse-as-library", "-swift-version", "6", "-target", target]
        command(["xcrun", "swiftc", *compile_flags, *sdk_defines, "-module-cache-path", str(scratch / "modules"),
                 "-o", str(binary), str(SOURCE)])
        load_commands = command(["otool", "-l", str(binary)])
        match = re.search(r"cmd (LC_(?:LOAD|LOAD_WEAK)_DYLIB)[^\n]*\n[^\n]*\n\s*name [^\n]*FoundationModels\.framework", load_commands)
        minimum_os = re.search(r"\bminos (\S+)", load_commands)
        receipt["build"] = {
            "target": target,
            "flags": compile_flags + sdk_defines,
            "machOMinimumOS": minimum_os.group(1) if minimum_os else None,
            "foundationModelsLoadCommand": match.group(1) if match else None,
            "bytes": binary.stat().st_size,
        }
        receipt["validation"] = run_frames(binary, [
            {"id": "metadata", "op": "availability"},
            {"id": "typed_refusal_mapping", "op": "synthetic_refusal"},
            {"id": "typed_native_timeout_mapping", "op": "synthetic_native_timeout"},
            {"id": "rejected_tool_arguments", "op": "synthetic_tool_scope"},
            {"id": "rejected_arbitrary_fields", "op": "availability", "endpoint": "invalid"},
            {"id": "rejected_invalid_operation", "op": "unknown"},
        ], timeout=10)
        if options.live:
            receipt["liveStartedUtc"] = utc_now()
            receipt["live"] = run_frames(binary, [{"id": case, "op": op} for case, op in LIVE_CASES], timeout=180)
            receipt["liveFinishedUtc"] = utc_now()

        receipt["oversize"] = run_frames(binary, [{"id": "x" * 300, "op": "availability"}], timeout=10)
        if not options.live:
            no_sdk = scratch / "afm-disabled"
            command(["xcrun", "swiftc", *compile_flags, "-D", "VDT_AFM_NO_SDK", "-module-cache-path",
                     str(scratch / "modules"), "-o", str(no_sdk), str(SOURCE)])
            receipt["sdkDisabledFixture"] = run_frames(no_sdk, [{"id": "sdk_disabled", "op": "availability"}], timeout=10)
    receipt["scratchRemoved"] = not scratch.exists()
    receipt["finishedUtc"] = utc_now()
    with options.output.open("x", encoding="utf-8") as file:
        json.dump(receipt, file, indent=2, sort_keys=True)
        file.write("\n")
    print(options.output)


if __name__ == "__main__":
    main()
