use auto_launch::{AutoLaunch, WindowsEnableMode};
use tauri::{AppHandle, Manager, State};

pub const LAUNCH_ARGUMENT: &str = "--autostart";

pub fn is_launch() -> bool {
    std::env::args().any(|argument| argument == LAUNCH_ARGUMENT)
}

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // auto-launch 0.6 writes this path verbatim; quote it for installations
    // under directories with spaces. Windows paths cannot contain quotes.
    let executable = format!("\"{}\"", std::env::current_exe()?.display());
    app.manage(AutoLaunch::new(
        &app.config().identifier,
        &executable,
        WindowsEnableMode::CurrentUser,
        &[LAUNCH_ARGUMENT],
    ));
    Ok(())
}

#[tauri::command]
pub fn read_autostart(registration: State<'_, AutoLaunch>) -> Result<bool, String> {
    registration.is_enabled().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_autostart(registration: State<'_, AutoLaunch>, enabled: bool) -> Result<bool, String> {
    let previous = registration
        .is_enabled()
        .map_err(|error| error.to_string())?;
    let result = if enabled {
        registration.enable()
    } else {
        registration.disable()
    };
    if let Err(error) = result {
        // Enabling can write Run before an error on StartupApproved. Restore
        // the previous OS state on a partial failure, without storing a copy.
        let rollback = if previous {
            registration.enable()
        } else {
            registration.disable()
        };
        return Err(match rollback {
            Ok(()) => error.to_string(),
            Err(rollback) => format!("{error}; rollback failed: {rollback}"),
        });
    }
    registration.is_enabled().map_err(|error| error.to_string())
}
