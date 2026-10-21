import {
  getArchitectureDocumentCanonicalHash,
  getWorkloadBehaviorContentHash,
} from "@cloudmarkup/domain";
import {
  modelCapabilityRegistryV1Schema,
  modelGatewayOperationV1Schema,
  modelGatewayResponseV1Schema,
  modelRouteRegistryV1Schema,
  modelRoutingRequestV1Schema,
  normalizeWorkloadBehaviorV2,
  sha256DigestSchema,
  type ModelCapabilityRegistryV1,
  type ModelGatewayOperationV1,
  type ModelGatewayRequestV1,
  type ModelGatewayResponseV1,
  type ModelRoutingDecisionV1,
  type ModelRoutingRequestV1,
  type NormalizedModelUsageV1,
} from "@cloudmarkup/schemas";

import {
  bedrockModelCapabilityRegistryV1,
  bedrockModelRouteRegistryV1,
  selectModelRoutingDecisionV1,
} from "./bedrock-routing.js";
import {
  ModelProviderInvocationError,
  type ModelGatewayResultV1,
  type ModelInvocationClaimResultV1,
  type ModelInvocationClaimV1,
  type ModelInvocationStore,
  type ModelProviderAdapter,
  type ModelProviderCapabilityProfileV1,
  type ModelProviderInvocationV1,
  type ModelProviderResultV1,
  type ModelUsageRecorder,
  type SafeModelLogEventV1,
  type SafeModelLogger,
} from "./ports.js";
import {
  modelRoutingConfigurationV1Schema,
  type ModelRoutingConfigurationV1,
} from "./routing.js";
import { digestStructuredValue, sha256Text } from "./security.js";

const fixedDigest = sha256DigestSchema.parse(`sha256:${"a".repeat(64)}`);
const fixedInstant = "2026-01-01T00:00:00.000Z";

function provenance(invocation: ModelProviderInvocationV1) {
  return {
    contractVersion: 1 as const,
    gatewayId: "cloudmarkup.model-gateway",
    ...(invocation.descriptor.inferenceProfileId === undefined
      ? {}
      : { inferenceProfileId: invocation.descriptor.inferenceProfileId }),
    inputDigest: invocation.descriptor.inputDigest,
    invocationId: invocation.descriptor.invocationId,
    modelId: invocation.descriptor.modelId,
    modelVersion: invocation.descriptor.modelVersion,
    ownership: "untrusted-proposal" as const,
    promptDigest: invocation.prompt.digest,
    promptTemplateId: invocation.prompt.templateId,
    promptVersion: invocation.prompt.version,
    providerId: invocation.descriptor.providerId,
  };
}

function evidenceReference(
  referenceId = "source_fake",
): ModelGatewayResponseV1["proposalContext"]["confidence"]["evidenceReferences"][number] {
  return {
    kind: "requirements-source",
    referenceId,
  };
}

function proposalContext() {
  return {
    assumptions: [],
    confidence: {
      basisPoints: 8_000,
      evidenceReferences: [],
      rationale: "Deterministic fake response for local development and CI.",
    },
    unknowns: [],
  };
}

function fakeIntentDocument(invocation: ModelProviderInvocationV1) {
  const request = invocation.request as Extract<
    ModelGatewayRequestV1,
    { operation: "intent.extract" }
  >;
  const unknown = (questionId: string, details: string) => ({
    details,
    questionId,
    state: "unknown" as const,
  });
  const unresolvedQuestions = [
    [
      "question_capabilities",
      "requirements.capabilities",
      "Which workload capabilities are required?",
    ],
    [
      "question_authentication",
      "requirements.identity.authentication",
      "What authentication is required?",
    ],
    [
      "question_authorization",
      "requirements.identity.authorization",
      "What authorization is required?",
    ],
    [
      "question_availability",
      "requirements.quality.availability",
      "What availability is required?",
    ],
    [
      "question_durability",
      "requirements.quality.durability",
      "What durability is required?",
    ],
    [
      "question_latency",
      "requirements.quality.latency",
      "What latency is required?",
    ],
    [
      "question_recovery",
      "requirements.quality.recovery",
      "What recovery objective is required?",
    ],
    ["question_scale", "requirements.quality.scale", "What scale is required?"],
    [
      "question_environment",
      "requirements.environment",
      "Which environment is required?",
    ],
    [
      "question_cost",
      "requirements.preferences.cost",
      "What cost preference applies?",
    ],
    [
      "question_operations",
      "requirements.preferences.operations",
      "What operational preference applies?",
    ],
  ].map(([id, subject, question]) => ({
    classification: "blocking" as const,
    id: id ?? "question_unknown",
    question: question ?? "Which requirement is unresolved?",
    rationale: "The unknown value requires an explicit answer.",
    subject: subject ?? "requirements.unknown",
  }));
  return {
    kind: "cloudmarkup.intent-document" as const,
    schemaVersion: 1 as const,
    documentId: `intent_document_${invocation.descriptor.invocationId}`,
    intentId: `intent_${invocation.descriptor.invocationId}`,
    revision: {
      createdAt: fixedInstant,
      createdBy: "actor_model_gateway_fake",
      revisionId: `intent_revision_${invocation.descriptor.invocationId}`,
      revisionNumber: 1,
    },
    application: {
      capabilities: unknown(
        "question_capabilities",
        "Capabilities are unresolved.",
      ),
      summary: request.source.content.slice(0, 8_000),
    },
    connectivity: {
      egress: {
        rationale: "No egress requirement was established.",
        state: "none" as const,
      },
      ingress: {
        rationale: "No ingress requirement was established.",
        state: "none" as const,
      },
    },
    identity: {
      authentication: unknown(
        "question_authentication",
        "Authentication is unresolved.",
      ),
      authorization: unknown(
        "question_authorization",
        "Authorization is unresolved.",
      ),
    },
    data: {
      rationale: "No data category was established.",
      state: "none" as const,
    },
    workflows: {
      rationale: "No workflow was established.",
      state: "none" as const,
    },
    quality: {
      availability: unknown(
        "question_availability",
        "Availability is unresolved.",
      ),
      durability: unknown("question_durability", "Durability is unresolved."),
      latency: unknown("question_latency", "Latency is unresolved."),
      recovery: unknown("question_recovery", "Recovery is unresolved."),
      scale: unknown("question_scale", "Scale is unresolved."),
    },
    environment: unknown("question_environment", "Environment is unresolved."),
    preferences: {
      cost: unknown("question_cost", "Cost preference is unresolved."),
      operationalOverhead: unknown(
        "question_operations",
        "Operational preference is unresolved.",
      ),
    },
    compliance: {
      rationale: "No compliance requirement was established.",
      state: "none" as const,
    },
    assumptions: [],
    unresolvedQuestions,
    decisions: [],
    alternatives: [],
    metadata: {
      provenance: {
        prompt: {
          capturedAt: fixedInstant,
          inputDigest: invocation.descriptor.inputDigest,
          interactionId: invocation.descriptor.invocationId,
          kind: "prompt-reference" as const,
          templateId: invocation.prompt.templateId,
          templateVersion: invocation.prompt.version,
        },
        schema: {
          contractId: "cloudmarkup.intent-document" as const,
          schemaVersion: 1 as const,
        },
      },
      serialization: {
        canonicalization: "cloudmarkup.intent-normalized-json.v1" as const,
        encoding: "utf-8" as const,
        mediaType: "application/json" as const,
      },
      source: "prompt-assisted" as const,
    },
  };
}

