#[path = "windows-directory.rs"]
mod windows_directory;
#[path = "windows-directory-entries.rs"]
mod windows_directory_entries;
#[path = "windows-directory-moves.rs"]
mod windows_directory_moves;
#[path = "windows-security.rs"]
mod windows_security;
#[path = "windows-skill-lock.rs"]
mod windows_skill_lock;
#[path = "windows-storage-session.rs"]
mod windows_storage_session;

use std::{io, path::Path, ptr, rc::Rc, slice, str};
use windows_storage_session::StorageSession;

type Session = Rc<StorageSession>;

// The Node shim passes only valid memory ranges for the duration of a call.
// The native handle is owned exclusively by the wrapped Node-API object.
#[no_mangle]
unsafe extern "C" fn vdt_storage_open(
    path: *const u8,
    length: usize,
    create: u8,
    output: *mut *mut Session,
) -> u32 {
    status(|| {
        let path = utf8(path, length)?;
        let session = StorageSession::open(Path::new(path), create != 0)?;
        unsafe { *output = Box::into_raw(Box::new(Rc::new(session))) };
        Ok(())
    })
}

#[no_mangle]
unsafe extern "C" fn vdt_storage_write(
    session: &Session,
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
unsafe extern "C" fn vdt_storage_publish(
    session: &Session,
    stage: *const u8,
    stage_len: usize,
    destination: *const u8,
    dest_len: usize,
    expected: *const u8,
    length: usize,
) -> u32 {
    status(|| {
        let bytes = if length == 0 {
            &[]
        } else {
            unsafe { slice::from_raw_parts(expected, length) }
        };
        session.publish(utf8(stage, stage_len)?, utf8(destination, dest_len)?, bytes)
    })
}

#[no_mangle]
unsafe extern "C" fn vdt_storage_replace(
    session: &Session,
    stage: *const u8,
    stage_len: usize,
    destination: *const u8,
    dest_len: usize,
    previous: *const u8,
    prev_len: usize,
    expected: *const u8,
    length: usize,
) -> u32 {
    status(|| {
        let old = if prev_len == 0 {
            &[]
        } else {
            unsafe { slice::from_raw_parts(previous, prev_len) }
        };
        let bytes = if length == 0 {
            &[]
        } else {
            unsafe { slice::from_raw_parts(expected, length) }
        };
        session.replace(
            utf8(stage, stage_len)?,
            utf8(destination, dest_len)?,
            old,
            bytes,
        )
    })
}

#[no_mangle]
unsafe extern "C" fn vdt_storage_read(
    session: &Session,
    name: *const u8,
    name_len: usize,
    bytes: *mut u8,
    capacity: usize,
    durable: u8,
    read: *mut usize,
) -> u32 {
    status(|| {
        let output = if capacity == 0 {
            &mut []
        } else {
            unsafe { slice::from_raw_parts_mut(bytes, capacity) }
        };
        let length = session.read(utf8(name, name_len)?, output, durable != 0)?;
        unsafe { *read = length };
        Ok(())
    })
}

#[no_mangle]
unsafe extern "C" fn vdt_storage_open_child(
    session: &Session,
    name: *const u8,
    length: usize,
    create: u8,
    output: *mut *mut Session,
) -> u32 {
    status(|| {
        let child =
            StorageSession::open_child(Rc::clone(session), utf8(name, length)?, create != 0)?;
        unsafe { *output = Box::into_raw(Box::new(Rc::new(child))) };
        Ok(())
    })
}

struct StorageLock {
    _handle: windows_directory::OwnedHandle,
    _session: Session,
}

#[no_mangle]
unsafe extern "C" fn vdt_storage_acquire_lock(
    session: &Session,
    name: *const u8,
    length: usize,
    output: *mut *mut StorageLock,
) -> u32 {
    status(|| {
        let handle = session.acquire_lock(utf8(name, length)?)?;
        unsafe {
            *output = Box::into_raw(Box::new(StorageLock {
                _handle: handle,
                _session: Rc::clone(session),
            }))
        };
        Ok(())
    })
}

#[no_mangle]
unsafe extern "C" fn vdt_storage_open_editor_leaf(
    session: &Session,
    name: *const u8,
    length: usize,
    output: *mut *mut StorageLock,
) -> u32 {
    status(|| {
        let handle = session.open_editor_leaf(utf8(name, length)?)?;
        unsafe {
            *output = Box::into_raw(Box::new(StorageLock {
                _handle: handle,
                _session: Rc::clone(session),
            }))
        };
        Ok(())
    })
}

#[no_mangle]
unsafe extern "C" fn vdt_storage_release_lock(lock: *mut StorageLock) {
    if !lock.is_null() {
        drop(unsafe { Box::from_raw(lock) });
    }
}

type TextCallback = unsafe extern "C" fn(*mut std::ffi::c_void, *const u8, usize) -> u8;

fn return_editor_path(
    path: String,
    context: *mut std::ffi::c_void,
    callback: TextCallback,
) -> io::Result<()> {
    let path = path
        .strip_prefix(r"\\?\")
        .filter(|path| path.as_bytes().get(1..3) == Some(b":\\"))
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::Unsupported,
                "editor object does not have a canonical local drive path",
            )
        })?;
    if unsafe { callback(context, path.as_ptr(), path.len()) } == 0 {
        return Err(io::Error::other("could not return native editor path"));
    }
    Ok(())
}

