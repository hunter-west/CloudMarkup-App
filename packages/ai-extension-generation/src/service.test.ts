import { readFileSync } from "node:fs";

import {
  getApplicationContractRecordContentHash,
  getApplicationContractsContentHash,
} from "@cloudmarkup/domain";
import {
  architectureDocumentV3Schema,
  modelApplicationSourceGenerationRequestV1Schema,
  evidenceRecordV1Schema,
  modelApplicationSourceGenerationResponseV1Schema,
  modelCandidateBundleV1Schema,
  modelCandidateRepairRequestV1Schema,
  modelCandidateRepairResponseV1Schema,
  modelIacExtensionGenerationRequestV1Schema,
  modelIacExtensionGenerationResponseV1Schema,
  modelInvocationDescriptorV1Schema,
  normalizedModelUsageV1Schema,
  solutionRevisionManifestV1Schema,
  utcTimestampSchema,
  workloadV2Schema,
  type ModelCandidateBundleV1,
  type ModelGatewayOperationV1,
} from "@cloudmarkup/schemas";
import {
  ModelGatewayError,
  type ModelGatewayInvocationContextV1,
  type ModelGatewayResultV1,
  type ModelRequestFor,
} from "@cloudmarkup/model-gateway";
import { describe, expect, it } from "vitest";

import { createCandidateReviewService } from "./editing.js";
import {
  getCandidateReviewAuthorizationRequestDigest,
  type CandidateReviewAuthorizationPort,
  type CandidateReviewAuthorizationRequestV1,
} from "./authorization.js";
import {
  createCandidateArtifactReviewBinding,
  type CandidateArtifactStore,
} from "./artifact-store.js";
import {
  candidateTargetValidationResultV1Schema,
  type CandidateTargetValidationInput,
  type CandidateTargetValidationPort,
} from "./validation.js";
import {
  createAiExtensionGenerationCoordinator,
  candidateExtensionAuthorityV1Schema,
  type CandidateModelGateway,
  type CustomCandidateGenerationInputV1,
} from "./service.js";
import {
  candidateReviewRecordV1Schema,
  getCandidateEditRevalidationFinalizationDigest,
  type CandidateEditRevalidationFinalizationV1,
  type CandidateReviewRecordV1,
} from "./presentation-contracts.js";
import {
  digestCanonicalValue,
  sha256Text,
  stableRecordId,
} from "./security.js";
import { InMemoryCandidateArtifactStore } from "./testing.js";

const assessedAt = "2026-08-21T12:00:00.000Z";
const promptDigest = sha256Text("reviewed extension prompt");
const solutionRevisionId = "solution-revision-custom-1";
const extensionId = "cloudmarkup.extension-custom";
const extensionSlotId = "terraform-extension-slot-1";
const scope = {
  organizationId: "organization-test",
  projectId: "project-test",
} as const;

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
  reason: "This deterministic coordinator fixture does not invoke the tool.",
  state: "not-applicable",
} as const;

function solutionRevision(
  paths: readonly string[],
  ownership: "ai-authored" | "approved-extension",
  architectureInput = architecture,
) {
  const digest = sha256Text("solution-revision-fixture");
  return solutionRevisionManifestV1Schema.parse({
    aiExtensionIds: [],
    architecture: {
      contentHash: digest,
      documentHash: digest,
      documentKind: "cloudmarkup.architecture-document",
      revisionId: architectureInput.revision.revisionId,
      schemaVersion: 3,
      visualHash: sha256Text("solution-revision-visual"),
    },
    assumptions: [],
    contractVersion: 1,
    contracts: {
      contentHash: sha256Text("solution-contracts"),
      contractVersion: 1,
      recordHashes: [],
    },
    createdAt: assessedAt,
    createdBy: "actor-test",
    evidenceIdsAtFreeze: [],
    externalResources: {
      contentHash: sha256Text("external-resources"),
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
      reason: "Intent is independently reviewed in this coordinator fixture.",
      state: "not-applicable",
    },
    issueIdsAtFreeze: [],
    kind: "cloudmarkup.solution-revision-manifest",
    repositoryObservations: [],
    solutionRevisionId,
    sourceOwnership: paths.map((path) => ({
      conflictBehavior: "semantic-diff-and-review",
      ownerId: extensionId,
      ownership,
      path,
    })),
    unresolvedDecisionIds: [],
    versions: {
      applicationGenerator: notApplicableVersion,
      catalog: architectureInput.catalog,
      compiler: notApplicableVersion,
      diagramRenderer: notApplicableVersion,
      importer: notApplicableVersion,
      modelPrompt: {
        state: "pinned",
        tool: {
          id: "cloudmarkup.prompt-extension",
          version: "1.0.0",
        },
      },
      policy: [],
    },
    workload: {
      contentHash: sha256Text("workload-behavior"),
      contractVersion: 2,
    },
  });
}

const catalogSliceContent = JSON.stringify({
  catalog: architecture.catalog,
  entries: architecture.nodes.map(({ semantic }) => ({
    resourceType: semantic.resourceType,
    serviceType: semantic.serviceType,
  })),
});
const officialSchemaDocument = JSON.stringify({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  additionalProperties: false,
  properties: {},
  type: "object",
});

const staticExpectations = [
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

interface IacFixtureOptions {
  readonly maximumFiles?: number;
  readonly maximumTotalBytes?: number;
  readonly paths?: readonly string[];
  readonly targetFormat?: "terraform" | "cloudformation";
}

function iacFixture(options: IacFixtureOptions = {}) {
  const targetFormat = options.targetFormat ?? "terraform";
  const paths = options.paths ?? [
    targetFormat === "terraform"
      ? "infrastructure/extensions/custom.tf"
      : "infrastructure/extensions/custom.json",
  ];
  const sourceReference = {
    kind: "architecture-node" as const,
    referenceId: "node_worker",
  };
  const revision = solutionRevision(paths, "ai-authored");
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
      content: catalogSliceContent,
      entries: architecture.nodes.map(({ semantic }) => ({
        resourceType: semantic.resourceType,
        serviceType: semantic.serviceType,
      })),
      sliceDigest: sha256Text(catalogSliceContent),
    },
    existingFiles: [],
    extensionId,
    extensionSlotId,
    kind: "iac-extension" as const,
    language: targetFormat === "terraform" ? "language.hcl" : "language.json",
    limits: {
      maximumCandidateFileBytes: 16_384,
      maximumCandidateFiles: options.maximumFiles ?? paths.length,
      maximumCandidateTotalBytes: options.maximumTotalBytes ?? 32_768,
      maximumDependencyRequests: 0,
      maximumExpectedTests: 0,
      maximumRepairAttempts: 2,
      maximumResourceCount: 4,
    },
    officialSchemas: [
      {
        document: officialSchemaDocument,
        schemaDigest: sha256Text(officialSchemaDocument),
        schemaId: "schema.iac-extension",
        schemaVersion: "1.0.0",
      },
    ],
    ownedPaths: paths,
    ownedResourceAddresses: ["aws_cloudwatch_log_group.custom"],
    protectedPaths: ["infrastructure/generated/main.tf"],
    protectedResourceAddresses: ["aws_lambda_function.canonical-worker"],
    requestedBehavior: {
      acceptanceCriteria: ["The candidate remains review-only."],
      objective: "Generate one bounded infrastructure extension.",
      requirements: ["Preserve deterministic compiler resources."],
    },
    runtimeFamily: "runtime.iac-extension",
    sourceReferences: [sourceReference],
    targetFormat,
    validationExpectations: staticExpectations,
  };
  const request = modelIacExtensionGenerationRequestV1Schema.parse({
    acceptanceCriteria: generationContext.requestedBehavior.acceptanceCriteria,
    architecture,
    boundary: {
      approvalPathIds: ["extension.iac"],
      boundaryId: extensionId,
      ownedPaths: paths,
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
      ownedPaths: paths,
      solutionRevisionId,
      sourceOwnership: revision.sourceOwnership,
    },
    sourceReferences: [sourceReference],
    targetFormat,
    validationExpectations: staticExpectations,
  });
  const extension = candidateExtensionAuthorityV1Schema.parse({
    id: extensionId,
    ownedPaths: paths.map((path) => ({ conflictPolicy: "fail", path })),
    regenerationPolicy: "replace-owned-exact",
    request: {
      acceptanceCriteria: ["The candidate remains review-only."],
      capabilityIds: ["infrastructure.custom-extension"],
      constraints: ["Preserve deterministic compiler resources."],
      objective: "Generate one bounded infrastructure extension.",
      prohibitedCapabilities: ["deployment.execute"],
    },
    reservationId: "reservation-custom-1",
    sourceReferences: [{ kind: "architecture-node", nodeId: "node_worker" }],
    target: {
      extensionSlotId,
      fileType:
        targetFormat === "terraform"
          ? "infrastructure.hcl"
          : "infrastructure.json",
      kind: "iac-extension",
      language: targetFormat === "terraform" ? "language.hcl" : "language.json",
      targetFormat,
    },
  });
  return { extension, request };
}
function iacSolutionContractFixture() {
  const fixture = iacFixture();
  const contractArchitecture = architectureDocumentV3Schema.parse({
    ...fixture.request.architecture,
    applicationContracts: {
      ...fixture.request.architecture.applicationContracts,
      contracts: [
        {
          authenticationMethod: "none",
          claims: [],
          contractId: "cloudmarkup.contract.custom-extension",
          contractKind: "auth",
          contractVersion: "1.0.0",
          displayName: "Custom extension authorization",
          provenance: {
            recordedAt: assessedAt,
            recordedBy: "actor-test",
            source: "designed",
            sourceReferenceIds: ["requirement-custom-extension"],
          },
          roles: [],
        },
      ],
    },
  });
  const contract = contractArchitecture.applicationContracts.contracts[0];
  if (contract === undefined) {
    throw new Error("Missing exact Application Contract fixture.");
  }
  const contractDigest = getApplicationContractRecordContentHash(contract);
  const revision = solutionRevisionManifestV1Schema.parse({
    ...fixture.request.solutionRevision,
    contracts: {
      contentHash: getApplicationContractsContentHash(
        contractArchitecture.applicationContracts,
      ),
      contractVersion: 1,
      recordHashes: [contractDigest],
    },
  });
  const sourceReference = {
    digest: contractDigest,
    kind: "solution-contract" as const,
    referenceId: contract.contractId,
  };
  const generationContext = {
    ...fixture.request.generationContext,
    sourceReferences: [sourceReference],
  };
  const request = modelIacExtensionGenerationRequestV1Schema.parse({
    ...fixture.request,
    architecture: contractArchitecture,
    generationContext,
    generationContextDigest: digestCanonicalValue(generationContext),
    solutionRevision: revision,
    sourceReferences: [sourceReference],
  });
  const extension = candidateExtensionAuthorityV1Schema.parse({
    ...fixture.extension,
    sourceReferences: [
      {
        contractId: contract.contractId,
        contractVersion: contract.contractVersion,
        digest: contractDigest,
        kind: "solution-contract",
      },
    ],
  });
  return { contract, contractDigest, extension, request };
}

