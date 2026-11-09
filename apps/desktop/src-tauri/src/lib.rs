mod sidecar_host;

#[cfg(all(target_os = "macos", not(debug_assertions)))]
mod packaged_web;

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
    #[serde(default, deserialize_with = "deserialize_optional_reasoning")]
    model_reasoning: Option<serde_json::Value>,
    timeout_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopSmartExecutionRequest {
    request_id: String,
    backend_id: String,
    model: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_reasoning")]
    model_reasoning: Option<serde_json::Value>,
    timeout_ms: Option<u64>,
}

fn is_model_reasoning_value(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Bool(_) => true,
        serde_json::Value::String(s) => !s.is_empty() && s.len() <= 48
            && s.as_bytes()[0].is_ascii_lowercase()
            && s.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'.' || c == b'-'),
        serde_json::Value::Number(n) => n.as_u64().map_or(false, |v| v <= 32768),
        _ => false,
    }
}

fn deserialize_optional_reasoning<'de, D>(deserializer: D) -> Result<Option<serde_json::Value>, D::Error>
where D: serde::Deserializer<'de> {
    let value = serde_json::Value::deserialize(deserializer)?;
    if !is_model_reasoning_value(&value) {
        return Err(serde::de::Error::custom("INVALID_REASONING: expected a bounded provider reasoning value"));
    }
    Ok(Some(value))
}

fn is_harness_backend(backend: &str) -> bool {
    if ["codex_subscription", "cursor_subscription", "claude_subscription", "copilot_subscription", "opencode_subscription", "hermes_subscription", "kiro_subscription", "kimi_subscription", "vibe_subscription", "kilo_subscription", "qwen_subscription", "grok-build_subscription", "pi_subscription"].contains(&backend) {
        return true;
    }
    backend.strip_suffix("_subscription").and_then(|id| id.strip_prefix("custom-")).map_or(false, |id| {
        !id.is_empty() && id.len() <= 80 && id.as_bytes()[0].is_ascii_alphanumeric()
            && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    })
}

fn is_smart_metadata_backend(backend: &str) -> bool {
    is_harness_backend(backend) || ["ollama", "lm_studio", "vllm"].contains(&backend)
}

#[tauri::command]
fn ai_harness_settings(payload: serde_json::Value, runtime: State<'_, DesktopRuntime>) -> Result<serde_json::Value, String> {
    runtime.harness_settings(payload).map_err(|error| error.to_string())
}

#[tauri::command]
async fn ai_smart_execution(request: DesktopSmartExecutionRequest, app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    if request.model_reasoning.as_ref().map_or(false, |value| !is_model_reasoning_value(value)) {
        return Err("INVALID_REASONING: modelReasoning must be a bounded provider value.".into());
    }
    if !is_smart_metadata_backend(&request.backend_id) || request.timeout_ms.map_or(false, |ms| ms == 0 || ms > 5000) {
        return Err("INVALID_SMART_METADATA: selected harness metadata requires a deadline of at most 5000ms.".into());
    }
    app.state::<DesktopRuntime>().reserve_smart_request(&request.request_id).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut payload = serde_json::json!({ "requestId": request.request_id, "backendId": request.backend_id });
        if let Some(model) = request.model { payload["model"] = serde_json::Value::String(model); }
        if let Some(reasoning) = request.model_reasoning { payload["modelReasoning"] = reasoning; }
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
async fn ai_detect_subscription_clis(agent_id: Option<String>, app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<DesktopRuntime>()
            .detect_subscription_clis(agent_id.as_deref())
            .map_err(|error| error.to_string())
    }).await.map_err(|error| error.to_string())?
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
    if request.model_reasoning.as_ref().map_or(false, |value| !is_model_reasoning_value(value)) {
        return Err("INVALID_REASONING: modelReasoning must be a bounded provider value.".into());
    }
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
    if let Some(reasoning) = request.model_reasoning {
        payload["modelReasoning"] = reasoning;
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
async fn ai_cancel(request_id: String, app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<DesktopRuntime>().cancel(&request_id).map_err(|error| error.to_string())
    }).await.map_err(|error| error.to_string())?
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
                    #[cfg(all(target_os = "macos", not(debug_assertions)))]
                    packaged_web::setup(app, &resource_dir, &runtime)?;
                    if let Err(error) = runtime.set_resource_dir(resource_dir) {
                        eprintln!("vdt_desktop_resource_dir_failed: {}", error);
                    }
                }
                Err(error) => {
                    eprintln!("vdt_desktop_resource_dir_unavailable: {}", error);
                }
            }
            #[cfg(all(target_os = "macos", debug_assertions))]
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?.build()?;
            if let Err(error) = runtime.start() {
                eprintln!("vdt_desktop_sidecar_start_failed: {}", error);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ai_harness_settings,
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
        .build(tauri::generate_context!())
        .expect("error while building VDT Studio Desktop")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                #[cfg(all(target_os = "macos", not(debug_assertions)))]
                if let Some(web) = app.try_state::<packaged_web::PackagedWeb>() {
                    web.stop();
                }
                app.state::<DesktopRuntime>().stop();
            }
        });
}

