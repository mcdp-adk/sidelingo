// Prevents an additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
        .invoke_handler(tauri::generate_handler![pin_window::hide_pin_window])
        .on_window_event(pin_window::on_window_event)
        .run(tauri::generate_context!())
        .expect("error while running sidelingo");
}
