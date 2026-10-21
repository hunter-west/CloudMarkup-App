import { expect, test } from "@playwright/test";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { getArchitectureDocumentContentHash } from "@cloudmarkup/domain";

import { loadStableConnectionDockVisualArchitectureDocument } from "../src/provider-catalog/aws-editor-fixture.js";
import { TypedBackendApiHarness } from "./support/typed-backend-api-harness.js";

test.skip(
  process.env["CLOUDMARKUP_DESKTOP_PRODUCTION_E2E"] !== "true",
  "Uses the local production fixture and intercepted synthetic APIs.",
);

async function installLocalBoundary(
  context: BrowserContext,
  origin: string,
): Promise<void> {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) await route.abort();
    else if (url.pathname === "/api/runtime-config")
      await route.fulfill(
        url.searchParams.get("view") === "account"
          ? {
              json: {
                schemaVersion: 1,
                managedLogin: true,
                registrationEnabled: false,
              },
            }
          : { status: 503, json: {} },
      );
    else if (url.pathname === "/api/auth/session/v1/restore")
      await route.fulfill({
        json: {
          schemaVersion: 1,
          accessToken: `${"a".repeat(48)}.${"b".repeat(48)}.${"c".repeat(48)}`,
          expiresIn: 1800,
          sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      });
    else if (url.pathname.startsWith("/api/"))
      await route.fulfill({ status: 503, json: {} });
    else await route.fallback();
  });
}

