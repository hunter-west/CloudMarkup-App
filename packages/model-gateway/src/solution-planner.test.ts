import { describe, expect, it } from "vitest";

import {
  defineValidationRuleV1,
  createValidationFindingCode,
  createValidationDocumentPath,
  getArchitectureDocumentCanonicalHash,
  getExternalResourceReferenceContentHash,
  getWorkloadBehaviorContentHash,
} from "@cloudmarkup/domain";
import {
  assistantOperationBatchV1Schema,
  externalResourceV1Schema,
  namespacedIdentifierSchema,
  proposalItemIdSchema,
  providerIdSchema,
  modelOperationProposalRequestV1Schema,
  modelInvocationDescriptorV1Schema,
  reconciliationProposalV1Schema,
  type ModelGatewayResponseV1,
} from "@cloudmarkup/schemas";

import {
  DeterministicFakeModelAdapter,
  ScriptedFakeModelAdapter,
  deterministicFakeResponseV1,
  InMemoryModelInvocationStore,
  CollectingModelUsageRecorder,
  CollectingSafeModelLogger,
  deterministicFakeRoutingV1,
} from "./fakes.js";
import { ProviderNeutralModelGateway } from "./gateway.js";
import type {
  ModelGatewayInvocationContextV1,
  ModelGatewayResultV1,
  ModelRequestFor,
} from "./ports.js";
import {
  InMemoryRestrictedInvalidSolutionProposalStoreV1,
  ReviewOnlySolutionProposalPlannerV1,
  evaluateSolutionProposalV1,
  assessSolutionProposalV2,
  deriveStableSolutionProposalIdV1,
  type SolutionPlanningGatewayV1,
} from "./solution-planner.js";
import {
  ModelGatewayValidationError,
  digestStructuredValue,
  sha256Text,
  validateModelRequestAuthority,
} from "./security.js";
import {
  TEST_DIGEST,
  modelTestContext,
  modelTestRequests,
  testIntent,
  testSolutionRevision,
} from "./test-helpers.js";

type OperationResponse = Extract<
  ModelGatewayResponseV1,
  { operation: "operations.propose" }
>;

const planningValidationRules = [
  "placement",
  "connection",
  "policy",
  "security",
  "cost",
  "coverage",
  "target-readiness",
].map((kind) =>
  defineValidationRuleV1({
    applicability: {
      catalogs: { kind: "all" },
      environments: ["development"],
      providers: { kind: "all" },
      targets: ["compilation"],
    },
    evaluate: () => [],
    id: `example.validation.${kind}`,
    input: "architecture-document",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
  }),
);

function requestFor<TOperation extends ModelGatewayResponseV1["operation"]>(
  operation: TOperation,
) {
  const request = modelTestRequests().find(
    (candidate) => candidate.operation === operation,
  );
  if (request === undefined) throw new Error(`Missing request ${operation}.`);
  return request as Extract<
    ReturnType<typeof modelTestRequests>[number],
    { operation: TOperation }
  >;
}

function configuredFakeGateway(): ProviderNeutralModelGateway {
  return new ProviderNeutralModelGateway({
    adapters: [new DeterministicFakeModelAdapter()],
    allowedApprovalPathIds: ["cloudmarkup.dependency-review.v1"],
    invocationStore: new InMemoryModelInvocationStore(),
    invalidProposalStore:
      new InMemoryRestrictedInvalidSolutionProposalStoreV1(),
    logger: new CollectingSafeModelLogger(),
    routing: deterministicFakeRoutingV1,
    usageRecorder: new CollectingModelUsageRecorder(),
  });
}

function planningRequest(input?: {
  readonly maximumAddedNodes?: number;
  readonly target?: "terraform" | "cloudformation";
  readonly targetStatus?: "ready" | "pending" | "unsupported";
  readonly withRepositoryEvidence?: boolean;
  readonly withReconciliation?: boolean;
}): ModelRequestFor<"operations.propose"> {
  const base = requestFor("operations.propose");
  const repository = requestFor("repository.interpret");
  const target = input?.target ?? "terraform";
  const targetStatus = input?.targetStatus ?? "ready";
  const reconciliation = input?.withReconciliation
    ? reconciliationProposalV1Schema.parse({
        applyPolicy: "explicit-review-and-deterministic-operation",
        authority: "proposal-only",
        contractVersion: 1,
        kind: "cloudmarkup.reconciliation-proposal",
        observedContentHash: sha256Text("observed-content"),
        observedSolutionId: "observed_solution_planning_test",
        operations: [
          {
            kind: "keep-observed-only",
            operationId: "reconciliation_operation_planning_test",
            rationale:
              "Keep the deterministic repository observation as evidence only.",
            target: {
              kind: "resource",
              observedResourceId: "observed_resource_planning_test",
              recordDigest: sha256Text("observed-resource"),
            },
          },
        ],
        proposalId: "reconciliation_proposal_planning_test",
        provenance: {
          actor: {
            kind: "deterministic-tool",
            tool: {
              id: "cloudmarkup.repository-importer",
              version: "1.0.0",
            },
          },
          createdAt: "2026-08-21T12:00:00.000Z",
          inputDigests: [sha256Text("observed-content")],
        },
        repositorySnapshotDigest: repository.repositorySnapshotDigest,
        repositorySnapshotId: repository.repositorySnapshotId,
        review: { state: "pending-review" },
      })
    : undefined;
  return modelOperationProposalRequestV1Schema.parse({
    ...base,
    planningContext: {
      allowedAssistantOperationKinds: [
        "add-external-resource",
        "add-workload-operation",
        "edit-workload",
        "edit-workload-operation",
        "edit-application-contract",
        "edit-external-resource",
        "set-source-ownership",
        "upsert-ai-extension-request",
        "review-repository-difference",
        "request-clarification",
      ],
      allowedGraphCommandKinds: [
        "add-edge",
        "add-node",
        "move-node",
        "replace-workload-and-application-contracts",
      ],
      allowedPolicyKinds: ["aws.iam.policy.identity-inline"],
      approvedIntent: testIntent,
      ...(!input?.withRepositoryEvidence && !input?.withReconciliation
        ? {}
        : {
            approvedRepositoryEvidence: {
              commitSha: repository.commitSha,
              evidence: repository.evidence,
              repositorySnapshotDigest: repository.repositorySnapshotDigest,
              repositorySnapshotId: repository.repositorySnapshotId,
            },
          }),
      assistantLimits: {
        maximumApplicationContracts: 64,
        maximumOperations: 64,
        maximumSourceOwnershipDeclarations: 64,
        maximumTestScenarios: 64,
        maximumWorkloadOperations: 64,
        maximumWorkloads: 64,
      },
      limits: {
        maximumAddedNodes: input?.maximumAddedNodes ?? 8,
        maximumEdges: 32,
        maximumExternalResources: 8,
        maximumNodes: 32,
      },
      target,
      targetReadiness: base.architecture.nodes.map((node) => ({
        rationale:
          "This exact synthetic service is covered by the test target.",
        serviceType: node.semantic.serviceType,
        status: targetStatus,
        target,
      })),
      validationRules: [
        {
          kind: "placement",
          ruleId: "example.validation.placement",
        },
        {
          kind: "connection",
          ruleId: "example.validation.connection",
        },
        {
          kind: "policy",
          ruleId: "example.validation.policy",
        },
        {
          kind: "security",
          ruleId: "example.validation.security",
        },
        {
          kind: "cost-sensitive",
          ruleId: "example.validation.cost",
        },
        {
          kind: "coverage",
          ruleId: "example.validation.coverage",
        },
        {
          kind: "target-readiness",
          ruleId: "example.validation.target-readiness",
        },
      ],
    },
    ...(reconciliation === undefined ? {} : { reconciliation }),
  });
}

function planner(
  gateway: SolutionPlanningGatewayV1,
  store = new InMemoryRestrictedInvalidSolutionProposalStoreV1(),
) {
  return {
    planner: new ReviewOnlySolutionProposalPlannerV1({
      allowedApprovalPathIds: new Set(["cloudmarkup.dependency-review.v1"]),
      gateway,
      invalidProposalStore: store,
      validationRules: planningValidationRules,
    }),
    store,
  };
}

function plannerInput(
  request: ModelRequestFor<"operations.propose">,
  invocationId: string,
  maximumRepairAttempts: 0 | 1 | 2 = 0,
) {
  return {
    createdAt: "2026-08-21T12:00:00.000Z",
    gatewayContext: modelTestContext(invocationId),
    maximumRepairAttempts,
    modelRequest: request,
    solutionRevisionId: testSolutionRevision.solutionRevisionId,
    validationEnvironment: "development" as const,
  };
}

type ResponseTransformer = (
  response: OperationResponse,
  request: ModelRequestFor<"operations.propose">,
  call: number,
) => OperationResponse;

class TransformingPlanningGateway implements SolutionPlanningGatewayV1 {
  public calls = 0;
  private readonly gateway: SolutionPlanningGatewayV1;
  private readonly transform: ResponseTransformer;

