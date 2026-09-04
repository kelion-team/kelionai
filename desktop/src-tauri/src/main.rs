// Kelionai desktop rulează exclusiv bundle-ul compilat în aplicație.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod shell;

fn main() {
    shell::run();
}
