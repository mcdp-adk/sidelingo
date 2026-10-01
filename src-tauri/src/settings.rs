//! Holds the settings document without knowing its fields, which the front
//! end's schema owns.

use std::io::Write;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

const FILE: &str = "settings.json";

/// The document as read at startup, or none when there is no file.
pub struct SettingsDocument(Mutex<Option<Value>>);

/// Reads the settings file from the data folder. The file is read at startup only.
pub fn load(app: &AppHandle) -> tauri::Result<()> {
    let path = app.path().app_data_dir()?.join(FILE);
    app.manage(SettingsDocument(Mutex::new(read(&path))));
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
pub fn read_settings(document: State<SettingsDocument>) -> Result<Option<Value>, String> {
    document
        .0
        .lock()
        .map(|value| value.clone())
        .map_err(|error| error.to_string())
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
    let mut next = held
        .clone()
        .unwrap_or_else(|| Value::Object(Default::default()));
    merge(&mut next, patch);
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(FILE);
    write_atomically(&path, &next).map_err(|error| error.to_string())?;
    *held = Some(next.clone());
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
