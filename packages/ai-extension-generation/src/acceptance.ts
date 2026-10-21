import {
  aiAuthoredExtensionV1Schema,
  evidenceCollectionV1Schema,
  solutionRevisionIdSchema,
  solutionSourceOwnershipV1Schema,
  solutionRevisionManifestV1Schema,
  utcTimestampSchema,
  type AiAuthoredExtensionV1,
  type EvidenceRecordV1,
  type GenerationCoverageEvidenceV1,
  type Sha256Digest,
  type SolutionGenerationCoverageV1,
  type SolutionRevisionManifestV1,
} from "@cloudmarkup/schemas";
import {
  getEvidenceRecordContentHash,
  validateSolutionRevisionManifestIntrinsicV1,
  validateSolutionRevisionManifestWithEvidenceV1,
} from "@cloudmarkup/domain";

import {
  requireCandidateReviewAuthorizationProof,
  type CandidateReviewAuthorizationPort,
} from "./authorization.js";
import {
  candidateAcceptanceResultV1Schema,
  candidateDecisionV1Schema,
  candidateExportInputV1Schema,
  candidateReviewRecordV1Schema,
  getCandidateExportInputId,
  getCandidateReviewDigest,
  hasExactCandidateAttemptReplayAuthority,
  type CandidateAcceptanceResultV1,
  type CandidateDecisionV1,
  type CandidateReviewRecordV1,
} from "./contracts.js";
import {
  assertCandidateArtifactSupersession,
  getCandidateArtifactDigest,
  type CandidateArtifactStore,
  type StoredCandidateArtifactV1,
} from "./artifact-store.js";
import {
  digestCanonicalValue,
  sha256Text,
  stableRecordId,
} from "./security.js";

const requiredStaticEvidence = {
  kind: "ai-extension-parse-static-validity",
  rank: 4,
  requirements: ["ai-extension-parse-static-validity"],
} as const;
const requiredApplicationEvidence = {
  kind: "application-build-and-tests",
  rank: 5,
  requirements: ["application-build-and-tests", "application-security-checks"],
} as const;

function requiredEvidenceLevels(extension: AiAuthoredExtensionV1) {
  return extension.target.kind === "application"
    ? [requiredStaticEvidence, requiredApplicationEvidence]
    : [requiredStaticEvidence];
}

function expectedTargetKind(extension: AiAuthoredExtensionV1) {
  return extension.target.kind === "application"
    ? "application"
    : extension.target.targetFormat;
}

function storedFileInventory(
  files: readonly {
    readonly digest: Sha256Digest;
    readonly ownership: "ai-authored-candidate" | "user-owned-preserved";
    readonly path: string;
    readonly sizeBytes: number;
    readonly sourceKind: "file" | "patch";
  }[],
) {
  return files.map((file) => ({
    digest: file.digest,
    ownership: file.ownership,
    path: file.path,
    sizeBytes: file.sizeBytes,
    sourceKind: file.sourceKind,
  }));
}

function exactSourceEvidence(input: {
  readonly evidence: unknown;
  readonly revision: SolutionRevisionManifestV1;
}) {
  const evidence = evidenceCollectionV1Schema.parse(input.evidence);
  const expectedIds = [...input.revision.evidenceIdsAtFreeze].sort();
  const suppliedIds = evidence.records.map(({ id }) => id).sort();
  if (digestCanonicalValue(expectedIds) !== digestCanonicalValue(suppliedIds)) {
    throw new Error(
      "Candidate acceptance requires the exact source revision Evidence freeze.",
    );
  }
  validateSolutionRevisionManifestWithEvidenceV1(input.revision, evidence);
  return evidence;
}

function combineEvidenceRecords(
  left: readonly EvidenceRecordV1[],
  right: readonly EvidenceRecordV1[],
): EvidenceRecordV1[] {
  const records = new Map<string, EvidenceRecordV1>();
  for (const record of [...left, ...right]) {
    const existing = records.get(record.id);
    if (
      existing !== undefined &&
      digestCanonicalValue(existing) !== digestCanonicalValue(record)
    ) {
      throw new Error(
        "Candidate acceptance found a conflicting Evidence identity.",
      );
    }
    records.set(record.id, record);
  }
  return [...records.values()].sort((leftRecord, rightRecord) =>
    leftRecord.id < rightRecord.id
      ? -1
      : leftRecord.id > rightRecord.id
        ? 1
        : 0,
  );
}

