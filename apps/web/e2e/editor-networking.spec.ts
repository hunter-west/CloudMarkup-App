import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import axe from "axe-core";

const editorPath =
  "/organizations/local-org/projects/field-notes/editor?fixture=aws-networking" as const;

const boundaryMinimum = { height: 256, width: 352 } as const;
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

const visibleAssociationEdges = [
  {
    id: "net_s3_endpoint_routes.edge.connection",
    label: "Adds endpoint route",
  },
  { id: "net_vpc_igw.edge.connection", label: "Attaches gateway" },
  {
    id: "net_vpc_security_group.edge.connection",
    label: "Associates policy",
  },
] as const;

interface ElementBox {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

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

async function chooseCanvasAction(
  page: Page,
  name: "Architecture list" | "Fit architecture",
): Promise<void> {
  await page.getByRole("button", { name: "Open Canvas menu" }).click();
  const menu = page.getByRole("dialog", { name: "Canvas actions" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name }).click();
  await expect(menu).toHaveCount(0);
}

async function documentHashes(page: Page) {
  const content = await editor(page).getAttribute("data-content-hash");
  const visual = await editor(page).getAttribute("data-visual-hash");
  if (content === null || visual === null) {
    throw new Error("The networking editor did not expose both hashes.");
  }
  return { content, visual };
}

async function expandResource(
  page: Page,
  nodeId: string,
  label: string,
): Promise<Locator> {
  const node = architectureNode(page, nodeId);
  const toggle = node.getByRole("button", { name: `Expand ${label}` });
  await toggle.focus();
  await toggle.press("Enter");
  await expect(node).toHaveAttribute("data-collapsed", "false");
  return node;
}

async function visibleNodeIds(page: Page): Promise<readonly string[]> {
  return editor(page)
    .locator("[data-architecture-node-id]")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute("data-architecture-node-id") ?? "")
        .sort(),
    );
}

async function stableDockIds(page: Page): Promise<readonly string[]> {
  return editor(page)
    .locator(".architecture-connection-dock[data-connection-group-id]")
    .evaluateAll((docks) =>
      docks
        .map((dock) => dock.getAttribute("data-connection-group-id") ?? "")
        .sort(),
    );
}

async function associationEdgeIds(page: Page): Promise<readonly string[]> {
  return editor(page)
    .locator('.architecture-edge__path[data-visual-role="association"]')
    .evaluateAll((paths) =>
      paths
        .map(
          (path) =>
            path
              .closest(".react-flow__edge")
              ?.getAttribute("data-testid")
              ?.replace(/^rf__edge-/u, "") ?? "",
        )
        .sort(),
    );
}

async function requiredBox(
  locator: Locator,
  description: string,
): Promise<ElementBox> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`${description} has no rendered bounds.`);
  }
  return box;
}

function rectanglesOverlap(left: ElementBox, right: ElementBox): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

async function flowNodeDimensions(page: Page, nodeId: string) {
  return editor(page)
    .locator(`.react-flow__node[data-id="${nodeId}"]`)
    .evaluate((element) => ({
      height: Number.parseFloat((element as HTMLElement).style.height),
      width: Number.parseFloat((element as HTMLElement).style.width),
    }));
}

async function flowNodePosition(page: Page, nodeId: string) {
  return editor(page)
    .locator(`.react-flow__node[data-id="${nodeId}"]`)
    .evaluate((element) => {
      const coordinates = (element as HTMLElement).style.transform
        .match(/-?\d+(?:\.\d+)?/gu)
        ?.map(Number);
      if (
        coordinates === undefined ||
        coordinates.length < 2 ||
        !Number.isFinite(coordinates[0]) ||
        !Number.isFinite(coordinates[1])
      ) {
        throw new Error("The React Flow node has no finite stored position.");
      }
      return { x: coordinates[0] ?? 0, y: coordinates[1] ?? 0 };
    });
}

async function viewportScale(page: Page): Promise<number> {
  return editor(page)
    .locator(".react-flow__viewport")
    .evaluate((element) => {
      const scale = new DOMMatrixReadOnly(getComputedStyle(element).transform)
        .a;
      if (!Number.isFinite(scale) || scale <= 0) {
        throw new Error("The fitted React Flow viewport has no valid scale.");
      }
      return scale;
    });
}

async function expectArchitectureTreeParent(
  architectureList: Locator,
  nodeId: string,
  parentNodeId: string,
): Promise<void> {
  const node = architectureList.locator(
    `[data-architecture-tree-node-id="${nodeId}"]`,
  );
  await expect(node).toHaveCount(1);
  const parentLabel = await architectureList
    .locator('[data-architecture-tree-node-id="' + parentNodeId + '"]')
    .getAttribute("aria-label");
  expect(parentLabel).not.toBeNull();
  const readableParent = parentLabel?.split(". ")[0];
  expect(readableParent).toBeTruthy();
  expect(await node.getAttribute("aria-label")).toContain(
    "In " + String(readableParent),
  );
  const otherParentId =
    parentNodeId === "node_availability_zone_a"
      ? "node_availability_zone_b"
      : "node_availability_zone_a";
  const otherLabel = await architectureList
    .locator('[data-architecture-tree-node-id="' + otherParentId + '"]')
    .getAttribute("aria-label");
  expect(otherLabel).not.toBeNull();
  expect(await node.getAttribute("aria-label")).not.toContain(
    "In " + String(otherLabel?.split(". ")[0]),
  );
}

async function expectBoundaryReadability(
  page: Page,
  branch: readonly string[],
): Promise<void> {
  const nodeAndHeaderBoxes = await Promise.all(
    branch.map(async (nodeId) => {
      const node = architectureNode(page, nodeId);
      const [dimensions, nodeBox, headerBox] = await Promise.all([
        flowNodeDimensions(page, nodeId),
        requiredBox(node, `${nodeId} boundary`),
        requiredBox(
          node.locator(".architecture-node__header").first(),
          `${nodeId} boundary header`,
        ),
      ]);
      expect(
        dimensions.width,
        `${nodeId} minimum width`,
      ).toBeGreaterThanOrEqual(boundaryMinimum.width);
      expect(
        dimensions.height,
        `${nodeId} minimum height`,
      ).toBeGreaterThanOrEqual(boundaryMinimum.height);
      expect(headerBox.x).toBeGreaterThanOrEqual(nodeBox.x);
      expect(headerBox.y).toBeGreaterThanOrEqual(nodeBox.y);
      expect(headerBox.x + headerBox.width).toBeLessThanOrEqual(
        nodeBox.x + nodeBox.width,
      );
      expect(headerBox.y + headerBox.height).toBeLessThanOrEqual(
        nodeBox.y + nodeBox.height,
      );
      return { headerBox, nodeBox };
    }),
  );

  for (let index = 0; index < nodeAndHeaderBoxes.length - 1; index += 1) {
    const parent = nodeAndHeaderBoxes[index];
    const child = nodeAndHeaderBoxes[index + 1];
    if (parent === undefined || child === undefined) {
      throw new Error("The expected nested boundary branch is incomplete.");
    }
    expect(child.nodeBox.y).toBeGreaterThanOrEqual(
      parent.headerBox.y + parent.headerBox.height,
    );
    expect(child.nodeBox.x).toBeGreaterThanOrEqual(parent.nodeBox.x);
    expect(child.nodeBox.y).toBeGreaterThanOrEqual(parent.nodeBox.y);
    expect(child.nodeBox.x + child.nodeBox.width).toBeLessThanOrEqual(
      parent.nodeBox.x + parent.nodeBox.width,
    );
    expect(child.nodeBox.y + child.nodeBox.height).toBeLessThanOrEqual(
      parent.nodeBox.y + parent.nodeBox.height,
    );
    expect(rectanglesOverlap(parent.headerBox, child.nodeBox)).toBe(false);
  }
}

