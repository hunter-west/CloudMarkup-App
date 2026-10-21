import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const editorRoutePath =
  "/organizations/local-org/projects/field-notes/editor" as const;
const editorPath = `${editorRoutePath}?fixture=aws` as const;
const nestedBoundaryEditorPath =
  `${editorRoutePath}?fixture=nested-boundaries` as const;
const fixtureNodeIds = [
  "node_api_handler",
  "node_identity",
  "node_imported_unknown",
  "node_notes_table",
] as const;
const representativeDesktopViewports = [
  { height: 900, width: 1680 },
  { height: 800, width: 1280 },
] as const;
const representativeTabletViewports = [
  { height: 800, width: 1279 },
  { height: 600, width: 768 },
] as const;
const validationCompletionAnnouncement =
  /^Draft validation (?:complete|incomplete): \d+ findings?\. Compilation validation (?:complete|incomplete): \d+ findings?\.$/u;
const validationCycleAttribute = "data-test-validation-cycle" as const;

async function observeNextValidationCycle(region: Locator): Promise<void> {
  await region.evaluate((element, attributeName) => {
    const initialText = element.textContent.trim();
    element.setAttribute(
      attributeName,
      initialText === "" ? "cleared" : "waiting",
    );
    const observer = new MutationObserver(() => {
      const text = element.textContent.trim();
      const phase = element.getAttribute(attributeName);
      if (text === "") {
        element.setAttribute(attributeName, "cleared");
        return;
      }
      if (phase === "cleared") {
        element.setAttribute(attributeName, "completed");
        observer.disconnect();
      }
    });
    observer.observe(element, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  }, validationCycleAttribute);
}

async function expectObservedValidationCycle(region: Locator): Promise<void> {
  await expect(region).toHaveAttribute(validationCycleAttribute, "completed");
  await expect(region).toHaveText(validationCompletionAnnouncement);
  await region.evaluate((element, attributeName) => {
    element.removeAttribute(attributeName);
  }, validationCycleAttribute);
}

async function expandServiceNode(node: Locator, label: string): Promise<void> {
  await node.getByRole("button", { name: `Expand ${label}` }).click();
  await expect(node).toHaveAttribute("data-collapsed", "false");
}

async function expectServiceCardControls(node: Locator): Promise<void> {
  const [card, target, icon, asset] = await Promise.all([
    requiredBox(node, "service card"),
    requiredBox(
      node.locator(".architecture-service-toggle"),
      "service control",
    ),
    requiredBox(node.locator(".cm-service-icon").first(), "service icon"),
    requiredBox(
      node.locator(".cm-service-icon__asset > *").first(),
      "service icon asset",
    ),
  ]);
  expect(asset.width).toBeGreaterThanOrEqual(icon.width * 0.8);
  expect(asset.height).toBeGreaterThanOrEqual(icon.height * 0.8);
  const collapsed = (await node.getAttribute("data-collapsed")) === "true";
  const iconOnly = (await node.getAttribute("data-icon-only")) === "true";
  const overview = (await node.getAttribute("data-overview-tile")) === "true";
  if (collapsed && !iconOnly) {
    const title = node.locator(".architecture-node__title strong").first();
    const text = await requiredBox(title, "service label");
    expect(
      Math.abs(icon.x + icon.width / 2 - (card.x + card.width / 2)),
    ).toBeLessThanOrEqual(2);
    expect(text.y).toBeGreaterThanOrEqual(icon.y + icon.height - 1);
    expect(text.y + text.height).toBeLessThanOrEqual(card.y + card.height + 1);
    expect(target.x).toBeGreaterThanOrEqual(card.x - 1);
    expect(target.y).toBeGreaterThanOrEqual(card.y - 1);
    expect(target.x + target.width).toBeLessThanOrEqual(
      card.x + card.width + 1,
    );
    expect(target.y + target.height).toBeLessThanOrEqual(
      card.y + card.height + 1,
    );
    if (!overview) {
      expect(
        Math.abs(target.x + target.width / 2 - (card.x + card.width / 2)),
      ).toBeLessThanOrEqual(1);
    } else {
      expect(target.x + target.width / 2).toBeGreaterThan(
        card.x + card.width * 0.7,
      );
    }
    expect(rectanglesOverlap(target, icon)).toBe(false);
    expect(rectanglesOverlap(target, text)).toBe(false);
    const counts = node.locator(".architecture-connection-dock__count");
    for (const count of await counts.all()) {
      const badge = await requiredBox(count, "connection count");
      expect(rectanglesOverlap(badge, icon)).toBe(false);
      expect(rectanglesOverlap(badge, text)).toBe(false);
    }
  } else if (!collapsed) {
    expect(
      Math.abs(target.x + target.width / 2 - (card.x + card.width / 2)),
    ).toBeLessThanOrEqual(1);
  }
}

test("opens the exact AWS fixture and catalog in both experience modes without changing its content", async ({
  page,
}) => {
  await page.goto(editorPath);

  const editor = page.locator(".architecture-editor");
  const canvas = page.getByRole("region", { name: "Architecture canvas" });
  const catalog = page.locator(".service-catalog-panel[data-catalog-mode]");
  const modeSwitch = page.getByLabel("Project status");
  const guidedMode = modeSwitch.getByRole("button", { name: "Guided" });
  const professionalMode = modeSwitch.getByRole("button", {
    name: "Professional",
  });
  const minimapOverview = page.getByRole("img", {
    name: "Architecture overview",
  });
  const minimap = page.locator(".react-flow__minimap.architecture-minimap");

  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(canvas).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Architecture editor" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Architecture workspace" }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "Inspect, add, and arrange resources in one deterministic catalog-bound Architecture Document fixture.",
      { exact: false },
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Development fixture status" }),
  ).toContainText("Local draft recovery is ready");
  await expect(minimapOverview).toBeVisible();
  await expect(minimap).toBeVisible();
  await expect(page.locator(".architecture-minimap-dock")).toHaveCount(0);
  await expect(
    page.locator(".architecture-canvas__flow").getByRole("img", {
      name: "Architecture overview",
    }),
  ).toHaveCount(1);
  await expect
    .poll(async () => readMiniMapNodeIds(minimapOverview))
    .toEqual([...fixtureNodeIds]);
  const miniMapBounds = await requiredBox(minimap, "architecture minimap");
  expect(miniMapBounds.width).toBeCloseTo(152, 0);
  expect(miniMapBounds.height).toBeCloseTo(104, 0);
  const miniMapMask = minimapOverview.locator(".react-flow__minimap-mask");
  const initialMaskPath = await miniMapMask.getAttribute("d");
  if (initialMaskPath === null) {
    throw new Error("The architecture minimap did not expose its viewport.");
  }
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect
    .poll(async () => miniMapMask.getAttribute("d"))
    .not.toBe(initialMaskPath);
  const statusLink = page.getByRole("link", {
    name: "Skip to workspace status",
  });
  await statusLink.focus();
  await statusLink.press("Enter");
  await expect(guidedMode).toHaveAttribute("aria-pressed", "true");
  await expect(editor).toHaveAttribute("data-editor-mode", "guided");
  await expect(catalog).toHaveAttribute("data-catalog-mode", "guided");
  await expect(editor).toHaveAttribute("data-document-id", /.+/u);
  await expect(editor).toHaveAttribute(
    "data-content-hash",
    /^sha256:[a-f0-9]{64}$/u,
  );
  await expect(
    editor.locator("[data-architecture-node-id]").first(),
  ).toBeVisible();

  const documentId = await editor.getAttribute("data-document-id");
  const guidedContentHash = await editor.getAttribute("data-content-hash");
  const guidedNodeIds = await readNodeIds(editor);

  if (documentId === null) {
    throw new Error("The fixture editor did not expose a document ID.");
  }

  if (guidedContentHash === null) {
    throw new Error("The fixture editor did not expose a content hash.");
  }

  expect(guidedNodeIds).toEqual([...fixtureNodeIds]);
  await expect(
    editor.locator(
      '[data-architecture-node-id="node_imported_unknown"].architecture-node--fallback',
    ),
  ).toBeVisible();

  await professionalMode.click();

  await expect(professionalMode).toHaveAttribute("aria-pressed", "true");
  await expect(editor).toHaveAttribute("data-editor-mode", "professional");
  await expect(catalog).toHaveAttribute("data-catalog-mode", "professional");
  await expect(editor).toHaveAttribute("data-document-id", documentId);
  await expect(canvas).toBeVisible();
  await expect(editor).toHaveAttribute("data-content-hash", guidedContentHash);
  await expect.poll(async () => readNodeIds(editor)).toEqual(guidedNodeIds);
});

test("keeps aggregate connection labels and keyboard tooltips fully visible", async ({
  page,
}) => {
  await page.goto(editorPath);

  const editor = page.locator(".architecture-editor");
  const lambda = editor.locator(
    '[data-architecture-node-id="node_api_handler"]',
  );
  const input = lambda.getByRole("button", {
    name: /^Open inputs for Notes API handler/u,
  });
  const output = lambda.getByRole("button", {
    name: /^Open outputs for Notes API handler/u,
  });
  const initialContentHash = await editor.getAttribute("data-content-hash");
  const initialVisualHash = await editor.getAttribute("data-visual-hash");
  if (initialContentHash === null || initialVisualHash === null) {
    throw new Error("The fixture editor did not expose both document hashes.");
  }

  const tooltipCenterIsPainted = async (tooltip: Locator) =>
    tooltip.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      const portal = element.closest<HTMLElement>(".cm-tooltip--portal");
      const priorElementPointerEvents = element.style.pointerEvents;
      const priorPortalPointerEvents = portal?.style.pointerEvents;
      element.style.pointerEvents = "auto";
      if (portal !== null) {
        portal.style.pointerEvents = "auto";
      }
      const painted = document
        .elementsFromPoint(centerX, centerY)
        .some(
          (candidate) => candidate === element || element.contains(candidate),
        );
      element.style.pointerEvents = priorElementPointerEvents;
      if (portal !== null) {
        portal.style.pointerEvents = priorPortalPointerEvents ?? "";
      }
      return painted;
    });
  // Compact connection controls intentionally overhang the node. Its text must fit.
  const details = lambda.locator(".architecture-node__header");
  const horizontalOverflow = () =>
    details.evaluate((element) => element.scrollWidth - element.clientWidth);

  await expect(details).toBeVisible();
  await input.hover();
  const inputTooltip = page.getByRole("tooltip");
  await expect(inputTooltip).toHaveText(
    "Inputs: Triggers, Async events, Event sources, Identity & grants, Networking",
  );
  await expect(input).toHaveAttribute("aria-describedby", /.+/u);
  const [inputControlBox, inputDotBox, inputTooltipBox] = await Promise.all([
    requiredBox(input, "Triggers input control"),
    requiredBox(
      input.locator(".architecture-connection-dock__dot"),
      "Triggers input dot",
    ),
    requiredBox(inputTooltip, "Triggers input tooltip"),
  ]);
  expect(inputTooltipBox.x + inputTooltipBox.width).toBeLessThanOrEqual(
    inputControlBox.x,
  );
  expect(inputTooltipBox.y + inputTooltipBox.height).toBeGreaterThan(
    inputDotBox.y,
  );
  expect(inputTooltipBox.y).toBeLessThan(inputDotBox.y + inputDotBox.height);
  expect(inputTooltipBox.x).toBeGreaterThanOrEqual(0);
  await expect.poll(() => tooltipCenterIsPainted(inputTooltip)).toBe(true);
  await expect.poll(horizontalOverflow).toBeLessThanOrEqual(1);

  await page.mouse.move(4, 4);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await output.focus();
  const outputTooltip = page.getByRole("tooltip");
  await expect(outputTooltip).toContainText("Outputs:");
  await expect(output).toHaveAttribute("aria-describedby", /.+/u);
  const [outputControlBox, outputDotBox, outputTooltipBox] = await Promise.all([
    requiredBox(output, "Invokes output control"),
    requiredBox(
      output.locator(".architecture-connection-dock__dot"),
      "Invokes output dot",
    ),
    requiredBox(outputTooltip, "Invokes output tooltip"),
  ]);
  expect(outputTooltipBox.x).toBeGreaterThanOrEqual(
    outputControlBox.x + outputControlBox.width,
  );
  expect(outputTooltipBox.y + outputTooltipBox.height).toBeGreaterThan(
    outputDotBox.y,
  );
  expect(outputTooltipBox.y).toBeLessThan(outputDotBox.y + outputDotBox.height);
  expect(outputTooltipBox.x + outputTooltipBox.width).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  );
  await expect.poll(() => tooltipCenterIsPainted(outputTooltip)).toBe(true);
  await expect.poll(horizontalOverflow).toBeLessThanOrEqual(1);

  await output.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(output).toBeFocused();
  await output.press("Enter");
  await expect(
    page.getByRole("dialog", {
      name: "Outputs for Notes API handler",
    }),
  ).toBeVisible();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(output).not.toHaveAttribute("aria-describedby", /.+/u);
  await expect(editor).toHaveAttribute("data-content-hash", initialContentHash);
  await expect(editor).toHaveAttribute("data-visual-hash", initialVisualHash);
});

