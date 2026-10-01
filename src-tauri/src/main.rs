// Prevents an additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(all(feature = "desktop-dev", not(debug_assertions)))]
compile_error!("desktop-dev is only available in debug builds");

mod accent_color;
mod clipboard;
mod pin_window;
mod tray;
mod ui_language;

fn main() {
    tauri::Builder::default()
        // Registered first, so a second launch shows this one's Pin window and quits early.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            pin_window::show(app)
        }))
        .setup(|app| {
            clipboard::start(app.handle())?;
            pin_window::create(app.handle())?;
            tray::create(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            accent_color::accent_color,
            pin_window::hide_pin_window,
            pin_window::pin_window_ready
        ])
        .on_window_event(pin_window::on_window_event)
        .run(tauri::generate_context!())
        .expect("error while running sidelingo");
}
