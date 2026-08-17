const MINUTE = 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const WEEK = DAY * 7;
const MONTH = DAY * 30;
const YEAR = DAY * 365;

/** Compact age label for a note's modified timestamp: "now", "5m", "3h", "4d". */
export function relativeTime(modified: string): string {
  const then = new Date(modified).getTime();
  if (Number.isNaN(then)) {
    return "";
  }

  const seconds = Math.max(0, (Date.now() - then) / 1000);

  if (seconds < MINUTE) return "now";
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h`;
  if (seconds < WEEK) return `${Math.floor(seconds / DAY)}d`;
  if (seconds < MONTH) return `${Math.floor(seconds / WEEK)}w`;
  if (seconds < YEAR) return `${Math.floor(seconds / MONTH)}mo`;
  return `${Math.floor(seconds / YEAR)}y`;
}

export function preview(text: string): string {
  const firstLine = text.trim().split("\n")[0]?.trim() ?? "";
  return firstLine || "Untitled";
}

export const IS_MAC =
  typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);

export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";