test("defaults every service to compact aggregate connection points without changing architecture meaning", async ({
  page,
}) => {
  await page.goto(editorPath);

  const editor = page.locator(".architecture-editor");
  const lambda = editor.locator(
    '[data-architecture-node-id="node_api_handler"]',
  );
  const initialContentHash = await editor.getAttribute("data-content-hash");
  const initialVisualHash = await editor.getAttribute("data-visual-hash");
  if (initialContentHash === null || initialVisualHash === null) {
    throw new Error("The fixture editor did not expose both document hashes.");
  }

  await expect(lambda).toHaveAttribute("data-collapsed", "true");
  await expectServiceCardControls(lambda);
  await expect
    .poll(() =>
      editor
        .locator(".architecture-node--resource, .architecture-node--fallback")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-collapsed")),
        ),
    )
    .toEqual(fixtureNodeIds.map(() => "true"));
  const compactSize = await lambda.evaluate((element) => {
    const wrapper = element.closest<HTMLElement>(".react-flow__node");
    if (wrapper === null) {
      throw new Error("The collapsed service has no React Flow wrapper.");
    }
    return {
      height: wrapper.style.height,
      width: wrapper.style.width,
    };
  });
  expect(compactSize).toEqual({ height: "96px", width: "160px" });
  const compactBounds = await requiredBox(lambda, "compact service surface");
  const flowBounds = await lambda.evaluate((element) => {
    const wrapper = element.closest<HTMLElement>(".react-flow__node");
    if (wrapper === null)
      throw new Error("The compact service lost its flow box.");
    const bounds = wrapper.getBoundingClientRect();
    return {
      height: bounds.height,
      width: bounds.width,
      x: bounds.x,
      y: bounds.y,
    };
  });
  expect(Math.abs(compactBounds.x - flowBounds.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(compactBounds.y - flowBounds.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(compactBounds.width - flowBounds.width)).toBeLessThanOrEqual(
    1,
  );
  expect(
    Math.abs(compactBounds.height - flowBounds.height),
  ).toBeLessThanOrEqual(1);

  const mountedDetails = lambda.locator(
    "#architecture-service-details-node_api_handler",
  );
  await expect(mountedDetails).toHaveCount(1);
  await expect(mountedDetails).toHaveAttribute("hidden", "");
  await expect(mountedDetails).toHaveAttribute("aria-hidden", "true");
  await expect(mountedDetails).not.toHaveClass(/nowheel/u);
  const detailsId = await mountedDetails.getAttribute("id");
  if (detailsId === null) {
    throw new Error("Expected the mounted service details to have an ID.");
  }
  await expect(
    lambda.getByRole("button", { name: "Expand Notes API handler" }),
  ).toHaveAttribute("aria-controls", detailsId);

  const compactDocks = lambda.getByRole("group", {
    name: "Compact connection docks",
  });
  const input = compactDocks.getByRole("button", {
    name: /^Open inputs for Notes API handler;/u,
  });
  const output = compactDocks.getByRole("button", {
    name: /^Open outputs for Notes API handler;/u,
  });
  await expect(
    compactDocks.locator(".architecture-connection-dock"),
  ).toHaveCount(2);
  await expect(
    compactDocks.locator(".architecture-connection-dock__dot"),
  ).toHaveCount(2);
  const aggregateAnchors = compactDocks.locator(
    '[data-connection-anchor-layout="aggregate"]',
  );
  await expect(aggregateAnchors).toHaveCount(10);
  expect(
    await aggregateAnchors.evaluateAll((anchors) =>
      anchors.map((anchor) =>
        (anchor as HTMLElement).style.getPropertyValue("top"),
      ),
    ),
  ).toEqual(Array.from({ length: 10 }, () => "50%"));

  await input.hover();
  await expect(page.getByRole("tooltip")).toContainText("Inputs: Triggers");
  await page.mouse.move(4, 4);
  await output.focus();
  await expect(page.getByRole("tooltip")).toHaveText(/^Outputs: .*Invokes/u);
  await output.press("Enter");

  const aggregateMenu = page.getByRole("dialog", {
    name: "Outputs for Notes API handler",
  });
  await expect(aggregateMenu).toBeVisible();
  await expect(
    aggregateMenu.getByText("Invokes", { exact: true }),
  ).toBeVisible();
  const invokesGroup = aggregateMenu
    .locator("li")
    .filter({ hasText: "Invokes" })
    .first();
  await invokesGroup
    .getByRole("button", {
      name: "Open Invokes output details for Notes API handler",
    })
    .click();

  const connectionWizard = page.getByRole("dialog", {
    name: "Choose services to connect",
  });
  await expect(connectionWizard).toBeVisible();
  await page.keyboard.press("Escape");
  const viewportTransform = editor.locator(".react-flow__viewport");
  const transformBeforeExpansion = await viewportTransform.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  await lambda
    .getByRole("button", { name: "Expand Notes API handler" })
    .click();
  await expect(lambda).toHaveAttribute("data-collapsed", "false");
  await expect
    .poll(() =>
      viewportTransform.evaluate(
        (element) => getComputedStyle(element).transform,
      ),
    )
    .toBe(transformBeforeExpansion);
  const expandedSize = await lambda.evaluate((element) => {
    const wrapper = element.closest<HTMLElement>(".react-flow__node");
    if (wrapper === null) {
      throw new Error("The expanded service has no React Flow wrapper.");
    }
    return {
      height: wrapper.style.height,
      width: wrapper.style.width,
    };
  });
  expect(expandedSize).toEqual(compactSize);
  const details = page.getByRole("dialog", {
    exact: true,
    name: "Notes API handler",
  });
  await expect(details).toBeVisible();
  await expectServiceCardControls(lambda);
  await expect(details).not.toHaveAttribute("hidden");
  await expect(details).not.toHaveAttribute("aria-hidden");
  await expect(
    lambda.getByRole("button", { name: "Collapse Notes API handler" }),
  ).toHaveAttribute("aria-controls", detailsId);
  const detailsStyle = await details.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      minHeight: style.minHeight,
      minWidth: style.minWidth,
      overflowY: style.overflowY,
      position: style.position,
      width: style.width,
    };
  });
  expect(detailsStyle).toMatchObject({
    overflowY: "auto",
    position: "relative",
  });
  expect(Number.parseFloat(detailsStyle.width)).toBeGreaterThanOrEqual(288);
  expect(
    await details.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    ),
  ).toBeLessThanOrEqual(1);
  const heading = details.getByRole("heading", {
    name: "Settings and connections",
  });
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expectServiceCardControls(lambda);
  expect(
    (await requiredBox(heading, "readable expanded heading")).height,
  ).toBeGreaterThanOrEqual(12);
  const [detailsBounds, nodeBounds] = await Promise.all([
    requiredBox(details, "expanded Notes API handler details surface"),
    requiredBox(lambda, "fixed Notes API handler frame"),
  ]);
  expect(rectanglesOverlap(detailsBounds, nodeBounds)).toBe(false);
  const exactControls = details.locator(
    '[data-connection-control-layout="details"] .cm-popover__trigger',
  );
  await expect(exactControls).toHaveCount(0);
  await expect(
    details.getByRole("button", { name: "Add connection" }),
  ).toBeVisible();
  const exactControlBounds = await exactControls.evaluateAll((controls) =>
    controls.map((control) => {
      const bounds = control.getBoundingClientRect();
      return {
        height: bounds.height,
        width: bounds.width,
        x: bounds.x,
        y: bounds.y,
      };
    }),
  );
  for (let left = 0; left < exactControlBounds.length; left += 1) {
    for (let right = left + 1; right < exactControlBounds.length; right += 1) {
      const leftBounds = exactControlBounds[left];
      const rightBounds = exactControlBounds[right];
      if (leftBounds === undefined || rightBounds === undefined) {
        throw new Error(
          "Expected every exact connection control to have visible bounds.",
        );
      }
      expect(rectanglesOverlap(leftBounds, rightBounds)).toBe(false);
    }
  }
  const collapseControl = lambda.getByRole("button", {
    name: "Collapse Notes API handler",
  });
  const collapseBounds = await requiredBox(collapseControl, "collapse control");
  const expandedBounds = await requiredBox(lambda, "expanded service frame");
  expect(collapseBounds.y).toBeGreaterThan(
    expandedBounds.y + expandedBounds.height / 2,
  );
  await details.focus();
  await details.press("Escape");
  await expect(lambda).toHaveAttribute("data-collapsed", "true");
  await expect(collapseControl).toHaveCount(0);
  await expect(
    lambda.getByRole("button", { name: "Expand Notes API handler" }),
  ).toBeFocused();
  await expectServiceCardControls(lambda);
  await expect(editor).toHaveAttribute("data-content-hash", initialContentHash);
  await expect(editor).toHaveAttribute("data-visual-hash", initialVisualHash);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`keeps expanded service controls within the resized canvas and preserves the graph with motion ${reducedMotion}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 1_180, height: 757 });
    await page.goto(editorPath);
    const editor = page.locator(".architecture-editor");
    await expect(editor).toBeVisible({ timeout: 30_000 });
    const contentHash = await editor.getAttribute("data-content-hash");
    const visualHash = await editor.getAttribute("data-visual-hash");
    const node = editor.locator(
      '[data-architecture-node-id="node_api_handler"]',
    );
    const flow = page.locator(".architecture-canvas__flow");
    const expand = node.getByRole("button", {
      name: "Expand Notes API handler",
    });
    const collapse = node.getByRole("button", {
      name: "Collapse Notes API handler",
    });
    const viewport = editor.locator(".react-flow__viewport");
    const transformBefore = await viewport.evaluate(
      (element) => getComputedStyle(element).transform,
    );
    await expectServiceCardControls(node);
    await expand.focus();
    await expand.press("Enter");
    const details = page.getByRole("dialog", {
      name: "Notes API handler",
      exact: true,
    });
    await expect
      .poll(() =>
        viewport.evaluate((element) => getComputedStyle(element).transform),
      )
      .toBe(transformBefore);
    async function expectPanelFits() {
      await expect
        .poll(async () => {
          const [card, canvas] = await Promise.all([
            requiredBox(details, "floating service details"),
            requiredBox(flow, "canvas viewport"),
          ]);
          return (
            card.x >= canvas.x - 1 &&
            card.y >= canvas.y - 1 &&
            card.x + card.width <= canvas.x + canvas.width + 1 &&
            card.y + card.height <= canvas.y + canvas.height + 1
          );
        })
        .toBe(true);
      const reveal = await details.evaluate((element) => {
        const control = document.querySelector(
          '[data-architecture-node-id="node_api_handler"] .architecture-service-toggle',
        );
        if (control === null)
          throw new Error("Expanded service control is missing");
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        const measure = (fraction: number) => {
          const content = element.getBoundingClientRect();
          const action = control.getBoundingClientRect();
          return {
            fraction,
            content: content.toJSON() as Rectangle,
            action: action.toJSON() as Rectangle,
            transform: getComputedStyle(element).transform,
            opacity: getComputedStyle(element).opacity,
          };
        };
        const viewport = {
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
        };
        if (reduced) return { reduced, viewport, samples: [measure(1)] };
        // Restart the existing CSS reveal so even a fast completed animation
        // is checked at its maximum offset, without a timing-dependent sleep.
        const previousName = element.style.animationName;
        element.style.animationName = "none";
        element.getBoundingClientRect();
        element.style.animationName = previousName;
        const animation = element
          .getAnimations()
          .find(
            (motion) =>
              motion instanceof CSSAnimation &&
              motion.animationName === "architecture-service-open",
          );
        const duration = animation?.effect?.getTiming().duration;
        if (animation === undefined || typeof duration !== "number")
          throw new Error("Expected the normal service reveal animation");
        animation.pause();
        try {
          const samples = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            animation.currentTime = duration * fraction;
            return measure(fraction);
          });
          return { reduced, viewport, duration, samples };
        } finally {
          animation.finish();
        }
      });
      await test.info().attach("service-reveal-geometry", {
        body: JSON.stringify(reveal),
        contentType: "application/json",
      });
      for (const sample of reveal.samples)
        expect(rectanglesOverlap(sample.action, sample.content)).toBe(false);
      expect(
        rectanglesOverlap(
          await requiredBox(collapse, "collapse control"),
          await requiredBox(details, "details content"),
        ),
      ).toBe(false);
    }
    await expectPanelFits();
    const animation = await details.evaluate(
      (element) => getComputedStyle(element).animationDuration,
    );
    if (reducedMotion === "reduce")
      expect(Number.parseFloat(animation)).toBe(0);
    else expect(Number.parseFloat(animation)).toBeGreaterThan(0);
    for (const width of [944, 787]) {
      await page.setViewportSize({ width, height: 600 });
      await expectPanelFits();
    }
    for (let count = 0; count < 3; count += 1) {
      await collapse.press("Enter");
      await expand.press("Enter");
    }
    await expectPanelFits();
    await expect(collapse).toBeFocused();
    await expect(editor).toHaveAttribute(
      "data-content-hash",
      contentHash ?? "",
    );
    await expect(editor).toHaveAttribute("data-visual-hash", visualHash ?? "");
  });
}

test("confirms service deletion from the Inspector and restores it with Undo", async ({
  page,
}) => {
  await page.goto(editorPath);

  const editor = page.locator(".architecture-editor");
  const initialContentHash = await editor.getAttribute("data-content-hash");
  if (initialContentHash === null)
    throw new Error("Expected the fixture document content hash.");
  await chooseCanvasAction(page, "Fit architecture");
  const table = editor.locator(
    '[data-architecture-node-id="node_notes_table"]',
  );
  const tableFlowNode = editor.getByRole("group", {
    name: /^Notes data\./u,
  });
  await tableFlowNode.focus();
  await tableFlowNode.press("Enter");
  await expect(table).toHaveAttribute("data-selected", "true");
  await page
    .getByRole("navigation", { name: "Inspector tools" })
    .getByRole("button", { name: "Configure" })
    .click();
  const inspector = page.getByRole("dialog", { name: "Configure inspector" });
  const deleteService = inspector.getByRole("button", {
    name: "Delete service",
  });
  await expect(deleteService).toHaveAttribute("data-variant", "secondary");
  expect(
    await deleteService.evaluate((button) => {
      const tabs = button
        .closest(".selected-inspector")
        ?.querySelector(".cm-tabs");
      return (
        tabs !== null &&
        tabs !== undefined &&
        Boolean(
          tabs.compareDocumentPosition(button) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        )
      );
    }),
  ).toBe(true);
  await deleteService.click();
  let confirmation = page.getByRole("dialog", { name: "Delete Notes data?" });
  await expect(confirmation).toContainText("0 connected relationships");
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(table).toHaveCount(1);
  await expect(editor).toHaveAttribute("data-content-hash", initialContentHash);

  await deleteService.click();
  confirmation = page.getByRole("dialog", { name: "Delete Notes data?" });
  await confirmation.getByRole("button", { name: "Delete service" }).click();
  await expect(table).toHaveCount(0);
  await expect(editor).not.toHaveAttribute(
    "data-content-hash",
    initialContentHash,
  );
  await page.keyboard.press("Control+z");
  await expect(table).toHaveCount(1);
  await expect(editor).toHaveAttribute("data-content-hash", initialContentHash);
});

test("keeps a grouped connection endpoint fixed while card content and its external menu move", async ({
  page,
}) => {
  await page.goto(nestedBoundaryEditorPath);
  await chooseCanvasAction(page, "Fit architecture");

  const editor = page.locator(".architecture-editor");
  const application = editor.locator(
    '[data-architecture-node-id="node_application"]',
  );
  await expandServiceNode(application, "Application");
  const details = page.getByRole("dialog", {
    exact: true,
    name: "Application",
  });
  const trigger = details.getByRole("button", {
    name: "Open Identity & network output connections for Application; 1 current connection; connections available",
    exact: true,
  });
  const dock = trigger.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' architecture-connection-dock ')][1]",
  );
  const handle = application.locator(
    '[data-connection-anchor-id="dock:network-and-security:output"] > .react-flow__handle',
  );
  const dot = dock.locator(".architecture-connection-dock__dot");
  const edgePath = editor.locator(
    '[data-testid="rf__edge-edge_application_network"] .architecture-edge__path',
  );
  const initialContentHash = await editor.getAttribute("data-content-hash");
  const initialVisualHash = await editor.getAttribute("data-visual-hash");
  if (initialContentHash === null || initialVisualHash === null) {
    throw new Error("The fixture editor did not expose both document hashes.");
  }

  async function endpointSnapshot() {
    const [handleBox, path] = await Promise.all([
      handle.boundingBox(),
      edgePath.getAttribute("d"),
    ]);
    if (handleBox === null || path === null) {
      throw new Error(
        "The grouped dock handle and exact edge path must render.",
      );
    }
    return {
      handleCenterX: handleBox.x + handleBox.width / 2,
      handleCenterY: handleBox.y + handleBox.height / 2,
      path: path.replace(/-?\d+(?:\.\d+)?/gu, (coordinate) =>
        Number(coordinate).toFixed(3),
      ),
    };
  }

  await expect(trigger).toBeVisible();
  await expect(dock).toHaveAttribute("data-actionable", "true");
  await expect(dock).toHaveAttribute(
    "data-connection-control-layout",
    "details",
  );
  await expect(dock).toHaveAttribute("data-direction", "output");
  await expect(dock).toHaveAttribute("data-side", "right");
  await expect(dot).toBeVisible();
  const [applicationBox, detailsBox, dotBox, triggerBox, visualHandleBox] =
    await Promise.all([
      application.boundingBox(),
      details.boundingBox(),
      dot.boundingBox(),
      trigger.boundingBox(),
      handle.boundingBox(),
    ]);
  if (
    applicationBox === null ||
    detailsBox === null ||
    dotBox === null ||
    triggerBox === null ||
    visualHandleBox === null
  ) {
    throw new Error(
      "The service frame, details surface, exact control, and stable handle must render.",
    );
  }
  const dotCenter = {
    x: dotBox.x + dotBox.width / 2,
    y: dotBox.y + dotBox.height / 2,
  };
  expect(rectanglesOverlap(applicationBox, detailsBox)).toBe(false);
  expect(rectanglesOverlap(detailsBox, triggerBox)).toBe(true);
  expect(dotCenter.x).toBeGreaterThanOrEqual(triggerBox.x);
  expect(dotCenter.x).toBeLessThanOrEqual(triggerBox.x + triggerBox.width);
  expect(dotCenter.y).toBeGreaterThanOrEqual(triggerBox.y);
  expect(dotCenter.y).toBeLessThanOrEqual(triggerBox.y + triggerBox.height);
  expect(
    Math.abs(
      visualHandleBox.x +
        visualHandleBox.width / 2 -
        (applicationBox.x + applicationBox.width),
    ),
  ).toBeLessThanOrEqual(2);
  await expect(edgePath).toBeVisible();

  await expect(details).not.toHaveClass(/nowheel/u);
  expect(
    await details.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    ),
  ).toBeLessThanOrEqual(1);
  const viewportTransform = editor.locator(".react-flow__viewport");
  const transformBeforeWheel = await viewportTransform.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  const detailsScrollMetrics = await details.evaluate((element) => {
    element.style.minBlockSize = "0";
    element.style.maxBlockSize = "6rem";
    element.style.overflowY = "scroll";
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });
  expect(detailsScrollMetrics.scrollHeight).toBeGreaterThan(
    detailsScrollMetrics.clientHeight,
  );
  // Scrolling the floating details must leave the compact node's edge fixed.
  await expect
    .poll(async () => {
      const box = await requiredBox(handle, "resized connection handle");
      const point = await edgePath.evaluate((element) => {
        if (!(element instanceof SVGPathElement))
          throw new Error("Expected edge path");
        const matrix = element.getScreenCTM();
        if (!matrix) throw new Error("Expected screen transform");
        const start = element.getPointAtLength(0);
        const screen = new DOMPoint(start.x, start.y).matrixTransform(matrix);
        return { x: screen.x, y: screen.y };
      });
      return Math.max(
        Math.abs(point.x - box.x - box.width / 2),
        Math.abs(point.y - box.y - box.height / 2),
      );
    })
    .toBeLessThanOrEqual(3);
  const closedEndpoint = await endpointSnapshot();
  await details.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(async () => details.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      viewportTransform.evaluate(
        (element) => getComputedStyle(element).transform,
      ),
    )
    .toBe(transformBeforeWheel);
  await expect.poll(endpointSnapshot).toEqual(closedEndpoint);
  await details.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(application.locator(".architecture-node__ports")).toHaveCount(0);
  const nodeScrollAttempt = await application.evaluate((element) => {
    const before = element.scrollTop;
    element.scrollTop = 100;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
    return {
      after: element.scrollTop,
      before,
      overflowY: window.getComputedStyle(element).overflowY,
    };
  });
  expect(["auto", "scroll"]).not.toContain(nodeScrollAttempt.overflowY);
  expect(nodeScrollAttempt.after).toBe(nodeScrollAttempt.before);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          resolve();
        });
      }),
  );
  await expect.poll(endpointSnapshot).toEqual(closedEndpoint);
  await expect(editor).toHaveAttribute("data-content-hash", initialContentHash);
  await expect(editor).toHaveAttribute("data-visual-hash", initialVisualHash);

  await trigger.click();
  const menu = page.getByRole("dialog", {
    name: "Identity & network output connections for Application",
  });
  await expect(menu).toBeVisible();
  expect(
    await menu.evaluate(
      (element) => element.parentElement === element.ownerDocument.body,
    ),
  ).toBe(true);
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error("The test browser must expose its viewport size.");
  }
  const { height: viewportHeight, width: viewportWidth } = viewport;
  async function menuIsAdjacentToApplication(): Promise<boolean> {
    const [menuBox, ownerBox, placement] = await Promise.all([
      menu.boundingBox(),
      application.boundingBox(),
      menu.getAttribute("data-placement"),
    ]);
    if (
      menuBox === null ||
      ownerBox === null ||
      (placement !== "left" && placement !== "right")
    ) {
      return false;
    }
    const horizontalGap =
      placement === "right"
        ? menuBox.x - (ownerBox.x + ownerBox.width)
        : ownerBox.x - (menuBox.x + menuBox.width);
    const overlapsVertically =
      menuBox.y < ownerBox.y + ownerBox.height &&
      menuBox.y + menuBox.height > ownerBox.y;
    const insideViewportGutter =
      menuBox.x >= 15 &&
      menuBox.y >= 15 &&
      menuBox.x + menuBox.width <= viewportWidth - 15 &&
      menuBox.y + menuBox.height <= viewportHeight - 15;
    return (
      Math.abs(horizontalGap - 8) <= 2 &&
      overlapsVertically &&
      insideViewportGutter
    );
  }
  await expect.poll(menuIsAdjacentToApplication).toBe(true);
  await expect.poll(endpointSnapshot).toEqual(closedEndpoint);
  await expect(editor).toHaveAttribute("data-content-hash", initialContentHash);
  await expect(editor).toHaveAttribute("data-visual-hash", initialVisualHash);

  const scrollMetrics = await menu.evaluate((element) => {
    element.style.maxBlockSize = "8rem";
    element.style.overflowY = "scroll";
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(
    scrollMetrics.clientHeight,
  );
  await menu.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(async () => menu.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect.poll(menuIsAdjacentToApplication).toBe(true);
  await expect.poll(endpointSnapshot).toEqual(closedEndpoint);
  await expect(editor).toHaveAttribute("data-content-hash", initialContentHash);
  await expect(editor).toHaveAttribute("data-visual-hash", initialVisualHash);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect.poll(endpointSnapshot).toEqual(closedEndpoint);
  await expect(editor).toHaveAttribute("data-content-hash", initialContentHash);
  await expect(editor).toHaveAttribute("data-visual-hash", initialVisualHash);
});

test("previews, preserves across mode changes, cancels, and applies deterministic automatic layout", async ({
  page,
}) => {
  await page.goto(nestedBoundaryEditorPath);
  await chooseCanvasAction(page, "Fit architecture");

  const editor = page.locator(".architecture-editor");
  const network = editor.locator('[data-architecture-node-id="node_network"]');
  const application = editor.locator(
    '[data-architecture-node-id="node_application"]',
  );
  const originalContentHash = await editor.getAttribute("data-content-hash");
  const originalVisualHash = await editor.getAttribute("data-visual-hash");
  if (originalContentHash === null || originalVisualHash === null) {
    throw new Error("The fixture editor did not expose both document hashes.");
  }

  await expect(network).toBeVisible();
  await expect(application).toBeVisible();
  const expandedNetwork = await requiredBox(
    network,
    "expanded network boundary",
  );
  await network.getByRole("button", { name: "Hide contents" }).click();
  const compactNetwork = await requiredBox(network, "compact network boundary");
  expect(compactNetwork.height).toBeLessThan(expandedNetwork.height * 0.6);
  expect(compactNetwork.height).toBeGreaterThanOrEqual(70);
  await expect(
    editor.locator('[data-architecture-node-id="node_zone"]'),
  ).toHaveCount(0);
  await expect(application).toHaveCount(0);
  await network.getByRole("button", { name: "Show contents" }).click();
  await expect(application).toBeVisible();
  expect(
    (await requiredBox(network, "restored network boundary")).height,
  ).toBeCloseTo(expandedNetwork.height, 0);

  await application.click();
  await page
    .getByRole("navigation", { name: "Inspector tools" })
    .getByRole("button", { name: "Configure" })
    .click();
  const configurePopup = page.getByRole("dialog", {
    name: "Configure inspector",
  });
  const selectedOverviewSummary = configurePopup
    .getByRole("region", { name: "Selected architecture element" })
    .locator("summary")
    .filter({ hasText: "Selected architecture element details:" });
  await expect(selectedOverviewSummary).toHaveAccessibleName(
    /Selected architecture element details:.*Application resource.*Application/iu,
  );
  await selectedOverviewSummary.click();
  const placement = configurePopup.getByRole("combobox", {
    name: "Place this resource",
  });
  await expect(placement).toHaveValue("node:node_zone");
  await placement.selectOption("root:");
  await configurePopup.getByRole("button", { name: "Apply placement" }).click();
  await expect(editor).not.toHaveAttribute(
    "data-content-hash",
    originalContentHash,
  );
  await placement.selectOption("node:node_zone");
  await configurePopup.getByRole("button", { name: "Apply placement" }).click();
  await expect(editor).toHaveAttribute(
    "data-content-hash",
    originalContentHash,
  );
  await expect(editor).not.toHaveAttribute(
    "data-visual-hash",
    originalVisualHash,
  );
  const placementVisualHash = await editor.getAttribute("data-visual-hash");
  if (placementVisualHash === null) {
    throw new Error("The readable placement did not expose a visual hash.");
  }
  const placementNodeTransforms = await readNodeTransforms(editor);

  await chooseCanvasAction(page, "Arrange automatically");
  const calculatingDialog = page.getByRole("dialog", {
    name: "Calculating automatic layout",
  });
  await expect(calculatingDialog).toBeVisible();
  await calculatingDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(calculatingDialog).toHaveCount(0);
  await expect(editor).toHaveAttribute(
    "data-content-hash",
    originalContentHash,
  );
  await expect(editor).toHaveAttribute("data-visual-hash", placementVisualHash);
  await expect
    .poll(async () => readNodeTransforms(editor))
    .toEqual(placementNodeTransforms);

  await chooseCanvasAction(page, "Arrange automatically");
  const previewDialog = page.getByRole("dialog", {
    name: "Review automatic layout",
  });
  await expect(previewDialog).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => readNodeTransforms(editor))
    .not.toEqual(placementNodeTransforms);
  await expect(editor).toHaveAttribute(
    "data-content-hash",
    originalContentHash,
  );
  await expect(editor).toHaveAttribute("data-visual-hash", placementVisualHash);

  await previewDialog.getByRole("button", { name: "Professional" }).click();
  await expect(previewDialog).toContainText(
    "Exact position-only Graph Command preview",
  );
  await expect(editor).toHaveAttribute(
    "data-content-hash",
    originalContentHash,
  );
  await previewDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(previewDialog).toHaveCount(0);
  await expect(editor).toHaveAttribute(
    "data-content-hash",
    originalContentHash,
  );
  await expect(editor).toHaveAttribute("data-visual-hash", placementVisualHash);
  await expect
    .poll(async () => readNodeTransforms(editor))
    .toEqual(placementNodeTransforms);

  await chooseCanvasAction(page, "Arrange automatically");
  const secondPreview = page.getByRole("dialog", {
    name: "Review automatic layout",
  });
  await expect(secondPreview).toBeVisible({ timeout: 30_000 });
  await secondPreview
    .getByRole("button", { name: /^Apply positions/u })
    .click();

  await expect(secondPreview).toHaveCount(0);
  await expect(editor).toHaveAttribute(
    "data-content-hash",
    originalContentHash,
  );
  await expect(editor).not.toHaveAttribute(
    "data-visual-hash",
    placementVisualHash,
  );
});

test("keeps fixed desktop Inspector and Workspace launchers compact, exclusive, and non-semantic", async ({
  page,
}) => {
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(editorPath);

    const editor = page.locator(".architecture-editor");
    const shell = page.locator(".workspace-shell");
    const inspectorTools = page.getByRole("navigation", {
      name: "Inspector tools",
    });
    const workspaceTools = page.getByRole("navigation", {
      name: "Workspace tools",
    });
    const architecture = inspectorTools.getByRole("button", {
      name: "Architecture",
    });
    const configure = inspectorTools.getByRole("button", {
      name: "Configure",
    });
    const issues = workspaceTools.getByRole("button", { name: "Issues" });
    const activity = workspaceTools.getByRole("button", {
      name: "Activity",
    });
    const initialContentHash = await editor.getAttribute("data-content-hash");
    const initialVisualHash = await editor.getAttribute("data-visual-hash");
    if (initialContentHash === null || initialVisualHash === null) {
      throw new Error(
        "The fixture editor did not expose both document hashes.",
      );
    }

    if (width === 1280) {
      await expect(
        page
          .getByRole("button", { name: "Open Canvas menu" })
          .getByText("Canvas", { exact: true }),
      ).toBeVisible();
    }

    await expect(
      page.getByRole("separator", { name: "Resize service catalog" }),
    ).toHaveAttribute("aria-valuenow", "300");
    await expect(
      page.getByRole("separator", {
        name: /Resize (?:contextual inspector|bottom workspace)/u,
      }),
    ).toHaveCount(0);
    await expect(shell).toHaveAttribute("data-inspector-open", "false");
    await expect(shell).toHaveAttribute("data-workspace-open", "false");
    await expect(inspectorTools.getByRole("button")).toHaveCount(4);
    await expect(workspaceTools.getByRole("button")).toHaveCount(4);
    await expect(architecture).toHaveAttribute("aria-haspopup", "dialog");
    await expect(configure).toHaveAttribute("aria-expanded", "false");
    await expect(issues).toHaveAttribute("aria-expanded", "false");
    expect(
      (await requiredBox(inspectorTools, "Inspector launcher rail")).width,
    ).toBeLessThanOrEqual(92);
    expect(
      (await requiredBox(workspaceTools, "Workspace launcher bar")).height,
    ).toBeLessThanOrEqual(48);

    const catalogToggle = page.getByRole("button", { name: "Hide Catalog" });
    const bottomBefore = await requiredBox(
      workspaceTools,
      "Workspace launcher",
    );
    const zoomBefore = await requiredBox(
      page.locator(".architecture-zoom-status"),
      "Zoom status",
    );
    await catalogToggle.click();
    await expect(
      page.getByRole("button", { name: "Show Catalog" }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const [bottom, zoom] = await Promise.all([
          requiredBox(workspaceTools, "Workspace launcher after Catalog close"),
          requiredBox(
            page.locator(".architecture-zoom-status"),
            "Zoom status after Catalog close",
          ),
        ]);
        return Math.max(
          Math.abs(bottom.x - bottomBefore.x),
          Math.abs(bottom.y - bottomBefore.y),
          Math.abs(zoom.x - zoomBefore.x),
          Math.abs(zoom.y - zoomBefore.y),
        );
      })
      .toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Show Catalog" }).click();

    await architecture.click();
    const architecturePopup = page.getByRole("dialog", {
      name: "Architecture inspector",
    });
    await expect(architecturePopup).toBeVisible();
    await expect(architecture).toHaveAttribute("aria-expanded", "true");
    await expect(
      architecturePopup.getByRole("region", { name: "Architecture list" }),
    ).toBeVisible();
    await expect(page.locator(".editor-popup-surface")).toHaveCount(1);

    await configure.click();
    const configurePopup = page.getByRole("dialog", {
      name: "Configure inspector",
    });
    await expect(configurePopup).toBeVisible();
    await expect(architecturePopup).toHaveCount(0);
    await expect(configure).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".editor-popup-surface")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(configurePopup).toHaveCount(0);
    await expect(configure).toBeFocused();

    await issues.click();
    const issuesPopup = page.getByRole("dialog", {
      name: "Issues workspace",
    });
    await expect(issuesPopup).toBeVisible();
    await expect(issues).toHaveAttribute("aria-expanded", "true");
    for (const [tabLabel, emptyHeading] of [
      ["Assistant", "Assistant not available"],
      ["Code", "No resource selected"],
    ] as const) {
      const tabTrigger = workspaceTools.getByRole("button", {
        name: tabLabel,
      });
      await tabTrigger.click();
      const tabPopup = page.getByRole("dialog", {
        name: `${tabLabel} workspace`,
      });
      await expect(tabPopup).toBeVisible();
      await expect(
        tabPopup.getByRole("heading", { name: emptyHeading }),
      ).toBeVisible();
      await expect(
        tabPopup.getByRole("tab", { name: tabLabel }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(tabPopup.locator(".cm-tabs")).toHaveAttribute(
        "data-size",
        "compact",
      );
    }
    await activity.click();
    const activityPopup = page.getByRole("dialog", {
      name: "Activity workspace",
    });
    await expect(activityPopup).toBeVisible();
    await expect(
      activityPopup.getByRole("heading", { name: "This editing session" }),
    ).toBeVisible();
    await expect(issuesPopup).toHaveCount(0);
    await expect(page.locator(".editor-popup-surface")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(activityPopup).toHaveCount(0);
    await expect(activity).toBeFocused();

    await expect(editor).toHaveAttribute(
      "data-content-hash",
      initialContentHash,
    );
    await expect(editor).toHaveAttribute("data-visual-hash", initialVisualHash);
    await expectPageToStayWithinViewport(page);
  }
});

for (const viewport of representativeDesktopViewports) {
  test(`keeps the full canvas, fitted graph, and minimap clear of floating panels at ${String(viewport.width)}x${String(viewport.height)}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(editorPath);

    const shell = page.locator(".workspace-shell");
    const flow = page.locator(".architecture-canvas__flow");
    const editor = page.locator(".architecture-editor");
    const minimap = page.locator(".react-flow__minimap.architecture-minimap");
    const inspectorTools = page.getByRole("navigation", {
      name: "Inspector tools",
    });
    const workspaceTools = page.getByRole("navigation", {
      name: "Workspace tools",
    });

    await expect(editor.locator("[data-architecture-node-id]")).toHaveCount(
      fixtureNodeIds.length,
    );
    await expect(shell).toHaveAttribute("data-catalog-open", "true");
    await expect(shell).toHaveAttribute("data-inspector-open", "false");
    await expect(shell).toHaveAttribute("data-workspace-open", "false");

    const originalContentHash = await editor.getAttribute("data-content-hash");
    const originalVisualHash = await editor.getAttribute("data-visual-hash");
    if (originalContentHash === null || originalVisualHash === null) {
      throw new Error(
        "The fixture editor did not expose both document hashes.",
      );
    }

    const initialShellBox = await requiredBox(shell, "workspace shell");
    const initialFlowBox = await requiredBox(flow, "full architecture canvas");
    expectSameRectangle(initialFlowBox, initialShellBox);
    await expectSurfaceToFillViewportBelowAppBar(page, shell);
    await expectPageToStayWithinViewport(page);

    const initialMiniMapBox = await requiredBox(
      minimap,
      "architecture minimap",
    );
    expect(initialMiniMapBox.width).toBeCloseTo(152, 0);
    expect(initialMiniMapBox.height).toBeCloseTo(104, 0);
    expect(
      Math.abs(
        initialFlowBox.y +
          initialFlowBox.height -
          (initialMiniMapBox.y + initialMiniMapBox.height) -
          72,
      ),
    ).toBeLessThanOrEqual(1);
    await expect(inspectorTools.getByRole("button")).toHaveCount(4);
    await expect(workspaceTools.getByRole("button")).toHaveCount(4);

    await chooseCanvasAction(page, "Fit architecture");
    await expectGraphToAvoidIntentionalOverlays(page, {
      catalog: true,
      inspector: true,
      workspace: false,
    });
    await expectCanvasPointsToReachFlow(page, flow, [
      { xRatio: 0.5, yRatio: 0.55 },
    ]);

    const flowViewport = flow.locator(".react-flow__viewport");
    const transformBeforeWorkspace = await readViewportTransform(flowViewport);
    await workspaceTools.getByRole("button", { name: "Issues" }).click();
    const workspace = page.getByRole("dialog", { name: "Issues workspace" });
    await expect(workspace).toBeVisible();
    await expect(shell).toHaveAttribute("data-workspace-open", "true");
    await expect
      .poll(async () => readViewportTransform(flowViewport))
      .toBe(transformBeforeWorkspace);
    await expectSameCanvasBounds(flow, initialFlowBox);
    await expectGraphToAvoidIntentionalOverlays(page, {
      catalog: true,
      inspector: false,
      workspace: true,
    });
    if (viewport.width === 1280) {
      const fixtureDetails = page.locator(
        ".architecture-fixture-status__disclosure",
      );
      const fixtureDetailsSummary = fixtureDetails.locator(":scope > summary");
      await fixtureDetailsSummary.focus();
      await fixtureDetailsSummary.press("Enter");
      await expect(fixtureDetails).toHaveJSProperty("open", true);
      await expectGraphToAvoidIntentionalOverlays(page, {
        catalog: true,
        inspector: false,
        workspace: true,
      });
      // The modeless workspace may cover this developer notice; keyboard
      // disclosure control remains available without scrolling the canvas.
      await fixtureDetailsSummary.press("Enter");
      await expect(fixtureDetails).toHaveJSProperty("open", false);
    }

    const transformBeforeSidePanels = await readViewportTransform(flowViewport);
    await page.getByRole("button", { name: "Hide Catalog" }).click();
    const collapsedCatalog = page.locator(".workspace-shell__catalog");
    const showCatalog = page.getByRole("button", { name: "Show Catalog" });
    await expect(collapsedCatalog).toBeVisible();
    await expect(collapsedCatalog).toHaveAttribute("data-expanded", "false");
    await expect(page.locator("#catalog-content")).toBeHidden();
    await expect(showCatalog).toBeVisible();
    const leftInset = await showCatalog.evaluate((element) => {
      const shell = element.closest(".workspace-shell");
      if (!shell) throw new Error("Expected a canvas services launcher");
      return (
        element.getBoundingClientRect().x - shell.getBoundingClientRect().x
      );
    });
    expect(leftInset).toBeGreaterThanOrEqual(12);
    expect(leftInset).toBeLessThanOrEqual(20);
    await inspectorTools.getByRole("button", { name: "Configure" }).click();
    const inspector = page.getByRole("dialog", { name: "Configure inspector" });
    await expect(inspector).toBeVisible();
    await expect(workspace).toHaveCount(0);
    await expect(shell).toHaveAttribute("data-catalog-open", "false");
    await expect(shell).toHaveAttribute("data-inspector-open", "true");
    await expect(shell).toHaveAttribute("data-workspace-open", "false");
    await expect
      .poll(async () => readViewportTransform(flowViewport))
      .toBe(transformBeforeSidePanels);
    await expectSameCanvasBounds(flow, initialFlowBox);
    await expectGraphToAvoidIntentionalOverlays(page, {
      catalog: false,
      inspector: true,
      workspace: false,
    });

    const transformBeforeInspectorClose =
      await readViewportTransform(flowViewport);
    await page.keyboard.press("Escape");
    await expect(shell).toHaveAttribute("data-inspector-open", "false");
    await expect
      .poll(async () => readViewportTransform(flowViewport))
      .toBe(transformBeforeInspectorClose);
    await expectSameCanvasBounds(flow, initialFlowBox);
    await expect
      .poll(async () => {
        const miniMapBox = await minimap.boundingBox();
        const flowBox = await flow.boundingBox();
        if (miniMapBox === null || flowBox === null) {
          return {
            bottomGap: Number.NaN,
            rightGap: Number.NaN,
          };
        }
        return {
          bottomGap:
            flowBox.y + flowBox.height - (miniMapBox.y + miniMapBox.height),
          rightGap:
            flowBox.x + flowBox.width - (miniMapBox.x + miniMapBox.width),
        };
      })
      .toEqual({ bottomGap: 72, rightGap: 116 });
    await chooseCanvasAction(page, "Fit architecture");
    await expectGraphToAvoidIntentionalOverlays(page, {
      catalog: false,
      inspector: false,
      workspace: false,
    });
    await expectCanvasPointsToReachFlow(page, flow, [
      { xRatio: 0.25, yRatio: 0.5 },
      { xRatio: 0.5, yRatio: 0.5 },
      { xRatio: 0.75, yRatio: 0.5 },
    ]);
    await expectCanvasBackgroundPanAndMiniMapSync(
      page,
      flow,
      page.getByRole("img", {
        name: "Architecture overview",
      }),
    );
    await expectPageToStayWithinViewport(page);
    await expect(editor).toHaveAttribute(
      "data-content-hash",
      originalContentHash,
    );
    await expect(editor).toHaveAttribute(
      "data-visual-hash",
      originalVisualHash,
    );
  });
}