  public constructor(
    gateway: SolutionPlanningGatewayV1,
    transform: ResponseTransformer,
  ) {
    this.gateway = gateway;
    this.transform = transform;
  }

  public async proposeOperations(
    request: ModelRequestFor<"operations.propose">,
    context: ModelGatewayInvocationContextV1,
    signal?: AbortSignal,
  ): Promise<ModelGatewayResultV1<"operations.propose">> {
    const result = await this.gateway.proposeOperations(
      request,
      context,
      signal,
    );
    this.calls += 1;
    return {
      ...result,
      response: this.transform(
        structuredClone(result.response),
        request,
        this.calls,
      ),
    };
  }
}

function graphEnvelope(
  request: ModelRequestFor<"operations.propose">,
  commandId: string,
) {
  return {
    commandId,
    inverseCommandId: `${commandId}_inverse`,
    origin: "ai-accepted" as const,
    schemaVersion: 1 as const,
    target: {
      architectureId: request.architecture.architectureId,
      documentId: request.architecture.documentId,
      revisionId: request.architecture.revision.revisionId,
    },
  };
}

function withGraphCommand(
  response: OperationResponse,
  request: ModelRequestFor<"operations.propose">,
  command: Record<string, unknown>,
): OperationResponse {
  return {
    ...response,
    batches: [
      ...response.batches,
      {
        batch: {
          ...graphEnvelope(request, `batch_${String(command["commandId"])}`),
          commands: [command],
          kind: "batch",
        },
        kind: "graph",
      },
    ],
  } as OperationResponse;
}

function solutionProposalFor(
  response: OperationResponse,
): NonNullable<OperationResponse["solutionProposal"]> {
  if (response.solutionProposal === undefined) {
    throw new Error("Missing deterministic solution proposal.");
  }
  return response.solutionProposal;
}

function expectRequestAuthorityCode(
  request: ModelRequestFor<"operations.propose">,
  code: string,
): void {
  try {
    validateModelRequestAuthority(request);
  } catch (error) {
    expect(error).toBeInstanceOf(ModelGatewayValidationError);
    if (!(error instanceof ModelGatewayValidationError)) throw error;
    expect(error.code).toBe(code);
    return;
  }
  throw new Error("Expected request authority validation to fail.");
}

function addNodeResponse(
  response: OperationResponse,
  request: ModelRequestFor<"operations.propose">,
  input?: {
    readonly maliciousLabel?: string;
    readonly rawNodeId?: string;
    readonly unknownService?: boolean;
  },
): OperationResponse {
  const source = request.architecture.nodes[0];
  if (source === undefined) throw new Error("Missing source node fixture.");
  const nodeId = input?.rawNodeId ?? "node_model_authored_candidate";
  return withGraphCommand(response, request, {
    ...graphEnvelope(request, `command_add_${nodeId}`),
    kind: "add-node",
    node: {
      ...source,
      id: nodeId,
      presentation: {
        ...source.presentation,
        label: input?.maliciousLabel ?? "Additional event source",
      },
      semantic: {
        ...source.semantic,
        deploymentKey: "additional_source",
        ...(input?.unknownService
          ? {
              serviceType: "example.unknown-service",
            }
          : {}),
        lifecycle: { origin: "ai-accepted", ownership: "user" },
      },
    },
  });
}

function expectedPlanningStructuralId(
  request: ModelRequestFor<"operations.propose">,
  kind: string,
  sourceKey: string,
): string {
  return deriveStableSolutionProposalIdV1({
    kind,
    sourceKey,
    scopeDigest: digestStructuredValue({
      architectureId: request.architecture.architectureId,
      catalog: request.architecture.catalog,
      documentId: request.architecture.documentId,
      revisionId: request.architecture.revision.revisionId,
    }),
  });
}

function expectedPlanningGraphId(
  request: ModelRequestFor<"operations.propose">,
  kind: "architecture-edge" | "architecture-node",
  batchIndex: number,
  commandIndex = 0,
): string {
  return expectedPlanningStructuralId(
    request,
    kind,
    String(batchIndex) + ":" + String(commandIndex),
  );
}

function externalResource(input?: {
  readonly ambiguousOwnership?: boolean;
  readonly missingSecretReference?: boolean;
  readonly secretReferences?: readonly string[];
}) {
  const unresolvedInformation: {
    blocking: boolean;
    fieldPath: string;
    summary: string;
    unresolvedInformationId: string;
  }[] = [];
  if (input?.ambiguousOwnership) {
    unresolvedInformation.push({
      blocking: true,
      fieldPath: "$.lifecycle.ownershipState",
      summary: "Confirm who owns this resource and whether import is intended.",
      unresolvedInformationId: "external_unknown_ownership",
    });
  }
  if (input?.missingSecretReference) {
    unresolvedInformation.push({
      blocking: true,
      fieldPath: "$.interfaces",
      summary:
        "Provide an approved secret reference for authentication; do not provide a secret value.",
      unresolvedInformationId: "external_missing_secret_reference",
    });
  }
  const ambiguous = input?.ambiguousOwnership === true;
  return externalResourceV1Schema.parse({
    addresses: ambiguous
      ? []
      : [
          {
            addressId: "external_address_api",
            kind: "url" as const,
            value: "https://api.example.test/v1",
          },
        ],
    architectureNodeIds: [],
    availability: { assumption: "unknown" as const },
    capability: "external.http-api",
    dataClassifications: ["confidential" as const],
    displayName: "Existing customer API",
    evidence: [],
    extractedCandidates: [],
    id: ambiguous ? "external_resource_ambiguous" : "external_resource_api",
    interfaces: [
      {
        authentication:
          input?.secretReferences === undefined
            ? { method: "none" as const }
            : {
                method: "api-key-reference" as const,
                secretReferences: [...input.secretReferences],
              },
        contracts: [],
        direction: "bidirectional" as const,
        interfaceId: "external_interface_api",
        protocol: "external.https",
      },
    ],
    lifecycle: ambiguous
      ? {
          behavior: {
            create: "forbidden" as const,
            dataSource: "unresolved" as const,
            import: "unresolved" as const,
            reference: "unresolved" as const,
          },
          iacTargets: [
            { readiness: "unresolved" as const, target: "terraform" as const },
          ],
          lifecycleAuthority: "unresolved" as const,
          ownershipState: "unknown-unresolved" as const,
        }
      : {
          behavior: {
            create: "forbidden" as const,
            dataSource: "allowed" as const,
            import: "unsupported" as const,
            reference: "required" as const,
          },
          iacTargets: [
            {
              readiness: "reference-ready" as const,
              target: "terraform" as const,
            },
          ],
          lifecycleAuthority: "third-party-owner" as const,
          ownershipState: "third-party-service-api" as const,
        },
    provider: {
      providerId: "external.provider",
      serviceFamily: "external.http-api",
      state: "known" as const,
    },
    scope: { location: "global" },
    trustBoundary: "public-internet" as const,
    unresolvedInformation,
  });
}

function modelAuthoredExternalResource(input: {
  readonly architectureNodeIds?: readonly string[];
  readonly displayName: string;
  readonly prefix: string;
}) {
  const base = externalResource();
  const address = base.addresses[0];
  const externalInterface = base.interfaces[0];
  if (address === undefined || externalInterface === undefined) {
    throw new Error("Missing External Resource fixture.");
  }
  return externalResourceV1Schema.parse({
    ...base,
    addresses: [
      {
        ...address,
        addressId: input.prefix + "_address",
      },
    ],
    architectureNodeIds: [...(input.architectureNodeIds ?? [])],
    displayName: input.displayName,
    extractedCandidates: [
      {
        candidateId: input.prefix + "_candidate",
        candidateValue: {
          kind: "resource-address",
          value: {
            ...address,
            addressId: input.prefix + "_candidate_address",
          },
        },
        confidenceBasisPoints: 8_000,
        fieldPath: "$.addresses",
        provenance: {
          modelGatewayId: "cloudmarkup.model-gateway",
          modelId: "cloudmarkup.fake-model",
          outputDigest: TEST_DIGEST,
          promptDigest: TEST_DIGEST,
          promptTemplateId: "cloudmarkup.external-resource-proposal",
          promptVersion: "1.0.0",
          source: "ai-extraction",
        },
      },
    ],
    id: input.prefix + "_resource",
    interfaces: [
      {
        ...externalInterface,
        interfaceId: input.prefix + "_interface",
      },
    ],
    lifecycle: {
      behavior: {
        create: "forbidden",
        dataSource: "optional",
        import: "reviewed-required",
        importAddressId: input.prefix + "_address",
        reference: "required",
      },
      iacTargets: [{ readiness: "import-ready", target: "terraform" }],
      lifecycleAuthority: "current-customer-iac",
      ownershipState: "imported-current-iac-lifecycle",
    },
    unresolvedInformation: [
      {
        blocking: false,
        fieldPath: "$.description",
        summary: "Optional descriptive context can be confirmed during review.",
        unresolvedInformationId: input.prefix + "_unresolved",
      },
    ],
  });
}

