import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  build: { outDir: "../../dist", emptyOutDir: true },
});
