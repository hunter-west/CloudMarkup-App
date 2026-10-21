import type {
  ApplicationContractRecordV1,
  ArchitectureDocumentV3,
} from "@cloudmarkup/schemas";

import { getApplicationContractRecordContentHash } from "./application-contract-hashing.js";
import type {
  ArchitectureDocumentSemanticIssue,
  ArchitectureDocumentSemanticIssueCode,
} from "./semantic-validation.js";

interface ContractReferenceShape {
  readonly contractId: string;
  readonly contractVersion: string;
  readonly digest: string;
  readonly contractKind: ApplicationContractRecordV1["contractKind"];
}

interface LocatedContractReference {
  readonly path: string;
  readonly reference: ContractReferenceShape;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContractReference(
  value: Readonly<Record<string, unknown>>,
): value is Readonly<Record<string, unknown>> & ContractReferenceShape {
  return (
    typeof value["contractId"] === "string" &&
    typeof value["contractVersion"] === "string" &&
    typeof value["digest"] === "string" &&
    typeof value["contractKind"] === "string"
  );
}

function collectContractReferences(
  value: unknown,
  path: string,
  references: LocatedContractReference[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectContractReferences(item, `${path}[${String(index)}]`, references);
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (isContractReference(value)) {
    references.push({
      path,
      reference: value,
    });
  }

  Object.entries(value).forEach(([key, nested]) => {
    collectContractReferences(nested, `${path}.${key}`, references);
  });
}

function contractIdentity(
  contract: Pick<ContractReferenceShape, "contractId" | "contractVersion">,
): string {
  return `${contract.contractId}@${contract.contractVersion}`;
}

function contractDigest(contract: ApplicationContractRecordV1): string {
  return getApplicationContractRecordContentHash(contract);
}

interface ExtensionReferenceShape {
  readonly digest: string;
  readonly extensionContractVersion: number;
  readonly extensionId: string;
  readonly ownership: "ai-authored" | "approved-extension";
  readonly validationEvidenceIds: readonly string[];
}

function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function extensionReferencesMatch(
  left: ExtensionReferenceShape,
  right: ExtensionReferenceShape,
): boolean {
  const leftEvidence = [...left.validationEvidenceIds].sort(compareUtf16);
  const rightEvidence = [...right.validationEvidenceIds].sort(compareUtf16);
  return (
    left.extensionId === right.extensionId &&
    left.extensionContractVersion === right.extensionContractVersion &&
    left.digest === right.digest &&
    left.ownership === right.ownership &&
    leftEvidence.length === rightEvidence.length &&
    leftEvidence.every(
      (evidenceId, index) => evidenceId === rightEvidence[index],
    )
  );
}
function issue(
  code: ArchitectureDocumentSemanticIssueCode,
  message: string,
  path: string,
): ArchitectureDocumentSemanticIssue {
  return { code, message, path };
}

function duplicateIdentityIssues<T>(
  values: readonly T[],
  identityOf: (value: T) => string,
  path: string,
  label: string,
  code: ArchitectureDocumentSemanticIssueCode,
): readonly ArchitectureDocumentSemanticIssue[] {
  const firstIndex = new Map<string, number>();
  const issues: ArchitectureDocumentSemanticIssue[] = [];

  values.forEach((value, index) => {
    const identity = identityOf(value);
    const previous = firstIndex.get(identity);
    if (previous === undefined) {
      firstIndex.set(identity, index);
      return;
    }
    issues.push(
      issue(
        code,
        `Duplicate ${label}; first declared at ${path}[${String(previous)}].`,
        `${path}[${String(index)}]`,
      ),
    );
  });

  return issues;
}

function validateWorkloadV2References(
  document: ArchitectureDocumentV3,
): readonly ArchitectureDocumentSemanticIssue[] {
  const issues: ArchitectureDocumentSemanticIssue[] = [];
  const edgeIds: ReadonlySet<string> = new Set(
    document.edges.map(({ id }) => id),
  );
  const requirementIds: ReadonlySet<string> = new Set(
    document.unresolvedRequirements.map(({ id }) => id),
  );

  document.workloadBehavior.workloads.forEach((workload, workloadIndex) => {
    const path = `$.workloadBehavior.workloads[${String(workloadIndex)}]`;
    const operationIds: ReadonlySet<string> = new Set(
      workload.operations.map(({ id }) => id),
    );

    issues.push(
      ...duplicateIdentityIssues(
        workload.extensions,
        ({ extensionId }) => extensionId,
        `${path}.extensions`,
        "workload extension ID",
        "duplicate_workload_extension_id",
      ),
    );

    const operationReferences: readonly {
      readonly operationId: string;
      readonly path: string;
    }[] = [
      ...workload.entrypoints.map((entrypoint, index) => ({
        operationId: entrypoint.operationId,
        path: `${path}.entrypoints[${String(index)}].operationId`,
      })),
      ...workload.httpRoutes.map((route, index) => ({
        operationId: route.operationId,
        path: `${path}.httpRoutes[${String(index)}].operationId`,
      })),
      ...workload.eventBindings.map((binding, index) => ({
        operationId: binding.operationId,
        path: `${path}.eventBindings[${String(index)}].operationId`,
      })),
      ...workload.schedules.map((binding, index) => ({
        operationId: binding.operationId,
        path: `${path}.schedules[${String(index)}].operationId`,
      })),
      ...workload.dataBindings.map((binding, index) => ({
        operationId: binding.operationId,
        path: `${path}.dataBindings[${String(index)}].operationId`,
      })),
      ...workload.authorization.flatMap((binding, bindingIndex) =>
        binding.operationIds.map((operationId, index) => ({
          operationId,
          path: `${path}.authorization[${String(bindingIndex)}].operationIds[${String(index)}]`,
        })),
      ),
      ...workload.idempotency.flatMap((policy, policyIndex) =>
        policy.operationIds.map((operationId, index) => ({
          operationId,
          path: `${path}.idempotency[${String(policyIndex)}].operationIds[${String(index)}]`,
        })),
      ),
      ...workload.observability.healthChecks.flatMap((healthCheck, index) =>
        healthCheck.operationId === undefined
          ? []
          : [
              {
                operationId: healthCheck.operationId,
                path: `${path}.observability.healthChecks[${String(index)}].operationId`,
              },
            ],
      ),
    ];

    operationReferences.forEach((reference) => {
      if (!operationIds.has(reference.operationId)) {
        issues.push(
          issue(
            "broken_workload_v2_operation_reference",
            "Workload v2 behavior references an operation not declared by the workload.",
            reference.path,
          ),
        );
      }
    });

    const edgeReferences: readonly {
      readonly edgeId: string;
      readonly path: string;
    }[] = [
      ...workload.httpRoutes.map((route, index) => ({
        edgeId: route.triggerEdgeId,
        path: `${path}.httpRoutes[${String(index)}].triggerEdgeId`,
      })),
      ...workload.eventBindings.map((binding, index) => ({
        edgeId: binding.edgeId,
        path: `${path}.eventBindings[${String(index)}].edgeId`,
      })),
      ...workload.schedules.flatMap((binding, index) =>
        binding.triggerEdgeId === undefined
          ? []
          : [
              {
                edgeId: binding.triggerEdgeId,
                path: `${path}.schedules[${String(index)}].triggerEdgeId`,
              },
            ],
      ),
      ...workload.dataBindings.flatMap((binding, index) =>
        binding.edgeId === undefined
          ? []
          : [
              {
                edgeId: binding.edgeId,
                path: `${path}.dataBindings[${String(index)}].edgeId`,
              },
            ],
      ),
    ];

    edgeReferences.forEach((reference) => {
      if (!edgeIds.has(reference.edgeId)) {
        issues.push(
          issue(
            "broken_workload_v2_edge_reference",
            "Workload v2 behavior references an architecture edge that does not exist.",
            reference.path,
          ),
        );
      }
    });

    workload.implementationRequirements.forEach((requirement, index) => {
      if (
        requirement.architectureRequirementId !== undefined &&
        !requirementIds.has(requirement.architectureRequirementId)
      ) {
        issues.push(
          issue(
            "broken_workload_requirement_reference",
            "Implementation requirement references an unresolved architecture requirement that does not exist.",
            `${path}.implementationRequirements[${String(index)}].architectureRequirementId`,
          ),
        );
      }
    });

    if (workload.implementation.mode === "ai-assisted-custom") {
      const implementationExtension = workload.implementation.extension;
      const declaredExtension = workload.extensions.find(
        ({ extensionId }) =>
          extensionId === implementationExtension.extensionId,
      );
      if (
        declaredExtension === undefined ||
        !extensionReferencesMatch(declaredExtension, implementationExtension)
      ) {
        issues.push(
          issue(
            "broken_workload_extension_reference",
            "AI-assisted implementation must reference the exact declared, reviewed extension record.",
            `${path}.implementation.extension`,
          ),
        );
      }

      const provenance = workload.provenance;
      if (provenance.source !== "ai-assisted") {
        issues.push(
          issue(
            "invalid_workload_model_compatibility",
            "AI-assisted implementation requires explicit AI provenance.",
            `${path}.provenance`,
          ),
        );
      } else if (
        !workload.compatibility.modelGateways.some(
          (compatibility) =>
            compatibility.promptTemplateId === provenance.promptTemplateId &&
            compatibility.promptVersion === provenance.promptVersion &&
            compatibility.promptDigest === provenance.promptDigest,
        )
      ) {
        issues.push(
          issue(
            "missing_workload_model_compatibility",
            "AI-assisted implementation requires a matching provider-neutral ModelGateway compatibility declaration.",
            `${path}.compatibility.modelGateways`,
          ),
        );
      }
    }
  });

  return issues;
}

export function validateSolutionReferences(
  document: ArchitectureDocumentV3,
): readonly ArchitectureDocumentSemanticIssue[] {
  const issues: ArchitectureDocumentSemanticIssue[] = [];
  const contractByIdentity = new Map(
    document.applicationContracts.contracts.map(
      (contract) => [contractIdentity(contract), contract] as const,
    ),
  );
  const references: LocatedContractReference[] = [];

  issues.push(
    ...duplicateIdentityIssues(
      document.applicationContracts.contracts,
      contractIdentity,
      "$.applicationContracts.contracts",
      "application contract identity",
      "duplicate_application_contract_identity",
    ),
    ...duplicateIdentityIssues(
      document.externalResources.resources,
      ({ id }) => id,
      "$.externalResources.resources",
      "external resource ID",
      "duplicate_external_resource_id",
    ),
  );

  collectContractReferences(document, "$", references);
  references.forEach(({ path, reference }) => {
    const contract = contractByIdentity.get(contractIdentity(reference));
    if (contract === undefined) {
      issues.push(
        issue(
          "broken_application_contract_reference",
          "Reference does not resolve to the exact declared application contract version.",
          path,
        ),
      );
      return;
    }
    if (contract.contractKind !== reference.contractKind) {
      issues.push(
        issue(
          "application_contract_kind_mismatch",
          "Application contract reference kind does not match the declared contract.",
          `${path}.contractKind`,
        ),
      );
    }
    if (contractDigest(contract) !== reference.digest) {
      issues.push(
        issue(
          "application_contract_digest_mismatch",
          "Application contract reference digest does not match the exact declared contract content.",
          `${path}.digest`,
        ),
      );
    }
  });

  const nodeIds = new Set(document.nodes.map(({ id }) => id));
  document.externalResources.resources.forEach((resource, resourceIndex) => {
    resource.architectureNodeIds.forEach((nodeId, nodeIndex) => {
      if (!nodeIds.has(nodeId)) {
        issues.push(
          issue(
            "broken_external_resource_node_reference",
            "External resource references an architecture node that does not exist.",
            `$.externalResources.resources[${String(resourceIndex)}].architectureNodeIds[${String(nodeIndex)}]`,
          ),
        );
      }
    });
  });

  issues.push(...validateWorkloadV2References(document));
  return issues;
}
