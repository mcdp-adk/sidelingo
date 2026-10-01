//! Follows the clipboard while the Pin window is visible.
//!
//! A hidden message window on its own thread listens for clipboard changes,
//! and every Input reaches the front end from that thread, so a `show` and the
//! copies around it arrive in the order they happened.

use std::collections::BTreeMap;
use std::io::Cursor;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{codecs::bmp::BmpDecoder, imageops::FilterType, DynamicImage, ImageFormat};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Webview, Window};
use windows::core::w;
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::DataExchange::{
    AddClipboardFormatListener, CloseClipboard, EmptyClipboard, GetClipboardData,
    GetClipboardOwner, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW,
    RemoveClipboardFormatListener, SetClipboardData,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};
use windows::Win32::System::Ole::{CF_DIB, CF_DIBV5, CF_UNICODETEXT};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetWindowThreadProcessId,
    KillTimer, PostMessageW, RegisterClassW, SetTimer, HWND_MESSAGE, MSG, WINDOW_EX_STYLE,
    WINDOW_STYLE, WM_APP, WM_CLIPBOARDUPDATE, WM_TIMER, WNDCLASSW,
};

/// Carries an Input to the front end.
const INPUT: &str = "input";
/// Clipboard notifications this close together are one copy.
const COALESCE_MS: u32 = 200;
const COALESCE_TIMER: usize = 1;
/// How long a clipboard held by another program is waited for.
const OPEN_RETRY: Duration = Duration::from_millis(500);
const OPEN_RETRY_INTERVAL: Duration = Duration::from_millis(20);
/// Bounds image payloads while preserving the copied image's aspect ratio.
const MAX_IMAGE_EDGE: u32 = 2048;
const WM_SHOWN: u32 = WM_APP;
const WM_HIDDEN: u32 = WM_APP + 1;

static APP: OnceLock<AppHandle> = OnceLock::new();
/// The message window's handle; HWND itself can't cross threads.
static WINDOW: AtomicIsize = AtomicIsize::new(0);
/// WebView2 writes selection copies in its browser process, rather than the app process.
static BROWSER_PROCESSES: Mutex<BTreeMap<String, u32>> = Mutex::new(BTreeMap::new());

pub fn webview_loaded(webview: &Webview) {
    let label = webview.label().to_owned();
    if let Err(error) = webview.with_webview(move |view| {
        let result = unsafe { view.controller().CoreWebView2() }.and_then(|browser| {
            let mut id = 0;
            unsafe { browser.BrowserProcessId(&mut id) }?;
            Ok(id)
        });
        match result {
            Ok(id) => {
                if let Ok(mut processes) = BROWSER_PROCESSES.lock() {
                    processes.insert(label, id);
                }
            }
            Err(error) => eprintln!("failed to identify WebView2's clipboard process: {error}"),
        }
    }) {
        eprintln!("failed to reach the native WebView2: {error}");
    }
}

pub fn webview_closed(label: &str) {
    if let Ok(mut processes) = BROWSER_PROCESSES.lock() {
        processes.remove(label);
    }
}

/// Writes Markdown as Unicode plain text, with a window in the app owning the copy.
#[tauri::command]
pub fn copy_text(window: Window, text: String) -> Result<(), String> {
    if text.contains('\0') {
        return Err("Clipboard text cannot contain a null character".into());
    }
    let units: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
    let global = unsafe { GlobalAlloc(GMEM_MOVEABLE, units.len() * std::mem::size_of::<u16>()) }
        .map_err(|error| error.to_string())?;
    let data = unsafe { GlobalLock(global) } as *mut u16;
    if data.is_null() {
        let _ = unsafe { GlobalFree(Some(global)) };
        return Err("Cannot access the clipboard buffer".into());
    }
    unsafe { std::ptr::copy_nonoverlapping(units.as_ptr(), data, units.len()) };
    let _ = unsafe { GlobalUnlock(global) };
    let opened = window
        .hwnd()
        .map_err(|error| error.to_string())
        .and_then(|hwnd| open(hwnd).ok_or_else(|| "The clipboard is busy".into()));
    if let Err(error) = opened {
        let _ = unsafe { GlobalFree(Some(global)) };
        return Err(error);
    }
    let result = unsafe {
        EmptyClipboard()
            .and_then(|_| SetClipboardData(CF_UNICODETEXT.0.into(), Some(HANDLE(global.0))))
    };
    let _ = unsafe { CloseClipboard() };
    if result.is_err() {
        let _ = unsafe { GlobalFree(Some(global)) };
    }
    result.map(|_| ()).map_err(|error| error.to_string())
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Input {
    Text {
        text: String,
    },
    Image {
        #[serde(rename = "dataUrl")]
        data_url: String,
    },
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

/// Usable text wins over a bitmap, as in copies from Word and Excel.
fn read(hwnd: HWND) -> Option<Input> {
    open(hwnd)?;
    if unsafe { is_own_copy() || is_excluded() } {
        let _ = unsafe { CloseClipboard() };
        return None;
    }
    let text = unsafe { read_text() }.filter(|text| !text.trim().is_empty());
    let dib = if text.is_none() {
        unsafe { read_bitmap() }
    } else {
        None
    };
    let _ = unsafe { CloseClipboard() };
    if let Some(text) = text {
        return Some(Input::Text { text });
    }
    // Image work happens after closing the clipboard, so another program can copy meanwhile.
    let decoder = BmpDecoder::new_without_file_header(Cursor::new(dib?)).ok()?;
    let mut image = DynamicImage::from_decoder(decoder).ok()?;
    if image.width().max(image.height()) > MAX_IMAGE_EDGE {
        image = image.resize(MAX_IMAGE_EDGE, MAX_IMAGE_EDGE, FilterType::Triangle);
    }
    let mut png = Cursor::new(Vec::new());
    image.write_to(&mut png, ImageFormat::Png).ok()?;
    Some(Input::Image {
        data_url: format!(
            "data:image/png;base64,{}",
            STANDARD.encode(png.into_inner())
        ),
    })
}

/// Copies a packed DIB while the clipboard is open. Windows can synthesize these formats.
unsafe fn read_bitmap() -> Option<Vec<u8>> {
    // Prefer Windows' synthesized DIB: the codec's V5 bitfields path assumes
    // extra mask bytes after the header, which packed clipboard V5 images omit.
    for format in [CF_DIB, CF_DIBV5] {
        let Ok(handle) = GetClipboardData(format.0.into()) else {
            continue;
        };
        let global = HGLOBAL(handle.0);
        let data = GlobalLock(global) as *const u8;
        if data.is_null() {
            continue;
        }
        let bytes = std::slice::from_raw_parts(data, GlobalSize(global)).to_vec();
        let _ = GlobalUnlock(global);
        return Some(bytes);
    }
    None
}

unsafe fn is_own_copy() -> bool {
    let Ok(owner) = GetClipboardOwner() else {
        return false;
    };
    let mut process = 0;
    GetWindowThreadProcessId(owner, Some(&mut process));
    process == std::process::id()
        || BROWSER_PROCESSES
            .lock()
            .is_ok_and(|processes| processes.values().any(|id| *id == process))
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
