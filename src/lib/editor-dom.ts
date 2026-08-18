/**
 * Maps between the note's plain text and the editable DOM.
 *
 * The editor is a contenteditable holding one <div class="ln"> per line. Lines
 * have to be real blocks so wrapped text can hang-indent under its marker,
 * which a <textarea> can't do: its content is a single block, so text-indent
 * only ever applies to the very first line.
 */

import { parseItem, type Edit, type Item } from "./lists";

/** Identifies how a line is currently rendered, so we only rebuild on change. */
function signature(item: Item | null): string {
  return item ? `${item.kind}:${item.checked}:${item.marker}` : "plain";
}

function markerEl(line: HTMLElement): HTMLElement | null {
  return line.querySelector(":scope > .marker");
}

/** Marker widths repeat constantly, and measuring forces layout. */
const widths = new Map<string, number>();

function measure(line: HTMLElement, item: Item): number {
  const key = item.indent + item.marker;
  const cached = widths.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const marker = markerEl(line);
  if (!marker) {
    return 0;
  }

  const range = document.createRange();
  range.setStart(line, 0);
  range.setEndAfter(marker);
  // Width is unaffected by text-indent, which shifts both ends equally.
  const width = range.getBoundingClientRect().width;
  widths.set(key, width);
  return width;
}

/** Hangs a wrapped line under its own marker, measured rather than guessed. */
function hang(line: HTMLElement, item: Item | null) {
  if (!item) {
    line.style.paddingLeft = "";
    line.style.textIndent = "";
    return;
  }

  const width = measure(line, item);
  line.style.paddingLeft = `${width}px`;
  line.style.textIndent = `${-width}px`;
}

function fill(line: HTMLElement, text: string) {
  const item = parseItem(text);
  line.textContent = "";
  line.className = item ? "ln is-item" : "ln";
  line.dataset.sig = signature(item);

  if (!item) {
    // A bare <br> is how an empty block stays selectable and keeps its height.
    line.appendChild(
      text ? document.createTextNode(text) : document.createElement("br"),
    );
    return;
  }

  if (item.indent) {
    line.appendChild(document.createTextNode(item.indent));
  }

  const marker = document.createElement("span");
  marker.className =
    item.kind === "todo"
      ? `marker box${item.checked ? " is-done" : ""}`
      : "marker";
  marker.textContent = item.marker;
  line.appendChild(marker);

  if (item.content) {
    const label = document.createElement("span");
    label.className = `label${item.checked ? " is-done" : ""}`;
    label.textContent = item.content;
    line.appendChild(label);
  }
}

/** Rebuilds every line. Callers restore the caret afterwards. */
export function render(root: HTMLElement, text: string) {
  const lines = text.split("\n");
  root.textContent = "";

  const els = lines.map((line) => {
    const el = document.createElement("div");
    fill(el, line);
    root.appendChild(el);
    return el;
  });

  // Fill first, measure second: one layout pass instead of one per line.
  els.forEach((el, i) => hang(el, parseItem(lines[i])));
}

/**
 * Brings the DOM back in line with `text` after the browser has edited it,
 * touching only what actually changed. Returns true if anything moved, which
 * means the caret needs restoring.
 */
export function sync(root: HTMLElement, text: string): boolean {
  const lines = text.split("\n");
  const kids = Array.from(root.childNodes);

  const shapeOk =
    kids.length === lines.length &&
    kids.every(
      (kid) => kid instanceof HTMLElement && kid.tagName === "DIV",
    );

  if (!shapeOk) {
    render(root, text);
    return true;
  }

  let changed = false;
  lines.forEach((line, i) => {
    const el = kids[i] as HTMLElement;
    const item = parseItem(line);
    // Typing inside the marker span leaves the signature intact but the
    // colouring wrong, so the marker's own text is checked too.
    const intact =
      el.dataset.sig === signature(item) &&
      (!item || markerEl(el)?.textContent === item.marker);

    if (!intact) {
      fill(el, line);
      hang(el, item);
      changed = true;
    }
  });

  return changed;
}

