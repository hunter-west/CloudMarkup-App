import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const editorRoutePath =
  "/organizations/local-org/projects/field-notes/editor" as const;
const editorPath = `${editorRoutePath}?fixture=aws` as const;

interface Rectangle {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

async function requiredBox(
  locator: Locator,
  description: string,
): Promise<Rectangle> {
  await expect(locator).toBeVisible();
  await locator.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations()
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`Expected ${description} to have rendered bounds.`);
  }
  return box;
}

async function waitForEditor(page: Page): Promise<void> {
  await expect(page.locator(".architecture-editor")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("region", { name: "Development fixture status" }),
  ).toContainText("Local draft recovery is ready");
}

async function chooseCanvasAction(
  page: Page,
  actionName: "Fit architecture",
): Promise<void> {
  await page.getByRole("button", { name: "Open Canvas menu" }).click();
  const menu = page.getByRole("dialog", { name: "Canvas actions" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: actionName }).click();
  await expect(menu).toHaveCount(0);
}

async function expectWithinWorkspace(
  page: Page,
  surface: Locator,
  description: string,
): Promise<void> {
  const workspace = await requiredBox(
    page.locator(".workspace-shell"),
    "workspace boundary",
  );
  const bounds = await requiredBox(surface, description);
  expect(bounds.y).toBeGreaterThanOrEqual(workspace.y - 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(
    workspace.y + workspace.height + 1,
  );
  expect(bounds.x).toBeGreaterThanOrEqual(workspace.x - 1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    workspace.x + workspace.width + 1,
  );
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
});

test("keeps top-bar menus and the Inspector mutually exclusive inside the whiteboard", async ({
  page,
}) => {
  await page.goto(editorPath);
  await waitForEditor(page);

  const canvasTrigger = page.getByRole("button", { name: "Open Canvas menu" });
  await canvasTrigger.click();
  const canvasMenu = page.getByRole("dialog", { name: "Canvas actions" });
  await expectWithinWorkspace(page, canvasMenu, "Canvas actions menu");

  const configureLauncher = page
    .getByRole("navigation", { name: "Inspector tools" })
    .getByRole("button", { name: "Configure" });
  await configureLauncher.click();
  await expect(canvasMenu).toHaveCount(0);

  const configureInspector = page.getByRole("dialog", {
    name: "Configure inspector",
  });
  await expectWithinWorkspace(page, configureInspector, "Configure inspector");

  await page
    .getByRole("button", { name: "Help and keyboard shortcuts" })
    .click();
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  await expect(configureInspector).toHaveCount(0);
  await expectWithinWorkspace(page, help, "keyboard shortcut dialog");
  await help.getByRole("button", { name: "Close" }).click();
  await expect(help).toHaveCount(0);
});

test("portals Catalog details above workspace chrome without closing the Catalog owner", async ({
  page,
}) => {
  await page.goto(editorPath);
  await waitForEditor(page);

  const resizeBounds = await requiredBox(
    page.getByRole("separator", { name: "Resize service catalog" }),
    "Catalog resize handle",
  );
  const detailsTrigger = page.getByRole("button", {
    name: "Show details for Lambda function",
  });
  await detailsTrigger.click();
  const details = page.getByRole("dialog", {
    name: "Lambda function details",
  });
  await expect(details).toBeVisible();
  await expect(page.locator("#catalog-panel")).toBeVisible();
  expect(
    await details.evaluate(
      (element) => element.closest(".workspace-shell") === null,
    ),
  ).toBe(true);

  const backdrop = details.locator("..");
  await expect(page.locator("#root")).toHaveAttribute("inert");
  await expect(page.locator("#root")).toHaveAttribute("aria-hidden", "true");
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest(".cm-modal-drawer__backdrop") !== null,
      {
        x: resizeBounds.x + resizeBounds.width / 2,
        y: resizeBounds.y + resizeBounds.height / 2,
      },
    ),
  ).toBe(true);
  await expect(backdrop).toHaveCSS("position", "fixed");

  await details
    .getByRole("button", { name: "Close details for Lambda function" })
    .click();
  await expect(details).toHaveCount(0);
  await expect(page.locator("#root")).not.toHaveAttribute("inert");
  await expect(page.locator("#root")).not.toHaveAttribute("aria-hidden");
  await expect(detailsTrigger).toBeFocused();
});

test("keeps the desktop Inspector inside the shifted whiteboard while offline", async ({
  context,
  page,
}) => {
  await page.goto(editorPath);
  await waitForEditor(page);
  await context.setOffline(true);

  try {
    const offlineBanner = page
      .getByRole("status")
      .filter({ hasText: "Offline." });
    const offlineBounds = await requiredBox(offlineBanner, "offline banner");

    await page
      .getByRole("navigation", { name: "Inspector tools" })
      .getByRole("button", { name: "Configure" })
      .click();
    const inspector = page.getByRole("dialog", {
      name: "Configure inspector",
    });
    const workspace = await requiredBox(
      page.locator(".workspace-shell"),
      "shifted workspace boundary",
    );
    const inspectorBounds = await requiredBox(
      inspector,
      "desktop Inspector with offline status",
    );

    expect(workspace.y).toBeGreaterThanOrEqual(
      offlineBounds.y + offlineBounds.height - 1,
    );
    expect(inspectorBounds.y).toBeGreaterThanOrEqual(workspace.y - 1);
    expect(inspectorBounds.y + inspectorBounds.height).toBeLessThanOrEqual(
      workspace.y + workspace.height + 1,
    );
  } finally {
    await context.setOffline(false);
  }
});

