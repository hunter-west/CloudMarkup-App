import {
  createConformanceDiagramService,
  type ConformanceDiagramRequestV1,
} from "@cloudmarkup/diagram-export/conformance";
import {
  getArchitectureDocumentContentHash,
  hashCanonicalValue,
} from "@cloudmarkup/domain";
import {
  architectureDocumentV3Schema,
  sha256DigestSchema,
  solutionRevisionIdSchema,
  solutionStableIdSchema,
  type ArchitectureDocumentV3,
  type ConformanceDifferenceV1,
  type ConformanceFactV1,
  type ConformanceReportV1,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import type { ContinuousConformanceDiagramRenderer } from "./continuous-conformance.js";
import { ApplicationError } from "./errors.js";

const approvedTopologyRecordV1Schema = z
  .object({
    architectureDocument: architectureDocumentV3Schema,
    architectureDocumentDigest: sha256DigestSchema,
    contractVersion: z.literal(1),
    organizationId: solutionStableIdSchema,
    projectId: solutionStableIdSchema,
    solutionRevision: z
      .object({
        digest: sha256DigestSchema,
        id: solutionRevisionIdSchema,
      })
      .strict(),
  })
  .strict();

export interface ContinuousConformanceApprovedTopologySource {
  get(input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly solutionRevisionId: string;
  }): Promise<unknown>;
}

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function unavailable(): ApplicationError {
  return new ApplicationError(
    "service_unavailable",
    "The approved conformance diagram topology is not currently verifiable.",
  );
}

type MappedTarget =
  | { readonly id: string; readonly kind: "node" }
  | { readonly id: string; readonly kind: "edge" };

function mappedTarget(value: {
  readonly subject?: ConformanceFactV1["subject"] | undefined;
}): MappedTarget | undefined {
  const reference = value.subject?.mappedReference;
  if (reference?.kind === "architecture-node") {
    return { id: `node.${reference.nodeId}`, kind: "node" };
  }
  if (reference?.kind === "architecture-edge") {
    return { id: `edge.${reference.edgeId}`, kind: "edge" };
  }
  return undefined;
}

function presence(
  differences: readonly ConformanceDifferenceV1[],
): "comparison-only-missing" | "present" {
  return differences.some(({ kind }) =>
    kind.startsWith("designed-missing-from-"),
  )
    ? "comparison-only-missing"
    : "present";
}

function status(
  layer: Pick<
    ConformanceReportV1["layers"][number],
    "availability" | "quality"
  >,
  fact: ConformanceFactV1 | undefined,
  differences: readonly ConformanceDifferenceV1[],
): "different" | "external" | "matching" | "unmanaged" | "unknown" {
  if (
    layer.availability !== "available" ||
    layer.quality.freshness !== "current"
  ) {
    return "unknown";
  }
  if (fact?.management === "external") return "external";
  if (fact?.management === "unmanaged") return "unmanaged";
  if (differences.some(({ kind }) => !kind.startsWith("matching-"))) {
    return "different";
  }
  if (
    fact === undefined ||
    fact.management === "unknown" ||
    fact.ownership === "unknown"
  ) {
    return "unknown";
  }
  return differences.some(
    ({ kind, subject }) =>
      kind.startsWith("matching-") &&
      subject?.kind === fact.subject.kind &&
      subject.stableKey === fact.subject.stableKey,
  )
    ? "matching"
    : "unknown";
}

function firstFact(
  facts: readonly ConformanceFactV1[],
): ConformanceFactV1 | undefined {
  return [...facts].sort((left, right) =>
    compareUtf16(left.factId, right.factId),
  )[0];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf16);
}

