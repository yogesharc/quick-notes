import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type UpdateStatus = { state: "ready"; version: string };

/// Holds the version once the backend has a bundle downloaded and ready.
///
/// Checking is entirely the backend's job — on reveal and on a timer there. A
/// timer here couldn't do it: a hidden window's JS is throttled and the app can
/// be App Napped outright, so an interval in the webview may never fire.
///
/// `null` is the resting state and covers every failure: a check that can't
/// reach the manifest emits nothing, so being offline is silent rather than an
/// error the reader can do nothing about.
export function useUpdater() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    const unlisten = listen<UpdateStatus>("update_status", (event) => {
      setStatus(event.payload);
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Resolving at all means the install failed — the backend relaunches the app
  // on success, so nothing downstream of this ever runs.
  const install = useCallback(
    () => invoke("install_update").catch((e) => console.error("[update install]", e)),
    []
  );

  return { updateVersion: status?.version ?? null, install };
}
