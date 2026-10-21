import {
  assertCandidateArtifactSupersession,
  createCandidateArtifactReviewBinding,
  createCandidateArtifactReference,
  createInvalidCandidateArtifactReference,
  type CandidateArtifactReviewBindingV1,
  type CandidateArtifactStoreBindReviewInput,
  type CandidateArtifactStore,
  type CandidateArtifactStoreInvalidInput,
  type CandidateArtifactStorePutInput,
  type CandidateArtifactStoreSupersedeInput,
  type CandidateArtifactLifecycleV1,
  type StoredCandidateArtifactV1,
} from "./artifact-store.js";
import type {
  CandidateArtifactReferenceV1,
  CandidateScopeV1,
  InvalidCandidateArtifactReferenceV1,
} from "./contracts.js";
import { utcTimestampSchema, type Sha256Digest } from "@cloudmarkup/schemas";

import { digestCanonicalValue } from "./security.js";

function scopeKey(scope: CandidateScopeV1): string {
  return `${scope.organizationId}\u0000${scope.projectId}`;
}

function cloneStored(
  value: StoredCandidateArtifactV1,
): StoredCandidateArtifactV1 {
  return structuredClone(value);
}

export class InMemoryCandidateArtifactStore implements CandidateArtifactStore {
  readonly #artifacts = new Map<string, StoredCandidateArtifactV1>();
  readonly #invalid = new Map<
    string,
    Readonly<{
      opaqueBundle: unknown;
      reference: InvalidCandidateArtifactReferenceV1;
      scopeKey: string;
    }>
  >();

  public async put(
    input: CandidateArtifactStorePutInput,
  ): Promise<CandidateArtifactReferenceV1> {
    await Promise.resolve();
    const reference = createCandidateArtifactReference(input);
    const value: StoredCandidateArtifactV1 = {
      files: structuredClone(input.files),
      lifecycle: { state: "current" },
      reference,
      targetKind: input.targetKind,
      ...(input.validationReplay === undefined
        ? {}
        : { validationReplay: structuredClone(input.validationReplay) }),
    };
    const existing = this.#artifacts.get(reference.artifactId);
    if (existing !== undefined) {
      if (existing.reference.artifactDigest !== reference.artifactDigest) {
        throw new Error("Candidate artifact identity collision.");
      }
      const { reviewBinding: _reviewBinding, ...existingArtifactMetadata } =
        existing;
      void _reviewBinding;
      if (
        digestCanonicalValue(existingArtifactMetadata) !==
        digestCanonicalValue(value)
      ) {
        throw new Error(
          "Candidate artifact storage is immutable and cannot overwrite metadata.",
        );
      }
      return structuredClone(existing.reference);
    }
    this.#artifacts.set(reference.artifactId, cloneStored(value));
    return structuredClone(reference);
  }

