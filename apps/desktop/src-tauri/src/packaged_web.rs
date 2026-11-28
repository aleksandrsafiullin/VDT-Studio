use std::{
    env,
    ffi::OsString,
    fs::DirBuilder,
    io::{self, Read},
    net::{Ipv4Addr, TcpListener},
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::{fs::DirBuilderExt, net::UnixStream, process::CommandExt},
    },
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::{webview::NewWindowResponse, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const WEB_PORT: u16 = 37541;
const START_TIMEOUT: Duration = Duration::from_secs(20);
const STOP_TIMEOUT: Duration = Duration::from_secs(7);

pub(crate) struct PackagedWeb {
    // Keep the bound socket until this process exits, even if Node crashes.
    _listener: TcpListener,
    process: Mutex<Option<WebProcess>>,
}

struct WebProcess {
    child: Child,
}

impl Drop for WebProcess {
    fn drop(&mut self) {
        self.child.stdin.take();
        let stop_deadline = std::time::Instant::now() + STOP_TIMEOUT;
        while std::time::Instant::now() < stop_deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(25));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl PackagedWeb {
    pub(crate) fn stop(&self) {
        if let Ok(mut process) = self.process.lock() {
            process.take();
        }
    }
}

pub(crate) fn setup(
    app: &tauri::App,
    resource_dir: &Path,
    runtime: &crate::sidecar_host::DesktopRuntime,
) -> Result<(), Box<dyn std::error::Error>> {
    let node = resource_dir.join("../Helpers/node");
    let web = resource_dir.join("web/apps/web");
    let data_dir = env::var_os("VDT_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or(app.path().app_local_data_dir()?);
    if !data_dir.is_absolute() {
        return Err("VDT_DATA_DIR must be absolute in the installed app.".into());
    }
    DirBuilder::new()
        .mode(0o700)
        .recursive(true)
        .create(&data_dir)?;
    let executable_path = runtime_path(&node)?;
    runtime.set_bundled_runtime(node.clone(), data_dir.clone(), executable_path.clone())?;

    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, WEB_PORT)).map_err(|err| {
        io::Error::new(
            err.kind(),
            format!("VDT Studio could not reserve its local port {WEB_PORT}: {err}"),
        )
    })?;
    let (mut control, child_control) = UnixStream::pair()?;
    control.set_read_timeout(Some(START_TIMEOUT))?;
    let (speech, child_speech) = UnixStream::pair()?;
    // Reserve both sources above the protocol descriptors so dup2 cannot
    // overwrite the other source during an unusually early launch.
    let child_listener = inherited_fd(&listener)?;
    let child_speech = inherited_fd(&child_speech)?;
    let listener_fd = child_listener.as_raw_fd();
    let speech_fd = child_speech.as_raw_fd();
    let mut command = Command::new(&node);
    command
        .arg(resource_dir.join("packaged-web.cjs"))
        .current_dir(&web)
        .env("PATH", executable_path)
        .env("VDT_DATA_DIR", &data_dir)
        .env(
            "VDT_BUNDLED_SKILLS_DIR",
            resource_dir.join("sidecars/vdt-agent-skills"),
        )
        .env("VDT_HARNESS_CONFIG", data_dir.join("harnesses.json"))
        .env("VDT_APP_MODE", "desktop")
        .env("NODE_ENV", "production")
        .env("NEXT_TELEMETRY_DISABLED", "1")
        .env("VDT_PACKAGED_SPEECH_FD", "4")
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .stdin(Stdio::piped())
        .stdout(Stdio::from(OwnedFd::from(child_control)))
        .stderr(Stdio::inherit());
    #[cfg(target_arch = "aarch64")]
    crate::apple_helpers::configure(&mut command, resource_dir);
    // Expose copies of the reserved listener and private speech socket.
    // Only async-signal-safe syscalls run between fork and exec.
    unsafe {
        command.pre_exec(move || {
            if libc::dup2(listener_fd, 3) == -1 || libc::dup2(speech_fd, 4) == -1 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let process = WebProcess {
        child: command.spawn()?,
    };
    drop(command);
    drop(child_listener);
    drop(child_speech);
    let mut session = [0; 64];
    control.read_exact(&mut session)?;
    if !session.iter().all(u8::is_ascii_hexdigit) {
        return Err("The packaged web server returned an invalid startup frame.".into());
    }
    app.manage(crate::packaged_speech::PackagedSpeech::default());
    let speech_app = app.handle().clone();
    thread::Builder::new().name("vdt-packaged-speech".into()).spawn(move || {
        let speech_state = speech_app.state::<crate::packaged_speech::PackagedSpeech>();
        let runtime = speech_app.state::<crate::sidecar_host::DesktopRuntime>();
        let _ = speech_state.serve(speech, |request| runtime.speech(request).map_err(|error| error.to_string()));
    })?;
    let origin = Url::parse(&format!("http://127.0.0.1:{WEB_PORT}"))?;
    let url = origin.join(&format!("/__vdt_start/{}", std::str::from_utf8(&session)?))?;
    let mut config = app.config().app.windows[0].clone();
    config.url = WebviewUrl::External(url);
    let expected_origin = origin.origin();
    let mut window = WebviewWindowBuilder::from_config(app, &config)?
        .on_navigation(move |url| {
            #[cfg(all(target_os = "macos", not(debug_assertions), feature = "app-intents-qualification"))]
            crate::app_intents::invalidate_window();
            url.origin() == expected_origin
        })
        .on_new_window(|_, _| NewWindowResponse::Deny);
    if let Some(profile) = webkit_profile()? {
        window = window.data_store_identifier(profile);
    }
    let _webview = window.build()?;
    #[cfg(all(target_os = "macos", not(debug_assertions), feature = "app-intents-qualification"))]
    _webview.on_window_event(|event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            crate::app_intents::invalidate_window();
        }
    });
    app.manage(PackagedWeb {
        _listener: listener,
        process: Mutex::new(Some(process)),
    });
    Ok(())
}

fn inherited_fd(source: &impl AsRawFd) -> io::Result<OwnedFd> {
    let duplicated = unsafe { libc::fcntl(source.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 10) };
    if duplicated == -1 { return Err(io::Error::last_os_error()); }
    // fcntl returned a new, independently owned descriptor.
    Ok(unsafe { OwnedFd::from_raw_fd(duplicated) })
}

fn runtime_path(node: &Path) -> io::Result<OsString> {
    let mut paths = vec![node.parent().unwrap().to_path_buf()];
    if let Some(home) = env::var_os("HOME") {
        paths.push(PathBuf::from(home).join(".local/bin"));
    }
    paths.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    if let Some(path) = env::var_os("PATH") {
        paths.extend(env::split_paths(&path).filter(|path| path.is_absolute()));
    }
    env::join_paths(paths).map_err(io::Error::other)
}

fn webkit_profile() -> Result<Option<[u8; 16]>, Box<dyn std::error::Error>> {
    let Ok(value) = env::var("VDT_DESKTOP_WEBKIT_PROFILE") else {
        return Ok(None);
    };
    if value.len() != 32 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("VDT_DESKTOP_WEBKIT_PROFILE must be a 32-digit hexadecimal identifier.".into());
    }
    let mut bytes = [0; 16];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)?;
    }
    Ok(Some(bytes))
}