function applicationFixture(input: { readonly userOwnedPatch?: boolean } = {}) {
  const paths = [
    "application/extensions/custom.ts",
    "application/extensions/custom.test.ts",
  ] as const;
  const userOwnedContent = "export const existingUserBehavior = 1;\n";
  const userOwnedDigest = sha256Text(userOwnedContent);
  const baseWorkload = architecture.workloadBehavior.workloads[0];
  if (baseWorkload === undefined) {
    throw new Error("The shared architecture fixture requires one workload.");
  }
  const extensionReference = {
    digest: sha256Text("workload-extension-authority"),
    extensionContractVersion: 1 as const,
    extensionId,
    ownership: "ai-authored" as const,
    validationEvidenceIds: ["evidence-authority-1"],
  };
  const applicationExpectations = [
    ...staticExpectations,
    {
      checkId: "extension.build",
      kind: "build" as const,
      required: true,
      successCondition: "must-pass" as const,
      toolProfileId: "cloudmarkup.extension-build",
    },
    {
      checkId: "extension.unit-test",
      kind: "unit-test" as const,
      required: true,
      successCondition: "must-pass" as const,
      toolProfileId: "cloudmarkup.extension-unit-test",
    },
    {
      checkId: "extension.contract-test",
      kind: "contract-test" as const,
      required: true,
      successCondition: "must-pass" as const,
      toolProfileId: "cloudmarkup.extension-contract-test",
    },
  ];
  const workload = workloadV2Schema.parse({
    ...baseWorkload,
    compatibility: {
      applicationGenerators: [],
      modelGateways: [
        {
          modelFamily: "model.fixture-family",
          modelGatewayContractVersion: "1.0.0",
          promptDigest,
          promptTemplateId: "cloudmarkup.prompt-extension",
          promptVersion: "1.0.0",
          requiredValidation: applicationExpectations.map(({ kind }) => kind),
          supportedMode: "ai-assisted-custom",
        },
      ],
    },
    extensionPoints: paths.map((path, index) => ({
      conflictBehavior: "require-reviewed-resolution",
      extensionPointId:
        index === 0
          ? "cloudmarkup.extension-point.handler"
          : "cloudmarkup.extension-point.test",
      kind: index === 0 ? "handler" : "test",
      path,
      permittedOwnership:
        input.userOwnedPatch === true && index === 0
          ? ["user-owned"]
          : ["ai-authored"],
    })),
    extensions: [extensionReference],
    implementation: {
      extension: extensionReference,
      handler: "src/handler.main",
      mode: "ai-assisted-custom",
      runtimeFamily: "example.runtime.nodejs",
      sourceOwnership: "ai-authored",
    },
    implementationRequirements: [],
    languageFamily: "language.typescript",
    provenance: {
      recordedAt: assessedAt,
      recordedBy: "actor-test",
      source: "manual",
    },
    sourceOwnership: paths.map((path, index) =>
      input.userOwnedPatch === true && index === 0
        ? {
            conflictBehavior: "preserve-user-content",
            declarationId: `ownership-declaration-${String(index + 1)}`,
            extensionPointId: "cloudmarkup.extension-point.handler",
            ownerId: "application.user-owner",
            ownership: "user-owned",
            path,
            pathKind: "file",
            regeneration: "never",
            semanticDiff: { strategy: "structured-language" },
          }
        : {
            conflictBehavior: "require-reviewed-resolution",
            declarationId: `ownership-declaration-${String(index + 1)}`,
            extensionPointId:
              index === 0
                ? "cloudmarkup.extension-point.handler"
                : "cloudmarkup.extension-point.test",
            ownerId: extensionId,
            ownership: "ai-authored",
            path,
            pathKind: "file",
            regeneration: "require-reviewed-operation",
            semanticDiff: { strategy: "byte-exact" },
          },
    ),
    unresolvedRequirementIds: [],
  });
  const applicationArchitecture = architectureDocumentV3Schema.parse({
    ...architecture,
    workloadBehavior: {
      contractVersion: 2,
      workloads: [workload],
    },
  });
  const baseRevision = solutionRevision(
    paths,
    "ai-authored",
    applicationArchitecture,
  );
  const revision =
    input.userOwnedPatch === true
      ? solutionRevisionManifestV1Schema.parse({
          ...baseRevision,
          sourceOwnership: baseRevision.sourceOwnership.map((entry, index) =>
            index === 0
              ? {
                  ...entry,
                  conflictBehavior: "preserve-user-content",
                  contentHash: userOwnedDigest,
                  ownerId: "application.user-owner",
                  ownership: "user-owned",
                }
              : entry,
          ),
        })
      : baseRevision;
  const sourceReference = {
    kind: "workload" as const,
    referenceId: workload.id,
  };
  const generationContext = {
    allowedDependencies: [],
    allowedProviders: [],
    allowedResources: [],
    catalogSlice: {
      catalog: applicationArchitecture.catalog,
      content: catalogSliceContent,
      entries: applicationArchitecture.nodes.map(({ semantic }) => ({
        resourceType: semantic.resourceType,
        serviceType: semantic.serviceType,
      })),
      sliceDigest: sha256Text(catalogSliceContent),
    },
    existingFiles:
      input.userOwnedPatch === true
        ? [
            {
              content: userOwnedContent,
              contentDigest: userOwnedDigest,
              noSecretValues: true as const,
              ownership: "user-owned" as const,
              path: paths[0],
              redactionStatus: "not-required" as const,
              sizeBytes: new TextEncoder().encode(userOwnedContent).byteLength,
            },
          ]
        : [],
    extensionId,
    extensionPointId: "cloudmarkup.extension-point.handler",
    kind: "application" as const,
    language: "language.typescript",
    limits: {
      maximumCandidateFileBytes: 16_384,
      maximumCandidateFiles: paths.length,
      maximumCandidateTotalBytes: 32_768,
      maximumDependencyRequests: 0,
      maximumExpectedTests: 4,
      maximumRepairAttempts: 2,
      maximumResourceCount: 0,
    },
    officialSchemas: [
      {
        document: officialSchemaDocument,
        schemaDigest: sha256Text(officialSchemaDocument),
        schemaId: "schema.application-extension",
        schemaVersion: "1.0.0",
      },
    ],
    ownedPaths: paths,
    ownedResourceAddresses: [],
    protectedPaths: ["application/generated/router.ts"],
    protectedResourceAddresses: [],
    requestedBehavior: {
      acceptanceCriteria: ["Unit and contract behavior pass."],
      objective: "Implement the exact custom workload behavior.",
      requirements: ["Preserve canonical bindings and contracts."],
    },
    runtimeFamily: "example.runtime.nodejs",
    sourceReferences: [sourceReference],
    validationExpectations: applicationExpectations,
    workloadId: workload.id,
  };
  const modelRequest = modelApplicationSourceGenerationRequestV1Schema.parse({
    acceptanceCriteria: generationContext.requestedBehavior.acceptanceCriteria,
    architecture: applicationArchitecture,
    boundary: {
      approvalPathIds: ["extension.application"],
      boundaryId: extensionId,
      ownedPaths: paths,
      writeAuthority: "candidate-artifacts-only",
    },
    contractVersion: 1,
    generationContext,
    generationContextDigest: digestCanonicalValue(generationContext),
    operation: "application-source.generate" as const,
    requestedMode: "guided" as const,
    solutionRevision: revision,
    sourceOwnershipAuthority: {
      authority: "solution-revision-candidate-generation" as const,
      candidateRoots: ["application" as const],
      canonicalization:
        "cloudmarkup.solution-source-ownership.canonical-json.v1" as const,
      ownedPaths: paths,
      solutionRevisionId,
      sourceOwnership: revision.sourceOwnership,
    },
    sourceReferences: [sourceReference],
    validationExpectations: applicationExpectations,
    workloadId: workload.id,
  });
  const extension = candidateExtensionAuthorityV1Schema.parse({
    id: extensionId,
    ownedPaths: paths.map((path, index) =>
      input.userOwnedPatch === true && index === 0
        ? {
            conflictPolicy: "propose-patch",
            path,
            priorDigest: userOwnedDigest,
          }
        : { conflictPolicy: "fail", path },
    ),
    regenerationPolicy:
      input.userOwnedPatch === true ? "propose-patch" : "replace-owned-exact",
    request: {
      acceptanceCriteria: ["Unit and contract behavior pass."],
      capabilityIds: ["application.custom-handler"],
      constraints: ["Preserve canonical bindings and contracts."],
      objective: "Implement the exact custom workload behavior.",
      prohibitedCapabilities: ["deployment.execute"],
    },
    reservationId: "reservation-custom-1",
    sourceReferences: [{ kind: "workload", workloadId: workload.id }],
    target: {
      fileType: "source.typescript",
      kind: "application",
      language: "language.typescript",
      workloadId: workload.id,
    },
  });
  return { extension, request: modelRequest, workload };
}

type GenerationRequest =
  | ModelRequestFor<"application-source.generate">
  | ModelRequestFor<"iac-extension.generate">;

function ownedPath(request: GenerationRequest, index: number): string {
  const path = request.boundary.ownedPaths[index];
  if (path === undefined) {
    throw new Error(`Missing owned candidate path ${String(index)}.`);
  }
  return path;
}

interface CandidateFileInput {
  readonly candidateId?: string;
  readonly content: string;
  readonly path: string;
  readonly priorDigest?: ReturnType<typeof sha256Text>;
  readonly stepId?: string;
}

function candidateBundle(
  request: GenerationRequest,
  files: readonly CandidateFileInput[],
  options: {
    readonly includeUnresolved?: boolean;
  } = {},
): ModelCandidateBundleV1 {
  const sourceReferences = request.sourceReferences;
  return modelCandidateBundleV1Schema.parse({
    assumptions: [],
    boundary: request.boundary,
    candidates: files.map((file, index) => ({
      candidateId: file.candidateId ?? `candidate-${String(index + 1)}`,
      content: file.content,
      contentDigest: sha256Text(file.content),
      encoding: "utf-8",
      kind: "file",
      ownership: "ai-authored-candidate",
      path: file.path,
      ...(file.priorDigest === undefined
        ? {}
        : { priorDigest: file.priorDigest }),
    })),
    dependencies: [],
    expectedTests:
      request.operation === "application-source.generate"
        ? [
            {
              description: "The custom handler satisfies its unit behavior.",
              expectedTestId: "expected-test-unit",
              kind: "unit-test",
              sourceReferences,
              targetPaths: [files[0]?.path],
              validationCheckId: "extension.unit-test",
            },
            {
              description: "The custom handler satisfies its contract.",
              expectedTestId: "expected-test-contract",
              kind: "contract-test",
              sourceReferences,
              targetPaths: [files[1]?.path],
              validationCheckId: "extension.contract-test",
            },
          ]
        : [],
    generationPlan: {
      objective: "Create only exact candidate-owned extension files.",
      planId: "candidate-generation-plan",
      steps: files.map((file, index) => ({
        action:
          file.priorDigest === undefined ? "create-file" : "replace-owned-file",
        rationale: "Implement the exact reviewed behavior.",
        sourceReferences,
        stepId: file.stepId ?? `candidate-step-${String(index + 1)}`,
        targetPath: file.path,
      })),
    },
    provenance: {
      contractVersion: 1,
      gatewayId: "cloudmarkup.model-gateway",
      inputDigest: sha256Text("unbound-input"),
      invocationId: "unbound-invocation",
      modelId: "model.fixture",
      modelVersion: "2026-08-21",
      ownership: "untrusted-proposal",
      promptDigest,
      promptTemplateId: "cloudmarkup.prompt-extension",
      promptVersion: "1.0.0",
      providerId: "provider.fixture",
    },
    unresolvedItems: options.includeUnresolved
      ? [
          {
            blocking: false,
            detail: "The caller must choose ownership before completion.",
            question: "Who owns the unresolved custom behavior?",
            sourceReferences,
            unresolvedItemId: "unresolved-custom-ownership",
          },
        ]
      : [],
    validationExpectations: request.validationExpectations,
  });
}

function userOwnedPatchBundle(fixture: ReturnType<typeof applicationFixture>): {
  readonly bundle: ModelCandidateBundleV1;
  readonly proposedContent: string;
} {
  const path = ownedPath(fixture.request, 0);
  const generationContext = fixture.request.generationContext;
  if (generationContext?.kind !== "application") {
    throw new Error("Missing exact application generation context.");
  }
  const existing = generationContext.existingFiles.find(
    (file) => file.path === path,
  );
  if (existing?.ownership !== "user-owned") {
    throw new Error("Missing exact user-owned patch base.");
  }
  const proposedContent = "export const existingUserBehavior = 2;\n";
  const baseBundle = candidateBundle(fixture.request, [
    {
      content: proposedContent,
      path,
      priorDigest: existing.contentDigest,
    },
    {
      content: "export const contractTest = () => true;\n",
      path: ownedPath(fixture.request, 1),
    },
  ]);
  const patchCandidate = {
    baseDigest: existing.contentDigest,
    candidateId: baseBundle.candidates[0]?.candidateId ?? "candidate-1",
    kind: "patch" as const,
    ownership: "ai-authored-candidate" as const,
    path,
    proposedResultDigest: sha256Text(proposedContent),
    unifiedDiff: [
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1 +1 @@",
      "-export const existingUserBehavior = 1;",
      "+export const existingUserBehavior = 2;",
      "",
    ].join("\n"),
  };
  const firstStep = baseBundle.generationPlan.steps[0];
  if (firstStep === undefined) {
    throw new Error("Missing user-owned patch plan step.");
  }
  return {
    bundle: modelCandidateBundleV1Schema.parse({
      ...baseBundle,
      candidates: [patchCandidate, ...baseBundle.candidates.slice(1)],
      generationPlan: {
        ...baseBundle.generationPlan,
        steps: [
          { ...firstStep, action: "propose-patch" },
          ...baseBundle.generationPlan.steps.slice(1),
        ],
      },
    }),
    proposedContent,
  };
}
function invocationContext(
  request: GenerationRequest,
  invocationId: string,
  acceptedMaximumCreditUnits = 20,
): ModelGatewayInvocationContextV1 {
  return {
    budget: {
      acceptedEstimateMaximumCreditUnits: acceptedMaximumCreditUnits,
      allowed: true,
      availableCreditUnits: 100,
      decisionId: "budget-decision-test",
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
      decisionId: "entitlement-decision-test",
      planKey: "pro",
      planVersionId: "plan-version-test",
    },
    evaluationPolicyId: "cloudmarkup.model-evaluation",
    evaluationPolicyVersion: "1.0.0",
    idempotencyKeyDigest: sha256Text(`idempotency:${invocationId}`),
    invocationId,
    requestedMode: request.requestedMode,
    scope: {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      solutionRevisionId: request.solutionRevision.solutionRevisionId,
      userId: "user-test",
    },
  };
}

