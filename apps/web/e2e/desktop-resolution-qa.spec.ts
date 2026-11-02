import { expect, test } from "@playwright/test";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { getArchitectureDocumentContentHash } from "@cloudmarkup/domain";

import { loadAwsEditorArchitectureDocument } from "../src/provider-catalog/aws-editor-fixture.js";

import {
  TYPED_BACKEND_ORGANIZATION_ID,
  TYPED_BACKEND_NOTES_PROJECT_ID,
  TypedBackendApiHarness,
} from "./support/typed-backend-api-harness.js";

const origin = "http://127.0.0.1:4189";
const organization = `/organizations/${TYPED_BACKEND_ORGANIZATION_ID}`;

test.skip(
  process.env["CLOUDMARKUP_DESKTOP_PRODUCTION_E2E"] !== "true",
  "Uses the local production preview and synthetic desktop QA transport.",
);

async function installLocalBoundary(context: BrowserContext): Promise<void> {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      await route.abort();
    } else if (url.pathname === "/api/runtime-config") {
      if (url.searchParams.get("view") === "account") {
        await route.fulfill({
          json: {
            schemaVersion: 1,
            managedLogin: true,
            registrationEnabled: false,
          },
        });
      } else {
        // Optional remote AI/export capabilities are intentionally unavailable.
        await route.fulfill({ status: 503, json: {} });
      }
    } else if (url.pathname === "/api/auth/session/v1/restore") {
      await route.fulfill({
        json: {
          schemaVersion: 1,
          accessToken: `${"a".repeat(48)}.${"b".repeat(48)}.${"c".repeat(48)}`,
          expiresIn: 1800,
          sessionExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      });
    } else if (url.pathname.startsWith("/api/")) {
      // A wrong build/API prefix fails locally, never reaching live services.
      await route.fulfill({ status: 503, json: {} });
    } else {
      await route.fallback();
    }
  });
}

