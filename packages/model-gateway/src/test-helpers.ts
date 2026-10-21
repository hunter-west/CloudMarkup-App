import { readFileSync } from "node:fs";

import {
  getActiveIssueRecordHash,
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentHashes,
  getExternalResourceReferenceContentHash,
  getWorkloadBehaviorContentHash,
} from "@cloudmarkup/domain";
import {
  activeIssueV1Schema,
  architectureDocumentV3Schema,
  intentDocumentV1Schema,
  modelGatewayRequestV1Schema,
  modelRoutingFeatureAuthorityV1,
  modelRoutingDecisionV1Schema,
  modelRoutingRequestV1Schema,
  repositorySnapshotIdSchema,
  sha256DigestSchema,
  solutionRevisionManifestV1Schema,
  type ActiveIssueV1,
  type ArchitectureDocumentV3,
  type IntentDocumentV1,
  type ModelGatewayRequestV1,
  type ModelRoutingDecisionV1,
  type ModelRoutingRequestV1,
  type SolutionRevisionManifestV1,
} from "@cloudmarkup/schemas";

import type { ModelGatewayInvocationContextV1 } from "./ports.js";
import { digestStructuredValue, sha256Text } from "./security.js";

export const TEST_DIGEST = sha256DigestSchema.parse(`sha256:${"a".repeat(64)}`);
export const TEST_SECOND_DIGEST = sha256DigestSchema.parse(
  `sha256:${"b".repeat(64)}`,
);
export const TEST_REPOSITORY_SNAPSHOT_ID = repositorySnapshotIdSchema.parse(
  "repository_snapshot_test",
);

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, "utf8")) as unknown;
}

export const testArchitecture: ArchitectureDocumentV3 =
  architectureDocumentV3Schema.parse(
    readJson(
      new URL(
        "../../test-fixtures/fixtures/architecture-document/v3/valid/representative.json",
        import.meta.url,
      ),
    ),
  );

export const testIntent: IntentDocumentV1 = intentDocumentV1Schema.parse(
  readJson(
    new URL(
      "../../test-fixtures/fixtures/intent-document/v1/valid/representative.json",
      import.meta.url,
    ),
  ),
);

const testArchitectureHashes = getArchitectureDocumentHashes(testArchitecture);

export function testCatalogConfigurationValidation(
  schemaId: string,
  schemaVersion: string,
) {
  const canonicalization =
    "cloudmarkup.provider-configuration-authority.canonical-json.v1" as const;
  const jsonSchema = {
    $id: `urn:cloudmarkup:configuration:${schemaId}:${schemaVersion}`,
    $schema: "https://json-schema.org/draft/2020-12/schema" as const,
    additionalProperties: false as const,
    properties: {},
    required: [],
    title: `Synthetic ${schemaId} configuration`,
    type: "object" as const,
  };
  const nodeReferenceAuthorities = {};
  const valueSources = {};
  return {
    canonicalization,
    jsonSchema,
    nodeReferenceAuthorities,
    schemaDigest: digestStructuredValue({
      canonicalization,
      jsonSchema,
      nodeReferenceAuthorities,
      schemaId,
      schemaVersion,
      valueSources,
    }),
    valueSources,
  };
}

