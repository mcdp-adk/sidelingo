// Prevents an additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(all(feature = "desktop-dev", not(debug_assertions)))]
compile_error!("desktop-dev is only available in debug builds");

mod accent_color;
mod autostart;
mod clipboard;
mod pin_window;
mod secrets;
mod settings;
mod settings_window;
mod tray;
mod ui_language;

fn main() {
    tauri::Builder::default()
        // A second manual launch shows this one's Pin window and quits early.
        .plugin(tauri_plugin_single_instance::init(|app, arguments, _| {
            if !arguments
                .iter()
                .any(|argument| argument == autostart::LAUNCH_ARGUMENT)
            {
                pin_window::show(app)
            }
        }))
        // Settle the borderless client area before restoring its inner size.
        .plugin(pin_window::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(pin_window::STATE_FLAGS)
                .with_filter(|label| label == pin_window::LABEL)
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .on_page_load(|webview, _| clipboard::webview_loaded(webview))
        .setup(|app| {
            autostart::setup(app.handle())?;
            settings::load(app.handle())?;
            clipboard::start(app.handle())?;
            pin_window::create(app.handle())?;
            tray::create(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            autostart::read_autostart,
            autostart::set_autostart,
            accent_color::accent_color,
            pin_window::hide_pin_window,
            pin_window::pin_window_ready,
            settings::read_settings,
            settings::patch_settings,
            settings_window::open_settings,
            clipboard::copy_text,
            secrets::protect_secret,
            secrets::unprotect_secret
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                clipboard::webview_closed(window.label());
            }
            pin_window::on_window_event(window, event);
            settings_window::on_window_event(window, event);
        })
        .run(tauri::generate_context!())
        .expect("error while running sidelingo");
}
