import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { TypedBackendApiHarness } from "./support/typed-backend-api-harness.js";
test.skip(
  process.env["CLOUDMARKUP_TYPED_BACKEND_E2E"] !== "true",
  "Requires the authenticated browser fixture.",
);
// Retain both staff actions and palettes without replaying each action in each palette.
for (const [theme, trial] of [
  ["light", false],
  ["dark", true],
] as const)
  test(
    "staff " +
      (trial ? "trial" : "credits") +
      " review, audit, and narrow-screen layout in " +
      theme,
    async ({ context, page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width: 1440, height: 960 });
      await context.addInitScript((value) => {
        localStorage.setItem("cloudmarkup.appearance.v1", value);
      }, theme);
      await new TypedBackendApiHarness({ role: "owner" }).install(context);
      const actor = "principal_typed_backend_owner",
        account = {
          contractVersion: 1,
          organizationId: "org_test_support",
          billingAccountId: "billing_test_support",
          displayName: "Synthetic testing workspace",
          kind: "personal",
          organizationState: "active",
          billingState: "active",
          subscriptionState: trial ? "not-subscribed" : "active",
          planDisplayName: "Professional",
          expensiveOperationsEnabled: true,
          version: 1,
        };
      let history: unknown[] = [];
      const writes: unknown[] = [];
      let trialState: "active" | "revoked" = "active";
      await context.route("**/v1/staff/**", async (route) => {
        const url = new URL(route.request().url()),
          path = url.pathname.split("/v1")[1];
        let data: unknown,
          headers: Record<string, string> = {};
        if (path === "/staff/access")
          data = {
            contractVersion: 1,
            permissions: [
              "accounts.read",
              "credits.grant",
              "credits.revoke",
              "operations.manage",
              ...(trial ? ["trials.grant", "trials.revoke"] : []),
            ],
          };
        else if (path === "/staff/workspaces")
          data = { contractVersion: 1, items: [account] };
        else if (path === "/staff/workspaces/org_test_support") {
          data = {
            contractVersion: 1,
            account,
            availableCreditUnits: history.length ? "100" : "0",
            reservedCreditUnits: "0",
            grants: [],
            history,
            ...(trial && history.length
              ? {
                  trial: {
                    contractVersion: 1,
                    id: "trial_browser",
                    creditGrantId: "grant_browser",
                    startsAt: "2026-10-06T12:00:00.000Z",
                    expiresAt: "2026-11-05T12:00:00.000Z",
                    state: trialState,
                    creditUnits: "100",
                    availableCreditUnits: trialState === "active" ? "100" : "0",
                    reservedCreditUnits: "0",
                  },
                }
              : {}),
          };
          headers = {
            etag:
              '"staff-account:billing_test_support:' +
              account.version.toString() +
              '"',
          };
        } else if (path?.endsWith("/actions")) {
          const input = route.request().postDataJSON() as Record<
            string,
            unknown
          >;
          writes.push(input);
          expect(input["confirmBillingAccountId"]).toBe(
            account.billingAccountId,
          );
          expect(route.request().headers()["if-match"]).toBe(
            '"staff-account:billing_test_support:' +
              String(account.version) +
              '"',
          );
          data = {
            contractVersion: 1,
            actionId: "staff_browser_receipt_" + String(account.version),
            organizationId: account.organizationId,
            billingAccountId: account.billingAccountId,
            actorPrincipalId: actor,
            action: trial ? input["action"] : "grant-credits",
            ...(trial
              ? {
                  trialId: "trial_browser",
                  trialExpiresAt: "2026-11-05T12:00:00.000Z",
                }
              : {}),
            creditUnits: "100",
            creditGrantId: "grant_browser",
            expensiveOperationsEnabled: null,
            reason: input["reason"],
            occurredAt: "2026-10-06T12:00:00.000Z",
            accountVersion: account.version + 1,
          };
          history = [data, ...history];
          account.version++;
          if (input["action"] === "revoke-trial") trialState = "revoked";
        } else throw Error("Unexpected staff route");
        await route.fulfill({ headers, json: { apiVersion: "v1", data } });
      });
      await page.goto("/staff/accounts");
      await expect(
        page.getByRole("heading", { name: "Account administration" }),
      ).toBeVisible();
      await page
        .getByRole("searchbox", { name: "Find an account" })
        .fill("Synthetic");
      await page.getByRole("button", { name: "Search accounts" }).click();
      await page
        .getByRole("button", { name: /Synthetic testing workspace/ })
        .click();
      if (trial)
        await page
          .getByRole("combobox", { name: "Action", exact: true })
          .selectOption("grant-trial");
      await page
        .getByRole("textbox", { name: "Reason", exact: true })
        .fill("Synthetic browser testing allowance");
      await page.getByRole("button", { name: "Review action" }).click();
      await expect(
        page.getByRole("region", { name: "Review staff action" }),
      ).toContainText("billing_test_support");
      expect(writes).toHaveLength(0);
      await expect(
        page.getByRole("heading", {
          name: trial ? "Confirm trial grant" : "Confirm credit grant",
        }),
      ).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath("staff-review-" + theme + ".png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Confirm action" }).click();
      await expect(
        page.getByText(
          trial
            ? /Action recorded. Receipt:/
            : /100 complimentary credits granted. Receipt:/,
        ),
      ).toBeVisible();
      expect(writes).toHaveLength(1);
      await expect(
        page.getByRole("heading", { name: "Staff action history" }),
      ).toBeVisible();
      await expect(
        page.getByText("Synthetic browser testing allowance", {
          exact: true,
        }),
      ).toBeVisible();
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
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(
        page.getByRole("button", { name: "Review action" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("staff-mobile-" + theme + ".png"),
        fullPage: true,
      });
      if (trial) {
        await expect(
          page.getByRole("region", { name: "Staff trial" }),
        ).toContainText("100 of 100");
        await page
          .getByRole("combobox", { name: "Action", exact: true })
          .selectOption("revoke-trial");
        await page
          .getByRole("textbox", { name: "Reason", exact: true })
          .fill("Synthetic trial revocation");
        await page.getByRole("button", { name: "Review action" }).click();
        await expect(
          page.getByRole("region", { name: "Review staff action" }),
        ).toContainText("Paid access and credits are preserved");
        expect(writes).toHaveLength(1);
        await page.getByRole("button", { name: "Confirm action" }).click();
        await expect(
          page.getByRole("region", { name: "Staff trial" }),
        ).toContainText("revoked");
        expect(writes).toHaveLength(2);
      }
      expect(errors).toEqual([]);
    },
  );
test("ordinary organization owners cannot open staff account controls", async ({
  context,
  page,
}) => {
  await new TypedBackendApiHarness({ role: "owner" }).install(context);
  let reads = 0;
  await context.route("**/v1/staff/**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/access"))
      await route.fulfill({
        json: {
          apiVersion: "v1",
          data: { contractVersion: 1, permissions: [] },
        },
      });
    else {
      reads++;
      await route.fulfill({
        status: 403,
        json: {
          apiVersion: "v1",
          error: {
            code: "access_denied",
            message: "Platform staff access is required.",
            correlationId: "synthetic",
          },
        },
      });
    }
  });
  await page.goto("/staff/accounts");
  await expect(
    page.getByRole("heading", { name: "Staff access required" }),
  ).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  expect(reads).toBe(0);
});