async function expectNoAxeViolations(
  page: Page,
  context: string,
  rootSelector?: string,
  disableTransformedCanvasTargetSize = false,
) {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(
    async ({ rootSelector, disableTransformedCanvasTargetSize }) => {
      const runtime = (
        globalThis as typeof globalThis & {
          axe: {
            run(
              root: Document | Element,
              options: {
                runOnly: { type: "tag"; values: string[] };
                rules?: { "target-size": { enabled: boolean } };
              },
            ): Promise<{
              violations: {
                id: string;
                impact: string | null;
                nodes: { failureSummary: string | null; target: string[] }[];
              }[];
            }>;
          };
        }
      ).axe;
      const root =
        rootSelector === undefined
          ? document
          : document.querySelector(rootSelector);
      if (root === null) {
        throw new Error(
          `Axe root selector did not match: ${String(rootSelector)}`,
        );
      }
      const result = await runtime.run(root, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
        },
        ...(disableTransformedCanvasTargetSize
          ? { rules: { "target-size": { enabled: false } } }
          : {}),
      });
      return result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => ({
          failureSummary: node.failureSummary,
          target: node.target,
        })),
      }));
    },
    { rootSelector, disableTransformedCanvasTargetSize },
  );
  expect(
    violations,
    `${context} axe violations:\n${JSON.stringify(violations, null, 2)}`,
  ).toEqual([]);
}

async function selectSubnetAndOpenPlacement(
  page: Page,
  nodeId = "node_public_subnet_a",
) {
  const architectureList = page.getByRole("region", {
    name: "Architecture list",
  });
  if (!(await architectureList.isVisible())) {
    const canvasMenu = page.getByRole("button", { name: "Open Canvas menu" });
    await canvasMenu.focus();
    await canvasMenu.press("Enter");
    const menu = page.getByRole("dialog", { name: "Canvas actions" });
    const architectureAction = menu.getByRole("button", {
      name: "Architecture list",
    });
    await architectureAction.focus();
    await architectureAction.press("Enter");
    await expect(menu).toHaveCount(0);
  }
  const subnet = architectureList.locator(
    `[data-architecture-tree-node-id="${nodeId}"]`,
  );
  await subnet.focus();
  await subnet.press("Enter");
  await expect(subnet).toHaveAttribute("aria-current", "true");
  const configure = page
    .getByRole("navigation", { name: "Inspector tools" })
    .getByRole("button", { exact: true, name: "Configure" });
  await configure.focus();
  await configure.press("Enter");
  const inspector = page.getByRole("dialog", { name: "Configure inspector" });
  await expect(inspector).toBeVisible();
  const selectedOverview = inspector
    .getByRole("region", { name: "Selected architecture element" })
    .locator("summary")
    .filter({ hasText: "Selected architecture element details:" });
  if ((await selectedOverview.getAttribute("aria-expanded")) !== "true") {
    await selectedOverview.focus();
    await selectedOverview.press("Enter");
  }
  const placement = inspector.getByRole("region", {
    name: "Boundary placement",
  });
  await expect(placement).toBeVisible();
  return placement;
}

