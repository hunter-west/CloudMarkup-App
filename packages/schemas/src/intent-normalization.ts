import type { IntentDocumentV1 } from "./intent-document-v1.js";

function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return compareUtf16(left.id, right.id);
}

function sortStrings(values: string[]): void {
  values.sort(compareUtf16);
}

function sortRationaleConsiderations(
  considerations: IntentDocumentV1["alternatives"][number]["rationale"]["considerations"],
): void {
  considerations.sort(
    (left, right) =>
      compareUtf16(left.kind, right.kind) ||
      compareUtf16(left.source, right.source) ||
      compareUtf16(left.statement, right.statement),
  );
}

const latencyPercentileOrder = {
  p50: 0,
  p95: 1,
  p99: 2,
} as const;

export function normalizeIntentDocumentV1(
  document: IntentDocumentV1,
): IntentDocumentV1 {
  const normalized = JSON.parse(JSON.stringify(document)) as IntentDocumentV1;

  if (normalized.application.capabilities.state === "known") {
    normalized.application.capabilities.items.sort(byId);
  }

  for (const direction of [
    normalized.connectivity.ingress,
    normalized.connectivity.egress,
  ]) {
    if (direction.state === "known") {
      direction.items.sort(byId);
      direction.items.forEach((requirement) => {
        sortStrings(requirement.capabilityIds);
      });
    }
  }

  if (normalized.identity.authentication.state === "known") {
    sortStrings(normalized.identity.authentication.principals);
    sortStrings(normalized.identity.authentication.methods);
    sortStrings(normalized.identity.authentication.requirements);
  }

  if (normalized.identity.authorization.state === "known") {
    sortStrings(normalized.identity.authorization.models);
    sortStrings(normalized.identity.authorization.requirements);
  }

  if (normalized.data.state === "known") {
    normalized.data.items.sort(byId);
    normalized.data.items.forEach((category) => {
      sortStrings(category.capabilityIds);
      if (category.residency.state === "known") {
        sortStrings(category.residency.locations);
      }
    });
  }

  if (normalized.workflows.state === "known") {
    normalized.workflows.items.sort(byId);
    normalized.workflows.items.forEach((workflow) => {
      sortStrings(workflow.capabilityIds);
    });
  }

  if (normalized.quality.latency.state === "known") {
    normalized.quality.latency.targets.sort(
      (left, right) =>
        latencyPercentileOrder[left.percentile] -
        latencyPercentileOrder[right.percentile],
    );
  }

  if (normalized.quality.scale.state === "known") {
    normalized.quality.scale.metrics.sort((left, right) =>
      compareUtf16(left.metric, right.metric),
    );
  }

  if (normalized.compliance.state === "known") {
    normalized.compliance.items.sort(byId);
    normalized.compliance.items.forEach((constraint) => {
      sortStrings(constraint.jurisdictions);
    });
  }

  normalized.assumptions.sort(byId);
  normalized.unresolvedQuestions.sort(byId);
  normalized.decisions.sort(byId);
  normalized.decisions.forEach((decision) => {
    sortRationaleConsiderations(decision.rationale.considerations);
  });
  normalized.alternatives.sort(byId);
  normalized.alternatives.forEach((alternative) => {
    sortRationaleConsiderations(alternative.rationale.considerations);
  });

  return normalized;
}
