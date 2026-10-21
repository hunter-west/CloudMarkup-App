import {
  applicationContractRecordV1Schema,
  architectureDocumentV3Schema,
  assistantOperationBatchV1Schema,
  assistantOperationV1Schema,
  externalResourceV1Schema,
  repositoryPathOwnershipV1Schema,
  workloadOperationV1Schema,
  workloadV2Schema,
  type ApplicationContractRecordV1,
  type ArchitectureDocumentV3,
  type AssistantOperationBatchV1,
  type AssistantOperationV1,
  type AssistantReviewDiffV1,
  type ReconciliationOperationV1,
  type WorkloadV2,
} from "@cloudmarkup/schemas";

import {
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  getExternalResourceReferenceContentHash,
  getWorkloadBehaviorContentHash,
  hashCanonicalValue,
} from "./document-hashing.js";
import { applyGraphCommand } from "./graph-commands.js";
import { validateArchitectureDocumentSemantics } from "./semantic-validation.js";

export interface AssistantOperationLimitsV1 {
  readonly maximumApplicationContracts: number;
  readonly maximumEdges: number;
  readonly maximumExternalResources: number;
  readonly maximumNodes: number;
  readonly maximumOperations: number;
  readonly maximumSourceOwnershipDeclarations: number;
  readonly maximumTestScenarios: number;
  readonly maximumWorkloadOperations: number;
  readonly maximumWorkloads: number;
}

export interface AssistantOperationTrustedProvenanceV1 {
  readonly applicationContract: ApplicationContractRecordV1["provenance"];
  readonly workload: WorkloadV2["provenance"];
}

export interface AssistantOperationApplicationResultV1 {
  readonly candidate: ArchitectureDocumentV3;
  readonly clarifications: readonly Extract<
    AssistantOperationV1,
    { readonly kind: "request-clarification" }
  >[];
  readonly diffs: readonly AssistantReviewDiffV1[];
  readonly extensionRequests: readonly Extract<
    AssistantOperationV1,
    { readonly kind: "upsert-ai-extension-request" }
  >[];
  readonly reconciliationReviews: readonly Extract<
    AssistantOperationV1,
    { readonly kind: "review-repository-difference" }
  >[];
  readonly writeAuthority: "none";
}

export type AssistantOperationApplicationIssueCode =
  | "batch-limit-exceeded"
  | "content-precondition-failed"
  | "duplicate-resource"
  | "final-limit-exceeded"
  | "graph-command-identity-mismatch"
  | "operation-not-supported"
  | "record-precondition-failed"
  | "resource-not-found"
  | "semantic-validation-failed"
  | "stable-identity-change"
  | "ungrounded-external-authority";

export interface AssistantOperationApplicationIssueV1 {
  readonly code: AssistantOperationApplicationIssueCode;
  readonly message: string;
  readonly path: string;
}

export class AssistantOperationApplicationError extends Error {
  public readonly issues: readonly AssistantOperationApplicationIssueV1[];

  public constructor(issues: readonly AssistantOperationApplicationIssueV1[]) {
    super(
      issues
        .map(({ code, message, path }) => `${path}: ${message} [${code}]`)
        .join("\n"),
    );
    this.name = "AssistantOperationApplicationError";
    this.issues = issues;
  }
}

