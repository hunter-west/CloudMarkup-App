import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { TypedBackendApiHarness } from "./support/typed-backend-api-harness.js";
test.skip(
  process.env["CLOUDMARKUP_TYPED_BACKEND_E2E"] !== "true",
  "Requires the typed browser fixture.",
);
// Shared palette checks cover both themes; execute this stateful journey once.
for (const theme of ["dark"] as const) {
  test(
    "credit source balance, expiry and denied refresh in " + theme,
    async ({ context, page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.setViewportSize({ width: 1440, height: 960 });
      await context.addInitScript((value) => {
        localStorage.setItem("cloudmarkup.appearance.v1", value);
      }, theme);
      const api = new TypedBackendApiHarness({ role: "owner" });
      await api.install(context);
      await page.goto("/organizations/org_local/usage");
      await expect(
        page.getByRole("heading", { name: "175 available credits" }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("region", { name: "Monthly credits" })
          .getByText("75", { exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("region", { name: "Purchased credits" })
          .getByText("100", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(/75 available credits expire next/u),
      ).toBeVisible();
      await expect(
        page.getByText("Top-up packs have no expiration."),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("credit-overview-" + theme + ".png"),
        fullPage: true,
      });
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(
        async () =>
          (
            await (
              globalThis as typeof globalThis & { axe: typeof axe }
            ).axe.run(document, {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            })
          ).violations,
      );
      expect(violations).toEqual([]);
      expect(errors).toEqual([]);
      expect(api.requests.every((request) => request.method === "GET")).toBe(
        true,
      );
      await context.route("**/commercial/credit-overview", (route) =>
        route.fulfill({
          status: 403,
          json: {
            apiVersion: "v1",
            error: {
              code: "access_denied",
              correlationId: "credit-denied",
              message: "Access unavailable.",
            },
          },
        }),
      );
      await page.getByRole("button", { name: "Refresh credits" }).click();
      await expect(page.getByRole("alert")).toContainText(
        "Usage summary unavailable",
      );
      await expect(
        page.getByRole("region", { name: "Purchased credits" }),
      ).toHaveCount(0);
    },
  );
}
