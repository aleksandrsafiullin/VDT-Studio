// Windows storage capability prototype. Callers must retain and validate the
// ancestor chain and enforce the private-directory ACL policy before mutation.
use std::{ffi::c_void, io, mem, ptr};

type Handle = *mut c_void;
const FILE_SHARE_READ_WRITE: u32 = 3;
const DIRECTORY_FLUSH_ACCESS: u32 = 0x0012_0187;
const FILE_OPEN: u32 = 1;
const FILE_CREATE: u32 = 2;
const FILE_WRITE_THROUGH: u32 = 2;
const FILE_NON_DIRECTORY_FILE: u32 = 0x40;
const FILE_ACCESS: u32 = 0x4013_0080; // GENERIC_WRITE | DELETE | READ_CONTROL | SYNCHRONIZE | READ_ATTRIBUTES
const FILE_DISPOSITION_INFO_CLASS: u32 = 4;
#[cfg(vdt_storage_addon)]
const DELETE_FILE_ACCESS: u32 = 0x0013_0080;
#[cfg(vdt_storage_addon)]
const FILE_RENAME_INFO_CLASS: u32 = 10;
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

#[cfg(vdt_storage_addon)]
#[repr(C)]
struct FileRenameInfo {
    replace_if_exists: u32,
    root_directory: Handle,
    file_name_length: u32,
    file_name: [u16; 1],
}

#[cfg(vdt_storage_addon)]
#[repr(C)]
struct FileStandardInfo {
    allocation_size: i64,
    end_of_file: i64,
    number_of_links: u32,
    delete_pending: u8,
    directory: u8,
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
    #[cfg(vdt_storage_addon)]
    fn NtSetInformationFile(
        handle: Handle,
        status: *mut IoStatusBlock,
        information: *const c_void,
        length: u32,
        class: u32,
    ) -> i32;
    fn RtlNtStatusToDosError(status: i32) -> u32;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CloseHandle(handle: Handle) -> i32;
    fn FlushFileBuffers(handle: Handle) -> i32;
    #[cfg(vdt_storage_addon)]
    fn ReadFile(
        handle: Handle,
        buffer: *mut c_void,
        length: u32,
        read: *mut u32,
        overlapped: *mut c_void,
    ) -> i32;
    fn WriteFile(
        handle: Handle,
        buffer: *const c_void,
        length: u32,
        written: *mut u32,
        overlapped: *mut c_void,
    ) -> i32;
    fn SetFileInformationByHandle(
        handle: Handle,
        class: u32,
        information: *const c_void,
        size: u32,
    ) -> i32;
    fn GetFileInformationByHandleEx(
        handle: Handle,
        class: u32,
        information: *mut c_void,
        size: u32,
    ) -> i32;
}

pub(crate) struct OwnedHandle {
    pub(crate) raw: Handle,
}

pub struct FlushableDirectory(OwnedHandle);

pub struct CreatedFile<'a> {
    handle: OwnedHandle,
    parent: &'a FlushableDirectory,
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.raw) };
    }
}

impl FlushableDirectory {
    /// Open an existing direct child without following a reparse point.
    ///
    /// The caller must retain a valid directory handle for the duration of
    /// this call. Ownership and locality checks belong to the caller.
    pub unsafe fn open_relative(parent: Handle, name: &str) -> io::Result<Self> {
        let directory = Self(open_relative(
            parent,
            name,
            DIRECTORY_FLUSH_ACCESS,
            FILE_SHARE_READ_WRITE,
            FILE_OPEN,
            FILE_DIRECTORY_FILE,
        )?);
        directory.reject_reparse_point()?;
        Ok(directory)
    }

    pub fn flush(&self) -> io::Result<()> {
        self.reject_reparse_point()?;
        self.0.flush()
    }

