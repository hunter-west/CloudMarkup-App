import { generateApplication } from "@cloudmarkup/application-generator";
import { createNotesGenerationRequest } from "@cloudmarkup/application-generator/testing";
import {
  applicationBuildPolicyV1Schema,
  applicationBuildProfileV1Schema,
  applicationBuildToolPinV1Schema,
  applicationDependencyLockV1Schema,
  canonicalJson,
  createApplicationBuildRunner,
  sha256Digest,
  type ApplicationBuildCommandInvocation,
  type ApplicationBuildCommandResult,
  type ApplicationBuildPolicyV1,
  type ApplicationBuildProducedFile,
  type ApplicationBuildRequestV1,
  type ApplicationBuildRunner,
  type ApplicationBuildSourceFileV1,
  type ApplicationBuildWorkspaceExecutor,
  type ApplicationBuildWorkspaceSession,
  type ApplicationDependencyLockV1,
} from "@cloudmarkup/application-build-runner";
import {
  modelCandidateBundleV1Schema,
  modelGenerationContextV1Schema,
  modelInvocationDescriptorV1Schema,
  prompt32ABuildArtifactEnvelopeV1Schema,
  solutionRevisionManifestV1Schema,
  type ModelCandidateBundleV1,
  type ModelGenerationContextV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { createApplicationCandidateValidator } from "./application-adapter.js";
import { createCandidateArtifactReference } from "./artifact-store.js";
import { digestCanonicalValue, sha256Text } from "./security.js";
import type { CandidateTargetValidationInput } from "./validation.js";

const assessedAt = "2026-08-21T12:00:00.000Z";
const scope = {
  organizationId: "organization-test",
  projectId: "project-test",
} as const;

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function ok(stdout = ""): ApplicationBuildCommandResult {
  return {
    exitCode: 0,
    outputBytes: utf8Bytes(stdout).byteLength,
    stderr: "",
    stdout,
    termination: "completed",
  };
}

function failed(stdout: string): ApplicationBuildCommandResult {
  return {
    exitCode: 1,
    outputBytes: utf8Bytes(stdout).byteLength,
    stderr: "redacted by the bounded test executor",
    stdout,
    termination: "completed",
  };
}

const passingTestOutput = JSON.stringify({
  numFailedTests: 0,
  numPassedTests: 4,
  numPendingTests: 0,
});
const failingTestOutput = JSON.stringify({
  numFailedTests: 1,
  numPassedTests: 3,
  numPendingTests: 0,
});
const scannerOutput = JSON.stringify({ Results: [] });

function pin(id: string, version: string) {
  return applicationBuildToolPinV1Schema.parse({
    digest: sha256Digest(`${id}@${version}`),
    id,
    version,
  });
}

function aiProfile() {
  const descriptor = {
    id: "cloudmarkup.application-build.ai-assisted-custom-nodejs24" as const,
    sourcePolicy: "ai-assisted-custom-only" as const,
    version: "1.0.0" as const,
  };
  return applicationBuildProfileV1Schema.parse({
    ...descriptor,
    digest: sha256Digest(canonicalJson(descriptor)),
  });
}

function buildPolicy(): ApplicationBuildPolicyV1 {
  return applicationBuildPolicyV1Schema.parse({
    builder: pin("cloudmarkup.application-builder", "1.0.0"),
    container: {
      digest: sha256Digest("application-build-image-v1"),
      image: "cloudmarkup/application-build",
      platform: "linux/amd64",
      pnpmStorePath: "/opt/cloudmarkup/pnpm-store",
    },
    contractVersion: 1,
    defaultLimits: {
      cpuSeconds: 120,
      maxArtifactBytes: 16 * 1024 * 1024,
      maxFileBytes: 2 * 1024 * 1024,
      maxFiles: 2_048,
      maxOutputBytes: 256 * 1024,
      maxProcesses: 32,
      maxTotalFileBytes: 64 * 1024 * 1024,
      memoryMiB: 1_024,
      wallTimeMilliseconds: 120_000,
    },
    dependencyAllowlist: [
      {
        kind: "runtime",
        name: "@aws-sdk/client-dynamodb",
        version: "3.1101.0",
      },
      { kind: "development", name: "@types/node", version: "24.13.3" },
      { kind: "development", name: "typescript", version: "6.0.3" },
      { kind: "development", name: "vitest", version: "4.1.10" },
    ],
    dependencyCacheDigest: sha256Digest("approved-offline-pnpm-store-v1"),
    dependencyDenylist: ["event-stream", "ua-parser-js"],
    profile: aiProfile(),
    scanner: pin("aquasecurity.trivy", "0.66.0"),
    secretScanner: pin("aquasecurity.trivy-secret", "0.66.0"),
    toolchain: [
      pin("runtime.nodejs", "24.18.0"),
      pin("package-manager.pnpm", "11.16.0"),
      pin("compiler.typescript", "6.0.3"),
      pin("test-runner.vitest", "4.1.10"),
      pin("packager.cloudmarkup-lambda-zip", "1.0.0"),
    ],
  });
}

function dependencyLock(
  packageManifestChecksum: ApplicationDependencyLockV1["packageManifestChecksum"],
): ApplicationDependencyLockV1 {
  const lockfileContent =
    "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: false\n";
  return applicationDependencyLockV1Schema.parse({
    cache: {
      digest: sha256Digest("approved-offline-pnpm-store-v1"),
      kind: "prepackaged-content-addressed",
      network: "deny",
    },
    contractVersion: 1,
    lifecycleScripts: "deny",
    lockfileChecksum: sha256Digest(lockfileContent),
    lockfileContent,
    lockfilePath: "application/pnpm-lock.yaml",
    packageManager: pin("package-manager.pnpm", "11.16.0"),
    packageManifestChecksum,
    packages: (
      [
        ["@aws-sdk/client-dynamodb", "3.1101.0", "runtime"],
        ["@types/node", "24.13.3", "development"],
        ["typescript", "6.0.3", "development"],
        ["vitest", "4.1.10", "development"],
      ] as const
    ).map(([name, version, kind]) => ({
      integrity: `sha512-${"A".repeat(86)}==`,
      kind,
      name,
      tarballDigest: sha256Digest(`${name}@${version}:tarball`),
      version,
    })),
  });
}

class FakeSession implements ApplicationBuildWorkspaceSession {
  public readonly invocations: ApplicationBuildCommandInvocation[] = [];
  public disposed = false;
  private readonly files: readonly ApplicationBuildSourceFileV1[];
  private readonly entrypoint: string;
  private readonly compiledEntrypoint: string;
  private readonly overrides: Readonly<
    Partial<
      Record<
        ApplicationBuildCommandInvocation["step"],
        ApplicationBuildCommandResult
      >
    >
  >;

  public constructor(
    files: readonly ApplicationBuildSourceFileV1[],
    entrypoint: string,
    compiledEntrypoint: string,
    overrides: Readonly<
      Partial<
        Record<
          ApplicationBuildCommandInvocation["step"],
          ApplicationBuildCommandResult
        >
      >
    >,
  ) {
    this.files = files;
    this.entrypoint = entrypoint;
    this.compiledEntrypoint = compiledEntrypoint;
    this.overrides = overrides;
  }

  public async execute(
    invocation: ApplicationBuildCommandInvocation,
    signal?: AbortSignal,
  ): Promise<ApplicationBuildCommandResult> {
    await Promise.resolve();
    this.invocations.push(invocation);
    if (signal?.aborted === true) {
      return {
        exitCode: null,
        outputBytes: 0,
        stderr: "",
        stdout: "",
        termination: "cancelled",
      };
    }
    return (
      this.overrides[invocation.step] ??
      (invocation.step === "unit-tests" || invocation.step === "contract-tests"
        ? ok(passingTestOutput)
        : invocation.step === "dependency-scan" ||
            invocation.step === "secret-scan"
          ? ok(scannerOutput)
          : ok())
    );
  }

  public async readProducedFiles(): Promise<
    readonly ApplicationBuildProducedFile[]
  > {
    await Promise.resolve();
    const sourceRoot = this.entrypoint.slice(
      0,
      this.entrypoint.lastIndexOf("/") + 1,
    );
    const compiledRoot = this.compiledEntrypoint.slice(
      0,
      this.compiledEntrypoint.lastIndexOf("/") + 1,
    );
    return [
      ...this.files.flatMap((file) =>
        (file.ownership === "generated" || file.ownership === "ai-authored") &&
        file.path.startsWith(sourceRoot) &&
        file.path.endsWith(".ts")
          ? [
              {
                bytes: utf8Bytes(
                  `export const built = ${JSON.stringify(file.path)};\n`,
                ),
                kind: "regular-file" as const,
                path: `${compiledRoot}${file.path
                  .slice(sourceRoot.length)
                  .replace(/\.ts$/u, ".js")}`,
              },
            ]
          : [],
      ),
      {
        bytes: utf8Bytes(
          '{"name":"@aws-sdk/client-dynamodb","version":"3.1101.0"}\n',
        ),
        kind: "regular-file",
        path: "application/node_modules/@aws-sdk/client-dynamodb/package.json",
      },
    ];
  }

  public async dispose(): Promise<void> {
    await Promise.resolve();
    this.disposed = true;
  }
}

function executor(input: {
  readonly compiledEntrypoint: string;
  readonly entrypoint: string;
  readonly overrides?: Readonly<
    Partial<
      Record<
        ApplicationBuildCommandInvocation["step"],
        ApplicationBuildCommandResult
      >
    >
  >;
}): {
  readonly executor: ApplicationBuildWorkspaceExecutor;
  readonly sessions: FakeSession[];
} {
  const sessions: FakeSession[] = [];
  return {
    executor: {
      async open({ files }) {
        await Promise.resolve();
        const session = new FakeSession(
          files,
          input.entrypoint,
          input.compiledEntrypoint,
          input.overrides ?? {},
        );
        sessions.push(session);
        return session;
      },
    },
    sessions,
  };
}

function invocationDescriptor(
  workload: ReturnType<
    typeof createNotesGenerationRequest
  >["workloadBehavior"]["workloads"][number],
) {
  const compatibility = workload.compatibility.modelGateways[0];
  if (compatibility === undefined)
    throw new TypeError("Missing model compatibility.");
  return modelInvocationDescriptorV1Schema.parse({
    budgetDecisionId: "budget-decision-1",
    complexity: "deep",
    contractVersion: 1,
    entitlementDecisionId: "entitlement-decision-1",
    evaluationPolicyId: "evaluation.application-custom",
    evaluationPolicyVersion: "1.0.0",
    feature: "application-source.generate",
    idempotencyKeyDigest: sha256Text("application-candidate-idempotency"),
    inputDigest: sha256Text("application-candidate-input"),
    invocationId: "invocation-application-candidate-1",
    modelId: "model.synthetic",
    modelVersion: "1.0.0",
    promptDigest: compatibility.promptDigest,
    promptTemplateId: compatibility.promptTemplateId,
    promptVersion: compatibility.promptVersion,
    providerFamily: "deterministic-fake",
    providerId: "provider.synthetic",
    requestedMode: "professional",
    role: "deep-architecture-custom-generation",
    scope: {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      solutionRevisionId: "solution_notes_revision_1",
      userId: "user-test",
    },
    toolAuthority: "none",
  });
}

function validationExpectations(
  workload: ReturnType<
    typeof createNotesGenerationRequest
  >["workloadBehavior"]["workloads"][number],
) {
  const required = workload.compatibility.modelGateways[0]?.requiredValidation;
  if (required === undefined)
    throw new TypeError("Missing required validation.");
  return required.map((kind) => ({
    checkId: `cloudmarkup.application.${kind}`,
    kind,
    required: true,
    successCondition: "must-pass" as const,
    toolProfileId: "cloudmarkup.application-build.ai-assisted-custom-nodejs24",
  }));
}

function generationContext(input: {
  readonly buildEnvelope: ReturnType<
    typeof prompt32ABuildArtifactEnvelopeV1Schema.parse
  >;
  readonly extensionPath: string;
  readonly request: ReturnType<typeof createNotesGenerationRequest>;
}): ModelGenerationContextV1 {
  const workload = input.request.workloadBehavior.workloads[0];
  const point = workload?.extensionPoints[0];
  if (
    workload === undefined ||
    point === undefined ||
    workload.languageFamily === undefined ||
    workload.implementation.mode !== "ai-assisted-custom"
  ) {
    throw new TypeError("Missing AI-assisted workload authority.");
  }
  return modelGenerationContextV1Schema.parse({
    allowedDependencies: input.buildEnvelope.contract.dependencies.map(
      (dependency) => ({
        approvalPathId: "approval.application.dependencies",
        ecosystem: "package.npm",
        kind: "package",
        name: dependency.name,
        requestedVersion: dependency.version,
      }),
    ),
    allowedProviders: [],
    allowedResources: [],
    catalogSlice: {
      catalog: input.request.solutionRevision.versions.catalog,
      content:
        "The workload uses the reviewed AWS Lambda application boundary.",
      entries: [
        {
          resourceType: "aws.lambda.function",
          serviceType: "aws.lambda",
        },
      ],
      sliceDigest: sha256Text("application-catalog-slice"),
    },
    existingFiles: [],
    extensionId: workload.implementation.extension.extensionId,
    extensionPointId: point.extensionPointId,
    kind: "application",
    language: workload.languageFamily,
    limits: {
      maximumCandidateFileBytes: 256 * 1024,
      maximumCandidateFiles: 1,
      maximumCandidateTotalBytes: 256 * 1024,
      maximumDependencyRequests: 16,
      maximumExpectedTests: 16,
      maximumRepairAttempts: 1,
      maximumResourceCount: 0,
    },
    officialSchemas: [
      {
        document: '{"additionalProperties":false,"type":"object"}',
        schemaDigest: sha256Text("application-contract-schema"),
        schemaId: "cloudmarkup.application.contracts",
        schemaVersion: "1.0.0",
      },
    ],
    ownedPaths: [input.extensionPath],
    ownedResourceAddresses: [],
    protectedPaths: [],
    protectedResourceAddresses: [],
    requestedBehavior: {
      acceptanceCriteria: ["Canonical unit and contract tests pass."],
      objective: "Implement the reviewed custom notes behavior.",
      requirements: ["Preserve generated bindings and interfaces."],
    },
    runtimeFamily: workload.implementation.runtimeFamily,
    sourceReferences: [
      {
        digest: input.request.solutionRevision.workload.contentHash,
        kind: "workload",
        referenceId: workload.id,
      },
    ],
    validationExpectations: validationExpectations(workload),
    workloadId: workload.id,
  });
}

function candidateBundle(input: {
  readonly content: string;
  readonly context: ModelGenerationContextV1;
  readonly descriptor: ReturnType<
    typeof modelInvocationDescriptorV1Schema.parse
  >;
  readonly path: string;
}): ModelCandidateBundleV1 {
  return modelCandidateBundleV1Schema.parse({
    boundary: {
      approvalPathIds: ["approval.application-source"],
      boundaryId: "application.notes.extensions",
      ownedPaths: [input.path],
      writeAuthority: "candidate-artifacts-only",
    },
    candidates: [
      {
        candidateId: "candidate-application-source",
        content: input.content,
        contentDigest: sha256Text(input.content),
        encoding: "utf-8",
        kind: "file",
        ownership: "ai-authored-candidate",
        path: input.path,
      },
    ],
    dependencies: [],
    generationPlan: {
      objective: "Implement only the reviewed custom source boundary.",
      planId: "plan-application-source",
      steps: [
        {
          action: "create-file",
          rationale:
            "The canonical Workload explicitly authorizes this boundary.",
          sourceReferences: input.context.sourceReferences,
          stepId: "step-application-source",
          targetPath: input.path,
        },
      ],
    },
    provenance: {
      contractVersion: 1,
      gatewayId: "cloudmarkup.model-gateway",
      inputDigest: input.descriptor.inputDigest,
      invocationId: input.descriptor.invocationId,
      modelId: input.descriptor.modelId,
      modelVersion: input.descriptor.modelVersion,
      ownership: "untrusted-proposal",
      promptDigest: input.descriptor.promptDigest,
      promptTemplateId: input.descriptor.promptTemplateId,
      promptVersion: input.descriptor.promptVersion,
      providerId: input.descriptor.providerId,
    },
    validationExpectations: input.context.validationExpectations,
  });
}

function candidateInput(input: {
  readonly bundle: ModelCandidateBundleV1;
  readonly context: ModelGenerationContextV1;
  readonly descriptor: ReturnType<
    typeof modelInvocationDescriptorV1Schema.parse
  >;
  readonly request: ReturnType<typeof createNotesGenerationRequest>;
}): CandidateTargetValidationInput {
  const candidate = input.bundle.candidates[0];
  if (candidate?.kind !== "file")
    throw new TypeError("Missing file candidate.");
  const file = {
    content: candidate.content,
    digest: candidate.contentDigest,
    ownership: "ai-authored-candidate" as const,
    path: candidate.path,
    sizeBytes: utf8Bytes(candidate.content).byteLength,
    sourceKind: "file" as const,
  };
  const bundleDigest = digestCanonicalValue(input.bundle);
  const artifact = createCandidateArtifactReference({
    bundleDigest,
    extensionId: input.context.extensionId,
    files: [file],
    scope,
    solutionRevisionId: input.request.solutionRevision.solutionRevisionId,
    storedAt: assessedAt,
    targetKind: "application",
  });
  return {
    artifact,
    assessedAt,
    bundle: input.bundle,
    descriptor: input.descriptor,
    files: [file],
    generationContext: input.context,
    solutionRevision: input.request.solutionRevision,
  };
}

function fixture(input?: {
  readonly overrides?: Readonly<
    Partial<
      Record<
        ApplicationBuildCommandInvocation["step"],
        ApplicationBuildCommandResult
      >
    >
  >;
  readonly runnerWrapper?: (
    runner: ApplicationBuildRunner,
  ) => ApplicationBuildRunner;
}) {
  let request = createNotesGenerationRequest({
    mode: "ai-assisted-custom",
    operations: ["create", "read", "update", "delete"],
  });
  let scaffold = generateApplication(request);
  const workload = request.workloadBehavior.workloads[0];
  const workloadContract = scaffold.artifact.workloadContracts[0];
  const initialExtensionFile = scaffold.artifact.sourceFiles.find(
    (file) =>
      file.ownership !== "generated" &&
      file.provenance.extensionPointIds.length > 0,
  );
  if (
    workload === undefined ||
    workloadContract?.implementationMode !== "ai-assisted-custom" ||
    initialExtensionFile === undefined ||
    !("content" in initialExtensionFile)
  ) {
    throw new TypeError("Missing deterministic AI scaffold boundary.");
  }
  const initialExtensionPath = initialExtensionFile.path;
  const initialExtensionChecksum = initialExtensionFile.checksum;
  const workloadOwnership = workload.sourceOwnership.find(
    (entry) => entry.path === initialExtensionPath,
  );
  if (workloadOwnership === undefined) {
    throw new TypeError("Missing deterministic extension ownership.");
  }
  request = {
    ...request,
    solutionRevision: solutionRevisionManifestV1Schema.parse({
      ...request.solutionRevision,
      aiExtensionIds: [],
      sourceOwnership: [
        {
          conflictBehavior: "preserve-user-content",
          contentHash: initialExtensionChecksum,
          ownerId: workloadOwnership.ownerId,
          ownership: "user-owned",
          path: initialExtensionPath,
        },
      ],
    }),
  };
  scaffold = generateApplication(request);
  const extensionFile = scaffold.artifact.sourceFiles.find(
    (file) => file.path === workloadOwnership.path,
  );
  if (extensionFile === undefined || !("content" in extensionFile)) {
    throw new TypeError("Missing revision-bound AI scaffold boundary.");
  }
  const complete = generateApplication(
    createNotesGenerationRequest({
      mode: "complete-supported-pattern",
      operations: ["create", "read", "update", "delete"],
    }),
  );
  const reviewed = complete.artifact.buildContracts[0];
  if (reviewed === undefined)
    throw new TypeError("Missing reviewed build envelope.");
  const contract = {
    ...reviewed.contract,
    implementationMode: "ai-assisted-custom" as const,
    workloadId: workload.id,
  };
  const buildEnvelope = prompt32ABuildArtifactEnvelopeV1Schema.parse({
    contract,
    contractDigest: sha256Digest(canonicalJson(contract)),
  });
  const packageFile = scaffold.artifact.sourceFiles.find(
    ({ path }) => path === "application/package.json",
  );
  if (packageFile === undefined)
    throw new TypeError("Missing package manifest.");
  const policy = buildPolicy();
  const fake = executor({
    compiledEntrypoint: buildEnvelope.contract.compiledEntrypoint,
    entrypoint: buildEnvelope.contract.entrypoint,
    ...(input?.overrides === undefined ? {} : { overrides: input.overrides }),
  });
  const baseRunner = createApplicationBuildRunner({
    executor: fake.executor,
    policy,
  });
  const capturedRequests: ApplicationBuildRequestV1[] = [];
  const selectedRunner = input?.runnerWrapper?.(baseRunner) ?? baseRunner;
  const runner: ApplicationBuildRunner = {
    async run(raw, options) {
      const parsed = raw as ApplicationBuildRequestV1;
      capturedRequests.push(structuredClone(parsed));
      return selectedRunner.run(raw, options);
    },
  };
  const context = generationContext({
    buildEnvelope,
    extensionPath: extensionFile.path,
    request,
  });
  const descriptor = invocationDescriptor(workload);
  const content = extensionFile.content.replaceAll(
    "user-required",
    "implemented",
  );
  const bundle = candidateBundle({
    content,
    context,
    descriptor,
    path: extensionFile.path,
  });
  const validationInput = candidateInput({
    bundle,
    context,
    descriptor,
    request,
  });
  const validator = createApplicationCandidateValidator({
    buildEnvelope,
    dependencyLock: dependencyLock(packageFile.checksum),
    deterministicScaffold: scaffold,
    environment: {
      environmentId: "environment.development",
      environmentType: "development",
    },
    limits: policy.defaultLimits,
    profile: policy.profile,
    runner,
    workload,
  });
  return {
    bundle,
    capturedRequests,
    context,
    descriptor,
    extensionFile,
    request,
    validationInput,
    validator,
  };
}

describe("application candidate validation adapter", () => {
  it("builds the exact AI-owned extension and bridges candidate-bound rank-5 Evidence", async () => {
    const test = fixture();
    expect(test.request.solutionRevision.aiExtensionIds).toEqual([]);
    const result = await test.validator.validate(test.validationInput);

    expect(result.state, JSON.stringify(result.diagnostics, null, 2)).toBe(
      "passed",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      level: { kind: "application-build-and-tests", rank: 5 },
      models: [
        {
          modelId: test.descriptor.modelId,
          providerId: test.descriptor.providerId,
        },
      ],
      solutionRevisionId: test.request.solutionRevision.solutionRevisionId,
    });
    expect(result.evidence[0]?.provenance.inputDigests).toEqual(
      expect.arrayContaining([
        test.validationInput.artifact.artifactDigest,
        test.validationInput.artifact.bundleDigest,
      ]),
    );
    expect(
      result.evidence[0]?.artifacts.filter(
        ({ digest }) => digest === test.validationInput.artifact.artifactDigest,
      ),
    ).toEqual([
      {
        digest: test.validationInput.artifact.artifactDigest,
        mediaType: "application/vnd.cloudmarkup.ai-extension-candidate.v1+json",
        sizeBytes: test.validationInput.artifact.files.reduce(
          (total, file) => total + file.sizeBytes,
          0,
        ),
      },
    ]);
    expect(
      result.evidence[0]?.checks
        .map(
          ({ generationCoverageRequirement }) => generationCoverageRequirement,
        )
        .filter((requirement) => requirement !== undefined)
        .sort(),
    ).toEqual(["application-build-and-tests", "application-security-checks"]);
    expect(
      result.outcomes.filter(({ kind }) => kind !== "integration-test"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "parse", result: "passed" }),
        expect.objectContaining({ kind: "format", result: "passed" }),
        expect.objectContaining({ kind: "static-analysis", result: "passed" }),
        expect.objectContaining({ kind: "build", result: "passed" }),
        expect.objectContaining({ kind: "unit-test", result: "passed" }),
        expect.objectContaining({ kind: "contract-test", result: "passed" }),
        expect.objectContaining({ kind: "security", result: "passed" }),
      ]),
    );
    const request = test.capturedRequests[0];
    expect(request?.source.kind).toBe("ai-assisted-custom");
    if (request?.source.kind !== "ai-assisted-custom") {
      throw new TypeError("Expected captured AI source.");
    }
    expect(request.source.aiOwnedPaths).toEqual(test.context.ownedPaths);
    expect(request.source.candidateBundleDigest).not.toBe(
      test.validationInput.artifact.bundleDigest,
    );
    expect(
      request.source.files.find(({ path }) =>
        test.context.ownedPaths.includes(path),
      )?.ownership,
    ).toBe("ai-authored");
    expect(
      request.source.deterministicScaffold.artifact.sourceFiles.find(
        ({ path }) => test.context.ownedPaths.includes(path),
      )?.ownership,
    ).toBe("user-owned");
  }, 15_000);
  it("does not relabel or package a patched user-owned file without an ownership transition", async () => {
    const test = fixture();
    const path = test.context.ownedPaths[0];
    const proposedContent = test.validationInput.files[0]?.content;
    const workload = test.request.workloadBehavior.workloads[0];
    const workloadOwnership = workload?.sourceOwnership.find(
      (entry) => entry.path === path,
    );
    if (
      path === undefined ||
      proposedContent === undefined ||
      workload === undefined ||
      workloadOwnership === undefined
    ) {
      throw new TypeError("Missing user-owned extension fixture.");
    }
    const baseContent = test.extensionFile.content;
    const baseDigest = test.extensionFile.checksum;
    expect(sha256Text(baseContent)).toBe(baseDigest);
    const beforeLines = baseContent.replace(/\n$/u, "").split("\n");
    const afterLines = proposedContent.replace(/\n$/u, "").split("\n");
    const unifiedDiff = [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${String(beforeLines.length)} +1,${String(afterLines.length)} @@`,
      ...beforeLines.map((line) => `-${line}`),
      ...afterLines.map((line) => `+${line}`),
      "",
    ].join("\n");
    const context = modelGenerationContextV1Schema.parse({
      ...test.context,
      existingFiles: [
        {
          content: baseContent,
          contentDigest: baseDigest,
          noSecretValues: true,
          ownership: "user-owned",
          path,
          redactionStatus: "not-required",
          sizeBytes: utf8Bytes(baseContent).byteLength,
        },
      ],
    });
    const solutionRevision = solutionRevisionManifestV1Schema.parse({
      ...test.request.solutionRevision,
      sourceOwnership: [
        {
          conflictBehavior: "preserve-user-content",
          contentHash: baseDigest,
          ownerId: workloadOwnership.ownerId,
          ownership: "user-owned",
          path,
        },
      ],
    });
    const bundle = modelCandidateBundleV1Schema.parse({
      ...test.bundle,
      candidates: [
        {
          baseDigest,
          candidateId: "candidate-application-source",
          kind: "patch",
          ownership: "ai-authored-candidate",
          path,
          proposedResultDigest: sha256Text(proposedContent),
          unifiedDiff,
        },
      ],
      generationPlan: {
        ...test.bundle.generationPlan,
        steps: test.bundle.generationPlan.steps.map((step) => ({
          ...step,
          action: "propose-patch",
        })),
      },
    });
    const file = {
      content: proposedContent,
      digest: sha256Text(proposedContent),
      ownership: "user-owned-preserved" as const,
      path,
      sizeBytes: utf8Bytes(proposedContent).byteLength,
      sourceKind: "patch" as const,
    };
    const artifact = createCandidateArtifactReference({
      bundleDigest: digestCanonicalValue(bundle),
      extensionId: context.extensionId,
      files: [file],
      scope,
      solutionRevisionId: solutionRevision.solutionRevisionId,
      storedAt: assessedAt,
      targetKind: "application",
    });
    const validationInput: CandidateTargetValidationInput = {
      artifact,
      assessedAt,
      bundle,
      descriptor: test.descriptor,
      files: [file],
      generationContext: context,
      solutionRevision,
    };

    const result = await test.validator.validate(validationInput);

    expect(result.state, JSON.stringify(result.diagnostics, null, 2)).toBe(
      "failed",
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "cloudmarkup.ai-extension.application-ownership-transition-required",
      }),
    );
    expect(validationInput.artifact.files[0]).toMatchObject({
      ownership: "user-owned-preserved",
      sourceKind: "patch",
    });
    expect(result.evidence).toEqual([]);
    expect(test.capturedRequests).toEqual([]);

    const staleRevision = solutionRevisionManifestV1Schema.parse({
      ...solutionRevision,
      sourceOwnership: solutionRevision.sourceOwnership.map((entry) => ({
        ...entry,
        contentHash: sha256Text("stale-user-owned-base"),
      })),
    });
    const rejected = await test.validator.validate({
      ...validationInput,
      solutionRevision: staleRevision,
    });
    expect(rejected.state).toBe("failed");
    expect(rejected.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "cloudmarkup.ai-extension.application-authority-mismatch",
      }),
    );
    expect(test.capturedRequests).toEqual([]);
  });

  it("maps a bounded unit-test failure without claiming candidate completion", async () => {
    const test = fixture({
      overrides: { "unit-tests": failed(failingTestOutput) },
    });
    const result = await test.validator.validate(test.validationInput);

    expect(result.state).toBe("failed");
    expect(result.outcomes).toContainEqual(
      expect.objectContaining({ kind: "unit-test", result: "failed" }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        category: "unit-test",
        severity: "error",
      }),
    );
    expect(result.evidence[0]?.level.rank).toBe(5);
    expect(
      result.evidence[0]?.checks.some(({ status }) => status !== "passed"),
    ).toBe(true);
    expect(JSON.stringify(result.diagnostics)).not.toContain("redacted by");
  });

  it("rejects valid but stale runner Evidence from another candidate", async () => {
    let cached: Awaited<ReturnType<ApplicationBuildRunner["run"]>> | undefined;
    const test = fixture({
      runnerWrapper: (runner) => ({
        async run(raw, options) {
          if (cached !== undefined) return cached;
          cached = await runner.run(raw, options);
          return cached;
        },
      }),
    });
    const first = await test.validator.validate(test.validationInput);
    expect(first.state).toBe("passed");
    const changedContent = `${test.validationInput.files[0]?.content ?? ""}\nexport const changed = true;\n`;
    const changedBundle = candidateBundle({
      content: changedContent,
      context: test.context,
      descriptor: test.descriptor,
      path: test.context.ownedPaths[0] ?? "application/invalid.ts",
    });
    const changedInput = candidateInput({
      bundle: changedBundle,
      context: test.context,
      descriptor: test.descriptor,
      request: test.request,
    });
    const result = await test.validator.validate(changedInput);

    expect(result.state).toBe("failed");
    expect(result.evidence).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        category: "provenance",
        code: "cloudmarkup.ai-extension.application-evidence-mismatch",
        repairable: false,
      }),
    );
    expect(test.capturedRequests).toHaveLength(2);
  });

  it.each([
    "application-build-and-tests",
    "application-security-checks",
  ] as const)(
    "rejects runner Evidence missing the %s claim at the strict result boundary",
    async (missingRequirement) => {
      const test = fixture({
        runnerWrapper: (runner) => ({
          async run(raw, options) {
            const result = await runner.run(raw, options);
            const evidence = {
              ...result.evidence,
              checks: result.evidence.checks.map((check) => {
                if (
                  check.generationCoverageRequirement !== missingRequirement
                ) {
                  return check;
                }
                const {
                  generationCoverageRequirement: _requirement,
                  ...withoutRequirement
                } = check;
                void _requirement;
                return withoutRequirement;
              }),
            };
            const { reportDigest: _reportDigest, ...oldProjection } = result;
            void _reportDigest;
            const projection = { ...oldProjection, evidence };
            return {
              ...projection,
              reportDigest: sha256Digest(canonicalJson(projection)),
            };
          },
        }),
      });

      const result = await test.validator.validate(test.validationInput);

      expect(result.state).toBe("error");
      expect(result.evidence).toEqual([]);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          category: "provenance",
          code: "cloudmarkup.ai-extension.application-result-invalid",
          repairable: false,
        }),
      );
      expect(result.outcomes.find(({ kind }) => kind === "parse")?.result).toBe(
        "error",
      );
      expect(
        result.outcomes
          .filter(({ kind }) => kind !== "parse")
          .every(({ result }) => result === "not-run"),
      ).toBe(true);
    },
  );
});
