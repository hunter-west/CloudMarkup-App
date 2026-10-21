import {
  aiExtensionIdSchema,
  applicationGenerationResultV1Schema,
  applicationRepositoryPathV1Schema,
  applicationRuntimePinV1Schema,
  asyncJobEnvironmentV1Schema,
  evidenceRecordV1Schema,
  namespacedIdentifierSchema,
  prompt32ABuildArtifactEnvelopeV1Schema,
  semanticVersionSchema,
  sha256DigestSchema,
  solutionRevisionManifestV1Schema,
  utcTimestampSchema,
  type ApplicationGenerationResultV1,
  type EvidenceRecordV1,
  type Prompt32ABuildArtifactEnvelopeV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import { canonicalJson, compareUtf16, sha256Digest } from "./security.js";

export const APPLICATION_BUILD_V1_MAXIMA = Object.freeze({
  artifactBytes: 64 * 1024 * 1024,
  fileBytes: 4 * 1024 * 1024,
  files: 20_000,
  lockfileBytes: 4 * 1024 * 1024,
  outputBytes: 2 * 1024 * 1024,
  pathBytes: 512,
  totalFileBytes: 128 * 1024 * 1024,
} as const);

const safeTextSchema = z.string().trim().min(1).max(2_000);
const safeSummarySchema = z.string().trim().min(1).max(500);
const sha512IntegritySchema = z
  .string()
  .regex(/^sha512-[A-Za-z0-9+/]{32,}={0,2}$/u);

export const applicationBuildToolPinV1Schema = z
  .object({
    digest: sha256DigestSchema,
    id: namespacedIdentifierSchema,
    version: semanticVersionSchema,
  })
  .strict();

export const applicationDependencyLockPackageV1Schema = z
  .object({
    integrity: sha512IntegritySchema,
    kind: z.enum([
      "runtime",
      "development",
      "transitive-runtime",
      "transitive-development",
    ]),
    name: z.string().regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u),
    tarballDigest: sha256DigestSchema,
    version: semanticVersionSchema,
  })
  .strict();

export const applicationDependencyLockV1Schema = z
  .object({
    cache: z
      .object({
        digest: sha256DigestSchema,
        kind: z.literal("prepackaged-content-addressed"),
        network: z.literal("deny"),
      })
      .strict(),
    contractVersion: z.literal(1),
    lifecycleScripts: z.literal("deny"),
    lockfileChecksum: sha256DigestSchema,
    lockfileContent: z
      .string()
      .min(1)
      .max(APPLICATION_BUILD_V1_MAXIMA.lockfileBytes),
    lockfilePath: z.literal("application/pnpm-lock.yaml"),
    packageManager: applicationBuildToolPinV1Schema,
    packageManifestChecksum: sha256DigestSchema,
    packages: z
      .array(applicationDependencyLockPackageV1Schema)
      .min(1)
      .max(2_048),
  })
  .strict()
  .superRefine((value, context) => {
    const identities = new Set<string>();
    value.packages.forEach((entry, index) => {
      const identity = `${entry.name}\u0000${entry.version}`;
      if (identities.has(identity)) {
        context.addIssue({
          code: "custom",
          message: "Dependency lock package identities must be unique.",
          path: ["packages", index],
        });
      }
      identities.add(identity);
      const previous = value.packages[index - 1];
      if (
        previous !== undefined &&
        `${previous.name}\u0000${previous.version}` >= identity
      ) {
        context.addIssue({
          code: "custom",
          message: "Dependency lock packages must be uniquely UTF-16 sorted.",
          path: ["packages", index],
        });
      }
    });
  });

