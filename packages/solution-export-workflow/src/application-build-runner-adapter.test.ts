import { generateApplication } from "@cloudmarkup/application-generator";
import {
  applicationBuildRequestDigest,
  applicationBuildRequestV1Schema,
  applicationBuildResultV1Schema,
  applicationBuildSourceFileV1Schema,
  applicationBuildSourceTreeDigest,
  type ApplicationBuildRequestV1,
  type ApplicationBuildResultV1,
  type ApplicationBuildRunner,
} from "@cloudmarkup/application-build-runner";
import {
  evidenceRecordV1Schema,
  serializeCanonicalJson,
} from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";
import { describe, expect, it } from "vitest";

import {
  applicationBuildRequestFromWorkflowInput,
  applicationBuildRequestsFromWorkflowInput,
  createSolutionExportApplicationBuildPort,
} from "./application-build-runner-adapter.js";
import {
  solutionExportApplicationBuildBatchInputV1Schema,
  solutionExportApplicationBuildBatchResultV1Schema,
  solutionExportWorkflowRequestV1Schema,
  solutionExportWorkflowStageDescriptorsV1Schema,
  solutionExportWorkflowTargetSettingsDigest,
} from "./contracts.js";
import { SolutionExportWorkflowFailureError } from "./orchestrator.js";
import { passingBuildResult } from "./passing-build.test-support.js";
import {
  durableJsonReference,
  multiWorkloadEventWorkflowFixture,
  workflowFixture,
} from "./workflow.test-support.js";

function digest(value: unknown) {
  return sha256Digest(serializeCanonicalJson(value));
}

function buildPortFixture() {
  const fixture = workflowFixture("complete-supported-pattern");
  const generation = generateApplication(fixture.generationRequest);
  const envelope = generation.artifact.buildContracts[0];
  const packageManifest = generation.artifact.sourceFiles.find(
    ({ path }) => path === "application/package.json",
  );
  if (envelope === undefined || packageManifest === undefined) {
    throw new TypeError(
      "Adapter fixture requires one generated build handoff.",
    );
  }
  const limits = {
    cpuSeconds: 120,
    maxArtifactBytes: 8 * 1024 * 1024,
    maxFileBytes: 2 * 1024 * 1024,
    maxFiles: 2_048,
    maxOutputBytes: 256 * 1024,
    maxProcesses: 32,
    maxTotalFileBytes: 16 * 1024 * 1024,
    memoryMiB: 1_024,
    wallTimeMilliseconds: 120_000,
  } as const;
  const profile = {
    digest: sha256Digest("approved-generated-nodejs24-profile"),
    id: "cloudmarkup.application-build.generated-nodejs24" as const,
    sourcePolicy: "generated-only" as const,
    version: "1.0.0" as const,
  };
  const lockfileContent = "lockfileVersion: '9.0'\n";
  const buildRequest = applicationBuildRequestV1Schema.parse({
    assessedAt: fixture.generationRequest.solutionRevision.createdAt,
    contractVersion: 1,
    dependencyLock: {
      cache: {
        digest: sha256Digest("approved-offline-store"),
        kind: "prepackaged-content-addressed",
        network: "deny",
      },
      contractVersion: 1,
      lifecycleScripts: "deny",
      lockfileChecksum: sha256Digest(lockfileContent),
      lockfileContent,
      lockfilePath: "application/pnpm-lock.yaml",
      packageManager: {
        digest: sha256Digest("package-manager.pnpm@11.16.0"),
        id: "package-manager.pnpm",
        version: "11.16.0",
      },
      packageManifestChecksum: packageManifest.checksum,
      packages: [
        {
          integrity: `sha512-${"A".repeat(86)}==`,
          kind: "runtime",
          name: "@aws-sdk/client-dynamodb",
          tarballDigest: sha256Digest("client-dynamodb-tarball"),
          version: "3.1101.0",
        },
      ],
    },
    environment: fixture.request.environment,
    limits,
    profile,
    solutionRevision: fixture.generationRequest.solutionRevision,
    solutionRevisionDigest: digest(fixture.generationRequest.solutionRevision),
    source: {
      applicationGeneration: generation,
      buildContractDigest: envelope.contractDigest,
      kind: "generated",
    },
  });
  if (fixture.request.targetSettings.target !== "terraform") {
    throw new TypeError("Expected Terraform workflow fixture.");
  }
  const approvedSettings =
    solutionExportWorkflowStageDescriptorsV1Schema.shape.applicationBuild.parse(
      {
        adapter:
          fixture.request.targetSettings.stageDescriptors.applicationBuild
            .adapter,
        dependencyContractDigest: digest(envelope.contract.dependencies),
        limitsDigest: digest(limits),
        profileDigest: buildRequest.profile.digest,
        profileId: buildRequest.profile.id,
        toolchainDigest: digest(envelope.contract.toolchain),
      },
    );
  const buildInputReference = durableJsonReference(
    "object.application-build-inputs.adapter-test",
    buildRequest,
  );
  const { digest: targetSettingsDigest, ...targetProjection } =
    fixture.request.targetSettings;
  void targetSettingsDigest;
  const targetSettingsProjection = {
    ...targetProjection,
    stageDescriptors: {
      ...targetProjection.stageDescriptors,
      applicationBuild: approvedSettings,
    },
  };
  const request = solutionExportWorkflowRequestV1Schema.parse({
    ...fixture.request,
    sources: {
      ...fixture.request.sources,
      applicationBuildInputs: buildInputReference,
    },
    targetSettings: {
      ...targetSettingsProjection,
      digest: solutionExportWorkflowTargetSettingsDigest(
        targetSettingsProjection,
      ),
    },
  });
  return {
    approvedSettings,
    buildRequest,
    fixture,
    generation,
    input: {
      generation,
      request,
      settings: approvedSettings,
      signal: new AbortController().signal,
      sources: {
        applicationBuildInputs: buildRequest,
        architectureDocument: fixture.generationRequest.architectureDocument,
        solutionRevision: fixture.generationRequest.solutionRevision,
        workloadBehavior: fixture.generationRequest.workloadBehavior,
      },
    },
  };
}

