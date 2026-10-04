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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use serde_json::json;

    use super::*;

    /// A real app whose data folder is its own, removed when the test ends.
    struct TestApp {
        app: tauri::App,
        folder: PathBuf,
    }

    impl TestApp {
        /// Starts with `settings.json` holding `text`, or without the file.
        fn start(text: Option<&str>) -> Self {
            Self::start_with(|file| {
                if let Some(text) = text {
                    std::fs::write(file, text).unwrap();
                }
            })
        }

        /// Starts after `prepare` has had the settings file's path.
        fn start_with(prepare: impl FnOnce(&Path)) -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let mut context = tauri::generate_context!();
            context.config_mut().identifier = format!(
                "io.github.mcdp-adk.sidelingo.cargo-test.{}.{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            );
            let app = tauri::Builder::default()
                .any_thread()
                .build(context)
                .expect("test app builds");
            let folder = app.path().app_data_dir().unwrap();
            let _ = std::fs::remove_dir_all(&folder);
            std::fs::create_dir_all(&folder).unwrap();
            prepare(&folder.join(FILE));
            load(app.handle()).unwrap();
            Self { app, folder }
        }

        fn read(&self) -> Value {
            serde_json::to_value(read_settings(self.app.state()).unwrap()).unwrap()
        }

        fn patch(&self, patch: Value) -> Result<(), String> {
            patch_settings(self.app.handle().clone(), self.app.state(), patch)
        }

        fn set_aside(&self, reason: &str, expected: Value) -> Result<bool, String> {
            set_aside_broken_settings(
                self.app.handle().clone(),
                self.app.state(),
                reason.into(),
                expected,
            )
        }

        fn file(&self, name: &str) -> PathBuf {
            self.folder.join(name)
        }

        fn text(&self, name: &str) -> Option<String> {
            std::fs::read_to_string(self.file(name)).ok()
        }

        fn written(&self) -> Value {
            serde_json::from_str(&self.text(FILE).expect("settings.json exists")).unwrap()
        }
    }

    impl Drop for TestApp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.folder);
        }
    }

    #[test]
    fn a_missing_file_reads_as_missing() {
        let app = TestApp::start(None);
        assert_eq!(app.read(), json!({ "status": "missing" }));
    }

    #[test]
    fn a_file_that_cannot_be_read_reads_as_unreadable() {
        let app = TestApp::start_with(|file| std::fs::create_dir(file).unwrap());
        assert_eq!(app.read(), json!({ "status": "unreadable" }));
    }

    #[test]
    fn a_file_that_is_not_json_reads_as_invalid_json() {
        let app = TestApp::start(Some("{bad json"));
        assert_eq!(app.read(), json!({ "status": "invalidJson" }));
    }

    #[test]
    fn a_json_file_reads_as_its_document() {
        let app = TestApp::start(Some(r#"{ "schemaVersion": 1, "activePreset": "custom" }"#));
        assert_eq!(
            app.read(),
            json!({
                "status": "document",
                "document": { "schemaVersion": 1, "activePreset": "custom" },
            })
        );
    }

    #[test]
    fn a_file_holding_json_null_reads_as_a_null_document_not_as_missing() {
        let app = TestApp::start(Some("null"));
        assert_eq!(
            app.read(),
            json!({ "status": "document", "document": null })
        );
    }

    #[test]
    fn a_patch_merges_nested_fields_and_replaces_everything_else() {
        let app = TestApp::start(Some(
            r#"{ "presets": { "custom": { "baseUrl": "a", "model": "m" }, "other": {} },
                 "languages": ["en", "fr"], "activePreset": "custom", "kept": true }"#,
        ));
        app.patch(json!({
            "presets": { "custom": { "model": "n", "added": 1 } },
            "languages": ["de"],
            "activePreset": { "now": "an object" },
        }))
        .unwrap();
        let expected = json!({
            "presets": { "custom": { "baseUrl": "a", "model": "n", "added": 1 }, "other": {} },
            "languages": ["de"],
            "activePreset": { "now": "an object" },
            "kept": true,
        });
        assert_eq!(app.written(), expected);
        assert_eq!(
            app.read(),
            json!({ "status": "document", "document": expected })
        );
    }

    #[test]
    fn a_patch_without_a_readable_document_starts_from_an_empty_one() {
        for start in [None, Some("{bad json"), Some("[1, 2]")] {
            let app = TestApp::start(start);
            app.patch(json!({ "schemaVersion": 1 })).unwrap();
            assert_eq!(
                app.written(),
                json!({ "schemaVersion": 1 }),
                "from {start:?}"
            );
        }
    }

    #[test]
    fn a_patch_that_is_not_an_object_is_refused_and_writes_nothing() {
        let app = TestApp::start(Some(r#"{"schemaVersion":1}"#));
        assert!(app.patch(json!(["schemaVersion"])).is_err());
        assert_eq!(app.text(FILE).as_deref(), Some(r#"{"schemaVersion":1}"#));
        assert_eq!(
            app.read(),
            json!({ "status": "document", "document": { "schemaVersion": 1 } })
        );
    }

    #[test]
    fn a_patch_replaces_the_existing_file_and_leaves_no_temporary_file() {
        let app = TestApp::start(Some(r#"{"schemaVersion":1}"#));
        app.patch(json!({ "activePreset": "custom" })).unwrap();
        assert_eq!(
            app.written(),
            json!({ "schemaVersion": 1, "activePreset": "custom" })
        );
        assert!(!app.file("settings.json.tmp").exists());
    }

    #[test]
    fn a_failed_write_changes_neither_the_file_nor_the_held_document() {
        let app = TestApp::start(Some(r#"{"schemaVersion":1}"#));
        // The temporary file can't be created where a folder stands.
        std::fs::create_dir(app.file("settings.json.tmp")).unwrap();
        assert!(app.patch(json!({ "activePreset": "custom" })).is_err());
        assert_eq!(app.text(FILE).as_deref(), Some(r#"{"schemaVersion":1}"#));
        assert_eq!(
            app.read(),
            json!({ "status": "document", "document": { "schemaVersion": 1 } })
        );
    }

    #[test]
    fn invalid_json_is_set_aside_with_its_text_and_then_reads_as_missing() {
        let app = TestApp::start(Some("{bad json"));
        assert_eq!(app.set_aside("invalidJson", Value::Null), Ok(true));
        assert_eq!(
            app.text("settings.json.broken").as_deref(),
            Some("{bad json")
        );
        assert!(!app.file(FILE).exists());
        assert_eq!(app.read(), json!({ "status": "missing" }));
    }

    #[test]
    fn a_rejected_document_is_set_aside_when_it_is_still_the_one_read() {
        for text in [r#"{"schemaVersion":99}"#, "null"] {
            let app = TestApp::start(Some(text));
            let read: Value = serde_json::from_str(text).unwrap();
            assert_eq!(app.set_aside("schema", read), Ok(true), "{text}");
            assert_eq!(app.text("settings.json.broken").as_deref(), Some(text));
            assert_eq!(app.read(), json!({ "status": "missing" }));
        }
    }

    #[test]
    fn the_next_patch_after_setting_aside_writes_a_fresh_file() {
        let app = TestApp::start(Some(r#"{"schemaVersion":99,"stale":true}"#));
        app.set_aside("schema", json!({ "schemaVersion": 99, "stale": true }))
            .unwrap();
        app.patch(json!({ "schemaVersion": 1 })).unwrap();
        assert_eq!(app.written(), json!({ "schemaVersion": 1 }));
    }

    #[test]
    fn a_file_rewritten_since_it_was_read_is_not_set_aside() {
        // Another window's patch replaced the broken file before this window set it aside.
        let app = TestApp::start(Some("{bad json"));
        app.patch(json!({ "schemaVersion": 1 })).unwrap();
        assert_eq!(app.set_aside("invalidJson", Value::Null), Ok(false));

        let app = TestApp::start(Some(r#"{"schemaVersion":99}"#));
        app.patch(json!({ "schemaVersion": 1 })).unwrap();
        assert_eq!(
            app.set_aside("schema", json!({ "schemaVersion": 99 })),
            Ok(false)
        );

        // A patch was written, then the rejected document was put back from outside sidelingo.
        let app = TestApp::start(Some(r#"{"schemaVersion":99}"#));
        app.patch(json!({ "schemaVersion": 1 })).unwrap();
        std::fs::write(app.file(FILE), r#"{"schemaVersion":99}"#).unwrap();
        assert_eq!(
            app.set_aside("schema", json!({ "schemaVersion": 99 })),
            Ok(false)
        );

        // Something outside sidelingo rewrote the file.
        let app = TestApp::start(Some(r#"{"schemaVersion":99}"#));
        std::fs::write(app.file(FILE), r#"{"schemaVersion":98}"#).unwrap();
        assert_eq!(
            app.set_aside("schema", json!({ "schemaVersion": 99 })),
            Ok(false)
        );
        assert_eq!(app.written(), json!({ "schemaVersion": 98 }));
        assert!(!app.file("settings.json.broken").exists());
    }

    #[test]
    fn a_missing_file_is_not_set_aside() {
        let app = TestApp::start(None);
        assert_eq!(app.set_aside("invalidJson", Value::Null), Ok(false));
        assert_eq!(app.set_aside("schema", Value::Null), Ok(false));
        assert!(!app.file("settings.json.broken").exists());
    }

    #[test]
    fn an_unknown_reason_is_refused_and_keeps_the_file() {
        let app = TestApp::start(Some("{bad json"));
        assert!(app.set_aside("tooOld", Value::Null).is_err());
        assert_eq!(app.text(FILE).as_deref(), Some("{bad json"));
    }
}
