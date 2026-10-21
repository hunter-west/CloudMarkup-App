/*
 * SVG numeric attributes are serialized only from finite, schema-bounded scene
 * coordinates and dimensions. Template interpolation is the canonical SVG
 * serializer at this boundary.
 */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { openSync, fstatSync, readFileSync, closeSync } from "node:fs";
import { DIAGRAM_SFNT_FONT } from "./sfnt-font.js";

import { Resvg } from "@resvg/resvg-js";

import type { DiagramExportRequestV1 } from "./contracts.js";
import {
  DIAGRAM_SCENE_ICON_SIZE,
  type DiagramSceneEdgeV1,
  type DiagramSceneNodeV1,
  type DiagramSceneV1,
} from "./scene.js";
import { escapeXml } from "./security.js";

const FONT_REGULAR_PATH = fileURLToPath(
  import.meta.resolve("@fontsource/inter/files/inter-latin-400-normal.woff2"),
);
const FONT_SEMIBOLD_PATH = fileURLToPath(
  import.meta.resolve("@fontsource/inter/files/inter-latin-600-normal.woff2"),
);

export const DIAGRAM_FONT = Object.freeze({
  family: "Inter" as const,
  regularDigest:
    "sha256:8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc" as const,
  semiboldDigest:
    "sha256:f9a06e79cd3a2a20951c0f0e28f66dd0e6d3fda73911d640a2125c8fcb78f21a" as const,
  source: "pinned-local-assets" as const,
  version: "5.3.0" as const,
});

interface Point {
  readonly x: number;
  readonly y: number;
}

function palette(background: DiagramExportRequestV1["theme"]["background"]) {
  return {
    background:
      background === "transparent"
        ? null
        : background === "canvas-light"
          ? "#f5f7fb"
          : "#ffffff",
    boundaryFill: "#f8fafc",
    boundaryStroke: "#94a3b8",
    edge: "#475569",
    edgeLabel: "#334155",
    generated: "#7c3aed",
    header: "#0f172a",
    muted: "#64748b",
    nodeFill: "#ffffff",
    nodeStroke: "#cbd5e1",
    text: "#172033",
  } as const;
}

function nodeById(
  scene: DiagramSceneV1,
): ReadonlyMap<string, DiagramSceneNodeV1> {
  return new Map(scene.nodes.map((node) => [node.id, node]));
}

function edgeRoute(
  edge: DiagramSceneEdgeV1,
  nodes: ReadonlyMap<string, DiagramSceneNodeV1>,
  laneOffset: number,
): { readonly label: Point; readonly path: string } {
  const source = nodes.get(edge.sourceNodeId);
  const target = nodes.get(edge.targetNodeId);
  if (source === undefined || target === undefined) {
    throw new TypeError("Diagram edge route references an unknown scene node.");
  }
  const sourcePoint = {
    x: source.x + source.width,
    y: source.y + source.height / 2,
  };
  const targetPoint = { x: target.x, y: target.y + target.height / 2 };
  const midpoint = Math.round((sourcePoint.x + targetPoint.x) / 2) + laneOffset;
  return {
    label: {
      x: midpoint,
      y: Math.round((sourcePoint.y + targetPoint.y) / 2) - 6,
    },
    path: `M ${sourcePoint.x} ${sourcePoint.y} L ${midpoint} ${sourcePoint.y} L ${midpoint} ${targetPoint.y} L ${targetPoint.x} ${targetPoint.y}`,
  };
}

function parallelEdgeLanes(
  edges: readonly DiagramSceneEdgeV1[],
): ReadonlyMap<string, number> {
  const groups = new Map<string, DiagramSceneEdgeV1[]>();
  for (const edge of edges) {
    const key = `${edge.sourceNodeId}\u0000${edge.targetNodeId}`;
    const group = groups.get(key) ?? [];
    group.push(edge);
    groups.set(key, group);
  }
  const lanes = new Map<string, number>();
  for (const group of groups.values()) {
    group.forEach((edge, index) => {
      lanes.set(edge.id, (index * 2 - (group.length - 1)) * 12);
    });
  }
  return lanes;
}
function iconMarkup(node: DiagramSceneNodeV1): string {
  const x = node.x + 18;
  const y = node.y + 20;
  if (node.icon === null) {
    return [
      `<g aria-hidden="true" transform="translate(${x} ${y})">`,
      `<rect width="${DIAGRAM_SCENE_ICON_SIZE}" height="${DIAGRAM_SCENE_ICON_SIZE}" rx="10" fill="#e2e8f0"/>`,
      '<path d="M14 15h20v18H14z M18 11h12v4H18z" fill="#64748b"/>',
      "</g>",
    ].join("");
  }
  return `<svg aria-hidden="true" x="${x}" y="${y}" width="${DIAGRAM_SCENE_ICON_SIZE}" height="${DIAGRAM_SCENE_ICON_SIZE}" viewBox="${escapeXml(node.icon.viewBox)}">${node.icon.innerMarkup}</svg>`;
}

