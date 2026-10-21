import { expect, test } from "@playwright/test";
import axe from "axe-core";

import {
  TypedBackendApiHarness,
  TYPED_BACKEND_NOTES_PROJECT_ID,
  TYPED_BACKEND_ORGANIZATION_ID,
} from "../e2e/support/typed-backend-api-harness.js";

// Retain wide/tablet/minimum-phone layout plus every distinct accessibility override.
// Normal palette and intermediate viewport coverage also lives in the browser suites.
const profiles = [
  { width: 2000, height: 1000, theme: "light" },
  { width: 768, height: 1024, theme: "dark" },
  { width: 320, height: 740, theme: "dark" },
  { width: 1440, height: 960, theme: "light", forcedColors: true },
  { width: 1440, height: 960, theme: "dark", opaque: true },
  { width: 1024, height: 768, theme: "light", zoomReflow: true },
  { width: 1440, height: 960, theme: "dark", textSpacing: true },
] as const;

const textSpacingOverride =
  "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }";

for (const profile of profiles) {
  test.describe(`surface profile ${JSON.stringify(profile)}`, () => {
    test.use({
      contextOptions: {
        deviceScaleFactor: "zoomReflow" in profile ? 2 : 1,
        reducedMotion: "reduce",
      },
    });
    test(`premium surfaces ${JSON.stringify(profile)}`, async ({
      context,
      page,
    }, testInfo) => {
      await page.setViewportSize({
        width: "zoomReflow" in profile ? profile.width / 2 : profile.width,
        height: "zoomReflow" in profile ? profile.height / 2 : profile.height,
      });
      await context.addInitScript((theme) => {
        localStorage.setItem("cloudmarkup.appearance.v1", theme);
        localStorage.setItem(
          "cloudmarkup.workspace-tour.v1.principal_local_owner",
          "complete",
        );
      }, profile.theme);
      const api = new TypedBackendApiHarness();
      await api.install(context);
      await context.route("**/api/auth/session/v1/restore", (route) =>
        route.fulfill({ status: 401 }),
      );
      if ("forcedColors" in profile)
        await page.emulateMedia({ forcedColors: "active" });
      if ("opaque" in profile) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setEmulatedMedia", {
          features: [
            { name: "prefers-reduced-transparency", value: "reduce" },
            { name: "prefers-reduced-motion", value: "reduce" },
            { name: "prefers-color-scheme", value: profile.theme },
          ],
        });
      }
      const root = `/organizations/${TYPED_BACKEND_ORGANIZATION_ID}`;
      await page.goto(`${root}/dashboard`);
      await expect(
        page.getByRole("heading", { name: "Dashboard", exact: true }),
      ).toBeVisible();
      const tour = page.getByRole("button", { name: "Dismiss workspace tour" });
      if (await tour.isVisible()) await tour.click();
      if ("textSpacing" in profile) {
        await page.addStyleTag({ content: textSpacingOverride });
        const spacing = await page
          .getByRole("heading", { name: "Dashboard", exact: true })
          .evaluate((heading) => {
            const style = getComputedStyle(heading);
            return {
              font: parseFloat(style.fontSize),
              line: parseFloat(style.lineHeight),
              letter: parseFloat(style.letterSpacing),
              word: parseFloat(style.wordSpacing),
            };
          });
        expect(spacing.line).toBeCloseTo(spacing.font * 1.5, 3);
        expect(spacing.letter).toBeCloseTo(spacing.font * 0.12, 3);
        expect(spacing.word).toBeCloseTo(spacing.font * 0.16, 3);
      }
      if ("zoomReflow" in profile) {
        // Context pixel scale plus the smaller CSS viewport models 200% reflow.
        // Native browser zoom and assistive technology remain manual acceptance.
        expect(
          await page.evaluate(() => ({
            width: innerWidth,
            scale: devicePixelRatio,
          })),
        ).toEqual({ width: profile.width / 2, scale: 2 });
      }
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() => document.activeElement !== document.body),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("dashboard.png"),
        fullPage: true,
      });
      await page.addScriptTag({ content: axe.source });
      const dashboardA11y = await page.evaluate(async () => {
        const result = await (window as unknown as { axe: typeof axe }).axe.run(
          document,
          {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          },
        );
        return result.violations.map(({ id, impact, nodes }) => ({
          id,
          impact,
          count: nodes.length,
        }));
      });
      expect(dashboardA11y).toEqual([]);
      await page.goto(
        `${root}/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/editor`,
      );
      const editor = page.locator(".architecture-editor");
      await expect(editor).toBeVisible();
      const walkthrough = page
        .locator(".guided-walkthrough")
        .getByRole("button", { name: "Dismiss", exact: true });
      if (await walkthrough.isVisible()) await walkthrough.click();
      if ("textSpacing" in profile)
        await page.addStyleTag({ content: textSpacingOverride });
      const content = await editor.getAttribute("data-content-hash");
      const visual = await editor.getAttribute("data-visual-hash");
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("editor.png"),
        fullPage: true,
      });
      await expect(editor).toHaveAttribute("data-content-hash", content ?? "");
      await expect(editor).toHaveAttribute("data-visual-hash", visual ?? "");
      expect(
        api.latestDraftSave(TYPED_BACKEND_NOTES_PROJECT_ID),
      ).toBeUndefined();
      const media = await page.evaluate(() => ({
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        reducedTransparency: matchMedia(
          "(prefers-reduced-transparency: reduce)",
        ).matches,
        forcedColors: matchMedia("(forced-colors: active)").matches,
      }));
      expect(media.reducedMotion).toBe(true);
      if ("opaque" in profile) expect(media.reducedTransparency).toBe(true);
      if ("forcedColors" in profile) expect(media.forcedColors).toBe(true);
      await testInfo.attach("surface-observation", {
        contentType: "application/json",
        body: JSON.stringify(
          {
            profile,
            dashboardA11y,
            media,
            requests: api.requests.map(({ method, path }) => ({
              method,
              path,
            })),
          },
          null,
          2,
        ),
      });
    });
  });
}

test("reserves loading space while the synthetic editor draft is pending", async ({
  context,
  page,
}, testInfo) => {
  await new TypedBackendApiHarness().install(context);
  await context.route("**/api/auth/session/v1/restore", (route) =>
    route.fulfill({ status: 401 }),
  );
  let releaseDraft: (() => void) | undefined;
  const draftReady = new Promise<void>((resolve) => {
    releaseDraft = resolve;
  });
  await context.route(
    `**/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/draft`,
    async (route) => {
      if (route.request().method() === "GET") await draftReady;
      await route.fallback();
    },
  );
  try {
    await page.goto(
      `/organizations/${TYPED_BACKEND_ORGANIZATION_ID}/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/editor`,
      { waitUntil: "commit" },
    );
    const loading = page.locator(".route-loading-indicator");
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute("role", "status");
    await expect(
      loading.locator(".route-loading-indicator__spinner"),
    ).toHaveCSS("animation-name", "none");
    expect((await loading.boundingBox())?.height).toBeGreaterThanOrEqual(120);
    await page.screenshot({ path: testInfo.outputPath("pending-editor.png") });
  } finally {
    releaseDraft?.();
  }
  await expect(page.locator(".architecture-editor")).toBeVisible();
});
