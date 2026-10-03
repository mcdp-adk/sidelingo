//! Protects secrets for the current Windows user without prompting.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::env;
use tauri::State;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

/// The four named Provider keys inherited when this app process starts.
#[derive(Clone, Serialize)]
pub struct KeyEnvironmentSnapshot {
    #[serde(rename = "OPENAI_API_KEY")]
    openai_api_key: Option<String>,
    #[serde(rename = "OPENROUTER_API_KEY")]
    openrouter_api_key: Option<String>,
    #[serde(rename = "DEEPSEEK_API_KEY")]
    deepseek_api_key: Option<String>,
    #[serde(rename = "OLLAMA_API_KEY")]
    ollama_api_key: Option<String>,
}

impl KeyEnvironmentSnapshot {
    pub fn capture() -> Self {
        Self {
            openai_api_key: env::var("OPENAI_API_KEY")
                .ok()
                .filter(|value| !value.is_empty()),
            openrouter_api_key: env::var("OPENROUTER_API_KEY")
                .ok()
                .filter(|value| !value.is_empty()),
            deepseek_api_key: env::var("DEEPSEEK_API_KEY")
                .ok()
                .filter(|value| !value.is_empty()),
            ollama_api_key: env::var("OLLAMA_API_KEY")
                .ok()
                .filter(|value| !value.is_empty()),
        }
    }
}

/// Returns only the fixed environment-key snapshot captured when the app started.
#[tauri::command]
pub fn read_key_environment(snapshot: State<'_, KeyEnvironmentSnapshot>) -> KeyEnvironmentSnapshot {
    snapshot.inner().clone()
}

fn input_blob(bytes: &[u8]) -> Result<CRYPT_INTEGER_BLOB, String> {
    Ok(CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(bytes.len()).map_err(|_| "The secret is too large")?,
        pbData: bytes.as_ptr().cast_mut(),
    })
}

/// Copies and releases the buffer Windows allocated after a successful DPAPI call.
unsafe fn take_output(output: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    let bytes = if output.cbData == 0 {
        Vec::new()
    } else {
        std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
    };
    let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
    bytes
}

#[tauri::command]
pub fn protect_secret(secret: String) -> Result<String, String> {
    let input = input_blob(secret.as_bytes())?;
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| error.to_string())?;
        Ok(STANDARD.encode(take_output(output)))
    }
}

/// Corrupted data, another user's data, and non-UTF-8 data all count as missing.
#[tauri::command]
pub fn unprotect_secret(ciphertext: String) -> Result<Option<String>, String> {
    let Ok(bytes) = STANDARD.decode(ciphertext) else {
        return Ok(None);
    };
    let input = input_blob(&bytes)?;
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        if CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .is_err()
        {
            return Ok(None);
        }
        Ok(String::from_utf8(take_output(output)).ok())
    }
}
