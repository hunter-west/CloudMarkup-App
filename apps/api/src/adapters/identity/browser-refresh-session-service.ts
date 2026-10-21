import { z } from "zod";
import type { PrincipalResolver } from "../../application/identity.js";
import type { BrowserRefreshSessions } from "../persistence/browser-refresh-sessions.js";

export const browserSessionHandleSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/u);
const refreshSchema = z
  .string()
  .min(1)
  .max(3000)
  .regex(/^[A-Za-z0-9._~+/=-]+$/u);
const tokenSchema = z.object({
  access_token: z
    .string()
    .min(1)
    .max(16384)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u),
  expires_in: z.number().int().positive().max(86400),
  token_type: z.literal("Bearer"),
  refresh_token: refreshSchema.optional(),
});
export class BrowserSessionError extends Error {
  readonly code: "invalid" | "rejected" | "unavailable";
  constructor(code: "invalid" | "rejected" | "unavailable") {
    super(
      code === "unavailable"
        ? "Session renewal is temporarily unavailable."
        : "The browser session is unavailable.",
    );
    this.code = code;
  }
}
export interface BrowserSessionGrant {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly sessionExpiresAt: string;
  readonly refreshToken: string;
  readonly handle: string;
}
export interface BrowserRefreshSessionConfiguration {
  readonly clientId: string;
  readonly domain: string;
  readonly callbackUrl: string;
  readonly principalResolver: PrincipalResolver;
  readonly sessions: BrowserRefreshSessions;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}
async function boundedJson(response: Response): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;|$)/iu.test(
      response.headers.get("content-type") ?? "",
    )
  )
    throw new BrowserSessionError("unavailable");
  const reader = response.body?.getReader();
  if (reader === undefined) throw new BrowserSessionError("unavailable");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunk: unknown = next.value;
      if (!(chunk instanceof Uint8Array))
        throw new BrowserSessionError("unavailable");
      length += chunk.byteLength;
      if (length > 32768) throw new BrowserSessionError("unavailable");
      chunks.push(chunk);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new BrowserSessionError("unavailable");
  }
}
/** Cognito transport only. Verified principal and durable session checks precede
 * access emission; provider credentials are confined to RAM and HttpOnly cookies. */
