//! Windows-only process ownership and private loopback peer attribution.
//! The activation frame is sent only after the child belongs to our Job Object.
use std::{
    ffi::c_void,
    io::{self, Write},
    mem::{size_of, zeroed},
    net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream},
    os::windows::{io::{AsRawHandle, AsRawSocket, FromRawHandle, OwnedHandle}, process::CommandExt},
    path::Path,
    process::{Child, Command},
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::ERROR_INSUFFICIENT_BUFFER,
    NetworkManagement::IpHelper::{GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, TCP_TABLE_OWNER_PID_ALL},
    Networking::WinSock::{setsockopt, AF_INET, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, WSAGetLastError},
    System::{
        JobObjects::{AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE},
        Threading::CREATE_NO_WINDOW,
    },
};

pub fn owned_listener(port: u16) -> io::Result<TcpListener> {
    let socket = socket2::Socket::new(socket2::Domain::IPV4, socket2::Type::STREAM, Some(socket2::Protocol::TCP))?;
    let enabled = 1i32;
    if unsafe { setsockopt(socket.as_raw_socket() as usize, SOL_SOCKET, SO_EXCLUSIVEADDRUSE,
        (&enabled as *const i32).cast(), size_of::<i32>() as i32) } != 0 {
        return Err(io::Error::from_raw_os_error(unsafe { WSAGetLastError() }));
    }
    socket.bind(&SocketAddrV4::new(Ipv4Addr::LOCALHOST, port).into())?;
    socket.listen(64)?;
    socket.set_nonblocking(true)?;
    Ok(socket.into())
}

pub struct ProcessJob {
    // OwnedHandle is non-inheritable: CreateJobObjectW receives no security attributes.
    _handle: OwnedHandle,
}

impl ProcessJob {
    pub fn attach_and_activate(child: &mut Child) -> io::Result<Self> {
        let result = Self::attach(child).and_then(|job| {
            child.stdin.as_mut().ok_or_else(|| io::Error::other("Missing runtime activation pipe."))?
                .write_all(b"start\n")?;
            Ok(job)
        });
        if result.is_err() {
            let _ = child.kill();
            let _ = child.wait();
        }
        result
    }

