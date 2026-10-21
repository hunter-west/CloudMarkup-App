import {
  accountAccessV1Schema,
  type AccountAccessV1,
} from "@cloudmarkup/api-contract";
export type AccountAuthenticationIntent = "sign-in" | "sign-up" | "recover";
const runtimeConfigPath = "/api/runtime-config";
const requiredScopes = Object.freeze([
  "openid",
  "profile",
  "cloudmarkup-api/access",
] as const);
const cognitoClientIdPattern = /^[a-z0-9]{26}$/u;
const cognitoDomainPattern =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.auth\.us-east-1\.amazoncognito\.com$/u;
const oauthValuePattern = /^[A-Za-z0-9._~-]{1,2048}$/u;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;
const accessTokenPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const maximumJsonBytes = 16 * 1024;
const renewalLeadMilliseconds = 60_000;
const tokenRequestTimeoutMilliseconds = 15_000;
export const COGNITO_BROWSER_SESSION_MAXIMUM_MILLISECONDS = 8 * 60 * 60 * 1000;
export const COGNITO_AUTHORIZATION_TIMEOUT_MILLISECONDS = 10 * 60 * 1000;
const callbackChannelPrefix = "cloudmarkup-cognito-callback-v1:";
export const COGNITO_BROWSER_AUTH_COMPOSITION =
  "cloudmarkup.auth-composition/cognito-pkce-v1";

export interface CognitoRuntimeConfig {
  readonly authentication: {
    readonly callbackUrl: string;
    readonly clientId: string;
    readonly domain: string;
    readonly logoutUrl: string;
    readonly provider: "cognito";
    readonly scopes: typeof requiredScopes;
  };
  readonly schemaVersion: 1;
}

export type ParsedCognitoCallback =
  | {
      readonly code: string;
      readonly kind: "success";
      readonly state: string;
    }
  | {
      readonly error: string;
      readonly kind: "error";
      readonly state: string;
    };

export type CognitoBrowserAuthErrorCode =
  | "registration-closed"
  | "authorization-cancelled"
  | "authorization-expired"
  | "authorization-in-progress"
  | "authorization-popup-blocked"
  | "authorization-replayed"
  | "authorization-state-mismatch"
  | "authorization-unavailable"
  | "callback-invalid"
  | "provider-error"
  | "runtime-config-invalid"
  | "runtime-config-unavailable"
  | "token-rejected"
  | "token-invalid"
  | "token-unavailable";

export class CognitoBrowserAuthError extends Error {
  public readonly code: CognitoBrowserAuthErrorCode;

  public constructor(code: CognitoBrowserAuthErrorCode, message: string) {
    super(message);
    this.name = "CognitoBrowserAuthError";
    this.code = code;
  }
}

export interface CognitoBrowserAuthEnvironment {
  readonly cryptoImplementation: Pick<Crypto, "getRandomValues" | "subtle">;
  readonly fetchImplementation: typeof globalThis.fetch;
  readonly now: () => number;
  readonly origin: string;
  readonly secureSession?: boolean;
}

interface PendingAuthorization {
  readonly handle: string;
  readonly config: CognitoRuntimeConfig;
  readonly createdAt: number;
  readonly state: string;
  readonly verifier: string;
}

interface AccessTokenRecord {
  readonly sessionExpiresAt?: number;
  readonly refreshToken?: string;
  readonly expiresAt: number;
  readonly value: string;
}

export interface PreparedCognitoAuthorization {
  readonly authorizationUrl: string;
  readonly state: string;
}

export interface StartCognitoSignInOptions {
  readonly intent?: AccountAuthenticationIntent;
  readonly signal?: AbortSignal;
}

interface CognitoCallbackMessage {
  readonly callback: ParsedCognitoCallback;
  readonly kind: "cloudmarkup.cognito-callback";
  readonly schemaVersion: 1;
}

interface CognitoCallbackAcknowledgement {
  readonly kind: "cloudmarkup.cognito-callback-acknowledgement";
  readonly schemaVersion: 1;
  readonly status: "accepted" | "rejected";
}