function projectApprovedTopology(document: ArchitectureDocumentV3) {
  if (document.nodes.length > 1_000 || document.edges.length > 4_000) {
    throw unavailable();
  }
  const rawNodeIds = new Set<string>();
  const nodes = [...document.nodes]
    .sort((left, right) => compareUtf16(left.id, right.id))
    .map((node) => {
      if (rawNodeIds.has(node.id)) throw unavailable();
      rawNodeIds.add(node.id);
      const { x, y } = node.presentation.position;
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        Math.abs(x) > 1_000_000 ||
        Math.abs(y) > 1_000_000
      ) {
        throw unavailable();
      }
      return {
        id: `node.${node.id}`,
        label: node.presentation.label,
        position: { x, y },
        serviceLabel: node.semantic.serviceType,
      };
    });

  const rawEdgeIds = new Set<string>();
  const edges = [...document.edges]
    .sort((left, right) => compareUtf16(left.id, right.id))
    .map((edge) => {
      if (
        rawEdgeIds.has(edge.id) ||
        !rawNodeIds.has(edge.semantic.source.nodeId) ||
        !rawNodeIds.has(edge.semantic.target.nodeId)
      ) {
        throw unavailable();
      }
      rawEdgeIds.add(edge.id);
      return {
        id: `edge.${edge.id}`,
        label: edge.semantic.relationshipType,
        sourceNodeId: `node.${edge.semantic.source.nodeId}`,
        targetNodeId: `node.${edge.semantic.target.nodeId}`,
      };
    });
  return { edges, nodes };
}

function projectProvenance(
  report: ConformanceReportV1,
): ConformanceDiagramRequestV1["provenance"] {
  const sources = new Map<
    string,
    ConformanceDiagramRequestV1["provenance"][number]
  >();
  for (const layer of report.layers) {
    for (const source of layer.sources) {
      const candidate = {
        evidenceIds: uniqueSorted(layer.evidenceIds),
        provenanceId: source.sourceId,
        sourceDigest: source.digest,
        sourceLabel: source.sourceId,
        verifiedAt: source.observedAt,
      };
      const existing = sources.get(source.sourceId);
      if (existing === undefined) {
        sources.set(source.sourceId, candidate);
        continue;
      }
      if (
        existing.sourceDigest !== candidate.sourceDigest ||
        existing.verifiedAt !== candidate.verifiedAt
      ) {
        throw unavailable();
      }
      sources.set(source.sourceId, {
        ...existing,
        evidenceIds: uniqueSorted([
          ...existing.evidenceIds,
          ...candidate.evidenceIds,
        ]),
      });
    }
  }
  return [...sources.values()].sort((left, right) =>
    compareUtf16(left.provenanceId, right.provenanceId),
  );
}

