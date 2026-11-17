// Directory enumeration and empty-directory removal use retained handles.
// The caller validates the handle, owns its enumeration cursor exclusively,
// and closes a deletion handle before flushing the parent directory.
use std::{ffi::c_void, io};

const FILE_FULL_DIRECTORY_INFO: u32 = 14;
const FILE_FULL_DIRECTORY_RESTART_INFO: u32 = 15;
const FILE_DISPOSITION_INFO: u32 = 4;
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const ERROR_NO_MORE_FILES: i32 = 18;
const MAX_ENTRIES: usize = 32_768;
const BUFFER_BYTES: usize = 16 * 1024;
// Offsets within the Windows SDK FILE_FULL_DIR_INFO structure.
const ATTRIBUTES_OFFSET: usize = 56;
const NAME_LENGTH_OFFSET: usize = 60;
const NAME_OFFSET: usize = 68;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetFileInformationByHandleEx(
        handle: *mut c_void,
        class: u32,
        buffer: *mut c_void,
        size: u32,
    ) -> i32;
    fn SetFileInformationByHandle(
        handle: *mut c_void,
        class: u32,
        buffer: *const c_void,
        size: u32,
    ) -> i32;
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct DirectoryEntry {
    pub name: String,
    pub is_directory: bool,
    pub is_reparse: bool,
}

/// The handle must be a live, validated directory opened for FILE_LIST_DIRECTORY.
/// No other caller may use its enumeration cursor for the duration of this call.
pub(crate) unsafe fn list(handle: *mut c_void) -> io::Result<Vec<DirectoryEntry>> {
    let mut aligned = [0u64; BUFFER_BYTES / 8];
    let mut class = FILE_FULL_DIRECTORY_RESTART_INFO;
    let mut entries = Vec::new();
    loop {
        aligned.fill(0);
        let status = unsafe {
            GetFileInformationByHandleEx(
                handle,
                class,
                aligned.as_mut_ptr().cast(),
                BUFFER_BYTES as u32,
            )
        };
        if status == 0 {
            let error = io::Error::last_os_error();
            return if error.raw_os_error() == Some(ERROR_NO_MORE_FILES) {
                Ok(entries)
            } else {
                Err(error)
            };
        }
        let bytes =
            unsafe { std::slice::from_raw_parts(aligned.as_ptr().cast::<u8>(), BUFFER_BYTES) };
        decode_batch(bytes, &mut entries)?;
        class = FILE_FULL_DIRECTORY_INFO;
    }
}

fn decode_batch(mut bytes: &[u8], entries: &mut Vec<DirectoryEntry>) -> io::Result<()> {
    loop {
        if bytes.len() < NAME_OFFSET {
            return Err(invalid_entries());
        }
        let number =
            |offset: usize| u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
        let next = number(0) as usize;
        let attributes = number(ATTRIBUTES_OFFSET);
        let name_bytes = number(NAME_LENGTH_OFFSET) as usize;
        let entry_end = if next == 0 { bytes.len() } else { next };
        if entry_end > bytes.len()
            || entry_end < NAME_OFFSET
            || (next != 0 && next % 8 != 0)
            || name_bytes == 0
            || name_bytes % 2 != 0
            || name_bytes > entry_end - NAME_OFFSET
        {
            return Err(invalid_entries());
        }
        let units: Vec<_> = bytes[NAME_OFFSET..NAME_OFFSET + name_bytes]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        let name = String::from_utf16(&units).map_err(|_| invalid_entries())?;
        if name.contains(['\0', '/', '\\', ':']) {
            return Err(invalid_entries());
        }
        if name != "." && name != ".." {
            if entries.len() == MAX_ENTRIES {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Windows storage directory exceeds the enumeration limit",
                ));
            }
            entries.push(DirectoryEntry {
                name,
                is_directory: attributes & FILE_ATTRIBUTE_DIRECTORY != 0,
                is_reparse: attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0,
            });
        }
        if next == 0 {
            return Ok(());
        }
        bytes = &bytes[next..];
    }
}

fn invalid_entries() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "invalid Windows storage directory entry",
    )
}

/// The handle must be a live, validated non-reparse directory opened for DELETE.
/// NTFS rejects a nonempty directory. The caller must close the handle to finish
/// deletion and flush the retained parent before reporting durable completion.
pub(crate) unsafe fn remove_empty_directory(handle: *mut c_void) -> io::Result<()> {
    let delete_file: u8 = 1; // FILE_DISPOSITION_INFO.DeleteFile is a BOOLEAN.
    let status = unsafe {
        SetFileInformationByHandle(
            handle,
            FILE_DISPOSITION_INFO,
            (&delete_file as *const u8).cast(),
            1,
        )
    };
    if status == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}
