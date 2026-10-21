import { ZodError } from "zod";
import {
  AssistantOperationApplicationError,
  GraphCommandApplicationError,
  applyAssistantOperationBatchV1,
  applyGraphCommand,
  projectAssistantOperationDiffV1,
  getApplicationContractRecordContentHash,
  getActiveIssueRecordHash,
  getArchitectureDocumentCanonicalHash,
  getExternalResourceReferenceContentHash,
  parseIntentDocument,
  validateArchitectureDocumentWithRules,
  type ValidationAffectedLocation,
  type ValidationFinding,
  type ValidationPortInventory,
  type ValidationReport,
  type ValidationRuleV1,
} from "@cloudmarkup/domain";
import {
  activeIssueV1Schema,
  actorIdSchema,
  architectureDocumentV3Schema,
  assistantOperationV1Schema,
  assistantOperationBatchV1Schema,
  externalResourceV1Schema,
  modelOperationProposalRequestV1Schema,
  modelInvocationDescriptorV1Schema,
  modelOperationProposalResponseV1Schema,
  serializeCanonicalJson,
  utcTimestampSchema,
  type ActiveIssueAffectedReferenceV1,
  type ActiveIssueV1,
  type ArchitectureDocumentV3,
  type AssistantOperationV1,
  type AssistantReviewDiffV1,
  type ExternalResourceV1,
  type ModelGatewayResponseV1,
} from "@cloudmarkup/schemas";

import type {
  ModelGatewayInvocationContextV1,
  ModelGatewayResultV1,
  ModelRequestFor,
} from "./ports.js";
import {
  ModelGatewayValidationError,
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
  sha256Text,
  redactModelRequest,
  validateModelRequestAuthority,
  validateModelResponseAuthority,
} from "./security.js";

const PLANNER_ID = "cloudmarkup.solution-proposal-planner" as const;
const PLANNER_VERSION = "1.0.0" as const;

export interface SolutionPlanningGatewayV1 {
  proposeOperations(
    request: ModelRequestFor<"operations.propose">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"operations.propose">>;
}

export interface InvalidSolutionProposalDiagnosticV1 {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export interface RestrictedInvalidSolutionProposalV1 {
  readonly classification: "restricted-model-proposal";
  readonly diagnostics: readonly InvalidSolutionProposalDiagnosticV1[];
  readonly invocationId: string;
  readonly organizationId: string;
  readonly projectId?: string;
  readonly proposalCanonicalJson: string;
  readonly proposalDigest: string;
  readonly retentionPolicyId: "cloudmarkup.invalid-model-proposal.v1";
}

export interface InvalidSolutionProposalStoreV1 {
  preserveRestricted(
    record: RestrictedInvalidSolutionProposalV1,
  ): Promise<void>;
}

export interface SolutionProposalPlannerV1Dependencies {
  readonly allowedApprovalPathIds: ReadonlySet<string>;
  readonly gateway: SolutionPlanningGatewayV1;
  readonly invalidProposalStore: InvalidSolutionProposalStoreV1;
  readonly validationRules?: readonly ValidationRuleV1[];
  readonly portInventory?: ValidationPortInventory;
}

export interface SolutionProposalPlannerRequestV1 {
  readonly createdAt: string;
  readonly gatewayContext: ModelGatewayInvocationContextV1;
  readonly maximumRepairAttempts: 0 | 1 | 2;
  readonly modelRequest: ModelRequestFor<"operations.propose">;
  readonly validationEnvironment: ValidationReport["environment"];
  readonly solutionRevisionId: ActiveIssueV1["solutionRevisionId"];
}

export type SolutionProposalPlannerResultV1 =
  | {
      readonly activeIssues: readonly ActiveIssueV1[];
      readonly assistantDiffs: readonly AssistantReviewDiffV1[];
      readonly assistantOperations: readonly AssistantOperationV1[];
      readonly candidateArchitecture: ArchitectureDocumentV3;
      readonly contractVersion: 1;
      readonly disposition: "ready-for-review" | "needs-user-input";
      readonly modelResult: ModelGatewayResultV1<"operations.propose">;
      readonly proposalDigest: string;
      readonly validationReport: ValidationReport;
      readonly writeAuthority: "none";
    }
  | {
      readonly attempts: number;
      readonly contractVersion: 1;
      readonly diagnostics: readonly InvalidSolutionProposalDiagnosticV1[];
      readonly disposition: "rejected";
      readonly writeAuthority: "none";
    };

export class SolutionProposalPlannerError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "SolutionProposalPlannerError";
    this.code = code;
  }
}

function compareUtf16(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function safeSlug(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, "-")
    .replace(/^[^a-z0-9]+/u, "")
    .replace(/-+/gu, "-")
    .slice(0, 48)
    .replace(/[^a-z0-9]+$/u, "");
  return safeSlugFallback(normalized);
}

function safeSlugFallback(value: string): string {
  return value.length === 0 ? "proposal" : value;
}

export function deriveStableSolutionProposalIdV1(input: {
  readonly kind: string;
  readonly sourceKey: string;
  readonly scopeDigest: string;
}): string {
  const digest = sha256Text(
    serializeCanonicalJson({
      kind: input.kind,
      sourceKey: input.sourceKey.normalize("NFKC"),
      scopeDigest: input.scopeDigest,
    }),
  ).slice("sha256:".length, "sha256:".length + 20);
  return `${safeSlug(input.kind)}_${safeSlug(input.sourceKey)}_${digest}`.slice(
    0,
    128,
  );
}

function diagnostic(
  code: string,
  message: string,
  path: string,
): InvalidSolutionProposalDiagnosticV1 {
  return { code, message: message.replace(/[\r\n\u2028\u2029]+/gu, " "), path };
}

function diagnosticsFor(
  error: unknown,
): readonly InvalidSolutionProposalDiagnosticV1[] {
  if (error instanceof ZodError) {
    return error.issues.map((issue) =>
      diagnostic(
        "cloudmarkup.solution-planner.invalid-structured-candidate",
        issue.message,
        `$.candidateArchitecture.${issue.path.map(String).join(".")}`,
      ),
    );
  }
  if (error instanceof GraphCommandApplicationError) {
    return error.issues.map((issue) =>
      diagnostic(
        `cloudmarkup.solution-planner.${issue.code.replaceAll("_", "-")}`,
        issue.message,
        issue.path,
      ),
    );
  }
  if (error instanceof AssistantOperationApplicationError) {
    return error.issues.map((issue) =>
      diagnostic(
        `cloudmarkup.solution-planner.${issue.code.replaceAll("_", "-")}`,
        issue.message,
        issue.path,
      ),
    );
  }
  if (error instanceof ModelGatewayValidationError) {
    return [diagnostic(error.code, error.message, "$.modelResponse")];
  }
  if (error instanceof SolutionProposalPlannerError) {
    return [diagnostic(error.code, error.message, "$.solutionProposal")];
  }
  return [
    diagnostic(
      "cloudmarkup.solution-planner.invalid-proposal",
      "The proposal failed deterministic post-validation.",
      "$",
    ),
  ];
}

function affectedReference(
  location: ValidationAffectedLocation,
  solutionRevisionId: ActiveIssueV1["solutionRevisionId"],
): ActiveIssueAffectedReferenceV1 {
  if (location.kind === "node") {
    return { kind: "architecture-node", nodeId: location.nodeId };
  }
  if (location.kind === "edge" || location.kind === "port") {
    return { edgeId: location.edgeId, kind: "architecture-edge" };
  }
  if (location.kind === "configuration") {
    return location.owner.kind === "node"
      ? { kind: "architecture-node", nodeId: location.owner.nodeId }
      : { edgeId: location.owner.edgeId, kind: "architecture-edge" };
  }
  return { kind: "solution-revision", solutionRevisionId };
}

function activeIssueForFinding(input: {
  readonly createdAt: string;
  readonly finding: ValidationFinding;
  readonly modelResult: ModelGatewayResultV1<"operations.propose">;
  readonly solutionRevisionId: ActiveIssueV1["solutionRevisionId"];
}): ActiveIssueV1 {
  const affected = input.finding.affected.map((location) =>
    affectedReference(location, input.solutionRevisionId),
  );
  const uniqueAffected = [
    ...new Map(
      (affected.length === 0
        ? [
            {
              kind: "solution-revision" as const,
              solutionRevisionId: input.solutionRevisionId,
            },
          ]
        : affected
      ).map((reference) => [serializeCanonicalJson(reference), reference]),
    ).values(),
  ];
  const issueId = deriveStableSolutionProposalIdV1({
    kind: "issue",
    sourceKey: input.finding.findingId,
    scopeDigest: input.modelResult.descriptor.inputDigest,
  });
  const placeholder = activeIssueV1Schema.parse({
    affected: uniqueAffected,
    category:
      input.finding.severity === "security-error"
        ? "security"
        : input.finding.severity === "cost-warning"
          ? "cost"
          : "provider",
    closureRequirements: [],
    contractVersion: 1,
    currentRecordDigest: sha256Text("placeholder"),
    id: issueId,
    lifecycle: { state: "current" },
    provenance: {
      actor: {
        kind: "deterministic-tool",
        tool: { id: PLANNER_ID, version: PLANNER_VERSION },
      },
      createdAt: input.createdAt,
      inputDigests: [
        input.modelResult.descriptor.inputDigest,
        digestStructuredValue(input.finding),
      ],
    },
    recordVersion: 1,
    severity: input.finding.severity,
    solutionRevisionId: input.solutionRevisionId,
    source: "provider-architecture-validation",
    sourceRecordId: input.finding.findingId,
    summary: input.finding.title.slice(0, 500),
    technicalDetail: input.finding.technicalExplanation.slice(0, 4_000),
  });
  return activeIssueV1Schema.parse({
    ...placeholder,
    currentRecordDigest: getActiveIssueRecordHash(placeholder),
  });
}

