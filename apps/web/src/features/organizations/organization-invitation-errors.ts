import { ApiClientError } from "@cloudmarkup/api-contract";

export function invitationErrorMessage(error: unknown): string {
  const code =
    error instanceof ApiClientError ? error.envelope.error.code : undefined;
  if (
    error instanceof ApiClientError &&
    code === "conflict" &&
    error.envelope.error.fieldIssues?.some(
      (issue) =>
        issue.code === "organization-membership.member-limit.v1" &&
        JSON.stringify(issue.path) ===
          JSON.stringify(["organization", "members"]),
    ) === true
  ) {
    return "This workspace has reached its total member limit, including the owner. Ask its owner to review the current sharing plan; this invitation has not added a member.";
  }
  switch (code) {
    case "authentication_required":
      return "Sign in again before continuing. Your invitation has not been discarded.";
    case "access_denied":
      return "A recent sign-in, current permission, and an eligible sharing plan are required. Ask the workspace owner to review access.";
    case "not_found":
      return "This invitation or workspace is unavailable. Ask its owner for a new invitation.";
    case "conflict":
      return "The invitation cannot continue with the current workspace state. Ask its owner to check member capacity and invitation status.";
    case "idempotency_key_reused":
      return "This attempt conflicts with an earlier request. It has not been replaced automatically.";
    default:
      return "The result could not be confirmed. Retry checks the same invitation; it does not create a new attempt.";
  }
}