    /// Create a new direct child. The parent must already enforce a private
    /// inheritable DACL. Existing entries are never opened for modification.
    pub fn create_file(&self, name: &str) -> io::Result<CreatedFile<'_>> {
        self.reject_reparse_point()?;
        let handle = open_relative(
            self.0.raw,
            name,
            FILE_ACCESS,
            0,
            FILE_CREATE,
            FILE_NON_DIRECTORY_FILE | FILE_WRITE_THROUGH,
        )?;
        #[cfg(vdt_storage_addon)]
        handle.validate_private_file()?;
        Ok(CreatedFile {
            handle,
            parent: self,
        })
    }

    #[cfg(vdt_storage_addon)]
    pub(crate) fn unlink(&self, name: &str) -> io::Result<()> {
        let handle = open_relative(
            self.0.raw,
            name,
            DELETE_FILE_ACCESS,
            0,
            FILE_OPEN,
            FILE_NON_DIRECTORY_FILE,
        )?;
        handle.validate_private_file()?;
        self.0.reject_reparse_point()?;
        CreatedFile {
            handle,
            parent: self,
        }
        .remove()
    }

    #[cfg(vdt_storage_addon)]
    pub(crate) fn ensure_bootstrap_directory(&self, name: &str) -> io::Result<Self> {
        self.reject_reparse_point()?;
        self.0.ensure_private_directory(name)
    }

    #[cfg(vdt_storage_addon)]
    pub(crate) fn open_child(&self, name: &str) -> io::Result<Self> {
        self.validate_private_dacl()?;
        let child = self.0.open_flushable_directory(name)?;
        child.validate_private_dacl()?;
        Ok(child)
    }

    #[cfg(vdt_storage_addon)]
    pub(crate) fn ensure_child(&self, name: &str) -> io::Result<()> {
        self.validate_private_dacl()?;
        self.0.ensure_private_directory(name)?;
        Ok(())
    }

    #[cfg(vdt_storage_addon)]
    pub(crate) fn read_verified(
        &self,
        name: &str,
        bytes: &mut [u8],
        durable: bool,
    ) -> io::Result<usize> {
        let access = 0x8012_0080 | if durable { 0x4000_0000 } else { 0 };
        let handle = open_relative(
            self.0.raw,
            name,
            access,
            0,
            FILE_OPEN,
            FILE_NON_DIRECTORY_FILE,
        )?;
        let info = handle.validate_private_file()?;
        let length = usize::try_from(info.end_of_file)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid file size"))?;
        if length > bytes.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "file exceeds its byte bound",
            ));
        }
        let mut offset = 0;
        while offset < length {
            let end = length.min(offset.saturating_add(64 * 1024));
            let read = handle.read(&mut bytes[offset..end])?;
            if read == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "file truncated while reading",
                ));
            }
            offset += read;
        }
        if handle.read(&mut [0u8; 1])? != 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "file grew while reading",
            ));
        }
        if durable {
            handle.flush()?;
            self.flush()?;
        }
        Ok(length)
    }

    /// Publish an already verified same-directory stage. The source handle
    /// excludes concurrent writers and namespace changes during rename.
    #[cfg(vdt_storage_addon)]
    pub(crate) fn publish(
        &self,
        stage: &str,
        destination: &str,
        expected: &[u8],
    ) -> io::Result<()> {
        let name = encode_component(destination)?;
        if stage.eq_ignore_ascii_case(destination) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "stage and destination must differ",
            ));
        }
        let source = open_relative(
            self.0.raw,
            stage,
            FILE_ACCESS | 0x8000_0000,
            0,
            FILE_OPEN,
            FILE_NON_DIRECTORY_FILE,
        )?;
        source.validate_private_file()?;
        source.verify_exact_bytes(expected)?;
        source.flush()?;
        self.reject_reparse_point()?;
        let name_bytes = name.len() * mem::size_of::<u16>();
        let bytes = mem::offset_of!(FileRenameInfo, file_name) + name_bytes;
        let mut aligned = vec![
            0usize;
            bytes
                .max(mem::size_of::<FileRenameInfo>())
                .div_ceil(mem::size_of::<usize>())
        ];
        let info = aligned.as_mut_ptr().cast::<FileRenameInfo>();
        unsafe {
            (*info).root_directory = self.0.raw;
            (*info).file_name_length = name_bytes as u32;
            ptr::copy_nonoverlapping(
                name.as_ptr(),
                ptr::addr_of_mut!((*info).file_name).cast(),
                name.len(),
            );
            let mut status = IoStatusBlock {
                status: 0,
                information: 0,
            };
            let result = NtSetInformationFile(
                source.raw,
                &mut status,
                info.cast(),
                bytes as u32,
                FILE_RENAME_INFO_CLASS,
            );
            if result < 0 {
                return Err(io::Error::from_raw_os_error(
                    RtlNtStatusToDosError(result) as i32
                ));
            }
        }
        self.flush()
    }

    fn reject_reparse_point(&self) -> io::Result<()> {
        self.0.reject_reparse_point()
    }

    #[cfg(vdt_storage_addon)]
    pub(crate) fn validate_private_dacl(&self) -> io::Result<()> {
        self.reject_reparse_point()?;
        crate::windows_security::validate_private_dacl(self.0.raw)
    }
}

