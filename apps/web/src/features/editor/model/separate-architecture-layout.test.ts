import { expect, it } from "vitest";
import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadAwsNetworkingVisualArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";

import {
  applyGraphCommand,
  getArchitectureDocumentHashes,
} from "@cloudmarkup/domain";
import { separateArchitectureLayout } from "./separate-architecture-layout.js";
import { prepareArchitectureLayout } from "./architecture-layout.js";
import {
  deriveArchitectureGeometry,
  type EditorSize,
} from "./architecture-geometry.js";
import {
  foundationEditorCatalog as catalog,
  loadFoundationArchitectureDocument,
} from "./foundation-editor-fixture.js";

it("separates newly generated VPC peers from nested AZ frames", () => {
  const original = loadAwsNetworkingVisualArchitectureDocument();
  const generatedIds = new Set([
    "node_public_route_table",
    "node_private_route_table",
    "node_s3_gateway_endpoint",
  ]);
  const colliding = {
    ...original,
    nodes: original.nodes.map((node) =>
      generatedIds.has(node.id)
        ? {
            ...node,
            presentation: {
              ...node.presentation,
              position: { ...node.presentation.position, y: 700 },
            },
          }
        : node,
    ),
  };
  const layout = separateArchitectureLayout(
    colliding,
    awsEditorCatalog,
    new Set(
      colliding.nodes
        .map((node) => node.id)
        .filter((id) => !generatedIds.has(id)),
    ),
    96,
  );
  let sequence = 0;
  const prepared = prepareArchitectureLayout(
    colliding,
    awsEditorCatalog,
    layout,
    () => "operation_generated_spacing_" + String(++sequence),
  );
  if (prepared === null) {
    throw new Error("Expected generated sibling collision repair.");
  }
  const applied = applyGraphCommand(colliding, prepared.command).document;
  expect(getArchitectureDocumentHashes(applied).contentHash).toBe(
    getArchitectureDocumentHashes(colliding).contentHash,
  );
  const sizes: ReadonlyMap<string, EditorSize> = deriveArchitectureGeometry(
    applied,
    awsEditorCatalog,
  ).sizes;
  const vpcPeers = layout.positions.filter(
    (position) => position.parentId === "node_network_vpc",
  );
  for (const [index, left] of vpcPeers.entries()) {
    for (const right of vpcPeers.slice(index + 1)) {
      const leftSize = sizes.get(left.nodeId);
      const rightSize = sizes.get(right.nodeId);
      if (leftSize === undefined || rightSize === undefined) {
        throw new Error("Expected VPC peer sizes.");
      }
      const gap =
        generatedIds.has(left.nodeId) || generatedIds.has(right.nodeId)
          ? 96
          : 48;
      expect(
        left.position.x + leftSize.width + gap <= right.position.x ||
          right.position.x + rightSize.width + gap <= left.position.x ||
          left.position.y + leftSize.height + gap <= right.position.y ||
          right.position.y + rightSize.height + gap <= left.position.y,
        `${left.nodeId} must not overlap ${right.nodeId}`,
      ).toBe(true);
    }
  }
});

it("separates enlarged nested boundaries from siblings with stable semantics and reversible commands", () => {
  const original = loadFoundationArchitectureDocument();
  const document = {
    ...original,
    nodes: original.nodes.map((node) => ({
      ...node,
      presentation: {
        ...node.presentation,
        position:
          node.id === "node_zone"
            ? { x: 32, y: 160 }
            : node.id === "node_application"
              ? { x: 320, y: 480 }
              : { x: 80, y: 80 },
      },
    })),
  };
  const existing = new Set(["node_network"]);
  const result = separateArchitectureLayout(document, catalog, existing);
  expect(
    separateArchitectureLayout(
      { ...document, nodes: [...document.nodes].reverse() },
      catalog,
      existing,
    ),
  ).toEqual(result);
  let sequence = 0;
  const prepared = prepareArchitectureLayout(
    document,
    catalog,
    result,
    () => "operation_spacing_" + String(++sequence),
  );
  expect(prepared).not.toBeNull();
  if (!prepared) throw new Error("Expected collision repair");
  const applied = applyGraphCommand(document, prepared.command);
  expect(getArchitectureDocumentHashes(applied.document).contentHash).toBe(
    getArchitectureDocumentHashes(document).contentHash,
  );
  expect(
    applied.document.nodes.find((node) => node.id === "node_network")
      ?.presentation.position,
  ).toEqual({ x: 80, y: 80 });
  const geometry = deriveArchitectureGeometry(applied.document, catalog);
  expect(geometry.overflows).toEqual([]);
  const sizes: ReadonlyMap<string, EditorSize> = geometry.sizes;
  for (const a of result.positions)
    for (const b of result.positions) {
      if (a.nodeId === b.nodeId || a.parentId !== b.parentId) continue;
      const sa = sizes.get(a.nodeId);
      const sb = sizes.get(b.nodeId);
      if (!sa || !sb) throw new Error("Missing geometry");
      expect(
        a.position.x + sa.width + 48 <= b.position.x ||
          b.position.x + sb.width + 48 <= a.position.x ||
          a.position.y + sa.height + 48 <= b.position.y ||
          b.position.y + sb.height + 48 <= a.position.y,
      ).toBe(true);
    }
  const unchanged = separateArchitectureLayout(
    applied.document,
    catalog,
    new Set(applied.document.nodes.map((node) => node.id)),
  );
  expect(
    prepareArchitectureLayout(
      applied.document,
      catalog,
      unchanged,
      () => "operation_repeat_" + String(++sequence),
    ),
  ).toBeNull();
  if (applied.inversion.kind !== "available")
    throw new Error("Expected safe inverse");
  expect(
    applyGraphCommand(applied.document, applied.inversion.command).document,
  ).toEqual(document);
});
