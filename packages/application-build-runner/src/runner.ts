import { parseTestSummary, parseTrivyFindings } from "./tool-observations.js";
import {
  NOTES_IDENTIFIER_RELEASE_V1_1,
  HTTP_NO_CONTENT_RELEASE_V1,
  APPLICATION_GENERATOR_DIGEST,
  APPLICATION_GENERATOR_ID,
  APPLICATION_GENERATOR_VERSION,
  APPLICATION_RUNTIME_DIGEST,
  APPLICATION_RUNTIME_ID,
  APPLICATION_RUNTIME_VERSION,
  EVENT_APPLICATION_GENERATOR_DIGEST,
  EVENT_APPLICATION_GENERATOR_ID,
  EVENT_APPLICATION_GENERATOR_VERSION,
  EVENT_APPLICATION_PATTERN_DIGEST,
  EVENT_APPLICATION_PATTERN_ID,
  EVENT_APPLICATION_PATTERN_VERSION,
  EVENT_APPLICATION_TEMPLATE_DIGEST,
  EVENT_APPLICATION_TEMPLATE_ID,
  EVENT_APPLICATION_TEMPLATE_VERSION,
  NOTES_PATTERN_DIGEST,
  NOTES_PATTERN_ID,
  NOTES_PATTERN_VERSION,
  NOTES_TEMPLATE_DIGEST,
  NOTES_TEMPLATE_ID,
  NOTES_TEMPLATE_VERSION,
  LAMBDA_HANDLER,
  LAMBDA_RUNTIME,
  NODE_RUNTIME_FAMILY,
  TYPESCRIPT_LANGUAGE_FAMILY,
} from "@cloudmarkup/application-generator";
import {
  evidenceRecordV1Schema,
  normalizeSolutionRevisionManifestV1,
  type EvidenceRecordV1,
  type Prompt32ABuildArtifactEnvelopeV1,
} from "@cloudmarkup/schemas";

import {
  APPROVED_APPLICATION_BUILD_COMMANDS,
  commandSummary,
} from "./commands.js";
import {
  applicationAiCandidateBundleDigest,
  applicationBuildRequestDigest,
  applicationBuildSourceTreeDigest,
  applicationLambdaArtifactManifestV1Schema,
  applicationBuildPolicyV1Schema,
  applicationBuildRequestV1Schema,
  applicationBuildResultV1Schema,
  type ApplicationBuildArtifactFileV1,
  type ApplicationBuildCommandInvocation,
  type ApplicationBuildCommandResult,
  type ApplicationBuildDiagnosticV1,
  type ApplicationBuildFindingV1,
  type ApplicationBuildPolicyV1,
  type ApplicationBuildRequestV1,
  type ApplicationBuildResultV1,
  type ApplicationBuildRunner,
  type ApplicationBuildSourceFileV1,
  type ApplicationBuildStepSummaryV1,
  type ApplicationBuildTestSummaryV1,
  type ApplicationBuildWorkspaceExecutor,
  type ApplicationDependencyLockV1,
  type ApplicationGenerationResultV1,
  type Sha256Digest,
} from "./contracts.js";
import {
  canonicalJson,
  compareUtf16,
  contentSecurityIssue,
  diagnostic,
  encodeBase64,
  outputPathIssue,
  sha256Digest,
  sortedDiagnostics,
  sourcePathIssue,
  utf8Bytes,
} from "./security.js";
import {
  createDeterministicLambdaZip,
  type ApplicationZipEntry,
} from "./zip.js";

interface PreparedBuild {
  readonly aiBinding?: {
    readonly candidateBundleDigest: Sha256Digest;
    readonly extensionId: NonNullable<
      ApplicationBuildArtifactFileV1["provenance"]["aiExtensionId"]
    >;
    readonly sourceTreeDigest: Sha256Digest;
  };
  readonly buildEnvelope?: Prompt32ABuildArtifactEnvelopeV1;
  readonly diagnostics: ApplicationBuildDiagnosticV1[];
  readonly files: ApplicationBuildSourceFileV1[];
  readonly generationArtifactDigest?: Sha256Digest;
  readonly inputCoverage:
    | "ai-assisted-custom-validated"
    | "starter-application"
    | "complete-supported-pattern"
    | "custom-implementation-required";
  readonly sourceDigest: Sha256Digest;
  readonly workloadId: string;
}

interface ExecutedBuild {
  readonly diagnostics: ApplicationBuildDiagnosticV1[];
  readonly findings: ApplicationBuildFindingV1[];
  readonly producedFiles: readonly {
    readonly bytes: Uint8Array;
    readonly kind: "regular-file" | "symlink" | "device-file";
    readonly path: string;
  }[];
  readonly state: ApplicationBuildResultV1["state"];
  readonly steps: ApplicationBuildStepSummaryV1[];
  readonly tests: ApplicationBuildTestSummaryV1[];
}

