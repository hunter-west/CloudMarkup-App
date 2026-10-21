import { generateApplication } from "@cloudmarkup/application-generator";
import {
  createEventGenerationRequest,
  createMultiWorkloadEventGenerationRequest,
  createNotesGenerationRequest,
  createHttpNoContentFixture,
} from "@cloudmarkup/application-generator/testing";
import {
  solutionRevisionManifestV1Schema,
  type ApplicationGenerationRequestV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  applicationAiCandidateBundleDigest,
  applicationBuildRequestDigest,
  applicationBuildSourceTreeDigest,
  applicationBuildPolicyV1Schema,
  applicationBuildProfileV1Schema,
  applicationBuildRequestV1Schema,
  applicationBuildResultV1Schema,
  applicationBuildToolPinV1Schema,
  applicationBuildSourceFileV1Schema,
  applicationDependencyLockV1Schema,
  type ApplicationBuildCommandInvocation,
  type ApplicationBuildCommandResult,
  type ApplicationBuildPolicyV1,
  type ApplicationBuildProducedFile,
  type ApplicationBuildRequestV1,
  type ApplicationBuildSourceFileV1,
  type ApplicationBuildWorkspaceExecutor,
  type ApplicationBuildWorkspaceSession,
  type ApplicationDependencyLockV1,
} from "./contracts.js";
import { createApplicationBuildRunner } from "./runner.js";
import {
  canonicalJson,
  compareUtf16,
  sha256Digest,
  utf8Bytes,
} from "./security.js";
import { createDeterministicLambdaZip } from "./zip.js";

const assessedAt = "2026-08-18T12:00:00.000Z";
const eventPatterns = [
  "s3-image-metadata",
  "sqs-consumer-dlq",
  "sns-fanout-consumer",
  "eventbridge-scheduled",
  "eventbridge-target",
  "step-functions-task",
] as const;
type EventPattern = (typeof eventPatterns)[number];
const ok = (stdout = ""): ApplicationBuildCommandResult => ({
  exitCode: 0,
  outputBytes: utf8Bytes(stdout).byteLength,
  stderr: "",
  stdout,
  termination: "completed",
});

