import { useEffect, useState } from "react";
import { ArrowLeftIcon, PlusIcon } from "@heroicons/react/24/outline";
import { useNotes } from "./hooks/useNotes";
import Note from "./components/Note";
import NoteRow from "./components/NoteRow";
import Shortcut from "./components/Shortcut";
import "./App.css";

function App() {
  const {
    notes,
    selectedNoteId,
    error,
    selectedNote,
    newNote,
    deleteNote,
    getNote,
    goBack,
    contents,
    setContents,
  } = useNotes();

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Esc, or a click anywhere outside the row, backs out of a pending delete.
  useEffect(() => {
    if (!pendingDeleteId) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setPendingDeleteId(null);
      }
    }

    function onMouseDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".row-confirming")) {
        setPendingDeleteId(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [pendingDeleteId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.repeat) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        newNote();
        return;
      }

      if (key === "b") {
        event.preventDefault();
        goBack();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newNote, goBack]);

  return (
    <main className="app">
      <header className="topbar" data-tauri-drag-region="deep">
        {selectedNoteId ? (
          <>
          <Shortcut letter="B" />
          <button type="button" className="btn" onClick={goBack}>
            <ArrowLeftIcon />
          </button>
          </>
        ) : (
          <>
            <Shortcut letter="N" />
            <button type="button" className="btn" onClick={newNote}>
              <PlusIcon />
            </button>
            </>
        )}
      </header>

      {selectedNoteId ? (
        selectedNote && <Note contents={contents} onChange={setContents} />
      ) : notes.length === 0 ? (
        <div className="empty">
          <p>No notes yet</p>
          <p className="empty-hint">
            Press <Shortcut letter="N" /> to start one
          </p>
        </div>
      ) : (
        <div className="list">
          {notes.map((item) => (
            <NoteRow
              key={item.id}
              note={item}
              confirming={pendingDeleteId === item.id}
              onOpen={() => getNote(item.id)}
              onDelete={() => setPendingDeleteId(item.id)}
              onCancelDelete={() => setPendingDeleteId(null)}
              onConfirmDelete={() => {
                deleteNote(item.id);
                setPendingDeleteId(null);
              }}
            />
          ))}
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
}

export default App;