export const testSolutionRevision: SolutionRevisionManifestV1 =
  solutionRevisionManifestV1Schema.parse({
    aiExtensionIds: [],
    architecture: {
      contentHash: testArchitectureHashes.contentHash,
      documentHash: getArchitectureDocumentCanonicalHash(testArchitecture),
      documentKind: "cloudmarkup.architecture-document",
      revisionId: testArchitecture.revision.revisionId,
      schemaVersion: 3,
      visualHash: testArchitectureHashes.visualHash,
    },
    assumptions: [],
    contractVersion: 1,
    contracts: {
      contentHash: getApplicationContractsContentHash(
        testArchitecture.applicationContracts,
      ),
      contractVersion: 1,
      recordHashes: [],
    },
    createdAt: "2026-08-20T00:00:00.000Z",
    createdBy: "actor_test",
    evidenceIdsAtFreeze: [],
    externalResources: {
      contentHash: getExternalResourceReferenceContentHash(
        testArchitecture.externalResources,
      ),
      contractVersion: 1,
    },
    generationCoverage: {
      contractVersion: 1,
      evidence: [],
      missingRequirements: [],
      solutionRevisionId: "solution_revision_test",
      state: "infrastructure-only",
      workloads: [],
    },
    intent: {
      reason: "The fixture uses an independently supplied intent document.",
      state: "not-applicable",
    },
    issueIdsAtFreeze: [],
    kind: "cloudmarkup.solution-revision-manifest",
    repositoryObservations: [],
    solutionRevisionId: "solution_revision_test",
    sourceOwnership: [
      {
        conflictBehavior: "replace-exact-owned-content",
        ownerId: "generator_test",
        ownership: "generated",
        path: "application/fake.ts",
      },
      {
        conflictBehavior: "replace-exact-owned-content",
        ownerId: "generator_test",
        ownership: "generated",
        path: "infrastructure/fake.tf",
      },
    ],
    unresolvedDecisionIds: [],
    versions: {
      applicationGenerator: {
        reason: "No deterministic application generation is asserted.",
        state: "not-applicable",
      },
      catalog: {
        digest: testArchitecture.catalog.digest,
        id: testArchitecture.catalog.id,
        version: testArchitecture.catalog.version,
      },
      compiler: {
        reason: "No compiler is invoked by the gateway fixture.",
        state: "not-applicable",
      },
      diagramRenderer: {
        reason: "No diagram renderer is invoked by the gateway fixture.",
        state: "not-applicable",
      },
      importer: {
        reason: "Repository input is supplied separately when required.",
        state: "not-applicable",
      },
      modelPrompt: {
        reason: "The fixture predates any accepted model output.",
        state: "not-applicable",
      },
      policy: [],
    },
    workload: {
      contentHash: getWorkloadBehaviorContentHash(
        testArchitecture.workloadBehavior,
      ),
      contractVersion: 2,
    },
  });

const graphTarget = {
  architectureId: testArchitecture.architectureId,
  documentId: testArchitecture.documentId,
  revisionId: testArchitecture.revision.revisionId,
};

const testIssuePlaceholder: ActiveIssueV1 = activeIssueV1Schema.parse({
  affected: [
    {
      kind: "solution-revision",
      solutionRevisionId: testSolutionRevision.solutionRevisionId,
    },
  ],
  category: "structure",
  closureRequirements: [],
  contractVersion: 1,
  currentRecordDigest: TEST_DIGEST,
  deterministicFix: {
    description: "Move one node using the exact current visual precondition.",
    graphCommand: {
      commandId: "command_batch_test",
      commands: [
        {
          commandId: "command_move_test",
          expectedPosition: testArchitecture.nodes[0]?.presentation.position,
          inverseCommandId: "command_move_inverse_test",
          kind: "move-node",
          nodeId: testArchitecture.nodes[0]?.id,
          origin: "user",
          position: testArchitecture.nodes[0]?.presentation.position,
          schemaVersion: 1,
          target: graphTarget,
        },
      ],
      inverseCommandId: "command_batch_inverse_test",
      kind: "batch",
      origin: "user",
      schemaVersion: 1,
      target: graphTarget,
    },
    resultingContentHash: TEST_DIGEST,
    resultingVisualHash: TEST_SECOND_DIGEST,
  },
  id: "issue_test",
  lifecycle: { state: "current" },
  provenance: {
    actor: {
      kind: "deterministic-tool",
      tool: { id: "cloudmarkup.test-validator", version: "1.0.0" },
    },
    createdAt: "2026-08-20T00:00:00.000Z",
    inputDigests: [TEST_DIGEST],
  },
  recordVersion: 1,
  severity: "error",
  solutionRevisionId: testSolutionRevision.solutionRevisionId,
  source: "schema-graph-validation",
  sourceRecordId: "finding_test",
  summary: "A deterministic synthetic issue requires review.",
  technicalDetail:
    "This issue exists only to exercise the ModelGateway boundary.",
});