function candidateSourceReference(request: ModelGatewayRequestV1) {
  if (
    request.operation === "application-source.generate" ||
    request.operation === "iac-extension.generate"
  ) {
    return request.sourceReferences[0] ?? evidenceReference();
  }
  if (request.operation === "fix.propose") {
    return {
      kind: "active-issue" as const,
      referenceId: request.issue.id,
      digest: request.issue.currentRecordDigest,
    };
  }
  if (request.operation === "candidate.repair") {
    return {
      kind: "candidate-artifact" as const,
      referenceId:
        request.failedCandidates[0]?.candidateId ?? "candidate_failed",
      digest: request.failedOutputDigest,
    };
  }
  return evidenceReference();
}

function candidateBundle(invocation: ModelProviderInvocationV1) {
  const request = invocation.request as Extract<
    ModelGatewayRequestV1,
    {
      operation:
        | "application-source.generate"
        | "candidate.repair"
        | "fix.propose"
        | "iac-extension.generate";
    }
  >;
  const path = request.boundary.ownedPaths[0] ?? "application/fake.ts";
  const content = `// Deterministic fake candidate for ${request.operation}\n`;
  const sourceReference = candidateSourceReference(request);
  const repairedPriorDigest =
    request.operation === "candidate.repair"
      ? (() => {
          const failed = request.failedCandidates.find(
            (candidate) => candidate.path === path,
          );
          if (failed === undefined) return undefined;
          return failed.kind === "file"
            ? failed.contentDigest
            : failed.proposedResultDigest;
        })()
      : undefined;
  const priorCandidateContext =
    request.operation === "candidate.repair"
      ? request.priorCandidateContext
      : undefined;
  return {
    assumptions: priorCandidateContext?.assumptions ?? [],
    boundary: request.boundary,
    candidates: [
      {
        candidateId: `candidate_${invocation.descriptor.invocationId}`,
        content,
        contentDigest: sha256Text(content),
        encoding: "utf-8" as const,
        kind: "file" as const,
        ownership: "ai-authored-candidate" as const,
        path,
        ...(repairedPriorDigest === undefined
          ? {}
          : { priorDigest: repairedPriorDigest }),
      },
    ],
    dependencies: [],
    expectedTests: priorCandidateContext?.expectedTests ?? [],
    generationPlan: {
      objective:
        "Produce one deterministic fake candidate for contract testing.",
      planId: `plan_${invocation.descriptor.invocationId}`,
      steps: [
        {
          action:
            request.operation === "candidate.repair"
              ? ("replace-owned-file" as const)
              : ("create-file" as const),
          rationale: "Exercise the exact candidate artifact boundary.",
          sourceReferences: [sourceReference],
          stepId: `step_${invocation.descriptor.invocationId}`,
          targetPath: path,
        },
      ],
    },
    provenance: provenance(invocation),
    unresolvedItems: priorCandidateContext?.unresolvedItems ?? [],
    validationExpectations: request.validationExpectations,
  };
}

