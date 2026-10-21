import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertLiveBetaAccessToken,
  comparableNotFoundEnvelope,
  formatLiveBetaSmokeFailure,
  LIVE_BETA_SMOKE_ENVIRONMENT_KEYS,
  LiveBetaApiStatusError,
  readLiveBetaSmokeConfig,
} from "./live-beta-smoke-core.mjs";

function environment() {
  const keys = LIVE_BETA_SMOKE_ENVIRONMENT_KEYS;
  return {
    [keys.baseUrl]: "https://beta.example.invalid",
    [keys.clientId]: "a".repeat(26),
    [keys.runId]: "run-20260902-001",
    [keys.userAEmail]: "smoke-a@example.invalid",
    [keys.userAPassword]: `${"A".repeat(12)}a1!`,
    [keys.userBEmail]: "smoke-b@example.invalid",
    [keys.userBPassword]: `${"B".repeat(12)}b1!`,
  };
}

function jwt(payload) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "RS256", kid: "test-key" })}.${encode(payload)}.signature`;
}

test("reads the exact live-beta inputs without making user credentials enumerable", () => {
  const config = readLiveBetaSmokeConfig(environment());
  assert.equal(config.baseUrl, "https://beta.example.invalid");
  assert.equal(config.clientId, "a".repeat(26));
  assert.equal(config.users.a.email, "smoke-a@example.invalid");
  assert.deepEqual(Object.keys(config.users.a), []);
  assert.equal(JSON.stringify(config).includes("smoke-a"), false);
});

test("rejects a non-beta origin and reused user identity", () => {
  const wrongOrigin = environment();
  wrongOrigin[LIVE_BETA_SMOKE_ENVIRONMENT_KEYS.baseUrl] =
    "https://example.invalid";
  assert.throws(() => readLiveBetaSmokeConfig(wrongOrigin));

  const duplicate = environment();
  duplicate[LIVE_BETA_SMOKE_ENVIRONMENT_KEYS.userBEmail] =
    "SMOKE-A@example.invalid";
  assert.throws(() => readLiveBetaSmokeConfig(duplicate));
});

test("accepts only a fresh Cognito access token with the beta API scope and a 30-minute maximum", () => {
  const now = 1_788_200_000;
  const payload = {
    auth_time: now - 10,
    client_id: "a".repeat(26),
    exp: now + 1_790,
    iat: now - 10,
    iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Example123",
    jti: "jti-example",
    scope: "openid profile cloudmarkup-api/access",
    sub: "subject-example",
    token_use: "access",
    version: 2,
  };
  assert.doesNotThrow(() =>
    assertLiveBetaAccessToken(jwt(payload), "a".repeat(26), now),
  );
  assert.throws(() =>
    assertLiveBetaAccessToken(
      jwt({ ...payload, exp: payload.iat + 1_801 }),
      "a".repeat(26),
      now,
    ),
  );
  assert.throws(() =>
    assertLiveBetaAccessToken(
      jwt({ ...payload, scope: "openid profile" }),
      "a".repeat(26),
      now,
    ),
  );
});

test("normalizes only the volatile correlation ID in not-found envelopes", () => {
  const first = comparableNotFoundEnvelope({
    apiVersion: "v1",
    error: {
      code: "not_found",
      correlationId: "correlation-first",
      message: "The requested resource is unavailable.",
    },
  });
  const second = comparableNotFoundEnvelope({
    apiVersion: "v1",
    error: {
      code: "not_found",
      correlationId: "correlation-second",
      message: "The requested resource is unavailable.",
    },
  });
  assert.deepEqual(first, second);
  assert.throws(() =>
    comparableNotFoundEnvelope({
      apiVersion: "v1",
      error: {
        code: "access_denied",
        correlationId: "correlation-third",
        message: "Different.",
      },
    }),
  );
});

test("reports only bounded status and an allowlisted API error code", () => {
  const sensitiveMessage = "secret-token@example.invalid bearer-value";
  const error = new LiveBetaApiStatusError(500, {
    apiVersion: "v1",
    error: {
      code: "internal_error",
      correlationId: "correlation-private",
      message: sensitiveMessage,
    },
  });
  const output = formatLiveBetaSmokeFailure(
    "first user authentication and persistence",
    error,
  );

  assert.equal(
    output,
    "Live beta smoke failed during first user authentication and persistence: API status 500, error code internal_error.",
  );
  assert.equal(output.includes(sensitiveMessage), false);
  assert.equal(output.includes("correlation-private"), false);
  assert.deepEqual(Object.keys(error), []);
  assert.throws(() => new LiveBetaApiStatusError(600, {}));
});

test("redacts unknown API codes, bodies, thrown messages, and phase input", () => {
  const hostileCode = "internal_error\r\nsecret-token@example.invalid";
  const statusError = new LiveBetaApiStatusError(502, {
    apiVersion: "v1",
    error: {
      code: hostileCode,
      message: "bearer-value",
    },
  });

  assert.equal(
    formatLiveBetaSmokeFailure("runtime configuration", statusError),
    "Live beta smoke failed during runtime configuration: API status 502, error code unavailable.",
  );
  assert.equal(
    formatLiveBetaSmokeFailure(
      "secret-token@example.invalid",
      new Error("bearer-value"),
    ),
    "Live beta smoke failed during configuration.",
  );
});

test("reports only an allowlisted invariant code for known smoke assertions", () => {
  const output = formatLiveBetaSmokeFailure(
    "first user authentication and persistence",
    new Error("The persisted draft ETag is invalid."),
  );

  assert.equal(
    output,
    "Live beta smoke failed during first user authentication and persistence: invariant draft_etag_invalid.",
  );
  assert.equal(output.includes("draft ETag"), false);
});

test("the operator entrypoint has no recording or filesystem persistence calls", async () => {
  const source = await readFile(
    new URL("./live-beta-smoke.mjs", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    ".screenshot(",
    ".startChunk(",
    ".start({",
    "recordHar",
    "recordVideo",
    "storageState",
    "writeFile(",
    "appendFile(",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.ok(source.includes("/api/auth/session/v1/exchange"));
  assert.equal(source.includes("/oauth2/token"), false);
  assert.match(source, /delete process\.env\["DEBUG"\]/u);
  assert.match(source, /delete process\.env\["PWDEBUG"\]/u);
  assert.match(source, /chromium\.launch\(\{ env: \{\}, headless: true \}\)/u);
  const fixedSuccess =
    /console\.log\(\s*"Live beta authentication, persistence, isolation, and cleanup passed\."\s*,?\s*\);/u;
  const fixedFailure =
    /console\.error\(formatLiveBetaSmokeFailure\(activePhase, error\)\);/u;
  assert.match(source, fixedSuccess);
  assert.match(source, fixedFailure);
  assert.doesNotMatch(
    source.replace(fixedSuccess, "").replace(fixedFailure, ""),
    /console\.(?:log|error)/u,
  );
  assert.match(
    source,
    /const accessToken = tokenEnvelope\["accessToken"\];[\s\S]*Reflect\.deleteProperty\(tokenEnvelope, key\);/u,
  );
});
