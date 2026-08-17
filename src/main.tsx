import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { IS_MAC } from "./lib/format";

// Drives the traffic-light inset under the overlay title bar.
document.documentElement.dataset.platform = IS_MAC ? "mac" : "other";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