async function measureControl(node: Locator, info: TestInfo, name: string) {
  const metrics = await node.evaluate((element) => {
    const toggle = element.querySelector(".architecture-service-toggle");
    const title = element.querySelector(".architecture-node__title strong");
    if (toggle === null || title === null)
      throw Error("Missing service controls");
    const button = toggle.getBoundingClientRect();
    const card = element.getBoundingClientRect();
    const label = title.getBoundingClientRect();
    const intersects = (a: DOMRect, b: DOMRect) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const hit = document.elementFromPoint(
      button.x + button.width / 2,
      button.y + button.height / 2,
    );
    return {
      collapsed: element.dataset["collapsed"] === "true",
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
      coarse: matchMedia("(pointer: coarse)").matches,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      card: card.toJSON() as {
        x: number;
        y: number;
        width: number;
        height: number;
      },
      button: button.toJSON() as {
        x: number;
        y: number;
        width: number;
        height: number;
      },
      titleFits: title.scrollWidth <= title.clientWidth + 1,
      titleOverlap: intersects(label, button),
      dockOverlap: Array.from(
        element.querySelectorAll(
          ".architecture-connection-dock--aggregate .cm-popover__trigger",
        ),
      ).some((dock) => intersects(dock.getBoundingClientRect(), button)),
      hit: hit !== null && (hit === toggle || toggle.contains(hit)),
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  await info.attach(name, {
    body: JSON.stringify(metrics),
    contentType: "application/json",
  });
  expect(metrics.viewport).toEqual({
    ...info.project.use.viewport,
    dpr: info.project.use.deviceScaleFactor,
  });
  expect(metrics.button.width).toBeGreaterThanOrEqual(metrics.coarse ? 44 : 31);
  expect(metrics.button.height).toBeGreaterThanOrEqual(
    metrics.coarse ? 44 : 31,
  );
  expect(
    Math.abs(
      metrics.button.x +
        metrics.button.width / 2 -
        (metrics.card.x + metrics.card.width / 2),
    ),
  ).toBeLessThanOrEqual(1);
  expect(metrics.button.y + metrics.button.height / 2).toBeGreaterThan(
    metrics.card.y + metrics.card.height * 0.5,
  );
  if (metrics.collapsed) {
    expect(metrics.button.x + metrics.button.width).toBeLessThanOrEqual(
      metrics.card.x + metrics.card.width + 1,
    );
    expect(metrics.button.y + metrics.button.height).toBeLessThanOrEqual(
      metrics.card.y + metrics.card.height + 1,
    );
  }
  expect(metrics.titleFits).toBe(true);
  expect(metrics.titleOverlap).toBe(false);
  expect(metrics.dockOverlap).toBe(false);
  expect(metrics.hit).toBe(true);
  expect(metrics.button.x).toBeGreaterThanOrEqual(-1);
  expect(metrics.button.y).toBeGreaterThanOrEqual(-1);
  expect(metrics.button.x + metrics.button.width).toBeLessThanOrEqual(
    metrics.viewport.width + 1,
  );
  expect(metrics.button.y + metrics.button.height).toBeLessThanOrEqual(
    metrics.viewport.height + 1,
  );
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport.width + 1);
  return metrics;
}

async function setMode(page: Page, mode: "Guided" | "Professional") {
  await page.getByRole("link", { name: "Skip to workspace status" }).focus();
  await page.keyboard.press("Enter");
  const status = page.getByRole("dialog", { name: "Project status" });
  await status.getByRole("button", { name: mode, exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(status).toHaveCount(0);
}

async function revealFullCard(page: Page, node: Locator) {
  for (
    let step = 0;
    step < 5 && (await node.getAttribute("data-overview-tile")) === "true";
    step++
  )
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(node).toHaveAttribute("data-overview-tile", "false");
}

for (const hasTouch of [false, true]) {
  test.describe(hasTouch ? "Coarse pointer" : "Desktop pointer", () => {
    test.use({ hasTouch });
    test("keeps connected service expansion at the card edge through motion, repeat and back navigation", async ({
      context,
      page,
      baseURL,
    }, info) => {
      if (baseURL === undefined) throw Error("Missing local preview URL");
      await installLocalBoundary(context, new URL(baseURL).origin);
      const api = new TypedBackendApiHarness({ role: "owner" });
      await api.install(context);
      const graph = loadStableConnectionDockVisualArchitectureDocument();
      api.seedArchitecture("project_notes", graph);
      const editorPath =
        "/organizations/org_local/projects/project_notes/editor";
      await page.goto(editorPath);
      const editor = page.locator(".architecture-editor");
      const hash = getArchitectureDocumentContentHash(graph);
      await expect(editor).toHaveAttribute("data-content-hash", hash);
      const dismiss = page.getByRole("button", {
        name: "Dismiss",
        exact: true,
      });
      if (await dismiss.isVisible()) await dismiss.click();
      const node = page.locator(
        '.architecture-node--service[data-architecture-node-id="node_api_handler"]',
      );
      await revealFullCard(page, node);
      const toggle = node.locator(".architecture-service-toggle");
      const details = page.locator(
        '[data-architecture-service-details-for="node_api_handler"]',
      );
      const viewport = page.locator(".react-flow__viewport");
      const controlId = await toggle.getAttribute("aria-controls");
      const anchorIds = await node
        .locator(".architecture-connection-anchor .react-flow__handle")
        .evaluateAll((elements) =>
          elements
            .map((element) => element.getAttribute("data-handleid"))
            .sort(),
        );
      expect(anchorIds.length).toBeGreaterThan(0);
      const edgeCount = await page.locator(".react-flow__edge-path").count();
      expect(edgeCount).toBeGreaterThan(0);
      for (const mode of ["Guided", "Professional"] as const) {
        await setMode(page, mode);
        await expect(editor).toHaveAttribute(
          "data-editor-mode",
          mode.toLowerCase(),
        );
        const collapsedMetrics = await measureControl(
          node,
          info,
          `${mode}-collapsed`,
        );
        expect(collapsedMetrics.coarse).toBe(hasTouch);
        if (mode === "Guided")
          await page.screenshot({ path: info.outputPath("collapsed.png") });
        for (let attempt = 0; attempt < 2; attempt++) {
          await page.emulateMedia({
            reducedMotion: attempt === 0 ? "no-preference" : "reduce",
          });
          const transformBefore = await viewport.evaluate(
            (element) => getComputedStyle(element).transform,
          );
          await toggle.focus();
          await toggle.press("Enter");
          await expect(toggle).toHaveAttribute("aria-expanded", "true");
          await expect(toggle).toBeFocused();
          await expect(details).toBeVisible();
          await expect
            .poll(() =>
              viewport.evaluate(
                (element) => getComputedStyle(element).transform,
              ),
            )
            .toBe(transformBefore);
          const motion = await details.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
              name: style.animationName,
              duration: style.animationDuration,
              easing: style.animationTimingFunction,
            };
          });
          await info.attach(`${mode}-${String(attempt)}-motion`, {
            body: JSON.stringify(motion),
            contentType: "application/json",
          });
          expect(motion.name).toBe(
            motion.reduced ? "none" : "architecture-service-open",
          );
          if (!motion.reduced) expect(motion.duration).toBe("0.16s");
          await expect
            .poll(async () =>
              details.evaluate((element) => element.getAnimations().length),
            )
            .toBe(0);
          await measureControl(
            node,
            info,
            `${mode}-${String(attempt)}-expanded`,
          );
          if (mode === "Guided" && attempt === 0)
            await page.screenshot({ path: info.outputPath("expanded.png") });
          await expect(toggle).toHaveAttribute(
            "aria-controls",
            controlId ?? "",
          );
          expect(
            await node
              .locator(".architecture-connection-anchor .react-flow__handle")
              .evaluateAll((elements) =>
                elements
                  .map((element) => element.getAttribute("data-handleid"))
                  .sort(),
              ),
          ).toEqual(anchorIds);
          await expect(page.locator(".react-flow__edge-path")).toHaveCount(
            edgeCount,
          );
          await toggle.press("Enter");
          await expect(toggle).toHaveAttribute("aria-expanded", "false");
          await expect(toggle).toBeFocused();
          await expect(details).toBeHidden();
          await expect(editor).toHaveAttribute("data-content-hash", hash);
        }
        // Cancel an opening immediately; reopening must still work with the same control.
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await toggle.press("Enter");
        await toggle.press("Enter");
        await expect(details).toBeHidden();
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await page
          .getByRole("button", { name: "Zoom in", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Zoom out", exact: true })
          .click();
        await measureControl(node, info, `${mode}-after-zoom`);
        await expect(editor).toHaveAttribute("data-content-hash", hash);
      }
      const panPoint = await page
        .locator(".react-flow__pane")
        .evaluate((element) => {
          const box = element.getBoundingClientRect();
          for (const y of [0.5, 0.65, 0.8])
            for (const x of [0.4, 0.5, 0.6]) {
              const point = {
                x: box.x + box.width * x,
                y: box.y + box.height * y,
              };
              if (document.elementFromPoint(point.x, point.y) === element)
                return point;
            }
          return null;
        });
      if (panPoint === null) throw Error("No unobstructed canvas pan point");
      const beforePan = await node.boundingBox();
      await page.mouse.move(panPoint.x, panPoint.y);
      await page.mouse.down();
      await page.mouse.move(panPoint.x + 24, panPoint.y + 16, { steps: 4 });
      await page.mouse.up();
      await expect
        .poll(async () => (await node.boundingBox())?.x)
        .not.toBe(beforePan?.x);
      await measureControl(node, info, "after-pan");
      await expect(editor).toHaveAttribute("data-content-hash", hash);
      await page.goto("/organizations/org_local/projects");
      await page.goBack();
      await expect(
        page.getByText("Read-only project", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      // A document navigation preserves the server reservation. Recover through
      // the existing public action after only this synthetic lease expires.
      api.expireEditingLease("project_notes");
      await page
        .getByRole("button", { name: "Try editing", exact: true })
        .click();
      await expect(editor).toHaveAttribute("data-content-hash", hash, {
        timeout: 30_000,
      });
      await revealFullCard(page, node);
      await measureControl(node, info, "after-back-recovery");
      await expect(toggle).toBeVisible();
      if (hasTouch) await toggle.tap();
      else await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      if (hasTouch) await toggle.tap();
      else await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(editor).toHaveAttribute("data-content-hash", hash);
    });
  });
}
