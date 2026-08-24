// Kelionai desktop rulează exclusiv bundle-ul compilat în aplicație. Backendul
// first-party este accesat prin HTTPS, iar autentificarea se deschide în
// browserul implicit și revine prin schema OS înregistrată `kelionai://`.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Manager, Runtime,
};

const SECURE_SERVICE: &str = env!("CARGO_PKG_NAME");

fn secure_account(kind: &str) -> Result<&'static str, String> {
    match kind {
        "install-id" => Ok("native-install-id-v1"),
        "access-token" => Ok("native-access-token-v1"),
        "pending-auth" => Ok("native-pending-auth-v1"),
        "pending-revocation" => Ok("native-pending-revocation-v1"),
        _ => Err("secure_kind_invalid".into()),
    }
}

fn secure_entry(kind: &str) -> Result<keyring::v1::Entry, String> {
    let account = secure_account(kind)?;
    keyring::v1::Entry::new(SECURE_SERVICE, account).map_err(|_| "secure_store_unavailable".into())
}

#[tauri::command]
fn native_secure_get(kind: String) -> Result<Option<String>, String> {
    match secure_entry(&kind)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::v1::Error::NoEntry) => Ok(None),
        Err(_) => Err("secure_store_read_failed".into()),
    }
}

#[tauri::command]
fn native_secure_set(kind: String, value: String) -> Result<(), String> {
    if value.is_empty() || value.len() > 8_192 || value.chars().any(char::is_control) {
        return Err("secure_value_invalid".into());
    }
    secure_entry(&kind)?
        .set_password(&value)
        .map_err(|_| "secure_store_write_failed".into())
}

#[tauri::command]
fn native_secure_delete(kind: String) -> Result<(), String> {
    match secure_entry(&kind)?.delete_credential() {
        Ok(()) | Err(keyring::v1::Error::NoEntry) => Ok(()),
        Err(_) => Err("secure_store_delete_failed".into()),
    }
}

fn navigation_guard<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("local-navigation-only")
        .on_navigation(|_webview, url| {
            // Tauri folosește `tauri://localhost` pe macOS/Linux și
            // `http(s)://tauri.localhost` pe Windows. Nicio pagină HTTPS
            // externă nu devine document top-level în WebView.
            (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                || ((url.scheme() == "http" || url.scheme() == "https")
                    && url.host_str() == Some("tauri.localhost"))
        })
        .build()
}

fn main() {
    tauri::Builder::default()
        // Trebuie primul: callbackul OAuth ajuns într-o a doua instanță este
        // transmis instanței existente de pluginul deep-link.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(navigation_guard())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            native_secure_get,
            native_secure_set,
            native_secure_delete
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Kelionai");
}