function resultFor(
  request: ApplicationBuildRequestV1,
  adapter: ReturnType<typeof buildPortFixture>["approvedSettings"]["adapter"],
) {
  const requestDigest = applicationBuildRequestDigest(request);
  const evidence = evidenceRecordV1Schema.parse({
    artifacts: [],
    checks: [
      {
        artifactDigests: [],
        checkId: "cloudmarkup.evidence.application-build-and-tests",
        generationCoverageRequirement: "application-build-and-tests",
        issueIds: [],
        redactedFailure: "The synthetic adapter test did not execute a build.",
        status: "error",
        summary: "The injected runner returned a bounded synthetic result.",
      },
    ],
    contractVersion: 1,
    environment: request.environment,
    id: "evidence_application_build_adapter_test",
    layer: "generated",
    level: { kind: "application-build-and-tests", rank: 5 },
    models: [],
    provenance: {
      actor: { kind: "deterministic-tool", tool: adapter },
      createdAt: request.assessedAt,
      inputDigests: [
        requestDigest,
        request.solutionRevisionDigest,
        request.source.kind === "generated"
          ? request.source.applicationGeneration.artifactDigest
          : request.source.sourceTreeDigest,
      ].sort(),
    },
    solutionRevisionId: request.solutionRevision.solutionRevisionId,
    staleness: { assessedAt: request.assessedAt, state: "current" },
    tools: [adapter],
  });
  const projection = {
    artifacts: [],
    contractVersion: 1 as const,
    coverage: {
      buildRequestDigest: requestDigest,
      confirmedState: "custom-implementation-required" as const,
      downgradeReason: "The synthetic adapter test did not execute a build.",
      ...(request.source.kind === "generated"
        ? {
            generationArtifactDigest:
              request.source.applicationGeneration.artifactDigest,
          }
        : {}),
      inputState: "complete-supported-pattern" as const,
      solutionRevisionDigest: request.solutionRevisionDigest,
      solutionRevisionId: request.solutionRevision.solutionRevisionId,
      workloadId: "workload_notes_api",
    },
    diagnostics: [],
    evidence,
    findings: [],
    state: "error" as const,
    steps: [],
    tests: [],
  };
  return applicationBuildResultV1Schema.parse({
    ...projection,
    reportDigest: digest(projection),
  });
}

