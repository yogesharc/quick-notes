import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type Note = {
  id: string;
  contents: string;
  modified: string;
};

const SELECTED_NOTE_KEY = "selected_note_id";

function isEmpty(contents: string) {
  return contents.trim() === "";
}

function persistSelectedNoteId(id: string | null) {
  if (id) {
    localStorage.setItem(SELECTED_NOTE_KEY, id);
  } else {
    localStorage.removeItem(SELECTED_NOTE_KEY);
  }
}

function getSelectedNoteId(): string | null {
  return localStorage.getItem(SELECTED_NOTE_KEY);
}

export function useNotes() {
  const [notes, setNotes] = useState<Array<Note>>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [contents, setContents] = useState("");
  const [error, setError] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [booted, setBooted] = useState(false);


  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;

  function selectNote(id: string | null, nextContents = "") {
    setSelectedNoteId(id);
    setContents(nextContents);
    persistSelectedNoteId(id);
  }

  async function newNote() {
    try {
      if (selectedNoteId) {
        if (isEmpty(contents)) {
          return;
        }
        await updateNote(selectedNoteId, contents);
      }

      const note = await invoke<Note>("new_note");
      setNotes((prev) => [note, ...prev]);
      selectNote(note.id, "");
      setError("");
    } catch {
      setError("Failed to create new note");
    }
  }

  async function updateNote(id: string, nextContents: string) {
    try {
      await invoke("update_note", { id, contents: nextContents });
      const modified = new Date().toISOString();
      setNotes((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, contents: nextContents, modified } : n,
        ),
      );
      setError("");
    } catch {
      setError("Failed to update note");
    }
  }

  async function deleteNote(id: string) {
    try {
      await invoke("delete_note", { id });
      setNotes((prev) => prev.filter((n) => n.id !== id));
      if (selectedNoteId === id) {
        selectNote(null);
      }
      setError("");
    } catch {
      setError(`Failed to delete note: ${id}`);
    }
  }

  async function getNote(id: string) {
    try {
      const note = await invoke<Note>("get_note", { id });
      setNotes((prev) =>
        prev.some((n) => n.id === note.id)
          ? prev.map((n) => (n.id === note.id ? note : n))
          : [note, ...prev],
      );
      selectNote(note.id, note.contents);
      setError("");
    } catch {
      persistSelectedNoteId(null);
      setError(`Failed to get note: ${id}`);
    }
  }

  async function listNotes() {
    try {
      const listed = await invoke<Array<Note>>("list_notes");
      setNotes(listed);
      setError("");
      return listed;
    } catch {
      setError("Failed to list notes");
      return null;
    }
  }

  async function goBack() {
    if (!selectedNoteId) {
      return;
    }

    if (isEmpty(contents)) {
      await deleteNote(selectedNoteId);
      return;
    }

    await updateNote(selectedNoteId, contents);
    selectNote(null);
  }

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const listed = await listNotes();
      if (cancelled) {
        return;
      }

      const savedId = listed && getSelectedNoteId();
      if (savedId) {
        if (listed.some((n) => n.id === savedId)) {
          await getNote(savedId);
        } else {
          persistSelectedNoteId(null);
        }
      }

      if (!cancelled) {
        setBooted(true);
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedNoteId) {
      return;
    }

    const timeoutId = setTimeout(() => {
      updateNote(selectedNoteId, contents);
    }, 400);

    return () => clearTimeout(timeoutId);
  }, [contents, selectedNoteId]);

  const visibleNotes = useMemo(() => {
    return searchKeyword ? notes.filter((n) => n.contents.includes(searchKeyword)) : notes
  }, [searchKeyword, notes])

  return {
    booted,
    selectedNoteId,
    error,
    selectedNote,
    newNote,
    deleteNote,
    getNote,
    goBack,
    contents,
    setContents,
    searchKeyword,
    setSearchKeyword,
    visibleNotes
  };
}