function activeIssueForProposalGap(input: {
  readonly affected: readonly ActiveIssueAffectedReferenceV1[];
  readonly category: ActiveIssueV1["category"];
  readonly createdAt: string;
  readonly gapId: string;
  readonly modelResult: ModelGatewayResultV1<"operations.propose">;
  readonly severity: ActiveIssueV1["severity"];
  readonly solutionRevisionId: ActiveIssueV1["solutionRevisionId"];
  readonly summary: string;
  readonly technicalDetail: string;
}): ActiveIssueV1 {
  const placeholder = activeIssueV1Schema.parse({
    affected: input.affected,
    category: input.category,
    closureRequirements: [],
    contractVersion: 1,
    currentRecordDigest: sha256Text("placeholder"),
    id: deriveStableSolutionProposalIdV1({
      kind: "issue",
      sourceKey: input.gapId,
      scopeDigest: input.modelResult.descriptor.inputDigest,
    }),
    lifecycle: { state: "current" },
    provenance: {
      actor: {
        kind: "model-assisted",
        modelId: input.modelResult.descriptor.modelId,
        modelVersion: input.modelResult.descriptor.modelVersion,
        promptVersion: input.modelResult.descriptor.promptVersion,
        providerId: input.modelResult.descriptor.providerId,
      },
      createdAt: input.createdAt,
      inputDigests: [input.modelResult.descriptor.inputDigest],
    },
    recordVersion: 1,
    severity: input.severity,
    solutionRevisionId: input.solutionRevisionId,
    source: "ai-generation-repair",
    sourceRecordId: input.gapId,
    summary: input.summary.slice(0, 500),
    technicalDetail: input.technicalDetail.slice(0, 4_000),
  });
  return activeIssueV1Schema.parse({
    ...placeholder,
    currentRecordDigest: getActiveIssueRecordHash(placeholder),
  });
}

interface ExternalResourceBlockingGapV1 {
  readonly fieldPath: string;
  readonly gapId: string;
  readonly summary: string;
}

function externalResourceBlockingGaps(
  resource: ExternalResourceV1,
  target: "terraform" | "cloudformation",
): readonly ExternalResourceBlockingGapV1[] {
  const gaps: ExternalResourceBlockingGapV1[] = [];
  const blockingPaths = new Set<string>(
    resource.unresolvedInformation
      .filter((item) => item.blocking)
      .map((item) => item.fieldPath),
  );
  const add = (fieldPath: string, suffix: string, summary: string): void => {
    if (!blockingPaths.has(fieldPath)) {
      gaps.push({
        fieldPath,
        gapId: `${resource.id}_${suffix}`,
        summary,
      });
    }
  };
  if (resource.lifecycle.ownershipState === "unknown-unresolved") {
    add(
      "$.lifecycle.ownershipState",
      "ownership",
      "Confirm who owns this resource and whether CloudMarkup may reference or import it.",
    );
  }
  if (resource.provider.state === "unknown") {
    add(
      "$.provider",
      "provider",
      "Confirm the resource provider and service family.",
    );
  }
  if (Object.keys(resource.scope).length === 0) {
    add(
      "$.scope",
      "location",
      "Confirm the account, project, region, or other resource location.",
    );
  }
  if (resource.addresses.length === 0) {
    add(
      "$.addresses",
      "endpoint",
      "Provide a non-secret resource address or endpoint reference.",
    );
  }
  if (resource.interfaces.length === 0) {
    add(
      "$.interfaces",
      "interface",
      "Confirm the interface protocol and authentication method; provide only secret references when authentication needs credentials.",
    );
  }
  const targetReadiness = resource.lifecycle.iacTargets.find(
    (entry) => entry.target === target,
  )?.readiness;
  if (
    targetReadiness === undefined ||
    targetReadiness === "unresolved" ||
    targetReadiness === "import-candidate"
  ) {
    add(
      "$.lifecycle.iacTargets",
      "import-decision",
      "Confirm whether this resource is referenced, imported after review, or excluded from the selected target.",
    );
  }
  return gaps;
}
function activeIssuesForProposalGaps(input: {
  readonly createdAt: string;
  readonly modelResult: ModelGatewayResultV1<"operations.propose">;
  readonly solutionRevisionId: ActiveIssueV1["solutionRevisionId"];
  readonly target: "terraform" | "cloudformation";
}): readonly ActiveIssueV1[] {
  const proposal = input.modelResult.response.solutionProposal;
  if (proposal === undefined) return [];
  const issues: ActiveIssueV1[] = [];
  input.modelResult.response.proposalContext.unknowns
    .filter((unknown) => unknown.blocking)
    .forEach((unknown) => {
      issues.push(
        activeIssueForProposalGap({
          affected: [
            {
              kind: "solution-revision",
              solutionRevisionId: input.solutionRevisionId,
            },
          ],
          category: "configuration",
          createdAt: input.createdAt,
          gapId: unknown.unknownId,
          modelResult: input.modelResult,
          severity: "warning",
          solutionRevisionId: input.solutionRevisionId,
          summary: unknown.question,
          technicalDetail:
            "A model-reported blocking unknown must be answered before acceptance.",
        }),
      );
    });
  proposal.externalResources.forEach((resource) => {
    resource.unresolvedInformation
      .filter((unresolved) => unresolved.blocking)
      .forEach((unresolved) => {
        issues.push(
          activeIssueForProposalGap({
            affected: [
              { externalResourceId: resource.id, kind: "external-resource" },
            ],
            category: "configuration",
            createdAt: input.createdAt,
            gapId: unresolved.unresolvedInformationId,
            modelResult: input.modelResult,
            severity: "warning",
            solutionRevisionId: input.solutionRevisionId,
            summary: unresolved.summary,
            technicalDetail: `Blocking external-resource field ${unresolved.fieldPath} requires explicit user input.`,
          }),
        );
      });
    externalResourceBlockingGaps(resource, input.target).forEach((gap) => {
      issues.push(
        activeIssueForProposalGap({
          affected: [
            { externalResourceId: resource.id, kind: "external-resource" },
          ],
          category: "configuration",
          createdAt: input.createdAt,
          gapId: gap.gapId,
          modelResult: input.modelResult,
          severity: "warning",
          solutionRevisionId: input.solutionRevisionId,
          summary: gap.summary,
          technicalDetail: `Blocking external-resource field ${gap.fieldPath} requires explicit user input. Secret values must never be requested.`,
        }),
      );
    });
  });
  proposal.generationCoverageSuggestions
    .filter((coverage) => coverage.missingRequirements.length > 0)
    .forEach((coverage) => {
      issues.push(
        activeIssueForProposalGap({
          affected: [{ kind: "workload", workloadId: coverage.workloadId }],
          category: "generation",
          createdAt: input.createdAt,
          gapId: `coverage_${coverage.workloadId}`,
          modelResult: input.modelResult,
          severity: "warning",
          solutionRevisionId: input.solutionRevisionId,
          summary: "The proposed workload has incomplete generation coverage.",
          technicalDetail: `Missing requirements: ${coverage.missingRequirements.join(", ")}.`,
        }),
      );
    });
  return issues.sort((left, right) => compareUtf16(left.id, right.id));
}

function assertRequestIsPlanning(
  request: ModelRequestFor<"operations.propose">,
): NonNullable<typeof request.planningContext> {
  const parsed = modelOperationProposalRequestV1Schema.parse(request);
  const context = parsed.planningContext;
  if (context === undefined) {
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.missing-planning-context",
      "Solution planning requires approved Intent and bounded planning metadata.",
    );
  }
  parseIntentDocument(context.approvedIntent);
  return context;
}

function assertUnique(
  values: readonly string[],
  code: string,
  message: string,
): void {
  if (new Set(values).size !== values.length) {
    throw new SolutionProposalPlannerError(code, message);
  }
}

function planningIdentityScopeDigest(
  request: ModelRequestFor<"operations.propose">,
): string {
  return digestStructuredValue({
    architectureId: request.architecture.architectureId,
    catalog: request.architecture.catalog,
    documentId: request.architecture.documentId,
    revisionId: request.architecture.revision.revisionId,
  });
}

interface PlanningGraphIdentityMapsV1 {
  readonly addressAliases: ReadonlyMap<string, string>;
  readonly candidateAliases: ReadonlyMap<string, string>;
  readonly canonicalAddressIds: ReadonlySet<string>;
  readonly canonicalCandidateIds: ReadonlySet<string>;
  readonly canonicalContractIds: ReadonlySet<string>;
  readonly canonicalEdgeIds: ReadonlySet<string>;
  readonly canonicalEvidenceIds: ReadonlySet<string>;
  readonly canonicalExternalResourceIds: ReadonlySet<string>;
  readonly canonicalInterfaceIds: ReadonlySet<string>;
  readonly canonicalNodeIds: ReadonlySet<string>;
  readonly canonicalUnresolvedInformationIds: ReadonlySet<string>;
  readonly canonicalWorkloadIds: ReadonlySet<string>;
  readonly edgeAliases: ReadonlyMap<string, string>;
  readonly externalResourceAliases: ReadonlyMap<string, string>;
  readonly generatedAddressIds: ReadonlySet<string>;
  readonly generatedCandidateIds: ReadonlySet<string>;
  readonly generatedEdgeIds: ReadonlySet<string>;
  readonly generatedExternalResourceIds: ReadonlySet<string>;
  readonly generatedInterfaceIds: ReadonlySet<string>;
  readonly generatedNodeIds: ReadonlySet<string>;
  readonly generatedUnresolvedInformationIds: ReadonlySet<string>;
  readonly interfaceAliases: ReadonlyMap<string, string>;
  readonly nodeAliases: ReadonlyMap<string, string>;
  readonly unresolvedInformationAliases: ReadonlyMap<string, string>;
}

