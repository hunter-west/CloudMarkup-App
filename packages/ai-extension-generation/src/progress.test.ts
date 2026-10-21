import { readFileSync } from "node:fs";

import {
  architectureDocumentV3Schema,
  evidenceRecordV1Schema,
  modelCandidateBundleV1Schema,
  modelCandidateRepairResponseV1Schema,
  modelIacExtensionGenerationRequestV1Schema,
  modelIacExtensionGenerationResponseV1Schema,
  modelInvocationDescriptorV1Schema,
  normalizedModelUsageV1Schema,
  solutionRevisionManifestV1Schema,
  solutionRevisionIdSchema,
  type ModelCandidateBundleV1,
  type ModelGatewayOperationV1,
} from "@cloudmarkup/schemas";
import type {
  ModelGatewayInvocationContextV1,
  ModelGatewayResultV1,
  ModelRequestFor,
} from "@cloudmarkup/model-gateway";
import { describe, expect, it } from "vitest";

import {
  candidateTargetValidationResultV1Schema,
  type CandidateTargetValidationInput,
  type CandidateTargetValidationPort,
} from "./validation.js";
import {
  candidateExtensionAuthorityV1Schema,
  candidateGenerationProgressPrefixV1Schema,
  candidateGenerationProgressSnapshotV1Schema,
  candidateGenerationProgressStreamV1Schema,
  getCandidateGenerationProgressPrefixDigest,
  createAiExtensionGenerationCoordinator,
  type CandidateGenerationProgressPort,
  type CandidateGenerationProgressSnapshotV1,
  type CandidateModelGateway,
  type CustomCandidateGenerationInputV1,
} from "./service.js";
import {
  digestCanonicalValue,
  sha256Text,
  stableRecordId,
} from "./security.js";
import { candidateReviewRecordV1Schema } from "./contracts.js";
import { InMemoryCandidateArtifactStore } from "./testing.js";

const assessedAt = "2026-08-22T12:00:00.000Z";
const promptDigest = sha256Text("reviewed progress prompt");
const solutionRevisionId = solutionRevisionIdSchema.parse(
  "solution-revision-progress-1",
);
const extensionId = "cloudmarkup.extension-progress";
const path = "infrastructure/extensions/progress.tf";
const scope = {
  organizationId: "organization-progress",
  projectId: "project-progress",
} as const;

function redigestProgressSnapshot(
  snapshot: CandidateGenerationProgressSnapshotV1,
  changes: Readonly<Record<string, unknown>>,
): unknown {
  const projection: Record<string, unknown> = {
    ...structuredClone(snapshot),
    ...changes,
  };
  delete projection["snapshotDigest"];
  return {
    ...projection,
    snapshotDigest: digestCanonicalValue(projection),
  };
}

