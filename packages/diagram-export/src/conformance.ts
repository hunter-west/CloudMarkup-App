import { hashCanonicalValue } from "@cloudmarkup/domain";
import {
  conformanceDifferenceKindV1Schema,
  conformanceEvidenceCompletenessV1Schema,
  conformanceEvidenceFreshnessV1Schema,
  conformanceLayerAvailabilityV1Schema,
  conformanceViewLayerV1Schema,
  serializeCanonicalJson,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import {
  compareUtf16,
  digestBytes,
  escapeXml,
  sanitizeDiagramText,
  utf8Size,
} from "./security.js";

export const CONFORMANCE_DIAGRAM_CONTRACT_VERSION = 1 as const;
export const CONFORMANCE_DIAGRAM_RENDERER_ID =
  "cloudmarkup.conformance-diagram-renderer" as const;
export const CONFORMANCE_DIAGRAM_RENDERER_VERSION = "1.0.0" as const;

export const CONFORMANCE_DIAGRAM_STATES = conformanceViewLayerV1Schema.options;
export const CONFORMANCE_DIAGRAM_DIFFERENCE_KINDS =
  conformanceDifferenceKindV1Schema.options;

const stableIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const stableTextSchema = z.string().trim().min(1).max(512);
const coordinateSchema = z.number().min(-1_000_000).max(1_000_000);
const timestampSchema = z.iso.datetime({ offset: true });

export const conformanceDiagramStateV1Schema = conformanceViewLayerV1Schema;
export const conformanceDiagramDifferenceKindV1Schema =
  conformanceDifferenceKindV1Schema;

export const conformanceDiagramQualityV1Schema = z
  .object({
    availability: conformanceLayerAvailabilityV1Schema,
    completeness: conformanceEvidenceCompletenessV1Schema,
    expiresAt: timestampSchema.optional(),
    freshness: conformanceEvidenceFreshnessV1Schema,
    lastVerifiedAt: timestampSchema.optional(),
    reason: stableTextSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.availability === "unavailable") {
      if (
        value.completeness !== "unknown" ||
        value.lastVerifiedAt !== undefined
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Unavailable conformance evidence must remain unknown and unverified.",
          path: ["availability"],
        });
      }
      if (value.reason === undefined) {
        context.addIssue({
          code: "custom",
          message: "Unavailable evidence requires a safe reason.",
          path: ["reason"],
        });
      }
      return;
    }
    if (value.freshness === "current" && value.lastVerifiedAt === undefined) {
      context.addIssue({
        code: "custom",
        message: "Current conformance evidence requires last-verified time.",
        path: ["lastVerifiedAt"],
      });
    }
    if (
      (value.completeness !== "complete" || value.freshness !== "current") &&
      value.reason === undefined
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Partial, stale, expired, invalid, or unknown evidence requires a safe reason.",
        path: ["reason"],
      });
    }
  });

const evidenceIdsSchema = z.array(stableIdSchema).max(256);
const differenceIdsSchema = z.array(stableIdSchema).max(256);
const conformancePresenceSchema = z.enum([
  "present",
  "comparison-only-missing",
  "unknown",
]);
const conformanceStatusSchema = z.enum([
  "matching",
  "different",
  "external",
  "unmanaged",
  "unknown",
]);

export const conformanceDiagramNodeV1Schema = z
  .object({
    differenceIds: differenceIdsSchema,
    evidenceIds: evidenceIdsSchema,
    id: stableIdSchema,
    label: stableTextSchema,
    mapping: z.literal("mapped"),
    position: z.object({ x: coordinateSchema, y: coordinateSchema }).strict(),
    presence: conformancePresenceSchema,
    serviceLabel: stableTextSchema,
    status: conformanceStatusSchema,
  })
  .strict();

export const conformanceDiagramEdgeV1Schema = z
  .object({
    differenceIds: differenceIdsSchema,
    evidenceIds: evidenceIdsSchema,
    id: stableIdSchema,
    label: stableTextSchema,
    mapping: z.literal("mapped"),
    presence: conformancePresenceSchema,
    sourceNodeId: stableIdSchema,
    status: conformanceStatusSchema,
    targetNodeId: stableIdSchema,
  })
  .strict();