function projectRequest(input: {
  readonly document: ArchitectureDocumentV3;
  readonly environmentId: string;
  readonly report: ConformanceReportV1;
  readonly showDifferences: boolean;
  readonly solutionRevisionId: string;
  readonly state: ConformanceDiagramRequestV1["state"];
}): ConformanceDiagramRequestV1 {
  const { document, environmentId, report, showDifferences, state } = input;
  const layer = report.layers.find(
    ({ layer: candidate }) => candidate === state,
  );
  if (layer === undefined) throw unavailable();

  const differences = report.differences
    .filter(({ layer: candidate }) => candidate === state)
    .sort((left, right) => compareUtf16(left.differenceId, right.differenceId));
  const topology = projectApprovedTopology(document);
  const topologyNodes = new Map(topology.nodes.map((node) => [node.id, node]));
  const topologyEdges = new Map(topology.edges.map((edge) => [edge.id, edge]));
  const factsByNode = new Map<string, ConformanceFactV1[]>();
  const factsByEdge = new Map<string, ConformanceFactV1[]>();

  for (const fact of layer.facts) {
    const target = mappedTarget(fact);
    if (target?.kind === "node" && topologyNodes.has(target.id)) {
      factsByNode.set(target.id, [...(factsByNode.get(target.id) ?? []), fact]);
    }
    if (target?.kind === "edge" && topologyEdges.has(target.id)) {
      factsByEdge.set(target.id, [...(factsByEdge.get(target.id) ?? []), fact]);
    }
  }

  const comparisonOnlyNodeIds = differences.flatMap((difference) => {
    const target = mappedTarget(difference);
    return target?.kind === "node" &&
      topologyNodes.has(target.id) &&
      presence([difference]) === "comparison-only-missing"
      ? [target.id]
      : [];
  });
  const nodeIds = uniqueSorted([
    ...factsByNode.keys(),
    ...comparisonOnlyNodeIds,
  ]);
  const nodes = nodeIds.map((id) => {
    const facts = factsByNode.get(id) ?? [];
    const topologyNode = topologyNodes.get(id);
    if (topologyNode === undefined) throw unavailable();
    const related = differences.filter((difference) => {
      const target = mappedTarget(difference);
      return target?.kind === "node" && target.id === id;
    });
    return {
      differenceIds: uniqueSorted(
        related.map(({ differenceId }) => differenceId),
      ),
      evidenceIds: uniqueSorted([
        ...facts.flatMap(({ evidenceIds }) => evidenceIds),
        ...related.flatMap(({ evidenceIds }) => evidenceIds),
      ]),
      id,
      label: topologyNode.label,
      mapping: "mapped" as const,
      position: topologyNode.position,
      presence: presence(related),
      serviceLabel: topologyNode.serviceLabel,
      status: status(layer, firstFact(facts), related),
    };
  });

  const drawnNodeIds = new Set(nodes.map(({ id }) => id));
  const consumedFactIds = new Set(
    [...factsByNode.values()].flatMap((facts) =>
      facts.map(({ factId }) => factId),
    ),
  );
  const comparisonOnlyEdgeIds = differences.flatMap((difference) => {
    const target = mappedTarget(difference);
    return target?.kind === "edge" &&
      topologyEdges.has(target.id) &&
      presence([difference]) === "comparison-only-missing"
      ? [target.id]
      : [];
  });
  const edges: ConformanceDiagramRequestV1["edges"][number][] = [];
  for (const id of uniqueSorted([
    ...factsByEdge.keys(),
    ...comparisonOnlyEdgeIds,
  ])) {
    const facts = factsByEdge.get(id) ?? [];
    const topologyEdge = topologyEdges.get(id);
    if (
      topologyEdge === undefined ||
      !drawnNodeIds.has(topologyEdge.sourceNodeId) ||
      !drawnNodeIds.has(topologyEdge.targetNodeId)
    ) {
      continue;
    }
    const related = differences.filter((difference) => {
      const target = mappedTarget(difference);
      return target?.kind === "edge" && target.id === id;
    });
    edges.push({
      differenceIds: uniqueSorted(
        related.map(({ differenceId }) => differenceId),
      ),
      evidenceIds: uniqueSorted([
        ...facts.flatMap(({ evidenceIds }) => evidenceIds),
        ...related.flatMap(({ evidenceIds }) => evidenceIds),
      ]),
      id,
      label: topologyEdge.label,
      mapping: "mapped",
      presence: presence(related),
      sourceNodeId: topologyEdge.sourceNodeId,
      status: status(layer, firstFact(facts), related),
      targetNodeId: topologyEdge.targetNodeId,
    });
    facts.forEach(({ factId }) => consumedFactIds.add(factId));
  }

  const unmappedEvidence = layer.facts
    .filter(({ factId }) => !consumedFactIds.has(factId))
    .map((fact) => {
      const target = mappedTarget(fact);
      return {
        evidenceIds: uniqueSorted(fact.evidenceIds),
        id: `unmapped.${hashCanonicalValue({
          factId: fact.factId,
          layer: state,
        }).slice("sha256:".length)}`,
        kind:
          fact.subject.kind === "connection"
            ? ("connection" as const)
            : fact.subject.kind === "resource" ||
                fact.subject.kind === "external-resource"
              ? ("resource" as const)
              : ("configuration" as const),
        label: fact.subject.stableKey,
        reason:
          target?.kind === "edge"
            ? "The approved edge is known, but safely mapped endpoint facts are not both present in this evidence layer."
            : target === undefined
              ? "No approved Architecture Document node or edge mapping accompanied this normalized fact."
              : "The mapped identity is not present in the exact approved topology.",
      };
    })
    .sort((left, right) => compareUtf16(left.id, right.id));

  const mappedNodeIds = new Set(nodes.map(({ id }) => id));
  const mappedEdgeIds = new Set(edges.map(({ id }) => id));
  const projectedDifferences = differences.map((difference) => {
    const target = mappedTarget(difference);
    const safeTarget =
      target?.kind === "node" && mappedNodeIds.has(target.id)
        ? target
        : target?.kind === "edge" && mappedEdgeIds.has(target.id)
          ? target
          : undefined;
    return {
      differenceId: difference.differenceId,
      evidenceIds: uniqueSorted(difference.evidenceIds),
      kind: difference.kind,
      severity: difference.severity,
      summary: difference.summary,
      ...(safeTarget === undefined ? {} : { target: safeTarget }),
    };
  });

  const qualityReason =
    layer.availability === "available" &&
    layer.quality.completeness === "complete" &&
    layer.quality.freshness === "current"
      ? undefined
      : `Evidence is ${layer.availability}, ${layer.quality.completeness}, and ${layer.quality.freshness}.`;

  return {
    contractVersion: 1,
    differences: projectedDifferences,
    edges,
    environmentId,
    environmentLabel: `${environmentId} | ${report.environment.environmentType}`,
    nodes,
    provenance: projectProvenance(report),
    quality: {
      availability: layer.availability,
      completeness: layer.quality.completeness,
      ...(layer.quality.expiresAt === undefined
        ? {}
        : { expiresAt: layer.quality.expiresAt }),
      freshness: layer.quality.freshness,
      ...(layer.quality.lastVerifiedAt === undefined
        ? {}
        : { lastVerifiedAt: layer.quality.lastVerifiedAt }),
      ...(qualityReason === undefined ? {} : { reason: qualityReason }),
    },
    reportDigest: report.reportDigest,
    reportId: report.reportId,
    showDifferences,
    solutionRevisionId: input.solutionRevisionId,
    state,
    title: "Continuous conformance",
    unmappedEvidence,
  };
}

