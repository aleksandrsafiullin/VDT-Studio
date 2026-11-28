use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    ffi::c_void,
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::WebviewWindow;

const ORIGIN: &str = "http://127.0.0.1:37541";
const LIMIT: usize = 16;
const OWNER_TTL: Duration = Duration::from_secs(3);
type Deliver = extern "C" fn(*const u8, usize) -> i32;
type Attach = unsafe extern "C" fn(*const u8, usize, Deliver) -> i32;
type Call = unsafe extern "C" fn(*const u8, usize) -> i32;

struct Native {
    attach: Attach,
    update: Call,
    detach: Call,
}

impl Native {
    fn load() -> Option<Self> {
        // The restricted qualification build must link and export the Swift
        // ABI in the main executable. An ordinary build has no command.
        unsafe {
            let available = libc::dlsym(libc::RTLD_DEFAULT, c"vdt_app_intents_available".as_ptr());
            let attach = libc::dlsym(libc::RTLD_DEFAULT, c"vdt_app_intents_attach".as_ptr());
            let update = libc::dlsym(libc::RTLD_DEFAULT, c"vdt_app_intents_update".as_ptr());
            let detach = libc::dlsym(libc::RTLD_DEFAULT, c"vdt_app_intents_detach".as_ptr());
            if [available, attach, update, detach]
                .iter()
                .any(|pointer| pointer.is_null())
            {
                return None;
            }
            let is_available =
                std::mem::transmute::<*mut c_void, unsafe extern "C" fn() -> i32>(available);
            if is_available() != 1 {
                return None;
            }
            Some(Self {
                attach: std::mem::transmute::<*mut c_void, Attach>(attach),
                update: std::mem::transmute::<*mut c_void, Call>(update),
                detach: std::mem::transmute::<*mut c_void, Call>(detach),
            })
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Snapshot {
    sequence: u64,
    consent_epoch: String,
    scope: Option<String>,
    listening_session: Option<String>,
    pending_review: Option<String>,
    status: Status,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum Status {
    Ready,
    Working,
    Listening,
    ReviewAvailable,
}

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Exchange {
    Probe,
    Attach,
    Sync { owner: String, snapshot: Snapshot },
    Detach { owner: String },
}

struct Owner {
    token: String,
    expires: Instant,
    sequence: u64,
    queue: Vec<Value>,
}

static OWNER: Mutex<Option<Owner>> = Mutex::new(None);

fn generate_owner() -> Option<String> {
    let mut bytes = [0_u8; 16];
    if unsafe { libc::getentropy(bytes.as_mut_ptr().cast(), bytes.len()) } != 0 {
        return None;
    }
    bytes[6] = bytes[6] & 0x0f | 0x40;
    bytes[8] = bytes[8] & 0x3f | 0x80;
    let hex = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Some(format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}

extern "C" fn deliver(bytes: *const u8, len: usize) -> i32 {
    if bytes.is_null() || len == 0 || len > 2_048 {
        return 0;
    }
    let Ok(message) =
        serde_json::from_slice::<Value>(unsafe { std::slice::from_raw_parts(bytes, len) })
    else {
        return 0;
    };
    let Ok(mut state) = OWNER.lock() else {
        return 0;
    };
    let Some(owner) = state.as_mut() else {
        return 0;
    };
    if owner.expires <= Instant::now()
        || owner.queue.len() >= LIMIT
        || !message
            .get("owner")
            .and_then(Value::as_str)
            .is_some_and(|token| token.eq_ignore_ascii_case(&owner.token))
        || message.get("sequence").and_then(Value::as_u64) != Some(owner.sequence)
    {
        return 0;
    }
    owner.queue.push(message);
    1
}

fn clear(state: &mut Option<Owner>, native: &Native) {
    if let Some(owner) = state.take() {
        unsafe { (native.detach)(owner.token.as_ptr(), owner.token.len()) };
    }
}

pub(crate) fn invalidate_window() {
    if let (Some(native), Ok(mut state)) = (Native::load(), OWNER.lock()) {
        clear(&mut state, &native);
    }
}

fn uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Receipt {
    available: bool,
    owner: Option<String>,
    deliveries: Vec<Value>,
}

fn exchange(request: Exchange, window: &WebviewWindow) -> Result<Receipt, String> {
    let url = window.url().map_err(|_| "Ineligible Shortcuts window.")?;
    if window.label() != "main"
        || url.origin().ascii_serialization() != ORIGIN
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path().starts_with("/__vdt_start/")
    {
        return Err("Ineligible Shortcuts window.".into());
    }
    let mut result = Receipt {
        available: false,
        owner: None,
        deliveries: Vec::new(),
    };
    let Some(native) = Native::load() else {
        return Ok(result);
    };
    result.available = true;
    let mut state = OWNER
        .lock()
        .map_err(|_| "Shortcuts ownership is unavailable.")?;
    if state
        .as_ref()
        .is_some_and(|owner| owner.expires <= Instant::now())
    {
        clear(&mut state, &native);
    }
    match request {
        Exchange::Probe => {}
        Exchange::Attach => {
            if state.is_some() {
                return Err("Shortcuts already has an owning window.".into());
            }
            let token = generate_owner().ok_or("Shortcuts ownership is unavailable.")?;
            if unsafe { (native.attach)(token.as_ptr(), token.len(), deliver) } != 1 {
                return Err("Shortcuts ownership is unavailable.".into());
            }
            result.owner = Some(token.clone());
            *state = Some(Owner {
                token,
                expires: Instant::now() + OWNER_TTL,
                sequence: 0,
                queue: Vec::new(),
            });
        }
        Exchange::Sync { owner, snapshot } => {
            let Some(active) = state.as_mut().filter(|active| active.token == owner) else {
                return Ok(result);
            };
            if snapshot.sequence == 0
                || snapshot.sequence > 9_007_199_254_740_991
                || !uuid(&snapshot.consent_epoch)
                || [
                    &snapshot.scope,
                    &snapshot.listening_session,
                    &snapshot.pending_review,
                ]
                .into_iter()
                .flatten()
                .any(|value| !uuid(value))
            {
                return Err("Invalid Shortcuts window snapshot.".into());
            }
            let payload = serde_json::to_vec(&serde_json::json!({
                "owner": owner, "optedIn": true, "sequence": snapshot.sequence,
                "consentEpoch": snapshot.consent_epoch, "scope": snapshot.scope, "status": snapshot.status,
                "listeningSession": snapshot.listening_session, "pendingReview": snapshot.pending_review
            })).map_err(|_| "Invalid Shortcuts window snapshot.")?;
            if unsafe { (native.update)(payload.as_ptr(), payload.len()) } != 1 {
                return Err("Shortcuts rejected a stale window snapshot.".into());
            }
            if snapshot.sequence != active.sequence {
                active.sequence = snapshot.sequence;
                active.queue.clear();
            }
            active.expires = Instant::now() + OWNER_TTL;
            result.owner = Some(owner);
            result.deliveries = std::mem::take(&mut active.queue);
        }
        Exchange::Detach { owner } => {
            if state.as_ref().is_some_and(|active| active.token == owner) {
                clear(&mut state, &native);
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn app_intents_exchange(
    window: WebviewWindow,
    request: Exchange,
) -> Result<Receipt, String> {
    let (send, receive) = mpsc::sync_channel(1);
    let owning_window = window.clone();
    let deadline = Instant::now() + Duration::from_secs(2);
    window
        .run_on_main_thread(move || {
            if Instant::now() < deadline {
                let _ = send.send(exchange(request, &owning_window));
            }
        })
        .map_err(|_| "Shortcuts ownership is unavailable.")?;
    tauri::async_runtime::spawn_blocking(move || receive.recv_timeout(Duration::from_secs(2)))
        .await
        .map_err(|_| "Shortcuts ownership is unavailable.")?
        .map_err(|_| "Shortcuts ownership is unavailable.")?
}
