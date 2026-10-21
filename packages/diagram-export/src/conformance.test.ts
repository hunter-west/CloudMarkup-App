import { describe, expect, it } from "vitest";

import {
  CONFORMANCE_DIAGRAM_DIFFERENCE_KINDS,
  CONFORMANCE_DIAGRAM_STATES,
  conformanceDiagramRequestV1Schema,
  createConformanceDiagramService,
  type ConformanceDiagramRequestV1,
} from "./conformance.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function request(
  overrides: Partial<ConformanceDiagramRequestV1> = {},
): ConformanceDiagramRequestV1 {
  const differences = CONFORMANCE_DIAGRAM_DIFFERENCE_KINDS.map(
    (kind, index) => ({
      differenceId: `difference.${String(index).padStart(2, "0")}`,
      evidenceIds: ["evidence.plan"],
      kind,
      severity:
        kind === "iam-expansion" || kind === "network-public-exposure-change"
          ? ("security-error" as const)
          : ("warning" as const),
      summary: `${kind.replaceAll("-", " ")} was established by safe evidence.`,
      ...(index === 0
        ? { target: { id: "node.api", kind: "node" as const } }
        : {}),
    }),
  );
  return conformanceDiagramRequestV1Schema.parse({
    contractVersion: 1,
    differences,
    edges: [
      {
        differenceIds: ["difference.01"],
        evidenceIds: ["evidence.plan"],
        id: "edge.api-table",
        label: "reads and writes",
        mapping: "mapped",
        presence: "present",
        sourceNodeId: "node.api",
        status: "different",
        targetNodeId: "node.table",
      },
    ],
    environmentId: "environment.staging",
    environmentLabel: "staging us-east-1",
    nodes: [
      {
        differenceIds: ["difference.00"],
        evidenceIds: ["evidence.plan"],
        id: "node.api",
        label: "Notes API",
        mapping: "mapped",
        position: { x: 120, y: 180 },
        presence: "present",
        serviceLabel: "AWS Lambda",
        status: "different",
      },
      {
        differenceIds: [],
        evidenceIds: ["evidence.design"],
        id: "node.table",
        label: "Notes table",
        mapping: "mapped",
        position: { x: 520, y: 180 },
        presence: "comparison-only-missing",
        serviceLabel: "Amazon DynamoDB",
        status: "unknown",
      },
    ],
    provenance: [
      {
        evidenceIds: ["evidence.design"],
        provenanceId: "source.design",
        sourceDigest: digest("d"),
        sourceLabel: "approved architecture",
        verifiedAt: "2026-08-29T10:00:00.000Z",
      },
      {
        evidenceIds: ["evidence.plan"],
        provenanceId: "source.plan",
        sourceDigest: digest("e"),
        sourceLabel: "sanitized saved plan",
        verifiedAt: "2026-08-29T10:05:00.000Z",
      },
    ],
    quality: {
      availability: "available",
      completeness: "partial",
      expiresAt: "2026-08-29T10:30:00.000Z",
      freshness: "stale",
      lastVerifiedAt: "2026-08-29T10:05:00.000Z",
      reason:
        "Only safely mapped resources are shown; current evidence is stale.",
    },
    reportDigest: digest("f"),
    reportId: "report.notes.7",
    showDifferences: true,
    solutionRevisionId: "revision.notes.7",
    state: "planned",
    title: "Notes conformance",
    unmappedEvidence: [
      {
        evidenceIds: ["evidence.plan"],
        id: "unmapped.bucket",
        kind: "resource",
        label: "Unmapped imported bucket",
        reason: "No stable approved deployment key was available.",
      },
    ],
    ...overrides,
  });
}