export const testIssue: ActiveIssueV1 = activeIssueV1Schema.parse({
  ...testIssuePlaceholder,
  currentRecordDigest: getActiveIssueRecordHash(testIssuePlaceholder),
});

export const testValidationExpectations = [
  {
    checkId: "cloudmarkup.validation.parse",
    kind: "parse" as const,
    required: true,
    successCondition: "must-pass" as const,
    toolProfileId: "cloudmarkup.validation-profile",
  },
];

export const testCandidateBoundary = {
  approvalPathIds: ["cloudmarkup.dependency-review.v1"],
  boundaryId: "candidate_boundary_test",
  ownedPaths: ["application/fake.ts"],
  writeAuthority: "candidate-artifacts-only" as const,
};

export const testIacCandidateBoundary = {
  approvalPathIds: ["cloudmarkup.dependency-review.v1"],
  boundaryId: "candidate_boundary_iac_test",
  ownedPaths: ["infrastructure/fake.tf"],
  writeAuthority: "candidate-artifacts-only" as const,
};

const repositoryEvidence = {
  content: "resource declaration is incomplete",
  evidenceId: "repository_evidence_test",
  fileChecksum: TEST_DIGEST,
  location: { endLine: 1, startLine: 1 },
  path: "infrastructure/main.tf",
  redaction: {
    categories: [],
    noSecretValues: true as const,
    status: "not-required" as const,
  },
};

export function modelTestContext(
  invocationId: string,
  complexity: ModelGatewayInvocationContextV1["complexity"] = "standard",
): ModelGatewayInvocationContextV1 {
  return {
    budget: {
      acceptedEstimateMaximumCreditUnits: 20,
      allowed: true,
      availableCreditUnits: 100,
      decisionId: "budget_decision_test",
      estimateAccepted: true,
      maximumCostTier: "deep",
    },
    complexity,
    entitlement: {
      allowed: true,
      allowedRoles: [
        "low-cost-extraction-help",
        "standard-planning-generation",
        "deep-architecture-custom-generation",
        "repair-escalation",
        "fallback",
      ],
      decisionId: "entitlement_decision_test",
      planKey: "pro",
      planVersionId: "plan_version_test",
    },
    evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
    evaluationPolicyVersion: "1.0.0",
    idempotencyKeyDigest: TEST_SECOND_DIGEST,
    invocationId,
    requestedMode: "guided",
    scope: {
      jobId: "job_test",
      organizationId: "organization_test",
      projectId: "project_test",
      repositorySnapshotId: TEST_REPOSITORY_SNAPSHOT_ID,
      solutionRevisionId: testSolutionRevision.solutionRevisionId,
      userId: "user_test",
    },
  };
}

export function modelTestRoutingRequest(
  request: ModelGatewayRequestV1,
  context: ModelGatewayInvocationContextV1,
  overrides: Partial<ModelRoutingRequestV1> = {},
): ModelRoutingRequestV1 {
  const inputDigest = digestStructuredValue({
    request,
    scope: context.scope,
  });
  const featureAuthority = modelRoutingFeatureAuthorityV1[request.operation];
  return modelRoutingRequestV1Schema.parse({
    accountRegionComplexity: "single-account-region",
    creditAuthorization: {
      ...(context.budget.acceptedEstimateMaximumCreditUnits === undefined
        ? {}
        : {
            acceptedEstimateMaximumCreditUnits:
              context.budget.acceptedEstimateMaximumCreditUnits,
          }),
      allowed: context.budget.allowed,
      availableCreditUnits: context.budget.availableCreditUnits,
      decisionId: context.budget.decisionId,
      estimateAccepted: context.budget.estimateAccepted,
    },
    currentValidationState: "not-run",
    customCodeRequirement: "none",
    edgeCount: 1,
    estimatedContextTokens: 10_000,
    environment: "production",
    expectedOutputClass: featureAuthority.expectedOutputClass,
    externalResourceCount: 0,
    feature: request.operation,
    idempotencyKeyDigest: context.idempotencyKeyDigest,
    inputDigest,
    networkingComplexity: "basic",
    nodeCount: 2,
    operationClass: featureAuthority.operationClass,
    organizationId: context.scope.organizationId,
    plan: {
      entitlementDecisionId: context.entitlement.decisionId,
      key: context.entitlement.planKey,
      versionId: context.entitlement.planVersionId,
    },
    principalId: context.scope.userId,
    projectId: context.scope.projectId ?? "project_test",
    repositoryFileEstimate: 0,
    repositoryTokenEstimate: 0,
    requiredEvaluationPolicyId: context.evaluationPolicyId,
    requiredEvaluationPolicyVersion: context.evaluationPolicyVersion,
    requestedMode: context.requestedMode,
    securityComplianceSensitivity: "ordinary",
    selectedPreference: "standard-design",
    serviceFamilyCount: 1,
    scopeDigest: digestStructuredValue(context.scope),
    ...(context.scope.solutionRevisionId === undefined
      ? {}
      : { solutionRevisionId: context.scope.solutionRevisionId }),
    ...(context.xhighEffortAuthorization === undefined
      ? {}
      : { xhighEffortAuthorization: context.xhighEffortAuthorization }),
    workloadCount: 0,
    ...overrides,
  });
}