for (const viewport of representativeTabletViewports) {
  test(`keeps the responsive tablet canvas at a real full-height bound at ${String(viewport.width)}x${String(viewport.height)}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(editorPath);

    const routeWorkspace = page.locator("#architecture-workspace");
    const responsiveShell = page.locator(".responsive-workspace-shell");
    const flow = page.locator(".architecture-canvas__flow");
    const routeBox = await requiredBox(
      routeWorkspace,
      "responsive architecture workspace",
    );
    const flowBox = await requiredBox(flow, "responsive architecture canvas");

    expect(routeBox.height).toBeGreaterThan(0);
    expect(flowBox.height).toBeGreaterThan(0);
    expectSameRectangle(flowBox, routeBox);
    await expectSurfaceToFillViewportBelowAppBar(page, responsiveShell);
    await expectPageToStayWithinViewport(page);
  });
}

test("keeps the catalog resizable while fixed launchers and popup surfaces stay bounded", async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto(editorPath);
  await expect(page.locator(".architecture-editor")).toBeVisible({
    timeout: 30_000,
  });

  const catalogPanel = page.locator(".workspace-shell__catalog");
  const catalogResize = page.getByRole("separator", {
    name: "Resize service catalog",
  });

  await expectResizeHandleToMatchPanel(
    catalogResize,
    catalogPanel,
    "vertical",
    "end",
  );

  const catalogValueBeforeDrag = Number(
    await catalogResize.getAttribute("aria-valuenow"),
  );
  const catalogBoxBeforeDrag = await requiredBox(
    catalogPanel,
    "catalog before pointer resize",
  );
  const catalogHandleBox = await requiredBox(
    catalogResize,
    "catalog resize handle",
  );
  await page.mouse.move(
    catalogHandleBox.x + catalogHandleBox.width / 2,
    catalogHandleBox.y + catalogHandleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    catalogHandleBox.x + catalogHandleBox.width / 2 + 32,
    catalogHandleBox.y + catalogHandleBox.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Number(await catalogResize.getAttribute("aria-valuenow")))
    .toBeGreaterThan(catalogValueBeforeDrag);
  await expect
    .poll(async () => (await catalogPanel.boundingBox())?.width ?? Number.NaN)
    .toBeGreaterThan(catalogBoxBeforeDrag.width);

  await catalogResize.press("Home");
  await expect(catalogResize).toHaveAttribute("aria-valuenow", "224");
  const minimumCatalogActions = page
    .locator(".service-catalog-card__actions")
    .first();
  await expect
    .poll(async () =>
      minimumCatalogActions.evaluate((actions) => {
        const scrollRegion = actions.closest<HTMLElement>(
          "[data-catalog-scroll-region]",
        );
        if (scrollRegion === null) {
          return false;
        }

        const visibleBounds = scrollRegion.getBoundingClientRect();
        const visibleRight = visibleBounds.left + scrollRegion.clientWidth;
        return [...actions.querySelectorAll<HTMLElement>("button")].every(
          (button) => {
            const buttonBounds = button.getBoundingClientRect();
            return (
              buttonBounds.left >= visibleBounds.left - 1 &&
              buttonBounds.right <= visibleRight + 1
            );
          },
        );
      }),
    )
    .toBe(true);
  for (let step = 0; step < 14; step += 1) {
    await catalogResize.press("ArrowRight");
  }
  await expect(catalogResize).toHaveAttribute("aria-valuenow", "336");

  await expect(
    page.getByRole("separator", {
      name: /Resize (?:contextual inspector|bottom workspace)/u,
    }),
  ).toHaveCount(0);
  await expect(page.locator(".architecture-workspace")).toHaveAttribute(
    "data-inspector-occlusion",
    "104",
  );
  await expect(page.locator(".architecture-workspace")).toHaveAttribute(
    "data-workspace-occlusion",
    "60",
  );
  await chooseCanvasAction(page, "Fit architecture");
  await expectGraphToAvoidIntentionalOverlays(page, {
    catalog: true,
    inspector: false,
    workspace: false,
  });
  await expectResizeHandleToMatchPanel(
    catalogResize,
    catalogPanel,
    "vertical",
    "end",
  );

  const workspaceTrigger = page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: "Issues" });
  await workspaceTrigger.click();
  const workspacePopup = page.getByRole("dialog", {
    name: "Issues workspace",
  });
  await expect(workspacePopup).toBeVisible();
  await expect(workspacePopup).toHaveCSS("box-shadow", /rgba|rgb/u);
  const popupBox = await requiredBox(workspacePopup, "Issues workspace popup");
  const openCatalogBox = await requiredBox(
    catalogPanel,
    "open Catalog beside Issues workspace",
  );
  expect(
    popupBox.x - (openCatalogBox.x + openCatalogBox.width),
  ).toBeGreaterThanOrEqual(8);
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error("Playwright did not expose the desktop viewport.");
  }
  expect(popupBox.x).toBeGreaterThanOrEqual(0);
  expect(popupBox.y).toBeGreaterThanOrEqual(0);
  expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(viewport.width);
  expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(viewport.height);
  await page.keyboard.press("Escape");
  await expect(workspacePopup).toHaveCount(0);
  await expect(workspaceTrigger).toBeFocused();
  await expectPageToStayWithinViewport(page);

  // Continue from the same 1280x800 canvas after resetting the catalog to 336.
  // Retain the Canvas-action entry point and skip-link focus without a second mount.
  {
    const editor = page.locator(".architecture-editor");
    const shell = page.locator(".workspace-shell");
    const catalogResize = page.getByRole("separator", {
      name: "Resize service catalog",
    });
    const initialContentHash = await editor.getAttribute("data-content-hash");
    const initialVisualHash = await editor.getAttribute("data-visual-hash");
    if (initialContentHash === null || initialVisualHash === null) {
      throw new Error(
        "The fixture editor did not expose both document hashes.",
      );
    }

    await catalogResize.press("End");
    await expect(catalogResize).toHaveAttribute("aria-valuenow", "844");
    await chooseCanvasAction(page, "Architecture list");
    await expect(shell).toHaveAttribute("data-inspector-open", "true");
    await expect(
      page.getByRole("dialog", { name: "Architecture inspector" }),
    ).toBeVisible();
    await expect(page.locator("#architecture-list")).toBeFocused();
    await expect(catalogResize).toHaveAttribute("aria-valuenow", "388");

    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Architecture inspector" }),
    ).toHaveCount(0);
    await expect(catalogResize).toHaveAttribute("aria-valuenow", "844");
    await page.getByRole("button", { name: "Hide Catalog" }).click();
    const skipToCatalog = page.getByRole("link", { name: "Skip to catalog" });
    await skipToCatalog.focus();
    await skipToCatalog.press("Enter");
    await expect(shell).toHaveAttribute("data-catalog-open", "true");
    await expect(page.locator("#catalog-panel")).toBeFocused();
    await expect(editor).toHaveAttribute(
      "data-content-hash",
      initialContentHash,
    );
    await expect(editor).toHaveAttribute("data-visual-hash", initialVisualHash);
  }
});

for (const responsiveWorkspaceViewport of [
  { bodySelector: ".cm-drawer__body", height: 600, width: 900 },
  { bodySelector: ".cm-modal-drawer__body", height: 568, width: 320 },
] as const) {
  test(`keeps responsive Workspace tabs fixed while only Issues scrolls at ${String(responsiveWorkspaceViewport.width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({
      height: responsiveWorkspaceViewport.height,
      width: responsiveWorkspaceViewport.width,
    });
    await page.goto(editorPath);
    const workspaceTrigger =
      responsiveWorkspaceViewport.width === 900
        ? page.getByRole("button", { exact: true, name: "Workspace" })
        : page
            .getByRole("navigation", { name: "Phone workspace navigation" })
            .getByRole("button", { exact: true, name: "Issues" });
    await workspaceTrigger.click();

    const workspaceDrawer = page.getByRole("dialog", {
      name: "Issues workspace",
    });
    const tabList = workspaceDrawer.getByRole("tablist", {
      name: "Bottom workspace",
    });
    const issuesTab = workspaceDrawer.getByRole("tab", { name: "Issues" });
    const issuesPanel = workspaceDrawer.getByRole("tabpanel", {
      name: "Issues",
    });
    const issuesControls = workspaceDrawer.locator(
      ".validation-issues__controls",
    );
    const targetLabel = workspaceDrawer.locator(".validation-target-selector");
    const targetSelect = workspaceDrawer.getByRole("combobox", {
      name: "Validation target",
    });

    await expect(workspaceDrawer).toBeVisible();
    await expect(issuesTab).toHaveAttribute("aria-selected", "true");
    await expect(tabList).toBeVisible();
    await expect(issuesControls).toBeVisible();
    await expect(targetLabel).toBeVisible();
    await expect(targetSelect).toBeVisible();
    await expect(tabList).toHaveCSS("position", "sticky");
    await expect(issuesControls).toHaveCSS("position", "sticky");
    await expectLocatorToStayWithinInlineBounds(
      targetLabel,
      workspaceDrawer,
      responsiveWorkspaceViewport.width,
    );
    await expectLocatorToStayWithinInlineBounds(
      targetSelect,
      workspaceDrawer,
      responsiveWorkspaceViewport.width,
    );

    const initialMetrics = await workspaceDrawer.evaluate(
      (drawer, bodySelector) => {
        const body = drawer.querySelector<HTMLElement>(bodySelector);
        const responsivePanel = drawer.querySelector<HTMLElement>(
          "#responsive-bottom-workspace",
        );
        const content = drawer.querySelector<HTMLElement>(
          ".bottom-workspace-content",
        );
        const activePanel = drawer.querySelector<HTMLElement>(
          ".cm-tabs__panel:not([hidden])",
        );
        if (
          body === null ||
          responsivePanel === null ||
          content === null ||
          activePanel === null
        ) {
          throw new Error("Expected responsive Workspace scroll surfaces.");
        }
        return {
          activeClientHeight: activePanel.clientHeight,
          activeOverflowY: getComputedStyle(activePanel).overflowY,
          activeScrollHeight: activePanel.scrollHeight,
          bodyClientHeight: body.clientHeight,
          bodyOverflowY: getComputedStyle(body).overflowY,
          bodyScrollHeight: body.scrollHeight,
          contentClientHeight: content.clientHeight,
          contentScrollHeight: content.scrollHeight,
          responsiveClientHeight: responsivePanel.clientHeight,
          responsiveScrollHeight: responsivePanel.scrollHeight,
        };
      },
      responsiveWorkspaceViewport.bodySelector,
    );
    expect(initialMetrics.bodyOverflowY).toBe("hidden");
    expect(initialMetrics.bodyScrollHeight).toBeLessThanOrEqual(
      initialMetrics.bodyClientHeight + 1,
    );
    expect(initialMetrics.responsiveScrollHeight).toBeLessThanOrEqual(
      initialMetrics.responsiveClientHeight + 1,
    );
    expect(initialMetrics.contentScrollHeight).toBeLessThanOrEqual(
      initialMetrics.contentClientHeight + 1,
    );
    expect(initialMetrics.activeOverflowY).toBe("auto");
    expect(initialMetrics.activeScrollHeight).toBeGreaterThan(
      initialMetrics.activeClientHeight,
    );

    await issuesPanel.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(async () => issuesPanel.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    const settledScroll = await workspaceDrawer.evaluate(
      (drawer, bodySelector) => {
        const body = drawer.querySelector<HTMLElement>(bodySelector);
        const responsivePanel = drawer.querySelector<HTMLElement>(
          "#responsive-bottom-workspace",
        );
        const content = drawer.querySelector<HTMLElement>(
          ".bottom-workspace-content",
        );
        if (body === null || responsivePanel === null || content === null) {
          throw new Error("Expected responsive Workspace scroll surfaces.");
        }
        return {
          bodyScrollTop: body.scrollTop,
          contentScrollTop: content.scrollTop,
          responsiveScrollTop: responsivePanel.scrollTop,
        };
      },
      responsiveWorkspaceViewport.bodySelector,
    );
    expect(settledScroll).toEqual({
      bodyScrollTop: 0,
      contentScrollTop: 0,
      responsiveScrollTop: 0,
    });
    await expect(tabList).toBeVisible();
    await expect(issuesControls).toBeVisible();
    await expect(targetLabel).toBeVisible();
    await expectLocatorToStayWithinInlineBounds(
      targetLabel,
      workspaceDrawer,
      responsiveWorkspaceViewport.width,
    );
    if (responsiveWorkspaceViewport.width === 900) {
      await expectPageToStayWithinViewport(page);
    } else {
      await expectPageToStayWithinInlineViewport(page);
    }
  });
}

for (const requestedPanel of ["Catalog", "Inspector"] as const) {
  test(`retains the explicitly opened ${requestedPanel} surface when returning to constrained desktop`, async ({
    page,
  }) => {
    await page.setViewportSize({ height: 600, width: 900 });
    await page.goto(editorPath);
    const responsiveControl = page.getByRole("button", {
      exact: true,
      name: requestedPanel,
    });
    await responsiveControl.focus();
    await responsiveControl.press("Enter");
    const responsiveSurface = page.getByRole("dialog", {
      name:
        requestedPanel === "Catalog"
          ? "Service catalog"
          : "Configure inspector",
    });
    await expect(responsiveSurface).toBeVisible();
    await page.setViewportSize({ height: 800, width: 1280 });

    await expect(page.locator("#catalog-panel")).toHaveCount(1);
    await expect(page.locator("#inspector-panel")).toHaveCount(1);
    await expect(page.locator("#bottom-workspace")).toHaveCount(1);
    if (requestedPanel === "Catalog") {
      await expect(responsiveSurface).toHaveCount(0);
      await expect(page.locator(".workspace-shell__catalog")).toHaveAttribute(
        "data-expanded",
        "true",
      );
    } else {
      await expect(responsiveSurface).toBeVisible();
      await expect(
        page
          .getByRole("navigation", { name: "Inspector tools" })
          .getByRole("button", { name: "Configure" }),
      ).toHaveAttribute("aria-expanded", "true");
    }
  });
}

test("preserves catalog focus while fixed popup launchers remain available at constrained desktop widths", async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1680 });
  await page.goto(editorPath);

  const catalogSearch = page.getByRole("searchbox", {
    name: "Search services",
  });
  await catalogSearch.focus();
  await expect(catalogSearch).toBeFocused();
  await page.setViewportSize({ height: 800, width: 1280 });

  const shell = page.locator(".workspace-shell");
  await expect(shell).toHaveAttribute("data-catalog-open", "true");
  await expect(shell).toHaveAttribute("data-inspector-open", "false");
  await expect(catalogSearch).toBeFocused();
  await expect(
    page.getByRole("navigation", { name: "Inspector tools" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Workspace tools" }),
  ).toBeVisible();
  await expect(
    page.getByRole("separator", { name: "Resize contextual inspector" }),
  ).toHaveCount(0);
});

test("keeps compact shared actions and Inspector tabs consistent across assistance modes", async ({
  page,
}) => {
  await page.goto(editorPath);

  const editor = page.locator(".architecture-editor");
  const serviceCard = page.locator(
    '[data-service-id="aws.apigateway.http-api"]',
  );
  const serviceActions = serviceCard.locator(".service-catalog-card__actions");
  const details = serviceActions.getByRole("button", {
    name: /^Show details for/u,
  });
  const add = serviceActions.getByRole("button", {
    name: /^Add .+ to canvas$/u,
  });
  const drag = serviceActions.getByRole("button", {
    name: /^Drag or add .+ to canvas$/u,
  });
  const information = serviceCard.getByRole("button", {
    name: "More information about API Gateway HTTP API",
    exact: true,
  });
  await information.hover();
  const guidedInformationSurface = page.getByRole("dialog", {
    name: /service information/u,
  });
  await expect(guidedInformationSurface).toBeVisible();
  await guidedInformationSurface.hover();
  await page.waitForTimeout(150);
  await expect(guidedInformationSurface).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guidedInformationSurface).toHaveCount(0);
  const configureLauncher = page
    .getByRole("navigation", { name: "Inspector tools" })
    .getByRole("button", { name: "Configure" });
  await configureLauncher.click();
  const configurePopup = page.getByRole("dialog", {
    name: "Configure inspector",
  });
  await expect(configurePopup).toBeVisible();
  const inspectorTabs = configurePopup.getByRole("tablist", {
    name: "Inspector sections",
  });
  const configureTab = inspectorTabs.getByRole("tab", {
    name: "Configure",
  });

  await expect(editor).toHaveAttribute("data-editor-mode", "guided");
  await expect(details).toHaveAttribute("data-size", "compact");
  await expect(details).toHaveAttribute("data-variant", "secondary");
  await expect(add).toHaveAttribute("data-size", "compact");
  await expect(add).toHaveAttribute("data-variant", "primary");
  await expect(inspectorTabs.locator("..")).toHaveAttribute(
    "data-size",
    "compact",
  );
  await expect(inspectorTabs.getByRole("tab")).toHaveCount(3);

  const guidedDetailsBox = await requiredBox(details, "Guided Details action");
  const guidedAddBox = await requiredBox(add, "Guided Add action");
  const guidedDragBox = await requiredBox(drag, "Guided drag action");
  const guidedActionRowBox = await requiredBox(
    serviceActions,
    "Guided service action row",
  );
  const guidedTabBox = await requiredBox(configureTab, "Guided Inspector tab");
  expect(guidedDetailsBox.height).toBeCloseTo(28, 0);
  expect(guidedAddBox.height).toBeCloseTo(28, 0);
  expect(guidedDragBox.height).toBeCloseTo(28, 0);
  expect(guidedActionRowBox.height).toBeCloseTo(28, 0);
  expect(guidedTabBox.height).toBeCloseTo(28, 0);
  await expectGuidedCompactHitTarget(details, "Guided Details action");
  await expectGuidedCompactHitTarget(add, "Guided Add action");
  await expectGuidedCompactHitTarget(drag, "Guided drag action");
  await expectGuidedCompactHitTarget(configureTab, "Guided Inspector tab");
  const guidedInformationHit = await information.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error("Service information target is not an HTMLElement.");
    }

    const bounds = element.getBoundingClientRect();
    const pointTarget = document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.bottom - 0.5,
    );
    return pointTarget === element || element.contains(pointTarget);
  });
  expect(
    guidedInformationHit,
    "Guided service information must own its lower interaction edge",
  ).toBe(true);
  expect(
    guidedAddBox.x - (guidedDragBox.x + guidedDragBox.width),
  ).toBeGreaterThanOrEqual(4);
  expect(
    guidedDetailsBox.x - (guidedAddBox.x + guidedAddBox.width),
  ).toBeGreaterThanOrEqual(4);

  await page.keyboard.press("Escape");
  await expect(configurePopup).toHaveCount(0);
  await page.getByRole("button", { name: "Professional" }).click();
  await expect(editor).toHaveAttribute("data-editor-mode", "professional");
  await information.click();
  const professionalInformationSurface = page.getByRole("dialog", {
    name: /service information/u,
  });
  await expect(professionalInformationSurface).toBeVisible();
  await page.keyboard.press("Escape");
  await configureLauncher.click();
  await expect(configurePopup).toBeVisible();
  await expect(inspectorTabs.getByRole("tab")).toHaveCount(3);

  const professionalDetailsBox = await requiredBox(
    details,
    "Professional Details action",
  );
  const professionalAddBox = await requiredBox(add, "Professional Add action");
  const professionalDragBox = await requiredBox(
    drag,
    "Professional drag action",
  );
  const professionalActionRowBox = await requiredBox(
    serviceActions,
    "Professional service action row",
  );
  const professionalTabBox = await requiredBox(
    configureTab,
    "Professional Inspector tab",
  );
  expect(professionalDetailsBox.height).toBeCloseTo(28, 0);
  expect(professionalAddBox.height).toBeCloseTo(28, 0);
  expect(professionalDragBox.height).toBeCloseTo(28, 0);
  expect(professionalActionRowBox.height).toBeCloseTo(28, 0);
  expect(professionalTabBox.height).toBeCloseTo(28, 0);
  expect(
    professionalAddBox.x - (professionalDragBox.x + professionalDragBox.width),
  ).toBeGreaterThanOrEqual(4);
  expect(
    professionalDetailsBox.x -
      (professionalAddBox.x + professionalAddBox.width),
  ).toBeGreaterThanOrEqual(4);
  expect(professionalDetailsBox.height).toBeCloseTo(guidedDetailsBox.height, 0);
  expect(professionalTabBox.height).toBeCloseTo(guidedTabBox.height, 0);

  await page.setViewportSize({ height: 800, width: 1279 });
  await expectTouchTarget(
    page
      .getByRole("region", { name: "Development fixture status" })
      .locator(".cm-disclosure__summary"),
    "Professional tablet fixture disclosure",
  );

  await page.getByRole("button", { exact: true, name: "Catalog" }).click();
  await expectTouchTarget(
    information,
    "Professional tablet service information",
  );
  await page.keyboard.press("Escape");

  await page.getByRole("button", { exact: true, name: "Inspector" }).click();
  await expectTouchTarget(
    page.getByRole("tab", { name: "Learn" }),
    "Professional tablet Learn tab",
  );
});