function registerPlanningIdentityAlias(input: {
  readonly aliases: Map<string, string>;
  readonly canonicalIds: ReadonlySet<string>;
  readonly derivedId: string;
  readonly generatedIds: Set<string>;
  readonly kind: string;
  readonly rawId: string;
}): void {
  if (
    input.canonicalIds.has(input.rawId) ||
    input.aliases.has(input.rawId) ||
    input.generatedIds.has(input.rawId) ||
    input.canonicalIds.has(input.derivedId) ||
    input.aliases.has(input.derivedId) ||
    input.generatedIds.has(input.derivedId)
  ) {
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.ambiguous-model-identity",
      "A model-created " +
        input.kind +
        " identity collides with canonical or proposal authority.",
    );
  }
  input.aliases.set(input.rawId, input.derivedId);
  input.generatedIds.add(input.derivedId);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rewritePlanningReference(input: {
  readonly aliases: ReadonlyMap<string, string>;
  readonly canonicalIds: ReadonlySet<string>;
  readonly generatedIds: ReadonlySet<string>;
  readonly kind: string;
  readonly value: unknown;
}): unknown {
  if (typeof input.value !== "string") return input.value;
  const normalized = input.aliases.get(input.value);
  if (normalized !== undefined) return normalized;
  if (
    input.canonicalIds.has(input.value) ||
    input.generatedIds.has(input.value)
  ) {
    return input.value;
  }
  throw new SolutionProposalPlannerError(
    "cloudmarkup.solution-planner.unresolved-model-reference",
    "A model proposal referenced an unknown " + input.kind + " identity.",
  );
}

type PlanningOperationResponseV1 = Extract<
  ModelGatewayResponseV1,
  { operation: "operations.propose" }
>;

function assertExternalResourceAuthorities(input: {
  readonly request: ModelRequestFor<"operations.propose">;
  readonly response: PlanningOperationResponseV1;
}): void {
  const proposedResources = [
    ...(input.response.solutionProposal?.externalResources ?? []),
    ...input.response.batches.flatMap((batch) =>
      batch.kind === "assistant"
        ? batch.batch.operations.flatMap((operation) => {
            if (operation.kind === "add-external-resource") {
              return [operation.resource];
            }
            if (operation.kind !== "edit-external-resource") return [];
            const existing =
              input.request.architecture.externalResources.resources.find(
                ({ id }) => id === operation.externalResourceId,
              );
            return existing === undefined
              ? []
              : [
                  externalResourceV1Schema.parse({
                    ...existing,
                    ...operation.patch,
                    id: existing.id,
                  }),
                ];
          })
        : [],
    ),
  ];
  if (proposedResources.length === 0) return;
  const canonicalSecretReferences = new Set<string>();
  input.request.architecture.workloadBehavior.workloads.forEach((workload) => {
    workload.environment.forEach((binding) => {
      if (binding.value.kind === "secret-reference") {
        canonicalSecretReferences.add(binding.value.reference);
      }
    });
  });
  const evidenceById = new Map<string, string>();
  input.request.architecture.externalResources.resources.forEach((resource) => {
    resource.interfaces.forEach((externalInterface) => {
      if ("secretReferences" in externalInterface.authentication) {
        externalInterface.authentication.secretReferences.forEach(
          (secretReference) => {
            canonicalSecretReferences.add(secretReference);
          },
        );
      }
    });
    resource.evidence.forEach((evidence) => {
      const canonical = serializeCanonicalJson(evidence);
      const previous = evidenceById.get(evidence.evidenceId);
      if (previous !== undefined && previous !== canonical) {
        throw new SolutionProposalPlannerError(
          "cloudmarkup.solution-planner.ambiguous-external-evidence-authority",
          "Canonical External Resource evidence identities must be unambiguous.",
        );
      }
      evidenceById.set(evidence.evidenceId, canonical);
    });
  });
  const contractsById = new Map(
    input.request.architecture.applicationContracts.contracts.map(
      (contract) => [contract.contractId, contract],
    ),
  );
  proposedResources.forEach((resource) => {
    resource.evidence.forEach((evidence) => {
      if (
        evidenceById.get(evidence.evidenceId) !==
        serializeCanonicalJson(evidence)
      ) {
        throw new SolutionProposalPlannerError(
          "cloudmarkup.solution-planner.ungrounded-external-evidence",
          "A proposed External Resource evidence reference is not exact canonical authority.",
        );
      }
    });
    resource.interfaces.forEach((externalInterface) => {
      if ("secretReferences" in externalInterface.authentication) {
        externalInterface.authentication.secretReferences.forEach(
          (secretReference) => {
            if (!canonicalSecretReferences.has(secretReference)) {
              throw new SolutionProposalPlannerError(
                "cloudmarkup.solution-planner.ungrounded-external-secret-reference",
                "A proposed External Resource secret reference is not exact canonical authority.",
              );
            }
          },
        );
      }
      externalInterface.contracts.forEach((reference) => {
        const contract = contractsById.get(reference.contractId);
        if (
          contract?.contractKind !== reference.contractKind ||
          contract.contractVersion !== reference.contractVersion ||
          getApplicationContractRecordContentHash(contract) !== reference.digest
        ) {
          throw new SolutionProposalPlannerError(
            "cloudmarkup.solution-planner.ungrounded-external-contract-reference",
            "A proposed External Resource contract reference is not exact canonical authority.",
          );
        }
      });
    });
  });
}

interface ReplacementIdentityInventoryV1 {
  readonly valuesByDomain: ReadonlyMap<string, ReadonlySet<string>>;
}

function collectReplacementIdentityInventory(input: {
  readonly applicationContracts: ArchitectureDocumentV3["applicationContracts"];
  readonly workloadBehavior: ArchitectureDocumentV3["workloadBehavior"];
}): ReplacementIdentityInventoryV1 {
  const mutable = new Map<string, Set<string>>();
  const declarationSeen = new Map<string, Set<string>>();
  const add = (domain: string, value: string): void => {
    const values = mutable.get(domain) ?? new Set<string>();
    values.add(value);
    mutable.set(domain, values);
  };
  const declare = (domain: string, value: string): void => {
    const seen = declarationSeen.get(domain) ?? new Set<string>();
    if (seen.has(value)) {
      throw new SolutionProposalPlannerError(
        "cloudmarkup.solution-planner.ambiguous-replacement-identity",
        "A replacement document declares the same stable identity twice within one authority domain.",
      );
    }
    seen.add(value);
    declarationSeen.set(domain, seen);
    add(domain, value);
  };
  const collectTypedReferences = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collectTypedReferences);
      return;
    }
    if (!isUnknownRecord(value)) return;
    Object.entries(value).forEach(([key, entry]) => {
      if (typeof entry === "string") {
        if (
          key === "operationId" ||
          key === "targetOperationId" ||
          key === "sourceOperationId" ||
          key === "dispatcherOperationId"
        ) {
          add("workload-operation", entry);
        } else if (key === "contractId") {
          add("application-contract", entry);
        } else if (key === "roleId") {
          add("application-contract-role", entry);
        } else if (key === "fixtureId") {
          add("application-test-fixture", entry);
        }
      } else if (Array.isArray(entry)) {
        if (key === "operationIds") {
          entry.forEach((item) => {
            if (typeof item === "string") add("workload-operation", item);
          });
        } else if (key === "permittedRoleIds") {
          entry.forEach((item) => {
            if (typeof item === "string")
              add("application-contract-role", item);
          });
        }
      }
      collectTypedReferences(entry);
    });
  };

  input.workloadBehavior.workloads.forEach((workload) => {
    declare("workload", workload.id);
    workload.operations.forEach((operation) => {
      declare("workload-operation", operation.id);
    });
    workload.triggers.forEach((binding) => {
      declare("workload-trigger-binding", binding.id);
    });
    workload.downstreamActions.forEach((binding) => {
      declare("workload-downstream-binding", binding.id);
    });
    workload.environment.forEach((binding) => {
      declare("workload-environment-binding", binding.id);
    });
    workload.entrypoints.forEach((entrypoint) => {
      declare("workload-entrypoint", entrypoint.entrypointId);
    });
    workload.httpRoutes.forEach((route) => {
      declare("workload-http-route", route.routeId);
    });
    workload.eventBindings.forEach((binding) => {
      declare("workload-event-binding", binding.bindingId);
    });
    workload.schedules.forEach((binding) => {
      declare("workload-schedule-binding", binding.bindingId);
    });
    workload.dataBindings.forEach((binding) => {
      declare("workload-data-binding", binding.bindingId);
    });
    workload.authorization.forEach((binding) => {
      declare("workload-authorization-binding", binding.bindingId);
    });
    workload.idempotency.forEach((policy) => {
      declare("workload-idempotency-policy", policy.policyId);
    });
    workload.observability.healthChecks.forEach((healthCheck) => {
      declare("workload-health-check", healthCheck.healthCheckId);
    });
    workload.tests.forEach((binding) => {
      declare("workload-test-binding", binding.bindingId);
    });
    workload.extensionPoints.forEach((extensionPoint) => {
      declare("workload-extension-point", extensionPoint.extensionPointId);
    });
    workload.extensions.forEach((extension) => {
      add("workload-extension", extension.extensionId);
    });
    if (workload.implementation.mode === "ai-assisted-custom") {
      add("workload-extension", workload.implementation.extension.extensionId);
    }
    if (workload.implementation.mode === "external-artifact") {
      add(
        "workload-external-artifact",
        workload.implementation.artifact.artifactId,
      );
    }
    workload.implementationRequirements.forEach((requirement) => {
      declare(
        "workload-implementation-requirement",
        requirement.implementationRequirementId,
      );
    });
  });
  declare("application-contract-set", input.applicationContracts.contractSetId);
  input.applicationContracts.contracts.forEach((contract) => {
    declare("application-contract", contract.contractId);
    if (contract.contractKind === "data-entity") {
      contract.indexes.forEach((index) => {
        declare("application-contract-index", index.indexId);
      });
    }
    if (contract.contractKind === "auth") {
      contract.roles.forEach((role) => {
        declare("application-contract-role", role.roleId);
      });
    }
    if (contract.contractKind === "test-case") {
      contract.expectations.forEach((expectation) => {
        declare("application-test-expectation", expectation.expectationId);
      });
    }
  });
  collectTypedReferences(input);
  return { valuesByDomain: mutable };
}