function fail(
  code: AssistantOperationApplicationIssueCode,
  path: string,
  message: string,
): never {
  throw new AssistantOperationApplicationError([{ code, message, path }]);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertDigest(
  actual: string,
  expected: string,
  path: string,
  label: string,
): void {
  if (actual !== expected) {
    fail(
      "content-precondition-failed",
      path,
      `${label} changed after this operation was proposed.`,
    );
  }
}

function duplicate(
  values: readonly string[],
  value: string,
  path: string,
  label: string,
): void {
  if (values.includes(value)) {
    fail("duplicate-resource", path, `${label} already exists.`);
  }
}

function indexOf(
  values: readonly string[],
  value: string,
  path: string,
  label: string,
): number {
  const index = values.indexOf(value);
  if (index < 0) {
    fail("resource-not-found", path, `${label} does not exist.`);
  }
  return index;
}

/** Deterministic review projection only; this never applies an operation. */
export function projectAssistantOperationDiffV1(
  input: AssistantOperationV1,
): AssistantReviewDiffV1 {
  const operation = assistantOperationV1Schema.parse(input);
  const base: Pick<AssistantReviewDiffV1, "operationIds" | "technical"> = {
    operationIds: [operation.operationId],
    technical: {
      evidenceIds:
        operation.kind === "request-clarification"
          ? [...operation.evidenceIds]
          : [],
      ids: [operation.operationId],
      paths:
        operation.kind === "set-source-ownership"
          ? [operation.declaration.path]
          : [],
      policyActions: [],
      validationDeltas: [],
    },
  };
  switch (operation.kind) {
    case "graph-command":
      return {
        ...base,
        category: "architecture",
        primary: `Architecture change: ${operation.command.kind.replaceAll("-", " ")}.`,
      };
    case "add-workload":
    case "edit-workload":
    case "add-workload-operation":
    case "edit-workload-operation":
    case "set-source-ownership":
      return {
        ...base,
        category: "workload",
        primary: operation.rationale,
      };
    case "add-application-contract":
    case "edit-application-contract":
    case "add-test-scenario":
    case "edit-test-scenario":
      return {
        ...base,
        category: "contract",
        primary: operation.rationale,
      };
    case "add-external-resource":
    case "edit-external-resource":
      return {
        ...base,
        category: "external-resource",
        primary: operation.rationale,
      };
    case "upsert-ai-extension-request":
      return {
        ...base,
        category: "custom-generation",
        primary: operation.rationale,
        technical: {
          ...base.technical,
          paths: operation.ownedPaths.map(({ path }) => path),
        },
      };
    case "review-repository-difference":
      return {
        ...base,
        category: "repository-observation",
        primary: operation.rationale,
      };
    case "request-clarification":
      return {
        ...base,
        category: "clarification",
        primary: operation.question,
      };
  }
}

function assertLimits(
  candidate: ArchitectureDocumentV3,
  limits: AssistantOperationLimitsV1,
): void {
  const testCount = candidate.applicationContracts.contracts.filter(
    ({ contractKind }) => contractKind === "test-case",
  ).length;
  const workloadOperationCount = candidate.workloadBehavior.workloads.reduce(
    (count, workload) => count + workload.operations.length,
    0,
  );
  const sourceOwnershipCount = candidate.workloadBehavior.workloads.reduce(
    (count, workload) => count + workload.sourceOwnership.length,
    0,
  );
  const checks = [
    [candidate.nodes.length, limits.maximumNodes, "node"],
    [candidate.edges.length, limits.maximumEdges, "edge"],
    [
      candidate.workloadBehavior.workloads.length,
      limits.maximumWorkloads,
      "Workload",
    ],
    [
      workloadOperationCount,
      limits.maximumWorkloadOperations,
      "Workload operation",
    ],
    [
      candidate.applicationContracts.contracts.length,
      limits.maximumApplicationContracts,
      "application contract",
    ],
    [testCount, limits.maximumTestScenarios, "test scenario"],
    [
      candidate.externalResources.resources.length,
      limits.maximumExternalResources,
      "External Resource",
    ],
    [
      sourceOwnershipCount,
      limits.maximumSourceOwnershipDeclarations,
      "source-ownership declaration",
    ],
  ] as const;
  const exceeded = checks.find(([current, maximum]) => current > maximum);
  if (exceeded !== undefined) {
    fail(
      "final-limit-exceeded",
      "$",
      `${exceeded[2]} count exceeds the trusted limit.`,
    );
  }
}

function validateCandidate(
  candidate: ArchitectureDocumentV3,
): ArchitectureDocumentV3 {
  const parsed = architectureDocumentV3Schema.parse(candidate);
  const issues = validateArchitectureDocumentSemantics(parsed);
  if (issues.length > 0) {
    throw new AssistantOperationApplicationError(
      issues.map((issue) => ({
        code: "semantic-validation-failed" as const,
        message: issue.message,
        path: issue.path,
      })),
    );
  }
  return parsed;
}

function contractIdentityProjection(
  contract: ApplicationContractRecordV1,
): unknown {
  return {
    contractId: contract.contractId,
    contractKind: contract.contractKind,
    ...(contract.contractKind === "data-entity"
      ? { indexIds: contract.indexes.map(({ indexId }) => indexId) }
      : {}),
    ...(contract.contractKind === "auth"
      ? { roleIds: contract.roles.map(({ roleId }) => roleId) }
      : {}),
    ...(contract.contractKind === "test-case"
      ? {
          expectationIds: contract.expectations.map(
            ({ expectationId }) => expectationId,
          ),
        }
      : {}),
  };
}

function externalIdentityProjection(
  resource: ArchitectureDocumentV3["externalResources"]["resources"][number],
): unknown {
  return {
    addressIds: resource.addresses.map(({ addressId }) => addressId),
    candidateIds: resource.extractedCandidates.map(
      ({ candidateId }) => candidateId,
    ),
    id: resource.id,
    interfaceIds: resource.interfaces.map(({ interfaceId }) => interfaceId),
    unresolvedInformationIds: resource.unresolvedInformation.map(
      ({ unresolvedInformationId }) => unresolvedInformationId,
    ),
  };
}

function externalAuthorityProjection(
  resource: ArchitectureDocumentV3["externalResources"]["resources"][number],
): unknown {
  return {
    evidence: resource.evidence,
    interfaces: resource.interfaces.map(
      ({ authentication, contracts, interfaceId }) => ({
        authentication,
        contracts,
        interfaceId,
      }),
    ),
  };
}
function applyGraph(
  candidate: ArchitectureDocumentV3,
  operation: Extract<AssistantOperationV1, { kind: "graph-command" }>,
): ArchitectureDocumentV3 {
  if (operation.operationId !== operation.command.commandId) {
    fail(
      "graph-command-identity-mismatch",
      "$.command.commandId",
      "The Assistant operation and Graph Command must share one identity.",
    );
  }
  return architectureDocumentV3Schema.parse(
    applyGraphCommand(candidate, operation.command).document,
  );
}

function applyReconciliation(
  candidate: ArchitectureDocumentV3,
  operation: Extract<
    AssistantOperationV1,
    { kind: "review-repository-difference" }
  >,
): ArchitectureDocumentV3 {
  if (operation.decision !== "accept") return candidate;
  const reconciliation: ReconciliationOperationV1 =
    operation.reconciliationOperation;
  if (reconciliation.kind === "accept-observed-graph-change") {
    assertDigest(
      getArchitectureDocumentContentHash(candidate),
      reconciliation.expectedArchitectureContentHash,
      "$.reconciliationOperation.expectedArchitectureContentHash",
      "Architecture",
    );
    const applied = architectureDocumentV3Schema.parse(
      applyGraphCommand(candidate, reconciliation.graphCommands).document,
    );
    assertDigest(
      getArchitectureDocumentContentHash(applied),
      reconciliation.resultingArchitectureContentHash,
      "$.reconciliationOperation.resultingArchitectureContentHash",
      "Reconciled Architecture",
    );
    return applied;
  }
  if (
    reconciliation.kind === "keep-observed-only" ||
    reconciliation.kind === "ignore-observation" ||
    reconciliation.kind === "update-generated-output-to-design"
  ) {
    return candidate;
  }
  fail(
    "operation-not-supported",
    "$.reconciliationOperation",
    "This accepted repository difference requires a configured deterministic domain operation.",
  );
}

function applyOperation(input: {
  readonly candidate: ArchitectureDocumentV3;
  readonly operation: AssistantOperationV1;
  readonly provenance: AssistantOperationTrustedProvenanceV1;
}): ArchitectureDocumentV3 {
  const { candidate, operation, provenance } = input;
  switch (operation.kind) {
    case "graph-command":
      return applyGraph(candidate, operation);
    case "add-workload": {
      assertDigest(
        getWorkloadBehaviorContentHash(candidate.workloadBehavior),
        operation.expectedWorkloadContentHash,
        "$.expectedWorkloadContentHash",
        "Workload document",
      );
      duplicate(
        candidate.workloadBehavior.workloads.map(({ id }) => id),
        operation.workload.id,
        "$.workload.id",
        "Workload",
      );
      return architectureDocumentV3Schema.parse({
        ...candidate,
        workloadBehavior: {
          ...candidate.workloadBehavior,
          workloads: [
            ...candidate.workloadBehavior.workloads,
            workloadV2Schema.parse({
              ...operation.workload,
              provenance: provenance.workload,
            }),
          ],
        },
      });
    }
    case "edit-workload": {
      assertDigest(
        getWorkloadBehaviorContentHash(candidate.workloadBehavior),
        operation.expectedWorkloadContentHash,
        "$.expectedWorkloadContentHash",
        "Workload document",
      );
      const index = indexOf(
        candidate.workloadBehavior.workloads.map(({ id }) => id),
        operation.workloadId,
        "$.workloadId",
        "Workload",
      );
      const existing = candidate.workloadBehavior.workloads[index];
      if (existing === undefined) throw new Error("unreachable Workload index");
      const workloads = [...candidate.workloadBehavior.workloads];
      workloads[index] = workloadV2Schema.parse({
        ...existing,
        ...operation.patch,
        id: existing.id,
        provenance: existing.provenance,
      });
      return architectureDocumentV3Schema.parse({
        ...candidate,
        workloadBehavior: { ...candidate.workloadBehavior, workloads },
      });
    }
    case "add-workload-operation":
    case "edit-workload-operation": {
      assertDigest(
        getWorkloadBehaviorContentHash(candidate.workloadBehavior),
        operation.expectedWorkloadContentHash,
        "$.expectedWorkloadContentHash",
        "Workload document",
      );
      const workloadIndex = indexOf(
        candidate.workloadBehavior.workloads.map(({ id }) => id),
        operation.workloadId,
        "$.workloadId",
        "Workload",
      );
      const workload = candidate.workloadBehavior.workloads[workloadIndex];
      if (workload === undefined) throw new Error("unreachable Workload index");
      const operationIndex = workload.operations.findIndex(
        ({ id }) => id === operation.operation.id,
      );
      const operations = [...workload.operations];
      if (operation.kind === "add-workload-operation") {
        if (operationIndex >= 0) {
          fail(
            "duplicate-resource",
            "$.operation.id",
            "Workload operation already exists.",
          );
        }
        operations.push(workloadOperationV1Schema.parse(operation.operation));
      } else {
        if (operationIndex < 0) {
          fail(
            "resource-not-found",
            "$.operation.id",
            "Workload operation does not exist.",
          );
        }
        const previous = operations[operationIndex];
        if (previous === undefined)
          throw new Error("unreachable operation index");
        if (
          hashCanonicalValue(previous) !== operation.expectedOperationDigest
        ) {
          fail(
            "record-precondition-failed",
            "$.expectedOperationDigest",
            "Workload operation changed after this edit was proposed.",
          );
        }
        operations[operationIndex] = workloadOperationV1Schema.parse(
          operation.operation,
        );
      }
      const workloads = [...candidate.workloadBehavior.workloads];
      workloads[workloadIndex] = workloadV2Schema.parse({
        ...workload,
        operations,
      });
      return architectureDocumentV3Schema.parse({
        ...candidate,
        workloadBehavior: { ...candidate.workloadBehavior, workloads },
      });
    }
    case "add-application-contract":
    case "add-test-scenario":
    case "edit-application-contract":
    case "edit-test-scenario": {
      assertDigest(
        getApplicationContractsContentHash(candidate.applicationContracts),
        operation.expectedContractsContentHash,
        "$.expectedContractsContentHash",
        "Application Contracts document",
      );
      const supplied =
        operation.kind === "add-test-scenario" ||
        operation.kind === "edit-test-scenario"
          ? operation.scenario
          : operation.contract;
      const record = applicationContractRecordV1Schema.parse({
        ...supplied,
        provenance: provenance.applicationContract,
      });
      const contracts = [...candidate.applicationContracts.contracts];
      const contractIndex = contracts.findIndex(
        ({ contractId }) => contractId === record.contractId,
      );
      const edit =
        operation.kind === "edit-application-contract" ||
        operation.kind === "edit-test-scenario";
      if (!edit && contractIndex >= 0) {
        fail(
          "duplicate-resource",
          "$.contractId",
          "Application Contract already exists.",
        );
      }
      if (edit && contractIndex < 0) {
        fail(
          "resource-not-found",
          "$.contractId",
          "Application Contract does not exist.",
        );
      }
      if (edit) {
        const previous = contracts[contractIndex];
        if (previous === undefined)
          throw new Error("unreachable contract index");
        const expectedDigest =
          operation.kind === "edit-test-scenario"
            ? operation.expectedScenarioDigest
            : operation.expectedContractDigest;
        if (hashCanonicalValue(previous) !== expectedDigest) {
          fail(
            "record-precondition-failed",
            "$.expectedContractDigest",
            "Application Contract changed after this edit was proposed.",
          );
        }
        if (
          hashCanonicalValue(contractIdentityProjection(previous)) !==
          hashCanonicalValue(contractIdentityProjection(record))
        ) {
          fail(
            "stable-identity-change",
            "$.contract",
            "Editing an Application Contract cannot replace its stable nested identities.",
          );
        }
        contracts[contractIndex] = record;
      } else {
        contracts.push(record);
      }
      return architectureDocumentV3Schema.parse({
        ...candidate,
        applicationContracts: {
          ...candidate.applicationContracts,
          contracts,
        },
      });
    }
    case "add-external-resource": {
      assertDigest(
        getExternalResourceReferenceContentHash(candidate.externalResources),
        operation.expectedExternalResourcesContentHash,
        "$.expectedExternalResourcesContentHash",
        "External Resource document",
      );
      duplicate(
        candidate.externalResources.resources.map(({ id }) => id),
        operation.resource.id,
        "$.resource.id",
        "External Resource",
      );
      return architectureDocumentV3Schema.parse({
        ...candidate,
        externalResources: {
          ...candidate.externalResources,
          resources: [
            ...candidate.externalResources.resources,
            externalResourceV1Schema.parse(operation.resource),
          ],
        },
      });
    }
    case "edit-external-resource": {
      assertDigest(
        getExternalResourceReferenceContentHash(candidate.externalResources),
        operation.expectedExternalResourcesContentHash,
        "$.expectedExternalResourcesContentHash",
        "External Resource document",
      );
      const index = indexOf(
        candidate.externalResources.resources.map(({ id }) => id),
        operation.externalResourceId,
        "$.externalResourceId",
        "External Resource",
      );
      const existing = candidate.externalResources.resources[index];
      if (existing === undefined)
        throw new Error("unreachable External Resource index");
      if (hashCanonicalValue(existing) !== operation.expectedResourceDigest) {
        fail(
          "record-precondition-failed",
          "$.expectedResourceDigest",
          "External Resource changed after this edit was proposed.",
        );
      }
      const resources = [...candidate.externalResources.resources];
      const updated = externalResourceV1Schema.parse({
        ...existing,
        ...operation.patch,
        id: existing.id,
      });
      if (
        hashCanonicalValue(externalIdentityProjection(existing)) !==
        hashCanonicalValue(externalIdentityProjection(updated))
      ) {
        fail(
          "stable-identity-change",
          "$.patch",
          "Editing an External Resource cannot replace its stable nested identities.",
        );
      }
      if (
        hashCanonicalValue(externalAuthorityProjection(existing)) !==
        hashCanonicalValue(externalAuthorityProjection(updated))
      ) {
        fail(
          "ungrounded-external-authority",
          "$.patch",
          "Editing External Resource evidence, contracts, or secret references requires a separately grounded authority.",
        );
      }
      resources[index] = updated;
      return architectureDocumentV3Schema.parse({
        ...candidate,
        externalResources: { ...candidate.externalResources, resources },
      });
    }
    case "set-source-ownership": {
      assertDigest(
        getWorkloadBehaviorContentHash(candidate.workloadBehavior),
        operation.expectedWorkloadContentHash,
        "$.expectedWorkloadContentHash",
        "Workload document",
      );
      const workloadIndex = indexOf(
        candidate.workloadBehavior.workloads.map(({ id }) => id),
        operation.workloadId,
        "$.workloadId",
        "Workload",
      );
      const workload = candidate.workloadBehavior.workloads[workloadIndex];
      if (workload === undefined) throw new Error("unreachable Workload index");
      const sourceOwnership = [...workload.sourceOwnership];
      const ownershipIndex = sourceOwnership.findIndex(
        ({ declarationId }) =>
          declarationId === operation.declaration.declarationId,
      );
      if (operation.action === "add") {
        if (ownershipIndex >= 0) {
          fail(
            "duplicate-resource",
            "$.declaration.declarationId",
            "Source ownership declaration already exists.",
          );
        }
        sourceOwnership.push(
          repositoryPathOwnershipV1Schema.parse(operation.declaration),
        );
      } else {
        if (ownershipIndex < 0) {
          fail(
            "resource-not-found",
            "$.declaration.declarationId",
            "Source ownership declaration does not exist.",
          );
        }
        const previous = sourceOwnership[ownershipIndex];
        if (previous === undefined)
          throw new Error("unreachable ownership index");
        if (
          hashCanonicalValue(previous) !== operation.expectedDeclarationDigest
        ) {
          fail(
            "record-precondition-failed",
            "$.expectedDeclarationDigest",
            "Source ownership changed after this edit was proposed.",
          );
        }
        sourceOwnership[ownershipIndex] = repositoryPathOwnershipV1Schema.parse(
          operation.declaration,
        );
      }
      const workloads = [...candidate.workloadBehavior.workloads];
      workloads[workloadIndex] = workloadV2Schema.parse({
        ...workload,
        sourceOwnership,
      });
      return architectureDocumentV3Schema.parse({
        ...candidate,
        workloadBehavior: { ...candidate.workloadBehavior, workloads },
      });
    }
    case "review-repository-difference":
      return applyReconciliation(candidate, operation);
    case "upsert-ai-extension-request":
    case "request-clarification":
      return candidate;
  }
}

export function applyAssistantOperationBatchV1(input: {
  readonly batch: AssistantOperationBatchV1;
  readonly document: ArchitectureDocumentV3;
  readonly limits: AssistantOperationLimitsV1;
  readonly provenance: AssistantOperationTrustedProvenanceV1;
}): AssistantOperationApplicationResultV1 {
  const batch = assistantOperationBatchV1Schema.parse(input.batch);
  const original = architectureDocumentV3Schema.parse(clone(input.document));
  assertDigest(
    getArchitectureDocumentCanonicalHash(original),
    batch.baseArchitectureDigest,
    "$.baseArchitectureDigest",
    "Architecture",
  );
  if (batch.operations.length > input.limits.maximumOperations) {
    fail(
      "batch-limit-exceeded",
      "$.operations",
      "Assistant operation count exceeds the trusted plan limit.",
    );
  }
  let candidate = original;
  for (const operation of batch.operations) {
    candidate = validateCandidate(
      applyOperation({ candidate, operation, provenance: input.provenance }),
    );
    assertLimits(candidate, input.limits);
  }
  return {
    candidate,
    clarifications: batch.operations.filter(
      (
        operation,
      ): operation is Extract<
        AssistantOperationV1,
        { kind: "request-clarification" }
      > => operation.kind === "request-clarification",
    ),
    diffs: batch.operations.map(projectAssistantOperationDiffV1),
    extensionRequests: batch.operations.filter(
      (
        operation,
      ): operation is Extract<
        AssistantOperationV1,
        { kind: "upsert-ai-extension-request" }
      > => operation.kind === "upsert-ai-extension-request",
    ),
    reconciliationReviews: batch.operations.filter(
      (
        operation,
      ): operation is Extract<
        AssistantOperationV1,
        { kind: "review-repository-difference" }
      > => operation.kind === "review-repository-difference",
    ),
    writeAuthority: "none",
  };
}
