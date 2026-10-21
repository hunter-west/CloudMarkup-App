import { describe, expect, it } from "vitest";

import {
  createCandidateArtifactReference,
  getCandidateArtifactDigest,
  type CandidateArtifactReviewIdentityV1,
  type CandidateArtifactStorePutInput,
  type CandidateArtifactStoreSupersedeInput,
} from "./artifact-store.js";
import { candidateArtifactOriginV1Schema } from "./contracts.js";
import type { MaterializedCandidateFile } from "./materializer.js";
import { sha256Text } from "./security.js";
import { InMemoryCandidateArtifactStore } from "./testing.js";

const storedAt = "2026-08-21T12:00:00Z";
const bundleDigest = sha256Text("candidate-bundle");
const originalContent = "export const answer = 42;\n";

const primaryScope = {
  organizationId: "organization-primary",
  projectId: "project-primary",
} as const;

function candidateFile(path = "application/extensions/custom.ts") {
  return {
    content: originalContent,
    digest: sha256Text(originalContent),
    ownership: "ai-authored-candidate" as const,
    path,
    sizeBytes: new TextEncoder().encode(originalContent).byteLength,
    sourceKind: "file" as const,
  };
}

function putInput(
  files: readonly MaterializedCandidateFile[] = [candidateFile()],
): CandidateArtifactStorePutInput {
  return {
    bundleDigest,
    extensionId: "extension-custom",
    files,
    scope: primaryScope,
    solutionRevisionId: "solution-revision-1",
    storedAt,
    targetKind: "application" as const,
  };
}

function reviewIdentity(label: string): CandidateArtifactReviewIdentityV1 {
  return {
    reviewDigest: sha256Text(`candidate-review:${label}`),
    reviewId: `candidate-review-${label}`,
  };
}

function supersessionInput(input: {
  readonly content: string;
  readonly editId: string;
  readonly editedAt: string;
  readonly previous: ReturnType<typeof createCandidateArtifactReference>;
  readonly previousFile: MaterializedCandidateFile;
  readonly previousReview: CandidateArtifactReviewIdentityV1;
  readonly successorReview: CandidateArtifactReviewIdentityV1;
}): CandidateArtifactStoreSupersedeInput {
  const file = {
    ...input.previousFile,
    content: input.content,
    digest: sha256Text(input.content),
    sizeBytes: new TextEncoder().encode(input.content).byteLength,
  };
  const previousEdits =
    input.previous.origin.kind === "user-modified"
      ? input.previous.origin.edits
      : [];
  return {
    ...putInput([file]),
    bundleDigest: sha256Text(`candidate-bundle:${input.content}`),
    origin: candidateArtifactOriginV1Schema.parse({
      baseArtifactDigest:
        input.previous.origin.kind === "user-modified"
          ? input.previous.origin.baseArtifactDigest
          : input.previous.artifactDigest,
      baseArtifactId:
        input.previous.origin.kind === "user-modified"
          ? input.previous.origin.baseArtifactId
          : input.previous.artifactId,
      edits: [
        ...previousEdits,
        {
          authorizationDecisionId: `authorization-${input.editId}`,
          editId: input.editId,
          editedAt: input.editedAt,
          editedBy: "actor-reviewer",
          path: file.path,
          priorDigest: input.previousFile.digest,
          resultDigest: file.digest,
        },
      ],
      kind: "user-modified",
      modelOutputDigest: input.previous.origin.modelOutputDigest,
      parentArtifactDigest: input.previous.artifactDigest,
      parentArtifactId: input.previous.artifactId,
    }),
    storedAt: input.editedAt,
    supersededArtifactId: input.previous.artifactId,
    expectedSupersededArtifactDigest: input.previous.artifactDigest,
    expectedSupersededReview: input.previousReview,
    successorReview: {
      ...input.successorReview,
      boundAt: input.editedAt,
    },
    supersededAt: input.editedAt,
  };
}

