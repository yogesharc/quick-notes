//! In-app updates over the Tauri updater plugin.
//!
//! The manifest lives at the repo's latest GitHub release, so shipping is just
//! publishing one — see `scripts/release.sh`. The endpoint is configured in
//! `tauri.conf.json`; nothing here needs to know the URL.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// What the footer draws. There is no idle variant: nothing is emitted until an
/// update exists, so the frontend's own `null` is the resting state and a
/// failed check leaves the UI exactly as it was.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum UpdateStatus {
    Ready { version: String },
}

/// The downloaded bundle, held between the background download and the user
/// pressing install. Kept in memory rather than spooled to a temp file: a file
/// would need its own cleanup on every path where the user never installs.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<(Update, Vec<u8>)>>);

/// Longest the app goes between background checks.
const CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// How often the background loop wakes to see whether that interval has passed.
/// Short relative to the interval because a sleeping laptop stretches both:
/// `Instant` doesn't tick while the machine is asleep and a `sleep` that long
/// gets coalesced, so polling keeps the deadline roughly honest either way.
const POLL_INTERVAL: Duration = Duration::from_secs(60 * 60);

// Process-global rather than app state: there is exactly one app, and threading
// a field through `manage` for one reader buys nothing.
// ponytail: static, move into app state if a second window ever checks.
static LAST_CHECK: Mutex<Option<Instant>> = Mutex::new(None);

/// Runs a check unless one ran within `CHECK_INTERVAL`.
///
/// Called on every reveal and from the background loop. Reveal matters because
/// process launch no longer does: ⌘W and ⌘Q only hide the window, so the app
/// can run for weeks without ever starting up again, and ordering the window in
/// is both the closest thing left to "app open" and the only moment the install
/// bar could be seen. The loop covers the opposite case, a window left open for
/// days that is never re-revealed.
pub fn check_in_background(app: &AppHandle) {
    {
        let Ok(mut last) = LAST_CHECK.lock() else {
            return;
        };
        if last.is_some_and(|t| t.elapsed() < CHECK_INTERVAL) {
            return;
        }
        *last = Some(Instant::now());
    }

    spawn_check(app.clone());
}

/// Drives `check_in_background` on a timer.
///
/// A Rust thread rather than a `setInterval` in the webview: a hidden window's
/// JS is throttled hard and the whole Accessory app is App Nap's to suspend, so
/// a long interval in there can be deferred indefinitely. This thread can be
/// delayed by the same power management, hence the short poll against a
/// wall-clock deadline instead of one long sleep.
pub fn start_check_loop(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL_INTERVAL);
        check_in_background(&app);
    });
}

fn spawn_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = check(app).await {
            // No network is the common case and nothing the user could act on,
            // so it stays in the log.
            eprintln!("[update check] {e}");
        }
    });
}

fn emit(app: &AppHandle, status: UpdateStatus) {
    if let Err(e) = app.emit("update_status", status) {
        eprintln!("[update status emit err] {e}");
    }
}

/// Checks the manifest and, when something newer is there, downloads it in the
/// background and emits `update_status`. The returned `Ok(())` only means the
/// run finished, not that anything was found.
async fn check(app: AppHandle) -> Result<(), String> {
    // A downloaded bundle is the end of the road until the app restarts, so
    // there is nothing to do until it's installed.
    if app
        .state::<PendingUpdate>()
        .0
        .lock()
        .map_err(|_| "pending update lock poisoned".to_string())?
        .is_some()
    {
        return Ok(());
    }

    let updater = app.updater().map_err(|e| e.to_string())?;

    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(());
    };

    let version = update.version.clone();
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    app.state::<PendingUpdate>()
        .0
        .lock()
        .map_err(|_| "pending update lock poisoned".to_string())?
        .replace((update, bytes));

    emit(&app, UpdateStatus::Ready { version });

    Ok(())
}

/// Swaps in the bundle already downloaded and relaunches.
///
/// Never returns on success — `restart` diverges — so the caller's `invoke`
/// resolving at all means the install failed.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    // Cloned rather than taken, so a failed install leaves the bundle in place
    // to be retried. Taking it would strand the footer on a button that can
    // only ever error: checks return early once a bundle is pending, so nothing
    // would download a replacement.
    let pending = app
        .state::<PendingUpdate>()
        .0
        .lock()
        .map_err(|_| "pending update lock poisoned".to_string())?
        .clone();

    let Some((update, bytes)) = pending else {
        return Err("no update has been downloaded".into());
    };

    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart();
}
