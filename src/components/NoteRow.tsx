import { TrashIcon } from "@heroicons/react/24/outline";
import type { Note } from "../hooks/useNotes";
import { preview, relativeTime } from "../lib/format";

export default function NoteRow({
  note,
  confirming,
  onOpen,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  note: Note;
  confirming: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const title = preview(note.contents);

  if (confirming) {
    return (
      <div className="row row-confirming">
        <span className="row-label">{title}</span>
        <div className="row-actions">
          <button type="button" className="row-btn" onClick={onCancelDelete}>
            Cancel
          </button>
          <button
            type="button"
            className="row-btn row-btn-danger"
            onClick={onConfirmDelete}
            autoFocus
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="row">
      <button type="button" className="row-open" onClick={onOpen}>
        <span className="row-title">{title}</span>
      </button>

      <div className="row-slot">
        <span className="row-time">{relativeTime(note.modified)}</span>
        <button
          type="button"
          className="row-delete"
          onClick={onDelete}
          aria-label={`Delete ${title}`}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}