async function withinViewport(locator: Locator, page: Page): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw Error("Missing rendered bounds");
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function usableControl(locator: Locator, page: Page): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await withinViewport(locator, page);
  const size = await locator.boundingBox();
  if (size === null) throw Error("Missing control bounds");
  expect(size.width).toBeGreaterThanOrEqual(24);
  expect(size.height).toBeGreaterThanOrEqual(24);
  expect(
    await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
      return hit !== null && (element === hit || element.contains(hit));
    }),
  ).toBe(true);
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  const measurements = await page.evaluate(() => ({
    cssViewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio,
    pageScrollHeight: document.documentElement.scrollHeight,
    pageScrollWidth: document.documentElement.scrollWidth,
    visualViewportScale: window.visualViewport?.scale ?? null,
  }));
  expect(measurements.cssViewport).toEqual(testInfo.project.use.viewport);
  expect(measurements.devicePixelRatio).toBe(
    testInfo.project.use.deviceScaleFactor,
  );
  await testInfo.attach(`${name}-measurements`, {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test.beforeEach(async ({ context }) => {
  await installLocalBoundary(context);
});

// These labels all relabel the same Lambda card. Keep long role, origin and delivery text.
for (const label of [
  "Worker execution role",
  "Private site origin",
  "Static site delivery",
]) {
  test(`keeps collapsed service identity readable: ${label}`, async ({
    context,
    page,
  }, testInfo) => {
    const api = new TypedBackendApiHarness({ role: "owner" });
    await api.install(context);
    const fixture = loadAwsEditorArchitectureDocument();
    const graph = {
      ...fixture,
      nodes: fixture.nodes.map((node) =>
        node.id === "node_api_handler"
          ? { ...node, presentation: { ...node.presentation, label } }
          : node,
      ),
    };
    api.seedArchitecture(TYPED_BACKEND_NOTES_PROJECT_ID, graph);
    await page.goto(
      `${organization}/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/editor`,
    );
    const editor = page.locator(".architecture-editor");
    const contentHash = getArchitectureDocumentContentHash(graph);
    await expect(editor).toHaveAttribute("data-content-hash", contentHash);
    const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    const node = page.locator(
      '.architecture-node--service[data-architecture-node-id="node_api_handler"]',
    );
    for (
      let step = 0;
      step < 5 && (await node.getAttribute("data-overview-tile")) === "true";
      step += 1
    ) {
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    }
    await expect(node).toHaveAttribute("data-overview-tile", "false");
    const title = node.locator(".architecture-node__title strong");
    for (const mode of ["Guided", "Professional"]) {
      const statusLink = page.getByRole("link", {
        name: "Skip to workspace status",
      });
      await statusLink.focus();
      await statusLink.press("Enter");
      const status = page.getByRole("dialog", { name: "Project status" });
      await status.getByRole("button", { name: mode, exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(status).toHaveCount(0);
      await expect(editor).toHaveAttribute(
        "data-editor-mode",
        mode.toLowerCase(),
      );
      await expect(title).toHaveText(label);
      await expect(node).toHaveAttribute("data-collapsed", "true");
      const metrics = await title.evaluate((element) => {
        const titleBox = element.getBoundingClientRect();
        const nodeBox = element.closest("article")?.getBoundingClientRect();
        const toggleBox = element
          .closest("article")
          ?.querySelector(".architecture-service-toggle")
          ?.getBoundingClientRect();
        return {
          cssViewport: { width: innerWidth, height: innerHeight },
          devicePixelRatio,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
          lineHeight: getComputedStyle(element).lineHeight,
          titleRect: {
            top: titleBox.top,
            right: titleBox.right,
            bottom: titleBox.bottom,
            left: titleBox.left,
          },
          nodeRect:
            nodeBox === undefined
              ? undefined
              : {
                  top: nodeBox.top,
                  right: nodeBox.right,
                  bottom: nodeBox.bottom,
                  left: nodeBox.left,
                },
          toggleRect:
            toggleBox === undefined
              ? undefined
              : {
                  top: toggleBox.top,
                  right: toggleBox.right,
                  bottom: toggleBox.bottom,
                  left: toggleBox.left,
                  width: toggleBox.width,
                  height: toggleBox.height,
                },
        };
      });
      await testInfo.attach(`${mode}-label-metrics`, {
        body: JSON.stringify(metrics),
        contentType: "application/json",
      });
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
      expect(metrics.scrollHeight).toBeLessThanOrEqual(
        metrics.clientHeight + 1,
      );
      expect(metrics.toggleRect).toBeDefined();
      if (metrics.toggleRect === undefined)
        throw Error("Missing expand control");
      if (metrics.nodeRect === undefined)
        throw Error("Missing normal card bounds");
      expect(metrics.toggleRect.width).toBeGreaterThanOrEqual(31);
      expect(metrics.toggleRect.height).toBeGreaterThanOrEqual(31);
      expect(metrics.toggleRect.bottom).toBeLessThanOrEqual(
        metrics.nodeRect.bottom + 1,
      );
      expect(metrics.titleRect.top).toBeGreaterThanOrEqual(
        metrics.nodeRect.top - 1,
      );
      expect(
        Math.min(metrics.titleRect.right, metrics.toggleRect.right) -
          Math.max(metrics.titleRect.left, metrics.toggleRect.left) >
          1 &&
          Math.min(metrics.titleRect.bottom, metrics.toggleRect.bottom) -
            Math.max(metrics.titleRect.top, metrics.toggleRect.top) >
            1,
      ).toBe(false);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await node.getByRole("button", { name: `Expand ${label}` }).click();
        await expect(node).toHaveAttribute("data-collapsed", "false");
        await node.getByRole("button", { name: `Collapse ${label}` }).click();
        await expect(node).toHaveAttribute("data-collapsed", "true");
      }
      await expect(editor).toHaveAttribute("data-content-hash", contentHash);
    }
    await capture(page, testInfo, "collapsed-service-label");
  });
}

test("production account entry, text, disclosure and back navigation fit", async ({
  context,
  page,
}, testInfo) => {
  // Entry pages now route an existing verified session to its workspace.
  await context.route("**/api/auth/session/v1/restore", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  await page.goto("/sign-in?returnTo=%2Fsettings%2Fsecurity");
  const signIn = page.getByRole("button", { name: "Sign in securely" });
  await usableControl(signIn, page);
  await withinViewport(
    page.getByRole("heading", { name: "Sign in to CloudMarkup", exact: true }),
    page,
  );
  await page.getByText("Security details", { exact: true }).click();
  await expect(
    page.getByText(/unfinished attempts expire after 10 minutes/u),
  ).toBeVisible();
  await capture(page, testInfo, "account-entry");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(
    page.getByRole("heading", { name: "Recover your account", exact: true }),
  ).toBeVisible();
  await usableControl(
    page.getByRole("button", { name: "Reset password securely" }),
    page,
  );
  await page.goBack();
  await expect(signIn).toBeEnabled();
  await page
    .getByRole("link", { name: "Create an account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Registration closed" }),
  ).toBeDisabled();
  await page.goBack();
  await expect(signIn).toBeEnabled();
});

test("production workspace, overlays, catalog, inspector and return paths fit", async ({
  context,
  page,
}, testInfo) => {
  const api = new TypedBackendApiHarness({ role: "owner" });
  await api.install(context);
  await page.goto(`${organization}/dashboard`);
  const dashboard = page.getByRole("heading", {
    name: "Dashboard",
    exact: true,
  });
  await expect(dashboard).toBeVisible();
  const dismissTour = page.getByRole("button", {
    name: "Dismiss workspace tour",
  });
  if (await dismissTour.isVisible()) await dismissTour.click();
  await capture(page, testInfo, "dashboard");
  const accountTrigger = page.getByRole("button", {
    name: "Open authenticated account",
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await usableControl(accountTrigger, page);
    await accountTrigger.click();
    const account = page.getByRole("dialog", { name: "Authenticated account" });
    await withinViewport(account, page);
    await account.getByRole("button", { name: /^Notifications/u }).click();
    await withinViewport(
      page.getByRole("dialog", { name: "Notifications" }),
      page,
    );
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Notifications" }),
    ).toHaveCount(0);
    await expect(accountTrigger).toBeFocused();
  }
  const navigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  await navigation.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(dashboard).toBeVisible();
  await navigation.getByRole("link", { name: "Projects", exact: true }).click();
  const projectCard = page
    .getByRole("listitem")
    .filter({ hasText: "Notes API" });
  await projectCard.getByRole("link", { name: "Open project" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Notes API" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open canvas" }).click();
  const editor = page.locator(".architecture-editor");
  await expect(editor).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Saved.*server draft version/u })
      .first(),
  ).toBeVisible();
  const contentHash = await editor.getAttribute("data-content-hash");
  const search = page.getByRole("searchbox", { name: "Search services" });
  await search.fill("Lambda function");
  const detailsTrigger = page.getByRole("button", {
    name: "Show details for Lambda function",
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await usableControl(detailsTrigger, page);
    await detailsTrigger.click();
    const details = page.getByRole("dialog", {
      name: "Lambda function details",
    });
    await withinViewport(details, page);
    if (attempt === 0) await capture(page, testInfo, "catalog-details");
    await details
      .getByRole("button", { name: "Close details for Lambda function" })
      .click();
    await expect(details).toHaveCount(0);
    await expect(detailsTrigger).toBeFocused();
  }
  await search.clear();
  const canvasTrigger = page.getByRole("button", { name: "Open Canvas menu" });
  await usableControl(canvasTrigger, page);
  await canvasTrigger.click();
  await page
    .getByRole("dialog", { name: "Canvas actions" })
    .getByRole("button", { name: "Fit architecture" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Canvas actions" }),
  ).toHaveCount(0);
  await withinViewport(page.locator(".react-flow"), page);
  const dismissEditorTour = page.getByRole("button", {
    name: "Dismiss",
    exact: true,
  });
  if (await dismissEditorTour.isVisible()) await dismissEditorTour.click();
  const apiNode = page.locator(".react-flow").getByRole("group", {
    name: /^Notes API handler\./u,
  });
  await apiNode.focus();
  await apiNode.press("Enter");
  const configureTrigger = page
    .getByRole("navigation", { name: "Inspector tools" })
    .getByRole("button", { name: "Configure" });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await usableControl(configureTrigger, page);
    const inspector = page.getByRole("dialog", { name: "Configure inspector" });
    if (!(await inspector.isVisible())) await configureTrigger.click();
    await withinViewport(inspector, page);
    if (attempt === 0) {
      await capture(page, testInfo, "editor-inspector");
      await inspector.getByText(/^Optional settings \(/u).click();
      const functionName = inspector.getByLabel(/^Function name/u);
      await usableControl(functionName, page);
      await expect(functionName).toHaveValue("notes-api-handler");
      await inspector.getByText(/^Fixed settings \(/u).click();
      const runtime = inspector.getByLabel(/^Runtime/u);
      await expect(runtime).toBeVisible();
      await expect(runtime).toHaveText("nodejs24.x");
      await capture(page, testInfo, "inspector-scrolled");
    }
    await page.keyboard.press("Escape");
    await expect(inspector).toHaveCount(0);
  }
  const helpTrigger = page.getByRole("button", {
    name: "Help and keyboard shortcuts",
  });
  await usableControl(helpTrigger, page);
  await helpTrigger.click();
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await withinViewport(help, page);
  await capture(page, testInfo, "keyboard-dialog");
  await help.getByRole("button", { name: "Close", exact: true }).click();
  await expect(help).toHaveCount(0);
  await expect(helpTrigger).toBeFocused();
  await expect(editor).toHaveAttribute("data-content-hash", contentHash ?? "");
  await page.goBack();
  await expect(
    page.getByRole("heading", { level: 1, name: "Notes API" }),
  ).toBeVisible();
  await page.goForward();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(editor).toHaveAttribute("data-content-hash", contentHash ?? "");
  await expect(search).toBeVisible();
});
