use std::io;

use crate::windows_directory::{
    open_relative, CreatedFile, FlushableDirectory, OwnedHandle, FILE_ACCESS, FILE_DIRECTORY_FILE,
    FILE_NON_DIRECTORY_FILE, FILE_OPEN,
};

const GENERIC_READ: u32 = 0x8000_0000;
const DELETE_READ_ATTRIBUTES_READ_CONTROL_SYNCHRONIZE: u32 = 0x0013_0080;
const ERROR_REVISION_MISMATCH: i32 = 1306;

fn open_expected(
    directory: &FlushableDirectory,
    name: &str,
    access: u32,
    expected: &[u8],
) -> io::Result<OwnedHandle> {
    let handle = open_relative(
        directory.0.raw,
        name,
        access | GENERIC_READ,
        0,
        FILE_OPEN,
        FILE_NON_DIRECTORY_FILE,
    )?;
    handle.validate_private_file()?;
    handle.verify_exact_bytes(expected).map_err(|error| {
        if error.kind() == io::ErrorKind::InvalidData {
            io::Error::from_raw_os_error(ERROR_REVISION_MISMATCH)
        } else {
            error
        }
    })?;
    Ok(handle)
}

// Callers retain and validate both directory sessions before invoking a move.
pub(crate) fn move_file(
    source: &FlushableDirectory,
    name: &str,
    target: &FlushableDirectory,
    target_name: &str,
    expected: &[u8],
) -> io::Result<()> {
    let handle = open_expected(source, name, FILE_ACCESS, expected)?;
    handle.flush()?;
    rename_and_flush(source, target, target_name, &handle)
}

pub(crate) fn move_dir(
    source: &FlushableDirectory,
    name: &str,
    target: &FlushableDirectory,
    target_name: &str,
) -> io::Result<()> {
    let handle = open_relative(
        source.0.raw,
        name,
        DELETE_READ_ATTRIBUTES_READ_CONTROL_SYNCHRONIZE,
        0,
        FILE_OPEN,
        FILE_DIRECTORY_FILE,
    )?;
    handle.reject_reparse_point()?;
    crate::windows_security::validate_private_descendant(handle.raw)?;
    rename_and_flush(source, target, target_name, &handle)
}

fn rename_and_flush(
    source: &FlushableDirectory,
    target: &FlushableDirectory,
    target_name: &str,
    entry: &OwnedHandle,
) -> io::Result<()> {
    target.rename_handle(entry, target_name, false)?;
    // A failed flush after a successful rename is ambiguous. Never undo or
    // retry it implicitly. Still attempt to flush both retained parents.
    let source_result = source.flush();
    let target_result = target.flush();
    source_result.and(target_result)
}

pub(crate) fn unlink_expected(
    directory: &FlushableDirectory,
    name: &str,
    expected: &[u8],
) -> io::Result<()> {
    let handle = open_expected(
        directory,
        name,
        DELETE_READ_ATTRIBUTES_READ_CONTROL_SYNCHRONIZE,
        expected,
    )?;
    CreatedFile {
        handle,
        parent: directory,
    }
    .remove()
}

/// Retain a checked leaf during dispatch to the system's registered editor.
/// Sharing permits ordinary reads/writes while excluding rename and deletion.
pub(crate) fn open_editor_leaf(
    directory: &FlushableDirectory,
    name: &str,
) -> io::Result<OwnedHandle> {
    const READ_ATTRIBUTES_READ_CONTROL_SYNCHRONIZE: u32 = 0x0012_0080;
    const SHARE_READ_WRITE: u32 = 3;
    let handle = open_relative(
        directory.0.raw,
        name,
        GENERIC_READ | READ_ATTRIBUTES_READ_CONTROL_SYNCHRONIZE,
        SHARE_READ_WRITE,
        FILE_OPEN,
        FILE_NON_DIRECTORY_FILE,
    )?;
    handle.validate_private_file()?;
    Ok(handle)
}