export function readText(root: HTMLElement): string {
  const lines = Array.from(root.childNodes).map((node) =>
    node instanceof HTMLElement && node.tagName === "BR"
      ? ""
      : (node.textContent ?? ""),
  );
  // The browser substitutes nbsp while editing; notes should hold real spaces.
  return lines.join("\n").replace(/\u00a0/g, " ");
}

function offsetOf(root: HTMLElement, node: Node, nodeOffset: number): number {
  // childNodes, not children: an empty editable can hold a bare text node, and
  // skipping it would silently collapse every offset to zero.
  const lines = Array.from(root.childNodes);

  if (node === root) {
    return lines
      .slice(0, nodeOffset)
      .reduce((n, line) => n + (line.textContent ?? "").length + 1, 0);
  }

  let total = 0;
  for (const line of lines) {
    if (line === node) {
      if (line.nodeType === Node.TEXT_NODE) {
        return total + nodeOffset;
      }
      const upto = Array.from(line.childNodes).slice(0, nodeOffset);
      return total + upto.reduce((n, c) => n + (c.textContent ?? "").length, 0);
    }

    if (line.contains(node)) {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (t === node) {
          return total + seen + nodeOffset;
        }
        seen += (t as Text).data.length;
      }
      return total + seen;
    }

    total += (line.textContent ?? "").length + 1;
  }

  return total;
}

function positionAt(root: HTMLElement, offset: number) {
  const lines = Array.from(root.childNodes);
  let remaining = offset;

  for (const line of lines) {
    const length = (line.textContent ?? "").length;
    if (remaining <= length) {
      if (line.nodeType === Node.TEXT_NODE) {
        return { node: line, offset: remaining };
      }
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const size = (t as Text).data.length;
        if (seen + size >= remaining) {
          return { node: t, offset: remaining - seen };
        }
        seen += size;
      }
      return { node: line, offset: line.childNodes.length };
    }
    remaining -= length + 1;
  }

  const last = lines[lines.length - 1];
  if (!last) {
    return { node: root as Node, offset: 0 };
  }
  return last.nodeType === Node.TEXT_NODE
    ? { node: last, offset: (last.textContent ?? "").length }
    : { node: last, offset: last.childNodes.length };
}

/** Text offset of a DOM position, for callers that have an element in hand. */
export function offsetOfNode(
  root: HTMLElement,
  node: Node,
  nodeOffset = 0,
): number {
  return offsetOf(root, node, nodeOffset);
}

export function getSelectionRange(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return null;
  }

  return {
    start: offsetOf(root, range.startContainer, range.startOffset),
    end: offsetOf(root, range.endContainer, range.endOffset),
  };
}

export function setSelectionRange(root: HTMLElement, from: number, to = from) {
  const start = positionAt(root, from);
  const end = positionAt(root, to);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * Applies an edit through the browser's own edit pipeline so the native undo
 * stack survives. Falls back to a direct rebuild if execCommand is unavailable.
 */
export function applyEdit(root: HTMLElement, edit: Edit) {
  setSelectionRange(root, edit.from, edit.to);

  // An empty insertText is a no-op in WebKit, so deletions need their own command.
  const applied = edit.text
    ? document.execCommand("insertText", false, edit.text)
    : document.execCommand("delete");

  if (!applied) {
    const text = readText(root);
    render(root, text.slice(0, edit.from) + edit.text + text.slice(edit.to));
  }
}

/** Programmatic caret moves don't scroll the way typing does. */
export function scrollCaretIntoView(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0).cloneRange();
  if (!root.contains(range.commonAncestorContainer)) {
    return;
  }

  let rect = range.getBoundingClientRect();
  if (!rect.height) {
    // A collapsed range can measure empty; the enclosing line still won't.
    const line = (
      range.startContainer instanceof HTMLElement
        ? range.startContainer
        : range.startContainer.parentElement
    )?.closest(".ln");
    if (!line) {
      return;
    }
    rect = line.getBoundingClientRect();
  }

  const view = root.getBoundingClientRect();
  const margin = rect.height;

  if (rect.top - margin < view.top) {
    root.scrollTop -= view.top - rect.top + margin;
  } else if (rect.bottom + margin > view.bottom) {
    root.scrollTop += rect.bottom - view.bottom + margin;
  }
}
