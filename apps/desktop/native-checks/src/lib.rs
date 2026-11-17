// Compile and execute the production ownership module without Tauri/WebView.
// This is a native prerequisite, not an installed-application acceptance test.
#[cfg(windows)]
#[path = "../../src-tauri/src/windows_process.rs"]
mod windows_process;
