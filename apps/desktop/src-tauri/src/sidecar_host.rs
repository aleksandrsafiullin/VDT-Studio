use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    env,
    fmt,
    fs::File,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, SystemTime},
};

const PROTOCOL_VERSION: u8 = 1;
const MAX_FRAME_BYTES: usize = 1024 * 1024;
const STARTUP_HANDSHAKE_TIMEOUT_MS: u64 = 5000;
const PACKAGED_SIDECAR_RELATIVE_PATH: &str = "sidecars/vdt-local-runtime";
const WINDOWS_PACKAGED_SIDECAR_RELATIVE_PATH: &str = "sidecars/vdt-local-runtime.cmd";
#[cfg(windows)]
const PACKAGED_SIDECAR_RELATIVE_PATHS: &[&str] = &[
    WINDOWS_PACKAGED_SIDECAR_RELATIVE_PATH,
    PACKAGED_SIDECAR_RELATIVE_PATH,
];
#[cfg(not(windows))]
const PACKAGED_SIDECAR_RELATIVE_PATHS: &[&str] = &[PACKAGED_SIDECAR_RELATIVE_PATH];
const SIDECAR_MANIFEST_FILE_NAME: &str = "vdt-local-runtime.manifest.json";
const SIDECAR_BUNDLE_FILE_NAME: &str = "vdt-local-runtime.mjs";
const NODE_BUNDLE_KIND: &str = "node-runtime-bundle";
const SELF_CONTAINED_KIND: &str = "self-contained-sidecar";
const DEV_SIDECAR_PATH_ENV: &str = "VDT_DESKTOP_SIDECAR_PATH";
const MAX_CRASH_RESTARTS: usize = 3;
const CRASH_WINDOW_SECONDS: u64 = 60;

#[derive(Debug)]
pub struct RuntimeError {
    code: &'static str,
    message: String,
}

impl RuntimeError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn is_process_failure(&self) -> bool {
        matches!(
            self.code,
            "SIDECAR_EXITED" | "SIDECAR_READ_FAILED" | "SIDECAR_WRITE_FAILED" | "SIDECAR_STATUS_FAILED"
        )
    }
}

impl fmt::Display for RuntimeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBackendStatus {
    pub backend_id: String,
    pub label: String,
    pub mode: String,
    pub status: String,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeState {
    pub status: String,
    pub message: String,
}

#[derive(Default)]
pub struct DesktopRuntime {
    sidecar: Mutex<Option<SidecarProcess>>,
    resource_dir: Mutex<Option<PathBuf>>,
    crash_timestamps: Mutex<Vec<SystemTime>>,
}

impl DesktopRuntime {
    pub fn set_resource_dir(&self, resource_dir: PathBuf) -> Result<(), RuntimeError> {
        let mut guard = self
            .resource_dir
            .lock()
            .map_err(|_| RuntimeError::new("SIDECAR_LOCK_FAILED", "Desktop resource directory lock was poisoned."))?;
        *guard = Some(resource_dir);
        Ok(())
    }

    pub fn start(&self) -> Result<RuntimeState, RuntimeError> {
        {
            let _sidecar = self.lock_or_start()?;
        }
        Ok(self.state())
    }

    pub fn list_backends(&self) -> Result<Vec<RuntimeBackendStatus>, RuntimeError> {
        let payload = self.request("list_backends", json!({}), None)?;
        let backends = payload
            .get("backends")
            .cloned()
            .ok_or_else(|| RuntimeError::new("INVALID_SIDECAR_RESPONSE", "Sidecar response did not include backends."))?;
        serde_json::from_value(backends)
            .map_err(|error| RuntimeError::new("INVALID_SIDECAR_RESPONSE", error.to_string()))
    }

    pub fn detect_subscription_clis(&self, agent_id: Option<&str>) -> Result<Value, RuntimeError> {
        let payload = match agent_id {
            Some(agent_id) => json!({ "agentId": agent_id }),
            None => json!({}),
        };
        self.request("detect_clis", payload, None)
    }

    pub fn test_backend(&self, backend_id: &str) -> Result<Value, RuntimeError> {
        self.request("test_backend", json!({ "backendId": backend_id }), None)
    }

    pub fn list_models(&self, backend_id: &str) -> Result<Vec<String>, RuntimeError> {
        let payload = self.request("list_models", json!({ "backendId": backend_id }), None)?;
        let models = payload
            .get("models")
            .cloned()
            .unwrap_or_else(|| json!([]));
        serde_json::from_value(models)
            .map_err(|error| RuntimeError::new("INVALID_SIDECAR_RESPONSE", error.to_string()))
    }

