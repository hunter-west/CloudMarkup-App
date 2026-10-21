/** An opt-in, single-operator browser session. Proofs and bearer tokens never
 * enter URLs, cookies, browser storage, logs, or React query keys. */
const proofPattern = /^[A-Za-z0-9_-]{43}$/u;
const tokenPattern = /^cmlo1_[A-Za-z0-9_-]{43}$/u;
const maximumResponseBytes = 1_024;

export function selectLocalOwnerAuthentication(
  mode: string | undefined,
  origin: string,
  apiBaseUrl: string | undefined,
  legacyDevelopmentToken: string | undefined,
): boolean {
  if (mode === undefined || mode === "cognito") return false;
  if (mode !== "local-owner")
    throw new TypeError("Unknown browser authentication mode.");
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    url.hostname !== "127.0.0.1" ||
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    (apiBaseUrl !== undefined && apiBaseUrl !== "/api") ||
    legacyDevelopmentToken !== undefined
  ) {
    throw new TypeError(
      "Local owner authentication requires an isolated loopback web origin and same-origin API.",
    );
  }
  return true;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (
    response.redirected ||
    response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() !== "application/json" ||
    response.body === null
  )
    throw new TypeError("The local authentication response is invalid.");
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) ||
      Number(declaredLength) > maximumResponseBytes)
  )
    throw new TypeError("The local authentication response is invalid.");
  const reader = response.body.getReader();
  const bytes = new Uint8Array(maximumResponseBytes);
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (length + next.value.byteLength > bytes.length)
        throw new TypeError("The local authentication response is invalid.");
      bytes.set(next.value, length);
      length += next.value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (length === 0)
    throw new TypeError("The local authentication response is invalid.");
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)),
  ) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class LocalOwnerBrowserSession {
  #accessToken: string | undefined;
  #expiresAt = 0;
  #generation = 0;
  #signOutInFlight:
    | {
        readonly token: string;
        readonly generation: number;
        readonly promise: Promise<boolean>;
      }
    | undefined;
  readonly #fetch: typeof fetch;

  constructor(fetchImplementation: typeof fetch, origin: string) {
    if (
      !selectLocalOwnerAuthentication("local-owner", origin, "/api", undefined)
    )
      throw new TypeError("Local owner authentication is unavailable.");
    this.#fetch = fetchImplementation;
  }

  getValidAccessToken(): string | undefined {
    if (Date.now() >= this.#expiresAt) {
      this.clear();
    }
    return this.#accessToken;
  }

  clear(): void {
    this.#accessToken = undefined;
    this.#expiresAt = 0;
    this.#generation += 1;
  }

  async exchange(proof: string, signal?: AbortSignal): Promise<void> {
    if (!proofPattern.test(proof))
      throw new TypeError(
        "Enter the 32-byte local owner proof created during setup.",
      );
    const requestSignal =
      signal === undefined
        ? AbortSignal.timeout(15_000)
        : AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    requestSignal.throwIfAborted();
    const response = await this.#fetch("/auth/local-owner/v1/exchange", {
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-cloudmarkup-session": "1",
      },
      method: "POST",
      mode: "same-origin",
      redirect: "error",
      body: JSON.stringify({ schemaVersion: 1, proof }),
      signal: requestSignal,
    });
    if (response.status !== 200)
      throw new TypeError(
        "The local owner proof was not accepted. Check the server and try again.",
      );
    const body = await boundedJson(response);
    if (
      !isRecord(body) ||
      Object.keys(body).sort().join(",") !==
        "accessToken,expiresAt,expiresIn,schemaVersion" ||
      body["schemaVersion"] !== 1 ||
      typeof body["accessToken"] !== "string" ||
      !tokenPattern.test(body["accessToken"]) ||
      typeof body["expiresAt"] !== "string" ||
      typeof body["expiresIn"] !== "number" ||
      !Number.isSafeInteger(body["expiresIn"]) ||
      body["expiresIn"] !== 28_800
    )
      throw new TypeError("The local authentication response is invalid.");
    const expiry = Date.parse(body["expiresAt"]);
    const now = Date.now();
    if (
      !Number.isSafeInteger(expiry) ||
      new Date(expiry).toISOString() !== body["expiresAt"] ||
      expiry <= now ||
      expiry > now + 28_800_000 + 30_000
    )
      throw new TypeError("The local authentication response is invalid.");
    if (requestSignal.aborted)
      throw new TypeError("The local sign-in was cancelled or timed out.");
    this.#accessToken = body["accessToken"];
    this.#expiresAt = expiry;
    this.#generation += 1;
  }

  async signOut(): Promise<boolean> {
    const token = this.getValidAccessToken();
    if (token === undefined) {
      this.clear();
      return true;
    }
    const generation = this.#generation;
    if (
      this.#signOutInFlight?.token === token &&
      this.#signOutInFlight.generation === generation
    )
      return this.#signOutInFlight.promise;
    const promise = (async () => {
      const response = await this.#fetch("/auth/local-owner/v1/logout", {
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-cloudmarkup-session": "1",
        },
        method: "POST",
        mode: "same-origin",
        redirect: "error",
        body: JSON.stringify({ schemaVersion: 1 }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status !== 204 || response.redirected)
        throw new TypeError(
          "The local session could not be revoked. Try again.",
        );
      if (this.#generation !== generation || this.#accessToken !== token)
        return false;
      this.clear();
      return true;
    })();
    this.#signOutInFlight = { token, generation, promise };
    try {
      return await promise;
    } finally {
      this.#finishSignOut(promise);
    }
  }

  #finishSignOut(promise: Promise<boolean>): void {
    if (this.#signOutInFlight?.promise === promise)
      this.#signOutInFlight = undefined;
  }
}
