import {
  applicationAiCandidateBundleDigest,
  applicationBuildLimitsV1Schema,
  applicationBuildProfileV1Schema,
  applicationBuildRequestDigest,
  applicationBuildRequestV1Schema,
  applicationBuildResultV1Schema,
  applicationBuildSourceFileV1Schema,
  applicationBuildSourceTreeDigest,
  applicationDependencyLockV1Schema,
  canonicalJson as applicationCanonicalJson,
  sha256Digest as applicationSha256Digest,
  type ApplicationBuildLimitsV1,
  type ApplicationBuildProfileV1,
  type ApplicationBuildRequestV1,
  type ApplicationBuildResultV1,
  type ApplicationBuildRunner,
  type ApplicationBuildSourceFileV1,
  type ApplicationDependencyLockV1,
} from "@cloudmarkup/application-build-runner";
import {
  applicationGenerationResultV1Schema,
  asyncJobEnvironmentV1Schema,
  evidenceRecordV1Schema,
  modelCandidateBundleV1Schema,
  modelGenerationContextV1Schema,
  modelInvocationDescriptorV1Schema,
  prompt32ABuildArtifactEnvelopeV1Schema,
  solutionRevisionManifestV1Schema,
  workloadV2Schema,
  type ApplicationGenerationResultV1,
  type EvidenceRecordV1,
  type Prompt32ABuildArtifactEnvelopeV1,
  type WorkloadV2,
} from "@cloudmarkup/schemas";

import { getCandidateArtifactDigest } from "./artifact-store.js";
import {
  candidateDiagnosticV1Schema,
  type CandidateDiagnosticV1,
} from "./contracts.js";
import {
  digestCanonicalValue,
  sameStringSet,
  sha256Text,
  stableRecordId,
} from "./security.js";
import {
  candidateTargetValidationResultV1Schema,
  type CandidateTargetValidationInput,
  type CandidateTargetValidationPort,
  type CandidateValidationOutcomeV1,
} from "./validation.js";

export interface ApplicationCandidateValidatorConfigurationV1 {
  readonly buildEnvelope: Prompt32ABuildArtifactEnvelopeV1;
  readonly ciIdentity?: string;
  readonly dependencyLock: ApplicationDependencyLockV1;
  readonly deterministicScaffold: ApplicationGenerationResultV1;
  readonly environment: ApplicationBuildRequestV1["environment"];
  readonly limits: ApplicationBuildLimitsV1;
  readonly profile: ApplicationBuildProfileV1;
  readonly runner: ApplicationBuildRunner;
  readonly workload: WorkloadV2;
}

type ApplicationGenerationContext = Extract<
  CandidateTargetValidationInput["generationContext"],
  { kind: "application" }
>;

const requiredRunnerValidationKinds = [
  "parse",
  "static-analysis",
  "build",
  "unit-test",
  "contract-test",
  "security",
] as const;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sanitizedText(value: string, maximum: number): string {
  let withoutControls = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    withoutControls +=
      codePoint <= 31 || (codePoint >= 127 && codePoint <= 159)
        ? " "
        : character;
  }
  const sanitized = withoutControls
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
  return sanitized.length === 0
    ? "A bounded application validation check failed."
    : sanitized;
}

function diagnostic(input: {
  readonly category: CandidateDiagnosticV1["category"];
  readonly code: string;
  readonly detail: string;
  readonly path?: string;
  readonly repairable: boolean;
  readonly severity?: CandidateDiagnosticV1["severity"];
  readonly summary: string;
}): CandidateDiagnosticV1 {
  return candidateDiagnosticV1Schema.parse({
    category: input.category,
    checkId: `cloudmarkup.ai-extension.application-${input.category}`,
    code: input.code,
    ...(input.path === undefined ? {} : { path: input.path }),
    repairable: input.repairable,
    severity: input.severity ?? "error",
    summary: sanitizedText(input.summary, 500),
    technicalDetail: sanitizedText(input.detail, 2_000),
  });
}

function authorityDiagnostic(detail: string): CandidateDiagnosticV1 {
  return diagnostic({
    category: "provenance",
    code: "cloudmarkup.ai-extension.application-authority-mismatch",
    detail,
    repairable: false,
    summary: "Application candidate authority does not match.",
  });
}

function contentMediaType(
  value: string,
): ApplicationBuildSourceFileV1["mediaType"] {
  return applicationBuildSourceFileV1Schema.shape.mediaType.parse(value);
}

