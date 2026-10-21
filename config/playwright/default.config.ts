import { defineConfig } from "@playwright/test";

const isCi = Boolean(process.env["CI"]);
const accountAccessPreview =
  process.env["CLOUDMARKUP_ACCOUNT_ACCESS_E2E"] === "true";

export default defineConfig({
  testDir: "../../apps/web/e2e",
  outputDir: "../../test-results",
  fullyParallel: false,
  forbidOnly: isCi,
  retries: 0,
  workers: 1,
  reporter: isCi
    ? [
        ["line"],
        ["html", { open: "never", outputFolder: "../../playwright-report" }],
      ]
    : [["line"]],
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: accountAccessPreview
      ? "http://127.0.0.1:4187"
      : "http://127.0.0.1:4173",
    browserName: "chromium",
    colorScheme: "light",
    contextOptions: {
      reducedMotion: "reduce",
    },
    locale: "en-US",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
    timezoneId: "America/New_York",
    trace: "retain-on-failure",
    video: "off",
    viewport: {
      height: 1_000,
      width: 2_000,
    },
  },
  webServer: {
    cwd: "../..",
    command: accountAccessPreview
      ? "node apps/web/node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port 4187 --strictPort"
      : "pnpm --filter @cloudmarkup/web dev --host 127.0.0.1 --port 4173 --strictPort",
    reuseExistingServer: !isCi && !accountAccessPreview,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 300_000,
    url: accountAccessPreview
      ? "http://127.0.0.1:4187"
      : "http://127.0.0.1:4173",
  },
});