test("shows the exact networking hierarchy, readable associations, education, minimap, accessibility, and mode parity", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto(editorPath);
  await waitForEditorReady(page);
  // Target-size uses the clipped/transformed canvas intersection, so a
  // correctly sized dock at a pan/zoom boundary is reported as too small.
  // The untransformed help and placement controls are scanned separately.
  await expectNoAxeViolations(
    page,
    "AWS networking canvas at default zoom",
    undefined,
    true,
  );
  await chooseCanvasAction(page, "Fit architecture");

  const boundaryTiers = [
    ["node_network_region", "outer"],
    ["node_network_vpc", "primary"],
    ["node_availability_zone_a", "secondary"],
    ["node_public_subnet_a", "tertiary"],
  ] as const;
  for (const [nodeId, level] of boundaryTiers) {
    await expect(architectureNode(page, nodeId)).toHaveAttribute(
      "data-boundary-level",
      level,
    );
  }
  const boundaryStyles = await Promise.all(
    boundaryTiers.map(([nodeId]) =>
      architectureNode(page, nodeId).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          borderLeftWidth: style.borderLeftWidth,
          borderTopStyle: style.borderTopStyle,
          borderTopWidth: style.borderTopWidth,
        };
      }),
    ),
  );
  expect(boundaryStyles.map((style) => style.borderTopStyle)).toEqual([
    "solid",
    "solid",
    "solid",
    "solid",
  ]);
  expect(boundaryStyles.map((style) => style.borderTopWidth)).toEqual([
    "1px",
    "1px",
    "1px",
    "1px",
  ]);
  expect(boundaryStyles.map((style) => style.borderLeftWidth)).toEqual([
    "4px",
    "4px",
    "4px",
    "4px",
  ]);
  expect(
    new Set(boundaryStyles.map((style) => style.backgroundColor)).size,
  ).toBe(4);
  await expect(architectureNode(page, "node_public_subnet_a")).toContainText(
    "Access tierpublic",
  );
  await expectBoundaryReadability(
    page,
    boundaryTiers.map(([nodeId]) => nodeId),
  );
  const vpcPeerIds = [
    "node_availability_zone_a",
    "node_availability_zone_b",
    "node_public_route_table",
    "node_private_route_table",
    "node_s3_gateway_endpoint",
  ] as const;
  const vpcPeerBoxes = await Promise.all(
    vpcPeerIds.map((nodeId) =>
      requiredBox(architectureNode(page, nodeId), nodeId),
    ),
  );
  for (const [index, left] of vpcPeerBoxes.entries()) {
    for (const right of vpcPeerBoxes.slice(index + 1)) {
      expect(
        rectanglesOverlap(left, right),
        `${String(vpcPeerIds[index])} must not cover another VPC child`,
      ).toBe(false);
    }
  }

  const associationPaths = editor(page).locator(
    '.architecture-edge__path[data-visual-role="association"]',
  );
  await expect(associationPaths).toHaveCount(visibleAssociationEdges.length);
  await expect
    .poll(() => associationEdgeIds(page))
    .toEqual(visibleAssociationEdges.map((edge) => edge.id).sort());
  const flowBox = await requiredBox(
    page.locator(".architecture-canvas__flow"),
    "the fitted networking canvas",
  );
  const boundaryHeaderBoxes = await Promise.all(
    boundaryTiers.map(([nodeId]) =>
      requiredBox(
        architectureNode(page, nodeId)
          .locator(".architecture-node__header")
          .first(),
        `${nodeId} boundary header`,
      ),
    ),
  );
  await expect(page.locator(".architecture-edge__label")).toHaveCount(0);
  for (const exactEdge of visibleAssociationEdges) {
    const edge = editor(page).locator(
      `[data-testid="rf__edge-${exactEdge.id}"]`,
    );
    const path = edge.locator(
      '.architecture-edge__path[data-visual-role="association"]',
    );
    const label = page.locator(
      `.architecture-edge__label[data-architecture-edge-id="${exactEdge.id}"][data-visual-role="association"]`,
    );
    await expect(edge, exactEdge.id).toHaveCount(1);
    await expect(edge).toHaveAttribute(
      "aria-label",
      new RegExp(`^${exactEdge.label}\\. Relationship type `, "u"),
    );
    await expect(path, `${exactEdge.id} path`).toHaveCount(1);
    await expect(label, `${exactEdge.id} idle label`).toHaveCount(0);
    await edge.focus();
    await expect(edge).toBeFocused();
    await edge.press("Enter");
    await expect(label, `${exactEdge.id} selected label`).toHaveText(
      exactEdge.label,
    );
    await expect(page.locator(".architecture-edge__label")).toHaveCount(1);
    const pathMetrics = await path.evaluate((element) => {
      if (!(element instanceof SVGPathElement)) {
        throw new Error("The exact networking association is not an SVG path.");
      }
      const matrix = element.getScreenCTM();
      if (matrix === null) {
        throw new Error(
          "The exact networking association has no screen transform.",
        );
      }
      const length = element.getTotalLength();
      const samples = Array.from({ length: 9 }, (_, index) => {
        const point = element.getPointAtLength((length * (index + 1)) / 10);
        const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
        return { x: screen.x, y: screen.y };
      });
      const style = getComputedStyle(element);
      return {
        dashArray: style.strokeDasharray,
        length,
        samples,
        strokeWidth: style.strokeWidth,
        vectorEffect: style.vectorEffect,
      };
    });
    expect(pathMetrics.length, `${exactEdge.id} path length`).toBeGreaterThan(
      24,
    );
    expect(pathMetrics.dashArray, exactEdge.id).not.toBe("none");
    expect(Number.parseFloat(pathMetrics.strokeWidth)).toBeGreaterThan(0);
    expect(pathMetrics.vectorEffect).toBe("non-scaling-stroke");
    for (const point of pathMetrics.samples) {
      for (const header of boundaryHeaderBoxes) {
        expect(
          point.x > header.x &&
            point.x < header.x + header.width &&
            point.y > header.y &&
            point.y < header.y + header.height,
          `${exactEdge.id} must not cross a boundary header`,
        ).toBe(false);
      }
    }
    const labelBox = await requiredBox(label, `${exactEdge.id} label`);
    expect(labelBox.x).toBeGreaterThanOrEqual(flowBox.x);
    expect(labelBox.y).toBeGreaterThanOrEqual(flowBox.y);
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(
      flowBox.x + flowBox.width,
    );
    expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(
      flowBox.y + flowBox.height,
    );
    for (const header of boundaryHeaderBoxes) {
      expect(rectanglesOverlap(labelBox, header), exactEdge.id).toBe(false);
    }
  }
  await expect(
    editor(page).locator(
      '[data-architecture-node-id="node_lambda_vpc_access"]',
    ),
  ).toHaveCount(0);
  await expect(
    editor(page).locator(
      '[data-architecture-node-id="node_public_default_route"]',
    ),
  ).toHaveCount(0);

  const overview = page.getByRole("img", {
    name: "Architecture overview",
  });
  const minimapTiers = boundaryTiers.map(([nodeId, level]) => ({
    level,
    node: overview.locator(`[data-minimap-node-id="${nodeId}"]`),
  }));
  for (const { level, node } of minimapTiers) {
    await expect(node).toHaveClass(
      new RegExp(`architecture-minimap-node--boundary-${level}`, "u"),
    );
  }
  const minimapStyles = await Promise.all(
    minimapTiers.map(({ node }) =>
      node.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          dashArray: style.strokeDasharray,
          strokeWidth: style.strokeWidth,
        };
      }),
    ),
  );
  expect(minimapStyles[0]?.strokeWidth).toBe("3px");
  expect(minimapStyles[1]?.dashArray).not.toBe("none");
  expect(minimapStyles[2]?.dashArray).not.toBe("none");
  expect(minimapStyles[1]?.dashArray).not.toBe(minimapStyles[2]?.dashArray);
  expect(minimapStyles[3]?.strokeWidth).toBe("2px");

  await page.emulateMedia({ forcedColors: "active" });
  expect(
    await page.evaluate(
      () => window.matchMedia("(forced-colors: active)").matches,
    ),
  ).toBe(true);
  const forcedBoundaryStyles = await Promise.all(
    boundaryTiers.map(([nodeId]) =>
      architectureNode(page, nodeId).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          backgroundImage: style.backgroundImage,
          borderColor: style.borderTopColor,
          borderStyle: style.borderTopStyle,
          color: style.color,
        };
      }),
    ),
  );
  expect(forcedBoundaryStyles.map((style) => style.borderStyle)).toEqual([
    "solid",
    "solid",
    "dotted",
    "solid",
  ]);
  for (const style of forcedBoundaryStyles) {
    expect(style.backgroundImage).toBe("none");
    expect(style.borderColor).toBe(style.color);
  }
  const firstMinimapTier = minimapTiers[0];
  if (firstMinimapTier === undefined) {
    throw new Error("Expected the region minimap tier to be rendered.");
  }
  const forcedMinimapStyle = await firstMinimapTier.node.evaluate((element) => {
    const style = getComputedStyle(element);
    return { fill: style.fill, stroke: style.stroke };
  });
  expect(forcedMinimapStyle.fill).not.toBe(forcedMinimapStyle.stroke);
  expect(
    await associationPaths.evaluateAll((paths) =>
      paths.every((path) => getComputedStyle(path).strokeDasharray !== "none"),
    ),
  ).toBe(true);
  await page.emulateMedia({ forcedColors: "none" });

  for (const subnet of [
    {
      accessTier: "public",
      label: "Public subnet A · 10.0.1.0/24",
      nodeId: "node_public_subnet_a",
    },
    {
      accessTier: "private",
      label: "Private subnet A · 10.0.11.0/24",
      nodeId: "node_private_subnet_a",
    },
  ] as const) {
    const node = architectureNode(page, subnet.nodeId);
    await expect(node).toContainText(`Access tier${subnet.accessTier}`);
    await node.getByRole("button", { name: `Explain ${subnet.label}` }).click();
    const help = page.getByRole("dialog", {
      name: "Learn inspector",
    });
    await expect(help).toContainText(
      "A subnet belongs to exactly one Availability Zone",
    );
    await expect(help).toContainText(
      "public routes point to an internet gateway",
    );
    await expect(help).toContainText(
      "private IPv4 egress commonly points to a NAT gateway",
    );
    await expect(help).toContainText("gateway endpoint for S3 or DynamoDB");
    await page.keyboard.press("Escape");
  }

  const nat = await expandResource(
    page,
    "node_nat_gateway_a",
    "NAT gateway · AZ A",
  );
  await page
    .locator('[data-architecture-service-details-for="node_nat_gateway_a"]')
    .getByRole("button", { name: "Explain NAT gateway · AZ A" })
    .click();
  const natHelp = page.getByRole("dialog", {
    name: "Learn inspector",
  });
  await expect(natHelp).toContainText("hourly and per-gigabyte charges");
  await expect(natHelp).toContainText("cross-zone routing adds cost");
  await expect(natHelp).toContainText(
    "Place a public NAT gateway in a public subnet",
  );
  await expect(natHelp).toContainText("S3/DynamoDB gateway endpoints");
  await page.keyboard.press("Escape");
  await nat
    .getByRole("button", { name: "Collapse NAT gateway · AZ A" })
    .click();

  const endpoint = await expandResource(
    page,
    "node_s3_gateway_endpoint",
    "S3 gateway endpoint",
  );
  await page
    .locator(
      '[data-architecture-service-details-for="node_s3_gateway_endpoint"]',
    )
    .getByRole("button", { name: "Explain S3 gateway endpoint" })
    .click();
  const endpointHelp = page.getByRole("dialog", {
    name: "Learn inspector",
  });
  await expect(endpointHelp).toContainText(
    "managed service stays outside your VPC",
  );
  await expect(endpointHelp).toContainText("no hourly endpoint charge");
  await expect(endpointHelp).toContainText("avoid NAT processing");
  await page.keyboard.press("Escape");
  await endpoint
    .getByRole("button", { name: "Collapse S3 gateway endpoint" })
    .click();

  const securityGroup = await expandResource(
    page,
    "node_application_security_group",
    "Application security group",
  );
  const securityGroupAssociations = page
    .locator(
      '[data-architecture-service-details-for="node_application_security_group"]',
    )
    .getByRole("list", {
      name: "Network associations for Application security group",
    });
  for (const badge of [
    {
      count: "1",
      id: "aws.ec2.security-group.dock.vpc",
      label: "VPC",
    },
    {
      count: "1",
      id: "aws.ec2.security-group.dock.lambda-vpc-access",
      label: "Lambda access",
    },
    {
      count: "2",
      id: "aws.ec2.security-group.dock.rules",
      label: "Traffic rules",
    },
  ] as const) {
    const item = securityGroupAssociations.locator(
      `[data-association-id="${badge.id}"]`,
    );
    await expect(item).toHaveAttribute("data-edge-count", badge.count);
    await expect(item).toContainText(badge.label);
  }
  await securityGroup
    .getByRole("button", { name: "Collapse Application security group" })
    .click();

  for (const routeTable of [
    {
      associationEdges: [
        {
          edgeId: "net_pub_a_route_assoc.edge.connection",
          nodeId: "node_public_route_association_a",
          remoteLabel: "Public subnet A · 10.0.1.0/24",
        },
        {
          edgeId: "net_pub_b_route_assoc.edge.connection",
          nodeId: "node_public_route_association_b",
          remoteLabel: "Public subnet B · 10.0.2.0/24",
        },
      ],
      label: "Public routes",
      nodeId: "node_public_route_table",
      routeEdgeId: "net_public_default.edge.connection",
      routeNodeId: "node_public_default_route",
      routeTarget: "Routes to internet: Internet gateway",
    },
    {
      associationEdges: [
        {
          edgeId: "net_priv_a_route_assoc.edge.connection",
          nodeId: "node_private_route_association_a",
          remoteLabel: "Private subnet A · 10.0.11.0/24",
        },
        {
          edgeId: "net_priv_b_route_assoc.edge.connection",
          nodeId: "node_private_route_association_b",
          remoteLabel: "Private subnet B · 10.0.12.0/24",
        },
      ],
      label: "Private routes",
      nodeId: "node_private_route_table",
      routeEdgeId: "net_private_default.edge.connection",
      routeNodeId: "node_private_default_route",
      routeTarget: "Routes through NAT: NAT gateway · AZ A",
    },
  ] as const) {
    const node = await expandResource(
      page,
      routeTable.nodeId,
      routeTable.label,
    );
    await page
      .locator(`[data-architecture-service-details-for="${routeTable.nodeId}"]`)
      .getByRole("button", { name: `Explain ${routeTable.label}` })
      .click();
    const help = page.getByRole("dialog", {
      name: "Learn inspector",
    });
    const routes = help
      .getByRole("tabpanel", { name: "Learn", exact: true })
      .locator(
        '[data-owned-configuration-slot="aws.ec2.route-table.slot.routes"]',
      );
    await expect(routes).toContainText("Routes (1)");
    await routes.locator(":scope > summary").click();
    const route = routes.locator(
      `[data-configuration-node-id="${routeTable.routeNodeId}"]`,
    );
    await expect(route).toContainText("Destination IPv4 CIDR: 0.0.0.0/0");
    await expect(
      route.locator(`[data-architecture-edge-id="${routeTable.routeEdgeId}"]`),
    ).toHaveText(routeTable.routeTarget);
    const associations = help
      .getByRole("tabpanel", { name: "Learn", exact: true })
      .locator(
        '[data-owned-configuration-slot="aws.ec2.route-table.slot.subnet-associations"]',
      );
    await expect(associations).toContainText("Subnet associations (2)");
    await associations.locator(":scope > summary").click();
    for (const association of routeTable.associationEdges) {
      const entry = associations.locator(
        `[data-configuration-node-id="${association.nodeId}"]`,
      );
      await expect(
        entry.locator(`[data-architecture-edge-id="${association.edgeId}"]`),
      ).toHaveText(`Associates subnet: ${association.remoteLabel}`);
    }
    await page.keyboard.press("Escape");
    await node
      .getByRole("button", { name: `Collapse ${routeTable.label}` })
      .click();
  }

  await expandResource(
    page,
    "node_networked_lambda",
    "Private application function",
  );
  await page
    .locator('[data-architecture-service-details-for="node_networked_lambda"]')
    .getByRole("button", { name: "Explain Private application function" })
    .click();
  const lambdaHelp = page.getByRole("dialog", {
    name: "Learn inspector",
  });
  await expect(lambdaHelp).toContainText("VPC access (1)");
  await expect(lambdaHelp).toContainText("Private subnet A · 10.0.11.0/24");
  await expect(lambdaHelp).toContainText("Private subnet B · 10.0.12.0/24");
  await expect(lambdaHelp).toContainText("Application security group");
  await expect(lambdaHelp).toContainText("multiple Availability Zones");
  const lambdaVpcAccess = lambdaHelp
    .getByRole("tabpanel", { name: "Learn", exact: true })
    .locator(
      '[data-owned-configuration-slot="aws.lambda.function.slot.vpc-access-configuration"]',
    );
  await lambdaVpcAccess.locator(":scope > summary").click();
  const lambdaConfiguration = lambdaVpcAccess.locator(
    '[data-configuration-node-id="node_lambda_vpc_access"]',
  );
  for (const association of [
    {
      edgeId: "net_lambda_subnet_a.edge.connection",
      text: "Uses subnet: Private subnet A · 10.0.11.0/24",
    },
    {
      edgeId: "net_lambda_subnet_b.edge.connection",
      text: "Uses subnet: Private subnet B · 10.0.12.0/24",
    },
    {
      edgeId: "net_lambda_security_group.edge.connection",
      text: "Uses security group: Application security group",
    },
  ] as const) {
    await expect(
      lambdaConfiguration.locator(
        `[data-architecture-edge-id="${association.edgeId}"]`,
      ),
    ).toHaveText(association.text);
  }
  await expectNoAxeViolations(
    page,
    "Lambda VPC access help",
    ".selected-inspector__tab",
  );
  await page.keyboard.press("Escape");

  const hashes = await documentHashes(page);
  const guidedNodeIds = await visibleNodeIds(page);
  const guidedDockIds = await stableDockIds(page);
  const guidedAssociationEdgeIds = await associationEdgeIds(page);
  const vpc = architectureNode(page, "node_network_vpc");
  const expandedVpc = await requiredBox(vpc, "expanded VPC boundary");
  await vpc.getByRole("button", { name: "Hide contents" }).click();
  const collapsedVpc = await requiredBox(vpc, "collapsed VPC boundary");
  expect(collapsedVpc.height).toBeLessThan(expandedVpc.height * 0.6);
  expect(collapsedVpc.height).toBeGreaterThanOrEqual(70);
  await expect(architectureNode(page, "node_availability_zone_a")).toHaveCount(
    0,
  );
  await expect(
    architectureNode(page, "node_application_security_group"),
  ).toBeVisible();
  await expect(architectureNode(page, "node_application_table")).toBeVisible();
  await expect(architectureNode(page, "node_networked_lambda")).toBeVisible();
  await expect(architectureNode(page, "node_s3_gateway_endpoint")).toHaveCount(
    0,
  );
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    hashes.content,
  );
  await expect(editor(page)).toHaveAttribute("data-visual-hash", hashes.visual);
  await expectNoAxeViolations(
    page,
    "collapsed VPC networking state",
    ".architecture-editor",
    true,
  );
  await vpc.getByRole("button", { name: "Show contents" }).click();

  await page.getByRole("button", { name: "Professional" }).click();
  await expect(editor(page)).toHaveAttribute(
    "data-editor-mode",
    "professional",
  );
  await expect.poll(() => visibleNodeIds(page)).toEqual(guidedNodeIds);
  await expect.poll(() => stableDockIds(page)).toEqual(guidedDockIds);
  await expect
    .poll(() => associationEdgeIds(page))
    .toEqual(guidedAssociationEdgeIds);
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    hashes.content,
  );
  await expect(editor(page)).toHaveAttribute("data-visual-hash", hashes.visual);
});

