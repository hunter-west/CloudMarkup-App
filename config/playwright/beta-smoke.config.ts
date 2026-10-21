import { defineConfig } from "@playwright/test";

const rawBaseUrl = process.env["CLOUDMARKUP_BETA_BASE_URL"];
if (rawBaseUrl === undefined) {
  throw new Error(
    "CLOUDMARKUP_BETA_BASE_URL is required for deployed beta smoke.",
  );
}
const baseUrl = new URL(rawBaseUrl);
if (
  baseUrl.origin !== "https://beta.example.invalid" ||
  baseUrl.pathname !== "/" ||
  baseUrl.search !== "" ||
  baseUrl.hash !== "" ||
  baseUrl.username !== "" ||
  baseUrl.password !== ""
) {
  throw new Error(
    "CLOUDMARKUP_BETA_BASE_URL must be exactly https://beta.example.invalid.",
  );
}

export default defineConfig({
  testDir: "../../scripts/beta-smoke",
  testMatch: "beta-deployment.spec.ts",
  outputDir: "../../test-results/beta",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [
    ["line"],
    ["html", { open: "never", outputFolder: "../../playwright-report/beta" }],
  ],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: baseUrl.origin,
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
});