function approvedGeneratedDescriptor(
  input: ApplicationGenerationResultV1["artifact"],
): boolean {
  return (
    input.runtime.id === APPLICATION_RUNTIME_ID &&
    input.runtime.version === APPLICATION_RUNTIME_VERSION &&
    input.runtime.digest === APPLICATION_RUNTIME_DIGEST &&
    input.runtime.runtimeFamily === NODE_RUNTIME_FAMILY &&
    input.runtime.languageFamily === TYPESCRIPT_LANGUAGE_FAMILY &&
    input.runtime.runtime === LAMBDA_RUNTIME &&
    input.runtime.handler === LAMBDA_HANDLER &&
    input.runtime.moduleFormat === "esm" &&
    ((input.generator.id === APPLICATION_GENERATOR_ID &&
      input.generator.version === APPLICATION_GENERATOR_VERSION &&
      input.generator.digest === APPLICATION_GENERATOR_DIGEST &&
      input.template.id === NOTES_TEMPLATE_ID &&
      input.template.version === NOTES_TEMPLATE_VERSION &&
      input.template.digest === NOTES_TEMPLATE_DIGEST &&
      input.pattern.id === NOTES_PATTERN_ID &&
      input.pattern.version === NOTES_PATTERN_VERSION &&
      input.pattern.digest === NOTES_PATTERN_DIGEST) ||
      (input.generator.id === NOTES_IDENTIFIER_RELEASE_V1_1.generator.id &&
        input.generator.version ===
          NOTES_IDENTIFIER_RELEASE_V1_1.generator.version &&
        input.generator.digest ===
          NOTES_IDENTIFIER_RELEASE_V1_1.generator.digest &&
        input.template.id === NOTES_IDENTIFIER_RELEASE_V1_1.template.id &&
        input.template.version ===
          NOTES_IDENTIFIER_RELEASE_V1_1.template.version &&
        input.template.digest ===
          NOTES_IDENTIFIER_RELEASE_V1_1.template.digest &&
        input.pattern.id === NOTES_IDENTIFIER_RELEASE_V1_1.pattern.id &&
        input.pattern.version ===
          NOTES_IDENTIFIER_RELEASE_V1_1.pattern.version &&
        input.pattern.digest ===
          NOTES_IDENTIFIER_RELEASE_V1_1.pattern.digest) ||
      (input.generator.id === HTTP_NO_CONTENT_RELEASE_V1.generator.id &&
        input.generator.version ===
          HTTP_NO_CONTENT_RELEASE_V1.generator.version &&
        input.generator.digest ===
          HTTP_NO_CONTENT_RELEASE_V1.generator.digest &&
        input.template.id === HTTP_NO_CONTENT_RELEASE_V1.template.id &&
        input.template.version ===
          HTTP_NO_CONTENT_RELEASE_V1.template.version &&
        input.template.digest === HTTP_NO_CONTENT_RELEASE_V1.template.digest &&
        input.pattern.id === HTTP_NO_CONTENT_RELEASE_V1.pattern.id &&
        input.pattern.version === HTTP_NO_CONTENT_RELEASE_V1.pattern.version &&
        input.pattern.digest === HTTP_NO_CONTENT_RELEASE_V1.pattern.digest) ||
      (input.generator.id === EVENT_APPLICATION_GENERATOR_ID &&
        input.generator.version === EVENT_APPLICATION_GENERATOR_VERSION &&
        input.generator.digest === EVENT_APPLICATION_GENERATOR_DIGEST &&
        input.template.id === EVENT_APPLICATION_TEMPLATE_ID &&
        input.template.version === EVENT_APPLICATION_TEMPLATE_VERSION &&
        input.template.digest === EVENT_APPLICATION_TEMPLATE_DIGEST &&
        input.pattern.id === EVENT_APPLICATION_PATTERN_ID &&
        input.pattern.version === EVENT_APPLICATION_PATTERN_VERSION &&
        input.pattern.digest === EVENT_APPLICATION_PATTERN_DIGEST))
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function scaffoldSolutionRevisionDigest(
  request: ApplicationBuildRequestV1,
): Sha256Digest {
  const semanticArchitectureHash =
    request.solutionRevision.architecture.contentHash;
  return sha256Digest(
    canonicalJson(
      normalizeSolutionRevisionManifestV1({
        ...request.solutionRevision,
        architecture: {
          ...request.solutionRevision.architecture,
          documentHash: semanticArchitectureHash,
          visualHash: semanticArchitectureHash,
        },
      }),
    ),
  );
}

function lockDigest(lock: ApplicationDependencyLockV1): Sha256Digest {
  return sha256Digest(canonicalJson(lock));
}

function exactInitialRuntime(
  envelope: Prompt32ABuildArtifactEnvelopeV1,
): boolean {
  const runtime = envelope.contract.runtime;
  return (
    runtime.id === APPLICATION_RUNTIME_ID &&
    runtime.version === APPLICATION_RUNTIME_VERSION &&
    runtime.digest === APPLICATION_RUNTIME_DIGEST &&
    runtime.runtimeFamily === NODE_RUNTIME_FAMILY &&
    runtime.languageFamily === TYPESCRIPT_LANGUAGE_FAMILY &&
    runtime.runtime === LAMBDA_RUNTIME &&
    runtime.handler === LAMBDA_HANDLER &&
    runtime.moduleFormat === "esm"
  );
}

function requiredContent(
  result: ApplicationGenerationResultV1,
  path: string,
):
  | {
      readonly content: string;
      readonly mediaType: ApplicationBuildSourceFileV1["mediaType"];
      readonly ownership: ApplicationBuildSourceFileV1["ownership"];
    }
  | undefined {
  const file = result.artifact.sourceFiles.find(
    (candidate) => candidate.path === path,
  );
  if (
    file === undefined ||
    !("content" in file) ||
    typeof file.content !== "string"
  )
    return undefined;
  if (
    !new Set([
      "application/json",
      "text/markdown",
      "text/plain",
      "text/typescript",
    ]).has(file.mediaType)
  )
    return undefined;
  return {
    content: file.content,
    mediaType: file.mediaType as ApplicationBuildSourceFileV1["mediaType"],
    ownership:
      file.ownership === "generated" ? "generated" : "user-owned-extension",
  };
}

function generatedFiles(
  result: ApplicationGenerationResultV1,
  envelope: Prompt32ABuildArtifactEnvelopeV1,
  diagnostics: ApplicationBuildDiagnosticV1[],
  revisionId: string,
): ApplicationBuildSourceFileV1[] {
  const files: ApplicationBuildSourceFileV1[] = [];
  for (const input of envelope.contract.sourceInputs) {
    const source = result.artifact.sourceFiles.find(
      (candidate) => candidate.path === input.path,
    );
    const materialized = requiredContent(result, input.path);
    if (source?.checksum !== input.checksum || materialized === undefined) {
      diagnostics.push(
        diagnostic({
          code: "application.build.source-not-materialized",
          detail:
            "Every build-envelope source input must be present with exact bytes and checksum.",
          solutionRevisionId: revisionId,
          source: "admission",
          summary: "The generated source tree is incomplete or has changed.",
          workloadId: envelope.contract.workloadId,
        }),
      );
      continue;
    }
    files.push({
      checksum: input.checksum,
      content: materialized.content,
      mediaType: materialized.mediaType,
      ownership: materialized.ownership,
      path: input.path,
    });
  }
  return files.sort((left, right) => compareUtf16(left.path, right.path));
}

function packageManifestFile(
  files: readonly ApplicationBuildSourceFileV1[],
): ApplicationBuildSourceFileV1 | undefined {
  return files.find((file) => file.path === "application/package.json");
}

function validatePackageAndLock(
  request: ApplicationBuildRequestV1,
  policy: ApplicationBuildPolicyV1,
  prepared: PreparedBuild,
): void {
  const { diagnostics, files, workloadId } = prepared;
  const revisionId = request.solutionRevision.solutionRevisionId;
  if (request.dependencyLock.cache.digest !== policy.dependencyCacheDigest) {
    diagnostics.push(
      diagnostic({
        code: "application.build.dependency-cache-not-approved",
        detail:
          "The resolved lock must bind the exact prepackaged offline dependency cache.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "The dependency cache is not approved.",
        workloadId,
      }),
    );
  }
  const approvedPnpm = policy.toolchain.find(
    (tool) => tool.id === "package-manager.pnpm",
  );
  if (
    request.dependencyLock.packageManager.id !== approvedPnpm?.id ||
    request.dependencyLock.packageManager.version !== approvedPnpm.version ||
    request.dependencyLock.packageManager.digest !== approvedPnpm.digest
  ) {
    diagnostics.push(
      diagnostic({
        code: "application.build.package-manager-not-approved",
        detail:
          "The dependency lock package manager must equal the exact approved pnpm binary pin.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "The package manager is not approved.",
        workloadId,
      }),
    );
  }
  if (
    sha256Digest(request.dependencyLock.lockfileContent) !==
    request.dependencyLock.lockfileChecksum
  ) {
    diagnostics.push(
      diagnostic({
        code: "application.build.lockfile-checksum-mismatch",
        detail: "Resolved pnpm lock bytes do not match the declared checksum.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "The dependency lock checksum does not match.",
        workloadId,
      }),
    );
  }
  if (
    !/^lockfileVersion:\s*['"]?9(?:\.0)?['"]?\s*$/mu.test(
      request.dependencyLock.lockfileContent,
    )
  ) {
    diagnostics.push(
      diagnostic({
        code: "application.build.lockfile-format-unsupported",
        detail: "The initial profile accepts only pnpm lockfile version 9.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "The dependency lock format is unsupported.",
        workloadId,
      }),
    );
  }
  const packageFile = packageManifestFile(files);
  if (
    packageFile?.checksum !== request.dependencyLock.packageManifestChecksum
  ) {
    diagnostics.push(
      diagnostic({
        code: "application.build.package-manifest-mismatch",
        detail:
          "The dependency lock must bind the exact application/package.json bytes.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "The package manifest does not match the dependency lock.",
        workloadId,
      }),
    );
    return;
  }
  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(packageFile.content) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new TypeError();
    manifest = parsed as Record<string, unknown>;
  } catch {
    diagnostics.push(
      diagnostic({
        code: "application.build.package-manifest-malformed",
        detail: "application/package.json must be a strict JSON object.",
        file: packageFile,
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "The package manifest is malformed.",
        workloadId,
      }),
    );
    return;
  }
  if ("scripts" in manifest) {
    diagnostics.push(
      diagnostic({
        code: "application.build.lifecycle-script-forbidden",
        detail:
          "The reviewed generated profile does not permit package scripts or lifecycle hooks.",
        file: packageFile,
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "Package scripts are forbidden.",
        workloadId,
      }),
    );
  }
  const envelope = prepared.buildEnvelope;
  if (envelope === undefined) return;
  const expectedToolchain = envelope.contract.toolchain
    .map(({ id, version }) => ({ id, version }))
    .sort((left, right) => compareUtf16(String(left.id), String(right.id)));
  const approvedToolchain = policy.toolchain
    .map(({ id, version }) => ({ id, version }))
    .sort((left, right) => compareUtf16(String(left.id), String(right.id)));
  if (!sameJson(expectedToolchain, approvedToolchain)) {
    diagnostics.push(
      diagnostic({
        code: "application.build.toolchain-not-approved",
        detail:
          "The Prompt 32A toolchain coordinates must equal the approved installed toolchain pins.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "The application toolchain is not approved.",
        workloadId,
      }),
    );
  }
  const declared = new Map<
    string,
    { kind: "runtime" | "development"; version: string }
  >();
  for (const kind of ["dependencies", "devDependencies"] as const) {
    const record = manifest[kind];
    if (record === undefined) continue;
    if (
      typeof record !== "object" ||
      record === null ||
      Array.isArray(record)
    ) {
      diagnostics.push(
        diagnostic({
          code: "application.build.package-manifest-malformed",
          detail: `${kind} must be an exact JSON object.`,
          file: packageFile,
          solutionRevisionId: revisionId,
          source: "admission",
          summary: "The package dependency declaration is malformed.",
          workloadId,
        }),
      );
      continue;
    }
    for (const [name, version] of Object.entries(record)) {
      if (typeof version !== "string") continue;
      declared.set(name, {
        kind: kind === "dependencies" ? "runtime" : "development",
        version,
      });
    }
  }
  const expected = envelope.contract.dependencies.map(
    ({ kind, name, version }) => ({ kind, name, version }),
  );
  const actual = [...declared].map(([name, value]) => ({ name, ...value }));
  const sort = <T extends { readonly name: string; readonly version: string }>(
    entries: readonly T[],
  ): T[] =>
    [...entries].sort((left, right) =>
      compareUtf16(
        `${left.name}\u0000${left.version}`,
        `${right.name}\u0000${right.version}`,
      ),
    );
  if (!sameJson(sort(actual), sort(expected))) {
    diagnostics.push(
      diagnostic({
        code: "application.build.dependency-contract-mismatch",
        detail:
          "Package dependencies must equal the exact Prompt 32A build-envelope coordinates.",
        file: packageFile,
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "Declared dependencies differ from the build contract.",
        workloadId,
      }),
    );
  }
  const approved = policy.dependencyAllowlist.map(
    ({ kind, name, version }) => ({ kind, name, version }),
  );
  if (!sameJson(sort(expected), sort(approved))) {
    diagnostics.push(
      diagnostic({
        code: "application.build.dependency-not-approved",
        detail:
          "The build envelope dependency set is not the exact approved profile allowlist.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "A dependency is not approved.",
        workloadId,
      }),
    );
  }
  const locked = new Map(
    request.dependencyLock.packages.map((entry) => [
      `${entry.name}\u0000${entry.version}`,
      entry,
    ]),
  );
  for (const dependency of expected) {
    const entry = locked.get(`${dependency.name}\u0000${dependency.version}`);
    if (entry?.kind !== dependency.kind) {
      diagnostics.push(
        diagnostic({
          code: "application.build.lockfile-dependency-mismatch",
          detail:
            "Every direct build dependency must have an exact integrity-bearing lock entry of the same kind.",
          solutionRevisionId: revisionId,
          source: "admission",
          summary: "The dependency lock does not match the build contract.",
          workloadId,
        }),
      );
    }
  }
  const denied = new Set(policy.dependencyDenylist);
  if (request.dependencyLock.packages.some((entry) => denied.has(entry.name))) {
    diagnostics.push(
      diagnostic({
        code: "application.build.dependency-denied",
        detail:
          "The resolved dependency graph contains a package denied by the approved profile.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "The dependency graph contains a denied package.",
        workloadId,
      }),
    );
  }
}

const REQUIRED_AI_CUSTOM_VALIDATION = [
  "build",
  "contract-tests",
  "parse",
  "security",
  "static-analysis",
  "unit-tests",
] as const;

const REQUIRED_BUILD_CHECKS = [
  "compile",
  "contract-tests",
  "reproducibility",
  "security",
  "unit-tests",
] as const;

function prepareAiAssisted(
  request: ApplicationBuildRequestV1,
  policy: ApplicationBuildPolicyV1,
  diagnostics: ApplicationBuildDiagnosticV1[],
): PreparedBuild {
  if (request.source.kind !== "ai-assisted-custom") {
    throw new TypeError("AI-assisted preparation requires AI source.");
  }
  const source = request.source;
  const scaffold = source.deterministicScaffold;
  const envelope = source.buildEnvelope;
  const files = [...source.files].sort((left, right) =>
    compareUtf16(left.path, right.path),
  );
  const revisionId = request.solutionRevision.solutionRevisionId;
  const workloadId = envelope.contract.workloadId;
  const reject = (input: {
    readonly code: string;
    readonly detail: string;
    readonly file?: ApplicationBuildSourceFileV1;
    readonly summary: string;
  }) => {
    diagnostics.push(
      diagnostic({
        ...input,
        solutionRevisionId: revisionId,
        source: "admission",
        workloadId,
      }),
    );
  };

  if (request.profile.sourcePolicy !== "ai-assisted-custom-only") {
    reject({
      code: "application.build.ai-assisted-profile-required",
      detail:
        "AI-authored source requires the exact AI-assisted custom Node.js 24 build profile.",
      summary: "The AI-assisted custom build profile is required.",
    });
  }
  if (
    scaffold.artifact.solutionRevisionId !== revisionId ||
    scaffold.artifact.sourceManifest.solutionRevisionId !== revisionId ||
    scaffold.artifact.sourceManifest.inputDigests.solutionRevision !==
      scaffoldSolutionRevisionDigest(request)
  ) {
    reject({
      code: "application.build.revision-binding-mismatch",
      detail:
        "The deterministic scaffold and source manifest must bind the exact Solution Revision.",
      summary: "The deterministic scaffold binds a different revision.",
    });
  }
  if (
    scaffold.artifact.generator.id !== APPLICATION_GENERATOR_ID ||
    scaffold.artifact.generator.version !== APPLICATION_GENERATOR_VERSION ||
    scaffold.artifact.generator.digest !== APPLICATION_GENERATOR_DIGEST
  ) {
    reject({
      code: "application.build.generator-not-approved",
      detail:
        "The AI-assisted build requires the exact Prompt 29A deterministic scaffold generator.",
      summary: "The deterministic scaffold generator is not approved.",
    });
  }
  if (
    scaffold.artifact.buildContracts.length !== 0 ||
    scaffold.artifact.sourceManifest.buildContracts.length !== 0
  ) {
    reject({
      code: "application.build.ai-scaffold-envelope-shadowed",
      detail:
        "The Prompt 29A AI scaffold must remain non-executable; its reviewed build envelope is supplied separately.",
      summary: "The AI scaffold contains an unexpected build envelope.",
    });
  }
  if (
    scaffold.artifact.diagnostics.some((entry) => entry.severity === "error")
  ) {
    reject({
      code: "application.build.generator-errors",
      detail:
        "A deterministic scaffold with producer errors cannot enter the execution boundary.",
      summary: "The application generator reported errors.",
    });
  }

  const workloadContract = scaffold.artifact.workloadContracts.find(
    (entry) => entry.workloadId === workloadId,
  );
  if (
    workloadContract?.implementationMode !== "ai-assisted-custom" ||
    workloadContract.readiness !== "custom-source-required" ||
    workloadContract.ownershipReadiness !== "extension-boundary-ready"
  ) {
    reject({
      code: "application.build.ai-scaffold-not-ready",
      detail:
        "The deterministic scaffold must expose an exact ready AI-assisted workload and extension boundary.",
      summary: "The deterministic AI scaffold is not ready.",
    });
  }
  if (
    workloadContract?.implementationMode === "ai-assisted-custom" &&
    !sameJson([...workloadContract.validationRequirements].sort(compareUtf16), [
      ...REQUIRED_AI_CUSTOM_VALIDATION,
    ])
  ) {
    reject({
      code: "application.build.ai-validation-requirements-mismatch",
      detail:
        "The AI scaffold must retain parse, static, build, unit, contract, and security validation requirements.",
      summary: "AI validation requirements do not match.",
    });
  }
  if (!exactInitialRuntime(envelope)) {
    reject({
      code: "application.build.runtime-not-approved",
      detail:
        "The externally derived build envelope does not match the exact reviewed Node.js 24/TypeScript/ESM runtime.",
      summary: "The runtime is not approved.",
    });
  }
  if (envelope.contract.implementationMode !== "ai-assisted-custom") {
    reject({
      code: "application.build.ai-envelope-mode-mismatch",
      detail:
        "The externally derived build envelope must retain ai-assisted-custom implementation mode.",
      summary: "The build envelope has the wrong implementation mode.",
    });
  }
  if (
    !sameJson([...envelope.contract.requiredChecks].sort(compareUtf16), [
      ...REQUIRED_BUILD_CHECKS,
    ])
  ) {
    reject({
      code: "application.build.required-checks-mismatch",
      detail:
        "The build envelope cannot omit compile, unit, contract, security, or reproducibility checks.",
      summary: "The required build checks do not match.",
    });
  }
  if (
    envelope.contract.packageManifestPath !== "application/package.json" ||
    envelope.contract.lockfilePath !== "application/lockfile.contract.json"
  ) {
    reject({
      code: "application.build.ai-envelope-path-mismatch",
      detail:
        "The derived build envelope must bind the fixed package, lock, and source-manifest paths.",
      summary: "The build envelope paths do not match the source tree.",
    });
  }

  const scaffoldFiles = scaffold.artifact.sourceFiles.filter((file) =>
    file.provenance.workloadIds.includes(workloadId),
  );
  const scaffoldEntrypoints = scaffoldFiles.filter(
    (file) =>
      file.ownership === "generated" &&
      /^application\/src\/functions\/[^/]+\/index\.ts$/u.test(file.path),
  );
  const expectedEntrypoint = scaffoldEntrypoints[0]?.path;
  const expectedCompiledEntrypoint =
    expectedEntrypoint === undefined
      ? undefined
      : `application/dist/${expectedEntrypoint
          .slice("application/".length)
          .replace(/\.ts$/u, ".js")}`;
  const expectedArtifactPath =
    workloadContract?.implementationMode === "ai-assisted-custom"
      ? workloadContract.expectedArtifact.path
      : undefined;
  if (
    scaffoldEntrypoints.length !== 1 ||
    envelope.contract.entrypoint !== expectedEntrypoint ||
    envelope.contract.compiledEntrypoint !== expectedCompiledEntrypoint ||
    envelope.contract.expectedArtifact.path !== expectedArtifactPath
  ) {
    reject({
      code: "application.build.ai-envelope-entrypoint-mismatch",
      detail:
        "The external build envelope must retain the exact deterministic handler, compiled entrypoint, and expected artifact path.",
      summary: "The build envelope entrypoint or artifact path does not match.",
    });
  }
  const scaffoldByPath = new Map(
    scaffoldFiles.map((file) => [file.path, file] as const),
  );
  const finalByPath = new Map(files.map((file) => [file.path, file] as const));
  if (
    scaffoldFiles.length !== files.length ||
    scaffoldFiles.some((file) => !finalByPath.has(file.path))
  ) {
    reject({
      code: "application.build.ai-scaffold-file-set-mismatch",
      detail:
        "The final source inventory must retain every workload-scoped scaffold path and cannot introduce unscaffolded paths.",
      summary: "The final source paths differ from the deterministic scaffold.",
    });
  }

  const declaredBoundaryPaths = new Set(
    workloadContract?.implementationMode === "ai-assisted-custom"
      ? workloadContract.sourceFiles
          .filter((file) => file.ownership !== "generated")
          .map((file) => file.path)
      : [],
  );
  const extensionBoundaryPaths = new Set(
    scaffoldFiles
      .filter(
        (file) =>
          file.ownership !== "generated" &&
          file.provenance.extensionPointIds.length > 0 &&
          declaredBoundaryPaths.has(file.path),
      )
      .map((file) => file.path),
  );
  const aiOwnedPaths = [...source.aiOwnedPaths].sort(compareUtf16);
  const aiFiles = files.filter((file) => file.ownership === "ai-authored");
  const actualAiPaths = aiFiles.map((file) => file.path).sort(compareUtf16);
  if (
    new Set(aiOwnedPaths).size !== aiOwnedPaths.length ||
    !sameJson(aiOwnedPaths, actualAiPaths)
  ) {
    reject({
      code: "application.build.ai-owned-paths-mismatch",
      detail:
        "AI-owned paths must be unique and equal the exact ai-authored file inventory.",
      summary: "AI-owned paths do not match the candidate files.",
    });
  }

  for (const file of files) {
    const scaffoldFile = scaffoldByPath.get(file.path);
    if (scaffoldFile === undefined) {
      reject({
        code: "application.build.ai-source-ungrounded",
        detail:
          "Every AI build input must correspond to an exact deterministic scaffold path.",
        file,
        summary: "An AI source path is not grounded in the scaffold.",
      });
      continue;
    }
    if (
      file.ownership !== "generated" &&
      file.ownership !== "ai-authored" &&
      file.ownership !== "user-owned"
    ) {
      reject({
        code: "application.build.ai-source-ownership-invalid",
        detail:
          "The AI profile accepts only preserved generated, ai-authored, and user-owned labels.",
        file,
        summary: "A source ownership label is invalid for AI execution.",
      });
      continue;
    }
    if (file.ownership === "generated") {
      const content =
        "content" in scaffoldFile ? scaffoldFile.content : undefined;
      if (
        scaffoldFile.ownership !== "generated" ||
        content === undefined ||
        file.content !== content ||
        file.checksum !== scaffoldFile.checksum ||
        file.mediaType !== scaffoldFile.mediaType
      ) {
        reject({
          code: "application.build.generated-scaffold-changed",
          detail:
            "Generated scaffold files must retain their exact bytes, checksum, media type, and ownership.",
          file,
          summary: "A deterministic scaffold file was changed.",
        });
      }
      continue;
    }
    if (file.ownership === "ai-authored") {
      if (
        scaffoldFile.ownership === "generated" ||
        !extensionBoundaryPaths.has(file.path) ||
        !source.aiOwnedPaths.includes(file.path)
      ) {
        reject({
          code: "application.build.ai-source-ownership-overlap",
          detail:
            "AI-authored source may occupy only an exact non-generated extension boundary.",
          file,
          summary: "AI source overlaps an unauthorized or generated path.",
        });
      }
      continue;
    }
    const scaffoldContent =
      "content" in scaffoldFile ? scaffoldFile.content : undefined;
    if (
      scaffoldFile.ownership === "generated" ||
      file.checksum !== scaffoldFile.checksum ||
      file.mediaType !== scaffoldFile.mediaType ||
      (scaffoldContent !== undefined && file.content !== scaffoldContent)
    ) {
      reject({
        code: "application.build.user-owned-source-changed",
        detail:
          "User-owned source must retain its exact scaffold checksum and bytes and is never regenerated by this profile.",
        file,
        summary: "A user-owned source file was changed.",
      });
    }
  }

  const envelopeInputs = envelope.contract.sourceInputs
    .map(({ checksum, path }) => ({ checksum, path }))
    .sort((left, right) => compareUtf16(left.path, right.path));
  const finalInputs = files
    .map(({ checksum, path }) => ({ checksum, path }))
    .sort((left, right) => compareUtf16(left.path, right.path));
  if (!sameJson(envelopeInputs, finalInputs)) {
    reject({
      code: "application.build.ai-envelope-source-mismatch",
      detail:
        "The external build envelope source inputs must equal the final path and checksum inventory.",
      summary: "The build envelope does not bind the final source tree.",
    });
  }
  if (applicationBuildSourceTreeDigest(files) !== source.sourceTreeDigest) {
    reject({
      code: "application.build.source-tree-digest-mismatch",
      detail:
        "The AI source-tree digest does not match the exact path, checksum, media type, and ownership inventory.",
      summary: "The source tree digest does not match.",
    });
  }
  if (
    applicationAiCandidateBundleDigest({
      aiOwnedPaths: source.aiOwnedPaths,
      extensionId: source.extensionId,
      files,
    }) !== source.candidateBundleDigest
  ) {
    reject({
      code: "application.build.candidate-bundle-digest-mismatch",
      detail:
        "The candidate bundle digest does not bind the exact extension ID, owned paths, and AI-authored file inventory.",
      summary: "The AI candidate bundle digest does not match.",
    });
  }
  if (source.unresolvedBehaviorIds.length > 0) {
    reject({
      code: "application.build.unresolved-behavior",
      detail:
        "AI-assisted source cannot execute or complete while canonical behavior remains unresolved.",
      summary: "Unresolved behavior blocks the AI-assisted build.",
    });
  }
  if (
    !files.some((file) =>
      /^application\/tests\/.+\/unit\.test\.ts$/u.test(file.path),
    ) ||
    !files.some((file) =>
      /^application\/tests\/.+\/contracts\.test\.ts$/u.test(file.path),
    )
  ) {
    reject({
      code: "application.build.required-tests-missing",
      detail:
        "The final source tree must retain generated unit and contract tests derived from canonical contracts.",
      summary: "Required application tests are missing.",
    });
  }

  const prepared: PreparedBuild = {
    aiBinding: {
      candidateBundleDigest: source.candidateBundleDigest,
      extensionId: source.extensionId,
      sourceTreeDigest: source.sourceTreeDigest,
    },
    buildEnvelope: envelope,
    diagnostics,
    files,
    generationArtifactDigest: scaffold.artifactDigest,
    inputCoverage: "ai-assisted-custom-validated",
    sourceDigest: source.sourceTreeDigest,
    workloadId,
  };
  validatePackageAndLock(request, policy, prepared);
  return prepared;
}

function prepare(
  request: ApplicationBuildRequestV1,
  policy: ApplicationBuildPolicyV1,
): PreparedBuild {
  const diagnostics: ApplicationBuildDiagnosticV1[] = [];
  const revisionId = request.solutionRevision.solutionRevisionId;
  const revisionDigest = sha256Digest(canonicalJson(request.solutionRevision));
  if (revisionDigest !== request.solutionRevisionDigest) {
    diagnostics.push(
      diagnostic({
        code: "application.build.solution-revision-digest-mismatch",
        detail:
          "Solution Revision digest must hash its exact canonical manifest.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "The Solution Revision digest does not match.",
      }),
    );
  }
  if (!sameJson(request.profile, policy.profile)) {
    diagnostics.push(
      diagnostic({
        code: "application.build.profile-not-approved",
        detail:
          "The requested build profile is not the exact runner-approved profile.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "The build profile is not approved.",
      }),
    );
  }
  if (
    request.limits.cpuSeconds > policy.defaultLimits.cpuSeconds ||
    request.limits.memoryMiB > policy.defaultLimits.memoryMiB ||
    request.limits.maxFiles > policy.defaultLimits.maxFiles ||
    request.limits.maxFileBytes > policy.defaultLimits.maxFileBytes ||
    request.limits.maxTotalFileBytes > policy.defaultLimits.maxTotalFileBytes ||
    request.limits.maxOutputBytes > policy.defaultLimits.maxOutputBytes ||
    request.limits.maxProcesses > policy.defaultLimits.maxProcesses ||
    request.limits.maxArtifactBytes > policy.defaultLimits.maxArtifactBytes ||
    request.limits.wallTimeMilliseconds >
      policy.defaultLimits.wallTimeMilliseconds
  ) {
    diagnostics.push(
      diagnostic({
        code: "application.build.limits-not-approved",
        detail: "Requested limits cannot exceed the approved profile maxima.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "Requested build limits are not approved.",
      }),
    );
  }
  if (request.source.kind === "ai-assisted-custom") {
    return prepareAiAssisted(request, policy, diagnostics);
  }
  if (request.source.kind === "user-provided") {
    const files = [...request.source.files].sort((left, right) =>
      compareUtf16(left.path, right.path),
    );
    const workloadId =
      request.solutionRevision.generationCoverage.workloads[0]?.workloadId ??
      "workload_user_source";
    if (request.profile.sourcePolicy !== "user-provided-static-only") {
      diagnostics.push(
        diagnostic({
          code: "application.build.user-source-disabled",
          detail:
            "User-provided source requires the explicit static-only safe profile and cannot use generated-code execution authority.",
          solutionRevisionId: revisionId,
          source: "admission",
          summary: "User-provided source is disabled by this profile.",
          workloadId,
        }),
      );
    }
    if (
      applicationBuildSourceTreeDigest(files) !==
      request.source.sourceTreeDigest
    ) {
      diagnostics.push(
        diagnostic({
          code: "application.build.source-tree-digest-mismatch",
          detail:
            "User-provided source inventory digest does not match the exact path/checksum/ownership projection.",
          solutionRevisionId: revisionId,
          source: "admission",
          summary: "The source tree digest does not match.",
          workloadId,
        }),
      );
    }
    const prepared = {
      diagnostics,
      files,
      inputCoverage: "custom-implementation-required" as const,
      sourceDigest: request.source.sourceTreeDigest,
      workloadId,
    };
    validatePackageAndLock(request, policy, prepared);
    return prepared;
  }
  const generatedSource = request.source;
  const generation = generatedSource.applicationGeneration;
  const envelope = generation.artifact.buildContracts.find(
    (entry) => entry.contractDigest === generatedSource.buildContractDigest,
  );
  const workloadId =
    envelope?.contract.workloadId ?? "workload_missing_build_contract";
  if (request.profile.sourcePolicy !== "generated-only") {
    diagnostics.push(
      diagnostic({
        code: "application.build.generated-profile-required",
        detail:
          "Generated source requires the exact generated Node.js 24 build profile.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "The generated build profile is required.",
        workloadId,
      }),
    );
  }
  if (
    generation.artifact.solutionRevisionId !== revisionId ||
    generation.artifact.sourceManifest.solutionRevisionId !== revisionId
  ) {
    diagnostics.push(
      diagnostic({
        code: "application.build.revision-binding-mismatch",
        detail:
          "Application source and manifest must bind the exact Solution Revision.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "Application source binds a different revision.",
        workloadId,
      }),
    );
  }
  if (!approvedGeneratedDescriptor(generation.artifact)) {
    diagnostics.push(
      diagnostic({
        code: "application.build.generator-not-approved",
        detail:
          "Only an exact reviewed deterministic generator descriptor is approved by the generated build profile.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "The source generator is not approved.",
        workloadId,
      }),
    );
  }
  if (envelope === undefined) {
    diagnostics.push(
      diagnostic({
        code: "application.build.contract-not-found",
        detail:
          "The requested build contract digest is absent from the application source artifact.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "The build contract is missing.",
        workloadId,
      }),
    );
    const prepared = {
      diagnostics,
      files: [],
      generationArtifactDigest: generation.artifactDigest,
      inputCoverage: "custom-implementation-required" as const,
      sourceDigest: generation.artifactDigest,
      workloadId,
    };
    validatePackageAndLock(request, policy, prepared);
    return prepared;
  }
  if (!exactInitialRuntime(envelope)) {
    diagnostics.push(
      diagnostic({
        code: "application.build.runtime-not-approved",
        detail:
          "The build envelope does not match the exact reviewed Node.js 24/TypeScript/ESM runtime.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "The runtime is not approved.",
        workloadId,
      }),
    );
  }
  if (
    !new Set(["generated-starter", "complete-supported-pattern"]).has(
      envelope.contract.implementationMode,
    )
  ) {
    diagnostics.push(
      diagnostic({
        code: "application.build.mode-not-buildable",
        detail:
          "Only generated-starter and complete-supported-pattern envelopes are buildable.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "The workload mode is not buildable.",
        workloadId,
      }),
    );
  }
  if (
    generation.artifact.diagnostics.some((entry) => entry.severity === "error")
  ) {
    diagnostics.push(
      diagnostic({
        code: "application.build.generator-errors",
        detail:
          "Source with producer errors cannot enter the execution boundary.",
        solutionRevisionId: revisionId,
        source: "admission",
        summary: "The application generator reported errors.",
        workloadId,
      }),
    );
  }
  const files = generatedFiles(generation, envelope, diagnostics, revisionId);
  const coverageWorkload = generation.artifact.coverage.workloads.find(
    (entry) => entry.workloadId === workloadId,
  );
  const inputCoverage =
    coverageWorkload?.state === "complete-supported-pattern" ||
    (coverageWorkload?.state === "starter-application" &&
      envelope.contract.implementationMode === "complete-supported-pattern")
      ? "complete-supported-pattern"
      : coverageWorkload?.state === "starter-application"
        ? "starter-application"
        : "custom-implementation-required";
  const prepared: PreparedBuild = {
    buildEnvelope: envelope,
    diagnostics,
    files,
    generationArtifactDigest: generation.artifactDigest,
    inputCoverage,
    sourceDigest: generation.artifactDigest,
    workloadId,
  };
  validatePackageAndLock(request, policy, prepared);
  return prepared;
}

function validateSourceSecurity(
  request: ApplicationBuildRequestV1,
  prepared: PreparedBuild,
): void {
  let totalBytes = 0;
  const portable = new Set<string>();
  for (const file of prepared.files) {
    const bytes = utf8Bytes(file.content).byteLength;
    totalBytes += bytes;
    const issue = sourcePathIssue(file.path);
    const portablePath = file.path.normalize("NFC").toLowerCase();
    if (issue !== undefined || portable.has(portablePath)) {
      prepared.diagnostics.push(
        diagnostic({
          code: "application.build.source-path-unsafe",
          detail:
            issue ??
            "Source paths must be unique under portable normalization.",
          file,
          solutionRevisionId: request.solutionRevision.solutionRevisionId,
          source: "admission",
          summary: "The source tree contains an unsafe or duplicate path.",
          workloadId: prepared.workloadId,
        }),
      );
    }
    portable.add(portablePath);
    if (sha256Digest(file.content) !== file.checksum) {
      prepared.diagnostics.push(
        diagnostic({
          code: "application.build.source-checksum-mismatch",
          detail: "Source content does not match its declared checksum.",
          file,
          solutionRevisionId: request.solutionRevision.solutionRevisionId,
          source: "admission",
          summary: "A source checksum does not match.",
          workloadId: prepared.workloadId,
        }),
      );
    }
    const securityIssue = contentSecurityIssue(file.content);
    if (securityIssue !== undefined) {
      prepared.diagnostics.push(
        diagnostic({
          code:
            securityIssue === "secret"
              ? "application.build.secret-detected"
              : "application.build.local-path-detected",
          detail:
            securityIssue === "secret"
              ? "A secret-like value was detected and was not copied into diagnostics."
              : "A local machine path was detected and was not copied into diagnostics.",
          file,
          solutionRevisionId: request.solutionRevision.solutionRevisionId,
          source: "admission",
          summary:
            securityIssue === "secret"
              ? "Source contains a secret-like value."
              : "Source contains a local machine path.",
          workloadId: prepared.workloadId,
        }),
      );
    }
  }
  if (
    prepared.files.length > request.limits.maxFiles ||
    totalBytes > request.limits.maxTotalFileBytes ||
    prepared.files.some(
      (file) =>
        utf8Bytes(file.content).byteLength > request.limits.maxFileBytes,
    )
  ) {
    prepared.diagnostics.push(
      diagnostic({
        code: "application.build.source-limits-exceeded",
        detail:
          "Source exceeds an approved file-count, file-size, or total-size limit.",
        solutionRevisionId: request.solutionRevision.solutionRevisionId,
        source: "admission",
        summary: "Source limits are exceeded.",
        workloadId: prepared.workloadId,
      }),
    );
  }
}

function terminationState(
  result: ApplicationBuildCommandResult,
): ApplicationBuildResultV1["state"] {
  if (result.termination === "cancelled") return "cancelled";
  if (result.termination !== "completed") return "error";
  return result.exitCode === 0 ? "passed" : "failed";
}

function commandFailureDetail(
  invocation: ApplicationBuildCommandInvocation,
  result: ApplicationBuildCommandResult,
): string {
  if (result.termination === "completed") {
    return `The approved ${invocation.step} command exited with a non-zero status; raw tool output is not included.`;
  }
  return `The approved ${invocation.step} command ended with ${result.termination}.`;
}

function terminationDiagnostic(
  request: ApplicationBuildRequestV1,
  prepared: PreparedBuild,
  invocation: ApplicationBuildCommandInvocation,
  result: ApplicationBuildCommandResult,
): ApplicationBuildDiagnosticV1 | undefined {
  if (result.termination === "completed" && result.exitCode === 0)
    return undefined;
  const source = invocation.step;
  return diagnostic({
    code: `application.build.${invocation.step}-failed`,
    detail: commandFailureDetail(invocation, result),
    solutionRevisionId: request.solutionRevision.solutionRevisionId,
    source,
    summary: `Application ${invocation.step} did not pass.`,
    workloadId: prepared.workloadId,
  });
}

async function execute(
  request: ApplicationBuildRequestV1,
  prepared: PreparedBuild,
  executor: ApplicationBuildWorkspaceExecutor,
  signal: AbortSignal | undefined,
): Promise<ExecutedBuild> {
  const diagnostics: ApplicationBuildDiagnosticV1[] = [];
  const findings: ApplicationBuildFindingV1[] = [];
  const steps: ApplicationBuildStepSummaryV1[] = [];
  const tests: ApplicationBuildTestSummaryV1[] = [];
  const session = await executor.open({
    files: prepared.files,
    limits: request.limits,
    lock: request.dependencyLock,
  });
  let producedFiles: ExecutedBuild["producedFiles"] = [];
  let state: ApplicationBuildResultV1["state"] = "passed";
  try {
    const staticOnly =
      request.profile.sourcePolicy === "user-provided-static-only";
    const commands = staticOnly
      ? [
          APPROVED_APPLICATION_BUILD_COMMANDS.lint,
          APPROVED_APPLICATION_BUILD_COMMANDS.typecheck,
          APPROVED_APPLICATION_BUILD_COMMANDS.dependencyScan,
          APPROVED_APPLICATION_BUILD_COMMANDS.secretScan,
        ]
      : Object.values(APPROVED_APPLICATION_BUILD_COMMANDS);
    for (const invocation of commands) {
      if (signal?.aborted === true) {
        state = "cancelled";
        diagnostics.push(
          diagnostic({
            code: "application.build.cancelled",
            detail: "The build was cancelled.",
            solutionRevisionId: request.solutionRevision.solutionRevisionId,
            source: "runner",
            summary: "Application build was cancelled.",
            workloadId: prepared.workloadId,
          }),
        );
        break;
      }
      const result = await session.execute(invocation, signal);
      steps.push(commandSummary(invocation, result));
      if (
        invocation.step === "unit-tests" ||
        invocation.step === "contract-tests"
      ) {
        const summary = parseTestSummary(
          invocation.step === "unit-tests" ? "unit" : "contract",
          result,
        );
        tests.push(summary);
        if (
          result.termination === "completed" &&
          result.exitCode === 0 &&
          (summary.state !== "passed" || summary.passed === 0)
        ) {
          state = "error";
          diagnostics.push(
            diagnostic({
              code: "application.build.test-summary-malformed",
              detail:
                "A successful generated test command must return bounded JSON with at least one passing test.",
              solutionRevisionId: request.solutionRevision.solutionRevisionId,
              source: invocation.step,
              summary: "Generated test results are malformed or empty.",
              workloadId: prepared.workloadId,
            }),
          );
          break;
        }
      }
      if (
        invocation.step === "dependency-scan" ||
        invocation.step === "secret-scan"
      ) {
        const parsedFindings = parseTrivyFindings(
          invocation.step === "dependency-scan" ? "dependency" : "secret",
          result.stdout,
        );
        if (parsedFindings === undefined) {
          state = "error";
          diagnostics.push(
            diagnostic({
              code: "application.build.scan-results-malformed",
              detail:
                "A successful scanner command must return bounded Trivy JSON results.",
              solutionRevisionId: request.solutionRevision.solutionRevisionId,
              source: invocation.step,
              summary: "Application scanner results are malformed.",
              workloadId: prepared.workloadId,
            }),
          );
          break;
        }
        findings.push(...parsedFindings);
      }
      const failure = terminationDiagnostic(
        request,
        prepared,
        invocation,
        result,
      );
      if (failure !== undefined) diagnostics.push(failure);
      const nextState = terminationState(result);
      if (nextState !== "passed") {
        state = nextState;
        break;
      }
    }
    if (
      state === "passed" &&
      findings.some(
        (finding) =>
          finding.source === "secret" ||
          finding.severity === "critical" ||
          finding.severity === "high",
      )
    ) {
      state = "failed";
      diagnostics.push(
        diagnostic({
          code: "application.build.security-findings",
          detail:
            "One or more redacted high-severity dependency or secret findings block packaging.",
          solutionRevisionId: request.solutionRevision.solutionRevisionId,
          source: "runner",
          summary: "Security findings block the build.",
          workloadId: prepared.workloadId,
        }),
      );
    }
    if (state === "passed" && !staticOnly)
      producedFiles = await session.readProducedFiles();
    if (staticOnly && state === "passed") state = "blocked";
  } catch {
    state = "error";
    diagnostics.push(
      diagnostic({
        code: "application.build.runner-error",
        detail:
          "The isolated build executor failed without exposing internal paths or logs.",
        solutionRevisionId: request.solutionRevision.solutionRevisionId,
        source: "runner",
        summary: "The isolated build runner failed.",
        workloadId: prepared.workloadId,
      }),
    );
  } finally {
    try {
      await session.dispose();
    } catch {
      state = "error";
      diagnostics.push(
        diagnostic({
          code: "application.build.cleanup-error",
          detail:
            "The isolated build workspace could not be verified as disposed.",
          solutionRevisionId: request.solutionRevision.solutionRevisionId,
          source: "runner",
          summary: "Build workspace cleanup failed.",
          workloadId: prepared.workloadId,
        }),
      );
    }
  }
  return { diagnostics, findings, producedFiles, state, steps, tests };
}

function cyclonedxSbom(
  request: ApplicationBuildRequestV1,
  prepared: PreparedBuild,
): Uint8Array {
  const components = request.dependencyLock.packages
    .map((entry) => ({
      hashes: [{ alg: "SHA-256", content: entry.tarballDigest.slice(7) }],
      name: entry.name,
      properties: [
        { name: "cloudmarkup:dependency-kind", value: entry.kind },
        { name: "cloudmarkup:registry-integrity", value: entry.integrity },
      ],
      purl: `pkg:npm/${encodeURIComponent(entry.name)}@${entry.version}`,
      type: "library",
      version: entry.version,
    }))
    .sort((left, right) => compareUtf16(left.purl, right.purl));
  return utf8Bytes(
    canonicalJson({
      bomFormat: "CycloneDX",
      components,
      metadata: {
        component: {
          name: prepared.workloadId,
          properties: [
            {
              name: "cloudmarkup:solution-revision",
              value: request.solutionRevision.solutionRevisionId,
            },
            {
              name: "cloudmarkup:dependency-lock",
              value: lockDigest(request.dependencyLock),
            },
          ],
          type: "application",
          version: "1",
        },
        tools: [
          {
            name: "cloudmarkup-application-builder",
            vendor: "CloudMarkup",
            version: "1.0.0",
          },
        ],
      },
      specVersion: "1.6",
      version: 1,
    }),
  );
}

function runtimePackageLocation(
  path: string,
):
  | { readonly name: string; readonly root: string; readonly suffix: string }
  | undefined {
  const parts = path.split("/");
  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0) return undefined;
  const first = parts[nodeModulesIndex + 1];
  if (first === undefined) return undefined;
  const scoped = first.startsWith("@");
  const second = scoped ? parts[nodeModulesIndex + 2] : undefined;
  if (scoped && second === undefined) return undefined;
  const packageEnd = nodeModulesIndex + (scoped ? 3 : 2);
  const suffix = parts.slice(packageEnd).join("/");
  if (suffix.length === 0) return undefined;
  return {
    name: scoped ? `${first}/${second ?? ""}` : first,
    root: parts.slice(0, packageEnd).join("/"),
    suffix,
  };
}