function exactApplicationAuthority(input: {
  readonly configuration: Readonly<{
    buildEnvelope: Prompt32ABuildArtifactEnvelopeV1;
    deterministicScaffold: ApplicationGenerationResultV1;
    workload: WorkloadV2;
  }>;
  readonly context: ApplicationGenerationContext;
  readonly validationInput: CandidateTargetValidationInput;
}): CandidateDiagnosticV1[] {
  const { buildEnvelope, deterministicScaffold, workload } =
    input.configuration;
  const { artifact, bundle, descriptor, files, solutionRevision } =
    input.validationInput;
  const context = input.context;
  const diagnostics: CandidateDiagnosticV1[] = [];
  const mismatch = (detail: string) =>
    diagnostics.push(authorityDiagnostic(detail));

  if (
    context.extensionId !== artifact.extensionId ||
    artifact.solutionRevisionId !== solutionRevision.solutionRevisionId ||
    deterministicScaffold.artifact.solutionRevisionId !==
      solutionRevision.solutionRevisionId ||
    deterministicScaffold.artifact.sourceManifest.solutionRevisionId !==
      solutionRevision.solutionRevisionId
  ) {
    mismatch(
      "The extension, candidate artifact, deterministic scaffold, and immutable Solution Revision must use one exact identity.",
    );
  }

  if (
    workload.id !== context.workloadId ||
    workload.implementation.mode !== "ai-assisted-custom" ||
    String(workload.implementation.extension.extensionId) !==
      context.extensionId ||
    workload.implementation.runtimeFamily !== context.runtimeFamily ||
    workload.languageFamily !== context.language ||
    buildEnvelope.contract.workloadId !== context.workloadId ||
    buildEnvelope.contract.implementationMode !== "ai-assisted-custom" ||
    buildEnvelope.contract.runtime.runtimeFamily !== context.runtimeFamily ||
    buildEnvelope.contract.runtime.languageFamily !== context.language
  ) {
    mismatch(
      "The generation context must match the exact canonical AI-assisted Workload, runtime, language, extension, and reviewed build envelope.",
    );
  }

  const namedExtensionPoint = workload.extensionPoints.find(
    ({ extensionPointId }) => extensionPointId === context.extensionPointId,
  );
  for (const path of context.ownedPaths) {
    const point = workload.extensionPoints.find(
      (entry) =>
        entry.path === path &&
        (entry.permittedOwnership.includes("ai-authored") ||
          entry.permittedOwnership.includes("approved-extension") ||
          entry.permittedOwnership.includes("user-owned")),
    );
    const scaffoldFile = deterministicScaffold.artifact.sourceFiles.find(
      (file) => file.path === path,
    );
    if (
      point === undefined ||
      scaffoldFile === undefined ||
      scaffoldFile.ownership === "generated" ||
      !scaffoldFile.provenance.workloadIds.includes(context.workloadId) ||
      !scaffoldFile.provenance.extensionPointIds.includes(
        point.extensionPointId,
      )
    ) {
      mismatch(
        "Every candidate path must be an exact non-generated deterministic scaffold extension boundary owned by the canonical Workload.",
      );
      break;
    }
  }
  if (
    namedExtensionPoint === undefined ||
    !context.ownedPaths.includes(namedExtensionPoint.path)
  ) {
    mismatch(
      "The generation context names an unknown or unowned Workload extension point.",
    );
  }

  if (
    !sameStringSet(
      context.ownedPaths,
      files.map(({ path }) => path),
    ) ||
    !sameStringSet(
      context.ownedPaths,
      artifact.files.map(({ path }) => path),
    ) ||
    !sameStringSet(context.ownedPaths, bundle.boundary.ownedPaths) ||
    !sameStringSet(
      context.ownedPaths,
      bundle.candidates.map(({ path }) => path),
    )
  ) {
    mismatch(
      "Generation context, model boundary, candidate files, and stored artifact must bind the same exact owned paths.",
    );
  }

  const candidatesByPath = new Map(
    bundle.candidates.map((candidate) => [candidate.path, candidate]),
  );
  const existingByPath = new Map(
    context.existingFiles.map((file) => [file.path, file]),
  );
  const workloadOwnershipByPath = new Map<
    string,
    (typeof workload.sourceOwnership)[number]
  >(workload.sourceOwnership.map((entry) => [entry.path, entry]));
  const revisionOwnershipByPath = new Map<
    string,
    (typeof solutionRevision.sourceOwnership)[number]
  >(solutionRevision.sourceOwnership.map((entry) => [entry.path, entry]));
  for (const file of files) {
    const reference = artifact.files.find(({ path }) => path === file.path);
    const candidate = candidatesByPath.get(file.path);
    const existing = existingByPath.get(file.path);
    const workloadOwnership = workloadOwnershipByPath.get(file.path);
    const revisionOwnership = revisionOwnershipByPath.get(file.path);
    const point = workload.extensionPoints.find(
      (entry) => entry.path === file.path,
    );
    const scaffoldFile = deterministicScaffold.artifact.sourceFiles.find(
      (entry) => entry.path === file.path,
    );
    const candidateResultMatches =
      candidate !== undefined &&
      ((candidate.kind === "file" &&
        file.sourceKind === "file" &&
        candidate.content === file.content &&
        candidate.contentDigest === file.digest &&
        sha256Text(candidate.content) === candidate.contentDigest) ||
        (candidate.kind === "patch" &&
          file.sourceKind === "patch" &&
          candidate.proposedResultDigest === file.digest));
    const preservedUserOwnedPatch =
      file.ownership === "user-owned-preserved" &&
      candidate?.kind === "patch" &&
      existing?.ownership === "user-owned" &&
      existing.contentDigest === candidate.baseDigest &&
      existing.contentDigest === sha256Text(existing.content) &&
      existing.sizeBytes ===
        new TextEncoder().encode(existing.content).byteLength &&
      workloadOwnership?.ownership === "user-owned" &&
      workloadOwnership.regeneration === "never" &&
      workloadOwnership.conflictBehavior === "preserve-user-content" &&
      revisionOwnership?.ownership === "user-owned" &&
      revisionOwnership.ownerId === workloadOwnership.ownerId &&
      revisionOwnership.conflictBehavior === "preserve-user-content" &&
      revisionOwnership.contentHash === existing.contentDigest &&
      point?.permittedOwnership.includes("user-owned") === true &&
      scaffoldFile?.ownership === "user-owned" &&
      scaffoldFile.checksum === existing.contentDigest &&
      "content" in scaffoldFile &&
      scaffoldFile.content === existing.content;
    if (preservedUserOwnedPatch) {
      diagnostics.push(
        diagnostic({
          category: "target-readiness",
          code: "cloudmarkup.ai-extension.application-ownership-transition-required",
          detail:
            "A model-authored change cannot execute or package bytes for a canonical user-owned file until a reviewed operation explicitly transitions its ownership.",
          path: file.path,
          repairable: false,
          summary: "User-owned source needs a reviewed ownership transition.",
        }),
      );
    }
    if (
      (file.ownership !== "ai-authored-candidate" &&
        !preservedUserOwnedPatch) ||
      !candidateResultMatches ||
      sha256Text(file.content) !== file.digest ||
      new TextEncoder().encode(file.content).byteLength !== file.sizeBytes ||
      reference?.digest !== file.digest ||
      reference.sizeBytes !== file.sizeBytes ||
      reference.sourceKind !== file.sourceKind ||
      reference.ownership !== file.ownership
    ) {
      mismatch(
        "Stored candidate references must bind exact materialized bytes, model result metadata, and any digest-bound user-owned patch lineage.",
      );
      break;
    }
  }

  const exactModelBundleDigest = digestCanonicalValue(bundle);
  if (
    artifact.bundleDigest !== exactModelBundleDigest ||
    getCandidateArtifactDigest({
      bundleDigest: artifact.bundleDigest,
      extensionId: artifact.extensionId,
      files,
      scope: artifact.scope,
      solutionRevisionId: artifact.solutionRevisionId,
      targetKind: "application",
    }) !== artifact.artifactDigest
  ) {
    mismatch(
      "The stored artifact digest must bind the exact structured model bundle and materialized application files.",
    );
  }

  if (
    context.allowedProviders.length !== 0 ||
    context.allowedResources.length !== 0
  ) {
    mismatch(
      "Application candidate authority cannot include infrastructure providers or resources.",
    );
  }
  const allowedDependencies = new Set(
    context.allowedDependencies.map(
      ({ kind, name, requestedVersion }) =>
        `${kind}\u0000${name}\u0000${requestedVersion}`,
    ),
  );
  for (const dependency of buildEnvelope.contract.dependencies) {
    if (
      !allowedDependencies.has(
        `package\u0000${dependency.name}\u0000${dependency.version}`,
      )
    ) {
      diagnostics.push(
        diagnostic({
          category: "dependency",
          code: "cloudmarkup.ai-extension.application-dependency-ungrounded",
          detail:
            "Every reviewed build dependency must be present in the exact generation-context package allowlist.",
          repairable: false,
          summary: "Application build dependency is outside model authority.",
        }),
      );
      break;
    }
  }
  for (const dependency of bundle.dependencies) {
    if (
      !buildEnvelope.contract.dependencies.some(
        (allowed) =>
          allowed.name === dependency.name &&
          allowed.version === dependency.requestedVersion,
      )
    ) {
      diagnostics.push(
        diagnostic({
          category: "dependency",
          code: "cloudmarkup.ai-extension.application-dependency-shadowing",
          detail:
            "AI application candidates cannot replace or extend the deterministic package manifest through free-form output.",
          repairable: true,
          summary:
            "Candidate requested a dependency outside the deterministic build envelope.",
        }),
      );
      break;
    }
  }

  const requiredKinds = new Set(
    context.validationExpectations
      .filter(({ required }) => required)
      .map(({ kind }) => kind),
  );
  if (requiredRunnerValidationKinds.some((kind) => !requiredKinds.has(kind))) {
    mismatch(
      "Application generation authority must require parse, static, build, unit, contract, and security validation.",
    );
  }
  const compatible = workload.compatibility.modelGateways.some(
    (entry) =>
      entry.promptTemplateId === descriptor.promptTemplateId &&
      entry.promptVersion === descriptor.promptVersion &&
      entry.promptDigest === descriptor.promptDigest &&
      (descriptor.routing === undefined ||
        entry.modelFamily === descriptor.routing.modelFamily) &&
      [...requiredKinds].every((kind) =>
        entry.requiredValidation.includes(kind),
      ),
  );
  if (!compatible) {
    mismatch(
      "The canonical Workload does not authorize the exact model prompt and required validation set.",
    );
  }

  return diagnostics;
}

