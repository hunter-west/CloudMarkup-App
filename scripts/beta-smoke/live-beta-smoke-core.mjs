const exactBetaOrigin = "https://beta.example.invalid";
const cognitoClientIdPattern = /^[a-z0-9]{26}$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/u;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;
const correlationIdPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
const requiredScopes = Object.freeze([
  "openid",
  "profile",
  "cloudmarkup-api/access",
]);
const apiErrorCodes = new Set([
  "authentication_required",
  "access_denied",
  "not_found",
  "invalid_request",
  "payload_too_large",
  "precondition_required",
  "precondition_failed",
  "idempotency_key_required",
  "idempotency_key_reused",
  "conflict",
  "unsupported_version",
  "rate_limited",
  "service_unavailable",
  "internal_error",
]);
const liveBetaSmokePhases = new Set([
  "configuration",
  "browser startup",
  "runtime configuration",
  "unauthenticated API boundary",
  "first user authentication and persistence",
  "second user authentication and isolation",
  "first user reauthentication and isolation",
  "project tombstone cleanup",
]);
const invariantErrorCodes = new Map([
  ["The API data response is invalid.", "api_data_response_invalid"],
  ["The live beta sign-in page is unavailable.", "sign_in_page_unavailable"],
  [
    "The Cognito token exchange was rejected.",
    "cognito_token_exchange_rejected",
  ],
  ["The Cognito token response is invalid.", "cognito_token_response_invalid"],
  ["The Cognito access token is malformed.", "access_token_malformed"],
  [
    "The Cognito access token claims are invalid.",
    "access_token_claims_invalid",
  ],
  [
    "The Cognito access token issuer is invalid.",
    "access_token_issuer_invalid",
  ],
  [
    "The Cognito access token lifetime is invalid.",
    "access_token_lifetime_invalid",
  ],
  ["The Cognito access token scope is invalid.", "access_token_scope_invalid"],
  ["The current principal response is invalid.", "principal_response_invalid"],
  [
    "The current principal tenant context is invalid.",
    "principal_tenant_context_invalid",
  ],
  [
    "The project creation response is invalid.",
    "project_creation_response_invalid",
  ],
  ["The persisted project identity is invalid.", "project_identity_invalid"],
  ["The persisted draft reference is invalid.", "draft_reference_invalid"],
  ["The persisted project ETag is invalid.", "project_etag_invalid"],
  ["The persisted draft ETag is invalid.", "draft_etag_invalid"],
]);
const unavailableApiErrorCode = "unavailable";

export const LIVE_BETA_SMOKE_ENVIRONMENT_KEYS = Object.freeze({
  baseUrl: "CLOUDMARKUP_BETA_BASE_URL",
  clientId: "CLOUDMARKUP_BETA_COGNITO_CLIENT_ID",
  runId: "CLOUDMARKUP_BETA_SMOKE_RUN_ID",
  userAEmail: "CLOUDMARKUP_BETA_SMOKE_USER_A_EMAIL",
  userAPassword: "CLOUDMARKUP_BETA_SMOKE_USER_A_PASSWORD",
  userBEmail: "CLOUDMARKUP_BETA_SMOKE_USER_B_EMAIL",
  userBPassword: "CLOUDMARKUP_BETA_SMOKE_USER_B_PASSWORD",
});

function fail(message) {
  throw new Error(message);
}

function requiredEnvironmentValue(environment, key) {
  const value = environment[key];
  if (typeof value !== "string" || value.length === 0) {
    fail(`The ${key} environment variable is required.`);
  }
  return value;
}

function sensitiveUser(email, password) {
  const user = {};
  Object.defineProperties(user, {
    email: { enumerable: false, value: email },
    password: { enumerable: false, value: password },
  });
  return Object.freeze(user);
}

function parseExactBetaOrigin(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail("The live beta base URL is invalid.");
  }
  if (
    parsed.origin !== exactBetaOrigin ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    fail("The live beta base URL must be the exact public beta origin.");
  }
  return parsed.origin;
}

function parseEmail(raw, label) {
  if (raw.length > 320 || !emailPattern.test(raw)) {
    fail(`The ${label} environment variable is invalid.`);
  }
  return raw;
}

function parsePassword(raw, label) {
  if (raw.length < 12 || raw.length > 256) {
    fail(`The ${label} environment variable is invalid.`);
  }
  return raw;
}

