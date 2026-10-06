use tauri::utils::config::WindowEffectsConfig;
use tauri::window::Effect;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, Window,
    WindowEvent,
};

use crate::look;
use crate::ui_language::UiLanguage;
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
};

const LABEL: &str = "settings";
static OPENING: Mutex<()> = Mutex::new(());

/// Settings is an ordinary window. While it exists, the Pin joins the ordinary
/// z-order so it cannot cover Settings merely by being topmost.
pub fn show(app: &AppHandle) -> tauri::Result<()> {
    // Async commands/tray dispatch can arrive together; creation has one owner.
    let _opening = OPENING
        .lock()
        .map_err(|_| std::io::Error::other("Settings window creation lock poisoned"))?;
    if let Some(window) = app.get_webview_window(LABEL) {
        window.unminimize()?;
        window.show()?;
        window.set_focus()?;
        window.emit("settings-window-opened", ())?;
        return Ok(());
    }

    let title = match UiLanguage::current() {
        UiLanguage::ZhHans => "设置",
        UiLanguage::En => "Settings",
    };
    let window =
        look::webview_defaults(WebviewWindowBuilder::new(app, LABEL, WebviewUrl::default()))?
            .title(title)
            .visible(false)
            .inner_size(640.0, 640.0)
            .min_inner_size(360.0, 300.0)
            .transparent(true)
            .effects(WindowEffectsConfig {
                effects: vec![Effect::Mica],
                ..Default::default()
            })
            .build()?;
    // Physical work-area coordinates keep centering on the Pin's monitor correct
    // when monitors use different scale factors.
    if let Some(pin) = app.get_webview_window("pin") {
        if let Some(monitor) = pin.current_monitor()? {
            let area = monitor.work_area();
            let size = window.outer_size()?;
            window.set_position(PhysicalPosition::new(
                area.position.x + (area.size.width.saturating_sub(size.width) / 2) as i32,
                area.position.y + (area.size.height.saturating_sub(size.height) / 2) as i32,
            ))?;
        }
        pin.set_always_on_top(false)?;
    }
    window.show()?;
    window.set_focus()?;
    Ok(())
}

/// Opens Settings from a synchronous event handler (tray menu, notification click), where
/// creating the WebView2 window directly deadlocks.
pub fn show_from_event_handler(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = show(&app) {
            eprintln!("failed to open Settings: {error}");
        }
    });
}

#[tauri::command]
pub async fn open_settings(app: AppHandle) -> Result<(), String> {
    show(&app).map_err(|error| error.to_string())
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    match (window.label(), event) {
        (LABEL, WindowEvent::Destroyed) => {
            if let Some(pin) = window.app_handle().get_webview_window("pin") {
                if let Err(error) = pin.set_always_on_top(!cfg!(feature = "desktop-dev")) {
                    eprintln!("failed to restore Pin window topmost state: {error}");
                }
            }
        }
        ("pin", WindowEvent::Focused(true)) => {
            if let Some(settings) = window.app_handle().get_webview_window(LABEL) {
                // Keep Settings above the Pin without taking keyboard focus away
                // from the Pin's controls or Ctrl+selection.
                if let Ok(hwnd) = settings.hwnd() {
                    let _ = unsafe {
                        SetWindowPos(
                            hwnd,
                            Some(HWND_TOP),
                            0,
                            0,
                            0,
                            0,
                            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
                        )
                    };
                }
            }
        }
        _ => {}
    }
}
use std::sync::Mutex;
