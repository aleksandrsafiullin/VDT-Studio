use std::{
    env,
    ffi::OsString,
    fs::DirBuilder,
    io::{self, Read},
    net::{Ipv4Addr, TcpListener},
    os::{
        fd::{AsRawFd, OwnedFd},
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
        for _ in 0..20 {
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
    let listener_fd = listener.as_raw_fd();
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
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .stdin(Stdio::piped())
        .stdout(Stdio::from(OwnedFd::from(child_control)))
        .stderr(Stdio::inherit());
    // The listener stays open in this host. Expose a copy as fd 3 to Node;
    // only async-signal-safe syscalls run between fork and exec.
    unsafe {
        command.pre_exec(move || {
            if libc::dup2(listener_fd, 3) == -1 || libc::fcntl(3, libc::F_SETFD, 0) == -1 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let process = WebProcess {
        child: command.spawn()?,
    };
    drop(command);
    let mut session = [0; 64];
    control.read_exact(&mut session)?;
    if !session.iter().all(u8::is_ascii_hexdigit) {
        return Err("The packaged web server returned an invalid startup frame.".into());
    }
    let origin = Url::parse(&format!("http://127.0.0.1:{WEB_PORT}"))?;
    let url = origin.join(&format!("/__vdt_start/{}", std::str::from_utf8(&session)?))?;
    let mut config = app.config().app.windows[0].clone();
    config.url = WebviewUrl::External(url);
    let expected_origin = origin.origin();
    let mut window = WebviewWindowBuilder::from_config(app, &config)?
        .on_navigation(move |url| url.origin() == expected_origin)
        .on_new_window(|_, _| NewWindowResponse::Deny);
    if let Some(profile) = webkit_profile()? {
        window = window.data_store_identifier(profile);
    }
    window.build()?;
    app.manage(PackagedWeb {
        _listener: listener,
        process: Mutex::new(Some(process)),
    });
    Ok(())
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
