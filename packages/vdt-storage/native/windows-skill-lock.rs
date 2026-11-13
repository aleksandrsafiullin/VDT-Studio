// Retain the opened lock file for the entire lease. Windows releases the lock
// when the process exits or its final owning handle closes.
use std::{ffi::c_void, io};

const LOCKFILE_FAIL_IMMEDIATELY: u32 = 1;
const LOCKFILE_EXCLUSIVE_LOCK: u32 = 2;

#[repr(C)]
struct Overlapped {
    internal: usize,
    internal_high: usize,
    offset: u32,
    offset_high: u32,
    event: *mut c_void,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn LockFileEx(
        handle: *mut c_void,
        flags: u32,
        reserved: u32,
        bytes_low: u32,
        bytes_high: u32,
        overlapped: *mut Overlapped,
    ) -> i32;
}

/// The caller must own a synchronous handle opened for write access with
/// sharing that excludes deletion, and must keep that handle until release.
pub(crate) unsafe fn acquire_write_lock(handle: *mut c_void) -> io::Result<()> {
    let mut overlapped = Overlapped {
        internal: 0,
        internal_high: 0,
        offset: 0,
        offset_high: 0,
        event: std::ptr::null_mut(),
    };
    let status = unsafe {
        LockFileEx(
            handle,
            LOCKFILE_FAIL_IMMEDIATELY | LOCKFILE_EXCLUSIVE_LOCK,
            0,
            1,
            0,
            &mut overlapped,
        )
    };
    if status == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}
