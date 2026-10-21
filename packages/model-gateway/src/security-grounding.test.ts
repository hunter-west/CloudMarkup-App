import {
  architectureDocumentV3Schema,
  configurationKeySchema,
  configurationValueSchema,
  externalResourceV1Schema,
  modelGatewayRequestV1Schema,
  modelGatewayResponseV1Schema,
  modelInvocationDescriptorV1Schema,
  modelValidationExpectationV1Schema,
  proposalItemIdSchema,
  solutionRevisionManifestV1Schema,
  type ModelGatewayRequestV1,
  type ModelGatewayResponseV1,
} from "@cloudmarkup/schemas";
import {
  getApplicationContractRecordContentHash,
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentHashes,
  getExternalResourceReferenceContentHash,
  getWorkloadBehaviorContentHash,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import {
  ModelGatewayValidationError,
  digestStructuredValue,
  redactModelRequest,
  sha256Text,
  validateModelRequestAuthority,
  validateModelResponseAuthority,
} from "./security.js";
import {
  TEST_DIGEST,
  modelTestRequests,
  testIacGenerationRequestWithContext,
} from "./test-helpers.js";

const descriptor = modelInvocationDescriptorV1Schema.parse({
  budgetDecisionId: "budget_decision_security_test",
  complexity: "standard",
  contractVersion: 1,
  entitlementDecisionId: "entitlement_decision_security_test",
  evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
  evaluationPolicyVersion: "1.0.0",
  feature: "summary.technical",
  idempotencyKeyDigest: TEST_DIGEST,
  inferenceProfileId: "profile.security-test",
  inputDigest: TEST_DIGEST,
  invocationId: "invocation_security_test",
  modelId: "model.security-test",
  modelVersion: "1",
  promptDigest: TEST_DIGEST,
  promptTemplateId: "prompt.security-test",
  promptVersion: "1.0.0",
  providerFamily: "deterministic-fake",
  providerId: "provider.security-test",
  requestedMode: "guided",
  role: "standard-planning-generation",
  scope: {
    organizationId: "organization_security_test",
    projectId: "project_security_test",
    repositorySnapshotId: "repository_snapshot_security_test",
    solutionRevisionId: "solution_revision_security_test",
    userId: "user_security_test",
  },
  toolAuthority: "none",
});

const provenance = {
  contractVersion: 1 as const,
  gatewayId: "cloudmarkup.model-gateway",
  inferenceProfileId: descriptor.inferenceProfileId,
  inputDigest: descriptor.inputDigest,
  invocationId: descriptor.invocationId,
  modelId: descriptor.modelId,
  modelVersion: descriptor.modelVersion,
  ownership: "untrusted-proposal" as const,
  promptDigest: descriptor.promptDigest,
  promptTemplateId: descriptor.promptTemplateId,
  promptVersion: descriptor.promptVersion,
  providerId: descriptor.providerId,
};

const proposalContext = {
  assumptions: [],
  confidence: {
    basisPoints: 10_000,
    evidenceReferences: [],
    rationale: "Deterministic security fixture.",
  },
  unknowns: [],
};

function parseRequestFor<Operation extends ModelGatewayRequestV1["operation"]>(
  operation: Operation,
  input: unknown,
): Extract<ModelGatewayRequestV1, { operation: Operation }> {
  const request = modelGatewayRequestV1Schema.parse(input);
  if (request.operation !== operation) {
    throw new Error(`Expected ${operation} request fixture.`);
  }
  return request as Extract<ModelGatewayRequestV1, { operation: Operation }>;
}

function parseResponseFor<
  Operation extends ModelGatewayResponseV1["operation"],
>(
  operation: Operation,
  input: unknown,
): Extract<ModelGatewayResponseV1, { operation: Operation }> {
  const response = modelGatewayResponseV1Schema.parse(input);
  if (response.operation !== operation) {
    throw new Error(`Expected ${operation} response fixture.`);
  }
  return response as Extract<ModelGatewayResponseV1, { operation: Operation }>;
}

function requestFor<Operation extends ModelGatewayRequestV1["operation"]>(
  operation: Operation,
): Extract<ModelGatewayRequestV1, { operation: Operation }> {
  const request = modelTestRequests().find(
    (candidate) => candidate.operation === operation,
  );
  if (request === undefined) {
    throw new Error(`Missing ModelGateway request fixture for ${operation}.`);
  }
  return parseRequestFor(operation, request);
}

function assertDenied(
  requestInput: unknown,
  responseInput: unknown,
  code: string,
): void {
  const request = modelGatewayRequestV1Schema.parse(requestInput);
  const response = modelGatewayResponseV1Schema.parse(responseInput);
  try {
    validateModelResponseAuthority({
      allowedApprovalPathIds: new Set(["cloudmarkup.dependency-review.v1"]),
      descriptor,
      request,
      response,
    });
    throw new Error("Expected response authority validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(ModelGatewayValidationError);
    expect((error as ModelGatewayValidationError).code).toBe(code);
  }
}

function assertRequestDenied(requestInput: unknown, code: string): void {
  const request = modelGatewayRequestV1Schema.parse(requestInput);
  try {
    validateModelRequestAuthority(request);
    throw new Error("Expected request authority validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(ModelGatewayValidationError);
    expect((error as ModelGatewayValidationError).code).toBe(code);
  }
}

function repairResponse(
  requestInput: unknown,
  input?: {
    readonly planPath?: string;
    readonly resolvedDiagnosticIds?: readonly string[];
  },
): Extract<ModelGatewayResponseV1, { operation: "candidate.repair" }> {
  const request = parseRequestFor("candidate.repair", requestInput);
  const content = "// repaired candidate\n";
  const candidatePath = request.boundary.ownedPaths[0] ?? "application/fake.ts";
  const failed = request.failedCandidates.find(
    (candidate) => candidate.path === candidatePath,
  );
  const priorDigest =
    failed?.kind === "file"
      ? failed.contentDigest
      : failed?.proposedResultDigest;
  return parseResponseFor("candidate.repair", {
    candidateBundle: {
      assumptions: request.priorCandidateContext?.assumptions ?? [],
      boundary: request.boundary,
      candidates: [
        {
          candidateId: "candidate_repaired_test",
          content,
          contentDigest: sha256Text(content),
          encoding: "utf-8",
          kind: "file",
          ownership: "ai-authored-candidate",
          path: candidatePath,
          priorDigest,
        },
      ],
      dependencies: [],
      expectedTests: request.priorCandidateContext?.expectedTests ?? [],
      generationPlan: {
        objective: "Repair the exact failed candidate.",
        planId: "plan_repair_security_test",
        steps: [
          {
            action: "replace-owned-file",
            rationale: "Apply the bounded diagnostic repair.",
            sourceReferences: [
              {
                digest: request.failedOutputDigest,
                kind: "candidate-artifact",
                referenceId:
                  request.failedCandidates[0]?.candidateId ??
                  "candidate_failed_test",
              },
            ],
            stepId: "step_repair_security_test",
            targetPath: input?.planPath ?? candidatePath,
          },
        ],
      },
      provenance,
      unresolvedItems: request.priorCandidateContext?.unresolvedItems ?? [],
      validationExpectations: request.validationExpectations,
    },
    contractVersion: 1,
    operation: "candidate.repair",
    proposalContext,
    provenance,
    repairedFromDigest: request.failedOutputDigest,
    resolvedDiagnosticIds: [
      ...(input?.resolvedDiagnosticIds ?? ["diagnostic_test"]),
    ],
  });
}

function contextualIacRequest() {
  const request = structuredClone(testIacGenerationRequestWithContext());
  if (request.generationContext === undefined) {
    throw new Error("Missing Prompt 36A generation context fixture.");
  }
  const unitExpectation = modelValidationExpectationV1Schema.parse({
    checkId: "cloudmarkup.validation.unit-test",
    kind: "unit-test",
    required: true,
    successCondition: "must-pass",
    toolProfileId: "cloudmarkup.validation-profile",
  });
  request.validationExpectations.push(unitExpectation);
  request.generationContext.validationExpectations.push(unitExpectation);
  request.generationContextDigest = digestStructuredValue(
    request.generationContext,
  );
  return parseRequestFor("iac-extension.generate", request);
}

function generationResponse(
  requestInput: unknown,
): Extract<ModelGatewayResponseV1, { operation: "iac-extension.generate" }> {
  const request = parseRequestFor("iac-extension.generate", requestInput);
  const path = request.boundary.ownedPaths[0] ?? "infrastructure/fake.tf";
  const content = "# bounded extension candidate\n";
  const sourceReference = request.sourceReferences[0];
  if (sourceReference === undefined) {
    throw new Error("Missing generation source reference fixture.");
  }
  return parseResponseFor("iac-extension.generate", {
    candidateBundle: {
      assumptions: [
        {
          assumptionId: "assumption_generation_context_test",
          sourceReferences: [sourceReference],
          statement: "The exact supplied target slot remains available.",
        },
      ],
      boundary: request.boundary,
      candidates: [
        {
          candidateId: "candidate_generation_context_test",
          content,
          contentDigest: sha256Text(content),
          encoding: "utf-8",
          kind: "file",
          ownership: "ai-authored-candidate",
          path,
        },
      ],
      dependencies: [],
      expectedTests: [
        {
          description: "Exercise the bounded extension contract.",
          expectedTestId: "expected_test_generation_context",
          kind: "unit-test",
          sourceReferences: [sourceReference],
          targetPaths: [path],
          validationCheckId: "cloudmarkup.validation.unit-test",
        },
      ],
      generationPlan: {
        objective: "Produce one bounded extension candidate.",
        planId: "plan_generation_context_test",
        steps: [
          {
            action: "create-file",
            rationale: "Use the exact approved target slot.",
            sourceReferences: [sourceReference],
            stepId: "step_generation_context_test",
            targetPath: path,
          },
        ],
      },
      provenance,
      unresolvedItems: [
        {
          blocking: true,
          detail: "Acceptance must confirm the target extension slot.",
          question: "Should this candidate be accepted into the slot?",
          sourceReferences: [sourceReference],
          unresolvedItemId: "unresolved_generation_context_test",
        },
      ],
      validationExpectations: request.validationExpectations,
    },
    contractVersion: 1,
    operation: "iac-extension.generate",
    proposalContext,
    provenance,
  });
}
function contextualUserOwnedApplicationRequest() {
  const base = structuredClone(requestFor("application-source.generate"));
  const iac = testIacGenerationRequestWithContext();
  if (iac.generationContext?.kind !== "iac-extension") {
    throw new Error("Missing contextual generation fixture.");
  }
  const baseWorkload = base.architecture.workloadBehavior.workloads.find(
    (entry) => entry.id === base.workloadId,
  );
  if (baseWorkload === undefined) {
    throw new Error("Missing application Workload fixture.");
  }
  const path = base.boundary.ownedPaths[0] ?? "application/fake.ts";
  const baseContent = 'export const preserved = "base";\n';
  const baseDigest = sha256Text(baseContent);
  const extensionId = "extension.application-context";
  const extension = {
    digest: sha256Text("application context extension"),
    extensionContractVersion: 1 as const,
    extensionId,
    ownership: "ai-authored" as const,
    validationEvidenceIds: ["evidence_application_context"],
  };
  const contract = {
    contractId: "contracts.gateway.exact",
    contractKind: "data-entity" as const,
    contractVersion: "1.0.0",
    displayName: "Gateway exact contract",
    fields: [
      {
        classification: "internal" as const,
        fieldType: { kind: "scalar" as const, scalarType: "string" as const },
        name: "value",
        nullable: false,
        required: true,
      },
    ],
    indexes: [],
    provenance: {
      recordedAt: "2026-08-20T00:00:00.000Z",
      recordedBy: "actor_test",
      source: "designed" as const,
      sourceReferenceIds: ["requirement_retry_review"],
    },
    semanticName: "application.gateway.exact",
    storageIntent: "persistent" as const,
    supportedOperations: ["read" as const],
  };
  const architecture = architectureDocumentV3Schema.parse({
    ...base.architecture,
    applicationContracts: {
      ...base.architecture.applicationContracts,
      contracts: [contract],
    },
    workloadBehavior: {
      ...base.architecture.workloadBehavior,
      workloads: base.architecture.workloadBehavior.workloads.map((workload) =>
        workload.id === base.workloadId
          ? {
              ...workload,
              compatibility: {
                applicationGenerators: [],
                modelGateways: [
                  {
                    modelFamily: "model.security-test",
                    modelGatewayContractVersion: "1.0.0",
                    promptDigest: descriptor.promptDigest,
                    promptTemplateId: descriptor.promptTemplateId,
                    promptVersion: descriptor.promptVersion,
                    requiredValidation: [
                      "parse",
                      "static-analysis",
                      "build",
                      "unit-test",
                      "contract-test",
                      "security",
                    ],
                    supportedMode: "ai-assisted-custom",
                  },
                ],
              },
              extensionPoints: [
                {
                  conflictBehavior: "require-reviewed-resolution",
                  extensionPointId: "extension.application-handler",
                  kind: "module",
                  path,
                  permittedOwnership: ["user-owned"],
                },
              ],
              extensions: [extension],
              implementation: {
                extension,
                handler: "src/handler.main",
                mode: "ai-assisted-custom",
                runtimeFamily: "example.runtime.nodejs",
                sourceOwnership: "ai-authored",
              },
              languageFamily: "language.typescript",
              provenance: {
                acceptedAt: "2026-08-20T00:00:00.000Z",
                acceptedBy: "actor_test",
                modelGatewayId: "cloudmarkup.model-gateway",
                modelId: "model.security-test",
                modelProviderId: "provider.security-test",
                outputDigest: extension.digest,
                promptDigest: descriptor.promptDigest,
                promptTemplateId: descriptor.promptTemplateId,
                promptVersion: descriptor.promptVersion,
                source: "ai-assisted",
              },
              sourceOwnership: [
                {
                  conflictBehavior: "preserve-user-content",
                  declarationId: "ownership_application_context",
                  ownerId: "application.owner",
                  ownership: "user-owned",
                  path,
                  pathKind: "file",
                  regeneration: "never",
                  semanticDiff: { strategy: "structured-language" },
                },
              ],
            }
          : workload,
      ),
    },
  });
  const hashes = getArchitectureDocumentHashes(architecture);
  const contractDigest = getApplicationContractRecordContentHash(contract);
  const solutionRevision = solutionRevisionManifestV1Schema.parse({
    ...base.solutionRevision,
    aiExtensionIds: [extensionId],
    architecture: {
      contentHash: hashes.contentHash,
      documentHash: getArchitectureDocumentCanonicalHash(architecture),
      documentKind: "cloudmarkup.architecture-document",
      revisionId: architecture.revision.revisionId,
      schemaVersion: 3,
      visualHash: hashes.visualHash,
    },
    contracts: {
      contentHash: getApplicationContractsContentHash(
        architecture.applicationContracts,
      ),
      contractVersion: 1,
      recordHashes: [contractDigest],
    },
    externalResources: {
      contentHash: getExternalResourceReferenceContentHash(
        architecture.externalResources,
      ),
      contractVersion: 1,
    },
    sourceOwnership: [
      {
        conflictBehavior: "preserve-user-content",
        contentHash: baseDigest,
        ownerId: "application.owner",
        ownership: "user-owned",
        path,
      },
      ...base.solutionRevision.sourceOwnership.filter(
        (entry) => entry.path !== path,
      ),
    ],
    workload: {
      contentHash: getWorkloadBehaviorContentHash(
        architecture.workloadBehavior,
      ),
      contractVersion: 2,
    },
  });
  const {
    extensionSlotId: _slot,
    targetFormat: _format,
    ...common
  } = structuredClone(iac.generationContext);
  void _slot;
  void _format;
  const sourceReferences = [
    {
      digest: contractDigest,
      kind: "solution-contract" as const,
      referenceId: contract.contractId,
    },
  ];
  const generationContext = {
    ...common,
    allowedProviders: [],
    allowedResources: [],
    existingFiles: [
      {
        content: baseContent,
        contentDigest: baseDigest,
        noSecretValues: true as const,
        ownership: "user-owned" as const,
        path,
        redactionStatus: "not-required" as const,
        sizeBytes: new TextEncoder().encode(baseContent).byteLength,
      },
    ],
    extensionId,
    extensionPointId: "extension.application-handler",
    kind: "application" as const,
    language: "language.typescript",
    ownedPaths: [path],
    ownedResourceAddresses: [],
    protectedPaths: ["infrastructure/fake.tf"],
    protectedResourceAddresses: [],
    requestedBehavior: {
      acceptanceCriteria: base.acceptanceCriteria,
      objective: "Patch the exact reviewed custom application behavior.",
      requirements: ["Preserve the digest-bound user-owned base."],
    },
    runtimeFamily: "example.runtime.nodejs",
    sourceReferences,
    validationExpectations: base.validationExpectations,
    workloadId: base.workloadId,
  };
  return parseRequestFor("application-source.generate", {
    ...base,
    architecture,
    generationContext,
    generationContextDigest: digestStructuredValue(generationContext),
    solutionRevision,
    sourceOwnershipAuthority: {
      ...base.sourceOwnershipAuthority,
      solutionRevisionId: solutionRevision.solutionRevisionId,
      sourceOwnership: solutionRevision.sourceOwnership.filter(
        (entry) => entry.path === path,
      ),
    },
    sourceReferences,
  });
}

function userOwnedApplicationResponse(requestInput: unknown) {
  const request = parseRequestFor("application-source.generate", requestInput);
  const path = request.boundary.ownedPaths[0] ?? "application/fake.ts";
  const existing = request.generationContext?.existingFiles[0];
  const reference = request.sourceReferences[0];
  if (existing === undefined || reference === undefined) {
    throw new Error("Missing exact user-owned application context.");
  }
  const proposedContent = 'export const preserved = "patched";\n';
  return parseResponseFor("application-source.generate", {
    candidateBundle: {
      boundary: request.boundary,
      candidates: [
        {
          baseDigest: existing.contentDigest,
          candidateId: "candidate_user_owned_patch",
          kind: "patch",
          ownership: "ai-authored-candidate",
          path,
          proposedResultDigest: sha256Text(proposedContent),
          unifiedDiff: [
            `--- a/${path}`,
            `+++ b/${path}`,
            "@@ -1 +1 @@",
            '-export const preserved = "base";',
            '+export const preserved = "patched";',
            "",
          ].join("\n"),
        },
      ],
      dependencies: [],
      generationPlan: {
        objective: "Patch the exact digest-bound user-owned file.",
        planId: "plan_user_owned_patch",
        steps: [
          {
            action: "propose-patch",
            rationale: "Preserve explicit user ownership and patch lineage.",
            sourceReferences: [reference],
            stepId: "step_user_owned_patch",
            targetPath: path,
          },
        ],
      },
      provenance,
      validationExpectations: request.validationExpectations,
    },
    contractVersion: 1,
    operation: "application-source.generate",
    proposalContext,
    provenance,
  });
}

describe("ModelGateway security grounding", () => {
  it("grounds exact user-owned patches and exact solution-contract references", () => {
    const request = contextualUserOwnedApplicationRequest();
    const response = userOwnedApplicationResponse(request);

    expect(() => {
      validateModelRequestAuthority(request);
    }).not.toThrow();
    expect(() => {
      validateModelResponseAuthority({
        allowedApprovalPathIds: new Set(["cloudmarkup.dependency-review.v1"]),
        descriptor,
        request,
        response,
      });
    }).not.toThrow();

    const exactReference = request.sourceReferences[0];
    if (
      exactReference?.digest === undefined ||
      request.generationContext?.kind !== "application"
    ) {
      throw new Error("Missing exact solution-contract fixture.");
    }
    const invalidReferences = [
      {
        kind: "solution-contract" as const,
        referenceId: exactReference.referenceId,
      },
      {
        digest: sha256Text("wrong contract"),
        kind: "solution-contract" as const,
        referenceId: exactReference.referenceId,
      },
      {
        digest: exactReference.digest,
        kind: "solution-contract" as const,
        referenceId: "contracts.gateway.missing",
      },
      {
        digest: exactReference.digest,
        kind: "solution-contract" as const,
        path: "application/fake.ts",
        referenceId: exactReference.referenceId,
      },
      {
        digest: exactReference.digest,
        kind: "solution-contract" as const,
        location: { endLine: 1, startLine: 1 },
        referenceId: exactReference.referenceId,
      },
    ];
    for (const reference of invalidReferences) {
      const altered = structuredClone(request);
      if (altered.generationContext?.kind !== "application") {
        throw new Error("Missing cloned application context.");
      }
      altered.sourceReferences = [reference];
      altered.generationContext.sourceReferences = [reference];
      altered.generationContextDigest = digestStructuredValue(
        altered.generationContext,
      );
      assertRequestDenied(altered, "model-gateway.ungrounded-generation-input");
    }

    const fullReplacement = structuredClone(response);
    const path = request.boundary.ownedPaths[0] ?? "application/fake.ts";
    const baseDigest =
      request.generationContext.existingFiles[0]?.contentDigest;
    if (baseDigest === undefined) {
      throw new Error("Missing user-owned base digest.");
    }
    const content = 'export const preserved = "replaced";';
    fullReplacement.candidateBundle.candidates = [
      {
        candidateId: proposalItemIdSchema.parse(
          "candidate_user_owned_replacement",
        ),
        content,
        contentDigest: sha256Text(content),
        encoding: "utf-8",
        kind: "file",
        ownership: "ai-authored-candidate",
        path,
        priorDigest: baseDigest,
      },
    ];
    const step = fullReplacement.candidateBundle.generationPlan.steps[0];
    if (step === undefined) {
      throw new Error("Missing generation-plan step.");
    }
    step.action = "replace-owned-file";
    assertDenied(
      request,
      fullReplacement,
      "model-gateway.user-owned-candidate-must-be-exact-patch",
    );

    const stalePatch = structuredClone(response);
    const candidate = stalePatch.candidateBundle.candidates[0];
    if (candidate?.kind !== "patch") {
      throw new Error("Missing patch candidate.");
    }
    candidate.baseDigest = sha256Text("stale base");
    assertDenied(
      request,
      stalePatch,
      "model-gateway.user-owned-candidate-must-be-exact-patch",
    );
  });
  it("rejects invented common and external-resource evidence references", () => {
    const summaryRequest = requestFor("summary.technical");
    assertDenied(
      summaryRequest,
      {
        contractVersion: 1,
        operation: "summary.technical",
        proposalContext: {
          ...proposalContext,
          confidence: {
            ...proposalContext.confidence,
            evidenceReferences: [
              {
                kind: "requirements-source",
                referenceId: "requirements_invented",
              },
            ],
          },
        },
        provenance,
        summary: "An ungrounded summary must be rejected.",
      },
      "model-gateway.ungrounded-evidence-reference",
    );

    const externalRequest = requestFor("external-resource.propose");
    const excerpt = externalRequest.repositoryExcerpts[0];
    if (excerpt === undefined) {
      throw new Error("External-resource repository excerpt is missing.");
    }
    const externalResponse = parseResponseFor("external-resource.propose", {
      contractVersion: 1 as const,
      operation: "external-resource.propose" as const,
      proposalContext,
      provenance,
      resources: [
        {
          candidateId: "external_candidate_security_test",
          capability: "cloudmarkup.external-capability",
          evidenceReferences: [
            {
              digest: excerpt.fileChecksum,
              kind: "repository-evidence" as const,
              location: excerpt.location,
              path: excerpt.path,
              referenceId: excerpt.evidenceId,
            },
          ],
          ownershipCandidate: "repository-defined-external-dependency" as const,
          rationale: "Bind the candidate to the exact supplied excerpt.",
        },
      ],
    });
    validateModelResponseAuthority({
      allowedApprovalPathIds: new Set(["cloudmarkup.dependency-review.v1"]),
      descriptor,
      request: externalRequest,
      response: externalResponse,
    });
    assertDenied(
      externalRequest,
      {
        ...externalResponse,
        resources: [
          {
            ...externalResponse.resources[0],
            evidenceReferences: [
              {
                digest: sha256Text("invented repository evidence"),
                kind: "repository-evidence",
                location: excerpt.location,
                path: "infrastructure/invented.tf",
                referenceId: "repository_evidence_invented",
              },
            ],
          },
        ],
      },
      "model-gateway.ungrounded-evidence-reference",
    );
  });

  it("redacts AWS secret access keys and Basic authorization despite trusted flags", () => {
    const base = requestFor("repository.interpret");
    const secretOne = "oneSecretAccessKeyValue01234567890123456789";
    const secretTwo = "twoSecretAccessKeyValue01234567890123456789";
    const basic = "dXNlcjpwYXNzd29yZA==";
    const request = parseRequestFor("repository.interpret", {
      ...base,
      evidence: [
        {
          ...base.evidence[0],
          content:
            `AWS_SECRET_ACCESS_KEY=${secretOne}\n` +
            `aws_secret_access_key: '${secretTwo}'\n` +
            `Authorization: Basic ${basic}`,
          redaction: {
            categories: [],
            noSecretValues: true as const,
            status: "not-required" as const,
          },
        },
      ],
    });

    const redacted = redactModelRequest(request);
    const serialized = JSON.stringify(redacted.request);
    expect(serialized).not.toContain(secretOne);
    expect(serialized).not.toContain(secretTwo);
    expect(serialized).not.toContain(basic);
    expect(serialized).toContain("[REDACTED:SECRET]");
    expect(serialized).toContain("[REDACTED:CREDENTIAL]");
    expect(redacted.summary.redactedValueCount).toBe(3);
    const sanitized = parseRequestFor("repository.interpret", redacted.request);
    const redactionMetadata = sanitized.evidence[0]?.redaction;
    expect(redactionMetadata).toMatchObject({
      noSecretValues: true,
      status: "applied",
    });
    expect(redactionMetadata?.categories).toEqual(
      expect.arrayContaining(["credential-candidate", "secret-candidate"]),
    );
  });

  it("preserves tagged configuration wrappers, redacts AWS session tokens, and rejects credential-shaped references", () => {
    const base = structuredClone(requestFor("operations.propose"));
    const node = base.architecture.nodes[0];
    if (node === undefined) {
      throw new Error("Typed configuration redaction node is missing.");
    }
    const password = "typed-password-value";
    const sessionToken =
      "IQoJb3JpZ2luX2VjEHgaCXVzLWVhc3QtMSJGMEQCIFakeSessionTokenValue";
    const listedSecret = "typed-list-secret-value";
    node.presentation.label = `aws_session_token="${sessionToken}"`;
    const awsSessionTokenKey = configurationKeySchema.parse("awsSessionToken");
    const passwordKey = configurationKeySchema.parse("password");
    const secretKey = configurationKeySchema.parse("secret");
    const tokenKey = configurationKeySchema.parse("token");
    node.semantic.configuration.values[awsSessionTokenKey] = {
      kind: "string",
      value: sessionToken,
    };
    node.semantic.configuration.values[passwordKey] = {
      kind: "string",
      value: password,
    };
    node.semantic.configuration.values[secretKey] =
      configurationValueSchema.parse({
        kind: "secret-reference",
        reference: "secret_session_authority",
      });
    node.semantic.configuration.values[tokenKey] = {
      kind: "string-list",
      value: [listedSecret],
    };
    const request = parseRequestFor("operations.propose", base);

    const redacted = redactModelRequest(request);
    const sanitized = modelGatewayRequestV1Schema.parse(redacted.request);
    if (sanitized.operation !== "operations.propose") {
      throw new Error("Sanitized typed configuration request is invalid.");
    }
    const sanitizedNode = sanitized.architecture.nodes[0];
    if (sanitizedNode === undefined) {
      throw new Error("Sanitized typed configuration node is missing.");
    }
    expect(sanitizedNode.semantic.configuration.values).toMatchObject({
      awsSessionToken: {
        kind: "string",
        value: "[REDACTED:SECRET]",
      },
      password: { kind: "string", value: "[REDACTED:SECRET]" },
      secret: {
        kind: "secret-reference",
        reference: "secret_session_authority",
      },
      token: {
        kind: "string-list",
        value: ["[REDACTED:SECRET]"],
      },
    });
    const serialized = JSON.stringify(sanitized);
    for (const secret of [password, sessionToken, listedSecret]) {
      expect(serialized).not.toContain(secret);
    }
    expect(redacted.summary.categories).toContain("secret-candidate");

    const rejected = structuredClone(base);
    const rejectedNode = rejected.architecture.nodes[0];
    if (rejectedNode === undefined) {
      throw new Error("Rejected typed configuration node is missing.");
    }
    rejectedNode.semantic.configuration.values[secretKey] =
      configurationValueSchema.parse({
        kind: "secret-reference",
        reference: `ghp_${"a".repeat(36)}`,
      });
    try {
      redactModelRequest(rejected);
      throw new Error(
        "Expected credential-shaped reference redaction to fail.",
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ModelGatewayValidationError);
      expect((error as ModelGatewayValidationError).code).toBe(
        "model-gateway.redaction-unsupported",
      );
    }
  });

  it("enforces dynamic question limits and stable identities across bounded collections", () => {
    const questionRequest = requestFor("requirements.blocking-questions");
    const question = {
      evidenceReferences: [],
      question: "Which exact environment is required?",
      questionId: "question_security_unique",
      rationale: "The supplied intent does not choose one.",
    };
    const questionResponse = parseResponseFor(
      "requirements.blocking-questions",
      {
        contractVersion: 1,
        operation: "requirements.blocking-questions",
        proposalContext,
        provenance,
        questions: [
          question,
          { ...question, questionId: "question_security_second" },
        ],
      },
    );
    assertDenied(
      { ...questionRequest, maximumQuestions: 1 },
      questionResponse,
      "model-gateway.question-limit-exceeded",
    );
    assertDenied(
      { ...questionRequest, maximumQuestions: 2 },
      {
        ...questionResponse,
        questions: [
          question,
          {
            ...question,
            question: "Which exact region is required?",
          },
        ],
      },
      "model-gateway.ambiguous-question-identity",
    );

    const repositoryRequest = requestFor("repository.interpret");
    const evidence = repositoryRequest.evidence[0];
    if (evidence === undefined) {
      throw new Error("Repository identity evidence fixture is missing.");
    }
    const reference = {
      digest: evidence.fileChecksum,
      kind: "repository-evidence" as const,
      location: evidence.location,
      path: evidence.path,
      referenceId: evidence.evidenceId,
    };
    const claim = {
      category: "resource" as const,
      claimId: "claim_security_unique",
      confidence: proposalContext.confidence,
      evidenceReferences: [reference],
      summary: "The exact excerpt declares one resource.",
    };
    assertDenied(
      repositoryRequest,
      {
        claims: [
          claim,
          {
            ...claim,
            summary: "A duplicate identity cannot represent another claim.",
          },
        ],
        contractVersion: 1,
        operation: "repository.interpret",
        proposalContext,
        provenance,
      },
      "model-gateway.ambiguous-repository-claim",
    );
    assertRequestDenied(
      {
        ...repositoryRequest,
        evidence: [
          evidence,
          { ...evidence, content: "Conflicting duplicate evidence." },
        ],
      },
      "model-gateway.ambiguous-request-evidence",
    );

    const externalRequest = requestFor("external-resource.propose");
    const externalCandidate = {
      candidateId: "external_candidate_security_unique",
      capability: "cloudmarkup.external-capability",
      evidenceReferences: [],
      ownershipCandidate: "unknown-unresolved" as const,
      rationale: "Exercise exact external candidate identity.",
    };
    assertDenied(
      externalRequest,
      {
        contractVersion: 1,
        operation: "external-resource.propose",
        proposalContext,
        provenance,
        resources: [
          externalCandidate,
          {
            ...externalCandidate,
            rationale:
              "A duplicate identity cannot represent another resource.",
          },
        ],
      },
      "model-gateway.ambiguous-external-resource-candidate",
    );
    const externalEvidence = externalRequest.repositoryExcerpts[0];
    if (externalEvidence === undefined) {
      throw new Error("External repository evidence fixture is missing.");
    }
    assertRequestDenied(
      {
        ...externalRequest,
        repositoryExcerpts: [externalEvidence, { ...externalEvidence }],
      },
      "model-gateway.ambiguous-request-evidence",
    );

    const summaryRequest = requestFor("summary.technical");
    const contextId = "proposal_context_security_duplicate";
    assertDenied(
      summaryRequest,
      {
        contractVersion: 1,
        operation: "summary.technical",
        proposalContext: {
          assumptions: [
            {
              assumptionId: contextId,
              confidence: proposalContext.confidence,
              statement: "One bounded assumption.",
            },
          ],
          confidence: proposalContext.confidence,
          unknowns: [
            {
              blocking: true,
              confidence: proposalContext.confidence,
              question: "One bounded unknown?",
              unknownId: contextId,
            },
          ],
        },
        provenance,
        summary: "A duplicate proposal-context identity is ambiguous.",
      },
      "model-gateway.ambiguous-proposal-context-identity",
    );
  });

  it("rejects ungrounded workload owners and source references", () => {
    const request = requestFor("workload.propose");
    const baseResponse = {
      contractVersion: 1 as const,
      operation: "workload.propose" as const,
      proposalContext,
      provenance,
      workloads: [
        {
          candidateId: "workload_candidate_security_test",
          implementationMode: "infrastructure-only" as const,
          owningNodeId: request.architecture.nodes[0]?.id ?? "node_missing",
          responsibilities: ["Exercise workload grounding."],
          sourceReferences: [],
        },
      ],
    };

    assertDenied(
      request,
      {
        ...baseResponse,
        workloads: [
          {
            ...baseResponse.workloads[0],
            owningNodeId: "node_invented",
          },
        ],
      },
      "model-gateway.ungrounded-workload-owner",
    );
    assertDenied(
      request,
      {
        ...baseResponse,
        workloads: [
          {
            ...baseResponse.workloads[0],
            sourceReferences: [
              {
                kind: "architecture-node",
                referenceId: "node_invented",
              },
            ],
          },
        ],
      },
      "model-gateway.ungrounded-workload-source",
    );
    if (request.solutionRevision === undefined) {
      throw new Error("Workload fixture must include a Solution Revision.");
    }
    assertDenied(
      {
        ...request,
        solutionRevision: {
          ...request.solutionRevision,
          architecture: {
            ...request.solutionRevision.architecture,
            documentHash: TEST_DIGEST,
          },
        },
      },
      {
        ...baseResponse,
        workloads: [
          {
            ...baseResponse.workloads[0],
            sourceReferences: [
              {
                kind: "architecture-node",
                referenceId:
                  request.architecture.nodes[0]?.id ?? "node_missing",
              },
            ],
          },
        ],
      },
      "model-gateway.ungrounded-workload-revision",
    );
  });

  it("accepts only exact frozen workload evidence, issues, and digest-bound external resources", () => {
    const base = requestFor("workload.propose");
    if (base.solutionRevision === undefined) {
      throw new Error("Workload fixture must include a Solution Revision.");
    }
    const architecture = structuredClone(base.architecture);
    architecture.externalResources.resources.push(
      externalResourceV1Schema.parse({
        addresses: [],
        architectureNodeIds: [],
        availability: { assumption: "unknown" },
        capability: "example.external.dependency",
        dataClassifications: [],
        displayName: "External dependency",
        evidence: [],
        extractedCandidates: [],
        id: "external_resource_security_test",
        interfaces: [],
        lifecycle: {
          behavior: {
            create: "forbidden",
            dataSource: "unresolved",
            import: "unresolved",
            reference: "unresolved",
          },
          iacTargets: [],
          lifecycleAuthority: "unresolved",
          ownershipState: "unknown-unresolved",
        },
        provider: {
          reason: "The exact provider remains unresolved.",
          state: "unknown",
        },
        scope: {},
        trustBoundary: "unknown",
        unresolvedInformation: [],
      }),
    );
    const architectureHashes = getArchitectureDocumentHashes(architecture);
    const request = parseRequestFor("workload.propose", {
      ...base,
      architecture,
      solutionRevision: {
        ...base.solutionRevision,
        architecture: {
          ...base.solutionRevision.architecture,
          contentHash: architectureHashes.contentHash,
          documentHash: getArchitectureDocumentCanonicalHash(architecture),
          visualHash: architectureHashes.visualHash,
        },
        evidenceIdsAtFreeze: ["evidence_frozen_security_test"],
        externalResources: {
          ...base.solutionRevision.externalResources,
          contentHash: getExternalResourceReferenceContentHash(
            architecture.externalResources,
          ),
        },
        issueIdsAtFreeze: ["issue_frozen_security_test"],
      },
    });
    if (request.solutionRevision === undefined) {
      throw new Error(
        "Parsed workload fixture must include a Solution Revision.",
      );
    }
    const exactReferences = [
      {
        kind: "evidence-record" as const,
        referenceId: "evidence_frozen_security_test",
      },
      {
        kind: "active-issue" as const,
        referenceId: "issue_frozen_security_test",
      },
      {
        digest: request.solutionRevision.externalResources.contentHash,
        kind: "external-resource" as const,
        referenceId: "external_resource_security_test",
      },
    ];
    const response = parseResponseFor("workload.propose", {
      contractVersion: 1 as const,
      operation: "workload.propose" as const,
      proposalContext,
      provenance,
      workloads: [
        {
          candidateId: "workload_candidate_frozen_evidence_test",
          implementationMode: "infrastructure-only" as const,
          owningNodeId: architecture.nodes[0]?.id ?? "node_missing",
          responsibilities: ["Exercise frozen revision evidence authority."],
          sourceReferences: exactReferences,
        },
      ],
    });
    expect(() => {
      validateModelResponseAuthority({
        allowedApprovalPathIds: new Set(["cloudmarkup.dependency-review.v1"]),
        descriptor,
        request,
        response,
      });
    }).not.toThrow();

    for (const [index, reference] of exactReferences.entries()) {
      assertDenied(
        request,
        {
          ...response,
          workloads: [
            {
              ...response.workloads[0],
              sourceReferences: [
                { ...reference, referenceId: `invented_${String(index)}` },
              ],
            },
          ],
        },
        "model-gateway.ungrounded-workload-source",
      );
    }
  });

  it("accepts exact Prompt 36A context and grounds candidate metadata", () => {
    const request = contextualIacRequest();
    const response = generationResponse(request);

    expect(() => {
      validateModelRequestAuthority(request);
    }).not.toThrow();
    expect(() => {
      validateModelResponseAuthority({
        allowedApprovalPathIds: new Set(["cloudmarkup.dependency-review.v1"]),
        descriptor,
        request,
        response,
      });
    }).not.toThrow();
    expect(response.candidateBundle.unresolvedItems?.[0]?.blocking).toBe(true);
    expect(response.candidateBundle.expectedTests).toHaveLength(1);

    const legacy = requestFor("iac-extension.generate");
    expect(legacy.generationContext).toBeUndefined();
    expect(() => {
      validateModelRequestAuthority(legacy);
    }).not.toThrow();
  });

  it("requires explicit ai-assisted-custom authority for application context", () => {
    const application = structuredClone(
      requestFor("application-source.generate"),
    );
    const iac = testIacGenerationRequestWithContext();
    if (iac.generationContext?.kind !== "iac-extension") {
      throw new Error("Missing IaC context source fixture.");
    }
    const { extensionSlotId, targetFormat, ...common } = structuredClone(
      iac.generationContext,
    );
    expect(extensionSlotId).toBe("slot_terraform_extension_test");
    expect(targetFormat).toBe("terraform");
    const extensionId = "extension_application_context_test";
    application.solutionRevision.sourceOwnership =
      application.solutionRevision.sourceOwnership.map((entry) =>
        entry.path === "application/fake.ts"
          ? {
              ...entry,
              conflictBehavior: "semantic-diff-and-review" as const,
              ownerId: extensionId,
              ownership: "ai-authored" as const,
            }
          : entry,
      );
    application.sourceOwnershipAuthority.sourceOwnership =
      application.solutionRevision.sourceOwnership.filter(
        (entry) => entry.path === "application/fake.ts",
      );
    const generationContext = {
      ...common,
      allowedProviders: [],
      allowedResources: [],
      extensionId,
      extensionPointId: "extension.application-handler",
      kind: "application" as const,
      language: "language.typescript",
      ownedPaths: application.boundary.ownedPaths,
      ownedResourceAddresses: [],
      protectedPaths: ["infrastructure/fake.tf"],
      protectedResourceAddresses: [],
      requestedBehavior: {
        acceptanceCriteria: application.acceptanceCriteria,
        objective: "Generate explicit custom application behavior.",
        requirements: ["Remain inside the Workload extension point."],
      },
      runtimeFamily: "example.runtime.nodejs",
      sourceReferences: application.sourceReferences,
      validationExpectations: application.validationExpectations,
      workloadId: application.workloadId,
    };
    const parsed = parseRequestFor("application-source.generate", {
      ...application,
      generationContext,
      generationContextDigest: digestStructuredValue(generationContext),
    });

    assertRequestDenied(parsed, "model-gateway.ungrounded-generation-input");
  });

  it("rejects altered context and ungrounded candidate metadata", () => {
    const request = contextualIacRequest();
    assertRequestDenied(
      {
        ...request,
        generationContextDigest: sha256Text("altered generation context"),
      },
      "model-gateway.ungrounded-generation-input",
    );

    if (request.generationContext === undefined) {
      throw new Error("Missing Prompt 36A generation context fixture.");
    }
    const ungroundedProtectedPath = structuredClone(request);
    if (ungroundedProtectedPath.generationContext === undefined) {
      throw new Error("Missing cloned generation context fixture.");
    }
    ungroundedProtectedPath.generationContext.protectedPaths = [
      "application/not-in-revision.ts",
    ];
    ungroundedProtectedPath.generationContextDigest = digestStructuredValue(
      ungroundedProtectedPath.generationContext,
    );
    assertRequestDenied(
      ungroundedProtectedPath,
      "model-gateway.ungrounded-generation-input",
    );
    const protectedExistingFile = structuredClone(request);
    if (protectedExistingFile.generationContext === undefined) {
      throw new Error("Missing cloned generation context fixture.");
    }
    const protectedContent = "protected deterministic content";
    protectedExistingFile.generationContext.existingFiles = [
      {
        content: protectedContent,
        contentDigest: sha256Text(protectedContent),
        noSecretValues: true,
        ownership: "generated",
        path: "application/fake.ts",
        redactionStatus: "not-required",
        sizeBytes: protectedContent.length,
      },
    ];
    protectedExistingFile.generationContextDigest = digestStructuredValue(
      protectedExistingFile.generationContext,
    );
    assertRequestDenied(
      protectedExistingFile,
      "model-gateway.ungrounded-generation-input",
    );

    const response = generationResponse(request);
    const ungroundedAssumption = structuredClone(response);
    const assumption = ungroundedAssumption.candidateBundle.assumptions?.[0];
    if (assumption === undefined) {
      throw new Error("Missing candidate assumption fixture.");
    }
    assumption.sourceReferences[0] = {
      kind: "architecture-node",
      referenceId: "node_invented",
    };
    assertDenied(
      request,
      ungroundedAssumption,
      "model-gateway.ungrounded-candidate-context",
    );

    const ungroundedTest = structuredClone(response);
    const expectedTest = ungroundedTest.candidateBundle.expectedTests?.[0];
    if (expectedTest === undefined) {
      throw new Error("Missing expected test fixture.");
    }
    expectedTest.targetPaths = ["infrastructure/not-generated.tf"];
    assertDenied(
      request,
      ungroundedTest,
      "model-gateway.ungrounded-expected-test",
    );
  });

  it("rebinds repair to exact context and preserves blocking unresolved items", () => {
    const generationRequest = contextualIacRequest();
    const generated = generationResponse(generationRequest).candidateBundle;
    const failedCandidates = generated.candidates;
    const candidate = failedCandidates[0];
    if (
      candidate === undefined ||
      generationRequest.generationContext === undefined ||
      generationRequest.generationContextDigest === undefined
    ) {
      throw new Error("Missing repair generation-context fixture.");
    }
    const priorContent = {
      assumptions: generated.assumptions ?? [],
      expectedTests: generated.expectedTests ?? [],
      unresolvedItems: generated.unresolvedItems ?? [],
    };
    const repair = parseRequestFor("candidate.repair", {
      ...requestFor("candidate.repair"),
      boundary: generationRequest.boundary,
      diagnostics: [
        {
          candidateId: candidate.candidateId,
          checkKind: "parse",
          diagnosticId: "diagnostic_test",
          message: "The bounded extension did not parse.",
          noSecretValues: true,
          path: candidate.path,
          redactionStatus: "not-required",
          toolId: "cloudmarkup.test-parser",
          toolVersion: "1.0.0",
        },
      ],
      failedCandidates,
      failedOutputDigest: digestStructuredValue(failedCandidates),
      generationContext: generationRequest.generationContext,
      generationContextDigest: generationRequest.generationContextDigest,
      priorCandidateContext: {
        ...priorContent,
        contextDigest: digestStructuredValue(priorContent),
      },
      validationExpectations: generationRequest.validationExpectations,
    });
    expect(() => {
      validateModelRequestAuthority(repair);
    }).not.toThrow();
    const protectedRepair = structuredClone(repair);
    if (protectedRepair.generationContext === undefined) {
      throw new Error("Missing cloned repair generation context fixture.");
    }
    const protectedContent = "protected deterministic content";
    protectedRepair.generationContext.existingFiles = [
      {
        content: protectedContent,
        contentDigest: sha256Text(protectedContent),
        noSecretValues: true,
        ownership: "generated",
        path: "application/fake.ts",
        redactionStatus: "not-required",
        sizeBytes: protectedContent.length,
      },
    ];
    protectedRepair.generationContextDigest = digestStructuredValue(
      protectedRepair.generationContext,
    );
    assertRequestDenied(
      protectedRepair,
      "model-gateway.ungrounded-repair-generation-context",
    );

    const response = repairResponse(repair);
    expect(() => {
      validateModelResponseAuthority({
        allowedApprovalPathIds: new Set(["cloudmarkup.dependency-review.v1"]),
        descriptor,
        request: repair,
        response,
      });
    }).not.toThrow();

    const hiddenBlockingQuestion = structuredClone(response);
    hiddenBlockingQuestion.candidateBundle.unresolvedItems = [];
    assertDenied(
      repair,
      hiddenBlockingQuestion,
      "model-gateway.repair-candidate-context-changed",
    );
  });

  it("rejects candidate-plan paths that do not rejoin", () => {
    const base = requestFor("candidate.repair");
    const request = parseRequestFor("candidate.repair", {
      ...base,
      boundary: {
        ...base.boundary,
        ownedPaths: ["application/fake.ts", "application/other.ts"],
      },
    });
    assertDenied(
      request,
      repairResponse(request, { planPath: "application/other.ts" }),
      "model-gateway.plan-candidate-path-mismatch",
    );
  });

  it("rejects diagnostics detached from failed candidates and invented resolutions", () => {
    const base = requestFor("candidate.repair");
    const detached = parseRequestFor("candidate.repair", {
      ...base,
      boundary: {
        ...base.boundary,
        ownedPaths: ["application/fake.ts", "application/other.ts"],
      },
      diagnostics: [
        {
          ...base.diagnostics[0],
          path: "application/other.ts",
        },
      ],
    });
    assertDenied(
      detached,
      repairResponse(detached),
      "model-gateway.ungrounded-repair-diagnostic",
    );
    assertDenied(
      base,
      repairResponse(base, {
        resolvedDiagnosticIds: ["diagnostic_invented"],
      }),
      "model-gateway.ungrounded-repair-diagnostic",
    );
  });
});