function multiBuildPortFixture() {
  const fixture = multiWorkloadEventWorkflowFixture();
  const generation = generateApplication(fixture.generationRequest);
  const requests = fixture.applicationBuildRequests;
  if (requests?.length !== 2) {
    throw new TypeError("Adapter fixture requires exactly two build requests.");
  }
  const source = solutionExportApplicationBuildBatchInputV1Schema.parse({
    contractVersion: 1,
    kind: "cloudmarkup.application-build-batch-input",
    requests,
  });
  const approvedSettings =
    fixture.request.targetSettings.stageDescriptors.applicationBuild;
  return {
    approvedSettings,
    expectedResults: requests.map((request) =>
      passingBuildResult(fixture, generation, request),
    ),
    fixture,
    generation,
    input: {
      generation,
      request: fixture.request,
      settings: approvedSettings,
      signal: new AbortController().signal,
      sources: {
        applicationBuildInputs: source,
        architectureDocument: fixture.generationRequest.architectureDocument,
        solutionRevision: fixture.generationRequest.solutionRevision,
        workloadBehavior: fixture.generationRequest.workloadBehavior,
      },
    },
    requests,
    source,
  };
}

function withBuildInputCandidate(
  fixture: ReturnType<typeof multiBuildPortFixture>,
  candidate: unknown,
) {
  const reference = durableJsonReference(
    "object.application-build-inputs.adapter-multi-candidate",
    candidate,
  );
  const request = solutionExportWorkflowRequestV1Schema.parse({
    ...fixture.input.request,
    sources: {
      ...fixture.input.request.sources,
      applicationBuildInputs: reference,
    },
  });
  return {
    ...fixture.input,
    request,
    sources: {
      ...fixture.input.sources,
      applicationBuildInputs: candidate,
    },
  };
}

function withResultProjection(
  result: ApplicationBuildResultV1,
  update: (
    projection: Omit<ApplicationBuildResultV1, "reportDigest">,
  ) => Omit<ApplicationBuildResultV1, "reportDigest">,
): ApplicationBuildResultV1 {
  const { reportDigest, ...projection } = result;
  void reportDigest;
  const updated = update(projection);
  return applicationBuildResultV1Schema.parse({
    ...updated,
    reportDigest: digest(updated),
  });
}

function expectedBuildResult(
  fixture: ReturnType<typeof multiBuildPortFixture>,
  index: number,
): ApplicationBuildResultV1 {
  const result = fixture.expectedResults[index];
  if (result === undefined) {
    throw new TypeError(
      `Build result fixture is missing index ${String(index)}.`,
    );
  }
  return result;
}

