use crate::store::Note;
use tauri::AppHandle;

mod store;

#[tauri::command]
fn new_note(app: AppHandle) -> Result<Note, String> {
    store::new_note(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_note(id: String, app: AppHandle) -> Result<Note, String> {
    store::get_note(id, &app).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_note(id: String, contents: String, app: AppHandle) -> Result<(), String> {
    store::update_note(id, contents, &app).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_notes(app: AppHandle) -> Result<Vec<Note>, String> {
    store::list_notes(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_note(id: String, app: AppHandle) -> Result<(), String> {
    store::delete_note(&id, &app).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            new_note,
            get_note,
            update_note,
            list_notes,
            delete_note
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
