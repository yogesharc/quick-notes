import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

/// Tells the backend to reveal the window once `booted` content is in the DOM
/// — showing it earlier flashes an empty pane while the webview boots. Timing
/// is deliberately not requestAnimationFrame: a hidden window produces no
/// frames, so the callback would never run.
export function useReadyToShow(booted: boolean) {
  useEffect(() => {
    if (!booted) {
      return;
    }

    const id = setTimeout(() => invoke("ready_to_show"), 0);
    return () => clearTimeout(id);
  }, [booted]);
}
