import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "../theme/tokens.css";
import "./app.css";
import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter basename="/mp">
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