export function modelTestRoutingDecision(
  routingRequest: ModelRoutingRequestV1,
): ModelRoutingDecisionV1 {
  return modelRoutingDecisionV1Schema.parse({
    automaticEscalationPermitted: true,
    capabilityRegistryDigest: TEST_DIGEST,
    capabilityRegistryId: "cloudmarkup.model-capabilities.amazon-bedrock",
    capabilityRegistryVersion: "1.0.0",
    contractVersion: 1,
    creditAuthorization: {
      allowed: true,
      decisionId: routingRequest.creditAuthorization.decisionId,
      estimateAccepted: true,
    },
    customerCharge: {
      acceptedMaximumCreditUnits: 20,
      incrementalEscalationCreditUnits: 0,
      policy: "accepted-estimate-cap",
    },
    effort: "medium",
    evaluationResultDigest: TEST_DIGEST,
    evaluationResultVersion: "1.0.0",
    entitlement: {
      allowed: true,
      decisionId: "entitlement_decision_test",
      planKey: "pro",
      planVersionId: "plan_version_test",
    },
    estimateClass: "standard",
    evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
    evaluationPolicyVersion: "1.0.0",
    feature: "summary.technical",
    inferenceProfileId: "configured.profile.standard.required",
    maximumAttempts: 2,
    maximumOutputTokens: 8_192,
    modelCapabilityDigest: TEST_DIGEST,
    modelCapabilityVersion: "1.0.0",
    modelConfigurationReference: "cloudmarkup.bedrock.standard.v1",
    modelFamily: "configured.model-family.standard",
    modelId: "configured.model.standard.required",
    modelVersion: "configured-at-runtime",
    outcome: "selected",
    pricingVersionReference: "cloudmarkup.pricing.unavailable.standard",
    promptCachePolicy: {
      cacheKeyRequired: true,
      enabled: true,
      maximumCheckpoints: 4,
      minimumCheckpointTokens: 4_096,
    },
    providerFamily: "amazon-bedrock",
    providerId: "cloudmarkup.amazon-bedrock",
    reasonCodes: ["standard-default"],
    recommendedServiceLevel: "standard-design",
    requestedMode: "guided",
    routeDefinitionDigest: TEST_DIGEST,
    routeId: "standard-design",
    routeRegistryDigest: TEST_DIGEST,
    routeRegistryId: "cloudmarkup.model-routes.amazon-bedrock",
    routeRegistryVersion: "1.0.0",
    routingConfigurationDigest: TEST_DIGEST,
    requestBinding: {
      idempotencyKeyDigest: routingRequest.idempotencyKeyDigest,
      inputDigest: routingRequest.inputDigest,
      routingRequestDigest: digestStructuredValue(routingRequest),
      scopeDigest: routingRequest.scopeDigest,
    },
    timeoutMilliseconds: 120_000,
    userConfirmationRequired: false,
  });
}

