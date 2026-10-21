import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

import typedBackend from "./typed-backend.config.js";

const nativeViewports = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 },
] as const;

// Minimum supported, representative HD and maximum desktop bounds cover the
// same layout regime. Fractional/scaled cases below retain distinct DPRs.

// CSS viewport/DPR equivalents of a 3840x2160 display, not OS scaling proof.
const scaled4k = [
  { scale: 1.25, viewport: { width: 3072, height: 1728 } },
  { scale: 1.5, viewport: { width: 2560, height: 1440 } },
  { scale: 2, viewport: { width: 1920, height: 1080 } },
] as const;

process.env["CLOUDMARKUP_DESKTOP_PRODUCTION_E2E"] = "true";

export default defineConfig({
  ...typedBackend,
  testMatch: ["desktop-resolution-qa.spec.ts", "service-expansion.spec.ts"],
  outputDir: "../../test-results/desktop-production",
  reporter: [
    ["line"],
    [
      "json",
      {
        outputFile: fileURLToPath(
          new URL(
            "../../.cache/desktop-production/report.json",
            import.meta.url,
          ),
        ),
      },
    ],
  ],
  projects: [
    ...nativeViewports.map((viewport) => ({
      name: `${String(viewport.width)}x${String(viewport.height)}-dpr1`,
      use: { viewport, deviceScaleFactor: 1 },
    })),
    ...scaled4k.map(({ scale, viewport }) => ({
      name: `4k-scaled-${String(scale * 100)}percent`,
      use: { viewport, deviceScaleFactor: scale },
    })),
  ],
  // First build with VITE_CLOUDMARKUP_API_BASE_URL=/typed-backend-api.
  // The fixture session and APIs are intercepted by the spec; no live login.
  webServer: {
    cwd: "../..",
    command:
      "node apps/web/node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port 4189 --strictPort",
    reuseExistingServer: false,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 120_000,
    url: "http://127.0.0.1:4189",
  },
  use: { ...typedBackend.use, baseURL: "http://127.0.0.1:4189" },
});
