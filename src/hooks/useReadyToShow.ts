import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

// If frames aren't being produced, rAF never runs — reveal on a timer rather
// than wait out the backend's multi-second backstop.
const PAINT_DEADLINE_MS = 150;

/// Tells the backend to reveal the window once `booted` content has been
/// through a frame. The backend stages the window transparent so the webview
/// is painting by then, and the second rAF runs after the frame carrying that
/// content has been composited.
export function useReadyToShow(booted: boolean) {
  useEffect(() => {
    if (!booted) {
      return;
    }

    let done = false;
    function ready() {
      if (done) {
        return;
      }
      done = true;
      invoke("ready_to_show");
    }

    const timer = setTimeout(ready, PAINT_DEADLINE_MS);
    const frame = requestAnimationFrame(() => requestAnimationFrame(ready));

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [booted]);
}
