import { defineConfig } from "vite";
// GitHub Pages serves the site from /rally-riot/
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/rally-riot/" : "/",
  server: { port: 5173 },
}));
