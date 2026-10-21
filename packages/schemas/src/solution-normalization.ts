import type {
  ActiveIssueCollectionV1,
  ActiveIssueV1,
} from "./active-issue-v1.js";
import type {
  AiAuthoredExtensionCollectionV1,
  AiAuthoredExtensionV1,
} from "./ai-authored-extension-v1.js";
import type {
  ApplicationContractRecordV1,
  ApplicationContractsV1,
} from "./application-contracts-v1.js";
import type { EvidenceCollectionV1, EvidenceRecordV1 } from "./evidence-v1.js";
import type { ExternalResourceReferenceDocumentV1 } from "./external-resource-reference-v1.js";
import type { SolutionGenerationCoverageV1 } from "./generation-coverage-v1.js";
import type { ObservedSolutionV1 } from "./observed-solution-v1.js";
import type { ReconciliationProposalV1 } from "./reconciliation-proposal-v1.js";
import type {
  CloudMarkupRepositoryLockV1,
  CloudMarkupRepositoryManifestV1,
} from "./repository-ownership-v1.js";
import type { RepositorySnapshotV1 } from "./repository-snapshot-v1.js";
import type { SolutionRevisionManifestV1 } from "./solution-revision-v1.js";
import type { WorkloadBehaviorV2, WorkloadV2 } from "./workload-behavior-v2.js";

function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sortBy<T>(values: T[], key: (value: T) => string): void {
  values.sort((left, right) => compareUtf16(key(left), key(right)));
}

function canonicalKey(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalKey(item)).join(",")}]`;
  }

  return `{${Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => compareUtf16(left, right))
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${canonicalKey(entryValue)}`,
    )
    .join(",")}}`;
}

function contractReferenceKey(reference: {
  readonly contractId: string;
  readonly contractVersion: string;
  readonly digest: string;
}): string {
  return `${reference.contractId}\u0000${reference.contractVersion}\u0000${reference.digest}`;
}

function normalizeApplicationContractInPlace(
  contract: ApplicationContractRecordV1,
): void {
  contract.provenance.sourceReferenceIds.sort(compareUtf16);

  switch (contract.contractKind) {
    case "http-api":
      sortBy(
        contract.request.parameters,
        (parameter) => `${parameter.location}\u0000${parameter.name}`,
      );
      sortBy(
        contract.responses,
        (response) =>
          `${String(response.statusCode).padStart(3, "0")}\u0000${response.mediaType ?? ""}`,
      );
      contract.responses.forEach((response) => {
        sortBy(response.headers, ({ name }) => name);
      });
      break;
    case "event-message":
      sortBy(contract.headers, ({ name }) => name);
      break;
    case "data-entity":
      sortBy(contract.fields, ({ name }) => name);
      sortBy(contract.indexes, ({ indexId }) => indexId);
      contract.supportedOperations.sort(compareUtf16);
      break;
    case "auth":
      sortBy(contract.claims, ({ name, source }) => `${name}\u0000${source}`);
      sortBy(contract.roles, ({ roleId }) => roleId);
      contract.roles.forEach((role) => {
        sortBy(
          role.claimRequirements,
          (requirement) =>
            `${requirement.claimName}\u0000${requirement.match}\u0000${requirement.expectedValue ?? ""}`,
        );
      });
      break;
    case "behavior-operation":
      contract.authorization?.permittedRoleIds.sort(compareUtf16);
      sortBy(
        contract.failureOutcomes,
        ({ category, description }) => `${category}\u0000${description}`,
      );
      break;
    case "test-case":
      sortBy(contract.preconditions, canonicalKey);
      sortBy(
        contract.fixtureReferences,
        ({ fixtureId, digest }) => `${fixtureId}\u0000${digest}`,
      );
      sortBy(contract.expectations, ({ expectationId }) => expectationId);
      break;
  }
}

