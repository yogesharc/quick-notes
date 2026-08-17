import { TrashIcon } from "@heroicons/react/24/outline";
import type { Note } from "../hooks/useNotes";
import { preview, relativeTime } from "../lib/format";

export default function NoteRow({
  note,
  onOpen,
  onDelete,
}: {
  note: Note;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="row">
      <button type="button" className="row-open" onClick={onOpen}>
        <span className="row-title">{preview(note.contents)}</span>
      </button>

      <div className="row-slot">
        <span className="row-time">{relativeTime(note.modified)}</span>
        <button
          type="button"
          className="row-delete"
          onClick={onDelete}
          aria-label={`Delete ${preview(note.contents)}`}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}