function createBuildFiles(input: {
  readonly context: ApplicationGenerationContext;
  readonly files: CandidateTargetValidationInput["files"];
  readonly scaffold: ApplicationGenerationResultV1;
}): ApplicationBuildSourceFileV1[] {
  const candidateByPath = new Map(input.files.map((file) => [file.path, file]));
  const scaffoldFiles = input.scaffold.artifact.sourceFiles.filter((file) =>
    file.provenance.workloadIds.includes(input.context.workloadId),
  );
  return scaffoldFiles
    .map((file): ApplicationBuildSourceFileV1 => {
      const candidate = candidateByPath.get(file.path);
      if (candidate !== undefined) {
        return applicationBuildSourceFileV1Schema.parse({
          checksum: candidate.digest,
          content: candidate.content,
          mediaType: contentMediaType(file.mediaType),
          ownership:
            candidate.ownership === "user-owned-preserved"
              ? "user-owned"
              : "ai-authored",
          path: file.path,
        });
      }
      if (!("content" in file) || typeof file.content !== "string") {
        throw new Error(
          "The deterministic scaffold omitted required source bytes.",
        );
      }
      return applicationBuildSourceFileV1Schema.parse({
        checksum: file.checksum,
        content: file.content,
        mediaType: contentMediaType(file.mediaType),
        ownership: file.ownership === "generated" ? "generated" : "user-owned",
        path: file.path,
      });
    })
    .sort((left, right) => compareText(left.path, right.path));
}