function descriptor(
  operation: ModelGatewayOperationV1,
  request: object,
  context: ModelGatewayInvocationContextV1,
) {
  const inputDigest = digestCanonicalValue({ request, scope: context.scope });
  const digest = sha256Text("routing-authority");
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
    modelVersion: "2026-08-21",
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
    completedAt: "2026-08-21T12:00:01.000Z",
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
    usageRecordId: stableRecordId("usage", {
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
    | {
        readonly sourceReferences: readonly unknown[];
      }
    | undefined;
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
      rationale:
        "The deterministic fixture binds the exact supplied authority.",
    },
    unknowns: [],
  };
}

function topLevelProvenance(
  invocationDescriptor: ReturnType<typeof descriptor>,
) {
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
  request: ModelRequestFor<"application-source.generate">,
  context: ModelGatewayInvocationContextV1,
  bundle: ModelCandidateBundleV1,
): ModelGatewayResultV1<"application-source.generate">;
function generationResult(
  request: ModelRequestFor<"iac-extension.generate">,
  context: ModelGatewayInvocationContextV1,
  bundle: ModelCandidateBundleV1,
): ModelGatewayResultV1<"iac-extension.generate">;
function generationResult(
  request: GenerationRequest,
  context: ModelGatewayInvocationContextV1,
  bundle: ModelCandidateBundleV1,
):
  | ModelGatewayResultV1<"application-source.generate">
  | ModelGatewayResultV1<"iac-extension.generate"> {
  const invocationDescriptor = descriptor(request.operation, request, context);
  const responseInput = {
    candidateBundle: boundBundle(bundle, invocationDescriptor),
    contractVersion: 1,
    proposalContext: proposalContext(request),
    provenance: topLevelProvenance(invocationDescriptor),
  };
  if (request.operation === "application-source.generate") {
    return {
      descriptor: invocationDescriptor,
      redaction: { categories: [], redactedValueCount: 0 },
      response: modelApplicationSourceGenerationResponseV1Schema.parse({
        ...responseInput,
        operation: request.operation,
      }),
      usage: usage(request.operation, context, invocationDescriptor),
    };
  }
  return {
    descriptor: invocationDescriptor,
    redaction: { categories: [], redactedValueCount: 0 },
    response: modelIacExtensionGenerationResponseV1Schema.parse({
      ...responseInput,
      operation: request.operation,
    }),
    usage: usage(request.operation, context, invocationDescriptor),
  };
}

function repairResult(
  request: ModelRequestFor<"candidate.repair">,
  context: ModelGatewayInvocationContextV1,
  bundle: ModelCandidateBundleV1,
): ModelGatewayResultV1<"candidate.repair"> {
  const invocationDescriptor = descriptor("candidate.repair", request, context);
  return {
    descriptor: invocationDescriptor,
    redaction: { categories: [], redactedValueCount: 0 },
    response: modelCandidateRepairResponseV1Schema.parse({
      candidateBundle: boundBundle(bundle, invocationDescriptor),
      contractVersion: 1,
      operation: "candidate.repair",
      proposalContext: proposalContext(request),
      provenance: topLevelProvenance(invocationDescriptor),
      repairedFromDigest: request.failedOutputDigest,
      resolvedDiagnosticIds: request.diagnostics.map(
        ({ diagnosticId }) => diagnosticId,
      ),
    }),
    usage: usage("candidate.repair", context, invocationDescriptor),
  };
}

class QueuedCandidateGateway implements CandidateModelGateway {
  public readonly calls: {
    readonly context: ModelGatewayInvocationContextV1;
    readonly operation: ModelGatewayOperationV1;
    readonly request: unknown;
  }[] = [];

  readonly #generationBundles: ModelCandidateBundleV1[];
  readonly #generationErrors: Error[];
  readonly #repairBundles: ModelCandidateBundleV1[];
  readonly #repairErrors: Error[];

  public constructor(
    input: {
      readonly generationBundles?: readonly ModelCandidateBundleV1[];
      readonly generationErrors?: readonly Error[];
      readonly repairBundles?: readonly ModelCandidateBundleV1[];
      readonly repairErrors?: readonly Error[];
    } = {},
  ) {
    this.#generationBundles = structuredClone([
      ...(input.generationBundles ?? []),
    ]);
    this.#generationErrors = [...(input.generationErrors ?? [])];
    this.#repairBundles = structuredClone([...(input.repairBundles ?? [])]);
    this.#repairErrors = [...(input.repairErrors ?? [])];
  }

  public generateApplicationSourceCandidate(
    request: ModelRequestFor<"application-source.generate">,
    context: ModelGatewayInvocationContextV1,
  ): Promise<ModelGatewayResultV1<"application-source.generate">> {
    this.calls.push({ context, operation: request.operation, request });
    const queuedError = this.#generationErrors.shift();
    if (queuedError !== undefined) {
      return Promise.reject(queuedError);
    }
    const bundle = this.#generationBundles.shift();
    if (bundle === undefined) {
      return Promise.reject(new Error("Missing queued application bundle."));
    }
    return Promise.resolve(generationResult(request, context, bundle));
  }

  public generateIacExtensionCandidate(
    request: ModelRequestFor<"iac-extension.generate">,
    context: ModelGatewayInvocationContextV1,
  ): Promise<ModelGatewayResultV1<"iac-extension.generate">> {
    this.calls.push({ context, operation: request.operation, request });
    const queuedError = this.#generationErrors.shift();
    if (queuedError !== undefined) {
      return Promise.reject(queuedError);
    }
    const bundle = this.#generationBundles.shift();
    if (bundle === undefined) {
      return Promise.reject(new Error("Missing queued IaC bundle."));
    }
    return Promise.resolve(generationResult(request, context, bundle));
  }

  public repairCandidate(
    request: ModelRequestFor<"candidate.repair">,
    context: ModelGatewayInvocationContextV1,
  ): Promise<ModelGatewayResultV1<"candidate.repair">> {
    this.calls.push({ context, operation: request.operation, request });
    const queuedError = this.#repairErrors.shift();
    if (queuedError !== undefined) {
      return Promise.reject(queuedError);
    }
    const bundle = this.#repairBundles.shift();
    if (bundle === undefined) {
      return Promise.reject(new Error("Missing queued repair bundle."));
    }
    return Promise.resolve(repairResult(request, context, bundle));
  }
}

class PassingCandidateValidator implements CandidateTargetValidationPort {
  public readonly calls: CandidateTargetValidationInput[] = [];

  public validate(input: CandidateTargetValidationInput) {
    this.calls.push(structuredClone(input));
    const application = input.generationContext.kind === "application";
    const evidenceLevel = application
      ? ({ kind: "application-build-and-tests", rank: 5 } as const)
      : ({ kind: "ai-extension-parse-static-validity", rank: 4 } as const);
    const evidence = evidenceRecordV1Schema.parse({
      artifacts: [
        {
          digest: input.artifact.artifactDigest,
          mediaType:
            "application/vnd.cloudmarkup.ai-extension-candidate.v1+json",
          sizeBytes: input.files.reduce((sum, file) => sum + file.sizeBytes, 0),
        },
      ],
      checks: [
        {
          artifactDigests: [input.artifact.artifactDigest],
          checkId: application
            ? "cloudmarkup.application-build-and-tests"
            : "cloudmarkup.ai-extension-parse-static",
          generationCoverageRequirement: application
            ? "application-build-and-tests"
            : "ai-extension-parse-static-validity",
          issueIds: [],
          status: "passed",
          summary: "The deterministic target fixture passed.",
        },
        ...(application
          ? [
              {
                artifactDigests: [input.artifact.artifactDigest],
                checkId: "cloudmarkup.application-security-checks",
                generationCoverageRequirement:
                  "application-security-checks" as const,
                issueIds: [],
                status: "passed" as const,
                summary:
                  "The deterministic application security fixture passed.",
              },
            ]
          : []),
      ],
      contractVersion: 1,
      environment: { environmentType: "test" },
      id: stableRecordId("evidence-target", {
        artifactDigest: input.artifact.artifactDigest,
        level: evidenceLevel,
      }),
      layer: "generated",
      level: evidenceLevel,
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
          tool: {
            id: "cloudmarkup.fixture-target-validator",
            version: "1.0.0",
          },
        },
        createdAt: input.assessedAt,
        inputDigests: [
          input.artifact.artifactDigest,
          input.artifact.bundleDigest,
        ],
      },
      solutionRevisionId: input.solutionRevision.solutionRevisionId,
      staleness: { assessedAt: input.assessedAt, state: "current" },
      tools: [{ id: "cloudmarkup.fixture-target-validator", version: "1.0.0" }],
    });
    return Promise.resolve(
      candidateTargetValidationResultV1Schema.parse({
        diagnostics: [],
        evidence: [evidence],
        outcomes: input.generationContext.validationExpectations.map(
          ({ kind }) => ({ kind, result: "passed", toolVersion: "1.0.0" }),
        ),
        representationDigest: digestCanonicalValue(
          input.files.map(({ digest, path }) => ({ digest, path })),
        ),
        state: "passed",
      }),
    );
  }
}

class DiagnosticCandidateValidator implements CandidateTargetValidationPort {
  public calls = 0;
  private unavailable = false;
  private resolution:
    Readonly<{ checkId: string; issueId: string }> | undefined;

  public resolveWith(issueId: string, checkId: string): void {
    this.resolution = { checkId, issueId };
  }

  public makeUnavailable(): void {
    this.unavailable = true;
  }

  public async validate(input: CandidateTargetValidationInput) {
    this.calls += 1;
    if (this.unavailable) {
      throw new Error("The configured production target is not ready.");
    }
    if (this.resolution !== undefined) {
      return new IssueLinkedPassingValidator(
        this.resolution.issueId,
        this.resolution.checkId,
      ).validate(input);
    }
    const passing = await new PassingCandidateValidator().validate(input);
    return candidateTargetValidationResultV1Schema.parse({
      ...passing,
      diagnostics: [
        {
          category: "format",
          checkId: "extension.format",
          code: "cloudmarkup.fixture.edit-required",
          path: input.files[0]?.path,
          repairable: false,
          severity: "error",
          summary: "The candidate requires a reviewed user edit.",
          technicalDetail:
            "The deterministic fixture keeps this issue current until the exact edit is revalidated.",
        },
      ],
      state: "failed",
    });
  }
}

class IssueLinkedPassingValidator implements CandidateTargetValidationPort {
  private readonly checkId: string;
  private readonly issueId: string;

  public constructor(issueId: string, checkId: string) {
    this.issueId = issueId;
    this.checkId = checkId;
  }

  public async validate(input: CandidateTargetValidationInput) {
    const passing = await new PassingCandidateValidator().validate(input);
    const basis = passing.evidence[0];
    if (basis === undefined)
      throw new Error("Missing passing Evidence fixture.");
    const evidence = evidenceRecordV1Schema.parse({
      ...basis,
      checks: [
        ...basis.checks,
        {
          artifactDigests: [input.artifact.artifactDigest],
          checkId: this.checkId,
          issueIds: [this.issueId],
          status: "passed",
          summary: "The exact edited candidate check passed.",
        },
      ],
      id: stableRecordId("evidence-edited-candidate-closure", {
        artifactDigest: input.artifact.artifactDigest,
        issueId: this.issueId,
      }),
    });
    return candidateTargetValidationResultV1Schema.parse({
      ...passing,
      evidence: [evidence],
    });
  }
}
class RecordingReviewAuthorization implements CandidateReviewAuthorizationPort {
  public readonly calls: CandidateReviewAuthorizationRequestV1[] = [];

  public authorize(request: CandidateReviewAuthorizationRequestV1) {
    this.calls.push(structuredClone(request));
    return Promise.resolve({
      action: request.action,
      allowed: true as const,
      authoritySource: "verified-authentication-context" as const,
      contractVersion: 1 as const,
      decidedAt: assessedAt,
      decisionId: stableRecordId("candidate-review-authorization", request),
      principalId: "actor-reviewer",
      requestDigest: getCandidateReviewAuthorizationRequestDigest(request),
    });
  }
}

class UnsupportedCandidateValidator implements CandidateTargetValidationPort {
  public calls = 0;

  public validate(): Promise<never> {
    this.calls += 1;
    return Promise.reject(
      new Error("The configured production target is not ready."),
    );
  }
}

