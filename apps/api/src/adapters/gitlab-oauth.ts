import { GitLabTokenMaterial } from "./gitlab-token-material.js";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  GitLabProviderError,
  gitLabSecretText,
  withGitLabOperation,
  type GitLabTransportOptions,
} from "./gitlab-http.js";

const textToken = z
  .string()
  .min(20)
  .max(4096)
  .regex(/^[A-Za-z0-9._~+/-]+={0,2}$/u);
const verifier = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/u);
const providerId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const tokenResponse = z.object({
  access_token: textToken,
  refresh_token: textToken,
  token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
  created_at: z.number().int().nonnegative(),
  expires_in: z.number().int().positive().max(86400),
});
const tokenInformation = z.object({
  resource_owner_id: providerId,
  scope: z.tuple([z.literal("api")]),
  application: z.object({ uid: z.string() }),
  expires_in: z.number().int().positive().max(86400),
});
const userResponse = z.object({
  id: providerId,
  username: z.string().min(1).max(255),
  state: z.literal("active"),
});

export interface GitLabOAuthConfiguration {
  readonly clientId: string;
  readonly redirectUri: string;
  /** Server configuration only. Return a fresh mutable buffer, cleared after use. */
  readonly readClientSecret: () => Promise<Uint8Array>;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

/** Secret bytes cannot be serialized with the metadata. Consumption clears both buffers. */
export class GitLabOAuthGrant extends GitLabTokenMaterial {
  readonly providerUserId: number;
  readonly username: string;
  readonly expiresAt: string;
  constructor(
    providerUserId: number,
    username: string,
    expiresAt: string,
    access: Uint8Array,
    refresh: Uint8Array,
  ) {
    super(access, refresh);
    this.providerUserId = providerUserId;
    this.username = username;
    this.expiresAt = expiresAt;
  }
}

/** OAuth protocol only. One-time actor/session-bound state and encrypted persistence belong to the application. */
export class GitLabOAuthAdapter {
  readonly #configuration: GitLabOAuthConfiguration;
  constructor(configuration: GitLabOAuthConfiguration) {
    const redirect = new URL(configuration.redirectUri);
    if (
      !/^[a-f0-9]{64}$/u.test(configuration.clientId) ||
      redirect.protocol !== "https:" ||
      redirect.username ||
      redirect.password ||
      redirect.hash ||
      redirect.search ||
      redirect.href !== configuration.redirectUri
    )
      throw new TypeError("Invalid GitLab OAuth configuration.");
    this.#configuration = Object.freeze({ ...configuration });
  }
  createAuthorization(): {
    readonly url: string;
    readonly state: string;
    readonly verifier: string;
  } {
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const url = new URL("https://gitlab.com/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: this.#configuration.clientId,
      redirect_uri: this.#configuration.redirectUri,
      response_type: "code",
      state,
      scope: "api",
      code_challenge: createHash("sha256")
        .update(codeVerifier)
        .digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    return { url: url.href, state, verifier: codeVerifier };
  }
  exchange(
    input: { readonly code: string; readonly verifier: string },
    admission: Omit<GitLabTransportOptions, "fetch">,
  ): Promise<GitLabOAuthGrant> {
    const parsed = z
      .object({ code: textToken, verifier })
      .strict()
      .safeParse(input);
    if (!parsed.success)
      throw new GitLabProviderError("not-sent", "invalid-input");
    return this.#grant(
      {
        grant_type: "authorization_code",
        code: parsed.data.code,
        code_verifier: parsed.data.verifier,
      },
      admission,
    );
  }
  refresh(
    input: {
      readonly refreshToken: Uint8Array;
      readonly providerUserId: number;
    },
    admission: Omit<GitLabTransportOptions, "fetch">,
  ): Promise<GitLabOAuthGrant> {
    if (!providerId.safeParse(input.providerUserId).success)
      throw new GitLabProviderError("not-sent", "invalid-input");
    const refreshToken = gitLabSecretText(input.refreshToken);
    return this.#grant(
      { grant_type: "refresh_token", refresh_token: refreshToken },
      admission,
      input.providerUserId,
    );
  }
  async #grant(
    fields: Readonly<Record<string, string>>,
    admission: Omit<GitLabTransportOptions, "fetch">,
    expectedUserId?: number,
  ): Promise<GitLabOAuthGrant> {
    let grant: GitLabOAuthGrant | undefined;
    let access: Uint8Array | undefined;
    let refresh: Uint8Array | undefined;
    try {
      return await withGitLabOperation(
        {
          ...admission,
          ...(this.#configuration.fetch
            ? { fetch: this.#configuration.fetch }
            : {}),
        },
        async (operation) => {
          const secret = await this.#configuration.readClientSecret();
          try {
            const body = new URLSearchParams({
              ...fields,
              client_id: this.#configuration.clientId,
              client_secret: gitLabSecretText(secret),
              redirect_uri: this.#configuration.redirectUri,
            }).toString();
            const response = await operation.request({
              path: "/oauth/token",
              method: "POST",
              body,
              contentType: "application/x-www-form-urlencoded",
              successStatus: 200,
            });
            const parsed = tokenResponse.safeParse(response?.value);
            if (!parsed.success)
              throw new GitLabProviderError("uncertain", "unavailable");
            const token = parsed.data;
            access = new TextEncoder().encode(token.access_token);
            refresh = new TextEncoder().encode(token.refresh_token);
            const now = (this.#configuration.now?.() ?? new Date()).getTime();
            const expires = (token.created_at + token.expires_in) * 1000;
            if (
              !Number.isFinite(now) ||
              token.created_at * 1000 > now + 60_000 ||
              expires <= now + 30_000 ||
              expires > now + 86460_000
            )
              throw new GitLabProviderError("uncertain", "unavailable");
            const info = tokenInformation.safeParse(
              (
                await operation.request({
                  path: "/oauth/token/info",
                  method: "GET",
                  token: access,
                  successStatus: 200,
                })
              )?.value,
            );
            if (
              !info.success ||
              info.data.application.uid !== this.#configuration.clientId ||
              (expectedUserId !== undefined &&
                info.data.resource_owner_id !== expectedUserId)
            )
              throw new GitLabProviderError("uncertain", "access-denied");
            const user = userResponse.safeParse(
              (
                await operation.request({
                  path: "/api/v4/user",
                  method: "GET",
                  token: access,
                  successStatus: 200,
                })
              )?.value,
            );
            if (!user.success || user.data.id !== info.data.resource_owner_id)
              throw new GitLabProviderError("uncertain", "access-denied");
            // Never extend the token's own expiry using a later information response.
            const conservativeExpiry = Math.min(
              expires,
              now + info.data.expires_in * 1000,
            );
            if (conservativeExpiry <= now + 30_000)
              throw new GitLabProviderError("uncertain", "unavailable");
            grant = new GitLabOAuthGrant(
              user.data.id,
              user.data.username,
              new Date(conservativeExpiry).toISOString(),
              access,
              refresh,
            );
            return grant;
          } finally {
            secret.fill(0);
          }
        },
      );
    } catch (error) {
      grant?.dispose();
      access?.fill(0);
      refresh?.fill(0);
      if (error instanceof GitLabProviderError) throw error;
      throw new GitLabProviderError("uncertain", "unavailable");
    }
  }
  async revoke(
    token: Uint8Array,
    admission: Omit<GitLabTransportOptions, "fetch">,
  ): Promise<void> {
    const value = gitLabSecretText(token);
    await withGitLabOperation(
      {
        ...admission,
        ...(this.#configuration.fetch
          ? { fetch: this.#configuration.fetch }
          : {}),
      },
      async (operation) => {
        const secret = await this.#configuration.readClientSecret();
        try {
          const response = await operation.request({
            path: "/oauth/revoke",
            method: "POST",
            successStatus: 200,
            contentType: "application/x-www-form-urlencoded",
            body: new URLSearchParams({
              client_id: this.#configuration.clientId,
              client_secret: gitLabSecretText(secret),
              token: value,
            }).toString(),
          });
          if (!z.object({}).strict().safeParse(response?.value).success)
            throw new GitLabProviderError("uncertain", "unavailable");
        } finally {
          secret.fill(0);
        }
      },
    );
  }
}
