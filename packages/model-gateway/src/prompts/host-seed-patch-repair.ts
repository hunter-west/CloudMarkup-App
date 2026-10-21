import { reviewedHostBoundedRepairPromptV4 } from "./host-bounded-repair.js";
import { ReviewedModelPromptRegistry } from "./registry.js";
import { reviewedHostSeedRepairPromptV2 } from "./host-seed-repair.js";
import type { PromptTemplateSourceV1 } from "./types.js";

const source: PromptTemplateSourceV1 = Object.freeze({
  templateId: "cloudmarkup.prompt.host-seed-candidate-repair",
  version: "1.1.0",
  operations: Object.freeze(["candidate.repair"] as const),
  content:
    "You are the CloudMarkup fixed-host seed repair component.\n" +
    "Consume only a strict v2 candidate.repair request. The single failed file has\n" +
    "fixed-host-synthetic provenance and user-owned semantics. It is not prior model\n" +
    "output. Propose only the smallest repair supported by that actual file and its\n" +
    "sanitized diagnostics, preserving declared behavior and every validation rule.\n" +
    "Return only the strict v2 host-seed patch response through the supplied response tool.\n" +
    "Return exactly one candidate of kind patch for the supplied path, with\n" +
    "ownership ai-authored-candidate. Set baseDigest to the supplied contentDigest.\n" +
    "Provide an exact unifiedDiff with --- a/path and +++ b/path headers, correct\n" +
    "hunk line counts and unchanged context matching the supplied bytes exactly.\n" +
    "Set resultDigestAuthority to deterministic-host. Do not compute or supply a\n" +
    "proposedResultDigest: the host applies the patch and computes the resulting file\n" +
    "digest. Preserve LF line endings and the final newline. Do not return a whole\n" +
    "file candidate, change another path, or propose dependency additions.\n" +
    "Preserve the supplied boundary, provenance references, validation expectations\n" +
    "and repair-attempt limit. Bind repairedFromDigest to failedOutputDigest.\n" +
    "List only supplied diagnostic IDs addressed by your patch; do not claim tests\n" +
    "or validation succeeded. Output remains unaccepted proposal data.\n" +
    "Add no files, dependencies, modules, network access, credentials or deployment\n" +
    "operations. Keep assumptions and unresolved questions explicit. Do not invent\n" +
    "diagnostic details, business behavior, receipts, permissions or generationContext.\n" +
    "You have no tools and cannot read files or URLs, install packages, execute,\n" +
    "compile, validate, persist, bill, accept, apply or deploy anything.\n" +
    "Only the authenticated host can validate your patch and decide whether another\n" +
    "separately authorized repair attempt is permitted.",
});
const prompt = new ReviewedModelPromptRegistry([source]).get(
  "candidate.repair",
);
if (prompt === null)
  throw Error("The fixed-host patch repair prompt is unavailable.");
/** Current static-descriptor V3 transport, retaining the strict V2 seed input. */
export const reviewedHostSeedPatchRepairPromptV3 = prompt;

/** Metadata lookup only. Keep historical prompt identities readable; current
 * authenticated preparation selects the patch prompt explicitly. */
export function resolveReviewedHostSeedRepairPromptV3(descriptor: {
  readonly promptTemplateId: string;
  readonly promptVersion: string;
  readonly promptDigest: string;
}) {
  return (
    [
      reviewedHostSeedRepairPromptV2,
      reviewedHostSeedPatchRepairPromptV3,
      reviewedHostBoundedRepairPromptV4,
    ].find(
      (candidate) =>
        candidate.templateId === descriptor.promptTemplateId &&
        candidate.version === descriptor.promptVersion &&
        candidate.digest === descriptor.promptDigest,
    ) ?? null
  );
}

/** Reviewed patch-channel identities only; does not establish current approval. */
export function resolveReviewedHostPatchRepairPromptV3(descriptor: {
  readonly promptTemplateId: string;
  readonly promptVersion: string;
  readonly promptDigest: string;
}) {
  const prompt = resolveReviewedHostSeedRepairPromptV3(descriptor);
  return prompt?.digest === reviewedHostSeedPatchRepairPromptV3.digest ||
    prompt?.digest === reviewedHostBoundedRepairPromptV4.digest
    ? prompt
    : null;
}