const architecture = architectureDocumentV3Schema.parse(
  JSON.parse(
    readFileSync(
      new URL(
        "../../test-fixtures/fixtures/architecture-document/v3/valid/representative.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as unknown,
);

const notApplicableVersion = {
  reason: "The progress fixture does not invoke this deterministic tool.",
  state: "not-applicable",
} as const;

function generationFixture() {
  const revisionDigest = sha256Text("progress-solution-revision");
  const revision = solutionRevisionManifestV1Schema.parse({
    aiExtensionIds: [],
    architecture: {
      contentHash: revisionDigest,
      documentHash: revisionDigest,
      documentKind: "cloudmarkup.architecture-document",
      revisionId: architecture.revision.revisionId,
      schemaVersion: 3,
      visualHash: sha256Text("progress-solution-visual"),
    },
    assumptions: [],
    contractVersion: 1,
    contracts: {
      contentHash: sha256Text("progress-contracts"),
      contractVersion: 1,
      recordHashes: [],
    },
    createdAt: assessedAt,
    createdBy: "actor-progress",
    evidenceIdsAtFreeze: [],
    externalResources: {
      contentHash: sha256Text("progress-external-resources"),
      contractVersion: 1,
    },
    generationCoverage: {
      contractVersion: 1,
      evidence: [],
      missingRequirements: [],
      solutionRevisionId,
      state: "infrastructure-only",
      workloads: [],
    },
    intent: {
      reason: "Intent is independently reviewed for this fixture.",
      state: "not-applicable",
    },
    issueIdsAtFreeze: [],
    kind: "cloudmarkup.solution-revision-manifest",
    repositoryObservations: [],
    solutionRevisionId,
    sourceOwnership: [
      {
        conflictBehavior: "semantic-diff-and-review",
        ownerId: extensionId,
        ownership: "ai-authored",
        path,
      },
    ],
    unresolvedDecisionIds: [],
    versions: {
      applicationGenerator: notApplicableVersion,
      catalog: architecture.catalog,
      compiler: notApplicableVersion,
      diagramRenderer: notApplicableVersion,
      importer: notApplicableVersion,
      modelPrompt: {
        state: "pinned",
        tool: { id: "cloudmarkup.prompt-extension", version: "1.0.0" },
      },
      policy: [],
    },
    workload: {
      contentHash: sha256Text("progress-workload"),
      contractVersion: 2,
    },
  });
  const catalogContent = JSON.stringify({
    catalog: architecture.catalog,
    entries: architecture.nodes.map(({ semantic }) => ({
      resourceType: semantic.resourceType,
      serviceType: semantic.serviceType,
    })),
  });
  const schemaDocument = JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    properties: {},
    type: "object",
  });
  const validationExpectations = [
    {
      checkId: "extension.parse",
      kind: "parse",
      required: true,
      successCondition: "must-pass",
      toolProfileId: "cloudmarkup.extension-parser",
    },
    {
      checkId: "extension.static-analysis",
      kind: "static-analysis",
      required: true,
      successCondition: "must-pass",
      toolProfileId: "cloudmarkup.extension-static",
    },
    {
      checkId: "extension.security",
      kind: "security",
      required: true,
      successCondition: "must-pass",
      toolProfileId: "cloudmarkup.extension-security",
    },
  ] as const;
  const sourceReference = {
    kind: "architecture-node" as const,
    referenceId: "node_worker",
  };
  const generationContext = {
    allowedDependencies: [],
    allowedProviders: [
      {
        providerId: "provider.hashicorp-aws",
        source: "hashicorp/aws",
        versionConstraint: ">= 6.55.0, < 7.0.0",
      },
    ],
    allowedResources: [
      {
        providerId: "provider.hashicorp-aws",
        resourceType: "aws_cloudwatch_log_group",
      },
    ],
    catalogSlice: {
      catalog: architecture.catalog,
      content: catalogContent,
      entries: architecture.nodes.map(({ semantic }) => ({
        resourceType: semantic.resourceType,
        serviceType: semantic.serviceType,
      })),
      sliceDigest: sha256Text(catalogContent),
    },
    existingFiles: [],
    extensionId,
    extensionSlotId: "terraform-extension-slot-progress",
    kind: "iac-extension" as const,
    language: "language.hcl" as const,
    limits: {
      maximumCandidateFileBytes: 16_384,
      maximumCandidateFiles: 1,
      maximumCandidateTotalBytes: 32_768,
      maximumDependencyRequests: 0,
      maximumExpectedTests: 0,
      maximumRepairAttempts: 1,
      maximumResourceCount: 4,
    },
    officialSchemas: [
      {
        document: schemaDocument,
        schemaDigest: sha256Text(schemaDocument),
        schemaId: "schema.iac-extension",
        schemaVersion: "1.0.0",
      },
    ],
    ownedPaths: [path],
    ownedResourceAddresses: ["aws_cloudwatch_log_group.progress"],
    protectedPaths: ["infrastructure/generated/main.tf"],
    protectedResourceAddresses: ["aws_lambda_function.canonical-worker"],
    requestedBehavior: {
      acceptanceCriteria: ["The candidate remains review-only."],
      objective: "Generate one bounded progress-test extension.",
      requirements: ["Preserve deterministic compiler resources."],
    },
    runtimeFamily: "runtime.iac-extension",
    sourceReferences: [sourceReference],
    targetFormat: "terraform" as const,
    validationExpectations,
  };
  const request = modelIacExtensionGenerationRequestV1Schema.parse({
    acceptanceCriteria: generationContext.requestedBehavior.acceptanceCriteria,
    architecture,
    boundary: {
      approvalPathIds: ["extension.iac"],
      boundaryId: extensionId,
      ownedPaths: [path],
      writeAuthority: "candidate-artifacts-only",
    },
    contractVersion: 1,
    generationContext,
    generationContextDigest: digestCanonicalValue(generationContext),
    operation: "iac-extension.generate",
    requestedMode: "guided",
    solutionRevision: revision,
    sourceOwnershipAuthority: {
      authority: "solution-revision-candidate-generation",
      candidateRoots: ["infrastructure"],
      canonicalization:
        "cloudmarkup.solution-source-ownership.canonical-json.v1",
      ownedPaths: [path],
      solutionRevisionId,
      sourceOwnership: revision.sourceOwnership,
    },
    sourceReferences: [sourceReference],
    targetFormat: "terraform",
    validationExpectations,
  });
  const extension = candidateExtensionAuthorityV1Schema.parse({
    id: extensionId,
    ownedPaths: [{ conflictPolicy: "fail", path }],
    regenerationPolicy: "replace-owned-exact",
    request: {
      acceptanceCriteria: ["The candidate remains review-only."],
      capabilityIds: ["infrastructure.progress-extension"],
      constraints: ["Preserve deterministic compiler resources."],
      objective: "Generate one bounded progress-test extension.",
      prohibitedCapabilities: ["deployment.execute"],
    },
    reservationId: "reservation-progress-1",
    sourceReferences: [{ kind: "architecture-node", nodeId: "node_worker" }],
    target: {
      extensionSlotId: generationContext.extensionSlotId,
      fileType: "infrastructure.hcl",
      kind: "iac-extension",
      language: "language.hcl",
      targetFormat: "terraform",
    },
  });
  return { extension, request };
}

function candidateBundle(
  request: ReturnType<typeof generationFixture>["request"],
  content: string,
  priorDigest?: ReturnType<typeof sha256Text>,
): ModelCandidateBundleV1 {
  return modelCandidateBundleV1Schema.parse({
    assumptions: [],
    boundary: request.boundary,
    candidates: [
      {
        candidateId: "candidate-progress",
        content,
        contentDigest: sha256Text(content),
        encoding: "utf-8",
        kind: "file",
        ownership: "ai-authored-candidate",
        path,
        ...(priorDigest === undefined ? {} : { priorDigest }),
      },
    ],
    dependencies: [],
    expectedTests: [],
    generationPlan: {
      objective: "Create only the exact candidate-owned extension file.",
      planId: "candidate-generation-progress-plan",
      steps: [
        {
          action:
            priorDigest === undefined ? "create-file" : "replace-owned-file",
          rationale: "Implement the reviewed bounded behavior.",
          sourceReferences: request.sourceReferences,
          stepId: "candidate-progress-step",
          targetPath: path,
        },
      ],
    },
    provenance: {
      contractVersion: 1,
      gatewayId: "cloudmarkup.model-gateway",
      inputDigest: sha256Text("unbound-progress-input"),
      invocationId: "unbound-progress-invocation",
      modelId: "model.fixture",
      modelVersion: "2026-08-22",
      ownership: "untrusted-proposal",
      promptDigest,
      promptTemplateId: "cloudmarkup.prompt-extension",
      promptVersion: "1.0.0",
      providerId: "provider.fixture",
    },
    unresolvedItems: [],
    validationExpectations: request.validationExpectations,
  });
}

function invocationContext(
  request: ReturnType<typeof generationFixture>["request"],
  invocationId: string,
): ModelGatewayInvocationContextV1 {
  return {
    budget: {
      acceptedEstimateMaximumCreditUnits: 20,
      allowed: true,
      availableCreditUnits: 100,
      decisionId: "budget-decision-progress",
      estimateAccepted: true,
      maximumCostTier: "deep",
    },
    complexity: "deep",
    entitlement: {
      allowed: true,
      allowedRoles: [
        "deep-architecture-custom-generation",
        "repair-escalation",
      ],
      decisionId: "entitlement-decision-progress",
      planKey: "pro",
      planVersionId: "plan-version-progress",
    },
    evaluationPolicyId: "cloudmarkup.model-evaluation",
    evaluationPolicyVersion: "1.0.0",
    idempotencyKeyDigest: sha256Text(`idempotency:${invocationId}`),
    invocationId,
    requestedMode: request.requestedMode,
    scope: {
      ...scope,
      solutionRevisionId,
      userId: "user-progress",
    },
  };
}

function descriptor(
  operation: ModelGatewayOperationV1,
  request: object,
  context: ModelGatewayInvocationContextV1,
) {
  const inputDigest = digestCanonicalValue({ request, scope: context.scope });
  const digest = sha256Text("progress-routing-authority");
  return modelInvocationDescriptorV1Schema.parse({
    budgetDecisionId: context.budget.decisionId,
    complexity: context.complexity,
    contractVersion: 1,
    entitlementDecisionId: context.entitlement.decisionId,
    evaluationPolicyId: context.evaluationPolicyId,
    evaluationPolicyVersion: context.evaluationPolicyVersion,
    feature: operation,
    idempotencyKeyDigest: context.idempotencyKeyDigest,
    inputDigest,
    invocationId: context.invocationId,
    modelId: "model.fixture",
    modelVersion: "2026-08-22",
    promptDigest,
    promptTemplateId: "cloudmarkup.prompt-extension",
    promptVersion: "1.0.0",
    providerFamily: "deterministic-fake",
    providerId: "provider.fixture",
    requestedMode: context.requestedMode,
    role:
      operation === "candidate.repair"
        ? "repair-escalation"
        : "deep-architecture-custom-generation",
    routing: {
      acceptedMaximumCreditUnits:
        context.budget.acceptedEstimateMaximumCreditUnits,
      capabilityRegistryDigest: digest,
      capabilityRegistryId: "cloudmarkup.model-capabilities",
      capabilityRegistryVersion: "1.0.0",
      capabilityVersion: "1.0.0",
      effort: "high",
      evaluationPolicyId: context.evaluationPolicyId,
      evaluationPolicyVersion: context.evaluationPolicyVersion,
      evaluationResultDigest: digest,
      evaluationResultVersion: "1.0.0",
      modelCapabilityDigest: digest,
      modelConfigurationReference: "cloudmarkup.model-configuration",
      modelFamily: "model.fixture-family",
      pricingVersionReference: "cloudmarkup.model-pricing",
      routeDefinitionDigest: digest,
      routeId: "deep-design",
      routeRegistryDigest: digest,
      routeRegistryId: "cloudmarkup.model-routes",
      routeRegistryVersion: "1.0.0",
      routingConfigurationDigest: digest,
      routingDecisionDigest: digest,
    },
    scope: context.scope,
    toolAuthority: "none",
  });
}

function usage(
  operation: ModelGatewayOperationV1,
  context: ModelGatewayInvocationContextV1,
  invocationDescriptor: ReturnType<typeof descriptor>,
) {
  return normalizedModelUsageV1Schema.parse({
    attemptNumber: 1,
    cacheReadUnits: "0",
    cacheWriteUnits: "0",
    completedAt: "2026-08-22T12:00:01.000Z",
    contractVersion: 1,
    durationMilliseconds: 1_000,
    feature: operation,
    idempotencyKeyDigest: context.idempotencyKeyDigest,
    inputDigest: invocationDescriptor.inputDigest,
    inputUnits: "10",
    invocationId: context.invocationId,
    modelId: invocationDescriptor.modelId,
    modelVersion: invocationDescriptor.modelVersion,
    outputUnits: "10",
    promptTemplateId: invocationDescriptor.promptTemplateId,
    promptVersion: invocationDescriptor.promptVersion,
    providerId: invocationDescriptor.providerId,
    result: "succeeded",
    routing: invocationDescriptor.routing,
    scope: context.scope,
    startedAt: assessedAt,
    thinkingUnits: "0",
    usageRecordId: stableRecordId("usage-progress", {
      invocationId: context.invocationId,
      operation,
    }),
  });
}

function boundBundle(
  bundle: ModelCandidateBundleV1,
  invocationDescriptor: ReturnType<typeof descriptor>,
) {
  return modelCandidateBundleV1Schema.parse({
    ...bundle,
    provenance: {
      contractVersion: 1,
      gatewayId: "cloudmarkup.model-gateway",
      inputDigest: invocationDescriptor.inputDigest,
      invocationId: invocationDescriptor.invocationId,
      modelId: invocationDescriptor.modelId,
      modelVersion: invocationDescriptor.modelVersion,
      ownership: "untrusted-proposal",
      promptDigest: invocationDescriptor.promptDigest,
      promptTemplateId: invocationDescriptor.promptTemplateId,
      promptVersion: invocationDescriptor.promptVersion,
      providerId: invocationDescriptor.providerId,
    },
  });
}

function proposalContext(request: {
  readonly generationContext?:
    { readonly sourceReferences?: readonly unknown[] | undefined } | undefined;
  readonly sourceReferences?: readonly unknown[] | undefined;
}) {
  return {
    assumptions: [],
    confidence: {
      basisPoints: 10_000,
      evidenceReferences:
        request.sourceReferences ??
        request.generationContext?.sourceReferences ??
        [],
      rationale: "The deterministic fixture binds the supplied authority.",
    },
    unknowns: [],
  };
}

function provenance(invocationDescriptor: ReturnType<typeof descriptor>) {
  return {
    contractVersion: 1,
    gatewayId: "cloudmarkup.model-gateway",
    inputDigest: invocationDescriptor.inputDigest,
    invocationId: invocationDescriptor.invocationId,
    modelId: invocationDescriptor.modelId,
    modelVersion: invocationDescriptor.modelVersion,
    ownership: "untrusted-proposal",
    promptDigest: invocationDescriptor.promptDigest,
    promptTemplateId: invocationDescriptor.promptTemplateId,
    promptVersion: invocationDescriptor.promptVersion,
    providerId: invocationDescriptor.providerId,
  } as const;
}

function generationResult(
  request: ModelRequestFor<"iac-extension.generate">,
  context: ModelGatewayInvocationContextV1,
  bundle: ModelCandidateBundleV1,
): ModelGatewayResultV1<"iac-extension.generate"> {
  const invocationDescriptor = descriptor(request.operation, request, context);
  return {
    descriptor: invocationDescriptor,
    redaction: { categories: [], redactedValueCount: 0 },
    response: modelIacExtensionGenerationResponseV1Schema.parse({
      candidateBundle: boundBundle(bundle, invocationDescriptor),
      contractVersion: 1,
      operation: request.operation,
      proposalContext: proposalContext(request),
      provenance: provenance(invocationDescriptor),
    }),
    usage: usage(request.operation, context, invocationDescriptor),
  };
}

function repairResult(
  request: ModelRequestFor<"candidate.repair">,
  context: ModelGatewayInvocationContextV1,
  bundle: ModelCandidateBundleV1,
): ModelGatewayResultV1<"candidate.repair"> {
  const invocationDescriptor = descriptor(request.operation, request, context);
  return {
    descriptor: invocationDescriptor,
    redaction: { categories: [], redactedValueCount: 0 },
    response: modelCandidateRepairResponseV1Schema.parse({
      candidateBundle: boundBundle(bundle, invocationDescriptor),
      contractVersion: 1,
      operation: request.operation,
      proposalContext: proposalContext(request),
      provenance: provenance(invocationDescriptor),
      repairedFromDigest: request.failedOutputDigest,
      resolvedDiagnosticIds: request.diagnostics.map(
        ({ diagnosticId }) => diagnosticId,
      ),
    }),
    usage: usage(request.operation, context, invocationDescriptor),
  };
}

class RepairGateway implements CandidateModelGateway {
  private readonly generationBundle: ModelCandidateBundleV1;
  private readonly repairedBundle: ModelCandidateBundleV1;

  public constructor(
    generationBundle: ModelCandidateBundleV1,
    repairedBundle: ModelCandidateBundleV1,
  ) {
    this.generationBundle = generationBundle;
    this.repairedBundle = repairedBundle;
  }

  public generateApplicationSourceCandidate(): Promise<never> {
    return Promise.reject(new Error("Unexpected application generation."));
  }

  public generateIacExtensionCandidate(
    request: ModelRequestFor<"iac-extension.generate">,
    context: ModelGatewayInvocationContextV1,
  ) {
    return Promise.resolve(
      generationResult(request, context, this.generationBundle),
    );
  }

  public repairCandidate(
    request: ModelRequestFor<"candidate.repair">,
    context: ModelGatewayInvocationContextV1,
  ) {
    return Promise.resolve(repairResult(request, context, this.repairedBundle));
  }
}

class PassingValidator implements CandidateTargetValidationPort {
  public validate(input: CandidateTargetValidationInput) {
    const evidence = evidenceRecordV1Schema.parse({
      artifacts: [
        {
          digest: input.artifact.artifactDigest,
          mediaType:
            "application/vnd.cloudmarkup.ai-extension-candidate.v1+json",
          sizeBytes: input.files.reduce(
            (total, file) => total + file.sizeBytes,
            0,
          ),
        },
      ],
      checks: [
        {
          artifactDigests: [input.artifact.artifactDigest],
          checkId: "cloudmarkup.ai-extension-parse-static",
          generationCoverageRequirement: "ai-extension-parse-static-validity",
          issueIds: [],
          status: "passed",
          summary: "The deterministic target fixture passed.",
        },
      ],
      contractVersion: 1,
      environment: { environmentType: "test" },
      id: stableRecordId("evidence-progress-target", {
        artifactDigest: input.artifact.artifactDigest,
      }),
      layer: "generated",
      level: { kind: "ai-extension-parse-static-validity", rank: 4 },
      models: [
        {
          modelId: input.descriptor.modelId,
          modelVersion: input.descriptor.modelVersion,
          promptVersion: input.descriptor.promptVersion,
          providerId: input.descriptor.providerId,
        },
      ],
      provenance: {
        actor: {
          kind: "deterministic-tool",
          tool: { id: "cloudmarkup.progress-validator", version: "1.0.0" },
        },
        createdAt: input.assessedAt,
        inputDigests: [
          input.artifact.artifactDigest,
          input.artifact.bundleDigest,
        ],
      },
      solutionRevisionId: input.solutionRevision.solutionRevisionId,
      staleness: { assessedAt: input.assessedAt, state: "current" },
      tools: [{ id: "cloudmarkup.progress-validator", version: "1.0.0" }],
    });
    return Promise.resolve(
      candidateTargetValidationResultV1Schema.parse({
        diagnostics: [],
        evidence: [evidence],
        outcomes: input.generationContext.validationExpectations.map(
          ({ kind }) => ({ kind, result: "passed", toolVersion: "1.0.0" }),
        ),
        representationDigest: digestCanonicalValue(
          input.files.map(({ digest, path: filePath }) => ({
            digest,
            path: filePath,
          })),
        ),
        state: "passed",
      }),
    );
  }
}

describe("AI extension generation progress", () => {
  it("awaits bounded issue snapshots in exact generation, validation, and repair order", async () => {
    const fixture = generationFixture();
    const invalidContent = 'resource "example" "invalid" {}\r\n';
    const validContent = 'resource "example" "valid" {}\n';
    const gateway = new RepairGateway(
      candidateBundle(fixture.request, invalidContent),
      candidateBundle(
        fixture.request,
        validContent,
        sha256Text(invalidContent),
      ),
    );
    const snapshots: CandidateGenerationProgressSnapshotV1[] = [];
    let activePublishers = 0;
    let maximumActivePublishers = 0;
    const progress: CandidateGenerationProgressPort = {
      async publish(snapshot) {
        activePublishers += 1;
        maximumActivePublishers = Math.max(
          maximumActivePublishers,
          activePublishers,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        snapshots.push(structuredClone(snapshot));
        activePublishers -= 1;
      },
    };
    const validator = new PassingValidator();
    const coordinator = createAiExtensionGenerationCoordinator({
      artifactStore: new InMemoryCandidateArtifactStore(),
      gateway,
      progress,
      validators: {
        application: validator,
        cloudformation: validator,
        terraform: validator,
      },
    });
    const modelContext = invocationContext(
      fixture.request,
      "invocation-progress-generation",
    );
    const repairContext = invocationContext(
      fixture.request,
      "invocation-progress-repair-1",
    );
    const input: CustomCandidateGenerationInputV1 = {
      assessedAt,
      authority: "approved-iac-extension",
      commercialAuthority: {
        acceptedWorkflowEstimateMaximumCreditUnits: 20,
        attemptEstimateCreditUnits: [1, 1],
        reservationId: fixture.extension.reservationId,
      },
      extension: fixture.extension,
      maximumRepairAttempts: 1,
      modelContext,
      modelRequest: fixture.request,
      repairContexts: [repairContext],
      scope,
    };

    const result = await coordinator.generate(input);
    if (!("reviewId" in result)) throw new Error("Expected candidate review.");

    expect(maximumActivePublishers).toBe(1);
    expect(snapshots.map(({ sequence }) => sequence)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(snapshots.map(({ phase }) => phase)).toEqual([
      "generation-complete",
      "validation-assessed",
      "repair-complete",
      "repair-proposed",
      "repair-validated",
      "validation-assessed",
    ]);
    expect(
      snapshots.every(
        (snapshot) =>
          snapshot.extensionId === extensionId &&
          snapshot.solutionRevisionId === solutionRevisionId &&
          snapshot.scope.organizationId === scope.organizationId &&
          snapshot.scope.projectId === scope.projectId,
      ),
    ).toBe(true);
    for (const snapshot of snapshots) {
      expect(snapshot).toMatchObject({
        deploymentAuthority: "none",
        repositoryWriteAuthority: "none",
        writeAuthority: "none",
      });
    }
    expect(snapshots[0]?.issues).toEqual([]);
    expect(snapshots[1]?.issues[0]?.lifecycle.state).toBe("current");
    expect(snapshots[3]?.issues[0]?.aiProposedFix?.validationStatus).toBe(
      "validation-pending",
    );
    expect(snapshots[4]?.issues[0]?.lifecycle.state).toBe("resolved");
    expect(snapshots.at(-1)?.issueHistory).toEqual(result.issueHistory);
    expect(snapshots.at(-1)?.issues).toEqual(result.issues);
    expect(result.state).toBe("ready-for-acceptance");
    expect(result.progress.at(-1)).toEqual({
      stage: "accept-candidate",
      state: "ready",
    });

    const first = snapshots[0];
    const second = snapshots[1];
    const third = snapshots[2];
    const fifth = snapshots[4];
    const sixth = snapshots[5];
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      fifth === undefined ||
      sixth === undefined
    ) {
      throw new Error("Expected the complete bounded progress stream.");
    }
    const expectedGenerationRunId = stableRecordId("candidate-generation-run", {
      extensionId,
      idempotencyKeyDigest: modelContext.idempotencyKeyDigest,
      invocationId: modelContext.invocationId,
      scope,
      solutionRevisionId,
    });
    expect(first.generationRunId).toBe(expectedGenerationRunId);
    expect(first.predecessor).toEqual({
      previousSnapshotDigest: "none",
      state: "genesis",
    });
    snapshots.slice(1).forEach((snapshot, index) => {
      expect(snapshot.generationRunId).toBe(expectedGenerationRunId);
      expect(snapshot.predecessor).toEqual({
        previousSnapshotDigest: snapshots[index]?.snapshotDigest,
        state: "continues",
      });
      expect(snapshot.evidenceDigest).toBe(
        digestCanonicalValue(snapshot.evidence),
      );
    });
    const prefix = {
      contractVersion: 1 as const,
      generationRunId: first.generationRunId,
      snapshots,
    };
    expect(
      candidateGenerationProgressPrefixV1Schema.safeParse(prefix).success,
    ).toBe(true);
    const finalizedStream = {
      ...prefix,
      finalization: result.generationProgress,
    };
    expect(
      candidateGenerationProgressStreamV1Schema.safeParse(finalizedStream)
        .success,
    ).toBe(true);
    expect(result.generationProgress).toMatchObject({
      finalEvidenceCount: sixth.evidence.length,
      finalEvidenceDigest: sixth.evidenceDigest,
      finalIssueHistoryCount: sixth.issueHistory.length,
      finalIssueHistoryDigest: sixth.issueHistoryDigest,
      finalIssuesCount: sixth.issues.length,
      finalIssuesDigest: sixth.issuesDigest,
      finalSequence: sixth.sequence,
      finalSnapshotDigest: sixth.snapshotDigest,
      generationRunId: expectedGenerationRunId,
      terminalPhase: sixth.phase,
      terminalResultKind: "candidate-review",
    });

    expect(
      candidateGenerationProgressPrefixV1Schema.safeParse({
        ...prefix,
        snapshots: [...snapshots, sixth],
      }).success,
    ).toBe(false);
    expect(
      candidateGenerationProgressPrefixV1Schema.safeParse({
        ...prefix,
        snapshots: [first, third, second, ...snapshots.slice(3)],
      }).success,
    ).toBe(false);
    expect(
      candidateGenerationProgressPrefixV1Schema.safeParse({
        ...prefix,
        snapshots: snapshots.slice(1),
      }).success,
    ).toBe(false);

    const wrongRunSnapshot = redigestProgressSnapshot(second, {
      generationRunId: stableRecordId("candidate-generation-run-wrong", {
        expectedGenerationRunId,
      }),
    });
    expect(
      candidateGenerationProgressPrefixV1Schema.safeParse({
        ...prefix,
        snapshots: [first, wrongRunSnapshot],
      }).success,
    ).toBe(false);

    const truncatedContinuation = redigestProgressSnapshot(sixth, {
      evidence: second.evidence,
      evidenceDigest: digestCanonicalValue(second.evidence),
      issueHistory: second.issueHistory,
      issueHistoryDigest: digestCanonicalValue(second.issueHistory),
      issues: second.issues,
      issuesDigest: digestCanonicalValue(second.issues),
    });
    expect(
      candidateGenerationProgressSnapshotV1Schema.safeParse(
        truncatedContinuation,
      ).success,
    ).toBe(true);
    expect(
      candidateGenerationProgressPrefixV1Schema.safeParse({
        ...prefix,
        snapshots: [...snapshots.slice(0, 5), truncatedContinuation],
      }).success,
    ).toBe(false);

    const properLivePrefix = {
      ...prefix,
      snapshots: snapshots.slice(0, -1),
    };
    expect(
      candidateGenerationProgressPrefixV1Schema.safeParse(properLivePrefix)
        .success,
    ).toBe(true);
    expect(
      candidateGenerationProgressStreamV1Schema.safeParse({
        ...properLivePrefix,
        finalization: result.generationProgress,
      }).success,
    ).toBe(false);

    const forgedFinalization = {
      ...result.generationProgress,
      finalEvidenceCount: fifth.evidence.length,
      finalEvidenceDigest: fifth.evidenceDigest,
      finalIssueHistoryCount: fifth.issueHistory.length,
      finalIssueHistoryDigest: fifth.issueHistoryDigest,
      finalIssuesCount: fifth.issues.length,
      finalIssuesDigest: fifth.issuesDigest,
      finalSequence: fifth.sequence,
      finalSnapshotDigest: fifth.snapshotDigest,
      streamDigest:
        getCandidateGenerationProgressPrefixDigest(properLivePrefix),
      terminalPhase: fifth.phase,
    };
    expect(
      candidateGenerationProgressStreamV1Schema.safeParse({
        ...properLivePrefix,
        finalization: forgedFinalization,
      }).success,
    ).toBe(true);
    const { reviewDigest: _reviewDigest, ...reviewProjection } = result;
    void _reviewDigest;
    const forgedReviewProjection = {
      ...reviewProjection,
      generationProgress: forgedFinalization,
    };
    expect(
      candidateReviewRecordV1Schema.safeParse({
        ...forgedReviewProjection,
        reviewDigest: digestCanonicalValue(forgedReviewProjection),
      }).success,
    ).toBe(false);
  });
});
