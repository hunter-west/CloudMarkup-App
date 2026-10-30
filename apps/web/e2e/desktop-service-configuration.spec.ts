import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

async function selectProfileAppearance(page: Page, theme: "dark" | "light") {
  const editorUrl = page.url();
  await page.getByRole("button", { name: "Open local mock account" }).click();
  const account = page.getByRole("dialog", { name: "Local mock account" });
  await account.getByRole("link", { name: "Preferences" }).click();
  const appearance = page.getByRole("combobox", {
    name: "Appearance",
    exact: true,
  });
  await expect(appearance).toBeVisible();
  await appearance.selectOption(theme);
  await page.goto(editorUrl);
  await expect(page.locator(".architecture-editor")).toBeVisible();
}

async function readViewport(viewport: Locator) {
  return viewport.evaluate((element) => {
    const transform = new DOMMatrixReadOnly(
      getComputedStyle(element).transform,
    );
    return { x: transform.e, y: transform.f, zoom: transform.a };
  });
}

async function expectExpandedServiceFits(
  page: Page,
  node: Locator,
  expectedViewport: { x: number; y: number; zoom: number },
) {
  const canvas = page.locator(".architecture-canvas__flow");
  const viewport = page.locator(".react-flow__viewport");
  await expect
    .poll(async () => {
      const [card, bounds, current] = await Promise.all([
        node.boundingBox(),
        canvas.boundingBox(),
        readViewport(viewport),
      ]);
      return (
        card !== null &&
        bounds !== null &&
        card.x >= bounds.x - 1 &&
        card.y >= bounds.y - 1 &&
        card.x + card.width <= bounds.x + bounds.width + 1 &&
        card.y + card.height <= bounds.y + bounds.height + 1 &&
        Math.abs(current.x - expectedViewport.x) < 0.01 &&
        Math.abs(current.y - expectedViewport.y) < 0.01 &&
        Math.abs(current.zoom - expectedViewport.zoom) < 0.00001
      );
    })
    .toBe(true);
  await expect(
    node.getByRole("button", { name: /^Collapse /u }),
  ).toBeInViewport();
}

