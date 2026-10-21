import { expect, test } from "@playwright/test";

import { connectedPerformanceDocument } from "../src/features/editor/beta-performance-fixture.js";
import {
  TypedBackendApiHarness,
  TYPED_BACKEND_NOTES_PROJECT_ID,
  TYPED_BACKEND_ORGANIZATION_ID,
} from "../e2e/support/typed-backend-api-harness.js";

test("observes heap after repeated synthetic editor entry and exit", async ({
  context,
  page,
}, testInfo) => {
  const api = new TypedBackendApiHarness();
  api.seedArchitecture(
    TYPED_BACKEND_NOTES_PROJECT_ID,
    connectedPerformanceDocument(100, 200),
  );
  await api.install(context);
  await context.route("**/api/auth/session/v1/restore", (route) =>
    route.fulfill({ status: 401 }),
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const heaps = [];
  const root = `/organizations/${TYPED_BACKEND_ORGANIZATION_ID}`;
  await page.goto(`${root}/dashboard`);
  const tour = page.getByRole("button", { name: "Dismiss workspace tour" });
  if (await tour.isVisible()) await tour.click();
  for (let cycle = 0; cycle < 8; cycle += 1) {
    await page
      .locator(
        `a[href="${root}/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/editor"]`,
      )
      .first()
      .click();
    await expect(page.locator(".react-flow__node")).toHaveCount(100);
    await page.getByRole("link", { name: "Dashboard home" }).click();
    await expect(
      page.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        api.requestCount(
          "DELETE",
          `/v1/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/editing-lease`,
        ),
      )
      .toBe(cycle + 1);
    // Explicit diagnostic collection reduces GC timing noise; it is not a product change.
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    heaps.push({
      cycle,
      bytes:
        metrics.find(({ name }) => name === "JSHeapUsedSize")?.value ?? null,
    });
  }
  expect(api.latestDraftSave(TYPED_BACKEND_NOTES_PROJECT_ID)).toBeUndefined();
  await testInfo.attach("mount-lifetime-observation", {
    body: JSON.stringify({ heaps }, null, 2),
    contentType: "application/json",
  });
  console.info("Mounted editor heap observation", heaps);
});