function defaultEnvironment(): CognitoBrowserAuthEnvironment {
  if (typeof window === "undefined") {
    throw new CognitoBrowserAuthError(
      "authorization-unavailable",
      "Browser authentication is unavailable in this runtime.",
    );
  }
  return {
    cryptoImplementation: window.crypto,
    fetchImplementation: window.fetch.bind(window),
    now: Date.now,
    origin: window.location.origin,
    secureSession: !import.meta.env.DEV,
  };
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function parseJson(
  text: string,
  errorCode: CognitoBrowserAuthErrorCode,
): unknown {
  if (text.length === 0 || text.length > maximumJsonBytes) {
    throw new CognitoBrowserAuthError(
      errorCode,
      "The authentication response is not valid.",
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CognitoBrowserAuthError(
      errorCode,
      "The authentication response is not valid.",
    );
  }
}

function hasJsonContentType(response: Response): boolean {
  return /^application\/json(?:\s*;|$)/iu.test(
    response.headers.get("content-type") ?? "",
  );
}

function parseExactUrl(value: unknown): URL | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2048 ||
    /[\r\n]/u.test(value)
  ) {
    return undefined;
  }
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

export function parseCognitoRuntimeConfig(
  value: unknown,
  currentOrigin: string,
): CognitoRuntimeConfig {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["authentication", "schemaVersion"]) ||
    value["schemaVersion"] !== 1 ||
    !isRecord(value["authentication"])
  ) {
    throw new CognitoBrowserAuthError(
      "runtime-config-invalid",
      "The public authentication configuration is invalid.",
    );
  }

  const authentication = value["authentication"];
  const scopes: unknown = authentication["scopes"];
  if (
    !hasExactKeys(authentication, [
      "callbackUrl",
      "clientId",
      "domain",
      "logoutUrl",
      "provider",
      "scopes",
    ]) ||
    authentication["provider"] !== "cognito" ||
    typeof authentication["clientId"] !== "string" ||
    !cognitoClientIdPattern.test(authentication["clientId"]) ||
    !Array.isArray(scopes) ||
    scopes.length !== requiredScopes.length ||
    !requiredScopes.every((scope, index) => scopes[index] === scope)
  ) {
    throw new CognitoBrowserAuthError(
      "runtime-config-invalid",
      "The public authentication configuration is invalid.",
    );
  }

  const origin = parseExactUrl(currentOrigin);
  const domain = parseExactUrl(authentication["domain"]);
  const callback = parseExactUrl(authentication["callbackUrl"]);
  const logout = parseExactUrl(authentication["logoutUrl"]);
  if (
    origin?.origin !== currentOrigin ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    domain?.protocol !== "https:" ||
    !cognitoDomainPattern.test(domain.hostname) ||
    domain.port !== "" ||
    domain.username !== "" ||
    domain.password !== "" ||
    domain.pathname !== "/" ||
    domain.search !== "" ||
    domain.hash !== "" ||
    callback?.origin !== currentOrigin ||
    callback.pathname !== "/auth/callback" ||
    callback.search !== "" ||
    callback.hash !== "" ||
    logout?.origin !== currentOrigin ||
    logout.pathname !== "/" ||
    logout.search !== "" ||
    logout.hash !== ""
  ) {
    throw new CognitoBrowserAuthError(
      "runtime-config-invalid",
      "The public authentication configuration is invalid.",
    );
  }

  return Object.freeze({
    authentication: Object.freeze({
      callbackUrl: callback.toString(),
      clientId: authentication["clientId"],
      domain: domain.origin,
      logoutUrl: logout.origin,
      provider: "cognito",
      scopes: requiredScopes,
    }),
    schemaVersion: 1,
  });
}

export async function fetchCognitoRuntimeConfig(
  environment: CognitoBrowserAuthEnvironment,
): Promise<CognitoRuntimeConfig> {
  let response: Response;
  try {
    response = await environment.fetchImplementation(runtimeConfigPath, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      method: "GET",
      redirect: "error",
    });
  } catch {
    throw new CognitoBrowserAuthError(
      "runtime-config-unavailable",
      "The public authentication configuration is unavailable.",
    );
  }
  if (response.status !== 200 || !hasJsonContentType(response)) {
    throw new CognitoBrowserAuthError(
      "runtime-config-unavailable",
      "The public authentication configuration is unavailable.",
    );
  }
  return parseCognitoRuntimeConfig(
    parseJson(await response.text(), "runtime-config-invalid"),
    environment.origin,
  );
}