function coordinatorHarness(
  input: {
    readonly authorization?: CandidateReviewAuthorizationPort;
    readonly gateway?: QueuedCandidateGateway;
    readonly applicationValidator?: CandidateTargetValidationPort;
    readonly cloudformationValidator?: CandidateTargetValidationPort;
    readonly terraformValidator?: CandidateTargetValidationPort;
  } = {},
) {
  const artifactStore = new InMemoryCandidateArtifactStore();
  const authorization =
    input.authorization ?? new RecordingReviewAuthorization();
  const gateway = input.gateway ?? new QueuedCandidateGateway();
  const applicationValidator =
    input.applicationValidator ?? new PassingCandidateValidator();
  const cloudformationValidator =
    input.cloudformationValidator ?? new PassingCandidateValidator();
  const terraformValidator =
    input.terraformValidator ?? new PassingCandidateValidator();
  const validators = {
    application: applicationValidator,
    cloudformation: cloudformationValidator,
    terraform: terraformValidator,
  };
  const coordinator = createAiExtensionGenerationCoordinator({
    artifactStore,
    gateway,
    validators,
  });
  const reviewService = createCandidateReviewService({
    artifactStore,
    authorization,
    validators,
  });
  return {
    applicationValidator,
    artifactStore,
    authorization,
    cloudformationValidator,
    coordinator,
    gateway,
    reviewService,
    terraformValidator,
  };
}

function customInput(
  fixture:
    ReturnType<typeof applicationFixture> | ReturnType<typeof iacFixture>,
  options: {
    readonly acceptedMaximumCreditUnits?: number;
    readonly attemptEstimateCreditUnits?: readonly number[];
    readonly authority?: CustomCandidateGenerationInputV1["authority"];
    readonly commercialAuthority?: unknown;
    readonly extension?: unknown;
    readonly maximumRepairAttempts?: number;
    readonly repairAcceptedMaximumCreditUnits?: readonly number[];
    readonly repairContexts?: readonly ModelGatewayInvocationContextV1[];
  } = {},
): CustomCandidateGenerationInputV1 {
  const maximumRepairAttempts = options.maximumRepairAttempts ?? 0;
  const modelContext = invocationContext(
    fixture.request,
    "invocation-generation-1",
    options.acceptedMaximumCreditUnits ?? 20,
  );
  const repairContexts =
    options.repairContexts ??
    Array.from({ length: maximumRepairAttempts }, (_, index) =>
      invocationContext(
        fixture.request,
        `invocation-repair-${String(index + 1)}`,
        options.repairAcceptedMaximumCreditUnits?.[index] ??
          options.acceptedMaximumCreditUnits ??
          20,
      ),
    );
  return {
    ...(fixture.request.operation === "application-source.generate" &&
    "workload" in fixture
      ? { applicationWorkload: fixture.workload }
      : {}),
    assessedAt,
    authority:
      options.authority ??
      (fixture.request.operation === "application-source.generate"
        ? "ai-assisted-custom"
        : "approved-iac-extension"),
    commercialAuthority: options.commercialAuthority ?? {
      acceptedWorkflowEstimateMaximumCreditUnits:
        options.acceptedMaximumCreditUnits ?? 20,
      attemptEstimateCreditUnits:
        options.attemptEstimateCreditUnits ??
        Array.from({ length: maximumRepairAttempts + 1 }, () => 1),
      reservationId: fixture.extension.reservationId,
    },
    extension: options.extension ?? fixture.extension,
    maximumRepairAttempts,
    modelContext,
    modelRequest: fixture.request,
    repairContexts,
    scope,
  };
}

function requireReview(
  result: Awaited<
    ReturnType<ReturnType<typeof coordinatorHarness>["coordinator"]["generate"]>
  >,
) {
  if (!("reviewId" in result)) {
    throw new Error("Expected a candidate review record.");
  }
  return result;
}

function requireFailure(
  result: Awaited<
    ReturnType<ReturnType<typeof coordinatorHarness>["coordinator"]["generate"]>
  >,
) {
  if (!("invalidArtifact" in result)) {
    throw new Error("Expected a rejected candidate generation record.");
  }
  return result;
}

function redigestCandidateReview(
  review: CandidateReviewRecordV1,
  changes: Partial<Omit<CandidateReviewRecordV1, "reviewDigest">>,
) {
  const { reviewDigest: _reviewDigest, ...current } = review;
  void _reviewDigest;
  const projection = { ...current, ...changes };
  return {
    ...projection,
    reviewDigest: digestCanonicalValue(projection),
  };
}

function redigestEditRevalidation(
  revalidation: CandidateEditRevalidationFinalizationV1,
  changes: Partial<
    Omit<CandidateEditRevalidationFinalizationV1, "finalizationDigest">
  >,
): CandidateEditRevalidationFinalizationV1 {
  const { finalizationDigest: _finalizationDigest, ...current } = revalidation;
  void _finalizationDigest;
  const projection = { ...current, ...changes };
  return {
    ...projection,
    finalizationDigest:
      getCandidateEditRevalidationFinalizationDigest(projection),
  };
}

function expectEditAuthorityRejected(review: unknown): void {
  const parsed = candidateReviewRecordV1Schema.safeParse(review);
  expect(parsed.success).toBe(false);
  if (!parsed.success) {
    expect(
      parsed.error.issues.some(({ path }) => path[0] === "editRevalidations"),
    ).toBe(true);
  }
}