function nodeMarkup(
  node: DiagramSceneNodeV1,
  colors: ReturnType<typeof palette>,
): string {
  const boundary = node.kind === "boundary";
  const fill = boundary ? colors.boundaryFill : colors.nodeFill;
  const stroke = boundary ? colors.boundaryStroke : colors.nodeStroke;
  const titleX = node.x + 82;
  const titleY = node.y + 34;
  const lines: string[] = [
    `<g id="${node.id}" role="group" aria-label="${escapeXml(node.label)}">`,
    `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${boundary ? 18 : 14}" fill="${fill}" stroke="${stroke}" stroke-width="${boundary ? 2 : 1.5}"${boundary ? ' stroke-dasharray="8 6"' : ""}/>`,
    iconMarkup(node),
    `<text x="${titleX}" y="${titleY}" fill="${colors.text}" font-size="16" font-weight="600">${escapeXml(node.label)}</text>`,
    `<text x="${titleX}" y="${titleY + 22}" fill="${colors.muted}" font-size="12">${escapeXml(node.serviceLabel)}</text>`,
  ];
  let detailY = node.y + 82;
  if (node.generated) {
    lines.push(
      `<rect x="${node.x + node.width - 92}" y="${node.y + 14}" width="76" height="22" rx="11" fill="#f3e8ff"/>`,
      `<text x="${node.x + node.width - 54}" y="${node.y + 29}" text-anchor="middle" fill="${colors.generated}" font-size="10" font-weight="600">GENERATED</text>`,
    );
  }
  if (node.deploymentIdentifier !== undefined) {
    lines.push(
      `<text x="${node.x + 18}" y="${detailY}" fill="${colors.muted}" font-family="Inter, sans-serif" font-size="11">Deployment: ${escapeXml(node.deploymentIdentifier)}</text>`,
    );
    detailY += 18;
  }
  for (const summary of node.configuration) {
    lines.push(
      `<text x="${node.x + 18}" y="${detailY}" fill="${colors.text}" font-size="11">${escapeXml(summary)}</text>`,
    );
    detailY += 18;
  }
  lines.push("</g>");
  return lines.join("\n");
}

function edgeMarkup(
  edge: DiagramSceneEdgeV1,
  route: ReturnType<typeof edgeRoute>,
  colors: ReturnType<typeof palette>,
): string {
  const labelWidth = Math.max(78, Math.min(260, edge.label.length * 7 + 20));
  return [
    `<g id="${edge.id}" role="group" aria-label="${escapeXml(edge.label)}">`,
    `<path d="${route.path}" fill="none" stroke="${colors.edge}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#edge-arrow)"/>`,
    `<rect x="${route.label.x - labelWidth / 2}" y="${route.label.y - 14}" width="${labelWidth}" height="22" rx="11" fill="#ffffff" stroke="#e2e8f0"/>`,
    `<text x="${route.label.x}" y="${route.label.y + 1}" text-anchor="middle" fill="${colors.edgeLabel}" font-size="10">${escapeXml(edge.label)}</text>`,
    "</g>",
  ].join("\n");
}

function legendMarkup(
  scene: DiagramSceneV1,
  colors: ReturnType<typeof palette>,
): string {
  const y =
    Math.max(...scene.nodes.map((node) => node.y + node.height), 220) + 34;
  const technical = scene.metadata.profile === "technical";
  return [
    `<g role="group" aria-label="Diagram legend" transform="translate(48 ${y})">`,
    `<text x="0" y="0" fill="${colors.text}" font-size="12" font-weight="600">Legend</text>`,
    `<rect x="0" y="14" width="20" height="14" rx="4" fill="#ffffff" stroke="${colors.nodeStroke}"/>`,
    `<text x="28" y="25" fill="${colors.muted}" font-size="10">Resource</text>`,
    `<rect x="100" y="14" width="20" height="14" rx="4" fill="${colors.boundaryFill}" stroke="${colors.boundaryStroke}" stroke-dasharray="4 3"/>`,
    `<text x="128" y="25" fill="${colors.muted}" font-size="10">Boundary</text>`,
    `<line x1="208" y1="21" x2="234" y2="21" stroke="${colors.edge}" stroke-width="2" marker-end="url(#edge-arrow)"/>`,
    `<text x="244" y="25" fill="${colors.muted}" font-size="10">Directed semantic relationship</text>`,
    ...(technical
      ? [
          `<rect x="468" y="14" width="54" height="14" rx="7" fill="#f3e8ff"/>`,
          `<text x="495" y="24" text-anchor="middle" fill="${colors.generated}" font-size="8" font-weight="600">GENERATED</text>`,
        ]
      : []),
    "</g>",
  ].join("\n");
}