function assertReplacementIdentityAuthority(input: {
  readonly request: ModelRequestFor<"operations.propose">;
  readonly response: PlanningOperationResponseV1;
}): void {
  const canonical = collectReplacementIdentityInventory({
    applicationContracts: input.request.architecture.applicationContracts,
    workloadBehavior: input.request.architecture.workloadBehavior,
  }).valuesByDomain;
  input.response.batches.forEach((proposedBatch) => {
    if (proposedBatch.kind !== "graph") return;
    proposedBatch.batch.commands.forEach((command) => {
      if (command.kind !== "replace-workload-and-application-contracts") return;
      const proposed = collectReplacementIdentityInventory({
        applicationContracts: command.applicationContracts,
        workloadBehavior: command.workloadBehavior,
      }).valuesByDomain;
      proposed.forEach((values, domain) => {
        const canonicalValues = canonical.get(domain) ?? new Set<string>();
        values.forEach((value) => {
          if (!canonicalValues.has(value)) {
            throw new SolutionProposalPlannerError(
              "cloudmarkup.solution-planner.noncanonical-replacement-identity",
              "A Workload/Application Contract replacement introduced an identity outside exact canonical " +
                domain +
                " authority.",
            );
          }
        });
      });
    });
  });
}

const emptyPlanningAliases: ReadonlyMap<string, string> = new Map();
const emptyPlanningGeneratedIds: ReadonlySet<string> = new Set();

function rewritePlanningGraphReferences(
  value: unknown,
  identities: PlanningGraphIdentityMapsV1,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      rewritePlanningGraphReferences(entry, identities),
    );
  }
  if (!isUnknownRecord(value)) return value;
  const referenceKind = value["kind"];
  const externalResourceRecord =
    typeof value["id"] === "string" &&
    Array.isArray(value["architectureNodeIds"]) &&
    Array.isArray(value["addresses"]) &&
    Array.isArray(value["interfaces"]) &&
    Array.isArray(value["unresolvedInformation"]);
  const rewrite = (input: {
    readonly aliases: ReadonlyMap<string, string>;
    readonly canonicalIds: ReadonlySet<string>;
    readonly generatedIds: ReadonlySet<string>;
    readonly kind: string;
    readonly value: unknown;
  }): unknown => rewritePlanningReference(input);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key === "id" && externalResourceRecord) {
        return [
          key,
          rewrite({
            aliases: identities.externalResourceAliases,
            canonicalIds: identities.canonicalExternalResourceIds,
            generatedIds: identities.generatedExternalResourceIds,
            kind: "external-resource",
            value: entry,
          }),
        ];
      }
      if (key === "architectureNodeIds" && Array.isArray(entry)) {
        return [
          key,
          entry.map((nodeId) =>
            rewrite({
              aliases: identities.nodeAliases,
              canonicalIds: identities.canonicalNodeIds,
              generatedIds: identities.generatedNodeIds,
              kind: "node",
              value: nodeId,
            }),
          ),
        ];
      }
      if (key === "nodeId" || key === "owningNodeId") {
        return [
          key,
          rewrite({
            aliases: identities.nodeAliases,
            canonicalIds: identities.canonicalNodeIds,
            generatedIds: identities.generatedNodeIds,
            kind: "node",
            value: entry,
          }),
        ];
      }
      if (key === "edgeId") {
        return [
          key,
          rewrite({
            aliases: identities.edgeAliases,
            canonicalIds: identities.canonicalEdgeIds,
            generatedIds: identities.generatedEdgeIds,
            kind: "edge",
            value: entry,
          }),
        ];
      }
      if (key === "addressId" || key === "importAddressId") {
        return [
          key,
          rewrite({
            aliases: identities.addressAliases,
            canonicalIds: identities.canonicalAddressIds,
            generatedIds: identities.generatedAddressIds,
            kind: "external-resource address",
            value: entry,
          }),
        ];
      }
      if (key === "candidateId") {
        return [
          key,
          rewrite({
            aliases: identities.candidateAliases,
            canonicalIds: identities.canonicalCandidateIds,
            generatedIds: identities.generatedCandidateIds,
            kind: "external-resource candidate",
            value: entry,
          }),
        ];
      }
      if (key === "interfaceId") {
        return [
          key,
          rewrite({
            aliases: identities.interfaceAliases,
            canonicalIds: identities.canonicalInterfaceIds,
            generatedIds: identities.generatedInterfaceIds,
            kind: "external-resource interface",
            value: entry,
          }),
        ];
      }
      if (key === "unresolvedInformationId") {
        return [
          key,
          rewrite({
            aliases: identities.unresolvedInformationAliases,
            canonicalIds: identities.canonicalUnresolvedInformationIds,
            generatedIds: identities.generatedUnresolvedInformationIds,
            kind: "external-resource unresolved-information",
            value: entry,
          }),
        ];
      }
      if (key === "evidenceId") {
        return [
          key,
          rewrite({
            aliases: emptyPlanningAliases,
            canonicalIds: identities.canonicalEvidenceIds,
            generatedIds: emptyPlanningGeneratedIds,
            kind: "external-resource evidence",
            value: entry,
          }),
        ];
      }
      if (key === "contractId") {
        return [
          key,
          rewrite({
            aliases: emptyPlanningAliases,
            canonicalIds: identities.canonicalContractIds,
            generatedIds: emptyPlanningGeneratedIds,
            kind: "application contract",
            value: entry,
          }),
        ];
      }
      if (key === "workloadId") {
        return [
          key,
          rewrite({
            aliases: emptyPlanningAliases,
            canonicalIds: identities.canonicalWorkloadIds,
            generatedIds: emptyPlanningGeneratedIds,
            kind: "workload",
            value: entry,
          }),
        ];
      }
      if (key === "referenceId" && referenceKind === "architecture-node") {
        return [
          key,
          rewrite({
            aliases: identities.nodeAliases,
            canonicalIds: identities.canonicalNodeIds,
            generatedIds: identities.generatedNodeIds,
            kind: "node",
            value: entry,
          }),
        ];
      }
      if (key === "referenceId" && referenceKind === "architecture-edge") {
        return [
          key,
          rewrite({
            aliases: identities.edgeAliases,
            canonicalIds: identities.canonicalEdgeIds,
            generatedIds: identities.generatedEdgeIds,
            kind: "edge",
            value: entry,
          }),
        ];
      }
      if (key === "referenceId" && referenceKind === "external-resource") {
        return [
          key,
          rewrite({
            aliases: identities.externalResourceAliases,
            canonicalIds: identities.canonicalExternalResourceIds,
            generatedIds: identities.generatedExternalResourceIds,
            kind: "external-resource",
            value: entry,
          }),
        ];
      }
      if (key === "referenceId" && referenceKind === "workload") {
        return [
          key,
          rewrite({
            aliases: emptyPlanningAliases,
            canonicalIds: identities.canonicalWorkloadIds,
            generatedIds: emptyPlanningGeneratedIds,
            kind: "workload",
            value: entry,
          }),
        ];
      }
      return [key, rewritePlanningGraphReferences(entry, identities)];
    }),
  );
}

