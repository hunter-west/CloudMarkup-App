import type {
  ArchitectureDocumentV1,
  ElementLifecycle,
} from "./architecture-document-v1.js";
import type { ArchitectureDocumentV2 } from "./architecture-document-v2.js";
import type { ArchitectureDocumentV3 } from "./architecture-document-v3.js";
import {
  normalizeApplicationContractsV1,
  normalizeExternalResourceReferenceDocumentV1,
  normalizeWorkloadBehaviorV2,
} from "./solution-normalization.js";
import type { WorkloadBehaviorV1, WorkloadV1 } from "./workload-behavior-v1.js";

function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return compareUtf16(left.id, right.id);
}

function normalizeLifecycle(lifecycle: ElementLifecycle): void {
  if (lifecycle.ownership === "user") {
    return;
  }

  lifecycle.provenance.dependentNodeIds.sort(compareUtf16);
  lifecycle.provenance.dependentEdgeIds.sort(compareUtf16);
}

function normalizeWorkload(workload: WorkloadV1): void {
  workload.operations.sort(byId);
  workload.triggers.sort(byId);
  workload.downstreamActions.sort(byId);
  workload.environment.sort(byId);
  workload.unresolvedRequirementIds.sort(compareUtf16);
}

export function normalizeWorkloadBehaviorV1(
  behavior: WorkloadBehaviorV1,
): WorkloadBehaviorV1 {
  const normalized = JSON.parse(JSON.stringify(behavior)) as WorkloadBehaviorV1;
  normalized.workloads.sort(byId);
  normalized.workloads.forEach(normalizeWorkload);
  return normalized;
}

function normalizeArchitectureDocument<
  T extends
    ArchitectureDocumentV1 | ArchitectureDocumentV2 | ArchitectureDocumentV3,
>(document: T): T {
  const normalized = JSON.parse(JSON.stringify(document)) as T;

  normalized.nodes.sort(byId);
  normalized.nodes.forEach((node) => {
    normalizeLifecycle(node.semantic.lifecycle);
  });

  normalized.edges.sort(byId);
  normalized.edges.forEach((edge) => {
    normalizeLifecycle(edge.semantic.lifecycle);
  });

  normalized.variables.sort(byId);
  normalized.outputs.sort(byId);
  normalized.assumptions.sort(byId);
  normalized.unresolvedRequirements.sort(byId);

  if (normalized.schemaVersion === 2) {
    normalized.workloadBehavior = normalizeWorkloadBehaviorV1(
      normalized.workloadBehavior,
    );
  } else if (normalized.schemaVersion === 3) {
    normalized.workloadBehavior = normalizeWorkloadBehaviorV2(
      normalized.workloadBehavior,
    );
    normalized.applicationContracts = normalizeApplicationContractsV1(
      normalized.applicationContracts,
    );
    normalized.externalResources = normalizeExternalResourceReferenceDocumentV1(
      normalized.externalResources,
    );
  }

  return normalized;
}

export function normalizeArchitectureDocumentV1(
  document: ArchitectureDocumentV1,
): ArchitectureDocumentV1 {
  return normalizeArchitectureDocument(document);
}

export function normalizeArchitectureDocumentV2(
  document: ArchitectureDocumentV2,
): ArchitectureDocumentV2 {
  return normalizeArchitectureDocument(document);
}

export function normalizeArchitectureDocumentV3(
  document: ArchitectureDocumentV3,
): ArchitectureDocumentV3 {
  return normalizeArchitectureDocument(document);
}
