// Diagnostic native primitive probe. It never admits Windows production storage.
// Build directly with rustc on Windows; no third-party dependencies are required.
// The supplied directory must be an empty, run-owned temporary directory.

#[cfg(not(windows))]
fn main() {
    eprintln!(
        "This diagnostic requires real Windows; cross-compilation is not execution evidence."
    );
    std::process::exit(2);
}

#[cfg(windows)]
fn main() {
    if let Err(error) = windows::run() {
        eprintln!("Windows storage probe failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(windows)]
#[path = "windows-directory.rs"]
mod windows_directory;

#[cfg(windows)]
mod windows {
    use std::{
        ffi::{c_void, OsStr},
        fs, io, mem,
        os::windows::ffi::OsStrExt,
        path::{Path, PathBuf},
        ptr,
    };

    type Handle = *mut c_void;
    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;
    const READ_ATTRIBUTES: u32 = 0x80;
    const READ_CONTROL: u32 = 0x20000;
    const SYNCHRONIZE: u32 = 0x100000;
    const DIRECTORY_READ: u32 = READ_ATTRIBUTES | READ_CONTROL | SYNCHRONIZE | 1;
    const GENERIC_READ: u32 = 0x80000000;
    const GENERIC_WRITE: u32 = 0x40000000;
    const OPEN_REPARSE_POINT: u32 = 0x00200000;
    const BACKUP_SEMANTICS: u32 = 0x02000000;
    const WRITE_THROUGH: u32 = 0x80000000;
    const ATTRIBUTE_DIRECTORY: u32 = 0x10;
    const ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct FileInfo {
        attributes: u32,
        creation: FileTime,
        access: FileTime,
        write: FileTime,
        volume_serial: u32,
        size_high: u32,
        size_low: u32,
        links: u32,
        index_high: u32,
        index_low: u32,
    }
    #[repr(C)]
    struct IoStatusBlock {
        status: usize,
        information: usize,
    }
    #[repr(C)]
    struct SidAndAttributes {
        sid: *mut c_void,
        attributes: u32,
    }
    #[repr(C)]
    struct TokenUser {
        user: SidAndAttributes,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateFileW(
            name: *const u16,
            access: u32,
            share: u32,
            security: *const c_void,
            disposition: u32,
            flags: u32,
            template: Handle,
        ) -> Handle;
        fn CloseHandle(handle: Handle) -> i32;
        fn GetLastError() -> u32;
        fn GetCurrentProcess() -> Handle;
        fn GetFileInformationByHandle(handle: Handle, information: *mut FileInfo) -> i32;
        fn GetVolumeInformationByHandleW(
            handle: Handle,
            name: *mut u16,
            name_length: u32,
            serial: *mut u32,
            maximum_component_length: *mut u32,
            flags: *mut u32,
            filesystem_name: *mut u16,
            filesystem_name_length: u32,
        ) -> i32;
        fn FlushFileBuffers(handle: Handle) -> i32;
        fn WriteFile(
            handle: Handle,
            bytes: *const c_void,
            length: u32,
            written: *mut u32,
            overlapped: *mut c_void,
        ) -> i32;
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
    }
    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn OpenProcessToken(process: Handle, access: u32, token: *mut Handle) -> i32;
        fn GetTokenInformation(
            token: Handle,
            class: u32,
            buffer: *mut c_void,
            length: u32,
            needed: *mut u32,
        ) -> i32;
        fn EqualSid(first: *const c_void, second: *const c_void) -> i32;
        fn GetSecurityInfo(
            handle: Handle,
            object_type: u32,
            information: u32,
            owner: *mut *mut c_void,
            group: *mut *mut c_void,
            dacl: *mut *mut c_void,
            sacl: *mut *mut c_void,
            descriptor: *mut *mut c_void,
        ) -> u32;
        fn GetSecurityDescriptorControl(
            descriptor: *const c_void,
            control: *mut u16,
            revision: *mut u32,
        ) -> i32;
    }
    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn NtFlushBuffersFileEx(
            handle: Handle,
            flags: u32,
            parameters: *const c_void,
            parameters_size: u32,
            status: *mut IoStatusBlock,
        ) -> i32;
    }

    struct OwnedHandle(Handle);
    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    struct SecurityDescriptor(*mut c_void);
    impl Drop for SecurityDescriptor {
        fn drop(&mut self) {
            unsafe {
                LocalFree(self.0);
            }
        }
    }

    fn wide(path: &OsStr) -> io::Result<Vec<u16>> {
        let mut result: Vec<u16> = path.encode_wide().collect();
        if result.contains(&0) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "embedded NUL"));
        }
        result.push(0);
        Ok(result)
    }
    fn open(
        path: &Path,
        access: u32,
        disposition: u32,
        directory: bool,
    ) -> io::Result<OwnedHandle> {
        let name = wide(path.as_os_str())?;
        // Deliberately omit FILE_SHARE_DELETE. A retained directory may not be
        // renamed/deleted behind the handle while this prototype holds it.
        let flags = OPEN_REPARSE_POINT
            | if directory {
                BACKUP_SEMANTICS
            } else {
                WRITE_THROUGH
            };
        let handle = unsafe {
            CreateFileW(
                name.as_ptr(),
                access,
                3,
                ptr::null(),
                disposition,
                flags,
                ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            Err(io::Error::last_os_error())
        } else {
            Ok(OwnedHandle(handle))
        }
    }
    fn info(handle: &OwnedHandle) -> io::Result<FileInfo> {
        let mut result = FileInfo::default();
        if unsafe { GetFileInformationByHandle(handle.0, &mut result) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(result)
    }
    fn same_identity(a: FileInfo, b: FileInfo) -> bool {
        a.volume_serial == b.volume_serial
            && a.index_high == b.index_high
            && a.index_low == b.index_low
    }
    fn open_real_directory(path: &Path) -> io::Result<OwnedHandle> {
        let handle = open(path, DIRECTORY_READ, 3, true)?;
        let metadata = info(&handle)?;
        if metadata.attributes & ATTRIBUTE_REPARSE_POINT != 0
            || metadata.attributes & ATTRIBUTE_DIRECTORY == 0
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "directory is a reparse point or not a directory",
            ));
        }
        Ok(handle)
    }
    fn flush_file(handle: &OwnedHandle) -> u32 {
        if unsafe { FlushFileBuffers(handle.0) } != 0 {
            0
        } else {
            unsafe { GetLastError() }
        }
    }
    fn filesystem_observation(handle: &OwnedHandle) -> io::Result<(String, u32)> {
        let mut name = [0u16; 64];
        let mut flags = 0;
        if unsafe {
            GetVolumeInformationByHandleW(
                handle.0,
                ptr::null_mut(),
                0,
                ptr::null_mut(),
                ptr::null_mut(),
                &mut flags,
                name.as_mut_ptr(),
                name.len() as u32,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let end = name
            .iter()
            .position(|character| *character == 0)
            .unwrap_or(name.len());
        let name = String::from_utf16_lossy(&name[..end]);
        // This is a filesystem type, not a volume label or personal path. Keep
        // the diagnostic JSON closed even for an unexpected filesystem driver.
        if name.is_empty() || !name.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unexpected filesystem type name",
            ));
        }
        Ok((name, flags))
    }
    fn owner_observation(handle: &OwnedHandle) -> io::Result<(bool, bool, bool)> {
        let mut token = ptr::null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), 8, &mut token) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let token = OwnedHandle(token);
        let mut elevation = 0u32;
        let mut elevation_length = 0;
        if unsafe {
            GetTokenInformation(
                token.0,
                20,
                (&mut elevation as *mut u32).cast(),
                mem::size_of::<u32>() as u32,
                &mut elevation_length,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let mut needed = 0;
        unsafe {
            GetTokenInformation(token.0, 1, ptr::null_mut(), 0, &mut needed);
        }
        if needed == 0 || needed > 65536 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unbounded token user",
            ));
        }
        // usize storage provides alignment for TOKEN_USER's native pointer.
        let mut token_buffer =
            vec![0usize; (needed as usize + mem::size_of::<usize>() - 1) / mem::size_of::<usize>()];
        if unsafe {
            GetTokenInformation(
                token.0,
                1,
                token_buffer.as_mut_ptr().cast(),
                needed,
                &mut needed,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let token_user = unsafe { &*token_buffer.as_ptr().cast::<TokenUser>() };
        let mut owner = ptr::null_mut();
        let mut descriptor = ptr::null_mut();
        let error = unsafe {
            GetSecurityInfo(
                handle.0,
                1,
                1 | 4,
                &mut owner,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                &mut descriptor,
            )
        };
        if error != 0 {
            return Err(io::Error::from_raw_os_error(error as i32));
        }
        let descriptor = SecurityDescriptor(descriptor);
        let same_owner = unsafe { EqualSid(token_user.user.sid, owner) } != 0;
        let mut control = 0;
        let mut revision = 0;
        if unsafe { GetSecurityDescriptorControl(descriptor.0, &mut control, &mut revision) } == 0 {
            return Err(io::Error::last_os_error());
        }
        // Protected DACL is only observed here, not proof that its ACEs are safe.
        Ok((same_owner, control & 0x1000 != 0, elevation != 0))
    }
    fn directory_flushes(path: &Path) -> io::Result<String> {
        let candidates = [
            DIRECTORY_READ,
            DIRECTORY_READ | 0x100,
            DIRECTORY_READ | 0x100 | 2 | 4,
            GENERIC_READ | GENERIC_WRITE,
        ];
        let mut observations = Vec::new();
        for access in candidates {
            match open(path, access, 3, true) {
                Err(error) => observations.push(format!("{{\"access\":\"0x{access:08x}\",\"openWin32Error\":{},\"win32FlushError\":null,\"ntFlushStatus\":null,\"identityStable\":null}}", error.raw_os_error().unwrap_or(-1))),
                Ok(handle) => {
                    let before = info(&handle)?;
                    let win32_error = flush_file(&handle);
                    let mut iosb = IoStatusBlock { status: 0, information: 0 };
                    let nt_status = unsafe { NtFlushBuffersFileEx(handle.0, 0, ptr::null(), 0, &mut iosb) };
                    let stable = same_identity(before, info(&handle)?);
                    observations.push(format!("{{\"access\":\"0x{access:08x}\",\"openWin32Error\":0,\"win32FlushError\":{win32_error},\"ntFlushStatus\":\"0x{:08x}\",\"identityStable\":{stable}}}", nt_status as u32));
                }
            }
        }
        Ok(format!("[{}]", observations.join(",")))
    }

    pub fn run() -> io::Result<()> {
        let arguments: Vec<_> = std::env::args_os().skip(1).collect();
        if arguments.len() != 1 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "expected one run-owned empty directory",
            ));
        }
        let root = PathBuf::from(&arguments[0]);
        if !root.is_absolute() || fs::read_dir(&root)?.next().is_some() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "probe directory must be absolute and empty",
            ));
        }
        let root_handle = open_real_directory(&root)?;
        let before = info(&root_handle)?;
        let reopened = open_real_directory(&root)?;
        let identity_stable = same_identity(before, info(&reopened)?);
        let (owner_matches_token, dacl_protected, token_elevated) =
            owner_observation(&root_handle)?;
        let (filesystem, filesystem_flags) = filesystem_observation(&root_handle)?;

        let file_path = root.join("exclusive.dat");
        let file = open(&file_path, GENERIC_READ | GENERIC_WRITE, 1, false)?;
        let bytes = b"vdt-windows-storage-probe-v1";
        let mut written = 0;
        if unsafe {
            WriteFile(
                file.0,
                bytes.as_ptr().cast(),
                bytes.len() as u32,
                &mut written,
                ptr::null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        if written != bytes.len() as u32 {
            return Err(io::Error::new(
                io::ErrorKind::WriteZero,
                "incomplete probe write",
            ));
        }
        let file_flush_error = flush_file(&file);
        let collision = open(&file_path, GENERIC_WRITE, 1, false)
            .err()
            .and_then(|error| error.raw_os_error())
            .unwrap_or(0);
        drop(file);
        let collision_preserved = fs::read(&file_path)? == bytes;
        let published_flushes = directory_flushes(&root)?;
        fs::remove_file(&file_path)?;
        let unlink_flushes = directory_flushes(&root)?;

        let retained_dir = root.join("retained");
        fs::create_dir(&retained_dir)?;
        let retained_handle = open_real_directory(&retained_dir)?;
        let rename_error = fs::rename(&retained_dir, root.join("renamed"))
            .err()
            .and_then(|error| error.raw_os_error())
            .unwrap_or(0);
        drop(retained_handle);

        let target = root.join("target");
        let alias = root.join("reparse");
        fs::create_dir(&target)?;
        let (reparse_setup_error, reparse_rejected) =
            match std::os::windows::fs::symlink_dir(&target, &alias) {
                Ok(()) => (0, Some(open_real_directory(&alias).is_err())),
                Err(error) => (error.raw_os_error().unwrap_or(-1), None),
            };
        let native_directory = unsafe {
            super::windows_directory::FlushableDirectory::open_relative(root_handle.0, "retained")
        }?;
        native_directory.flush()?;
        let mut relative_file = native_directory.create_file("relative.dat")?;
        relative_file.write_all(bytes)?;
        relative_file.flush()?;
        drop(relative_file);
        if native_directory
            .create_file("relative.dat")
            .err()
            .map(|error| error.kind())
            != Some(io::ErrorKind::AlreadyExists)
            || fs::read(retained_dir.join("relative.dat"))? != bytes
        {
            return Err(io::Error::other(
                "root-relative file create did not preserve existing bytes",
            ));
        }
        let removable = native_directory.create_file("removable.dat")?;
        removable.remove()?;
        if retained_dir.join("removable.dat").try_exists()? {
            return Err(io::Error::other("handle-based unlink left an entry behind"));
        }
        let rejected_alias = reparse_rejected.map(|_| {
            unsafe {
                super::windows_directory::FlushableDirectory::open_relative(
                    root_handle.0,
                    "reparse",
                )
            }
            .is_err()
        });
        if rejected_alias == Some(false) {
            return Err(io::Error::other(
                "root-relative directory primitive followed a reparse point",
            ));
        }
        if unsafe {
            super::windows_directory::FlushableDirectory::open_relative(root_handle.0, "..")
        }
        .is_ok()
        {
            return Err(io::Error::other(
                "root-relative directory primitive accepted traversal",
            ));
        }
        let relative_reparse_json = rejected_alias
            .map(|value| value.to_string())
            .unwrap_or_else(|| "null".into());
        let reparse_json = reparse_rejected
            .map(|value| value.to_string())
            .unwrap_or_else(|| "null".into());
        println!("{{\"schemaVersion\":\"windows_storage_primitive_probe.v1\",\"processArch\":\"{}\",\"productionAdmission\":false,\"certifiesCrashDurability\":false,\"filesystem\":\"{filesystem}\",\"filesystemFlags\":{filesystem_flags},\"tokenElevated\":{token_elevated},\"retainedIdentityStable\":{identity_stable},\"ownerMatchesToken\":{owner_matches_token},\"daclProtected\":{dacl_protected},\"daclPolicyCertified\":false,\"fileFlushWin32Error\":{file_flush_error},\"exclusiveCreateCollisionWin32Error\":{collision},\"exclusiveCreatePreservedBytes\":{collision_preserved},\"retainedDirectoryRenameWin32Error\":{rename_error},\"reparseSetupWin32Error\":{reparse_setup_error},\"reparseRejected\":{reparse_json},\"relativeFilePrimitivesSucceeded\":true,\"relativeDirectoryFlushSucceeded\":true,\"relativeReparseRejected\":{relative_reparse_json},\"afterPublication\":{published_flushes},\"afterUnlink\":{unlink_flushes}}}", std::env::consts::ARCH);
        Ok(())
    }
}