describe("deterministic conformance diagram export", () => {
  it("exports every evidence state with explicit quality, provenance, and difference semantics", () => {
    const service = createConformanceDiagramService();
    for (const state of CONFORMANCE_DIAGRAM_STATES) {
      const result = service.generate(request({ state }));
      expect(result.artifact.state).toBe(state);
      expect(result.artifact.environmentId).toBe("environment.staging");
      expect(result.artifact.reportId).toBe("report.notes.7");
      expect(result.artifact.reportDigest).toBe(digest("f"));
      expect(
        result.artifact.provenance.map(
          ({ provenanceId, evidenceIds, sourceDigest }) => ({
            evidenceIds,
            provenanceId,
            sourceDigest,
          }),
        ),
      ).toEqual([
        {
          evidenceIds: ["evidence.design"],
          provenanceId: "source.design",
          sourceDigest: digest("d"),
        },
        {
          evidenceIds: ["evidence.plan"],
          provenanceId: "source.plan",
          sourceDigest: digest("e"),
        },
      ]);
      expect(result.artifact.file.path).toBe(
        `diagram/conformance/${state}-differences.svg`,
      );
      expect(result.artifact.counts.differences).toBe(
        CONFORMANCE_DIAGRAM_DIFFERENCE_KINDS.length,
      );
      expect(result.svg).toContain("Evidence: partial / stale");
      expect(result.svg).toContain("last verified 2026-08-29T10:05:00.000Z");
      expect(result.svg).toContain("expires 2026-08-29T10:30:00.000Z");
      expect(result.artifact.quality.expiresAt).toBe(
        "2026-08-29T10:30:00.000Z",
      );
      for (const kind of CONFORMANCE_DIAGRAM_DIFFERENCE_KINDS) {
        expect(result.svg).toContain(kind);
      }
    }
  });

  it("is reproducible and invariant to equivalent collection order", () => {
    const service = createConformanceDiagramService();
    const input = request();
    const reordered = request({
      differences: [...input.differences].reverse(),
      edges: [...input.edges].reverse(),
      nodes: [...input.nodes].reverse(),
      provenance: [...input.provenance].reverse(),
      unmappedEvidence: [...input.unmappedEvidence].reverse(),
    });
    const first = service.generate(input);
    const second = service.generate(reordered);
    expect(second).toEqual(first);
    expect(service.verify({ request: reordered, result: first })).toEqual(
      first,
    );
  });

  it("draws only mapped nodes and keeps unmapped evidence explicitly outside graph inventory", () => {
    const result = createConformanceDiagramService().generate(request());
    expect(result.svg).toContain('id="conformance-node-node.api"');
    expect(result.svg).toContain('id="conformance-edge-edge.api-table"');
    expect(result.svg).not.toContain('id="conformance-node-unmapped.bucket"');
    expect(result.svg).toContain("Unmapped evidence (1)");
    expect(result.svg).toContain("Unmapped imported bucket");
    expect(result.svg).toContain("not complete inventory");
    expect(result.svg).toContain("never remediates drift");
  });

  it("can omit the Differences overlay without changing layer evidence", () => {
    const input = request({ showDifferences: false });
    const result = createConformanceDiagramService().generate(input);
    expect(result.artifact.file.path).toBe("diagram/conformance/planned.svg");
    expect(result.svg).not.toContain("Differences (");
    expect(result.svg).not.toContain("iam-expansion");
    expect(result.svg).toContain("Evidence (2)");
    expect(result.artifact.counts).toEqual({
      differences: input.differences.length,
      edges: input.edges.length,
      nodes: input.nodes.length,
      provenance: input.provenance.length,
      unmappedEvidence: input.unmappedEvidence.length,
    });
    expect(result.artifact.provenance).toEqual(input.provenance);
    expect(result.artifact.quality).toEqual(input.quality);
    expect(result.artifact.reportDigest).toBe(input.reportDigest);
    expect(result.artifact.solutionRevisionId).toBe(input.solutionRevisionId);
    for (const node of input.nodes) {
      expect(result.svg).toContain(`id="conformance-node-${node.id}"`);
    }
    for (const edge of input.edges) {
      expect(result.svg).toContain(`id="conformance-edge-${edge.id}"`);
    }
  });

  it("rejects sensitive labels and unknown graph or Evidence references", () => {
    expect(() =>
      createConformanceDiagramService().generate(
        request({ environmentLabel: "Authorization: Bearer private-value" }),
      ),
    ).toThrow(/must not contain secrets/u);

    expect(() =>
      conformanceDiagramRequestV1Schema.parse({
        ...request(),
        edges: [
          {
            ...request().edges[0],
            targetNodeId: "node.unmapped",
          },
        ],
      }),
    ).toThrow(/must reference mapped nodes/u);

    expect(() =>
      conformanceDiagramRequestV1Schema.parse({
        ...request(),
        nodes: [
          {
            ...request().nodes[0],
            evidenceIds: ["evidence.unknown"],
          },
        ],
      }),
    ).toThrow(/Unknown Evidence identity/u);
  });

  it("rejects substituted SVG and artifact metadata", () => {
    const service = createConformanceDiagramService();
    const input = request();
    const result = service.generate(input);
    expect(() =>
      service.verify({
        request: input,
        result: {
          ...result,
          svg: result.svg.replace("Notes API", "Other API"),
        },
      }),
    ).toThrow(/does not reproduce/u);
    expect(() =>
      service.verify({
        request: input,
        result: {
          ...result,
          artifact: {
            ...result.artifact,
            artifactDigest: digest("0"),
          },
        },
      }),
    ).toThrow(/artifact digest/u);
  });
});