/** @internal Shared exact identity projection for planning and review coverage. */
export function normalizePlanningResponseIdentities(input: {
  readonly request: ModelRequestFor<"operations.propose">;
  readonly response: Extract<
    ModelGatewayResponseV1,
    { operation: "operations.propose" }
  >;
}): Extract<ModelGatewayResponseV1, { operation: "operations.propose" }> {
  const response = modelOperationProposalResponseV1Schema.parse(input.response);
  assertExternalResourceAuthorities({ request: input.request, response });
  assertReplacementIdentityAuthority({ request: input.request, response });
  const scopeDigest = planningIdentityScopeDigest(input.request);
  const canonicalExternalResources =
    input.request.architecture.externalResources.resources;
  const canonicalNodeIds = new Set(
    input.request.architecture.nodes.map((node) => node.id),
  );
  const canonicalEdgeIds = new Set(
    input.request.architecture.edges.map((edge) => edge.id),
  );
  const canonicalExternalResourceIds = new Set(
    canonicalExternalResources.map((resource) => resource.id),
  );
  const canonicalAddressIds = new Set(
    canonicalExternalResources.flatMap((resource) =>
      resource.addresses.map((address) => address.addressId),
    ),
  );
  const canonicalInterfaceIds = new Set(
    canonicalExternalResources.flatMap((resource) =>
      resource.interfaces.map(
        (externalInterface) => externalInterface.interfaceId,
      ),
    ),
  );
  const canonicalCandidateIds = new Set(
    canonicalExternalResources.flatMap((resource) =>
      resource.extractedCandidates.map((candidate) => candidate.candidateId),
    ),
  );
  const canonicalUnresolvedInformationIds = new Set(
    canonicalExternalResources.flatMap((resource) =>
      resource.unresolvedInformation.map(
        (unresolved) => unresolved.unresolvedInformationId,
      ),
    ),
  );
  const canonicalEvidenceIds = new Set(
    canonicalExternalResources.flatMap((resource) =>
      resource.evidence.map((evidence) => evidence.evidenceId),
    ),
  );
  const canonicalContractIds = new Set(
    collectReplacementIdentityInventory({
      applicationContracts: input.request.architecture.applicationContracts,
      workloadBehavior: input.request.architecture.workloadBehavior,
    }).valuesByDomain.get("application-contract") ?? [],
  );
  const canonicalWorkloadIds = new Set(
    input.request.architecture.workloadBehavior.workloads.map(
      (workload) => workload.id,
    ),
  );
  const nodeAliases = new Map<string, string>();
  const edgeAliases = new Map<string, string>();
  const externalResourceAliases = new Map<string, string>();
  const addressAliases = new Map<string, string>();
  const interfaceAliases = new Map<string, string>();
  const candidateAliases = new Map<string, string>();
  const unresolvedInformationAliases = new Map<string, string>();
  const generatedNodeIds = new Set<string>();
  const generatedEdgeIds = new Set<string>();
  const generatedExternalResourceIds = new Set<string>();
  const generatedAddressIds = new Set<string>();
  const generatedInterfaceIds = new Set<string>();
  const generatedCandidateIds = new Set<string>();
  const generatedUnresolvedInformationIds = new Set<string>();

  response.batches.forEach((proposedBatch, batchIndex) => {
    if (proposedBatch.kind !== "graph") return;
    proposedBatch.batch.commands.forEach((command, commandIndex) => {
      const sourceKey = String(batchIndex) + ":" + String(commandIndex);
      if (command.kind === "add-node") {
        registerPlanningIdentityAlias({
          aliases: nodeAliases,
          canonicalIds: canonicalNodeIds,
          derivedId: deriveStableSolutionProposalIdV1({
            kind: "architecture-node",
            scopeDigest,
            sourceKey,
          }),
          generatedIds: generatedNodeIds,
          kind: "node",
          rawId: command.node.id,
        });
      }
      if (command.kind === "add-edge") {
        registerPlanningIdentityAlias({
          aliases: edgeAliases,
          canonicalIds: canonicalEdgeIds,
          derivedId: deriveStableSolutionProposalIdV1({
            kind: "architecture-edge",
            scopeDigest,
            sourceKey,
          }),
          generatedIds: generatedEdgeIds,
          kind: "edge",
          rawId: command.edge.id,
        });
      }
    });
  });

  const proposedExternalResources = [
    ...(response.solutionProposal?.externalResources ?? []).map(
      (resource, resourceIndex) => ({
        resource,
        resourceSourceKey: "external:" + String(resourceIndex),
      }),
    ),
    ...response.batches.flatMap((batch, batchIndex) =>
      batch.kind === "assistant"
        ? batch.batch.operations.flatMap((operation, operationIndex) =>
            operation.kind === "add-external-resource"
              ? [
                  {
                    resource: operation.resource,
                    resourceSourceKey:
                      "assistant:" +
                      String(batchIndex) +
                      ":" +
                      String(operationIndex) +
                      ":external",
                  },
                ]
              : [],
          )
        : [],
    ),
  ];
  proposedExternalResources.forEach(({ resource, resourceSourceKey }) => {
    registerPlanningIdentityAlias({
      aliases: externalResourceAliases,
      canonicalIds: canonicalExternalResourceIds,
      derivedId: deriveStableSolutionProposalIdV1({
        kind: "external-resource",
        scopeDigest,
        sourceKey: resourceSourceKey,
      }),
      generatedIds: generatedExternalResourceIds,
      kind: "external-resource",
      rawId: resource.id,
    });
    resource.addresses.forEach((address, addressIndex) => {
      registerPlanningIdentityAlias({
        aliases: addressAliases,
        canonicalIds: canonicalAddressIds,
        derivedId: deriveStableSolutionProposalIdV1({
          kind: "external-resource-address",
          scopeDigest,
          sourceKey: resourceSourceKey + ":address:" + String(addressIndex),
        }),
        generatedIds: generatedAddressIds,
        kind: "external-resource address",
        rawId: address.addressId,
      });
    });
    resource.interfaces.forEach((externalInterface, interfaceIndex) => {
      registerPlanningIdentityAlias({
        aliases: interfaceAliases,
        canonicalIds: canonicalInterfaceIds,
        derivedId: deriveStableSolutionProposalIdV1({
          kind: "external-resource-interface",
          scopeDigest,
          sourceKey: resourceSourceKey + ":interface:" + String(interfaceIndex),
        }),
        generatedIds: generatedInterfaceIds,
        kind: "external-resource interface",
        rawId: externalInterface.interfaceId,
      });
    });
    resource.extractedCandidates.forEach((candidate, candidateIndex) => {
      const candidateSourceKey =
        resourceSourceKey + ":candidate:" + String(candidateIndex);
      registerPlanningIdentityAlias({
        aliases: candidateAliases,
        canonicalIds: canonicalCandidateIds,
        derivedId: deriveStableSolutionProposalIdV1({
          kind: "external-resource-candidate",
          scopeDigest,
          sourceKey: candidateSourceKey,
        }),
        generatedIds: generatedCandidateIds,
        kind: "external-resource candidate",
        rawId: candidate.candidateId,
      });
      if (candidate.candidateValue.kind === "resource-address") {
        registerPlanningIdentityAlias({
          aliases: addressAliases,
          canonicalIds: canonicalAddressIds,
          derivedId: deriveStableSolutionProposalIdV1({
            kind: "external-resource-candidate-address",
            scopeDigest,
            sourceKey: candidateSourceKey + ":address",
          }),
          generatedIds: generatedAddressIds,
          kind: "external-resource address",
          rawId: candidate.candidateValue.value.addressId,
        });
      }
    });
    resource.unresolvedInformation.forEach((unresolved, unresolvedIndex) => {
      registerPlanningIdentityAlias({
        aliases: unresolvedInformationAliases,
        canonicalIds: canonicalUnresolvedInformationIds,
        derivedId: deriveStableSolutionProposalIdV1({
          kind: "external-resource-unresolved-information",
          scopeDigest,
          sourceKey:
            resourceSourceKey + ":unresolved:" + String(unresolvedIndex),
        }),
        generatedIds: generatedUnresolvedInformationIds,
        kind: "external-resource unresolved-information",
        rawId: unresolved.unresolvedInformationId,
      });
    });
  });

  const identities: PlanningGraphIdentityMapsV1 = {
    addressAliases,
    candidateAliases,
    canonicalAddressIds,
    canonicalCandidateIds,
    canonicalContractIds,
    canonicalEdgeIds,
    canonicalEvidenceIds,
    canonicalExternalResourceIds,
    canonicalInterfaceIds,
    canonicalNodeIds,
    canonicalUnresolvedInformationIds,
    canonicalWorkloadIds,
    edgeAliases,
    externalResourceAliases,
    generatedAddressIds,
    generatedCandidateIds,
    generatedEdgeIds,
    generatedExternalResourceIds,
    generatedInterfaceIds,
    generatedNodeIds,
    generatedUnresolvedInformationIds,
    interfaceAliases,
    nodeAliases,
    unresolvedInformationAliases,
  };
  const rewritten = rewritePlanningGraphReferences(response, identities);
  if (!isUnknownRecord(rewritten) || !Array.isArray(rewritten["batches"])) {
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.invalid-normalized-proposal",
      "The deterministic proposal identity projection is invalid.",
    );
  }
  const rewrittenBatches = rewritten["batches"].map(
    (proposedBatch, batchIndex) => {
      if (!isUnknownRecord(proposedBatch)) {
        throw new SolutionProposalPlannerError(
          "cloudmarkup.solution-planner.invalid-normalized-proposal",
          "The deterministic proposal batch projection is invalid.",
        );
      }
      if (proposedBatch["kind"] === "assistant") {
        const batch = proposedBatch["batch"];
        const rawBatch = response.batches[batchIndex];
        if (
          !isUnknownRecord(batch) ||
          !Array.isArray(batch["operations"]) ||
          rawBatch?.kind !== "assistant"
        ) {
          throw new SolutionProposalPlannerError(
            "cloudmarkup.solution-planner.invalid-normalized-proposal",
            "The deterministic Assistant operation projection is invalid.",
          );
        }
        const operations = batch["operations"].map(
          (operation, operationIndex) => {
            const rawOperation = rawBatch.batch.operations[operationIndex];
            if (
              !isUnknownRecord(operation) ||
              rawOperation === undefined ||
              typeof operation["kind"] !== "string"
            ) {
              throw new SolutionProposalPlannerError(
                "cloudmarkup.solution-planner.invalid-normalized-proposal",
                "The deterministic Assistant operation projection is invalid.",
              );
            }
            if (rawOperation.kind === "graph-command") {
              throw new SolutionProposalPlannerError(
                "cloudmarkup.solution-planner.use-graph-command-batch",
                "Model-authored graph changes must use the dedicated normalized Graph Command batch.",
              );
            }
            if (
              rawOperation.kind === "add-workload" ||
              rawOperation.kind === "add-application-contract" ||
              rawOperation.kind === "add-test-scenario"
            ) {
              throw new SolutionProposalPlannerError(
                "cloudmarkup.solution-planner.identity-heavy-addition-not-normalized",
                "Identity-heavy whole-record additions require a reviewed deterministic operation with host-issued identities.",
              );
            }
            const sourceKey =
              "assistant:" + String(batchIndex) + ":" + String(operationIndex);
            const normalizedOperation: Record<string, unknown> = {
              ...operation,
              operationId: deriveStableSolutionProposalIdV1({
                kind: "assistant-operation-" + operation["kind"],
                scopeDigest,
                sourceKey,
              }),
            };
            if (rawOperation.kind === "add-workload-operation") {
              const workloadOperation = normalizedOperation["operation"];
              if (!isUnknownRecord(workloadOperation)) {
                throw new SolutionProposalPlannerError(
                  "cloudmarkup.solution-planner.invalid-normalized-proposal",
                  "The Workload operation projection is invalid.",
                );
              }
              normalizedOperation["operation"] = {
                ...workloadOperation,
                id: deriveStableSolutionProposalIdV1({
                  kind: "workload-operation",
                  scopeDigest,
                  sourceKey,
                }),
              };
            }
            if (rawOperation.kind === "set-source-ownership") {
              const declaration = normalizedOperation["declaration"];
              if (!isUnknownRecord(declaration)) {
                throw new SolutionProposalPlannerError(
                  "cloudmarkup.solution-planner.invalid-normalized-proposal",
                  "The source ownership projection is invalid.",
                );
              }
              if (rawOperation.action === "add") {
                normalizedOperation["declaration"] = {
                  ...declaration,
                  declarationId: deriveStableSolutionProposalIdV1({
                    kind: "source-ownership-declaration",
                    scopeDigest,
                    sourceKey,
                  }),
                };
              }
            }
            if (rawOperation.kind === "upsert-ai-extension-request") {
              normalizedOperation["extensionRequestId"] =
                deriveStableSolutionProposalIdV1({
                  kind: "ai-extension-request",
                  scopeDigest,
                  sourceKey,
                });
            }
            if (rawOperation.kind === "request-clarification") {
              normalizedOperation["questionId"] =
                deriveStableSolutionProposalIdV1({
                  kind: "assistant-clarification",
                  scopeDigest,
                  sourceKey,
                });
            }
            return normalizedOperation;
          },
        );
        return {
          ...proposedBatch,
          batch: { ...batch, operations },
        };
      }
      if (proposedBatch["kind"] !== "graph") {
        return proposedBatch;
      }
      const batch = proposedBatch["batch"];
      if (!isUnknownRecord(batch) || !Array.isArray(batch["commands"])) {
        return proposedBatch;
      }
      const commands = batch["commands"].map((command, commandIndex) => {
        if (!isUnknownRecord(command) || typeof command["kind"] !== "string") {
          throw new SolutionProposalPlannerError(
            "cloudmarkup.solution-planner.invalid-normalized-proposal",
            "The deterministic proposal command projection is invalid.",
          );
        }
        const sourceKey = String(batchIndex) + ":" + String(commandIndex);
        const rawBatch = response.batches[batchIndex];
        const rawAction =
          rawBatch?.kind === "graph"
            ? rawBatch.batch.commands[commandIndex]
            : undefined;
        const normalizedCommand: Record<string, unknown> = {
          ...command,
          commandId: deriveStableSolutionProposalIdV1({
            kind: "graph-command-" + command["kind"],
            scopeDigest,
            sourceKey,
          }),
          inverseCommandId: deriveStableSolutionProposalIdV1({
            kind: "graph-command-" + command["kind"] + "-inverse",
            scopeDigest,
            sourceKey,
          }),
        };
        if (rawAction?.kind === "add-node") {
          const node = normalizedCommand["node"];
          if (isUnknownRecord(node)) {
            normalizedCommand["node"] = {
              ...node,
              id: nodeAliases.get(rawAction.node.id),
            };
          }
        }
        if (rawAction?.kind === "add-edge") {
          const edge = normalizedCommand["edge"];
          if (isUnknownRecord(edge)) {
            normalizedCommand["edge"] = {
              ...edge,
              id: edgeAliases.get(rawAction.edge.id),
            };
          }
        }
        if (rawAction?.kind === "remove-node") {
          const expectedNode = normalizedCommand["expectedNode"];
          if (isUnknownRecord(expectedNode)) {
            normalizedCommand["expectedNode"] = {
              ...expectedNode,
              id:
                nodeAliases.get(rawAction.expectedNode.id) ??
                rawAction.expectedNode.id,
            };
          }
        }
        if (rawAction?.kind === "remove-edge") {
          const expectedEdge = normalizedCommand["expectedEdge"];
          if (isUnknownRecord(expectedEdge)) {
            normalizedCommand["expectedEdge"] = {
              ...expectedEdge,
              id:
                edgeAliases.get(rawAction.expectedEdge.id) ??
                rawAction.expectedEdge.id,
            };
          }
        }
        return normalizedCommand;
      });
      return {
        ...proposedBatch,
        batch: {
          ...batch,
          commandId: deriveStableSolutionProposalIdV1({
            kind: "graph-batch",
            scopeDigest,
            sourceKey: String(batchIndex),
          }),
          commands,
          inverseCommandId: deriveStableSolutionProposalIdV1({
            kind: "graph-batch-inverse",
            scopeDigest,
            sourceKey: String(batchIndex),
          }),
        },
      };
    },
  );
  return modelOperationProposalResponseV1Schema.parse({
    ...rewritten,
    batches: rewrittenBatches,
  });
}
function validateSolutionSummary(input: {
  readonly candidateArchitecture: ArchitectureDocumentV3;
  readonly request: ModelRequestFor<"operations.propose">;
  readonly response: Extract<
    ModelGatewayResponseV1,
    { operation: "operations.propose" }
  >;
}): "ready-for-review" | "needs-user-input" {
  const context = assertRequestIsPlanning(input.request);
  const proposal = input.response.solutionProposal;
  if (proposal === undefined) {
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.missing-solution-summary",
      "A Prompt 36 operation response must include its review-only solution summary.",
    );
  }
  if (proposal.targetReadiness.target !== context.target) {
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.target-mismatch",
      "The proposal target does not match the trusted planning target.",
    );
  }
  const allowedPolicyKinds = new Set(context.allowedPolicyKinds);
  if (proposal.policyKindsUsed.some((kind) => !allowedPolicyKinds.has(kind))) {
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.unknown-policy-kind",
      "The proposal referenced a policy kind outside the supplied allowlist.",
    );
  }
  if (
    proposal.externalResources.length > context.limits.maximumExternalResources
  ) {
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.resource-limit-exceeded",
      "The proposal exceeded the external-resource limit.",
    );
  }
  assertUnique(
    proposal.externalResources.map((resource) => resource.id),
    "cloudmarkup.solution-planner.ambiguous-external-resource",
    "External-resource identities must be unique.",
  );
  assertUnique(
    proposal.testScenarios.map((scenario) => scenario.scenarioId),
    "cloudmarkup.solution-planner.ambiguous-test-scenario",
    "Test-scenario identities must be unique.",
  );
  assertUnique(
    proposal.rejectedAlternatives.map(
      (alternative) => alternative.alternativeId,
    ),
    "cloudmarkup.solution-planner.ambiguous-rejected-alternative",
    "Rejected-alternative identities must be unique.",
  );

  const workloadIds = new Set(
    input.candidateArchitecture.workloadBehavior.workloads.map(
      (workload) => workload.id,
    ),
  );
  const coverageIds = proposal.generationCoverageSuggestions.map(
    (coverage) => coverage.workloadId,
  );
  assertUnique(
    coverageIds,
    "cloudmarkup.solution-planner.ambiguous-generation-coverage",
    "Generation coverage must contain one record per candidate workload.",
  );
  if (
    coverageIds.length !== workloadIds.size ||
    [...workloadIds].some((workloadId) => !coverageIds.includes(workloadId))
  ) {
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.incomplete-generation-coverage",
      "Generation coverage must account for every candidate workload exactly once.",
    );
  }
  if (
    proposal.generationCoverageSuggestions.some(
      (coverage) => !workloadIds.has(coverage.workloadId),
    ) ||
    proposal.testScenarios.some(
      (scenario) =>
        scenario.workloadId !== undefined &&
        !workloadIds.has(scenario.workloadId),
    )
  ) {
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.unknown-workload-reference",
      "Coverage and test scenarios must reference workloads in the candidate design.",
    );
  }

  const reconciliationIds = new Set<string>(
    input.request.reconciliation?.operations.map(
      (operation) => operation.operationId,
    ) ?? [],
  );
  if (
    proposal.reconciliationSuggestions.some(
      (suggestion) => !reconciliationIds.has(suggestion.operationId),
    )
  ) {
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.ungrounded-reconciliation",
      "A reconciliation suggestion does not bind an exact deterministic import operation.",
    );
  }

  const serviceReadiness = new Map(
    context.targetReadiness.map((entry) => [entry.serviceType, entry]),
  );
  const unsupported = input.candidateArchitecture.nodes.some((node) => {
    const status = serviceReadiness.get(node.semantic.serviceType)?.status;
    return status === undefined || status === "unsupported";
  });
  const pendingTarget = input.candidateArchitecture.nodes.some(
    (node) =>
      serviceReadiness.get(node.semantic.serviceType)?.status === "pending",
  );
  if (unsupported || proposal.targetReadiness.status === "unsupported") {
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.unsupported-target",
      "At least one proposed service is not ready for the selected target.",
    );
  }

  const needsExternalInput = proposal.externalResources.some(
    (resource) =>
      externalResourceBlockingGaps(resource, context.target).length > 0 ||
      resource.lifecycle.ownershipState === "unknown-unresolved" ||
      resource.unresolvedInformation.some((item) => item.blocking),
  );
  const needsModelInput = input.response.proposalContext.unknowns.some(
    (unknown) => unknown.blocking,
  );
  return needsExternalInput ||
    needsModelInput ||
    pendingTarget ||
    proposal.targetReadiness.status === "blocked"
    ? "needs-user-input"
    : "ready-for-review";
}

