use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};
use windows::core::w;
use windows::Win32::UI::WindowsAndMessaging::{CreateWindowExW, WINDOW_EX_STYLE, WS_POPUP};

const LABEL: &str = "pin";
const MIN_WIDTH: f64 = 230.0;
/// Room for the toolbar and a few lines.
const MIN_HEIGHT: f64 = 120.0;
/// Tells the front end the Pin window was hidden.
const HIDDEN: &str = "pin-window-hidden";

/// Creates the Pin window. It lives as long as the process and only ever hides.
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    // Windows leaves an owned window out of the taskbar and Alt+Tab. tao's
    // `skip_taskbar` only drops the taskbar button, and a WS_EX_TOOLWINDOW style
    // set by hand is lost whenever tao rewrites the window's styles.
    let owner = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            w!("STATIC"),
            None,
            WS_POPUP,
            0,
            0,
            0,
            0,
            None,
            None,
            None,
            None,
        )
    }
    .map_err(|e| tauri::Error::Anyhow(e.into()))?;

    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::default())
        .title("sidelingo")
        .owner_raw(owner)
        .inner_size(360.0, 240.0)
        // As narrow as the compact toolbar allows.
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .decorations(false)
        .always_on_top(true)
        .minimizable(false)
        .maximizable(false)
        .build()?;
    Ok(())
}

// Every path that shows or hides the Pin window goes through `show` or `hide`,
// so its visibility has one owner.

pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
        let _ = window.emit(HIDDEN, ());
    }
}

/// Esc, the close button, and a double-click on the content.
#[tauri::command]
pub fn hide_pin_window(app: AppHandle) {
    hide(&app);
}

/// Closing the Pin window (Alt+F4) hides it instead.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == LABEL {
            api.prevent_close();
            hide(window.app_handle());
        }
    }
}
