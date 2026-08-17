use crate::store::Note;
use tauri::AppHandle;

mod store;
mod updater;

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

/// `alwaysOnTop` only floats the window within its own Space. Joining every
/// Space (including other apps' full-screen ones) needs the collection
/// behavior, and staying visible there needs a level above the app's own.
#[cfg(target_os = "macos")]
fn float_above_fullscreen(window: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

    // Status level (25) sits below the layer macOS composites another app's
    // full-screen space into, so the window is there but covered. Pop-up menu
    // level is the lowest one that draws over it — the same level Spotlight and
    // Raycast use for exactly this.
    const NS_POPUP_MENU_WINDOW_LEVEL: isize = 101;

    let ns_window = unsafe { &*(window.ns_window()? as *mut NSWindow) };
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::Stationary,
    );
    ns_window.setLevel(NS_POPUP_MENU_WINDOW_LEVEL);

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                // Activating a Regular (Dock) app makes macOS switch to a Space
                // that owns its windows, kicking the user out of full-screen.
                // Accessory apps activate in place, so the overlay stays put.
                _app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                if let Some(window) = _app.get_webview_window("main") {
                    float_above_fullscreen(&window)?;
                    // An Accessory app is not activated by being launched, so
                    // without this the window arrives unfocused and the first
                    // keystroke goes to whatever was already frontmost.
                    let _ = window.set_focus();
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::PendingUpdate::default())
        .invoke_handler(tauri::generate_handler![
            new_note,
            get_note,
            update_note,
            list_notes,
            delete_note,
            updater::check_update,
            updater::install_update
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
            // Launching an already-running app sends Reopen rather than
            // starting a second copy. Without handling it, opening Quick Notes
            // from a Space where it is already showing looks like nothing
            // happened — the window is there, just behind and unfocused.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                use tauri::Manager;
                if let Some(window) = _app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
