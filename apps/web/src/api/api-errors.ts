import {
  ApiClientError,
  ApiGatewayError,
  ApiNetworkError,
  apiErrorEnvelopeV1Schema,
  type ApiErrorCode,
  type ConflictRecoveryV1,
  type FieldIssue,
} from "@cloudmarkup/api-contract";

export interface MappedApiError {
  readonly code: ApiErrorCode | "network_unavailable" | "unexpected_error";
  readonly message: string;
  readonly sessionExpired: boolean;
  readonly correlationId?: string;
  readonly fieldIssues?: readonly Readonly<FieldIssue>[];
  readonly conflict?: Readonly<ConflictRecoveryV1>;
}

const safeMessages: Readonly<Record<ApiErrorCode, string>> = {
  authentication_required: "Your session expired. Sign in again to continue.",
  access_denied:
    "You do not have permission to perform this action. Ask the project owner to check your access.",
  conflict:
    "This change conflicts with the current state. Review the latest details before trying again.",
  invalid_request:
    "The request could not be accepted. Review the request details and try again.",
  not_found:
    "The requested resource is unavailable. Return to the project and check your access.",
  payload_too_large:
    "The request is too large. Reduce its size before trying again.",
  precondition_failed:
    "The server draft changed after this page loaded. Compare it with your changes before trying again.",
  precondition_required:
    "The request is missing a required version check. Keep a copy of your work and reload this page.",
  idempotency_key_required:
    "The request is missing recovery information. Keep a copy of your work and reload this page.",
  idempotency_key_reused:
    "This request's recovery information belongs to another change. Check the original request's status before trying again.",
  unsupported_version:
    "This version of the request is unavailable. Keep a copy of your work and reload this page.",
  rate_limited: "The request limit was reached. Wait before trying again.",
  service_unavailable:
    "The service is temporarily unavailable. Check status before trying again.",
  internal_error:
    "The request could not be completed. Check its status before trying again.",
};

export function mapApiError(error: unknown): MappedApiError {
  if (error instanceof ApiClientError) {
    const parsed = apiErrorEnvelopeV1Schema.safeParse(error.envelope);
    if (parsed.success) {
      const detail = parsed.data.error;
      // Keep validated selectors/version evidence; remote prose is not UI copy.
      return {
        code: detail.code,
        message: safeMessages[detail.code],
        sessionExpired: detail.code === "authentication_required",
        correlationId: detail.correlationId,
        ...(detail.conflict ? { conflict: detail.conflict } : {}),
        ...(detail.fieldIssues
          ? {
              fieldIssues: detail.fieldIssues.map(({ code, path }) => ({
                code,
                path,
                message: "Review this field and enter a valid value.",
              })),
            }
          : {}),
      };
    }
  }

  if (error instanceof ApiGatewayError) {
    return {
      code: "service_unavailable",
      message: safeMessages.service_unavailable,
      sessionExpired: false,
    };
  }

  if (error instanceof ApiNetworkError) {
    return {
      code: "network_unavailable",
      message: "The server is unavailable. Local recovery remains separate.",
      sessionExpired: false,
    };
  }

  return {
    code: "unexpected_error",
    message:
      "The request could not be completed. Check its status before trying again.",
    sessionExpired: false,
  };
}

export function isApiErrorCode(error: unknown, code: ApiErrorCode): boolean {
  return error instanceof ApiClientError && error.envelope.error.code === code;
}