function deterministicFakeResponseInputV1(
  invocation: ModelProviderInvocationV1,
): unknown {
  const common = {
    contractVersion: 1 as const,
    proposalContext: proposalContext(),
    provenance: provenance(invocation),
  };
  const request = invocation.request;
  switch (request.operation) {
    case "intent.extract":
      return {
        ...common,
        intentDocument: fakeIntentDocument(invocation),
        operation: request.operation,
      };
    case "requirements.blocking-questions":
      return { ...common, operation: request.operation, questions: [] };
    case "architecture.propose": {
      const serviceId = request.catalog.allowedServiceIds[0];
      return {
        ...common,
        operation: request.operation,
        relationships: [],
        services:
          serviceId === undefined
            ? []
            : [
                {
                  candidateId: "service_candidate_fake",
                  capability: "cloudmarkup.fake-capability",
                  catalogServiceId: serviceId,
                  evidenceReferences: [],
                  rationale:
                    "Deterministic fake catalog-bound service proposal.",
                },
              ],
      };
    }
    case "workload.propose":
      return { ...common, operation: request.operation, workloads: [] };
    case "external-resource.propose":
      return { ...common, operation: request.operation, resources: [] };
    case "operations.propose":
      if (request.planningContext !== undefined) {
        const workload = request.architecture.workloadBehavior.workloads[0];
        const assistantBatch =
          request.planningContext.allowedAssistantOperationKinds?.length ===
            1 &&
          request.planningContext.allowedAssistantOperationKinds[0] ===
            "edit-workload" &&
          workload !== undefined
            ? {
                batch: {
                  baseArchitectureDigest: getArchitectureDocumentCanonicalHash(
                    request.architecture,
                  ),
                  contractVersion: 1 as const,
                  kind: "cloudmarkup.assistant-operation-batch" as const,
                  operations: [
                    {
                      expectedWorkloadContentHash:
                        getWorkloadBehaviorContentHash(
                          request.architecture.workloadBehavior,
                        ),
                      kind: "edit-workload" as const,
                      operationId: "assistant_fake_edit_workload",
                      patch: {
                        executionAssumptions: {
                          retry: {
                            kind: "bounded" as const,
                            maximumAttempts: 4,
                          },
                          timeout: {
                            kind: "duration" as const,
                            milliseconds: 45_000,
                          },
                        },
                      },
                      rationale: "Use the reviewed timeout and retry budget.",
                      workloadId: workload.id,
                    },
                  ],
                },
                kind: "assistant" as const,
              }
            : undefined;
        const readinessStatuses = request.planningContext.targetReadiness.map(
          (entry) => entry.status,
        );
        return {
          ...common,
          batches: [
            {
              batch: {
                commandId: "batch_solution_planning_fake",
                commands: [
                  {
                    commandId: "command_solution_planning_fake",
                    expectedPosition: request.architecture.nodes[0]
                      ?.presentation.position ?? {
                      x: 0,
                      y: 0,
                    },
                    inverseCommandId: "command_solution_planning_fake_inverse",
                    kind: "move-node",
                    nodeId: request.architecture.nodes[0]?.id ?? "node_fake",
                    origin: "ai-accepted",
                    position: request.architecture.nodes[0]?.presentation
                      .position ?? {
                      x: 0,
                      y: 0,
                    },
                    schemaVersion: 1,
                    target: {
                      architectureId: request.architecture.architectureId,
                      documentId: request.architecture.documentId,
                      revisionId: request.architecture.revision.revisionId,
                    },
                  },
                ],
                inverseCommandId: "batch_solution_planning_fake_inverse",
                kind: "batch",
                origin: "ai-accepted",
                schemaVersion: 1,
                target: {
                  architectureId: request.architecture.architectureId,
                  documentId: request.architecture.documentId,
                  revisionId: request.architecture.revision.revisionId,
                },
              },
              kind: "graph",
            },
            ...(assistantBatch === undefined ? [] : [assistantBatch]),
          ],
          operation: request.operation,
          solutionProposal: {
            externalResources: [],
            generationCoverageSuggestions:
              request.architecture.workloadBehavior.workloads.map(
                (workload) => {
                  const deterministicCoverage =
                    workload.implementation.mode === "infrastructure-only";
                  return {
                    missingRequirements: deterministicCoverage
                      ? []
                      : [
                          "deterministic-application-generation" as const,
                          "application-build-and-tests" as const,
                          "application-security-checks" as const,
                        ],
                    rationale: deterministicCoverage
                      ? "The workload requires no application generation."
                      : "The deterministic fallback does not claim generated or validated custom application coverage.",
                    state: deterministicCoverage
                      ? ("infrastructure-only" as const)
                      : ("custom-implementation-required" as const),
                    workloadId: workload.id,
                  };
                },
              ),
            policyKindsUsed: [],
            rationale:
              "The deterministic fallback preserves the current validated design for review.",
            reconciliationSuggestions:
              request.reconciliation?.operations.map((operation) => {
                const evidence =
                  request.planningContext?.approvedRepositoryEvidence
                    ?.evidence[0];
                const evidenceReferences =
                  evidence === undefined
                    ? []
                    : [
                        {
                          digest: evidence.fileChecksum,
                          kind: "repository-evidence" as const,
                          location: evidence.location,
                          path: evidence.path,
                          referenceId: evidence.evidenceId,
                        },
                      ];
                return {
                  confidence: {
                    basisPoints: 10_000,
                    evidenceReferences,
                    rationale:
                      "The suggestion binds one exact deterministic reconciliation operation.",
                  },
                  evidenceReferences,
                  explanation:
                    "Review the exact deterministic repository reconciliation operation.",
                  operationId: operation.operationId,
                };
              }) ?? [],
            rejectedAlternatives: [],
            targetReadiness: {
              rationale:
                "The result reflects only the supplied target-readiness metadata.",
              status: readinessStatuses.includes("unsupported")
                ? ("unsupported" as const)
                : readinessStatuses.includes("pending")
                  ? ("blocked" as const)
                  : ("ready" as const),
              target: request.planningContext.target,
            },
            testScenarios: [],
          },
        };
      }
      return {
        ...common,
        batches: [
          {
            kind: "workload",
            operations: [
              {
                action: "add",
                expectedWorkloadContentHash: digestStructuredValue(
                  normalizeWorkloadBehaviorV2(
                    request.architecture.workloadBehavior,
                  ),
                ),
                operationId: "workload_operation_fake",
                proposal: {
                  implementationMode: "infrastructure-only",
                  owningNodeId:
                    request.architecture.nodes[0]?.id ?? "node_fake",
                  responsibilities: [
                    "Represent a deterministic fake workload proposal.",
                  ],
                  workloadId: "workload_fake",
                },
              },
            ],
          },
        ],
        operation: request.operation,
      };
    case "repository.interpret": {
      const source = request.evidence[0];
      return {
        ...common,
        claims:
          source === undefined
            ? []
            : [
                {
                  category: "diagnostic",
                  claimId: "repository_claim_fake",
                  confidence: {
                    basisPoints: 7_500,
                    evidenceReferences: [],
                    rationale:
                      "The claim is limited to one exact supplied excerpt.",
                  },
                  evidenceReferences: [
                    {
                      digest: source.fileChecksum,
                      kind: "repository-evidence",
                      location: source.location,
                      path: source.path,
                      referenceId: source.evidenceId,
                    },
                  ],
                  summary:
                    "The supplied excerpt was interpreted as bounded diagnostic evidence.",
                },
              ],
        operation: request.operation,
      };
    }
    case "issue.explain":
    case "deterministic-fix.explain":
      return {
        ...common,
        explanation: {
          nextActions: ["Review the exact issue and its required evidence."],
          plainLanguage: "This is a deterministic fake explanation for review.",
          technical:
            "No authority or model call is implied by this fake response.",
        },
        operation: request.operation,
      };
    case "fix.propose":
      return {
        ...common,
        candidateBundle: candidateBundle(invocation),
        issueId: request.issue.id,
        operation: request.operation,
      };
    case "application-source.generate":
    case "iac-extension.generate":
      return {
        ...common,
        candidateBundle: candidateBundle(invocation),
        operation: request.operation,
      };
    case "candidate.repair":
      return {
        ...common,
        candidateBundle: candidateBundle(invocation),
        operation: request.operation,
        repairedFromDigest: request.failedOutputDigest,
        resolvedDiagnosticIds: request.diagnostics.map(
          (diagnostic) => diagnostic.diagnosticId,
        ),
      };
    case "summary.plain-language":
      return {
        ...common,
        operation: request.operation,
        summary:
          "A deterministic plain-language summary for local development.",
      };
    case "summary.technical":
      return {
        ...common,
        operation: request.operation,
        summary:
          "A deterministic technical summary for local development and CI.",
      };
  }
}