export function modelTestRequests(): readonly ModelGatewayRequestV1[] {
  const reference = {
    digest: TEST_DIGEST,
    kind: "solution-contract" as const,
    referenceId: "contract_test",
  };
  const failedContent = "// failed candidate\n";
  const failedCandidates = [
    {
      candidateId: "candidate_failed_test",
      content: failedContent,
      contentDigest: sha256Text(failedContent),
      encoding: "utf-8" as const,
      kind: "file" as const,
      ownership: "ai-authored-candidate" as const,
      path: "application/fake.ts",
    },
  ];
  const requests: unknown[] = [
    {
      contractVersion: 1,
      operation: "intent.extract",
      requestedMode: "guided",
      source: {
        content: "Create a bounded synthetic workload.",
        digest: sha256Text("Create a bounded synthetic workload."),
        kind: "requirements-text",
        sourceId: "requirements_test",
      },
    },
    {
      contractVersion: 1,
      intentDocument: testIntent,
      maximumQuestions: 5,
      operation: "requirements.blocking-questions",
      requestedMode: "guided",
    },
    {
      catalog: {
        allowedRelationshipTypes: ["example.relationship"],
        allowedServiceIds: ["example.events"],
        catalogDigest: testArchitecture.catalog.digest,
        catalogId: testArchitecture.catalog.id,
        catalogVersion: testArchitecture.catalog.version,
      },
      contractVersion: 1,
      currentArchitecture: testArchitecture,
      intentDocument: testIntent,
      operation: "architecture.propose",
      requestedMode: "guided",
    },
    {
      architecture: testArchitecture,
      contractVersion: 1,
      operation: "workload.propose",
      requestedMode: "guided",
      solutionRevision: testSolutionRevision,
    },
    {
      architecture: testArchitecture,
      contractVersion: 1,
      operation: "external-resource.propose",
      repositoryExcerpts: [repositoryEvidence],
      requestedMode: "guided",
    },
    {
      architecture: testArchitecture,
      catalogGrounding: {
        catalog: testArchitecture.catalog,
        connectionRules: [
          {
            configurationSchemaId: "example.relationship.invokes-config",
            configurationSchemaVersion: "1.0.0",
            configurationValidation: testCatalogConfigurationValidation(
              "example.relationship.invokes-config",
              "1.0.0",
            ),
            relationshipType: "example.relationship.invokes",
            ruleId: "example.connection-rule.invokes",
            ruleVersion: "1.0.0",
            source: {
              port: "example.port.event",
              serviceType: "example.events",
            },
            target: {
              port: "example.port.invocation",
              serviceType: "example.compute",
            },
          },
          {
            configurationSchemaId: "example.relationship.writes-config",
            configurationSchemaVersion: "1.0.0",
            configurationValidation: testCatalogConfigurationValidation(
              "example.relationship.writes-config",
              "1.0.0",
            ),
            relationshipType: "example.relationship.writes",
            ruleId: "example.connection-rule.writes",
            ruleVersion: "1.0.0",
            source: {
              port: "example.port.data-write",
              serviceType: "example.compute",
            },
            target: {
              port: "example.port.data",
              serviceType: "example.events",
            },
          },
        ],
        manifestVersion: 1,
        nodes: [
          {
            configurationSchemaId: "example.events.source-config",
            configurationSchemaVersion: "1.0.0",
            configurationValidation: testCatalogConfigurationValidation(
              "example.events.source-config",
              "1.0.0",
            ),
            placement: {
              allowedParentTypes: [
                {
                  relationshipType: "example.relationship.contains",
                  serviceType: "example.compute",
                },
              ],
              maximumDepth: 2,
              rootPlacement: "allowed",
            },
            ports: [
              { direction: "output", port: "example.port.event" },
              { direction: "input", port: "example.port.data" },
            ],
            resourceType: "example.events.source",
            serviceType: "example.events",
          },
          {
            configurationSchemaId: "example.compute.function-config",
            configurationSchemaVersion: "1.0.0",
            configurationValidation: testCatalogConfigurationValidation(
              "example.compute.function-config",
              "1.0.0",
            ),
            placement: {
              allowedParentTypes: [],
              maximumDepth: 1,
              rootPlacement: "allowed",
            },
            ports: [
              { direction: "input", port: "example.port.invocation" },
              { direction: "output", port: "example.port.data-write" },
            ],
            resourceType: "example.compute.function",
            serviceType: "example.compute",
          },
        ],
      },
      contractVersion: 1,
      operation: "operations.propose",
      requestedMode: "guided",
    },
    {
      commitSha: "a".repeat(40),
      contractVersion: 1,
      evidence: [repositoryEvidence],
      operation: "repository.interpret",
      repositorySnapshotDigest: TEST_DIGEST,
      repositorySnapshotId: TEST_REPOSITORY_SNAPSHOT_ID,
      requestedMode: "guided",
    },
    {
      contractVersion: 1,
      issue: testIssue,
      operation: "issue.explain",
      requestedMode: "guided",
    },
    {
      contractVersion: 1,
      issue: testIssue,
      operation: "deterministic-fix.explain",
      requestedMode: "guided",
    },
    {
      boundary: testCandidateBoundary,
      contractVersion: 1,
      issue: testIssue,
      operation: "fix.propose",
      requestedMode: "guided",
      validationExpectations: testValidationExpectations,
    },
    {
      acceptanceCriteria: ["The synthetic candidate remains review-only."],
      architecture: testArchitecture,
      boundary: testCandidateBoundary,
      contractVersion: 1,
      operation: "application-source.generate",
      requestedMode: "guided",
      solutionRevision: testSolutionRevision,
      sourceOwnershipAuthority: {
        authority: "solution-revision-candidate-generation",
        candidateRoots: ["application"],
        canonicalization:
          "cloudmarkup.solution-source-ownership.canonical-json.v1",
        ownedPaths: testCandidateBoundary.ownedPaths,
        solutionRevisionId: testSolutionRevision.solutionRevisionId,
        sourceOwnership: testSolutionRevision.sourceOwnership.filter(
          (entry) => entry.path === "application/fake.ts",
        ),
      },
      sourceReferences: [{ kind: "workload", referenceId: "workload_worker" }],
      validationExpectations: testValidationExpectations,
      workloadId: "workload_worker",
    },
    {
      acceptanceCriteria: ["The synthetic candidate remains review-only."],
      architecture: testArchitecture,
      boundary: testIacCandidateBoundary,
      contractVersion: 1,
      operation: "iac-extension.generate",
      requestedMode: "guided",
      solutionRevision: testSolutionRevision,
      sourceOwnershipAuthority: {
        authority: "solution-revision-candidate-generation",
        candidateRoots: ["infrastructure"],
        canonicalization:
          "cloudmarkup.solution-source-ownership.canonical-json.v1",
        ownedPaths: testIacCandidateBoundary.ownedPaths,
        solutionRevisionId: testSolutionRevision.solutionRevisionId,
        sourceOwnership: testSolutionRevision.sourceOwnership.filter(
          (entry) => entry.path === "infrastructure/fake.tf",
        ),
      },
      sourceReferences: [
        { kind: "architecture-node", referenceId: "node_worker" },
      ],
      targetFormat: "terraform",
      validationExpectations: testValidationExpectations,
    },
    {
      boundary: testCandidateBoundary,
      contractVersion: 1,
      diagnostics: [
        {
          candidateId: "candidate_failed_test",
          checkKind: "parse",
          diagnosticId: "diagnostic_test",
          message: "The synthetic candidate did not parse.",
          noSecretValues: true,
          path: "application/fake.ts",
          redactionStatus: "not-required",
          toolId: "cloudmarkup.test-parser",
          toolVersion: "1.0.0",
        },
      ],
      currentAttempt: 1,
      failedCandidates,
      failedCandidatesCanonicalization:
        "cloudmarkup.model-failed-candidates.canonical-json.v1",
      failedOutputDigest: digestStructuredValue(failedCandidates),
      maximumRepairAttempts: 1,
      operation: "candidate.repair",
      requestedMode: "guided",
      validationExpectations: testValidationExpectations,
    },
    {
      contractVersion: 1,
      operation: "summary.plain-language",
      requestedMode: "guided",
      source: {
        content: "A synthetic source needs a concise summary.",
        contentDigest: sha256Text(
          "A synthetic source needs a concise summary.",
        ),
        evidenceReferences: [reference],
        sourceKind: "architecture",
      },
    },
    {
      contractVersion: 1,
      operation: "summary.technical",
      requestedMode: "guided",
      source: {
        content: "A synthetic source needs a technical summary.",
        contentDigest: sha256Text(
          "A synthetic source needs a technical summary.",
        ),
        evidenceReferences: [reference],
        sourceKind: "architecture",
      },
    },
  ];
  return requests.map((request) => modelGatewayRequestV1Schema.parse(request));
}

