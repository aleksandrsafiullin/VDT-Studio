mod sidecar_host;

use serde::Deserialize;
use sidecar_host::{DesktopRuntime, RuntimeBackendStatus};
use tauri::{Manager, State};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCompletionRequest {
    request_id: String,
    #[serde(rename = "providerId")]
    _provider_id: String,
    backend_id: String,
    task_type: String,
    schema_id: String,
    input: serde_json::Value,
    model: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopSmartExecutionRequest {
    request_id: String,
    backend_id: String,
    model: Option<String>,
    timeout_ms: Option<u64>,
}

#[tauri::command]
async fn ai_smart_execution(request: DesktopSmartExecutionRequest, app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    if request.backend_id != "codex_subscription" || request.timeout_ms.map_or(false, |ms| ms == 0 || ms > 5000) {
        return Err("INVALID_SMART_METADATA: selected Codex metadata requires a deadline of at most 5000ms.".into());
    }
    app.state::<DesktopRuntime>().reserve_smart_request(&request.request_id).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut payload = serde_json::json!({ "requestId": request.request_id, "backendId": request.backend_id });
        if let Some(model) = request.model { payload["model"] = serde_json::Value::String(model); }
        if let Some(timeout_ms) = request.timeout_ms { payload["timeoutMs"] = serde_json::Value::Number(timeout_ms.into()); }
        app.state::<DesktopRuntime>().smart_execution(payload).map_err(|error| error.to_string())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn get_app_mode() -> &'static str {
    "desktop"
}

#[tauri::command]
fn ai_list_backends(runtime: State<'_, DesktopRuntime>) -> Result<Vec<RuntimeBackendStatus>, String> {
    runtime.list_backends().map_err(|error| error.to_string())
}

#[tauri::command]
fn ai_detect_subscription_clis(agent_id: Option<String>, runtime: State<'_, DesktopRuntime>) -> Result<serde_json::Value, String> {
    runtime
        .detect_subscription_clis(agent_id.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn ai_test_backend(backend_id: String, runtime: State<'_, DesktopRuntime>) -> Result<serde_json::Value, String> {
    runtime
        .test_backend(&backend_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn ai_list_models(backend_id: String, runtime: State<'_, DesktopRuntime>) -> Result<Vec<String>, String> {
    runtime
        .list_models(&backend_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn ai_complete(
    request: DesktopCompletionRequest,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let smart = request.task_type == "suggest_incoming_kpis";
    if smart {
        app.state::<DesktopRuntime>().reserve_smart_request(&request.request_id).map_err(|error| error.to_string())?;
    }
    let mut payload = serde_json::json!({
        "requestId": request.request_id,
        "backendId": request.backend_id,
        "taskType": request.task_type,
        "schemaId": request.schema_id,
        "input": request.input
    });
    if let Some(model) = request.model {
        payload["model"] = serde_json::Value::String(model);
    }
    if let Some(timeout_ms) = request.timeout_ms {
        payload["timeoutMs"] = serde_json::Value::Number(timeout_ms.into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<DesktopRuntime>();
        if smart { runtime.smart_complete(payload) } else { runtime.complete(payload) }
            .map_err(|error| error.to_string())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn ai_cancel(request_id: String, runtime: State<'_, DesktopRuntime>) -> Result<(), String> {
    runtime.cancel(&request_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn ai_get_run(request_id: String, runtime: State<'_, DesktopRuntime>) -> Result<serde_json::Value, String> {
    runtime.get_run(&request_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_provider_auth(backend_id: String, runtime: State<'_, DesktopRuntime>) -> Result<serde_json::Value, String> {
    runtime
        .open_provider_auth(&backend_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn speech_request(request: serde_json::Value, app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<DesktopRuntime>().speech(request).map_err(|error| error.to_string())
    }).await.map_err(|error| error.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .manage(DesktopRuntime::default())
        .setup(|app| {
            let runtime = app.state::<DesktopRuntime>();
            match app.path().resource_dir() {
                Ok(resource_dir) => {
                    if let Err(error) = runtime.set_resource_dir(resource_dir) {
                        eprintln!("vdt_desktop_resource_dir_failed: {}", error);
                    }
                }
                Err(error) => {
                    eprintln!("vdt_desktop_resource_dir_unavailable: {}", error);
                }
            }
            if let Err(error) = runtime.start() {
                eprintln!("vdt_desktop_sidecar_start_failed: {}", error);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ai_list_backends,
            ai_detect_subscription_clis,
            ai_test_backend,
            ai_list_models,
            ai_complete,
            ai_smart_execution,
            ai_cancel,
            ai_get_run,
            open_provider_auth,
            speech_request,
            get_app_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running VDT Studio Desktop");
}
