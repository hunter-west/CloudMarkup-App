import type { AccountAuthenticatorEnrollmentV1 } from "@cloudmarkup/api-contract";
import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { TypedBackendApiHarness } from "./support/typed-backend-api-harness.js";
test.skip(
  process.env["CLOUDMARKUP_TYPED_BACKEND_E2E"] !== "true",
  "Uses the authenticated browser fixture.",
);
// Shared palette checks cover both themes; execute this stateful journey once.
for (const theme of ["dark"] as const) {
  test(
    "authenticator setup, code verification and removal in " + theme,
    async ({ context, page }, testInfo) => {
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });
      await page.setViewportSize({ width: 1440, height: 960 });
      await context.addInitScript((value) => {
        localStorage.setItem("cloudmarkup.appearance.v1", value);
      }, theme);
      await new TypedBackendApiHarness({ role: "owner" }).install(context);
      const principalId = "principal_typed_backend_owner",
        secretCode = "JBSWY3DPEHPK3PXP";
      let enabled = false,
        enrollment: AccountAuthenticatorEnrollmentV1 | null = null;
      const state = () => ({
        contractVersion: 1,
        principalId,
        enabled,
        enrollmentAvailable: !enabled,
        recoveryContact: { kind: "email", value: "help@example.com" },
        enrollment,
      });
      const actions: string[] = [];
      await context.route("**/v1/account/sessions?**", (route) =>
        route.fulfill({
          json: { apiVersion: "v1", data: [], page: { hasMore: false } },
        }),
      );
      await context.route("**/v1/account/credentials", (route) =>
        route.fulfill({
          json: {
            apiVersion: "v1",
            data: {
              contractVersion: 1,
              principalId,
              email: "actor@example.com",
              emailVerified: true,
              authenticatorEnabled: enabled,
            },
          },
        }),
      );
      await context.route("**/v1/account/authenticator", (route) =>
        route.fulfill({ json: { apiVersion: "v1", data: state() } }),
      );
      await context.route(
        "**/v1/account/authenticator-enrollments",
        async (route) => {
          const input = route.request().postDataJSON() as {
            attemptId: string;
            acknowledgedRecovery: boolean;
          };
          expect(input.acknowledgedRecovery).toBe(true);
          expect(route.request().headers()["x-cloudmarkup-account"]).toBe(
            principalId,
          );
          enrollment = {
            id: input.attemptId,
            expiresAt: new Date(Date.now() + 600000).toISOString(),
            status: "ready",
            currentSession: true,
          };
          actions.push("start");
          await route.fulfill({
            json: {
              apiVersion: "v1",
              data: {
                contractVersion: 1,
                principalId,
                attemptId: input.attemptId,
                action: "start",
                outcome: "succeeded",
                problem: null,
                state: state(),
                secretCode,
              },
            },
          });
        },
      );
      await context.route(
        "**/v1/account/authenticator-changes",
        async (route) => {
          const input = route.request().postDataJSON() as {
            attemptId: string;
            enrollmentId?: string;
            action: string;
            code?: string;
            acknowledgedReduction?: boolean;
          };
          expect(route.request().headers()["x-cloudmarkup-account"]).toBe(
            principalId,
          );
          if (input.action !== "disable")
            expect(input.enrollmentId).toBe(enrollment?.id);
          else expect(input.acknowledgedReduction).toBe(true);
          const rejected = input.code === "000000";
          actions.push(input.action);
          if (!rejected) {
            enabled = input.action === "verify-enable";
            enrollment = null;
          }
          await route.fulfill({
            json: {
              apiVersion: "v1",
              data: {
                contractVersion: 1,
                principalId,
                attemptId: input.attemptId,
                action: input.action,
                outcome: rejected ? "rejected" : "succeeded",
                problem: rejected ? "incorrect-code" : null,
                state: rejected ? null : state(),
              },
            },
          });
        },
      );
      await page.goto("/settings/security");
      const tour = page.getByRole("button", { name: "Dismiss workspace tour" });
      if (await tour.isVisible()) await tour.click();
      const controls = page.getByRole("region", {
        name: "Authenticator app",
        exact: true,
      });
      await expect(
        controls.getByRole("button", {
          name: "Set up authenticator",
          exact: true,
        }),
      ).toBeEnabled();
      await controls
        .getByRole("checkbox", { name: /saved the recovery contact/u })
        .check();
      await controls
        .getByRole("button", { name: "Set up authenticator", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(controls.getByLabel("Authenticator setup key")).toHaveValue(
        secretCode,
      );
      await controls.getByLabel("Authenticator code").fill("000000");
      await controls
        .getByRole("button", { name: "Verify and enable authenticator" })
        .click();
      await expect(
        controls.getByText(/That code was not accepted/u),
      ).toBeVisible();
      await expect(controls.getByLabel("Authenticator code")).toHaveValue("");
      await controls.getByLabel("Authenticator code").fill("123456");
      await controls
        .getByRole("button", { name: "Verify and enable authenticator" })
        .click();
      await expect(
        controls.getByText(/Authenticator enabled\./u),
      ).toBeVisible();
      await expect(controls.getByLabel("Authenticator setup key")).toHaveCount(
        0,
      );
      expect(
        await page.evaluate(
          (value) =>
            JSON.stringify(localStorage).includes(value) ||
            JSON.stringify(sessionStorage).includes(value),
          secretCode,
        ),
      ).toBe(false);
      await page.addScriptTag({ content: axe.source });
      expect(
        await page.evaluate(async () =>
          (
            await (
              globalThis as typeof globalThis & { axe: typeof axe }
            ).axe.run(document, {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            })
          ).violations.map((v) => v.id),
        ),
      ).toEqual([]);
      await controls.scrollIntoViewIfNeeded();
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath("account-authenticator-" + theme + ".png"),
      });
      await controls
        .getByRole("checkbox", {
          name: /removes the authenticator requirement/u,
        })
        .check();
      await controls
        .getByRole("button", { name: "Disable authenticator" })
        .click();
      await expect(
        controls.getByText(/Authenticator disabled\./u),
      ).toBeVisible();
      expect(actions).toEqual([
        "start",
        "verify-enable",
        "verify-enable",
        "disable",
      ]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(browserErrors).toEqual([]);
    },
  );
}
