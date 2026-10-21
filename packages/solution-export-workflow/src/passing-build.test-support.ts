import {
  applicationBuildRequestDigest,
  applicationBuildResultV1Schema,
  type ApplicationBuildRequestV1,
  type ApplicationBuildResultV1,
} from "@cloudmarkup/application-build-runner";
import {
  evidenceRecordV1Schema,
  serializeCanonicalJson,
  type ApplicationGenerationResultV1,
} from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";

import {
  canonicalBytes,
  type WorkflowFixture,
} from "./workflow.test-support.js";

const AT = "2026-08-18T12:00:00.000Z";

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function passingBuildResult(
  fixture: WorkflowFixture,
  generation: ApplicationGenerationResultV1,
  request?: ApplicationBuildRequestV1,
): ApplicationBuildResultV1 {
  const buildRequest = request ?? fixture.applicationBuildRequest;
  const generatedSource =
    buildRequest?.source.kind === "generated" ? buildRequest.source : undefined;
  const envelope =
    generatedSource === undefined
      ? undefined
      : generation.artifact.buildContracts.find(
          ({ contractDigest }) =>
            contractDigest === generatedSource.buildContractDigest,
        );
  if (
    envelope === undefined ||
    buildRequest?.source.kind !== "generated" ||
    buildRequest.source.applicationGeneration.artifactDigest !==
      generation.artifactDigest
  ) {
    throw new TypeError(
      "Passing build fixture requires exact generated inputs.",
    );
  }
  const workloadCoverage = generation.artifact.coverage.workloads.find(
    ({ workloadId }) => workloadId === envelope.contract.workloadId,
  );
  if (workloadCoverage === undefined) {
    throw new TypeError("Passing build fixture requires workload coverage.");
  }
  const inputState =
    workloadCoverage.state === "complete-supported-pattern" ||
    (workloadCoverage.state === "starter-application" &&
      envelope.contract.implementationMode === "complete-supported-pattern")
      ? "complete-supported-pattern"
      : workloadCoverage.state;
  const buildRequestDigest = applicationBuildRequestDigest(buildRequest);
  const generationArtifactDigest = generation.artifactDigest;
  const solutionRevisionDigest = buildRequest.solutionRevisionDigest;
  const dependencyLockDigest = sha256Digest(
    serializeCanonicalJson(buildRequest.dependencyLock),
  );
  const sourceChecksums = generation.artifact.sourceFiles
    .map(({ checksum }) => checksum)
    .sort();
  const zipBytes = new TextEncoder().encode(
    `PK\u0003\u0004reviewed-lambda-zip:${envelope.contract.workloadId}`,
  );
  const artifactManifestBytes = canonicalBytes({
    artifact: {
      artifactId: envelope.contract.expectedArtifact.artifactId,
      archiveEntrypoint: envelope.contract.expectedArtifact.archiveEntrypoint,
      checksum: sha256Digest(zipBytes),
      digestAlgorithm: envelope.contract.expectedArtifact.digestAlgorithm,
      handler: envelope.contract.expectedArtifact.handler,
      kind: envelope.contract.expectedArtifact.kind,
      mediaType: envelope.contract.expectedArtifact.mediaType,
      path: envelope.contract.expectedArtifact.path,
    },
    bindings: {
      buildContractDigest: envelope.contractDigest,
      buildRequestDigest,
      generationArtifactDigest,
      solutionRevisionDigest,
      solutionRevisionId: buildRequest.solutionRevision.solutionRevisionId,
      workloadId: envelope.contract.workloadId,
    },
    compiledEntrypoint: envelope.contract.compiledEntrypoint,
    contractVersion: 1,
    entrypoint: envelope.contract.entrypoint,
    kind: "cloudmarkup.lambda-artifact-manifest",
    runtime: envelope.contract.runtime,
  });
  const artifactInputs = [
    {
      bytes: canonicalBytes({
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        version: 1,
      }),
      mediaType: "application/vnd.cyclonedx+json" as const,
      path: envelope.contract.expectedArtifact.path.replace(
        /application\/artifacts\/([^/]+)\/function\.zip$/u,
        "application/evidence/$1/sbom.cdx.json",
      ),
    },
    {
      bytes: artifactManifestBytes,
      mediaType: "application/json" as const,
      path: envelope.contract.expectedArtifact.path.replace(
        /function\.zip$/u,
        "artifact-manifest.json",
      ),
    },
    {
      bytes: zipBytes,
      mediaType: "application/zip" as const,
      path: envelope.contract.expectedArtifact.path,
    },
  ];
  const artifacts = artifactInputs.map(({ bytes, mediaType, path }) => ({
    bytesBase64: base64(bytes),
    checksum: sha256Digest(bytes),
    mediaType,
    ownership: "generated-build-artifact" as const,
    path,
    provenance: {
      buildRequestDigest,
      buildContractDigest: envelope.contractDigest,
      dependencyLockDigest,
      generationArtifactDigest,
      solutionRevisionDigest,
      sourceChecksums,
      workloadId: envelope.contract.workloadId,
    },
    sizeBytes: bytes.byteLength,
  }));
  const buildEvidence = evidenceRecordV1Schema.parse({
    artifacts: artifacts.map(({ checksum, mediaType, sizeBytes }) => ({
      digest: checksum,
      mediaType,
      sizeBytes,
    })),
    checks: [
      {
        artifactDigests: artifacts.map(({ checksum }) => checksum),
        checkId: "cloudmarkup.evidence.application-build-and-tests",
        generationCoverageRequirement: "application-build-and-tests",
        issueIds: [],
        status: "passed",
        summary:
          "The isolated build and reviewed unit and contract tests passed.",
      },
      {
        artifactDigests: artifacts.map(({ checksum }) => checksum),
        checkId: "cloudmarkup.evidence.application-security-checks",
        generationCoverageRequirement: "application-security-checks",
        issueIds: [],
        status: "passed",
        summary:
          "The reviewed dependency and secret scans established a clean artifact.",
      },
    ],
    contractVersion: 1,
    environment: buildRequest.environment,
    id: `evidence_build_${sha256Digest(envelope.contract.workloadId).slice(7, 31)}`,
    layer: "generated",
    level: { kind: "application-build-and-tests", rank: 5 },
    models: [],
    provenance: {
      actor: {
        kind: "deterministic-tool",
        tool: fixture.request.targetSettings.stageDescriptors.applicationBuild
          .adapter,
      },
      createdAt: AT,
      inputDigests: [
        buildRequestDigest,
        generationArtifactDigest,
        solutionRevisionDigest,
        envelope.contractDigest,
        dependencyLockDigest,
      ].sort(),
    },
    solutionRevisionId: buildRequest.solutionRevision.solutionRevisionId,
    staleness: { assessedAt: AT, state: "current" },
    tools: [
      fixture.request.targetSettings.stageDescriptors.applicationBuild.adapter,
    ],
  });
  const steps = [
    ["install", "pnpm"],
    ["lint", "eslint"],
    ["typecheck", "tsc"],
    ["unit-tests", "vitest"],
    ["contract-tests", "vitest"],
    ["dependency-scan", "trivy"],
    ["secret-scan", "trivy"],
    ["compile", "tsc"],
    ["production-prune", "pnpm"],
  ] as const;
  const projection = {
    artifacts,
    contractVersion: 1 as const,
    coverage: {
      buildRequestDigest,
      confirmedState: inputState,
      evidenceId: buildEvidence.id,
      generationArtifactDigest,
      inputState,
      solutionRevisionDigest,
      solutionRevisionId: buildRequest.solutionRevision.solutionRevisionId,
      workloadId: envelope.contract.workloadId,
    },
    diagnostics: [],
    evidence: buildEvidence,
    findings: [],
    state: "passed" as const,
    steps: steps.map(([step, executable]) => ({
      executable,
      outputBytes: 0,
      state: "passed" as const,
      step,
    })),
    tests: [
      {
        failed: 0,
        kind: "unit" as const,
        passed: 4,
        skipped: 0,
        state: "passed" as const,
      },
      {
        failed: 0,
        kind: "contract" as const,
        passed: 4,
        skipped: 0,
        state: "passed" as const,
      },
    ],
  };
  return applicationBuildResultV1Schema.parse({
    ...projection,
    reportDigest: sha256Digest(serializeCanonicalJson(projection)),
  });
}
