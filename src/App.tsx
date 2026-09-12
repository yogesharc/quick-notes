import { useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, PlusIcon } from "@heroicons/react/24/outline";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useNotes } from "./hooks/useNotes";
import { useReadyToShow } from "./hooks/useReadyToShow";
import { useUpdater } from "./hooks/useUpdater";
import Note from "./components/Note";
import NoteRow from "./components/NoteRow";
import Shortcut from "./components/Shortcut";
import UpdateBar from "./components/UpdateBar";
import "./App.css";

/// The traffic lights are hidden while the pointer is outside the window, so
/// the app reads as a plain floating panel until you reach for it.
const showTrafficLights = (visible: boolean) => {
  void invoke("set_traffic_lights", { visible }).catch(() => {});
};

function App() {
  const {
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
  } = useNotes();

  const { updateVersion, install } = useUpdater();

  useReadyToShow(booted);

  // Tracked off the native window, not the DOM: this is an accessory app that
  // takes key status without a normal activation, so window blur/focus events
  // don't line up with what the title bar is actually showing.
  const [focused, setFocused] = useState(true);
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload }) =>
      setFocused(payload),
    );
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Keyboard highlight in the list. Clamped rather than reset, so a note
  // disappearing (delete, or a narrowing search) can't strand it past the end.
  const [highlight, setHighlight] = useState(0);
  const activeIndex = Math.min(highlight, visibleNotes.length - 1);

  useEffect(() => setHighlight(0), [searchKeyword]);

  // On window, not the list: the search input holds focus while you arrow
  // through results, and arrow keys would otherwise just move its caret.
  useEffect(() => {
    if (selectedNoteId || pendingDeleteId || visibleNotes.length === 0) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Enter") {
        event.preventDefault();
        getNote(visibleNotes[activeIndex].id);
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }

      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight(
        Math.min(Math.max(activeIndex + step, 0), visibleNotes.length - 1),
      );
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNoteId, pendingDeleteId, visibleNotes, activeIndex]);

  useEffect(() => {
    document
      .querySelector('.row[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Arrowing scrolls rows under a stationary cursor, and the browser reports
  // that as a hover. Only a pointer that actually changed position counts.
  const pointer = useRef({ x: -1, y: -1 });
  function hover(index: number, event: { clientX: number; clientY: number }) {
    if (event.clientX === pointer.current.x && event.clientY === pointer.current.y) {
      return;
    }
    pointer.current = { x: event.clientX, y: event.clientY };
    setHighlight(index);
  }

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
    <main className="app" data-focused={focused}>
      <header
        className="topbar"
        data-tauri-drag-region="deep"
        onMouseEnter={() => showTrafficLights(true)}
        onMouseLeave={() => showTrafficLights(false)}
      >
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

      {!selectedNoteId &&
      <input
        className="search"
        type="text"
        placeholder="Search for notes..."
        value={searchKeyword}
        onChange={(e) => setSearchKeyword(e.target.value)}
        autoFocus={true}
      />
      }

      {selectedNoteId ? (
        selectedNote && <Note contents={contents} onChange={setContents} />
      ) : visibleNotes.length === 0 ? (
        <div className="empty">
          {!searchKeyword ? 
          <>
          <p>No notes yet</p>
          <p className="empty-hint">
            Press <Shortcut letter="N" /> to start one
          </p>
          </>
          : <p>No matches found</p>
}
        </div>
      ) : (
        <div className="list">
          {visibleNotes.map((item, index) => (
            <NoteRow
              key={item.id}
              note={item}
              active={index === activeIndex}
              onHover={(event) => hover(index, event)}
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

      {updateVersion && <UpdateBar version={updateVersion} onInstall={install} />}

      {error && <p className="error">{error}</p>}
    </main>
  );
}

export default App;
