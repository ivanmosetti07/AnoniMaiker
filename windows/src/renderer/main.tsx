import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./app.css";
import { App } from "./App";

// L'interfaccia di AnoniMaiker: il modello è già pronto in `window.anonimaiker` (lo crea il preload).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