test("closes the connection chooser before opening the compact wizard below the app bar", async ({
  page,
}) => {
  await page.goto(editorPath);
  await waitForEditor(page);

  const appBar = await requiredBox(
    page.getByRole("banner", { name: "Application header" }),
    "application bar",
  );
  await page
    .getByRole("searchbox", { name: "Search services" })
    .fill("API Gateway HTTP API");
  await page
    .getByRole("button", {
      name: "Drag or add API Gateway HTTP API to canvas",
    })
    .press("Enter");
  await chooseCanvasAction(page, "Fit architecture");

  const apiNode = page.locator(
    '[data-architecture-node-id="node_apigateway_http_api"]',
  );
  await apiNode
    .getByRole("button", { name: "Expand API Gateway HTTP API" })
    .click();
  await page
    .locator(
      '[data-architecture-service-details-for="node_apigateway_http_api"]',
    )
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  const chooser = page.getByRole("dialog", {
    name: "Choose services to connect",
  });
  await expectWithinWorkspace(page, chooser, "connection chooser");
  await chooser.getByRole("radio", { name: "Invokes", exact: true }).click();

  const wizard = page.getByRole("dialog", {
    name: "Connect API Gateway HTTP API to Lambda function",
  });
  await expect(wizard).toBeVisible();
  await expect(chooser).toHaveCount(0);
  await expect(wizard.getByRole("button", { name: "Guided" })).toHaveCount(0);
  await expect(
    wizard.getByRole("button", { name: "Professional" }),
  ).toHaveCount(0);
  await expectWithinWorkspace(page, wizard, "connection wizard");

  const wizardBounds = await requiredBox(wizard, "connection wizard");
  expect(wizardBounds.y).toBeGreaterThanOrEqual(appBar.y + appBar.height - 1);

  await wizard.getByRole("button", { name: "Cancel" }).click();
  await expect(wizard).toHaveCount(0);
});

test("closes the Connect inspector when its modal connection workflow starts", async ({
  page,
}) => {
  await page.goto(editorPath);
  await waitForEditor(page);
  await chooseCanvasAction(page, "Fit architecture");

  const lambdaNode = page.locator(
    '[data-architecture-node-id="node_api_handler"]',
  );
  await lambdaNode.locator(":scope > header").click({
    position: { x: 8, y: 8 },
  });
  await page
    .getByRole("navigation", { name: "Inspector tools" })
    .getByRole("button", { name: "Connect" })
    .click();

  const inspector = page.getByRole("dialog", { name: "Connect inspector" });
  await expectWithinWorkspace(page, inspector, "Connect inspector");
  await inspector
    .getByRole("tabpanel", { name: "Connect" })
    .getByRole("button", { exact: true, name: "Connect Notes API handler" })
    .click();

  const chooser = page.getByRole("dialog", {
    name: "Choose services to connect",
  });
  await expect(chooser).toBeVisible();
  await expect(inspector).toHaveCount(0);
  await chooser
    .getByRole("radio", {
      exact: true,
      name: "Reads from",
    })
    .click();

  const wizard = page.getByRole("dialog", {
    name: "Connect Lambda function to DynamoDB table",
  });
  await expect(wizard).toBeVisible();
  await expect(inspector).toHaveCount(0);
  await expectWithinWorkspace(page, wizard, "data connection wizard");
  await wizard.getByRole("button", { name: "Cancel" }).click();
  await expect(wizard).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Inspector tools" })
      .getByRole("button", { name: "Connect" }),
  ).toBeFocused();
});

test("keeps the blank-canvas message inside the unobscured canvas safe area", async ({
  page,
}) => {
  await page.goto(`${editorRoutePath}?start=blank`);
  await waitForEditor(page);

  const emptyState = page.locator(".architecture-empty-state--canvas");
  await expect(emptyState).toContainText("This architecture has no elements");
  const emptyBounds = await requiredBox(emptyState, "blank-canvas empty state");
  const catalogBounds = await requiredBox(
    page.locator('.workspace-shell__catalog[data-expanded="true"]'),
    "expanded service catalog",
  );
  const inspectorBounds = await requiredBox(
    page.getByRole("navigation", { name: "Inspector tools" }),
    "Inspector launcher",
  );
  const workspaceBounds = await requiredBox(
    page.getByRole("navigation", { name: "Workspace tools" }),
    "workspace launcher",
  );
  const headerBounds = await requiredBox(
    page.getByRole("banner", { name: "Application header" }),
    "application header",
  );

  expect(emptyBounds.x).toBeGreaterThanOrEqual(
    catalogBounds.x + catalogBounds.width - 1,
  );
  expect(emptyBounds.x + emptyBounds.width).toBeLessThanOrEqual(
    inspectorBounds.x + 1,
  );
  expect(emptyBounds.y).toBeGreaterThanOrEqual(
    headerBounds.y + headerBounds.height - 1,
  );
  expect(emptyBounds.y + emptyBounds.height).toBeLessThanOrEqual(
    workspaceBounds.y + 1,
  );
});