export function deterministicFakeResponseV1(
  invocation: ModelProviderInvocationV1,
): ModelGatewayResponseV1 {
  return modelGatewayResponseV1Schema.parse(
    deterministicFakeResponseInputV1(invocation),
  );
}

export const deterministicFakeProviderProfileV1 = Object.freeze({
  capabilities: [
    {
      acceptedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      capabilityDigest: fixedDigest,
      capabilityRegistryDigest: fixedDigest,
      capabilityRegistryId: "cloudmarkup.model-capabilities.fake",
      capabilityRegistryVersion: "1.0.0",
      capabilityVersion: "1.0.0",
      costTier: "low",
      dataResidencyBoundary: "cloudmarkup.residency.fake.v1",
      evaluation: {
        evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
        evaluationPolicyVersion: "1.0.0",
        passed: true,
        resultDigest: fixedDigest,
        resultVersion: "1.0.0",
        scoreBasisPoints: 10_000,
      },
      maximumInputBytes: 1024 * 1024,
      maximumAttempts: 2,
      maximumOutputBytes: 512 * 1024,
      maximumOutputTokens: 32_768,
      contextLimitTokens: 128_000,
      modelConfigurationReference: "cloudmarkup.fake-model.standard.v1",
      modelFamily: "cloudmarkup.fake-model",
      modelId: "cloudmarkup.fake-model",
      modelVersion: "1.0.0",
      operations: modelGatewayOperationV1Schema.options,
      pricingVersionReference: "cloudmarkup.pricing.fake-model.v1",
      promptCache: {
        maximumCheckpoints: 0,
        minimumCheckpointTokens: 0,
        supported: false,
      },
      roles: [
        "low-cost-extraction-help",
        "standard-planning-generation",
        "deep-architecture-custom-generation",
        "repair-escalation",
        "fallback",
      ],
      streamingSupported: false,
      structuredOutput: "tool-schema",
      supportedModes: ["guided", "professional"],
      timeoutMilliseconds: 120_000,
      usageFieldsExpected: [
        "input-units",
        "output-units",
        "cache-read-units",
        "cache-write-units",
        "thinking-units",
      ],
    },
  ],
  enabled: true,
  profileVersion: "1.0.0",
  providerFamily: "deterministic-fake",
  providerId: "cloudmarkup.fake",
} as const satisfies ModelProviderCapabilityProfileV1);

export const deterministicFakeRoutingV1: ModelRoutingConfigurationV1 =
  modelRoutingConfigurationV1Schema.parse({
    allowFallback: true,
    configurationId: "cloudmarkup.model-routing.fake.v1",
    configurationVersion: "1.0.0",
    routes: [
      "low-cost-extraction-help",
      "standard-planning-generation",
      "deep-architecture-custom-generation",
      "repair-escalation",
      "fallback",
    ].map((role) => ({
      candidates: [
        {
          modelId: "cloudmarkup.fake-model",
          priority: 1,
          providerId: "cloudmarkup.fake",
        },
      ],
      role: role as ModelGatewayResultV1["descriptor"]["role"],
    })),
  });

export class DeterministicFakeModelAdapter implements ModelProviderAdapter {
  public readonly profile: ModelProviderCapabilityProfileV1;
  public readonly invocations: ModelProviderInvocationV1[] = [];

  public constructor(
    profile: ModelProviderCapabilityProfileV1 = deterministicFakeProviderProfileV1,
  ) {
    this.profile = profile;
  }

