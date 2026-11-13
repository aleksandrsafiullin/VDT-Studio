#[path = "windows-directory.rs"]
mod windows_directory;
#[path = "windows-security.rs"]
mod windows_security;
#[path = "windows-storage-session.rs"]
mod windows_storage_session;

use std::{io, path::Path, ptr, slice, str};
use windows_storage_session::StorageSession;

// The Node shim passes only valid memory ranges for the duration of a call.
// The native handle is owned exclusively by the wrapped Node-API object.
#[no_mangle]
unsafe extern "C" fn vdt_storage_open(
    path: *const u8,
    length: usize,
    output: *mut *mut StorageSession,
) -> u32 {
    status(|| {
        let path = utf8(path, length)?;
        let session = StorageSession::open(Path::new(path))?;
        unsafe { *output = Box::into_raw(Box::new(session)) };
        Ok(())
    })
}

#[no_mangle]
unsafe extern "C" fn vdt_storage_write(
    session: &StorageSession,
    name: *const u8,
    name_len: usize,
    bytes: *const u8,
    len: usize,
) -> u32 {
    status(|| {
        let name = utf8(name, name_len)?;
        let bytes = if len == 0 {
            &[]
        } else {
            unsafe { slice::from_raw_parts(bytes, len) }
        };
        session.write_exclusive(name, bytes)
    })
}

#[no_mangle]
unsafe extern "C" fn vdt_storage_unlink(
    session: &StorageSession,
    name: *const u8,
    length: usize,
) -> u32 {
    status(|| session.unlink(utf8(name, length)?))
}

#[no_mangle]
extern "C" fn vdt_storage_flush(session: &StorageSession) -> u32 {
    status(|| session.flush())
}

#[no_mangle]
unsafe extern "C" fn vdt_storage_close(session: *mut StorageSession) {
    if !ptr::eq(session, ptr::null_mut()) {
        drop(unsafe { Box::from_raw(session) });
    }
}

fn utf8<'a>(bytes: *const u8, length: usize) -> io::Result<&'a str> {
    str::from_utf8(unsafe { slice::from_raw_parts(bytes, length) })
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))
}

fn status(operation: impl FnOnce() -> io::Result<()>) -> u32 {
    match operation() {
        Ok(()) => 0,
        Err(error) => error.raw_os_error().map_or_else(
            || match error.kind() {
                io::ErrorKind::PermissionDenied => 5,
                io::ErrorKind::InvalidInput => 87,
                io::ErrorKind::Unsupported => 50,
                _ => 31,
            },
            |code| code as u32,
        ),
    }
}