export const applicationBuildLimitsV1Schema = z
  .object({
    cpuSeconds: z.number().int().positive().max(600),
    maxArtifactBytes: z
      .number()
      .int()
      .positive()
      .max(APPLICATION_BUILD_V1_MAXIMA.artifactBytes),
    maxFileBytes: z
      .number()
      .int()
      .positive()
      .max(APPLICATION_BUILD_V1_MAXIMA.fileBytes),
    maxFiles: z
      .number()
      .int()
      .positive()
      .max(APPLICATION_BUILD_V1_MAXIMA.files),
    maxOutputBytes: z
      .number()
      .int()
      .positive()
      .max(APPLICATION_BUILD_V1_MAXIMA.outputBytes),
    maxProcesses: z.number().int().positive().max(128),
    maxTotalFileBytes: z
      .number()
      .int()
      .positive()
      .max(APPLICATION_BUILD_V1_MAXIMA.totalFileBytes),
    memoryMiB: z.number().int().min(128).max(8_192),
    wallTimeMilliseconds: z.number().int().min(1_000).max(900_000),
  })
  .strict();

export const applicationBuildProfileV1Schema = z
  .object({
    digest: sha256DigestSchema,
    id: z.enum([
      "cloudmarkup.application-build.ai-assisted-custom-nodejs24",
      "cloudmarkup.application-build.generated-nodejs24",
      "cloudmarkup.application-build.user-source-static-nodejs24",
    ]),
    sourcePolicy: z.enum([
      "ai-assisted-custom-only",
      "generated-only",
      "user-provided-static-only",
    ]),
    version: z.literal("1.0.0"),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedPolicy = {
      "cloudmarkup.application-build.ai-assisted-custom-nodejs24":
        "ai-assisted-custom-only",
      "cloudmarkup.application-build.generated-nodejs24": "generated-only",
      "cloudmarkup.application-build.user-source-static-nodejs24":
        "user-provided-static-only",
    }[value.id];
    if (value.sourcePolicy !== expectedPolicy) {
      context.addIssue({
        code: "custom",
        message: "Build profile identity and source policy must match.",
        path: ["sourcePolicy"],
      });
    }
  });

export const applicationBuildPolicyV1Schema = z
  .object({
    builder: applicationBuildToolPinV1Schema,
    container: z
      .object({
        digest: sha256DigestSchema,
        image: z.string().regex(/^[a-z0-9][a-z0-9./_-]{1,255}$/u),
        platform: z.literal("linux/amd64"),
        pnpmStorePath: z.literal("/opt/cloudmarkup/pnpm-store"),
      })
      .strict(),
    contractVersion: z.literal(1),
    defaultLimits: applicationBuildLimitsV1Schema,
    dependencyCacheDigest: sha256DigestSchema,
    dependencyDenylist: z
      .array(z.string().regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u))
      .max(256),
    dependencyAllowlist: z
      .array(
        z
          .object({
            kind: z.enum(["runtime", "development"]),
            name: z.string().regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u),
            version: semanticVersionSchema,
          })
          .strict(),
      )
      .min(1)
      .max(64),
    profile: applicationBuildProfileV1Schema,
    scanner: applicationBuildToolPinV1Schema,
    secretScanner: applicationBuildToolPinV1Schema,
    toolchain: z.array(applicationBuildToolPinV1Schema).min(5).max(16),
  })
  .strict();

export const applicationBuildSourceFileV1Schema = z
  .object({
    checksum: sha256DigestSchema,
    content: z.string().max(APPLICATION_BUILD_V1_MAXIMA.fileBytes),
    mediaType: z.enum([
      "application/json",
      "text/markdown",
      "text/plain",
      "text/typescript",
    ]),
    ownership: z.enum([
      "ai-authored",
      "generated",
      "user-owned",
      "user-provided",
      "user-owned-extension",
    ]),
    path: applicationRepositoryPathV1Schema,
  })
  .strict();

