import {
  continuousConformanceAvailableReviewActionsV1Schema,
  type ContinuousConformanceAvailableReviewActionsV1,
} from "@cloudmarkup/api-contract";
import type { ArchitectureDocument } from "@cloudmarkup/domain";
import {
  conformanceReportV1Schema,
  type ConformanceDifferenceV1,
  type ConformanceFactV1,
  type ConformanceReportV1,
  type ConformanceViewLayerV1,
} from "@cloudmarkup/schemas";

import {
  CONTINUOUS_CONFORMANCE_STATES,
  type ContinuousConformanceDiagramEdge,
  type ContinuousConformanceDiagramNode,
  type ContinuousConformanceReadModel,
} from "./model.js";
import {
  compareConformanceText,
  safeConformanceLabel,
} from "./presentation.js";

export interface ApprovedConformanceTopologyV1 {
  readonly edges: readonly {
    readonly id: string;
    readonly label: string;
    readonly sourceNodeId: string;
    readonly targetNodeId: string;
  }[];
  readonly nodes: readonly {
    readonly id: string;
    readonly label: string;
    readonly position: { readonly x: number; readonly y: number };
    readonly serviceLabel: string;
  }[];
}

export interface ConformanceReportProjectionBinding {
  readonly approvedTopology: ApprovedConformanceTopologyV1;
  readonly environmentId: string;
  readonly projectId: string;
  readonly solutionRevisionId: string;
}

function projectServerKnownReviewActions(
  input: unknown,
  differenceIds: ReadonlySet<string>,
): ReadonlyMap<
  string,
  ContinuousConformanceReadModel["differences"][number]["reviewActions"]
> {
  const available =
    continuousConformanceAvailableReviewActionsV1Schema.parse(input);
  const actionKeys = new Set<string>();
  const projected = new Map<
    string,
    ContinuousConformanceReadModel["differences"][number]["reviewActions"]
  >();
  for (const entry of available) {
    if (
      !differenceIds.has(entry.differenceId) ||
      projected.has(entry.differenceId)
    ) {
      throw new TypeError(
        "Conformance review-action availability does not match the verified report differences.",
      );
    }
    const actions = entry.actions
      .map((action) => {
        if (actionKeys.has(action.actionKey)) {
          throw new TypeError(
            "Conformance review-action availability contains a duplicate action key.",
          );
        }
        actionKeys.add(action.actionKey);
        return {
          actionKey: action.actionKey,
          differenceId: entry.differenceId,
          kind: action.kind,
        };
      })
      .sort((left, right) =>
        compareConformanceText(left.actionKey, right.actionKey),
      );
    projected.set(entry.differenceId, actions);
  }
  return projected;
}

export function projectApprovedConformanceTopologyV1(
  document: ArchitectureDocument,
): ApprovedConformanceTopologyV1 {
  if (document.nodes.length > 1_000 || document.edges.length > 4_000) {
    throw new TypeError(
      "Approved topology exceeds the bounded conformance diagram projection.",
    );
  }
  const architectureNodeIds = new Set(document.nodes.map(({ id }) => id));
  const nodes = [...document.nodes]
    .sort((left, right) => compareConformanceText(left.id, right.id))
    .map((node) => {
      const { x, y } = node.presentation.position;
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        Math.abs(x) > 1_000_000 ||
        Math.abs(y) > 1_000_000
      ) {
        throw new TypeError(
          "Approved topology contains an out-of-bounds visual position.",
        );
      }
      return {
        id: `node.${node.id}`,
        label: safeConformanceLabel(node.presentation.label),
        position: { x, y },
        serviceLabel: safeConformanceLabel(node.semantic.serviceType),
      };
    });
  const edges = [...document.edges]
    .sort((left, right) => compareConformanceText(left.id, right.id))
    .map((edge) => {
      if (
        !architectureNodeIds.has(edge.semantic.source.nodeId) ||
        !architectureNodeIds.has(edge.semantic.target.nodeId)
      ) {
        throw new TypeError(
          "Approved topology edge endpoints must resolve within the exact Architecture Document.",
        );
      }
      return {
        id: `edge.${edge.id}`,
        label: safeConformanceLabel(edge.semantic.relationshipType),
        sourceNodeId: `node.${edge.semantic.source.nodeId}`,
        targetNodeId: `node.${edge.semantic.target.nodeId}`,
      };
    });
  return { edges, nodes };
}

