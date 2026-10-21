import { ApplicationError } from "./errors.js";

export const MAX_AUTHORIZATION_HEADER_BYTES = 16_384;
export const DEFAULT_RECENT_AUTHENTICATION_MAX_AGE_MS = 10 * 60 * 1_000;
export const DEFAULT_AUTHENTICATION_FUTURE_SKEW_MS = 60 * 1_000;

export type AuthenticationSource =
  "cognito" | "local-development" | "local-owner" | "test";

/**
 * Trusted request identity produced only by verified authentication middleware.
 * Tenant, role, ownership, and permissions deliberately do not belong here.
 */
export interface Principal {
  readonly authenticatedAt: string;
  readonly authenticationSource: AuthenticationSource;
  readonly expiresAt: string;
  readonly principalId: string;
  readonly sessionId: string;
}

export interface PrincipalResolver {
  resolve(authorization: string | undefined): Promise<Principal | null>;
}

export interface ExternalPrincipalReference {
  readonly issuer: string;
  readonly provider: "cognito";
  readonly subject: string;
}

export interface PrincipalDirectory {
  resolveActivePrincipal(
    reference: ExternalPrincipalReference,
  ): Promise<{ readonly principalId: string } | null>;
}

export function parseBearerToken(
  authorization: string | undefined,
): string | null {
  if (
    authorization === undefined ||
    new TextEncoder().encode(authorization).byteLength >
      MAX_AUTHORIZATION_HEADER_BYTES
  ) {
    return null;
  }

  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] ?? null;
}

export function requireRecentAuthentication(
  principal: Principal,
  now: Date,
  options: {
    readonly futureSkewMs?: number;
    readonly maxAgeMs?: number;
  } = {},
): void {
  const authenticatedAt = Date.parse(principal.authenticatedAt);
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_RECENT_AUTHENTICATION_MAX_AGE_MS;
  const futureSkewMs =
    options.futureSkewMs ?? DEFAULT_AUTHENTICATION_FUTURE_SKEW_MS;
  const age = now.getTime() - authenticatedAt;

  if (
    !Number.isFinite(authenticatedAt) ||
    age < -futureSkewMs ||
    age > maxAgeMs
  ) {
    throw new ApplicationError(
      "access_denied",
      "Recent authentication is required for this action.",
    );
  }
}
