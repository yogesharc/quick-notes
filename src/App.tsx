import { useEffect, useState } from "react";
import { ArrowLeftIcon, PlusIcon } from "@heroicons/react/24/outline";
import { useNotes } from "./hooks/useNotes";
import Note from "./components/Note";
import NoteRow from "./components/NoteRow";
import ConfirmDialog from "./components/ConfirmDialog";
import Shortcut from "./components/Shortcut";
import { preview } from "./lib/format";
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
  const pendingNote = notes.find((n) => n.id === pendingDeleteId) ?? null;

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
      <header className="topbar" data-tauri-drag-region>
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
              onOpen={() => getNote(item.id)}
              onDelete={() => setPendingDeleteId(item.id)}
            />
          ))}
        </div>
      )}

      {pendingNote && (
        <ConfirmDialog
          title="Delete note?"
          description={`“${preview(pendingNote.contents)}” will be permanently deleted.`}
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={() => {
            deleteNote(pendingNote.id);
            setPendingDeleteId(null);
          }}
        />
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
}

export default App;
