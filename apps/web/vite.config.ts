import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "import.meta.env.VITE_CLOUDMARKUP_VISUAL_FIXTURES": JSON.stringify("false"),
  },
  plugins: [react()],
  publicDir: "src/assets/brand/public",
  // Browser fixtures retain development composition. Pre-transform their
  // shared bootstrap so behavior assertions do not time Vite's cold waterfall.
  server: {
    warmup: { clientFiles: ["./src/main.tsx"] },
  },
});