export const applicationBuildSourceV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      applicationGeneration: applicationGenerationResultV1Schema,
      buildContractDigest: sha256DigestSchema,
      kind: z.literal("generated"),
    })
    .strict(),
  z
    .object({
      files: z
        .array(applicationBuildSourceFileV1Schema)
        .min(1)
        .max(APPLICATION_BUILD_V1_MAXIMA.files),
      kind: z.literal("user-provided"),
      runtime: applicationRuntimePinV1Schema,
      sourceTreeDigest: sha256DigestSchema,
    })
    .strict(),
  z
    .object({
      aiOwnedPaths: z
        .array(applicationRepositoryPathV1Schema)
        .min(1)
        .max(APPLICATION_BUILD_V1_MAXIMA.files),
      buildEnvelope: prompt32ABuildArtifactEnvelopeV1Schema,
      candidateBundleDigest: sha256DigestSchema,
      deterministicScaffold: applicationGenerationResultV1Schema,
      extensionId: aiExtensionIdSchema,
      files: z
        .array(applicationBuildSourceFileV1Schema)
        .min(1)
        .max(APPLICATION_BUILD_V1_MAXIMA.files),
      kind: z.literal("ai-assisted-custom"),
      sourceTreeDigest: sha256DigestSchema,
      unresolvedBehaviorIds: z
        .array(namespacedIdentifierSchema)
        .max(APPLICATION_BUILD_V1_MAXIMA.files),
    })
    .strict(),
]);

function sourceFileDigestProjection(
  files: readonly z.output<typeof applicationBuildSourceFileV1Schema>[],
) {
  return files
    .map(({ checksum, mediaType, ownership, path }) => ({
      checksum,
      mediaType,
      ownership,
      path,
    }))
    .sort((left, right) => compareUtf16(left.path, right.path));
}

export function applicationBuildSourceTreeDigest(
  files: readonly z.output<typeof applicationBuildSourceFileV1Schema>[],
): Sha256Digest {
  return sha256Digest(
    canonicalJson(
      sourceFileDigestProjection(
        files.map((file) => applicationBuildSourceFileV1Schema.parse(file)),
      ),
    ),
  );
}

export function applicationAiCandidateBundleDigest(input: {
  readonly aiOwnedPaths: readonly string[];
  readonly extensionId: string;
  readonly files: readonly z.output<
    typeof applicationBuildSourceFileV1Schema
  >[];
}): Sha256Digest {
  const extensionId = aiExtensionIdSchema.parse(input.extensionId);
  const ownedPaths = input.aiOwnedPaths
    .map((path) => applicationRepositoryPathV1Schema.parse(path))
    .sort(compareUtf16);
  const files = input.files.map((file) =>
    applicationBuildSourceFileV1Schema.parse(file),
  );
  return sha256Digest(
    canonicalJson({
      contractVersion: 1,
      extensionId,
      files: sourceFileDigestProjection(
        files.filter((file) => file.ownership === "ai-authored"),
      ),
      ownedPaths,
    }),
  );
}

export const applicationBuildRequestV1Schema = z
  .object({
    assessedAt: utcTimestampSchema,
    ciIdentity: z.string().min(1).max(256).optional(),
    contractVersion: z.literal(1),
    environment: asyncJobEnvironmentV1Schema,
    dependencyLock: applicationDependencyLockV1Schema,
    limits: applicationBuildLimitsV1Schema,
    profile: applicationBuildProfileV1Schema,
    solutionRevision: solutionRevisionManifestV1Schema,
    solutionRevisionDigest: sha256DigestSchema,
    source: applicationBuildSourceV1Schema,
  })
  .strict();

export function applicationBuildRequestDigest(
  request: z.output<typeof applicationBuildRequestV1Schema>,
): Sha256Digest {
  return sha256Digest(canonicalJson(request));
}

export const applicationBuildReferenceV1Schema = z
  .object({
    contractIds: z.array(z.string().min(1).max(256)).max(256),
    operationIds: z.array(z.string().min(1).max(256)).max(256),
    path: applicationRepositoryPathV1Schema.optional(),
    solutionRevisionId: z.string().min(1).max(256),
    workloadId: z.string().min(1).max(256).optional(),
  })
  .strict();

export const applicationBuildDiagnosticV1Schema = z
  .object({
    code: namespacedIdentifierSchema,
    detail: safeTextSchema,
    references: applicationBuildReferenceV1Schema,
    severity: z.enum(["error", "warning", "info"]),
    source: z.enum([
      "admission",
      "install",
      "lint",
      "typecheck",
      "unit-tests",
      "contract-tests",
      "dependency-scan",
      "secret-scan",
      "compile",
      "production-prune",
      "package",
      "reproducibility",
      "runner",
    ]),
    summary: safeSummarySchema,
  })
  .strict();