export function normalizeApplicationContractRecordV1(
  contract: ApplicationContractRecordV1,
): ApplicationContractRecordV1 {
  const normalized = clone(contract);
  normalizeApplicationContractInPlace(normalized);
  return normalized;
}
export function normalizeApplicationContractsV1(
  contracts: ApplicationContractsV1,
): ApplicationContractsV1 {
  const normalized = clone(contracts);
  sortBy(
    normalized.contracts,
    (contract) =>
      `${contract.contractId}\u0000${contract.contractVersion}\u0000${contract.contractKind}`,
  );
  normalized.contracts.forEach(normalizeApplicationContractInPlace);
  return normalized;
}

function normalizeWorkloadV2(workload: WorkloadV2): void {
  sortBy(workload.operations, ({ id }) => id);
  sortBy(workload.behaviorContracts, contractReferenceKey);
  sortBy(workload.triggers, ({ id }) => id);
  sortBy(workload.downstreamActions, ({ id }) => id);
  sortBy(workload.environment, ({ id }) => id);
  workload.unresolvedRequirementIds.sort(compareUtf16);
  sortBy(workload.entrypoints, ({ entrypointId }) => entrypointId);
  sortBy(workload.httpRoutes, ({ routeId }) => routeId);
  sortBy(workload.eventBindings, ({ bindingId }) => bindingId);
  sortBy(workload.schedules, ({ bindingId }) => bindingId);
  workload.schedules.forEach((binding) => {
    if (binding.schedule.kind === "weekly") {
      binding.schedule.days.sort(compareUtf16);
    }
  });
  sortBy(workload.dataBindings, ({ bindingId }) => bindingId);
  sortBy(workload.authorization, ({ bindingId }) => bindingId);
  workload.authorization.forEach((binding) => {
    binding.operationIds.sort(compareUtf16);
    binding.permittedRoleIds.sort(compareUtf16);
  });
  sortBy(workload.idempotency, ({ policyId }) => policyId);
  workload.idempotency.forEach((policy) => {
    policy.operationIds.sort(compareUtf16);
  });
  workload.observability.signals.sort(compareUtf16);
  sortBy(
    workload.observability.healthChecks,
    ({ healthCheckId }) => healthCheckId,
  );
  sortBy(workload.observability.smokeTests, contractReferenceKey);
  sortBy(workload.tests, ({ bindingId }) => bindingId);
  sortBy(workload.sourceOwnership, ({ declarationId }) => declarationId);
  sortBy(workload.extensionPoints, ({ extensionPointId }) => extensionPointId);
  workload.extensionPoints.forEach((extensionPoint) => {
    extensionPoint.permittedOwnership.sort(compareUtf16);
  });
  sortBy(workload.extensions, ({ extensionId }) => extensionId);
  workload.extensions.forEach((extension) => {
    extension.validationEvidenceIds.sort(compareUtf16);
  });
  sortBy(
    workload.implementationRequirements,
    ({ implementationRequirementId }) => implementationRequirementId,
  );
  workload.implementationRequirements.forEach((requirement) => {
    sortBy(requirement.affectedContractReferences, contractReferenceKey);
  });
  sortBy(
    workload.compatibility.applicationGenerators,
    (compatibility) =>
      `${compatibility.generatorId}\u0000${compatibility.minimumVersion}\u0000${compatibility.templateId}\u0000${compatibility.templateVersion}`,
  );
  workload.compatibility.applicationGenerators.forEach((compatibility) => {
    compatibility.supportedModes.sort(compareUtf16);
  });
  sortBy(
    workload.compatibility.modelGateways,
    (compatibility) =>
      `${compatibility.modelGatewayContractVersion}\u0000${compatibility.modelFamily}\u0000${compatibility.promptTemplateId}\u0000${compatibility.promptVersion}`,
  );
  workload.compatibility.modelGateways.forEach((compatibility) => {
    compatibility.requiredValidation.sort(compareUtf16);
  });
  if (workload.implementation.mode === "ai-assisted-custom") {
    workload.implementation.extension.validationEvidenceIds.sort(compareUtf16);
  }
}

export function normalizeWorkloadBehaviorV2(
  behavior: WorkloadBehaviorV2,
): WorkloadBehaviorV2 {
  const normalized = clone(behavior);
  sortBy(normalized.workloads, ({ id }) => id);
  normalized.workloads.forEach(normalizeWorkloadV2);
  return normalized;
}