function packageOutputs(
  request: ApplicationBuildRequestV1,
  prepared: PreparedBuild,
  produced: ExecutedBuild["producedFiles"],
): {
  readonly artifacts: ApplicationBuildArtifactFileV1[];
  readonly reproducible: boolean;
  readonly diagnostics: ApplicationBuildDiagnosticV1[];
} {
  const envelope = prepared.buildEnvelope;
  if (
    envelope === undefined ||
    prepared.generationArtifactDigest === undefined ||
    request.source.kind === "user-provided"
  )
    return { artifacts: [], diagnostics: [], reproducible: false };
  const aiAssisted = request.source.kind === "ai-assisted-custom";
  const diagnostics: ApplicationBuildDiagnosticV1[] = [];
  const producedByPath = new Map<string, Uint8Array>();
  const portableOutputPaths = new Set<string>();
  const totalProducedBytes = produced.reduce(
    (total, file) => total + file.bytes.byteLength,
    0,
  );
  if (
    produced.length > request.limits.maxFiles ||
    totalProducedBytes > request.limits.maxTotalFileBytes
  ) {
    diagnostics.push(
      diagnostic({
        code: "application.build.output-limits-exceeded",
        detail: "Produced files exceed the approved count or total-byte limit.",
        solutionRevisionId: request.solutionRevision.solutionRevisionId,
        source: "package",
        summary: "Build output limits are exceeded.",
        workloadId: prepared.workloadId,
      }),
    );
  }
  for (const file of produced) {
    const portablePath = file.path.normalize("NFC").toLowerCase();
    if (
      file.kind !== "regular-file" ||
      outputPathIssue(file.path) !== undefined ||
      producedByPath.has(file.path) ||
      portableOutputPaths.has(portablePath)
    ) {
      diagnostics.push(
        diagnostic({
          code: "application.build.output-file-unsafe",
          detail: "Build output must contain only unique safe regular files.",
          solutionRevisionId: request.solutionRevision.solutionRevisionId,
          source: "package",
          summary: "The build output contains an unsafe file.",
          workloadId: prepared.workloadId,
        }),
      );
      continue;
    }
    if (file.bytes.byteLength > request.limits.maxFileBytes) {
      diagnostics.push(
        diagnostic({
          code: "application.build.output-limits-exceeded",
          detail: "A produced file exceeds the approved file-size limit.",
          solutionRevisionId: request.solutionRevision.solutionRevisionId,
          source: "package",
          summary: "Build output limits are exceeded.",
          workloadId: prepared.workloadId,
        }),
      );
      continue;
    }
    producedByPath.set(file.path, file.bytes);
    portableOutputPaths.add(portablePath);
  }
  const compiledRoot = envelope.contract.compiledEntrypoint.slice(
    0,
    envelope.contract.compiledEntrypoint.lastIndexOf("/") + 1,
  );
  const sourceRoot = envelope.contract.entrypoint.slice(
    0,
    envelope.contract.entrypoint.lastIndexOf("/") + 1,
  );
  const entries: ApplicationZipEntry[] = [];
  for (const source of prepared.files) {
    const deployableOwnership =
      source.ownership === "generated" ||
      (aiAssisted && source.ownership === "ai-authored");
    if (
      !deployableOwnership ||
      !source.path.startsWith(sourceRoot) ||
      !source.path.endsWith(".ts") ||
      (!aiAssisted && source.path.includes("/extensions/"))
    )
      continue;
    const relative = source.path
      .slice(sourceRoot.length)
      .replace(/\.ts$/u, ".js");
    const outputPath = `${compiledRoot}${relative}`;
    const bytes = producedByPath.get(outputPath);
    if (bytes === undefined) {
      diagnostics.push(
        diagnostic({
          code: "application.build.compiled-output-missing",
          detail:
            "Every generated runtime TypeScript file must produce the exact expected JavaScript path.",
          solutionRevisionId: request.solutionRevision.solutionRevisionId,
          source: "package",
          summary: "A compiled runtime file is missing.",
          workloadId: prepared.workloadId,
        }),
      );
      continue;
    }
    entries.push({ bytes, path: relative });
  }
  const runtimeDependencies = envelope.contract.dependencies.filter(
    (entry) => entry.kind === "runtime",
  );
  const lockedRuntime = new Map(
    request.dependencyLock.packages
      .filter(
        (entry) =>
          entry.kind === "runtime" || entry.kind === "transitive-runtime",
      )
      .map((entry) => [`${entry.name}\0${entry.version}`, entry]),
  );
  const runtimeFiles = [...producedByPath].filter(([path]) =>
    path.startsWith("application/node_modules/"),
  );
  const packageRoots = new Map<string, string>();
  const invalidRuntimePaths = new Set<string>();
  for (const [path] of runtimeFiles) {
    const location = runtimePackageLocation(path);
    const suffixSegments = location?.suffix.toLowerCase().split("/") ?? [];
    if (
      location === undefined ||
      location.name.startsWith(".") ||
      /\.(?:map|ts)$/iu.test(location.suffix) ||
      suffixSegments.some(
        (segment) =>
          segment.startsWith(".") ||
          new Set(["__tests__", "test", "tests"]).has(segment),
      )
    ) {
      invalidRuntimePaths.add(path);
      continue;
    }
    packageRoots.set(location.root, location.name);
  }
  const seenRuntime = new Set<string>();
  for (const [root, expectedName] of packageRoots) {
    const manifest = producedByPath.get(`${root}/package.json`);
    let identity: string | undefined;
    if (manifest !== undefined) {
      try {
        const parsed = JSON.parse(Buffer.from(manifest).toString("utf8")) as {
          readonly name?: unknown;
          readonly version?: unknown;
        };
        if (
          parsed.name === expectedName &&
          typeof parsed.version === "string"
        ) {
          identity = `${expectedName}\0${parsed.version}`;
        }
      } catch {
        identity = undefined;
      }
    }
    if (identity === undefined || !lockedRuntime.has(identity)) {
      invalidRuntimePaths.add(root);
    } else {
      seenRuntime.add(identity);
    }
  }
  if (
    invalidRuntimePaths.size > 0 ||
    seenRuntime.size !== lockedRuntime.size ||
    [...lockedRuntime].some(([identity]) => !seenRuntime.has(identity))
  ) {
    diagnostics.push(
      diagnostic({
        code: "application.build.runtime-dependency-output-unsafe",
        detail:
          "Packaged dependencies must be the complete regular production-only runtime/transitive-runtime lock inventory.",
        solutionRevisionId: request.solutionRevision.solutionRevisionId,
        source: "package",
        summary:
          "Runtime dependency output is not the exact production closure.",
        workloadId: prepared.workloadId,
      }),
    );
  }
  for (const [path, bytes] of producedByPath) {
    if (!path.startsWith("application/node_modules/")) continue;
    if (invalidRuntimePaths.has(path)) continue;
    const location = runtimePackageLocation(path);
    if (location === undefined || invalidRuntimePaths.has(location.root))
      continue;
    entries.push({ bytes, path: path.slice("application/".length) });
  }
  for (const dependency of runtimeDependencies) {
    const packagePath = `node_modules/${dependency.name}/package.json`;
    if (!entries.some((entry) => entry.path === packagePath)) {
      diagnostics.push(
        diagnostic({
          code: "application.build.runtime-dependency-missing",
          detail:
            "Every direct runtime dependency must be present in the deployment tree with package metadata.",
          solutionRevisionId: request.solutionRevision.solutionRevisionId,
          source: "package",
          summary: "A runtime dependency is missing from the package.",
          workloadId: prepared.workloadId,
        }),
      );
    }
  }
  entries.push({
    bytes: utf8Bytes(
      canonicalJson({
        dependencies: Object.fromEntries(
          runtimeDependencies
            .map((entry) => [entry.name, entry.version] as const)
            .sort(([left], [right]) => compareUtf16(left, right)),
        ),
        engines: { node: ">=24.0.0 <25" },
        private: true,
        type: "module",
      }),
    ),
    path: "package.json",
  });
  if (diagnostics.some((entry) => entry.severity === "error"))
    return { artifacts: [], diagnostics, reproducible: false };
  const first = createDeterministicLambdaZip(entries);
  const second = createDeterministicLambdaZip([...entries].reverse());
  const reproducible = Buffer.from(first).equals(Buffer.from(second));
  if (!reproducible || first.byteLength > request.limits.maxArtifactBytes) {
    diagnostics.push(
      diagnostic({
        code: "application.build.package-not-reproducible",
        detail: reproducible
          ? "Lambda ZIP exceeds the approved artifact-size limit."
          : "Independent deterministic ZIP assembly produced different bytes.",
        solutionRevisionId: request.solutionRevision.solutionRevisionId,
        source: "reproducibility",
        summary: reproducible
          ? "The Lambda artifact is too large."
          : "The Lambda package is not reproducible.",
        workloadId: prepared.workloadId,
      }),
    );
    return { artifacts: [], diagnostics, reproducible: false };
  }
  const dependencyLockDigest = lockDigest(request.dependencyLock);
  const provenance = {
    ...(prepared.aiBinding === undefined
      ? {}
      : {
          aiExtensionId: prepared.aiBinding.extensionId,
          candidateBundleDigest: prepared.aiBinding.candidateBundleDigest,
          sourceTreeDigest: prepared.aiBinding.sourceTreeDigest,
        }),
    buildRequestDigest: applicationBuildRequestDigest(request),
    buildContractDigest: envelope.contractDigest,
    dependencyLockDigest,
    generationArtifactDigest: prepared.generationArtifactDigest,
    solutionRevisionDigest: request.solutionRevisionDigest,
    sourceChecksums: prepared.files
      .map((file) => file.checksum)
      .sort(compareUtf16),
    workloadId: prepared.workloadId,
  };
  const sbom = cyclonedxSbom(request, prepared);
  const zipChecksum = sha256Digest(first);
  const artifactManifestContract =
    applicationLambdaArtifactManifestV1Schema.parse({
      artifact: {
        artifactId: envelope.contract.expectedArtifact.artifactId,
        archiveEntrypoint: envelope.contract.expectedArtifact.archiveEntrypoint,
        checksum: zipChecksum,
        digestAlgorithm: envelope.contract.expectedArtifact.digestAlgorithm,
        handler: envelope.contract.expectedArtifact.handler,
        kind: envelope.contract.expectedArtifact.kind,
        mediaType: envelope.contract.expectedArtifact.mediaType,
        path: envelope.contract.expectedArtifact.path,
      },
      bindings: {
        buildContractDigest: envelope.contractDigest,
        buildRequestDigest: applicationBuildRequestDigest(request),
        generationArtifactDigest: prepared.generationArtifactDigest,
        solutionRevisionDigest: request.solutionRevisionDigest,
        solutionRevisionId: request.solutionRevision.solutionRevisionId,
        workloadId: prepared.workloadId,
      },
      compiledEntrypoint: envelope.contract.compiledEntrypoint,
      contractVersion: 1,
      entrypoint: envelope.contract.entrypoint,
      kind: "cloudmarkup.lambda-artifact-manifest",
      runtime: envelope.contract.runtime,
    });
  const artifactManifest = utf8Bytes(canonicalJson(artifactManifestContract));
  const evidenceRoot = envelope.contract.expectedArtifact.path
    .replace("application/artifacts/", "application/evidence/")
    .replace(/\/function\.zip$/u, "");
  const artifactManifestPath = envelope.contract.expectedArtifact.path.replace(
    /\/function\.zip$/u,
    "/artifact-manifest.json",
  ) as ApplicationBuildArtifactFileV1["path"];
  return {
    artifacts: [
      {
        bytesBase64: encodeBase64(first),
        checksum: zipChecksum,
        mediaType: "application/zip",
        ownership: aiAssisted
          ? "ai-assisted-build-artifact"
          : "generated-build-artifact",
        path: envelope.contract.expectedArtifact.path,
        provenance,
        sizeBytes: first.byteLength,
      },
      {
        bytesBase64: encodeBase64(artifactManifest),
        checksum: sha256Digest(artifactManifest),
        mediaType: "application/json",
        ownership: aiAssisted
          ? "ai-assisted-build-artifact"
          : "generated-build-artifact",
        path: artifactManifestPath,
        provenance,
        sizeBytes: artifactManifest.byteLength,
      },
      {
        bytesBase64: encodeBase64(sbom),
        checksum: sha256Digest(sbom),
        mediaType: "application/vnd.cyclonedx+json",
        ownership: aiAssisted
          ? "ai-assisted-build-artifact"
          : "generated-build-artifact",
        path: `${evidenceRoot}/sbom.cdx.json` as ApplicationBuildArtifactFileV1["path"],
        provenance,
        sizeBytes: sbom.byteLength,
      },
    ],
    diagnostics,
    reproducible,
  };
}

