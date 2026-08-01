import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "./state/AppProvider";
import App from "./App";
import "./styles/tokens.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