describe("AI extension generation coordinator", () => {
  it("bypasses the model, validators, and stores for deterministic catalog behavior", async () => {
    const harness = coordinatorHarness();

    const result = await harness.coordinator.generate({
      authority: "deterministic-supported",
      solutionRevisionId,
      target: "application",
    });

    expect(result).toEqual({
      contractVersion: 1,
      modelInvocations: 0,
      solutionRevisionId,
      state: "deterministic-generator-required",
      target: "application",
      writeAuthority: "none",
    });
    expect(harness.gateway.calls).toHaveLength(0);
    expect(harness.artifactStore.artifactCount()).toBe(0);
    expect(harness.artifactStore.invalidArtifactCount()).toBe(0);
    expect(
      (harness.applicationValidator as PassingCandidateValidator).calls,
    ).toHaveLength(0);
  });

  it("returns a review-ready ai-assisted-custom application candidate", async () => {
    const fixture = applicationFixture();
    const bundle = candidateBundle(fixture.request, [
      {
        content: "export const handler = async () => ({ ok: true });\n",
        path: ownedPath(fixture.request, 0),
      },
      {
        content: "export const contractTest = () => true;\n",
        path: ownedPath(fixture.request, 1),
      },
    ]);
    const gateway = new QueuedCandidateGateway({ generationBundles: [bundle] });
    const harness = coordinatorHarness({ gateway });

    const review = requireReview(
      await harness.coordinator.generate(customInput(fixture)),
    );

    expect(review.state).toBe("ready-for-acceptance");
    expect(review.writeAuthority).toBe("none");
    expect(review.extension.acceptance.state).toBe("pending");
    expect(review.extension.exportSafety.state).toBe("not-safe");
    expect(review.expectedTests.map(({ kind }) => kind).sort()).toEqual([
      "contract-test",
      "unit-test",
    ]);
    expect(review.evidence.map(({ level }) => level.rank)).toEqual([4, 5]);
    expect(review.validation.every(({ result }) => result === "passed")).toBe(
      true,
    );
    expect(gateway.calls.map(({ operation }) => operation)).toEqual([
      "application-source.generate",
    ]);
    const storedReview = await harness.artifactStore.read({
      artifactId: review.artifact.artifactId,
      expectedArtifactDigest: review.artifact.artifactDigest,
      scope,
    });
    expect(storedReview.reviewBinding).toEqual(
      createCandidateArtifactReviewBinding({
        reference: review.artifact,
        review: {
          boundAt: review.artifact.storedAt,
          reviewDigest: review.reviewDigest,
          reviewId: review.reviewId,
        },
      }),
    );
    expect(harness.artifactStore.artifactCount()).toBe(1);
    expect(harness.artifactStore.invalidArtifactCount()).toBe(0);
  });

  it("fails closed when initial review storage cannot prove the exact immutable binding", async () => {
    const fixture = applicationFixture();
    const bundle = candidateBundle(fixture.request, [
      {
        content: "export const handler = async () => ({ ok: true });\n",
        path: ownedPath(fixture.request, 0),
      },
      {
        content: "export const contractTest = () => true;\n",
        path: ownedPath(fixture.request, 1),
      },
    ]);

    for (const behavior of ["missing", "divergent"] as const) {
      const backingStore = new InMemoryCandidateArtifactStore();
      const artifactStore: CandidateArtifactStore = {
        ...(behavior === "missing"
          ? {}
          : {
              bindReview: async (input) => ({
                ...(await backingStore.bindReview(input)),
                reviewDigest: sha256Text("divergent-review-binding"),
              }),
            }),
        preserveInvalid: (input) => backingStore.preserveInvalid(input),
        put: (input) => backingStore.put(input),
        read: (input) => backingStore.read(input),
      };
      const validator = new PassingCandidateValidator();
      const coordinator = createAiExtensionGenerationCoordinator({
        artifactStore,
        gateway: new QueuedCandidateGateway({ generationBundles: [bundle] }),
        validators: {
          application: validator,
          cloudformation: validator,
          terraform: validator,
        },
      });

      await expect(coordinator.generate(customInput(fixture))).rejects.toThrow(
        behavior === "missing"
          ? /does not support immutable review binding/u
          : /changed the immutable review binding/u,
      );
    }
  });

  it("rejects inspection and editing when the stored review binding is missing or divergent", async () => {
    const fixture = applicationFixture();
    const bundle = candidateBundle(fixture.request, [
      {
        content: "export const handler = async () => ({ ok: true });\n",
        path: ownedPath(fixture.request, 0),
      },
      {
        content: "export const contractTest = () => true;\n",
        path: ownedPath(fixture.request, 1),
      },
    ]);
    const harness = coordinatorHarness({
      gateway: new QueuedCandidateGateway({ generationBundles: [bundle] }),
    });
    const review = requireReview(
      await harness.coordinator.generate(customInput(fixture)),
    );
    const stored = await harness.artifactStore.read({
      artifactId: review.artifact.artifactId,
      expectedArtifactDigest: review.artifact.artifactDigest,
      scope,
    });
    const editableFile = stored.files[0];
    if (editableFile === undefined) {
      throw new Error("Expected an exact candidate file for binding checks.");
    }

    for (const behavior of ["missing", "divergent"] as const) {
      const artifactStore: CandidateArtifactStore = {
        preserveInvalid: (input) =>
          harness.artifactStore.preserveInvalid(input),
        put: (input) => harness.artifactStore.put(input),
        read: async (input) => {
          const current = await harness.artifactStore.read(input);
          if (behavior === "missing") {
            const { reviewBinding: _reviewBinding, ...withoutBinding } =
              current;
            void _reviewBinding;
            return withoutBinding;
          }
          if (current.reviewBinding === undefined) {
            throw new Error("Expected the generated review binding.");
          }
          return {
            ...current,
            reviewBinding: {
              ...current.reviewBinding,
              reviewDigest: sha256Text("divergent-operation-binding"),
            },
          };
        },
      };
      const validator = new PassingCandidateValidator();
      const reviewService = createCandidateReviewService({
        artifactStore,
        authorization: new RecordingReviewAuthorization(),
        validators: {
          application: validator,
          cloudformation: validator,
          terraform: validator,
        },
      });
      await expect(
        reviewService.inspect({
          expectedArtifactDigest: review.artifact.artifactDigest,
          expectedReviewDigest: review.reviewDigest,
          review,
          reviewId: review.reviewId,
          scope,
        }),
      ).rejects.toThrow(/exact immutable stored review binding/u);
      await expect(
        reviewService.editAndRevalidate({
          request: {
            editedAt: "2026-08-21T12:05:00.000Z",
            editedBy: "actor-reviewer",
            edits: [
              {
                content: `${editableFile.content}\n// reviewed edit\n`,
                expectedDigest: editableFile.digest,
                path: editableFile.path,
              },
            ],
            expectedArtifactDigest: review.artifact.artifactDigest,
            expectedReviewDigest: review.reviewDigest,
            reviewId: review.reviewId,
            scope,
          },
          review,
        }),
      ).rejects.toThrow(/exact immutable stored review binding/u);
    }
  });

  it("accepts an exact versioned solution-contract source authority", async () => {
    const fixture = iacSolutionContractFixture();
    const bundle = candidateBundle(fixture.request, [
      {
        content:
          'resource "aws_cloudwatch_log_group" "custom" { name = "custom" }\n',
        path: ownedPath(fixture.request, 0),
      },
    ]);
    const gateway = new QueuedCandidateGateway({ generationBundles: [bundle] });
    const harness = coordinatorHarness({ gateway });

    const review = requireReview(
      await harness.coordinator.generate(customInput(fixture)),
    );

    expect(review.state).toBe("ready-for-acceptance");
    expect(review.extension.sourceReferences).toEqual(
      fixture.extension.sourceReferences,
    );
    expect(gateway.calls.map(({ operation }) => operation)).toEqual([
      "iac-extension.generate",
    ]);
  });

  it("rejects altered solution-contract version, identity, digest, and frozen record authority before model invocation", async () => {
    const fixture = iacSolutionContractFixture();
    const exactReference = fixture.extension.sourceReferences[0];
    if (exactReference?.kind !== "solution-contract") {
      throw new Error("Missing exact solution-contract authority fixture.");
    }
    const gateway = new QueuedCandidateGateway();
    const harness = coordinatorHarness({ gateway });

    const wrongVersion = candidateExtensionAuthorityV1Schema.parse({
      ...fixture.extension,
      sourceReferences: [{ ...exactReference, contractVersion: "2.0.0" }],
    });
    await expect(
      harness.coordinator.generate(
        customInput(fixture, { extension: wrongVersion }),
      ),
    ).rejects.toThrow(/exact versioned Application Contract authority/u);

    const alteredReferences = [
      {
        contractId: "cloudmarkup.contract.missing",
        digest: exactReference.digest,
      },
      {
        contractId: exactReference.contractId,
        digest: sha256Text("unbound solution contract"),
      },
    ];
    for (const alteredReference of alteredReferences) {
      const sourceReference = {
        digest: alteredReference.digest,
        kind: "solution-contract" as const,
        referenceId: alteredReference.contractId,
      };
      const generationContext = {
        ...fixture.request.generationContext,
        sourceReferences: [sourceReference],
      };
      const request = modelIacExtensionGenerationRequestV1Schema.parse({
        ...fixture.request,
        generationContext,
        generationContextDigest: digestCanonicalValue(generationContext),
        sourceReferences: [sourceReference],
      });
      const extension = candidateExtensionAuthorityV1Schema.parse({
        ...fixture.extension,
        sourceReferences: [
          {
            ...exactReference,
            contractId: alteredReference.contractId,
            digest: alteredReference.digest,
          },
        ],
      });
      const modelInput = customInput(fixture, { extension });
      await expect(
        harness.coordinator.generate({ ...modelInput, modelRequest: request }),
      ).rejects.toThrow(/exact versioned Application Contract authority/u);
    }

    const unboundRevision = solutionRevisionManifestV1Schema.parse({
      ...fixture.request.solutionRevision,
      contracts: {
        ...fixture.request.solutionRevision.contracts,
        recordHashes: [],
      },
    });
    const revisionInput = customInput(fixture);
    await expect(
      harness.coordinator.generate({
        ...revisionInput,
        modelRequest: modelIacExtensionGenerationRequestV1Schema.parse({
          ...fixture.request,
          solutionRevision: unboundRevision,
        }),
      }),
    ).rejects.toThrow(/exact frozen Application Contract set and records/u);

    expect(gateway.calls).toHaveLength(0);
    expect(harness.artifactStore.artifactCount()).toBe(0);
    expect(harness.artifactStore.invalidArtifactCount()).toBe(0);
  });

  it("preserves exact user-owned edits through a digest-bound bounded patch", async () => {
    const fixture = applicationFixture({ userOwnedPatch: true });
    const { bundle, proposedContent } = userOwnedPatchBundle(fixture);
    const gateway = new QueuedCandidateGateway({ generationBundles: [bundle] });
    const harness = coordinatorHarness({ gateway });

    const review = requireReview(
      await harness.coordinator.generate(customInput(fixture)),
    );
    const userPath = ownedPath(fixture.request, 0);
    const aiPath = ownedPath(fixture.request, 1);

    expect(review.state).toBe("ready-for-acceptance");
    expect(review.artifact.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          digest: sha256Text(proposedContent),
          ownership: "user-owned-preserved",
          path: userPath,
          sourceKind: "patch",
        }),
        expect.objectContaining({
          ownership: "ai-authored-candidate",
          path: aiPath,
          sourceKind: "file",
        }),
      ]),
    );
    const validation = (
      harness.applicationValidator as PassingCandidateValidator
    ).calls[0];
    expect(
      validation?.files.find(({ path }) => path === userPath),
    ).toMatchObject({
      ownership: "user-owned-preserved",
      sourceKind: "patch",
    });

    const staleGateway = new QueuedCandidateGateway();
    const staleHarness = coordinatorHarness({ gateway: staleGateway });
    const staleOwnedPaths = fixture.extension.ownedPaths.map((entry, index) =>
      index === 0
        ? { ...entry, priorDigest: sha256Text("stale user-owned content") }
        : entry,
    );
    await expect(
      staleHarness.coordinator.generate(
        customInput(fixture, {
          extension: { ...fixture.extension, ownedPaths: staleOwnedPaths },
        }),
      ),
    ).rejects.toThrow(/explicit digest-bound user-owned patch authority/u);
    expect(staleGateway.calls).toHaveLength(0);
  });

  it("rejects wrong authority and mismatched target authority before model invocation", async () => {
    const fixture = iacFixture();
    const gateway = new QueuedCandidateGateway();
    const harness = coordinatorHarness({ gateway });

    await expect(
      harness.coordinator.generate(
        customInput(fixture, { authority: "ai-assisted-custom" }),
      ),
    ).rejects.toThrow(/exact approved target extension slot/u);
    await expect(
      harness.coordinator.generate(
        customInput(fixture, {
          extension: {
            ...fixture.extension,
            target: {
              ...fixture.extension.target,
              targetFormat: "cloudformation",
            },
          },
        }),
      ),
    ).rejects.toThrow(/exact approved target extension slot/u);
    expect(gateway.calls).toHaveLength(0);
    expect(harness.artifactStore.artifactCount()).toBe(0);
  });

  it("rejects mismatched proposal and commercial authority before model invocation", async () => {
    const fixture = iacFixture();
    const gateway = new QueuedCandidateGateway();
    const harness = coordinatorHarness({ gateway });
    const exactProposalAuthority =
      /exact extension ownership and validation authority/u;

    await expect(
      harness.coordinator.generate(
        customInput(fixture, {
          extension: {
            ...fixture.extension,
            request: {
              ...fixture.extension.request,
              objective: "Generate an unreviewed extension objective.",
            },
          },
        }),
      ),
    ).rejects.toThrow(exactProposalAuthority);

    await expect(
      harness.coordinator.generate(
        customInput(fixture, {
          extension: {
            ...fixture.extension,
            sourceReferences: [
              { kind: "architecture-node", nodeId: "node_unreviewed" },
            ],
          },
        }),
      ),
    ).rejects.toThrow(exactProposalAuthority);

    await expect(
      harness.coordinator.generate(
        customInput(fixture, {
          commercialAuthority: {
            acceptedWorkflowEstimateMaximumCreditUnits: 20,
            attemptEstimateCreditUnits: [1],
            reservationId: "reservation-unreviewed",
          },
        }),
      ),
    ).rejects.toThrow(/exact trusted commercial reservation/u);

    await expect(
      harness.coordinator.generate(
        customInput(fixture, {
          attemptEstimateCreditUnits: [11, 10],
          maximumRepairAttempts: 1,
        }),
      ),
    ).rejects.toThrow(/cannot exceed the accepted workflow estimate/u);

    const protectedContent = "sanitized deterministic compiler output\n";
    const baseGenerationContext = fixture.request.generationContext;
    if (baseGenerationContext?.kind !== "iac-extension") {
      throw new Error("Missing exact IaC generation context.");
    }
    const protectedGenerationContext = {
      ...baseGenerationContext,
      existingFiles: [
        {
          content: protectedContent,
          contentDigest: sha256Text(protectedContent),
          noSecretValues: true as const,
          ownership: "generated" as const,
          path: "infrastructure/generated/main.tf",
          redactionStatus: "not-required" as const,
          sizeBytes: protectedContent.length,
        },
      ],
    };
    const protectedRequest = modelIacExtensionGenerationRequestV1Schema.parse({
      ...fixture.request,
      generationContext: protectedGenerationContext,
      generationContextDigest: digestCanonicalValue(protectedGenerationContext),
    });
    const protectedInput = customInput(fixture);
    await expect(
      harness.coordinator.generate({
        ...protectedInput,
        modelRequest: protectedRequest,
      }),
    ).rejects.toThrow(exactProposalAuthority);

    expect(gateway.calls).toHaveLength(0);
    expect(harness.artifactStore.artifactCount()).toBe(0);
    expect(harness.artifactStore.invalidArtifactCount()).toBe(0);
  });

  it("turns initial ModelGateway invalid output into a restricted rejected candidate", async () => {
    const fixture = iacFixture();
    const gateway = new QueuedCandidateGateway({
      generationErrors: [
        new ModelGatewayError(
          "model-gateway.invalid-output",
          "The deterministic fixture rejected malformed structured output.",
        ),
      ],
    });
    const harness = coordinatorHarness({ gateway });

    const failure = requireFailure(
      await harness.coordinator.generate(customInput(fixture)),
    );

    expect(failure.state).toBe("rejected");
    expect(failure.writeAuthority).toBe("none");
    expect(failure.attempts).toEqual([]);
    expect(failure.diagnostics).toEqual([
      expect.objectContaining({
        category: "admission",
        code: "cloudmarkup.ai-extension.model-gateway-output-rejected",
        repairable: false,
      }),
    ]);
    expect(failure.issues[0]?.lifecycle.state).toBe("current");
    expect(failure.issues[0]?.severity).toBe("error");
    expect(failure.invalidArtifact.classification).toBe(
      "restricted-invalid-ai-authored-candidate",
    );
    expect(failure.progress).toEqual([
      { stage: "generate", state: "failed" },
      { stage: "check", state: "failed" },
      { stage: "fix-automatically-where-safe", state: "not-needed" },
      { stage: "review-remaining-issues", state: "blocked" },
      { stage: "accept-candidate", state: "blocked" },
    ]);
    expect(gateway.calls.map(({ operation }) => operation)).toEqual([
      "iac-extension.generate",
    ]);
    expect(harness.artifactStore.invalidArtifactCount()).toBe(1);
    expect(harness.artifactStore.artifactCount()).toBe(0);
    expect(
      (harness.terraformValidator as PassingCandidateValidator).calls,
    ).toHaveLength(0);
  });

  it("rejects and preserves a candidate when the configured target is unsupported", async () => {
    const fixture = iacFixture({ targetFormat: "cloudformation" });
    const bundle = candidateBundle(fixture.request, [
      {
        content: '{"Resources":{}}\n',
        path: ownedPath(fixture.request, 0),
      },
    ]);
    const gateway = new QueuedCandidateGateway({ generationBundles: [bundle] });
    const unsupported = new UnsupportedCandidateValidator();
    const harness = coordinatorHarness({
      cloudformationValidator: unsupported,
      gateway,
    });

    const failure = requireFailure(
      await harness.coordinator.generate(customInput(fixture)),
    );

    expect(failure.state).toBe("rejected");
    expect(failure.writeAuthority).toBe("none");
    expect(failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "cloudmarkup.ai-extension.target-validator-error",
        }),
      ]),
    );
    expect(failure.invalidArtifact.classification).toBe(
      "restricted-invalid-ai-authored-candidate",
    );
    expect(unsupported.calls).toBe(1);
    expect(harness.artifactStore.invalidArtifactCount()).toBe(1);
    expect(harness.artifactStore.artifactCount()).toBe(0);
  });

  it("rejects malicious and excessive output and preserves restricted diagnostics", async () => {
    const maliciousFixture = iacFixture();
    const maliciousBundle = candidateBundle(maliciousFixture.request, [
      {
        content: 'client_secret = "candidate-secret-value"\n',
        path: ownedPath(maliciousFixture.request, 0),
      },
    ]);
    const maliciousHarness = coordinatorHarness({
      gateway: new QueuedCandidateGateway({
        generationBundles: [maliciousBundle],
      }),
    });
    const maliciousFailure = requireFailure(
      await maliciousHarness.coordinator.generate(
        customInput(maliciousFixture),
      ),
    );
    expect(maliciousFailure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "security" }),
      ]),
    );
    expect(maliciousFailure.invalidArtifact.classification).toBe(
      "restricted-invalid-ai-authored-candidate",
    );
    expect(maliciousHarness.artifactStore.invalidArtifactCount()).toBe(1);
    expect(maliciousHarness.artifactStore.artifactCount()).toBe(0);

    const excessivePaths = [
      "infrastructure/extensions/a.tf",
      "infrastructure/extensions/b.tf",
    ];
    const excessiveFixture = iacFixture({
      maximumFiles: 1,
      paths: excessivePaths,
    });
    const excessiveBundle = candidateBundle(
      excessiveFixture.request,
      excessivePaths.map((path, index) => ({
        content: `resource "example" "r${String(index)}" {}\n`,
        path,
      })),
    );
    const excessiveHarness = coordinatorHarness({
      gateway: new QueuedCandidateGateway({
        generationBundles: [excessiveBundle],
      }),
    });
    const excessiveFailure = requireFailure(
      await excessiveHarness.coordinator.generate(
        customInput(excessiveFixture),
      ),
    );
    expect(excessiveFailure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "cloudmarkup.ai-extension.file-count-exceeded",
        }),
      ]),
    );
    expect(excessiveHarness.artifactStore.invalidArtifactCount()).toBe(1);
    expect(excessiveHarness.artifactStore.artifactCount()).toBe(0);
    expect(excessiveFailure.writeAuthority).toBe("none");
  });

  it("keeps any unresolved behavior in review with active issues", async () => {
    const fixture = applicationFixture();
    const bundle = candidateBundle(
      fixture.request,
      [
        {
          content: "export const handler = async () => ({ ok: true });\n",
          path: ownedPath(fixture.request, 0),
        },
        {
          content: "export const contractTest = () => true;\n",
          path: ownedPath(fixture.request, 1),
        },
      ],
      { includeUnresolved: true },
    );
    const harness = coordinatorHarness({
      gateway: new QueuedCandidateGateway({ generationBundles: [bundle] }),
    });

    const review = requireReview(
      await harness.coordinator.generate(customInput(fixture)),
    );

    expect(review.state).toBe("review-with-issues");
    expect(review.unresolvedItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ blocking: false })]),
    );
    expect(
      review.issues.some(({ lifecycle }) => lifecycle.state === "current"),
    ).toBe(true);
    expect(review.validation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "static-analysis", result: "failed" }),
      ]),
    );
    expect(review.writeAuthority).toBe("none");
    const storedReview = await harness.artifactStore.read({
      artifactId: review.artifact.artifactId,
      expectedArtifactDigest: review.artifact.artifactDigest,
      scope,
    });
    expect(storedReview.reviewBinding).toEqual(
      createCandidateArtifactReviewBinding({
        reference: review.artifact,
        review: {
          boundAt: review.artifact.storedAt,
          reviewDigest: review.reviewDigest,
          reviewId: review.reviewId,
        },
      }),
    );

    expect(harness.artifactStore.invalidArtifactCount()).toBe(1);
  });

  it("retains append-only issue and artifact lineage across inspected repeated edits", async () => {
    const paths = [
      "infrastructure/extensions/custom.tf",
      "infrastructure/extensions/custom-test.tf",
    ] as const;
    const fixture = iacFixture({
      maximumTotalBytes: 128,
      paths,
    });
    const initialContent = 'resource "example" "before-edit" {}\n';
    const secondContent = 'resource "example" "unchanged" {}\n';
    const groundedBundle = candidateBundle(
      fixture.request,
      [
        { content: initialContent, path: paths[0] },
        { content: secondContent, path: paths[1] },
      ],
      { includeUnresolved: true },
    );
    const bundle = modelCandidateBundleV1Schema.parse({
      ...groundedBundle,
      generationPlan: {
        ...groundedBundle.generationPlan,
        steps: groundedBundle.generationPlan.steps.map((step, index) =>
          index === 0
            ? {
                ...step,
                sourceReferences: [
                  {
                    kind: "architecture-node",
                    referenceId: "node_ungrounded",
                  },
                ],
              }
            : step,
        ),
      },
    });
    const validator = new DiagnosticCandidateValidator();
    const harness = coordinatorHarness({
      gateway: new QueuedCandidateGateway({ generationBundles: [bundle] }),
      terraformValidator: validator,
    });
    const review = requireReview(
      await harness.coordinator.generate(customInput(fixture)),
    );
    const issue = review.issues.find(
      ({ summary }) =>
        summary === "The candidate requires a reviewed user edit.",
    );
    if (issue === undefined) throw new Error("Expected an editable issue.");
    expect(review.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "cloudmarkup.ai-extension.candidate-item-unresolved",
        "cloudmarkup.ai-extension.candidate-source-ungrounded",
        "cloudmarkup.fixture.edit-required",
      ]),
    );
    validator.resolveWith(
      issue.id,
      issue.closureRequirements[0]?.evidenceCheckId ?? "extension.format",
    );

    const inspection = await harness.reviewService.inspect({
      expectedArtifactDigest: review.artifact.artifactDigest,
      expectedReviewDigest: review.reviewDigest,
      review,
      reviewId: review.reviewId,
      scope,
    });
    const inspectedFile = inspection.files.find(
      (file) => file.path === paths[0],
    );
    if (inspectedFile === undefined) {
      throw new Error("Expected an inspected candidate file.");
    }
    const inspectionAuthorizationRequest = (
      harness.authorization as RecordingReviewAuthorization
    ).calls[0];
    if (inspectionAuthorizationRequest === undefined) {
      throw new Error("Expected exact inspection authorization.");
    }
    expect(inspection.authorization).toEqual({
      action: "inspect",
      authorizationDecisionId: stableRecordId(
        "candidate-review-authorization",
        inspectionAuthorizationRequest,
      ),
      principalId: "actor-reviewer",
    });
    const firstRequest = {
      editedAt: "2026-08-21T12:05:00.000Z",
      editedBy: "actor-reviewer",
      edits: [
        {
          content: 'resource "example" "after-edit" {}\n',
          expectedDigest: inspectedFile.digest,
          path: inspectedFile.path,
        },
      ],
      expectedArtifactDigest: review.artifact.artifactDigest,
      expectedReviewDigest: review.reviewDigest,
      reviewId: review.reviewId,
      scope,
    };
    const edited = await harness.reviewService.editAndRevalidate({
      request: firstRequest,
      review,
    });
    const storedEdited = await harness.artifactStore.read({
      artifactId: edited.artifact.artifactId,
      expectedArtifactDigest: edited.artifact.artifactDigest,
      scope,
    });
    expect(storedEdited.reviewBinding).toEqual(
      createCandidateArtifactReviewBinding({
        reference: edited.artifact,
        review: {
          boundAt: edited.artifact.storedAt,
          reviewDigest: edited.reviewDigest,
          reviewId: edited.reviewId,
        },
      }),
    );

    expect(edited.issueHistory.slice(0, review.issueHistory.length)).toEqual(
      review.issueHistory,
    );
    expect(edited.issueHistory.length).toBeGreaterThan(
      review.issueHistory.length,
    );
    expect(
      edited.issues.find(({ id }) => id === issue.id)?.lifecycle.state,
    ).toBe("resolved");
    expect(
      edited.evidence.some((record) =>
        record.checks.some((check) => check.issueIds.includes(issue.id)),
      ),
    ).toBe(true);
    expect(edited.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "cloudmarkup.ai-extension.candidate-item-unresolved",
        "cloudmarkup.ai-extension.candidate-source-ungrounded",
      ]),
    );
    expect(
      edited.issues.some(
        ({ lifecycle, summary }) =>
          lifecycle.state === "current" &&
          (summary === "Candidate still has unresolved behavior." ||
            summary ===
              "Candidate metadata contains an ungrounded source claim."),
      ),
    ).toBe(true);
    expect(edited.state).toBe("review-with-issues");
    const firstEditAuthorizationRequest = (
      harness.authorization as RecordingReviewAuthorization
    ).calls.find(
      ({ action, reviewId }) =>
        action === "edit" && reviewId === review.reviewId,
    );
    if (
      firstEditAuthorizationRequest === undefined ||
      edited.artifact.origin.kind !== "user-modified"
    ) {
      throw new Error("Expected authorized first-edit lineage.");
    }
    const firstEditRevalidation = edited.editRevalidations[0];
    if (firstEditRevalidation === undefined) {
      throw new Error("Expected an edit-revalidation progress authority.");
    }
    expect(edited.generationProgress).toEqual(review.generationProgress);
    expect(firstEditRevalidation).toMatchObject({
      artifactDigest: edited.artifact.artifactDigest,
      authorityKind: "candidate-edit-revalidation",
      parentArtifactDigest: review.artifact.artifactDigest,
      parentProgressFinalizationDigest: digestCanonicalValue(
        review.generationProgress,
      ),
      parentReviewDigest: review.reviewDigest,
      priorEditCount: 0,
      editCount: 1,
    });
    const firstAuthorityTampering = [
      redigestEditRevalidation(firstEditRevalidation, {
        parentProgressFinalizationDigest: sha256Text(
          "tampered-parent-progress",
        ),
      }),
      redigestEditRevalidation(firstEditRevalidation, {
        parentReviewDigest: sha256Text("tampered-parent-review"),
      }),
      redigestEditRevalidation(firstEditRevalidation, {
        parentReviewId: "candidate-review-tampered-parent",
      }),
      redigestEditRevalidation(firstEditRevalidation, {
        authorizationDecision: {
          ...firstEditRevalidation.authorizationDecision,
          decisionId: "authorization-tampered-edit",
        },
      }),
      redigestEditRevalidation(firstEditRevalidation, {
        authorizationDecision: {
          ...firstEditRevalidation.authorizationDecision,
          decidedAt: utcTimestampSchema.parse("2026-08-21T12:05:00.500Z"),
        },
      }),
    ];
    for (const tampered of firstAuthorityTampering) {
      expectEditAuthorityRejected(
        redigestCandidateReview(edited, {
          editRevalidations: [tampered],
        }),
      );
    }
    const divergentExtensionValidation = redigestCandidateReview(edited, {
      extension: {
        ...edited.extension,
        validation: edited.extension.validation.map((check, index) =>
          index === 0
            ? {
                ...check,
                toolVersion: "tampered-validation-version",
              }
            : check,
        ),
      },
    });
    const divergentValidationParse = candidateReviewRecordV1Schema.safeParse(
      divergentExtensionValidation,
    );
    expect(divergentValidationParse.success).toBe(false);
    if (!divergentValidationParse.success) {
      expect(divergentValidationParse.error.issues).toContainEqual(
        expect.objectContaining({
          message:
            "Candidate review and Prompt 24D extension validation must match exactly.",
          path: ["extension", "validation"],
        }),
      );
    }
    expect(edited.artifact.origin.edits[0]?.authorizationDecisionId).toBe(
      stableRecordId(
        "candidate-review-authorization",
        firstEditAuthorizationRequest,
      ),
    );

    await expect(
      harness.reviewService.inspect({
        expectedArtifactDigest: review.artifact.artifactDigest,
        expectedReviewDigest: review.reviewDigest,
        review,
        reviewId: review.reviewId,
        scope,
      }),
    ).rejects.toThrow(/unavailable/u);
    await expect(
      harness.reviewService.editAndRevalidate({
        request: firstRequest,
        review,
      }),
    ).rejects.toThrow(/unavailable/u);

    const secondInspection = await harness.reviewService.inspect({
      expectedArtifactDigest: edited.artifact.artifactDigest,
      expectedReviewDigest: edited.reviewDigest,
      review: edited,
      reviewId: edited.reviewId,
      scope,
    });
    const firstEditedFile = secondInspection.files.find(
      (file) => file.path === paths[0],
    );
    if (firstEditedFile === undefined) {
      throw new Error("Expected the first edited candidate file.");
    }
    const secondRequest = {
      editedAt: "2026-08-21T12:06:00.000Z",
      editedBy: "actor-reviewer",
      edits: [
        {
          content: 'resource "example" "after-second-edit" {}\n',
          expectedDigest: firstEditedFile.digest,
          path: firstEditedFile.path,
        },
      ],
      expectedArtifactDigest: edited.artifact.artifactDigest,
      expectedReviewDigest: edited.reviewDigest,
      reviewId: edited.reviewId,
      scope,
    };
    const maliciousValidator = new UnsupportedCandidateValidator();
    const editedAgain = await harness.reviewService.editAndRevalidate({
      request: secondRequest,
      review: edited,
    });
    const storedEditedAgain = await harness.artifactStore.read({
      artifactId: editedAgain.artifact.artifactId,
      expectedArtifactDigest: editedAgain.artifact.artifactDigest,
      scope,
    });
    expect(storedEditedAgain.reviewBinding).toEqual(
      createCandidateArtifactReviewBinding({
        reference: editedAgain.artifact,
        review: {
          boundAt: editedAgain.artifact.storedAt,
          reviewDigest: editedAgain.reviewDigest,
          reviewId: editedAgain.reviewId,
        },
      }),
    );

    expect(maliciousValidator.calls).toBe(0);
    expect(
      editedAgain.issueHistory.slice(0, edited.issueHistory.length),
    ).toEqual(edited.issueHistory);
    const editRevalidations = editedAgain.editRevalidations;
    const secondEditRevalidation = editRevalidations[1];
    if (
      editedAgain.artifact.origin.kind !== "user-modified" ||
      editRevalidations[0] === undefined ||
      secondEditRevalidation === undefined
    ) {
      throw new Error("Expected repeated user-modified artifact lineage.");
    }
    expect(editedAgain.generationProgress).toEqual(review.generationProgress);
    expect(editRevalidations[0]).toEqual(firstEditRevalidation);
    expect(secondEditRevalidation).toMatchObject({
      artifactDigest: editedAgain.artifact.artifactDigest,
      authorityKind: "candidate-edit-revalidation",
      parentArtifactDigest: edited.artifact.artifactDigest,
      parentProgressFinalizationDigest: digestCanonicalValue(
        firstEditRevalidation,
      ),
      parentReviewDigest: edited.reviewDigest,
      priorEditCount: 1,
      editCount: 2,
    });
    expectEditAuthorityRejected(
      redigestCandidateReview(editedAgain, {
        editRevalidations: [
          firstEditRevalidation,
          redigestEditRevalidation(secondEditRevalidation, {
            parentProgressFinalizationDigest: sha256Text(
              "tampered-repeated-edit-parent",
            ),
          }),
        ],
      }),
    );
    expectEditAuthorityRejected(
      redigestCandidateReview(editedAgain, {
        editRevalidations: [secondEditRevalidation, firstEditRevalidation],
      }),
    );
    const shortenedEvidence = editedAgain.evidence.slice(1);
    expectEditAuthorityRejected(
      redigestCandidateReview(editedAgain, {
        editRevalidations: [
          firstEditRevalidation,
          redigestEditRevalidation(secondEditRevalidation, {
            evidenceCount: shortenedEvidence.length,
            evidenceDigest: digestCanonicalValue(shortenedEvidence),
          }),
        ],
        evidence: shortenedEvidence,
      }),
    );
    const firstHistoryRecord = editedAgain.issueHistory[0];
    const secondHistoryRecord = editedAgain.issueHistory[1];
    if (firstHistoryRecord === undefined || secondHistoryRecord === undefined) {
      throw new Error("Expected cumulative issue history for reorder testing.");
    }
    const reorderedIssueHistory = [
      secondHistoryRecord,
      firstHistoryRecord,
      ...editedAgain.issueHistory.slice(2),
    ];
    expectEditAuthorityRejected(
      redigestCandidateReview(editedAgain, {
        editRevalidations: [
          firstEditRevalidation,
          redigestEditRevalidation(secondEditRevalidation, {
            finalIssueHistoryDigest: digestCanonicalValue(
              reorderedIssueHistory,
            ),
          }),
        ],
        issueHistory: reorderedIssueHistory,
      }),
    );
    expect(editedAgain.artifact.origin.baseArtifactId).toBe(
      review.artifact.artifactId,
    );
    expect(editedAgain.artifact.origin.baseArtifactDigest).toBe(
      review.artifact.artifactDigest,
    );
    expect(editedAgain.artifact.origin.parentArtifactId).toBe(
      edited.artifact.artifactId,
    );
    expect(editedAgain.artifact.origin.parentArtifactDigest).toBe(
      edited.artifact.artifactDigest,
    );
    expect(editedAgain.artifact.origin.edits).toHaveLength(2);
    expect(editedAgain.artifact.origin.edits[0]).toEqual(
      edited.artifact.origin.edits[0],
    );
    expect(editedAgain.artifact.origin.edits[1]?.priorDigest).toBe(
      editedAgain.artifact.origin.edits[0]?.resultDigest,
    );
    const secondEditAuthorizationRequest = [
      ...(harness.authorization as RecordingReviewAuthorization).calls,
    ]
      .reverse()
      .find(
        ({ action, reviewId }) =>
          action === "edit" && reviewId === edited.reviewId,
      );
    if (secondEditAuthorizationRequest === undefined) {
      throw new Error("Expected authorized second-edit lineage.");
    }
    expect(editedAgain.artifact.origin.edits[1]?.authorizationDecisionId).toBe(
      stableRecordId(
        "candidate-review-authorization",
        secondEditAuthorizationRequest,
      ),
    );
    const priorClosureEvidenceIds = new Set(
      edited.issueHistory.flatMap(({ lifecycle }) =>
        lifecycle.state === "resolved" ? lifecycle.evidenceIds : [],
      ),
    );
    for (const evidenceId of priorClosureEvidenceIds) {
      expect(editedAgain.evidence.some(({ id }) => id === evidenceId)).toBe(
        true,
      );
    }

    await expect(
      harness.reviewService.inspect({
        expectedArtifactDigest: edited.artifact.artifactDigest,
        expectedReviewDigest: edited.reviewDigest,
        review: edited,
        reviewId: edited.reviewId,
        scope,
      }),
    ).rejects.toThrow(/unavailable/u);
    await expect(
      harness.reviewService.editAndRevalidate({
        request: secondRequest,
        review: edited,
      }),
    ).rejects.toThrow(/unavailable/u);
    expect(harness.artifactStore.artifactCount()).toBe(3);

    const currentInspection = await harness.reviewService.inspect({
      expectedArtifactDigest: editedAgain.artifact.artifactDigest,
      expectedReviewDigest: editedAgain.reviewDigest,
      review: editedAgain,
      reviewId: editedAgain.reviewId,
      scope,
    });
    const currentFile = currentInspection.files.find(
      (file) => file.path === paths[0],
    );
    if (currentFile === undefined) throw new Error("Missing current file.");

    await expect(
      harness.reviewService.editAndRevalidate({
        request: {
          ...secondRequest,
          editedAt: "2026-08-21T12:06:30.000Z",
          editedBy: "actor-attacker",
          edits: [
            {
              content: 'resource "example" "unauthorized-edit" {}\n',
              expectedDigest: currentFile.digest,
              path: currentFile.path,
            },
          ],
          expectedArtifactDigest: editedAgain.artifact.artifactDigest,
          expectedReviewDigest: editedAgain.reviewDigest,
          reviewId: editedAgain.reviewId,
        },
        review: editedAgain,
      }),
    ).rejects.toThrow(/not authorized/u);
    expect(harness.artifactStore.artifactCount()).toBe(3);

    await expect(
      harness.reviewService.editAndRevalidate({
        request: {
          ...secondRequest,
          editedAt: "2026-08-21T12:07:00.000Z",
          edits: [
            {
              content: `# ${"x".repeat(120)}\n`,
              expectedDigest: currentFile.digest,
              path: currentFile.path,
            },
          ],
          expectedArtifactDigest: editedAgain.artifact.artifactDigest,
          expectedReviewDigest: editedAgain.reviewDigest,
          reviewId: editedAgain.reviewId,
        },
        review: editedAgain,
      }),
    ).rejects.toThrow(/aggregate file-count or byte limits/u);
    expect(harness.artifactStore.artifactCount()).toBe(3);

    validator.makeUnavailable();
    await expect(
      harness.reviewService.editAndRevalidate({
        request: {
          ...secondRequest,
          editedAt: "2026-08-21T12:08:00.000Z",
          edits: [
            {
              content: 'resource "example" "validator-unavailable" {}\n',
              expectedDigest: currentFile.digest,
              path: currentFile.path,
            },
          ],
          expectedArtifactDigest: editedAgain.artifact.artifactDigest,
          expectedReviewDigest: editedAgain.reviewDigest,
          reviewId: editedAgain.reviewId,
        },
        review: editedAgain,
      }),
    ).rejects.toThrow(/original candidate remains current/u);
    expect(harness.artifactStore.artifactCount()).toBe(3);
    expect(
      await harness.reviewService.inspect({
        expectedArtifactDigest: editedAgain.artifact.artifactDigest,
        expectedReviewDigest: editedAgain.reviewDigest,
        review: editedAgain,
        reviewId: editedAgain.reviewId,
        scope,
      }),
    ).toEqual(
      expect.objectContaining({ artifactId: editedAgain.artifact.artifactId }),
    );
    expect(inspection.repositoryWriteAuthority).toBe("none");
    expect(editedAgain.writeAuthority).toBe("none");
    expect(
      (harness.authorization as RecordingReviewAuthorization).calls.map(
        ({ action }) => action,
      ),
    ).toEqual(expect.arrayContaining(["inspect", "edit"]));
  });
  it("derives stable review identity, digest, and provenance reproducibly", async () => {
    const fixture = applicationFixture();
    const bundle = candidateBundle(fixture.request, [
      {
        content: "export const handler = async () => ({ ok: true });\n",
        path: ownedPath(fixture.request, 0),
      },
      {
        content: "export const contractTest = () => true;\n",
        path: ownedPath(fixture.request, 1),
      },
    ]);
    const firstHarness = coordinatorHarness({
      gateway: new QueuedCandidateGateway({ generationBundles: [bundle] }),
    });
    const secondHarness = coordinatorHarness({
      gateway: new QueuedCandidateGateway({ generationBundles: [bundle] }),
    });

    const first = requireReview(
      await firstHarness.coordinator.generate(customInput(fixture)),
    );
    const second = requireReview(
      await secondHarness.coordinator.generate(customInput(fixture)),
    );

    expect(second.reviewId).toBe(first.reviewId);
    expect(second.reviewDigest).toBe(first.reviewDigest);
    expect(second.artifact.artifactId).toBe(first.artifact.artifactId);
    expect(second.artifact.artifactDigest).toBe(first.artifact.artifactDigest);
    expect(second.extension.model).toEqual(first.extension.model);
    expect(
      first.evidence.every((record) =>
        record.provenance.inputDigests.some(
          (digest) =>
            digest === first.artifact.artifactDigest ||
            digest === first.artifact.bundleDigest,
        ),
      ),
    ).toBe(true);
    expect(first.writeAuthority).toBe("none");
    expect(first.extension.acceptance.state).toBe("pending");
  });

  it("repairs safely within the bound with unique metered attempts", async () => {
    const fixture = iacFixture();
    const path = ownedPath(fixture.request, 0);
    const invalidContent = 'resource "example" "invalid" {}\r\n';
    const validContent = 'resource "example" "valid" {}\n';
    const initial = candidateBundle(fixture.request, [
      { content: invalidContent, path },
    ]);
    const repaired = candidateBundle(fixture.request, [
      {
        content: validContent,
        path,
        priorDigest: sha256Text(invalidContent),
      },
    ]);
    const gateway = new QueuedCandidateGateway({
      generationBundles: [initial],
      repairBundles: [repaired],
    });
    const harness = coordinatorHarness({ gateway });
    const input = customInput(fixture, {
      acceptedMaximumCreditUnits: 20,
      maximumRepairAttempts: 1,
      repairAcceptedMaximumCreditUnits: [20],
    });

    const review = requireReview(await harness.coordinator.generate(input));

    expect(review.state).toBe("ready-for-acceptance");
    expect(review.attempts).toHaveLength(2);
    expect(review.attempts.map(({ attemptNumber }) => attemptNumber)).toEqual([
      0, 1,
    ]);
    expect(review.attempts.map(({ metered }) => metered)).toEqual([true, true]);
    expect(
      new Set(
        review.attempts.map(({ idempotencyKeyDigest }) => idempotencyKeyDigest),
      ).size,
    ).toBe(review.attempts.length);
    expect(
      new Set(review.attempts.map(({ usageRecordId }) => usageRecordId)).size,
    ).toBe(review.attempts.length);
    expect(gateway.calls.map(({ operation }) => operation)).toEqual([
      "iac-extension.generate",
      "candidate.repair",
    ]);
    expect(
      gateway.calls.every(
        ({ context }) =>
          (context.budget.acceptedEstimateMaximumCreditUnits ?? 0) <= 20,
      ),
    ).toBe(true);
    expect(review.progress).toEqual(
      expect.arrayContaining([
        {
          stage: "fix-automatically-where-safe",
          state: "complete",
        },
      ]),
    );
    expect(review.writeAuthority).toBe("none");
    expect(review.issueHistory.length).toBeGreaterThan(review.issues.length);
    expect(
      review.issueHistory.some(
        ({ aiProposedFix }) =>
          aiProposedFix?.validationStatus === "validation-pending",
      ),
    ).toBe(true);
    expect(review.issues.map(({ lifecycle }) => lifecycle.state)).toEqual([
      "resolved",
    ]);
    const resolvedIssueId = review.issues[0]?.id;
    if (resolvedIssueId === undefined) {
      throw new Error("Expected the exact resolved repair issue.");
    }
    expect(review.issues[0]?.aiProposedFix?.validationStatus).toBe(
      "validated-for-review",
    );
    expect(review.issues[0]?.aiProposedFix?.proposedPatchDigest).toBe(
      review.attempts[1]?.bundleDigest,
    );
    expect(
      review.evidence.some((record) =>
        record.checks.some(
          (check) =>
            check.issueIds.includes(resolvedIssueId) &&
            check.generationCoverageRequirement === undefined,
        ),
      ),
    ).toBe(true);
    expect(harness.artifactStore.invalidArtifactCount()).toBe(1);
    expect(harness.artifactStore.artifactCount()).toBe(1);
  });

  it("normalizes colliding partial-repair identities reproducibly", async () => {
    const paths = [
      "infrastructure/extensions/primary.tf",
      "infrastructure/extensions/secondary.tf",
    ] as const;
    const fixture = iacFixture({ paths });
    const untouchedContent = 'resource "example" "primary" {}\n';
    const invalidContent = 'resource "example" "secondary-invalid" {}\r\n';
    const repairedContent = 'resource "example" "secondary-valid" {}\n';
    const initial = candidateBundle(fixture.request, [
      { content: untouchedContent, path: paths[0] },
      { content: invalidContent, path: paths[1] },
    ]);
    const collidingRepair = candidateBundle(fixture.request, [
      {
        candidateId: "candidate-1",
        content: repairedContent,
        path: paths[1],
        priorDigest: sha256Text(invalidContent),
        stepId: "candidate-step-1",
      },
    ]);
    const firstHarness = coordinatorHarness({
      gateway: new QueuedCandidateGateway({
        generationBundles: [initial],
        repairBundles: [collidingRepair],
      }),
    });
    const secondHarness = coordinatorHarness({
      gateway: new QueuedCandidateGateway({
        generationBundles: [initial],
        repairBundles: [collidingRepair],
      }),
    });

    const firstReview = requireReview(
      await firstHarness.coordinator.generate(
        customInput(fixture, { maximumRepairAttempts: 1 }),
      ),
    );
    const secondReview = requireReview(
      await secondHarness.coordinator.generate(
        customInput(fixture, { maximumRepairAttempts: 1 }),
      ),
    );

    expect(firstReview.state).toBe("ready-for-acceptance");
    expect(firstReview.attempts).toHaveLength(2);
    expect(firstReview.attempts[1]?.bundleDigest).not.toBe(
      firstReview.attempts[1]?.mergedBundleDigest,
    );
    expect(firstReview.attempts[1]?.mergedBundleDigest).toBe(
      firstReview.artifact.bundleDigest,
    );
    expect(firstReview.issues[0]?.aiProposedFix?.proposedPatchDigest).toBe(
      firstReview.attempts[1]?.bundleDigest,
    );
    expect(firstReview.issues[0]?.aiProposedFix?.proposedPatchDigest).not.toBe(
      firstReview.attempts[1]?.mergedBundleDigest,
    );
    expect(
      secondReview.attempts.map(({ bundleDigest, mergedBundleDigest }) => ({
        bundleDigest,
        mergedBundleDigest,
      })),
    ).toEqual(
      firstReview.attempts.map(({ bundleDigest, mergedBundleDigest }) => ({
        bundleDigest,
        mergedBundleDigest,
      })),
    );
    expect(secondReview.reviewDigest).toBe(firstReview.reviewDigest);
    expect(secondReview.artifact.artifactDigest).toBe(
      firstReview.artifact.artifactDigest,
    );

    const firstValidation = (
      firstHarness.terraformValidator as PassingCandidateValidator
    ).calls[0];
    const secondValidation = (
      secondHarness.terraformValidator as PassingCandidateValidator
    ).calls[0];
    if (firstValidation === undefined || secondValidation === undefined) {
      throw new Error("Expected both replayed candidates to be validated.");
    }
    const candidateIdentityByPath = (input: CandidateTargetValidationInput) =>
      [...input.bundle.candidates]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map(({ candidateId, path }) => ({ candidateId, path }));
    const stepIdentityByPath = (input: CandidateTargetValidationInput) =>
      [...input.bundle.generationPlan.steps]
        .sort((left, right) => left.targetPath.localeCompare(right.targetPath))
        .map(({ stepId, targetPath }) => ({ stepId, targetPath }));
    const firstCandidateIdentities = candidateIdentityByPath(firstValidation);
    const firstStepIdentities = stepIdentityByPath(firstValidation);

    expect(firstCandidateIdentities).toEqual(
      candidateIdentityByPath(secondValidation),
    );
    expect(firstStepIdentities).toEqual(stepIdentityByPath(secondValidation));
    expect(
      new Set(firstCandidateIdentities.map(({ candidateId }) => candidateId))
        .size,
    ).toBe(paths.length);
    expect(new Set(firstStepIdentities.map(({ stepId }) => stepId)).size).toBe(
      paths.length,
    );
    expect(firstCandidateIdentities[0]).toEqual({
      candidateId: "candidate-1",
      path: paths[0],
    });
    expect(firstCandidateIdentities[1]?.candidateId).not.toBe("candidate-1");
    expect(firstStepIdentities[0]).toEqual({
      stepId: "candidate-step-1",
      targetPath: paths[0],
    });
    expect(firstStepIdentities[1]?.stepId).not.toBe("candidate-step-1");

    const firstStored = await firstHarness.artifactStore.read({
      artifactId: firstReview.artifact.artifactId,
      expectedArtifactDigest: firstReview.artifact.artifactDigest,
      scope,
    });
    expect(
      [...firstStored.files]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map(({ content, digest, path }) => ({ content, digest, path })),
    ).toEqual([
      {
        content: untouchedContent,
        digest: sha256Text(untouchedContent),
        path: paths[0],
      },
      {
        content: repairedContent,
        digest: sha256Text(repairedContent),
        path: paths[1],
      },
    ]);
  });

  it("preserves per-path lineage across two partial repairs", async () => {
    const paths = [
      "infrastructure/extensions/primary.tf",
      "infrastructure/extensions/secondary.tf",
    ] as const;
    const fixture = iacFixture({ paths });
    const initialContent = [
      'resource "example" "primary-invalid" {}\r\n',
      'resource "example" "secondary-invalid" {}\r\n',
    ] as const;
    const repairedContent = [
      'resource "example" "primary-valid" {}\n',
      'resource "example" "secondary-valid" {}\n',
    ] as const;
    const initial = candidateBundle(fixture.request, [
      { content: initialContent[0], path: paths[0] },
      { content: initialContent[1], path: paths[1] },
    ]);
    const firstRepair = candidateBundle(fixture.request, [
      {
        candidateId: "candidate-1",
        content: repairedContent[0],
        path: paths[0],
        priorDigest: sha256Text(initialContent[0]),
        stepId: "candidate-step-1",
      },
    ]);
    const secondRepair = candidateBundle(fixture.request, [
      {
        candidateId: "candidate-2",
        content: repairedContent[1],
        path: paths[1],
        priorDigest: sha256Text(initialContent[1]),
        stepId: "candidate-step-2",
      },
    ]);
    const gateway = new QueuedCandidateGateway({
      generationBundles: [initial],
      repairBundles: [firstRepair, secondRepair],
    });
    const harness = coordinatorHarness({ gateway });

    const review = requireReview(
      await harness.coordinator.generate(
        customInput(fixture, { maximumRepairAttempts: 2 }),
      ),
    );

    expect(review.state).toBe("ready-for-acceptance");
    expect(review.attempts).toHaveLength(3);
    expect(review.attempts[1]?.bundleDigest).not.toBe(
      review.attempts[1]?.mergedBundleDigest,
    );
    expect(review.attempts[2]?.bundleDigest).not.toBe(
      review.attempts[2]?.mergedBundleDigest,
    );
    expect(review.attempts[2]?.mergedBundleDigest).toBe(
      review.artifact.bundleDigest,
    );

    const repairRequests = gateway.calls
      .filter(({ operation }) => operation === "candidate.repair")
      .map(({ request }) => modelCandidateRepairRequestV1Schema.parse(request));
    expect(
      repairRequests[0]?.failedCandidates.map(({ path }) => path).sort(),
    ).toEqual([...paths].sort());
    expect(repairRequests[1]?.failedCandidates.map(({ path }) => path)).toEqual(
      [paths[1]],
    );
    expect(harness.artifactStore.invalidArtifactCount()).toBe(2);
    expect(harness.artifactStore.artifactCount()).toBe(1);
  });

  it("stops after a repair ModelGateway invalid-output rejection", async () => {
    const fixture = iacFixture();
    const path = ownedPath(fixture.request, 0);
    const initial = candidateBundle(fixture.request, [
      {
        content: 'resource "example" "invalid" {}\r\n',
        path,
      },
    ]);
    const gateway = new QueuedCandidateGateway({
      generationBundles: [initial],
      repairErrors: [
        new ModelGatewayError(
          "model-gateway.invalid-output",
          "The deterministic fixture rejected malformed repair output.",
        ),
      ],
    });
    const harness = coordinatorHarness({ gateway });

    const failure = requireFailure(
      await harness.coordinator.generate(
        customInput(fixture, { maximumRepairAttempts: 2 }),
      ),
    );

    expect(failure.state).toBe("rejected");
    expect(failure.writeAuthority).toBe("none");
    expect(failure.attempts).toHaveLength(1);
    expect(failure.attempts[0]).toEqual(
      expect.objectContaining({ attemptNumber: 0, kind: "generation" }),
    );
    expect(failure.diagnostics).toEqual([
      expect.objectContaining({
        category: "admission",
        code: "cloudmarkup.ai-extension.model-gateway-output-rejected",
        repairable: false,
      }),
    ]);
    expect(failure.issues[0]?.lifecycle.state).toBe("current");
    expect(failure.issues[0]?.severity).toBe("error");
    expect(failure.invalidArtifact.classification).toBe(
      "restricted-invalid-ai-authored-candidate",
    );
    expect(failure.progress).toEqual(
      expect.arrayContaining([
        {
          stage: "fix-automatically-where-safe",
          state: "exhausted",
        },
      ]),
    );
    expect(gateway.calls.map(({ operation }) => operation)).toEqual([
      "iac-extension.generate",
      "candidate.repair",
    ]);
    expect(harness.artifactStore.invalidArtifactCount()).toBe(2);
    expect(harness.artifactStore.artifactCount()).toBe(0);
  });

  it("stops with preserved issues after bounded repair exhaustion", async () => {
    const fixture = iacFixture();
    const path = ownedPath(fixture.request, 0);
    const firstContent = 'resource "example" "invalid-1" {}\r\n';
    const secondContent = 'resource "example" "invalid-2" {}\r\n';
    const thirdContent = 'resource "example" "invalid-3" {}\r\n';
    const first = candidateBundle(fixture.request, [
      { content: firstContent, path },
    ]);
    const second = candidateBundle(fixture.request, [
      {
        content: secondContent,
        path,
        priorDigest: sha256Text(firstContent),
      },
    ]);
    const third = candidateBundle(fixture.request, [
      {
        content: thirdContent,
        path,
        priorDigest: sha256Text(secondContent),
      },
    ]);
    const gateway = new QueuedCandidateGateway({
      generationBundles: [first],
      repairBundles: [second, third],
    });
    const harness = coordinatorHarness({ gateway });

    const failure = requireFailure(
      await harness.coordinator.generate(
        customInput(fixture, { maximumRepairAttempts: 2 }),
      ),
    );

    expect(failure.state).toBe("rejected");
    expect(failure.attempts).toHaveLength(3);
    expect(failure.attempts.map(({ metered }) => metered)).toEqual([
      true,
      true,
      true,
    ]);
    expect(
      new Set(
        failure.attempts.map(
          ({ idempotencyKeyDigest }) => idempotencyKeyDigest,
        ),
      ).size,
    ).toBe(failure.attempts.length);
    expect(
      new Set(failure.attempts.map(({ usageRecordId }) => usageRecordId)).size,
    ).toBe(failure.attempts.length);
    expect(failure.progress).toEqual(
      expect.arrayContaining([
        {
          stage: "fix-automatically-where-safe",
          state: "exhausted",
        },
      ]),
    );
    expect(failure.issues.length).toBeGreaterThan(0);
    expect(failure.issueHistory.length).toBeGreaterThan(failure.issues.length);
    expect(
      failure.issueHistory.some(
        ({ aiProposedFix }) =>
          aiProposedFix?.validationStatus === "validation-pending",
      ),
    ).toBe(true);
    expect(
      failure.issues.some(({ lifecycle }) => lifecycle.state === "current"),
    ).toBe(true);
    expect(
      failure.issues.some(
        ({ aiProposedFix }) => aiProposedFix?.validationStatus === "rejected",
      ),
    ).toBe(true);
    expect(failure.writeAuthority).toBe("none");
    expect(gateway.calls).toHaveLength(3);
    expect(harness.artifactStore.invalidArtifactCount()).toBe(3);
    expect(harness.artifactStore.artifactCount()).toBe(0);
  });

  it("rejects duplicate attempt identity and mismatched repair authority before invocation", async () => {
    const fixture = iacFixture();
    const gateway = new QueuedCandidateGateway();
    const harness = coordinatorHarness({ gateway });

    await expect(
      harness.coordinator.generate(
        customInput(fixture, {
          acceptedMaximumCreditUnits: 20,
          maximumRepairAttempts: 1,
          repairAcceptedMaximumCreditUnits: [21],
        }),
      ),
    ).rejects.toThrow(/exact accepted budget/u);

    const generationContext = invocationContext(
      fixture.request,
      "invocation-generation-duplicate",
    );
    const duplicateRepairContext = {
      ...invocationContext(fixture.request, "invocation-repair-duplicate"),
      idempotencyKeyDigest: generationContext.idempotencyKeyDigest,
    };
    await expect(
      harness.coordinator.generate({
        ...customInput(fixture, { maximumRepairAttempts: 1 }),
        modelContext: generationContext,
        repairContexts: [duplicateRepairContext],
      }),
    ).rejects.toThrow(/unique idempotency key/u);

    expect(gateway.calls).toHaveLength(0);
    expect(harness.artifactStore.artifactCount()).toBe(0);
    expect(harness.artifactStore.invalidArtifactCount()).toBe(0);
  });
});