export const applicationBuildStepSummaryV1Schema = z
  .object({
    executable: z.enum(["pnpm", "eslint", "tsc", "vitest", "trivy"]),
    outputBytes: z.number().int().nonnegative(),
    state: z.enum([
      "passed",
      "failed",
      "timeout",
      "cancelled",
      "output-limit",
      "unavailable",
      "skipped",
    ]),
    step: z.enum([
      "install",
      "lint",
      "typecheck",
      "unit-tests",
      "contract-tests",
      "dependency-scan",
      "secret-scan",
      "compile",
      "production-prune",
    ]),
  })
  .strict();

export const applicationBuildTestSummaryV1Schema = z
  .object({
    failed: z.number().int().nonnegative(),
    kind: z.enum(["unit", "contract"]),
    passed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    state: z.enum(["passed", "failed", "not-run"]),
  })
  .strict();

export const applicationBuildFindingV1Schema = z
  .object({
    findingId: namespacedIdentifierSchema,
    packageName: z.string().max(256).optional(),
    path: applicationRepositoryPathV1Schema.optional(),
    severity: z.enum(["critical", "high", "medium", "low", "unknown"]),
    source: z.enum(["dependency", "secret"]),
    summary: safeSummarySchema,
  })
  .strict();

export const applicationBuildArtifactFileV1Schema = z
  .object({
    bytesBase64: z
      .string()
      .min(1)
      .max(Math.ceil((APPLICATION_BUILD_V1_MAXIMA.artifactBytes * 4) / 3) + 4),
    checksum: sha256DigestSchema,
    mediaType: z.enum([
      "application/json",
      "application/vnd.cyclonedx+json",
      "application/zip",
    ]),
    ownership: z.enum([
      "ai-assisted-build-artifact",
      "generated-build-artifact",
    ]),
    path: applicationRepositoryPathV1Schema,
    provenance: z
      .object({
        aiExtensionId: aiExtensionIdSchema.optional(),
        buildRequestDigest: sha256DigestSchema,
        buildContractDigest: sha256DigestSchema,
        candidateBundleDigest: sha256DigestSchema.optional(),
        dependencyLockDigest: sha256DigestSchema,
        generationArtifactDigest: sha256DigestSchema,
        solutionRevisionDigest: sha256DigestSchema,
        sourceChecksums: z
          .array(sha256DigestSchema)
          .max(APPLICATION_BUILD_V1_MAXIMA.files),
        sourceTreeDigest: sha256DigestSchema.optional(),
        workloadId: z.string().min(1).max(256),
      })
      .strict(),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(APPLICATION_BUILD_V1_MAXIMA.artifactBytes),
  })
  .strict()
  .superRefine((value, context) => {
    const hasCompleteAiProvenance =
      value.provenance.aiExtensionId !== undefined &&
      value.provenance.candidateBundleDigest !== undefined &&
      value.provenance.sourceTreeDigest !== undefined;
    const hasAnyAiProvenance =
      value.provenance.aiExtensionId !== undefined ||
      value.provenance.candidateBundleDigest !== undefined ||
      value.provenance.sourceTreeDigest !== undefined;
    if (
      (value.ownership === "ai-assisted-build-artifact" &&
        !hasCompleteAiProvenance) ||
      (value.ownership === "generated-build-artifact" && hasAnyAiProvenance)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "AI-assisted artifact ownership requires the complete extension, candidate, and source-tree provenance binding.",
        path: ["provenance"],
      });
    }
    const bytes = Buffer.from(value.bytesBase64, "base64");
    if (bytes.toString("base64") !== value.bytesBase64) {
      context.addIssue({
        code: "custom",
        message: "Artifact content must use canonical base64 encoding.",
        path: ["bytesBase64"],
      });
      return;
    }
    if (bytes.byteLength !== value.sizeBytes) {
      context.addIssue({
        code: "custom",
        message: "Artifact size must match the decoded content bytes.",
        path: ["sizeBytes"],
      });
    }
    if (sha256Digest(bytes) !== value.checksum) {
      context.addIssue({
        code: "custom",
        message: "Artifact checksum must hash the decoded content bytes.",
        path: ["checksum"],
      });
    }
  });