export function renderDiagramSvg(
  scene: DiagramSceneV1,
  request: DiagramExportRequestV1,
): string {
  const colors = palette(request.theme.background);
  const nodes = nodeById(scene);
  const background =
    colors.background === null
      ? ""
      : `<rect width="100%" height="100%" fill="${colors.background}"/>`;
  const title = `${scene.metadata.projectTitle} — ${scene.metadata.architectureTitle}`;
  const description = `${scene.metadata.profile === "technical" ? "Technical" : "Presentation"} architecture diagram for ${scene.metadata.provider} in ${scene.metadata.region}. ${String(scene.nodes.length)} resources and ${String(scene.edges.length)} directed semantic relationships. Generated from an immutable Solution Revision.`;
  const laneOffsets = parallelEdgeLanes(scene.edges);
  const edgeMarkupLines = scene.edges.map((edge) =>
    edgeMarkup(
      edge,
      edgeRoute(edge, nodes, laneOffsets.get(edge.id) ?? 0),
      colors,
    ),
  );
  const nodeMarkupLines = [
    ...scene.nodes.filter((node) => node.kind === "boundary"),
    ...scene.nodes.filter((node) => node.kind === "resource"),
  ].map((node) => nodeMarkup(node, colors));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.dimensions.width}" height="${scene.dimensions.height}" viewBox="0 0 ${scene.dimensions.viewBoxWidth} ${scene.dimensions.viewBoxHeight}" role="img" aria-labelledby="diagram-title diagram-description">`,
    `<title id="diagram-title">${escapeXml(title)}</title>`,
    `<desc id="diagram-description">${escapeXml(description)}</desc>`,
    "<defs>",
    `<marker id="edge-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L8 4 L0 8 Z" fill="${colors.edge}"/></marker>`,
    "</defs>",
    background,
    `<g font-family="Inter, sans-serif" text-rendering="geometricPrecision" shape-rendering="geometricPrecision">`,
    `<text x="48" y="42" fill="${colors.header}" font-size="24" font-weight="600">${escapeXml(title)}</text>`,
    `<text x="48" y="68" fill="${colors.muted}" font-size="12">${escapeXml(`${scene.metadata.provider} · ${scene.metadata.region} · ${scene.metadata.profile} profile`)}</text>`,
    ...(scene.metadata.profile === "technical"
      ? [
          `<text x="48" y="88" fill="${colors.muted}" font-size="11">Readiness: ${escapeXml(scene.metadata.coverageState)}</text>`,
        ]
      : []),
    ...edgeMarkupLines,
    ...nodeMarkupLines,
    legendMarkup(scene, colors),
    "</g>",
    "</svg>",
    "",
  ].join("\n");
}

export interface DiagramPngRasterizer {
  rasterize(input: {
    readonly height: number;
    readonly svg: string;
    readonly width: number;
  }): Uint8Array;
}

export function createResvgDiagramRasterizer(): DiagramPngRasterizer {
  return createResvgRasterizer([FONT_REGULAR_PATH, FONT_SEMIBOLD_PATH]);
}

/** Only fixed, digest-verified derived Inter fonts are admitted for 1.1.0.
 * Production supplies immutable read-only layer paths, never document input. */
export function createSfntResvgDiagramRasterizer(
  fontFiles: readonly [string, string],
): DiagramPngRasterizer {
  const pins = [
    DIAGRAM_SFNT_FONT.regularDigest,
    DIAGRAM_SFNT_FONT.semiboldDigest,
  ];
  for (const [index, path] of fontFiles.entries()) {
    const file = openSync(path, "r");
    try {
      const metadata = fstatSync(file);
      if (
        !metadata.isFile() ||
        metadata.size < 12 ||
        metadata.size > 2 * 1024 * 1024
      )
        throw new TypeError("The pinned diagram font is unavailable.");
      const bytes = readFileSync(file);
      if (
        bytes.length !== metadata.size ||
        "sha256:" + createHash("sha256").update(bytes).digest("hex") !==
          pins[index]
      )
        throw new TypeError(
          "The diagram font does not match its fixed SFNT pin.",
        );
    } finally {
      closeSync(file);
    }
  }
  return createResvgRasterizer([...fontFiles]);
}

function createResvgRasterizer(
  fontFiles: readonly [string, string],
): DiagramPngRasterizer {
  return Object.freeze({
    rasterize(input: {
      readonly height: number;
      readonly svg: string;
      readonly width: number;
    }): Uint8Array {
      const renderer = new Resvg(input.svg, {
        fitTo: { mode: "width", value: input.width },
        font: {
          defaultFontFamily: "Inter",
          fontFiles: [...fontFiles],
          loadSystemFonts: false,
          sansSerifFamily: "Inter",
        },
        imageRendering: 0,
        shapeRendering: 2,
        textRendering: 2,
      });
      const rendered = renderer.render();
      if (rendered.width !== input.width || rendered.height !== input.height) {
        throw new TypeError(
          "PNG rasterizer dimensions do not match the approved diagram dimensions.",
        );
      }
      return new Uint8Array(rendered.asPng());
    },
  });
}
