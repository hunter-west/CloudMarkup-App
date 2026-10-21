import { defineConfig } from "@playwright/test";

// A production bundle with the existing loopback-only synthetic API harness.
// Timings are observations; deterministic behavior remains the pass criterion.
export default defineConfig({
  testDir: "../../apps/web/performance",
  outputDir: "../../test-results/editor-performance",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["line"]],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:4293",
    browserName: "chromium",
    colorScheme: "light",
    locale: "en-US",
    contextOptions: { reducedMotion: "reduce" },
    serviceWorkers: "block",
    timezoneId: "America/New_York",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 960 },
  },
  webServer: {
    cwd: "../..",
    command:
      "node apps/web/node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port 4293 --strictPort",
    reuseExistingServer: false,
    url: "http://127.0.0.1:4293",
    timeout: 120_000,
  },
});