export function readLiveBetaSmokeConfig(environment) {
  const keys = LIVE_BETA_SMOKE_ENVIRONMENT_KEYS;
  const baseUrl = parseExactBetaOrigin(
    requiredEnvironmentValue(environment, keys.baseUrl),
  );
  const clientId = requiredEnvironmentValue(environment, keys.clientId);
  if (!cognitoClientIdPattern.test(clientId)) {
    fail("The live beta Cognito client ID is invalid.");
  }
  const runId = requiredEnvironmentValue(environment, keys.runId);
  if (!runIdPattern.test(runId)) {
    fail("The live beta smoke run ID is invalid.");
  }
  const userAEmail = parseEmail(
    requiredEnvironmentValue(environment, keys.userAEmail),
    keys.userAEmail,
  );
  const userBEmail = parseEmail(
    requiredEnvironmentValue(environment, keys.userBEmail),
    keys.userBEmail,
  );
  if (userAEmail.toLowerCase() === userBEmail.toLowerCase()) {
    fail("The live beta smoke users must be distinct.");
  }
  const userAPassword = parsePassword(
    requiredEnvironmentValue(environment, keys.userAPassword),
    keys.userAPassword,
  );
  const userBPassword = parsePassword(
    requiredEnvironmentValue(environment, keys.userBPassword),
    keys.userBPassword,
  );
  return Object.freeze({
    baseUrl,
    clientId,
    runId,
    users: Object.freeze({
      a: sensitiveUser(userAEmail, userAPassword),
      b: sensitiveUser(userBEmail, userBPassword),
    }),
  });
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function allowlistedApiErrorCode(value) {
  if (
    !isRecord(value) ||
    value["apiVersion"] !== "v1" ||
    !isRecord(value["error"]) ||
    !apiErrorCodes.has(value["error"]["code"])
  ) {
    return unavailableApiErrorCode;
  }
  return value["error"]["code"];
}

export class LiveBetaApiStatusError extends Error {
  constructor(status, responseBody) {
    if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
      fail("The live beta API response status is invalid.");
    }
    super("The live beta API response status is invalid.");
    Object.defineProperties(this, {
      apiErrorCode: {
        enumerable: false,
        value: allowlistedApiErrorCode(responseBody),
      },
      name: { enumerable: false, value: "LiveBetaApiStatusError" },
      status: { enumerable: false, value: status },
    });
  }
}

export function formatLiveBetaSmokeFailure(phase, error) {
  const safePhase = liveBetaSmokePhases.has(phase) ? phase : "configuration";
  const prefix = `Live beta smoke failed during ${safePhase}`;
  if (!(error instanceof LiveBetaApiStatusError)) {
    const invariantCode =
      error instanceof Error
        ? invariantErrorCodes.get(error.message)
        : undefined;
    return invariantCode === undefined
      ? `${prefix}.`
      : `${prefix}: invariant ${invariantCode}.`;
  }
  return `${prefix}: API status ${error.status}, error code ${error.apiErrorCode}.`;
}

function decodeJwtPart(part) {
  if (
    part.length === 0 ||
    part.length > 16_384 ||
    !base64UrlPattern.test(part)
  ) {
    fail("The Cognito access token is malformed.");
  }
  let parsed;
  try {
    const decoded = Buffer.from(part, "base64url").toString("utf8");
    if (Buffer.byteLength(decoded, "utf8") > 16 * 1024) {
      fail("The Cognito access token is malformed.");
    }
    parsed = JSON.parse(decoded);
  } catch {
    fail("The Cognito access token is malformed.");
  }
  if (!isRecord(parsed)) {
    fail("The Cognito access token is malformed.");
  }
  return parsed;
}

/**
 * Validates only public access-token claims. Successful API calls provide the
 * independent server-side signature, issuer, audience, expiry, and scope proof.
 */
export function assertLiveBetaAccessToken(
  token,
  clientId,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (typeof token !== "string" || token.length > 16_384) {
    fail("The Cognito access token is malformed.");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    fail("The Cognito access token is malformed.");
  }
  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);
  if (
    header["alg"] !== "RS256" ||
    typeof header["kid"] !== "string" ||
    header["kid"].length === 0 ||
    payload["token_use"] !== "access" ||
    payload["version"] !== 2 ||
    payload["client_id"] !== clientId ||
    typeof payload["sub"] !== "string" ||
    payload["sub"].length === 0 ||
    typeof payload["jti"] !== "string" ||
    payload["jti"].length === 0
  ) {
    fail("The Cognito access token claims are invalid.");
  }

  let issuer;
  try {
    issuer = new URL(payload["iss"]);
  } catch {
    fail("The Cognito access token issuer is invalid.");
  }
  if (
    issuer.protocol !== "https:" ||
    issuer.hostname !== "cognito-idp.us-east-1.amazonaws.com" ||
    !/^\/us-east-1_[A-Za-z0-9]+$/u.test(issuer.pathname) ||
    issuer.search !== "" ||
    issuer.hash !== "" ||
    issuer.username !== "" ||
    issuer.password !== ""
  ) {
    fail("The Cognito access token issuer is invalid.");
  }

  const issuedAt = payload["iat"];
  const expiresAt = payload["exp"];
  const authenticatedAt = payload["auth_time"];
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    !Number.isSafeInteger(authenticatedAt) ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > 30 * 60 ||
    nowSeconds >= expiresAt ||
    issuedAt > nowSeconds + 60 ||
    authenticatedAt > nowSeconds + 60 ||
    nowSeconds - authenticatedAt > 5 * 60
  ) {
    fail("The Cognito access token lifetime is invalid.");
  }

  const scope = payload["scope"];
  const scopes =
    typeof scope === "string" ? scope.split(" ").filter(Boolean) : [];
  if (
    scopes.length !== new Set(scopes).size ||
    !requiredScopes.every((requiredScope) => scopes.includes(requiredScope))
  ) {
    fail("The Cognito access token scope is invalid.");
  }
}

export function comparableNotFoundEnvelope(value) {
  if (
    !isRecord(value) ||
    value["apiVersion"] !== "v1" ||
    !isRecord(value["error"]) ||
    value["error"]["code"] !== "not_found" ||
    typeof value["error"]["message"] !== "string" ||
    !correlationIdPattern.test(value["error"]["correlationId"])
  ) {
    fail("The API not-found response is invalid.");
  }
  return {
    ...value,
    error: { ...value["error"], correlationId: "correlation-redacted" },
  };
}
