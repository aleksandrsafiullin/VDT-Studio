use std::{
    env, ffi::OsString, fs, io::{self, BufRead, BufReader, Read, Write},
    net::{Ipv4Addr, Shutdown, SocketAddrV4, TcpListener, TcpStream},
    path::{Path, PathBuf}, process::{Child, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc, Mutex},
    thread::{self, JoinHandle}, time::Duration,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{webview::NewWindowResponse, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use crate::windows_process::{owned_listener, runtime_command, verify_backend_peer, ProcessJob};

const WEB_PORT: u16 = 37541;
const START_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_CONNECTIONS: usize = 64;

pub(crate) struct PackagedWeb { process: Mutex<Option<WebProcess>> }

struct WebProcess {
    // Retained for the entire proxy lifetime, preventing PID reuse admission.
    child: Child,
    _job: ProcessJob,
    proxy: Option<Proxy>,
}

impl Drop for WebProcess {
    fn drop(&mut self) {
        self.proxy.take();
        self.child.stdin.take();
        for _ in 0..20 {
            if matches!(self.child.try_wait(), Ok(Some(_))) { return; }
            thread::sleep(Duration::from_millis(25));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
        // Closing the job also terminates any remaining runtime descendants.
    }
}

impl PackagedWeb {
    pub(crate) fn stop(&self) {
        if let Ok(mut process) = self.process.lock() { process.take(); }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Startup { backend_port: u16, bootstrap: String }

pub(crate) fn setup(app: &tauri::App, resource_dir: &Path, runtime: &crate::sidecar_host::DesktopRuntime)
    -> Result<(), Box<dyn std::error::Error>> {
    let result = setup_inner(app, resource_dir, runtime);
    if let Err(error) = &result {
        let message: Vec<u16> = format!("VDT Studio could not start its local runtime.\n\n{error}")
            .encode_utf16().chain(Some(0)).collect();
        let title: Vec<u16> = "VDT Studio".encode_utf16().chain(Some(0)).collect();
        unsafe { windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(
            std::ptr::null_mut(), message.as_ptr(), title.as_ptr(),
            windows_sys::Win32::UI::WindowsAndMessaging::MB_OK | windows_sys::Win32::UI::WindowsAndMessaging::MB_ICONERROR); }
    }
    result
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StorageManifest {
    schema_version: u8,
    file_name: String,
    architecture: String,
    node_api_version: u8,
    node_version: String,
    sha256: String,
}

fn checked_storage_runtime(resource_dir: &Path) -> io::Result<PathBuf> {
    let runtime = resource_dir.join("runtime");
    for item in [&runtime, &runtime.join("windows-storage.manifest.json"), &runtime.join("windows-storage.node")] {
        use std::os::windows::fs::MetadataExt;
        if fs::symlink_metadata(item)?.file_attributes() & 0x400 != 0 {
            return Err(io::Error::other("The installed storage runtime contains a reparse point."));
        }
    }
    let manifest_file = fs::File::open(runtime.join("windows-storage.manifest.json"))?;
    let mut manifest_bytes = Vec::new();
    manifest_file.take(4097).read_to_end(&mut manifest_bytes)?;
    if manifest_bytes.len() > 4096 {
        return Err(io::Error::other("The installed storage runtime manifest exceeds its size limit."));
    }
    let manifest: StorageManifest = serde_json::from_slice(&manifest_bytes).map_err(io::Error::other)?;
    if manifest.schema_version != 1 || manifest.file_name != "windows-storage.node" ||
        manifest.architecture != "x64" || manifest.node_api_version != 8 ||
        manifest.node_version != "24.22.2" || manifest.sha256.len() != 64 {
        return Err(io::Error::other("The installed storage runtime manifest is invalid."));
    }
    let addon = fs::File::open(runtime.join(manifest.file_name))?;
    let mut hash = Sha256::new();
    let size = io::copy(&mut addon.take(16 * 1024 * 1024 + 1), &mut hash)?;
    if size == 0 || size > 16 * 1024 * 1024 || format!("{:x}", hash.finalize()) != manifest.sha256 {
        return Err(io::Error::other("The installed storage runtime checksum is invalid."));
    }
    Ok(runtime)
}

fn setup_inner(app: &tauri::App, resource_dir: &Path, runtime: &crate::sidecar_host::DesktopRuntime)
    -> Result<(), Box<dyn std::error::Error>> {
    let node = resource_dir.join("runtime/node.exe");
    let web = resource_dir.join("web/apps/web");
    if !node.is_file() || !web.join(".next/required-server-files.json").is_file() {
        return Err("The installed runtime is incomplete. Reinstall the verified VDT Studio package.".into());
    }
    let storage_runtime = checked_storage_runtime(resource_dir)?;
    let data_dir = env::var_os("VDT_DATA_DIR").map(PathBuf::from).unwrap_or(app.path().app_local_data_dir()?);
    if !data_dir.is_absolute() { return Err("VDT_DATA_DIR must be absolute in the installed app.".into()); }
    let executable_path = runtime_path(&node)?;
    runtime.set_bundled_runtime(node.clone(), data_dir.clone(), executable_path.clone())?;
    // Windows requires SO_EXCLUSIVEADDRUSE before bind; retain this listener
    // even if the Node child fails, so another process cannot replace the UI.
    let listener = owned_listener(WEB_PORT).map_err(|error| io::Error::new(error.kind(),
        format!("The local port {WEB_PORT} is unavailable. Close another VDT Studio instance and retry: {error}")))?;
    let mut child = runtime_command(&node, resource_dir, "web")
        .current_dir(&web).env("PATH", executable_path).env("VDT_DATA_DIR", &data_dir)
        .env("VDT_WINDOWS_STORAGE_RUNTIME_DIR", storage_runtime)
        .env("VDT_BUNDLED_SKILLS_DIR", resource_dir.join("sidecars/vdt-agent-skills"))
        .env("VDT_HARNESS_CONFIG", data_dir.join("harnesses.json"))
        .env("VDT_APP_MODE", "desktop").env("NODE_ENV", "production")
        .env("NEXT_TELEMETRY_DISABLED", "1")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn()?;
    let job = ProcessJob::attach_and_activate(&mut child)?;
    let mut process = WebProcess { child, _job: job, proxy: None };
    let stdout = process.child.stdout.take().ok_or("Missing packaged-web startup pipe.")?;
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = BufReader::new(stdout.take(257)).read_until(b'\n', &mut bytes)
            .map(|_| bytes);
        let _ = sender.send(result);
    });
    let bytes = receiver.recv_timeout(START_TIMEOUT).map_err(|_| "The local runtime startup timed out.")??;
    if bytes.len() > 256 || bytes.last() != Some(&b'\n') { return Err("Invalid local runtime startup frame.".into()); }
    let startup: Startup = serde_json::from_slice(&bytes)?;
    if startup.backend_port < 1024 || startup.backend_port == WEB_PORT || startup.bootstrap.len() != 64
        || !startup.bootstrap.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) {
        return Err("Invalid local runtime startup identity.".into());
    }
    // Check ownership even before creating the WebView, then again for every
    // actual connection. A private port number alone is never authority.
    let probe = connect_backend(startup.backend_port, process.child.id())?;
    drop(probe);
    process.proxy = Some(Proxy::start(listener, startup.backend_port, process.child.id())?);
    let origin = Url::parse(&format!("http://127.0.0.1:{WEB_PORT}"))?;
    let mut config = app.config().app.windows[0].clone();
    config.url = WebviewUrl::External(origin.join(&format!("/__vdt_start/{}", startup.bootstrap))?);
    let expected_origin = origin.origin();
    WebviewWindowBuilder::from_config(app, &config)?
        .data_directory(data_dir.join("webview"))
        .on_navigation(move |url| url.origin() == expected_origin)
        .on_new_window(|_, _| NewWindowResponse::Deny).build()?;
    app.manage(PackagedWeb { process: Mutex::new(Some(process)) });
    Ok(())
}

fn runtime_path(node: &Path) -> io::Result<OsString> {
    let mut paths = vec![node.parent().ok_or_else(|| io::Error::other("Missing Node directory."))?.to_path_buf()];
    if let Some(path) = env::var_os("PATH") { paths.extend(env::split_paths(&path).filter(|path| path.is_absolute())); }
    env::join_paths(paths).map_err(io::Error::other)
}

fn connect_backend(port: u16, pid: u32) -> io::Result<TcpStream> {
    let stream = TcpStream::connect_timeout(&SocketAddrV4::new(Ipv4Addr::LOCALHOST, port).into(), Duration::from_secs(2))?;
    stream.set_read_timeout(Some(Duration::from_secs(1)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    verify_backend_peer(&stream, pid)?;
    Ok(stream)
}

struct Proxy {
    // Retain ownership independently of the accept thread, including panic or
    // fatal accept failure, for as long as the trusted WebView can exist.
    _listener: TcpListener,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Proxy {
    fn start(listener: TcpListener, backend_port: u16, child_pid: u32) -> io::Result<Self> {
        let retained_listener = listener.try_clone()?;
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let thread = thread::Builder::new().name("vdt-web-proxy".into()).spawn(move || {
            let mut connections: Vec<JoinHandle<()>> = Vec::new();
            while !stopping.load(Ordering::Acquire) {
                let mut index = 0;
                while index < connections.len() {
                    if connections[index].is_finished() { let _ = connections.swap_remove(index).join(); }
                    else { index += 1; }
                }
                match listener.accept() {
                    Ok((client, _)) if connections.len() < MAX_CONNECTIONS => {
                        let stop = stopping.clone();
                        connections.push(thread::spawn(move || { let _ = forward(client, backend_port, child_pid, stop); }));
                    }
                    Ok((client, _)) => { let _ = client.shutdown(Shutdown::Both); }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(20)),
                    Err(_) => break,
                }
            }
            stopping.store(true, Ordering::Release);
            for connection in connections { let _ = connection.join(); }
        })?;
        Ok(Self { _listener: retained_listener, stop, thread: Some(thread) })
    }
}

impl Drop for Proxy {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() { let _ = thread.join(); }
    }
}

fn forward(client: TcpStream, port: u16, pid: u32, stop: Arc<AtomicBool>) -> io::Result<()> {
    // Ownership is validated before the first request byte, including bootstrap.
    let backend = connect_backend(port, pid)?;
    client.set_read_timeout(Some(Duration::from_secs(1)))?;
    client.set_write_timeout(Some(Duration::from_secs(5)))?;
    let upload_client = client.try_clone()?;
    let upload_backend = backend.try_clone()?;
    let close_client = client.try_clone()?;
    let close_backend = backend.try_clone()?;
    let upload_stop = stop.clone();
    let upload = thread::spawn(move || { let _ = copy_until_stopped(upload_client, upload_backend, upload_stop); });
    let result = copy_until_stopped(backend, client, stop);
    // A closed backend must release a client that leaves its write half open.
    let _ = close_client.shutdown(Shutdown::Both);
    let _ = close_backend.shutdown(Shutdown::Both);
    let _ = upload.join();
    result
}

fn copy_until_stopped(mut from: TcpStream, mut to: TcpStream, stop: Arc<AtomicBool>) -> io::Result<()> {
    let mut bytes = [0u8; 16 * 1024];
    let result = (|| {
        while !stop.load(Ordering::Acquire) {
            match from.read(&mut bytes) {
                Ok(0) => break,
                Ok(count) => to.write_all(&bytes[..count])?,
                Err(error) if matches!(error.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => continue,
                Err(error) => return Err(error),
            }
        }
        Ok(())
    })();
    let _ = to.shutdown(Shutdown::Write);
    let _ = from.shutdown(Shutdown::Read);
    result
}