export function normalizeExternalResourceReferenceDocumentV1(
  document: ExternalResourceReferenceDocumentV1,
): ExternalResourceReferenceDocumentV1 {
  const normalized = clone(document);
  sortBy(normalized.resources, ({ id }) => id);
  normalized.resources.forEach((resource) => {
    resource.architectureNodeIds.sort(compareUtf16);
    sortBy(resource.addresses, ({ addressId }) => addressId);
    resource.lifecycle.iacTargets.sort((left, right) =>
      compareUtf16(left.target, right.target),
    );
    sortBy(resource.interfaces, ({ interfaceId }) => interfaceId);
    resource.interfaces.forEach((resourceInterface) => {
      sortBy(resourceInterface.contracts, contractReferenceKey);
      if ("secretReferences" in resourceInterface.authentication) {
        resourceInterface.authentication.secretReferences.sort(compareUtf16);
      }
    });
    resource.dataClassifications.sort(compareUtf16);
    sortBy(resource.evidence, ({ evidenceId }) => evidenceId);
    sortBy(resource.extractedCandidates, ({ candidateId }) => candidateId);
    sortBy(
      resource.unresolvedInformation,
      ({ unresolvedInformationId }) => unresolvedInformationId,
    );
  });
  return normalized;
}

export function normalizeCloudMarkupRepositoryLockV1(
  lock: CloudMarkupRepositoryLockV1,
): CloudMarkupRepositoryLockV1 {
  const normalized = clone(lock);
  sortBy(
    normalized.inputs,
    (input) => `${input.kind}\u0000${input.id}\u0000${input.version}`,
  );
  return normalized;
}

export function normalizeCloudMarkupRepositoryManifestV1(
  manifest: CloudMarkupRepositoryManifestV1,
): CloudMarkupRepositoryManifestV1 {
  const normalized = clone(manifest);
  sortBy(normalized.ownership, ({ declarationId }) => declarationId);
  sortBy(normalized.files, ({ path }) => path);
  return normalized;
}

export function normalizeRepositorySnapshotV1(
  snapshot: RepositorySnapshotV1,
): RepositorySnapshotV1 {
  const normalized = clone(snapshot);
  sortBy(normalized.selectedPaths, ({ ruleId }) => ruleId);
  sortBy(normalized.ignoreRules, ({ ruleId }) => ruleId);
  sortBy(normalized.files, ({ path }) => path);
  normalized.files.forEach((file) => file.detectedKinds.sort(compareUtf16));
  sortBy(
    normalized.detectedTypes,
    (detected) =>
      `${detected.category}\u0000${detected.typeId}\u0000${detected.detectorId}\u0000${detected.detectorVersion}`,
  );
  normalized.detectedTypes.forEach((detected) => {
    detected.evidenceIds.sort(compareUtf16);
  });
  normalized.redaction.categories.sort(compareUtf16);
  sortBy(normalized.evidence, ({ evidenceId }) => evidenceId);
  sortBy(normalized.parseFindings, ({ findingId }) => findingId);
  normalized.parseFindings.forEach((finding) => {
    finding.evidenceIds.sort(compareUtf16);
  });
  sortBy(
    normalized.inferredRelationships,
    ({ relationshipId }) => relationshipId,
  );
  normalized.inferredRelationships.forEach((relationship) => {
    relationship.evidenceIds.sort(compareUtf16);
  });
  sortBy(normalized.unsupportedFiles, ({ path }) => path);
  return normalized;
}

