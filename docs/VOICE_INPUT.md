# Local Voice Input

Status: Whisper input is implemented as an alpha capability for localhost development and desktop private IPC. Whisper installer targets are macOS Apple silicon, macOS Intel and Windows x64. Apple recognition and system voice previews are implemented behind the private host adapter. The signed installed helper, native permissions and real recording/playback remain release gates.

## User Flow

- Voice capture and automatic speech start off. The muted microphone beside the chat provider/model selector opens Settings → Voice input. It remains clickable for setup and does not open the microphone or begin a download.
- Voice input shows the selected analytics connection and model separately from speech recognition, spoken responses and realtime voice. Installed Whisper recognition runs on this computer with no usage charges. Spoken responses and realtime voice are off.
- Choose Tiny (75 MiB), Base (142 MiB, default) or Small (466 MiB). These are multilingual models. Russian is the default dictation language; users may select another language or automatic detection.
- Download requires a separate **Download and enable** confirmation naming the model and approximate size. **Not now** performs no download. There is no automatic download when opening settings or choosing a model.
- Progress, cancellation, retryable errors and offline readiness are shown in settings. Installation enables the preference; the user starts recording with a fresh microphone click.
- A ready microphone toggles recording/stop. A dark recording strip shows Listening, elapsed captured-audio duration and a rolling waveform calculated from actual PCM energy, even while the local recognizer is busy. No speech detected after three seconds is reported explicitly. Recognized words appear in the existing draft as phrases finish; the current phrase can be refined. Stop changes to Transcribing audio with an elapsed processing timer and a frozen recording waveform. Opening the microphone, recording, final processing and failure are separate states. Send is disabled while recording/finalizing and is always a separate manual action.
- Cancel restores the draft that existed before recording. Typing during recording stops dictation, preserves the manual edit and discards late recognizer responses. Changing the project, VDT, selected analytics connection/model, voice model or language stops capture and invalidates old callbacks. Leaving the composer stops capture. Reopening the same workspace in the same app session can recover its draft from memory. A full app restart clears that memory. Start again with a fresh microphone click after switching.
- Repeated Stop actions share one completion operation. Errors leave an explicit stopped/error card rather than a listening indicator. The waveform is a bounded display of microphone energy, not a transcript, speech-quality score or completion estimate.

## Verified Spoken Notifications

The notification feed accepts canonical Supervisor events and compatible
public events. It discards old replay, deduplicates method selection receipts
and reads the current run status and node count from the public snapshot.
An actual method selection can speak its name and reason. Questions and
approval requests use the current run's checkpoints. Saved completion requires
persisted finish evidence and an active saved revision. The feed avoids
speaking assistant prose, proposal text, failed mutations and internal
provider diagnostics.

The composer integration can use the feed with the microphone closed. It
requires an explicit local synthesis grant and has no automatic playback
fallback. Mute, interruption and project, VDT, revision or provider changes
abort owned audio without affecting the analytical run. Apple notifications
render short, word-bounded fragments in sequence to reduce waveform size.
When the Apple helper reports that a fragment exceeds the waveform limit,
the composer closes that lease and can split the fragment at word boundaries
through two levels, using fresh fragment identities. Unclassified failures, oversized
single tokens and cancelled output end playback. The question remains visible
and accepts typed answers.
Supervisor runs speak the confirmed pending question, and legacy runs use their
standalone question events. Deterministic tests cover delivery to the WebView audio
API and the packaged answer proof path. Physical playback and installed-package
integration remain separate qualification checks.

When the same Apple run refreshes an identical workspace, the notification
observer preserves the current question's occurrence and avoids repeating it.
Playback and microphone admission still check the current workspace scope.

## Recognition And Latency

The AudioWorklet captures mono PCM, resampled to 16 kHz and encoded as canonical 16-bit WAV. Provisional snapshots are requested every approximately 1.6 seconds of speech. A pause of approximately 650 ms finalizes a phrase; uninterrupted speech is bounded into 10-second fragments. Actual visible latency includes inference time and varies with model/hardware; this is incremental chunked transcription, not a guarantee of word-by-word instantaneous recognition. A slower runtime coalesces obsolete provisional snapshots, retains final audio and stops with an actionable error if it cannot keep up.

The model is loaded by a bounded whisper.cpp CLI invocation per fragment. This initial implementation uses CPU execution on all targets; Apple silicon explicitly disables Metal device registration to avoid shader compilation delaying each cold fragment. A real inference warm-up validates a fresh installation before completion. There is no persistent model cache yet. Speed, Russian domain vocabulary, numerical accuracy and long-phrase boundaries need evaluation on target machines. A larger model is a user choice, not an accuracy guarantee.

