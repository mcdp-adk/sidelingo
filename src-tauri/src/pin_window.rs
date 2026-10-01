use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};
use windows::core::w;
use windows::Win32::UI::WindowsAndMessaging::{CreateWindowExW, WINDOW_EX_STYLE, WS_POPUP};

const LABEL: &str = "pin";

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
        .decorations(false)
        .always_on_top(true)
        .minimizable(false)
        .maximizable(false)
        .build()?;
    Ok(())
}

pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Closing the Pin window (Alt+F4) hides it instead.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == LABEL {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}