function withForgedArtifactManifest(
  result: ApplicationBuildResultV1,
): ApplicationBuildResultV1 {
  return withResultProjection(result, (projection) => {
    const manifestArtifact = projection.artifacts.find(
      ({ mediaType }) => mediaType === "application/json",
    );
    if (manifestArtifact === undefined) {
      throw new TypeError(
        "Forged result fixture requires an artifact manifest.",
      );
    }
    const manifest = JSON.parse(
      Buffer.from(manifestArtifact.bytesBase64, "base64").toString("utf8"),
    ) as {
      readonly artifact: { readonly artifactId: string };
    };
    const forgedBytes = new TextEncoder().encode(
      serializeCanonicalJson({
        ...manifest,
        artifact: {
          ...manifest.artifact,
          artifactId: "artifact_forged_lambda_zip",
        },
      }),
    );
    const forgedChecksum = sha256Digest(forgedBytes);
    const artifacts = projection.artifacts.map((artifact) =>
      artifact.path === manifestArtifact.path
        ? {
            ...artifact,
            bytesBase64: Buffer.from(forgedBytes).toString("base64"),
            checksum: forgedChecksum,
            sizeBytes: forgedBytes.byteLength,
          }
        : artifact,
    );
    const replaceDigest = (
      value: ApplicationBuildResultV1["artifacts"][number]["checksum"],
    ): ApplicationBuildResultV1["artifacts"][number]["checksum"] =>
      value === manifestArtifact.checksum ? forgedChecksum : value;
    return {
      ...projection,
      artifacts,
      evidence: {
        ...projection.evidence,
        artifacts: projection.evidence.artifacts.map((artifact) => ({
          ...artifact,
          digest: replaceDigest(artifact.digest),
          sizeBytes:
            artifact.digest === manifestArtifact.checksum
              ? forgedBytes.byteLength
              : artifact.sizeBytes,
        })),
        checks: projection.evidence.checks.map((check) => ({
          ...check,
          artifactDigests: check.artifactDigests.map(replaceDigest),
        })),
      },
    };
  });
}

function userProvidedRequest(
  fixture: ReturnType<typeof multiBuildPortFixture>,
): ApplicationBuildRequestV1 {
  const generated = fixture.requests[1];
  const sourceFile = fixture.generation.artifact.sourceFiles[0];
  const runtime =
    fixture.generation.artifact.buildContracts[1]?.contract.runtime;
  if (
    generated === undefined ||
    sourceFile === undefined ||
    runtime === undefined
  ) {
    throw new TypeError(
      "User-provided negative fixture requires source input.",
    );
  }
  if (!("content" in sourceFile) || typeof sourceFile.content !== "string") {
    throw new TypeError(
      "User-provided negative fixture requires textual source input.",
    );
  }
  const content = sourceFile.content;
  const files = [
    applicationBuildSourceFileV1Schema.parse({
      checksum: sourceFile.checksum,
      content,
      mediaType: sourceFile.mediaType,
      ownership: "user-provided",
      path: sourceFile.path,
    }),
  ];
  return applicationBuildRequestV1Schema.parse({
    ...generated,
    source: {
      files,
      kind: "user-provided",
      runtime,
      sourceTreeDigest: applicationBuildSourceTreeDigest(files),
    },
  });
}

function failureCode(error: unknown): string | undefined {
  return error instanceof SolutionExportWorkflowFailureError
    ? error.failure.code
    : undefined;
}

async function rejectedValue(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected the promise to reject.");
}

