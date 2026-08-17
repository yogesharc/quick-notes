import { ArrowPathIcon } from "@heroicons/react/24/outline";

type UpdateBarProps = {
  version: string;
  onInstall: () => void;
};

/// The install offer, pinned to the window's bottom edge.
///
/// Drawn only once a bundle has finished downloading — the app has no permanent
/// footer, and there is nothing to offer until the restart would actually do
/// something. Checking and downloading stay silent.
export default function UpdateBar({ version, onInstall }: UpdateBarProps) {
  return (
    <button type="button" className="update-bar" onClick={onInstall}>
      <ArrowPathIcon />
      <span>Restart to update</span>
      <span className="update-version">v{version}</span>
    </button>
  );
}