test("keeps every compact editor action visible and hittable on narrow phones", async ({
  page,
}) => {
  for (const width of [320, 375]) {
    await page.setViewportSize({ height: 800, width });
    await page.goto(editorPath);
    await expectPageToStayWithinInlineWidth(page);

    const header = page.getByRole("banner", { name: "Application header" });
    const toolbar = header.getByRole("toolbar", { name: "Editor actions" });
    await expect(toolbar).toBeVisible();
    const actions = toolbar.getByRole("button");
    await expect(actions).toHaveCount(3);

    const headerBox = await requiredBox(
      header,
      `Application header at ${String(width)}px`,
    );
    const toolbarBox = await requiredBox(
      toolbar,
      `Editor actions at ${String(width)}px`,
    );
    expect(toolbarBox.x).toBeGreaterThanOrEqual(headerBox.x - 1);
    expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(
      headerBox.x + headerBox.width + 1,
    );

    for (let index = 0; index < 3; index += 1) {
      const action = actions.nth(index);
      await expectTouchTarget(
        action,
        `Editor header action ${String(index + 1)} at ${String(width)}px`,
      );
      const ownsCenter = await action.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const target = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        );
        return target === element || element.contains(target);
      });
      expect(ownsCenter).toBe(true);
    }
  }
});