export const conformanceDiagramUnmappedEvidenceV1Schema = z
  .object({
    evidenceIds: evidenceIdsSchema,
    id: stableIdSchema,
    kind: z.enum(["resource", "connection", "configuration"]),
    label: stableTextSchema,
    reason: stableTextSchema,
  })
  .strict();

export const conformanceDiagramEvidenceV1Schema = z
  .object({
    evidenceIds: evidenceIdsSchema,
    provenanceId: stableIdSchema,
    sourceDigest: sha256DigestSchema,
    sourceLabel: stableTextSchema,
    verifiedAt: timestampSchema.optional(),
  })
  .strict();

export const conformanceDiagramDifferenceV1Schema = z
  .object({
    differenceId: stableIdSchema,
    evidenceIds: evidenceIdsSchema,
    kind: conformanceDiagramDifferenceKindV1Schema,
    severity: z.enum(["information", "warning", "error", "security-error"]),
    summary: stableTextSchema,
    target: z
      .discriminatedUnion("kind", [
        z.object({ id: stableIdSchema, kind: z.literal("node") }).strict(),
        z.object({ id: stableIdSchema, kind: z.literal("edge") }).strict(),
        z.object({ id: stableIdSchema, kind: z.literal("unmapped") }).strict(),
      ])
      .optional(),
  })
  .strict();

