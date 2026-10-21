import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const editorPath =
  "/organizations/local-org/projects/field-notes/editor?fixture=aws" as const;
const fixtureNodeIds = [
  "node_api_handler",
  "node_identity",
  "node_imported_unknown",
  "node_notes_table",
] as const;

function editor(page: Page) {
  return page.locator(".architecture-editor");
}

function recoveryStatus(page: Page) {
  return page.getByRole("region", { name: "Development fixture status" });
}

async function waitForRecoveryReady(page: Page): Promise<void> {
  // Cold Vite loads the deferred editor before recovery can initialize.
  await expect(editor(page)).toBeVisible({ timeout: 30_000 });
  await expect(recoveryStatus(page)).toContainText(
    "Local draft recovery is ready",
  );
}

async function addServiceFromCatalog(
  page: Page,
  input: {
    readonly buttonName: string;
    readonly nodeId: string;
    readonly search: string;
  },
): Promise<void> {
  await page
    .getByRole("searchbox", { name: "Search services" })
    .fill(input.search);
  const add = page.getByRole("button", { name: input.buttonName });
  await add.focus();
  await add.press("Enter");
  await expect(
    editor(page).locator(`[data-architecture-node-id="${input.nodeId}"]`),
  ).toHaveCount(1);
}

async function documentHashes(
  page: Page,
): Promise<{ readonly content: string; readonly visual: string }> {
  const surface = editor(page);
  const content = await surface.getAttribute("data-content-hash");
  const visual = await surface.getAttribute("data-visual-hash");
  if (content === null || visual === null) {
    throw new Error(
      "The editor did not expose both Architecture Document hashes.",
    );
  }
  return { content, visual };
}

test("recovers the last validated local checkpoint after refresh with fresh history", async ({
  page,
}) => {
  await page.goto(editorPath);
  await waitForRecoveryReady(page);

  const originalHashes = await documentHashes(page);
  await addServiceFromCatalog(page, {
    buttonName: "Drag or add Lambda function to canvas",
    nodeId: "node_lambda_function",
    search: "bounded application workload",
  });
  await expect(recoveryStatus(page)).toContainText(
    "Local recovery checkpoint saved.",
  );
  const savedHashes = await documentHashes(page);
  expect(savedHashes.content).not.toBe(originalHashes.content);

  await page.reload();

  await expect(editor(page)).toBeVisible();
  await expect(recoveryStatus(page)).toContainText(
    "Recovered the latest validated local Architecture Document checkpoint.",
  );
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    savedHashes.content,
  );
  await expect(editor(page)).toHaveAttribute(
    "data-visual-hash",
    savedHashes.visual,
  );
  await expect(
    editor(page).locator('[data-architecture-node-id="node_lambda_function"]'),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Undo unavailable" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("searchbox", { name: "Search services" }),
  ).toHaveValue("");
});

test("detects a stale tab and never overwrites the newer local checkpoint", async ({
  page,
}) => {
  const secondPage = await page.context().newPage();
  try {
    // Load each tab to the ready checkpoint before exercising stale writes.
    await page.goto(editorPath);
    await waitForRecoveryReady(page);
    await secondPage.goto(editorPath);
    await waitForRecoveryReady(secondPage);

    await addServiceFromCatalog(page, {
      buttonName: "Drag or add Lambda function to canvas",
      nodeId: "node_lambda_function",
      search: "bounded application workload",
    });
    await expect(recoveryStatus(page)).toContainText(
      "Local recovery checkpoint saved.",
    );
    const authoritativeHashes = await documentHashes(page);

    await expect(recoveryStatus(secondPage)).toContainText(
      "another tab changed this architecture",
    );
    await addServiceFromCatalog(secondPage, {
      buttonName: "Drag or add API Gateway HTTP API to canvas",
      nodeId: "node_apigateway_http_api",
      search: "API Gateway HTTP API",
    });
    await expect(recoveryStatus(secondPage)).toContainText(
      "another tab changed this architecture",
    );
    const staleTabHashes = await documentHashes(secondPage);
    expect(staleTabHashes.content).not.toBe(authoritativeHashes.content);

    await secondPage.reload();

    await expect(editor(secondPage)).toBeVisible();
    await expect(recoveryStatus(secondPage)).toContainText(
      "Recovered the latest validated local Architecture Document checkpoint.",
    );
    await expect(editor(secondPage)).toHaveAttribute(
      "data-content-hash",
      authoritativeHashes.content,
    );
    await expect(editor(secondPage)).toHaveAttribute(
      "data-visual-hash",
      authoritativeHashes.visual,
    );
    await expect
      .poll(async () =>
        editor(secondPage)
          .locator("[data-architecture-node-id]")
          .evaluateAll((nodes) =>
            nodes
              .map((node) => node.getAttribute("data-architecture-node-id"))
              .filter((nodeId): nodeId is string => nodeId !== null)
              .sort(),
          ),
      )
      .toEqual([...fixtureNodeIds, "node_lambda_function"].sort());
  } finally {
    await secondPage.close();
  }
});
test("detects a stale tab by IndexedDB CAS when broadcasts are unavailable", async ({
  context,
  page,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: undefined,
    });
  });
  const secondPage = await context.newPage();
  try {
    // Load each tab to the ready checkpoint before exercising stale writes.
    await page.goto(editorPath);
    await waitForRecoveryReady(page);
    await secondPage.goto(editorPath);
    await waitForRecoveryReady(secondPage);

    await addServiceFromCatalog(page, {
      buttonName: "Drag or add Lambda function to canvas",
      nodeId: "node_lambda_function",
      search: "bounded application workload",
    });
    await expect(recoveryStatus(page)).toContainText(
      "Local recovery checkpoint saved.",
    );
    const authoritativeHashes = await documentHashes(page);

    await addServiceFromCatalog(secondPage, {
      buttonName: "Drag or add API Gateway HTTP API to canvas",
      nodeId: "node_apigateway_http_api",
      search: "API Gateway HTTP API",
    });
    await expect(recoveryStatus(secondPage)).toContainText(
      "another tab changed this architecture",
    );

    await secondPage.reload();
    await expect(editor(secondPage)).toBeVisible();
    await expect(editor(secondPage)).toHaveAttribute(
      "data-content-hash",
      authoritativeHashes.content,
    );
    await expect(editor(secondPage)).toHaveAttribute(
      "data-visual-hash",
      authoritativeHashes.visual,
    );
  } finally {
    await secondPage.close();
  }
});