  public invoke(
    invocation: ModelProviderInvocationV1,
    signal?: AbortSignal,
  ): Promise<ModelProviderResultV1> {
    if (signal?.aborted === true) {
      return Promise.reject(new Error("canceled"));
    }
    this.invocations.push(invocation);
    return Promise.resolve({
      content: {
        input: deterministicFakeResponseV1(invocation),
        kind: "tool-use",
        toolName: invocation.responseTool.toolName,
      },
      usage: {
        cacheReadUnits: "0",
        cacheWriteUnits: "0",
        inputUnits: "100",
        outputUnits: "50",
        providerRequestId: `fake_${invocation.descriptor.invocationId}`,
        thinkingUnits: "0",
      },
    });
  }
}

export class DeterministicFakeScenarioError extends Error {
  public readonly code =
    "model-gateway.invalid-deterministic-fake-scenario" as const;

  public constructor() {
    super("The deterministic fake scenario is not recognized.");
    this.name = "DeterministicFakeScenarioError";
  }
}

function assertDeterministicFakeScenarioV1(
  scenario: unknown,
  allowedScenarioIds: ReadonlySet<string>,
): void {
  if (typeof scenario !== "string" || !allowedScenarioIds.has(scenario)) {
    throw new DeterministicFakeScenarioError();
  }
}

export const deterministicFakeModelScenarioIdsV1 = [
  "success",
  "throttled",
  "missing-usage",
  "cache-hit",
  "cache-miss",
  "timeout",
  "await-cancellation",
  "malformed-tool-input",
  "unknown-tool",
] as const;

const deterministicFakeModelScenarioIdSetV1: ReadonlySet<string> = new Set(
  deterministicFakeModelScenarioIdsV1,
);

export type DeterministicFakeModelScenarioV1 =
  (typeof deterministicFakeModelScenarioIdsV1)[number];

export class DeterministicScenarioFakeModelAdapter implements ModelProviderAdapter {
  public readonly profile: ModelProviderCapabilityProfileV1;
  public readonly invocations: ModelProviderInvocationV1[] = [];
  readonly #scenarios: readonly DeterministicFakeModelScenarioV1[];

  public constructor(
    scenarios: readonly DeterministicFakeModelScenarioV1[],
    profile: ModelProviderCapabilityProfileV1 = deterministicFakeProviderProfileV1,
  ) {
    for (const scenario of scenarios) {
      assertDeterministicFakeScenarioV1(
        scenario,
        deterministicFakeModelScenarioIdSetV1,
      );
    }
    this.#scenarios = [...scenarios];
    this.profile = profile;
  }

  public invoke(
    invocation: ModelProviderInvocationV1,
    signal?: AbortSignal,
  ): Promise<ModelProviderResultV1> {
    const scenario = this.#scenarios[this.invocations.length] ?? "success";
    this.invocations.push(invocation);
    if (scenario === "throttled") {
      return Promise.reject(
        new ModelProviderInvocationError({
          classification: "transient",
          safeCode: "model-provider.throttled",
          safeMessage: "The deterministic provider is throttled.",
          usage: {
            cacheReadUnits: "0",
            cacheWriteUnits: "0",
            inputUnits: "100",
            outputUnits: "0",
            providerRequestId: `fake_throttled_${invocation.descriptor.invocationId}`,
            thinkingUnits: "0",
          },
        }),
      );
    }
    if (scenario === "timeout") {
      return Promise.reject(
        new ModelProviderInvocationError({
          classification: "transient",
          safeCode: "model-provider.timeout",
          safeMessage: "The deterministic provider settled after timeout.",
          usage: {
            cacheReadUnits: "0",
            cacheWriteUnits: "0",
            inputUnits: "100",
            outputUnits: "0",
            providerRequestId: `fake_timeout_${invocation.descriptor.invocationId}`,
            thinkingUnits: "0",
          },
        }),
      );
    }
    if (scenario === "await-cancellation") {
      return new Promise<ModelProviderResultV1>((_resolve, reject) => {
        const canceled = () => {
          reject(
            new ModelProviderInvocationError({
              classification: "permanent",
              safeCode: "model-provider.canceled",
              safeMessage: "The deterministic invocation was canceled.",
              usage: {
                cacheReadUnits: "0",
                cacheWriteUnits: "0",
                inputUnits: "100",
                outputUnits: "0",
                providerRequestId: `fake_canceled_${invocation.descriptor.invocationId}`,
                thinkingUnits: "0",
              },
            }),
          );
        };
        if (signal?.aborted === true) canceled();
        else signal?.addEventListener("abort", canceled, { once: true });
      });
    }

    const content = {
      input:
        scenario === "malformed-tool-input"
          ? { contractVersion: 1 }
          : deterministicFakeResponseV1(invocation),
      kind: "tool-use" as const,
      toolName:
        scenario === "unknown-tool"
          ? "cloudmarkup_unknown_v1"
          : invocation.responseTool.toolName,
    };
    if (scenario === "missing-usage") return Promise.resolve({ content });
    return Promise.resolve({
      content,
      usage: {
        cacheReadUnits: scenario === "cache-hit" ? "80" : "0",
        cacheWriteUnits: scenario === "cache-miss" ? "80" : "0",
        inputUnits: "100",
        outputUnits: "50",
        providerRequestId: `fake_${scenario}_${invocation.descriptor.invocationId}`,
        thinkingUnits: "10",
      },
    });
  }
}

export type ScriptedFakeModelStepV1 =
  | ModelProviderResultV1
  | Error
  | ((
      invocation: ModelProviderInvocationV1,
    ) => ModelProviderResultV1 | Error | Promise<ModelProviderResultV1>);

export class ScriptedFakeModelAdapter implements ModelProviderAdapter {
  public readonly profile: ModelProviderCapabilityProfileV1;
  public readonly invocations: ModelProviderInvocationV1[] = [];
  readonly #steps: readonly ScriptedFakeModelStepV1[];