test("uses the keyboard/list alternative for an exact cross-AZ move with reviewed undo and redo", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(editorPath);
  await waitForEditorReady(page);
  const hashes = await documentHashes(page);
  const initialSubnetPosition = await flowNodePosition(
    page,
    "node_public_subnet_a",
  );
  const zoneBPosition = await flowNodePosition(
    page,
    "node_availability_zone_b",
  );
  const initialBoundaryDimensions = {
    region: await flowNodeDimensions(page, "node_network_region"),
    vpc: await flowNodeDimensions(page, "node_network_vpc"),
    zoneB: await flowNodeDimensions(page, "node_availability_zone_b"),
  };
  const placement = await selectSubnetAndOpenPlacement(page);
  const select = placement.getByRole("combobox", {
    name: "Place this resource",
  });
  await expect(select.locator("option")).toHaveCount(2);
  await expectNoAxeViolations(
    page,
    "boundary placement inspector",
    '[aria-label="Boundary placement"]',
  );
  expect(
    await select
      .locator("option")
      .evaluateAll((options) =>
        options.map((option) => option.getAttribute("value")),
      ),
  ).toEqual(["node:node_availability_zone_a", "node:node_availability_zone_b"]);
  await expect(select).toHaveValue("node:node_availability_zone_a");

  await select.focus();
  await select.press("ArrowDown");
  await expect(select).toBeFocused();
  await expect(select).toHaveValue("node:node_availability_zone_b");
  const apply = placement.getByRole("button", { name: "Apply placement" });
  await apply.focus();
  await apply.press("Enter");
  await expect(select).toHaveValue("node:node_availability_zone_b");
  await expect
    .poll(() => flowNodePosition(page, "node_public_subnet_a"))
    .not.toEqual(initialSubnetPosition);
  const movedSubnetPosition = await flowNodePosition(
    page,
    "node_public_subnet_a",
  );
  expect(movedSubnetPosition).toEqual({
    x: zoneBPosition.x + 32,
    y: zoneBPosition.y + 736,
  });
  const movedBoundaryDimensions = {
    region: await flowNodeDimensions(page, "node_network_region"),
    vpc: await flowNodeDimensions(page, "node_network_vpc"),
    zoneB: await flowNodeDimensions(page, "node_availability_zone_b"),
  };
  expect(movedBoundaryDimensions.zoneB.height).toBeGreaterThan(
    initialBoundaryDimensions.zoneB.height,
  );
  expect(movedBoundaryDimensions.vpc.height).toBeGreaterThan(
    initialBoundaryDimensions.vpc.height,
  );
  expect(movedBoundaryDimensions.region.height).toBeGreaterThan(
    initialBoundaryDimensions.region.height,
  );
  await expectBoundaryReadability(page, [
    "node_network_region",
    "node_network_vpc",
    "node_availability_zone_b",
    "node_public_subnet_a",
  ]);
  await expectNoAxeViolations(
    page,
    "post-mutation boundary placement inspector",
    '[aria-label="Boundary placement"]',
  );
  const moved = await documentHashes(page);
  expect(moved.content).not.toBe(hashes.content);
  expect(moved.visual).not.toBe(hashes.visual);

  await chooseCanvasAction(page, "Architecture list");
  const architectureList = page.getByRole("region", {
    name: "Architecture list",
  });
  await expectArchitectureTreeParent(
    architectureList,
    "node_public_subnet_a",
    "node_availability_zone_b",
  );
  await expectNoAxeViolations(
    page,
    "post-mutation architecture tree",
    '[aria-label="Architecture list"]',
  );

  await page.keyboard.press("Control+z");
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    hashes.content,
  );
  await expect(editor(page)).toHaveAttribute("data-visual-hash", hashes.visual);
  await expect
    .poll(() => flowNodePosition(page, "node_public_subnet_a"))
    .toEqual(initialSubnetPosition);
  await expectArchitectureTreeParent(
    architectureList,
    "node_public_subnet_a",
    "node_availability_zone_a",
  );

  await page.keyboard.press("Control+y");
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    moved.content,
  );
  await expect(editor(page)).toHaveAttribute("data-visual-hash", moved.visual);
  await expect
    .poll(() => flowNodePosition(page, "node_public_subnet_a"))
    .toEqual(movedSubnetPosition);
  await expectArchitectureTreeParent(
    architectureList,
    "node_public_subnet_a",
    "node_availability_zone_b",
  );
});

