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

#[tauri::command]
fn get_app_mode() -> &'static str {
    "desktop"
}

#[tauri::command]
fn ai_list_backends(runtime: State<'_, DesktopRuntime>) -> Result<Vec<RuntimeBackendStatus>, String> {
    runtime.list_backends().map_err(|error| error.to_string())
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
fn ai_complete(
    request: DesktopCompletionRequest,
    runtime: State<'_, DesktopRuntime>,
) -> Result<serde_json::Value, String> {
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
    runtime
        .complete(payload)
        .map_err(|error| error.to_string())
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
            ai_test_backend,
            ai_list_models,
            ai_complete,
            ai_cancel,
            ai_get_run,
            open_provider_auth,
            get_app_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running VDT Studio Desktop");
}
