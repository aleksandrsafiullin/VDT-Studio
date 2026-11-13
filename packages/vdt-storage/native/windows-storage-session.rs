use std::{
    ffi::c_void,
    io,
    path::{Component, Path, Prefix},
    ptr,
    rc::Rc,
};

use crate::windows_directory::{FlushableDirectory, OwnedHandle};

const OPEN_EXISTING: u32 = 3;
const DIRECTORY_OPEN_FLAGS: u32 = 0x0220_0000;
const READ_ATTRIBUTES_CONTROL_SYNCHRONIZE: u32 = 0x0012_00a0;
const DRIVE_FIXED: u32 = 3;
const FILE_PERSISTENT_ACLS: u32 = 8;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateFileW(
        path: *const u16,
        access: u32,
        share: u32,
        security: *const c_void,
        disposition: u32,
        flags: u32,
        template: *mut c_void,
    ) -> *mut c_void;
    fn GetDriveTypeW(root: *const u16) -> u32;
    fn GetVolumeInformationByHandleW(
        handle: *mut c_void,
        name: *mut u16,
        name_length: u32,
        serial: *mut u32,
        maximum_component_length: *mut u32,
        flags: *mut u32,
        filesystem_name: *mut u16,
        filesystem_name_length: u32,
    ) -> i32;
}

pub struct StorageSession {
    directory: FlushableDirectory,
    namespace: Namespace,
}

enum Namespace {
    Root(Vec<OwnedHandle>),
    Child(Rc<StorageSession>),
}

impl StorageSession {
    pub fn open(path: &Path, create: bool) -> io::Result<Self> {
        let mut components = path.components();
        let Some(Component::Prefix(prefix)) = components.next() else {
            return Err(unsupported("storage requires a local drive path"));
        };
        let Prefix::Disk(drive) = prefix.kind() else {
            return Err(unsupported("storage requires a local drive path"));
        };
        if components.next() != Some(Component::RootDir) {
            return Err(unsupported("storage requires an absolute drive path"));
        }
        let mut children = components
            .map(|component| match component {
                Component::Normal(value) => value
                    .to_str()
                    .ok_or_else(|| unsupported("invalid Unicode path component")),
                _ => Err(unsupported("unexpected path component")),
            })
            .collect::<io::Result<Vec<_>>>()?;
        let name = children
            .pop()
            .ok_or_else(|| unsupported("a drive root cannot be a storage directory"))?;
        let root = [u16::from(drive), b':' as u16, b'\\' as u16, 0];
        if unsafe { GetDriveTypeW(root.as_ptr()) } != DRIVE_FIXED {
            return Err(unsupported("storage requires a local fixed drive"));
        }
        let handle = unsafe {
            CreateFileW(
                root.as_ptr(),
                READ_ATTRIBUTES_CONTROL_SYNCHRONIZE,
                3,
                ptr::null(),
                OPEN_EXISTING,
                DIRECTORY_OPEN_FLAGS,
                ptr::null_mut(),
            )
        };
        let root = unsafe { OwnedHandle::adopt_win32(handle)? };
        root.reject_reparse_point()?;
        verify_ntfs(&root)?;
        let mut ancestors = vec![root];
        for name in children {
            let parent = ancestors.last().expect("drive handle retained");
            ancestors.push(parent.open_directory(name)?);
        }
        let parent = ancestors.last().expect("drive handle retained");
        let directory = if create {
            // Re-open the immediate parent with proven write/flush access.
            // The first traversal remains pinned while this handle is acquired.
            if ancestors.len() < 2 {
                return Err(unsupported(
                    "cannot initialize storage directly under a drive root",
                ));
            }
            let parent_name = path
                .parent()
                .and_then(Path::file_name)
                .and_then(|name| name.to_str())
                .ok_or_else(|| unsupported("invalid storage parent name"))?;
            let parent = ancestors[ancestors.len() - 2].open_flushable_directory(parent_name)?;
            parent.ensure_bootstrap_directory(name)?
        } else {
            parent.open_flushable_directory(name)?
        };
        directory.validate_private_dacl()?;
        Ok(Self {
            directory,
            namespace: Namespace::Root(ancestors),
        })
    }

    pub fn write_exclusive(&self, name: &str, bytes: &[u8]) -> io::Result<()> {
        self.validate()?;
        let mut file = self.directory.create_file(name)?;
        file.write_all(bytes)?;
        file.flush()
    }

    pub fn publish(&self, stage: &str, destination: &str, expected: &[u8]) -> io::Result<()> {
        self.validate()?;
        self.directory.publish(stage, destination, expected)
    }

    pub fn open_child(parent: Rc<Self>, name: &str) -> io::Result<Self> {
        parent.validate()?;
        let directory = parent.directory.open_child(name)?;
        Ok(Self {
            directory,
            namespace: Namespace::Child(parent),
        })
    }

    pub fn acquire_lock(&self, name: &str) -> io::Result<OwnedHandle> {
        self.validate()?;
        self.directory.acquire_lock(name)
    }

    pub fn list(&self) -> io::Result<Vec<crate::windows_directory_entries::DirectoryEntry>> {
        self.validate()?;
        self.directory.list()
    }

    pub fn remove_empty_child(&self, name: &str) -> io::Result<()> {
        self.validate()?;
        self.directory.remove_empty_child(name)
    }

    pub fn ensure_child(&self, name: &str) -> io::Result<()> {
        self.validate()?;
        self.directory.ensure_child(name)
    }

    pub fn read(&self, name: &str, bytes: &mut [u8], durable: bool) -> io::Result<usize> {
        self.validate()?;
        self.directory.read_verified(name, bytes, durable)
    }

    pub fn unlink(&self, name: &str) -> io::Result<()> {
        self.validate()?;
        self.directory.unlink(name)
    }

    pub fn flush(&self) -> io::Result<()> {
        self.validate()?;
        self.directory.flush()
    }

    fn validate(&self) -> io::Result<()> {
        match &self.namespace {
            Namespace::Root(ancestors) => {
                for ancestor in ancestors {
                    ancestor.reject_reparse_point()?;
                }
                self.directory.validate_private_dacl()
            }
            Namespace::Child(parent) => {
                parent.validate()?;
                self.directory.validate_private_descendant()
            }
        }
    }
}

fn verify_ntfs(root: &OwnedHandle) -> io::Result<()> {
    let mut fs = [0u16; 16];
    let mut flags = 0;
    if unsafe {
        GetVolumeInformationByHandleW(
            root.raw,
            ptr::null_mut(),
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            &mut flags,
            fs.as_mut_ptr(),
            fs.len() as u32,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    if fs[..5] != [b'N' as u16, b'T' as u16, b'F' as u16, b'S' as u16, 0]
        || flags & FILE_PERSISTENT_ACLS == 0
    {
        return Err(unsupported(
            "storage requires local NTFS with persistent ACLs",
        ));
    }
    Ok(())
}

fn unsupported(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::Unsupported, message)
}
