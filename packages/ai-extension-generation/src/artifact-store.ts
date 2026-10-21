import {
  sha256DigestSchema,
  solutionRevisionIdSchema,
  solutionStableIdSchema,
  utcTimestampSchema,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import {
  candidateArtifactOriginV1Schema,
  candidateArtifactReferenceV1Schema,
  candidateValidationReplayV1Schema,
  candidateScopeV1Schema,
  invalidCandidateArtifactReferenceV1Schema,
  type CandidateArtifactLifecycleV1,
  type CandidateArtifactOriginV1,
  type CandidateArtifactReferenceV1,
  type CandidateDiagnosticV1,
  type CandidateScopeV1,
  type CandidateValidationReplayV1,
  type InvalidCandidateArtifactReferenceV1,
} from "./presentation-contracts.js";
import {
  digestCanonicalValue,
  portablePathKey,
  sha256Text,
  stableRecordId,
  type CandidateContentKind,
} from "./security.js";
import type { MaterializedCandidateFile } from "./materializer.js";

export const candidateArtifactReviewBindingV1Schema = z
  .object({
    artifactDigest: sha256DigestSchema,
    artifactId: solutionStableIdSchema,
    boundAt: utcTimestampSchema,
    contractVersion: z.literal(1),
    reviewDigest: sha256DigestSchema,
    reviewId: solutionStableIdSchema,
    scope: candidateScopeV1Schema,
    solutionRevisionId: solutionRevisionIdSchema,
  })
  .strict();

export type CandidateArtifactReviewBindingV1 = z.output<
  typeof candidateArtifactReviewBindingV1Schema
>;

export interface CandidateArtifactReviewIdentityV1 {
  readonly reviewDigest: Sha256Digest;
  readonly reviewId: string;
}

export interface CandidateArtifactSuccessorReviewBindingInputV1 extends CandidateArtifactReviewIdentityV1 {
  readonly boundAt: string;
}

export interface CandidateArtifactStoreBindReviewInput extends CandidateArtifactSuccessorReviewBindingInputV1 {
  readonly artifactId: string;
  readonly expectedArtifactDigest: Sha256Digest;
  readonly scope: CandidateScopeV1;
}

export function createCandidateArtifactReviewBinding(input: {
  readonly reference: CandidateArtifactReferenceV1;
  readonly review: CandidateArtifactSuccessorReviewBindingInputV1;
}): CandidateArtifactReviewBindingV1 {
  return candidateArtifactReviewBindingV1Schema.parse({
    artifactDigest: input.reference.artifactDigest,
    artifactId: input.reference.artifactId,
    boundAt: input.review.boundAt,
    contractVersion: 1,
    reviewDigest: input.review.reviewDigest,
    reviewId: input.review.reviewId,
    scope: input.reference.scope,
    solutionRevisionId: input.reference.solutionRevisionId,
  });
}

export interface CandidateArtifactStorePutInput {
  readonly bundleDigest: Sha256Digest;
  readonly extensionId: string;
  readonly files: readonly MaterializedCandidateFile[];
  readonly scope: CandidateScopeV1;
  readonly origin?: CandidateArtifactOriginV1;
  readonly validationReplay?: CandidateValidationReplayV1;
  readonly solutionRevisionId: string;
  readonly storedAt: string;
  readonly targetKind: CandidateContentKind;
}

export interface CandidateArtifactStoreSupersedeInput extends CandidateArtifactStorePutInput {
  readonly expectedSupersededArtifactDigest: Sha256Digest;
  readonly expectedSupersededReview: CandidateArtifactReviewIdentityV1;
  readonly successorReview: CandidateArtifactSuccessorReviewBindingInputV1;
  readonly supersededArtifactId: string;
  readonly supersededAt: string;
}

export {
  candidateValidationReplayV1Schema,
  type CandidateArtifactLifecycleV1,
  type CandidateValidationReplayV1,
} from "./presentation-contracts.js";
export interface CandidateArtifactStoreInvalidInput {
  readonly bundle: unknown;
  readonly bundleDigest: Sha256Digest;
  readonly diagnostics: readonly CandidateDiagnosticV1[];
  readonly extensionId: string;
  readonly scope: CandidateScopeV1;
  readonly solutionRevisionId: string;
  readonly storedAt: string;
}

export interface StoredCandidateArtifactV1 {
  readonly lifecycle: CandidateArtifactLifecycleV1;
  readonly reference: CandidateArtifactReferenceV1;
  readonly targetKind: CandidateContentKind;
  readonly files: readonly MaterializedCandidateFile[];
  readonly validationReplay?: CandidateValidationReplayV1;
  readonly reviewBinding?: CandidateArtifactReviewBindingV1;
}

export interface CandidateArtifactStore {
  bindReview?(
    input: CandidateArtifactStoreBindReviewInput,
  ): Promise<CandidateArtifactReviewBindingV1>;
  put(
    input: CandidateArtifactStorePutInput,
  ): Promise<CandidateArtifactReferenceV1>;
  preserveInvalid(
    input: CandidateArtifactStoreInvalidInput,
  ): Promise<InvalidCandidateArtifactReferenceV1>;
  read(input: {
    readonly artifactId: string;
    readonly expectedArtifactDigest: Sha256Digest;
    readonly scope: CandidateScopeV1;
  }): Promise<StoredCandidateArtifactV1>;
  readImmutable?(input: {
    readonly artifactId: string;
    readonly expectedArtifactDigest: Sha256Digest;
    readonly scope: CandidateScopeV1;
  }): Promise<StoredCandidateArtifactV1>;
  supersede?(
    input: CandidateArtifactStoreSupersedeInput,
  ): Promise<CandidateArtifactReferenceV1>;
}

function fileReference(file: MaterializedCandidateFile) {
  return {
    digest: file.digest,
    ownership: file.ownership,
    path: file.path,
    sizeBytes: file.sizeBytes,
    sourceKind: file.sourceKind,
  };
}

const unavailableAttemptAuthorityDigest = digestCanonicalValue([]);
const unavailableValidationReplayDigest = digestCanonicalValue({
  contractVersion: 1,
  state: "unavailable",
});

function exactArtifactOrigin(input: {
  readonly bundleDigest: Sha256Digest;
  readonly origin?: CandidateArtifactOriginV1;
}): CandidateArtifactOriginV1 {
  return candidateArtifactOriginV1Schema.parse(
    input.origin ?? {
      kind: "model-output",
      modelOutputDigest: input.bundleDigest,
    },
  );
}

function exactValidationReplay(input: {
  readonly validationReplay?: CandidateValidationReplayV1;
}): {
  readonly attemptAuthorityDigest: Sha256Digest;
  readonly digest: Sha256Digest;
  readonly replay?: CandidateValidationReplayV1;
} {
  if (input.validationReplay === undefined) {
    return {
      attemptAuthorityDigest: unavailableAttemptAuthorityDigest,
      digest: unavailableValidationReplayDigest,
    };
  }
  const replay = candidateValidationReplayV1Schema.parse(
    input.validationReplay,
  );
  return {
    attemptAuthorityDigest: digestCanonicalValue(replay.attemptAuthority),
    digest: digestCanonicalValue(replay),
    replay,
  };
}

export function getCandidateArtifactDigest(input: {
  readonly bundleDigest: Sha256Digest;
  readonly extensionId: string;
  readonly files: readonly MaterializedCandidateFile[];
  readonly origin?: CandidateArtifactOriginV1;
  readonly validationReplay?: CandidateValidationReplayV1;
  readonly scope: CandidateScopeV1;
  readonly solutionRevisionId: string;
  readonly targetKind: CandidateContentKind;
}): Sha256Digest {
  const origin = exactArtifactOrigin(input);
  const validationReplay = exactValidationReplay(input);

  return digestCanonicalValue({
    attemptAuthorityDigest: validationReplay.attemptAuthorityDigest,
    bundleDigest: input.bundleDigest,
    extensionId: input.extensionId,
    origin,
    files: [...input.files]
      .sort((left, right) => {
        const leftKey = portablePathKey(left.path);
        const rightKey = portablePathKey(right.path);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      })
      .map(fileReference),
    scope: input.scope,
    solutionRevisionId: input.solutionRevisionId,
    targetKind: input.targetKind,
    validationReplayDigest: validationReplay.digest,
  });
}

export function assertCandidateArtifactSupersession(input: {
  readonly next: CandidateArtifactReferenceV1;
  readonly previous: StoredCandidateArtifactV1;
}): void {
  const previous = input.previous;
  const next = input.next;
  if (
    previous.lifecycle.state !== "current" ||
    next.artifactId === previous.reference.artifactId ||
    next.scope.organizationId !== previous.reference.scope.organizationId ||
    next.scope.projectId !== previous.reference.scope.projectId ||
    next.extensionId !== previous.reference.extensionId ||
    next.attemptAuthorityDigest !== previous.reference.attemptAuthorityDigest ||
    next.solutionRevisionId !== previous.reference.solutionRevisionId ||
    next.origin.kind !== "user-modified" ||
    next.origin.parentArtifactId !== previous.reference.artifactId ||
    next.origin.parentArtifactDigest !== previous.reference.artifactDigest ||
    next.origin.modelOutputDigest !==
      previous.reference.origin.modelOutputDigest
  ) {
    throw new Error(
      "Candidate supersession must bind the exact current predecessor authority.",
    );
  }
  const previousEdits =
    previous.reference.origin.kind === "user-modified"
      ? previous.reference.origin.edits
      : [];
  const expectedBase =
    previous.reference.origin.kind === "user-modified"
      ? {
          digest: previous.reference.origin.baseArtifactDigest,
          id: previous.reference.origin.baseArtifactId,
        }
      : {
          digest: previous.reference.artifactDigest,
          id: previous.reference.artifactId,
        };
  if (
    next.origin.baseArtifactDigest !== expectedBase.digest ||
    next.origin.baseArtifactId !== expectedBase.id ||
    next.origin.edits.length <= previousEdits.length ||
    previousEdits.some(
      (edit, index) =>
        digestCanonicalValue(edit) !==
        digestCanonicalValue(
          next.origin.kind === "user-modified"
            ? next.origin.edits[index]
            : undefined,
        ),
    )
  ) {
    throw new Error(
      "Candidate supersession must append to the original immutable edit lineage.",
    );
  }
  const previousFiles = new Map(
    previous.files.map((file) => [portablePathKey(file.path), file]),
  );
  const nextFiles = new Map(
    next.files.map((file) => [portablePathKey(file.path), file]),
  );
  const appendedEdits = next.origin.edits.slice(previousEdits.length);
  const newEditsByPath = new Map<
    string,
    (typeof next.origin.edits)[number][]
  >();
  for (const edit of appendedEdits) {
    const key = portablePathKey(edit.path);
    const edits = newEditsByPath.get(key) ?? [];
    edits.push(edit);
    newEditsByPath.set(key, edits);
  }
  if (
    next.storedAt <= previous.reference.storedAt ||
    appendedEdits.some((edit) => edit.editedAt !== next.storedAt) ||
    nextFiles.size !== previousFiles.size
  ) {
    throw new Error(
      "Candidate supersession must preserve ordered storage and exact file cardinality.",
    );
  }
  for (const [key, previousFile] of previousFiles) {
    const nextFile = nextFiles.get(key);
    const edits = newEditsByPath.get(key) ?? [];
    if (
      nextFile?.path !== previousFile.path ||
      nextFile.ownership !== previousFile.ownership ||
      nextFile.sourceKind !== previousFile.sourceKind ||
      (edits.length === 0 &&
        (nextFile.digest !== previousFile.digest ||
          nextFile.sizeBytes !== previousFile.sizeBytes)) ||
      (edits.length > 0 &&
        (edits[0]?.priorDigest !== previousFile.digest ||
          edits[edits.length - 1]?.resultDigest !== nextFile.digest))
    ) {
      throw new Error(
        "Candidate supersession must preserve every file or bind its exact appended edit chain.",
      );
    }
  }
  if ([...newEditsByPath.keys()].some((key) => !previousFiles.has(key))) {
    throw new Error(
      "Candidate supersession cannot add an edit outside the predecessor artifact.",
    );
  }
}
export function createCandidateArtifactReference(
  input: CandidateArtifactStorePutInput,
): CandidateArtifactReferenceV1 {
  for (const file of input.files) {
    if (sha256Text(file.content) !== file.digest) {
      throw new Error(
        "Candidate artifact files must match their exact content digests.",
      );
    }
  }
  const origin = exactArtifactOrigin(input);
  const validationReplay = exactValidationReplay(input);
  const artifactDigest = getCandidateArtifactDigest({ ...input, origin });
  return candidateArtifactReferenceV1Schema.parse({
    artifactDigest,
    artifactId: stableRecordId("candidate", {
      artifactDigest,
      scope: input.scope,
    }),
    attemptAuthorityDigest: validationReplay.attemptAuthorityDigest,
    bundleDigest: input.bundleDigest,
    classification: "restricted-ai-authored-candidate",
    contractVersion: 1,
    extensionId: input.extensionId,
    files: input.files.map(fileReference),
    scope: input.scope,
    origin,
    solutionRevisionId: input.solutionRevisionId,
    storedAt: input.storedAt,
    validationReplayDigest: validationReplay.digest,
  });
}

export function createInvalidCandidateArtifactReference(
  input: CandidateArtifactStoreInvalidInput,
): InvalidCandidateArtifactReferenceV1 {
  const diagnosticCodes = [
    ...new Set(input.diagnostics.map(({ code }) => code)),
  ].sort();
  const artifactDigest = digestCanonicalValue({
    bundleDigest: input.bundleDigest,
    diagnosticCodes,
    extensionId: input.extensionId,
    opaqueBundleDigest: digestCanonicalValue(input.bundle),
    scope: input.scope,
    solutionRevisionId: input.solutionRevisionId,
  });
  return invalidCandidateArtifactReferenceV1Schema.parse({
    artifactDigest,
    artifactId: stableRecordId("invalid-candidate", {
      artifactDigest,
      scope: input.scope,
    }),
    bundleDigest: input.bundleDigest,
    classification: "restricted-invalid-ai-authored-candidate",
    contractVersion: 1,
    diagnosticCodes,
    extensionId: input.extensionId,
    scope: input.scope,
    solutionRevisionId: input.solutionRevisionId,
    storedAt: input.storedAt,
  });
}