interface CandidateAssessmentV1 {
  readonly assistantDiffs: readonly AssistantReviewDiffV1[];
  readonly assistantOperations: readonly AssistantOperationV1[];
  readonly candidateArchitecture: ArchitectureDocumentV3;
}

function candidateAssessmentFor(input: {
  readonly actorId: string;
  readonly createdAt: string;
  readonly request: ModelRequestFor<"operations.propose">;
  readonly response: Extract<
    ModelGatewayResponseV1,
    { operation: "operations.propose" }
  >;
}): CandidateAssessmentV1 {
  const context = assertRequestIsPlanning(input.request);
  const allowedGraphCommands = new Set(context.allowedGraphCommandKinds);
  const allowedAssistantOperations = new Set(
    context.allowedAssistantOperationKinds ?? [],
  );
  const assistantOperations: AssistantOperationV1[] = [];
  const assistantDiffs: AssistantReviewDiffV1[] = [];
  let candidate = input.request.architecture;
  const applyReviewedAssistantBatch = (
    batch: Parameters<typeof applyAssistantOperationBatchV1>[0]["batch"],
  ) => {
    if (context.assistantLimits === undefined) {
      throw new SolutionProposalPlannerError(
        "cloudmarkup.solution-planner.assistant-limits-missing",
        "Assistant operations require exact trusted Workload, contract, ownership, test, and operation limits.",
      );
    }
    const disallowed = batch.operations.find(
      (operation) => !allowedAssistantOperations.has(operation.kind),
    );
    if (disallowed !== undefined) {
      throw new SolutionProposalPlannerError(
        "cloudmarkup.solution-planner.operation-not-allowed",
        `Assistant operation kind ${disallowed.kind} is outside the exact planning allowlist.`,
      );
    }
    const operationIds = batch.operations.map(({ operationId }) => operationId);
    const applied = applyAssistantOperationBatchV1({
      batch: batch,
      document: candidate,
      limits: {
        maximumApplicationContracts:
          context.assistantLimits.maximumApplicationContracts,
        maximumEdges: context.limits.maximumEdges,
        maximumExternalResources: context.limits.maximumExternalResources,
        maximumNodes: context.limits.maximumNodes,
        maximumOperations: context.assistantLimits.maximumOperations,
        maximumSourceOwnershipDeclarations:
          context.assistantLimits.maximumSourceOwnershipDeclarations,
        maximumTestScenarios: context.assistantLimits.maximumTestScenarios,
        maximumWorkloadOperations:
          context.assistantLimits.maximumWorkloadOperations,
        maximumWorkloads: context.assistantLimits.maximumWorkloads,
      },
      provenance: {
        applicationContract: {
          recordedAt: utcTimestampSchema.parse(input.createdAt),
          recordedBy: actorIdSchema.parse(input.actorId),
          source: "designed",
          sourceReferenceIds: operationIds.slice(0, 64),
        },
        workload: {
          recordedAt: utcTimestampSchema.parse(input.createdAt),
          recordedBy: actorIdSchema.parse(input.actorId),
          source: "manual",
        },
      },
    });
    candidate = applied.candidate;
    assistantOperations.push(...batch.operations);
    assistantDiffs.push(...applied.diffs);
  };
  for (const proposedBatch of input.response.batches) {
    if (proposedBatch.kind === "graph") {
      const disallowed = proposedBatch.batch.commands.find(
        (command) =>
          command.kind === "replace-catalog-binding" ||
          !allowedGraphCommands.has(command.kind),
      );
      if (disallowed !== undefined) {
        throw new SolutionProposalPlannerError(
          "cloudmarkup.solution-planner.operation-not-allowed",
          `Graph Command kind ${disallowed.kind} is outside the exact planning allowlist.`,
        );
      }
      // Keep the original Graph Command batch atomic. These exact child
      // commands are review data under the graph allowlist, not model-supplied
      // Assistant authority and not a second command execution.
      const operations = proposedBatch.batch.commands.flatMap((command) => {
        const projected = assistantOperationV1Schema.safeParse({
          kind: "graph-command",
          operationId: command.commandId,
          command,
          rationale: `Apply the validated ${command.kind.replaceAll("-", " ")} command.`,
        });
        // Legacy planner commands may lack a granular review representation.
        // The workflow independently rejects incomplete review coverage.
        return projected.success ? [projected.data] : [];
      });
      candidate = architectureDocumentV3Schema.parse(
        applyGraphCommand(candidate, proposedBatch.batch).document,
      );
      assistantOperations.push(...operations);
      assistantDiffs.push(...operations.map(projectAssistantOperationDiffV1));
      continue;
    }
    if (proposedBatch.kind === "workload") {
      throw new SolutionProposalPlannerError(
        "cloudmarkup.solution-planner.partial-workload-operation",
        "Prompt 37 requires strict granular Assistant Workload operations instead of whole-document replacement.",
      );
    }
    if (proposedBatch.kind === "assistant") {
      applyReviewedAssistantBatch(proposedBatch.batch);
    }
  }
  const summary = input.response.solutionProposal;
  if (summary !== undefined) {
    const existingExternalIds = new Set(
      candidate.externalResources.resources.map((resource) => resource.id),
    );
    if (
      summary.externalResources.some((resource) =>
        existingExternalIds.has(resource.id),
      )
    ) {
      throw new SolutionProposalPlannerError(
        "cloudmarkup.solution-planner.external-resource-precondition",
        "A new external-resource proposal reused an existing canonical identity.",
      );
    }
    // Summary resources are untrusted mutations too. Project each into the
    // same permitted, preconditioned and diffed command path used by batches.
    for (const resource of summary.externalResources) {
      if (
        context.assistantLimits === undefined ||
        assistantOperations.length + 1 >
          context.assistantLimits.maximumOperations
      ) {
        throw new SolutionProposalPlannerError(
          "cloudmarkup.solution-planner.resource-limit-exceeded",
          "The complete proposal exceeded its exact Assistant operation limit.",
        );
      }
      applyReviewedAssistantBatch(
        assistantOperationBatchV1Schema.parse({
          baseArchitectureDigest:
            getArchitectureDocumentCanonicalHash(candidate),
          contractVersion: 1,
          kind: "cloudmarkup.assistant-operation-batch",
          operations: [
            {
              expectedExternalResourcesContentHash:
                getExternalResourceReferenceContentHash(
                  candidate.externalResources,
                ),
              kind: "add-external-resource",
              operationId:
                "assistant_external_" +
                digestStructuredValue(resource).slice(0, 32),
              rationale: "Reference the proposed external resource.",
              resource,
            },
          ],
        }),
      );
    }
  }
  const addedNodes =
    candidate.nodes.length - input.request.architecture.nodes.length;
  if (
    addedNodes > context.limits.maximumAddedNodes ||
    candidate.nodes.length > context.limits.maximumNodes ||
    candidate.edges.length > context.limits.maximumEdges ||
    candidate.externalResources.resources.length >
      context.limits.maximumExternalResources
  ) {
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.resource-limit-exceeded",
      "The proposal exceeded its exact node, edge, or External Resource limit.",
    );
  }
  return {
    assistantDiffs,
    assistantOperations,
    candidateArchitecture: candidate,
  };
}