test("removes floating-panel and safe-area motion when reduced motion is requested", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(editorPath);
  await expect(page.locator(".architecture-editor")).toBeVisible({
    timeout: 30_000,
  });

  for (const selector of [
    ".workspace-shell__catalog",
    ".architecture-top-stack",
    ".architecture-canvas .react-flow__controls",
    ".architecture-canvas .react-flow__minimap.architecture-minimap",
    ".architecture-zoom-status",
  ]) {
    await expect(page.locator(selector)).toHaveCSS("transition-duration", "0s");
  }

  await page
    .getByRole("navigation", { name: "Inspector tools" })
    .getByRole("button", { name: "Configure" })
    .click();
  const configurePopup = page.getByRole("dialog", {
    name: "Configure inspector",
  });
  await expect(configurePopup).toHaveCSS("animation-duration", "0s");
  await expect(configurePopup).toHaveCSS("box-shadow", /rgba|rgb/u);
  await page.keyboard.press("Escape");
  await expect(configurePopup).toHaveCount(0);

  const fixtureDetails = page.locator(
    ".architecture-fixture-status__disclosure",
  );
  await fixtureDetails.locator(":scope > summary").click();
  await expect(
    fixtureDetails.locator(":scope > .cm-disclosure__content"),
  ).toHaveCSS("animation-duration", "0s");
});