function rebaseEvidenceRecords(input: {
  readonly acceptedAt: string;
  readonly acceptedBy: string;
  readonly artifactDigest: Sha256Digest;
  readonly records: readonly EvidenceRecordV1[];
  readonly sourceSolutionRevisionDigest: Sha256Digest;
  readonly successorSolutionRevisionId: string;
}) {
  const sourceToSuccessorId = new Map<string, EvidenceRecordV1["id"]>();
  const records = input.records.map((record) => {
    const sourceRecordDigest = getEvidenceRecordContentHash(record);
    const id = stableRecordId("evidence-successor", {
      acceptedAt: input.acceptedAt,
      acceptedBy: input.acceptedBy,
      sourceEvidenceId: record.id,
      sourceRecordDigest,
      successorSolutionRevisionId: input.successorSolutionRevisionId,
    });
    const parsed = evidenceCollectionV1Schema.parse({
      contractVersion: 1,
      records: [
        {
          ...record,
          id,
          provenance: {
            actor: {
              kind: "deterministic-tool",
              tool: {
                id: "cloudmarkup.ai-extension-generation",
                version: "1.1.0",
              },
            },
            createdAt: input.acceptedAt,
            inputDigests: [
              sourceRecordDigest,
              input.artifactDigest,
              input.sourceSolutionRevisionDigest,
            ],
          },
          solutionRevisionId: input.successorSolutionRevisionId,
          staleness: {
            assessedAt: input.acceptedAt,
            state: "current",
          },
          tools: [
            {
              id: "cloudmarkup.ai-extension-generation",
              version: "1.1.0",
            },
            ...record.tools,
          ]
            .filter(
              (tool, index, tools) =>
                tools.findIndex(
                  (candidate) =>
                    candidate.id === tool.id &&
                    candidate.version === tool.version,
                ) === index,
            )
            .slice(0, 64),
        },
      ],
    }).records[0];
    if (parsed === undefined) {
      throw new Error("Successor Evidence could not be created.");
    }
    sourceToSuccessorId.set(record.id, parsed.id);
    return parsed;
  });
  return {
    evidence: evidenceCollectionV1Schema.parse({
      contractVersion: 1,
      records,
    }),
    sourceToSuccessorId,
  };
}

function remapCoverageEntries(
  entries: readonly GenerationCoverageEvidenceV1[],
  sourceToSuccessorId: ReadonlyMap<string, EvidenceRecordV1["id"]>,
) {
  return entries.map((entry) => {
    const evidenceId = sourceToSuccessorId.get(entry.evidenceId);
    if (evidenceId === undefined) {
      throw new Error(
        "Candidate acceptance cannot rebase missing coverage Evidence.",
      );
    }
    return { evidenceId, requirement: entry.requirement };
  });
}

function coverageEntries(
  records: readonly EvidenceRecordV1[],
): GenerationCoverageEvidenceV1[] {
  const entries = records.flatMap((record) =>
    record.checks.flatMap((check) =>
      check.status === "passed" &&
      check.generationCoverageRequirement !== undefined
        ? [
            {
              evidenceId: record.id,
              requirement: check.generationCoverageRequirement,
            },
          ]
        : [],
    ),
  );
  const byRequirement = new Map(
    entries.map((entry) => [entry.requirement, entry]),
  );
  return [...byRequirement.values()].sort((left, right) =>
    left.requirement < right.requirement
      ? -1
      : left.requirement > right.requirement
        ? 1
        : 0,
  );
}

function mergeCoverageEntries(
  current: readonly GenerationCoverageEvidenceV1[],
  added: readonly GenerationCoverageEvidenceV1[],
) {
  const byRequirement = new Map(
    current.map((entry) => [entry.requirement, entry]),
  );
  for (const entry of added) byRequirement.set(entry.requirement, entry);
  return [...byRequirement.values()].sort((left, right) =>
    left.requirement < right.requirement
      ? -1
      : left.requirement > right.requirement
        ? 1
        : 0,
  );
}

function successorCoverage(input: {
  readonly acceptedEvidence: readonly EvidenceRecordV1[];
  readonly extension: AiAuthoredExtensionV1;
  readonly source: SolutionGenerationCoverageV1;
  readonly sourceToSuccessorId: ReadonlyMap<string, EvidenceRecordV1["id"]>;
  readonly successorSolutionRevisionId: string;
}) {
  const accepted = coverageEntries(input.acceptedEvidence);
  const evidence = mergeCoverageEntries(
    remapCoverageEntries(input.source.evidence, input.sourceToSuccessorId),
    accepted,
  );
  const satisfied = new Set(evidence.map(({ requirement }) => requirement));
  const missingRequirements = input.source.missingRequirements.filter(
    (requirement) => !satisfied.has(requirement),
  );
  const requiredApplication = [
    "structural-validity",
    "provider-architecture-validity",
    "ai-extension-parse-static-validity",
    "application-build-and-tests",
    "application-security-checks",
  ] as const;
  const workloads = input.source.workloads.map((workload) => {
    const current = remapCoverageEntries(
      workload.evidence,
      input.sourceToSuccessorId,
    );
    if (
      input.extension.target.kind !== "application" ||
      workload.workloadId !== input.extension.target.workloadId
    ) {
      return { ...workload, evidence: current };
    }
    const workloadEvidence = mergeCoverageEntries(current, accepted);
    const workloadSatisfied = new Set(
      workloadEvidence.map(({ requirement }) => requirement),
    );
    const workloadMissingRequirements = workload.missingRequirements.filter(
      (requirement) => !workloadSatisfied.has(requirement),
    );
    const workloadComplete =
      requiredApplication.every((requirement) =>
        workloadSatisfied.has(requirement),
      ) &&
      workloadMissingRequirements.length === 0 &&
      workload.unresolvedRequirementIds.length === 0;
    return {
      ...workload,
      evidence: workloadEvidence,
      missingRequirements: workloadMissingRequirements,
      state: workloadComplete
        ? ("ai-assisted-custom-validated" as const)
        : workload.state,
    };
  });
  const targetWorkloadId =
    input.extension.target.kind === "application"
      ? input.extension.target.workloadId
      : undefined;
  const targetWorkloadComplete =
    workloads.find(({ workloadId }) => workloadId === targetWorkloadId)
      ?.state === "ai-assisted-custom-validated";
  const allWorkloadsComplete = workloads.every(
    (workload) =>
      workload.missingRequirements.length === 0 &&
      workload.unresolvedRequirementIds.length === 0 &&
      (workload.workloadId === targetWorkloadId ||
        workload.state === "ai-assisted-custom-validated" ||
        workload.state === "complete-supported-pattern" ||
        workload.state === "infrastructure-only"),
  );
  const applicationComplete =
    input.extension.target.kind === "application" &&
    targetWorkloadComplete &&
    missingRequirements.length === 0 &&
    allWorkloadsComplete;
  return {
    ...input.source,
    evidence,
    missingRequirements,
    solutionRevisionId: input.successorSolutionRevisionId,
    state: applicationComplete
      ? ("ai-assisted-custom-validated" as const)
      : input.source.state,
    workloads,
  };
}

