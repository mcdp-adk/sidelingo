//! Holds the settings document without knowing its fields, which the front
//! end's schema owns.

use std::io::Write;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
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

/// What `read_settings` answers and each written document broadcasts.
#[derive(Clone, Serialize)]
pub struct Held {
    #[serde(flatten)]
    read: SettingsRead,
    /// Counts the documents written since startup, so a window can tell the newest
    /// from one whose broadcast arrives late. Setting a broken file aside writes no
    /// document, so it keeps the revision.
    revision: u64,
    /// The front end rejected the held document and it couldn't be set aside, so a
    /// patch would write over it.
    #[serde(skip)]
    rejected: bool,
    /// The file's text as last read or written, so a set-aside can tell it still holds
    /// what the front end judged; none when there is no file or it couldn't be read.
    #[serde(skip)]
    text: Option<String>,
}

/// Why the front end judged the held document broken, named as it crosses the seam.
#[derive(Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BrokenReason {
    /// The file isn't JSON.
    InvalidJson,
    /// The document is JSON the schema rejects.
    Schema,
}

impl BrokenReason {
    /// Whether `read` is the status this reason judges.
    fn names(self, read: &SettingsRead) -> bool {
        matches!(
            (self, read),
            (Self::InvalidJson, SettingsRead::InvalidJson)
                | (Self::Schema, SettingsRead::Document(_))
        )
    }
}

/// The JSON document as last read or written, with its file and parse status.
pub struct SettingsDocument(Mutex<Held>);

/// Reads the settings file from the data folder at startup. A patch reads it again
/// only when this read failed.
pub fn load(app: &AppHandle) -> tauri::Result<()> {
    let path = app.path().app_data_dir()?.join(FILE);
    let (read, text) = read(&path);
    app.manage(SettingsDocument(Mutex::new(Held {
        read,
        revision: 0,
        rejected: false,
        text,
    })));
    Ok(())
}

/// The file's status and document, with the text it was read from.
fn read(path: &Path) -> (SettingsRead, Option<String>) {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return (SettingsRead::Missing, None)
        }
        Err(error) => {
            eprintln!("failed to read {}: {error}", path.display());
            return (SettingsRead::Unreadable, None);
        }
    };
    let read = match serde_json::from_str(&text) {
        Ok(document) => SettingsRead::Document(document),
        Err(error) => {
            eprintln!("failed to parse {}: {error}", path.display());
            SettingsRead::InvalidJson
        }
    };
    (read, Some(text))
}

#[tauri::command]
pub fn read_settings(document: State<SettingsDocument>) -> Result<Held, String> {
    document
        .0
        .lock()
        .map(|value| value.clone())
        .map_err(|error| error.to_string())
}