#[cfg(test)]
mod harness_tests {
    use super::{is_harness_backend, is_smart_metadata_backend, DesktopCompletionRequest, DesktopSmartExecutionRequest};
    fn smart_metadata() -> serde_json::Value {
        serde_json::json!({ "requestId": "test-request", "backendId": "codex_subscription", "model": "selected" })
    }
    fn smart_completion() -> serde_json::Value {
        serde_json::json!({ "requestId": "test-request", "providerId": "local_runner", "backendId": "codex_subscription", "taskType": "suggest_incoming_kpis", "schemaId": "suggest-incoming-kpis-v1", "input": {}, "model": "selected" })
    }
    #[test]
    fn cancelling_an_unowned_request_does_not_start_the_sidecar() {
        let runtime = super::DesktopRuntime::default();
        assert!(runtime.cancel("already-finished").is_ok());
        assert_eq!(runtime.state().status, "stopped");
    }
    #[test]
    fn smart_reasoning_missing_and_explicit_off_remain_distinct() {
        assert!(serde_json::from_value::<DesktopSmartExecutionRequest>(smart_metadata()).unwrap().model_reasoning.is_none());
        assert!(serde_json::from_value::<DesktopCompletionRequest>(smart_completion()).unwrap().model_reasoning.is_none());
        let mut metadata = smart_metadata(); metadata["modelReasoning"] = serde_json::json!(false);
        let mut completion = smart_completion(); completion["modelReasoning"] = serde_json::json!(false);
        assert_eq!(serde_json::from_value::<DesktopSmartExecutionRequest>(metadata).unwrap().model_reasoning, Some(serde_json::json!(false)));
        assert_eq!(serde_json::from_value::<DesktopCompletionRequest>(completion).unwrap().model_reasoning, Some(serde_json::json!(false)));
    }
    #[test]
    fn smart_reasoning_preserves_exact_named_boolean_and_numeric_values() {
        for value in [serde_json::json!("low"), serde_json::json!("xhigh"), serde_json::json!(true), serde_json::json!(0), serde_json::json!(4096), serde_json::json!(32768)] {
            let mut metadata = smart_metadata(); metadata["modelReasoning"] = value.clone();
            let mut completion = smart_completion(); completion["modelReasoning"] = value.clone();
            assert_eq!(serde_json::from_value::<DesktopSmartExecutionRequest>(metadata).unwrap().model_reasoning, Some(value.clone()));
            assert_eq!(serde_json::from_value::<DesktopCompletionRequest>(completion).unwrap().model_reasoning, Some(value));
        }
    }
    #[test]
    fn smart_reasoning_rejects_present_null_structures_and_unbounded_values() {
        for value in [serde_json::json!(null), serde_json::json!([]), serde_json::json!({}), serde_json::json!(""), serde_json::json!("HIGH"), serde_json::json!("low;run"), serde_json::json!("a".repeat(49)), serde_json::json!(-1), serde_json::json!(1.5), serde_json::json!(32769)] {
            let mut metadata = smart_metadata(); metadata["modelReasoning"] = value.clone();
            let mut completion = smart_completion(); completion["modelReasoning"] = value;
            assert!(serde_json::from_value::<DesktopSmartExecutionRequest>(metadata).is_err());
            assert!(serde_json::from_value::<DesktopCompletionRequest>(completion).is_err());
        }
    }
    #[test]
    fn smart_accepts_all_harnesses_and_custom_ids() {
        for id in ["codex", "cursor", "claude", "copilot", "opencode", "hermes", "kiro", "kimi", "vibe", "kilo", "qwen", "grok-build", "pi", "custom-team_agent-1"] {
            assert!(is_harness_backend(&format!("{}_subscription", id)));
        }
        for id in ["ollama", "lm_studio", "vllm", "codex_subscription", "custom-team_subscription"] {
            assert!(is_smart_metadata_backend(id));
        }
        for id in ["mock", "local_cli", "http://127.0.0.1:1234", "custom-../bad_subscription"] {
            assert!(!is_smart_metadata_backend(id));
        }
        for id in ["ollama", "gemini_subscription", "unknown_subscription", "custom-_subscription", "custom-../bad_subscription", "custom- space_subscription"] {
            assert!(!is_harness_backend(id));
        }
    }
}