describe("evaluateSolutionProposalV1", () => {
  const dependencies = {
    allowedApprovalPathIds: new Set(["cloudmarkup.dependency-review.v1"]),
    validationRules: planningValidationRules,
  };
  it("validates the exact already generated proposal reproducibly without another model call", async () => {
    const input = plannerInput(
      planningRequest(),
      "invocation_direct_validation",
    );
    const original = structuredClone(input.modelRequest);
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response) => response,
    );
    const result = await gateway.proposeOperations(
      input.modelRequest,
      input.gatewayContext,
    );
    const before = structuredClone(result);
    const assessed = evaluateSolutionProposalV1({
      input,
      result,
      dependencies,
    });
    expect(assessed.disposition).toBe("ready-for-review");
    expect(assessed.writeAuthority).toBe("none");
    const graphBatches = assessed.modelResult.response.batches.filter(
      (batch) => batch.kind === "graph",
    );
    const commands = graphBatches.flatMap((batch) => batch.batch.commands);
    expect(commands.length).toBeGreaterThan(0);
    expect(assessed.assistantOperations).toHaveLength(commands.length);
    const reviewed = assessed.assistantOperations[0];
    expect(reviewed?.kind).toBe("graph-command");
    if (reviewed?.kind !== "graph-command")
      throw Error("Missing graph review.");
    expect(reviewed.operationId).toBe(reviewed.command.commandId);
    expect(reviewed.operationId).not.toBe(commands[0]?.commandId);
    expect(reviewed.command.kind).toBe(commands[0]?.kind);
    expect(assessed.assistantDiffs[0]?.operationIds).toEqual([
      reviewed.operationId,
    ]);
    expect(assessed.validationReport.evaluationStatus).toBe("complete");
    expect(
      assessed.validationReport.executedRules.map((rule) => rule.ruleId),
    ).toEqual(
      expect.arrayContaining(planningValidationRules.map((rule) => rule.id)),
    );
    expect(evaluateSolutionProposalV1({ input, result, dependencies })).toEqual(
      assessed,
    );
    expect(input.modelRequest).toEqual(original);
    expect(result).toEqual(before);
    expect(gateway.calls).toBe(1);
  });

  it.each([
    "scope",
    "invocation",
    "idempotency",
    "budget",
    "entitlement",
    "evaluation",
    "input",
  ] as const)(
    "rejects a direct assessment with substituted %s metadata",
    async (change) => {
      const input = plannerInput(planningRequest(), "invocation_direct_bound");
      const gateway = configuredFakeGateway();
      const result = await gateway.proposeOperations(
        input.modelRequest,
        input.gatewayContext,
      );
      const foreign = digestStructuredValue("foreign synthetic input");
      const descriptor = modelInvocationDescriptorV1Schema.parse({
        ...result.descriptor,
        ...(change === "scope"
          ? {
              scope: {
                ...result.descriptor.scope,
                organizationId: "foreign_organization",
              },
            }
          : {}),
        ...(change === "invocation"
          ? { invocationId: "foreign_invocation" }
          : {}),
        ...(change === "idempotency" ? { idempotencyKeyDigest: foreign } : {}),
        ...(change === "budget" ? { budgetDecisionId: "foreign_budget" } : {}),
        ...(change === "entitlement"
          ? { entitlementDecisionId: "foreign_entitlement" }
          : {}),
        ...(change === "evaluation"
          ? { evaluationPolicyId: "foreign.evaluation" }
          : {}),
        ...(change === "input" ? { inputDigest: foreign } : {}),
      });
      expect(() =>
        evaluateSolutionProposalV1({
          input,
          dependencies,
          result: { ...result, descriptor },
        }),
      ).toThrow("The proposal does not match the exact request");
    },
  );

  it("requires every declared validation rule when assessing an existing response", async () => {
    const input = plannerInput(
      planningRequest(),
      "invocation_direct_incomplete",
    );
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response) => response,
    );
    const result = await gateway.proposeOperations(
      input.modelRequest,
      input.gatewayContext,
    );
    expect(() =>
      evaluateSolutionProposalV1({
        input,
        result,
        dependencies: { ...dependencies, validationRules: [] },
      }),
    ).toThrow("Every supplied placement");
    expect(gateway.calls).toBe(1);
  });

  it("exposes a complete positive V2 assessment with the exact unchanged V1 result", async () => {
    const input = plannerInput(
      planningRequest(),
      "invocation_assessment_passed",
    );
    const gateway = configuredFakeGateway();
    const result = await gateway.proposeOperations(
      input.modelRequest,
      input.gatewayContext,
    );
    const assessed = assessSolutionProposalV2({ input, result, dependencies });
    expect(assessed.validationOutcome).toBe("passed");
    expect(assessed.contractVersion).toBe(2);
    const { validationOutcome, ...content } = assessed;
    void validationOutcome;
    expect({ ...content, contractVersion: 1 }).toEqual(
      evaluateSolutionProposalV1({ input, result, dependencies }),
    );
  });
  it.each(["error", "security-error"] as const)(
    "retains actual completed %s findings without approving or mutating the proposal",
    async (severity) => {
      const input = plannerInput(
        planningRequest(),
        "invocation_assessment_failed",
      );
      const gateway = new TransformingPlanningGateway(
        configuredFakeGateway(),
        (response) => response,
      );
      const result = await gateway.proposeOperations(
        input.modelRequest,
        input.gatewayContext,
      );
      const originalInput = structuredClone(input);
      const originalResult = structuredClone(result);
      const validationRules = planningValidationRules.map((rule) =>
        rule.id.endsWith(".security")
          ? defineValidationRuleV1({
              ...rule,
              evaluate: () => [
                {
                  code: createValidationFindingCode(
                    "example.validation.failed-design",
                  ),
                  severity,
                  title: "Synthetic rejected design",
                  beginnerExplanation: "The synthetic design needs correction.",
                  technicalExplanation:
                    "The configured deterministic rule reported a failed design.",
                  affected: [
                    {
                      kind: "document",
                      path: createValidationDocumentPath("$.nodes"),
                    },
                  ],
                  documentationReferences: [],
                },
              ],
            })
          : rule,
      );
      const options = {
        input,
        result,
        dependencies: { ...dependencies, validationRules },
      };
      const assessed = assessSolutionProposalV2(options);
      expect(assessed).toMatchObject({
        contractVersion: 2,
        disposition: "validation-failed",
        validationOutcome: "failed",
        writeAuthority: "none",
      });
      expect(assessed.validationReport.evaluationStatus).toBe("complete");
      expect(assessed.validationReport.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "example.validation.failed-design",
            severity,
          }),
        ]),
      );
      expect(assessed.activeIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity,
            lifecycle: { state: "current" },
          }),
        ]),
      );
      expect(assessSolutionProposalV2(options)).toEqual(assessed);
      expect(() => evaluateSolutionProposalV1(options)).toThrow(
        "The candidate design failed deterministic architecture validation.",
      );
      expect(input).toEqual(originalInput);
      expect(result).toEqual(originalResult);
      expect(gateway.calls).toBe(1);
    },
  );
  it("does not turn unavailable validators into completed negative quality", async () => {
    const input = plannerInput(
      planningRequest(),
      "invocation_assessment_unavailable",
    );
    const gateway = configuredFakeGateway();
    const result = await gateway.proposeOperations(
      input.modelRequest,
      input.gatewayContext,
    );
    const unavailable = planningValidationRules.map((rule) =>
      defineValidationRuleV1({
        ...rule,
        evaluate: () => {
          throw Error("Synthetic unavailable validator.");
        },
      }),
    );
    expect(() =>
      assessSolutionProposalV2({
        input,
        result,
        dependencies: { ...dependencies, validationRules: unavailable },
      }),
    ).toThrow(
      "The candidate design failed deterministic architecture validation.",
    );
  });
  it.each(["scope"] as const)(
    "keeps V2 %s authority checks before assessment",
    async () => {
      const input = plannerInput(
        planningRequest(),
        "invocation_assessment_bound",
      );
      const gateway = configuredFakeGateway();
      const result = await gateway.proposeOperations(
        input.modelRequest,
        input.gatewayContext,
      );
      const descriptor = structuredClone(result.descriptor);
      descriptor.scope.organizationId = "another_organization";
      expect(() =>
        assessSolutionProposalV2({
          input,
          result: { ...result, descriptor },
          dependencies,
        }),
      ).toThrow("The proposal does not match the exact request");
    },
  );
});

