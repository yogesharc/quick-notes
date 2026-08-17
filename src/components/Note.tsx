import {
  Fragment,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type UIEvent,
} from "react";
import {
  continueList,
  expandTodoShorthand,
  parseTodoLine,
  toggleTodo,
  toggleTodoIfClicked,
} from "../lib/lists";

/**
 * A textarea can't style individual characters, so a mirror of the same text
 * sits behind it with the checkboxes marked up. The textarea's own text is
 * transparent — only its caret and selection show through.
 */
function Mirror({ contents }: { contents: string }) {
  return (
    <>
      {contents.split("\n").map((line, index) => {
        const todo = parseTodoLine(line);
        return (
          <Fragment key={index}>
            {todo ? (
              <>
                {todo.indent}
                <span className={todo.checked ? "todo-box is-done" : "todo-box"}>
                  {todo.box}
                </span>
                <span
                  className={todo.checked ? "todo-label is-done" : "todo-label"}
                >
                  {todo.label}
                </span>
              </>
            ) : (
              line
            )}
            {"\n"}
          </Fragment>
        );
      })}
    </>
  );
}

export default function Note({
  contents,
  onChange,
}: {
  contents: string;
  onChange: (value: string) => void;
}) {
  const mirrorRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const el = event.currentTarget;
    const mod = event.metaKey || event.ctrlKey;

    if (event.key === "Enter" && mod && toggleTodo(el, el.selectionStart)) {
      event.preventDefault();
      return;
    }

    if (event.key === "Enter" && !mod && !event.shiftKey && !event.altKey) {
      if (continueList(el)) {
        event.preventDefault();
      }
      return;
    }

    if (event.key === " " && !mod && !event.altKey && expandTodoShorthand(el)) {
      event.preventDefault();
    }
  }

  function onClick(event: MouseEvent<HTMLTextAreaElement>) {
    toggleTodoIfClicked(event.currentTarget);
  }

  function onScroll(event: UIEvent<HTMLTextAreaElement>) {
    if (mirrorRef.current) {
      mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
    }
  }

  return (
    <div className="editor-wrap">
      <div className="editor-mirror" ref={mirrorRef} aria-hidden="true">
        <Mirror contents={contents} />
      </div>
      <textarea
        className="editor"
        value={contents}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onClick={onClick}
        onScroll={onScroll}
        placeholder="- bullet list. 1. num list. [ ] for todo. ⌘ + Enter to check"
        spellCheck={false}
        autoFocus
      />
    </div>
  );
}