  public constructor(
    steps: readonly ScriptedFakeModelStepV1[],
    profile: ModelProviderCapabilityProfileV1 = deterministicFakeProviderProfileV1,
  ) {
    this.#steps = [...steps];
    this.profile = profile;
  }

  public invoke(
    invocation: ModelProviderInvocationV1,
  ): Promise<ModelProviderResultV1> {
    const step = this.#steps[this.invocations.length];
    this.invocations.push(invocation);
    if (step === undefined) return Promise.reject(new Error("fake exhausted"));
    const resolved = typeof step === "function" ? step(invocation) : step;
    return resolved instanceof Error
      ? Promise.reject(resolved)
      : Promise.resolve(resolved);
  }
}

interface StoredInvocation {
  readonly claim: ModelInvocationClaimV1;
  readonly result?: ModelGatewayResultV1;
  readonly state: "in-progress" | "complete" | "failed";
}

export class InMemoryModelInvocationStore implements ModelInvocationStore {
  readonly #records = new Map<string, StoredInvocation>();
  readonly #escalationLineages = new Map<string, string>();

  public claim(
    claim: ModelInvocationClaimV1,
  ): Promise<ModelInvocationClaimResultV1> {
    const existing = this.#records.get(claim.invocationId);
    if (existing === undefined) {
      if (claim.escalation !== undefined) {
        const expectedLineageDigest = digestStructuredValue({
          feature: claim.escalation.feature,
          inputDigest: claim.inputDigest,
          originalAcceptedEstimateMaximumCreditUnits:
            claim.escalation.originalAcceptedEstimateMaximumCreditUnits,
          originalCreditAuthorizationDecisionId:
            claim.escalation.originalCreditAuthorizationDecisionId,
          originalInvocationId: claim.escalation.originalInvocationId,
          originalRoutingDecisionDigest:
            claim.escalation.originalRoutingDecisionDigest,
          scopeDigest: claim.escalation.scopeDigest,
        });
        const original = this.#records.get(
          claim.escalation.originalInvocationId,
        );
        const existingEscalationInvocationId = this.#escalationLineages.get(
          claim.escalation.lineageDigest,
        );
        if (
          claim.escalation.lineageDigest !== expectedLineageDigest ||
          original?.state !== "complete" ||
          original.result?.descriptor.feature !== claim.escalation.feature ||
          original.result.descriptor.inputDigest !== claim.inputDigest ||
          digestStructuredValue(original.result.descriptor.scope) !==
            claim.escalation.scopeDigest ||
          original.result.descriptor.budgetDecisionId !==
            claim.escalation.originalCreditAuthorizationDecisionId ||
          original.result.descriptor.routing?.routeId !== "standard-design" ||
          original.result.descriptor.routing.acceptedMaximumCreditUnits !==
            claim.escalation.originalAcceptedEstimateMaximumCreditUnits ||
          original.result.descriptor.routing.routingDecisionDigest !==
            claim.escalation.originalRoutingDecisionDigest ||
          (existingEscalationInvocationId !== undefined &&
            existingEscalationInvocationId !== claim.invocationId)
        ) {
          return Promise.resolve({ kind: "conflict" });
        }
        this.#escalationLineages.set(
          claim.escalation.lineageDigest,
          claim.invocationId,
        );
      }
      this.#records.set(claim.invocationId, { claim, state: "in-progress" });
      return Promise.resolve({ kind: "claimed" });
    }
    if (
      existing.claim.authorityDigest !== claim.authorityDigest ||
      existing.claim.inputDigest !== claim.inputDigest ||
      existing.claim.idempotencyKeyDigest !== claim.idempotencyKeyDigest
    ) {
      return Promise.resolve({ kind: "conflict" });
    }
    if (existing.state === "complete" && existing.result !== undefined) {
      return Promise.resolve({
        kind: "duplicate-complete",
        result: existing.result,
      });
    }
    return Promise.resolve(
      existing.state === "in-progress"
        ? { kind: "duplicate-in-progress" }
        : { kind: "conflict" },
    );
  }

  public complete(
    claim: ModelInvocationClaimV1,
    result: ModelGatewayResultV1,
  ): Promise<void> {
    this.#records.set(claim.invocationId, {
      claim,
      result,
      state: "complete",
    });
    return Promise.resolve();
  }

  public loadCompleted(
    invocationId: string,
  ): Promise<ModelGatewayResultV1 | null> {
    const record = this.#records.get(invocationId);
    return Promise.resolve(
      record?.state === "complete" && record.result !== undefined
        ? record.result
        : null,
    );
  }

  public fail(claim: ModelInvocationClaimV1): Promise<void> {
    this.#records.set(claim.invocationId, { claim, state: "failed" });
    return Promise.resolve();
  }
}

export const deterministicModelGatewayScenarioIdsV1 = [
  "standard-success",
  "deep-success",
  "standard-validation-failure",
  "internal-escalation-success",
  "internal-escalation-failure",
  "route-disabled",
  "plan-denial",
  "credit-denial",
  "duplicate-request",
  "model-configuration-drift",
] as const;

const deterministicModelGatewayScenarioIdSetV1: ReadonlySet<string> = new Set(
  deterministicModelGatewayScenarioIdsV1,
);

export type DeterministicModelGatewayScenarioV1 =
  (typeof deterministicModelGatewayScenarioIdsV1)[number];

export type DeterministicModelGatewayScenarioResultV1 =
  | {
      readonly contractVersion: 1;
      readonly decision: ModelRoutingDecisionV1;
      readonly kind: "attempt";
      readonly result: "succeeded" | "validation-failure";
      readonly safeCode?: string;
      readonly scenario: DeterministicModelGatewayScenarioV1;
    }
  | {
      readonly contractVersion: 1;
      readonly decision: ModelRoutingDecisionV1;
      readonly kind: "route-denied";
      readonly scenario: DeterministicModelGatewayScenarioV1;
    }
  | {
      readonly contractVersion: 1;
      readonly duplicateClaim: ModelInvocationClaimResultV1;
      readonly firstClaim: ModelInvocationClaimResultV1;
      readonly kind: "duplicate-request";
      readonly scenario: "duplicate-request";
    };

