import {
  modelRepositoryInterpretationRequestV1Schema,
  modelRepositoryInterpretationResponseV1Schema,
  modelRequestedModeV1Schema,
} from "./model-gateway-v1.js";
import { repositorySnapshotV1Schema } from "./repository-snapshot-v1.js";
import { observedSolutionV1Schema } from "./observed-solution-v1.js";
import { serializeCanonicalJson } from "./canonical-json.js";

/** Read-only presentation of deterministic observations and separately unverified
 * model claims. Exact citations do not establish the semantic truth of a claim. */
export function projectRepositoryInterpretationReviewV1(input: {
  readonly request: unknown;
  readonly response: unknown;
  readonly snapshot: unknown;
  readonly observedSolution: unknown;
  readonly requestedMode: unknown;
}) {
  const request = modelRepositoryInterpretationRequestV1Schema.parse(
    input.request,
  );
  const response = modelRepositoryInterpretationResponseV1Schema.parse(
    input.response,
  );
  const snapshot = repositorySnapshotV1Schema.parse(input.snapshot);
  const observed = observedSolutionV1Schema.parse(input.observedSolution);
  const mode = modelRequestedModeV1Schema.parse(input.requestedMode);
  if (
    request.repositorySnapshotId !== snapshot.snapshotId ||
    request.repositorySnapshotDigest !== snapshot.snapshotDigest ||
    request.commitSha !== snapshot.revision.commitSha ||
    observed.provenance.repositorySnapshotId !== snapshot.snapshotId ||
    observed.provenance.repositorySnapshotDigest !== snapshot.snapshotDigest ||
    observed.provenance.commitSha !== snapshot.revision.commitSha ||
    request.evidence.some(
      (e) =>
        !snapshot.files.some(
          (f) => f.path === e.path && f.checksum === e.fileChecksum,
        ),
    )
  )
    throw Error("Repository review requires the exact imported source.");
  const claims = response.claims.map((claim) => ({
    ...claim,
    status: "unverified-model-claim" as const,
    citations: claim.evidenceReferences.map((reference) => {
      const source = request.evidence.find(
        (e) =>
          reference.kind === "repository-evidence" &&
          reference.referenceId === e.evidenceId &&
          reference.path === e.path &&
          reference.digest === e.fileChecksum &&
          reference.location !== undefined &&
          serializeCanonicalJson(reference.location) ===
            serializeCanonicalJson(e.location),
      );
      return { reference, source: source ?? null };
    }),
  }));
  return {
    explanation:
      mode === "guided"
        ? "Compare the imported observations with the assistant’s suggestions. A source citation does not confirm a suggestion."
        : "Review deterministic observations and unverified model claims against the exact repository snapshot.",
    semantic: {
      contractVersion: 1 as const,
      writeAuthority: "none" as const,
      state: "review-only" as const,
      snapshotId: snapshot.snapshotId,
      snapshotDigest: snapshot.snapshotDigest,
      commitSha: snapshot.revision.commitSha,
      observations: observed,
      parseFindings: snapshot.parseFindings,
      claims,
      assumptions: response.proposalContext.assumptions,
      unknowns: response.proposalContext.unknowns,
    },
  };
}