export const applicationLambdaArtifactManifestV1Schema = z
  .object({
    artifact: z
      .object({
        artifactId: z.string().min(1).max(256),
        archiveEntrypoint: z.literal("index.js"),
        checksum: sha256DigestSchema,
        digestAlgorithm: z.literal("sha256"),
        handler: z.literal("index.handler"),
        kind: z.literal("aws-lambda-zip"),
        mediaType: z.literal("application/zip"),
        path: applicationRepositoryPathV1Schema,
      })
      .strict(),
    bindings: z
      .object({
        buildContractDigest: sha256DigestSchema,
        buildRequestDigest: sha256DigestSchema,
        generationArtifactDigest: sha256DigestSchema,
        solutionRevisionDigest: sha256DigestSchema,
        solutionRevisionId: z.string().min(1).max(256),
        workloadId: z.string().min(1).max(256),
      })
      .strict(),
    compiledEntrypoint: applicationRepositoryPathV1Schema,
    contractVersion: z.literal(1),
    entrypoint: applicationRepositoryPathV1Schema,
    kind: z.literal("cloudmarkup.lambda-artifact-manifest"),
    runtime: applicationRuntimePinV1Schema,
  })
  .strict();

export const applicationBuildCoverageV1Schema = z
  .object({
    aiExtensionId: aiExtensionIdSchema.optional(),
    buildRequestDigest: sha256DigestSchema,
    candidateBundleDigest: sha256DigestSchema.optional(),
    confirmedState: z.enum([
      "ai-assisted-custom-validated",
      "starter-application",
      "complete-supported-pattern",
      "custom-implementation-required",
    ]),
    downgradeReason: safeSummarySchema.optional(),
    evidenceId: z.string().min(1).max(256).optional(),
    generationArtifactDigest: sha256DigestSchema.optional(),
    inputState: z.enum([
      "ai-assisted-custom-validated",
      "starter-application",
      "complete-supported-pattern",
      "custom-implementation-required",
    ]),
    solutionRevisionDigest: sha256DigestSchema,
    solutionRevisionId: z.string().min(1).max(256),
    sourceTreeDigest: sha256DigestSchema.optional(),
    workloadId: z.string().min(1).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    const hasCompleteAiBinding =
      value.aiExtensionId !== undefined &&
      value.candidateBundleDigest !== undefined &&
      value.sourceTreeDigest !== undefined &&
      value.generationArtifactDigest !== undefined;
    const hasAnyAiBinding =
      value.aiExtensionId !== undefined ||
      value.candidateBundleDigest !== undefined ||
      value.sourceTreeDigest !== undefined;
    if (
      (value.inputState === "ai-assisted-custom-validated" &&
        !hasCompleteAiBinding) ||
      (value.inputState !== "ai-assisted-custom-validated" && hasAnyAiBinding)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "AI-assisted coverage requires the complete extension, candidate, source-tree, and deterministic scaffold binding.",
        path: ["inputState"],
      });
    }
  });
