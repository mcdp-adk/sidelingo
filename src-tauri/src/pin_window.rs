use crate::clipboard;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::utils::config::WindowEffectsConfig;
use tauri::window::Effect;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent,
};
#[cfg(not(feature = "desktop-dev"))]
use windows::{
    core::w,
    Win32::UI::WindowsAndMessaging::{CreateWindowExW, WINDOW_EX_STYLE, WS_POPUP},
};

const LABEL: &str = "pin";
static MINIMUM_SIZE: Mutex<Option<PhysicalSize<u32>>> = Mutex::new(None);
const MIN_WIDTH: f64 = 230.0;
/// Room for the toolbar and a few lines.
const MIN_HEIGHT: f64 = 120.0;
/// Tells the front end the Pin window was hidden.
const HIDDEN: &str = "pin-window-hidden";
/// Set once the front end listens for Inputs, so the first `show` reaches it.
static READY: AtomicBool = AtomicBool::new(false);

/// Creates the Pin window, hidden until its front end is ready. It lives as long
/// as the process and only ever hides.
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::default());

    #[cfg(not(feature = "desktop-dev"))]
    let window = {
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
        window.owner_raw(owner)
    };

    let window = window
        .title("sidelingo")
        .visible(false)
        .inner_size(360.0, 240.0)
        // As narrow as the compact toolbar allows.
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .decorations(false)
        .always_on_top(!cfg!(feature = "desktop-dev"))
        .minimizable(false)
        .maximizable(false)
        // Mica shows through the page's transparent background.
        .transparent(true)
        .effects(WindowEffectsConfig {
            effects: vec![Effect::Mica],
            ..Default::default()
        })
        .build()?;
    update_minimum_size(&window)?;
    Ok(())
}

fn update_minimum_size(window: &WebviewWindow) -> tauri::Result<()> {
    let inner = window.inner_size()?;
    let outer = window.outer_size()?;
    let scale = window.scale_factor()?;
    // Undecorated Windows shadows add frame insets that tao's minimum-size
    // constraint misses, shrinking the client area (tauri-apps/tauri#12899).
    // https://github.com/tauri-apps/tauri/issues/12899
    let configured = LogicalSize::new(MIN_WIDTH, MIN_HEIGHT).to_physical::<f64>(scale);
    let minimum = PhysicalSize::new(
        configured.width.ceil() as u32 + outer.width.saturating_sub(inner.width),
        configured.height.ceil() as u32 + outer.height.saturating_sub(inner.height),
    );
    let previous = {
        let mut cached = MINIMUM_SIZE
            .lock()
            .map_err(|_| std::io::Error::other("Pin window minimum-size cache poisoned"))?;
        if *cached == Some(minimum) {
            return Ok(());
        }
        // Update before the setter can trigger a resize, and release the lock.
        cached.replace(minimum)
    };
    if let Err(error) = window.set_min_size(Some(minimum)) {
        let mut cached = MINIMUM_SIZE
            .lock()
            .map_err(|_| std::io::Error::other("Pin window minimum-size cache poisoned"))?;
        if *cached == Some(minimum) {
            *cached = previous;
        }
        return Err(error);
    }
    Ok(())
}

// Every path that shows or hides the Pin window goes through `show` or `hide`,
// so its visibility, and following the clipboard with it, has one owner.

/// Shows and focuses the Pin window. Going from hidden to shown follows the
/// clipboard again and sends its current Input.
pub fn show(app: &AppHandle) {
    // Readiness shows the window, so an earlier request has nothing to add.
    if !READY.load(Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        let was_hidden = !window.is_visible().unwrap_or(false);
        let _ = window.show();
        let _ = window.set_focus();
        if was_hidden {
            clipboard::shown();
        }
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        if !window.is_visible().unwrap_or(false) {
            return;
        }
        let _ = window.hide();
        clipboard::hidden();
        let _ = window.emit(HIDDEN, ());
    }
}

/// The front end listens for Inputs, so the Pin window can show.
#[tauri::command]
pub fn pin_window_ready(app: AppHandle) {
    READY.store(true, Ordering::SeqCst);
    show(&app);
}

/// Esc, the close button, and a double-click on the content.
#[tauri::command]
pub fn hide_pin_window(app: AppHandle) {
    hide(&app);
}

/// Closing the Pin window (Alt+F4) hides it instead.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != LABEL {
        return;
    }
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            hide(window.app_handle());
        }
        // ScaleFactorChanged arrives before the new frame dimensions settle.
        WindowEvent::Resized(_) => {
            if let Some(window) = window.app_handle().get_webview_window(LABEL) {
                if let Err(error) = update_minimum_size(&window) {
                    eprintln!("failed to update Pin window minimum size: {error}");
                }
            }
        }
        _ => {}
    }
}