function nextRepairRequest(
  request: ModelRequestFor<"operations.propose">,
  response: Extract<
    ModelGatewayResponseV1,
    { operation: "operations.propose" }
  >,
  diagnostics: readonly InvalidSolutionProposalDiagnosticV1[],
  attempt: number,
): ModelRequestFor<"operations.propose"> {
  return modelOperationProposalRequestV1Schema.parse({
    ...request,
    repairContext: {
      attempt,
      diagnostics: diagnostics.slice(0, 128),
      previousProposalDigest: digestStructuredValue(response),
    },
  });
}

export interface SolutionProposalAssessmentInputV2 {
  readonly input: Omit<
    SolutionProposalPlannerRequestV1,
    "maximumRepairAttempts"
  >;
  readonly result: ModelGatewayResultV1<"operations.propose">;
  readonly dependencies: Pick<
    SolutionProposalPlannerV1Dependencies,
    "allowedApprovalPathIds" | "validationRules" | "portInventory"
  >;
}
type ReviewedSolutionProposalV1 = Extract<
  SolutionProposalPlannerResultV1,
  { readonly candidateArchitecture: ArchitectureDocumentV3 }
>;
/** Completed deterministic work can report an invalid design. This is a RAM-only
 * assessment, not a validator receipt, saved design, report or promotion. */
export type SolutionProposalAssessmentV2 = Omit<
  ReviewedSolutionProposalV1,
  "contractVersion" | "disposition"
> & { readonly contractVersion: 2 } & (
    | {
        readonly validationOutcome: "passed";
        readonly disposition: ReviewedSolutionProposalV1["disposition"];
      }
    | {
        readonly validationOutcome: "failed";
        readonly disposition: "validation-failed";
      }
  );
/** Preserve normal V1 behavior: only a fully valid candidate may be reviewed. */
export function evaluateSolutionProposalV1(
  options: SolutionProposalAssessmentInputV2,
): ReviewedSolutionProposalV1 {
  const assessment = assessSolutionProposalV2(options);
  if (assessment.modelResult.response.batches[0]?.kind === "safety-refusal")
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.safety-refused",
      "The model declined the request under its bounded safety policy.",
    );
  if (assessment.validationOutcome === "failed")
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.deterministic-validation-failed",
      "The candidate design failed deterministic architecture validation.",
    );
  const { validationOutcome, ...result } = assessment;
  void validationOutcome;
  return { ...result, contractVersion: 1 };
}
/** Assess an exact already generated operations proposal with the real command
 * preview and deterministic rules. Failed quality retains the actual report;
 * unavailable/incomplete validators and mismatched authority still fail closed.
 * No provider, persistence or graph mutation port is present. */
