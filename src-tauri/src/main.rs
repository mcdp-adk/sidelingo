// Prevents an additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(all(feature = "desktop-dev", not(debug_assertions)))]
compile_error!("desktop-dev is only available in debug builds");

mod accent_color;
mod pin_window;
mod tray;
mod ui_language;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            pin_window::create(app.handle())?;
            tray::create(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            accent_color::accent_color,
            pin_window::hide_pin_window
        ])
        .on_window_event(pin_window::on_window_event)
        .run(tauri::generate_context!())
        .expect("error while running sidelingo");
}
