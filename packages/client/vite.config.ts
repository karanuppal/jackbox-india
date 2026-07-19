import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { BRANDING } from "../shared/src/branding.js";

// Brand strings live only in @tamasha/shared (PLAN.md §2 / QA-M0-13); the
// static <title> is injected from there at build time.
function htmlBranding(): Plugin {
  return {
    name: "html-branding",
    transformIndexHtml(html) {
      return html.replace("%APP_TITLE%", BRANDING.platformName);
    },
  };
}

export default defineConfig({
  plugins: [react(), htmlBranding()],
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/play": { target: "ws://localhost:8787", ws: true },
    },
  },
});
