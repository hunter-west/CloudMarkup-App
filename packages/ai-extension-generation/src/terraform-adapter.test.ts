import { readFileSync } from "node:fs";

import { hclInspectionResultV1Schema } from "@cloudmarkup/repository-importer";
import {
  architectureDocumentV3Schema,
  modelCandidateBundleV1Schema,
  modelGenerationContextV1Schema,
  modelInvocationDescriptorV1Schema,
  solutionRevisionManifestV1Schema,
} from "@cloudmarkup/schemas";
import {
  createTerraformValidationRunner,
  terraformValidationFileV1Schema,
  terraformValidationPolicyV1Schema,
  terraformValidationReferenceV1Schema,
  terraformValidationRequestV1Schema,
  terraformValidationResultV1Schema,
  terraformValidationTreeDigest,
  type TerraformValidationRequestV1,
  type TerraformValidationRunner,
  type ValidationCommandInvocation,
  type ValidationCommandResult,
  type ValidationWorkspaceExecutor,
  type ValidationWorkspaceSession,
} from "@cloudmarkup/terraform-validation-runner";
import { describe, expect, it } from "vitest";

import { createCandidateArtifactReference } from "./artifact-store.js";
import { digestCanonicalValue, sha256Text } from "./security.js";
import { createTerraformCandidateValidator } from "./terraform-adapter.js";
import {
  candidateTargetValidationResultV1Schema,
  type CandidateTargetValidationInput,
} from "./validation.js";

const assessedAt = "2026-08-21T12:00:00.000Z";
const solutionRevisionId = "solution-revision-terraform-adapter";
const extensionId = "extension.terraform-custom";
const candidatePath = "infrastructure/extensions/custom.tf";
const baselinePath = "infrastructure/generated/main.tf";
const scope = {
  organizationId: "organization-terraform-adapter",
  projectId: "project-terraform-adapter",
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

const compiler = {
  digest: sha256Text("compiler@1.0.0"),
  id: "cloudmarkup.iac-compiler",
  version: "1.0.0",
} as const;

function solutionRevision() {
  const digest = sha256Text("terraform-adapter-solution-revision");
  return solutionRevisionManifestV1Schema.parse({
    aiExtensionIds: [],
    architecture: {
      contentHash: digest,
      documentHash: digest,
      documentKind: "cloudmarkup.architecture-document",
      revisionId: architecture.revision.revisionId,
      schemaVersion: 3,
      visualHash: sha256Text("terraform-adapter-visual"),
    },
    assumptions: [],
    contractVersion: 1,
    contracts: {
      contentHash: sha256Text("terraform-adapter-contracts"),
      contractVersion: 1,
      recordHashes: [],
    },
    createdAt: assessedAt,
    createdBy: "actor-terraform-adapter",
    evidenceIdsAtFreeze: [],
    externalResources: {
      contentHash: sha256Text("terraform-adapter-external-resources"),
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
      reason: "Intent is independently reviewed in this adapter fixture.",
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
        ownership: "approved-extension",
        path: candidatePath,
      },
    ],
    unresolvedDecisionIds: [],
    versions: {
      applicationGenerator: {
        reason: "No application generation is used by this fixture.",
        state: "not-applicable",
      },
      catalog: architecture.catalog,
      compiler: {
        reason: "The baseline request carries the exact compiler pin.",
        state: "not-applicable",
      },
      diagramRenderer: {
        reason: "No diagram rendering is used by this fixture.",
        state: "not-applicable",
      },
      importer: {
        reason: "No repository import is used by this fixture.",
        state: "not-applicable",
      },
      modelPrompt: {
        state: "pinned",
        tool: {
          id: "cloudmarkup.prompt-terraform-extension",
          version: "1.0.0",
        },
      },
      policy: [],
    },
    workload: {
      contentHash: sha256Text("terraform-adapter-workload"),
      contractVersion: 2,
    },
  });
}

