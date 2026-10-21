import { expect, test } from "@playwright/test";
import axe from "axe-core";
test.skip(
  process.env["CLOUDMARKUP_ACCOUNT_ACCESS_E2E"] !== "true",
  "Uses the local production build with synthetic account capabilities.",
);
for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(
      "branded account signup gate and recovery in " +
        theme +
        " at " +
        String(width),
      async ({ context, page }, testInfo) => {
        await page.setViewportSize({ width, height: 960 });
        await context.addInitScript((value) => {
          localStorage.setItem("cloudmarkup.appearance.v1", value);
        }, theme);
        let enabled = false;
        await context.route("**/*", async (route) => {
          const url = new URL(route.request().url());
          if (url.origin !== "http://127.0.0.1:4187") {
            await route.abort();
            return;
          }
          if (
            url.pathname === "/api/runtime-config" &&
            url.searchParams.get("view") === "account"
          ) {
            await route.fulfill({
              json: {
                schemaVersion: 1,
                managedLogin: true,
                registrationEnabled: enabled,
              },
            });
            return;
          }
          if (url.pathname.startsWith("/api/")) {
            await route.fulfill({
              status: 401,
              json: {
                error: {
                  code: "authentication_required",
                  message: "Synthetic unauthenticated browser",
                },
                contractVersion: 1,
              },
            });
            return;
          }
          await route.continue();
        });
        await page.goto("/");
        await expect(
          page.getByRole("heading", {
            name: "From the big idea to the right details.",
          }),
        ).toBeVisible();
        const signup = page
          .locator(".landing__actions")
          .getByRole("link", { name: "Create an account" });
        await expect(signup).toHaveAttribute("href", "/signup");
        await expect(signup).toBeInViewport();
        expect((await signup.boundingBox())?.height).toBeGreaterThanOrEqual(56);
        await expect(
          page.getByRole("link", { name: "Sign in to your workspace" }),
        ).toHaveAttribute("href", "/login");
        const landingAccessibility = await page.evaluate(async (source) => {
          window.eval(source);
          return await (window as unknown as { axe: typeof axe }).axe.run(
            document,
            { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } },
          );
        }, axe.source);
        expect(landingAccessibility.violations).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(
            "landing-" + theme + "-" + String(width) + ".png",
          ),
          fullPage: true,
        });
        await page.goto("/login?returnTo=%2Fsettings%2Fsecurity");
        await page.reload();
        await expect(
          page.getByRole("heading", {
            name: "Sign in to CloudMarkup",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Sign in securely" }),
        ).toBeEnabled();
        await page.screenshot({
          path: testInfo.outputPath(
            "login-" + theme + "-" + String(width) + ".png",
          ),
          fullPage: true,
        });
        await page.evaluate(() => {
          window.open = () => null;
        });
        await page.getByRole("button", { name: "Sign in securely" }).click();
        await expect(page.getByRole("alert")).toContainText(
          "Allow popups for this site",
        );
        await page
          .getByRole("link", { name: "Create an account", exact: true })
          .click();
        await expect(page).toHaveURL(/\/signup\?returnTo=/u);
        await page.reload();
        await expect(
          page.getByRole("heading", {
            name: "CloudMarkup account registration",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByText(/New account registration is temporarily closed/u),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Registration closed" }),
        ).toBeDisabled();
        await expect(
          page.getByRole("link", { name: "Help center" }),
        ).toHaveAttribute("href", "https://support.cloudmarkup.com/");
        await expect(
          page.getByText(/Create an independent account/u),
        ).toHaveCount(0);
        const results = await page.evaluate(async (source) => {
          window.eval(source);
          return await (window as unknown as { axe: typeof axe }).axe.run(
            document,
            { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } },
          );
        }, axe.source);
        expect(results.violations).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        if (width === 390) {
          const button = await page
            .getByRole("button", { name: "Registration closed" })
            .boundingBox();
          expect(button?.y).toBeLessThan(900);
        }
        await expect(
          page.getByText("Invite-only beta", { exact: true }),
        ).toHaveCount(0);
        await page.screenshot({
          path: testInfo.outputPath(
            "signup-" + theme + "-" + String(width) + ".png",
          ),
          fullPage: true,
        });
        const recover = page.getByRole("link", {
          name: "Forgot your password?",
        });
        await recover.focus();
        await page.keyboard.press("Enter");
        await expect(
          page.getByRole("heading", {
            name: "Recover your account",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Reset password securely" }),
        ).toBeEnabled();
        await page.screenshot({
          path: testInfo.outputPath(
            "recovery-" + theme + "-" + String(width) + ".png",
          ),
          fullPage: true,
        });
        await expect(
          page.getByRole("link", { name: "Already have an account? Sign in" }),
        ).toHaveAttribute("href", "/login?returnTo=%2Fsettings%2Fsecurity");
        enabled = true;
        await page
          .getByRole("link", { name: "Create an account", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Create account securely" }),
        ).toBeEnabled();
        await expect(
          page.getByText(/Your account starts with a private workspace/u),
        ).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath(
            "signup-open-" + theme + "-" + String(width) + ".png",
          ),
          fullPage: true,
        });
      },
    );
  }
}
