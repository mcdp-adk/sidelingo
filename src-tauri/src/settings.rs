//! Holds the settings document without knowing its fields, which the front
//! end's schema owns.

use std::io::Write;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

const FILE: &str = "settings.json";

#[derive(Clone, Serialize)]
#[serde(tag = "status", content = "document", rename_all = "camelCase")]
pub enum SettingsRead {
    Missing,
    InvalidJson,
    Unreadable,
    Document(Value),
}

/// The JSON document as read at startup, with its file and parse status.
pub struct SettingsDocument(Mutex<SettingsRead>);

/// Reads the settings file from the data folder. The file is read at startup only.
pub fn load(app: &AppHandle) -> tauri::Result<()> {
    let path = app.path().app_data_dir()?.join(FILE);
    app.manage(SettingsDocument(Mutex::new(read(&path))));
    Ok(())
}

fn read(path: &Path) -> SettingsRead {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return SettingsRead::Missing,
        Err(error) => {
            eprintln!("failed to read {}: {error}", path.display());
            return SettingsRead::Unreadable;
        }
    };
    match serde_json::from_str(&text) {
        Ok(document) => SettingsRead::Document(document),
        Err(error) => {
            eprintln!("failed to parse {}: {error}", path.display());
            SettingsRead::InvalidJson
        }
    }
}

#[tauri::command]
pub fn read_settings(document: State<SettingsDocument>) -> Result<SettingsRead, String> {
    document
        .0
        .lock()
        .map(|value| value.clone())
        .map_err(|error| error.to_string())
}

/// Sets aside a settings file that the TypeScript settings model rejected.
#[tauri::command]
pub fn set_aside_broken_settings(
    app: AppHandle,
    document: State<SettingsDocument>,
    reason: String,
    expected_document: Value,
) -> Result<bool, String> {
    let mut held = document.0.lock().map_err(|error| error.to_string())?;
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(FILE);
    if reason == "invalidJson" {
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.to_string()),
        };
        if serde_json::from_str::<Value>(&text).is_ok() {
            return Ok(false);
        }
    } else if reason == "schema" {
        if !matches!(&*held, SettingsRead::Document(current) if current == &expected_document) {
            return Ok(false);
        }
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.to_string()),
        };
        if serde_json::from_str::<Value>(&text).ok().as_ref() != Some(&expected_document) {
            return Ok(false);
        }
    } else {
        return Err("Unknown settings recovery reason".into());
    }
    let broken = path.with_file_name("settings.json.broken");
    match std::fs::rename(&path, broken) {
        Ok(()) => {
            *held = SettingsRead::Missing;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

/// Serializes patches from both windows. A failed write changes neither the held
/// document nor the document other windows receive.
#[tauri::command]
pub fn patch_settings(
    app: AppHandle,
    document: State<SettingsDocument>,
    patch: Value,
) -> Result<(), String> {
    if !patch.is_object() {
        return Err("A settings patch must be an object".into());
    }
    let mut held = document.0.lock().map_err(|error| error.to_string())?;
    let mut next = match &*held {
        SettingsRead::Document(document) => document.clone(),
        _ => Value::Object(Default::default()),
    };
    merge(&mut next, patch);
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(FILE);
    write_atomically(&path, &next).map_err(|error| error.to_string())?;
    *held = SettingsRead::Document(next.clone());
    if let Err(error) = app.emit("settings-document-changed", &next) {
        eprintln!("failed to broadcast settings document: {error}");
    }
    Ok(())
}

fn merge(document: &mut Value, patch: Value) {
    if let Value::Object(fields) = patch {
        if !document.is_object() {
            *document = Value::Object(Default::default());
        }
        let target = document.as_object_mut().unwrap();
        for (key, value) in fields {
            merge(target.entry(key).or_insert(Value::Null), value);
        }
    } else {
        *document = patch;
    }
}

fn write_atomically(path: &Path, document: &Value) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(path.parent().ok_or("Settings path has no parent")?)?;
    let temporary = path.with_extension("json.tmp");
    let result = (|| {
        let mut file = std::fs::File::create(&temporary)?;
        file.write_all(&serde_json::to_vec_pretty(document)?)?;
        file.sync_all()?;
        drop(file);
        let wide = |path: &Path| {
            path.as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>()
        };
        let from = wide(&temporary);
        let to = wide(path);
        // std::fs::rename cannot replace an existing Windows file. MoveFileExW
        // replaces it atomically after the temporary file's contents are flushed.
        unsafe {
            MoveFileExW(
                PCWSTR(from.as_ptr()),
                PCWSTR(to.as_ptr()),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}