export function assertConformanceReportProjectionBindingV1(
  report: {
    readonly currentSolutionRevision: { readonly id: string };
    readonly environment: { readonly environmentId: string };
    readonly evaluatedSolutionRevision: { readonly id: string };
    readonly projectId: string;
  },
  binding: Pick<
    ConformanceReportProjectionBinding,
    "environmentId" | "projectId" | "solutionRevisionId"
  >,
): void {
  if (
    report.projectId !== binding.projectId ||
    report.evaluatedSolutionRevision.id !== binding.solutionRevisionId ||
    report.environment.environmentId !== binding.environmentId
  ) {
    throw new TypeError(
      "Conformance report does not match the authorized project, evaluated revision, and environment binding.",
    );
  }
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

function status(
  layer: Pick<
    ConformanceReportV1["layers"][number],
    "availability" | "quality"
  >,
  fact: ConformanceFactV1 | undefined,
  differences: readonly ConformanceDifferenceV1[],
): ContinuousConformanceDiagramNode["status"] {
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

function presence(
  differences: readonly ConformanceDifferenceV1[],
): ContinuousConformanceDiagramNode["presence"] {
  return differences.some(({ kind }) =>
    kind.startsWith("designed-missing-from-"),
  )
    ? "comparison-only-missing"
    : "present";
}

function projectedPresence(
  layer: ConformanceReportV1["layers"][number],
  hasFact: boolean,
  differences: readonly ConformanceDifferenceV1[],
): ContinuousConformanceDiagramNode["presence"] {
  if (
    layer.availability !== "available" ||
    (!hasFact && layer.quality.completeness !== "complete")
  ) {
    return "unknown";
  }
  return presence(differences);
}

function firstFact(facts: readonly ConformanceFactV1[]): ConformanceFactV1 {
  const fact = [...facts].sort((left, right) =>
    compareConformanceText(left.factId, right.factId),
  )[0];
  if (fact === undefined) throw new TypeError("Mapped fact group is empty.");
  return fact;
}

function projectLayer(
  report: ConformanceReportV1,
  state: ConformanceViewLayerV1,
  topology: ApprovedConformanceTopologyV1,
) {
  const layer = report.layers.find(
    ({ layer: candidate }) => candidate === state,
  );
  if (layer === undefined) {
    throw new TypeError(`Conformance report is missing layer ${state}.`);
  }
  const differences = report.differences.filter(
    ({ layer: candidate }) => candidate === state,
  );
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
  const includeReferenceTopology =
    layer.availability !== "available" ||
    layer.quality.completeness !== "complete";
  const projectedNodeIds = [
    ...new Set([
      ...factsByNode.keys(),
      ...comparisonOnlyNodeIds,
      ...(includeReferenceTopology ? topologyNodes.keys() : []),
    ]),
  ].sort(compareConformanceText);
  const nodes = projectedNodeIds.map((id) => {
    const facts = factsByNode.get(id) ?? [];
    const topologyNode = topologyNodes.get(id);
    if (topologyNode === undefined) {
      throw new TypeError("Mapped topology node is unavailable.");
    }
    const fact = facts.length === 0 ? undefined : firstFact(facts);
    const related = differences.filter((difference) => {
      const target = mappedTarget(difference);
      return target?.kind === "node" && target.id === id;
    });
    return {
      differenceIds: related.map(({ differenceId }) => differenceId),
      evidenceIds: [
        ...new Set([
          ...facts.flatMap(({ evidenceIds }) => evidenceIds),
          ...related.flatMap(({ evidenceIds }) => evidenceIds),
        ]),
      ].sort(compareConformanceText),
      id,
      label: topologyNode.label,
      mapping: "mapped" as const,
      position: topologyNode.position,
      presence: projectedPresence(layer, fact !== undefined, related),
      serviceLabel: topologyNode.serviceLabel,
      status: status(layer, fact, related),
    };
  });
  const drawnNodeIds = new Set(nodes.map(({ id }) => id));
  const consumedFactIds = new Set(
    [...factsByNode.values()].flatMap((facts) =>
      facts.map(({ factId }) => factId),
    ),
  );
  const edges: ContinuousConformanceDiagramEdge[] = [];
  const comparisonOnlyEdgeIds = differences.flatMap((difference) => {
    const target = mappedTarget(difference);
    return target?.kind === "edge" &&
      topologyEdges.has(target.id) &&
      presence([difference]) === "comparison-only-missing"
      ? [target.id]
      : [];
  });
  const projectedEdgeIds = [
    ...new Set([
      ...factsByEdge.keys(),
      ...comparisonOnlyEdgeIds,
      ...(includeReferenceTopology ? topologyEdges.keys() : []),
    ]),
  ].sort(compareConformanceText);
  for (const id of projectedEdgeIds) {
    const facts = factsByEdge.get(id) ?? [];
    const topologyEdge = topologyEdges.get(id);
    if (
      topologyEdge === undefined ||
      !drawnNodeIds.has(topologyEdge.sourceNodeId) ||
      !drawnNodeIds.has(topologyEdge.targetNodeId)
    ) {
      continue;
    }
    const fact = facts.length === 0 ? undefined : firstFact(facts);
    const related = differences.filter((difference) => {
      const target = mappedTarget(difference);
      return target?.kind === "edge" && target.id === id;
    });
    edges.push({
      differenceIds: related.map(({ differenceId }) => differenceId),
      evidenceIds: [
        ...new Set([
          ...facts.flatMap(({ evidenceIds }) => evidenceIds),
          ...related.flatMap(({ evidenceIds }) => evidenceIds),
        ]),
      ].sort(compareConformanceText),
      id,
      label: topologyEdge.label,
      mapping: "mapped",
      presence: projectedPresence(layer, fact !== undefined, related),
      sourceNodeId: topologyEdge.sourceNodeId,
      status: status(layer, fact, related),
      targetNodeId: topologyEdge.targetNodeId,
    });
    facts.forEach(({ factId }) => consumedFactIds.add(factId));
  }
  const unmappedEvidence = layer.facts
    .filter(({ factId }) => !consumedFactIds.has(factId))
    .map((fact) => {
      const target = mappedTarget(fact);
      return {
        evidenceIds: fact.evidenceIds,
        id: `unmapped.${fact.factId}`,
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
    .sort((left, right) => compareConformanceText(left.id, right.id));
  const qualityReasons = [
    ...layer.quality.freshnessReasons,
    ...(layer.quality.completeness === "complete"
      ? []
      : [`Evidence completeness is ${layer.quality.completeness}.`]),
    ...(layer.availability === "available"
      ? []
      : ["Evidence is explicitly unavailable."]),
  ];
  return {
    diagram: { edges, nodes, unmappedEvidence },
    evidence: layer.sources
      .map((source) => ({
        evidenceIds: layer.evidenceIds,
        level: source.kind,
        provenanceId: source.sourceId,
        sourceDigest: source.digest,
        sourceLabel: source.sourceId,
        ...(source.tool === undefined
          ? {}
          : { toolLabel: `${source.tool.id}@${source.tool.version}` }),
        verifiedAt: source.observedAt,
      }))
      .sort((left, right) =>
        compareConformanceText(left.provenanceId, right.provenanceId),
      ),
    quality: {
      availability: layer.availability,
      completeness: layer.quality.completeness,
      ...(layer.quality.expiresAt === undefined
        ? {}
        : { expiresAt: layer.quality.expiresAt }),
      freshness: layer.quality.freshness,
      freshnessReasons: layer.quality.freshnessReasons,
      ...(layer.quality.lastVerifiedAt === undefined
        ? {}
        : { lastVerifiedAt: layer.quality.lastVerifiedAt }),
      ...(qualityReasons.length === 0
        ? {}
        : { reason: qualityReasons.join(", ") }),
    },
    state,
  };
}

export function projectConformanceReportV1(
  input: unknown,
  binding: ConformanceReportProjectionBinding,
  availableReviewActions: ContinuousConformanceAvailableReviewActionsV1 = [],
): ContinuousConformanceReadModel {
  const report = conformanceReportV1Schema.parse(input);
  assertConformanceReportProjectionBindingV1(report, binding);
  const reviewActionsByDifference = projectServerKnownReviewActions(
    availableReviewActions,
    new Set(report.differences.map(({ differenceId }) => differenceId)),
  );
  const topologyNodeIds = new Set(
    binding.approvedTopology.nodes.map(({ id }) => id),
  );
  const topologyEdgeIds = new Set(
    binding.approvedTopology.edges.map(({ id }) => id),
  );
  return {
    differences: report.differences
      .map((difference) => {
        const target = mappedTarget(difference);
        const resolvedTarget =
          target?.kind === "node" && topologyNodeIds.has(target.id)
            ? target
            : target?.kind === "edge" && topologyEdgeIds.has(target.id)
              ? target
              : undefined;
        return {
          differenceId: difference.differenceId,
          evidenceIds: difference.evidenceIds,
          kind: difference.kind,
          // Action availability is projected only from the server registry. A
          // review-required disposition alone never proves that a GitHub issue
          // or PR action is configured for this tenant and repository.
          reviewActions:
            reviewActionsByDifference.get(difference.differenceId) ?? [],
          severity: difference.severity,
          states: [
            difference.layer,
            ...(difference.comparedWithLayer === undefined
              ? []
              : [difference.comparedWithLayer]),
          ],
          summary: difference.summary,
          ...(resolvedTarget === undefined ? {} : { target: resolvedTarget }),
        };
      })
      .sort((left, right) =>
        compareConformanceText(left.differenceId, right.differenceId),
      ),
    environmentId: report.environment.environmentId,
    environmentLabel: `${report.environment.environmentId} · ${report.environment.environmentType}`,
    issues: report.issues
      .map((issue) => ({
        evidenceIds: issue.affected.flatMap((reference) =>
          reference.kind === "evidence" ? [reference.evidenceId] : [],
        ),
        issueId: issue.id,
        lifecycle: issue.lifecycle.state,
        severity: issue.severity,
        source: issue.source,
        summary: issue.summary,
      }))
      .sort((left, right) =>
        compareConformanceText(left.issueId, right.issueId),
      ),
    layers: CONTINUOUS_CONFORMANCE_STATES.map((state) =>
      projectLayer(report, state, binding.approvedTopology),
    ),
    reportDigest: report.reportDigest,
    reportId: report.reportId,
    solutionRevisionId: report.evaluatedSolutionRevision.id,
  };
}