async function dragNodeCenterTo(
  page: Page,
  nodeId: string,
  target: { readonly x: number; readonly y: number },
) {
  const wrapper = editor(page).locator(
    `.react-flow__node[data-id="${nodeId}"]`,
  );
  const box = await wrapper.boundingBox();
  if (box === null) {
    throw new Error(`Drag source ${nodeId} has no bounds.`);
  }
  const grab = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
}

async function dragNodeToFlowPosition(
  page: Page,
  nodeId: string,
  targetPosition: { readonly x: number; readonly y: number },
): Promise<void> {
  const wrapper = editor(page).locator(
    `.react-flow__node[data-id="${nodeId}"]`,
  );
  const [box, initialPosition, scale] = await Promise.all([
    wrapper.boundingBox(),
    flowNodePosition(page, nodeId),
    viewportScale(page),
  ]);
  if (box === null) {
    throw new Error(`Drag source ${nodeId} has no bounds.`);
  }
  const grab = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  let cursor = {
    x: grab.x + (targetPosition.x - initialPosition.x) * scale,
    y: grab.y + (targetPosition.y - initialPosition.y) * scale,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.mouse.move(cursor.x, cursor.y, { steps: 12 });
    const previewPosition = await flowNodePosition(page, nodeId);
    if (
      previewPosition.x === targetPosition.x &&
      previewPosition.y === targetPosition.y
    ) {
      break;
    }
    cursor = {
      x: cursor.x + (targetPosition.x - previewPosition.x) * scale,
      y: cursor.y + (targetPosition.y - previewPosition.y) * scale,
    };
  }
  await expect
    .poll(() => flowNodePosition(page, nodeId))
    .toEqual(targetPosition);
  await page.mouse.up();
}