describe("candidate artifact storage", () => {
  it("fails closed across organization and project scopes", async () => {
    const store = new InMemoryCandidateArtifactStore();
    const reference = await store.put(putInput());

    await expect(
      store.read({
        artifactId: reference.artifactId,
        expectedArtifactDigest: reference.artifactDigest,
        scope: {
          ...primaryScope,
          organizationId: "organization-other",
        },
      }),
    ).rejects.toThrow(/exact authorized scope/u);
    await expect(
      store.read({
        artifactId: reference.artifactId,
        expectedArtifactDigest: reference.artifactDigest,
        scope: { ...primaryScope, projectId: "project-other" },
      }),
    ).rejects.toThrow(/exact authorized scope/u);
    await expect(
      store.read({
        artifactId: reference.artifactId,
        expectedArtifactDigest: sha256Text("wrong-artifact"),
        scope: primaryScope,
      }),
    ).rejects.toThrow(/exact authorized scope/u);
  });

  it("clones writes and reads so callers cannot mutate stored candidate content", async () => {
    const store = new InMemoryCandidateArtifactStore();
    const inputFile = candidateFile();
    const reference = await store.put(putInput([inputFile]));

    inputFile.content = "tampered after write\n";
    const firstRead = await store.read({
      artifactId: reference.artifactId,
      expectedArtifactDigest: reference.artifactDigest,
      scope: primaryScope,
    });
    expect(firstRead.files[0]?.content).toBe(originalContent);

    const mutableRead = firstRead.files[0] as { content: string } | undefined;
    if (mutableRead === undefined) {
      throw new Error("The stored fixture must contain one candidate file.");
    }
    mutableRead.content = "tampered after read\n";

    const secondRead = await store.read({
      artifactId: reference.artifactId,
      expectedArtifactDigest: reference.artifactDigest,
      scope: primaryScope,
    });
    expect(secondRead.files[0]?.content).toBe(originalContent);
    expect(
      getCandidateArtifactDigest({
        bundleDigest: secondRead.reference.bundleDigest,
        extensionId: secondRead.reference.extensionId,
        files: secondRead.files,
        scope: secondRead.reference.scope,
        solutionRevisionId: secondRead.reference.solutionRevisionId,
        targetKind: secondRead.targetKind,
      }),
    ).toBe(reference.artifactDigest);
  });

  it("derives stable identity independently of candidate file ordering", () => {
    const first = candidateFile("application/extensions/a.ts");
    const second = candidateFile("application/extensions/b.ts");
    const forward = createCandidateArtifactReference(putInput([first, second]));
    const reverse = createCandidateArtifactReference(putInput([second, first]));

    expect(reverse.artifactDigest).toBe(forward.artifactDigest);
    expect(reverse.artifactId).toBe(forward.artifactId);
    expect(createCandidateArtifactReference(putInput([first, second]))).toEqual(
      forward,
    );
  });

  it("rejects a file whose declared digest does not match its exact content", () => {
    expect(() =>
      createCandidateArtifactReference(
        putInput([{ ...candidateFile(), digest: sha256Text("not-content") }]),
      ),
    ).toThrow(/exact content digests/u);
  });

  it("is idempotent only for exact immutable stored metadata", async () => {
    const store = new InMemoryCandidateArtifactStore();
    const first = await store.put(putInput());
    const review = reviewIdentity("bound");
    const bindingInput = {
      artifactId: first.artifactId,
      boundAt: storedAt,
      expectedArtifactDigest: first.artifactDigest,
      ...review,
      scope: primaryScope,
    };
    await expect(
      store.bindReview({
        ...bindingInput,
        boundAt: "2026-08-21T11:59:59Z",
      }),
    ).rejects.toThrow(/cannot predate/u);
    const binding = await store.bindReview(bindingInput);
    expect(await store.bindReview(bindingInput)).toEqual(binding);
    const replay = await store.put(putInput());

    expect(replay).toEqual(first);
    expect(store.artifactCount()).toBe(1);
    await expect(
      store.bindReview({
        ...bindingInput,
        reviewDigest: sha256Text("different-review"),
      }),
    ).rejects.toThrow(/immutable.*rebound/u);
    await expect(
      store.bindReview({
        ...bindingInput,
        scope: { ...primaryScope, projectId: "project-other" },
      }),
    ).rejects.toThrow(/exact authorized scope/u);

    await expect(
      store.put({
        ...putInput(),
        storedAt: "2026-08-21T12:00:01Z",
      }),
    ).rejects.toThrow(/immutable.*metadata/u);

    const stored = await store.read({
      artifactId: first.artifactId,
      expectedArtifactDigest: first.artifactDigest,
      scope: primaryScope,
    });
    expect(stored.reference.storedAt).toBe(storedAt);
    expect(stored.reviewBinding).toEqual(binding);
    expect(store.artifactCount()).toBe(1);
  });

  it("atomically supersedes only the current artifact and preserves repeated edit lineage", async () => {
    const store = new InMemoryCandidateArtifactStore();
    const baseFile = candidateFile();
    const base = await store.put(putInput([baseFile]));
    const baseReview = reviewIdentity("base");
    const firstReview = reviewIdentity("first-edit");
    const firstContent = "export const answer = 43;\n";
    const firstInput = supersessionInput({
      content: firstContent,
      editId: "candidate-edit-first",
      editedAt: "2026-08-21T12:01:00Z",
      previous: base,
      previousFile: baseFile,
      previousReview: baseReview,
      successorReview: firstReview,
    });
    await expect(store.supersede(firstInput)).rejects.toThrow(
      /stale|review binding/u,
    );
    await store.bindReview({
      artifactId: base.artifactId,
      boundAt: storedAt,
      expectedArtifactDigest: base.artifactDigest,
      ...baseReview,
      scope: primaryScope,
    });
    await expect(
      store.supersede({
        ...firstInput,
        expectedSupersededReview: reviewIdentity("wrong-base"),
      }),
    ).rejects.toThrow(/stale|review binding/u);
    const first = await store.supersede(firstInput);

    await expect(
      store.read({
        artifactId: base.artifactId,
        expectedArtifactDigest: base.artifactDigest,
        scope: primaryScope,
      }),
    ).rejects.toThrow(/unavailable/u);
    expect(store.artifactLifecycle(base.artifactId)).toEqual({
      state: "superseded",
      successorArtifactDigest: first.artifactDigest,
      successorArtifactId: first.artifactId,
      supersededAt: first.storedAt,
    });

    const firstStored = await store.read({
      artifactId: first.artifactId,
      expectedArtifactDigest: first.artifactDigest,
      scope: primaryScope,
    });
    expect(firstStored.reviewBinding).toEqual(
      expect.objectContaining(firstReview),
    );
    const firstFile = firstStored.files[0];
    if (firstFile === undefined) throw new Error("Missing first edited file.");
    const secondInput = supersessionInput({
      content: "export const answer = 44;\n",
      editId: "candidate-edit-second",
      editedAt: "2026-08-21T12:02:00Z",
      previous: first,
      previousFile: firstFile,
      previousReview: firstReview,
      successorReview: reviewIdentity("second-edit"),
    });
    if (secondInput.origin?.kind !== "user-modified") {
      throw new Error("Expected a repeated edit input.");
    }
    await expect(
      store.supersede({
        ...secondInput,
        origin: {
          ...secondInput.origin,
          edits: secondInput.origin.edits.map((edit, index) =>
            index === 1
              ? { ...edit, priorDigest: sha256Text("wrong-edit-parent") }
              : edit,
          ),
        },
      }),
    ).rejects.toThrow(/per-path digest chain/u);
    expect(store.artifactLifecycle(first.artifactId)).toEqual({
      state: "current",
    });

    const second = await store.supersede(secondInput);

    expect(second.origin).toEqual(
      expect.objectContaining({
        baseArtifactDigest: base.artifactDigest,
        baseArtifactId: base.artifactId,
        parentArtifactDigest: first.artifactDigest,
        parentArtifactId: first.artifactId,
      }),
    );
    if (second.origin.kind !== "user-modified") {
      throw new Error("Expected repeated user modification lineage.");
    }
    expect(second.origin.edits).toHaveLength(2);
    expect(second.origin.edits[1]?.priorDigest).toBe(
      second.origin.edits[0]?.resultDigest,
    );
    await expect(store.supersede(secondInput)).rejects.toThrow(
      /stale|replay|overwrite/u,
    );
    await expect(
      store.read({
        artifactId: first.artifactId,
        expectedArtifactDigest: first.artifactDigest,
        scope: primaryScope,
      }),
    ).rejects.toThrow(/unavailable/u);
    expect(store.artifactCount()).toBe(3);
  });

  it("leaves the predecessor current when lineage validation rejects the successor", async () => {
    const store = new InMemoryCandidateArtifactStore();
    const baseFile = candidateFile();
    const base = await store.put(putInput([baseFile]));
    const baseReview = reviewIdentity("invalid-lineage-base");
    await store.bindReview({
      artifactId: base.artifactId,
      boundAt: storedAt,
      expectedArtifactDigest: base.artifactDigest,
      ...baseReview,
      scope: primaryScope,
    });
    const valid = supersessionInput({
      content: "export const answer = 45;\n",
      editId: "candidate-edit-invalid-lineage",
      editedAt: "2026-08-21T12:03:00Z",
      previous: base,
      previousFile: baseFile,
      previousReview: baseReview,
      successorReview: reviewIdentity("invalid-lineage-successor"),
    });
    if (valid.origin?.kind !== "user-modified") {
      throw new Error("Expected user-modified lineage fixture.");
    }

    await expect(
      store.supersede({
        ...valid,
        origin: {
          ...valid.origin,
          parentArtifactDigest: sha256Text("wrong-predecessor"),
        },
      }),
    ).rejects.toThrow(/exact current predecessor authority/u);

    const current = await store.read({
      artifactId: base.artifactId,
      expectedArtifactDigest: base.artifactDigest,
      scope: primaryScope,
    });
    expect(current.lifecycle).toEqual({ state: "current" });
    expect(store.artifactCount()).toBe(1);
  });
});
