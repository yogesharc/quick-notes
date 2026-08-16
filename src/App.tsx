import { useEffect } from "react";
import { useNotes } from "./hooks/useNotes";
import "./App.css";
import Note from "./components/Note";

function preview(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return "Untitled";
  }
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
}

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
    <main className="container">
      {selectedNoteId ? (
        <>
          <button type="button" onClick={goBack} aria-label="Back">
            ←
          </button>
          {selectedNote && (
            <Note contents={contents} onChange={setContents} />
          )}
        </>
      ) : (
        <>
          <button type="button" onClick={newNote}>
            New Note +
          </button>
          <div>
            {notes.map((item) => (
              <div key={item.id} className="row">
                <button type="button" onClick={() => getNote(item.id)}>
                  {preview(item.contents)}
                </button>
                <button
                  type="button"
                  onClick={() => deleteNote(item.id)}
                  aria-label="Delete note"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {error && <p>{error}</p>}
    </main>
  );
}

export default App;
