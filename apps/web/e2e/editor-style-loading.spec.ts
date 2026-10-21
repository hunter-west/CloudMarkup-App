import { expect, test, type Locator, type Page } from "@playwright/test";

const projectPath = "/organizations/local-org/projects/field-notes";

async function editorStyleCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      Array.from(document.styleSheets).filter((sheet) =>
        Array.from(sheet.cssRules).some(
          (rule) =>
            rule instanceof CSSStyleRule &&
            rule.selectorText ===
              ".architecture-canvas .architecture-edge__path",
        ),
      ).length,
  );
}

async function expectEstablishedEdgeStyle(
  edge: Locator,
  association = false,
): Promise<void> {
  // A horizontal SVG path has a zero-height DOM box but still paints its stroke.
  await expect(edge).toBeAttached();
  await expect(edge).toHaveCSS(
    "stroke",
    association ? "rgb(45, 80, 173)" : "rgb(82, 96, 109)",
  );
  await expect(edge).toHaveCSS("stroke-width", "2px");
}

test("preserves canvas CSS precedence across cold project navigation and a warm editor return", async ({
  page,
}) => {
  await page.goto(projectPath);
  await expect(
    page.getByRole("link", { name: "Open editor shell", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".architecture-editor")).toHaveCount(0);
  expect(await editorStyleCount(page)).toBe(1);

  await page
    .getByRole("link", { name: "Open editor shell", exact: true })
    .click();
  const editor = page.locator(".architecture-editor");
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(
    editor.locator('[data-architecture-node-id="node_api_handler"]'),
  ).toBeVisible();
  const contentHash = await editor.getAttribute("data-content-hash");
  if (contentHash === null)
    throw new Error("The editor must expose its content hash.");
  expect(contentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  expect(await editorStyleCount(page)).toBe(1);

  await page.goBack();
  await expect(
    page.getByRole("link", { name: "Open editor shell", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Open editor shell", exact: true })
    .click();
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute("data-content-hash", contentHash);
  expect(await editorStyleCount(page)).toBe(1);

  // The ordinary mock starts without edges; this existing fixture supplies
  // DynamoDB relationships without mutating any document from the test.
  await page.goto(`${projectPath}/editor?fixture=stable-connection-dock`);
  await expectEstablishedEdgeStyle(
    page
      .locator('.architecture-edge__path[data-visual-role="relationship"]')
      .first(),
  );
});

test("keeps the established networking association appearance after deferred editor loading", async ({
  page,
}, testInfo) => {
  await page.goto(`${projectPath}/editor?fixture=aws-networking`);
  await expect(
    page.getByRole("region", { name: "Development fixture status" }),
  ).toContainText("Local draft recovery is ready");
  const association = page
    .locator('.architecture-edge__path[data-visual-role="association"]')
    .first();
  await expectEstablishedEdgeStyle(association, true);
  await expect(association).toHaveCSS("stroke-dasharray", "5px, 7px");
  await expect(association).toHaveCSS("opacity", "0.42");
  expect(await editorStyleCount(page)).toBe(1);

  await page.getByRole("button", { name: "Open Canvas menu" }).click();
  const menu = page.getByRole("dialog", { name: "Canvas actions" });
  await menu
    .getByRole("button", { name: "Fit architecture", exact: true })
    .click();
  await expect(menu).toHaveCount(0);
  await expectEstablishedEdgeStyle(association, true);
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  });
  await page.mouse.move(1, 1);
  await page.locator(".architecture-editor").screenshot({
    animations: "disabled",
    path: testInfo.outputPath("networking-stable-cascade.png"),
  });
});