export function normalizeObservedSolutionV1(
  observed: ObservedSolutionV1,
): ObservedSolutionV1 {
  const normalized = clone(observed);
  sortBy(normalized.evidence, ({ sourceEvidenceId }) => sourceEvidenceId);
  sortBy(normalized.resources, ({ observedResourceId }) => observedResourceId);
  sortBy(
    normalized.connections,
    ({ observedConnectionId }) => observedConnectionId,
  );
  sortBy(normalized.workloads, ({ observedWorkloadId }) => observedWorkloadId);
  sortBy(normalized.externalResources, ({ candidateId }) => candidateId);
  sortBy(
    normalized.generatedFileOwnership,
    ({ observedGeneratedFileId }) => observedGeneratedFileId,
  );
  const evidencedRecords = [
    ...normalized.resources,
    ...normalized.connections,
    ...normalized.workloads,
    ...normalized.externalResources,
    ...normalized.generatedFileOwnership,
  ];
  evidencedRecords.forEach((record) => {
    record.sourceEvidenceIds.sort(compareUtf16);
  });
  normalized.workloads.forEach((workload) => {
    workload.entrypoints.sort(compareUtf16);
    workload.applicationRelationshipIds.sort(compareUtf16);
  });
  return normalized;
}

function normalizeRecordProvenance(record: {
  provenance: { inputDigests: string[] };
}): void {
  record.provenance.inputDigests.sort(compareUtf16);
}

export function normalizeReconciliationProposalV1(
  proposal: ReconciliationProposalV1,
): ReconciliationProposalV1 {
  const normalized = clone(proposal);
  normalizeRecordProvenance(normalized);
  sortBy(normalized.operations, ({ operationId }) => operationId);
  normalized.operations.forEach((operation) => {
    if (operation.kind === "resolve-ambiguous-mapping") {
      sortBy(operation.candidates, ({ mappingId }) => mappingId);
      operation.candidates.forEach((candidate) => {
        candidate.evidenceIds.sort(compareUtf16);
      });
    }
    if (operation.kind === "remove-stale-imported-evidence") {
      operation.staleEvidenceIds.sort(compareUtf16);
    }
  });
  if (
    normalized.review.state === "accepted" ||
    normalized.review.state === "partially-accepted"
  ) {
    normalized.review.acceptedOperationIds.sort(compareUtf16);
    if (normalized.review.state === "partially-accepted") {
      normalized.review.rejectedOperationIds.sort(compareUtf16);
    }
  }
  return normalized;
}

function normalizeCoverage(coverage: SolutionGenerationCoverageV1): void {
  sortBy(
    coverage.evidence,
    ({ requirement, evidenceId }) => `${requirement}\u0000${evidenceId}`,
  );
  coverage.missingRequirements.sort(compareUtf16);
  sortBy(coverage.workloads, ({ workloadId }) => workloadId);
  coverage.workloads.forEach((workload) => {
    sortBy(
      workload.evidence,
      ({ requirement, evidenceId }) => `${requirement}\u0000${evidenceId}`,
    );
    workload.missingRequirements.sort(compareUtf16);
    workload.unresolvedRequirementIds.sort(compareUtf16);
  });
}

export function normalizeSolutionGenerationCoverageV1(
  coverage: SolutionGenerationCoverageV1,
): SolutionGenerationCoverageV1 {
  const normalized = clone(coverage);
  normalizeCoverage(normalized);
  return normalized;
}

export function normalizeAiAuthoredExtensionV1(
  extension: AiAuthoredExtensionV1,
): AiAuthoredExtensionV1 {
  const normalized = clone(extension);
  normalized.request.acceptanceCriteria.sort(compareUtf16);
  normalized.request.capabilityIds.sort(compareUtf16);
  normalized.request.constraints.sort(compareUtf16);
  normalized.request.prohibitedCapabilities.sort(compareUtf16);
  normalized.model.usageEventIds.sort(compareUtf16);
  sortBy(
    normalized.dependencies,
    (dependency) =>
      `${dependency.ecosystem}\u0000${dependency.name}\u0000${dependency.requestedVersion}`,
  );
  sortBy(
    normalized.outputs,
    ({ path, kind, digest }) => `${path}\u0000${kind}\u0000${digest}`,
  );
  sortBy(normalized.ownedPaths, ({ path }) => path);
  normalized.issueIds.sort(compareUtf16);
  sortBy(normalized.sourceReferences, canonicalKey);
  sortBy(normalized.validation, ({ checkId }) => checkId);
  if (normalized.exportSafety.state === "not-safe") {
    normalized.exportSafety.missingEvidenceKinds.sort(compareUtf16);
  } else {
    normalized.exportSafety.evidenceIds.sort(compareUtf16);
  }
  return normalized;
}

