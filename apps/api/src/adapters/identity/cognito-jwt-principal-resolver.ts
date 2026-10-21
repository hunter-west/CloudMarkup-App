import type { AccountSessionAdmission } from "../../application/account-sessions.js";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { CognitoAccessTokenPayload } from "aws-jwt-verify/jwt-model";

import {
  parseBearerToken,
  type Principal,
  type PrincipalDirectory,
  type PrincipalResolver,
} from "../../application/identity.js";

export interface CognitoTokenVerifier {
  verify(token: string): Promise<unknown>;
}

export interface CognitoPrincipalResolverOptions {
  readonly clientId: string | readonly string[];
  readonly principalDirectory: PrincipalDirectory;
  readonly requiredScope: string | readonly string[];
  readonly userPoolId: string;
  readonly verifier?: CognitoTokenVerifier;
  readonly sessionAdmission?: AccountSessionAdmission;
}

function asStringArray(value: string | readonly string[]): string[] {
  if (typeof value === "string") {
    return [value];
  }
  return [...value];
}

type VerifiedPrincipalClaims = Pick<
  CognitoAccessTokenPayload,
  "auth_time" | "exp" | "iss" | "jti" | "scope" | "sub" | "token_use"
> & { readonly origin_jti?: string };

function isVerifiedAccessToken(
  value: unknown,
): value is VerifiedPrincipalClaims {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const claims = value as Readonly<Record<string, unknown>>;
  return (
    claims["token_use"] === "access" &&
    typeof claims["sub"] === "string" &&
    claims["sub"].length > 0 &&
    typeof claims["iss"] === "string" &&
    claims["iss"].length > 0 &&
    typeof claims["auth_time"] === "number" &&
    Number.isSafeInteger(claims["auth_time"]) &&
    typeof claims["exp"] === "number" &&
    Number.isSafeInteger(claims["exp"]) &&
    typeof claims["jti"] === "string" &&
    claims["jti"].length > 0 &&
    claims["jti"].length <= 256 &&
    (claims["origin_jti"] === undefined ||
      (typeof claims["origin_jti"] === "string" &&
        /^[A-Za-z0-9_-]{1,256}$/u.test(claims["origin_jti"])))
  );
}

/** Production adapter. Cognito claims identify a subject but never grant a tenant. */
export class CognitoJwtPrincipalResolver implements PrincipalResolver {
  readonly #directory: PrincipalDirectory;
  readonly #requiredScopes: ReadonlySet<string>;
  readonly #verifier: CognitoTokenVerifier;
  readonly #sessionAdmission: AccountSessionAdmission | undefined;

  constructor(options: CognitoPrincipalResolverOptions) {
    const requiredScopes = asStringArray(options.requiredScope);
    if (
      requiredScopes.length === 0 ||
      requiredScopes.some((scope) => scope.length === 0 || /\s/u.test(scope))
    ) {
      throw new TypeError(
        "At least one valid Cognito access-token scope is required.",
      );
    }
    this.#directory = options.principalDirectory;
    this.#sessionAdmission = options.sessionAdmission;
    this.#requiredScopes = new Set(requiredScopes);
    this.#verifier =
      options.verifier ??
      CognitoJwtVerifier.create({
        clientId: asStringArray(options.clientId),
        includeRawJwtInErrors: false,
        tokenUse: "access",
        userPoolId: options.userPoolId,
      });
  }

  async resolve(authorization: string | undefined): Promise<Principal | null> {
    const token = parseBearerToken(authorization);
    if (token === null) {
      return null;
    }

    let claims: unknown;
    try {
      claims = await this.#verifier.verify(token);
    } catch {
      return null;
    }

    if (!isVerifiedAccessToken(claims)) {
      return null;
    }
    const grantedScopes =
      typeof claims.scope === "string"
        ? new Set(claims.scope.split(/\s+/u).filter(Boolean))
        : new Set<string>();
    if ([...this.#requiredScopes].some((scope) => !grantedScopes.has(scope))) {
      return null;
    }

    const mapped = await this.#directory.resolveActivePrincipal({
      issuer: claims.iss,
      provider: "cognito",
      subject: claims.sub,
    });
    if (mapped === null) {
      return null;
    }

    const principal: Principal = {
      authenticatedAt: new Date(claims.auth_time * 1_000).toISOString(),
      authenticationSource: "cognito",
      expiresAt: new Date(claims.exp * 1_000).toISOString(),
      principalId: mapped.principalId,
      // Verified Cognito refresh-family identity survives access-token renewal.
      // auth_time above still requires an actual recent sign-in for sensitive work.
      sessionId: claims.origin_jti ?? claims.jti,
    };
    if (
      this.#sessionAdmission &&
      !(await this.#sessionAdmission.isActive(principal))
    )
      return null;
    return principal;
  }
}
