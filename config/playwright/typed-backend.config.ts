import { defineConfig } from "@playwright/test";

const isCi = Boolean(process.env["CI"]);
const port = 4_174;
const origin = `http://127.0.0.1:${String(port)}`;

process.env["CLOUDMARKUP_TYPED_BACKEND_E2E"] = "true";

export default defineConfig({
  testDir: "../../apps/web/e2e",
  testMatch: [
    "typed-backend.spec.ts",
    "gitlab-connections.spec.ts",
    "desktop-dashboard.spec.ts",
    "account-authenticator.spec.ts",
    "staff-accounts.spec.ts",
    "credit-overview.spec.ts",
  ],
  outputDir: "../../test-results/typed-backend",
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
  timeout: 90_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: origin,
    browserName: "chromium",
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
    locale: "en-US",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
    timezoneId: "America/New_York",
    trace: "retain-on-failure",
    video: "off",
    viewport: { height: 1_000, width: 2_000 },
  },
  webServer: {
    cwd: "../..",
    command: `node apps/web/node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port ${String(port)} --strictPort`,
    env: {
      VITE_CLOUDMARKUP_API_BASE_URL: "/typed-backend-api",
    },
    reuseExistingServer: false,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 120_000,
    url: origin,
  },
});