describe("application build runner workflow adapter", () => {
  it("passes the exact content-addressed request and active signal to the runner", async () => {
    const fixture = buildPortFixture();
    let captured:
      | {
          input: unknown;
          signal: AbortSignal | undefined;
        }
      | undefined;
    const expectedResult = resultFor(
      fixture.buildRequest,
      fixture.approvedSettings.adapter,
    );
    const runner: ApplicationBuildRunner = {
      run(input, options) {
        captured = { input, signal: options?.signal };
        return Promise.resolve(expectedResult);
      },
    };
    const port = createSolutionExportApplicationBuildPort({
      approvedSettings: fixture.approvedSettings,
      runner,
    });

    await expect(port.build(fixture.input)).resolves.toEqual(expectedResult);
    expect(captured?.input).toEqual(fixture.buildRequest);
    expect(captured?.signal).toBe(fixture.input.signal);
    expect(
      applicationBuildRequestFromWorkflowInput(
        fixture.input,
        fixture.approvedSettings,
      ),
    ).toEqual(fixture.buildRequest);
  });

  it("fails before invoking the runner when approved settings do not match", async () => {
    const fixture = buildPortFixture();
    let calls = 0;
    const port = createSolutionExportApplicationBuildPort({
      approvedSettings: fixture.approvedSettings,
      runner: {
        run() {
          calls += 1;
          return Promise.resolve(
            resultFor(fixture.buildRequest, fixture.approvedSettings.adapter),
          );
        },
      },
    });

    const error = await rejectedValue(
      port.build({
        ...fixture.input,
        settings: {
          ...fixture.input.settings,
          limitsDigest: sha256Digest("forged-build-limits"),
        },
      }),
    );

    expect(failureCode(error)).toBe(
      "cloudmarkup.export.build-input-binding-invalid",
    );
    expect(calls).toBe(0);
  });

  it("propagates the same live AbortSignal through an active runner", async () => {
    const fixture = buildPortFixture();
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const runner: ApplicationBuildRunner = {
      run(_input, options) {
        observedSignal = options?.signal;
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("runner canceled");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      },
    };
    const port = createSolutionExportApplicationBuildPort({
      approvedSettings: fixture.approvedSettings,
      runner,
    });

    const pending = port.build({
      ...fixture.input,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(observedSignal).toBe(controller.signal);
    expect(observedSignal?.aborted).toBe(true);
  });

  it("runs the canonical two-workload batch exactly once per request and retains every artifact and Evidence record", async () => {
    const fixture = multiBuildPortFixture();
    const invocations: ApplicationBuildRequestV1[] = [];
    const runner: ApplicationBuildRunner = {
      run(input) {
        const request = applicationBuildRequestV1Schema.parse(input);
        invocations.push(request);
        const index = fixture.requests.findIndex(
          (candidate) =>
            applicationBuildRequestDigest(candidate) ===
            applicationBuildRequestDigest(request),
        );
        return Promise.resolve(expectedBuildResult(fixture, index));
      },
    };
    const port = createSolutionExportApplicationBuildPort({
      approvedSettings: fixture.approvedSettings,
      runner,
    });

    const result = solutionExportApplicationBuildBatchResultV1Schema.parse(
      await port.build(fixture.input),
    );

    expect(invocations).toEqual(fixture.requests);
    expect(result).toMatchObject({
      contractVersion: 1,
      kind: "cloudmarkup.application-build-batch-result",
      results: fixture.expectedResults,
    });
    expect(result.results.flatMap(({ artifacts }) => artifacts)).toHaveLength(
      6,
    );
    expect(result.results.map(({ evidence }) => evidence.id)).toEqual(
      fixture.expectedResults.map(({ evidence }) => evidence.id),
    );
    expect(
      applicationBuildRequestsFromWorkflowInput(
        fixture.input,
        fixture.approvedSettings,
      ),
    ).toEqual(fixture.requests);
  });

  it("fails atomically when a later build runner invocation rejects", async () => {
    const fixture = multiBuildPortFixture();
    const invocations: ApplicationBuildRequestV1[] = [];
    const port = createSolutionExportApplicationBuildPort({
      approvedSettings: fixture.approvedSettings,
      runner: {
        run(input) {
          const request = applicationBuildRequestV1Schema.parse(input);
          invocations.push(request);
          if (invocations.length === 2) {
            return Promise.reject(new Error("bounded runner failure"));
          }
          return Promise.resolve(expectedBuildResult(fixture, 0));
        },
      },
    });

    await expect(port.build(fixture.input)).rejects.toThrow(
      "bounded runner failure",
    );
    expect(invocations).toEqual(fixture.requests);
  });

  it.each([
    {
      expectedCode: "cloudmarkup.export.build-input-coverage-invalid",
      name: "missing build request",
      value(fixture: ReturnType<typeof multiBuildPortFixture>) {
        return {
          ...fixture.source,
          requests: fixture.source.requests.slice(0, 1),
        };
      },
    },
    {
      expectedCode: "cloudmarkup.export.build-input-invalid",
      name: "reordered build requests",
      value(fixture: ReturnType<typeof multiBuildPortFixture>) {
        return {
          ...fixture.source,
          requests: [...fixture.source.requests].reverse(),
        };
      },
    },
    {
      expectedCode: "cloudmarkup.export.build-input-invalid",
      name: "duplicate build request identity",
      value(fixture: ReturnType<typeof multiBuildPortFixture>) {
        const first = fixture.source.requests[0];
        return {
          ...fixture.source,
          requests: first === undefined ? [] : [first, first],
        };
      },
    },
    {
      expectedCode: "cloudmarkup.export.build-input-invalid",
      name: "user-provided source in a generated batch",
      value(fixture: ReturnType<typeof multiBuildPortFixture>) {
        return {
          ...fixture.source,
          requests: [fixture.source.requests[0], userProvidedRequest(fixture)],
        };
      },
    },
  ])("rejects $name before invoking any runner", async (testCase) => {
    const fixture = multiBuildPortFixture();
    let calls = 0;
    const port = createSolutionExportApplicationBuildPort({
      approvedSettings: fixture.approvedSettings,
      runner: {
        run() {
          calls += 1;
          return Promise.resolve(expectedBuildResult(fixture, 0));
        },
      },
    });

    const error = await rejectedValue(
      port.build(withBuildInputCandidate(fixture, testCase.value(fixture))),
    );

    expect(failureCode(error)).toBe(testCase.expectedCode);
    expect(calls).toBe(0);
  });

  it.each(["evidence", "artifact-path"] as const)(
    "rejects cross-result %s collisions without publishing a batch result",
    async (collision) => {
      const fixture = multiBuildPortFixture();
      const first = fixture.expectedResults[0];
      const second = fixture.expectedResults[1];
      if (first === undefined || second === undefined) {
        throw new TypeError("Collision fixture requires two results.");
      }
      const colliding = withResultProjection(second, (projection) =>
        collision === "evidence"
          ? {
              ...projection,
              coverage: {
                ...projection.coverage,
                evidenceId: first.evidence.id,
              },
              evidence: { ...projection.evidence, id: first.evidence.id },
            }
          : {
              ...projection,
              artifacts: projection.artifacts.map((artifact) => ({
                ...artifact,
                path: artifact.path.endsWith("/sbom.cdx.json")
                  ? (first.artifacts.find(({ path }) =>
                      path.endsWith("/sbom.cdx.json"),
                    )?.path ?? artifact.path)
                  : artifact.path,
              })),
            },
      );
      let calls = 0;
      const port = createSolutionExportApplicationBuildPort({
        approvedSettings: fixture.approvedSettings,
        runner: {
          run() {
            const result = calls === 0 ? first : colliding;
            calls += 1;
            return Promise.resolve(result);
          },
        },
      });

      const error = await rejectedValue(port.build(fixture.input));

      expect(failureCode(error)).toBe(
        "cloudmarkup.export.build-result-invalid",
      );
      expect(calls).toBe(2);
    },
  );

  it("rejects a result returned for the wrong workload before the next runner invocation", async () => {
    const fixture = multiBuildPortFixture();
    let calls = 0;
    const port = createSolutionExportApplicationBuildPort({
      approvedSettings: fixture.approvedSettings,
      runner: {
        run() {
          calls += 1;
          return Promise.resolve(expectedBuildResult(fixture, 1));
        },
      },
    });

    const error = await rejectedValue(port.build(fixture.input));

    expect(failureCode(error)).toBe(
      "cloudmarkup.export.build-result-binding-invalid",
    );
    expect(calls).toBe(1);
  });

  it("rejects an internally consistent artifact manifest forged away from the selected envelope", async () => {
    const fixture = multiBuildPortFixture();
    const first = fixture.expectedResults[0];
    if (first === undefined) {
      throw new TypeError("Forged result fixture requires one result.");
    }
    const forged = withForgedArtifactManifest(first);
    let calls = 0;
    const port = createSolutionExportApplicationBuildPort({
      approvedSettings: fixture.approvedSettings,
      runner: {
        run() {
          calls += 1;
          return Promise.resolve(forged);
        },
      },
    });

    const error = await rejectedValue(port.build(fixture.input));

    expect(failureCode(error)).toBe(
      "cloudmarkup.export.build-result-binding-invalid",
    );
    expect(calls).toBe(1);
  });
});
