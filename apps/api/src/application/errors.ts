import type {
  ApiErrorCode,
  ConflictRecoveryV1,
  FieldIssue,
} from "@cloudmarkup/api-contract";

const statusByCode: Readonly<Record<ApiErrorCode, number>> = {
  access_denied: 403,
  authentication_required: 401,
  conflict: 409,
  idempotency_key_required: 400,
  idempotency_key_reused: 409,
  internal_error: 500,
  invalid_request: 400,
  not_found: 404,
  payload_too_large: 413,
  precondition_failed: 412,
  precondition_required: 428,
  rate_limited: 429,
  service_unavailable: 503,
  unsupported_version: 422,
};

export class ApplicationError extends Error {
  readonly code: ApiErrorCode;
  readonly conflict: ConflictRecoveryV1 | undefined;
  readonly fieldIssues: readonly FieldIssue[] | undefined;
  readonly status: number;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: {
      readonly conflict?: ConflictRecoveryV1;
      readonly fieldIssues?: readonly FieldIssue[];
    } = {},
  ) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
    this.conflict = options.conflict;
    this.status = statusByCode[code];
    this.fieldIssues = options.fieldIssues;
  }
}
