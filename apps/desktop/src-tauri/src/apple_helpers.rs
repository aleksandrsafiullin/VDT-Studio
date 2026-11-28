use serde::Deserialize;
use std::{
    fs,
    path::Path,
    process::{Command, Stdio},
};

const MODEL_PATH: &str = "VDT_APPLE_FOUNDATION_MODELS_HELPER_PATH";
const MODEL_HASH: &str = "VDT_APPLE_FOUNDATION_MODELS_HELPER_SHA256";
const MODEL_ENABLED: &str = "VDT_APPLE_FOUNDATION_MODELS_ENABLED";
const DEFAULT_ENABLED: &str = "VDT_APPLE_ANALYTICAL_DEFAULT_ENABLED";
const VOICE_PATH: &str = "VDT_APPLE_VOICE_HELPER_PATH";
const VOICE_HASH: &str = "VDT_APPLE_VOICE_HELPER_SHA256";

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AppleHelpers {
    version: u8,
    foundation_models: String,
    voice: String,
    analytical_default: bool,
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// The signed resource manifest opts this particular bundle into the preview.
/// Ignore inherited values on each child path.
pub(crate) fn configure(command: &mut Command, resource_dir: &Path) {
    for key in [
        MODEL_PATH,
        MODEL_HASH,
        MODEL_ENABLED,
        DEFAULT_ENABLED,
        VOICE_PATH,
        VOICE_HASH,
    ] {
        command.env_remove(key);
    }
    let Some((contents, manifest)) = verified_bundle(resource_dir) else {
        return;
    };
    let helpers = contents.join("Helpers");
    command
        .env(MODEL_PATH, helpers.join("vdt-apple-foundation-models"))
        .env(MODEL_HASH, manifest.foundation_models)
        .env(MODEL_ENABLED, "true")
        .env(DEFAULT_ENABLED, "false")
        .env(VOICE_PATH, helpers.join("vdt-apple-voice"))
        .env(VOICE_HASH, manifest.voice);
}

fn verified_bundle(resource_dir: &Path) -> Option<(std::path::PathBuf, AppleHelpers)> {
    let resources = resource_dir.canonicalize().ok()?;
    let contents = resources.parent()?;
    let app = contents.parent()?;
    if resources.file_name()? != "Resources"
        || contents.file_name()? != "Contents"
        || app.extension()? != "app"
    {
        return None;
    }
    let path = resources.join("vdt-apple-helpers.json");
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.file_type().is_file() || metadata.len() > 1024 {
        return None;
    }
    let manifest: AppleHelpers = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    if manifest.version != 1
        || manifest.analytical_default
        || !valid_digest(&manifest.foundation_models)
        || !valid_digest(&manifest.voice)
    {
        return None;
    }
    let verified = Command::new("/usr/bin/codesign")
        .args(["--verify", "--deep", "--strict"])
        .arg(app)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()?
        .success();
    verified.then(|| (contents.to_path_buf(), manifest))
}
