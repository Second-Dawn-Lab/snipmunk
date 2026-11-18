import "@seconddawn/ui/styles.css";
import "./app.css";
import "./settings/settings.css";
import "./overlay/overlay.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