function deterministicEvaluatedCapabilityRegistryV1(): ModelCapabilityRegistryV1 {
  return modelCapabilityRegistryV1Schema.parse({
    ...bedrockModelCapabilityRegistryV1,
    capabilities: bedrockModelCapabilityRegistryV1.capabilities.map(
      (capability) => ({
        ...capability,
        evaluation: {
          ...capability.evaluation,
          passed: true,
          scoreBasisPoints: 9_500,
        },
        lifecycleState: "active",
      }),
    ),
  });
}

function deterministicRoutingScenarioRequest(input?: {
  readonly creditsAllowed?: boolean;
  readonly plan?: "starter" | "pro";
  readonly preference?: "automatic" | "standard-design" | "deep-design";
  readonly standardValidationFailure?: boolean;
}): ModelRoutingRequestV1 {
  const standardValidationFailure = input?.standardValidationFailure === true;
  return modelRoutingRequestV1Schema.parse({
    accountRegionComplexity: "single-account-region",
    creditAuthorization: {
      acceptedEstimateMaximumCreditUnits: 40,
      allowed: input?.creditsAllowed ?? true,
      availableCreditUnits: 500,
      decisionId: "credit_decision_fake",
      estimateAccepted: true,
    },
    currentValidationState: standardValidationFailure
      ? "failed-deterministic-validation"
      : "not-run",
    customCodeRequirement: "none",
    edgeCount: 4,
    environment: "production",
    estimatedContextTokens: 20_000,
    expectedOutputClass: "structured-proposal",
    externalResourceCount: 0,
    feature: "architecture.propose",
    idempotencyKeyDigest: fixedDigest,
    inputDigest: fixedDigest,
    networkingComplexity: "basic",
    nodeCount: 5,
    operationClass: "planning",
    organizationId: "organization_fake",
    plan: {
      entitlementDecisionId: "entitlement_decision_fake",
      key: input?.plan ?? "starter",
      versionId: "plan_version_fake",
    },
    principalId: "principal_fake",
    ...(standardValidationFailure
      ? {
          priorAttempt: {
            diagnosticsDigest: fixedDigest,
            escalationCount: 0,
            originalAcceptedEstimateMaximumCreditUnits: 40,
            originalCreditAuthorizationDecisionId: "credit_decision_fake",
            originalInvocationId: "invocation_fake_standard_prior",
            originalRoutingDecisionDigest: fixedDigest,
            result: "validation-failure",
            routeId: "standard-design",
          },
        }
      : {}),
    projectId: "project_fake",
    repositoryFileEstimate: 20,
    repositoryTokenEstimate: 5_000,
    requiredEvaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
    requiredEvaluationPolicyVersion: "1.0.0",
    requestedMode: "guided",
    securityComplianceSensitivity: "ordinary",
    selectedPreference: input?.preference ?? "automatic",
    serviceFamilyCount: 3,
    scopeDigest: fixedDigest,
    workloadCount: 1,
  });
}

function selectedAttemptResult(input: {
  readonly decision: ModelRoutingDecisionV1;
  readonly result: "succeeded" | "validation-failure";
  readonly safeCode?: string;
  readonly scenario: DeterministicModelGatewayScenarioV1;
}): DeterministicModelGatewayScenarioResultV1 {
  if (input.decision.outcome !== "selected") {
    throw new Error("The deterministic selected-route scenario was denied.");
  }
  return {
    contractVersion: 1,
    decision: input.decision,
    kind: "attempt",
    result: input.result,
    ...(input.safeCode === undefined ? {} : { safeCode: input.safeCode }),
    scenario: input.scenario,
  };
}

function deniedRouteResult(
  scenario: DeterministicModelGatewayScenarioV1,
  decision: ModelRoutingDecisionV1,
): DeterministicModelGatewayScenarioResultV1 {
  if (decision.outcome !== "denied") {
    throw new Error("The deterministic denied-route scenario was selected.");
  }
  return {
    contractVersion: 1,
    decision,
    kind: "route-denied",
    scenario,
  };
}

/**
 * Runs one routing scenario entirely in memory. Selected attempts
 * are strict routing decisions plus a synthetic validation result; denied,
 * duplicate, and configuration-drift scenarios stop before provider invoke.
 */