impl OwnedHandle {
    #[cfg(vdt_storage_addon)]
    pub(crate) unsafe fn adopt_win32(raw: Handle) -> io::Result<Self> {
        if raw == -1isize as Handle {
            return Err(io::Error::last_os_error());
        }
        Ok(Self { raw })
    }

    #[cfg(vdt_storage_addon)]
    pub(crate) fn open_directory(&self, name: &str) -> io::Result<Self> {
        let directory = open_relative(
            self.raw,
            name,
            0x0012_00a0,
            FILE_SHARE_READ_WRITE,
            FILE_OPEN,
            FILE_DIRECTORY_FILE,
        )?;
        directory.reject_reparse_point()?;
        Ok(directory)
    }

    #[cfg(vdt_storage_addon)]
    pub(crate) fn ensure_private_directory(&self, name: &str) -> io::Result<FlushableDirectory> {
        let descriptor = crate::windows_security::private_directory_descriptor()?;
        match open_relative_with_security(
            self.raw,
            name,
            DIRECTORY_FLUSH_ACCESS,
            FILE_SHARE_READ_WRITE,
            FILE_CREATE,
            FILE_DIRECTORY_FILE,
            descriptor.0,
        ) {
            Ok(handle) => {
                let directory = FlushableDirectory(handle);
                directory.validate_private_dacl()?;
                directory.flush()?;
                self.flush()?;
                Ok(directory)
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let child = self.open_flushable_directory(name)?;
                child.validate_private_dacl()?;
                Ok(child)
            }
            Err(error) => Err(error),
        }
    }

    #[cfg(vdt_storage_addon)]
    pub(crate) fn open_flushable_directory(&self, name: &str) -> io::Result<FlushableDirectory> {
        unsafe { FlushableDirectory::open_relative(self.raw, name) }
    }

