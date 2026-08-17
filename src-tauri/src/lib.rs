use crate::store::Note;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, State};

mod store;
mod updater;

/// Set once the window has been ordered in, so the frontend's ready signal and
/// the fallback timer can't both reveal it.
#[derive(Default)]
struct Revealed(AtomicBool);

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

/// Orders the window in without making it key first. The distinction matters:
/// `show()`/`set_focus()` go through `makeKeyAndOrderFront`, and when a
/// background app calls that while another app's full-screen Space is active,
/// the window server banishes the window to the Desktop Space and pins it
/// there for the window's lifetime — `CanJoinAllSpaces` is ignored from then
/// on and no amount of re-showing rebinds it. `orderFrontRegardless` as the
/// window's first ordering honors the collection behavior.
#[cfg(target_os = "macos")]
fn show_overlay(window: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSWindow};

    float_above_fullscreen(window)?;
    let ns_window = unsafe { &*(window.ns_window()? as *mut NSWindow) };
    ns_window.orderFrontRegardless();

    // Focus without reordering: tao's set_focus() is makeKeyAndOrderFront,
    // which would re-punt the window (see above). makeKeyWindow only takes
    // key status; the activation is what lets an Accessory app type-focus at
    // all, and it activates in place without a Space switch.
    let mtm = MainThreadMarker::new().ok_or("show_overlay called off the main thread")?;
    let app = NSApplication::sharedApplication(mtm);
    #[allow(deprecated)]
    app.activateIgnoringOtherApps(true);
    ns_window.makeKeyWindow();
    Ok(())
}

fn reveal(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    #[cfg(target_os = "macos")]
    if let Err(e) = show_overlay(&window) {
        eprintln!("[show_overlay] {e}");
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The window is built hidden: showing it before the webview has painted gives
/// an empty pane for a few frames. The frontend calls this once its first real
/// frame is on screen.
#[tauri::command]
fn ready_to_show(app: AppHandle, revealed: State<Revealed>) {
    if revealed.0.swap(true, Ordering::SeqCst) {
        return;
    }
    reveal(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            // Activating a Regular (Dock) app makes macOS switch to a Space
            // that owns its windows, kicking the user out of full-screen.
            // Accessory apps activate in place, so the overlay stays put.
            #[cfg(target_os = "macos")]
            _app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::PendingUpdate::default())
        .manage(Revealed::default())
        .invoke_handler(tauri::generate_handler![
            ready_to_show,
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
            #[cfg(target_os = "macos")]
            {
                match _event {
                    // The main window is NOT in tauri.conf.json: config
                    // windows are created during app launch, and a window
                    // created that early gets pinned to the Desktop Space by
                    // the window server for its whole lifetime —
                    // CanJoinAllSpaces set later is ignored, so the overlay
                    // never appears over other Spaces or full-screen apps.
                    // Windows created after launch bind to every Space
                    // correctly, so the window is built here instead.
                    tauri::RunEvent::Ready => {
                        let window = tauri::WebviewWindowBuilder::new(
                            _app,
                            "main",
                            tauri::WebviewUrl::App("index.html".into()),
                        )
                        .title("Quick Notes")
                        .inner_size(400.0, 560.0)
                        .min_inner_size(320.0, 280.0)
                        .minimizable(false)
                        .maximizable(false)
                        .transparent(true)
                        .hidden_title(true)
                        .title_bar_style(tauri::TitleBarStyle::Overlay)
                        .effects(tauri::utils::config::WindowEffectsConfig {
                            effects: vec![tauri::utils::WindowEffect::Sidebar],
                            state: Some(
                                tauri::utils::WindowEffectState::FollowsWindowActiveState,
                            ),
                            radius: Some(12.0),
                            color: None,
                        })
                        .always_on_top(true)
                        .visible(false)
                        .build();
                        match window {
                            // Nothing shows the window here — the frontend
                            // calls ready_to_show once it has painted. This
                            // timer is only a backstop for a frontend that
                            // never boots, so the app can't end up running
                            // with no visible window at all.
                            Ok(_) => {
                                let handle = _app.clone();
                                std::thread::spawn(move || {
                                    std::thread::sleep(
                                        std::time::Duration::from_millis(3000),
                                    );
                                    let _ = handle.clone().run_on_main_thread(move || {
                                        if !handle
                                            .state::<Revealed>()
                                            .0
                                            .swap(true, Ordering::SeqCst)
                                        {
                                            eprintln!("[reveal] frontend never signalled");
                                            reveal(&handle);
                                        }
                                    });
                                });
                            }
                            Err(e) => eprintln!("[window build] {e}"),
                        }
                    }
                    // Launching an already-running app sends Reopen rather
                    // than starting a second copy. Without handling it,
                    // opening Quick Notes looks like nothing happened — the
                    // window is there, just behind and unfocused.
                    tauri::RunEvent::Reopen { .. } => reveal(_app),
                    _ => {}
                }
            }
        });
}