const requiredPassingBuildStepsV1 = [
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

const requiredPassingBuildChecksV1 = [
  {
    checkId: "cloudmarkup.evidence.application-build-and-tests",
    generationCoverageRequirement: "application-build-and-tests",
  },
  {
    checkId: "cloudmarkup.evidence.application-security-checks",
    generationCoverageRequirement: "application-security-checks",
  },
] as const;

export const applicationBuildResultV1Schema = z
  .object({
    artifacts: z.array(applicationBuildArtifactFileV1Schema).max(8),
    contractVersion: z.literal(1),
    coverage: applicationBuildCoverageV1Schema,
    diagnostics: z.array(applicationBuildDiagnosticV1Schema).max(1_000),
    evidence: evidenceRecordV1Schema,
    findings: z.array(applicationBuildFindingV1Schema).max(1_000),
    reportDigest: sha256DigestSchema,
    state: z.enum(["passed", "failed", "error", "cancelled", "blocked"]),
    steps: z.array(applicationBuildStepSummaryV1Schema).max(16),
    tests: z.array(applicationBuildTestSummaryV1Schema).max(2),
  })
  .strict()
  .superRefine((value, context) => {
    const { reportDigest, ...projection } = value;
    if (sha256Digest(canonicalJson(projection)) !== reportDigest) {
      context.addIssue({
        code: "custom",
        message:
          "Build report digest must hash the canonical result projection.",
        path: ["reportDigest"],
      });
    }
    const artifactPaths = new Set<string>();
    value.artifacts.forEach((artifact, index) => {
      const portablePath = artifact.path.normalize("NFC").toLowerCase();
      if (artifactPaths.has(portablePath)) {
        context.addIssue({
          code: "custom",
          message:
            "Artifact paths must be unique under portable normalization.",
          path: ["artifacts", index, "path"],
        });
      }
      artifactPaths.add(portablePath);
    });
    const evidenceArtifacts = value.evidence.artifacts
      .map(({ digest, mediaType, sizeBytes }) => ({
        digest,
        mediaType,
        sizeBytes,
      }))
      .sort((left, right) =>
        compareUtf16(String(left.digest), String(right.digest)),
      );
    const resultArtifacts = value.artifacts
      .map(({ checksum, mediaType, sizeBytes }) => ({
        digest: checksum,
        mediaType,
        sizeBytes,
      }))
      .sort((left, right) =>
        compareUtf16(String(left.digest), String(right.digest)),
      );
    if (canonicalJson(evidenceArtifacts) !== canonicalJson(resultArtifacts)) {
      context.addIssue({
        code: "custom",
        message:
          "Evidence artifact commitments must equal the returned artifacts.",
        path: ["evidence", "artifacts"],
      });
    }
    const bindingDigests = [
      value.coverage.buildRequestDigest,
      value.coverage.solutionRevisionDigest,
      ...(value.coverage.candidateBundleDigest === undefined
        ? []
        : [value.coverage.candidateBundleDigest]),
      ...(value.coverage.generationArtifactDigest === undefined
        ? []
        : [value.coverage.generationArtifactDigest]),
      ...(value.coverage.sourceTreeDigest === undefined
        ? []
        : [value.coverage.sourceTreeDigest]),
    ];
    if (
      value.evidence.solutionRevisionId !== value.coverage.solutionRevisionId ||
      bindingDigests.some(
        (digest) => !value.evidence.provenance.inputDigests.includes(digest),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Build Evidence must bind the exact request, revision, source, candidate, and generation artifact.",
        path: ["evidence", "provenance", "inputDigests"],
      });
    }
    value.artifacts.forEach((artifact, index) => {
      const aiAssisted =
        value.coverage.inputState === "ai-assisted-custom-validated";
      if (
        artifact.provenance.buildRequestDigest !==
          value.coverage.buildRequestDigest ||
        artifact.provenance.generationArtifactDigest !==
          value.coverage.generationArtifactDigest ||
        artifact.provenance.solutionRevisionDigest !==
          value.coverage.solutionRevisionDigest ||
        artifact.provenance.workloadId !== value.coverage.workloadId ||
        artifact.provenance.aiExtensionId !== value.coverage.aiExtensionId ||
        artifact.provenance.candidateBundleDigest !==
          value.coverage.candidateBundleDigest ||
        artifact.provenance.sourceTreeDigest !==
          value.coverage.sourceTreeDigest ||
        aiAssisted !== (artifact.ownership === "ai-assisted-build-artifact")
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Build artifacts must bind the exact request, revision, generation artifact, source ownership, candidate, and workload coverage.",
          path: ["artifacts", index, "provenance"],
        });
      }
    });
    if (value.state === "passed") {
      const requiredArtifactDigests = value.artifacts
        .map(({ checksum }) => checksum)
        .sort(compareUtf16);
      const passingChecks = value.evidence.checks
        .map(
          ({
            artifactDigests,
            checkId,
            generationCoverageRequirement,
            issueIds,
            status,
          }) => ({
            artifactDigests: [...artifactDigests].sort(compareUtf16),
            checkId: String(checkId),
            generationCoverageRequirement,
            issueIds: [...issueIds].sort(compareUtf16),
            status,
          }),
        )
        .sort((left, right) => compareUtf16(left.checkId, right.checkId));
      const requiredPassingChecks = requiredPassingBuildChecksV1
        .map(({ checkId, generationCoverageRequirement }) => ({
          artifactDigests: requiredArtifactDigests,
          checkId,
          generationCoverageRequirement,
          issueIds: [],
          status: "passed" as const,
        }))
        .sort((left, right) => compareUtf16(left.checkId, right.checkId));
      if (
        canonicalJson(passingChecks) !== canonicalJson(requiredPassingChecks)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Passing builds require the exact passing build/test and security Evidence checks with complete artifact commitments and no issues.",
          path: ["evidence", "checks"],
        });
      }
      const mediaTypes = value.artifacts
        .map(({ mediaType }) => mediaType)
        .sort(compareUtf16);
      if (
        canonicalJson(mediaTypes) !==
        canonicalJson([
          "application/json",
          "application/vnd.cyclonedx+json",
          "application/zip",
        ])
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Passing builds require exactly one Lambda ZIP, target-neutral artifact manifest, and CycloneDX SBOM.",
          path: ["artifacts"],
        });
      }
      const zip = value.artifacts.find(
        ({ mediaType }) => mediaType === "application/zip",
      );
      const manifestArtifact = value.artifacts.find(
        ({ mediaType }) => mediaType === "application/json",
      );
      let manifest:
        z.output<typeof applicationLambdaArtifactManifestV1Schema> | undefined;
      try {
        manifest = applicationLambdaArtifactManifestV1Schema.parse(
          JSON.parse(
            Buffer.from(manifestArtifact?.bytesBase64 ?? "", "base64").toString(
              "utf8",
            ),
          ) as unknown,
        );
      } catch {
        manifest = undefined;
      }
      if (
        zip === undefined ||
        manifestArtifact === undefined ||
        manifest?.artifact.checksum !== zip.checksum ||
        manifest.artifact.path !== zip.path ||
        manifestArtifact.path !==
          zip.path.replace(/\/function\.zip$/u, "/artifact-manifest.json") ||
        manifestArtifact.ownership !== zip.ownership ||
        manifest.bindings.buildContractDigest !==
          zip.provenance.buildContractDigest ||
        manifest.bindings.buildContractDigest !==
          manifestArtifact.provenance.buildContractDigest ||
        manifest.bindings.workloadId !== value.coverage.workloadId ||
        manifest.bindings.solutionRevisionId !==
          value.coverage.solutionRevisionId ||
        manifest.bindings.buildRequestDigest !==
          value.coverage.buildRequestDigest ||
        manifest.bindings.generationArtifactDigest !==
          value.coverage.generationArtifactDigest ||
        manifest.bindings.solutionRevisionDigest !==
          value.coverage.solutionRevisionDigest
      ) {
        context.addIssue({
          code: "custom",
          message:
            "The final artifact manifest must bind the exact ZIP and build coverage.",
          path: ["artifacts"],
        });
      }
      if (
        value.coverage.evidenceId !== value.evidence.id ||
        value.coverage.downgradeReason !== undefined ||
        value.coverage.generationArtifactDigest === undefined ||
        value.coverage.confirmedState !== value.coverage.inputState ||
        value.coverage.confirmedState === "custom-implementation-required"
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Passing coverage must preserve the admitted input assessment and bind this Evidence without a downgrade.",
          path: ["coverage"],
        });
      }
      if (
        value.diagnostics.some(({ severity }) => severity === "error") ||
        canonicalJson(
          value.steps.map(({ executable, step }) => [step, executable]),
        ) !== canonicalJson(requiredPassingBuildStepsV1) ||
        value.steps.some(({ state }) => state !== "passed") ||
        value.tests.length !== 2 ||
        value.tests.some(
          ({ passed, state }) => state !== "passed" || passed === 0,
        ) ||
        value.evidence.checks.some(({ status }) => status !== "passed")
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Passing builds require every build, test, security, and Evidence check to pass.",
          path: ["state"],
        });
      }
    } else if (
      value.artifacts.length !== 0 ||
      value.coverage.confirmedState !== "custom-implementation-required" ||
      value.coverage.evidenceId !== undefined ||
      value.coverage.downgradeReason === undefined
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Non-passing builds cannot expose artifacts or confirmed complete coverage.",
        path: ["state"],
      });
    }
  });

