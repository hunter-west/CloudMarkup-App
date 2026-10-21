import { applicationBuildResultV1Schema } from "@cloudmarkup/application-build-runner";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { applicationBuildSupplementalFiles } from "./application-build-adapter.js";
import { solutionExportExternalStageStatusV1Schema } from "./contracts.js";
import { sha256Digest } from "./security.js";

const assessedAt = "2026-08-18T12:00:00.000Z";

function result() {
  const zip = Buffer.from("deterministic-lambda-zip").toString("base64");
  const sbom = Buffer.from('{"bomFormat":"CycloneDX"}\n').toString("base64");
  const zipBytes = Buffer.from(zip, "base64");
  const sbomBytes = Buffer.from(sbom, "base64");
  const zipDigest = sha256Digest(zipBytes);
  const sbomDigest = sha256Digest(sbomBytes);
  const builder = {
    digest: sha256Digest("builder@1.0.0"),
    id: "cloudmarkup.application-builder",
    version: "1.0.0",
  };
  const buildRequestDigest = sha256Digest("application-build-request");
  const generationArtifactDigest = sha256Digest("application-generation");
  const solutionRevisionDigest = sha256Digest("solution-revision");
  const provenance = {
    buildRequestDigest,
    buildContractDigest: sha256Digest("build-contract"),
    dependencyLockDigest: sha256Digest("dependency-lock"),
    generationArtifactDigest,
    solutionRevisionDigest,
    sourceChecksums: [sha256Digest("source")],
    workloadId: "workload_notes_api",
  };
  const manifestText = serializeCanonicalJson({
    artifact: {
      artifactId: "artifact.lambda.workload_notes_api",
      archiveEntrypoint: "index.js",
      checksum: zipDigest,
      digestAlgorithm: "sha256",
      handler: "index.handler",
      kind: "aws-lambda-zip",
      mediaType: "application/zip",
      path: "application/artifacts/workload_notes_api/function.zip",
    },
    bindings: {
      buildContractDigest: provenance.buildContractDigest,
      buildRequestDigest,
      generationArtifactDigest,
      solutionRevisionDigest,
      solutionRevisionId: "solution_notes_revision_1",
      workloadId: "workload_notes_api",
    },
    compiledEntrypoint: "application/dist/functions/notes_handler/index.js",
    contractVersion: 1,
    entrypoint: "application/src/functions/notes_handler/index.ts",
    kind: "cloudmarkup.lambda-artifact-manifest",
    runtime: {
      digest: sha256Digest("nodejs24-typescript-runtime"),
      handler: "index.handler",
      id: "cloudmarkup.runtime.aws-lambda-nodejs-typescript",
      languageFamily: "cloudmarkup.language.typescript",
      moduleFormat: "esm",
      runtime: "nodejs24.x",
      runtimeFamily: "cloudmarkup.runtime-family.aws-lambda",
      version: "1.0.0",
    },
  });
  const manifest = Buffer.from(manifestText).toString("base64");
  const manifestBytes = Buffer.from(manifest, "base64");
  const manifestDigest = sha256Digest(manifestBytes);
  const projection = {
    artifacts: [
      {
        bytesBase64: zip,
        checksum: zipDigest,
        mediaType: "application/zip",
        ownership: "generated-build-artifact",
        path: "application/artifacts/workload_notes_api/function.zip",
        provenance,
        sizeBytes: zipBytes.byteLength,
      },
      {
        bytesBase64: manifest,
        checksum: manifestDigest,
        mediaType: "application/json",
        ownership: "generated-build-artifact",
        path: "application/artifacts/workload_notes_api/artifact-manifest.json",
        provenance,
        sizeBytes: manifestBytes.byteLength,
      },
      {
        bytesBase64: sbom,
        checksum: sbomDigest,
        mediaType: "application/vnd.cyclonedx+json",
        ownership: "generated-build-artifact",
        path: "application/evidence/workload_notes_api/sbom.cdx.json",
        provenance,
        sizeBytes: sbomBytes.byteLength,
      },
    ],
    contractVersion: 1,
    coverage: {
      buildRequestDigest,
      confirmedState: "complete-supported-pattern",
      evidenceId: "evidence_application_build_fixture",
      generationArtifactDigest,
      inputState: "complete-supported-pattern",
      solutionRevisionDigest,
      solutionRevisionId: "solution_notes_revision_1",
      workloadId: "workload_notes_api",
    },
    diagnostics: [],
    evidence: {
      artifacts: [
        {
          digest: zipDigest,
          mediaType: "application/zip",
          sizeBytes: zipBytes.byteLength,
        },
        {
          digest: manifestDigest,
          mediaType: "application/json",
          sizeBytes: manifestBytes.byteLength,
        },
        {
          digest: sbomDigest,
          mediaType: "application/vnd.cyclonedx+json",
          sizeBytes: sbomBytes.byteLength,
        },
      ],
      checks: [
        {
          artifactDigests: [zipDigest, manifestDigest, sbomDigest],
          checkId: "cloudmarkup.evidence.application-build-and-tests",
          generationCoverageRequirement: "application-build-and-tests",
          issueIds: [],
          status: "passed",
          summary: "Application build and generated tests passed.",
        },
        {
          artifactDigests: [zipDigest, manifestDigest, sbomDigest],
          checkId: "cloudmarkup.evidence.application-security-checks",
          generationCoverageRequirement: "application-security-checks",
          issueIds: [],
          status: "passed",
          summary: "Application dependency and secret checks passed.",
        },
      ],
      contractVersion: 1,
      environment: { environmentType: "unknown" },
      id: "evidence_application_build_fixture",
      layer: "generated",
      level: { kind: "application-build-and-tests", rank: 5 },
      models: [],
      provenance: {
        actor: { kind: "deterministic-tool", tool: builder },
        createdAt: assessedAt,
        inputDigests: [
          buildRequestDigest,
          generationArtifactDigest,
          solutionRevisionDigest,
        ].sort(),
      },
      solutionRevisionId: "solution_notes_revision_1",
      staleness: { assessedAt, state: "current" },
      tools: [builder],
    },
    findings: [],
    state: "passed",
    steps: [
      ["install", "pnpm"],
      ["lint", "eslint"],
      ["typecheck", "tsc"],
      ["unit-tests", "vitest"],
      ["contract-tests", "vitest"],
      ["dependency-scan", "trivy"],
      ["secret-scan", "trivy"],
      ["compile", "tsc"],
      ["production-prune", "pnpm"],
    ].map(([step, executable]) => ({
      executable,
      outputBytes: 0,
      state: "passed",
      step,
    })),
    tests: [
      {
        failed: 0,
        kind: "unit",
        passed: 4,
        skipped: 0,
        state: "passed",
      },
      {
        failed: 0,
        kind: "contract",
        passed: 4,
        skipped: 0,
        state: "passed",
      },
    ],
  } as const;
  return applicationBuildResultV1Schema.parse({
    ...projection,
    reportDigest: sha256Digest(serializeCanonicalJson(projection)),
  });
}