    pub fn complete(&self, mut request: Value) -> Result<Value, RuntimeError> {
        let request_id = string_field(&request, "requestId")?;
        let payload = request
            .as_object_mut()
            .ok_or_else(|| RuntimeError::new("INVALID_REQUEST", "Completion request must be an object."))?;
        payload.remove("requestId");
        payload.remove("providerId");
        self.request("complete", request, Some(request_id))
    }

    pub fn cancel(&self, request_id: &str) -> Result<(), RuntimeError> {
        let mut sidecar = self.lock_or_start()?;
        let result = sidecar
            .as_mut()
            .ok_or_else(|| RuntimeError::new("SIDECAR_NOT_STARTED", "Sidecar was not started."))?
            .cancel(request_id);
        if matches!(result.as_ref(), Err(error) if error.is_process_failure()) {
            *sidecar = None;
            self.record_crash();
        }
        result
    }

    pub fn get_run(&self, request_id: &str) -> Result<Value, RuntimeError> {
        self.request("get_run", json!({ "runRequestId": request_id }), None)
    }

    pub fn open_provider_auth(&self, backend_id: &str) -> Result<Value, RuntimeError> {
        self.request("open_provider_auth", json!({ "backendId": backend_id }), None)
    }

    pub fn state(&self) -> RuntimeState {
        let ready = self
            .sidecar
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false);
        RuntimeState {
            status: if ready { "ready" } else { "stopped" }.to_string(),
            message: if ready {
                "Desktop sidecar is running.".to_string()
            } else {
                "Desktop sidecar has not started.".to_string()
            },
        }
    }

    fn request(
        &self,
        method: &'static str,
        payload: Value,
        request_id: Option<String>,
    ) -> Result<Value, RuntimeError> {
        let mut sidecar = self.lock_or_start()?;
        let result = sidecar
            .as_mut()
            .ok_or_else(|| RuntimeError::new("SIDECAR_NOT_STARTED", "Sidecar was not started."))?
            .request(method, payload, request_id);
        if matches!(result.as_ref(), Err(error) if error.is_process_failure()) {
            *sidecar = None;
            self.record_crash();
        }
        result
    }

    fn lock_or_start(&self) -> Result<std::sync::MutexGuard<'_, Option<SidecarProcess>>, RuntimeError> {
        let mut guard = self
            .sidecar
            .lock()
            .map_err(|_| RuntimeError::new("SIDECAR_LOCK_FAILED", "Desktop runtime lock was poisoned."))?;
        if guard.is_none() {
            self.assert_crash_budget()?;
            *guard = Some(SidecarProcess::start(self.resource_dir()?)?);
        }
        Ok(guard)
    }

    fn resource_dir(&self) -> Result<Option<PathBuf>, RuntimeError> {
        self.resource_dir
            .lock()
            .map(|guard| guard.clone())
            .map_err(|_| RuntimeError::new("SIDECAR_LOCK_FAILED", "Desktop resource directory lock was poisoned."))
    }

    fn assert_crash_budget(&self) -> Result<(), RuntimeError> {
        let mut crashes = self
            .crash_timestamps
            .lock()
            .map_err(|_| RuntimeError::new("SIDECAR_LOCK_FAILED", "Desktop crash tracker lock was poisoned."))?;
        prune_crashes(&mut crashes);
        if crashes.len() >= MAX_CRASH_RESTARTS {
            return Err(RuntimeError::new(
                "SIDECAR_CRASH_LOOP",
                format!("Sidecar restart limit reached after {} failure(s).", crashes.len()),
            ));
        }
        Ok(())
    }

    fn record_crash(&self) {
        if let Ok(mut crashes) = self.crash_timestamps.lock() {
            prune_crashes(&mut crashes);
            crashes.push(SystemTime::now());
        }
    }
}

impl Drop for DesktopRuntime {
    fn drop(&mut self) {
        if let Ok(mut sidecar) = self.sidecar.lock() {
            drop(sidecar.take());
        }
    }
}

fn prune_crashes(crashes: &mut Vec<SystemTime>) {
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(CRASH_WINDOW_SECONDS))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    crashes.retain(|timestamp| *timestamp >= cutoff);
}

struct SidecarProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    seen_request_ids: HashSet<String>,
}