export type ApplicationBuildToolPinV1 = z.output<
  typeof applicationBuildToolPinV1Schema
>;
export type ApplicationDependencyLockV1 = z.output<
  typeof applicationDependencyLockV1Schema
>;
export type ApplicationBuildLimitsV1 = z.output<
  typeof applicationBuildLimitsV1Schema
>;
export type ApplicationBuildProfileV1 = z.output<
  typeof applicationBuildProfileV1Schema
>;
export type ApplicationBuildPolicyV1 = z.output<
  typeof applicationBuildPolicyV1Schema
>;
export type ApplicationBuildSourceFileV1 = z.output<
  typeof applicationBuildSourceFileV1Schema
>;
export type ApplicationBuildRequestV1 = z.output<
  typeof applicationBuildRequestV1Schema
>;
export type ApplicationBuildDiagnosticV1 = z.output<
  typeof applicationBuildDiagnosticV1Schema
>;
export type ApplicationBuildReferenceV1 = z.output<
  typeof applicationBuildReferenceV1Schema
>;
export type ApplicationBuildStepSummaryV1 = z.output<
  typeof applicationBuildStepSummaryV1Schema
>;
export type ApplicationBuildTestSummaryV1 = z.output<
  typeof applicationBuildTestSummaryV1Schema
>;
export type ApplicationBuildFindingV1 = z.output<
  typeof applicationBuildFindingV1Schema