function createBuildRequest(input: {
  readonly assessedAt: string;
  readonly configuration: Readonly<{
    buildEnvelope: Prompt32ABuildArtifactEnvelopeV1;
    ciIdentity?: string;
    dependencyLock: ApplicationDependencyLockV1;
    deterministicScaffold: ApplicationGenerationResultV1;
    environment: ApplicationBuildRequestV1["environment"];
    limits: ApplicationBuildLimitsV1;
    profile: ApplicationBuildProfileV1;
    workload: WorkloadV2;
  }>;
  readonly context: ApplicationGenerationContext;
  readonly files: CandidateTargetValidationInput["files"];
  readonly solutionRevision: CandidateTargetValidationInput["solutionRevision"];
}): ApplicationBuildRequestV1 {
  const files = createBuildFiles({
    context: input.context,
    files: input.files,
    scaffold: input.configuration.deterministicScaffold,
  });
  const contract = {
    ...input.configuration.buildEnvelope.contract,
    sourceInputs: files.map(({ checksum, path }) => ({ checksum, path })),
  };
  const buildEnvelope = prompt32ABuildArtifactEnvelopeV1Schema.parse({
    contract,
    contractDigest: applicationSha256Digest(applicationCanonicalJson(contract)),
  });
  const aiOwnedPaths = files
    .filter(({ ownership }) => ownership === "ai-authored")
    .map(({ path }) => path)
    .sort(compareText);
  const sourceTreeDigest = applicationBuildSourceTreeDigest(files);
  const candidateBundleDigest = applicationAiCandidateBundleDigest({
    aiOwnedPaths,
    extensionId: input.context.extensionId,
    files,
  });
  return applicationBuildRequestV1Schema.parse({
    assessedAt: input.assessedAt,
    ...(input.configuration.ciIdentity === undefined
      ? {}
      : { ciIdentity: input.configuration.ciIdentity }),
    contractVersion: 1,
    dependencyLock: input.configuration.dependencyLock,
    environment: input.configuration.environment,
    limits: input.configuration.limits,
    profile: input.configuration.profile,
    solutionRevision: input.solutionRevision,
    solutionRevisionDigest: applicationSha256Digest(
      applicationCanonicalJson(input.solutionRevision),
    ),
    source: {
      aiOwnedPaths,
      buildEnvelope,
      candidateBundleDigest,
      deterministicScaffold: input.configuration.deterministicScaffold,
      extensionId: input.context.extensionId,
      files,
      kind: "ai-assisted-custom",
      sourceTreeDigest,
      unresolvedBehaviorIds: [
        ...new Set([
          ...input.configuration.workload.unresolvedRequirementIds,
          ...input.configuration.workload.implementationRequirements
            .filter(({ blocking }) => blocking)
            .map(({ implementationRequirementId }) =>
              String(implementationRequirementId),
            ),
        ]),
      ],
    },
  });
}

