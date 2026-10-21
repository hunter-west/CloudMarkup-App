import type {
  ArchitectureDocumentV3,
  WorkloadBehaviorV2,
} from "@cloudmarkup/schemas";

import { sha256Hex } from "./sha256.js";

type ArchitectureNodeV3 = ArchitectureDocumentV3["nodes"][number];
type ArchitectureEdgeV3 = ArchitectureDocumentV3["edges"][number];
type ArchitectureVariableV3 = ArchitectureDocumentV3["variables"][number];
type ArchitectureOutputV3 = ArchitectureDocumentV3["outputs"][number];

export interface ArchitectureConformanceSourcesV1 {
  readonly architectureDocument: Pick<ArchitectureDocumentV3, "nodes">;
  readonly workloadBehavior: Pick<WorkloadBehaviorV2, "workloads">;
}

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort(compareUtf16);
}

function lifecycleProjection(
  value: ArchitectureNodeV3["semantic"]["lifecycle"],
) {
  const adoptedBy = "adoptedBy" in value ? value.adoptedBy : undefined;
  const provenance = "provenance" in value ? value.provenance : undefined;
  return {
    ...(adoptedBy === undefined ? {} : { adoptedBy }),
    origin: value.origin,
    ownership: value.ownership,
    ...(provenance === undefined
      ? {}
      : {
          provenance: {
            dependentEdgeIds: sortedStrings(provenance.dependentEdgeIds),
            dependentNodeIds: sortedStrings(provenance.dependentNodeIds),
            generatorId: provenance.generatorId,
            generatorKind: provenance.generatorKind,
            generatorVersion: provenance.generatorVersion,
            operationId: provenance.operationId,
          },
        }),
  };
}

export function assignConformanceTargetKeysV1(
  sources: Pick<ArchitectureConformanceSourcesV1, "architectureDocument">,
): ReadonlyMap<string, string> {
  const groups = new Map<string, ArchitectureDocumentV3["nodes"]>();
  for (const node of sources.architectureDocument.nodes) {
    const existing = groups.get(node.semantic.deploymentKey) ?? [];
    groups.set(node.semantic.deploymentKey, [...existing, node]);
  }
  const result = new Map<string, string>();
  for (const [base, nodes] of groups) {
    const ordered = [...nodes].sort((left, right) =>
      compareUtf16(left.id, right.id),
    );
    if (ordered.length === 1) {
      const only = ordered[0];
      if (only !== undefined) result.set(only.id, base);
      continue;
    }
    const used = new Set<string>();
    ordered.forEach((node, index) => {
      const prefix = base.slice(0, 52);
      let candidate = `${prefix}_${sha256Hex(node.id).slice(0, 17)}`;
      if (used.has(candidate)) {
        candidate = `${prefix.slice(0, 49)}_${String(index).padStart(2, "0")}`;
      }
      used.add(candidate);
      result.set(node.id, candidate);
    });
  }
  return result;
}

export function projectArchitectureResourceIntentV1(
  sources: ArchitectureConformanceSourcesV1,
  node: ArchitectureNodeV3,
  targetKeys: ReadonlyMap<string, string>,
) {
  return {
    configuration: node.semantic.configuration,
    deploymentKey: node.semantic.deploymentKey,
    lifecycle: lifecycleProjection(node.semantic.lifecycle),
    ...(node.semantic.parent === undefined
      ? {}
      : {
          parent: {
            nodeId: node.semantic.parent.nodeId,
            targetKey: targetKeys.get(node.semantic.parent.nodeId),
          },
        }),
    resourceType: node.semantic.resourceType,
    serviceType: node.semantic.serviceType,
    targetKey: targetKeys.get(node.id),
    workloadIds: sortedStrings(
      sources.workloadBehavior.workloads
        .filter(({ owningNodeId }) => owningNodeId === node.id)
        .map(({ id }) => id),
    ),
  };
}

export function projectArchitectureConnectionIntentV1(
  edge: ArchitectureEdgeV3,
  targetKeys: ReadonlyMap<string, string>,
) {
  return {
    configuration: edge.semantic.configuration,
    lifecycle: lifecycleProjection(edge.semantic.lifecycle),
    relationshipType: edge.semantic.relationshipType,
    source: {
      nodeId: edge.semantic.source.nodeId,
      port: edge.semantic.source.port,
      targetKey: targetKeys.get(edge.semantic.source.nodeId),
    },
    target: {
      nodeId: edge.semantic.target.nodeId,
      port: edge.semantic.target.port,
      targetKey: targetKeys.get(edge.semantic.target.nodeId),
    },
  };
}

export function projectArchitectureVariableIntentV1(
  variable: ArchitectureVariableV3,
) {
  return {
    ...(variable.defaultValue === undefined
      ? {}
      : { defaultValue: variable.defaultValue }),
    key: variable.key,
    required: variable.required,
    valueType: variable.valueType,
  };
}

export function projectArchitectureOutputIntentV1(
  output: ArchitectureOutputV3,
  targetKeys: ReadonlyMap<string, string>,
) {
  return {
    key: output.key,
    sensitive: output.sensitive,
    source:
      output.source.kind === "variable"
        ? { kind: output.source.kind, variableId: output.source.variableId }
        : {
            attribute: output.source.attribute,
            kind: output.source.kind,
            nodeId: output.source.nodeId,
            targetKey: targetKeys.get(output.source.nodeId),
          },
  };
}

export function getReviewedPublicExposureV1(configuration: {
  readonly values: Readonly<Record<string, unknown>>;
}): "none" | "private" | "public" | undefined {
  const reviewedKeys = [
    "publicExposure",
    "exposure",
    "accessTier",
    "connectivityType",
    "endpointType",
  ] as const;
  for (const key of reviewedKeys) {
    const candidate = configuration.values[key];
    const value =
      typeof candidate === "object" &&
      candidate !== null &&
      !Array.isArray(candidate)
        ? (candidate as Readonly<Record<string, unknown>>)["value"]
        : undefined;
    if (typeof value !== "string") continue;
    const normalized = value.toLowerCase();
    if (normalized === "public" || normalized === "public-internet") {
      return "public";
    }
    if (normalized === "private" || normalized === "internal") {
      return "private";
    }
    if (normalized === "none" || normalized === "isolated") return "none";
  }
  return undefined;
}