export class CanonicalContinuousConformanceDiagramRenderer implements ContinuousConformanceDiagramRenderer {
  readonly #source: ContinuousConformanceApprovedTopologySource;

  constructor(source: ContinuousConformanceApprovedTopologySource) {
    this.#source = source;
  }

  async render(input: {
    readonly environmentId: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly report: ConformanceReportV1;
    readonly showDifferences: boolean;
    readonly solutionRevisionId: string;
    readonly state: ConformanceDiagramRequestV1["state"];
  }): Promise<{ readonly artifactId: string; readonly svg: string }> {
    let untrusted: unknown;
    try {
      untrusted = await this.#source.get({
        organizationId: input.organizationId,
        projectId: input.projectId,
        solutionRevisionId: input.solutionRevisionId,
      });
    } catch (cause) {
      if (cause instanceof ApplicationError) throw cause;
      throw unavailable();
    }
    const parsed = approvedTopologyRecordV1Schema.safeParse(untrusted);
    if (!parsed.success) throw unavailable();
    const record = parsed.data;
    if (
      record.organizationId !== input.organizationId ||
      record.projectId !== input.projectId ||
      record.solutionRevision.id !== input.solutionRevisionId ||
      record.solutionRevision.id !==
        input.report.evaluatedSolutionRevision.id ||
      record.solutionRevision.digest !==
        input.report.evaluatedSolutionRevision.digest ||
      record.architectureDocumentDigest !==
        getArchitectureDocumentContentHash(record.architectureDocument)
    ) {
      throw unavailable();
    }

    try {
      const result = createConformanceDiagramService().generate(
        projectRequest({
          document: record.architectureDocument,
          environmentId: input.environmentId,
          report: input.report,
          showDifferences: input.showDifferences,
          solutionRevisionId: input.solutionRevisionId,
          state: input.state,
        }),
      );
      return {
        artifactId: result.artifact.artifactDigest,
        svg: result.svg,
      };
    } catch (cause) {
      if (cause instanceof ApplicationError) throw cause;
      throw unavailable();
    }
  }
}