describe("ReviewOnlySolutionProposalPlannerV1", () => {
  it("returns a complete schema-constrained proposal without changing canonical design", async () => {
    const request = planningRequest();
    const original = structuredClone(request.architecture);
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response, current) =>
        withGraphCommand(response, current, {
          ...graphEnvelope(current, "command_replace_workload_contracts"),
          applicationContracts: current.architecture.applicationContracts,
          expectedApplicationContracts:
            current.architecture.applicationContracts,
          expectedWorkloadBehavior: current.architecture.workloadBehavior,
          kind: "replace-workload-and-application-contracts",
          workloadBehavior: current.architecture.workloadBehavior,
        }),
    );
    const { planner: service } = planner(gateway);
    const result = await service.propose(
      plannerInput(request, "invocation_solution_full"),
    );

    expect(result.disposition).toBe("ready-for-review");
    if (result.disposition === "rejected")
      throw new Error("Unexpected rejection.");
    expect(result.writeAuthority).toBe("none");
    expect(result.modelResult.response.solutionProposal).toMatchObject({
      generationCoverageSuggestions: [
        expect.objectContaining({ workloadId: "workload_worker" }),
      ],
      rejectedAlternatives: [],
      targetReadiness: { status: "ready", target: "terraform" },
      testScenarios: [],
    });
    expect(request.architecture).toEqual(original);
    expect(result.candidateArchitecture).toEqual(original);
    expect(typeof result.modelResult.response.solutionProposal?.rationale).toBe(
      "string",
    );
  });

  it("applies a strict granular Assistant operation without replacing the Workload or unrelated design", async () => {
    const request = planningRequest();
    const original = structuredClone(request.architecture);
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response, current) => ({
        ...response,
        batches: [
          ...response.batches,
          {
            batch: assistantOperationBatchV1Schema.parse({
              baseArchitectureDigest: getArchitectureDocumentCanonicalHash(
                current.architecture,
              ),
              contractVersion: 1,
              kind: "cloudmarkup.assistant-operation-batch" as const,
              operations: [
                {
                  expectedWorkloadContentHash: getWorkloadBehaviorContentHash(
                    current.architecture.workloadBehavior,
                  ),
                  kind: "edit-workload" as const,
                  operationId: "assistant_edit_timeout",
                  patch: {
                    executionAssumptions: {
                      retry: { kind: "bounded" as const, maximumAttempts: 4 },
                      timeout: {
                        kind: "duration" as const,
                        milliseconds: 45_000,
                      },
                    },
                  },
                  rationale: "Use the reviewed timeout and retry budget.",
                  workloadId: "workload_worker",
                },
              ],
            }),
            kind: "assistant" as const,
          },
        ],
      }),
    );
    const result = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_assistant_workload"),
    );

    expect(result.disposition).toBe("ready-for-review");
    if (result.disposition === "rejected")
      throw new Error("Unexpected Assistant operation rejection.");
    expect(result.assistantOperations).toHaveLength(2);
    expect(result.assistantOperations[1]?.operationId).not.toBe(
      "assistant_edit_timeout",
    );
    expect(result.assistantDiffs).toEqual([
      expect.objectContaining({ category: "architecture" }),
      expect.objectContaining({ category: "workload" }),
    ]);
    expect(
      result.candidateArchitecture.workloadBehavior.workloads[0]
        ?.executionAssumptions,
    ).toEqual({
      retry: { kind: "bounded", maximumAttempts: 4 },
      timeout: { kind: "duration", milliseconds: 45_000 },
    });
    expect(result.candidateArchitecture.nodes).toEqual(original.nodes);
    expect(result.candidateArchitecture.edges).toEqual(original.edges);
    expect(request.architecture).toEqual(original);
  });
  it("normalizes model-authored Assistant External Resource and nested identities reproducibly", async () => {
    const request = planningRequest();
    const resource = externalResource();
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response, current) => ({
        ...response,
        batches: [
          ...response.batches,
          {
            batch: assistantOperationBatchV1Schema.parse({
              baseArchitectureDigest: getArchitectureDocumentCanonicalHash(
                current.architecture,
              ),
              contractVersion: 1,
              kind: "cloudmarkup.assistant-operation-batch" as const,
              operations: [
                {
                  expectedExternalResourcesContentHash:
                    getExternalResourceReferenceContentHash(
                      current.architecture.externalResources,
                    ),
                  kind: "add-external-resource" as const,
                  operationId: "assistant_raw_external_operation",
                  rationale: "Reference the reviewed external API.",
                  resource,
                },
              ],
            }),
            kind: "assistant" as const,
          },
        ],
      }),
    );
    const service = planner(gateway).planner;
    const result = await service.propose(
      plannerInput(request, "invocation_solution_assistant_external"),
    );
    expect(result.disposition).toBe("ready-for-review");
    if (result.disposition === "rejected") {
      throw new Error("Unexpected External Resource rejection.");
    }
    const operation = result.assistantOperations.find(
      (operation) => operation.kind === "add-external-resource",
    );
    if (operation?.kind !== "add-external-resource") {
      throw new Error("Missing normalized External Resource operation.");
    }
    expect(operation.operationId).not.toBe("assistant_raw_external_operation");
    expect(operation.resource.id).not.toBe(resource.id);
    expect(operation.resource.addresses[0]?.addressId).not.toBe(
      resource.addresses[0]?.addressId,
    );
    expect(operation.resource.interfaces[0]?.interfaceId).not.toBe(
      resource.interfaces[0]?.interfaceId,
    );
    expect(result.candidateArchitecture.externalResources.resources).toEqual([
      operation.resource,
    ]);
    expect(request.architecture.externalResources.resources).toEqual([]);

    const replay = await service.propose(
      plannerInput(request, "invocation_solution_assistant_external_replay"),
    );
    if (replay.disposition === "rejected") {
      throw new Error("Unexpected deterministic replay rejection.");
    }
    expect(replay.assistantOperations).toEqual(result.assistantOperations);
    expect(replay.candidateArchitecture).toEqual(result.candidateArchitecture);
  });
  it("allows content-only Workload replacement while retaining exact canonical identities", async () => {
    const request = planningRequest();
    const workload = request.architecture.workloadBehavior.workloads[0];
    if (workload === undefined) throw new Error("Missing Workload fixture.");
    const changedWorkload = {
      ...workload,
      executionAssumptions: {
        ...workload.executionAssumptions,
        timeout: { kind: "duration" as const, milliseconds: 31_000 },
      },
    };
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response, current) =>
        withGraphCommand(response, current, {
          ...graphEnvelope(current, "command_replace_workload_content_only"),
          applicationContracts: current.architecture.applicationContracts,
          expectedApplicationContracts:
            current.architecture.applicationContracts,
          expectedWorkloadBehavior: current.architecture.workloadBehavior,
          kind: "replace-workload-and-application-contracts",
          workloadBehavior: {
            ...current.architecture.workloadBehavior,
            workloads: [changedWorkload],
          },
        }),
    );
    const result = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_replacement_content_only"),
    );
    expect(result.disposition).toBe("ready-for-review");
    if (result.disposition === "rejected")
      throw new Error("Unexpected rejection.");
    expect(
      result.candidateArchitecture.workloadBehavior.workloads.map(
        (candidate) => candidate.id,
      ),
    ).toEqual(
      request.architecture.workloadBehavior.workloads.map(
        (candidate) => candidate.id,
      ),
    );
    expect(
      result.candidateArchitecture.applicationContracts.contracts.map(
        (contract) => contract.contractId,
      ),
    ).toEqual(
      request.architecture.applicationContracts.contracts.map(
        (contract) => contract.contractId,
      ),
    );
    expect(
      result.candidateArchitecture.workloadBehavior.workloads[0]
        ?.executionAssumptions.timeout,
    ).toEqual({ kind: "duration", milliseconds: 31_000 });
  });

  it.each(["workload", "nested-operation", "contract"] as const)(
    "rejects a schema-valid noncanonical %s replacement identity",
    async (identityKind) => {
      const request = planningRequest();
      const workload = request.architecture.workloadBehavior.workloads[0];
      const operation = workload?.operations[0];
      if (workload === undefined || operation === undefined) {
        throw new Error("Missing Workload identity fixture.");
      }
      const workloadBehavior =
        identityKind === "workload"
          ? {
              ...request.architecture.workloadBehavior,
              workloads: [
                {
                  ...workload,
                  id: "workload_model_new_identity",
                },
              ],
            }
          : identityKind === "nested-operation"
            ? {
                ...request.architecture.workloadBehavior,
                workloads: [
                  {
                    ...workload,
                    operations: [
                      {
                        ...operation,
                        id: "operation_model_new_identity",
                      },
                    ],
                  },
                ],
              }
            : request.architecture.workloadBehavior;
      const applicationContracts =
        identityKind === "contract"
          ? {
              ...request.architecture.applicationContracts,
              contracts: [
                {
                  contractId: "example.contract.model-new",
                  contractKind: "data-entity" as const,
                  contractVersion: "1.0.0",
                  displayName: "Model-created contract identity",
                  fields: [
                    {
                      classification: "internal" as const,
                      fieldType: {
                        kind: "scalar" as const,
                        scalarType: "string" as const,
                      },
                      name: "id",
                      nullable: false,
                      required: true,
                    },
                  ],
                  indexes: [],
                  provenance: {
                    recordedAt: "2026-08-21T12:00:00.000Z",
                    source: "ai-accepted" as const,
                    sourceReferenceIds: [],
                  },
                  semanticName: "example.entity.model-new",
                  storageIntent: "persistent" as const,
                  supportedOperations: ["read" as const],
                },
              ],
            }
          : request.architecture.applicationContracts;
      const gateway = new TransformingPlanningGateway(
        configuredFakeGateway(),
        (response, current) =>
          withGraphCommand(response, current, {
            ...graphEnvelope(
              current,
              "command_noncanonical_replacement_" + identityKind,
            ),
            applicationContracts,
            expectedApplicationContracts:
              current.architecture.applicationContracts,
            expectedWorkloadBehavior: current.architecture.workloadBehavior,
            kind: "replace-workload-and-application-contracts",
            workloadBehavior,
          }),
      );
      const result = await planner(gateway).planner.propose(
        plannerInput(
          request,
          "invocation_solution_noncanonical_replacement_" + identityKind,
        ),
      );
      expect(result).toMatchObject({
        diagnostics: [
          expect.objectContaining({
            code: "cloudmarkup.solution-planner.noncanonical-replacement-identity",
          }),
        ],
        disposition: "rejected",
      });
    },
  );

  it("preserves structurally invalid planning output in the restricted store", async () => {
    const request = planningRequest();
    const store = new InMemoryRestrictedInvalidSolutionProposalStoreV1();
    const gateway = new ProviderNeutralModelGateway({
      adapters: [
        new ScriptedFakeModelAdapter([
          (invocation) => {
            const response = deterministicFakeResponseV1(invocation);
            if (
              response.operation !== "operations.propose" ||
              response.solutionProposal === undefined
            ) {
              throw new Error("Missing deterministic planning response.");
            }
            const invalid = {
              ...response,
              solutionProposal: {
                ...response.solutionProposal,
                unexpectedField: "must be rejected and retained securely",
              },
            };
            return {
              content: {
                input: invalid,
                kind: "tool-use",
                toolName: invocation.responseTool.toolName,
              },
              usage: {
                cacheReadUnits: "0",
                cacheWriteUnits: "0",
                inputUnits: "20",
                outputUnits: "10",
                providerRequestId: "provider_invalid_planning_output",
                thinkingUnits: "0",
              },
            };
          },
        ]),
      ],
      allowedApprovalPathIds: ["cloudmarkup.dependency-review.v1"],
      invalidProposalStore: store,
      invocationStore: new InMemoryModelInvocationStore(),
      logger: new CollectingSafeModelLogger(),
      routing: deterministicFakeRoutingV1,
      usageRecorder: new CollectingModelUsageRecorder(),
    });
    await expect(
      gateway.proposeOperations(
        request,
        modelTestContext("invocation_solution_invalid_structured_output"),
      ),
    ).rejects.toMatchObject({ code: "model-gateway.invalid-output" });
    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toMatchObject({
      classification: "restricted-model-proposal",
      diagnostics: [
        expect.objectContaining({ code: "model-gateway.invalid-output" }),
      ],
      organizationId: "organization_test",
      retentionPolicyId: "cloudmarkup.invalid-model-proposal.v1",
    });
    expect(store.records[0]?.proposalCanonicalJson).toContain(
      "unexpectedField",
    );
  });
  it("returns a typed external-resource reference for explicit review", async () => {
    const request = planningRequest({ withRepositoryEvidence: true });
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response) => ({
        ...response,
        solutionProposal: {
          ...solutionProposalFor(response),
          externalResources: [externalResource()],
        },
      }),
    );
    const result = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_external"),
    );
    expect(result.disposition).toBe("ready-for-review");
    if (result.disposition === "rejected")
      throw new Error("Unexpected rejection.");
    const resource =
      result.candidateArchitecture.externalResources.resources[0];
    expect(resource?.id).toBe(
      expectedPlanningStructuralId(request, "external-resource", "external:0"),
    );
    expect(resource?.lifecycle.ownershipState).toBe("third-party-service-api");
    const operation = result.assistantOperations.find(
      (operation) => operation.kind === "add-external-resource",
    );
    expect(operation).toMatchObject({ resource });
    expect(result.assistantDiffs).toContainEqual(
      expect.objectContaining({ operationIds: [operation?.operationId] }),
    );
    const replay = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_external_replay"),
    );
    if (replay.disposition === "rejected")
      throw new Error("Unexpected replay rejection.");
    expect(replay.assistantOperations).toEqual(result.assistantOperations);
    expect(replay.candidateArchitecture).toEqual(result.candidateArchitecture);
  });

  it.each([
    ["permission", "cloudmarkup.solution-planner.operation-not-allowed"],
    ["combined limit", "cloudmarkup.solution-planner.resource-limit-exceeded"],
  ] as const)(
    "rejects summary resources outside the exact %s",
    async (restriction, code) => {
      const base = planningRequest({ withRepositoryEvidence: true });
      const context = base.planningContext;
      if (!context?.assistantLimits)
        throw new Error("Missing planning authority.");
      const request = modelOperationProposalRequestV1Schema.parse({
        ...base,
        planningContext: {
          ...context,
          allowedAssistantOperationKinds:
            restriction === "permission"
              ? context.allowedAssistantOperationKinds?.filter(
                  (kind) => kind !== "add-external-resource",
                )
              : context.allowedAssistantOperationKinds,
          assistantLimits: {
            ...context.assistantLimits,
            maximumOperations: restriction === "combined limit" ? 1 : 64,
          },
        },
      });
      const original = structuredClone(request.architecture);
      const gateway = new TransformingPlanningGateway(
        configuredFakeGateway(),
        (response) => ({
          ...response,
          batches: response.batches.filter((batch) => batch.kind === "graph"),
          solutionProposal: {
            ...solutionProposalFor(response),
            externalResources: [externalResource()],
          },
        }),
      );
      const result = await planner(gateway).planner.propose(
        plannerInput(request, "invocation_summary_authority"),
      );
      expect(result).toMatchObject({
        disposition: "rejected",
        diagnostics: [expect.objectContaining({ code })],
      });
      expect(request.architecture).toEqual(original);
    },
  );

  it("preserves an External Resource secret reference grounded by canonical Workload authority", async () => {
    const request = planningRequest();
    const secretBinding = request.architecture.workloadBehavior.workloads
      .flatMap((workload) => workload.environment)
      .find((binding) => binding.value.kind === "secret-reference");
    const secretReference =
      secretBinding?.value.kind === "secret-reference"
        ? secretBinding.value.reference
        : undefined;
    if (secretReference === undefined) {
      throw new Error("Missing canonical Workload secret-reference fixture.");
    }
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response) => ({
        ...response,
        solutionProposal: {
          ...solutionProposalFor(response),
          externalResources: [
            externalResource({
              secretReferences: [secretReference],
            }),
          ],
        },
      }),
    );
    const result = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_external_secret_grounded"),
    );
    expect(result.disposition).toBe("ready-for-review");
    if (result.disposition === "rejected")
      throw new Error("Unexpected rejection.");
    expect(
      result.candidateArchitecture.externalResources.resources[0]?.interfaces[0]
        ?.authentication,
    ).toEqual({
      method: "api-key-reference",
      secretReferences: [secretReference],
    });
  });

  it("rejects an External Resource secret reference without canonical authority", async () => {
    const request = planningRequest();
    const original = structuredClone(request.architecture);
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response) => ({
        ...response,
        solutionProposal: {
          ...solutionProposalFor(response),
          externalResources: [
            externalResource({
              secretReferences: ["secretref_model_invented"],
            }),
          ],
        },
      }),
    );
    const result = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_external_secret_ungrounded"),
    );
    expect(result).toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: "cloudmarkup.solution-planner.ungrounded-external-secret-reference",
        }),
      ],
      disposition: "rejected",
    });
    expect(request.architecture).toEqual(original);
  });

  it("normalizes model-authored External Resource identities and new-node references reproducibly", async () => {
    const request = planningRequest();
    const original = structuredClone(request.architecture);
    const rawNodeId = "node_external_model_alias";
    const cases = [
      {
        displayName: '<script>alert("external")</script> ../../',
        prefix: "label_derived_external",
      },
      {
        displayName: "Completely different external label",
        prefix: "random_external_selection",
      },
    ] as const;
    const observedResourceIds: string[] = [];

    for (const [index, candidate] of cases.entries()) {
      const gateway = new TransformingPlanningGateway(
        configuredFakeGateway(),
        (response, current) => {
          const withNode = addNodeResponse(response, current, { rawNodeId });
          return {
            ...withNode,
            solutionProposal: {
              ...solutionProposalFor(withNode),
              externalResources: [
                modelAuthoredExternalResource({
                  architectureNodeIds: [rawNodeId],
                  displayName: candidate.displayName,
                  prefix: candidate.prefix,
                }),
              ],
            },
          };
        },
      );
      const result = await planner(gateway).planner.propose(
        plannerInput(
          request,
          "invocation_solution_external_stable_" + String(index),
        ),
      );
      expect(result.disposition).toBe("ready-for-review");
      if (result.disposition === "rejected")
        throw new Error("Unexpected rejection.");
      const expectedNodeId = expectedPlanningGraphId(
        request,
        "architecture-node",
        1,
      );
      const expectedResourceId = expectedPlanningStructuralId(
        request,
        "external-resource",
        "external:0",
      );
      const resource =
        result.candidateArchitecture.externalResources.resources[0];
      expect(resource).toMatchObject({
        addresses: [
          {
            addressId: expectedPlanningStructuralId(
              request,
              "external-resource-address",
              "external:0:address:0",
            ),
          },
        ],
        architectureNodeIds: [expectedNodeId],
        displayName: candidate.displayName,
        id: expectedResourceId,
        interfaces: [
          {
            interfaceId: expectedPlanningStructuralId(
              request,
              "external-resource-interface",
              "external:0:interface:0",
            ),
          },
        ],
        unresolvedInformation: [
          {
            unresolvedInformationId: expectedPlanningStructuralId(
              request,
              "external-resource-unresolved-information",
              "external:0:unresolved:0",
            ),
          },
        ],
      });
      expect(
        resource?.lifecycle.ownershipState === "imported-current-iac-lifecycle"
          ? resource.lifecycle.behavior.importAddressId
          : undefined,
      ).toBe(resource?.addresses[0]?.addressId);
      const extractedCandidate = resource?.extractedCandidates[0];
      expect(extractedCandidate?.candidateId).toBe(
        expectedPlanningStructuralId(
          request,
          "external-resource-candidate",
          "external:0:candidate:0",
        ),
      );
      expect(
        extractedCandidate?.candidateValue.kind === "resource-address"
          ? extractedCandidate.candidateValue.value.addressId
          : undefined,
      ).toBe(
        expectedPlanningStructuralId(
          request,
          "external-resource-candidate-address",
          "external:0:candidate:0:address",
        ),
      );
      expect(
        result.modelResult.response.solutionProposal?.externalResources[0]?.id,
      ).toBe(candidate.prefix + "_resource");
      expect(request.architecture).toEqual(original);
      observedResourceIds.push(resource?.id ?? "");
    }
    expect(new Set(observedResourceIds)).toEqual(
      new Set([
        expectedPlanningStructuralId(
          request,
          "external-resource",
          "external:0",
        ),
      ]),
    );
  });

  it("rejects duplicate External Resource aliases and unknown Architecture references before candidate apply", async () => {
    const request = planningRequest();
    const duplicateGateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response) => {
        const first = modelAuthoredExternalResource({
          displayName: "First external",
          prefix: "duplicate_first",
        });
        const second = modelAuthoredExternalResource({
          displayName: "Second external",
          prefix: "duplicate_second",
        });
        return {
          ...response,
          solutionProposal: {
            ...solutionProposalFor(response),
            externalResources: [
              first,
              externalResourceV1Schema.parse({ ...second, id: first.id }),
            ],
          },
        };
      },
    );
    const duplicate = await planner(duplicateGateway).planner.propose(
      plannerInput(request, "invocation_solution_external_duplicate"),
    );
    expect(duplicate).toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: "cloudmarkup.solution-planner.ambiguous-model-identity",
        }),
      ],
      disposition: "rejected",
    });

    const unknownGateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response) => ({
        ...response,
        solutionProposal: {
          ...solutionProposalFor(response),
          externalResources: [
            modelAuthoredExternalResource({
              architectureNodeIds: ["node_unknown_external_reference"],
              displayName: "Unknown node external",
              prefix: "unknown_reference",
            }),
          ],
        },
      }),
    );
    const unknown = await planner(unknownGateway).planner.propose(
      plannerInput(request, "invocation_solution_external_unknown_reference"),
    );
    expect(unknown).toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: "cloudmarkup.solution-planner.unresolved-model-reference",
        }),
      ],
      disposition: "rejected",
    });
  });

  it.each(["evidence", "contract"] as const)(
    "rejects ungrounded External Resource %s authority",
    async (authorityKind) => {
      const request = planningRequest();
      const gateway = new TransformingPlanningGateway(
        configuredFakeGateway(),
        (response) => {
          const resource = modelAuthoredExternalResource({
            displayName: "Ungrounded authority",
            prefix: "ungrounded_" + authorityKind,
          });
          const externalInterface = resource.interfaces[0];
          if (externalInterface === undefined)
            throw new Error("Missing External Resource interface fixture.");
          const withAuthority =
            authorityKind === "evidence"
              ? externalResourceV1Schema.parse({
                  ...resource,
                  evidence: [
                    {
                      digest: TEST_DIGEST,
                      evidenceId: "external_evidence_not_canonical",
                      observedAt: "2026-08-21T12:00:00.000Z",
                      source: "user-attestation",
                    },
                  ],
                })
              : externalResourceV1Schema.parse({
                  ...resource,
                  interfaces: [
                    {
                      ...externalInterface,
                      contracts: [
                        {
                          contractId: "example.contract.event",
                          contractKind: "event-message",
                          contractVersion: "1.0.0",
                          digest: TEST_DIGEST,
                        },
                      ],
                    },
                  ],
                });
          return {
            ...response,
            solutionProposal: {
              ...solutionProposalFor(response),
              externalResources: [withAuthority],
            },
          };
        },
      );
      const result = await planner(gateway).planner.propose(
        plannerInput(
          request,
          "invocation_solution_external_ungrounded_" + authorityKind,
        ),
      );
      expect(result).toMatchObject({
        diagnostics: [
          expect.objectContaining({
            code:
              authorityKind === "evidence"
                ? "cloudmarkup.solution-planner.ungrounded-external-evidence"
                : "cloudmarkup.solution-planner.ungrounded-external-contract-reference",
          }),
        ],
        disposition: "rejected",
      });
    },
  );

  it("rejects missing or mismatched approved repository snapshot lineage", () => {
    const request = planningRequest({
      withReconciliation: true,
      withRepositoryEvidence: true,
    });
    const context = request.planningContext;
    const approved = context?.approvedRepositoryEvidence;
    if (context === undefined || approved === undefined) {
      throw new Error("Repository planning authority fixture is incomplete.");
    }
    expectRequestAuthorityCode(
      modelOperationProposalRequestV1Schema.parse({
        ...request,
        planningContext: undefined,
      }),
      "model-gateway.reconciliation-evidence-lineage-mismatch",
    );
    const variants = [
      {
        ...context,
        approvedRepositoryEvidence: undefined,
      },
      {
        ...context,
        approvedRepositoryEvidence: {
          ...approved,
          repositorySnapshotId: "repository_snapshot_lineage_mismatch",
        },
      },
      {
        ...context,
        approvedRepositoryEvidence: {
          ...approved,
          repositorySnapshotDigest: sha256Text(
            "repository snapshot lineage mismatch",
          ),
        },
      },
    ];
    for (const planningContext of variants) {
      expectRequestAuthorityCode(
        modelOperationProposalRequestV1Schema.parse({
          ...request,
          planningContext,
        }),
        "model-gateway.reconciliation-evidence-lineage-mismatch",
      );
    }
  });

  it("binds repository reconciliation explanations to deterministic import evidence", async () => {
    const request = planningRequest({
      withReconciliation: true,
      withRepositoryEvidence: true,
    });
    const evidence =
      request.planningContext?.approvedRepositoryEvidence?.evidence[0];
    const operation = request.reconciliation?.operations[0];
    if (evidence === undefined || operation === undefined)
      throw new Error("Repository planning fixture is incomplete.");
    const reference = {
      digest: evidence.fileChecksum,
      kind: "repository-evidence" as const,
      location: evidence.location,
      path: evidence.path,
      referenceId: evidence.evidenceId,
    };
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response) => ({
        ...response,
        solutionProposal: {
          ...solutionProposalFor(response),
          reconciliationSuggestions: [
            {
              confidence: {
                basisPoints: 9_000,
                evidenceReferences: [reference],
                rationale:
                  "The exact deterministic import evidence supports this suggestion.",
              },
              evidenceReferences: [reference],
              explanation: "Keep the imported observation separate for review.",
              operationId: operation.operationId,
            },
          ],
        },
      }),
    );
    const result = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_reconciliation"),
    );
    expect(result.disposition).toBe("ready-for-review");
  });

  it.each([
    {
      caseId: "empty",
      confidenceReferences: "empty",
      directReferences: "empty",
    },
    {
      caseId: "missing-confidence",
      confidenceReferences: "empty",
      directReferences: "exact",
    },
    {
      caseId: "mismatched-confidence",
      confidenceReferences: "wrong-checksum",
      directReferences: "exact",
    },
    {
      caseId: "wrong-excerpt-checksum",
      confidenceReferences: "wrong-checksum",
      directReferences: "wrong-checksum",
    },
  ] as const)(
    "rejects reconciliation evidence authority case $caseId before review",
    async ({ caseId, confidenceReferences, directReferences }) => {
      const request = planningRequest({
        withReconciliation: true,
        withRepositoryEvidence: true,
      });
      const evidence =
        request.planningContext?.approvedRepositoryEvidence?.evidence[0];
      const operation = request.reconciliation?.operations[0];
      if (evidence === undefined || operation === undefined) {
        throw new Error("Repository planning fixture is incomplete.");
      }
      const exactReference = {
        digest: evidence.fileChecksum,
        kind: "repository-evidence" as const,
        location: evidence.location,
        path: evidence.path,
        referenceId: evidence.evidenceId,
      };
      const wrongChecksumReference = {
        ...exactReference,
        digest: sha256Text("wrong approved excerpt file checksum"),
      };
      const referencesFor = (state: "empty" | "exact" | "wrong-checksum") =>
        state === "empty"
          ? []
          : [state === "exact" ? exactReference : wrongChecksumReference];
      const gateway = new TransformingPlanningGateway(
        configuredFakeGateway(),
        (response) => ({
          ...response,
          solutionProposal: {
            ...solutionProposalFor(response),
            reconciliationSuggestions: [
              {
                confidence: {
                  basisPoints: 9_000,
                  evidenceReferences: referencesFor(confidenceReferences),
                  rationale:
                    "This confidence must bind exact approved import evidence.",
                },
                evidenceReferences: referencesFor(directReferences),
                explanation:
                  "This reconciliation suggestion must remain evidence-bound.",
                operationId: operation.operationId,
              },
            ],
          },
        }),
      );
      const result = await planner(gateway).planner.propose(
        plannerInput(
          request,
          `invocation_solution_reconciliation_${caseId.replaceAll("-", "_")}`,
        ),
      );
      expect(result).toMatchObject({
        diagnostics: [
          expect.objectContaining({
            code: "model-gateway.ungrounded-reconciliation-evidence",
          }),
        ],
        disposition: "rejected",
      });
    },
  );

  it("rejects an unknown catalog service and preserves restricted diagnostics", async () => {
    const request = planningRequest();
    const baseline = structuredClone(request.architecture);
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response, current) =>
        addNodeResponse(response, current, { unknownService: true }),
    );
    const { planner: service, store } = planner(gateway);
    const result = await service.propose(
      plannerInput(request, "invocation_solution_unknown_service"),
    );
    expect(result).toMatchObject({
      disposition: "rejected",
      diagnostics: [
        expect.objectContaining({
          code: "model-gateway.ungrounded-graph-command",
        }),
      ],
    });
    expect(request.architecture).toEqual(baseline);
    expect(gateway.calls).toBe(1);
    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toMatchObject({
      classification: "restricted-model-proposal",
      retentionPolicyId: "cloudmarkup.invalid-model-proposal.v1",
    });
  });

  it("rejects an invalid edge port", async () => {
    const request = planningRequest();
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response, current) => {
        const edge = current.architecture.edges[0];
        if (edge === undefined) throw new Error("Missing edge fixture.");
        return withGraphCommand(response, current, {
          ...graphEnvelope(current, "command_invalid_edge"),
          edge: {
            ...edge,
            id: "edge_invalid_port",
            semantic: {
              ...edge.semantic,
              lifecycle: { origin: "ai-accepted", ownership: "user" },
              source: { ...edge.semantic.source, port: "example.port.unknown" },
            },
          },
          kind: "add-edge",
        });
      },
    );
    const result = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_invalid_edge"),
    );
    expect(result).toMatchObject({
      disposition: "rejected",
      diagnostics: [
        expect.objectContaining({
          code: "model-gateway.ungrounded-graph-command",
          message:
            "A proposed add-edge relationship/schema is outside the exact ordered catalog allowlist.",
        }),
      ],
    });
  });

  it("rejects a known Graph Command kind outside the exact request allowlist", async () => {
    const request = planningRequest();
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response, current) => {
        const source = current.architecture.nodes.find(
          (node) => node.id === "node_source",
        );
        const worker = current.architecture.nodes.find(
          (node) => node.id === "node_worker",
        );
        if (source === undefined || worker === undefined)
          throw new Error("Missing reparent fixtures.");
        return withGraphCommand(response, current, {
          ...graphEnvelope(current, "command_disallowed_reparent"),
          expectedParent: source.semantic.parent ?? null,
          kind: "reparent-node",
          nodeId: source.id,
          parent: {
            nodeId: worker.id,
            relationshipType: "example.relationship.contains",
          },
        });
      },
    );
    const result = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_disallowed_operation"),
    );
    expect(result).toMatchObject({
      disposition: "rejected",
      diagnostics: [
        expect.objectContaining({
          code: "cloudmarkup.solution-planner.operation-not-allowed",
        }),
      ],
    });
  });
  it("rejects a policy kind outside the exact allowlist", async () => {
    const request = planningRequest();
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response) => ({
        ...response,
        solutionProposal: {
          ...solutionProposalFor(response),
          policyKindsUsed: [
            namespacedIdentifierSchema.parse("aws.iam.policy.unknown"),
          ],
        },
      }),
    );
    const result = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_unknown_policy"),
    );
    expect(result).toMatchObject({
      disposition: "rejected",
      diagnostics: [
        expect.objectContaining({
          code: "cloudmarkup.solution-planner.unknown-policy-kind",
        }),
      ],
    });
  });

  it("rejects an unsupported target", async () => {
    const request = planningRequest({
      target: "cloudformation",
      targetStatus: "unsupported",
    });
    const result = await planner(configuredFakeGateway()).planner.propose(
      plannerInput(request, "invocation_solution_unsupported_target"),
    );
    expect(result).toMatchObject({
      disposition: "rejected",
      diagnostics: [
        expect.objectContaining({
          code: "cloudmarkup.solution-planner.unsupported-target",
        }),
      ],
    });
  });

  it("normalizes arbitrary model node IDs independently of labels and preserves raw provenance", async () => {
    const request = planningRequest();
    const original = structuredClone(request.architecture);
    const expectedId = expectedPlanningGraphId(request, "architecture-node", 1);
    const cases = [
      {
        label: '<script>alert("credentials")</script> ../../',
        rawNodeId: "node_label_derived_candidate",
      },
      {
        label: "Completely different display label",
        rawNodeId: "node_random_model_selection",
      },
    ] as const;
    const observedIds: string[] = [];

    for (const [index, candidate] of cases.entries()) {
      const gateway = new TransformingPlanningGateway(
        configuredFakeGateway(),
        (response, current) =>
          addNodeResponse(response, current, {
            maliciousLabel: candidate.label,
            rawNodeId: candidate.rawNodeId,
          }),
      );
      const result = await planner(gateway).planner.propose(
        plannerInput(
          request,
          "invocation_solution_stable_node_" + String(index),
        ),
      );
      expect(result.disposition).toBe("ready-for-review");
      if (result.disposition === "rejected")
        throw new Error("Unexpected rejection.");
      expect(request.architecture).toEqual(original);
      expect(expectedId).toMatch(/^[a-z0-9][a-z0-9._:-]{0,127}$/u);
      const proposedNode = result.candidateArchitecture.nodes.find(
        (node) => node.id === expectedId,
      );
      expect(proposedNode?.id).toBe(expectedId);
      expect(proposedNode?.id).not.toBe(candidate.rawNodeId);
      expect(proposedNode?.presentation.label).toBe(candidate.label);
      observedIds.push(proposedNode?.id ?? "");

      const rawAddedNode = result.modelResult.response.batches
        .flatMap((batch) =>
          batch.kind === "graph" ? batch.batch.commands : [],
        )
        .find((command) => command.kind === "add-node");
      expect(rawAddedNode?.node.id).toBe(candidate.rawNodeId);
    }

    expect(new Set(observedIds)).toEqual(new Set([expectedId]));
  });

  it("rewrites dependent edge references to normalized proposal node IDs", async () => {
    const request = planningRequest();
    const rawNodeId = "node_model_edge_source";
    const rawEdgeId = "edge_model_authored_candidate";
    const expectedNodeId = expectedPlanningGraphId(
      request,
      "architecture-node",
      1,
    );
    const expectedEdgeId = expectedPlanningGraphId(
      request,
      "architecture-edge",
      1,
      1,
    );
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response, current) => {
        const edge = current.architecture.edges[0];
        const templateNode = current.architecture.nodes[0];
        if (edge === undefined || templateNode === undefined) {
          throw new Error("Missing graph fixture.");
        }
        if (edge.semantic.source.nodeId !== templateNode.id) {
          throw new Error("Unexpected source-node fixture.");
        }
        return {
          ...response,
          batches: [
            ...response.batches,
            {
              batch: {
                ...graphEnvelope(current, "batch_model_dependent_graph"),
                commands: [
                  {
                    ...graphEnvelope(current, "command_add_model_node"),
                    kind: "add-node",
                    node: {
                      ...templateNode,
                      id: rawNodeId,
                      presentation: {
                        ...templateNode.presentation,
                        label: "Model-authored edge source",
                      },
                      semantic: {
                        ...templateNode.semantic,
                        deploymentKey: "additional_edge_source",
                        lifecycle: {
                          origin: "ai-accepted",
                          ownership: "user",
                        },
                      },
                    },
                  },
                  {
                    ...graphEnvelope(current, "command_add_model_edge"),
                    edge: {
                      ...edge,
                      id: rawEdgeId,
                      semantic: {
                        ...edge.semantic,
                        lifecycle: {
                          origin: "ai-accepted",
                          ownership: "user",
                        },
                        source: {
                          ...edge.semantic.source,
                          nodeId: rawNodeId,
                        },
                      },
                    },
                    kind: "add-edge",
                  },
                ],
                kind: "batch",
              },
              kind: "graph",
            },
          ],
        } as OperationResponse;
      },
    );
    const result = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_stable_edge_reference"),
    );
    expect(result.disposition).toBe("ready-for-review");
    if (result.disposition === "rejected")
      throw new Error("Unexpected rejection.");
    expect(
      result.candidateArchitecture.nodes.some(
        (node) => node.id === expectedNodeId,
      ),
    ).toBe(true);
    const proposedEdge = result.candidateArchitecture.edges.find(
      (edge) => edge.id === expectedEdgeId,
    );
    expect(proposedEdge?.id).toBe(expectedEdgeId);
    expect(proposedEdge?.semantic.source.nodeId).toBe(expectedNodeId);
  });

  it("rejects raw model IDs that collide with derived proposal authority", async () => {
    const request = planningRequest();
    const templateNode = request.architecture.nodes[0];
    if (templateNode === undefined) throw new Error("Missing node fixture.");
    const original = structuredClone(request.architecture);
    const rawFirstId = "node_model_first_alias";
    const derivedFirstId = expectedPlanningGraphId(
      request,
      "architecture-node",
      1,
    );
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response, current) =>
        ({
          ...response,
          batches: [
            ...response.batches,
            {
              batch: {
                ...graphEnvelope(current, "batch_model_identity_collision"),
                commands: [
                  {
                    ...graphEnvelope(current, "command_model_first_node"),
                    kind: "add-node",
                    node: {
                      ...templateNode,
                      id: rawFirstId,
                      presentation: {
                        ...templateNode.presentation,
                        label: "First model node",
                      },
                      semantic: {
                        ...templateNode.semantic,
                        deploymentKey: "additional_identity_first",
                        lifecycle: {
                          origin: "ai-accepted",
                          ownership: "user",
                        },
                      },
                    },
                  },
                  {
                    ...graphEnvelope(current, "command_model_second_node"),
                    kind: "add-node",
                    node: {
                      ...templateNode,
                      id: derivedFirstId,
                      presentation: {
                        ...templateNode.presentation,
                        label: "Second model node",
                      },
                      semantic: {
                        ...templateNode.semantic,
                        deploymentKey: "additional_identity_second",
                        lifecycle: {
                          origin: "ai-accepted",
                          ownership: "user",
                        },
                      },
                    },
                  },
                ],
                kind: "batch",
              },
              kind: "graph",
            },
          ],
        }) as OperationResponse,
    );
    const result = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_identity_collision"),
    );
    expect(result).toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: "cloudmarkup.solution-planner.ambiguous-model-identity",
        }),
      ],
      disposition: "rejected",
    });
    expect(request.architecture).toEqual(original);
  });

  it("rejects unknown graph references before applying a model batch", async () => {
    const request = planningRequest();
    const original = structuredClone(request.architecture);
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response, current) => {
        const edge = current.architecture.edges[0];
        if (edge === undefined) throw new Error("Missing edge fixture.");
        return withGraphCommand(response, current, {
          ...graphEnvelope(current, "command_unknown_node_reference"),
          edge: {
            ...edge,
            id: "edge_model_unknown_reference",
            semantic: {
              ...edge.semantic,
              lifecycle: { origin: "ai-accepted", ownership: "user" },
              target: {
                ...edge.semantic.target,
                nodeId: "node_missing_model_alias",
              },
            },
          },
          kind: "add-edge",
        });
      },
    );
    const result = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_unknown_graph_reference"),
    );
    expect(result).toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: "model-gateway.ungrounded-graph-command",
        }),
      ],
      disposition: "rejected",
    });
    expect(request.architecture).toEqual(original);
  });

  it("rejects excessive resource counts", async () => {
    const request = planningRequest({ maximumAddedNodes: 0 });
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response, current) => addNodeResponse(response, current),
    );
    const result = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_resource_limit"),
    );
    expect(result).toMatchObject({
      disposition: "rejected",
      diagnostics: [
        expect.objectContaining({
          code: "cloudmarkup.solution-planner.resource-limit-exceeded",
        }),
      ],
    });
  });

  it("asks for blocking ownership and import decisions without guessing", async () => {
    const request = planningRequest({ withRepositoryEvidence: true });
    const unresolvedResource = externalResource({ ambiguousOwnership: true });
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response) => ({
        ...response,
        solutionProposal: {
          ...solutionProposalFor(response),
          externalResources: [unresolvedResource],
        },
      }),
    );
    const result = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_ambiguous_ownership"),
    );
    expect(result.disposition).toBe("needs-user-input");
    if (result.disposition === "rejected")
      throw new Error("Unexpected unresolved ownership rejection.");
    const resource =
      result.candidateArchitecture.externalResources.resources[0];
    if (resource === undefined)
      throw new Error("Missing unresolved External Resource.");
    expect(resource.lifecycle).toEqual(unresolvedResource.lifecycle);
    expect(
      result.activeIssues.filter(
        (issue) =>
          issue.category === "configuration" &&
          issue.technicalDetail ===
            "Blocking external-resource field $.lifecycle.ownershipState requires explicit user input." &&
          issue.affected.some(
            (location) =>
              location.kind === "external-resource" &&
              location.externalResourceId === resource.id,
          ),
      ),
    ).not.toHaveLength(0);
  });

  it("requests a secret reference, never a secret value", async () => {
    const request = planningRequest({ withRepositoryEvidence: true });
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response) => ({
        ...response,
        solutionProposal: {
          ...solutionProposalFor(response),
          externalResources: [
            externalResource({ missingSecretReference: true }),
          ],
        },
      }),
    );
    const result = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_missing_secret_reference"),
    );
    expect(result.disposition).toBe("needs-user-input");
    if (result.disposition !== "rejected")
      expect(result.activeIssues).not.toHaveLength(0);
    if (result.disposition === "rejected")
      throw new Error("Unexpected rejection.");
    const summary =
      result.candidateArchitecture.externalResources.resources[0]
        ?.unresolvedInformation[0]?.summary ?? "";
    expect(summary).toContain("secret reference");
    expect(summary).toContain("do not provide a secret value");
  });

  it("rejects an ungrounded repository claim", async () => {
    const request = planningRequest({ withRepositoryEvidence: true });
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response) => ({
        ...response,
        solutionProposal: {
          ...solutionProposalFor(response),
          rejectedAlternatives: [
            {
              alternativeId: proposalItemIdSchema.parse(
                "alternative_ungrounded_repository",
              ),
              evidenceReferences: [
                {
                  digest: TEST_DIGEST,
                  kind: "repository-evidence",
                  path: "infrastructure/invented.tf",
                  referenceId: "repository_evidence_invented",
                },
              ],
              rationale: "This assertion has no supplied import evidence.",
              summary: "Invented repository claim",
            },
          ],
        },
      }),
    );
    const result = await planner(gateway).planner.propose(
      plannerInput(request, "invocation_solution_ungrounded_repository"),
    );
    expect(result).toMatchObject({
      disposition: "rejected",
      diagnostics: [
        expect.objectContaining({
          code: "model-gateway.ungrounded-evidence-reference",
        }),
      ],
    });
  });

  it("stops after the bounded repair loop is exhausted", async () => {
    const request = planningRequest();
    const gateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response, current) =>
        addNodeResponse(response, current, { unknownService: true }),
    );
    const { planner: service, store } = planner(gateway);
    const result = await service.propose(
      plannerInput(request, "invocation_solution_repair_exhaustion", 2),
    );
    expect(result).toMatchObject({ attempts: 3, disposition: "rejected" });
    expect(gateway.calls).toBe(3);
    expect(store.records).toHaveLength(3);
  });

  it("is reproducible for exact replay and rejects provenance tampering", async () => {
    const request = planningRequest();
    const context = plannerInput(request, "invocation_solution_replay");
    const { planner: service } = planner(configuredFakeGateway());
    const first = await service.propose(context);
    const replay = await service.propose(context);
    expect(first.disposition).toBe("ready-for-review");
    expect(replay.disposition).toBe("ready-for-review");
    if (first.disposition === "rejected" || replay.disposition === "rejected")
      throw new Error("Unexpected rejection.");
    expect(replay.proposalDigest).toBe(first.proposalDigest);
    expect(replay.modelResult.descriptor).toEqual(first.modelResult.descriptor);

    const tamperedGateway = new TransformingPlanningGateway(
      configuredFakeGateway(),
      (response) => ({
        ...response,
        provenance: {
          ...response.provenance,
          providerId: providerIdSchema.parse("cloudmarkup.tampered-provider"),
        },
      }),
    );
    const tampered = await planner(tamperedGateway).planner.propose(
      plannerInput(request, "invocation_solution_tampered_provenance"),
    );
    expect(tampered).toMatchObject({
      disposition: "rejected",
      diagnostics: [
        expect.objectContaining({ code: "model-gateway.provenance-mismatch" }),
      ],
    });
  });
});
