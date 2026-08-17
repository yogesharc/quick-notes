/**
 * Plain-text list behaviour for a <textarea>: bullets, numbers and todos that
 * continue themselves on Enter. Deliberately not markdown — nothing here reacts
 * to `*`, `_`, `#` or any other formatting character.
 */

/** Swap these for any pair you like: □/■, ○/●, ⬜/✅. Must stay single-code-unit. */
export const UNCHECKED = "○";
export const CHECKED = "●";

const TODO = new RegExp(`^(\\s*)([${UNCHECKED}${CHECKED}])[ \\t]+`);
const BULLET = /^(\s*)([-*+])[ \t]+/;
const ORDERED = /^(\s*)(\d+)([.)])[ \t]+/;

/** `[]` or `[ ]`, alone or right after a bullet, with nothing else on the line. */
const TODO_SHORTHAND = /^(\s*)(?:[-*+][ \t]+)?\[ ?\]$/;

type Item = {
  indent: string;
  /** Everything after the marker and its trailing space. */
  content: string;
  /** Marker to open the *next* item with, e.g. "- ", "3. ", "☐ ". */
  next: string;
};

function parseItem(line: string): Item | null {
  const todo = TODO.exec(line);
  if (todo) {
    return {
      indent: todo[1],
      content: line.slice(todo[0].length),
      next: `${UNCHECKED} `,
    };
  }

  const bullet = BULLET.exec(line);
  if (bullet) {
    return {
      indent: bullet[1],
      content: line.slice(bullet[0].length),
      next: `${bullet[2]} `,
    };
  }

  const ordered = ORDERED.exec(line);
  if (ordered) {
    return {
      indent: ordered[1],
      content: line.slice(ordered[0].length),
      next: `${Number(ordered[2]) + 1}${ordered[3]} `,
    };
  }

  return null;
}

function lineBounds(value: string, from: number, to: number) {
  const start = value.lastIndexOf("\n", from - 1) + 1;
  const end = value.indexOf("\n", to);
  return { start, end: end === -1 ? value.length : end };
}

/**
 * Writes through the browser's own edit pipeline so the native undo stack and
 * React's onChange both stay intact. Falls back to poking the value setter
 * directly if execCommand is unavailable. Every path leaves the caret just past
 * the inserted text — engines disagree about where it lands otherwise.
 */
function replaceRange(
  el: HTMLTextAreaElement,
  from: number,
  to: number,
  text: string,
) {
  el.focus();
  el.setSelectionRange(from, to);

  // An empty insertText is a no-op in WebKit, so deletions need their own command.
  const applied = text
    ? document.execCommand("insertText", false, text)
    : document.execCommand("delete");

  if (!applied) {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setValue?.call(el, el.value.slice(0, from) + text + el.value.slice(to));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const caret = from + text.length;
  el.setSelectionRange(caret, caret);
}

/** Numbered lines directly below `lineEnd` sharing `indent`, as one contiguous run. */
function orderedRun(value: string, lineEnd: number, indent: string) {
  const lines: string[] = [];
  let pos = lineEnd;
  let end = lineEnd;

  while (pos < value.length && value[pos] === "\n") {
    const { start, end: stop } = lineBounds(value, pos + 1, pos + 1);
    const line = value.slice(start, stop);
    const match = ORDERED.exec(line);
    if (!match || match[1] !== indent) {
      break;
    }
    lines.push(line);
    end = stop;
    pos = stop;
  }

  return lines.length ? { lines, end } : null;
}

/** Enter inside a list item: open the next one, or drop out if this one is empty. */
export function continueList(el: HTMLTextAreaElement): boolean {
  const { value, selectionStart, selectionEnd } = el;
  const { start: lineStart, end: lineEnd } = lineBounds(
    value,
    selectionStart,
    selectionEnd,
  );

  const before = value.slice(lineStart, selectionStart);
  const after = value.slice(selectionEnd, lineEnd);

  const item = parseItem(before);
  if (!item) {
    return false;
  }

  if (!item.content.trim() && !after.trim()) {
    replaceRange(el, lineStart, lineEnd, "");
    return true;
  }

  const opener = `\n${item.indent}${item.next}`;
  const caret = lineStart + before.length + opener.length;

  const ordered = ORDERED.exec(before);
  const run = ordered ? orderedRun(value, lineEnd, item.indent) : null;

  if (ordered && run) {
    // Inserting mid-list would leave duplicate numbers below, so rewrite the run.
    let n = Number(ordered[2]) + 1;
    const renumbered = run.lines.map((line) => {
      const match = ORDERED.exec(line)!;
      n += 1;
      return `${match[1]}${n}${match[3]} ${line.slice(match[0].length)}`;
    });
    replaceRange(
      el,
      lineStart,
      run.end,
      [before + opener + after, ...renumbered].join("\n"),
    );
  } else {
    replaceRange(el, lineStart, lineEnd, before + opener + after);
  }

  el.setSelectionRange(caret, caret);
  return true;
}

/** Space after `[]` / `[ ]` / `- []` turns the line into a todo. */
export function expandTodoShorthand(el: HTMLTextAreaElement): boolean {
  const { value, selectionStart, selectionEnd } = el;
  if (selectionStart !== selectionEnd) {
    return false;
  }

  const { start: lineStart } = lineBounds(value, selectionStart, selectionEnd);
  const match = TODO_SHORTHAND.exec(value.slice(lineStart, selectionStart));
  if (!match) {
    return false;
  }

  replaceRange(el, lineStart, selectionStart, `${match[1]}${UNCHECKED} `);
  return true;
}

/** Flip the checkbox on the line holding `pos`, leaving the caret where it was. */
export function toggleTodo(el: HTMLTextAreaElement, pos: number): boolean {
  const { value } = el;
  const { start: lineStart, end: lineEnd } = lineBounds(value, pos, pos);
  const match = TODO.exec(value.slice(lineStart, lineEnd));
  if (!match) {
    return false;
  }

  const box = lineStart + match[1].length;
  replaceRange(el, box, box + 1, value[box] === UNCHECKED ? CHECKED : UNCHECKED);
  el.setSelectionRange(pos, pos);
  return true;
}

/** Splits a todo line so the checkbox and its label can be styled separately. */
export function parseTodoLine(line: string) {
  const match = TODO.exec(line);
  if (!match) {
    return null;
  }

  return {
    indent: match[1],
    box: match[2],
    checked: match[2] === CHECKED,
    // Keeps the marker's trailing whitespace so column alignment survives.
    label: line.slice(match[1].length + 1),
  };
}

/** A click counts as hitting the checkbox only if the caret landed on the glyph. */
export function toggleTodoIfClicked(el: HTMLTextAreaElement): boolean {
  const { value, selectionStart, selectionEnd } = el;
  if (selectionStart !== selectionEnd) {
    return false;
  }

  const { start: lineStart, end: lineEnd } = lineBounds(
    value,
    selectionStart,
    selectionEnd,
  );
  const match = TODO.exec(value.slice(lineStart, lineEnd));
  if (!match) {
    return false;
  }

  const column = selectionStart - lineStart;
  const box = match[1].length;
  if (column < box || column > box + 1) {
    return false;
  }

  return toggleTodo(el, selectionStart);
}