impl SidecarProcess {
    fn start(resource_dir: Option<PathBuf>) -> Result<Self, RuntimeError> {
        let binary = sidecar_binary_path(resource_dir.as_deref())?;
        verify_sidecar_integrity(&binary)?;
        let mut child = Command::new(&binary)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| RuntimeError::new("SIDECAR_START_FAILED", error.to_string()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| RuntimeError::new("SIDECAR_START_FAILED", "Sidecar stdin pipe was not available."))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| RuntimeError::new("SIDECAR_START_FAILED", "Sidecar stdout pipe was not available."))?;

        let (stdout, hello) = match read_startup_frame(stdout, Duration::from_millis(STARTUP_HANDSHAKE_TIMEOUT_MS)) {
            Ok(result) => result,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        if hello.get("type").and_then(Value::as_str) != Some("hello") {
            let _ = child.kill();
            let _ = child.wait();
            return Err(RuntimeError::new(
                "SIDECAR_PROTOCOL_ERROR",
                "Sidecar did not begin with the expected hello frame.",
            ));
        }
        let nonce = match string_field(&hello, "nonce") {
            Ok(value) => value,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };

        let mut sidecar = Self {
            child,
            stdin,
            stdout,
            seen_request_ids: HashSet::new(),
        };
        sidecar.write_frame(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "type": "ready",
            "nonce": nonce
        }))?;
        Ok(sidecar)
    }

    fn request(
        &mut self,
        method: &'static str,
        payload: Value,
        request_id: Option<String>,
    ) -> Result<Value, RuntimeError> {
        self.ensure_alive()?;
        let request_id = request_id.unwrap_or_else(|| uuid_like_id(method));
        if self.seen_request_ids.contains(&request_id) {
            return Err(RuntimeError::new(
                "DUPLICATE_REQUEST_ID",
                "Desktop sidecar request id was reused.",
            ));
        }
        self.seen_request_ids.insert(request_id.clone());
        self.write_frame(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "type": "request",
            "requestId": request_id,
            "method": method,
            "payload": payload
        }))?;

        loop {
            let frame = self.read_frame()?;
            if frame.get("type").and_then(Value::as_str) == Some("event") {
                continue;
            }
            if frame.get("type").and_then(Value::as_str) != Some("response") {
                return Err(RuntimeError::new(
                    "INVALID_SIDECAR_RESPONSE",
                    "Sidecar sent a non-response frame.",
                ));
            }
            if frame.get("ok").and_then(Value::as_bool) == Some(true) {
                return Ok(frame.get("payload").cloned().unwrap_or_else(|| json!({})));
            }
            let error = frame.get("error").cloned().unwrap_or_else(|| json!({}));
            let code = error
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("SIDECAR_REQUEST_FAILED");
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Sidecar request failed.");
            return Err(RuntimeError::new("SIDECAR_REQUEST_FAILED", format!("{}: {}", code, message)));
        }
    }

    fn cancel(&mut self, request_id: &str) -> Result<(), RuntimeError> {
        self.ensure_alive()?;
        self.write_frame(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "type": "cancel",
            "requestId": request_id
        }))
    }

    fn ensure_alive(&mut self) -> Result<(), RuntimeError> {
        match self.child.try_wait() {
            Ok(Some(status)) => Err(RuntimeError::new(
                "SIDECAR_EXITED",
                format!("Sidecar exited with status {}.", status),
            )),
            Ok(None) => Ok(()),
            Err(error) => Err(RuntimeError::new("SIDECAR_STATUS_FAILED", error.to_string())),
        }
    }

    fn write_frame(&mut self, value: Value) -> Result<(), RuntimeError> {
        let frame = serde_json::to_string(&value)
            .map_err(|error| RuntimeError::new("SIDECAR_SERIALIZE_FAILED", error.to_string()))?;
        if frame.len() > MAX_FRAME_BYTES {
            return Err(RuntimeError::new("SIDECAR_FRAME_TOO_LARGE", "Sidecar frame is too large."));
        }
        self.stdin
            .write_all(frame.as_bytes())
            .and_then(|_| self.stdin.write_all(b"\n"))
            .and_then(|_| self.stdin.flush())
            .map_err(|error| RuntimeError::new("SIDECAR_WRITE_FAILED", error.to_string()))
    }

    fn read_frame(&mut self) -> Result<Value, RuntimeError> {
        let mut line = String::new();
        let bytes = self
            .stdout
            .read_line(&mut line)
            .map_err(|error| RuntimeError::new("SIDECAR_READ_FAILED", error.to_string()))?;
        parse_frame_line(&line, bytes)
    }
}