test("applies a valid pointer cross-AZ reparent and rejects an invalid subnet-container drop without mutation", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(editorPath);
  await waitForEditorReady(page);
  await chooseCanvasAction(page, "Fit architecture");
  const initial = await documentHashes(page);
  const initialPosition = await flowNodePosition(page, "node_public_subnet_b");
  const initialBoundaryDimensions = {
    region: await flowNodeDimensions(page, "node_network_region"),
    vpc: await flowNodeDimensions(page, "node_network_vpc"),
    zoneA: await flowNodeDimensions(page, "node_availability_zone_a"),
    zoneB: await flowNodeDimensions(page, "node_availability_zone_b"),
  };
  const zoneAPosition = await flowNodePosition(
    page,
    "node_availability_zone_a",
  );

  // The subnet's placement anchor lands inside AZ A, to the right of its
  // existing child subnets. This exercises pointer hit-testing, placement
  // preflight, and the atomic move + reparent command instead of a same-AZ
  // position-only move.
  const expectedValidDropPosition = {
    x: zoneAPosition.x + 216,
    y: zoneAPosition.y + 160,
  };
  await dragNodeToFlowPosition(
    page,
    "node_public_subnet_b",
    expectedValidDropPosition,
  );
  await expect
    .poll(async () => (await documentHashes(page)).content)
    .not.toBe(initial.content);
  const validDropPosition = await flowNodePosition(
    page,
    "node_public_subnet_b",
  );
  expect(validDropPosition).toEqual(expectedValidDropPosition);
  await expect
    .poll(async () => (await documentHashes(page)).visual)
    .not.toBe(initial.visual);
  const moved = await documentHashes(page);
  const movedBoundaryDimensions = {
    region: await flowNodeDimensions(page, "node_network_region"),
    vpc: await flowNodeDimensions(page, "node_network_vpc"),
    zoneA: await flowNodeDimensions(page, "node_availability_zone_a"),
    zoneB: await flowNodeDimensions(page, "node_availability_zone_b"),
  };
  expect(movedBoundaryDimensions.zoneA).toEqual({ height: 736, width: 600 });
  expect(movedBoundaryDimensions.zoneA.width).toBeGreaterThan(
    initialBoundaryDimensions.zoneA.width,
  );
  expect(movedBoundaryDimensions.zoneB).toEqual(
    initialBoundaryDimensions.zoneB,
  );
  expect(movedBoundaryDimensions.vpc).toEqual(initialBoundaryDimensions.vpc);
  expect(movedBoundaryDimensions.region).toEqual(
    initialBoundaryDimensions.region,
  );
  await expectBoundaryReadability(page, [
    "node_network_region",
    "node_network_vpc",
    "node_availability_zone_a",
    "node_public_subnet_b",
  ]);
  await chooseCanvasAction(page, "Architecture list");
  const architectureList = page.getByRole("region", {
    name: "Architecture list",
  });
  await expectArchitectureTreeParent(
    architectureList,
    "node_public_subnet_b",
    "node_availability_zone_a",
  );

  await page.keyboard.press("Control+z");
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    initial.content,
  );
  await expect(editor(page)).toHaveAttribute(
    "data-visual-hash",
    initial.visual,
  );
  await expect
    .poll(() => flowNodePosition(page, "node_public_subnet_b"))
    .toEqual(initialPosition);
  await expectArchitectureTreeParent(
    architectureList,
    "node_public_subnet_b",
    "node_availability_zone_b",
  );
  expect(await flowNodeDimensions(page, "node_availability_zone_a")).toEqual(
    initialBoundaryDimensions.zoneA,
  );

  await page.keyboard.press("Control+y");
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    moved.content,
  );
  await expect(editor(page)).toHaveAttribute("data-visual-hash", moved.visual);
  await expect
    .poll(() => flowNodePosition(page, "node_public_subnet_b"))
    .toEqual(validDropPosition);
  await expectArchitectureTreeParent(
    architectureList,
    "node_public_subnet_b",
    "node_availability_zone_a",
  );

  await page.keyboard.press("Control+z");
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    initial.content,
  );
  await expect(editor(page)).toHaveAttribute(
    "data-visual-hash",
    initial.visual,
  );
  await expect
    .poll(() => flowNodePosition(page, "node_public_subnet_b"))
    .toEqual(initialPosition);
  const beforeInvalid = await documentHashes(page);
  await chooseCanvasAction(page, "Fit architecture");
  const privateSubnet = editor(page).locator(
    '.react-flow__node[data-id="node_private_subnet_b"]',
  );
  const privateSubnetBox = await privateSubnet.boundingBox();
  if (privateSubnetBox === null) {
    throw new Error("The invalid subnet target has no rendered bounds.");
  }
  await dragNodeCenterTo(page, "node_public_subnet_b", {
    x: privateSubnetBox.x + privateSubnetBox.width / 2,
    y: privateSubnetBox.y + privateSubnetBox.height / 2,
  });
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    beforeInvalid.content,
  );
  await expect(editor(page)).toHaveAttribute(
    "data-visual-hash",
    beforeInvalid.visual,
  );
  await expect
    .poll(() => flowNodePosition(page, "node_public_subnet_b"))
    .toEqual(initialPosition);
  const invalidNotice = page.locator(
    '.architecture-canvas-notice[role="alert"]',
  );
  await expect(invalidNotice).toContainText(
    /cannot be placed inside|must be placed inside|only be placed/u,
  );
  await expectNoAxeViolations(
    page,
    "invalid subnet-container drop notice",
    ".architecture-canvas-notice",
  );
  await expectArchitectureTreeParent(
    architectureList,
    "node_public_subnet_b",
    "node_availability_zone_b",
  );
});

