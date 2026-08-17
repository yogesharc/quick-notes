//! In-app updates over the Tauri updater plugin.
//!
//! The manifest lives at the repo's latest GitHub release, so shipping is just
//! publishing one — see `scripts/release.sh`. The endpoint is configured in
//! `tauri.conf.json`; nothing here needs to know the URL.

use std::sync::Mutex;

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

/// Checks the manifest and, when something newer is there, downloads it in the
/// background and emits `update_status`. The returned `Ok(())` only means the
/// run finished, not that anything was found.
///
/// A failed check is not an error the user should see — no network is the
/// common case — so the caller logs and moves on.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<(), String> {
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

    if let Err(e) = app.emit("update_status", UpdateStatus::Ready { version }) {
        eprintln!("[update status emit err] {e}");
    }

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
    // only ever error: the frontend stops checking once an update is ready, so
    // nothing would download a replacement.
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