/// Sets aside the settings file the front end judged broken at `revision`, when Rust
/// still holds that revision with the status `reason` names and the file still holds
/// the text it was read from; otherwise answers false and changes nothing.
#[tauri::command]
pub fn set_aside_broken_settings(
    app: AppHandle,
    document: State<SettingsDocument>,
    revision: u64,
    reason: BrokenReason,
) -> Result<bool, String> {
    let mut held = document.0.lock().map_err(|error| error.to_string())?;
    if held.revision != revision || !reason.names(&held.read) {
        return Ok(false);
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(FILE);
    let result = match std::fs::read_to_string(&path) {
        Ok(text) if Some(&text) != held.text.as_ref() => return Ok(false),
        Ok(_) => std::fs::rename(&path, path.with_file_name("settings.json.broken")),
        Err(error) => Err(error),
    };
    match result {
        Ok(()) => {
            held.read = SettingsRead::Missing;
            held.text = None;
            held.rejected = false;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => {
            held.rejected = reason == BrokenReason::Schema;
            Err(error.to_string())
        }
    }
}

/// Serializes patches from both windows. A failed write changes neither the held
/// document nor the document other windows receive. A file that couldn't be read
/// is read again rather than replaced, and the patch is refused while it still can't.
/// A document the front end rejected is never patched; it must be set aside first.
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
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(FILE);
    if held.rejected {
        return Err(
            "settings.json holds settings this version can't use and couldn't be set aside, so this change wasn't saved over it"
                .into(),
        );
    }
    let current = match &held.read {
        SettingsRead::InvalidJson | SettingsRead::Unreadable => read(&path).0,
        current => current.clone(),
    };
    let mut next = match current {
        SettingsRead::Document(document) => document,
        SettingsRead::Missing => Value::Object(Default::default()),
        SettingsRead::InvalidJson | SettingsRead::Unreadable => return Err(
            "settings.json can't be read or isn't valid JSON, so this change wasn't saved over it"
                .into(),
        ),
    };
    merge(&mut next, patch);
    let text = serde_json::to_string_pretty(&next).map_err(|error| error.to_string())?;
    write_atomically(&path, &text).map_err(|error| error.to_string())?;
    *held = Held {
        read: SettingsRead::Document(next),
        revision: held.revision + 1,
        rejected: false,
        text: Some(text),
    };
    if let Err(error) = app.emit("settings-document-changed", &*held) {
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

fn write_atomically(path: &Path, text: &str) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(path.parent().ok_or("Settings path has no parent")?)?;
    let temporary = path.with_extension("json.tmp");
    let result = (|| {
        let mut file = std::fs::File::create(&temporary)?;
        file.write_all(text.as_bytes())?;
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
    use std::os::windows::fs::OpenOptionsExt;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use serde_json::json;
    use tauri::Listener;

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

        /// Starts after `prepare` has had the settings file's path, keeping what it returns until the file is read.
        fn start_with<T>(prepare: impl FnOnce(&Path) -> T) -> Self {
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
            let prepared = prepare(&folder.join(FILE));
            load(app.handle()).unwrap();
            drop(prepared);
            Self { app, folder }
        }

        /// What `read_settings` answers, without its revision.
        fn read(&self) -> Value {
            let mut read = serde_json::to_value(read_settings(self.app.state()).unwrap()).unwrap();
            read.as_object_mut().unwrap().remove("revision");
            read
        }

        fn revision(&self) -> u64 {
            read_settings(self.app.state()).unwrap().revision
        }

        fn patch(&self, patch: Value) -> Result<(), String> {
            patch_settings(self.app.handle().clone(), self.app.state(), patch)
        }

        /// The front end's verdict on the document read at `revision`, its reason named as it crosses the seam.
        fn set_aside(&self, reason: &str, revision: u64) -> Result<bool, String> {
            set_aside_broken_settings(
                self.app.handle().clone(),
                self.app.state(),
                revision,
                serde_json::from_value(json!(reason)).unwrap(),
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

    /// Holds `file` open as another program can, so no one else can read or write it until the handle drops.
    fn hold_exclusively(file: &Path) -> std::fs::File {
        std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(file)
            .unwrap()
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
    fn a_patch_without_a_file_or_onto_a_non_object_starts_from_an_empty_one() {
        for start in [None, Some("[1, 2]")] {
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
    fn a_patch_merges_onto_a_file_that_could_not_be_read_at_startup() {
        let saved = r#"{"schemaVersion":1,"activePreset":"custom","presets":{"custom":{"keyCiphertext":"kept"}}}"#;
        // Another program held the file open while sidelingo started.
        let app = TestApp::start_with(|file| {
            std::fs::write(file, saved).unwrap();
            hold_exclusively(file)
        });
        assert_eq!(app.read(), json!({ "status": "unreadable" }));
        app.patch(json!({ "displayMode": "both" })).unwrap();
        assert_eq!(
            app.written(),
            json!({
                "schemaVersion": 1,
                "activePreset": "custom",
                "presets": { "custom": { "keyCiphertext": "kept" } },
                "displayMode": "both",
            })
        );
    }

    #[test]
    fn a_patch_is_refused_and_writes_nothing_while_the_file_cannot_be_read() {
        let app = TestApp::start(Some("{bad json"));
        assert!(app.patch(json!({ "displayMode": "both" })).is_err());
        assert_eq!(app.text(FILE).as_deref(), Some("{bad json"));

        let saved = r#"{"schemaVersion":1,"activePreset":"custom"}"#;
        let app = TestApp::start_with(|file| {
            std::fs::write(file, saved).unwrap();
            hold_exclusively(file)
        });
        let held = hold_exclusively(&app.file(FILE));
        assert!(app.patch(json!({ "displayMode": "both" })).is_err());
        drop(held);
        assert_eq!(app.text(FILE).as_deref(), Some(saved));
    }

    #[test]
    fn each_written_document_takes_the_next_revision_and_is_broadcast_with_it() {
        let app = TestApp::start(Some(r#"{"schemaVersion":1}"#));
        let broadcasts = std::sync::Arc::new(Mutex::new(Vec::<Value>::new()));
        let heard = broadcasts.clone();
        app.app
            .listen_any("settings-document-changed", move |event| {
                heard
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str(event.payload()).unwrap());
            });
        assert_eq!(app.revision(), 0);
        app.patch(json!({ "activePreset": "custom" })).unwrap();
        app.patch(json!({ "displayMode": "both" })).unwrap();
        assert_eq!(app.revision(), 2);
        // Neither a refused patch nor a failed write writes a document.
        assert!(app.patch(json!(["displayMode"])).is_err());
        std::fs::create_dir(app.file("settings.json.tmp")).unwrap();
        assert!(app.patch(json!({ "targetLanguage": "ja" })).is_err());
        assert_eq!(app.revision(), 2);
        assert_eq!(
            *broadcasts.lock().unwrap(),
            [
                json!({ "status": "document", "document": { "schemaVersion": 1, "activePreset": "custom" }, "revision": 1 }),
                json!({
                    "status": "document",
                    "document": { "schemaVersion": 1, "activePreset": "custom", "displayMode": "both" },
                    "revision": 2,
                }),
            ]
        );
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
        assert_eq!(app.set_aside("invalidJson", 0), Ok(true));
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
            assert_eq!(app.set_aside("schema", 0), Ok(true), "{text}");
            assert_eq!(app.text("settings.json.broken").as_deref(), Some(text));
            assert_eq!(app.read(), json!({ "status": "missing" }));
        }
    }

    #[test]
    fn the_next_patch_after_setting_aside_writes_a_fresh_file() {
        let app = TestApp::start(Some(r#"{"schemaVersion":99,"stale":true}"#));
        app.set_aside("schema", 0).unwrap();
        app.patch(json!({ "schemaVersion": 1 })).unwrap();
        assert_eq!(app.written(), json!({ "schemaVersion": 1 }));
    }

    #[test]
    fn a_verdict_on_an_older_revision_is_refused() {
        // The other window patched after this one read the rejected document.
        let app = TestApp::start(Some(r#"{"schemaVersion":99}"#));
        app.patch(json!({ "schemaVersion": 1 })).unwrap();
        assert_eq!(app.set_aside("schema", 0), Ok(false));
        assert_eq!(app.written(), json!({ "schemaVersion": 1 }));

        // Then the rejected document was put back from outside sidelingo.
        std::fs::write(app.file(FILE), r#"{"schemaVersion":99}"#).unwrap();
        assert_eq!(app.set_aside("schema", 0), Ok(false));
        assert_eq!(app.written(), json!({ "schemaVersion": 99 }));
        assert!(!app.file("settings.json.broken").exists());
    }

    #[test]
    fn a_second_verdict_on_the_same_revision_after_a_set_aside_is_refused() {
        // Both windows judged the same broken file, which came back from outside sidelingo in between.
        for (text, reason) in [
            ("{bad json", "invalidJson"),
            (r#"{"schemaVersion":99}"#, "schema"),
        ] {
            let app = TestApp::start(Some(text));
            assert_eq!(app.set_aside(reason, 0), Ok(true), "{reason}");
            std::fs::write(app.file(FILE), text).unwrap();
            assert_eq!(app.set_aside(reason, 0), Ok(false), "{reason}");
            assert_eq!(app.text(FILE).as_deref(), Some(text), "{reason}");
        }
    }

    #[test]
    fn a_file_edited_to_different_content_after_the_read_is_kept() {
        for (text, edited, reason) in [
            ("{bad json", "{other bad json", "invalidJson"),
            (
                r#"{"schemaVersion":99}"#,
                r#"{"schemaVersion":98}"#,
                "schema",
            ),
            // Different text holding the same document is an edit too.
            (
                r#"{"schemaVersion":99}"#,
                r#"{ "schemaVersion": 99 }"#,
                "schema",
            ),
        ] {
            let app = TestApp::start(Some(text));
            std::fs::write(app.file(FILE), edited).unwrap();
            assert_eq!(app.set_aside(reason, 0), Ok(false), "{edited}");
            assert_eq!(app.text(FILE).as_deref(), Some(edited));
            assert!(!app.file("settings.json.broken").exists());
        }
    }

    #[test]
    fn a_written_document_judged_rejected_is_set_aside() {
        // The front end judges each document Rust writes as it judges the one read at startup.
        let app = TestApp::start(None);
        app.patch(json!({ "schemaVersion": 99 })).unwrap();
        assert_eq!(app.set_aside("schema", 1), Ok(true));
        assert_eq!(
            serde_json::from_str::<Value>(&app.text("settings.json.broken").unwrap()).unwrap(),
            json!({ "schemaVersion": 99 })
        );
    }

    #[test]
    fn a_rejected_document_that_could_not_be_set_aside_takes_no_patch_until_it_is() {
        let rejected = r#"{"schemaVersion":99,"newer":true}"#;
        // Held so it can't be read, then so it can be read but not moved (FILE_SHARE_READ).
        for share_mode in [0, 1] {
            let app = TestApp::start(Some(rejected));
            let held = std::fs::OpenOptions::new()
                .read(true)
                .share_mode(share_mode)
                .open(app.file(FILE))
                .unwrap();
            assert!(app.set_aside("schema", 0).is_err());
            drop(held);
            assert!(app
                .patch(json!({ "schemaVersion": 1, "displayMode": "both" }))
                .is_err());
            assert_eq!(app.text(FILE).as_deref(), Some(rejected), "{share_mode}");

            // The other window's start sets it aside, and patches write a fresh file again.
            assert_eq!(app.set_aside("schema", 0), Ok(true));
            assert_eq!(app.text("settings.json.broken").as_deref(), Some(rejected));
            app.patch(json!({ "schemaVersion": 1, "displayMode": "both" }))
                .unwrap();
            assert_eq!(
                app.written(),
                json!({ "schemaVersion": 1, "displayMode": "both" })
            );
        }
    }

    #[test]
    fn a_verdict_whose_reason_names_another_status_is_refused() {
        for (text, reason) in [
            (None, "invalidJson"),
            (None, "schema"),
            (Some(r#"{"schemaVersion":99}"#), "invalidJson"),
            (Some("{bad json"), "schema"),
        ] {
            let app = TestApp::start(text);
            assert_eq!(app.set_aside(reason, 0), Ok(false), "{text:?} {reason}");
            assert_eq!(app.text(FILE).as_deref(), text);
            assert!(!app.file("settings.json.broken").exists());
        }
    }

    #[test]
    fn only_the_reasons_the_front_end_names_deserialize() {
        for (name, reason) in [
            ("invalidJson", BrokenReason::InvalidJson),
            ("schema", BrokenReason::Schema),
        ] {
            assert!(serde_json::from_value::<BrokenReason>(json!(name)).ok() == Some(reason));
        }
        for name in ["tooOld", "InvalidJson", "invalid_json"] {
            assert!(serde_json::from_value::<BrokenReason>(json!(name)).is_err());
        }
    }
}
