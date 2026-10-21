import { betaInfrastructureProposalResponseV1Schema } from "@cloudmarkup/api-contract";
import type { PreparedBetaInfrastructureInput } from "./beta-infrastructure.js";
import {
  digestCanonicalValue,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";

export function assertBoundBetaProposalInput(
  input: PreparedBetaInfrastructureInput,
  record: Pick<AsyncJobRecordV1, "ownership" | "input">,
) {
  if (
    record.input.family !== "architecture-proposal" ||
    input.savedArchitectureDigest !== record.input.subject.contentDigest ||
    (input.proposalVersion === 6 &&
      (digestCanonicalValue(input.validationOwnership) !==
        digestCanonicalValue(record.ownership) ||
        digestCanonicalValue(input.validationSubject) !==
          digestCanonicalValue(record.input.subject)))
  )
    throw new Error("Proposal saved-subject authority mismatch.");
}

/** Shared fresh-publication/retained-replay check. Stored model bytes cannot
 * acquire a different draft, version or catalog applicability binding. */
export function parseBoundBetaProposalResult(
  input: PreparedBetaInfrastructureInput,
  raw: unknown,
) {
  const result =
    betaInfrastructureProposalResponseV1Schema.shape.data.parse(raw);
  if (
    result.architectureDigest !== input.architectureDigest ||
    result.proposal.contractVersion !== input.proposalVersion ||
    (input.proposalVersion === 6 &&
      result.applicability?.catalogDigest !== input.catalogDigest)
  )
    throw new Error(
      "Proposal output does not match its immutable admitted input.",
    );
  return result;
}