test.use({ viewport: { width: 1440, height: 960 } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("cloudmarkup.appearance.v1"))
      localStorage.setItem("cloudmarkup.appearance.v1", "light");
    localStorage.setItem(
      "cloudmarkup.web.preferences.v1:local-mock-actor:experience-mode",
      "professional",
    );
    localStorage.setItem(
      "cloudmarkup.web.experience-preferences.v1:local-mock-actor",
      JSON.stringify({
        schemaVersion: 1,
        contextualTeachingEnabled: false,
        defaultRegion: "us-east-1",
        firstUseStatus: "completed",
        notesApiWalkthrough: "dismissed",
        preferredProvider: "aws",
        startChoice: "blank",
      }),
    );
  });
  await page.goto(
    "/organizations/local-org/projects/field-notes/editor?fixture=owned-configurations",
  );
  // Cold Vite resolves the deferred editor before configuration can initialize.
  await expect(page.locator(".architecture-editor")).toBeVisible({
    timeout: 30_000,
  });
});
test("one FSx entry exposes file systems in configuration", async ({
  page,
}) => {
  await page.getByRole("searchbox", { name: "Search services" }).fill("FSx");
  await expect(page.locator('[data-service-id^="aws.fsx."]')).toHaveCount(1);
  await page
    .getByRole("button", { name: "Set up Amazon FSx", exact: true })
    .click();
  const choice = page.getByRole("combobox", {
    name: "File system",
    exact: true,
  });
  await expect(choice.locator("option")).toHaveCount(4);
  await choice.selectOption("aws.fsx.windows-file-system");
  await expect(
    page.getByRole("dialog", { name: "Set up FSx for Windows File Server" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "File system", exact: true }),
  ).toHaveValue("aws.fsx.windows-file-system");
});
test("expands the service on canvas and prioritizes IAM permissions without metadata disclosures", async ({
  page,
}) => {
  const node = page.locator(
    '[data-architecture-node-id="node_iam_role_policy_fixture"]',
  );
  const viewport = page.locator(".react-flow__viewport");
  const initialViewport = await readViewport(viewport);
  const editor = page.locator(".architecture-editor");
  const contentHash = await editor.getAttribute("data-content-hash");
  const visualHash = await editor.getAttribute("data-visual-hash");
  const before = await node.boundingBox();
  if (!before) throw new Error("Expected a visible service");
  await node.dblclick({ force: true, position: { x: 10, y: 10 } });
  await expect(node).toHaveAttribute("data-collapsed", "false");
  await expectExpandedServiceFits(page, node, initialViewport);
  // Floating details leave the card, graph position, and viewport unchanged.
  await expect
    .poll(async () => (await node.boundingBox())?.width ?? 0)
    .toBeCloseTo(before.width, 1);
  const details = page.locator(
    '[data-architecture-service-details-for="node_iam_role_policy_fixture"]',
  );
  await expect(details).toBeVisible();
  const expanded = await node.boundingBox();
  const content = await details.boundingBox();
  const collapseControl = await node
    .getByRole("button", { name: /^Collapse /u })
    .boundingBox();
  if (!expanded || !content || !collapseControl)
    throw new Error("Expected an expanded service and collapse control");
  expect(collapseControl.x).toBeGreaterThan(expanded.x);
  expect(content.width).toBeGreaterThan(expanded.width);
  await node
    .getByRole("button", { name: /^Collapse /u })
    .click({ force: true });
  await expect(node).toHaveAttribute("data-collapsed", "true");
  await node.getByRole("button", { name: /^Expand /u }).click({ force: true });
  await expect(node).toHaveAttribute("data-collapsed", "false");
  await expectExpandedServiceFits(page, node, initialViewport);
  await expect(editor).toHaveAttribute("data-content-hash", contentHash ?? "");
  await expect(editor).toHaveAttribute("data-visual-hash", visualHash ?? "");
  await details.getByRole("button", { name: "Configure", exact: true }).click();
  await expect(
    page.getByText("Custom inline policies", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Target readiness", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page
      .locator("#responsive-inspector-panel summary")
      .filter({ hasText: /^Technical details$/u }),
  ).toHaveCount(0);
});
test.describe("configuration inspector containment", () => {
  test.use({ viewport: { width: 1440, height: 813 } });

  test("keeps generated policy details inside the inspector", async ({
    page,
  }) => {
    const node = page.locator(
      '[data-architecture-node-id="node_iam_role_policy_fixture"]',
    );
    await node.dblclick({ force: true, position: { x: 10, y: 10 } });
    await page
      .locator(
        '[data-architecture-service-details-for="node_iam_role_policy_fixture"]',
      )
      .getByRole("button", { name: "Configure", exact: true })
      .click();
    const inspector = page.getByRole("dialog", { name: "Configure inspector" });
    const configuration = inspector.locator(".owned-configuration");
    await expect(
      configuration.getByRole("heading", { name: "Custom inline policies" }),
    ).toBeVisible();
    expect(
      await configuration.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const [dialogBounds, contentBounds] = await Promise.all([
      inspector.boundingBox(),
      configuration.boundingBox(),
    ]);
    if (!dialogBounds || !contentBounds)
      throw new Error("Expected visible inspector and configuration bounds");
    expect(contentBounds.x + contentBounds.width).toBeLessThanOrEqual(
      dialogBounds.x + dialogBounds.width,
    );
  });
});

test.describe("expanded service safe area", () => {
  test.use({ viewport: { width: 2000, height: 1300 } });

  test("keeps a zoomed service readable without an inner scrollbar and exposes its collapse control", async ({
    page,
  }) => {
    const editor = page.locator(".architecture-editor");
    const node = page.locator(
      '[data-architecture-node-id="node_iam_role_policy_fixture"]',
    );
    const viewport = page.locator(".react-flow__viewport");
    const tools = page.getByRole("navigation", { name: "Workspace tools" });
    const visualHash = await editor.getAttribute("data-visual-hash");
    const contentHash = await editor.getAttribute("data-content-hash");
    const initialViewport = await readViewport(viewport);
    expect(initialViewport.zoom).toBeGreaterThan(1);

    await node.getByRole("button", { name: /^Expand /u }).click();
    const details = page.locator(
      '[data-architecture-service-details-for="node_iam_role_policy_fixture"]',
    );
    const collapse = node.getByRole("button", { name: /^Collapse /u });
    await expect(details).toBeVisible();
    await expectExpandedServiceFits(page, node, initialViewport);
    await expect(collapse).toBeInViewport();
    const [control, toolbar] = await Promise.all([
      collapse.boundingBox(),
      tools.boundingBox(),
    ]);
    if (control === null || toolbar === null)
      throw new Error(
        "Expected collapse control and workspace toolbar bounds.",
      );
    expect(control.y + control.height).toBeLessThan(toolbar.y - 4);
    expect(
      await details.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    ).toBeLessThanOrEqual(1);
    await expect(
      details.getByText("Policies & permissions", { exact: true }),
    ).toBeVisible();
    await expect(
      details.getByRole("button", { name: "Configure", exact: true }),
    ).toBeVisible();
    const fittedViewport = await readViewport(viewport);
    await collapse.click();
    await expect(node).toHaveAttribute("data-collapsed", "true");
    await expect.poll(() => readViewport(viewport)).toEqual(fittedViewport);
    await expect(
      node.getByRole("button", { name: /^Expand /u }),
    ).toBeInViewport();
    await expect(editor).toHaveAttribute("data-visual-hash", visualHash ?? "");
    await expect(editor).toHaveAttribute(
      "data-content-hash",
      contentHash ?? "",
    );
  });
});

test("switches desktop pages and canvas to a persistent dark appearance", async ({
  page,
}) => {
  await selectProfileAppearance(page, "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".react-flow")).toHaveClass(/dark/u);
  const colors = await page
    .locator(".service-catalog-panel")
    .evaluate((element) => ({
      text: getComputedStyle(element).color,
      background: getComputedStyle(document.documentElement)
        .getPropertyValue("--cm-color-surface")
        .trim(),
    }));
  expect(colors.background).toBe("#1b1d21");
  await page.screenshot({ path: ".cache/desktop-ui/dark-canvas.png" });
  await page.reload();
  await expect(page.locator(".architecture-editor")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await selectProfileAppearance(page, "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: ".cache/desktop-ui/light-canvas.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("the tour outlines the actual catalog and inspector with a substantial blue border", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "cloudmarkup.web.preferences.v1:local-mock-actor:experience-mode",
      "guided",
    );
    localStorage.setItem(
      "cloudmarkup.web.experience-preferences.v1:local-mock-actor",
      JSON.stringify({
        schemaVersion: 1,
        contextualTeachingEnabled: true,
        defaultRegion: "us-east-1",
        firstUseStatus: "completed",
        notesApiWalkthrough: "not-started",
        preferredProvider: "aws",
        startChoice: "template",
      }),
    );
  });
  await page.goto(
    "/organizations/local-org/projects/field-notes/editor?start=template",
  );
  const tour = page.getByTestId("guided-walkthrough");
  await expect(tour).toBeVisible();
  await tour.getByRole("button", { name: "Show me", exact: true }).click();
  await expect(page.locator("#catalog-panel")).toHaveCSS(
    "outline-width",
    "4px",
  );
  await tour.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".editor-popup-surface--inspector")).toBeVisible();
  await expect(page.locator(".editor-popup-surface--inspector")).toHaveCSS(
    "outline-width",
    "4px",
  );
  await expect
    .poll(async () => {
      const target = await page
        .locator(".editor-popup-surface--inspector")
        .boundingBox();
      const card = await tour.boundingBox();
      return target && card
        ? Math.abs(card.x + card.width + 18 - target.x)
        : 999;
    })
    .toBeLessThan(2);
  await page.screenshot({ path: ".cache/desktop-ui/tutorial-highlight.png" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator('[data-tour-target="true"]')).toHaveCSS(
    "animation-name",
    "tour-attention",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator('[data-tour-target="true"]')).toHaveCSS(
    "animation-name",
    "none",
  );
});

test("puts Lambda application function first at a wide desktop size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const node = page.locator('[data-architecture-node-id="node_api_handler"]');
  await node.dblclick({ force: true, position: { x: 10, y: 10 } });
  await page
    .locator('[data-architecture-service-details-for="node_api_handler"]')
    .getByRole("button", { name: "Configure", exact: true })
    .click();
  const inspector = page.locator("#responsive-inspector-panel");
  await expect(
    inspector.getByRole("textbox", { name: /Purpose/u }),
  ).toBeVisible();
  await page.screenshot({ path: ".cache/desktop-ui/lambda-desktop.png" });
  await selectProfileAppearance(page, "dark");
  await page
    .getByRole("navigation", { name: "Inspector tools" })
    .getByRole("button", { name: "Configure", exact: true })
    .click();
  await page.screenshot({ path: ".cache/desktop-ui/lambda-desktop-dark.png" });
});
test("keeps connected dark diagrams distinct and canvas menus translucent", async ({
  page,
}) => {
  await selectProfileAppearance(page, "dark");
  await page.goto(
    "/organizations/local-org/projects/field-notes/editor?fixture=stable-connection-dock",
  );
  const edge = page
    .locator('.architecture-edge__path[data-visual-role="relationship"]')
    .first();
  await expect(edge).toBeAttached();
  await expect(edge).toHaveCSS("stroke", "rgb(189, 205, 227)");
  await expect(edge).toHaveCSS("stroke-width", "2px");
  const arrowFill = await edge.evaluate((element) => {
    const marker = element
      .getAttribute("marker-end")
      ?.match(/^url\(["']?#(.+?)["']?\)$/u)?.[1];
    const arrow = marker
      ? document.getElementById(marker)?.querySelector("polyline")
      : null;
    return arrow ? getComputedStyle(arrow).fill : null;
  });
  expect(arrowFill).toBe("rgb(189, 205, 227)");
  const node = page.locator(".architecture-node--service").first();
  await expect(node).toHaveCSS("border-top-style", "solid");
  await expect(node).toHaveCSS("border-top-width", "1px");
  await expect(node).not.toHaveCSS("box-shadow", "none");
  const editor = page.locator(".architecture-editor");
  const contentHash = await editor.getAttribute("data-content-hash");
  if (contentHash === null) throw new Error("Expected a loaded architecture");
  for (const selector of [
    "#catalog-panel",
    "#inspector-panel",
    "#bottom-workspace",
  ]) {
    await expect(page.locator(selector)).toHaveCSS(
      "backdrop-filter",
      "blur(4px) saturate(1.15)",
    );
    await expect(page.locator(selector)).toHaveCSS(
      "background-color",
      "rgba(32, 41, 54, 0.58)",
    );
  }
  await page.getByRole("button", { name: "Hide Catalog", exact: true }).click();
  const show = page.getByRole("button", { name: "Show Catalog", exact: true });
  await show.hover();
  await show.focus();
  await expect(page.locator("#catalog-panel")).toHaveCSS("overflow", "visible");
  await expect(show).toHaveCSS("backdrop-filter", "blur(4px) saturate(1.15)");
  await page.screenshot({ path: ".cache/desktop-ui/dark-connections.png" });
  await show.click();
  await page
    .getByRole("navigation", { name: "Inspector tools" })
    .getByRole("button", { name: "Configure", exact: true })
    .click();
  await expect(page.locator(".editor-popup-surface--inspector")).toHaveCSS(
    "background-color",
    "rgba(32, 41, 54, 0.58)",
  );
  await page.screenshot({ path: ".cache/desktop-ui/glass-inspector-dark.png" });
  await page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: "Issues", exact: true })
    .click();
  await expect(page.locator(".editor-popup-surface--workspace")).toHaveCSS(
    "background-color",
    "rgba(32, 41, 54, 0.58)",
  );
  const issues = page.locator("#workspace-launcher-issues");
  await expect(issues.locator("svg")).toHaveCount(0);
  await expect(issues.locator("#editor-issue-count")).toHaveCSS(
    "background-color",
    "rgb(180, 35, 24)",
  );
  await page.screenshot({ path: ".cache/desktop-ui/glass-issues-dark.png" });
  await expect(editor).toHaveAttribute("data-content-hash", contentHash);
});

test("puts commands in Help and notifications and appearance in the profile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const header = page.getByRole("banner", { name: "Application header" });
  await expect(
    header.getByRole("button", { name: "Commands", exact: true }),
  ).toHaveCount(0);
  await expect(
    header.getByRole("button", { name: "Project status", exact: true }),
  ).toHaveCount(0);
  await expect(
    header.getByRole("button", {
      name: /Open notifications|Switch to .* mode/u,
    }),
  ).toHaveCount(0);
  const help = header.getByRole("button", {
    name: "Help and keyboard shortcuts",
  });
  await help.click();
  await page
    .getByRole("dialog", { name: "Keyboard shortcuts" })
    .getByRole("button", { name: "Commands", exact: true })
    .click();
  await expect(
    page.getByRole("searchbox", { name: "Search commands" }),
  ).toBeFocused();
  await expect(page.locator("[data-cm-modal-drawer]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(help).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("searchbox", { name: "Search commands" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await header.getByRole("button", { name: "Guided", exact: true }).click();
  const profile = header.getByRole("button", {
    name: "Open local mock account",
  });
  await expect(profile.locator(".profile-notification-badge")).toHaveText("1");
  await expect(profile).toHaveAccessibleDescription("1 new notification");
  await profile.click();
  await expect(profile.locator(".profile-notification-badge")).toHaveCount(0);
  const account = page.getByRole("dialog", { name: "Local mock account" });
  await expect(
    account.getByRole("link", { name: "Preferences" }),
  ).toBeVisible();
  await account
    .getByRole("button", { name: "Notifications (1 unread)" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Notifications" }),
  ).toContainText("Guided presentation enabled");
  await page.keyboard.press("Escape");
  await expect(profile).toBeFocused();
  await profile.click();
  await expect(
    account.getByRole("button", { name: "Notifications", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await header
    .getByRole("button", { name: "Professional", exact: true })
    .click();
  await expect(profile).toHaveAccessibleDescription("1 new notification");
  await page.screenshot({ path: ".cache/desktop-ui/profile-badge.png" });
});

test("inspectors start compact and resize without changing the diagram", async ({
  page,
}) => {
  await page
    .getByRole("navigation", { name: "Inspector tools" })
    .getByRole("button", { name: "Configure", exact: true })
    .click();
  const panel = page.locator(".editor-popup-surface--inspector");
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())?.width).toBeCloseTo(448, 0);
  expect(
    (await panel.locator(".cm-drawer__header").boundingBox())?.height,
  ).toBeLessThanOrEqual(42);
  const before = await page
    .locator(".architecture-editor")
    .getAttribute("data-content-hash");
  const resize = page.getByRole("separator", { name: "Resize inspector" });
  await resize.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  expect((await panel.boundingBox())?.width).toBeCloseTo(480, 0);
  const handle = await resize.boundingBox();
  if (!handle) throw new Error("Missing resize handle");
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle.x - 60, handle.y + handle.height / 2);
  await page.mouse.up();
  expect((await panel.boundingBox())?.width).toBeGreaterThan(530);
  await expect(page.locator(".architecture-editor")).toHaveAttribute(
    "data-content-hash",
    before ?? "",
  );
});