    fn attach(child: &Child) -> io::Result<Self> {
        // No job name, shared handle or BREAKAWAY permission is exposed.
        let raw = unsafe { CreateJobObjectW(null(), null()) };
        if raw.is_null() { return Err(io::Error::last_os_error()); }
        let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe { SetInformationJobObject(handle.as_raw_handle(), JobObjectExtendedLimitInformation,
            &limits as *const _ as *const c_void, size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32) } == 0 {
            return Err(io::Error::last_os_error());
        }
        if unsafe { AssignProcessToJobObject(handle.as_raw_handle(), child.as_raw_handle()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self { _handle: handle })
    }
}

pub fn runtime_command(node: &Path, resources: &Path, mode: &'static str) -> Command {
    // mode is selected by native source, never a command argument from the WebView.
    assert!(matches!(mode, "web" | "sidecar"));
    let mut command = Command::new(node);
    command.arg(resources.join("windows-runtime.cjs")).arg(mode)
        .env_remove("NODE_OPTIONS").env_remove("NODE_PATH")
        .creation_flags(CREATE_NO_WINDOW);
    command
}

pub fn sidecar_command(node: &Path, verified_launcher: &Path) -> io::Result<Command> {
    let resources = verified_launcher.parent().and_then(Path::parent)
        .ok_or_else(|| io::Error::other("Missing sidecar resource directory."))?;
    Ok(runtime_command(node, resources, "sidecar"))
}

/// Validate the established connection's server-side socket tuple, not merely a
/// listening port. Keep the original Child handle alive for the proxy lifetime.
/// No request/cookie/bootstrap bytes may be sent before this succeeds.
pub fn verify_backend_peer(stream: &TcpStream, expected_pid: u32) -> io::Result<()> {
    let local = match stream.local_addr()? {
        std::net::SocketAddr::V4(value) if *value.ip() == Ipv4Addr::LOCALHOST => value,
        _ => return Err(io::Error::other("Private web client is not IPv4 loopback.")),
    };
    let peer = match stream.peer_addr()? {
        std::net::SocketAddr::V4(value) if *value.ip() == Ipv4Addr::LOCALHOST => value,
        _ => return Err(io::Error::other("Private web peer is not IPv4 loopback.")),
    };
    let mut byte_count = 0u32;
    let status = unsafe { GetExtendedTcpTable(null_mut(), &mut byte_count, 0, AF_INET as u32, TCP_TABLE_OWNER_PID_ALL, 0) };
    if status != ERROR_INSUFFICIENT_BUFFER || byte_count > 16 * 1024 * 1024 {
        return Err(io::Error::other("Cannot size the Windows TCP ownership table."));
    }
    // The OS table can grow between calls. A bounded retry never sends data.
    for _ in 0..3 {
        let mut bytes = vec![0u8; byte_count as usize];
        let status = unsafe { GetExtendedTcpTable(bytes.as_mut_ptr().cast(), &mut byte_count, 0, AF_INET as u32, TCP_TABLE_OWNER_PID_ALL, 0) };
        if status == ERROR_INSUFFICIENT_BUFFER && byte_count <= 16 * 1024 * 1024 { continue; }
        if status != 0 || byte_count < 4 || byte_count as usize > bytes.len() {
            return Err(io::Error::other("Cannot read the Windows TCP ownership table."));
        }
        let count = u32::from_ne_bytes(bytes[..4].try_into().unwrap()) as usize;
        if count > (byte_count as usize - 4) / size_of::<MIB_TCPROW_OWNER_PID>() {
            return Err(io::Error::other("Invalid Windows TCP ownership table."));
        }
        for index in 0..count {
            let row = unsafe { bytes.as_ptr().add(4 + index * size_of::<MIB_TCPROW_OWNER_PID>())
                .cast::<MIB_TCPROW_OWNER_PID>().read_unaligned() };
            if row.dwState == 5 && row.dwOwningPid == expected_pid
                && endpoint(row.dwLocalAddr, row.dwLocalPort) == peer
                && endpoint(row.dwRemoteAddr, row.dwRemotePort) == local {
                return Ok(());
            }
        }
        return Err(io::Error::other("The private web connection is not owned by the packaged runtime."));
    }
    Err(io::Error::other("Windows TCP ownership changed during admission."))
}

fn endpoint(address: u32, port: u32) -> SocketAddrV4 {
    SocketAddrV4::new(Ipv4Addr::from(address.to_ne_bytes()), u16::from_be(port as u16))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::BufRead, process::Stdio, time::{Duration, SystemTime, UNIX_EPOCH}};
    use windows_sys::Win32::{Foundation::WAIT_OBJECT_0,
        System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE}};
    #[test]
    fn decodes_windows_network_order_endpoint() {
        assert_eq!(endpoint(u32::from_ne_bytes([127, 0, 0, 1]), 37541u16.to_be() as u32),
            SocketAddrV4::new(Ipv4Addr::LOCALHOST, 37541));
    }

    #[test]
    fn attributes_established_peer_and_rejects_another_pid_before_bytes() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (mut server, _) = listener.accept().unwrap();
        verify_backend_peer(&client, std::process::id()).unwrap();
        assert!(verify_backend_peer(&client, 0).is_err());
        server.set_read_timeout(Some(Duration::from_millis(100))).unwrap();
        let mut byte = [0];
        assert!(matches!(std::io::Read::read(&mut server, &mut byte).unwrap_err().kind(),
            io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock));
    }

    #[test]
    fn exclusive_public_listener_cannot_be_replaced() {
        let listener = owned_listener(0).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(owned_listener(port).is_err());
        let retained = listener.try_clone().unwrap();
        drop(listener);
        assert!(owned_listener(port).is_err());
        drop(retained);
        owned_listener(port).unwrap();
    }

    struct Fixture { root: std::path::PathBuf }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("vdt-owned-job-{}-{}", std::process::id(),
                SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
            fs::create_dir(&root).unwrap();
            fs::write(root.join(".owned"), b"vdt-windows-native-checks").unwrap();
            fs::copy(std::env::var_os("VDT_TEST_WINDOWS_RUNTIME").expect("Run through verify-windows-native-runtime.mjs"),
                root.join("windows-runtime.cjs")).unwrap();
            fs::write(root.join("packaged-web.cjs"),
                "exports.start=()=>{const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.stdout.write(String(c.pid)+'\\n');process.stdin.resume();setInterval(()=>{},1000);};").unwrap();
            Self { root }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            if fs::read(self.root.join(".owned")).ok().as_deref() == Some(b"vdt-windows-native-checks") {
                let _ = fs::remove_dir_all(&self.root);
            }
        }
    }
    struct TestChild { child: Child, job: Option<ProcessJob> }
    impl Drop for TestChild {
        fn drop(&mut self) {
            self.job.take();
            let _ = self.child.kill(); let _ = self.child.wait();
        }
    }
    #[test]
    fn exclusive_listener_outlives_accept_thread_and_rejects_replacement() {
        let listener = owned_listener(0).unwrap();
        let port = listener.local_addr().unwrap().port();
        let accept_socket = listener.try_clone().unwrap();
        let result = std::thread::spawn(move || {
            let _listener = accept_socket;
            panic!("simulate unexpected accept-thread exit");
        }).join();
        assert!(result.is_err());
        assert!(owned_listener(port).is_err());
        drop(listener);
        owned_listener(port).unwrap();
    }

    #[test]
    fn activation_failure_terminates_and_reaps_child() {
        let fixture = Fixture::new();
        let node = std::env::var_os("VDT_TEST_NODE").expect("Run through verify-windows-native-runtime.mjs");
        let child = runtime_command(Path::new(&node), &fixture.root, "web")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        let mut managed = TestChild { child, job: None };
        // Retain the pipe so the child cannot exit from EOF before assignment.
        let activation_pipe = managed.child.stdin.take().unwrap();
        assert!(ProcessJob::attach_and_activate(&mut managed.child).is_err());
        assert!(managed.child.try_wait().unwrap().is_some());
        drop(activation_pipe);
        let mut output = String::new();
        std::io::Read::read_to_string(&mut managed.child.stdout.take().unwrap(), &mut output).unwrap();
        assert!(output.is_empty(), "the gated application must never load");
    }

    #[test]
    fn host_loss_worker() {
        let Some(resources) = std::env::var_os("VDT_TEST_CRASH_WORKER_RESOURCES") else { return; };
        let node = std::env::var_os("VDT_TEST_NODE").unwrap();
        let mut child = runtime_command(Path::new(&node), Path::new(&resources), "web")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        let _job = ProcessJob::attach_and_activate(&mut child).unwrap();
        let mut line = String::new();
        std::io::BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
        println!("host-loss-ready {} {}", child.id(), line.trim());
        std::io::stdout().flush().unwrap();
        loop { std::thread::park(); }
    }

    #[test]
    fn abrupt_host_loss_terminates_child_and_descendant() {
        let fixture = Fixture::new();
        let child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "windows_process::tests::host_loss_worker", "--nocapture"])
            .env("VDT_TEST_CRASH_WORKER_RESOURCES", &fixture.root)
            .stdout(Stdio::piped()).spawn().unwrap();
        let mut host = TestChild { child, job: None };
        let stdout = host.child.stdout.take().unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || {
            for line in std::io::BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(pids) = line.split_once("host-loss-ready ") {
                    let _ = send.send(pids.1.to_owned());
                    break;
                }
            }
        });
        let pids = receive.recv_timeout(Duration::from_secs(10));
        if pids.is_err() {
            let _ = host.child.kill();
            let _ = host.child.wait();
        }
        reader.join().unwrap();
        let handles: Vec<_> = pids.unwrap().split_whitespace().map(|pid| {
            let raw = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE, 0, pid.parse().unwrap()) };
            assert!(!raw.is_null());
            unsafe { OwnedHandle::from_raw_handle(raw) }
        }).collect();
        assert_eq!(handles.len(), 2);
        host.child.kill().unwrap();
        host.child.wait().unwrap();
        for handle in handles {
            assert_eq!(unsafe { WaitForSingleObject(handle.as_raw_handle(), 5_000) }, WAIT_OBJECT_0);
        }
    }

    #[test]
    fn closing_job_terminates_child_and_descendant() {
        let fixture = Fixture::new();
        let node = std::env::var_os("VDT_TEST_NODE").expect("Run through verify-windows-native-runtime.mjs");
        let child = runtime_command(Path::new(&node), &fixture.root, "web")
            .stdin(std::process::Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
        let mut managed = TestChild { child, job: None };
        managed.job = Some(ProcessJob::attach_and_activate(&mut managed.child).unwrap());
        let mut line = String::new();
        std::io::BufReader::new(managed.child.stdout.take().unwrap()).read_line(&mut line).unwrap();
        let grandchild_pid: u32 = line.trim().parse().expect("The activated fixture should report its descendant.");
        let raw = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE, 0, grandchild_pid) };
        assert!(!raw.is_null());
        let grandchild = unsafe { OwnedHandle::from_raw_handle(raw) };
        managed.job.take();
        assert_eq!(unsafe { WaitForSingleObject(managed.child.as_raw_handle(), 5_000) }, WAIT_OBJECT_0);
        assert_eq!(unsafe { WaitForSingleObject(grandchild.as_raw_handle(), 5_000) }, WAIT_OBJECT_0);
        managed.child.wait().unwrap();
    }
}
