import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/montserrat/wght.css";
import "@fontsource/lobster/latin-400.css";
import "./ui/tokens.css";
import "./marca/farina.css";
import "./ui/kit.css";
import "./portal.css";
import { App } from "./App";

// Build estático (Vercel): as rotas do portal rodam na própria página. No build
// normal este bloco some e o front fala com o servidor Express.
if (import.meta.env.VITE_DEMO_NAVEGADOR === "1") {
  const { instalarBackendNavegador } = await import("./demo/backendNavegador");
  instalarBackendNavegador();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
