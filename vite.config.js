import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  /** Listen on all interfaces so devices on your LAN can use http://YOUR_PC_IP:5173/ */
  server: { host: true, open: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        river: resolve(__dirname, "river.html"),
      },
    },
  },
});
