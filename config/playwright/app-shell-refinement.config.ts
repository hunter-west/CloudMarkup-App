import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
const sizes = [
  { name: "1366x768", width: 1366, height: 768, dpr: 1 },
  { name: "1440x900", width: 1440, height: 900, dpr: 1 },
  { name: "4k-125", width: 3072, height: 1728, dpr: 1.25 },
  { name: "4k-150", width: 2560, height: 1440, dpr: 1.5 },
  { name: "phone", width: 390, height: 844, dpr: 2 },
  { name: "tablet", width: 768, height: 1024, dpr: 1 },
];
// Preserve 1440x900: capture, staff authorization and photo transport select it.
// Other projects cover minimum desktop, fractional scaling, phone and tablet layouts.
// The 1920x1080/DPR1 production workspace/account journey remains in desktop-production.
// DPR2 desktop geometry also remains in the desktop-production profile.
export default defineConfig({
  testDir: "../../apps/web/e2e",
  testMatch: "app-shell-refinement.audit.ts",
  timeout: 120000,
  expect: { timeout: 20000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4193",
    browserName: "chromium",
    headless: true,
  },
  projects: sizes.map((size) => ({
    name: size.name,
    use: {
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.dpr,
      ...(size.name === "phone" ? { isMobile: true, hasTouch: true } : {}),
    },
  })),
  reporter: [
    ["line"],
    [
      "json",
      {
        outputFile: fileURLToPath(
          new URL("../../../ui-render-report.json", import.meta.url),
        ),
      },
    ],
  ],
  outputDir: fileURLToPath(
    new URL("../../../ui-render-results", import.meta.url),
  ),
  webServer: {
    cwd: "../..",
    command:
      "node apps/web/node_modules/vite/bin/vite.js preview apps/web --outDir ../../../ui-fixture-dist --host 127.0.0.1 --port 4193 --strictPort",
    url: "http://127.0.0.1:4193",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