test("preserves focus with standard floating-panel motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto(editorPath);
  await expect(page.locator(".architecture-editor")).toBeVisible({
    timeout: 30_000,
  });

  const catalog = page.locator(".workspace-shell__catalog");
  const flow = page.locator(".architecture-canvas__flow");
  const minimap = page.locator(".architecture-minimap");
  const apiNode = flow.locator(
    '[data-architecture-node-id="node_api_handler"]',
  );

  await expect(catalog).toHaveCSS("transition-duration", /0\.16s/u);
  await expect(catalog).toHaveCSS(
    "transition-timing-function",
    /cubic-bezier\(0, 0, 0\.2, 1\)/u,
  );
  await chooseCanvasAction(page, "Fit architecture");
  const initialContentHash = await page
    .locator(".architecture-editor")
    .getAttribute("data-content-hash");
  const apiFlowNode = flow.getByRole("group", {
    name: /^Notes API handler\./u,
  });
  await apiFlowNode.focus();
  await apiFlowNode.press("Enter");
  await expect(apiNode).toHaveAttribute("data-selected", "true");
  const configureLauncher = page
    .getByRole("navigation", { name: "Inspector tools" })
    .getByRole("button", { exact: true, name: "Configure" });
  const initialMinimap = await minimap.boundingBox();
  if (initialMinimap === null) {
    throw new Error("Expected the desktop architecture overview.");
  }
  await configureLauncher.click();
  const configurePopup = page.getByRole("dialog", {
    name: "Configure inspector",
  });
  await expect(configurePopup).toBeVisible();
  await expect(configurePopup).toHaveCSS("animation-duration", /0\.16s/u);
  await expect
    .poll(async () => {
      const popup = await configurePopup.boundingBox();
      const overview = await minimap.boundingBox();
      return popup === null || overview === null
        ? -1
        : popup.x - (overview.x + overview.width);
    })
    .toBeGreaterThan(8);
  const popup = await configurePopup.boundingBox();
  const overview = await minimap.boundingBox();
  if (popup === null || overview === null) {
    throw new Error("Expected the inspector and architecture overview.");
  }
  expect(popup.x - (overview.x + overview.width)).toBeLessThan(48);
  await expect(
    configurePopup.getByRole("heading", {
      exact: true,
      name: "Configure Notes API handler",
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(configurePopup).toHaveCount(0);
  await expect(configureLauncher).toBeFocused();
  await expect
    .poll(async () => (await minimap.boundingBox())?.x ?? -1)
    .toBeCloseTo(initialMinimap.x, 0);
  await page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: "Issues" })
    .click();
  const workspacePopup = page.locator(".editor-popup-surface--workspace");
  await expect(workspacePopup).toBeVisible();
  const workspaceBox = await workspacePopup.boundingBox();
  const workspaceMinimap = await minimap.boundingBox();
  if (workspaceBox === null || workspaceMinimap === null) {
    throw new Error("Expected the Workspace menu and architecture overview.");
  }
  expect(workspaceMinimap.x).toBeCloseTo(initialMinimap.x, 0);
  expect(workspaceMinimap.y).toBeCloseTo(initialMinimap.y, 0);
  expect(workspaceBox.x + workspaceBox.width).toBeLessThan(
    workspaceMinimap.x - 8,
  );
  await page.keyboard.press("Escape");
  await expect(workspacePopup).toHaveCount(0);
  await page.getByRole("button", { name: "Hide Catalog" }).click();
  await expect(
    page.getByRole("button", { name: "Show Catalog" }),
  ).toBeFocused();
  await expect(catalog).toHaveCSS(
    "transition-timing-function",
    /cubic-bezier\(0\.4, 0, 1, 1\)/u,
  );
  await expect(catalog).toBeVisible();
  await expect(catalog).toHaveAttribute("data-expanded", "false");
  await expect(page.locator("#catalog-content")).toBeHidden();
  await expect
    .poll(async () => (await catalog.boundingBox())?.width ?? 0)
    .toBeLessThan(130);
  const collapsedCatalog = await catalog.boundingBox();
  expect(collapsedCatalog?.x).toBeGreaterThanOrEqual(0);
  expect(collapsedCatalog?.x).toBeLessThan(32);
  await expect(
    page.getByRole("button", { name: "Show Catalog" }),
  ).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Hide Catalog" }),
  ).toBeFocused();
  if (initialContentHash !== null) {
    await expect(page.locator(".architecture-editor")).toHaveAttribute(
      "data-content-hash",
      initialContentHash,
    );
  }
});

test("keeps the desktop editor bounded while secondary architecture controls stay non-semantic", async ({
  page,
}) => {
  await page.goto(editorPath);

  const editor = page.locator(".architecture-editor");
  const professionalMode = page.getByRole("button", {
    name: "Professional",
  });
  const architectureLauncher = page
    .getByRole("navigation", { name: "Inspector tools" })
    .getByRole("button", { name: "Architecture" });
  const catalogResults = page.getByRole("region", {
    name: "Catalog service results",
  });

  await expect(editor).toBeVisible({ timeout: 30_000 });
  const guidedContentHash = await editor.getAttribute("data-content-hash");
  const guidedVisualHash = await editor.getAttribute("data-visual-hash");
  if (guidedContentHash === null || guidedVisualHash === null) {
    throw new Error("The fixture editor did not expose both document hashes.");
  }

  await expect(architectureLauncher).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("separator", {
      name: "Resize contextual inspector",
    }),
  ).toHaveCount(0);
  await expect(page.locator(".cm-resize-handle summary")).toHaveCount(0);

  await expect(catalogResults).toBeVisible();
  await expectCatalogFocusRingWithinScroller(catalogResults);
  const initialCatalogScroll = await catalogResults.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));
  expect(initialCatalogScroll.clientHeight).toBeGreaterThan(0);
  expect(initialCatalogScroll.scrollHeight).toBeGreaterThan(
    initialCatalogScroll.clientHeight,
  );
  expect(initialCatalogScroll.scrollTop).toBe(0);

  await catalogResults.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(async () => catalogResults.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);

  const documentBounds = await page.evaluate(() => ({
    innerHeight: window.innerHeight,
    scrollHeight:
      document.scrollingElement?.scrollHeight ??
      document.documentElement.scrollHeight,
  }));
  expect(documentBounds.scrollHeight).toBeLessThanOrEqual(
    documentBounds.innerHeight + 1,
  );

  await professionalMode.click();

  await expect(editor).toHaveAttribute("data-editor-mode", "professional");
  await expect(architectureLauncher).toHaveAttribute("aria-expanded", "false");
  await expect(editor).toHaveAttribute("data-content-hash", guidedContentHash);
  await expect(editor).toHaveAttribute("data-visual-hash", guidedVisualHash);

  await chooseCanvasAction(page, "Architecture list");

  const architecturePopup = page.getByRole("dialog", {
    name: "Architecture inspector",
  });
  const architectureList = architecturePopup.getByRole("region", {
    name: "Architecture list",
  });
  await expect(architecturePopup).toBeVisible();
  await expect(architecturePopup).toHaveCSS("box-shadow", /rgba|rgb/u);
  await expect(architectureLauncher).toHaveAttribute("aria-expanded", "true");
  await expect(architectureList).toBeVisible();
  await expect(architectureList).toBeFocused();
  await expect(
    architectureList.locator(".architecture-tree__technical").first(),
  ).toHaveCSS("display", "block");
  await expectArchitectureTreeTextNotToOverlap(
    architectureList.locator(".architecture-tree__button").first(),
  );

  await chooseCanvasAction(page, "Architecture list");

  await expect(architectureList).toBeFocused();
  await expect(architecturePopup).toBeVisible();
  await expect(editor).toHaveAttribute("data-content-hash", guidedContentHash);
  await expect(editor).toHaveAttribute("data-visual-hash", guidedVisualHash);

  await page.goto("/organizations/local-org/projects?fixture=local-app");
  await expect(
    page.getByRole("button", { name: "Hide Navigation" }),
  ).toBeVisible();
  await expect(page.locator(".cm-resize-handle summary")).toHaveCount(0);

  for (const responsiveViewport of [
    { bodySelector: ".cm-drawer__body", width: 900 },
    { bodySelector: ".cm-modal-drawer__body", width: 375 },
  ]) {
    await page.setViewportSize({
      width: responsiveViewport.width,
      height: responsiveViewport.width === 900 ? 600 : 800,
    });
    await page.goto(editorPath);

    if (responsiveViewport.width === 900) {
      await expectPageToStayWithinViewport(page);
    }

    await page.getByRole("button", { name: "Catalog", exact: true }).click();

    const catalogDrawer = page.getByRole("dialog", {
      name: "Service catalog",
    });
    await expectCatalogOwnsResponsiveScroll(
      catalogDrawer,
      responsiveViewport.bodySelector,
    );

    if (responsiveViewport.width === 375) {
      await page.setViewportSize({ width: 375, height: 568 });
      const responsiveResults = catalogDrawer.getByRole("region", {
        name: "Catalog service results",
      });
      await responsiveResults.evaluate((element) => {
        element.scrollTop = 0;
      });
      await catalogDrawer
        .locator(".service-catalog-diagnostics > summary")
        .click();

      const constrainedSecondary = catalogDrawer.locator(
        ".service-catalog-secondary",
      );
      await constrainedSecondary.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect
        .poll(async () =>
          constrainedSecondary.evaluate((element) => element.scrollTop),
        )
        .toBeGreaterThan(0);

      const detailsTrigger = responsiveResults
        .getByRole("button", { name: /Show details for/u })
        .first();
      await detailsTrigger.click();
      const detailsDialog = page.getByRole("dialog", {
        name: / details$/u,
      });
      await expect(detailsDialog).toBeInViewport();
      const detailsBody = detailsDialog.locator(".cm-modal-drawer__body");
      const detailsMetrics = await detailsBody.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
      expect(detailsMetrics.clientHeight).toBeGreaterThan(0);
      expect(detailsMetrics.scrollHeight).toBeGreaterThan(
        detailsMetrics.clientHeight,
      );
      await detailsBody.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect
        .poll(async () => detailsBody.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await detailsDialog
        .getByRole("button", { name: /Close details for/u })
        .click();
      await expect(detailsTrigger).toBeFocused();
      await expect
        .poll(async () =>
          constrainedSecondary.evaluate((element) => element.scrollTop),
        )
        .toBeGreaterThan(0);

      const secondaryMetrics = await constrainedSecondary.evaluate(
        (element) => ({
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        }),
      );
      expect(secondaryMetrics.clientHeight).toBeGreaterThan(0);
      expect(secondaryMetrics.scrollHeight).toBeGreaterThan(
        secondaryMetrics.clientHeight,
      );
      const shortDrawerMetrics = await catalogDrawer.evaluate((drawer) => {
        const body = drawer.querySelector<HTMLElement>(
          ".cm-modal-drawer__body",
        );
        const secondary = drawer.querySelector<HTMLElement>(
          ".service-catalog-secondary",
        );
        if (body === null || secondary === null) {
          throw new Error("Expected the short catalog drawer surfaces.");
        }
        return {
          bodyBottom: body.getBoundingClientRect().bottom,
          bodyClientHeight: body.clientHeight,
          bodyScrollHeight: body.scrollHeight,
          secondaryBottom: secondary.getBoundingClientRect().bottom,
        };
      });
      expect(shortDrawerMetrics.bodyScrollHeight).toBeLessThanOrEqual(
        shortDrawerMetrics.bodyClientHeight + 1,
      );
      expect(shortDrawerMetrics.secondaryBottom).toBeLessThanOrEqual(
        shortDrawerMetrics.bodyBottom + 1,
      );
    }
  }
});