export class BrowserRefreshSessionService {
  readonly #config: BrowserRefreshSessionConfiguration;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => number;
  constructor(config: BrowserRefreshSessionConfiguration) {
    const domain = new URL(config.domain);
    const callback = new URL(config.callbackUrl);
    if (
      domain.protocol !== "https:" ||
      domain.pathname !== "/" ||
      domain.search ||
      domain.hash ||
      domain.username ||
      domain.password ||
      domain.port ||
      !domain.hostname.endsWith(".auth.us-east-1.amazoncognito.com") ||
      callback.protocol !== "https:" ||
      callback.pathname !== "/auth/callback" ||
      callback.search ||
      callback.hash ||
      callback.username ||
      callback.password ||
      !/^[a-z0-9]{26}$/u.test(config.clientId)
    )
      throw new TypeError("Invalid fixed browser session configuration.");
    this.#config = config;
    this.#fetch = config.fetch ?? globalThis.fetch;
    this.#now = config.now ?? Date.now;
  }
  async #tokens(form: URLSearchParams) {
    try {
      const response = await this.#fetch(
        new URL("/oauth2/token", this.#config.domain),
        {
          method: "POST",
          body: form,
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        },
      );
      const value = await boundedJson(response);
      if (
        response.status === 400 &&
        typeof value === "object" &&
        value !== null &&
        "error" in value &&
        value.error === "invalid_grant"
      )
        throw new BrowserSessionError("rejected");
      if (response.status !== 200) throw new BrowserSessionError("unavailable");
      const parsed = tokenSchema.safeParse(value);
      if (!parsed.success) throw new BrowserSessionError("unavailable");
      return parsed.data;
    } catch (error) {
      if (error instanceof BrowserSessionError) throw error;
      throw new BrowserSessionError("unavailable");
    }
  }
  async exchange(input: {
    readonly handle: string;
    readonly code: string;
    readonly verifier: string;
  }): Promise<BrowserSessionGrant> {
    if (!(await this.#config.sessions.begin(input.handle)))
      throw new BrowserSessionError("rejected");
    let refreshToken: string | undefined;
    try {
      const token = await this.#tokens(
        new URLSearchParams({
          client_id: this.#config.clientId,
          grant_type: "authorization_code",
          code: input.code,
          code_verifier: input.verifier,
          redirect_uri: this.#config.callbackUrl,
        }),
      );
      refreshToken = token.refresh_token;
      if (refreshToken === undefined) throw new BrowserSessionError("rejected");
      const principal = await this.#config.principalResolver.resolve(
        "Bearer " + token.access_token,
      );
      if (principal?.authenticationSource !== "cognito")
        throw new BrowserSessionError("rejected");
      const expires = await this.#config.sessions.activate(
        input.handle,
        principal,
      );
      if (expires === null) throw new BrowserSessionError("rejected");
      return this.#grant(
        input.handle,
        refreshToken,
        token,
        expires,
        principal.expiresAt,
      );
    } catch (error) {
      await this.#config.sessions.revoke(input.handle);
      if (refreshToken !== undefined) await this.#revokeProvider(refreshToken);
      throw error;
    }
  }
  async restore(input: {
    readonly handle: string;
    readonly refreshToken: string;
  }): Promise<BrowserSessionGrant> {
    let token;
    try {
      token = await this.#tokens(
        new URLSearchParams({
          client_id: this.#config.clientId,
          grant_type: "refresh_token",
          refresh_token: input.refreshToken,
        }),
      );
    } catch (error) {
      if (error instanceof BrowserSessionError && error.code === "rejected")
        await this.#config.sessions.revoke(input.handle);
      throw error;
    }
    const principal = await this.#config.principalResolver.resolve(
      "Bearer " + token.access_token,
    );
    if (principal?.authenticationSource !== "cognito")
      throw new BrowserSessionError("rejected");
    const expires = await this.#config.sessions.current(
      input.handle,
      principal,
    );
    if (expires === null) throw new BrowserSessionError("rejected");
    // This transport uses the existing non-rotating Cognito client. Restores
    // are cookie-read-only so delayed replies cannot clobber newer sign-ins.
    if (
      token.refresh_token !== undefined &&
      token.refresh_token !== input.refreshToken
    )
      throw new BrowserSessionError("unavailable");
    return this.#grant(
      input.handle,
      input.refreshToken,
      token,
      expires,
      principal.expiresAt,
    );
  }
  #grant(
    handle: string,
    refreshToken: string,
    token: z.output<typeof tokenSchema>,
    expires: string,
    tokenExpires: string,
  ): BrowserSessionGrant {
    const seconds = Math.floor(
      (Math.min(Date.parse(expires), Date.parse(tokenExpires)) - this.#now()) /
        1000,
    );
    if (!Number.isSafeInteger(seconds) || seconds <= 0)
      throw new BrowserSessionError("rejected");
    return {
      handle,
      refreshToken,
      accessToken: token.access_token,
      expiresIn: Math.min(token.expires_in, seconds),
      sessionExpiresAt: expires,
    };
  }
  async revoke(handle: string, refreshToken?: string): Promise<void> {
    await this.#config.sessions.revoke(handle);
    if (refreshToken !== undefined) await this.#revokeProvider(refreshToken);
  }
  async #revokeProvider(token: string): Promise<void> {
    try {
      await this.#fetch(new URL("/oauth2/revoke", this.#config.domain), {
        method: "POST",
        body: new URLSearchParams({ client_id: this.#config.clientId, token }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      /* Durable revocation already prevents restoration. */
    }
  }
}
export const browserSessionCookieSchema = z.tuple([
  browserSessionHandleSchema,
  refreshSchema,
]);