export function testIacGenerationRequestWithContext(): Extract<
  ModelGatewayRequestV1,
  { operation: "iac-extension.generate" }
> {
  const requests = modelTestRequests();
  const generation = requests.find(
    (request) => request.operation === "iac-extension.generate",
  );
  const planning = requests.find(
    (request) => request.operation === "operations.propose",
  );
  if (
    generation?.operation !== "iac-extension.generate" ||
    planning?.operation !== "operations.propose"
  ) {
    throw new Error("Missing generation-context source fixtures.");
  }
  const extensionId = "extension_iac_context_test";
  const solutionRevision = solutionRevisionManifestV1Schema.parse({
    ...generation.solutionRevision,
    sourceOwnership: generation.solutionRevision.sourceOwnership.map((entry) =>
      entry.path === "infrastructure/fake.tf"
        ? {
            ...entry,
            conflictBehavior: "semantic-diff-and-review",
            ownerId: extensionId,
            ownership: "approved-extension",
          }
        : entry,
    ),
  });
  const sourceOwnership = solutionRevision.sourceOwnership.filter(
    (entry) => entry.path === "infrastructure/fake.tf",
  );
  const officialSchemaDocument = JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    additionalProperties: false,
    properties: {},
    type: "object",
  });
  const catalogSliceContent = JSON.stringify(planning.catalogGrounding);
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
        resourceType: "aws_lambda_function",
      },
    ],
    catalogSlice: {
      catalog: planning.catalogGrounding.catalog,
      content: catalogSliceContent,
      entries: planning.catalogGrounding.nodes.map((node) => ({
        resourceType: node.resourceType,
        serviceType: node.serviceType,
      })),
      sliceDigest: sha256Text(catalogSliceContent),
    },
    existingFiles: [],
    extensionId,
    extensionSlotId: "slot_terraform_extension_test",
    kind: "iac-extension",
    language: "language.hcl",
    limits: {
      maximumCandidateFileBytes: 256 * 1_024,
      maximumCandidateFiles: 1,
      maximumCandidateTotalBytes: 256 * 1_024,
      maximumDependencyRequests: 0,
      maximumExpectedTests: 1,
      maximumRepairAttempts: 2,
      maximumResourceCount: 2,
    },
    officialSchemas: [
      {
        document: officialSchemaDocument,
        schemaDigest: sha256Text(officialSchemaDocument),
        schemaId: "schema.terraform-extension",
        schemaVersion: "1.0.0",
      },
    ],
    ownedPaths: generation.boundary.ownedPaths,
    ownedResourceAddresses: ["aws_lambda_function.worker"],
    protectedPaths: ["application/fake.ts"],
    protectedResourceAddresses: ["aws_lambda_function.canonical_worker"],
    requestedBehavior: {
      acceptanceCriteria: generation.acceptanceCriteria,
      objective: "Generate one bounded Terraform extension candidate.",
      requirements: ["Preserve the deterministic compiler resource."],
    },
    runtimeFamily: "runtime.terraform-cli",
    sourceReferences: generation.sourceReferences,
    targetFormat: generation.targetFormat,
    validationExpectations: generation.validationExpectations,
  };
  const parsed = modelGatewayRequestV1Schema.parse({
    ...generation,
    generationContext,
    generationContextDigest: digestStructuredValue(generationContext),
    solutionRevision,
    sourceOwnershipAuthority: {
      ...generation.sourceOwnershipAuthority,
      sourceOwnership,
    },
  });
  if (parsed.operation !== "iac-extension.generate") {
    throw new Error("Unexpected generation-context fixture operation.");
  }
  return parsed;
}
