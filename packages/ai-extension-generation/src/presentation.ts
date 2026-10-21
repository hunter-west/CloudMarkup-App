/**
 * Browser-safe candidate presentation boundary. It intentionally excludes
 * model invocation, sandbox execution, repository mutation, and acceptance
 * services.
 */
export {
  candidateArtifactLifecycleV1Schema,
  candidateInspectionV1Schema,
  candidateReviewRecordV1Schema,
  candidateValidationReplayV1Schema,
  getCandidateReviewDigest,
  type CandidateArtifactLifecycleV1,
  type CandidateInspectionV1,
  type CandidateReviewRecordV1,
  type CandidateValidationReplayV1,
} from "./presentation-contracts.js";
export {
  digestCanonicalValue,
  sha256Text,
  utf8ByteLength,
} from "./presentation-support.js";
