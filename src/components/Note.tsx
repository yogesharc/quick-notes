import {
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  applyEdit,
  getSelectionRange,
  offsetOfNode,
  readText,
  render,
  scrollCaretIntoView,
  setSelectionRange,
  sync,
} from "../lib/editor-dom";
import { History } from "../lib/history";
import {
  capitalizeItemStart,
  continueList,
  expandShorthand,
  toggleTodo,
  type Edit,
} from "../lib/lists";
import type { Snapshot } from "../lib/history";

/** Formatting shortcuts the browser would otherwise apply to editable text. */
const FORMATTING_KEYS = new Set(["b", "i", "u"]);

export default function Note({
  contents,
  onChange,
}: {
  contents: string;
  onChange: (value: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef(new History({ text: contents, caret: 0 }));
  const composingRef = useRef(false);

  // The DOM is owned by the browser while typing; this only steps in when the
  // note is swapped out from underneath us.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    // An empty editable has no line block for the browser to type into, so it
    // would start a bare text node at the root instead.
    if (root.childNodes.length === 0 || readText(root) !== contents) {
      render(root, contents);
      setSelectionRange(root, contents.length);
      historyRef.current.reset({ text: contents, caret: contents.length });
    }
  }, [contents]);

  useLayoutEffect(() => {
    rootRef.current?.focus();
  }, []);

  function commit(root: HTMLDivElement, edit: Edit) {
    applyEdit(root, edit);
    const text = readText(root);
    sync(root, text);
    setSelectionRange(root, edit.caret);
    scrollCaretIntoView(root);
    // Structural edits always start their own undo step.
    historyRef.current.record({ text, caret: edit.caret }, Date.now(), true);
    onChange(text);
  }

  function restore(root: HTMLDivElement, snapshot: Snapshot) {
    render(root, snapshot.text);
    setSelectionRange(root, snapshot.caret);
    scrollCaretIntoView(root);
    onChange(snapshot.text);
  }

  function onInput() {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const text = readText(root);

    // Rebuilding spans mid-composition would tear the IME's own DOM out from
    // under it, so structure is left alone until the composition commits.
    if (composingRef.current) {
      onChange(text);
      return;
    }

    const caret = getSelectionRange(root);
    if (sync(root, text) && caret) {
      setSelectionRange(root, caret.start, caret.end);
    }
    scrollCaretIntoView(root);

    const at = getSelectionRange(root)?.start ?? text.length;
    const previous = historyRef.current.current.text;
    // Line changes are structural enough to deserve their own undo step.
    const separate =
      text.split("\n").length !== previous.split("\n").length;
    historyRef.current.record({ text, caret: at }, Date.now(), separate);
    onChange(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const root = rootRef.current;
    const mod = event.metaKey || event.ctrlKey;
    if (!root) {
      return;
    }

    if (mod && FORMATTING_KEYS.has(event.key.toLowerCase())) {
      event.preventDefault();
      return;
    }

    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      const snapshot = event.shiftKey
        ? historyRef.current.redo()
        : historyRef.current.undo();
      if (snapshot) {
        restore(root, snapshot);
      }
      return;
    }

    const range = getSelectionRange(root);
    if (!range || event.nativeEvent.isComposing) {
      return;
    }

    const text = readText(root);
    const { start, end } = range;

    const run = (edit: Edit | null) => {
      if (!edit) {
        return false;
      }
      event.preventDefault();
      commit(root, edit);
      return true;
    };

    if (event.key === "Enter" && mod) {
      run(toggleTodo(text, start));
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      run(continueList(text, start, end));
      return;
    }

    if (event.key === " " && !mod && !event.altKey) {
      run(expandShorthand(text, start, end));
      return;
    }

    if (!mod && !event.altKey) {
      run(capitalizeItemStart(text, start, end, event.key));
    }
  }

  /** Clicking a checkbox toggles it; the marker is a real element now. */
  function onClick(event: MouseEvent<HTMLDivElement>) {
    const root = rootRef.current;
    const line = (event.target as HTMLElement | null)
      ?.closest(".box")
      ?.closest(".ln");
    if (!root || !line) {
      return;
    }

    // Derived from the clicked element rather than the caret, which the click
    // may have dropped anywhere along the line.
    const edit = toggleTodo(readText(root), offsetOfNode(root, line));
    if (edit) {
      event.preventDefault();
      commit(root, edit);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (text) {
      document.execCommand("insertText", false, text);
    }
  }

  return (
    <div className="editor-wrap">
      <div
        className="editor"
        ref={rootRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-multiline="true"
        onInput={onInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          onInput();
        }}
        onKeyDown={onKeyDown}
        onClick={onClick}
        onPaste={onPaste}
      />
      {!contents && (
        <div className="editor-placeholder" aria-hidden="true">
          - bullet list. 1. num list. [ ] for todo. ⌘ + Enter to check
        </div>
      )}
    </div>
  );
}