test("creates, reviews, retargets, and removes an exact route-table association without changing subnet containment", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto(editorPath);
  await waitForEditorReady(page);
  await chooseCanvasAction(page, "Architecture list");

  const architectureList = page.getByRole("region", {
    name: "Architecture list",
  });
  const publicRouteTable = architectureList.locator(
    '[data-architecture-tree-node-id="node_public_route_table"]',
  );
  await publicRouteTable.focus();
  await publicRouteTable.press("Enter");
  await expect(publicRouteTable).toHaveAttribute("aria-current", "true");
  const configure = page
    .getByRole("navigation", { name: "Inspector tools" })
    .getByRole("button", { exact: true, name: "Configure" });
  await configure.focus();
  await configure.press("Enter");

  const inspector = page.getByRole("dialog", { name: "Configure inspector" });
  await expect(inspector).toBeVisible();
  const ownedConfigurations = inspector.getByRole("region", {
    name: "Owned configurations",
  });
  await expect(
    ownedConfigurations.locator(".owned-configuration__disclosure"),
  ).toHaveAttribute("open", "");
  const associationSlot = ownedConfigurations.locator(
    '[data-owned-configuration-slot="aws.ec2.route-table.slot.subnet-associations"]',
  );
  const validationAnnouncement = editor(page).locator(
    ".architecture-validation-live-region",
  );
  await expect(associationSlot).toContainText("2 configured");
  await expect(
    architectureList.locator(
      '[data-architecture-tree-node-id="node_public_route_association_b"]',
    ),
  ).toHaveCount(0);

  const initial = await documentHashes(page);
  const initialSubnetPosition = await flowNodePosition(
    page,
    "node_public_subnet_b",
  );
  const initialSubnetAPosition = await flowNodePosition(
    page,
    "node_public_subnet_a",
  );
  const releasedAssociation = associationSlot
    .getByRole("article")
    .filter({ hasText: "Public subnet A association" });
  await expect(releasedAssociation).toHaveCount(1);
  await observeNextValidationCycle(validationAnnouncement);
  await releasedAssociation
    .getByRole("button", {
      name: "Remove configuration and 1 association",
    })
    .click();
  await expectObservedValidationCycle(validationAnnouncement);
  await expect(editor(page).locator(".architecture-live-region")).toHaveText(
    "Remove Subnet associations applied through one Graph Command batch.",
  );
  await expect(releasedAssociation).toHaveCount(0);
  const afterTargetRelease = await documentHashes(page);
  expect(afterTargetRelease.content).not.toBe(initial.content);

  const retargetedAssociation = associationSlot
    .getByRole("article")
    .filter({ hasText: "Public subnet B association" });
  await retargetedAssociation
    .getByText("Current associations (1)", { exact: true })
    .click();
  await expect(retargetedAssociation).toContainText(
    "Associates subnet · Public subnet B · 10.0.2.0/24",
  );
  await retargetedAssociation
    .getByRole("button", {
      name: "Change Subnet for Public subnet B association",
    })
    .click();
  const chooser = page.getByRole("dialog", {
    name: "Choose services to connect",
  });
  await expect(chooser).toBeVisible();
  const publicSubnetAChoice = chooser
    .locator(".cm-choice")
    .filter({ hasText: "Public subnet A · 10.0.1.0/24" });
  await expect(publicSubnetAChoice).toHaveCount(1);
  await publicSubnetAChoice.getByRole("radio").dispatchEvent("click");

  const retargetWizard = page.getByRole("dialog", {
    name: "Update Subnet route-table association to Subnet connection",
  });
  await expect(
    retargetWizard.getByRole("heading", { name: "What will change" }),
  ).toBeVisible();
  await expect(
    retargetWizard.getByRole("list", { name: "Connection change summary" }),
  ).toContainText("Public subnet A · 10.0.1.0/24");
  const retargetTechnicalDetails = retargetWizard.locator(
    ".connection-wizard__technical",
  );
  await retargetTechnicalDetails.locator(":scope > summary").click();
  const generatedResources = retargetTechnicalDetails.getByRole("list", {
    name: "Generated resources",
  });
  await expect(generatedResources).toContainText(
    "net_pub_b_route_assoc.edge.connection",
  );
  await expect(generatedResources).toContainText(
    "Source node_public_route_association_b",
  );
  await expect(generatedResources).toContainText("target node_public_subnet_a");
  await expect(generatedResources).toContainText(
    "Generator aws.ec2.route-table-association-targets-subnet",
  );
  await expect(generatedResources).toContainText(
    "operation net_pub_b_route_assoc",
  );
  await expect(retargetTechnicalDetails).toContainText("Atomic batch:");
  await observeNextValidationCycle(validationAnnouncement);
  await retargetWizard
    .getByRole("button", { name: "Update connection" })
    .click();
  await expect(retargetWizard).toHaveCount(0);
  await expectObservedValidationCycle(validationAnnouncement);
  await expect(editor(page).locator(".architecture-live-region")).toHaveText(
    "Connection applied through the confirmed atomic Graph Command batch.",
  );
  const retargeted = await documentHashes(page);
  expect(retargeted.content).not.toBe(afterTargetRelease.content);
  expect(retargeted.visual).toBe(afterTargetRelease.visual);

  await chooseCanvasAction(page, "Architecture list");
  await publicRouteTable.focus();
  await publicRouteTable.press("Enter");
  await configure.focus();
  await configure.press("Enter");
  await expect(inspector).toBeVisible();
  if (!(await associationSlot.isVisible())) {
    await ownedConfigurations
      .getByText("Policies and related settings (2)", { exact: true })
      .click();
  }
  if (
    !(await retargetedAssociation
      .getByText("Associates subnet · Public subnet A · 10.0.1.0/24", {
        exact: true,
      })
      .isVisible())
  ) {
    await retargetedAssociation
      .getByText("Current associations (1)", { exact: true })
      .click();
  }
  await expect(retargetedAssociation).toContainText(
    "Associates subnet · Public subnet A · 10.0.1.0/24",
  );
  await expect
    .poll(() => flowNodePosition(page, "node_public_subnet_a"))
    .toEqual(initialSubnetAPosition);
  await expect
    .poll(() => flowNodePosition(page, "node_public_subnet_b"))
    .toEqual(initialSubnetPosition);

  await page.keyboard.press("Control+z");
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    afterTargetRelease.content,
  );
  await page.keyboard.press("Control+y");
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    retargeted.content,
  );
  await page.keyboard.press("Control+z");
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    afterTargetRelease.content,
  );
  await page.keyboard.press("Control+z");
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    initial.content,
  );
  await expect(editor(page)).toHaveAttribute(
    "data-visual-hash",
    initial.visual,
  );

  const existingAssociation = associationSlot
    .getByRole("article")
    .filter({ hasText: "Public subnet B association" });
  await expect(existingAssociation).toHaveCount(1);
  await existingAssociation
    .getByText("Current associations (1)", { exact: true })
    .click();
  await expect(existingAssociation).toContainText(
    "Associates subnet · Public subnet B · 10.0.2.0/24",
  );
  await expect(existingAssociation).toContainText(
    "Generated · reviewed cleanup",
  );
  await existingAssociation
    .getByRole("button", {
      name: "Remove configuration and 1 association",
    })
    .focus();
  await observeNextValidationCycle(validationAnnouncement);
  await existingAssociation
    .getByRole("button", { name: "Remove configuration and 1 association" })
    .click();
  await expectObservedValidationCycle(validationAnnouncement);
  await expect(editor(page).locator(".architecture-live-region")).toHaveText(
    "Remove Subnet associations applied through one Graph Command batch.",
  );
  await expect(existingAssociation).toHaveCount(0);
  await expect(associationSlot).toContainText("1 configured");
  await expect
    .poll(async () => (await documentHashes(page)).content)
    .not.toBe(initial.content);
  const afterExistingRemoval = await documentHashes(page);

  await associationSlot
    .getByText("Add Subnet associations", { exact: true })
    .click();
  await observeNextValidationCycle(validationAnnouncement);
  await associationSlot
    .getByRole("button", { name: "Add subnet associations" })
    .click();
  await expectObservedValidationCycle(validationAnnouncement);
  await expect(editor(page).locator(".architecture-live-region")).toHaveText(
    "Add Subnet associations applied through one Graph Command batch.",
  );
  await expect(associationSlot).toContainText("2 configured");
  const createdAssociation = associationSlot
    .getByRole("heading", {
      exact: true,
      level: 5,
      name: "Subnet associations",
    })
    .locator("xpath=ancestor::article[1]");
  await expect(createdAssociation).toHaveCount(1);
  await expect(createdAssociation).toContainText("Current associations (0)");
  await expect
    .poll(async () => (await documentHashes(page)).content)
    .not.toBe(afterExistingRemoval.content);
  const afterCreate = await documentHashes(page);

  await createdAssociation
    .getByText("Edit configuration", { exact: true })
    .click();
  await createdAssociation
    .getByRole("button", { name: "Save configuration" })
    .click();
  await expect(createdAssociation.getByRole("alert")).toContainText(
    "Review 1 configuration error",
  );
  await expect(createdAssociation.getByRole("alert")).toContainText(
    "The proposed owned configuration does not change semantic graph content.",
  );
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    afterCreate.content,
  );

  await createdAssociation
    .getByRole("button", {
      name: "Choose Subnet for Subnet associations",
    })
    .click();
  const wizard = page.getByRole("dialog", {
    name: "Connect Subnet route-table association to Subnet",
  });
  await expect(wizard).toBeVisible();
  await expect(
    wizard.getByRole("heading", { name: "What will change" }),
  ).toBeVisible();
  await expect(
    wizard.getByRole("list", { name: "Connection change summary" }),
  ).toContainText("Public subnet B · 10.0.2.0/24");
  const technicalDetails = wizard.locator(".connection-wizard__technical");
  await technicalDetails.locator(":scope > summary").click();
  await expect(technicalDetails).toContainText(
    "aws.ec2.route-table-association-targets-subnet",
  );
  await expect(technicalDetails).toContainText("Atomic batch:");
  await observeNextValidationCycle(validationAnnouncement);
  await wizard.getByRole("button", { name: "Connect" }).click();
  await expect(wizard).toHaveCount(0);
  await expectObservedValidationCycle(validationAnnouncement);
  await expect(editor(page).locator(".architecture-live-region")).toHaveText(
    "Connection applied through the confirmed atomic Graph Command batch.",
  );
  await expect
    .poll(async () => (await documentHashes(page)).content)
    .not.toBe(afterCreate.content);
  const connected = await documentHashes(page);

  // Starting from the hidden configuration port selects that graph-backed
  // configuration. Return through the visible architecture list before
  // reviewing its persisted association on the owning route table.
  await chooseCanvasAction(page, "Architecture list");
  await publicRouteTable.focus();
  await publicRouteTable.press("Enter");
  await expect(publicRouteTable).toHaveAttribute("aria-current", "true");
  await configure.focus();
  await configure.press("Enter");
  await expect(inspector).toBeVisible();
  if (!(await associationSlot.isVisible())) {
    await ownedConfigurations
      .getByText("Policies and related settings (3)", { exact: true })
      .click();
  }
  await expect(createdAssociation).toContainText("Current associations (1)");
  await createdAssociation
    .getByText("Current associations (1)", { exact: true })
    .click();
  await expect(createdAssociation).toContainText(
    "Associates subnet · Public subnet B · 10.0.2.0/24",
  );
  await expect(createdAssociation).toContainText(
    "Generated · reviewed cleanup",
  );

  await createdAssociation
    .getByRole("button", {
      name: "Remove configuration and 1 association",
    })
    .focus();
  await observeNextValidationCycle(validationAnnouncement);
  await createdAssociation
    .getByRole("button", { name: "Remove configuration and 1 association" })
    .click();
  await expectObservedValidationCycle(validationAnnouncement);
  await expect(editor(page).locator(".architecture-live-region")).toHaveText(
    "Remove Subnet associations applied through one Graph Command batch.",
  );
  await expect(createdAssociation).toHaveCount(0);
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    afterExistingRemoval.content,
  );
  await expect(editor(page)).toHaveAttribute(
    "data-visual-hash",
    afterExistingRemoval.visual,
  );

  await chooseCanvasAction(page, "Architecture list");
  await expectArchitectureTreeParent(
    architectureList,
    "node_public_subnet_b",
    "node_availability_zone_b",
  );
  await expect
    .poll(() => flowNodePosition(page, "node_public_subnet_b"))
    .toEqual(initialSubnetPosition);
  await expect(
    architectureList.locator(
      '[data-architecture-tree-node-id="node_public_route_association_b"]',
    ),
  ).toHaveCount(0);

  await page.keyboard.press("Control+z");
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    connected.content,
  );
  await page.keyboard.press("Control+y");
  await expect(editor(page)).toHaveAttribute(
    "data-content-hash",
    afterExistingRemoval.content,
  );
  await expectArchitectureTreeParent(
    architectureList,
    "node_public_subnet_b",
    "node_availability_zone_b",
  );
});