  public async bindReview(
    input: CandidateArtifactStoreBindReviewInput,
  ): Promise<CandidateArtifactReviewBindingV1> {
    await Promise.resolve();
    const value = this.#artifacts.get(input.artifactId);
    if (
      value?.lifecycle.state !== "current" ||
      value.reference.artifactDigest !== input.expectedArtifactDigest ||
      scopeKey(value.reference.scope) !== scopeKey(input.scope)
    ) {
      throw new Error(
        "Candidate review binding failed because the artifact is stale or outside the exact authorized scope.",
      );
    }
    const binding = createCandidateArtifactReviewBinding({
      reference: value.reference,
      review: input,
    });
    if (Date.parse(binding.boundAt) < Date.parse(value.reference.storedAt)) {
      throw new Error(
        "Candidate review binding cannot predate the immutable artifact.",
      );
    }
    if (value.reviewBinding !== undefined) {
      if (
        digestCanonicalValue(value.reviewBinding) !==
        digestCanonicalValue(binding)
      ) {
        throw new Error(
          "Candidate artifact review binding is immutable and cannot be rebound.",
        );
      }
      return structuredClone(value.reviewBinding);
    }
    this.#artifacts.set(input.artifactId, {
      ...cloneStored(value),
      reviewBinding: structuredClone(binding),
    });
    return structuredClone(binding);
  }

  public async supersede(
    input: CandidateArtifactStoreSupersedeInput,
  ): Promise<CandidateArtifactReferenceV1> {
    await Promise.resolve();
    const previous = this.#artifacts.get(input.supersededArtifactId);
    if (
      previous?.lifecycle.state !== "current" ||
      previous.reference.artifactDigest !==
        input.expectedSupersededArtifactDigest ||
      scopeKey(previous.reference.scope) !== scopeKey(input.scope) ||
      previous.targetKind !== input.targetKind ||
      previous.reviewBinding?.reviewId !==
        input.expectedSupersededReview.reviewId ||
      previous.reviewBinding.reviewDigest !==
        input.expectedSupersededReview.reviewDigest
    ) {
      throw new Error(
        "Candidate supersession failed because the predecessor is stale or unauthorized.",
      );
    }
    const reference = createCandidateArtifactReference(input);
    if (this.#artifacts.has(reference.artifactId)) {
      throw new Error(
        "Candidate supersession cannot replay or overwrite a stored artifact.",
      );
    }
    const reviewBinding = createCandidateArtifactReviewBinding({
      reference,
      review: input.successorReview,
    });
    if (reviewBinding.boundAt !== reference.storedAt) {
      throw new Error(
        "Atomic candidate supersession must bind the successor review at its exact storage time.",
      );
    }
    const next: StoredCandidateArtifactV1 = {
      files: structuredClone(input.files),
      lifecycle: { state: "current" },
      reference,
      reviewBinding,
      targetKind: input.targetKind,
      ...(input.validationReplay === undefined
        ? {}
        : { validationReplay: structuredClone(input.validationReplay) }),
    };
    assertCandidateArtifactSupersession({ next: reference, previous });
    const supersededAt = utcTimestampSchema.parse(input.supersededAt);
    if (supersededAt !== reference.storedAt) {
      throw new Error(
        "Candidate supersession time must bind the exact successor storage time.",
      );
    }
    this.#artifacts.set(reference.artifactId, cloneStored(next));
    this.#artifacts.set(input.supersededArtifactId, {
      ...cloneStored(previous),
      lifecycle: {
        state: "superseded",
        successorArtifactDigest: reference.artifactDigest,
        successorArtifactId: reference.artifactId,
        supersededAt,
      },
    });
    return structuredClone(reference);
  }
  public async preserveInvalid(
    input: CandidateArtifactStoreInvalidInput,
  ): Promise<InvalidCandidateArtifactReferenceV1> {
    await Promise.resolve();
    const reference = createInvalidCandidateArtifactReference(input);
    const existing = this.#invalid.get(reference.artifactId);
    if (
      existing !== undefined &&
      existing.reference.artifactDigest !== reference.artifactDigest
    ) {
      throw new Error("Invalid candidate artifact identity collision.");
    }
    this.#invalid.set(reference.artifactId, {
      opaqueBundle: structuredClone(input.bundle),
      reference: structuredClone(reference),
      scopeKey: scopeKey(input.scope),
    });
    return structuredClone(reference);
  }

  public async read(input: {
    readonly artifactId: string;
    readonly expectedArtifactDigest: Sha256Digest;
    readonly scope: CandidateScopeV1;
  }): Promise<StoredCandidateArtifactV1> {
    await Promise.resolve();
    const value = this.#artifacts.get(input.artifactId);
    if (
      value?.lifecycle.state !== "current" ||
      scopeKey(value.reference.scope) !== scopeKey(input.scope) ||
      value.reference.artifactDigest !== input.expectedArtifactDigest
    ) {
      throw new Error(
        "Candidate artifact is unavailable for the exact authorized scope.",
      );
    }
    return cloneStored(value);
  }

  public async readImmutable(input: {
    readonly artifactId: string;
    readonly expectedArtifactDigest: Sha256Digest;
    readonly scope: CandidateScopeV1;
  }): Promise<StoredCandidateArtifactV1> {
    await Promise.resolve();
    const value = this.#artifacts.get(input.artifactId);
    if (
      value === undefined ||
      scopeKey(value.reference.scope) !== scopeKey(input.scope) ||
      value.reference.artifactDigest !== input.expectedArtifactDigest
    ) {
      throw new Error(
        "Candidate artifact version is unavailable for the exact authorized scope.",
      );
    }
    return cloneStored(value);
  }

  public artifactLifecycle(
    artifactId: string,
  ): CandidateArtifactLifecycleV1 | undefined {
    const lifecycle = this.#artifacts.get(artifactId)?.lifecycle;
    return lifecycle === undefined ? undefined : structuredClone(lifecycle);
  }
  public invalidArtifactCount(): number {
    return this.#invalid.size;
  }

  public artifactCount(): number {
    return this.#artifacts.size;
  }
}