fn read_startup_frame(
    stdout: ChildStdout,
    timeout: Duration,
) -> Result<(BufReader<ChildStdout>, Value), RuntimeError> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let result = reader
            .read_line(&mut line)
            .map_err(|error| RuntimeError::new("SIDECAR_READ_FAILED", error.to_string()))
            .and_then(|bytes| parse_frame_line(&line, bytes))
            .map(|value| (reader, value));
        let _ = sender.send(result);
    });

    match receiver.recv_timeout(timeout) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => Err(RuntimeError::new(
            "SIDECAR_START_TIMEOUT",
            "Sidecar did not complete the startup handshake in time.",
        )),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(RuntimeError::new(
            "SIDECAR_EXITED",
            "Sidecar startup handshake reader exited unexpectedly.",
        )),
    }
}

fn parse_frame_line(line: &str, bytes: usize) -> Result<Value, RuntimeError> {
    if bytes == 0 {
        return Err(RuntimeError::new("SIDECAR_EXITED", "Sidecar stdout closed."));
    }
    if bytes > MAX_FRAME_BYTES {
        return Err(RuntimeError::new("SIDECAR_FRAME_TOO_LARGE", "Sidecar frame is too large."));
    }
    let value: Value = serde_json::from_str(line.trim_end())
        .map_err(|error| RuntimeError::new("SIDECAR_PROTOCOL_ERROR", error.to_string()))?;
    if value.get("protocolVersion").and_then(Value::as_u64) != Some(PROTOCOL_VERSION as u64) {
        return Err(RuntimeError::new(
            "SIDECAR_PROTOCOL_ERROR",
            "Sidecar protocol version mismatch.",
        ));
    }
    Ok(value)
}

impl Drop for SidecarProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarManifest {
    schema_version: u8,
    kind: String,
    protocol_version: u8,
    launcher: String,
    entrypoint: String,
    launcher_sha256: Option<String>,
    windows_launcher_sha256: Option<String>,
    bundle_sha256: Option<String>,
    sidecar_sha256: Option<String>,
    self_contained: bool,
    requires_node: Option<String>,
}

fn verify_sidecar_integrity(binary: &Path) -> Result<(), RuntimeError> {
    let manifest_path = binary.with_file_name(SIDECAR_MANIFEST_FILE_NAME);
    let manifest_file = File::open(&manifest_path).map_err(|error| {
        RuntimeError::new(
            "SIDECAR_INTEGRITY_FAILED",
            format!("Sidecar integrity manifest is missing: {}.", error),
        )
    })?;
    let manifest: SidecarManifest = serde_json::from_reader(manifest_file).map_err(|error| {
        RuntimeError::new(
            "SIDECAR_INTEGRITY_FAILED",
            format!("Sidecar integrity manifest is invalid: {}.", error),
        )
    })?;
    if manifest.schema_version != 1 || manifest.protocol_version != PROTOCOL_VERSION {
        return Err(RuntimeError::new(
            "SIDECAR_INTEGRITY_FAILED",
            "Sidecar integrity manifest version is not supported.",
        ));
    }
    if manifest.launcher != "vdt-local-runtime" {
        return Err(RuntimeError::new(
            "SIDECAR_INTEGRITY_FAILED",
            "Sidecar integrity manifest does not describe the reviewed launcher.",
        ));
    }

    match manifest.kind.as_str() {
        NODE_BUNDLE_KIND => verify_node_bundle_integrity(binary, &manifest),
        SELF_CONTAINED_KIND => verify_self_contained_integrity(binary, &manifest),
        _ => Err(RuntimeError::new(
            "SIDECAR_INTEGRITY_FAILED",
            "Sidecar integrity manifest kind is not supported.",
        )),
    }
}

fn verify_node_bundle_integrity(binary: &Path, manifest: &SidecarManifest) -> Result<(), RuntimeError> {
    if manifest.self_contained || manifest.requires_node.as_deref().unwrap_or("").is_empty() {
        return Err(RuntimeError::new(
            "SIDECAR_INTEGRITY_FAILED",
            "Node sidecar manifest must declare its Node runtime requirement.",
        ));
    }
    if manifest.entrypoint != "sidecars/vdt-local-runtime.mjs" {
        return Err(RuntimeError::new(
            "SIDECAR_INTEGRITY_FAILED",
            "Node sidecar manifest entrypoint is not the reviewed bundle path.",
        ));
    }
    verify_sha256(
        binary,
        manifest_launcher_sha256(binary, manifest),
        manifest_launcher_sha256_label(binary),
    )?;
    let bundle = binary.with_file_name(SIDECAR_BUNDLE_FILE_NAME);
    verify_sha256(&bundle, manifest.bundle_sha256.as_deref(), "bundleSha256")
}

