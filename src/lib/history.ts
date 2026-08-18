/**
 * Undo history for the editor.
 *
 * The browser's own undo stack can't be used: rebuilding a line's spans to
 * recolour a marker is a direct DOM mutation, which invalidates it. Since the
 * editor already owns rendering, it owns undo too.
 *
 * Steps break the way a text editor's do — at word boundaries, at pauses, and
 * whenever the caret jumps or the edit changes direction — so a single undo
 * takes back a word, not everything you just wrote.
 */

export type Snapshot = { text: string; caret: number };

/** Keystrokes further apart than this start a new step. */
const PAUSE_MS = 500;

/** Typing one of these closes the current step once it has been included. */
const BOUNDARY = /[\s.,;:!?()[\]{}'"]/;

type Kind = "insert" | "delete" | "replace" | "none";

/** Where two strings differ, as one replaced span. */
function diff(before: string, after: string) {
  const max = Math.min(before.length, after.length);
  let start = 0;
  while (start < max && before[start] === after[start]) {
    start += 1;
  }

  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  return {
    start,
    removed: before.slice(start, endBefore),
    inserted: after.slice(start, endAfter),
  };
}

export class History {
  private stack: Snapshot[];
  private index = 0;
  private stamp = 0;
  /** Text offset the last edit finished at, for detecting a caret jump. */
  private edge = 0;
  private kind: Kind = "none";
  private broken = true;

  constructor(initial: Snapshot) {
    this.stack = [initial];
    this.edge = initial.caret;
  }

  reset(initial: Snapshot) {
    this.stack = [initial];
    this.index = 0;
    this.stamp = 0;
    this.edge = initial.caret;
    this.kind = "none";
    this.broken = true;
  }

  get current(): Snapshot {
    return this.stack[this.index];
  }

  /** `separate` forces a new step rather than extending the current one. */
  record(next: Snapshot, now: number, separate: boolean) {
    const current = this.stack[this.index];
    if (current.text === next.text) {
      current.caret = next.caret;
      return;
    }

    // Anything previously undone is no longer reachable.
    this.stack.length = this.index + 1;

    const change = diff(current.text, next.text);
    const kind: Kind =
      change.inserted && change.removed
        ? "replace"
        : change.inserted
          ? "insert"
          : "delete";

    // Typing or deleting must carry on from where the last edit stopped.
    const contiguous =
      change.start === this.edge ||
      change.start + change.removed.length === this.edge;

    const extend =
      !separate &&
      !this.broken &&
      this.index > 0 &&
      kind !== "replace" &&
      kind === this.kind &&
      contiguous &&
      now - this.stamp < PAUSE_MS;

    if (extend) {
      this.stack[this.index] = next;
    } else {
      this.stack.push(next);
      this.index += 1;
    }

    this.stamp = now;
    this.kind = kind;
    this.edge =
      kind === "delete" ? change.start : change.start + change.inserted.length;
    this.broken =
      separate || BOUNDARY.test(change.inserted || change.removed);
  }

  private step(to: number): Snapshot {
    this.index = to;
    const snapshot = this.stack[to];
    this.stamp = 0;
    this.edge = snapshot.caret;
    this.kind = "none";
    this.broken = true;
    return snapshot;
  }

  undo(): Snapshot | null {
    return this.index === 0 ? null : this.step(this.index - 1);
  }

  redo(): Snapshot | null {
    return this.index >= this.stack.length - 1
      ? null
      : this.step(this.index + 1);
  }
}
