import type { AuthorizedOrganizationScope } from "./persistence.js";

export interface CompleteDeterministicValidationInput {
  readonly contentSha256: string;
  readonly draftId: string;
  readonly draftVersion: number;
  readonly projectId: string;
  readonly semanticSha256: string;
  readonly validationRunId: string;
  readonly visualSha256: string;
}

/**
 * Produces durable, exact-draft validation evidence before an immutable
 * architecture revision is admitted. Implementations must fail closed.
 */
export interface RevisionValidation {
  ensureComplete(
    scope: AuthorizedOrganizationScope,
    input: CompleteDeterministicValidationInput,
  ): Promise<void>;
}