function descriptor() {
  return modelInvocationDescriptorV1Schema.parse({
    budgetDecisionId: "budget-decision-terraform-adapter",
    complexity: "deep",
    contractVersion: 1,
    entitlementDecisionId: "entitlement-decision-terraform-adapter",
    evaluationPolicyId: "cloudmarkup.model-evaluation",
    evaluationPolicyVersion: "1.0.0",
    feature: "iac-extension.generate",
    idempotencyKeyDigest: sha256Text("terraform-adapter-idempotency"),
    inputDigest: sha256Text("terraform-adapter-model-input"),
    invocationId: "invocation-terraform-adapter",
    modelId: "model.terraform-adapter-fixture",
    modelVersion: "2026-08-21",
    promptDigest: sha256Text("terraform-adapter-prompt"),
    promptTemplateId: "cloudmarkup.prompt-terraform-extension",
    promptVersion: "1.0.0",
    providerFamily: "deterministic-fake",
    providerId: "provider.terraform-adapter-fixture",
    requestedMode: "professional",
    role: "deep-architecture-custom-generation",
    scope: {
      ...scope,
      solutionRevisionId,
      userId: "user-terraform-adapter",
    },
    toolAuthority: "none",
  });
}

function generationContext(blockKind: "data" | "resource") {
  const schemaDocument =
    '{"additionalProperties":false,"properties":{},"type":"object"}';
  const catalogContent = JSON.stringify({
    catalog: architecture.catalog,
    entries: architecture.nodes.map(({ semantic }) => ({
      resourceType: semantic.resourceType,
      serviceType: semantic.serviceType,
    })),
  });
  const resourceType =
    blockKind === "data" ? "aws_caller_identity" : "aws_cloudwatch_log_group";
  const ownedAddress =
    blockKind === "data"
      ? "data.aws_caller_identity.current"
      : "aws_cloudwatch_log_group.custom";
  return modelGenerationContextV1Schema.parse({
    allowedDependencies: [],
    allowedProviders: [
      {
        providerId: "provider.hashicorp-aws",
        source: "hashicorp/aws",
        versionConstraint: ">= 6.0.0, < 7.0.0",
      },
    ],
    allowedResources: [
      {
        providerId: "provider.hashicorp-aws",
        resourceType,
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
    extensionSlotId: "slot.terraform-custom",
    kind: "iac-extension",
    language: "language.hcl",
    limits: {
      maximumCandidateFileBytes: 16_384,
      maximumCandidateFiles: 1,
      maximumCandidateTotalBytes: 16_384,
      maximumDependencyRequests: 0,
      maximumExpectedTests: 0,
      maximumRepairAttempts: 1,
      maximumResourceCount: 1,
    },
    officialSchemas: [
      {
        document: schemaDocument,
        schemaDigest: sha256Text(schemaDocument),
        schemaId: "schema.terraform-aws-extension",
        schemaVersion: "1.0.0",
      },
    ],
    ownedPaths: [candidatePath],
    ownedResourceAddresses: [ownedAddress],
    protectedPaths: [baselinePath],
    protectedResourceAddresses: ["aws_lambda_function.canonical_worker"],
    requestedBehavior: {
      acceptanceCriteria: ["The candidate remains review-only."],
      objective: "Generate one bounded Terraform extension.",
      requirements: ["Preserve deterministic compiler resources."],
    },
    runtimeFamily: "runtime.terraform",
    sourceReferences: [
      {
        kind: "architecture-node",
        referenceId: "node_worker",
      },
    ],
    targetFormat: "terraform",
    validationExpectations: [
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
    ],
  });
}

function candidateContent(blockKind: "data" | "resource"): string {
  return blockKind === "data"
    ? 'data "aws_caller_identity" "current" {}\n'
    : 'resource "aws_cloudwatch_log_group" "custom" {\n  name              = "/aws/lambda/cloudmarkup-custom"\n  retention_in_days = 14\n}\n';
}

function bundle(
  context: ReturnType<typeof generationContext>,
  invocation: ReturnType<typeof descriptor>,
  content: string,
) {
  return modelCandidateBundleV1Schema.parse({
    assumptions: [],
    boundary: {
      approvalPathIds: ["approval.terraform-extension"],
      boundaryId: extensionId,
      ownedPaths: [candidatePath],
      writeAuthority: "candidate-artifacts-only",
    },
    candidates: [
      {
        candidateId: "candidate-terraform-extension",
        content,
        contentDigest: sha256Text(content),
        encoding: "utf-8",
        kind: "file",
        ownership: "ai-authored-candidate",
        path: candidatePath,
      },
    ],
    dependencies: [],
    expectedTests: [],
    generationPlan: {
      objective: "Create only the exact Terraform candidate file.",
      planId: "plan-terraform-extension",
      steps: [
        {
          action: "create-file",
          rationale: "Use the exact reviewed Terraform extension slot.",
          sourceReferences: context.sourceReferences,
          stepId: "step-terraform-extension",
          targetPath: candidatePath,
        },
      ],
    },
    provenance: {
      contractVersion: 1,
      gatewayId: "cloudmarkup.model-gateway",
      inputDigest: invocation.inputDigest,
      invocationId: invocation.invocationId,
      modelId: invocation.modelId,
      modelVersion: invocation.modelVersion,
      ownership: "untrusted-proposal",
      promptDigest: invocation.promptDigest,
      promptTemplateId: invocation.promptTemplateId,
      promptVersion: invocation.promptVersion,
      providerId: invocation.providerId,
    },
    unresolvedItems: [],
    validationExpectations: context.validationExpectations,
  });
}

const providerLockContent =
  'provider "registry.terraform.io/hashicorp/aws" {\n  version = "6.0.0"\n  hashes  = ["h1:reviewed-fixture"]\n}\n';

function validationPolicy() {
  const tool = (id: string, version: string) => ({
    digest: sha256Text(id + "@" + version),
    id,
    version,
  });
  return terraformValidationPolicyV1Schema.parse({
    compiler,
    container: {
      digest: sha256Text("terraform-adapter-validation-image"),
      image: "registry.example.invalid/cloudmarkup/terraform-validation",
      platform: "linux/amd64",
      providerMirrorPath: "/opt/cloudmarkup/provider-mirror",
      terraformCliConfigPath: "/opt/cloudmarkup/terraform.rc",
    },
    contractVersion: 1,
    limits: {
      cpuSeconds: 30,
      maxFileBytes: 64 * 1024,
      maxFiles: 64,
      maxOutputBytes: 64 * 1024,
      maxProcesses: 16,
      maxTotalFileBytes: 512 * 1024,
      memoryMiB: 512,
      wallTimeMilliseconds: 30_000,
    },
    modules: [],
    providerLock: {
      checksum: sha256Text(providerLockContent),
      content: providerLockContent,
    },
    providers: [
      {
        mirrorPackageDigest: sha256Text("aws-provider-package"),
        source: "hashicorp/aws",
        version: "6.0.0",
      },
    ],
    runner: tool("cloudmarkup.terraform-validation-runner", "1.0.0"),
    scanner: {
      configDigest: sha256Text("trivy-config"),
      required: false,
      tool: tool("aquasecurity.trivy", "0.66.0"),
    },
    terraform: tool("hashicorp.terraform", "1.13.5"),
    tflint: {
      configDigest: sha256Text("tflint-config"),
      required: false,
      tool: tool("terraform-linters.tflint", "0.59.1"),
    },
  });
}

const successByStep = {
  fmt: {
    exitCode: 0,
    outputBytes: 0,
    stderr: "",
    stdout: "",
    termination: "completed",
  },
  init: {
    exitCode: 0,
    outputBytes: 24,
    stderr: "",
    stdout: "Terraform initialized.",
    termination: "completed",
  },
  scanner: {
    exitCode: 0,
    outputBytes: 14,
    stderr: "",
    stdout: '{"Results":[]}',
    termination: "completed",
  },
  tflint: {
    exitCode: 0,
    outputBytes: 13,
    stderr: "",
    stdout: '{"issues":[]}',
    termination: "completed",
  },
  validate: {
    exitCode: 0,
    outputBytes: 48,
    stderr: "",
    stdout: '{"format_version":"1.0","valid":true,"diagnostics":[]}',
    termination: "completed",
  },
} as const satisfies Readonly<Record<string, ValidationCommandResult>>;

class FakeSession implements ValidationWorkspaceSession {
  public execute(
    invocation: ValidationCommandInvocation,
  ): Promise<ValidationCommandResult> {
    return Promise.resolve(successByStep[invocation.step]);
  }

  public dispose(): Promise<void> {
    return Promise.resolve();
  }
}

const executor: ValidationWorkspaceExecutor = {
  open() {
    return Promise.resolve(new FakeSession());
  },
};

function baselineRequest(revision: ReturnType<typeof solutionRevision>) {
  const references = terraformValidationReferenceV1Schema.parse({
    edgeIds: [],
    nodeIds: ["node_worker"],
    ownedPolicyIds: [],
    solutionRevisionId,
  });
  const content =
    'terraform {\n  required_providers {\n    aws = {\n      source  = "hashicorp/aws"\n      version = "6.0.0"\n    }\n  }\n}\n';
  const file = terraformValidationFileV1Schema.parse({
    checksum: sha256Text(content),
    content,
    path: baselinePath,
    references,
  });
  return {
    references,
    request: terraformValidationRequestV1Schema.parse({
      artifactDigest: terraformValidationTreeDigest([file]),
      assessedAt,
      compiler,
      contractVersion: 1,
      environment: {
        environmentId: "environment.development",
        environmentType: "development",
      },
      files: [file],
      solutionRevisionDigest: digestCanonicalValue(revision),
      solutionRevisionId,
    }),
  };
}

function fixture(
  blockKind: "data" | "resource" = "resource",
  tamperEvidence?:
    "bindings" | "candidate-artifact" | "coverage-claim" | "duplicate",
) {
  const revision = solutionRevision();
  const invocation = descriptor();
  const context = generationContext(blockKind);
  const content = candidateContent(blockKind);
  const candidateBundle = bundle(context, invocation, content);
  const file = {
    content,
    digest: sha256Text(content),
    ownership: "ai-authored-candidate" as const,
    path: candidatePath,
    sizeBytes: new TextEncoder().encode(content).byteLength,
    sourceKind: "file" as const,
  };
  const bundleDigest = digestCanonicalValue(candidateBundle);
  const artifact = createCandidateArtifactReference({
    bundleDigest,
    extensionId,
    files: [file],
    scope,
    solutionRevisionId,
    storedAt: assessedAt,
    targetKind: "terraform",
  });
  const input: CandidateTargetValidationInput = {
    artifact,
    assessedAt,
    bundle: candidateBundle,
    descriptor: invocation,
    files: [file],
    generationContext: context,
    solutionRevision: revision,
  };
  const baseline = baselineRequest(revision);
  const captured: TerraformValidationRequestV1[] = [];
  const exactRunner = createTerraformValidationRunner({
    executor,
    policy: validationPolicy(),
  });
  const capturingRunner: TerraformValidationRunner = {
    async run(request, options) {
      const parsed = terraformValidationRequestV1Schema.parse(request);
      captured.push(parsed);
      const result = await exactRunner.run(parsed, options);
      if (tamperEvidence === undefined) return result;
      const sourceEvidence = result.evidenceRecords[0];
      if (sourceEvidence === undefined) {
        throw new Error("Missing Terraform runner Evidence.");
      }
      if (tamperEvidence === "duplicate") {
        return terraformValidationResultV1Schema.parse({
          ...result,
          evidenceRecords: [
            sourceEvidence,
            { ...sourceEvidence, id: "evidence-terraform-duplicate" },
          ],
        });
      }
      return terraformValidationResultV1Schema.parse({
        ...result,
        evidenceRecords: result.evidenceRecords.map((record) => ({
          ...record,
          artifacts:
            tamperEvidence === "candidate-artifact"
              ? record.artifacts.map((reference) =>
                  reference.digest === artifact.artifactDigest
                    ? {
                        ...reference,
                        mediaType: "application/json",
                        sizeBytes: reference.sizeBytes + 1,
                      }
                    : reference,
                )
              : record.artifacts,
          checks: record.checks.map((check) => {
            if (tamperEvidence === "coverage-claim") {
              const {
                generationCoverageRequirement: _requirement,
                ...withoutRequirement
              } = check;
              void _requirement;
              return withoutRequirement;
            }
            return {
              ...check,
              artifactDigests:
                tamperEvidence === "bindings"
                  ? check.artifactDigests.filter(
                      (digest) => digest !== artifact.artifactDigest,
                    )
                  : check.artifactDigests,
            };
          }),
          provenance: {
            ...record.provenance,
            inputDigests:
              tamperEvidence === "bindings"
                ? record.provenance.inputDigests.filter(
                    (digest) => digest !== artifact.artifactDigest,
                  )
                : record.provenance.inputDigests,
          },
        })),
      });
    },
  };
  const validator = createTerraformCandidateValidator({
    baselineRequest: baseline.request,
    candidateReferences: baseline.references,
    hclInspector: {
      inspect() {
        return Promise.resolve(
          hclInspectionResultV1Schema.parse({
            blocks: [],
            contractVersion: 1,
            diagnostics: [],
            parser: {
              id: "cloudmarkup.hcl-inspector",
              version: "1.0.0",
            },
            succeeded: true,
          }),
        );
      },
    },
    runner: capturingRunner,
  });
  return {
    artifact,
    captured,
    context,
    input,
    invocation,
    validator,
  };
}

describe("Terraform candidate validator", () => {
  it.each(["resource", "data"] as const)(
    "preserves exact %s block/provider/resource/address/schema authority and final artifact Evidence",
    async (blockKind) => {
      const test = fixture(blockKind);
      expect(test.input.solutionRevision.aiExtensionIds).toEqual([]);
      const result = await test.validator.validate(test.input);

      expect(result.state, JSON.stringify(result.diagnostics, null, 2)).toBe(
        "passed",
      );
      expect(result.diagnostics).toEqual([]);
      const extensionContext = test.captured[0]?.extensionContext;
      expect(extensionContext).toBeDefined();
      expect(extensionContext?.candidateArtifactDigest).toBe(
        test.artifact.artifactDigest,
      );
      expect(extensionContext?.modelDescriptor).toEqual(test.invocation);
      expect(extensionContext?.providerAuthorities).toEqual(
        test.context.allowedProviders,
      );
      expect(extensionContext?.resourceAuthorities).toEqual([
        {
          blockKind,
          ...test.context.allowedResources[0],
        },
      ]);
      expect(extensionContext?.ownedResourceAddresses).toEqual(
        test.context.ownedResourceAddresses,
      );
      expect(extensionContext?.officialSchemaAuthorities).toEqual(
        test.context.officialSchemas.map(
          ({ schemaDigest, schemaId, schemaVersion }) => ({
            schemaDigest,
            schemaId,
            schemaVersion,
          }),
        ),
      );
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0]?.provenance.inputDigests).toEqual(
        expect.arrayContaining([
          test.artifact.artifactDigest,
          digestCanonicalValue(test.invocation),
          test.context.officialSchemas[0]?.schemaDigest,
        ]),
      );
      expect(result.evidence[0]?.models).toEqual([
        {
          modelId: test.invocation.modelId,
          modelVersion: test.invocation.modelVersion,
          promptVersion: test.invocation.promptVersion,
          providerId: test.invocation.providerId,
        },
      ]);
      expect(
        result.evidence[0]?.artifacts.filter(
          ({ digest }) => digest === test.artifact.artifactDigest,
        ),
      ).toEqual([
        {
          digest: test.artifact.artifactDigest,
          mediaType:
            "application/vnd.cloudmarkup.ai-extension-candidate.v1+json",
          sizeBytes: test.artifact.files.reduce(
            (total, file) => total + file.sizeBytes,
            0,
          ),
        },
      ]);
      expect(
        result.evidence[0]?.checks.filter(
          ({ generationCoverageRequirement }) =>
            generationCoverageRequirement ===
            "ai-extension-parse-static-validity",
        ),
      ).toHaveLength(1);
    },
  );

  it("rejects a re-bundled materialized file that is not the structured model candidate", async () => {
    const test = fixture();
    const content = candidateContent("resource") + "\n";
    const sourceFile = test.input.files[0];
    if (sourceFile === undefined) {
      throw new Error("The adapter fixture requires one materialized file.");
    }
    const file = {
      ...sourceFile,
      content,
      digest: sha256Text(content),
      sizeBytes: new TextEncoder().encode(content).byteLength,
    };
    const artifact = createCandidateArtifactReference({
      bundleDigest: test.artifact.bundleDigest,
      extensionId,
      files: [file],
      scope,
      solutionRevisionId,
      storedAt: assessedAt,
      targetKind: "terraform",
    });

    await expect(
      test.validator.validate({ ...test.input, artifact, files: [file] }),
    ).rejects.toThrow(/file bytes and artifact metadata/u);
    expect(test.captured).toEqual([]);
  });

  it("rejects a descriptor replayed over a bundle from another invocation", async () => {
    const test = fixture();
    const replayed = modelInvocationDescriptorV1Schema.parse({
      ...test.invocation,
      invocationId: "invocation-terraform-adapter-replayed",
    });

    await expect(
      test.validator.validate({ ...test.input, descriptor: replayed }),
    ).rejects.toThrow(/revision, model, path, and validation authority/u);
    expect(test.captured).toEqual([]);
  });

  it("rejects extension identity drift even before the candidate is accepted", async () => {
    const test = fixture();
    const generationContext = modelGenerationContextV1Schema.parse({
      ...test.context,
      extensionId: "extension.terraform-other",
    });

    await expect(
      test.validator.validate({ ...test.input, generationContext }),
    ).rejects.toThrow(
      /exact extension, revision, model, path, and validation authority/u,
    );
    expect(test.captured).toEqual([]);
  });

  it("rejects an official schema whose document no longer matches its authority digest", async () => {
    const test = fixture();
    const generationContext = {
      ...test.context,
      officialSchemas: test.context.officialSchemas.map((schema) => ({
        ...schema,
        document: '{"additionalProperties":true,"type":"object"}',
      })),
    };

    await expect(
      test.validator.validate({ ...test.input, generationContext }),
    ).rejects.toThrow(/official schema integrity/u);
    expect(test.captured).toEqual([]);
  });

  it.each([
    ["missing candidate bindings", "bindings"],
    ["a wrong candidate artifact tuple", "candidate-artifact"],
    ["a missing coverage claim", "coverage-claim"],
    ["duplicate exact qualifying records", "duplicate"],
  ] as const)(
    "drops rank-4 Evidence with %s",
    async (_case, tamperEvidence) => {
      const test = fixture("resource", tamperEvidence);
      const result = await test.validator.validate(test.input);

      expect(result.state).toBe("failed");
      expect(result.evidence).toEqual([]);
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: "provenance",
            code: "cloudmarkup.ai-extension.terraform-evidence-mismatch",
            repairable: false,
            severity: "error",
          }),
        ]),
      );
    },
  );

  it("caps target Evidence at 31 records before coordinator review Evidence is added", async () => {
    const test = fixture();
    const result = await test.validator.validate(test.input);
    const evidence = result.evidence[0];
    if (evidence === undefined) throw new Error("Missing Terraform Evidence.");
    const withCount = (count: number) => ({
      ...result,
      evidence: Array.from({ length: count }, (_, index) => ({
        ...evidence,
        id: `evidence-terraform-${String(index)}`,
      })),
    });

    expect(
      candidateTargetValidationResultV1Schema.safeParse(withCount(31)).success,
    ).toBe(true);
    expect(
      candidateTargetValidationResultV1Schema.safeParse(withCount(32)).success,
    ).toBe(false);
  });
});
