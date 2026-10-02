use global_hotkey::{hotkey::HotKey, GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

struct Registration {
    manager: GlobalHotKeyManager,
    active: Option<HotKey>,
    error: Option<String>,
}

// The manager is created and used only on Tauri's main thread. Commands dispatch
// there before reading or changing it, as the platform requires.
unsafe impl Send for Registration {}

pub fn start(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(Mutex::new(Registration {
        manager: GlobalHotKeyManager::new()?,
        active: None,
        error: None,
    }));
    let handle = app.clone();
    GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
        if event.state != HotKeyState::Pressed {
            return;
        }
        if let Some(pin) = handle.get_webview_window("pin") {
            if pin.is_visible().unwrap_or(false)
                && pin
                    .hwnd()
                    .is_ok_and(|hwnd| unsafe { GetForegroundWindow() } == hwnd)
            {
                crate::pin_window::hide(&handle);
            } else {
                crate::pin_window::show(&handle);
            }
        }
    }));
    Ok(())
}

fn system_error(error: global_hotkey::Error) -> String {
    // global-hotkey categorizes this Windows error, so restore the system's
    // own localized message and error number for the field.
    match error {
        global_hotkey::Error::AlreadyRegistered(_) => {
            std::io::Error::from_raw_os_error(1409).to_string()
        }
        other => other.to_string(),
    }
}

fn replace(app: &AppHandle, hotkey: Option<String>) -> Result<(), String> {
    let candidate = hotkey
        .map(|chord| {
            chord
                .replace("Win+", "Super+")
                .parse::<HotKey>()
                .map_err(|error| error.to_string())
        })
        .transpose()?;
    let state = app.state::<Mutex<Registration>>();
    let mut registration = state.lock().map_err(|error| error.to_string())?;
    if candidate == registration.active {
        return Ok(());
    }
    if let Some(candidate) = candidate {
        registration
            .manager
            .register(candidate)
            .map_err(system_error)?;
    }
    if let Some(old) = registration.active {
        if let Err(error) = registration.manager.unregister(old) {
            if let Some(candidate) = candidate {
                let _ = registration.manager.unregister(candidate);
            }
            return Err(system_error(error));
        }
    }
    registration.active = candidate;
    Ok(())
}

#[tauri::command]
pub async fn register_hotkey(app: AppHandle, hotkey: Option<String>) -> Result<(), String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = replace(&handle, hotkey);
        let result = match handle.state::<Mutex<Registration>>().lock() {
            Ok(mut registration) => {
                registration.error = result.as_ref().err().cloned();
                result
            }
            Err(error) => Err(error.to_string()),
        };
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;
    receiver.recv().map_err(|error| error.to_string())?
}

/// Settings is created after startup and needs the real registration result,
/// including failures that happened while only the Pin frontend existed.
#[tauri::command]
pub fn read_hotkey_error(app: AppHandle) -> Result<Option<String>, String> {
    let state = app.state::<Mutex<Registration>>();
    let registration = state.lock().map_err(|error| error.to_string())?;
    Ok(registration.error.clone())
}