export function normalizeAiAuthoredExtensionCollectionV1(
  collection: AiAuthoredExtensionCollectionV1,
): AiAuthoredExtensionCollectionV1 {
  const normalized = clone(collection);
  sortBy(normalized.extensions, ({ id }) => id);
  normalized.extensions = normalized.extensions.map((extension) =>
    normalizeAiAuthoredExtensionV1(extension),
  );
  return normalized;
}

export function normalizeActiveIssueV1(issue: ActiveIssueV1): ActiveIssueV1 {
  const normalized = clone(issue);
  normalizeRecordProvenance(normalized);
  sortBy(normalized.affected, canonicalKey);
  sortBy(
    normalized.closureRequirements,
    (requirement) =>
      `${String(requirement.evidenceLevel.rank).padStart(2, "0")}\u0000${requirement.evidenceLevel.kind}\u0000${requirement.evidenceCheckId}\u0000${requirement.description}`,
  );
  if (normalized.lifecycle.state === "resolved") {
    normalized.lifecycle.evidenceIds.sort(compareUtf16);
  }
  return normalized;
}

export function normalizeActiveIssueCollectionV1(
  collection: ActiveIssueCollectionV1,
): ActiveIssueCollectionV1 {
  const normalized = clone(collection);
  sortBy(
    normalized.issues,
    (issue) =>
      `${issue.id}\u0000${String(issue.recordVersion).padStart(10, "0")}`,
  );
  normalized.issues = normalized.issues.map((issue) =>
    normalizeActiveIssueV1(issue),
  );
  return normalized;
}

export function normalizeEvidenceRecordV1(
  evidence: EvidenceRecordV1,
): EvidenceRecordV1 {
  const normalized = clone(evidence);
  normalizeRecordProvenance(normalized);
  sortBy(
    normalized.artifacts,
    ({ digest, mediaType }) => `${digest}\u0000${mediaType}`,
  );
  sortBy(normalized.checks, ({ checkId }) => checkId);
  normalized.checks.forEach((check) => {
    check.artifactDigests.sort(compareUtf16);
    check.issueIds.sort(compareUtf16);
  });
  sortBy(
    normalized.models,
    (model) =>
      `${model.providerId}\u0000${model.modelId}\u0000${model.modelVersion}\u0000${model.promptVersion}`,
  );
  sortBy(
    normalized.tools,
    (tool) => `${tool.id}\u0000${tool.version}\u0000${tool.digest ?? ""}`,
  );
  return normalized;
}

export function normalizeEvidenceCollectionV1(
  collection: EvidenceCollectionV1,
): EvidenceCollectionV1 {
  const normalized = clone(collection);
  sortBy(normalized.records, ({ id }) => id);
  normalized.records = normalized.records.map((record) =>
    normalizeEvidenceRecordV1(record),
  );
  return normalized;
}

export function normalizeSolutionRevisionManifestV1(
  manifest: SolutionRevisionManifestV1,
): SolutionRevisionManifestV1 {
  const normalized = clone(manifest);
  normalized.contracts.recordHashes.sort(compareUtf16);
  normalized.versions.policy.sort((left, right) =>
    compareUtf16(
      `${left.id}\u0000${left.version}\u0000${left.digest ?? ""}`,
      `${right.id}\u0000${right.version}\u0000${right.digest ?? ""}`,
    ),
  );
  normalized.aiExtensionIds.sort(compareUtf16);
  normalized.assumptions.sort(compareUtf16);
  normalized.evidenceIdsAtFreeze.sort(compareUtf16);
  normalized.issueIdsAtFreeze.sort(compareUtf16);
  sortBy(
    normalized.repositoryObservations,
    ({ repositorySnapshotId, observedSolutionId }) =>
      `${repositorySnapshotId}\u0000${observedSolutionId}`,
  );
  sortBy(normalized.sourceOwnership, ({ path }) => path);
  normalized.unresolvedDecisionIds.sort(compareUtf16);
  normalizeCoverage(normalized.generationCoverage);
  return normalized;
}