export async function runDeterministicModelGatewayScenarioV1(
  scenario: DeterministicModelGatewayScenarioV1,
): Promise<DeterministicModelGatewayScenarioResultV1> {
  assertDeterministicFakeScenarioV1(
    scenario,
    deterministicModelGatewayScenarioIdSetV1,
  );
  const capabilityRegistry = deterministicEvaluatedCapabilityRegistryV1();
  const routeRegistry = modelRouteRegistryV1Schema.parse({
    ...bedrockModelRouteRegistryV1,
    capabilityRegistryDigest: digestStructuredValue(capabilityRegistry),
  });
  if (scenario === "duplicate-request") {
    const invocationStore = new InMemoryModelInvocationStore();
    const claimDigest = sha256DigestSchema.parse(fixedDigest);
    const claim: ModelInvocationClaimV1 = {
      authorityDigest: claimDigest,
      idempotencyKeyDigest: claimDigest,
      inputDigest: claimDigest,
      invocationId: "invocation_fake_duplicate_request",
    };
    const firstClaim = await invocationStore.claim(claim);
    const duplicateClaim = await invocationStore.claim(claim);
    return {
      contractVersion: 1,
      duplicateClaim,
      firstClaim,
      kind: "duplicate-request",
      scenario,
    };
  }

  if (scenario === "model-configuration-drift") {
    const driftedRouteRegistry = modelRouteRegistryV1Schema.parse({
      ...routeRegistry,
      capabilityRegistryVersion: "2.0.0",
    });
    selectModelRoutingDecisionV1({
      capabilityRegistry,
      request: deterministicRoutingScenarioRequest(),
      routeRegistry: driftedRouteRegistry,
      routingConfigurationDigest: fixedDigest,
    });
    throw new Error("Model configuration drift did not fail closed.");
  }

  if (scenario === "route-disabled") {
    const disabledRouteRegistry = modelRouteRegistryV1Schema.parse({
      ...routeRegistry,
      routes: routeRegistry.routes.map((route) =>
        route.routeId === "standard-design"
          ? { ...route, enabled: false }
          : route,
      ),
    });
    return deniedRouteResult(
      scenario,
      selectModelRoutingDecisionV1({
        capabilityRegistry,
        request: deterministicRoutingScenarioRequest(),
        routeRegistry: disabledRouteRegistry,
        routingConfigurationDigest: fixedDigest,
      }),
    );
  }

  if (scenario === "plan-denial") {
    return deniedRouteResult(
      scenario,
      selectModelRoutingDecisionV1({
        capabilityRegistry,
        routeRegistry,
        request: deterministicRoutingScenarioRequest({
          plan: "starter",
          preference: "deep-design",
        }),
        routingConfigurationDigest: fixedDigest,
      }),
    );
  }

  if (scenario === "credit-denial") {
    return deniedRouteResult(
      scenario,
      selectModelRoutingDecisionV1({
        capabilityRegistry,
        routeRegistry,
        request: deterministicRoutingScenarioRequest({
          creditsAllowed: false,
        }),
        routingConfigurationDigest: fixedDigest,
      }),
    );
  }

  const isEscalation =
    scenario === "internal-escalation-success" ||
    scenario === "internal-escalation-failure";
  const decision = selectModelRoutingDecisionV1({
    capabilityRegistry,
    routeRegistry,
    request: deterministicRoutingScenarioRequest({
      plan: scenario === "deep-success" ? "pro" : "starter",
      preference: scenario === "deep-success" ? "deep-design" : "automatic",
      standardValidationFailure: isEscalation,
    }),
    routingConfigurationDigest: fixedDigest,
  });

  if (scenario === "standard-validation-failure") {
    return selectedAttemptResult({
      decision,
      result: "validation-failure",
      safeCode: "model-output.validation-failed",
      scenario,
    });
  }
  if (scenario === "internal-escalation-failure") {
    return selectedAttemptResult({
      decision,
      result: "validation-failure",
      safeCode: "model-escalation.validation-failed",
      scenario,
    });
  }
  return selectedAttemptResult({
    decision,
    result: "succeeded",
    scenario,
  });
}

export class CollectingModelUsageRecorder implements ModelUsageRecorder {
  public readonly records: NormalizedModelUsageV1[] = [];
  public fail = false;
  public listByInvocationId(
    invocationId: string,
  ): Promise<readonly NormalizedModelUsageV1[]> {
    return Promise.resolve(
      this.records.filter((record) => record.invocationId === invocationId),
    );
  }

  public record(usage: NormalizedModelUsageV1): Promise<void> {
    if (this.fail) return Promise.reject(new Error("meter unavailable"));
    const existing = this.records.find(
      (record) => record.usageRecordId === usage.usageRecordId,
    );
    if (existing !== undefined) {
      return digestStructuredValue(existing) === digestStructuredValue(usage)
        ? Promise.resolve()
        : Promise.reject(new Error("conflicting usage record"));
    }
    this.records.push(usage);
    return Promise.resolve();
  }
}

export class CollectingSafeModelLogger implements SafeModelLogger {
  public readonly events: SafeModelLogEventV1[] = [];

  public write(event: SafeModelLogEventV1): void {
    this.events.push(event);
  }
}

export function fakeOutputDigestFor(response: ModelGatewayResponseV1): string {
  return digestStructuredValue(response);
}

export function supportedFakeOperations(): readonly ModelGatewayOperationV1[] {
  return modelGatewayOperationV1Schema.options;
}
export * from "./commercial-lifecycle-fakes.js";
export { syntheticLiveEvaluationFixtureV2 } from "./model-live-evaluation-fakes.js";
export * from "./commercial-reconciliation-fake.js";
export * from "./commercial-reconciliation-source-fake.js";

/**
 * Frozen synthetic fixtures for downstream deterministic full-solution E2E hosts.
 * They remain test-only through the declared @cloudmarkup/model-gateway/testing
 * export and carry no network, credential, repository-write, or deployment authority.
 */
export {
  modelTestContext,
  modelTestRequests,
  modelTestRoutingRequest,
  modelTestRoutingDecision,
  testIntent,
  testSolutionRevision,
} from "./test-helpers.js";

export { syntheticSequenceFixtureV3 } from "./model-live-sequence-test-helpers.js";

export { syntheticSeedRuntimeFixtureV3 } from "./model-live-seed-runtime-test-helpers.js";

export { syntheticSeedSequenceRuntimeFixtureV4 } from "./model-live-sequence-runtime-v4-test-helpers.js";

export { createHostSeedResponseFixtureV3 } from "./host-seed-response-test-helpers.js";

export { createHostSeedPatchResponseFixtureV2 } from "./host-seed-response-test-helpers.js";

export {
  createHostRepairSuccessorTestInvocationV4,
  createHostRepairSuccessorResponseFixtureV4,
} from "./host-repair-successor-test-helpers.js";
