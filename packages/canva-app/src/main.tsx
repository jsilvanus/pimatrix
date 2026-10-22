import React from "react";
import ReactDOM from "react-dom/client";
import { AppUiProvider } from "@canva/app-ui-kit";
import "@canva/app-ui-kit/styles.css";
import { App } from "./App";

const rootEl = document.getElementById("root");
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(
    <React.StrictMode>
      <AppUiProvider>
        <App />
      </AppUiProvider>
    </React.StrictMode>
  );
}