function diagnosticCategory(
  source: ApplicationBuildResultV1["diagnostics"][number]["source"],
  code: string,
): CandidateDiagnosticV1["category"] {
  if (/ownership|extension|revision|provenance|digest-mismatch/iu.test(code)) {
    return "provenance";
  }
  if (/dependency|package|install/iu.test(code) && source === "admission") {
    return "dependency";
  }
  switch (source) {
    case "admission":
      return "parse";
    case "lint":
      return "format";
    case "typecheck":
      return "static-analysis";
    case "unit-tests":
      return "unit-test";
    case "contract-tests":
      return "contract-test";
    case "dependency-scan":
    case "secret-scan":
      return "security";
    case "install":
    case "production-prune":
    case "compile":
    case "package":
    case "reproducibility":
    case "runner":
      return "build";
  }
}

function mappedRunnerDiagnostics(
  result: ApplicationBuildResultV1,
  ownedPaths: readonly string[],
): CandidateDiagnosticV1[] {
  const owned = new Set(ownedPaths);
  const diagnostics = result.diagnostics.map((entry) => {
    const path = entry.references.path;
    return diagnostic({
      category: diagnosticCategory(entry.source, entry.code),
      code: entry.code,
      detail: `The approved isolated application ${entry.source} check reported ${entry.code}; raw runner output remains excluded.`,
      ...(path === undefined ? {} : { path }),
      repairable:
        path !== undefined &&
        owned.has(path) &&
        entry.source !== "dependency-scan" &&
        entry.source !== "secret-scan",
      severity: entry.severity === "info" ? "information" : entry.severity,
      summary: entry.summary,
    });
  });
  diagnostics.push(
    ...result.findings.map((finding) =>
      diagnostic({
        category: "security",
        code: finding.findingId,
        detail:
          finding.source === "secret"
            ? "The bounded secret scanner reported a redacted candidate finding."
            : "The bounded dependency scanner reported a reviewed package finding.",
        ...(finding.path === undefined ? {} : { path: finding.path }),
        repairable: finding.path !== undefined && owned.has(finding.path),
        severity:
          finding.severity === "critical" || finding.severity === "high"
            ? "error"
            : finding.severity === "medium"
              ? "warning"
              : "information",
        summary: finding.summary,
      }),
    ),
  );
  return diagnostics;
}

function stepOutcome(
  result: ApplicationBuildResultV1,
  step: ApplicationBuildResultV1["steps"][number]["step"],
): CandidateValidationOutcomeV1["result"] {
  const state = result.steps.find((entry) => entry.step === step)?.state;
  if (state === "passed") return "passed";
  if (state === "failed" || state === "timeout" || state === "output-limit") {
    return "failed";
  }
  if (state === "unavailable") return "error";
  return "not-run";
}

function buildOutcomes(
  result: ApplicationBuildResultV1,
  profileVersion: string,
): CandidateValidationOutcomeV1[] {
  const admissionFailed = result.diagnostics.some(
    ({ severity, source }) => severity === "error" && source === "admission",
  );
  const securityFailed = result.diagnostics.some(
    ({ severity, source }) =>
      severity === "error" &&
      (source === "dependency-scan" || source === "secret-scan"),
  );
  const securityNotRun =
    stepOutcome(result, "dependency-scan") === "not-run" ||
    stepOutcome(result, "secret-scan") === "not-run";
  return [
    {
      kind: "parse",
      result: admissionFailed ? "failed" : "passed",
      toolVersion: profileVersion,
    },
    {
      kind: "format",
      result: stepOutcome(result, "lint"),
      toolVersion: profileVersion,
    },
    {
      kind: "static-analysis",
      result: admissionFailed ? "failed" : stepOutcome(result, "typecheck"),
      toolVersion: profileVersion,
    },
    {
      kind: "build",
      result:
        stepOutcome(result, "compile") === "passed" &&
        stepOutcome(result, "install") === "passed"
          ? "passed"
          : stepOutcome(result, "compile"),
      toolVersion: profileVersion,
    },
    {
      kind: "unit-test",
      result: stepOutcome(result, "unit-tests"),
      toolVersion: profileVersion,
    },
    {
      kind: "contract-test",
      result: stepOutcome(result, "contract-tests"),
      toolVersion: profileVersion,
    },
    {
      kind: "integration-test",
      result: "not-run",
      toolVersion: profileVersion,
    },
    {
      kind: "security",
      result: securityFailed ? "failed" : securityNotRun ? "not-run" : "passed",
      toolVersion: profileVersion,
    },
  ];
}