## Runtime And Storage

`packages/local-runner/src/speech/` owns the closed model/language catalog, request validation, downloader, integrity checks, job lifecycle and native process launch. `apps/web/app/api/speech/route.ts` accepts bounded same-origin JSON in loopback `development_web` mode. The direct Host and browser Origin must match on the same local port, including when Next reconstructs the URL with a different loopback hostname. Hosted and non-local requests fail closed. Desktop uses the reviewed `speech_request` command and `speech` pipe method. The browser never supplies a path, URL, executable, argument list or environment.

`status`, confirmed `install`, `cancel_install`, `apple_status`, the confirmed Apple asset setup operations, explicit `apple_preview`, opt-in `open_tts` / `tts_result` / `close_tts` in private desktop IPC, `open_session`, `keep_session`, `close_session`, `transcribe`, `result` and `cancel` are the only operations. The microphone click requests a session before capture. The host checks the closed component selection and verifies the installed engine and model, then grants an opaque, process-local session ID for the selected scope, Whisper model and language. The analytics mode and provider/model label describe the current selection and cannot authorize an analytics or paid speech route. The host derives the on-device processing boundary and the absence of credentials and usage charges. Audio and job requests carry only the session and job IDs. Closing a session revokes those IDs, cancels its active jobs and discards its transcripts. The open composer keeps its session alive while it owns capture. An abandoned session expires after two minutes of inactivity. The host admits one capture session and one recognizer invocation at a time.

Installed local recognizers can be selected in Local, CLI subscription, API keys and compatibility modes. Whisper is available through its existing verified setup. An Apple helper must be supplied by the private package host and match its signed resource manifest before Apple Speech or system voice preview is available. Release builds keep cloud speech and unified realtime off. The optional OpenAI API preview below requires explicit component and billing consent. Subscription speech requires separate entitlement and billing verification.

Inference starts as a job and returns immediately, so the private command transport does not wait for a whole phrase to decode. Fragments fit the existing 1 MiB pipe-frame limit. Completed jobs remain bounded in memory for at most the current session and are pruned on a subsequent transcription request after two minutes of inactivity. Whisper receives bounded WAV bytes over its private stdin pipe. The host passes no audio path and requests no output files. It requires the recognizer to acknowledge the exact byte count after opening the WAV decoder, so an empty transcript can represent silence. Cancellation and timeout terminate the recognizer and wait for it to exit. An abrupt host exit closes the pipe and leaves no Whisper WAV to recover. Files from older releases in shared temporary storage remain untouched because the host cannot establish their ownership.

Persistent models and the engine live at:

- macOS: `~/Library/Application Support/VDT Studio/speech/`;
- Windows: `%LOCALAPPDATA%/VDT Studio/speech/` (home AppData/Local fallback).

The host-only `VDT_SPEECH_DATA_DIR` override is available for isolated development/test storage. Model selection, language and voice component preferences use browser-local `vdt-studio-voice-input-v1`. A saved enabled preference is retained as a local Whisper selection. The browser never persists an active session grant. No model weights/audio are stored in project revisions or chat history. Audio is sent only to the same-machine local runtime and removed after inference; recognized draft text enters the normal agent path only on Send. Offline transcription does not change the selected chat provider's network requirements.

Downloads stream to an attempt-owned staging directory, enforce exact catalog byte lengths and SHA-256 and publish only verified files. A partial file is never ready. Failed/cancelled attempts remove only their own staging directory. Abrupt OS/process termination can leave an owned temporary directory; automatic crash-recovery sweeping is not implemented.

## Apple recognition and system voice previews

For a language with no saved voice selection, Voice Input prefers installed
Premium and Enhanced voices, followed by Standard voices. Within the same
quality tier, it prefers the voice AVFoundation returns for the language's
configured macOS locale. The app keeps the exact voice once you select it.

On an eligible Mac with the private helper configured, Voice input lists Apple Speech as a separate recognition choice. The helper uses SpeechTranscriber and SpeechAnalyzer with a specific language and an installed on-device asset. Missing assets, unsupported languages and download-in-progress states leave capture off and preserve Whisper as an explicit choice. To set up a supported language, select Apple Speech and choose **Set up Apple speech assets**, then confirm **Download assets** for the exact macOS locale shown. The host issues a one-use confirmation scoped to that locale, expiring after one minute. It invokes the Apple asset installer only after confirmation and rechecks the exact installed locale before enabling recognition. No setup runs when you open settings, change languages or ask the agent. Settings show SDK download progress when available, along with verification, errors and retry. Leaving Voice Input or hiding the app requests cancellation. macOS owns its shared asset activity and can continue or retry it separately. Start dictation with a fresh microphone click after setup. Existing browser microphone permission is requested only after the user's microphone click receives a valid host session. Recognition and TTS helpers do not open the microphone. [Apple SpeechAnalyzer and assets](https://developer.apple.com/documentation/speech/speechanalyzer), [Asset inventory](https://developer.apple.com/documentation/speech/assetinventory)