describe("Prompt 32A to Prompt 31 export adapter", () => {
  it("preserves build/evidence ownership, bytes, provenance, and checksums", () => {
    const files = applicationBuildSupplementalFiles(result());
    expect(files.map(({ ownership, path }) => ({ ownership, path }))).toEqual([
      {
        ownership: "generated-build-artifact",
        path: "application/artifacts/workload_notes_api/function.zip",
      },
      {
        ownership: "generated-build-artifact",
        path: "application/artifacts/workload_notes_api/artifact-manifest.json",
      },
      {
        ownership: "generated-build-artifact",
        path: "application/evidence/workload_notes_api/sbom.cdx.json",
      },
      {
        ownership: "evidence-artifact",
        path: "application/evidence/workload_notes_api/application-build-evidence.json",
      },
    ]);
    expect(
      files.every(
        ({ provenance }) =>
          provenance.solutionRevisionId === "solution_notes_revision_1" &&
          provenance.sourceReferences.some(({ kind }) => kind === "workload") &&
          provenance.sourceReferences.some(({ kind }) => kind === "evidence"),
      ),
    ).toBe(true);
  });

  it("rejects a corrupted or non-passing build result", () => {
    const valid = result();
    expect(() =>
      applicationBuildSupplementalFiles({
        ...valid,
        reportDigest: sha256Digest("tampered"),
      }),
    ).toThrow(/report digest/u);
    const { reportDigest: _reportDigest, ...validProjection } = valid;
    void _reportDigest;
    const failedProjection = {
      ...validProjection,
      artifacts: [],
      coverage: {
        buildRequestDigest: valid.coverage.buildRequestDigest,
        confirmedState: "custom-implementation-required" as const,
        downgradeReason: "The reviewed build fixture did not pass.",
        generationArtifactDigest: valid.coverage.generationArtifactDigest,
        inputState: valid.coverage.inputState,
        solutionRevisionDigest: valid.coverage.solutionRevisionDigest,
        solutionRevisionId: valid.coverage.solutionRevisionId,
        workloadId: valid.coverage.workloadId,
      },
      evidence: {
        ...valid.evidence,
        artifacts: [],
        checks: valid.evidence.checks.map((check) => ({
          ...check,
          artifactDigests: [],
          redactedFailure: "The reviewed build fixture did not pass.",
          status: "failed" as const,
        })),
      },
      state: "failed" as const,
    };
    expect(() =>
      applicationBuildSupplementalFiles({
        ...failedProjection,
        reportDigest: sha256Digest(serializeCanonicalJson(failedProjection)),
      }),
    ).toThrow(/passing application build/u);
  });

  it("accepts a bounded application build Evidence batch while retaining the Terraform validation cap", () => {
    const evidenceRecords = Array.from({ length: 32 }, (_, index) => ({
      evidenceId: `evidence_application_build_${String(index).padStart(2, "0")}`,
      recordDigest: sha256Digest(`application-build-evidence-${String(index)}`),
    }));
    const base = {
      applicationBuild: {
        evidenceRecords,
        reportDigest: sha256Digest("application-build-batch-report"),
        state: "passed-before-export" as const,
      },
      environment: { environmentType: "development" as const },
      targetSettingsDigest: sha256Digest("target-settings"),
      terraformValidation: {
        evidenceRecords: [
          {
            evidenceId: "evidence_terraform_validation_00",
            recordDigest: sha256Digest("terraform-validation-evidence"),
          },
        ],
        reportDigest: sha256Digest("terraform-validation-report"),
        state: "passed-before-export" as const,
      },
      workflowRequestDigest: sha256Digest("workflow-request"),
    };

    expect(
      solutionExportExternalStageStatusV1Schema.safeParse(base).success,
    ).toBe(true);
    expect(
      solutionExportExternalStageStatusV1Schema.safeParse({
        ...base,
        applicationBuild: {
          ...base.applicationBuild,
          evidenceRecords: [
            ...evidenceRecords,
            {
              evidenceId: "evidence_application_build_32",
              recordDigest: sha256Digest("application-build-evidence-32"),
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      solutionExportExternalStageStatusV1Schema.safeParse({
        ...base,
        terraformValidation: {
          ...base.terraformValidation,
          evidenceRecords: evidenceRecords.slice(0, 3),
        },
      }).success,
    ).toBe(false);
  });
});