function successorSourceOwnership(input: {
  readonly acceptedBy: string;
  readonly artifact: CandidateReviewRecordV1["artifact"];
  readonly extensionId: string;
  readonly source: SolutionRevisionManifestV1;
}) {
  const byPath = new Map<
    string,
    SolutionRevisionManifestV1["sourceOwnership"][number]
  >(input.source.sourceOwnership.map((entry) => [entry.path, entry]));
  for (const file of input.artifact.files) {
    const existing = byPath.get(file.path);
    if (
      file.ownership === "user-owned-preserved" &&
      existing?.ownership !== "user-owned"
    ) {
      throw new Error(
        "Candidate acceptance cannot transfer or invent preserved user ownership.",
      );
    }
    if (
      file.ownership === "ai-authored-candidate" &&
      existing !== undefined &&
      (existing.ownership !== "ai-authored" ||
        existing.ownerId !== input.extensionId)
    ) {
      throw new Error(
        "Candidate acceptance cannot shadow generated, user-owned, or another accepted extension path.",
      );
    }
    byPath.set(
      file.path,
      solutionSourceOwnershipV1Schema.parse({
        conflictBehavior:
          file.ownership === "user-owned-preserved"
            ? "preserve-user-content"
            : "replace-exact-owned-content",
        contentHash: file.digest,
        ownerId:
          file.ownership === "user-owned-preserved"
            ? (existing?.ownerId ?? input.acceptedBy)
            : input.extensionId,
        ownership:
          file.ownership === "user-owned-preserved"
            ? "user-owned"
            : "approved-extension",
        path: file.path,
      }),
    );
  }
  return [...byPath.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

function assertStoredCandidateArtifactVersion(
  stored: StoredCandidateArtifactV1,
): void {
  for (const file of stored.files) {
    if (
      sha256Text(file.content) !== file.digest ||
      new TextEncoder().encode(file.content).byteLength !== file.sizeBytes
    ) {
      throw new Error(
        "Candidate artifact lineage contains file bytes that do not match their exact digest and size.",
      );
    }
  }
  if (
    digestCanonicalValue(storedFileInventory(stored.files)) !==
      digestCanonicalValue(stored.reference.files) ||
    getCandidateArtifactDigest({
      bundleDigest: stored.reference.bundleDigest,
      extensionId: stored.reference.extensionId,
      files: stored.files,
      origin: stored.reference.origin,
      scope: stored.reference.scope,
      solutionRevisionId: stored.reference.solutionRevisionId,
      targetKind: stored.targetKind,
      ...(stored.validationReplay === undefined
        ? {}
        : { validationReplay: stored.validationReplay }),
    }) !== stored.reference.artifactDigest
  ) {
    throw new Error(
      "Candidate artifact lineage contains an invalid immutable content address.",
    );
  }
}

function assertExactStoredReviewBinding(input: {
  readonly expectedReviewDigest: Sha256Digest;
  readonly expectedReviewId: string;
  readonly notAfter: string;
  readonly stored: StoredCandidateArtifactV1;
}): void {
  const binding = input.stored.reviewBinding;
  if (
    binding?.artifactId !== input.stored.reference.artifactId ||
    binding.artifactDigest !== input.stored.reference.artifactDigest ||
    binding.scope.organizationId !==
      input.stored.reference.scope.organizationId ||
    binding.scope.projectId !== input.stored.reference.scope.projectId ||
    binding.solutionRevisionId !== input.stored.reference.solutionRevisionId ||
    binding.reviewId !== input.expectedReviewId ||
    binding.reviewDigest !== input.expectedReviewDigest ||
    Date.parse(binding.boundAt) < Date.parse(input.stored.reference.storedAt) ||
    Date.parse(binding.boundAt) > Date.parse(input.notAfter)
  ) {
    throw new Error(
      "Candidate acceptance requires the exact immutable stored artifact review binding.",
    );
  }
}

async function verifyCandidateArtifactLineage(input: {
  readonly acceptedAt: string;
  readonly artifactStore: CandidateArtifactStore;
  readonly current: StoredCandidateArtifactV1;
  readonly review: CandidateReviewRecordV1;
}): Promise<void> {
  if (input.current.lifecycle.state !== "current") {
    throw new Error(
      "Candidate acceptance requires the exact current artifact lifecycle.",
    );
  }
  assertExactStoredReviewBinding({
    expectedReviewDigest: input.review.reviewDigest,
    expectedReviewId: input.review.reviewId,
    notAfter: input.acceptedAt,
    stored: input.current,
  });
  const rootOrigin = input.current.reference.origin;
  if (rootOrigin.kind === "model-output") return;
  const readImmutable = input.artifactStore.readImmutable?.bind(
    input.artifactStore,
  );
  if (readImmutable === undefined) {
    throw new Error(
      "User-modified candidate acceptance requires immutable historical artifact authority.",
    );
  }

  const visited = new Set<string>([input.current.reference.artifactId]);
  let child = input.current;
  const maximumLinks = input.review.editRevalidations.length;
  for (let depth = 0; depth < maximumLinks; depth += 1) {
    const childOrigin = child.reference.origin;
    if (childOrigin.kind !== "user-modified") {
      throw new Error(
        "Candidate artifact lineage ended before its declared immutable base.",
      );
    }
    if (visited.has(childOrigin.parentArtifactId)) {
      throw new Error("Candidate artifact lineage contains a cycle.");
    }
    visited.add(childOrigin.parentArtifactId);
    const parent = await readImmutable({
      artifactId: childOrigin.parentArtifactId,
      expectedArtifactDigest: childOrigin.parentArtifactDigest,
      scope: child.reference.scope,
    });
    if (
      parent.reference.artifactId !== childOrigin.parentArtifactId ||
      parent.reference.artifactDigest !== childOrigin.parentArtifactDigest ||
      parent.reference.scope.organizationId !==
        child.reference.scope.organizationId ||
      parent.reference.scope.projectId !== child.reference.scope.projectId ||
      parent.lifecycle.state !== "superseded" ||
      parent.lifecycle.successorArtifactId !== child.reference.artifactId ||
      parent.lifecycle.successorArtifactDigest !==
        child.reference.artifactDigest ||
      parent.lifecycle.supersededAt !== child.reference.storedAt ||
      parent.targetKind !== child.targetKind
    ) {
      throw new Error(
        "Candidate artifact lineage does not bind the exact predecessor and successor lifecycle.",
      );
    }
    const revalidation =
      input.review.editRevalidations[maximumLinks - depth - 1];
    if (
      revalidation?.artifactId !== child.reference.artifactId ||
      revalidation.artifactDigest !== child.reference.artifactDigest ||
      revalidation.parentArtifactId !== parent.reference.artifactId ||
      revalidation.parentArtifactDigest !== parent.reference.artifactDigest
    ) {
      throw new Error(
        "Candidate artifact lineage does not match its exact edit revalidation authority.",
      );
    }
    assertExactStoredReviewBinding({
      expectedReviewDigest: revalidation.parentReviewDigest,
      expectedReviewId: revalidation.parentReviewId,
      notAfter: input.acceptedAt,
      stored: parent,
    });
    assertStoredCandidateArtifactVersion(parent);
    if (
      parent.validationReplay === undefined ||
      child.validationReplay === undefined ||
      digestCanonicalValue(parent.validationReplay.descriptor) !==
        digestCanonicalValue(child.validationReplay.descriptor) ||
      parent.validationReplay.generationContextDigest !==
        child.validationReplay.generationContextDigest ||
      digestCanonicalValue(parent.validationReplay.attemptAuthority) !==
        digestCanonicalValue(child.validationReplay.attemptAuthority) ||
      parent.validationReplay.solutionRevisionDigest !==
        child.validationReplay.solutionRevisionDigest
    ) {
      throw new Error(
        "Candidate artifact lineage changed its validation or ModelGateway replay authority.",
      );
    }
    assertCandidateArtifactSupersession({
      next: child.reference,
      previous: { ...parent, lifecycle: { state: "current" } },
    });
    if (parent.reference.origin.kind === "model-output") {
      if (
        parent.reference.artifactId !== rootOrigin.baseArtifactId ||
        parent.reference.artifactDigest !== rootOrigin.baseArtifactDigest
      ) {
        throw new Error(
          "Candidate artifact lineage does not terminate at its exact declared model-output base.",
        );
      }
      return;
    }
    child = parent;
  }
  throw new Error(
    "Candidate artifact lineage exceeded its bounded immutable edit history.",
  );
}

export interface CandidateAcceptanceRequestV1 {
  readonly acceptedAt: string;
  readonly expectedReviewDigest: Sha256Digest;
  readonly expectedSolutionRevisionId: string;
  readonly review: unknown;
  readonly sourceEvidence: unknown;
  readonly sourceSolutionRevision: unknown;
  readonly successorSolutionRevisionId: string;
}

export interface CandidateRejectionRequestV1 {
  readonly expectedReviewDigest: Sha256Digest;
  readonly reason: string;
  readonly rejectedAt: string;
  readonly review: unknown;
}

export interface CandidateAcceptanceService {
  accept(
    input: CandidateAcceptanceRequestV1,
  ): Promise<CandidateAcceptanceResultV1>;
  reject(input: CandidateRejectionRequestV1): Promise<CandidateDecisionV1>;
}

export interface CandidateAcceptanceServiceDependencies {
  readonly artifactStore: CandidateArtifactStore;
  readonly authorization: CandidateReviewAuthorizationPort;
}

async function acceptCandidateReview(input: {
  readonly acceptedAt: string;
  readonly artifactStore: CandidateArtifactStore;
  readonly authorization: CandidateReviewAuthorizationPort;
  readonly expectedReviewDigest: Sha256Digest;
  readonly expectedSolutionRevisionId: string;
  readonly review: unknown;
  readonly sourceEvidence: unknown;
  readonly sourceSolutionRevision: unknown;
  readonly successorSolutionRevisionId: string;
}): Promise<CandidateAcceptanceResultV1> {
  const acceptedAt = utcTimestampSchema.parse(input.acceptedAt);
  const review = candidateReviewRecordV1Schema.parse(input.review);
  if (
    review.reviewDigest !== input.expectedReviewDigest ||
    getCandidateReviewDigest(review) !== input.expectedReviewDigest
  ) {
    throw new Error(
      "Candidate acceptance failed because the review digest is stale.",
    );
  }
  if (
    review.extension.solutionRevisionId !== input.expectedSolutionRevisionId ||
    review.artifact.solutionRevisionId !== input.expectedSolutionRevisionId
  ) {
    throw new Error(
      "Candidate acceptance failed because the Solution Revision changed.",
    );
  }
  if (review.state !== "ready-for-acceptance") {
    throw new Error(
      "Candidate acceptance requires a fully validated review-ready candidate.",
    );
  }

  const authorization = await requireCandidateReviewAuthorizationProof({
    action: "accept",
    artifactDigest: review.artifact.artifactDigest,
    authorization: input.authorization,
    reviewDigest: review.reviewDigest,
    reviewId: review.reviewId,
    scope: review.scope,
    solutionRevisionId: review.artifact.solutionRevisionId,
  });

  const authorizationDecision = authorization.allowedDecision;
  const acceptedBy = authorizationDecision.principalId;
  const sourceSolutionRevision = validateSolutionRevisionManifestIntrinsicV1(
    input.sourceSolutionRevision,
  );
  const sourceSolutionRevisionDigest = digestCanonicalValue(
    sourceSolutionRevision,
  );
  const successorSolutionRevisionId = solutionRevisionIdSchema.parse(
    input.successorSolutionRevisionId,
  );
  if (
    sourceSolutionRevision.solutionRevisionId !==
      input.expectedSolutionRevisionId ||
    successorSolutionRevisionId === input.expectedSolutionRevisionId ||
    sourceSolutionRevision.aiExtensionIds.includes(review.extension.id)
  ) {
    throw new Error(
      "Candidate acceptance requires the exact source and one distinct new successor Solution Revision.",
    );
  }
  const sourceEvidence = exactSourceEvidence({
    evidence: input.sourceEvidence,
    revision: sourceSolutionRevision,
  });
  const acceptanceTime = Date.parse(acceptedAt);
  const priorTimes = [
    sourceSolutionRevision.createdAt,
    review.artifact.storedAt,
    authorizationDecision.decidedAt,
    ...review.evidence.map((record) => record.provenance.createdAt),
    ...review.issueHistory.map((issue) => issue.provenance.createdAt),
  ].map(Date.parse);
  if (priorTimes.some((priorTime) => priorTime > acceptanceTime)) {
    throw new Error(
      "Candidate acceptance timestamp cannot precede its immutable source, validation, issue, artifact, or authorization history.",
    );
  }

  const initiallyStored = await input.artifactStore.read({
    artifactId: review.artifact.artifactId,
    expectedArtifactDigest: review.artifact.artifactDigest,
    scope: review.scope,
  });
  await verifyCandidateArtifactLineage({
    acceptedAt,
    artifactStore: input.artifactStore,
    current: initiallyStored,
    review,
  });
  const stored = await input.artifactStore.read({
    artifactId: review.artifact.artifactId,
    expectedArtifactDigest: review.artifact.artifactDigest,
    scope: review.scope,
  });
  if (digestCanonicalValue(stored) !== digestCanonicalValue(initiallyStored)) {
    throw new Error(
      "Candidate acceptance failed because the current artifact or review binding changed during lineage verification.",
    );
  }
  const targetKind = expectedTargetKind(review.extension);
  if (stored.targetKind !== targetKind) {
    throw new Error(
      "Candidate acceptance failed because the stored target kind does not match.",
    );
  }
  for (const file of stored.files) {
    if (
      sha256Text(file.content) !== file.digest ||
      new TextEncoder().encode(file.content).byteLength !== file.sizeBytes
    ) {
      throw new Error(
        "Candidate acceptance failed because stored file bytes or size no longer match.",
      );
    }
  }
  if (
    stored.validationReplay === undefined ||
    digestCanonicalValue(stored.validationReplay) !==
      review.artifact.validationReplayDigest ||
    stored.validationReplay.solutionRevisionDigest !==
      sourceSolutionRevisionDigest ||
    stored.validationReplay.solutionRevision.solutionRevisionId !==
      input.expectedSolutionRevisionId ||
    digestCanonicalValue(stored.validationReplay.attemptAuthority) !==
      digestCanonicalValue(review.attemptAuthority) ||
    !hasExactCandidateAttemptReplayAuthority(
      review.attempts,
      stored.validationReplay.attemptAuthority,
    )
  ) {
    throw new Error(
      "Candidate acceptance requires the exact full-validation replay and source revision authority.",
    );
  }
  const finalAttempt = review.attempts[review.attempts.length - 1];
  const descriptor = stored.validationReplay.descriptor;
  const descriptorModel = {
    modelId: descriptor.modelId,
    modelVersion: descriptor.modelVersion,
    promptDigest: descriptor.promptDigest,
    promptTemplateId: descriptor.promptTemplateId,
    promptVersion: descriptor.promptVersion,
    providerId: descriptor.providerId,
  };
  if (
    finalAttempt?.idempotencyKeyDigest !== descriptor.idempotencyKeyDigest ||
    finalAttempt.invocationId !== descriptor.invocationId ||
    digestCanonicalValue(finalAttempt.model) !==
      digestCanonicalValue(descriptorModel) ||
    review.extension.model.modelId !== descriptor.modelId ||
    review.extension.model.modelVersion !== descriptor.modelVersion ||
    review.extension.model.promptDigest !== descriptor.promptDigest ||
    review.extension.model.promptVersion !== descriptor.promptVersion ||
    review.extension.model.providerId !== descriptor.providerId
  ) {
    throw new Error(
      "Candidate acceptance requires exact ModelGateway replay and attempt provenance.",
    );
  }

  if (
    digestCanonicalValue(stored.reference) !==
      digestCanonicalValue(review.artifact) ||
    digestCanonicalValue(storedFileInventory(stored.files)) !==
      digestCanonicalValue(review.artifact.files)
  ) {
    throw new Error(
      "Candidate acceptance failed because the exact artifact reference inventory changed.",
    );
  }
  if (
    getCandidateArtifactDigest({
      bundleDigest: review.artifact.bundleDigest,
      extensionId: review.artifact.extensionId,
      files: stored.files,
      origin: review.artifact.origin,
      scope: review.artifact.scope,
      solutionRevisionId: review.artifact.solutionRevisionId,
      targetKind,
      validationReplay: stored.validationReplay,
    }) !== review.artifact.artifactDigest
  ) {
    throw new Error(
      "Candidate acceptance failed because stored content no longer matches.",
    );
  }
  if (
    review.validation.some(
      (check) => check.required && check.result !== "passed",
    ) ||
    review.unresolvedItems.length > 0 ||
    review.issues.some(
      (issue) =>
        issue.lifecycle.state === "current" &&
        (issue.severity === "error" || issue.severity === "security-error"),
    )
  ) {
    throw new Error(
      "Candidate acceptance failed because required work remains unresolved.",
    );
  }

  const candidateSizeBytes = review.artifact.files.reduce(
    (total, file) => total + file.sizeBytes,
    0,
  );
  const passingEvidence = review.evidence.filter((record) => {
    const candidateReferences = record.artifacts.filter(
      ({ digest }) => digest === review.artifact.artifactDigest,
    );
    return (
      record.solutionRevisionId === input.expectedSolutionRevisionId &&
      record.staleness.state === "current" &&
      record.provenance.inputDigests.includes(review.artifact.artifactDigest) &&
      record.provenance.inputDigests.includes(sourceSolutionRevisionDigest) &&
      record.checks.every(
        (check) =>
          check.status === "passed" &&
          check.artifactDigests.includes(review.artifact.artifactDigest),
      ) &&
      candidateReferences.length === 1 &&
      candidateReferences[0]?.mediaType ===
        "application/vnd.cloudmarkup.ai-extension-candidate.v1+json" &&
      candidateReferences[0].sizeBytes === candidateSizeBytes
    );
  });
  const acceptedEvidence = requiredEvidenceLevels(review.extension).flatMap(
    (level) => {
      const matching = passingEvidence.filter(
        (record) =>
          record.level.kind === level.kind &&
          record.level.rank === level.rank &&
          level.requirements.every(
            (requirement) =>
              record.checks.filter(
                (check) =>
                  check.status === "passed" &&
                  check.generationCoverageRequirement === requirement,
              ).length === 1,
          ),
      );
      if (matching.length !== 1) {
        throw new Error(
          "Candidate acceptance failed because exact required Evidence is missing or duplicated.",
        );
      }
      return matching;
    },
  );

  const rebased = rebaseEvidenceRecords({
    acceptedAt: input.acceptedAt,
    acceptedBy: acceptedBy,
    artifactDigest: review.artifact.artifactDigest,
    records: combineEvidenceRecords(sourceEvidence.records, passingEvidence),
    sourceSolutionRevisionDigest,
    successorSolutionRevisionId,
  });
  const acceptedSuccessorEvidence = acceptedEvidence.map((record) => {
    const successorEvidenceId = rebased.sourceToSuccessorId.get(record.id);
    const successorEvidence = rebased.evidence.records.find(
      ({ id }) => id === successorEvidenceId,
    );
    if (successorEvidence === undefined) {
      throw new Error(
        "Candidate acceptance could not preserve required successor Evidence.",
      );
    }
    return successorEvidence;
  });
  const extension = aiAuthoredExtensionV1Schema.parse({
    ...review.extension,
    acceptance: {
      acceptedAt: input.acceptedAt,
      acceptedBy: acceptedBy,
      state: "accepted",
    },
    exportSafety: {
      evidenceIds: acceptedSuccessorEvidence.map(({ id }) => id).sort(),
      state: "safe-to-export",
    },
    solutionRevisionId: successorSolutionRevisionId,
  });
  const successorSolutionRevision = solutionRevisionManifestV1Schema.parse(
    validateSolutionRevisionManifestIntrinsicV1({
      ...sourceSolutionRevision,
      aiExtensionIds: [...sourceSolutionRevision.aiExtensionIds, extension.id]
        .filter((id, index, ids) => ids.indexOf(id) === index)
        .sort(),
      createdAt: input.acceptedAt,
      createdBy: acceptedBy,
      evidenceIdsAtFreeze: rebased.evidence.records.map(({ id }) => id).sort(),
      generationCoverage: successorCoverage({
        acceptedEvidence: acceptedSuccessorEvidence,
        extension,
        source: sourceSolutionRevision.generationCoverage,
        sourceToSuccessorId: rebased.sourceToSuccessorId,
        successorSolutionRevisionId,
      }),
      issueIdsAtFreeze: [
        ...sourceSolutionRevision.issueIdsAtFreeze,
        ...review.issues.map(({ id }) => id),
      ]
        .filter((id, index, ids) => ids.indexOf(id) === index)
        .sort(),
      solutionRevisionId: successorSolutionRevisionId,
      sourceOwnership: successorSourceOwnership({
        acceptedBy: acceptedBy,
        artifact: review.artifact,
        extensionId: extension.id,
        source: sourceSolutionRevision,
      }),
      versions: {
        ...sourceSolutionRevision.versions,
        modelPrompt: {
          state: "pinned",
          tool: {
            id: finalAttempt.model.promptTemplateId,
            version: finalAttempt.model.promptVersion,
          },
        },
      },
    }),
  );
  validateSolutionRevisionManifestWithEvidenceV1(
    successorSolutionRevision,
    rebased.evidence,
  );

  const decision = candidateDecisionV1Schema.parse({
    artifact: review.artifact,
    authorization,
    authorizationDecisionId: authorizationDecision.decisionId,
    contractVersion: 1,
    decidedAt: input.acceptedAt,
    decidedBy: acceptedBy,
    decision: "accepted",
    deploymentAuthority: "none",
    extension,
    reviewDigest: review.reviewDigest,
    review,
    reviewId: review.reviewId,
    sourceSolutionRevisionId: sourceSolutionRevision.solutionRevisionId,
    successorSolutionRevisionId,
    writeAuthority: "none",
  });
  const exportProjection = {
    acceptanceAuthorization: authorization,
    acceptanceAuthorizationDecisionId: authorizationDecision.decisionId,
    artifact: review.artifact,
    attempts: review.attempts,
    attemptAuthority: review.attemptAuthority,
    artifactReadAuthority: "restricted-candidate-artifact-only" as const,
    classification: "immutable-solution-revision-export-input" as const,
    contractVersion: 1 as const,
    createdAt: input.acceptedAt,
    createdBy: acceptedBy,
    deploymentAuthority: "none" as const,
    evidence: rebased.evidence,
    exportInputId: getCandidateExportInputId({
      acceptanceAuthorization: authorization,
      acceptedAt: input.acceptedAt,
      acceptedBy: acceptedBy,
      artifactDigest: review.artifact.artifactDigest,
      attemptAuthority: review.attemptAuthority,
      review,
      sourceSolutionRevision,
      successorSolutionRevision,
    }),
    extension,
    issueHistory: review.issueHistory,
    issues: review.issues,
    repositoryWriteAuthority: "none" as const,
    review,
    reviewDigest: review.reviewDigest,
    reviewEvidence: review.evidence,
    reviewId: review.reviewId,
    sourceIssueIdsAtFreeze: sourceSolutionRevision.issueIdsAtFreeze,
    sourceSolutionRevision,
    sourceSolutionRevisionDigest,
    sourceSolutionRevisionId: sourceSolutionRevision.solutionRevisionId,
    successorSolutionRevision,
    successorSolutionRevisionDigest: digestCanonicalValue(
      successorSolutionRevision,
    ),
    userModifications:
      review.artifact.origin.kind === "user-modified"
        ? review.artifact.origin.edits
        : [],
  };
  const exportInput = candidateExportInputV1Schema.parse({
    ...exportProjection,
    exportInputDigest: digestCanonicalValue(exportProjection),
  });
  return candidateAcceptanceResultV1Schema.parse({
    contractVersion: 1,
    decision,
    exportInput,
  });
}
async function rejectCandidateReview(input: {
  readonly artifactStore: CandidateArtifactStore;
  readonly authorization: CandidateReviewAuthorizationPort;
  readonly expectedReviewDigest: Sha256Digest;
  readonly reason: string;
  readonly rejectedAt: string;
  readonly review: unknown;
}): Promise<CandidateDecisionV1> {
  const rejectedAt = utcTimestampSchema.parse(input.rejectedAt);
  const review = candidateReviewRecordV1Schema.parse(input.review);
  if (
    review.reviewDigest !== input.expectedReviewDigest ||
    getCandidateReviewDigest(review) !== input.expectedReviewDigest
  ) {
    throw new Error(
      "Candidate rejection failed because the review digest is stale.",
    );
  }
  const authorization = await requireCandidateReviewAuthorizationProof({
    action: "reject",
    artifactDigest: review.artifact.artifactDigest,
    authorization: input.authorization,
    reviewDigest: review.reviewDigest,
    reviewId: review.reviewId,
    scope: review.scope,
    solutionRevisionId: review.artifact.solutionRevisionId,
  });
  const authorizationDecision = authorization.allowedDecision;
  const rejectionTime = Date.parse(rejectedAt);
  const priorTimes = [
    review.artifact.storedAt,
    authorizationDecision.decidedAt,
    ...review.evidence.map((record) => record.provenance.createdAt),
    ...review.issueHistory.map((issue) => issue.provenance.createdAt),
  ].map(Date.parse);
  if (priorTimes.some((priorTime) => priorTime > rejectionTime)) {
    throw new Error(
      "Candidate rejection timestamp cannot precede its immutable validation, issue, artifact, or authorization history.",
    );
  }
  const rejectedBy = authorizationDecision.principalId;
  const stored = await input.artifactStore.read({
    artifactId: review.artifact.artifactId,
    expectedArtifactDigest: review.artifact.artifactDigest,
    scope: review.scope,
  });
  assertExactStoredReviewBinding({
    expectedReviewDigest: review.reviewDigest,
    expectedReviewId: review.reviewId,
    notAfter: rejectedAt,
    stored,
  });
  assertStoredCandidateArtifactVersion(stored);
  if (
    stored.lifecycle.state !== "current" ||
    digestCanonicalValue(stored.reference) !==
      digestCanonicalValue(review.artifact) ||
    digestCanonicalValue(storedFileInventory(stored.files)) !==
      digestCanonicalValue(review.artifact.files)
  ) {
    throw new Error(
      "Candidate rejection requires the exact current bound artifact and review authority.",
    );
  }
  const extension = aiAuthoredExtensionV1Schema.parse({
    ...review.extension,
    acceptance: {
      reason: input.reason,
      rejectedAt: input.rejectedAt,
      rejectedBy: rejectedBy,
      state: "rejected",
    },
    exportSafety: {
      missingEvidenceKinds:
        review.extension.exportSafety.state === "not-safe"
          ? review.extension.exportSafety.missingEvidenceKinds
          : ["cloudmarkup.user-acceptance"],
      state: "not-safe",
    },
  });
  return candidateDecisionV1Schema.parse({
    artifact: review.artifact,
    authorization,
    authorizationDecisionId: authorizationDecision.decisionId,
    contractVersion: 1,
    decidedAt: input.rejectedAt,
    decidedBy: rejectedBy,
    decision: "rejected",
    deploymentAuthority: "none",
    extension,
    reviewDigest: review.reviewDigest,
    review,
    reviewId: review.reviewId,
    sourceSolutionRevisionId: review.artifact.solutionRevisionId,
    writeAuthority: "none",
  });
}

export function createCandidateAcceptanceService(
  dependencies: CandidateAcceptanceServiceDependencies,
): CandidateAcceptanceService {
  return Object.freeze({
    accept: (input: CandidateAcceptanceRequestV1) =>
      acceptCandidateReview({
        ...input,
        artifactStore: dependencies.artifactStore,
        authorization: dependencies.authorization,
      }),
    reject: (input: CandidateRejectionRequestV1) =>
      rejectCandidateReview({
        ...input,
        artifactStore: dependencies.artifactStore,
        authorization: dependencies.authorization,
      }),
  });
}