test("adds a searched catalog service by dragging it to the command-backed canvas", async ({
  page,
}) => {
  await page.goto(editorPath);

  const editor = page.locator(".architecture-editor");
  const search = page.getByRole("searchbox", { name: "Search services" });
  const canvas = page.locator(".architecture-canvas__flow");
  const minimap = page.getByRole("img", {
    name: "Architecture overview",
  });

  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => readMiniMapNodeIds(minimap))
    .toEqual([...fixtureNodeIds]);
  const originalContentHash = await editor.getAttribute("data-content-hash");
  if (originalContentHash === null) {
    throw new Error("The fixture editor did not expose a content hash.");
  }

  await search.fill("bounded application workload");
  const lambdaCard = page.locator(
    '[data-service-id="aws.lambda.function"][data-add-enabled="true"]',
  );
  await expect(lambdaCard).toBeVisible();
  await lambdaCard
    .getByRole("button", {
      name: "Drag or add Lambda function to canvas",
    })
    .dragTo(canvas, {
      targetPosition: { x: 520, y: 360 },
    });

  await expect(
    editor.locator('[data-architecture-node-id="node_lambda_function"]'),
  ).toBeVisible();
  await expect
    .poll(async () => editor.getAttribute("data-content-hash"))
    .not.toBe(originalContentHash);
  await expect
    .poll(async () => readNodeIds(editor))
    .toEqual([...fixtureNodeIds, "node_lambda_function"].sort());
  await expect
    .poll(async () => readMiniMapNodeIds(minimap))
    .toEqual([...fixtureNodeIds, "node_lambda_function"].sort());
  await search.fill("");
  await expect(
    page.getByRole("heading", { name: "Recently used" }),
  ).toBeVisible();

  const addedContentHash = await editor.getAttribute("data-content-hash");
  if (addedContentHash === null) {
    throw new Error("The updated editor did not expose a content hash.");
  }
  await page.getByRole("button", { name: "Professional" }).click();
  await expect(editor).toHaveAttribute("data-content-hash", addedContentHash);
});

test("adds exactly one searched catalog service through native keyboard activation", async ({
  page,
}) => {
  await page.goto(editorPath);

  const editor = page.locator(".architecture-editor");
  const search = page.getByRole("searchbox", { name: "Search services" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  const originalContentHash = await editor.getAttribute("data-content-hash");
  if (originalContentHash === null) {
    throw new Error("The fixture editor did not expose a content hash.");
  }

  await search.fill("bounded application workload");
  const keyboardAdd = page.getByRole("button", {
    name: "Drag or add Lambda function to canvas",
  });
  const validationAnnouncement = page.locator(
    ".architecture-validation-live-region",
  );
  await observeNextValidationCycle(validationAnnouncement);
  await keyboardAdd.focus();
  await keyboardAdd.press("Enter");

  await expectObservedValidationCycle(validationAnnouncement);
  await expect(
    editor.locator('[data-architecture-node-id="node_lambda_function"]'),
  ).toHaveCount(1);
  await expect
    .poll(async () => editor.getAttribute("data-content-hash"))
    .not.toBe(originalContentHash);
  await expect
    .poll(async () => readNodeIds(editor))
    .toEqual([...fixtureNodeIds, "node_lambda_function"].sort());
  await expect(page.locator(".architecture-live-region")).toHaveText(
    "Lambda function added through a Graph Command.",
  );

  const addedBox = await editor
    .locator('[data-architecture-node-id="node_lambda_function"]')
    .boundingBox();
  if (addedBox === null) {
    throw new Error("The keyboard-added node has no rendered bounds.");
  }
  for (const fixtureNodeId of fixtureNodeIds) {
    const fixtureBox = await editor
      .locator(`[data-architecture-node-id="${fixtureNodeId}"]`)
      .boundingBox();
    if (fixtureBox === null) {
      throw new Error(`Fixture node ${fixtureNodeId} has no rendered bounds.`);
    }
    expect(rectanglesOverlap(addedBox, fixtureBox)).toBe(false);
  }
});

test("draws a typed API connection, closes its dock, and confirms by keyboard", async ({
  page,
}) => {
  await page.goto(editorPath);

  const editor = page.locator(".architecture-editor");
  const search = page.getByRole("searchbox", { name: "Search services" });
  await search.fill("API Gateway HTTP API");
  await page
    .getByRole("button", {
      name: "Drag or add API Gateway HTTP API to canvas",
    })
    .press("Enter");

  const apiNode = editor.locator(
    '[data-architecture-node-id="node_apigateway_http_api"]',
  );
  const lambdaNode = editor.locator(
    '[data-architecture-node-id="node_api_handler"]',
  );
  await expect(apiNode).toBeVisible();
  await expect(lambdaNode).toBeVisible();
  await chooseCanvasAction(page, "Fit architecture");
  const contentHashAfterAdd = await editor.getAttribute("data-content-hash");
  if (contentHashAfterAdd === null) {
    throw new Error("The editor did not expose the post-add content hash.");
  }
  await expandServiceNode(apiNode, "API Gateway HTTP API");

  const addConnection = editor
    .locator(
      '[data-architecture-service-details-for="node_apigateway_http_api"]',
    )
    .getByRole("button", {
      name: "Add connection",
      exact: true,
    });
  await addConnection.focus();
  await expect(addConnection).toBeFocused();
  await addConnection.press("Enter");
  const chooser = page.getByRole("dialog", {
    name: "Choose services to connect",
  });
  await expect(chooser).toBeVisible();
  const invoke = chooser.getByRole("radio", { name: "Invokes", exact: true });
  await invoke.focus();
  await expect(invoke).toBeFocused();
  await invoke.press("Space");
  await expect(editor).toHaveAttribute(
    "data-content-hash",
    contentHashAfterAdd,
  );

  const wizard = page.getByRole("dialog", {
    name: "Connect API Gateway HTTP API to Lambda function",
  });
  await expect(wizard).toBeVisible();
  await expect(wizard.getByRole("button", { name: "Guided" })).toHaveCount(0);
  await expect(
    wizard.getByRole("button", { name: "Professional" }),
  ).toHaveCount(0);
  const route = wizard.getByLabel(
    /Which HTTP method and path should invoke this function/u,
  );
  await route.fill("GET /notes");

  await expect(route).toHaveValue("GET /notes");
  await expect(
    wizard.getByLabel(/Which HTTP API Lambda payload format should be used/u),
  ).toHaveValue("2.0");
  await wizard.getByRole("button", { name: "Review connection" }).click();
  await expect(
    wizard.getByRole("heading", {
      name: "What will change",
    }),
  ).toBeVisible();
  await expect(
    wizard.getByRole("list", { name: "Permission consequences" }),
  ).toContainText(
    "The future compiler may grant API Gateway invoke permission only on the connected Lambda function.",
  );
  const technicalDetails = wizard.locator(".connection-wizard__technical");
  await expect(technicalDetails).not.toHaveAttribute("open");
  await expect(
    technicalDetails.getByText("lambda:InvokeFunction", { exact: true }),
  ).not.toBeVisible();
  await technicalDetails.locator(":scope > summary").click();
  await expect(
    technicalDetails.getByText("lambda:InvokeFunction", { exact: true }),
  ).toBeVisible();
  await expect(technicalDetails).toContainText("apigateway.amazonaws.com");
  await expect(technicalDetails).toContainText(
    /operation_editor_[A-Za-z0-9._:-]+_\d{6}\.edge\.connection/u,
  );

  await wizard.locator(".connection-wizard__body").press("Control+Enter");
  await expect(wizard).toHaveCount(0);
  await expect(editor.locator(".react-flow__edge")).toHaveCount(1);
  await expect
    .poll(async () => editor.getAttribute("data-content-hash"))
    .not.toBe(contentHashAfterAdd);
  await expect(editor.locator(".architecture-edge__label")).toHaveText(
    "Invokes",
  );
  await editor.locator(".react-flow__pane").click({
    position: { x: 8, y: 8 },
  });
  await expect(editor.locator(".architecture-edge__label")).toHaveCount(0);
  const createdEdge = editor.locator(".react-flow__edge").first();
  await createdEdge.focus();
  await createdEdge.press("Enter");
  await expect(editor.locator(".architecture-edge__label")).toHaveText(
    "Invokes",
  );
});

test("scopes keyboard connection initiation and cancels without changing the document", async ({
  page,
}) => {
  await page.goto(editorPath);

  const editor = page.locator(".architecture-editor");
  const initialContentHash = await editor.getAttribute("data-content-hash");
  if (initialContentHash === null) {
    throw new Error("The editor did not expose its initial content hash.");
  }
  await chooseCanvasAction(page, "Architecture list");
  const lambdaTreeNode = page.locator(
    '[data-architecture-tree-node-id="node_api_handler"]',
  );
  await lambdaTreeNode.focus();
  await lambdaTreeNode.press("c");

  const wizard = page.getByRole("dialog", {
    name: "Choose services to connect",
  });
  await expect(wizard).toBeVisible();
  await expect(editor).toHaveAttribute("data-content-hash", initialContentHash);
  await wizard.getByRole("button", { name: "Cancel" }).click();
  await expect(wizard).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open Canvas menu" }),
  ).toBeFocused();
  await expect(editor).toHaveAttribute("data-content-hash", initialContentHash);

  const canvasMenuTrigger = page.getByRole("button", {
    name: "Open Canvas menu",
  });
  await canvasMenuTrigger.focus();
  await canvasMenuTrigger.press("c");
  await expect(wizard).toHaveCount(0);
  await expect(editor).toHaveAttribute("data-content-hash", initialContentHash);
});

test("keeps synthetic boundary meaning visible in forced-colors mode", async ({
  page,
}) => {
  await page.goto("/development/visual-gallery?fixture=local-app");

  await expect(
    page.getByRole("heading", { name: "Development visual gallery" }),
  ).toBeVisible();

  await page.emulateMedia({ forcedColors: "active" });
  expect(
    await page.evaluate(
      () => window.matchMedia("(forced-colors: active)").matches,
    ),
  ).toBe(true);

  const unsupportedBoundary = page.locator(
    '.development-gallery__boundary[data-boundary-state="unsupported"]',
  );
  await expect(unsupportedBoundary).toContainText("Unsupported");
  const forcedColorStyles = await unsupportedBoundary.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      backgroundImage: styles.backgroundImage,
      borderColor: styles.borderTopColor,
      boxShadow: styles.boxShadow,
      color: styles.color,
    };
  });

  expect(
    forcedColorStyles.backgroundImage
      .split(",")
      .every((layer) => layer.trim() === "none"),
  ).toBe(true);
  expect(forcedColorStyles).toMatchObject({
    borderColor: forcedColorStyles.color,
    boxShadow: "none",
  });
});

async function readNodeIds(editor: Locator): Promise<readonly string[]> {
  return editor
    .locator("[data-architecture-node-id]")
    .evaluateAll((elements) =>
      elements
        .map(
          (element) => element.getAttribute("data-architecture-node-id") ?? "",
        )
        .sort(),
    );
}

async function readNodeTransforms(editor: Locator): Promise<readonly string[]> {
  return editor.locator("[data-architecture-node-id]").evaluateAll((elements) =>
    elements
      .map((element) => {
        const nodeId = element.getAttribute("data-architecture-node-id") ?? "";
        const wrapper = element.closest<HTMLElement>(".react-flow__node");
        if (wrapper === null) {
          throw new Error(
            `Architecture node ${nodeId} has no React Flow wrapper.`,
          );
        }
        return `${nodeId}:${wrapper.style.transform}`;
      })
      .sort(),
  );
}

async function readMiniMapNodeIds(
  minimap: Locator,
): Promise<readonly string[]> {
  return minimap
    .locator("[data-minimap-node-id]")
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute("data-minimap-node-id") ?? "")
        .sort(),
    );
}

type CanvasActionName =
  | "Architecture list"
  | "Arrange automatically"
  | "Fit architecture"
  | "Fit selection";

async function chooseCanvasAction(
  page: Page,
  actionName: CanvasActionName,
): Promise<void> {
  const trigger = page.getByRole("button", { name: "Open Canvas menu" });
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "Canvas actions" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: actionName }).click();
  await expect(menu).toHaveCount(0);
}

interface Rectangle {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

async function requiredBox(
  locator: Locator,
  label: string,
): Promise<Rectangle> {
  // Responsive layout may replace the element between visibility and measurement.
  // Poll the actual measurement using the existing assertion timeout.
  const measurement: { box: Rectangle | null } = { box: null };
  await expect
    .poll(
      async () => {
        measurement.box = await locator.boundingBox();
        return measurement.box !== null;
      },
      { message: `Expected ${label} to have rendered bounds.` },
    )
    .toBe(true);
  if (measurement.box === null) {
    throw new Error(`Expected ${label} to have rendered bounds.`);
  }
  return measurement.box;
}

async function expectGuidedCompactHitTarget(
  locator: Locator,
  label: string,
): Promise<void> {
  const result = await locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error("Compact target is not an HTMLElement.");
    }

    const bounds = element.getBoundingClientRect();
    const requiredSize = 44;
    const blockExtension = Math.max(0, requiredSize - bounds.height);
    const inlineCenter = bounds.left + bounds.width / 2;
    const inspectPoint = (blockPosition: number) => {
      const pointTarget = document.elementFromPoint(
        inlineCenter,
        blockPosition,
      );
      return {
        owned: pointTarget === element || element.contains(pointTarget),
        target:
          pointTarget === null
            ? "null"
            : `${pointTarget.tagName.toLowerCase()}#${pointTarget.id}.${pointTarget.getAttribute("class") ?? ""}`,
      };
    };
    const bottomEdge = inspectPoint(bounds.bottom - 0.5);
    const topEdge = inspectPoint(bounds.top - blockExtension + 0.5);
    const upperMiddle = inspectPoint(bounds.top - blockExtension / 2);

    return {
      bottomEdgeOwned: bottomEdge.owned,
      bottomEdgeTarget: bottomEdge.target,
      height: bounds.height,
      topEdgeOwned: topEdge.owned,
      topEdgeTarget: topEdge.target,
      upperMiddleOwned: upperMiddle.owned,
      upperMiddleTarget: upperMiddle.target,
      width: bounds.width,
    };
  });

  expect(result.width, `${label} interaction width`).toBeGreaterThanOrEqual(44);
  expect(result.height, `${label} compact visual height`).toBeCloseTo(28, 0);
  expect(
    result.topEdgeOwned,
    `${label} upper hit extension resolved to ${result.topEdgeTarget}`,
  ).toBe(true);
  expect(
    result.bottomEdgeOwned,
    `${label} lower hit extension resolved to ${result.bottomEdgeTarget}`,
  ).toBe(true);
  expect(
    result.upperMiddleOwned,
    `${label} upper hit-area midpoint resolved to ${result.upperMiddleTarget}`,
  ).toBe(true);
}

async function expectTouchTarget(
  locator: Locator,
  label: string,
): Promise<void> {
  const bounds = await requiredBox(locator, label);
  expect(bounds.height, `${label} height`).toBeGreaterThanOrEqual(44);
  expect(bounds.width, `${label} width`).toBeGreaterThanOrEqual(44);
}

async function readViewportTransform(locator: Locator): Promise<string> {
  return locator.evaluate((element) => getComputedStyle(element).transform);
}

function expectSameRectangle(
  actual: Rectangle,
  expected: Rectangle,
  tolerance = 1,
): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.width - expected.width)).toBeLessThanOrEqual(
    tolerance,
  );
  expect(Math.abs(actual.height - expected.height)).toBeLessThanOrEqual(
    tolerance,
  );
}

async function expectSameCanvasBounds(
  flow: Locator,
  expected: Rectangle,
): Promise<void> {
  await expect
    .poll(async () => {
      const box = await flow.boundingBox();
      if (box === null) {
        return false;
      }
      return (
        Math.abs(box.x - expected.x) <= 1 &&
        Math.abs(box.y - expected.y) <= 1 &&
        Math.abs(box.width - expected.width) <= 1 &&
        Math.abs(box.height - expected.height) <= 1
      );
    })
    .toBe(true);
}

