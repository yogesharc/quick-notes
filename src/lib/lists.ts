/**
 * Plain-text list behaviour: bullets, numbers and todos that continue
 * themselves on Enter. Deliberately not markdown — nothing here reacts to `*`,
 * `_`, `#` or any other formatting character.
 *
 * Every operation is a pure function over (text, selection) returning a single
 * replacement, so the DOM layer stays free to apply it however it likes.
 */

export const UNCHECKED = "○";
export const CHECKED = "●";

/** Typed bullets normalise to this. */
export const BULLET_POINT = "•";

const TODO = new RegExp(`^(\\s*)([${UNCHECKED}${CHECKED}])[ \\t]+`);
const BULLET = /^(\s*)([-*+•])[ \t]+/;
const ORDERED = /^(\s*)(\d+)([.)])[ \t]+/;

/** `[]` or `[ ]`, alone or right after a bullet, with nothing else on the line. */
const TODO_SHORTHAND = /^(\s*)(?:[-*+•][ \t]+)?\[ ?\]$/;

/** A lone `-`, `*` or `+` holding the whole line. */
const BULLET_SHORTHAND = /^(\s*)[-*+]$/;

export type Item = {
  kind: "todo" | "bullet" | "ordered";
  indent: string;
  /** The marker including its trailing space, e.g. "○ ", "• ", "12. ". */
  marker: string;
  content: string;
  checked: boolean;
  /** The marker that opens the next item. */
  next: string;
};

export function parseItem(line: string): Item | null {
  const todo = TODO.exec(line);
  if (todo) {
    return {
      kind: "todo",
      indent: todo[1],
      marker: todo[0].slice(todo[1].length),
      content: line.slice(todo[0].length),
      checked: todo[2] === CHECKED,
      next: `${UNCHECKED} `,
    };
  }

  const bullet = BULLET.exec(line);
  if (bullet) {
    return {
      kind: "bullet",
      indent: bullet[1],
      marker: bullet[0].slice(bullet[1].length),
      content: line.slice(bullet[0].length),
      checked: false,
      next: `${BULLET_POINT} `,
    };
  }

  const ordered = ORDERED.exec(line);
  if (ordered) {
    return {
      kind: "ordered",
      indent: ordered[1],
      marker: ordered[0].slice(ordered[1].length),
      content: line.slice(ordered[0].length),
      checked: false,
      next: `${Number(ordered[2]) + 1}${ordered[3]} `,
    };
  }

  return null;
}

/** A single replacement: swap `[from, to)` for `text` and put the caret at `caret`. */
export type Edit = { from: number; to: number; text: string; caret: number };

function lineBounds(value: string, from: number, to: number) {
  const start = value.lastIndexOf("\n", from - 1) + 1;
  const end = value.indexOf("\n", to);
  return { start, end: end === -1 ? value.length : end };
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
export function continueList(
  value: string,
  start: number,
  end: number,
): Edit | null {
  const { start: lineStart, end: lineEnd } = lineBounds(value, start, end);
  const before = value.slice(lineStart, start);
  const after = value.slice(end, lineEnd);

  const item = parseItem(before);
  if (!item) {
    return null;
  }

  if (!item.content.trim() && !after.trim()) {
    return { from: lineStart, to: lineEnd, text: "", caret: lineStart };
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
    return {
      from: lineStart,
      to: run.end,
      text: [before + opener + after, ...renumbered].join("\n"),
      caret,
    };
  }

  return { from: lineStart, to: lineEnd, text: before + opener + after, caret };
}

/** Space turns `[]` into a checkbox and a lone `-` into a real bullet point. */
export function expandShorthand(
  value: string,
  start: number,
  end: number,
): Edit | null {
  if (start !== end) {
    return null;
  }

  const { start: lineStart } = lineBounds(value, start, end);
  const line = value.slice(lineStart, start);

  const todo = TODO_SHORTHAND.exec(line);
  if (todo) {
    const text = `${todo[1]}${UNCHECKED} `;
    return { from: lineStart, to: start, text, caret: lineStart + text.length };
  }

  const bullet = BULLET_SHORTHAND.exec(line);
  if (bullet) {
    const text = `${bullet[1]}${BULLET_POINT} `;
    return { from: lineStart, to: start, text, caret: lineStart + text.length };
  }

  return null;
}

/**
 * Uppercases the first letter typed into any empty list item, so `[] k` reads
 * `○ K`. Returns null for keys with no uppercase form, which skips scripts that
 * don't have letter case at all.
 */
export function capitalizeItemStart(
  value: string,
  start: number,
  end: number,
  key: string,
): Edit | null {
  const upper = key.toUpperCase();
  if (key.length !== 1 || upper === key || start !== end) {
    return null;
  }

  const bounds = lineBounds(value, start, end);
  if (value.slice(start, bounds.end).trim()) {
    return null;
  }

  const item = parseItem(value.slice(bounds.start, start));
  if (!item || item.content.trim()) {
    return null;
  }

  return { from: start, to: end, text: upper, caret: start + upper.length };
}

/** Flip the checkbox on the line holding `pos`, leaving the caret where it was. */
export function toggleTodo(value: string, pos: number): Edit | null {
  const { start, end } = lineBounds(value, pos, pos);
  const item = parseItem(value.slice(start, end));
  if (!item || item.kind !== "todo") {
    return null;
  }

  const box = start + item.indent.length;
  return {
    from: box,
    to: box + 1,
    text: item.checked ? UNCHECKED : CHECKED,
    caret: pos,
  };
}