test("turns nested network boundaries into readable overview tiles as the canvas zooms out", async ({
  page,
}) => {
  await page.goto(editorPath);
  await waitForEditorReady(page);
  await chooseCanvasAction(page, "Fit architecture");
  const before = await documentHashes(page);
  const subnet = architectureNode(page, "node_public_subnet_a");
  const region = architectureNode(page, "node_network_region");
  await expect(subnet).toBeVisible();
  await expect(subnet).toHaveAttribute("data-condensed-heading", "true");
  await expect
    .poll(async () =>
      subnet
        .locator(".architecture-boundary-heading")
        .evaluate((heading) => heading.scrollHeight - heading.clientHeight),
    )
    .toBeLessThanOrEqual(1);
  await expect(
    editor(page).locator(
      ".architecture-node--boundary .architecture-connection-dock:not(.architecture-connection-dock--aggregate):not(.architecture-connection-anchor)",
    ),
  ).toHaveCount(0);
  for (let index = 0; index < 8; index += 1) {
    await page.getByRole("button", { name: "Zoom out" }).click();
  }
  await expect(region).toBeVisible();
  await expect(
    editor(page).locator('[data-overview-tile="true"][data-boundary-level]'),
  ).not.toHaveCount(0);
  await expect(subnet).toHaveCount(0);
  const overviewTile = region;
  await expect(overviewTile).toHaveAttribute("data-overview-tile", "true");
  const icon = overviewTile.locator(".cm-service-icon");
  await expect(icon).toBeVisible();
  const iconBox = await icon.boundingBox();
  expect(iconBox?.width).toBeGreaterThanOrEqual(24);
  expect(iconBox?.height).toBeGreaterThanOrEqual(24);
  expect(await documentHashes(page)).toEqual(before);
  for (let index = 0; index < 8; index += 1) {
    await page.getByRole("button", { name: "Zoom in" }).click();
  }
  await expect(subnet).toBeVisible();
  expect(await documentHashes(page)).toEqual(before);
});