    pub(crate) fn reject_reparse_point(&self) -> io::Result<()> {
        let mut info = FileAttributeTagInfo {
            attributes: 0,
            reparse_tag: 0,
        };
        if unsafe {
            GetFileInformationByHandleEx(
                self.raw,
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

    #[cfg(vdt_storage_addon)]
    fn validate_private_file(&self) -> io::Result<FileStandardInfo> {
        self.reject_reparse_point()?;
        let mut info = FileStandardInfo {
            allocation_size: 0,
            end_of_file: 0,
            number_of_links: 0,
            delete_pending: 0,
            directory: 0,
        };
        if unsafe {
            GetFileInformationByHandleEx(
                self.raw,
                1,
                (&mut info as *mut FileStandardInfo).cast(),
                mem::size_of::<FileStandardInfo>() as u32,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        if info.number_of_links != 1 || info.delete_pending != 0 || info.directory != 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "expected a single-link regular file",
            ));
        }
        crate::windows_security::validate_private_file(self.raw)?;
        Ok(info)
    }

    #[cfg(vdt_storage_addon)]
    fn read(&self, buffer: &mut [u8]) -> io::Result<usize> {
        let mut read = 0;
        if unsafe {
            ReadFile(
                self.raw,
                buffer.as_mut_ptr().cast(),
                buffer.len() as u32,
                &mut read,
                ptr::null_mut(),
            )
        } == 0
        {
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(38) {
                return Err(error);
            }
        }
        Ok(read as usize)
    }

    #[cfg(vdt_storage_addon)]
    fn verify_exact_bytes(&self, expected: &[u8]) -> io::Result<()> {
        let mut buffer = [0u8; 8192];
        let mut offset = 0;
        loop {
            let read = self.read(&mut buffer)?;
            let end = offset + read;
            if read == 0 && offset == expected.len() {
                return Ok(());
            }
            if read == 0 || expected.get(offset..end) != Some(&buffer[..read]) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "stage content differs from expected bytes",
                ));
            }
            offset = end;
        }
    }

    fn flush(&self) -> io::Result<()> {
        if unsafe { FlushFileBuffers(self.raw) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

impl CreatedFile<'_> {
    pub fn write_all(&mut self, mut bytes: &[u8]) -> io::Result<()> {
        while !bytes.is_empty() {
            let count = bytes.len().min(u32::MAX as usize) as u32;
            let mut written = 0;
            if unsafe {
                WriteFile(
                    self.handle.raw,
                    bytes.as_ptr().cast(),
                    count,
                    &mut written,
                    ptr::null_mut(),
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            if written == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "Windows storage write made no progress",
                ));
            }
            bytes = &bytes[written as usize..];
        }
        Ok(())
    }

    pub fn flush(&self) -> io::Result<()> {
        self.handle.flush()?;
        self.parent.flush()
    }

    /// Schedule deletion on this exclusive handle, close it, then flush its
    /// retained parent. A flush failure means deletion durability is unknown.
    pub fn remove(self) -> io::Result<()> {
        // FILE_DISPOSITION_INFO.DeleteFile is a one-byte BOOLEAN.
        let delete: u8 = 1;
        if unsafe {
            SetFileInformationByHandle(
                self.handle.raw,
                FILE_DISPOSITION_INFO_CLASS,
                (&delete as *const u8).cast(),
                mem::size_of::<u8>() as u32,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let parent = self.parent;
        drop(self);
        parent.flush()
    }
}

fn open_relative(
    parent: Handle,
    name: &str,
    access: u32,
    share: u32,
    disposition: u32,
    options: u32,
) -> io::Result<OwnedHandle> {
    open_relative_with_security(
        parent,
        name,
        access,
        share,
        disposition,
        options,
        ptr::null(),
    )
}

fn open_relative_with_security(
    parent: Handle,
    name: &str,
    access: u32,
    share: u32,
    disposition: u32,
    options: u32,
    security_descriptor: *const c_void,
) -> io::Result<OwnedHandle> {
    if parent.is_null() || parent == -1isize as Handle {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "expected a retained parent handle",
        ));
    }
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
        security_descriptor,
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
            access,
            &attributes,
            &mut status,
            ptr::null(),
            0,
            share,
            disposition,
            options | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT,
            ptr::null(),
            0,
        )
    };
    if result < 0 {
        return Err(io::Error::from_raw_os_error(
            unsafe { RtlNtStatusToDosError(result) } as i32,
        ));
    }
    Ok(OwnedHandle { raw: handle })
}

fn reserved_dos_name(name: &str) -> bool {
    let base = name.split('.').next().unwrap_or("").trim_end_matches(' ');
    let base = base.to_ascii_uppercase();
    matches!(
        base.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || ["COM", "LPT"].iter().any(|prefix| {
        base.strip_prefix(prefix).is_some_and(|suffix| {
            matches!(
                suffix,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
    })
}

fn encode_component(name: &str) -> io::Result<Vec<u16>> {
    let encoded: Vec<_> = name.encode_utf16().collect();
    if encoded.is_empty()
        || encoded.len() > 255
        || name.ends_with(['.', ' '])
        || name.contains(['\\', '/', ':', '<', '>', '"', '|', '?', '*'])
        || name.chars().any(|character| character < ' ')
        || reserved_dos_name(name)
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "expected one native directory component",
        ));
    }
    Ok(encoded)
}
