import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const editorPath =
  "/organizations/local-org/projects/field-notes/editor?fixture=aws-networking" as const;

function editor(page: Page): Locator {
  return page.locator(".architecture-editor");
}

function architectureNode(page: Page, nodeId: string): Locator {
  return editor(page).locator(`[data-architecture-node-id="${nodeId}"]`);
}

async function waitForEditorReady(page: Page): Promise<void> {
  await expect(editor(page)).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("region", { name: "Development fixture status" }),
  ).toContainText("Local draft recovery is ready");
  await expect(architectureNode(page, "node_network_region")).toBeVisible();
}

async function fitArchitecture(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open Canvas menu" }).click();
  const menu = page.getByRole("dialog", { name: "Canvas actions" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "Fit architecture" }).click();
  await expect(menu).toHaveCount(0);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

async function prepareVisualCapture(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.mouse.move(1, 1);
}

test.describe("AWS networking visual baselines", () => {
  test.skip(
    process.platform !== "linux",
    "Visual baselines are pinned to the reviewed Linux Playwright container.",
  );

  test("renders the fitted hierarchy, associations, managed services, and minimap", async ({
    page,
  }) => {
    await page.goto(editorPath);
    await waitForEditorReady(page);
    await fitArchitecture(page);
    // The overview keeps relationship labels out of the way until inspected.
    await expect(
      page.locator('.architecture-edge__label[data-visual-role="association"]'),
    ).toHaveCount(0);
    await expect(
      architectureNode(page, "node_application_table"),
    ).toBeVisible();
    await expect(editor(page).locator(".architecture-minimap")).toBeVisible();
    await prepareVisualCapture(page);

    await expect(editor(page)).toHaveScreenshot(
      "aws-networking-fitted-hierarchy.png",
      {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.001,
        scale: "css",
        threshold: 0.2,
      },
    );
  });

  test("renders grounded Lambda VPC access evidence and multi-AZ guidance", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 1_600, width: 2_000 });
    await page.goto(editorPath);
    await waitForEditorReady(page);
    await fitArchitecture(page);
    const lambda = architectureNode(page, "node_networked_lambda");
    await lambda
      .getByRole("button", { name: "Expand Private application function" })
      .click();
    await fitArchitecture(page);
    const explain = page
      .locator(
        '[data-architecture-service-details-for="node_networked_lambda"]',
      )
      .getByRole("button", { name: "Explain Private application function" });
    const inspectorLauncher = page.getByRole("navigation", {
      name: "Inspector tools",
    });
    for (let zoom = 0; zoom < 5; zoom += 1) {
      const explainBox = await explain.boundingBox();
      const launcherBox = await inspectorLauncher.boundingBox();
      if (!explainBox || !launcherBox) {
        throw new Error(
          "Expanded Lambda and Inspector launcher must be visible",
        );
      }
      if (explainBox.x + explainBox.width < launcherBox.x) break;
      await editor(page).getByRole("button", { name: "Zoom out" }).click();
    }
    await explain.click();
    const help = page.getByRole("dialog", {
      name: "Learn inspector",
    });
    await help.getByText("VPC access (1)", { exact: true }).click();
    await expect(help).toContainText("VPC access (1)");
    await expect(help).toContainText("Private subnet A · 10.0.11.0/24");
    await expect(help).toContainText("Private subnet B · 10.0.12.0/24");
    await expect(help).toContainText("Application security group");
    await expect(help).toContainText("multiple Availability Zones");
    await prepareVisualCapture(page);

    await expect(help).toHaveScreenshot("aws-networking-lambda-vpc-help.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.001,
      scale: "css",
      threshold: 0.2,
    });
  });
});
