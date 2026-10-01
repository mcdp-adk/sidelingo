//! Holds the settings document without knowing its fields, which the front
//! end's schema owns.

use std::path::Path;

use serde_json::Value;
use tauri::{AppHandle, Manager, State};

const FILE: &str = "settings.json";

/// The document as read at startup, or none when there is no file.
pub struct SettingsDocument(Option<Value>);

/// Reads the settings file from the data folder. The file is read at startup only.
pub fn load(app: &AppHandle) -> tauri::Result<()> {
    let path = app.path().app_data_dir()?.join(FILE);
    app.manage(SettingsDocument(read(&path)));
    Ok(())
}

fn read(path: &Path) -> Option<Value> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => {
            eprintln!("failed to read {}: {error}", path.display());
            return None;
        }
    };
    // Setting a broken file aside comes with #55; until then it reads as none.
    serde_json::from_str(&text)
        .inspect_err(|error| eprintln!("failed to parse {}: {error}", path.display()))
        .ok()
}

#[tauri::command]
pub fn read_settings(document: State<SettingsDocument>) -> Option<Value> {
    document.0.clone()
}
