use std::{fs, path::PathBuf};

use anyhow::{Context, Ok, Result};
use chrono::{DateTime, Local};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Serialize)]
pub struct Note {
    id: String,
    contents: String,
    modified: DateTime<Local>,
}

fn get_app_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_data_dir()
        .context("could not get app data dir")
}

fn get_notes_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = get_app_dir(app)?.join("notes");
    fs::create_dir_all(&dir)?;

    Ok(dir)
}

fn build_file_path(id: &str, app: &AppHandle) -> Result<PathBuf> {
    let notes_dir = get_notes_dir(app)?;
    let path = notes_dir.join(id).with_extension("md");

    Ok(path)
}

pub fn new_note(app: &AppHandle) -> Result<Note> {
    let id = Uuid::new_v4().to_string();
    let path = build_file_path(&id, app)?;
    let contents = String::new();

    fs::write(path, &contents)?;

    Ok(Note {
        id,
        contents,
        modified: Local::now(),
    })
}

pub fn get_note(id: String, app: &AppHandle) -> Result<Note> {
    let path = build_file_path(&id, app)?;
    let contents = fs::read_to_string(&path)?;
    let modified = DateTime::<Local>::from(fs::metadata(&path)?.modified()?);

    Ok(Note {
        id,
        contents,
        modified,
    })
}

pub fn update_note(id: String, contents: String, app: &AppHandle) -> Result<()> {
    let path = build_file_path(&id, app)?;
    fs::write(path, contents)?;
    Ok(())
}

pub fn list_notes(app: &AppHandle) -> Result<Vec<Note>> {
    let dir = get_notes_dir(app)?;
    let mut notes: Vec<Note> = Vec::new();

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            match &path.extension().and_then(|e| e.to_str()) {
                Some(ext) => {
                    if *ext != "md" {
                        continue;
                    }
                }
                None => continue,
            }

            let mut contents = fs::read_to_string(&path)?;
            if let Some((idx, _)) = contents.char_indices().nth(60) {
                contents.truncate(idx);
            }
            let modified = DateTime::<Local>::from(entry.metadata()?.modified()?);
            let id;

            match path.file_stem().and_then(|n| n.to_str()) {
                Some(name) => id = name.to_string(),
                None => continue,
            }

            notes.push(Note {
                id,
                contents,
                modified,
            });
        }
    }

    notes.sort_by(|a, b| b.modified.cmp(&a.modified));

    Ok(notes)
}

pub fn delete_note(id: &str, app: &AppHandle) -> Result<()> {
    let path = build_file_path(id, app)?;
    fs::remove_file(path)?;

    Ok(())
}
