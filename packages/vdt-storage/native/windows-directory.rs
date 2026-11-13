// Windows storage capability prototype. Callers must retain and validate the
// ancestor chain and enforce the private-directory ACL policy before mutation.
use std::{ffi::c_void, io, mem, ptr};

type Handle = *mut c_void;
const FILE_SHARE_READ_WRITE: u32 = 3;
const DIRECTORY_FLUSH_ACCESS: u32 = 0x0012_0187;
const FILE_OPEN: u32 = 1;
const FILE_DIRECTORY_FILE: u32 = 0x1;
const FILE_SYNCHRONOUS_IO_NONALERT: u32 = 0x20;
const FILE_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
const OBJ_CASE_INSENSITIVE: u32 = 0x40;
const OBJ_DONT_REPARSE: u32 = 0x1000;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const FILE_ATTRIBUTE_TAG_INFO_CLASS: u32 = 9;

#[repr(C)]
struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *const u16,
}

#[repr(C)]
struct ObjectAttributes {
    length: u32,
    root_directory: Handle,
    object_name: *const UnicodeString,
    attributes: u32,
    security_descriptor: *const c_void,
    security_quality_of_service: *const c_void,
}

#[repr(C)]
struct IoStatusBlock {
    status: usize,
    information: usize,
}

#[repr(C)]
struct FileAttributeTagInfo {
    attributes: u32,
    reparse_tag: u32,
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtCreateFile(
        handle: *mut Handle,
        access: u32,
        attributes: *const ObjectAttributes,
        status: *mut IoStatusBlock,
        allocation_size: *const i64,
        file_attributes: u32,
        share_access: u32,
        disposition: u32,
        options: u32,
        ea_buffer: *const c_void,
        ea_length: u32,
    ) -> i32;
    fn RtlNtStatusToDosError(status: i32) -> u32;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CloseHandle(handle: Handle) -> i32;
    fn FlushFileBuffers(handle: Handle) -> i32;
    fn GetFileInformationByHandleEx(
        handle: Handle,
        class: u32,
        information: *mut c_void,
        size: u32,
    ) -> i32;
}

pub struct FlushableDirectory(Handle);

impl Drop for FlushableDirectory {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

impl FlushableDirectory {
    /// Open an existing direct child without following a reparse point.
    ///
    /// The caller must retain a valid directory handle for the duration of
    /// this call. Ownership and locality checks belong to the caller.
    pub unsafe fn open_relative(parent: Handle, name: &str) -> io::Result<Self> {
        let component = encode_component(name)?;
        let byte_length = (component.len() * mem::size_of::<u16>()) as u16;
        let name = UnicodeString {
            length: byte_length,
            maximum_length: byte_length,
            buffer: component.as_ptr(),
        };
        let attributes = ObjectAttributes {
            length: mem::size_of::<ObjectAttributes>() as u32,
            root_directory: parent,
            object_name: &name,
            attributes: OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE,
            security_descriptor: ptr::null(),
            security_quality_of_service: ptr::null(),
        };
        let mut handle = ptr::null_mut();
        let mut status = IoStatusBlock {
            status: 0,
            information: 0,
        };
        let result = unsafe {
            NtCreateFile(
                &mut handle,
                DIRECTORY_FLUSH_ACCESS,
                &attributes,
                &mut status,
                ptr::null(),
                0,
                FILE_SHARE_READ_WRITE,
                FILE_OPEN,
                FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT,
                ptr::null(),
                0,
            )
        };
        if result < 0 {
            return Err(io::Error::from_raw_os_error(
                unsafe { RtlNtStatusToDosError(result) } as i32,
            ));
        }
        let directory = Self(handle);
        directory.reject_reparse_point()?;
        Ok(directory)
    }

    pub fn flush(&self) -> io::Result<()> {
        self.reject_reparse_point()?;
        if unsafe { FlushFileBuffers(self.0) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    fn reject_reparse_point(&self) -> io::Result<()> {
        let mut info = FileAttributeTagInfo {
            attributes: 0,
            reparse_tag: 0,
        };
        if unsafe {
            GetFileInformationByHandleEx(
                self.0,
                FILE_ATTRIBUTE_TAG_INFO_CLASS,
                (&mut info as *mut FileAttributeTagInfo).cast(),
                mem::size_of::<FileAttributeTagInfo>() as u32,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        if info.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "directory is a reparse point",
            ));
        }
        Ok(())
    }
}

fn encode_component(name: &str) -> io::Result<Vec<u16>> {
    let encoded: Vec<_> = name.encode_utf16().collect();
    if encoded.is_empty()
        || encoded.len() > 255
        || name.ends_with(['.', ' '])
        || name.contains(['\\', '/', ':', '\0'])
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "expected one native directory component",
        ));
    }
    Ok(encoded)
}