function runnerEvidenceBinds(input: {
  readonly buildRequest: ApplicationBuildRequestV1;
  readonly result: ApplicationBuildResultV1;
}): boolean {
  const source = input.buildRequest.source;
  if (source.kind !== "ai-assisted-custom") return false;
  const requestDigest = applicationBuildRequestDigest(input.buildRequest);
  const revisionDigest = input.buildRequest.solutionRevisionDigest;
  const requiredDigests = [
    requestDigest,
    revisionDigest,
    source.candidateBundleDigest,
    source.sourceTreeDigest,
    source.deterministicScaffold.artifactDigest,
  ];
  const coverage = input.result.coverage;
  const evidence = input.result.evidence;
  const requiredCoverage = [
    "application-build-and-tests",
    "application-security-checks",
  ] as const;
  return (
    evidence.level.kind === "application-build-and-tests" &&
    requiredCoverage.every(
      (requirement) =>
        evidence.checks.filter(
          (check) => check.generationCoverageRequirement === requirement,
        ).length === 1,
    ) &&
    evidence.solutionRevisionId ===
      input.buildRequest.solutionRevision.solutionRevisionId &&
    evidence.staleness.state === "current" &&
    requiredDigests.every((digest) =>
      evidence.provenance.inputDigests.includes(digest),
    ) &&
    coverage.buildRequestDigest === requestDigest &&
    coverage.solutionRevisionDigest === revisionDigest &&
    coverage.solutionRevisionId ===
      input.buildRequest.solutionRevision.solutionRevisionId &&
    coverage.workloadId === source.buildEnvelope.contract.workloadId &&
    coverage.aiExtensionId === source.extensionId &&
    coverage.candidateBundleDigest === source.candidateBundleDigest &&
    coverage.sourceTreeDigest === source.sourceTreeDigest &&
    coverage.generationArtifactDigest ===
      source.deterministicScaffold.artifactDigest &&
    input.result.artifacts.every(
      (artifact) =>
        artifact.provenance.buildRequestDigest === requestDigest &&
        artifact.provenance.solutionRevisionDigest === revisionDigest &&
        artifact.provenance.workloadId ===
          source.buildEnvelope.contract.workloadId &&
        artifact.provenance.aiExtensionId === source.extensionId &&
        artifact.provenance.candidateBundleDigest ===
          source.candidateBundleDigest &&
        artifact.provenance.sourceTreeDigest === source.sourceTreeDigest &&
        artifact.provenance.generationArtifactDigest ===
          source.deterministicScaffold.artifactDigest,
    )
  );
}

function exactCandidateBuildEvidence(input: {
  readonly buildRequest: ApplicationBuildRequestV1;
  readonly candidateInput: CandidateTargetValidationInput;
  readonly result: ApplicationBuildResultV1;
}): EvidenceRecordV1 {
  const runnerEvidence = input.result.evidence;
  const runnerEvidenceDigest = digestCanonicalValue(runnerEvidence);
  const contextDigest = digestCanonicalValue(
    input.candidateInput.generationContext,
  );
  const inputDigests = [
    ...new Set([
      ...runnerEvidence.provenance.inputDigests,
      input.candidateInput.artifact.artifactDigest,
      input.candidateInput.artifact.bundleDigest,
      contextDigest,
      runnerEvidenceDigest,
      input.buildRequest.source.kind === "ai-assisted-custom"
        ? input.buildRequest.source.buildEnvelope.contractDigest
        : input.candidateInput.artifact.artifactDigest,
    ]),
  ].sort(compareText);
  const candidateArtifact = {
    digest: input.candidateInput.artifact.artifactDigest,
    mediaType: "application/vnd.cloudmarkup.ai-extension-candidate.v1+json",
    sizeBytes: input.candidateInput.artifact.files.reduce(
      (sum, file) => sum + file.sizeBytes,
      0,
    ),
  };
  const artifacts = [
    ...runnerEvidence.artifacts.filter(
      ({ digest }) => digest !== candidateArtifact.digest,
    ),
    candidateArtifact,
  ];
  const evidenceId = stableRecordId("evidence-application-candidate", {
    artifactDigest: input.candidateInput.artifact.artifactDigest,
    buildRequestDigest: applicationBuildRequestDigest(input.buildRequest),
    runnerEvidenceDigest,
  });
  return evidenceRecordV1Schema.parse({
    ...runnerEvidence,
    artifacts,
    checks: runnerEvidence.checks.map((check) => ({
      ...check,
      artifactDigests: [
        ...new Set([
          ...check.artifactDigests,
          input.candidateInput.artifact.artifactDigest,
        ]),
      ].sort(compareText),
    })),
    id: evidenceId,
    models: [
      {
        modelId: input.candidateInput.descriptor.modelId,
        modelVersion: input.candidateInput.descriptor.modelVersion,
        promptVersion: input.candidateInput.descriptor.promptVersion,
        providerId: input.candidateInput.descriptor.providerId,
      },
    ],
    provenance: {
      ...runnerEvidence.provenance,
      inputDigests,
    },
  });
}