#[no_mangle]
extern "C" fn vdt_storage_editor_path(
    lock: &StorageLock,
    context: *mut std::ffi::c_void,
    callback: TextCallback,
) -> u32 {
    status(|| return_editor_path(lock._handle.final_path(0)?, context, callback))
}

#[no_mangle]
extern "C" fn vdt_storage_editor_directory_path(
    session: &Session,
    context: *mut std::ffi::c_void,
    callback: TextCallback,
) -> u32 {
    status(|| return_editor_path(session.editor_directory_path()?, context, callback))
}

#[no_mangle]
extern "C" fn vdt_storage_sqlite_path(
    session: &Session,
    context: *mut std::ffi::c_void,
    callback: TextCallback,
) -> u32 {
    status(|| {
        let path = session.sqlite_path()?;
        if unsafe { callback(context, path.as_ptr(), path.len()) } == 0 {
            return Err(io::Error::other("could not return native SQLite path"));
        }
        Ok(())
    })
}

#[no_mangle]
unsafe extern "C" fn vdt_storage_move_entry(
    session: &Session,
    name: *const u8,
    length: usize,
    target: &Session,
    target_name: *const u8,
    target_length: usize,
    bytes: *const u8,
    byte_length: usize,
    file: u8,
) -> u32 {
    status(|| {
        let expected = if file == 0 {
            None
        } else if byte_length == 0 {
            Some(&[][..])
        } else {
            Some(unsafe { slice::from_raw_parts(bytes, byte_length) })
        };
        session.move_entry(
            utf8(name, length)?,
            target,
            utf8(target_name, target_length)?,
            expected,
        )
    })
}

#[no_mangle]
unsafe extern "C" fn vdt_storage_unlink_expected(
    session: &Session,
    name: *const u8,
    length: usize,
    bytes: *const u8,
    byte_length: usize,
) -> u32 {
    status(|| {
        let expected = if byte_length == 0 {
            &[]
        } else {
            unsafe { slice::from_raw_parts(bytes, byte_length) }
        };
        session.unlink_expected(utf8(name, length)?, expected)
    })
}

type EntryCallback = unsafe extern "C" fn(*mut std::ffi::c_void, *const u8, usize, u8, u8) -> u8;

#[no_mangle]
extern "C" fn vdt_storage_list(
    session: &Session,
    context: *mut std::ffi::c_void,
    callback: EntryCallback,
) -> u32 {
    status(|| {
        for entry in session.list()? {
            if unsafe {
                callback(
                    context,
                    entry.name.as_ptr(),
                    entry.name.len(),
                    entry.is_directory.into(),
                    entry.is_reparse.into(),
                )
            } == 0
            {
                return Err(io::Error::other("could not return storage directory entry"));
            }
        }
        Ok(())
    })
}

#[no_mangle]
unsafe extern "C" fn vdt_storage_remove_empty_child(
    session: &Session,
    name: *const u8,
    length: usize,
) -> u32 {
    status(|| session.remove_empty_child(utf8(name, length)?))
}

#[no_mangle]
unsafe extern "C" fn vdt_storage_ensure_child(
    session: &Session,
    name: *const u8,
    length: usize,
) -> u32 {
    status(|| session.ensure_child(utf8(name, length)?))
}

#[no_mangle]
unsafe extern "C" fn vdt_storage_unlink(session: &Session, name: *const u8, length: usize) -> u32 {
    status(|| session.unlink(utf8(name, length)?))
}

#[no_mangle]
extern "C" fn vdt_storage_flush(session: &Session) -> u32 {
    status(|| session.flush())
}

#[no_mangle]
unsafe extern "C" fn vdt_storage_close(session: *mut Session) {
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
                io::ErrorKind::InvalidData => 13,
                _ => 31,
            },
            |code| code as u32,
        ),
    }
}
