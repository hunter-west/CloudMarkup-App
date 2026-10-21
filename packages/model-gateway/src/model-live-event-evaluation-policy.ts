import { z } from "zod";
import {
  digestCanonicalValue,
  namespacedIdentifierSchema,
  semanticVersionSchema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";

const policySchema = z.object({
  evaluationPolicyId: namespacedIdentifierSchema,
  evaluationPolicyVersion: semanticVersionSchema,
  evaluationPolicyDigest: sha256DigestSchema,
});

/** Existing immutable policy identity. This is not an approval or a replacement. */
export const historicalFullBetaEvaluationPolicyIdentityV2 = Object.freeze({
  evaluationPolicyId: namespacedIdentifierSchema.parse(
    "cloudmarkup.model-evaluation.full-beta",
  ),
  evaluationPolicyVersion: semanticVersionSchema.parse("2.4.0"),
  evaluationPolicyDigest: sha256DigestSchema.parse(
    "sha256:d1e2fdd91f64626630efc49f9bc562d06f80395eaee4fb2699d083ab55b257a6",
  ),
});

const criterionBody = {
  criterionId: "cloudmarkup.live-event-unresolved-issue-criterion",
  criterionVersion: "2.11.0",
  caseId: "evaluation_case_event_driven_image_processing_full_beta_v1",
  sourceDataset: "cloudmarkup.model-evaluation.full-beta",
  topologyCoverage: {
    numerator: 9,
    denominator: 9,
  },
  deterministicValidation: "passed",
  blockingUnknowns: "nonempty-unique-exact-source-issue-bindings",
  issue: {
    source: "ai-generation-repair",
    category: "configuration",
    severity: "warning",
    lifecycle: "current",
    provenance: "exact-input-and-solution-revision",
    summary: "source-question-first-500-characters",
  },
  targetReadiness: "blocked",
  inventedWorkloads: 0,
  inventedApplicationContracts: 0,
  workflows: ["guided:needs-user-input", "professional:needs-user-input"],
  writeAuthority: "none",
  historicalExpectation: "preserved-not-regraded",
} as const;
/** Closed interpretation chosen by policy before a result exists. No raw source. */
Object.freeze(criterionBody.topologyCoverage);
Object.freeze(criterionBody.issue);
Object.freeze(criterionBody.workflows);
Object.freeze(criterionBody);
export const modelLiveEventCriterionV211 = Object.freeze({
  ...criterionBody,
  criterionDigest: digestCanonicalValue(criterionBody),
});
const identity = {
  evaluationPolicyId:
    historicalFullBetaEvaluationPolicyIdentityV2.evaluationPolicyId,
  evaluationPolicyVersion: semanticVersionSchema.parse("2.5.0"),
};
/** Transitive predecessor digest preserves exact dataset, thresholds and budgets. */
export const fullBetaEventEvaluationPolicyV2 = Object.freeze({
  ...identity,
  evaluationPolicyDigest: digestCanonicalValue({
    ...identity,
    predecessorPolicy: historicalFullBetaEvaluationPolicyIdentityV2,
    eventCriterion: modelLiveEventCriterionV211,
  }),
});
function exact(
  a: z.output<typeof policySchema>,
  b: z.output<typeof policySchema>,
) {
  return (
    a.evaluationPolicyId === b.evaluationPolicyId &&
    a.evaluationPolicyVersion === b.evaluationPolicyVersion &&
    a.evaluationPolicyDigest === b.evaluationPolicyDigest
  );
}
/** Only exact known full-beta policies can authorize held report projection. */
export function resolveFullBetaEvaluationPolicyV2(input: unknown) {
  const policy = policySchema.parse(input);
  if (exact(policy, historicalFullBetaEvaluationPolicyIdentityV2))
    return historicalFullBetaEvaluationPolicyIdentityV2;
  if (exact(policy, fullBetaEventEvaluationPolicyV2))
    return fullBetaEventEvaluationPolicyV2;
  throw new Error("The exact full-beta evaluation policy is unavailable.");
}
/** Historical other-policy receipts remain readable; a partial successor claim
 * is never treated as legacy. Issuers call this over an authenticated plan. */
export function selectModelLiveEventValidatorVersion(
  input: unknown,
): "2.8.0" | "2.11.0" {
  const policy = policySchema.parse(input);
  if (exact(policy, fullBetaEventEvaluationPolicyV2)) return "2.11.0";
  if (exact(policy, historicalFullBetaEvaluationPolicyIdentityV2))
    return "2.8.0";
  if (
    (policy.evaluationPolicyId === identity.evaluationPolicyId &&
      policy.evaluationPolicyVersion === identity.evaluationPolicyVersion) ||
    policy.evaluationPolicyDigest ===
      fullBetaEventEvaluationPolicyV2.evaluationPolicyDigest
  )
    throw new Error("The event validator policy binding is contradictory.");
  return "2.8.0";
}
