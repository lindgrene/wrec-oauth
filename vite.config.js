import { defineConfig } from "vite";

export default defineConfig({
  server: {
    fs: {
      // Allow serving the src/ folder which lives above example/ (the vite root).
      allow: [".."],
    },
  },
});
