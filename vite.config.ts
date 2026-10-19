import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const raiz = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(raiz, "web"),
  plugins: [react()],
  build: { outDir: path.join(raiz, "dist"), emptyOutDir: true, sourcemap: false, target: "es2022" },
});