function evidence(
  request: ApplicationBuildRequestV1,
  policy: ApplicationBuildPolicyV1,
  prepared: PreparedBuild,
  artifacts: readonly ApplicationBuildArtifactFileV1[],
  diagnostics: readonly ApplicationBuildDiagnosticV1[],
  steps: readonly ApplicationBuildStepSummaryV1[],
  reproducible: boolean,
  state: ApplicationBuildResultV1["state"],
): EvidenceRecordV1 {
  const passed = state === "passed";
  const artifactsContent = artifacts.map(
    ({ checksum, mediaType, sizeBytes }) => ({
      digest: checksum,
      mediaType,
      sizeBytes,
    }),
  );
  const check = (
    id: string,
    ok: boolean,
    requirement: "application-build-and-tests" | "application-security-checks",
    summary: string,
  ) => {
    const status = ok
      ? ("passed" as const)
      : state === "error" || state === "cancelled"
        ? ("error" as const)
        : state === "blocked"
          ? ("skipped" as const)
          : ("failed" as const);
    return {
      artifactDigests: artifacts.map((artifact) => artifact.checksum),
      checkId: id,
      generationCoverageRequirement: requirement,
      issueIds: diagnostics
        .filter((entry) => entry.severity !== "info")
        .map((entry) => entry.code)
        .sort(compareUtf16),
      ...(status === "failed" || status === "error"
        ? { redactedFailure: "The bounded application check did not pass." }
        : {}),
      status,
      summary,
    };
  };
  const securityPassed =
    passed &&
    !diagnostics.some(
      (entry) =>
        entry.source === "secret-scan" || entry.source === "dependency-scan",
    );
  const inputDigests = [
    ...new Set([
      applicationBuildRequestDigest(request),
      request.solutionRevisionDigest,
      prepared.sourceDigest,
      ...(prepared.generationArtifactDigest === undefined
        ? []
        : [prepared.generationArtifactDigest]),
      ...(prepared.aiBinding === undefined
        ? []
        : [prepared.aiBinding.candidateBundleDigest]),
      lockDigest(request.dependencyLock),
      request.profile.digest,
      policy.container.digest,
    ]),
  ].sort(compareUtf16);
  const evidenceSeed = sha256Digest(
    canonicalJson({
      artifacts: artifacts.map((entry) => entry.checksum),
      inputDigests,
      state,
      steps,
    }),
  );
  return evidenceRecordV1Schema.parse({
    artifacts: artifactsContent,
    checks: [
      check(
        "cloudmarkup.evidence.application-build-and-tests",
        passed && reproducible,
        "application-build-and-tests",
        passed
          ? "Pinned install, lint, type-check, generated unit and contract tests, compilation, production dependency pruning, packaging, and reproduction passed."
          : "Application build and test checks did not establish a deployable artifact.",
      ),
      check(
        "cloudmarkup.evidence.application-security-checks",
        securityPassed,
        "application-security-checks",
        securityPassed
          ? "Offline dependency and secret scans passed without blocking findings."
          : "Application security checks did not establish a clean artifact.",
      ),
    ],
    ...(request.ciIdentity === undefined
      ? {}
      : { ciIdentity: request.ciIdentity }),
    contractVersion: 1,
    environment: request.environment,
    id: `evidence_application_build_${evidenceSeed.slice(7, 31)}`,
    layer: "generated",
    level: { kind: "application-build-and-tests", rank: 5 },
    models: [],
    provenance: {
      actor: { kind: "deterministic-tool", tool: policy.builder },
      createdAt: request.assessedAt,
      inputDigests,
    },
    solutionRevisionId: request.solutionRevision.solutionRevisionId,
    staleness: { assessedAt: request.assessedAt, state: "current" },
    tools: [
      policy.builder,
      ...policy.toolchain,
      policy.scanner,
      policy.secretScanner,
    ]
      .filter(
        (tool, index, values) =>
          values.findIndex((candidate) => candidate.id === tool.id) === index,
      )
      .sort((left, right) => compareUtf16(String(left.id), String(right.id))),
  });
}

