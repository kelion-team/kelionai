// Aplicație separată: controlează aceeași coadă/worker Kelion prin API-ul autentificat.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[path = "../../../desktop/src-tauri/src/shell.rs"]
mod shell;

fn main() {
    shell::run();
}
