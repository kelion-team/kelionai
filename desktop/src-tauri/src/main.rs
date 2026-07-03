// Kelionai desktop — a thin native window around the LIVE app at kelionai.app.
// The web app is the single source of truth: every deploy reaches the desktop
// instantly, no reinstall. The SHELL itself (this window) self-updates too: on
// every launch it checks kelionai.app/downloads/desktop-update.json, and a new
// signed shell installs silently — everyone who ever downloaded the .exe stays
// permanently up to date.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_updater::UpdaterExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Best-effort: any failure (offline, no update) is silently
                // ignored — the app itself always works regardless.
                if let Ok(updater) = handle.updater() {
                    if let Ok(Some(update)) = updater.check().await {
                        if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
                            handle.restart();
                        }
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start Kelionai");
}
