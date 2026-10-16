# Local Voice Input

Status: implemented as an alpha capability for localhost development and the desktop private-IPC path. Supported installer targets are macOS Apple silicon, macOS Intel and Windows x64. Native packaged macOS/Windows behavior still requires release qualification; the existing desktop release blockers remain in force.

## User Flow

- The muted microphone beside the chat provider/model selector opens Settings → Voice input. It remains clickable for setup; no microphone is opened and nothing is downloaded by that click.
- Choose Tiny (75 MiB), Base (142 MiB, default) or Small (466 MiB). These are multilingual models. Russian is the default dictation language; users may select another language or automatic detection.
- Download requires a separate **Download and enable** confirmation naming the model and approximate size. **Not now** performs no download. There is no automatic download when opening settings or choosing a model.
- Progress, cancellation, retryable errors and offline readiness are shown in settings. Installation enables the preference; the user starts recording with a fresh microphone click.
- A ready microphone toggles recording/stop. Recognized words appear in the existing draft during recording; the current phrase can be refined. Stop finishes the final fragment. Send is disabled while recording/finalizing and is always a separate manual action.
- Cancel restores the draft that existed before recording. Typing during recording stops dictation, preserves the manual edit and discards late recognizer responses. Changing VDT or unmounting stops capture and invalidates callbacks.

## Recognition And Latency

The AudioWorklet captures mono PCM, resampled to 16 kHz and encoded as canonical 16-bit WAV. Provisional snapshots are requested every approximately 1.6 seconds of speech. A pause of approximately 650 ms finalizes a phrase; uninterrupted speech is bounded into 10-second fragments. Actual visible latency includes inference time and varies with model/hardware; this is incremental chunked transcription, not a guarantee of word-by-word instantaneous recognition. A slower runtime coalesces obsolete provisional snapshots, retains final audio and stops with an actionable error if it cannot keep up.

The model is loaded by a bounded whisper.cpp CLI invocation per fragment. This initial implementation uses CPU execution on all targets; Apple silicon explicitly disables Metal device registration to avoid shader compilation delaying each cold fragment. A real inference warm-up validates a fresh installation before completion. There is no persistent model cache yet. Speed, Russian domain vocabulary, numerical accuracy and long-phrase boundaries need evaluation on target machines. A larger model is a user choice, not an accuracy guarantee.

## Runtime And Storage

`packages/local-runner/src/speech/` owns the closed model/language catalog, request validation, downloader, integrity checks, job lifecycle and native process launch. `apps/web/app/api/speech/route.ts` accepts bounded same-origin JSON only in localhost `development_web` mode. Hosted/non-local requests fail closed. Desktop uses the reviewed `speech_request` command and `speech` pipe method; the browser never supplies a path, URL, executable, argument list or environment.

`status`, confirmed `install`, `cancel_install`, `transcribe`, `result` and `cancel` are the only operations. Inference starts as a job and returns immediately, so the private command transport does not wait for a whole phrase to decode. Fragments fit the existing 1 MiB pipe-frame limit. At most one inference runs at a time. Completed job results stay in a bounded in-memory cache and are pruned on a subsequent transcription request after two minutes of inactivity. Active jobs/timeouts terminate and wait for the child before removing the job-owned temporary WAV directory.

Persistent models and the engine live at:

- macOS: `~/Library/Application Support/VDT Studio/speech/`;
- Windows: `%LOCALAPPDATA%/VDT Studio/speech/` (home AppData/Local fallback).

The host-only `VDT_SPEECH_DATA_DIR` override is available for isolated development/test storage. Model selection, language and enabled preference use browser-local `vdt-studio-voice-input-v1`. No model weights/audio are stored in project revisions or chat history. Audio is sent only to the same-machine local runtime and removed after inference; recognized draft text enters the normal agent path only on Send. Offline transcription does not change the selected chat provider's network requirements.

Downloads stream to an attempt-owned staging directory, enforce exact catalog byte lengths and SHA-256 and publish only verified files. A partial file is never ready. Failed/cancelled attempts remove only their own staging directory. Abrupt OS/process termination can leave an owned temporary directory; automatic crash-recovery sweeping is not implemented.

## Pinned Assets And Provenance

Multilingual GGML weights come from [ggerganov/whisper.cpp on Hugging Face](https://huggingface.co/ggerganov/whisper.cpp) at revision `5359861c739e955e79d9a303bcbc70fb988958b1`. Each model's exact size and LFS SHA-256 are pinned in the runtime. The weights inherit [Whisper's MIT license](https://github.com/openai/whisper/blob/main/LICENSE).

Native static whisper.cpp executables come from community builds rather than upstream ggml-org binary releases: Apple silicon uses [OpenWhispr release 0.0.10](https://github.com/OpenWhispr/whisper.cpp/releases/tag/0.0.10); Intel Mac and Windows x64 use the [OpenWhispr maintainer's release v1.0.0](https://github.com/sjoerdteunisse/whisper.cpp/releases/tag/v1.0.0). Both ZIP and extracted executable SHA-256 are pinned. The installer accepts exactly one expected regular executable from each archive and rejects paths, symlinks, oversized expansion and unsupported compression. It does not install Homebrew, Python, compilers, CUDA or global packages. The Apple silicon binary contains Metal support but this integration selects CPU explicitly, including disabling Metal device enumeration; the earlier build cannot disable eager Metal initialization and is not accepted by the current Apple silicon catalog. whisper.cpp and the builds are [MIT licensed](https://github.com/sjoerdteunisse/whisper.cpp/blob/master/LICENSE); full engine/model notices are saved as `LICENSES.txt` beside installed assets. Windows ARM-native installation and other OS targets are not supplied.

## Verification Boundary

Focused checks cover live draft updates, refinement without duplicate phrases, silence, slow-recognizer coalescing, cancellation/late results, insertion range preservation, PCM resampling/format limits, confirmation, host/origin/size gates, pinned download failure, supported target selection and temporary staging cleanup. Native Windows microphone/CPU behavior and signed/packaged WebView permission prompts remain unverified until tested on those systems. Real microphone quality must be evaluated separately from synthetic/prerecorded audio checks.