export const conformanceDiagramRequestV1Schema = z
  .object({
    contractVersion: z.literal(CONFORMANCE_DIAGRAM_CONTRACT_VERSION),
    differences: z.array(conformanceDiagramDifferenceV1Schema).max(2_000),
    edges: z.array(conformanceDiagramEdgeV1Schema).max(4_000),
    environmentId: stableIdSchema,
    environmentLabel: stableTextSchema,
    nodes: z.array(conformanceDiagramNodeV1Schema).max(1_000),
    provenance: z.array(conformanceDiagramEvidenceV1Schema).max(2_000),
    quality: conformanceDiagramQualityV1Schema,
    reportDigest: sha256DigestSchema,
    reportId: stableIdSchema,
    showDifferences: z.boolean(),
    solutionRevisionId: stableIdSchema,

    state: conformanceDiagramStateV1Schema,
    title: stableTextSchema,
    unmappedEvidence: z
      .array(conformanceDiagramUnmappedEvidenceV1Schema)
      .max(2_000),
  })
  .strict()
  .superRefine((value, context) => {
    const nodeIds = new Set<string>();
    value.nodes.forEach((node, index) => {
      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate mapped node ${node.id}.`,
          path: ["nodes", index, "id"],
        });
      }
      nodeIds.add(node.id);
    });

    const edgeIds = new Set<string>();
    value.edges.forEach((edge, index) => {
      if (edgeIds.has(edge.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate mapped edge ${edge.id}.`,
          path: ["edges", index, "id"],
        });
      }
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
        context.addIssue({
          code: "custom",
          message: "Mapped conformance edges must reference mapped nodes.",
          path: ["edges", index],
        });
      }
    });

    const evidenceIds = new Set<string>();
    const provenanceIds = new Set<string>();
    value.provenance.forEach((evidence, index) => {
      if (provenanceIds.has(evidence.provenanceId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate provenance identity ${evidence.provenanceId}.`,
          path: ["provenance", index, "provenanceId"],
        });
      }
      provenanceIds.add(evidence.provenanceId);
      evidence.evidenceIds.forEach((evidenceId) => evidenceIds.add(evidenceId));
    });
    const referencedEvidence = [
      ...value.nodes.flatMap((node) => node.evidenceIds),
      ...value.edges.flatMap((edge) => edge.evidenceIds),
      ...value.unmappedEvidence.flatMap((item) => item.evidenceIds),
      ...value.differences.flatMap((difference) => difference.evidenceIds),
    ];
    referencedEvidence.forEach((evidenceId) => {
      if (!evidenceIds.has(evidenceId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown Evidence identity ${evidenceId}.`,
          path: ["provenance"],
        });
      }
    });

    const unmappedIds = new Set(value.unmappedEvidence.map(({ id }) => id));
    const differenceIds = new Set<string>();
    value.differences.forEach((difference, index) => {
      if (differenceIds.has(difference.differenceId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate difference ${difference.differenceId}.`,
          path: ["differences", index, "differenceId"],
        });
      }
      differenceIds.add(difference.differenceId);
      const target = difference.target;
      const targetExists =
        target === undefined ||
        (target.kind === "node" && nodeIds.has(target.id)) ||
        (target.kind === "edge" && edgeIds.has(target.id)) ||
        (target.kind === "unmapped" && unmappedIds.has(target.id));
      if (!targetExists) {
        context.addIssue({
          code: "custom",
          message:
            "A difference target must resolve within this safe projection.",
          path: ["differences", index, "target"],
        });
      }
    });

    for (const [collection, records] of [
      ["nodes", value.nodes],
      ["edges", value.edges],
    ] as const) {
      records.forEach((record, index) => {
        record.differenceIds.forEach((differenceId) => {
          if (!differenceIds.has(differenceId)) {
            context.addIssue({
              code: "custom",
              message: `Unknown difference identity ${differenceId}.`,
              path: [collection, index, "differenceIds"],
            });
          }
        });
      });
    }
  });

const conformanceDiagramFileV1Schema = z
  .object({
    checksum: sha256DigestSchema,
    mediaType: z.literal("image/svg+xml"),
    path: z
      .string()
      .regex(
        /^diagram\/conformance\/(?:designed|imported|generated|planned|deployed|current-drift)(?:-differences)?\.svg$/u,
      ),
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(8 * 1024 * 1024),
  })
  .strict();

export const conformanceDiagramArtifactV1Schema = z
  .object({
    artifactDigest: sha256DigestSchema,
    contractVersion: z.literal(CONFORMANCE_DIAGRAM_CONTRACT_VERSION),
    counts: z
      .object({
        differences: z.number().int().nonnegative().max(2_000),
        edges: z.number().int().nonnegative().max(4_000),
        nodes: z.number().int().nonnegative().max(1_000),
        provenance: z.number().int().nonnegative().max(2_000),
        unmappedEvidence: z.number().int().nonnegative().max(2_000),
      })
      .strict(),
    environmentId: stableIdSchema,
    file: conformanceDiagramFileV1Schema,
    kind: z.literal("cloudmarkup.conformance-diagram-artifact"),
    provenanceDigest: sha256DigestSchema,
    quality: conformanceDiagramQualityV1Schema,
    reportDigest: sha256DigestSchema,
    reportId: stableIdSchema,
    renderer: z
      .object({
        digest: sha256DigestSchema,
        id: z.literal(CONFORMANCE_DIAGRAM_RENDERER_ID),
        version: z.literal(CONFORMANCE_DIAGRAM_RENDERER_VERSION),
      })
      .strict(),
    requestDigest: sha256DigestSchema,
    showDifferences: z.boolean(),
    solutionRevisionId: stableIdSchema,
    provenance: z.array(conformanceDiagramEvidenceV1Schema).max(2_000),
    state: conformanceDiagramStateV1Schema,
    svgDigest: sha256DigestSchema,
  })
  .strict();

export const conformanceDiagramResultV1Schema = z
  .object({
    artifact: conformanceDiagramArtifactV1Schema,
    svg: z
      .string()
      .min(1)
      .max(8 * 1024 * 1024),
  })
  .strict();

export type ConformanceDiagramStateV1 = z.output<
  typeof conformanceDiagramStateV1Schema
>;
export type ConformanceDiagramDifferenceKindV1 = z.output<
  typeof conformanceDiagramDifferenceKindV1Schema
>;
export type ConformanceDiagramRequestV1 = z.output<
  typeof conformanceDiagramRequestV1Schema
>;
export type ConformanceDiagramArtifactV1 = z.output<
  typeof conformanceDiagramArtifactV1Schema
>;
export type ConformanceDiagramResultV1 = z.output<
  typeof conformanceDiagramResultV1Schema
>;

const rendererCommitment = Object.freeze({
  id: CONFORMANCE_DIAGRAM_RENDERER_ID,
  layout: "approved-position-projection-v1",
  policy: "mapped-evidence-only-v1",
  version: CONFORMANCE_DIAGRAM_RENDERER_VERSION,
});

export const conformanceDiagramRendererV1Pin = Object.freeze({
  digest: hashCanonicalValue(rendererCommitment),
  id: CONFORMANCE_DIAGRAM_RENDERER_ID,
  version: CONFORMANCE_DIAGRAM_RENDERER_VERSION,
});

const WIDTH = 1_280;
const MINIMUM_HEIGHT = 720;
const GRAPH_LEFT = 56;
const GRAPH_RIGHT = 900;
const GRAPH_TOP = 152;
const NODE_WIDTH = 176;
const NODE_HEIGHT = 68;

function sorted<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => compareUtf16(key(left), key(right)));
}

function normalizeRequest(
  request: ConformanceDiagramRequestV1,
): ConformanceDiagramRequestV1 {
  return {
    ...request,
    differences: sorted(request.differences, (item) => item.differenceId),
    edges: sorted(request.edges, (item) => item.id),
    nodes: sorted(request.nodes, (item) => item.id),
    provenance: sorted(request.provenance, (item) => item.provenanceId),
    unmappedEvidence: sorted(request.unmappedEvidence, (item) => item.id),
  };
}

function safeText(value: string, maximumLength = 120): string {
  return sanitizeDiagramText(value, maximumLength).value;
}

function stateLabel(state: ConformanceDiagramStateV1): string {
  return state === "current-drift"
    ? "Current drift"
    : `${state.slice(0, 1).toUpperCase()}${state.slice(1)}`;
}

function project(
  value: number,
  minimum: number,
  maximum: number,
  start: number,
  end: number,
): number {
  if (minimum === maximum) return (start + end) / 2;
  return start + ((value - minimum) / (maximum - minimum)) * (end - start);
}

function statusStyle(status: z.output<typeof conformanceStatusSchema>): {
  readonly dash: string;
  readonly stroke: string;
  readonly token: string;
} {
  switch (status) {
    case "matching":
      return { dash: "", stroke: "#1f7a4d", token: "MATCH" };
    case "different":
      return { dash: "8 5", stroke: "#b42318", token: "DIFF" };
    case "external":
      return { dash: "3 4", stroke: "#475467", token: "EXT" };
    case "unmanaged":
      return { dash: "2 3", stroke: "#6941c6", token: "UNMANAGED" };
    case "unknown":
      return { dash: "1 5", stroke: "#b54708", token: "UNKNOWN" };
  }
}

function renderSvg(request: ConformanceDiagramRequestV1): string {
  const nodes = request.nodes;
  const edges = request.edges;
  const differences = request.showDifferences ? request.differences : [];
  const renderedRowCount =
    Math.min(differences.length, 40) +
    Math.min(request.unmappedEvidence.length, 20) +
    Math.min(request.provenance.length, 20);
  const height = Math.max(MINIMUM_HEIGHT, 360 + renderedRowCount * 18);
  const xValues = nodes.map(({ position }) => position.x);
  const yValues = nodes.map(({ position }) => position.y);
  const minimumX = xValues.length === 0 ? 0 : Math.min(...xValues);
  const maximumX = xValues.length === 0 ? 0 : Math.max(...xValues);
  const minimumY = yValues.length === 0 ? 0 : Math.min(...yValues);
  const maximumY = yValues.length === 0 ? 0 : Math.max(...yValues);
  const graphBottom = Math.max(440, height - 190);
  const positions = new Map(
    nodes.map((node) => [
      node.id,
      {
        x: project(
          node.position.x,
          minimumX,
          maximumX,
          GRAPH_LEFT + NODE_WIDTH / 2,
          GRAPH_RIGHT - NODE_WIDTH / 2,
        ),
        y: project(
          node.position.y,
          minimumY,
          maximumY,
          GRAPH_TOP + NODE_HEIGHT / 2,
          graphBottom - NODE_HEIGHT / 2,
        ),
      },
    ]),
  );
  const state = stateLabel(request.state);
  const title = safeText(request.title);
  const environment = safeText(request.environmentLabel);
  const qualityReason =
    request.quality.reason === undefined
      ? ""
      : safeText(request.quality.reason, 180);
  const expiresAt = request.quality.expiresAt ?? "not declared";
  const lastVerified = request.quality.lastVerifiedAt ?? "not established";
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(WIDTH)}" height="${String(height)}" viewBox="0 0 ${String(WIDTH)} ${String(height)}" role="img" aria-labelledby="conformance-title conformance-description">`,
    `<title id="conformance-title">${escapeXml(title)} · ${escapeXml(state)}</title>`,
    `<desc id="conformance-description">${escapeXml(state)} evidence for one exact Solution Revision. Only safely mapped evidence is drawn as graph inventory; partial and unmapped evidence remains explicit.</desc>`,
    '<rect width="100%" height="100%" fill="#f8fafc"/>',
    `<text x="48" y="42" fill="#101828" font-family="Inter, sans-serif" font-size="24" font-weight="600">${escapeXml(title)}</text>`,
    `<text x="48" y="70" fill="#344054" font-family="Inter, sans-serif" font-size="14">${escapeXml(state)} · ${escapeXml(environment)} · revision ${escapeXml(request.solutionRevisionId)} · environment ${escapeXml(request.environmentId)}</text>`,
    `<text x="48" y="94" fill="#475467" font-family="Inter, sans-serif" font-size="12">Evidence: ${escapeXml(request.quality.completeness)} / ${escapeXml(request.quality.freshness)} · last verified ${escapeXml(lastVerified)} · expires ${escapeXml(expiresAt)}</text>`,
    ...(qualityReason === ""
      ? []
      : [
          `<text x="48" y="116" fill="#b54708" font-family="Inter, sans-serif" font-size="12">${escapeXml(qualityReason)}</text>`,
        ]),
    '<defs><marker id="conformance-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="#667085"/></marker></defs>',
    '<g aria-label="Mapped connections">',
  ];

  for (const edge of edges) {
    const source = positions.get(edge.sourceNodeId);
    const target = positions.get(edge.targetNodeId);
    if (source === undefined || target === undefined) continue;
    const style = statusStyle(edge.status);
    const stroke = request.showDifferences ? style.stroke : "#667085";
    const dash =
      edge.presence === "comparison-only-missing"
        ? "8 6"
        : edge.presence === "unknown"
          ? "2 5"
          : request.showDifferences
            ? style.dash
            : "";
    const label = safeText(edge.label, 72);
    parts.push(
      `<g id="conformance-edge-${escapeXml(edge.id)}" role="group" aria-label="${escapeXml(`${label}, ${edge.presence}, ${style.token}`)}">`,
      `<line x1="${String(source.x)}" y1="${String(source.y)}" x2="${String(target.x)}" y2="${String(target.y)}" stroke="${stroke}" stroke-width="2.5"${dash === "" ? "" : ` stroke-dasharray="${dash}"`} marker-end="url(#conformance-arrow)"/>`,
      `<text x="${String((source.x + target.x) / 2)}" y="${String((source.y + target.y) / 2 - 6)}" text-anchor="middle" fill="#344054" font-family="Inter, sans-serif" font-size="11">${escapeXml(label)}</text>`,
      "</g>",
    );
  }
  parts.push("</g>", '<g aria-label="Safely mapped resources">');

  for (const node of nodes) {
    const position = positions.get(node.id);
    if (position === undefined) continue;
    const style = statusStyle(node.status);
    const stroke = request.showDifferences ? style.stroke : "#475467";
    const dash =
      node.presence === "comparison-only-missing"
        ? "9 6"
        : node.presence === "unknown"
          ? "2 5"
          : request.showDifferences
            ? style.dash
            : "";
    const label = safeText(node.label, 44);
    const service = safeText(node.serviceLabel, 54);
    parts.push(
      `<g id="conformance-node-${escapeXml(node.id)}" role="group" aria-label="${escapeXml(`${label}, ${node.presence}, ${style.token}`)}">`,
      `<rect x="${String(position.x - NODE_WIDTH / 2)}" y="${String(position.y - NODE_HEIGHT / 2)}" width="${String(NODE_WIDTH)}" height="${String(NODE_HEIGHT)}" rx="10" fill="#ffffff" stroke="${stroke}" stroke-width="3"${dash === "" ? "" : ` stroke-dasharray="${dash}"`}/>`,
      `<text x="${String(position.x - NODE_WIDTH / 2 + 12)}" y="${String(position.y - 5)}" fill="#101828" font-family="Inter, sans-serif" font-size="14" font-weight="600">${escapeXml(label)}</text>`,
      `<text x="${String(position.x - NODE_WIDTH / 2 + 12)}" y="${String(position.y + 17)}" fill="#475467" font-family="Inter, sans-serif" font-size="11">${escapeXml(service)}</text>`,
      `<text x="${String(position.x + NODE_WIDTH / 2 - 10)}" y="${String(position.y - NODE_HEIGHT / 2 + 15)}" text-anchor="end" fill="${stroke}" font-family="Inter, sans-serif" font-size="9" font-weight="600">${escapeXml(style.token)}</text>`,
      "</g>",
    );
  }
  parts.push("</g>");

  const panelX = 930;
  parts.push(
    `<rect x="${String(panelX)}" y="132" width="314" height="${String(height - 166)}" rx="10" fill="#ffffff" stroke="#d0d5dd"/>`,
    `<text x="${String(panelX + 18)}" y="160" fill="#101828" font-family="Inter, sans-serif" font-size="15" font-weight="600">Legend and provenance</text>`,
    `<text x="${String(panelX + 18)}" y="184" fill="#344054" font-family="Inter, sans-serif" font-size="11">Solid = evidenced · dashed = comparison-only</text>`,
    `<text x="${String(panelX + 18)}" y="203" fill="#344054" font-family="Inter, sans-serif" font-size="11">Dotted = unknown · labels supplement color</text>`,
  );
  let panelY = 230;
  if (request.showDifferences) {
    parts.push(
      `<text x="${String(panelX + 18)}" y="${String(panelY)}" fill="#101828" font-family="Inter, sans-serif" font-size="12" font-weight="600">Differences (${String(differences.length)})</text>`,
    );
    panelY += 20;
    for (const difference of differences.slice(0, 40)) {
      const summary = safeText(difference.summary, 46);
      parts.push(
        `<text x="${String(panelX + 18)}" y="${String(panelY)}" fill="#475467" font-family="Inter, sans-serif" font-size="10">${escapeXml(`${difference.kind}: ${summary}`)}</text>`,
      );
      panelY += 17;
    }
  }
  panelY += 10;
  parts.push(
    `<text x="${String(panelX + 18)}" y="${String(panelY)}" fill="#101828" font-family="Inter, sans-serif" font-size="12" font-weight="600">Unmapped evidence (${String(request.unmappedEvidence.length)})</text>`,
  );
  panelY += 20;
  for (const item of request.unmappedEvidence.slice(0, 20)) {
    const label = safeText(item.label, 42);
    parts.push(
      `<text x="${String(panelX + 18)}" y="${String(panelY)}" fill="#475467" font-family="Inter, sans-serif" font-size="10">${escapeXml(`${item.kind}: ${label}`)}</text>`,
    );
    panelY += 17;
  }
  panelY += 10;
  parts.push(
    `<text x="${String(panelX + 18)}" y="${String(panelY)}" fill="#101828" font-family="Inter, sans-serif" font-size="12" font-weight="600">Evidence (${String(request.provenance.length)})</text>`,
  );
  panelY += 20;
  for (const evidence of request.provenance.slice(0, 20)) {
    const label = safeText(evidence.sourceLabel, 40);
    parts.push(
      `<text x="${String(panelX + 18)}" y="${String(panelY)}" fill="#475467" font-family="Inter, sans-serif" font-size="10">${escapeXml(`${evidence.provenanceId}: ${label}`)}</text>`,
    );
    panelY += 17;
  }
  parts.push(
    `<text x="48" y="${String(height - 36)}" fill="#475467" font-family="Inter, sans-serif" font-size="11">This diagram is read-only evidence. It is not complete inventory unless completeness is explicitly complete, and it never remediates drift.</text>`,
    "</svg>",
  );
  const svg = `${parts.join("\n")}\n`;
  const audited = svg.replace('xmlns="http://www.w3.org/2000/svg"', "");
  if (
    /<(?:script|foreignObject)\b|\b(?:href|xlink:href|on[A-Za-z]+)\s*=|https?:\/\/|file:\/\//iu.test(
      audited,
    )
  ) {
    throw new TypeError(
      "Conformance SVG contains forbidden active or external content.",
    );
  }
  return svg;
}

function artifactContent(
  artifact: ConformanceDiagramArtifactV1,
): Omit<ConformanceDiagramArtifactV1, "artifactDigest"> {
  const { artifactDigest, ...content } = artifact;
  void artifactDigest;
  return content;
}

export interface ConformanceDiagramServiceV1 {
  generate(input: unknown): ConformanceDiagramResultV1;
  verify(input: {
    readonly request: unknown;
    readonly result: unknown;
  }): ConformanceDiagramResultV1;
}

export function createConformanceDiagramService(): ConformanceDiagramServiceV1 {
  function generate(input: unknown): ConformanceDiagramResultV1 {
    const request = normalizeRequest(
      conformanceDiagramRequestV1Schema.parse(input),
    );
    const svg = renderSvg(request);
    const svgDigest = digestBytes(svg);
    const path = `diagram/conformance/${request.state}${request.showDifferences ? "-differences" : ""}.svg`;
    const content = {
      contractVersion: CONFORMANCE_DIAGRAM_CONTRACT_VERSION,
      counts: {
        differences: request.differences.length,
        edges: request.edges.length,
        nodes: request.nodes.length,
        provenance: request.provenance.length,
        unmappedEvidence: request.unmappedEvidence.length,
      },
      environmentId: request.environmentId,
      file: {
        checksum: svgDigest,
        mediaType: "image/svg+xml" as const,
        path,
        sizeBytes: utf8Size(svg),
      },
      kind: "cloudmarkup.conformance-diagram-artifact" as const,
      provenanceDigest: hashCanonicalValue(request.provenance),
      quality: request.quality,
      reportDigest: request.reportDigest,
      reportId: request.reportId,
      renderer: conformanceDiagramRendererV1Pin,
      requestDigest: hashCanonicalValue(request),
      showDifferences: request.showDifferences,
      solutionRevisionId: request.solutionRevisionId,
      provenance: request.provenance,
      state: request.state,
      svgDigest,
    };
    const artifact = conformanceDiagramArtifactV1Schema.parse({
      ...content,
      artifactDigest: hashCanonicalValue(content),
    });
    return conformanceDiagramResultV1Schema.parse({ artifact, svg });
  }

  function verify(input: {
    readonly request: unknown;
    readonly result: unknown;
  }): ConformanceDiagramResultV1 {
    const result = conformanceDiagramResultV1Schema.parse(input.result);
    if (
      result.artifact.artifactDigest !==
      hashCanonicalValue(artifactContent(result.artifact))
    ) {
      throw new TypeError(
        "Conformance diagram artifact digest does not match its metadata.",
      );
    }
    const expected = generate(input.request);
    if (
      serializeCanonicalJson(result.artifact) !==
        serializeCanonicalJson(expected.artifact) ||
      result.svg !== expected.svg
    ) {
      throw new TypeError(
        "Conformance diagram does not reproduce from the exact request.",
      );
    }
    return expected;
  }

  return Object.freeze({ generate, verify });
}