function errorOutcomes(profileVersion: string): CandidateValidationOutcomeV1[] {
  return [
    "parse",
    "format",
    "static-analysis",
    "build",
    "unit-test",
    "contract-test",
    "integration-test",
    "security",
  ].map((kind) => ({
    kind: kind as CandidateValidationOutcomeV1["kind"],
    result: kind === "parse" ? "error" : "not-run",
    toolVersion: profileVersion,
  }));
}

export function createApplicationCandidateValidator(
  rawConfiguration: ApplicationCandidateValidatorConfigurationV1,
): CandidateTargetValidationPort {
  const configuration = Object.freeze({
    buildEnvelope: prompt32ABuildArtifactEnvelopeV1Schema.parse(
      rawConfiguration.buildEnvelope,
    ),
    ...(rawConfiguration.ciIdentity === undefined
      ? {}
      : { ciIdentity: rawConfiguration.ciIdentity }),
    dependencyLock: applicationDependencyLockV1Schema.parse(
      rawConfiguration.dependencyLock,
    ),
    deterministicScaffold: applicationGenerationResultV1Schema.parse(
      rawConfiguration.deterministicScaffold,
    ),
    environment: asyncJobEnvironmentV1Schema.parse(
      rawConfiguration.environment,
    ),
    limits: applicationBuildLimitsV1Schema.parse(rawConfiguration.limits),
    profile: applicationBuildProfileV1Schema.parse(rawConfiguration.profile),
    runner: rawConfiguration.runner,
    workload: workloadV2Schema.parse(rawConfiguration.workload),
  });
  if (
    configuration.profile.id !==
      "cloudmarkup.application-build.ai-assisted-custom-nodejs24" ||
    configuration.profile.sourcePolicy !== "ai-assisted-custom-only"
  ) {
    throw new Error(
      "Application candidate validation requires the exact AI-assisted build profile.",
    );
  }

  return Object.freeze({
    async validate(
      validationInput: CandidateTargetValidationInput,
      signal?: AbortSignal,
    ) {
      let context: ApplicationGenerationContext | undefined;
      try {
        const parsedContext = modelGenerationContextV1Schema.parse(
          validationInput.generationContext,
        );
        if (parsedContext.kind !== "application") {
          throw new Error(
            "Application candidate validator received a non-application context.",
          );
        }
        context = parsedContext;
        const parsedInput: CandidateTargetValidationInput = {
          artifact: validationInput.artifact,
          assessedAt: validationInput.assessedAt,
          bundle: modelCandidateBundleV1Schema.parse(validationInput.bundle),
          descriptor: modelInvocationDescriptorV1Schema.parse(
            validationInput.descriptor,
          ),
          files: validationInput.files,
          generationContext: parsedContext,
          solutionRevision: solutionRevisionManifestV1Schema.parse(
            validationInput.solutionRevision,
          ),
        };
        const authorityDiagnostics = exactApplicationAuthority({
          configuration,
          context,
          validationInput: parsedInput,
        });
        if (authorityDiagnostics.some(({ severity }) => severity === "error")) {
          return candidateTargetValidationResultV1Schema.parse({
            diagnostics: authorityDiagnostics,
            evidence: [],
            outcomes: errorOutcomes(configuration.profile.version),
            representationDigest: digestCanonicalValue({
              artifactDigest: validationInput.artifact.artifactDigest,
              authority: "rejected",
            }),
            state: "failed",
          });
        }

        const buildRequest = createBuildRequest({
          assessedAt: parsedInput.assessedAt,
          configuration,
          context,
          files: parsedInput.files,
          solutionRevision: parsedInput.solutionRevision,
        });
        let rawResult: ApplicationBuildResultV1;
        try {
          rawResult = await configuration.runner.run(
            buildRequest,
            signal === undefined ? undefined : { signal },
          );
        } catch {
          const diagnostics = [
            diagnostic({
              category: "build",
              code: "cloudmarkup.ai-extension.application-runner-error",
              detail:
                "The approved isolated application build runner returned an error without exposing raw runner output.",
              repairable: false,
              summary: "Application build runner failed.",
            }),
          ];
          return candidateTargetValidationResultV1Schema.parse({
            diagnostics,
            evidence: [],
            outcomes: errorOutcomes(configuration.profile.version),
            representationDigest: digestCanonicalValue({
              buildRequestDigest: applicationBuildRequestDigest(buildRequest),
              runner: "error",
            }),
            state: "error",
          });
        }

        let result: ApplicationBuildResultV1;
        try {
          result = applicationBuildResultV1Schema.parse(rawResult);
        } catch {
          const diagnostics = [
            diagnostic({
              category: "provenance",
              code: "cloudmarkup.ai-extension.application-result-invalid",
              detail:
                "The application runner result failed its strict schema or self-contained digest validation.",
              repairable: false,
              summary: "Application build result is invalid.",
            }),
          ];
          return candidateTargetValidationResultV1Schema.parse({
            diagnostics,
            evidence: [],
            outcomes: errorOutcomes(configuration.profile.version),
            representationDigest: digestCanonicalValue({
              buildRequestDigest: applicationBuildRequestDigest(buildRequest),
              runner: "invalid-result",
            }),
            state: "error",
          });
        }

        const diagnostics = mappedRunnerDiagnostics(result, context.ownedPaths);
        const outcomes = buildOutcomes(result, configuration.profile.version);
        const evidenceBound = runnerEvidenceBinds({ buildRequest, result });
        if (!evidenceBound) {
          diagnostics.push(
            diagnostic({
              category: "provenance",
              code: "cloudmarkup.ai-extension.application-evidence-mismatch",
              detail:
                "Rank-5 Evidence must bind the exact build request, Solution Revision, model candidate source, deterministic scaffold, and every returned build artifact.",
              repairable: false,
              summary:
                "Application Evidence is not grounded in this candidate.",
            }),
          );
        }
        if (
          result.state !== "passed" &&
          !diagnostics.some(({ severity }) => severity === "error")
        ) {
          diagnostics.push(
            diagnostic({
              category: "build",
              code: "cloudmarkup.ai-extension.application-validation-incomplete",
              detail:
                "The isolated application run did not pass every build, test, security, and reproducibility check.",
              repairable: false,
              summary: "Application candidate validation did not pass.",
            }),
          );
        }
        const requiredOutcomesPassed = context.validationExpectations
          .filter(({ required }) => required)
          .every(
            ({ kind }) =>
              outcomes.find((outcome) => outcome.kind === kind)?.result ===
              "passed",
          );
        if (
          !requiredOutcomesPassed &&
          !diagnostics.some(({ severity }) => severity === "error")
        ) {
          diagnostics.push(
            diagnostic({
              category: "target-readiness",
              code: "cloudmarkup.ai-extension.application-required-check-incomplete",
              detail:
                "At least one required application validation outcome failed, errored, or was not run.",
              repairable: false,
              summary: "A required application validation check is incomplete.",
            }),
          );
        }
        const state =
          result.state === "passed" &&
          evidenceBound &&
          requiredOutcomesPassed &&
          diagnostics.every(({ severity }) => severity !== "error")
            ? "passed"
            : result.state === "error"
              ? "error"
              : "failed";
        return candidateTargetValidationResultV1Schema.parse({
          diagnostics,
          evidence: evidenceBound
            ? [
                exactCandidateBuildEvidence({
                  buildRequest,
                  candidateInput: parsedInput,
                  result,
                }),
              ]
            : [],
          outcomes,
          representationDigest: digestCanonicalValue({
            buildReportDigest: result.reportDigest,
            buildRequestDigest: applicationBuildRequestDigest(buildRequest),
            candidateArtifactDigest: parsedInput.artifact.artifactDigest,
            sourceTreeDigest:
              buildRequest.source.kind === "ai-assisted-custom"
                ? buildRequest.source.sourceTreeDigest
                : parsedInput.artifact.artifactDigest,
          }),
          state,
        });
      } catch {
        const diagnostics = [
          authorityDiagnostic(
            "Application candidate admission failed closed before isolated build execution.",
          ),
        ];
        return candidateTargetValidationResultV1Schema.parse({
          diagnostics,
          evidence: [],
          outcomes: errorOutcomes(configuration.profile.version),
          representationDigest: digestCanonicalValue({
            artifactDigest: validationInput.artifact.artifactDigest,
            contextKind: context?.kind ?? "invalid",
          }),
          state: "failed",
        });
      }
    },
  });
}