function finalize(
  request: ApplicationBuildRequestV1,
  policy: ApplicationBuildPolicyV1,
  prepared: PreparedBuild,
  executed: ExecutedBuild,
): ApplicationBuildResultV1 {
  const packaged =
    executed.state === "passed"
      ? packageOutputs(request, prepared, executed.producedFiles)
      : { artifacts: [], diagnostics: [], reproducible: false };
  const diagnostics = sortedDiagnostics([
    ...prepared.diagnostics,
    ...executed.diagnostics,
    ...packaged.diagnostics,
  ]);
  const state =
    diagnostics.some((entry) => entry.severity === "error") &&
    executed.state === "passed"
      ? "failed"
      : executed.state;
  const passed =
    state === "passed" &&
    packaged.reproducible &&
    packaged.artifacts.some((entry) => entry.mediaType === "application/zip");
  const evidenceRecord = evidence(
    request,
    policy,
    prepared,
    packaged.artifacts,
    diagnostics,
    executed.steps,
    packaged.reproducible,
    passed ? "passed" : state,
  );
  const confirmedState = passed
    ? prepared.inputCoverage
    : "custom-implementation-required";
  const coverage = {
    ...(prepared.aiBinding === undefined
      ? {}
      : {
          aiExtensionId: prepared.aiBinding.extensionId,
          candidateBundleDigest: prepared.aiBinding.candidateBundleDigest,
          sourceTreeDigest: prepared.aiBinding.sourceTreeDigest,
        }),
    buildRequestDigest: applicationBuildRequestDigest(request),
    confirmedState,
    ...(passed
      ? { evidenceId: evidenceRecord.id }
      : {
          downgradeReason:
            request.profile.sourcePolicy === "user-provided-static-only"
              ? "User-provided source was admitted only for static validation; execution and packaging remained disabled."
              : "Build, tests, security checks, packaging, or reproducibility did not pass.",
        }),
    ...(prepared.generationArtifactDigest === undefined
      ? {}
      : {
          generationArtifactDigest: prepared.generationArtifactDigest,
        }),
    inputState: prepared.inputCoverage,
    solutionRevisionDigest: request.solutionRevisionDigest,
    solutionRevisionId: request.solutionRevision.solutionRevisionId,
    workloadId: prepared.workloadId,
  } as const;
  const projection = {
    artifacts: packaged.artifacts,
    contractVersion: 1 as const,
    coverage,
    diagnostics,
    evidence: evidenceRecord,
    findings: executed.findings,
    state: passed ? ("passed" as const) : state,
    steps: executed.steps,
    tests: executed.tests,
  };
  return applicationBuildResultV1Schema.parse({
    ...projection,
    reportDigest: sha256Digest(canonicalJson(projection)),
  });
}

function blockedExecution(): ExecutedBuild {
  return {
    diagnostics: [],
    findings: [],
    producedFiles: [],
    state: "blocked",
    steps: [],
    tests: [],
  };
}

export function createApplicationBuildRunner(input: {
  readonly executor: ApplicationBuildWorkspaceExecutor;
  readonly policy: ApplicationBuildPolicyV1;
}): ApplicationBuildRunner {
  const policy = applicationBuildPolicyV1Schema.parse(input.policy);
  return {
    async run(raw, options) {
      const request = applicationBuildRequestV1Schema.parse(raw);
      const prepared = prepare(request, policy);
      validateSourceSecurity(request, prepared);
      if (prepared.diagnostics.some((entry) => entry.severity === "error")) {
        return finalize(request, policy, prepared, blockedExecution());
      }
      const executed = await execute(
        request,
        prepared,
        input.executor,
        options?.signal,
      );
      return finalize(request, policy, prepared, executed);
    },
  };
}