fn verify_self_contained_integrity(binary: &Path, manifest: &SidecarManifest) -> Result<(), RuntimeError> {
    if !manifest.self_contained || manifest.requires_node.is_some() {
        return Err(RuntimeError::new(
            "SIDECAR_INTEGRITY_FAILED",
            "Self-contained sidecar manifest must not require Node.",
        ));
    }
    if manifest.entrypoint != "sidecars/vdt-local-runtime" {
        return Err(RuntimeError::new(
            "SIDECAR_INTEGRITY_FAILED",
            "Self-contained sidecar manifest entrypoint is not the reviewed binary path.",
        ));
    }
    verify_sha256(binary, manifest.sidecar_sha256.as_deref(), "sidecarSha256")
}

fn verify_sha256(path: &Path, expected: Option<&str>, label: &'static str) -> Result<(), RuntimeError> {
    let expected = expected.filter(|value| !value.is_empty()).ok_or_else(|| {
        RuntimeError::new(
            "SIDECAR_INTEGRITY_FAILED",
            format!("Sidecar integrity manifest is missing {}.", label),
        )
    })?;
    let actual = sha256_hex(path)?;
    if actual != expected {
        return Err(RuntimeError::new(
            "SIDECAR_INTEGRITY_FAILED",
            format!("Sidecar integrity check failed for {}.", label),
        ));
    }
    Ok(())
}

fn sha256_hex(path: &Path) -> Result<String, RuntimeError> {
    let mut file = File::open(path).map_err(|error| {
        RuntimeError::new(
            "SIDECAR_INTEGRITY_FAILED",
            format!("Sidecar integrity target is missing: {}.", error),
        )
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let bytes = file.read(&mut buffer).map_err(|error| {
            RuntimeError::new(
                "SIDECAR_INTEGRITY_FAILED",
                format!("Sidecar integrity target could not be read: {}.", error),
            )
        })?;
        if bytes == 0 {
            break;
        }
        hasher.update(&buffer[..bytes]);
    }
    Ok(hasher.finalize().iter().map(|byte| format!("{:02x}", byte)).collect())
}

fn manifest_launcher_sha256<'a>(binary: &Path, manifest: &'a SidecarManifest) -> Option<&'a str> {
    if is_windows_launcher(binary) {
        manifest.windows_launcher_sha256.as_deref()
    } else {
        manifest.launcher_sha256.as_deref()
    }
}

fn manifest_launcher_sha256_label(binary: &Path) -> &'static str {
    if is_windows_launcher(binary) {
        "windowsLauncherSha256"
    } else {
        "launcherSha256"
    }
}

fn is_windows_launcher(binary: &Path) -> bool {
    binary
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("vdt-local-runtime.cmd"))
        .unwrap_or(false)
}

fn sidecar_binary_path(resource_dir: Option<&Path>) -> Result<PathBuf, RuntimeError> {
    if let Ok(value) = env::var(DEV_SIDECAR_PATH_ENV) {
        let path = PathBuf::from(value);
        if path.is_absolute() && path.is_file() {
            return Ok(path);
        }
        return Err(RuntimeError::new(
            "SIDECAR_NOT_FOUND",
            "VDT_DESKTOP_SIDECAR_PATH must point to an absolute sidecar binary.",
        ));
    }
    if let Some(resource_dir) = resource_dir {
        for relative_path in PACKAGED_SIDECAR_RELATIVE_PATHS {
            let candidate = resource_dir.join(relative_path);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    let current = env::current_exe()
        .map_err(|error| RuntimeError::new("SIDECAR_NOT_FOUND", error.to_string()))?;
    let base = current
        .parent()
        .ok_or_else(|| RuntimeError::new("SIDECAR_NOT_FOUND", "Desktop binary has no parent directory."))?;
    for relative_path in PACKAGED_SIDECAR_RELATIVE_PATHS {
        let candidate = base.join(relative_path);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(RuntimeError::new(
        "SIDECAR_NOT_PACKAGED",
        "The VDT local runtime sidecar is not packaged with this desktop build.",
    ))
}

fn string_field(value: &Value, field: &'static str) -> Result<String, RuntimeError> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| RuntimeError::new("INVALID_REQUEST", format!("{} is required.", field)))
}

fn uuid_like_id(seed: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("00000000-0000-4000-8000-{:012x}", (nanos ^ seed.len() as u128) & 0xffffffffffff)
}