async function expectResizeHandleToMatchPanel(
  resizeHandle: Locator,
  panel: Locator,
  orientation: "horizontal" | "vertical",
  boundary: "start" | "end",
): Promise<void> {
  await expect
    .poll(async () => {
      const [handleBox, panelBox, centerOwned] = await Promise.all([
        resizeHandle.boundingBox(),
        panel.boundingBox(),
        resizeHandle.evaluate((handle) => {
          if (!(handle instanceof HTMLElement)) {
            return false;
          }
          const bounds = handle.getBoundingClientRect();
          const target = document.elementFromPoint(
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height / 2,
          );
          return target === handle || handle.contains(target);
        }),
      ]);
      if (handleBox === null || panelBox === null) {
        return false;
      }

      const expectedBoundary =
        orientation === "vertical"
          ? boundary === "start"
            ? panelBox.x
            : panelBox.x + panelBox.width
          : boundary === "start"
            ? panelBox.y
            : panelBox.y + panelBox.height;
      const handleCenter =
        orientation === "vertical"
          ? handleBox.x + handleBox.width / 2
          : handleBox.y + handleBox.height / 2;
      const spansPanel =
        orientation === "vertical"
          ? Math.abs(handleBox.y - panelBox.y) <= 1 &&
            Math.abs(handleBox.height - panelBox.height) <= 1
          : Math.abs(handleBox.x - panelBox.x) <= 1 &&
            Math.abs(handleBox.width - panelBox.width) <= 1;
      const crossSize =
        orientation === "vertical" ? handleBox.width : handleBox.height;

      return (
        Math.abs(handleCenter - expectedBoundary) <= 1 &&
        Math.abs(crossSize - 8) <= 1 &&
        spansPanel &&
        centerOwned
      );
    })
    .toBe(true);
}

async function expectPageToStayWithinViewport(page: Page): Promise<void> {
  const pageBounds = await page.evaluate(() => ({
    clientHeight: document.documentElement.clientHeight,
    clientWidth: document.documentElement.clientWidth,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    scrollHeight:
      document.scrollingElement?.scrollHeight ??
      document.documentElement.scrollHeight,
    scrollWidth:
      document.scrollingElement?.scrollWidth ??
      document.documentElement.scrollWidth,
  }));
  expect(pageBounds.scrollWidth).toBeLessThanOrEqual(pageBounds.innerWidth + 1);
  expect(pageBounds.scrollHeight).toBeLessThanOrEqual(
    pageBounds.innerHeight + 1,
  );
  expect(pageBounds.clientWidth).toBeLessThanOrEqual(pageBounds.innerWidth);
  expect(pageBounds.clientHeight).toBeLessThanOrEqual(pageBounds.innerHeight);
}

async function expectPageToStayWithinInlineWidth(page: Page): Promise<void> {
  const pageBounds = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
    scrollWidth:
      document.scrollingElement?.scrollWidth ??
      document.documentElement.scrollWidth,
  }));
  expect(pageBounds.scrollWidth).toBeLessThanOrEqual(pageBounds.innerWidth + 1);
  expect(pageBounds.clientWidth).toBeLessThanOrEqual(pageBounds.innerWidth);
}

async function expectPageToStayWithinInlineViewport(page: Page): Promise<void> {
  await expectPageToStayWithinInlineWidth(page);

  const backdrop = page.locator(".cm-modal-drawer__backdrop");
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error("Playwright did not expose the phone viewport.");
  }
  const backdropBox = await requiredBox(backdrop, "phone modal backdrop");
  expectSameRectangle(backdropBox, {
    height: viewport.height,
    width: viewport.width,
    x: 0,
    y: 0,
  });
}
async function expectGraphToAvoidIntentionalOverlays(
  page: Page,
  openPanels: {
    readonly catalog: boolean;
    readonly inspector: boolean;
    readonly workspace: boolean;
  },
): Promise<void> {
  const overlaySelectors = [
    ".architecture-top-stack",
    ".architecture-minimap",
    ".architecture-canvas .react-flow__controls",
    ".architecture-zoom-status",
    openPanels.catalog
      ? '.workspace-shell__catalog[data-expanded="true"]'
      : '.workspace-shell__catalog[data-expanded="false"]',
    ".workspace-shell__inspector-launcher",
    ".workspace-shell__workspace-launcher",
  ];
  const nodes = page.locator("[data-architecture-node-id]");
  const overlays = page.locator(overlaySelectors.join(", "));

  await expect
    .poll(async () => {
      const [flowBox, nodeBoxes, overlayBoxes] = await Promise.all([
        page.locator(".architecture-canvas__flow").boundingBox(),
        nodes.evaluateAll((elements) =>
          elements.map((element) => {
            const bounds = element.getBoundingClientRect();
            return {
              height: bounds.height,
              width: bounds.width,
              x: bounds.x,
              y: bounds.y,
            };
          }),
        ),
        overlays.evaluateAll((elements) =>
          elements
            .filter((element) => {
              const styles = getComputedStyle(element);
              return (
                styles.display !== "none" && styles.visibility !== "hidden"
              );
            })
            .map((element) => {
              const bounds = element.getBoundingClientRect();
              return {
                height: bounds.height,
                width: bounds.width,
                x: bounds.x,
                y: bounds.y,
              };
            }),
        ),
      ]);

      if (flowBox === null) {
        return false;
      }

      return nodeBoxes.every(
        (nodeBox) =>
          nodeBox.width > 0 &&
          nodeBox.height > 0 &&
          nodeBox.x >= flowBox.x - 1 &&
          nodeBox.y >= flowBox.y - 1 &&
          nodeBox.x + nodeBox.width <= flowBox.x + flowBox.width + 1 &&
          nodeBox.y + nodeBox.height <= flowBox.y + flowBox.height + 1 &&
          overlayBoxes.every(
            (overlayBox) => !rectanglesOverlap(nodeBox, overlayBox),
          ),
      );
    })
    .toBe(true);
}

async function expectCanvasPointsToReachFlow(
  page: Page,
  flow: Locator,
  points: readonly {
    readonly xRatio: number;
    readonly yRatio: number;
  }[],
): Promise<void> {
  const flowBox = await requiredBox(flow, "full architecture canvas");
  const pointsReachFlow = await page.evaluate(
    ({ box, samplePoints }) => {
      const flowElement = document.querySelector(".architecture-canvas__flow");
      if (flowElement === null) {
        return false;
      }
      const intentionalOverlaySelector = [
        "[data-canvas-overlay]",
        ".shell-floating-panel",
        ".workspace-shell__inspector-launcher",
        ".workspace-shell__workspace-launcher",
        ".editor-popup-surface",
        ".react-flow__controls",
        ".react-flow__minimap",
      ].join(", ");
      return samplePoints.every(({ xRatio, yRatio }) => {
        const target = document.elementFromPoint(
          box.x + box.width * xRatio,
          box.y + box.height * yRatio,
        );
        return (
          target?.closest(".architecture-canvas__flow") === flowElement &&
          target.closest(intentionalOverlaySelector) === null
        );
      });
    },
    { box: flowBox, samplePoints: points },
  );
  expect(pointsReachFlow).toBe(true);
}

async function expectCanvasBackgroundPanAndMiniMapSync(
  page: Page,
  flow: Locator,
  minimapOverview: Locator,
): Promise<void> {
  const flowViewport = flow.locator(".react-flow__viewport");
  const miniMapMask = minimapOverview.locator(".react-flow__minimap-mask");
  const transformBeforePan = await readViewportTransform(flowViewport);
  const maskBeforePan = await miniMapMask.getAttribute("d");
  if (maskBeforePan === null) {
    throw new Error("The architecture minimap did not expose its viewport.");
  }

  const backgroundPoint = await findUnobstructedCanvasPoint(page, flow);

  await page.mouse.move(backgroundPoint.x, backgroundPoint.y);
  await page.mouse.down();
  await page.mouse.move(backgroundPoint.x + 48, backgroundPoint.y + 32, {
    steps: 4,
  });
  await page.mouse.up();

  await expect
    .poll(async () => readViewportTransform(flowViewport))
    .not.toBe(transformBeforePan);
  await expect
    .poll(async () => miniMapMask.getAttribute("d"))
    .not.toBe(maskBeforePan);
}

async function findUnobstructedCanvasPoint(
  page: Page,
  flow: Locator,
): Promise<{ readonly x: number; readonly y: number }> {
  const flowBox = await requiredBox(flow, "full architecture canvas");
  const backgroundPoint = await page.evaluate((box) => {
    const flowElement = document.querySelector(".architecture-canvas__flow");
    const pane = flowElement?.querySelector(".react-flow__pane");
    if (flowElement === null || pane === null) {
      return null;
    }

    const intentionalOverlaySelector = [
      "[data-canvas-overlay]",
      ".shell-floating-panel",
      ".workspace-shell__inspector-launcher",
      ".workspace-shell__workspace-launcher",
      ".editor-popup-surface",
      ".react-flow__controls",
      ".react-flow__minimap",
    ].join(", ");
    const candidates = [
      [0.5, 0.55],
      [0.5, 0.7],
      [0.35, 0.65],
      [0.65, 0.65],
      [0.5, 0.4],
    ] as const;

    for (const [xRatio, yRatio] of candidates) {
      const x = box.x + box.width * xRatio;
      const y = box.y + box.height * yRatio;
      const target = document.elementFromPoint(x, y);
      if (
        target === pane &&
        target.closest(intentionalOverlaySelector) === null
      ) {
        return { x, y };
      }
    }

    return null;
  }, flowBox);

  expect(backgroundPoint).not.toBeNull();
  if (backgroundPoint === null) {
    throw new Error("No unobstructed React Flow background point was found.");
  }

  return backgroundPoint;
}

async function expectSurfaceToFillViewportBelowAppBar(
  page: Page,
  surface: Locator,
): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error("Playwright did not expose the current viewport.");
  }

  const appBarBox = await requiredBox(
    page.locator(".top-app-bar"),
    "global application bar",
  );
  const surfaceBox = await requiredBox(surface, "editor workspace surface");

  expect(surfaceBox.x).toBeCloseTo(0, 0);
  expect(surfaceBox.width).toBeCloseTo(viewport.width, 0);
  expect(surfaceBox.y).toBeCloseTo(appBarBox.y + appBarBox.height, 0);
  expect(surfaceBox.y + surfaceBox.height).toBeCloseTo(viewport.height, 0);
}

async function expectLocatorToStayWithinInlineBounds(
  child: Locator,
  parent: Locator,
  viewportWidth: number,
): Promise<void> {
  const childBox = await requiredBox(child, "contained child");
  const parentBox = await requiredBox(parent, "containing parent");
  const childRight = childBox.x + childBox.width;
  const parentRight = parentBox.x + parentBox.width;

  expect(childBox.x, "child inline start").toBeGreaterThanOrEqual(
    parentBox.x - 1,
  );
  expect(childRight, "child inline end within parent").toBeLessThanOrEqual(
    parentRight + 1,
  );
  expect(childRight, "child inline end within viewport").toBeLessThanOrEqual(
    viewportWidth,
  );
}

async function expectArchitectureTreeTextNotToOverlap(
  treeItem: Locator,
): Promise<void> {
  const technical = treeItem.locator(".architecture-tree__technical");
  const kind = treeItem.locator(".architecture-tree__kind");
  await expect(technical).toBeVisible();
  await expect(kind).toBeVisible();
  const technicalBox = await technical.boundingBox();
  const kindBox = await kind.boundingBox();
  if (technicalBox === null || kindBox === null) {
    throw new Error("Expected architecture-list text to have rendered bounds.");
  }
  expect(rectanglesOverlap(technicalBox, kindBox)).toBe(false);
}

async function expectCatalogOwnsResponsiveScroll(
  catalogDrawer: Locator,
  bodySelector: string,
): Promise<void> {
  const catalogResults = catalogDrawer.getByRole("region", {
    name: "Catalog service results",
  });
  await expect(catalogDrawer).toBeVisible();
  await expect(catalogResults).toBeVisible();

  const scrollMetrics = await catalogDrawer.evaluate((drawer, selector) => {
    const body = drawer.querySelector<HTMLElement>(selector);
    const results = drawer.querySelector<HTMLElement>(
      "[data-catalog-scroll-region]",
    );
    if (body === null || results === null) {
      throw new Error("Expected the responsive catalog scroll surfaces.");
    }
    return {
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      resultsClientHeight: results.clientHeight,
      resultsScrollHeight: results.scrollHeight,
    };
  }, bodySelector);
  expect(scrollMetrics.bodyClientHeight).toBeGreaterThan(0);
  expect(scrollMetrics.bodyScrollHeight).toBeLessThanOrEqual(
    scrollMetrics.bodyClientHeight + 1,
  );
  expect(scrollMetrics.resultsScrollHeight).toBeGreaterThan(
    scrollMetrics.resultsClientHeight,
  );

  await catalogResults.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(async () => catalogResults.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
}

async function expectCatalogFocusRingWithinScroller(
  catalogResults: Locator,
): Promise<void> {
  const firstCategory = catalogResults.locator("details > summary").first();
  await firstCategory.focus();
  await expect(firstCategory).toBeFocused();

  const resultsBox = await catalogResults.boundingBox();
  const categoryBox = await firstCategory.boundingBox();
  const focusOutline = await firstCategory.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      offset: Number.parseFloat(styles.outlineOffset),
      width: Number.parseFloat(styles.outlineWidth),
    };
  });
  if (resultsBox === null || categoryBox === null) {
    throw new Error("Expected catalog focus surfaces to have rendered bounds.");
  }
  expect(focusOutline.width).toBeGreaterThan(0);
  expect(Number.isFinite(focusOutline.offset)).toBe(true);
  expect(
    categoryBox.x - focusOutline.width - focusOutline.offset,
  ).toBeGreaterThanOrEqual(resultsBox.x);
}

function rectanglesOverlap(
  left: {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  },
  right: {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  },
): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

test("dragging service bubbles in either direction starts typed review without changing the design", async ({
  page,
}) => {
  await page.goto(editorPath);
  const editor = page.locator(".architecture-editor");
  await expect(editor).toBeVisible({ timeout: 30_000 });
  const before = await editor.getAttribute("data-content-hash");
  const lambda = page.locator('[data-architecture-node-id="node_api_handler"]');
  const table = page.locator('[data-architecture-node-id="node_notes_table"]');
  for (const [source, target] of [
    [lambda, table],
    [table, lambda],
  ] as const) {
    const start = source
      .locator(".architecture-connection-dock__drag-surface")
      .first();
    const end = target
      .locator(".architecture-connection-dock__drag-surface")
      .first();
    const [a, b] = await Promise.all([start.boundingBox(), end.boundingBox()]);
    if (a === null || b === null)
      throw Error("Expected visible service connection bubbles");
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 });
    await page.mouse.up();
    const dialog = page.getByRole("dialog", {
      name: "Choose services to connect",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("radio")).toHaveCount(2);
    await expect(
      dialog.getByRole("radio", { name: "Reads from", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("radio", { name: "Writes to", exact: true }),
    ).toBeVisible();
    await expect(editor).toHaveAttribute("data-content-hash", before ?? "");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
});