const testOutput = JSON.stringify({
  numFailedTests: 0,
  numPassedTests: 4,
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

function generatedProfile() {
  const descriptor = {
    id: "cloudmarkup.application-build.generated-nodejs24" as const,
    sourcePolicy: "generated-only" as const,
    version: "1.0.0" as const,
  };
  return applicationBuildProfileV1Schema.parse({
    ...descriptor,
    digest: sha256Digest(canonicalJson(descriptor)),
  });
}

function staticProfile() {
  const descriptor = {
    id: "cloudmarkup.application-build.user-source-static-nodejs24" as const,
    sourcePolicy: "user-provided-static-only" as const,
    version: "1.0.0" as const,
  };
  return applicationBuildProfileV1Schema.parse({
    ...descriptor,
    digest: sha256Digest(canonicalJson(descriptor)),
  });
}

function aiAssistedProfile() {
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

function policy(
  profile: ApplicationBuildPolicyV1["profile"] = generatedProfile(),
): ApplicationBuildPolicyV1 {
  return applicationBuildPolicyV1Schema.parse({
    builder: pin("cloudmarkup.application-builder", "1.0.0"),
    container: {
      digest: sha256Digest("cloudmarkup-application-build-image-v1"),
      image: "cloudmarkup/application-build",
      platform: "linux/amd64",
      pnpmStorePath: "/opt/cloudmarkup/pnpm-store",
    },
    contractVersion: 1,
    dependencyCacheDigest: sha256Digest("approved-offline-pnpm-store-v1"),
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
    dependencyDenylist: ["event-stream", "ua-parser-js"],
    profile,
    scanner: pin("aquasecurity.trivy", "0.74.0"),
    secretScanner: pin("aquasecurity.trivy-secret", "0.74.0"),
    toolchain: [
      pin("runtime.nodejs", "24.18.0"),
      pin("package-manager.pnpm", "11.16.0"),
      pin("compiler.typescript", "6.0.3"),
      pin("test-runner.vitest", "4.1.10"),
      pin("packager.cloudmarkup-lambda-zip", "1.0.0"),
    ],
  });
}

function lock(
  packageManifestChecksum: ApplicationDependencyLockV1["packageManifestChecksum"],
): ApplicationDependencyLockV1 {
  const lockfileContent = `lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: false\n`;
  const packageManager = policy().toolchain.find(
    (tool) => tool.id === "package-manager.pnpm",
  );
  if (packageManager === undefined) {
    throw new TypeError("Missing approved pnpm test pin.");
  }
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
    packageManager,
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

function generatedFixtureFromRequest(
  generationRequest: ApplicationGenerationRequestV1,
  envelopeIndex = 0,
) {
  const applicationGeneration = generateApplication(generationRequest);
  const envelope = applicationGeneration.artifact.buildContracts[envelopeIndex];
  if (envelope === undefined)
    throw new TypeError("Missing generated build envelope.");
  const packageFile = applicationGeneration.artifact.sourceFiles.find(
    (file) => file.path === "application/package.json",
  );
  if (packageFile === undefined)
    throw new TypeError("Missing package manifest.");
  const buildPolicy = policy();
  const request = applicationBuildRequestV1Schema.parse({
    assessedAt,
    contractVersion: 1,
    dependencyLock: lock(packageFile.checksum),
    environment: {
      environmentId: "environment.development",
      environmentType: "development",
    },
    limits: buildPolicy.defaultLimits,
    profile: buildPolicy.profile,
    solutionRevision: generationRequest.solutionRevision,
    solutionRevisionDigest: sha256Digest(
      canonicalJson(generationRequest.solutionRevision),
    ),
    source: {
      applicationGeneration,
      buildContractDigest: envelope.contractDigest,
      kind: "generated",
    },
  });
  return { applicationGeneration, buildPolicy, envelope, request };
}

function generatedFixture() {
  return generatedFixtureFromRequest(
    createNotesGenerationRequest({
      operations: ["create", "read", "update", "delete"],
    }),
  );
}

function eventGeneratedFixture(pattern: EventPattern) {
  return generatedFixtureFromRequest(createEventGenerationRequest({ pattern }));
}

function multiEventGeneratedFixture(envelopeIndex: number) {
  return generatedFixtureFromRequest(
    createMultiWorkloadEventGenerationRequest(),
    envelopeIndex,
  );
}

function producedFiles(
  fixture: ReturnType<typeof generatedFixture>,
): ApplicationBuildProducedFile[] {
  const sourceRoot = fixture.envelope.contract.entrypoint.slice(
    0,
    fixture.envelope.contract.entrypoint.lastIndexOf("/") + 1,
  );
  const compiledRoot = fixture.envelope.contract.compiledEntrypoint.slice(
    0,
    fixture.envelope.contract.compiledEntrypoint.lastIndexOf("/") + 1,
  );
  const compiled = fixture.applicationGeneration.artifact.sourceFiles.flatMap(
    (file) =>
      file.ownership === "generated" &&
      file.path.startsWith(sourceRoot) &&
      file.path.endsWith(".ts") &&
      !file.path.includes("/extensions/")
        ? [
            {
              bytes: utf8Bytes(
                `export const built = ${JSON.stringify(file.path)};\n`,
              ),
              kind: "regular-file" as const,
              path: `${compiledRoot}${file.path.slice(sourceRoot.length).replace(/\.ts$/u, ".js")}`,
            },
          ]
        : [],
  );
  return [
    ...compiled,
    {
      bytes: utf8Bytes(
        '{"name":"@aws-sdk/client-dynamodb","version":"3.1101.0"}\n',
      ),
      kind: "regular-file",
      path: "application/node_modules/@aws-sdk/client-dynamodb/package.json",
    },
    {
      bytes: utf8Bytes("excluded source map"),
      kind: "regular-file",
      path: `${compiledRoot}index.js.map`,
    },
    {
      bytes: utf8Bytes("user extension must not ship"),
      kind: "regular-file",
      path: `${compiledRoot}extensions/custom.js`,
    },
    {
      bytes: utf8Bytes("test output must not ship"),
      kind: "regular-file",
      path: "application/dist/tests/functions/notes_handler/unit.test.js",
    },
  ];
}

function aiAssistedFixture() {
  const baseGenerationRequest = createNotesGenerationRequest({
    mode: "ai-assisted-custom",
    operations: ["create", "read", "update", "delete"],
  });
  const generationRequest = {
    ...baseGenerationRequest,
    solutionRevision: solutionRevisionManifestV1Schema.parse({
      ...baseGenerationRequest.solutionRevision,
      aiExtensionIds: [],
    }),
  };
  const deterministicScaffold = generateApplication(generationRequest);
  const workloadContract =
    deterministicScaffold.artifact.workloadContracts.find(
      (entry) => entry.implementationMode === "ai-assisted-custom",
    );
  if (workloadContract?.implementationMode !== "ai-assisted-custom") {
    throw new TypeError("Missing AI-assisted workload contract.");
  }
  const workloadId = workloadContract.workloadId;
  const scaffoldFiles = deterministicScaffold.artifact.sourceFiles.filter(
    (file) => file.provenance.workloadIds.includes(workloadId),
  );
  const extension = scaffoldFiles.find(
    (file) =>
      file.ownership === "user-owned" &&
      file.provenance.extensionPointIds.length > 0,
  );
  if (
    extension === undefined ||
    !("content" in extension) ||
    typeof extension.content !== "string"
  ) {
    throw new TypeError("Missing materialized AI extension boundary.");
  }
  const candidateContent = extension.content.replaceAll(
    "user-required",
    "implemented",
  );
  const files = scaffoldFiles
    .map((file): ApplicationBuildSourceFileV1 => {
      if (!("content" in file) || typeof file.content !== "string") {
        throw new TypeError(`Missing scaffold content for ${file.path}.`);
      }
      const aiAuthored = file.path === extension.path;
      const content = aiAuthored ? candidateContent : file.content;
      return {
        checksum: sha256Digest(content),
        content,
        mediaType: applicationBuildSourceFileV1Schema.shape.mediaType.parse(
          file.mediaType,
        ),
        ownership: aiAuthored ? "ai-authored" : "generated",
        path: file.path,
      };
    })
    .sort((left, right) => compareUtf16(left.path, right.path));
  const aiOwnedPaths = [extension.path];
  const referenceEnvelope = generatedFixture().envelope;
  const contract = {
    ...referenceEnvelope.contract,
    implementationMode: "ai-assisted-custom" as const,
    sourceInputs: files.map(({ checksum, path }) => ({ checksum, path })),
    workloadId,
  };
  const buildEnvelope = {
    contract,
    contractDigest: sha256Digest(canonicalJson(contract)),
  };
  const selectedProfile = aiAssistedProfile();
  const buildPolicy = policy(selectedProfile);
  const packageFile = files.find(
    (file) => file.path === "application/package.json",
  );
  if (packageFile === undefined) throw new TypeError("Missing package file.");
  const sourceTreeDigest = applicationBuildSourceTreeDigest(files);
  const candidateBundleDigest = applicationAiCandidateBundleDigest({
    aiOwnedPaths,
    extensionId: "extension.notes.custom",
    files,
  });
  const request = applicationBuildRequestV1Schema.parse({
    assessedAt,
    contractVersion: 1,
    dependencyLock: lock(packageFile.checksum),
    environment: {
      environmentId: "environment.development",
      environmentType: "development",
    },
    limits: buildPolicy.defaultLimits,
    profile: selectedProfile,
    solutionRevision: generationRequest.solutionRevision,
    solutionRevisionDigest: sha256Digest(
      canonicalJson(generationRequest.solutionRevision),
    ),
    source: {
      aiOwnedPaths,
      buildEnvelope,
      candidateBundleDigest,
      deterministicScaffold,
      extensionId: "extension.notes.custom",
      files,
      kind: "ai-assisted-custom",
      sourceTreeDigest,
      unresolvedBehaviorIds: [],
    },
  });
  return { buildEnvelope, buildPolicy, deterministicScaffold, files, request };
}

function aiProducedFiles(
  fixture: ReturnType<typeof aiAssistedFixture>,
): ApplicationBuildProducedFile[] {
  const sourceRoot = fixture.buildEnvelope.contract.entrypoint.slice(
    0,
    fixture.buildEnvelope.contract.entrypoint.lastIndexOf("/") + 1,
  );
  const compiledRoot = fixture.buildEnvelope.contract.compiledEntrypoint.slice(
    0,
    fixture.buildEnvelope.contract.compiledEntrypoint.lastIndexOf("/") + 1,
  );
  const compiled = fixture.files.flatMap((file) =>
    (file.ownership === "generated" || file.ownership === "ai-authored") &&
    file.path.startsWith(sourceRoot) &&
    file.path.endsWith(".ts")
      ? [
          {
            bytes: utf8Bytes(
              `export const built = ${JSON.stringify(file.path)};\n`,
            ),
            kind: "regular-file" as const,
            path: `${compiledRoot}${file.path.slice(sourceRoot.length).replace(/\.ts$/u, ".js")}`,
          },
        ]
      : [],
  );
  return [
    ...compiled,
    {
      bytes: utf8Bytes(
        '{"name":"@aws-sdk/client-dynamodb","version":"3.1101.0"}\n',
      ),
      kind: "regular-file",
      path: "application/node_modules/@aws-sdk/client-dynamodb/package.json",
    },
  ];
}

type FakeOverrides = Readonly<
  Partial<
    Record<
      ApplicationBuildCommandInvocation["step"],
      ApplicationBuildCommandResult
    >
  >
>;

class FakeSession implements ApplicationBuildWorkspaceSession {
  private readonly outputs: readonly ApplicationBuildProducedFile[];
  private readonly overrides: FakeOverrides;
  public readonly invocations: ApplicationBuildCommandInvocation[] = [];
  public disposed = false;

  public constructor(
    overrides: FakeOverrides,
    outputs: readonly ApplicationBuildProducedFile[],
  ) {
    this.overrides = overrides;
    this.outputs = outputs;
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
        ? ok(testOutput)
        : invocation.step === "dependency-scan" ||
            invocation.step === "secret-scan"
          ? ok(scannerOutput)
          : ok())
    );
  }

  public async readProducedFiles() {
    await Promise.resolve();
    return this.outputs;
  }

  public async dispose() {
    await Promise.resolve();
    this.disposed = true;
  }
}

function fakeExecutor(
  outputs: readonly ApplicationBuildProducedFile[],
  overrides: FakeOverrides = {},
): {
  executor: ApplicationBuildWorkspaceExecutor;
  openedFiles: ApplicationBuildSourceFileV1[];
  session: FakeSession;
} {
  const session = new FakeSession(overrides, outputs);
  const openedFiles: ApplicationBuildSourceFileV1[] = [];
  return {
    executor: {
      async open(input) {
        await Promise.resolve();
        openedFiles.push(...input.files);
        return session;
      },
    },
    openedFiles,
    session,
  };
}

async function runFixture(
  overrides: FakeOverrides = {},
  mutate?: (request: ApplicationBuildRequestV1) => ApplicationBuildRequestV1,
  outputFactory?: (
    fixture: ReturnType<typeof generatedFixture>,
  ) => readonly ApplicationBuildProducedFile[],
) {
  const fixture = generatedFixture();
  const fake = fakeExecutor(
    outputFactory?.(fixture) ?? producedFiles(fixture),
    overrides,
  );
  const runner = createApplicationBuildRunner({
    executor: fake.executor,
    policy: fixture.buildPolicy,
  });
  const request = mutate?.(structuredClone(fixture.request)) ?? fixture.request;
  return { fixture, result: await runner.run(request), session: fake.session };
}

function rebindAiRequest(
  raw: ApplicationBuildRequestV1,
  files: readonly ApplicationBuildSourceFileV1[],
): ApplicationBuildRequestV1 {
  const request = structuredClone(raw);
  if (request.source.kind !== "ai-assisted-custom") {
    throw new TypeError("Expected AI-assisted source.");
  }
  request.source.files = [...files].sort((left, right) =>
    compareUtf16(left.path, right.path),
  );
  request.source.aiOwnedPaths = request.source.files
    .filter((file) => file.ownership === "ai-authored")
    .map((file) => file.path)
    .sort(compareUtf16);
  const contract = {
    ...request.source.buildEnvelope.contract,
    sourceInputs: request.source.files.map(({ checksum, path }) => ({
      checksum,
      path,
    })),
  };
  request.source.buildEnvelope = {
    contract,
    contractDigest: sha256Digest(canonicalJson(contract)),
  };
  request.source.sourceTreeDigest = applicationBuildSourceTreeDigest(
    request.source.files,
  );
  request.source.candidateBundleDigest = applicationAiCandidateBundleDigest({
    aiOwnedPaths: request.source.aiOwnedPaths,
    extensionId: request.source.extensionId,
    files: request.source.files,
  });
  return applicationBuildRequestV1Schema.parse(request);
}

async function runAiFixture(
  mutate?: (request: ApplicationBuildRequestV1) => ApplicationBuildRequestV1,
  overrides: FakeOverrides = {},
) {
  const fixture = aiAssistedFixture();
  const fake = fakeExecutor(aiProducedFiles(fixture), overrides);
  const runner = createApplicationBuildRunner({
    executor: fake.executor,
    policy: fixture.buildPolicy,
  });
  const request = mutate?.(structuredClone(fixture.request)) ?? fixture.request;
  return {
    fixture,
    openedFiles: fake.openedFiles,
    request,
    result: await runner.run(request),
    session: fake.session,
  };
}

function userSourceRequest(
  source: string,
  selectedProfile: ReturnType<typeof generatedProfile>,
  scripts = false,
) {
  const fixture = generatedFixture();
  const packageContent = canonicalJson({
    dependencies: { "@aws-sdk/client-dynamodb": "3.1101.0" },
    devDependencies: {
      "@types/node": "24.13.3",
      typescript: "6.0.3",
      vitest: "4.1.10",
    },
    ...(scripts ? { scripts: { postinstall: "node unknown.js" } } : {}),
    private: true,
    type: "module",
  });
  const files = [
    {
      checksum: sha256Digest(packageContent),
      content: packageContent,
      mediaType: "application/json" as const,
      ownership: "user-provided" as const,
      path: "application/package.json" as const,
    },
    {
      checksum: sha256Digest(source),
      content: source,
      mediaType: "text/typescript" as const,
      ownership: "user-provided" as const,
      path: "application/src/index.ts" as const,
    },
  ].sort((left, right) => compareUtf16(left.path, right.path));
  const sourceTreeDigest = sha256Digest(
    canonicalJson(
      files.map(({ checksum, mediaType, ownership, path }) => ({
        checksum,
        mediaType,
        ownership,
        path,
      })),
    ),
  );
  const buildPolicy = policy(selectedProfile);
  const request = applicationBuildRequestV1Schema.parse({
    ...fixture.request,
    dependencyLock: lock(files[0]?.checksum ?? sha256Digest("missing")),
    profile: selectedProfile,
    source: {
      files,
      kind: "user-provided",
      runtime: fixture.envelope.contract.runtime,
      sourceTreeDigest,
    },
  });
  return { buildPolicy, request };
}

describe("isolated application build runner", () => {
  it("admits only the complete notes 1.1 tuple through the generated profile", async () => {
    for (const tamperedField of [undefined, "template", "pattern"] as const) {
      const fixture = generatedFixtureFromRequest(
        createNotesGenerationRequest({
          identifierSafeGenerator: true,
          entityContractId: "contracts.repair-seed.entity",
          operations: ["create", "read", "update", "delete"],
        }),
      );
      const request = structuredClone(fixture.request);
      if (request.source.kind !== "generated")
        throw new Error("Expected generated source.");
      if (tamperedField !== undefined) {
        const artifact = request.source.applicationGeneration.artifact;
        artifact[tamperedField] =
          generatedFixture().applicationGeneration.artifact[tamperedField];
        artifact.sourceManifest[tamperedField] = artifact[tamperedField];
        artifact.sourceManifestDigest = sha256Digest(
          canonicalJson(artifact.sourceManifest),
        );
        request.source.applicationGeneration.artifactDigest = sha256Digest(
          canonicalJson(artifact),
        );
      }
      const fake = fakeExecutor(producedFiles(fixture));
      const runner = createApplicationBuildRunner({
        executor: fake.executor,
        policy: fixture.buildPolicy,
      });
      const result = await runner.run(request);
      if (tamperedField === undefined) {
        expect(result.state, JSON.stringify(result.diagnostics)).toBe("passed");
        expect(fake.session.invocations.length).toBeGreaterThan(0);
        expect(fake.session.disposed).toBe(true);
      } else {
        expect(result.state).toBe("blocked");
        expect(result.diagnostics.map((entry) => entry.code)).toContain(
          "application.build.generator-not-approved",
        );
        expect(fake.session.invocations).toEqual([]);
      }
    }
  });
  it("builds, tests, scans, and packages every curated event artifact through Prompt 32A", async () => {
    const cases = [
      ...eventPatterns.map((pattern) => ({
        fixture: eventGeneratedFixture(pattern),
        label: pattern,
      })),
      { fixture: multiEventGeneratedFixture(0), label: "sns-fanout-first" },
      { fixture: multiEventGeneratedFixture(1), label: "sns-fanout-second" },
    ];

    for (const eventCase of cases) {
      const fake = fakeExecutor(producedFiles(eventCase.fixture));
      const runner = createApplicationBuildRunner({
        executor: fake.executor,
        policy: eventCase.fixture.buildPolicy,
      });
      const first = await runner.run(eventCase.fixture.request);
      expect(
        first.state,
        `${eventCase.label}: ${JSON.stringify(first.diagnostics)}`,
      ).toBe("passed");
      expect(fake.session.invocations.map(({ step }) => step)).toEqual([
        "install",
        "lint",
        "typecheck",
        "unit-tests",
        "contract-tests",
        "dependency-scan",
        "secret-scan",
        "compile",
        "production-prune",
      ]);
      expect(first.coverage).toMatchObject({
        confirmedState: "complete-supported-pattern",
        inputState: "complete-supported-pattern",
      });
      expect(
        first.evidence.checks.every((check) => check.status === "passed"),
      ).toBe(true);
      const zip = first.artifacts.find(
        (artifact) => artifact.mediaType === "application/zip",
      );
      const manifestArtifact = first.artifacts.find((artifact) =>
        artifact.path.endsWith("/artifact-manifest.json"),
      );
      const archive = Buffer.from(zip?.bytesBase64 ?? "", "base64").toString(
        "utf8",
      );
      expect(archive).toContain("index.js");
      expect(archive).toContain("generated/runtime-extension.js");
      expect(archive).not.toContain("extensions/custom.js");
      expect(archive).not.toContain("unit.test.js");
      const manifest = JSON.parse(
        Buffer.from(manifestArtifact?.bytesBase64 ?? "", "base64").toString(
          "utf8",
        ),
      ) as { artifact: { archiveEntrypoint: string; checksum: string } };
      expect(manifest.artifact).toMatchObject({
        archiveEntrypoint:
          eventCase.fixture.envelope.contract.expectedArtifact
            .archiveEntrypoint,
        checksum: zip?.checksum,
      });
    }
  });
  it("builds and attests an exact AI-owned extension without relabeling the deterministic scaffold", async () => {
    const { fixture, openedFiles, result, session } = await runAiFixture();
    if (fixture.request.source.kind !== "ai-assisted-custom") {
      throw new TypeError("Expected AI-assisted source.");
    }
    const aiOwnedPath = fixture.request.source.aiOwnedPaths[0];
    if (aiOwnedPath === undefined) {
      throw new TypeError("Expected an AI-owned extension path.");
    }
    expect(fixture.request.solutionRevision.aiExtensionIds).toEqual([]);

    expect(result.state, JSON.stringify(result.diagnostics, null, 2)).toBe(
      "passed",
    );
    expect(result.diagnostics).toEqual([]);
    expect(session.invocations.map((entry) => entry.step)).toEqual([
      "install",
      "lint",
      "typecheck",
      "unit-tests",
      "contract-tests",
      "dependency-scan",
      "secret-scan",
      "compile",
      "production-prune",
    ]);
    expect(new Set(openedFiles.map((file) => file.ownership))).toEqual(
      new Set(["generated", "ai-authored"]),
    );
    expect(
      fixture.deterministicScaffold.artifact.sourceFiles.find(
        (file) => file.path === aiOwnedPath,
      )?.ownership,
    ).toBe("user-owned");
    expect(result.coverage).toMatchObject({
      aiExtensionId: fixture.request.source.extensionId,
      candidateBundleDigest: fixture.request.source.candidateBundleDigest,
      confirmedState: "ai-assisted-custom-validated",
      generationArtifactDigest: fixture.deterministicScaffold.artifactDigest,
      inputState: "ai-assisted-custom-validated",
      sourceTreeDigest: fixture.request.source.sourceTreeDigest,
    });
    expect(
      result.artifacts.every(
        (artifact) => artifact.ownership === "ai-assisted-build-artifact",
      ),
    ).toBe(true);
    expect(result.artifacts[0]?.provenance).toMatchObject({
      aiExtensionId: fixture.request.source.extensionId,
      candidateBundleDigest: fixture.request.source.candidateBundleDigest,
      sourceTreeDigest: fixture.request.source.sourceTreeDigest,
    });
    expect(result.evidence.provenance.inputDigests).toEqual(
      expect.arrayContaining([
        fixture.request.source.candidateBundleDigest,
        fixture.request.source.sourceTreeDigest,
        fixture.deterministicScaffold.artifactDigest,
      ]),
    );
    expect(
      result.evidence.checks.every((check) => check.status === "passed"),
    ).toBe(true);
    const archive = Buffer.from(
      result.artifacts.find(
        (artifact) => artifact.mediaType === "application/zip",
      )?.bytesBase64 ?? "",
      "base64",
    ).toString("utf8");
    expect(archive).toContain("extensions/custom.js");
    expect(archive).not.toContain("unit.test.js");

    const repeated = await runAiFixture();
    expect(repeated.result).toEqual(result);
  });

  it("blocks AI source under a non-AI profile before execution", async () => {
    const { result, session } = await runAiFixture((request) =>
      applicationBuildRequestV1Schema.parse({
        ...request,
        profile: generatedProfile(),
      }),
    );
    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      "application.build.ai-assisted-profile-required",
    );
    expect(session.invocations).toEqual([]);
  });

  it("blocks an extension ID that no longer matches the candidate bundle digest", async () => {
    const { result, session } = await runAiFixture((request) => {
      if (request.source.kind !== "ai-assisted-custom") {
        throw new TypeError("Expected AI-assisted source.");
      }
      return applicationBuildRequestV1Schema.parse({
        ...request,
        source: {
          ...request.source,
          extensionId: "extension.notes.other",
        },
      });
    });
    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      "application.build.candidate-bundle-digest-mismatch",
    );
    expect(session.invocations).toEqual([]);
  });
  it("does not persist a user-owned sibling sentinel emitted by a failing AI test", async () => {
    const sentinel = "USER_OWNED_SIBLING_SENTINEL_6f3a";
    const { result } = await runAiFixture(undefined, {
      "unit-tests": {
        ...ok(
          JSON.stringify({
            numFailedTests: 1,
            numPassedTests: 3,
            numPendingTests: 0,
          }),
        ),
        exitCode: 1,
        stderr: `AI-authored test emitted ${sentinel}`,
        stdout: JSON.stringify({
          emitted: sentinel,
          numFailedTests: 1,
          numPassedTests: 3,
          numPendingTests: 0,
        }),
      },
    });

    expect(result.state).toBe("failed");
    expect(result.tests).toContainEqual({
      failed: 1,
      kind: "unit",
      passed: 3,
      skipped: 0,
      state: "failed",
    });
    expect(
      result.diagnostics.find(
        ({ code }) => code === "application.build.unit-tests-failed",
      )?.detail,
    ).toBe(
      "The approved unit-tests command exited with a non-zero status; raw tool output is not included.",
    );
    expect(canonicalJson(result)).not.toContain(sentinel);
    expect(canonicalJson(result.evidence)).not.toContain(sentinel);

    expect(result.artifacts).toEqual([]);
    expect(result.coverage).toMatchObject({
      confirmedState: "custom-implementation-required",
      inputState: "ai-assisted-custom-validated",
    });
    expect(result.coverage.evidenceId).toBeUndefined();
    expect(result.evidence.artifacts).toEqual([]);
    expect(
      result.evidence.checks.some((check) => check.status !== "passed"),
    ).toBe(true);
  });

  it("blocks missing generated tests and unresolved behavior", async () => {
    const missingTests = await runAiFixture((request) => {
      if (request.source.kind !== "ai-assisted-custom") {
        throw new TypeError("Expected AI-assisted source.");
      }
      return rebindAiRequest(
        request,
        request.source.files.filter(
          (file) => !file.path.endsWith("/unit.test.ts"),
        ),
      );
    });
    expect(missingTests.result.state).toBe("blocked");
    expect(
      missingTests.result.diagnostics.map((entry) => entry.code),
    ).toContain("application.build.required-tests-missing");
    expect(missingTests.session.invocations).toEqual([]);

    const unresolved = await runAiFixture((request) => {
      if (request.source.kind !== "ai-assisted-custom") {
        throw new TypeError("Expected AI-assisted source.");
      }
      return applicationBuildRequestV1Schema.parse({
        ...request,
        source: {
          ...request.source,
          unresolvedBehaviorIds: ["behavior.pending"],
        },
      });
    });
    expect(unresolved.result.state).toBe("blocked");
    expect(unresolved.result.diagnostics.map((entry) => entry.code)).toContain(
      "application.build.unresolved-behavior",
    );
    expect(unresolved.session.invocations).toEqual([]);
  });

  it("blocks AI ownership overlap with a deterministic scaffold path", async () => {
    const { result, session } = await runAiFixture((request) => {
      if (request.source.kind !== "ai-assisted-custom") {
        throw new TypeError("Expected AI-assisted source.");
      }
      const generated = request.source.files.find(
        (file) =>
          file.ownership === "generated" && file.path.endsWith("/index.ts"),
      );
      if (generated === undefined) throw new TypeError("Missing handler.");
      return rebindAiRequest(
        request,
        request.source.files.map((file) =>
          file.path === generated.path
            ? { ...file, ownership: "ai-authored" as const }
            : file,
        ),
      );
    });
    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      "application.build.ai-source-ownership-overlap",
    );
    expect(session.invocations).toEqual([]);
  });

  it.each([
    ["candidate bundle", "candidateBundleDigest"],
    ["source tree", "sourceTreeDigest"],
  ] as const)("blocks an exact %s digest mismatch", async (_, field) => {
    const { result, session } = await runAiFixture((request) => {
      if (request.source.kind !== "ai-assisted-custom") {
        throw new TypeError("Expected AI-assisted source.");
      }
      return applicationBuildRequestV1Schema.parse({
        ...request,
        source: {
          ...request.source,
          [field]: sha256Digest(`tampered-${field}`),
        },
      });
    });
    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      field === "candidateBundleDigest"
        ? "application.build.candidate-bundle-digest-mismatch"
        : "application.build.source-tree-digest-mismatch",
    );
    expect(session.invocations).toEqual([]);
  });
  it("builds, tests, scans, packages, and attests the complete notes API", async () => {
    const { fixture, result, session } = await runFixture();

    expect(result.state, JSON.stringify(result.diagnostics, null, 2)).toBe(
      "passed",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.tests).toEqual([
      { failed: 0, kind: "unit", passed: 4, skipped: 0, state: "passed" },
      { failed: 0, kind: "contract", passed: 4, skipped: 0, state: "passed" },
    ]);
    expect(result.coverage).toMatchObject({
      buildRequestDigest: applicationBuildRequestDigest(fixture.request),
      confirmedState: "complete-supported-pattern",
      generationArtifactDigest: fixture.applicationGeneration.artifactDigest,
      inputState: "complete-supported-pattern",
      solutionRevisionDigest: fixture.request.solutionRevisionDigest,
      solutionRevisionId: fixture.request.solutionRevision.solutionRevisionId,
    });
    expect(result.evidence.environment).toEqual(fixture.request.environment);
    expect(result.artifacts[0]?.provenance).toMatchObject({
      buildRequestDigest: applicationBuildRequestDigest(fixture.request),
      generationArtifactDigest: fixture.applicationGeneration.artifactDigest,
    });
    expect(result.evidence.level).toEqual({
      kind: "application-build-and-tests",
      rank: 5,
    });
    expect(
      result.evidence.checks.every((check) => check.status === "passed"),
    ).toBe(true);
    expect(
      result.artifacts.find(
        (artifact) => artifact.mediaType === "application/zip",
      )?.path,
    ).toBe(fixture.envelope.contract.expectedArtifact.path);
    expect(session.invocations.map((entry) => entry.step)).toEqual([
      "install",
      "lint",
      "typecheck",
      "unit-tests",
      "contract-tests",
      "dependency-scan",
      "secret-scan",
      "compile",
      "production-prune",
    ]);
    expect(session.disposed).toBe(true);

    const archive = Buffer.from(
      result.artifacts.find(
        (artifact) => artifact.mediaType === "application/zip",
      )?.bytesBase64 ?? "",
      "base64",
    ).toString("utf8");
    expect(archive).not.toContain("unit.test.js");
    expect(archive).not.toContain("index.js.map");
    expect(archive).not.toContain("extensions/custom.js");
    expect(archive).toContain("index.js");

    const zip = result.artifacts.find(
      (entry) => entry.mediaType === "application/zip",
    );
    const manifestArtifact = result.artifacts.find((entry) =>
      entry.path.endsWith("/artifact-manifest.json"),
    );
    expect(zip).toBeDefined();
    expect(manifestArtifact).toBeDefined();
    const manifest = JSON.parse(
      Buffer.from(manifestArtifact?.bytesBase64 ?? "", "base64").toString(
        "utf8",
      ),
    ) as {
      artifact: {
        archiveEntrypoint: string;
        checksum: string;
        handler: string;
        path: string;
      };
      bindings: {
        buildContractDigest: string;
        solutionRevisionId: string;
        workloadId: string;
      };
      kind: string;
      runtime: { runtime: string };
    };
    expect(manifest).toMatchObject({
      artifact: {
        archiveEntrypoint: "index.js",
        checksum: zip?.checksum,
        handler: fixture.envelope.contract.expectedArtifact.handler,
        path: fixture.envelope.contract.expectedArtifact.path,
      },
      bindings: {
        buildContractDigest: fixture.envelope.contractDigest,
        solutionRevisionId: fixture.request.solutionRevision.solutionRevisionId,
        workloadId: fixture.envelope.contract.workloadId,
      },
      kind: "cloudmarkup.lambda-artifact-manifest",
      runtime: { runtime: "nodejs24.x" },
    });

    const repeated = await runFixture();
    expect(repeated.result).toEqual(result);
  });

  it.each(["template", "pattern"] as const)(
    "rejects a forged generated %s pin before execution",
    async (field) => {
      const { result, session } = await runFixture({}, (request) => {
        if (request.source.kind !== "generated") {
          throw new TypeError("Expected generated source.");
        }
        const artifact = request.source.applicationGeneration.artifact;
        const forgedPin = {
          ...artifact[field],
          digest: sha256Digest(`forged-${field}`),
        };
        const forgedSourceManifest = {
          ...artifact.sourceManifest,
          [field]: forgedPin,
        };
        const forgedArtifact = {
          ...artifact,
          [field]: forgedPin,
          sourceManifest: forgedSourceManifest,
          sourceManifestDigest: sha256Digest(
            canonicalJson(forgedSourceManifest),
          ),
        };
        return applicationBuildRequestV1Schema.parse({
          ...request,
          source: {
            ...request.source,
            applicationGeneration: {
              ...request.source.applicationGeneration,
              artifact: forgedArtifact,
              artifactDigest: sha256Digest(canonicalJson(forgedArtifact)),
            },
          },
        });
      });

      expect(result.state).toBe("blocked");
      expect(result.diagnostics.map(({ code }) => code)).toContain(
        "application.build.generator-not-approved",
      );
      expect(session.invocations).toEqual([]);
    },
  );

  it.each(["lint", "typecheck"] as const)(
    "fails closed on a %s failure",
    async (step) => {
      const { result } = await runFixture({
        [step]: {
          ...ok(),
          exitCode: 1,
          stderr: "C:\\Users\\operator\\secret\\source.ts failed",
        },
      });
      expect(result.state).toBe("failed");
      expect(result.artifacts).toEqual([]);
      expect(result.diagnostics[0]?.detail).toBe(
        `The approved ${step} command exited with a non-zero status; raw tool output is not included.`,
      );
      expect(canonicalJson(result)).not.toContain("operator");
    },
  );

  it("blocks packaging when the production dependency prune fails", async () => {
    const { result } = await runFixture({
      "production-prune": { ...ok(), exitCode: 1 },
    });
    expect(result.state).toBe("failed");
    expect(result.artifacts).toEqual([]);
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "application.build.production-prune-failed",
    );
  });

  it.each(["unit-tests", "contract-tests"] as const)(
    "downgrades complete coverage on a %s failure",
    async (step) => {
      const { result } = await runFixture({
        [step]: {
          ...ok(
            JSON.stringify({
              numFailedTests: 1,
              numPassedTests: 3,
              numPendingTests: 0,
            }),
          ),
          exitCode: 1,
        },
      });
      expect(result.state).toBe("failed");
      expect(result.coverage.confirmedState).toBe(
        "custom-implementation-required",
      );
      expect(result.coverage.evidenceId).toBeUndefined();
      expect(result.evidence.checks[0]?.status).toBe("failed");
    },
  );

  it("rejects dependency tampering", async () => {
    const { result } = await runFixture({}, (request) => ({
      ...request,
      dependencyLock: {
        ...request.dependencyLock,
        packages: request.dependencyLock.packages.map((entry, index) =>
          index === 0
            ? { ...entry, version: "3.1100.0" as typeof entry.version }
            : entry,
        ),
      },
    }));
    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      "application.build.lockfile-dependency-mismatch",
    );
  });

  it("rejects a lockfile checksum mismatch", async () => {
    const { result } = await runFixture({}, (request) => ({
      ...request,
      dependencyLock: {
        ...request.dependencyLock,
        lockfileContent: `${request.dependencyLock.lockfileContent}tampered: true\n`,
      },
    }));
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      "application.build.lockfile-checksum-mismatch",
    );
  });

  it("rejects lifecycle scripts before execution", async () => {
    const fixture = userSourceRequest(
      "export const value = 1;\n",
      generatedProfile(),
      true,
    );
    const fake = fakeExecutor([]);
    const result = await createApplicationBuildRunner({
      executor: fake.executor,
      policy: fixture.buildPolicy,
    }).run(fixture.request);
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      "application.build.lifecycle-script-forbidden",
    );
    expect(fake.session.invocations).toEqual([]);
  });

  it("detects secrets without echoing them", async () => {
    const secret = `AKIA${"A".repeat(16)}`;
    const fixture = userSourceRequest(
      `export const credential = "${secret}";\n`,
      staticProfile(),
    );
    const fake = fakeExecutor([]);
    const result = await createApplicationBuildRunner({
      executor: fake.executor,
      policy: fixture.buildPolicy,
    }).run(fixture.request);
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      "application.build.secret-detected",
    );
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("rejects malicious source paths at the public boundary", async () => {
    const fixture = userSourceRequest("export {};\n", staticProfile());
    const malicious = structuredClone(fixture.request) as unknown as {
      source: { files: { path: string }[] };
    };
    const maliciousFile = malicious.source.files[0];
    if (maliciousFile === undefined) throw new TypeError("Missing file.");
    maliciousFile.path = "application/../credentials";
    await expect(
      createApplicationBuildRunner({
        executor: fakeExecutor([]).executor,
        policy: fixture.buildPolicy,
      }).run(malicious),
    ).rejects.toThrow();
  });

  it.each([
    ["output-limit", "error"],
    ["timeout", "error"],
  ] as const)("handles %s without packaging", async (termination, expected) => {
    const { result } = await runFixture({
      install: {
        exitCode: null,
        outputBytes: 300_000,
        stderr: "",
        stdout: "",
        termination,
      },
    });
    expect(result.state).toBe(expected);
    expect(result.artifacts).toEqual([]);
  });

  it("honors cancellation and always disposes", async () => {
    const fixture = generatedFixture();
    const fake = fakeExecutor(producedFiles(fixture));
    const controller = new AbortController();
    controller.abort();
    const result = await createApplicationBuildRunner({
      executor: fake.executor,
      policy: fixture.buildPolicy,
    }).run(fixture.request, { signal: controller.signal });
    expect(result.state).toBe("cancelled");
    expect(fake.session.disposed).toBe(true);
  });

  it("produces byte-identical ZIPs independent of input ordering", () => {
    const entries = [
      { bytes: utf8Bytes("b"), path: "generated/b.js" },
      { bytes: utf8Bytes("a"), path: "index.js" },
    ];
    expect(createDeterministicLambdaZip(entries)).toEqual(
      createDeterministicLambdaZip([...entries].reverse()),
    );
  });

  it("disables user-provided source under the generated profile", async () => {
    const fixture = userSourceRequest("export {};\n", generatedProfile());
    const fake = fakeExecutor([]);
    const result = await createApplicationBuildRunner({
      executor: fake.executor,
      policy: fixture.buildPolicy,
    }).run(fixture.request);
    expect(result.state).toBe("blocked");
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      "application.build.user-source-disabled",
    );
    expect(fake.session.invocations).toEqual([]);
  });

  it("keeps explicitly approved user source static-only", async () => {
    const fixture = userSourceRequest("export {};\n", staticProfile());
    const fake = fakeExecutor([]);
    const result = await createApplicationBuildRunner({
      executor: fake.executor,
      policy: fixture.buildPolicy,
    }).run(fixture.request);
    expect(result.state).toBe("blocked");
    expect(result.artifacts).toEqual([]);
    expect(result.coverage.confirmedState).toBe(
      "custom-implementation-required",
    );
    expect(fake.session.invocations.map((entry) => entry.step)).toEqual([
      "lint",
      "typecheck",
      "dependency-scan",
      "secret-scan",
    ]);
  });

  it.each([".npmrc", ".pnpmfile.cjs"] as const)(
    "rejects a static-only package-manager hook at %s before execution",
    async (name) => {
      const buildFixture = userSourceRequest("export {};\n", staticProfile());
      const request = structuredClone(buildFixture.request);
      if (request.source.kind !== "user-provided") {
        throw new TypeError("Expected user-provided source fixture.");
      }
      const content = "registry=https://attacker.invalid\n";
      request.source.files = [
        ...request.source.files,
        applicationBuildSourceFileV1Schema.parse({
          checksum: sha256Digest(content),
          content,
          mediaType: "text/markdown",
          ownership: "user-provided",
          path: `application/${name}`,
        }),
      ].sort((left, right) => compareUtf16(left.path, right.path));
      request.source.sourceTreeDigest = applicationBuildSourceTreeDigest(
        request.source.files,
      );
      const fake = fakeExecutor([]);
      const result = await createApplicationBuildRunner({
        executor: fake.executor,
        policy: buildFixture.buildPolicy,
      }).run(request);
      expect(result.state).toBe("blocked");
      expect(result.artifacts).toEqual([]);
      expect(result.diagnostics.map(({ code }) => code)).toContain(
        "application.build.source-path-unsafe",
      );
      expect(fake.session.invocations).toEqual([]);
    },
  );

  it("keeps the Lambda artifact path compatible with Prompt 29 Terraform", async () => {
    const { fixture, result } = await runFixture();
    const artifact = result.artifacts.find(
      (entry) => entry.mediaType === "application/zip",
    );
    expect(artifact?.path).toBe(
      fixture.envelope.contract.expectedArtifact.path,
    );
    if (artifact === undefined) throw new TypeError("Missing Lambda artifact.");
    expect(`../${artifact.path}`).toBe(
      "../application/artifacts/workload_notes_api/function.zip",
    );
    expect(fixture.envelope.contract.expectedArtifact.handler).toBe(
      "index.handler",
    );
  });

  it.each(["unit-tests", "dependency-scan"] as const)(
    "fails closed on malformed successful %s output",
    async (step) => {
      const { result } = await runFixture({ [step]: ok("not-json") });
      expect(result.state).toBe("error");
      expect(result.artifacts).toEqual([]);
      expect(result.diagnostics.map(({ code }) => code)).toContain(
        step === "unit-tests"
          ? "application.build.test-summary-malformed"
          : "application.build.scan-results-malformed",
      );
    },
  );

  it.each([
    { Results: [null] },
    { Results: [{}] },
    { Results: [{ Vulnerabilities: [null] }] },
    {
      Results: [
        {
          Vulnerabilities: [
            { VulnerabilityID: "invalid-severity", Severity: "HIHG" },
          ],
        },
      ],
    },
    {
      Results: [
        ...Array.from({ length: 256 }, () => ({ Vulnerabilities: [] })),
        {
          Vulnerabilities: [
            { VulnerabilityID: "late-critical", Severity: "CRITICAL" },
          ],
        },
      ],
    },
    {
      Results: [
        {
          Vulnerabilities: [
            ...Array.from({ length: 256 }, (_, i) => ({
              VulnerabilityID: "low-" + String(i),
              Severity: "LOW",
            })),
            { VulnerabilityID: "late-critical", Severity: "CRITICAL" },
          ],
        },
      ],
    },
  ])(
    "rejects incomplete or oversized scanner output %# without an artifact",
    async (report) => {
      const { result } = await runFixture({
        "dependency-scan": ok(JSON.stringify(report)),
      });
      expect(result.state).toBe("error");
      expect(result.artifacts).toEqual([]);
      expect(result.diagnostics.map(({ code }) => code)).toContain(
        "application.build.scan-results-malformed",
      );
    },
  );

  it("accepts the pinned pnpm clean package inventory with omitted findings", async () => {
    const report = JSON.stringify({
      Results: [
        {
          Target: "pnpm-lock.yaml",
          Class: "lang-pkgs",
          Type: "pnpm",
          Packages: [
            {
              Name: "typescript",
              Version: "6.0.3",
              ID: "typescript@6.0.3",
              AnalyzedBy: "pnpm",
            },
          ],
        },
      ],
    });
    const { result } = await runFixture({
      "dependency-scan": ok(report),
      "secret-scan": ok(report),
    });
    expect(result.state).toBe("passed");
  });

  it("blocks packaging on a high dependency finding", async () => {
    const { result } = await runFixture({
      "dependency-scan": ok(
        JSON.stringify({
          Results: [
            {
              Target: "application/pnpm-lock.yaml",
              Vulnerabilities: [
                {
                  PkgName: "example-package",
                  Severity: "HIGH",
                  Title: "Reviewed high severity fixture",
                  VulnerabilityID: "CVE-2026-0001",
                },
              ],
            },
          ],
        }),
      ),
    });
    expect(result.state).toBe("failed");
    expect(result.artifacts).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "application.build.security-findings",
    );
  });

  it("rejects unsafe and duplicate portable build output paths", async () => {
    const { result } = await runFixture({}, undefined, (fixture) => [
      ...producedFiles(fixture),
      {
        bytes: utf8Bytes("malicious"),
        kind: "regular-file",
        path: "application/dist/../credentials",
      },
      {
        bytes: utf8Bytes("duplicate"),
        kind: "regular-file",
        path: "APPLICATION/dist/functions/notes_handler/index.js",
      },
    ]);
    expect(result.state).toBe("failed");
    expect(result.artifacts).toEqual([]);
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "application.build.output-file-unsafe",
    );
  });

  it("rejects forged report, artifact, and step evidence at the public schema boundary", async () => {
    const { result } = await runFixture();
    expect(
      applicationBuildResultV1Schema.safeParse({
        ...result,
        reportDigest: sha256Digest("forged-report"),
      }).success,
    ).toBe(false);
    const artifact = result.artifacts[0];
    if (artifact === undefined) throw new TypeError("Missing build artifact.");
    expect(
      applicationBuildResultV1Schema.safeParse({
        ...result,
        artifacts: [
          {
            ...artifact,
            bytesBase64: `${artifact.bytesBase64.slice(0, -4)}AAAA`,
          },
          ...result.artifacts.slice(1),
        ],
      }).success,
    ).toBe(false);
    const { reportDigest, ...projection } = result;
    void reportDigest;
    const forgedProjection = {
      ...projection,
      coverage: {
        ...projection.coverage,
        generationArtifactDigest: sha256Digest("forged-generation"),
      },
    };
    expect(
      applicationBuildResultV1Schema.safeParse({
        ...forgedProjection,
        reportDigest: sha256Digest(canonicalJson(forgedProjection)),
      }).success,
    ).toBe(false);
    const duplicateStepProjection = {
      ...projection,
      steps: projection.steps.map((step, index) =>
        index === projection.steps.length - 1
          ? { ...step, executable: "tsc", step: "compile" }
          : step,
      ),
    };
    expect(
      applicationBuildResultV1Schema.safeParse({
        ...duplicateStepProjection,
        reportDigest: sha256Digest(canonicalJson(duplicateStepProjection)),
      }).success,
    ).toBe(false);

    const buildCheck = projection.evidence.checks.find(
      ({ checkId }) =>
        checkId === "cloudmarkup.evidence.application-build-and-tests",
    );
    const securityCheck = projection.evidence.checks.find(
      ({ checkId }) =>
        checkId === "cloudmarkup.evidence.application-security-checks",
    );
    if (buildCheck === undefined || securityCheck === undefined) {
      throw new TypeError("Passing build Evidence checks are required.");
    }
    const evidenceCheckForgeries = [
      {
        checks: [buildCheck],
        label: "missing security check",
      },
      {
        checks: [
          buildCheck,
          securityCheck,
          {
            ...buildCheck,
            checkId: "cloudmarkup.evidence.unrelated-check",
          },
        ],
        label: "extra check",
      },
      {
        checks: [buildCheck, securityCheck, { ...securityCheck }],
        label: "duplicate check",
      },
      {
        checks: [
          buildCheck,
          {
            ...securityCheck,
            generationCoverageRequirement: "application-build-and-tests",
          },
        ],
        label: "mismatched coverage requirement",
      },
      {
        checks: [
          buildCheck,
          {
            ...securityCheck,
            status: "skipped",
          },
        ],
        label: "non-passing security check",
      },
      {
        checks: [
          buildCheck,
          {
            ...securityCheck,
            issueIds: ["application.build.security-findings"],
          },
        ],
        label: "passing security check with issues",
      },
      {
        checks: [
          buildCheck,
          {
            ...securityCheck,
            artifactDigests: securityCheck.artifactDigests.slice(1),
          },
        ],
        label: "incomplete artifact commitment",
      },
    ];
    for (const forgery of evidenceCheckForgeries) {
      const forgedEvidenceProjection = {
        ...projection,
        evidence: { ...projection.evidence, checks: forgery.checks },
      };
      expect(
        applicationBuildResultV1Schema.safeParse({
          ...forgedEvidenceProjection,
          reportDigest: sha256Digest(canonicalJson(forgedEvidenceProjection)),
        }).success,
        forgery.label,
      ).toBe(false);
    }
  });
});