Speech synthesis is configured separately from recognition and defaults to Off. Selecting Apple system voice lets you choose a language for preview and spoken output. The installed system voice list excludes personal and novelty voices. Preparing a preview asks AVSpeechSynthesizer to write a fixed sample to an audio buffer with the selected rate and volume. Use Play, Pause or Stop to review it. Preview generation is refused during dictation and never starts playback. The preview does not enable automatic speaking. [Apple AVSpeechSynthesizer](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer)

The arm64 Swift 6 helper compiled against SDK 27.2 with a macOS 14 minimum and weak Speech linkage. On macOS 27.0.1 build 26A434, English recognition reported `asset_required` and Russian reported `unsupported_locale`. Bounded recognition requests returned those statuses before inference. EN and RU system voices generated RIFF/WAV preview buffers of 198,668 and 250,660 bytes. The probe rejected a missing confirmation and a mismatched locale. It captured no microphone input, played no audio and requested no assets. Successful foreground Apple asset installation remains unverified. A successful native transcript, independent egress measurement, installed package signing, OS fallback, TCC consent and human playback quality remain unverified. The receipt is `output/apple-local-ai-voice-2026-11-25/v02/native-speech-setup-probe.json`.

## Pinned Assets And Provenance

Multilingual GGML weights come from [ggerganov/whisper.cpp on Hugging Face](https://huggingface.co/ggerganov/whisper.cpp) at revision `5359861c739e955e79d9a303bcbc70fb988958b1`. Each model's exact size and LFS SHA-256 are pinned in the runtime. The weights inherit [Whisper's MIT license](https://github.com/openai/whisper/blob/main/LICENSE).

Native static whisper.cpp executables come from community builds rather than upstream ggml-org binary releases: Apple silicon uses [OpenWhispr release 0.0.10](https://github.com/OpenWhispr/whisper.cpp/releases/tag/0.0.10); Intel Mac and Windows x64 use the [OpenWhispr maintainer's release v1.0.0](https://github.com/sjoerdteunisse/whisper.cpp/releases/tag/v1.0.0). Both ZIP and extracted executable SHA-256 are pinned. The installer accepts exactly one expected regular executable from each archive and rejects paths, symlinks, oversized expansion and unsupported compression. It does not install Homebrew, Python, compilers, CUDA or global packages. The Apple silicon binary contains Metal support but this integration selects CPU explicitly, including disabling Metal device enumeration; the earlier build cannot disable eager Metal initialization and is not accepted by the current Apple silicon catalog. whisper.cpp and the builds are [MIT licensed](https://github.com/sjoerdteunisse/whisper.cpp/blob/master/LICENSE); full engine/model notices are saved as `LICENSES.txt` beside installed assets. Windows ARM-native installation and other OS targets are not supplied.

## Verification Boundary

Focused checks cover live draft updates, refinement without duplicate phrases, silence, slow-recognizer coalescing, cancellation/late results, insertion range preservation, PCM resampling/format limits, confirmation, host/origin/size gates, per-mode Whisper admission, rejected unimplemented routes, session revocation, stale jobs, pinned download failure, supported target selection, installer staging cleanup and file-free Whisper input across abrupt host exit. Native Windows microphone/CPU behavior and signed/packaged WebView permission prompts remain unverified until tested on those systems. Real microphone quality must be evaluated separately from synthetic/prerecorded audio checks.

## Opt-in voice conversation

When local recognition is ready, select **Start voice conversation** beside manual dictation. **Speak** opens one microphone turn. Silence after speech, **Finish turn**, or the ten-second limit ends capture. The active plain-text question shows **Speak your answer** on the question card and changes it to **Finish answer** during capture. You can also type an answer in that card. The microphone, speaker, playback interruption and exit icons act on the conversation. The run has its own cancellation control. If playback fails, the question stays visible and the voice control reports the error.

Recognition submits one final utterance through the ordinary composer. During a running task, the composer hands permitted steering to the existing checkpoint queue. A single pending plain-text question receives the answer under its actual question ID. Multi-part responses, structured choices and approvals stay in their existing controls.

An idle conversation can remain open when Apple first becomes ready or
refreshes an identical saved tree. A new turn still needs a Speak action
and a fresh capture scoped to the current question and workspace.

The dialogue validates the capture session and checks the project, VDT, selected provider, run and current question set before dispatch. Changing workspace or provider, leaving the page, or muting closes the active capture and discards its late results. A failed send in the same scope can be edited in the composer draft. The draft stays in memory for its workspace across component remounts.
Collapsing the composer retires its capture and pending speech as soon as the
workspace visibility changes. Late recognition cannot send a new answer or
change the draft. Reopening the same workspace restores its editable draft and
requires a fresh action to start the microphone.

The loopback development host and packaged macOS Desktop can submit a final spoken answer to one pending plain-text question. A completed recognition job produces a short-lived, one-use proof for the capture session, turn, run, project, VDT, question-set and exact question occurrence. The host retains a hash of the recognized text and checks that hash and the live checkpoint before accepting the answer. On packaged macOS, the web host reaches the verified local speech sidecar over a private native-host socket. It rechecks the active capture and its working and saved VDT revisions before consuming the proof. Cancel, close or bridge loss revokes unused proof. Reconnects, reused question names or IDs, manual edits and stale transcripts grant no new authority.

Packaged automatic submission uses explicitly selected English or Russian. Other languages, automatic language detection, and captures without proof keep the transcript editable for manual submission. Structured and numeric answers stay in the draft for the user to check values and units. Method decisions and approvals use the existing visual controls. The proof authenticates recognition of submitted PCM. Speaker identity and microphone origin require separate physical verification. The local runtime keeps verified notification synthesis and recognition mutually exclusive. Audible preview playback in the current WebView revokes a proof-bearing capture. Signed-app and physical proof qualification remain open.

Spoken agreement and decline can stage a read-back of the current visual review. Approve or Reject stays a separate on-screen action tied to the exact proposal and its base revision. Re-previewing or switching scope retires the earlier voice read-back. Speech never triggers destructive edits or approvals directly. The workbook announcement requires a final persisted run and an exact workbook artifact for its saved revision. Staged or incomplete artifacts produce no workbook claim.

Microphone mute, spoken playback interruption and analytical cancellation are separate actions. The verified run notification queue pauses before capture and resumes after microphone and session release. In Voice settings, choose Apple system voice and separately turn on **Automatically speak verified run updates using the installed voice**. Choose an installed system voice and adjust its rate and volume. These settings are saved per language and also apply to previews. Turning automatic speaking on or explicitly changing its language confirms the displayed installed voice. If an older Auto Speak preference has no saved voice, select one or turn Auto Speak on again. Spoken mute stays in effect while the desktop webview is open. If a saved voice becomes unavailable for its language, spoken updates pause until you select an installed replacement. The browser projects verified events and binds each notification to its event identity. The private host grant validates the scope and voice and permits bounded speech on this device. Mute, interrupt, closing the composer, or changing scope or provider revokes pending audio. Verified updates and clarification cards are also visible in the composer. Physical audio and installed offline operation require separate qualification.

## Optional voice capabilities

The local-runner source includes an experimental, host-only Piper adapter
for English Joe and Russian Denis. The asset store requires one-use consent
to download an exact voice revision, then verifies its weights, configuration
and model card by SHA-256. The host separately supplies an approved external
Piper 1.5.0 installation and exact Python executable and library-tree
identities. Synthesis runs in a network- and write-denied macOS ARM64
subprocess. The adapter returns bounded PCM WAV through the same lease as
verified local speech. Missing or changed assets or runtime files fail the
request.

In a trusted loopback session launched by `scripts/mac-web-launcher.mjs`,
an approved installation unlocks **Settings → Voice input → Neural voice
preview**. Choose Joe or Denis, check the assets and confirm the displayed
download size if setup is needed. **Play sample** renders a fixed phrase
offline and uses the shared speech lease through playback. **Stop sample**
releases the lease. Confirm **Remove voice** to remove the selected assets.
The preview does not set the voice for analytical notifications.

The launcher inherits the operator's `VDT_NEURAL_VOICE_ASSET_DIR`,
`VDT_NEURAL_VOICE_PYTHON`, `VDT_NEURAL_VOICE_PYTHON_SHA256`,
`VDT_NEURAL_VOICE_LIBRARIES` and `VDT_NEURAL_VOICE_LIBRARIES_SHA256`.
Configure canonical absolute paths and SHA-256 identities after approving
Piper and its dependencies. The library digest uses `hashPiperLibraries`
from `packages/local-runner/src/speech/neural-voice-engine.ts`. The Voice
Input setup downloads only the selected voice assets. The native packaged
bridge and human playback qualification are pending.
[Piper release and license](https://pypi.org/project/piper-tts/1.5.0/)

The desktop composer exposes local shortcuts for the active workspace. A
shortcut can focus the open VDT or voice controls, show coarse status, or
open the existing stop and review controls. Starting capture and approving a
proposal still use their dedicated actions. The native App Intents prototype
has five parameterless foreground actions. Main-app registration and signed
Shortcuts discovery require separate qualification.

On the selected Codex subscription connection, Voice Input can inspect the
installed Codex CLI's experimental voice protocol offline. The result
describes the installed protocol's surface. Subscription entitlement,
usage charges, quotas and live voice remain unverified.

### Set up OpenAI voice with eligible ChatGPT Pro API credits

Open **Settings → Voice input → Using ChatGPT Pro with voice** for the
setup guide. In Desktop, click a setup link to copy its address, then open
it in your browser. If clipboard access fails, the app shows the address
for manual copying. Eligible subscribers can claim API credits in ChatGPT
**Settings → Billing** after at least seven days on the eligible paid
subscription. Use the same email and choose an OpenAI API organization
you own. Verify the grant before creating a key in a project in that
organization. The project uses its API organization's credits or paid
balance and API limits. The signed-in Codex usage budget is separate.
[OpenAI eligibility and activation](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions) · [OpenAI API keys](https://platform.openai.com/api-keys)

Enter the key in **Settings → Execution mode → API keys**, select
**OpenAI** under **Protocol**, select **Direct** under **Gateway**, and
leave **Customize base URL** off.

The signed Desktop guide provides the setup steps and local alternatives.
The OpenAI API speech preview is off in the default signed configuration.
For a loopback development preview on macOS, stop any existing development
launcher for this checkout, then start a new one from the repository root
with both client and host flags enabled.

```sh
env NEXT_PUBLIC_VDT_OPENAI_SPEECH_BYOK_ENABLED=true \
  VDT_OPENAI_SPEECH_BYOK_ENABLED=true ./run.command
```

The launcher sets development mode and binds to `127.0.0.1`. The public
flag exposes the preview controls and the host flag authorizes the local
speech route. In this preview, open a saved VDT and start a run using the
direct connection. While it is active, **Check active OpenAI
connection** in Voice Input checks credential presence locally. With a
credential present, **Generate OpenAI sample · API usage** authorizes
one request for a fixed English or Russian phrase, depending on the
selected speech output language. It sends neither the microphone audio
nor the work in the VDT. After synthesis and session close, **Play**
listens to the AI-generated sample. Choosing local speech or using
Codex CLI requires a separate selection.

With the same active direct OpenAI run, the composer’s **OpenAI
dictation** control discloses API billing before **Record with OpenAI**.
It sends one recording of up to ten seconds for transcription after the
microphone closes. The transcript enters the editable composer draft and
requires an explicit Send. The selected local spoken-output settings still
apply. OpenAI dictation is available for English, Russian and automatic
recognition, while OpenAI spoken updates are off.

With a ready on-device recognizer, **OpenAI spoken questions and approvals**
offers **Enable for this run · API usage** for the same saved direct run.
It sends only the current verified question or pending approval notice
to synthesize. The host accepts each occurrence at most once for the
active binding. Recognition stays on the device, and approval still
requires the existing visual action. The opt-in clears when the run,
revision, connection, capture selection or speech language changes.

Recognition and synthesis each require an explicit, expiring, one-use
authorization for the exact active run, saved revision and speech route.
The host checks the lease deadline before a provider request and before
returning its result. The host can use the active run's key for the authorized request. The
adapter includes tool-free realtime synthesis and a scoped transcription
route, and records its processing and billing boundary. Live provider,
combined cloud capture and playback, physical delivery of cloud
notifications, and paid-use qualification are pending.

### Preview with a separate OpenAI voice key

On a trusted loopback-only development host on macOS or Linux, the optional
fixed sample can use a separate OpenAI API project key while the active
saved analytical run uses its own Local, CLI subscription or API key
binding. Enable the OpenAI speech preview for that host. Store the voice
key in a regular file owned by your user with mode `0600` and no additional
access grants. Set `VDT_OPENAI_VOICE_API_KEY_FILE` to its absolute
canonical path without symlinks, then restart the host. On Windows and in
packaged Desktop this separate-file option remains unavailable.

With an active run on a saved VDT, open **Settings → Voice input →
Separate OpenAI voice key**. Select **Check separate voice key** to verify
presence without incurring API usage. **Generate with separate voice
key · API usage** sends one fixed sample to OpenAI through the separate
key. Choose **Play** to hear the result. This preview grants no access to
microphone recording or run readback.