async function fetchAccountAccess(
  environment: CognitoBrowserAuthEnvironment,
): Promise<AccountAccessV1> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => {
    controller.abort();
  }, tokenRequestTimeoutMilliseconds);
  try {
    const response = await environment.fetchImplementation(
      runtimeConfigPath + "?view=account",
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
        method: "GET",
        redirect: "error",
        signal: controller.signal,
      },
    );
    if (response.status !== 200 || !hasJsonContentType(response))
      throw Error("Unavailable account configuration");
    return accountAccessV1Schema.parse(
      parseJson(await response.text(), "runtime-config-invalid"),
    );
  } catch {
    throw new CognitoBrowserAuthError(
      "runtime-config-unavailable",
      "Account registration information is unavailable.",
    );
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function randomBase64Url(
  bytes: number,
  cryptoImplementation: Pick<Crypto, "getRandomValues">,
): string {
  const value = cryptoImplementation.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

async function sha256Base64Url(
  value: string,
  cryptoImplementation: Pick<Crypto, "subtle">,
): Promise<string> {
  const digest = await cryptoImplementation.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

const allowedProviderErrors = new Set([
  "access_denied",
  "invalid_request",
  "invalid_scope",
  "server_error",
  "temporarily_unavailable",
  "unauthorized_client",
  "unsupported_response_type",
]);

export function parseCognitoCallback(search: string): ParsedCognitoCallback {
  if (
    search.length === 0 ||
    search.length > 4096 ||
    !search.startsWith("?") ||
    /[#\r\n]/u.test(search)
  ) {
    throw new CognitoBrowserAuthError(
      "callback-invalid",
      "The authentication callback is invalid.",
    );
  }
  const parameters = new URLSearchParams(search);
  const allowedKeys = new Set(["code", "error", "error_description", "state"]);
  for (const key of parameters.keys()) {
    if (!allowedKeys.has(key) || parameters.getAll(key).length !== 1) {
      throw new CognitoBrowserAuthError(
        "callback-invalid",
        "The authentication callback is invalid.",
      );
    }
  }
  const state = parameters.get("state");
  if (state?.length !== 43 || !base64UrlPattern.test(state)) {
    throw new CognitoBrowserAuthError(
      "callback-invalid",
      "The authentication callback is invalid.",
    );
  }
  const code = parameters.get("code");
  const error = parameters.get("error");
  const errorDescription = parameters.get("error_description");
  if (
    code !== null &&
    error === null &&
    errorDescription === null &&
    parameters.size === 2 &&
    oauthValuePattern.test(code)
  ) {
    return Object.freeze({ code, kind: "success", state });
  }
  if (
    code === null &&
    error !== null &&
    allowedProviderErrors.has(error) &&
    (errorDescription === null ||
      (errorDescription.length <= 1024 && !/[\r\n]/u.test(errorDescription)))
  ) {
    return Object.freeze({ error, kind: "error", state });
  }
  throw new CognitoBrowserAuthError(
    "callback-invalid",
    "The authentication callback is invalid.",
  );
}

function parseTokenResponse(value: unknown): {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken?: string;
} {
  if (!isRecord(value)) {
    throw new CognitoBrowserAuthError(
      "token-invalid",
      "The identity provider returned an invalid token response.",
    );
  }
  const allowedKeys = new Set([
    "access_token",
    "expires_in",
    "id_token",
    "refresh_token",
    "scope",
    "token_type",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new CognitoBrowserAuthError(
      "token-invalid",
      "The identity provider returned an invalid token response.",
    );
  }
  const accessToken = value["access_token"];
  const expiresIn = value["expires_in"];
  const refreshToken = value["refresh_token"];
  if (
    typeof accessToken !== "string" ||
    accessToken.length < 100 ||
    accessToken.length > 16_384 ||
    !accessTokenPattern.test(accessToken) ||
    value["token_type"] !== "Bearer" ||
    typeof expiresIn !== "number" ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn < 60 ||
    expiresIn > 3600 ||
    (refreshToken !== undefined &&
      (typeof refreshToken !== "string" ||
        refreshToken.length < 1 ||
        refreshToken.length > 16_384 ||
        !/^[\x21-\x7e]+$/u.test(refreshToken)))
  ) {
    throw new CognitoBrowserAuthError(
      "token-invalid",
      "The identity provider returned an invalid token response.",
    );
  }
  return {
    accessToken,
    expiresIn,
    ...(refreshToken === undefined ? {} : { refreshToken }),
  };
}

async function exchangeTokens(
  environment: CognitoBrowserAuthEnvironment,
  config: CognitoRuntimeConfig,
  body: URLSearchParams,
  controller: AbortController,
): Promise<AccessTokenRecord> {
  const startedAt = environment.now();
  const timeout = globalThis.setTimeout(() => {
    controller.abort();
  }, tokenRequestTimeoutMilliseconds);
  try {
    const response = await environment.fetchImplementation(
      `${config.authentication.domain}/oauth2/token`,
      {
        body,
        cache: "no-store",
        credentials: "omit",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        method: "POST",
        redirect: "error",
        signal: controller.signal,
      },
    );
    if (response.status === 400 && hasJsonContentType(response)) {
      const failure = parseJson(await response.text(), "token-invalid");
      if (isRecord(failure) && failure["error"] === "invalid_grant") {
        throw new CognitoBrowserAuthError(
          "token-rejected",
          "The sign-in credential is no longer valid.",
        );
      }
      throw new CognitoBrowserAuthError(
        "token-invalid",
        "The identity provider rejected the token request.",
      );
    }
    if (response.status !== 200 || !hasJsonContentType(response)) {
      throw new CognitoBrowserAuthError(
        "token-unavailable",
        "The identity provider token exchange failed.",
      );
    }
    const token = parseTokenResponse(
      parseJson(await response.text(), "token-invalid"),
    );
    if (controller.signal.aborted) throw new Error("Token request cancelled.");
    return {
      expiresAt: startedAt + token.expiresIn * 1000,
      value: token.accessToken,
      ...(token.refreshToken === undefined
        ? {}
        : { refreshToken: token.refreshToken }),
    };
  } catch (error) {
    if (error instanceof CognitoBrowserAuthError) throw error;
    throw new CognitoBrowserAuthError(
      "token-unavailable",
      "The identity provider token exchange failed.",
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function requestSecureSession(
  environment: CognitoBrowserAuthEnvironment,
  operation: "exchange" | "restore" | "cancel" | "logout",
  input: Readonly<Record<string, unknown>>,
  controller = new AbortController(),
): Promise<AccessTokenRecord | undefined> {
  const started = environment.now();
  const timeout = globalThis.setTimeout(() => {
    controller.abort();
  }, tokenRequestTimeoutMilliseconds);
  try {
    const response = await environment.fetchImplementation(
      environment.origin + "/api/auth/session/v1/" + operation,
      {
        method: "POST",
        credentials: operation === "cancel" ? "omit" : "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-cloudmarkup-session": "1",
        },
        body: JSON.stringify({ schemaVersion: 1, ...input }),
        signal: controller.signal,
      },
    );
    if (controller.signal.aborted)
      throw new CognitoBrowserAuthError(
        "token-unavailable",
        "Session renewal was interrupted.",
      );
    if (response.status === 401)
      throw new CognitoBrowserAuthError(
        "token-rejected",
        "The browser session is no longer valid.",
      );
    if (
      response.status === 204 &&
      (operation === "cancel" || operation === "logout")
    )
      return undefined;
    if (response.status !== 200 || !hasJsonContentType(response))
      throw new CognitoBrowserAuthError(
        "token-unavailable",
        "Session renewal is temporarily unavailable.",
      );
    const value = parseJson(await response.text(), "token-invalid");
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        "schemaVersion",
        "accessToken",
        "expiresIn",
        "sessionExpiresAt",
      ]) ||
      value["schemaVersion"] !== 1 ||
      typeof value["sessionExpiresAt"] !== "string"
    )
      throw new CognitoBrowserAuthError(
        "token-invalid",
        "The session response is invalid.",
      );
    const token = parseTokenResponse({
      access_token: value["accessToken"],
      expires_in: value["expiresIn"],
      token_type: "Bearer",
    });
    const sessionExpiresAt = Date.parse(value["sessionExpiresAt"]);
    if (
      !Number.isFinite(sessionExpiresAt) ||
      sessionExpiresAt <= environment.now() ||
      sessionExpiresAt >
        environment.now() +
          COGNITO_BROWSER_SESSION_MAXIMUM_MILLISECONDS +
          30000 ||
      isSignalAborted(controller.signal)
    )
      throw new CognitoBrowserAuthError(
        "token-invalid",
        "The session lifetime is invalid.",
      );
    return {
      value: token.accessToken,
      expiresAt: Math.min(started + token.expiresIn * 1000, sessionExpiresAt),
      sessionExpiresAt,
    };
  } catch (error) {
    if (error instanceof CognitoBrowserAuthError) throw error;
    throw new CognitoBrowserAuthError(
      "token-unavailable",
      "Session renewal is temporarily unavailable.",
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export class CognitoBrowserAuthSession {
  public readonly composition = COGNITO_BROWSER_AUTH_COMPOSITION;
  readonly #environment: () => CognitoBrowserAuthEnvironment;
  #accessToken: AccessTokenRecord | undefined;
  #refreshToken: string | undefined;
  #sessionExpiresAt: number | undefined;
  #sessionGeneration = 0;
  #refreshRetryAt = 0;
  #restorationAllowed = true;
  #sessionHandle: string | undefined;
  #pendingCancellationHandle: string | undefined;
  #authorizationPreparing = false;
  #tokenRequestController: AbortController | undefined;
  #refreshPromise: Promise<string | undefined> | undefined;
  #lastConsumedState: string | undefined;
  #pendingAuthorization: PendingAuthorization | undefined;
  #runtimeConfig: CognitoRuntimeConfig | undefined;

  public constructor(
    environment: () => CognitoBrowserAuthEnvironment = defaultEnvironment,
  ) {
    this.#environment = environment;
  }

  public readAccountAccess(): Promise<AccountAccessV1> {
    return fetchAccountAccess(this.#environment());
  }

  public async prepareAuthorization(
    intent?: AccountAuthenticationIntent,
  ): Promise<PreparedCognitoAuthorization> {
    const environment = this.#environment();
    if (
      this.#authorizationPreparing ||
      (this.#pendingAuthorization !== undefined &&
        environment.now() - this.#pendingAuthorization.createdAt <
          COGNITO_AUTHORIZATION_TIMEOUT_MILLISECONDS)
    ) {
      throw new CognitoBrowserAuthError(
        "authorization-in-progress",
        "A sign-in attempt is already in progress.",
      );
    }
    let generation = this.#sessionGeneration;
    this.#authorizationPreparing = true;
    try {
      // A closed signup gate must not cancel an existing account session.
      let access: AccountAccessV1 | undefined;
      if (intent !== undefined) {
        if (!["sign-in", "sign-up", "recover"].includes(intent))
          throw new CognitoBrowserAuthError(
            "authorization-unavailable",
            "This account action is unavailable.",
          );
        try {
          access = await fetchAccountAccess(environment);
        } catch (error) {
          if (intent === "sign-up") throw error;
        }
        if (intent === "sign-up" && !access?.registrationEnabled)
          throw new CognitoBrowserAuthError(
            "registration-closed",
            "New account registration is temporarily closed. Existing users can still sign in.",
          );
      }
      if (generation !== this.#sessionGeneration)
        throw new CognitoBrowserAuthError(
          "authorization-cancelled",
          "The account action was cancelled.",
        );
      this.#pendingCancellationHandle ??= this.#sessionHandle;
      this.clearSession();
      generation = this.#sessionGeneration;
      this.#authorizationPreparing = true;
      if (environment.secureSession === true) {
        await this.#cancelRetainedHandle(environment);
        await requestSecureSession(environment, "logout", {});
      }
      const config = await fetchCognitoRuntimeConfig(environment);
      const state = randomBase64Url(32, environment.cryptoImplementation);
      const handle = randomBase64Url(32, environment.cryptoImplementation);
      const verifier = randomBase64Url(96, environment.cryptoImplementation);
      const challenge = await sha256Base64Url(
        verifier,
        environment.cryptoImplementation,
      );
      const authorizationUrl = new URL(
        intent === "sign-up"
          ? "/signup"
          : intent === "recover"
            ? "/forgotPassword"
            : "/oauth2/authorize",
        config.authentication.domain,
      );
      authorizationUrl.search = new URLSearchParams({
        client_id: config.authentication.clientId,
        code_challenge: challenge,
        code_challenge_method: "S256",
        redirect_uri: config.authentication.callbackUrl,
        response_type: "code",
        prompt: "login",
        scope: [
          ...config.authentication.scopes,
          ...(access?.managedLogin ? ["aws.cognito.signin.user.admin"] : []),
        ].join(" "),
        state,
      }).toString();
      if (generation !== this.#sessionGeneration) {
        throw new CognitoBrowserAuthError(
          "authorization-cancelled",
          "The sign-in attempt was cancelled.",
        );
      }
      this.#runtimeConfig = config;
      this.#sessionHandle = handle;
      this.#pendingAuthorization = {
        handle,
        config,
        createdAt: environment.now(),
        state,
        verifier,
      };
      return Object.freeze({
        authorizationUrl: authorizationUrl.toString(),
        state,
      });
    } finally {
      if (generation === this.#sessionGeneration)
        this.#authorizationPreparing = false;
    }
  }

  public hasPendingAuthorization(state: string): boolean {
    return this.#pendingAuthorization?.state === state;
  }

  public async cancelPendingAuthorization(): Promise<void> {
    this.#pendingCancellationHandle ??= this.#sessionHandle;
    const environment = this.#environment();
    this.clearSession();
    if (environment.secureSession === true)
      await this.#cancelRetainedHandle(environment);
  }

  async #cancelRetainedHandle(
    environment: CognitoBrowserAuthEnvironment,
  ): Promise<void> {
    const handle = this.#pendingCancellationHandle;
    if (handle === undefined) return;
    await requestSecureSession(environment, "cancel", { handle });
    if (this.#pendingCancellationHandle === handle)
      this.#pendingCancellationHandle = undefined;
  }

  public async completeCallback(
    callback: ParsedCognitoCallback | string,
  ): Promise<void> {
    const parsed =
      typeof callback === "string" ? parseCognitoCallback(callback) : callback;
    if (
      this.#lastConsumedState !== undefined &&
      safeEqual(parsed.state, this.#lastConsumedState)
    ) {
      throw new CognitoBrowserAuthError(
        "authorization-replayed",
        "The authentication callback has already been used.",
      );
    }
    const pending = this.#pendingAuthorization;
    if (pending === undefined) {
      throw new CognitoBrowserAuthError(
        "authorization-unavailable",
        "No in-memory sign-in attempt matches this callback.",
      );
    }
    const environment = this.#environment();
    if (
      environment.now() - pending.createdAt >=
      COGNITO_AUTHORIZATION_TIMEOUT_MILLISECONDS
    ) {
      this.#pendingAuthorization = undefined;
      throw new CognitoBrowserAuthError(
        "authorization-expired",
        "The sign-in attempt expired. Start again.",
      );
    }
    if (!safeEqual(parsed.state, pending.state)) {
      throw new CognitoBrowserAuthError(
        "authorization-state-mismatch",
        "The authentication callback did not match the active sign-in attempt.",
      );
    }
    this.#lastConsumedState = pending.state;
    this.#pendingAuthorization = undefined;
    if (parsed.kind === "error") {
      throw new CognitoBrowserAuthError(
        "provider-error",
        "The identity provider did not complete sign-in.",
      );
    }
    const generation = this.#sessionGeneration;
    const controller = new AbortController();
    this.#tokenRequestController = controller;
    try {
      const token =
        environment.secureSession === true
          ? await requestSecureSession(
              environment,
              "exchange",
              {
                handle: pending.handle,
                code: parsed.code,
                verifier: pending.verifier,
              },
              controller,
            )
          : await exchangeTokens(
              environment,
              pending.config,
              new URLSearchParams({
                client_id: pending.config.authentication.clientId,
                code: parsed.code,
                code_verifier: pending.verifier,
                grant_type: "authorization_code",
                redirect_uri: pending.config.authentication.callbackUrl,
              }),
              controller,
            );
      if (generation !== this.#sessionGeneration || controller.signal.aborted) {
        throw new CognitoBrowserAuthError(
          "authorization-cancelled",
          "The sign-in attempt was cancelled.",
        );
      }
      if (token === undefined)
        throw new CognitoBrowserAuthError(
          "token-invalid",
          "The session response is invalid.",
        );
      this.#accessToken = token;
      this.#refreshToken = token.refreshToken;
      this.#restorationAllowed = true;
      this.#sessionExpiresAt =
        token.sessionExpiresAt ??
        environment.now() + COGNITO_BROWSER_SESSION_MAXIMUM_MILLISECONDS;
    } catch (error) {
      if (generation !== this.#sessionGeneration)
        throw new CognitoBrowserAuthError(
          "authorization-cancelled",
          "The sign-in attempt was cancelled.",
        );
      throw error;
    } finally {
      if (this.#tokenRequestController === controller) {
        this.#tokenRequestController = undefined;
      }
    }
  }

  public getAccessToken(): string | undefined {
    const now = this.#environment().now();
    if (this.#sessionExpiresAt !== undefined && now >= this.#sessionExpiresAt) {
      this.clearSession();
      return undefined;
    }
    if (this.#accessToken === undefined) return undefined;
    if (this.#accessToken.expiresAt <= now + 5000) {
      this.#accessToken = undefined;
      return undefined;
    }
    return this.#accessToken.value;
  }

  public async getValidAccessToken(): Promise<string | undefined> {
    const environment = this.#environment();
    const current = this.getAccessToken();
    if (
      current !== undefined &&
      this.#accessToken !== undefined &&
      this.#accessToken.expiresAt > environment.now() + renewalLeadMilliseconds
    )
      return current;
    if (this.#refreshPromise !== undefined) return this.#refreshPromise;
    if (environment.secureSession === true) return this.#restoreSecureSession();
    const refreshToken = this.#refreshToken;
    const config = this.#runtimeConfig;
    if (refreshToken === undefined || config === undefined) return current;
    if (environment.now() < this.#refreshRetryAt) {
      if (current !== undefined) return current;
      throw new CognitoBrowserAuthError(
        "token-unavailable",
        "Session renewal is temporarily unavailable. Try again shortly.",
      );
    }
    const generation = this.#sessionGeneration;
    const controller = new AbortController();
    this.#tokenRequestController = controller;
    const refresh = exchangeTokens(
      environment,
      config,
      new URLSearchParams({
        client_id: config.authentication.clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      controller,
    )
      .then((token) => {
        if (
          generation !== this.#sessionGeneration ||
          controller.signal.aborted
        ) {
          return undefined;
        }
        if (
          this.#sessionExpiresAt === undefined ||
          environment.now() >= this.#sessionExpiresAt
        ) {
          this.clearSession();
          return undefined;
        }
        this.#refreshRetryAt = 0;
        this.#accessToken = token;
        this.#refreshToken = token.refreshToken ?? refreshToken;
        return this.getAccessToken();
      })
      .catch((error: unknown) => {
        if (generation !== this.#sessionGeneration) return undefined;
        if (
          error instanceof CognitoBrowserAuthError &&
          error.code === "token-unavailable"
        ) {
          this.#refreshRetryAt = environment.now() + 5000;
          const usable = this.getAccessToken();
          if (usable !== undefined) return usable;
          throw error;
        }
        this.clearSession();
        return undefined;
      })
      .finally(() => {
        if (this.#tokenRequestController === controller)
          this.#tokenRequestController = undefined;
        if (this.#refreshPromise === refresh) this.#refreshPromise = undefined;
      });
    this.#refreshPromise = refresh;
    return refresh;
  }

  async #restoreSecureSession(): Promise<string | undefined> {
    if (!this.#restorationAllowed) return undefined;
    const environment = this.#environment();
    if (environment.now() < this.#refreshRetryAt) {
      const current = this.getAccessToken();
      if (current !== undefined) return current;
      throw new CognitoBrowserAuthError(
        "token-unavailable",
        "Session renewal is temporarily unavailable. Try again shortly.",
      );
    }
    const generation = this.#sessionGeneration;
    const controller = new AbortController();
    this.#tokenRequestController = controller;
    const refresh = requestSecureSession(environment, "restore", {}, controller)
      .then((token) => {
        if (generation !== this.#sessionGeneration || controller.signal.aborted)
          return undefined;
        if (token === undefined)
          throw new CognitoBrowserAuthError(
            "token-invalid",
            "The session response is invalid.",
          );
        this.#accessToken = token;
        this.#sessionExpiresAt = token.sessionExpiresAt;
        this.#refreshRetryAt = 0;
        return this.getAccessToken();
      })
      .catch((error: unknown) => {
        if (generation !== this.#sessionGeneration) return undefined;
        if (
          error instanceof CognitoBrowserAuthError &&
          error.code === "token-unavailable"
        ) {
          this.#refreshRetryAt = environment.now() + 5000;
          const current = this.getAccessToken();
          if (current !== undefined) return current;
          throw error;
        }
        if (this.#authorizationPreparing) {
          // Reject the old session without cancelling the new account action.
          // Its preparation will clear and revoke any retained handle below.
          this.#restorationAllowed = false;
          this.#accessToken = undefined;
          this.#refreshToken = undefined;
          this.#sessionExpiresAt = undefined;
          this.#refreshRetryAt = 0;
          return undefined;
        }
        this.clearSession();
        return undefined;
      })
      .finally(() => {
        if (this.#tokenRequestController === controller)
          this.#tokenRequestController = undefined;
        if (this.#refreshPromise === refresh) this.#refreshPromise = undefined;
      });
    this.#refreshPromise = refresh;
    return refresh;
  }

  public async createLogoutUrl(): Promise<string> {
    const environment = this.#environment();
    const config =
      this.#runtimeConfig ?? (await fetchCognitoRuntimeConfig(environment));
    this.#runtimeConfig = config;
    if (environment.secureSession === true) {
      await this.#cancelRetainedHandle(environment);
      await requestSecureSession(
        environment,
        "logout",
        this.#sessionHandle === undefined
          ? {}
          : { handle: this.#sessionHandle },
      );
    }
    const logoutUrl = new URL("/logout", config.authentication.domain);
    logoutUrl.search = new URLSearchParams({
      client_id: config.authentication.clientId,
      logout_uri: config.authentication.logoutUrl,
    }).toString();
    return logoutUrl.toString();
  }

  public clearSession(): void {
    this.#pendingCancellationHandle ??= this.#sessionHandle;
    this.#sessionGeneration += 1;
    this.#restorationAllowed = false;
    this.#sessionHandle = undefined;
    this.#refreshRetryAt = 0;
    this.#tokenRequestController?.abort();
    this.#tokenRequestController = undefined;
    this.#accessToken = undefined;
    this.#refreshToken = undefined;
    this.#refreshPromise = undefined;
    this.#sessionExpiresAt = undefined;
    this.#authorizationPreparing = false;
    this.#pendingAuthorization = undefined;
  }
}

export const browserCognitoAuthSession = new CognitoBrowserAuthSession();

export function getCognitoAccessToken(): string | undefined {
  return browserCognitoAuthSession.getAccessToken();
}

export function getValidCognitoAccessToken(): Promise<string | undefined> {
  return browserCognitoAuthSession.getValidAccessToken();
}

function callbackChannelName(state: string): string {
  if (state.length !== 43 || !base64UrlPattern.test(state)) {
    throw new CognitoBrowserAuthError(
      "callback-invalid",
      "The authentication callback is invalid.",
    );
  }
  return `${callbackChannelPrefix}${state}`;
}

function isParsedCallback(value: unknown): value is ParsedCognitoCallback {
  if (!isRecord(value) || typeof value["state"] !== "string") return false;
  if (value["kind"] === "success") {
    return (
      hasExactKeys(value, ["code", "kind", "state"]) &&
      typeof value["code"] === "string" &&
      oauthValuePattern.test(value["code"])
    );
  }
  return (
    value["kind"] === "error" &&
    hasExactKeys(value, ["error", "kind", "state"]) &&
    typeof value["error"] === "string" &&
    allowedProviderErrors.has(value["error"])
  );
}

function isCallbackMessage(value: unknown): value is CognitoCallbackMessage {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["callback", "kind", "schemaVersion"]) &&
    value["kind"] === "cloudmarkup.cognito-callback" &&
    value["schemaVersion"] === 1 &&
    isParsedCallback(value["callback"])
  );
}

function isCallbackAcknowledgement(
  value: unknown,
): value is CognitoCallbackAcknowledgement {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["kind", "schemaVersion", "status"]) &&
    value["kind"] === "cloudmarkup.cognito-callback-acknowledgement" &&
    value["schemaVersion"] === 1 &&
    (value["status"] === "accepted" || value["status"] === "rejected")
  );
}

export async function startCognitoSignInWithPopup(
  session: CognitoBrowserAuthSession = browserCognitoAuthSession,
  options: StartCognitoSignInOptions = {},
): Promise<void> {
  if (isSignalAborted(options.signal)) {
    throw new CognitoBrowserAuthError(
      "authorization-cancelled",
      "The sign-in attempt was cancelled.",
    );
  }
  if (
    typeof window === "undefined" ||
    typeof BroadcastChannel === "undefined"
  ) {
    throw new CognitoBrowserAuthError(
      "authorization-unavailable",
      "This browser cannot keep the sign-in verifier in memory.",
    );
  }
  const popup = window.open(
    "",
    "cloudmarkup-cognito-sign-in",
    "popup,width=520,height=720,resizable=yes,scrollbars=yes",
  );
  if (popup === null) {
    throw new CognitoBrowserAuthError(
      "authorization-popup-blocked",
      "Allow the sign-in window and try again.",
    );
  }
  try {
    popup.opener = null;
  } catch {
    popup.close();
    throw new CognitoBrowserAuthError(
      "authorization-unavailable",
      "The sign-in window could not be isolated.",
    );
  }

  let prepared: PreparedCognitoAuthorization;
  try {
    prepared =
      options.intent === undefined
        ? await session.prepareAuthorization()
        : await session.prepareAuthorization(options.intent);
  } catch (error) {
    popup.close();
    throw error;
  }
  if (isSignalAborted(options.signal)) {
    await session.cancelPendingAuthorization();
    popup.close();
    throw new CognitoBrowserAuthError(
      "authorization-cancelled",
      "The sign-in attempt was cancelled.",
    );
  }
  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(callbackChannelName(prepared.state));
  } catch {
    await session.cancelPendingAuthorization();
    popup.close();
    throw new CognitoBrowserAuthError(
      "authorization-unavailable",
      "The sign-in callback channel is unavailable.",
    );
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const closePopup = () => {
      try {
        popup.close();
      } catch {
        // COOP may sever the cross-origin WindowProxy. Completion does not
        // depend on observing or closing that handle.
      }
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
      channel.close();
      closePopup();
      if (error === undefined) resolve();
      else reject(error);
    };
    const cancel = () => {
      void session.cancelPendingAuthorization().then(
        () => {
          finish(
            new CognitoBrowserAuthError(
              "authorization-cancelled",
              "The sign-in attempt was cancelled.",
            ),
          );
        },
        () => {
          finish(
            new CognitoBrowserAuthError(
              "token-unavailable",
              "Cancellation could not be confirmed. Try again.",
            ),
          );
        },
      );
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    const timeout = window.setTimeout(() => {
      void session.cancelPendingAuthorization().then(
        () => {
          finish(
            new CognitoBrowserAuthError(
              "authorization-expired",
              "The sign-in attempt expired after 10 minutes.",
            ),
          );
        },
        () => {
          finish(
            new CognitoBrowserAuthError(
              "token-unavailable",
              "Cancellation could not be confirmed. Try again.",
            ),
          );
        },
      );
    }, COGNITO_AUTHORIZATION_TIMEOUT_MILLISECONDS);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isCallbackMessage(event.data)) return;
      if (!safeEqual(event.data.callback.state, prepared.state)) return;
      void session.completeCallback(event.data.callback).then(
        () => {
          const acknowledgement: CognitoCallbackAcknowledgement = {
            kind: "cloudmarkup.cognito-callback-acknowledgement",
            schemaVersion: 1,
            status: "accepted",
          };
          channel.postMessage(acknowledgement);
          finish();
        },
        (error: unknown) => {
          const acknowledgement: CognitoCallbackAcknowledgement = {
            kind: "cloudmarkup.cognito-callback-acknowledgement",
            schemaVersion: 1,
            status: "rejected",
          };
          channel.postMessage(acknowledgement);
          finish(
            error instanceof Error
              ? error
              : new CognitoBrowserAuthError(
                  "token-unavailable",
                  "The original browser session rejected the sign-in callback.",
                ),
          );
        },
      );
    };
    try {
      popup.location.replace(prepared.authorizationUrl);
    } catch {
      void session.cancelPendingAuthorization().then(
        () => {
          finish(
            new CognitoBrowserAuthError(
              "authorization-unavailable",
              "The sign-in window could not open the identity provider.",
            ),
          );
        },
        () => {
          finish(
            new CognitoBrowserAuthError(
              "token-unavailable",
              "Cancellation could not be confirmed. Try again.",
            ),
          );
        },
      );
    }
  });
}

export async function relayCognitoCallback(
  callback: ParsedCognitoCallback,
): Promise<void> {
  if (typeof BroadcastChannel === "undefined") {
    throw new CognitoBrowserAuthError(
      "authorization-unavailable",
      "The sign-in callback cannot reach the active browser session.",
    );
  }
  const channel = new BroadcastChannel(callbackChannelName(callback.state));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      finish(
        new CognitoBrowserAuthError(
          "authorization-unavailable",
          "The active sign-in window did not accept the callback.",
        ),
      );
    }, 30_000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      channel.close();
      if (error === undefined) resolve();
      else reject(error);
    };
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isCallbackAcknowledgement(event.data)) return;
      if (event.data.status === "accepted") finish();
      else {
        finish(
          new CognitoBrowserAuthError(
            "token-unavailable",
            "The original browser session rejected the sign-in callback.",
          ),
        );
      }
    };
    const message: CognitoCallbackMessage = {
      callback,
      kind: "cloudmarkup.cognito-callback",
      schemaVersion: 1,
    };
    channel.postMessage(message);
  });
}