export function assessSolutionProposalV2(
  options: SolutionProposalAssessmentInputV2,
): SolutionProposalAssessmentV2 {
  const { input, result, dependencies } = options;
  const request = modelOperationProposalRequestV1Schema.parse(
    input.modelRequest,
  );
  assertRequestIsPlanning(request);
  const context = input.gatewayContext;
  const descriptor = modelInvocationDescriptorV1Schema.parse(result.descriptor);
  const sanitized = modelOperationProposalRequestV1Schema.parse(
    redactModelRequest(request).request,
  );
  validateModelRequestAuthority(request);
  validateModelRequestAuthority(sanitized);
  if (
    descriptor.feature !== request.operation ||
    descriptor.complexity !== context.complexity ||
    (request.reconciliation !== undefined &&
      request.reconciliation.repositorySnapshotId !==
        context.scope.repositorySnapshotId) ||
    digestStructuredValue(descriptor.scope) !==
      digestStructuredValue(context.scope) ||
    descriptor.invocationId !== context.invocationId ||
    descriptor.idempotencyKeyDigest !== context.idempotencyKeyDigest ||
    descriptor.inputDigest !==
      digestStructuredValue({ request: sanitized, scope: context.scope }) ||
    descriptor.budgetDecisionId !== context.budget.decisionId ||
    descriptor.entitlementDecisionId !== context.entitlement.decisionId ||
    descriptor.evaluationPolicyId !== context.evaluationPolicyId ||
    descriptor.evaluationPolicyVersion !== context.evaluationPolicyVersion ||
    descriptor.requestedMode !== context.requestedMode ||
    request.requestedMode !== context.requestedMode ||
    (descriptor.routing?.routingDecisionDigest ?? null) !==
      (context.routingDecision === undefined
        ? null
        : digestStructuredValue(context.routingDecision))
  )
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.invocation-binding-mismatch",
      "The proposal does not match the exact request, tenant and invocation authority.",
    );

  if (
    input.gatewayContext.scope.solutionRevisionId !== input.solutionRevisionId
  )
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.solution-revision-mismatch",
      "Planning issue authority must match the trusted gateway scope.",
    );
  const secretInspection = inspectModelValueForSecretCandidatesV1(
    result.response,
  );
  if (secretInspection.detectedValueCount > 0) {
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.secret-value-detected",
      "A model proposal contained a secret or credential candidate instead of a reference.",
    );
  }
  validateModelResponseAuthority({
    allowedApprovalPathIds: dependencies.allowedApprovalPathIds,
    descriptor: result.descriptor,
    request,
    response: result.response,
  });
  const normalizedResponse = normalizePlanningResponseIdentities({
    request,
    response: result.response,
  });
  const normalizedModelResult = {
    ...result,
    response: normalizedResponse,
  };
  const assessment = candidateAssessmentFor({
    actorId: input.gatewayContext.scope.userId,
    createdAt: input.createdAt,
    request,
    response: normalizedResponse,
  });
  const { candidateArchitecture } = assessment;
  const refusal =
    normalizedResponse.batches[0]?.kind === "safety-refusal"
      ? normalizedResponse.batches[0]
      : undefined;
  const summaryDisposition =
    refusal === undefined
      ? validateSolutionSummary({
          candidateArchitecture,
          request,
          response: normalizedResponse,
        })
      : "needs-user-input";
  const disposition = assessment.assistantOperations.some(
    (operation) =>
      operation.kind === "request-clarification" && operation.blocking,
  )
    ? "needs-user-input"
    : summaryDisposition;
  const validationReport = validateArchitectureDocumentWithRules({
    ...(dependencies.validationRules === undefined
      ? {}
      : { additionalRules: dependencies.validationRules }),
    document: candidateArchitecture,
    environment: input.validationEnvironment,
    ...(dependencies.portInventory === undefined
      ? {}
      : { portInventory: dependencies.portInventory }),
    target: "compilation",
  });
  const declaredRuleIds = new Set(
    assertRequestIsPlanning(request).validationRules.map((rule) => rule.ruleId),
  );
  const executedRuleIds = new Set<string>(
    validationReport.executedRules.map((rule) => rule.ruleId),
  );
  if ([...declaredRuleIds].some((ruleId) => !executedRuleIds.has(ruleId))) {
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.validation-coverage-incomplete",
      "Every supplied placement, connection, policy, security, cost-sensitive, coverage, and target-readiness rule must execute.",
    );
  }
  if (validationReport.evaluationStatus !== "complete") {
    throw new SolutionProposalPlannerError(
      "cloudmarkup.solution-planner.deterministic-validation-failed",
      "The candidate design failed deterministic architecture validation.",
    );
  }
  const activeIssues = validationReport.findings.map((finding) =>
    activeIssueForFinding({
      createdAt: input.createdAt,
      finding,
      modelResult: normalizedModelResult,
      solutionRevisionId: input.solutionRevisionId,
    }),
  );
  activeIssues.push(
    ...activeIssuesForProposalGaps({
      createdAt: input.createdAt,
      modelResult: normalizedModelResult,
      solutionRevisionId: input.solutionRevisionId,
      target: assertRequestIsPlanning(request).target,
    }),
  );
  if (refusal !== undefined)
    activeIssues.push(
      activeIssueForProposalGap({
        affected: [
          {
            kind: "solution-revision",
            solutionRevisionId: input.solutionRevisionId,
          },
        ],
        category: "security",
        createdAt: input.createdAt,
        gapId: "typed_safety_refusal",
        modelResult: normalizedModelResult,
        severity: "error",
        solutionRevisionId: input.solutionRevisionId,
        summary: "The model declined the request under its safety policy.",
        technicalDetail: refusal.explanation,
      }),
    );
  activeIssues.sort((left, right) => compareUtf16(left.id, right.id));
  return {
    activeIssues,
    assistantDiffs: assessment.assistantDiffs,
    assistantOperations: assessment.assistantOperations,
    candidateArchitecture,
    contractVersion: 2,
    ...(refusal !== undefined ||
    validationReport.findings.some((finding) =>
      ["error", "security-error"].includes(finding.severity),
    )
      ? {
          validationOutcome: "failed" as const,
          disposition: "validation-failed" as const,
        }
      : { validationOutcome: "passed" as const, disposition }),
    modelResult: result,
    proposalDigest: digestStructuredValue({
      assistantDiffs: assessment.assistantDiffs,
      assistantOperations: assessment.assistantOperations,
      candidateArchitecture,
      normalizedResponse,
      rawResponseDigest: digestStructuredValue(result.response),
      validationReport,
    }),
    validationReport,
    writeAuthority: "none",
  };
}

export class ReviewOnlySolutionProposalPlannerV1 {
  readonly #dependencies: SolutionProposalPlannerV1Dependencies;

  public constructor(dependencies: SolutionProposalPlannerV1Dependencies) {
    this.#dependencies = dependencies;
  }

  public async propose(
    input: SolutionProposalPlannerRequestV1,
    signal?: AbortSignal,
  ): Promise<SolutionProposalPlannerResultV1> {
    assertRequestIsPlanning(input.modelRequest);
    if (
      input.gatewayContext.scope.solutionRevisionId !== input.solutionRevisionId
    ) {
      throw new SolutionProposalPlannerError(
        "cloudmarkup.solution-planner.solution-revision-mismatch",
        "Planning issue authority must match the trusted gateway scope.",
      );
    }
    let request = input.modelRequest;
    let attempts = 0;
    let lastDiagnostics: readonly InvalidSolutionProposalDiagnosticV1[] = [];
    while (attempts <= input.maximumRepairAttempts) {
      attempts += 1;
      const gatewayContext =
        attempts === 1
          ? input.gatewayContext
          : {
              ...input.gatewayContext,
              idempotencyKeyDigest: sha256Text(
                `${input.gatewayContext.idempotencyKeyDigest}\u0000repair\u0000${String(attempts - 1)}`,
              ),
              invocationId: deriveStableSolutionProposalIdV1({
                kind: "invocation-repair",
                sourceKey: `${input.gatewayContext.invocationId}-${String(attempts - 1)}`,
                scopeDigest: digestStructuredValue(input.gatewayContext.scope),
              }),
            };
      const result = await this.#dependencies.gateway.proposeOperations(
        request,
        gatewayContext,
        signal,
      );
      try {
        return evaluateSolutionProposalV1({
          input: { ...input, gatewayContext, modelRequest: request },
          result,
          dependencies: this.#dependencies,
        });
      } catch (error) {
        lastDiagnostics = [...diagnosticsFor(error)].sort(
          (left, right) =>
            compareUtf16(left.path, right.path) ||
            compareUtf16(left.code, right.code) ||
            compareUtf16(left.message, right.message),
        );
        // A valid typed refusal is terminal. Do not repair it into commands or
        // retain its body as an invalid proposal.
        if (
          error instanceof SolutionProposalPlannerError &&
          error.code === "cloudmarkup.solution-planner.safety-refused"
        )
          break;
        const proposalCanonicalJson = serializeCanonicalJson(result.response);
        await this.#dependencies.invalidProposalStore.preserveRestricted({
          classification: "restricted-model-proposal",
          diagnostics: lastDiagnostics,
          invocationId: result.descriptor.invocationId,
          organizationId: input.gatewayContext.scope.organizationId,
          ...(input.gatewayContext.scope.projectId === undefined
            ? {}
            : { projectId: input.gatewayContext.scope.projectId }),
          proposalCanonicalJson,
          proposalDigest: digestStructuredValue(result.response),
          retentionPolicyId: "cloudmarkup.invalid-model-proposal.v1",
        });
        if (attempts > input.maximumRepairAttempts) break;
        request = nextRepairRequest(
          input.modelRequest,
          result.response,
          lastDiagnostics,
          attempts,
        );
      }
    }
    return {
      attempts,
      contractVersion: 1,
      diagnostics: lastDiagnostics,
      disposition: "rejected",
      writeAuthority: "none",
    };
  }
}

export class InMemoryRestrictedInvalidSolutionProposalStoreV1 implements InvalidSolutionProposalStoreV1 {
  public readonly records: RestrictedInvalidSolutionProposalV1[] = [];

  public preserveRestricted(
    record: RestrictedInvalidSolutionProposalV1,
  ): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }
}
