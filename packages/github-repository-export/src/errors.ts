export const GITHUB_EXPORT_ERROR_CODES = [
  "authorization-denied",
  "artifact-invalid",
  "branch-conflict",
  "destination-invalid",
  "github-permission-denied",
  "installation-revoked",
  "installation-link-expired",
  "export-in-progress",
  "installation-link-invalid",
  "installation-link-replayed",
  "import-blocked",
  "import-in-progress",
  "integration-not-found",
  "invalid-request",
  "ungrounded-claim",
  "path-conflict",
  "preview-blocked",
  "preview-expired",
  "public-repository-workflow-denied",
  "rate-limited",
  "repository-changed",
  "repository-not-found",
  "secret-unavailable",
  "service-unavailable",
  "webhook-invalid",
  "webhook-replayed",
  "workflow-confirmation-required",
] as const;

export type GitHubExportErrorCode = (typeof GITHUB_EXPORT_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<GitHubExportErrorCode, string>> = {
  "authorization-denied":
    "You are not allowed to perform this GitHub export action.",
  "artifact-invalid":
    "The approved Solution package failed its integrity checks.",
  "branch-conflict": "The requested feature branch is no longer available.",
  "destination-invalid":
    "The destination folder is not a safe repository path.",
  "export-in-progress":
    "An identical GitHub export is already in progress. Retry after it finishes.",
  "github-permission-denied":
    "The GitHub App does not have the required repository permission.",
  "installation-revoked": "The GitHub App installation is no longer available.",
  "installation-link-expired":
    "The GitHub App installation link has expired. Start a new connection.",
  "installation-link-invalid":
    "The GitHub App installation link could not be verified.",
  "installation-link-replayed":
    "The GitHub App installation link has already been used.",
  "import-blocked":
    "The repository import was blocked by its path, type, size, or content policy.",
  "import-in-progress":
    "An identical repository import is already in progress. Retry after it finishes.",
  "integration-not-found": "The GitHub App connection is unavailable.",
  "invalid-request": "The GitHub export request is invalid.",
  "ungrounded-claim":
    "Repository interpretation returned a claim without selected source evidence.",
  "path-conflict":
    "Repository files conflict with the approved package ownership rules.",
  "preview-blocked":
    "The repository export preview has issues that must be resolved.",
  "preview-expired": "The repository export preview is no longer current.",
  "public-repository-workflow-denied":
    "The reviewed plan workflow can only be exported to a private repository.",
  "rate-limited": "GitHub temporarily limited this request. Try again later.",
  "repository-changed":
    "The repository changed after preview. Create a new preview.",
  "repository-not-found":
    "The selected repository is no longer available to the GitHub App.",
  "secret-unavailable": "The GitHub App secret configuration is unavailable.",
  "service-unavailable": "GitHub export is temporarily unavailable.",
  "webhook-invalid": "The GitHub webhook could not be verified.",
  "webhook-replayed": "The GitHub webhook delivery was already processed.",
  "workflow-confirmation-required":
    "Every workflow file requires explicit confirmation before export.",
};

export class GitHubExportError extends Error {
  readonly code: GitHubExportErrorCode;
  readonly retryAfterSeconds?: number;
  readonly transient: boolean;

  constructor(
    code: GitHubExportErrorCode,
    options: {
      readonly retryAfterSeconds?: number;
      readonly transient?: boolean;
    } = {},
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = "GitHubExportError";
    this.code = code;
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
    this.transient = options.transient ?? false;
  }
}

export function safeGitHubExportError(error: unknown): GitHubExportError {
  if (error instanceof GitHubExportError) return error;
  return new GitHubExportError("service-unavailable", { transient: true });
}
