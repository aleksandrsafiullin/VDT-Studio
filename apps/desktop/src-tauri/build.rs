fn main() {
    println!("cargo:rerun-if-env-changed=VDT_APP_INTENTS_STAGE");

    if std::env::var_os("CARGO_FEATURE_APP_INTENTS_QUALIFICATION").is_some()
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos")
    {
        if let Some(stage) = std::env::var_os("VDT_APP_INTENTS_STAGE") {
            link_app_intents(std::path::Path::new(&stage));
        }
    }

    tauri_build::build();
}

fn link_app_intents(stage: &std::path::Path) {
    let object = stage.join("VDTStudioAppIntents.o");
    let runtime_file = stage.join("swift-runtime-path.txt");
    let runtime =
        std::fs::read_to_string(&runtime_file).expect("Read the prepared Swift runtime path");
    let runtime = std::path::Path::new(runtime.trim());
    assert!(
        stage.is_absolute() && object.is_file() && runtime.is_absolute() && runtime.is_dir(),
        "Prepare the App Intents qualification Swift input before linking"
    );
    println!("cargo:rerun-if-changed={}", object.display());
    println!("cargo:rerun-if-changed={}", runtime_file.display());
    // The Tauri binary resolves the ABI from its executable. Keep Swift type
    // symbols and protocol conformances in the executable under dead stripping.
    for arg in [
        object.display().to_string(),
        format!("-L{}", runtime.display()),
        "-Wl,-export_dynamic".into(),
        "-Wl,-rpath,/usr/lib/swift".into(),
    ] {
        println!("cargo:rustc-link-arg-bin=vdt-studio-desktop={arg}");
    }
}
