use std::{ffi::c_void, io, mem, ptr};

type Pointer = *mut c_void;
const ACCESS_ALLOWED_ACE: u8 = 0;
const ACCESS_INHERIT_BOTH: u8 = 3;
const FILE_ALL_ACCESS: u32 = 0x001f_01ff;

#[repr(C)]
struct Ace {
    kind: u8,
    flags: u8,
    size: u16,
    mask: u32,
    sid_start: u32,
}

#[repr(C)]
struct AclSizeInformation {
    ace_count: u32,
    bytes_in_use: u32,
    bytes_free: u32,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetCurrentProcess() -> Pointer;
    fn CloseHandle(handle: Pointer) -> i32;
    fn LocalFree(memory: Pointer) -> Pointer;
}

#[link(name = "advapi32")]
unsafe extern "system" {
    fn OpenProcessToken(process: Pointer, access: u32, token: *mut Pointer) -> i32;
    fn GetTokenInformation(
        token: Pointer,
        class: u32,
        buffer: Pointer,
        length: u32,
        needed: *mut u32,
    ) -> i32;
    fn GetSecurityInfo(
        handle: Pointer,
        object_type: u32,
        flags: u32,
        owner: *mut Pointer,
        group: *mut Pointer,
        dacl: *mut Pointer,
        sacl: *mut Pointer,
        descriptor: *mut Pointer,
    ) -> u32;
    fn GetSecurityDescriptorControl(
        descriptor: Pointer,
        control: *mut u16,
        revision: *mut u32,
    ) -> i32;
    fn GetAclInformation(acl: Pointer, information: Pointer, length: u32, class: u32) -> i32;
    fn GetAce(acl: Pointer, index: u32, ace: *mut Pointer) -> i32;
    fn IsValidAcl(acl: Pointer) -> i32;
    fn IsValidSid(sid: *const c_void) -> i32;
    fn EqualSid(a: *const c_void, b: *const c_void) -> i32;
    fn IsWellKnownSid(sid: *const c_void, kind: u32) -> i32;
}

struct Descriptor(Pointer);

impl Drop for Descriptor {
    fn drop(&mut self) {
        unsafe { LocalFree(self.0) };
    }
}

fn token_user() -> io::Result<Vec<usize>> {
    let mut token = ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), 8, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let result = (|| {
        let mut needed = 0;
        unsafe { GetTokenInformation(token, 1, ptr::null_mut(), 0, &mut needed) };
        if needed < mem::size_of::<usize>() as u32 || needed > 65536 {
            return Err(denied("invalid token user size"));
        }
        let mut aligned = vec![0usize; (needed as usize).div_ceil(mem::size_of::<usize>())];
        if unsafe {
            GetTokenInformation(token, 1, aligned.as_mut_ptr().cast(), needed, &mut needed)
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(aligned)
    })();
    unsafe { CloseHandle(token) };
    result
}

pub fn validate_private_dacl(handle: Pointer) -> io::Result<()> {
    validate_acl(handle, true)
}

pub fn validate_private_file(handle: Pointer) -> io::Result<()> {
    validate_acl(handle, false)
}

fn validate_acl(handle: Pointer, directory: bool) -> io::Result<()> {
    let token = token_user()?;
    let user = token[0] as *const c_void;
    let mut descriptor = ptr::null_mut();
    let mut owner = ptr::null_mut();
    let mut acl = ptr::null_mut();
    let error = unsafe {
        GetSecurityInfo(
            handle,
            1,
            5,
            &mut owner,
            ptr::null_mut(),
            &mut acl,
            ptr::null_mut(),
            &mut descriptor,
        )
    };
    if error != 0 {
        return Err(io::Error::from_raw_os_error(error as i32));
    }
    let descriptor = Descriptor(descriptor);
    if owner.is_null() || user.is_null() || unsafe { EqualSid(owner, user) } == 0 {
        return Err(denied(
            "storage directory owner differs from the process token",
        ));
    }
    if acl.is_null() || unsafe { IsValidAcl(acl) } == 0 {
        return Err(denied("storage directory requires a valid non-null DACL"));
    }
    let mut control = 0;
    let mut revision = 0;
    if unsafe { GetSecurityDescriptorControl(descriptor.0, &mut control, &mut revision) } == 0 {
        return Err(io::Error::last_os_error());
    }
    if directory && control & 0x1000 == 0 {
        return Err(denied(
            "storage directory DACL must be protected from inheritance",
        ));
    }
    let mut size = AclSizeInformation {
        ace_count: 0,
        bytes_in_use: 0,
        bytes_free: 0,
    };
    if unsafe {
        GetAclInformation(
            acl,
            (&mut size as *mut AclSizeInformation).cast(),
            mem::size_of::<AclSizeInformation>() as u32,
            2,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let mut user_full_access = false;
    for index in 0..size.ace_count {
        let mut raw = ptr::null_mut();
        if unsafe { GetAce(acl, index, &mut raw) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let header = unsafe { &*raw.cast::<[u8; 4]>() };
        let length = usize::from(u16::from_le_bytes([header[2], header[3]]));
        if header[0] != ACCESS_ALLOWED_ACE || length < 16 {
            return Err(denied(
                "storage directory contains an unsupported access entry",
            ));
        }
        let ace = unsafe { &*raw.cast::<Ace>() };
        let sid = ptr::addr_of!(ace.sid_start).cast::<u8>();
        let sid_length = 8 + usize::from(unsafe { *sid.add(1) }) * 4;
        if sid_length + 8 > length || unsafe { IsValidSid(sid.cast()) } == 0 {
            return Err(denied("storage directory contains an invalid SID"));
        }
        let is_user = unsafe { EqualSid(sid.cast(), user) } != 0;
        let is_system = unsafe { IsWellKnownSid(sid.cast(), 22) } != 0;
        let is_admins = unsafe { IsWellKnownSid(sid.cast(), 26) } != 0;
        if !(is_user || is_system || is_admins) || ace.mask & !FILE_ALL_ACCESS != 0 {
            return Err(denied("storage directory grants unsupported access rights"));
        }
        let expected_flags = if directory {
            ace.flags == ACCESS_INHERIT_BOTH
        } else {
            ace.flags == 0 || ace.flags == 0x10
        };
        if is_user && expected_flags && ace.mask == FILE_ALL_ACCESS {
            user_full_access = true;
        }
    }
    if !user_full_access {
        return Err(denied("storage object requires full access for its owner"));
    }
    Ok(())
}

fn denied(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, message)
}