>;
export type ApplicationBuildArtifactFileV1 = z.output<
  typeof applicationBuildArtifactFileV1Schema
>;
export type ApplicationLambdaArtifactManifestV1 = z.output<
  typeof applicationLambdaArtifactManifestV1Schema
>;
export type ApplicationBuildCoverageV1 = z.output<
  typeof applicationBuildCoverageV1Schema
>;
export type ApplicationBuildResultV1 = z.output<
  typeof applicationBuildResultV1Schema
>;
export type {
  ApplicationGenerationResultV1,
  EvidenceRecordV1,
  Prompt32ABuildArtifactEnvelopeV1,
  Sha256Digest,
};

export type ApplicationBuildExecutable =
  "pnpm" | "eslint" | "tsc" | "vitest" | "trivy";
export type ApplicationBuildStep = ApplicationBuildStepSummaryV1["step"];

export interface ApplicationBuildCommandInvocation {
  readonly args: readonly string[];
  readonly executable: ApplicationBuildExecutable;
  readonly step: ApplicationBuildStep;
}

export interface ApplicationBuildCommandResult {
  readonly exitCode: number | null;
  readonly outputBytes: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly termination:
    "completed" | "timeout" | "cancelled" | "output-limit" | "unavailable";
}

export interface ApplicationBuildProducedFile {
  readonly bytes: Uint8Array;
  readonly kind: "regular-file" | "symlink" | "device-file";
  readonly path: string;
}

export interface ApplicationBuildWorkspaceSession {
  execute(
    invocation: ApplicationBuildCommandInvocation,
    signal?: AbortSignal,
  ): Promise<ApplicationBuildCommandResult>;
  readProducedFiles(): Promise<readonly ApplicationBuildProducedFile[]>;
  dispose(): Promise<void>;
}

export interface ApplicationBuildWorkspaceExecutor {
  open(input: {
    /** Optional transient cancellation; never persisted in a request or receipt. */
    readonly signal?: AbortSignal;
    readonly files: readonly ApplicationBuildSourceFileV1[];
    readonly limits: ApplicationBuildLimitsV1;
    readonly lock: ApplicationDependencyLockV1;
  }): Promise<ApplicationBuildWorkspaceSession>;
}

export interface ApplicationBuildRunner {
  run(
    input: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ApplicationBuildResultV1>;
}
