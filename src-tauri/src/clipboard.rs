//! Follows the clipboard while the Pin window is visible.
//!
//! A hidden message window on its own thread listens for clipboard changes,
//! and every Input reaches the front end from that thread, so a `show` and the
//! copies around it arrive in the order they happened.

use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{mpsc, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::core::w;
use windows::Win32::Foundation::{HGLOBAL, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::DataExchange::{
    AddClipboardFormatListener, CloseClipboard, GetClipboardData, IsClipboardFormatAvailable,
    OpenClipboard, RegisterClipboardFormatW, RemoveClipboardFormatListener,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
use windows::Win32::System::Ole::CF_UNICODETEXT;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, KillTimer, PostMessageW,
    RegisterClassW, SetTimer, HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP,
    WM_CLIPBOARDUPDATE, WM_TIMER, WNDCLASSW,
};

/// Carries an Input to the front end.
const INPUT: &str = "input";
/// Clipboard notifications this close together are one copy.
const COALESCE_MS: u32 = 200;
const COALESCE_TIMER: usize = 1;
/// How long a clipboard held by another program is waited for.
const OPEN_RETRY: Duration = Duration::from_millis(500);
const OPEN_RETRY_INTERVAL: Duration = Duration::from_millis(20);
const WM_SHOWN: u32 = WM_APP;
const WM_HIDDEN: u32 = WM_APP + 1;

static APP: OnceLock<AppHandle> = OnceLock::new();
/// The message window's handle; HWND itself can't cross threads.
static WINDOW: AtomicIsize = AtomicIsize::new(0);

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Input {
    Text { text: String },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "lowercase")]
enum Origin {
    /// An accepted copy while the Pin window is visible.
    Copy,
    /// The Pin window went from hidden to shown.
    Show,
}

#[derive(Clone, Serialize)]
struct InputEvent {
    origin: Origin,
    /// `None` when the clipboard holds nothing usable, which only a `show` carries.
    input: Option<Input>,
}

/// Starts the listener's thread, which stays idle until the Pin window shows.
pub fn start(app: &AppHandle) -> tauri::Result<()> {
    let _ = APP.set(app.clone());
    let (created, window) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = created.send(create_window().map(|hwnd| hwnd.0 as isize));
        let mut message = MSG::default();
        // GetMessageW returns 0 on WM_QUIT and -1 on failure.
        while unsafe { GetMessageW(&mut message, None, 0, 0) }.0 > 0 {
            unsafe { DispatchMessageW(&message) };
        }
    });
    let hwnd = window
        .recv()
        .map_err(|e| tauri::Error::Anyhow(e.into()))?
        .map_err(|e| tauri::Error::Anyhow(e.into()))?;
    WINDOW.store(hwnd, Ordering::SeqCst);
    Ok(())
}

/// Starts following the clipboard and sends its current Input as a `show`.
pub fn shown() {
    post(WM_SHOWN);
}

/// Stops following the clipboard, dropping a copy still being coalesced.
pub fn hidden() {
    post(WM_HIDDEN);
}

fn post(message: u32) {
    let hwnd = HWND(WINDOW.load(Ordering::SeqCst) as *mut _);
    if let Err(error) = unsafe { PostMessageW(Some(hwnd), message, WPARAM(0), LPARAM(0)) } {
        eprintln!("failed to reach the clipboard listener: {error}");
    }
}

fn create_window() -> windows::core::Result<HWND> {
    let instance = unsafe { GetModuleHandleW(None) }?;
    let class = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: instance.into(),
        lpszClassName: w!("sidelingo-clipboard"),
        ..Default::default()
    };
    if unsafe { RegisterClassW(&class) } == 0 {
        return Err(windows::core::Error::from_thread());
    }
    unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class.lpszClassName,
            None,
            WINDOW_STYLE::default(),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(instance.into()),
            None,
        )
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_SHOWN => {
            if let Err(error) = AddClipboardFormatListener(hwnd) {
                eprintln!("failed to follow the clipboard: {error}");
            }
            emit(Origin::Show, read(hwnd));
        }
        WM_HIDDEN => {
            let _ = RemoveClipboardFormatListener(hwnd);
            let _ = KillTimer(Some(hwnd), COALESCE_TIMER);
        }
        // Each notification restarts the timer, so a burst ends in one copy.
        WM_CLIPBOARDUPDATE => {
            SetTimer(Some(hwnd), COALESCE_TIMER, COALESCE_MS, None);
        }
        WM_TIMER if wparam.0 == COALESCE_TIMER => {
            let _ = KillTimer(Some(hwnd), COALESCE_TIMER);
            if let Some(input) = read(hwnd) {
                emit(Origin::Copy, Some(input));
            }
        }
        _ => return DefWindowProcW(hwnd, message, wparam, lparam),
    }
    LRESULT(0)
}

fn emit(origin: Origin, input: Option<Input>) {
    if let Some(app) = APP.get() {
        if let Err(error) = app.emit(INPUT, InputEvent { origin, input }) {
            eprintln!("failed to send an Input: {error}");
        }
    }
}

/// The clipboard's Input: Unicode text that is non-empty after trimming.
fn read(hwnd: HWND) -> Option<Input> {
    open(hwnd)?;
    if unsafe { is_excluded() } {
        let _ = unsafe { CloseClipboard() };
        return None;
    }
    let text = unsafe { read_text() };
    let _ = unsafe { CloseClipboard() };
    text.filter(|text| !text.trim().is_empty())
        .map(|text| Input::Text { text })
}

/// Whether the clipboard owner marked this content private or opted out of history.
unsafe fn is_excluded() -> bool {
    format_is_available(w!("ExcludeClipboardContentFromMonitorProcessing"))
        || format_is_available(w!("Clipboard Viewer Ignore"))
        || clipboard_dword(w!("CanIncludeInClipboardHistory")) == Some(0)
}

unsafe fn format_is_available(name: windows::core::PCWSTR) -> bool {
    let format = RegisterClipboardFormatW(name);
    format != 0 && IsClipboardFormatAvailable(format).is_ok()
}

/// Reads a registered clipboard format containing a serialized DWORD.
unsafe fn clipboard_dword(name: windows::core::PCWSTR) -> Option<u32> {
    let format = RegisterClipboardFormatW(name);
    if format == 0 {
        return None;
    }
    let global = HGLOBAL(GetClipboardData(format).ok()?.0);
    if GlobalSize(global) < std::mem::size_of::<u32>() {
        return None;
    }
    let data = GlobalLock(global) as *const u32;
    if data.is_null() {
        return None;
    }
    let value = data.read_unaligned();
    let _ = GlobalUnlock(global);
    Some(value)
}

/// Opens the clipboard, waiting briefly while another program, such as
/// Windows' clipboard history reading a fresh copy, holds it open.
fn open(hwnd: HWND) -> Option<()> {
    let deadline = Instant::now() + OPEN_RETRY;
    loop {
        if unsafe { OpenClipboard(Some(hwnd)) }.is_ok() {
            return Some(());
        }
        if Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(OPEN_RETRY_INTERVAL);
    }
}

/// The open clipboard's Unicode text, if it holds any.
unsafe fn read_text() -> Option<String> {
    let global = HGLOBAL(GetClipboardData(CF_UNICODETEXT.0.into()).ok()?.0);
    let data = GlobalLock(global) as *const u16;
    if data.is_null() {
        return None;
    }
    let units = std::slice::from_raw_parts(data, GlobalSize(global) / 2);
    let length = units
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(units.len());
    let text = String::from_utf16_lossy(&units[..length]);
    let _ = GlobalUnlock(global);
    Some(text)
}