describe("exact no-content generated build admission", () => {
  it("admits the exact stateless tuple without runtime packages and rejects mixed descriptors before execution", async () => {
    for (const field of [
      undefined,
      "generator",
      "template",
      "pattern",
    ] as const) {
      const fixture = generatedFixtureFromRequest(createHttpNoContentFixture());
      const buildPolicy = applicationBuildPolicyV1Schema.parse({
        ...fixture.buildPolicy,
        dependencyAllowlist: fixture.buildPolicy.dependencyAllowlist.filter(
          (dependency) => dependency.kind === "development",
        ),
      });
      const request = structuredClone(fixture.request);
      request.dependencyLock.packages = request.dependencyLock.packages.filter(
        (dependency) => dependency.kind === "development",
      );
      if (request.source.kind !== "generated")
        throw Error("Expected generated source.");
      if (field !== undefined) {
        const artifact = request.source.applicationGeneration.artifact;
        artifact[field] =
          generatedFixture().applicationGeneration.artifact[field];
        artifact.sourceManifest[field] = artifact[field];
        artifact.sourceManifestDigest = sha256Digest(
          canonicalJson(artifact.sourceManifest),
        );
        request.source.applicationGeneration.artifactDigest = sha256Digest(
          canonicalJson(artifact),
        );
      }
      const fake = fakeExecutor(
        producedFiles(fixture).filter(
          (file) => !file.path.includes("node_modules"),
        ),
      );
      const result = await createApplicationBuildRunner({
        executor: fake.executor,
        policy: buildPolicy,
      }).run(request);
      if (field === undefined) {
        expect(result.state, JSON.stringify(result.diagnostics)).toBe("passed");
        expect(fake.session.invocations.length).toBeGreaterThan(0);
        expect(fake.session.disposed).toBe(true);
      } else {
        expect(result.state).toBe("blocked");
        expect(
          result.diagnostics.map((diagnostic) => diagnostic.code),
        ).toContain("application.build.generator-not-approved");
        expect(fake.session.invocations).toEqual([]);
      }
    }
  });
});
