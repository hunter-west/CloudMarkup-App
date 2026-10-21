import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { GitHubExportError } from "@cloudmarkup/github-repository-export/errors";
import {
  gitHubInstallationLinkIntentSchema,
  gitHubInstallationLinkStateSchema,
} from "@cloudmarkup/github-repository-export/contracts";
import type {
  GitHubFetch,
  GitHubInstallationLinkCallbackVerifier,
  SecretConfigurationResolver,
  VerifiedGitHubInstallationLinkCallback,
} from "@cloudmarkup/github-repository-export";
import { z } from "zod";

const MAX_SESSION_SECONDS = 600;
const MAX_RESPONSE_BYTES = 524_288;
const MAX_PAGES = 5;
const MAX_FLOW_MILLISECONDS = 20_000;
const opaqueIdSchema = gitHubInstallationLinkIntentSchema.shape.intentId;
const opaqueTokenSchema = z
  .string()
  .min(1)
  .max(4_096)
  .regex(/^[A-Za-z0-9_.-]+$/);
const identitySchema = z.object({
  expiresAt: z.iso.datetime(),
  intentId: opaqueIdSchema,
  issuedAt: z.iso.datetime(),
  organizationId: opaqueIdSchema,
  principalId: opaqueIdSchema,
  returnPath: z.string().min(1).max(512),
  sessionId: opaqueIdSchema,
  state: gitHubInstallationLinkStateSchema,
});
const browserSchema = identitySchema
  .extend({
    installationId: z.number().int().positive().optional(),
    oauthState: gitHubInstallationLinkStateSchema,
    pkceVerifier: gitHubInstallationLinkStateSchema,
    stage: z.enum(["installation", "authorization"]),
  })
  .strict();
const receiptSchema = identitySchema
  .extend({
    accountId: z.number().int().positive(),
    accountType: z.enum(["Organization", "User"]),
    installationId: z.number().int().positive(),
    setupAction: z.literal("install"),
  })
  .strict();
const accountSchema = z
  .object({
    id: z.number().int().positive(),
    type: z.enum(["Organization", "User"]),
  })
  .loose();
const userSchema = z
  .object({
    id: z.number().int().positive(),
    type: z.literal("User"),
  })
  .loose();
const installationSchema = z
  .object({
    account: accountSchema,
    app_id: z.number().int().positive(),
    id: z.number().int().positive(),
    permissions: z
      .object({
        contents: z.literal("write"),
        metadata: z.literal("read"),
        pull_requests: z.literal("write"),
      })
      .loose(),
    repository_selection: z.literal("selected"),
    suspended_at: z.null(),
  })
  .loose();
const installationPageSchema = z
  .object({
    installations: z.array(z.unknown()).max(100),
    total_count: z.number().int().nonnegative(),
  })
  .loose();
const membershipSchema = z
  .object({
    organization: z.object({ id: z.number().int().positive() }).loose(),
    role: z.enum(["admin", "member"]),
    state: z.enum(["active", "pending"]),
    user: z.object({ id: z.number().int().positive() }).loose(),
  })
  .loose();
const tokenSchema = z
  .object({
    access_token: z
      .string()
      .min(20)
      .max(1_024)
      .regex(/^ghu_[A-Za-z0-9_]+$/),
    scope: z.literal(""),
    token_type: z.literal("bearer"),
  })
  .loose();

export interface GitHubInstallationLinkOptions {
  readonly appId: number;
  readonly appSlug: string;
  readonly callbackUrl: string;
  readonly clientId: string;
  readonly clientSecretReference: string;
  /** Set only when the existing secret is a JSON object, not a plain secret. */
  readonly clientSecretJsonField?: string;
  readonly clock?: () => Date;
  readonly fetch?: GitHubFetch;
  readonly secrets: SecretConfigurationResolver;
}

type BrowserSession = z.output<typeof browserSchema>;
type Identity = z.output<typeof identitySchema>;
type CallbackContext = Parameters<
  GitHubInstallationLinkCallbackVerifier["verifyCallbackReceipt"]
>[1];

function denied(): never {
  throw new GitHubExportError("installation-link-invalid");
}

function equal(left: string, right: string): boolean {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
}

/**
 * Provider-specific browser proof authority. Call createBrowserSession only after
 * current tenant authorization. Its cookie value is never a product access token:
 * the host must set it HttpOnly, Secure, SameSite=Lax, Path=/, without Domain.
 * Final completion still requires the same verified Cognito session and the
 * existing database intent's atomic one-time claim. Do not log cookies or receipts.
 */
export class GitHubInstallationLinkAdapter implements GitHubInstallationLinkCallbackVerifier {
  readonly #options: GitHubInstallationLinkOptions;
  readonly #clock: () => Date;
  readonly #fetch: GitHubFetch;
  readonly #audience: string;

  constructor(options: GitHubInstallationLinkOptions) {
    const callback = new URL(options.callbackUrl);
    if (
      !Number.isSafeInteger(options.appId) ||
      options.appId <= 0 ||
      !/^[a-z0-9-]{1,100}$/.test(options.appSlug) ||
      !/^[A-Za-z0-9]{10,100}$/.test(options.clientId) ||
      callback.protocol !== "https:" ||
      callback.username !== "" ||
      callback.password !== "" ||
      callback.search !== "" ||
      callback.hash !== "" ||
      options.clientSecretReference.length === 0
    )
      throw new GitHubExportError("invalid-request");
    this.#options = options;
    this.#clock = options.clock ?? (() => new Date());
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#audience = `${String(options.appId)}:${options.clientId}:${callback.href}`;
  }

  async createBrowserSession(input: Omit<Identity, "issuedAt">): Promise<{
    readonly cookie: string;
    readonly installationUrl: string;
  }> {
    const session = browserSchema.parse({
      ...input,
      issuedAt: this.#clock().toISOString(),
      oauthState: randomBytes(32).toString("base64url"),
      pkceVerifier: randomBytes(32).toString("base64url"),
      stage: "installation",
    });
    this.#validateIdentity(session);
    const installationUrl = new URL(
      `https://github.com/apps/${this.#options.appSlug}/installations/new`,
    );
    installationUrl.searchParams.set("state", session.state);
    return {
      cookie: await this.#seal("browser", session),
      installationUrl: installationUrl.href,
    };
  }

  async continueInstallationSetup(input: {
    readonly cookie: string;
    readonly installationId: number;
    readonly setupAction: string;
    readonly state: string;
  }): Promise<{ readonly authorizationUrl: string; readonly cookie: string }> {
    const session = await this.#openBrowser(input.cookie);
    if (
      session.stage !== "installation" ||
      input.setupAction !== "install" ||
      !Number.isSafeInteger(input.installationId) ||
      input.installationId <= 0 ||
      !equal(session.state, input.state)
    )
      denied();
    const authorization = new URL("https://github.com/login/oauth/authorize");
    authorization.searchParams.set("client_id", this.#options.clientId);
    authorization.searchParams.set("redirect_uri", this.#options.callbackUrl);
    authorization.searchParams.set("state", session.oauthState);
    authorization.searchParams.set(
      "code_challenge",
      createHash("sha256").update(session.pkceVerifier).digest("base64url"),
    );
    authorization.searchParams.set("code_challenge_method", "S256");
    return {
      authorizationUrl: authorization.href,
      cookie: await this.#seal("browser", {
        ...session,
        installationId: input.installationId,
        stage: "authorization",
      }),
    };
  }

  async completeAuthorization(input: {
    readonly code: string;
    readonly cookie: string;
    readonly state: string;
  }): Promise<Identity & { readonly callbackReceipt: string }> {
    const session = await this.#openBrowser(input.cookie);
    if (
      session.stage !== "authorization" ||
      session.installationId === undefined ||
      !equal(session.oauthState, input.state) ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(input.code)
    )
      denied();
    const deadline = Date.now() + MAX_FLOW_MILLISECONDS;
    const token = await this.#withSecret(async (secret) => {
      const response = await this.#request(
        "https://github.com/login/oauth/access_token",
        {
          body: new URLSearchParams({
            client_id: this.#options.clientId,
            client_secret: secret.toString("utf8"),
            code: input.code,
            code_verifier: session.pkceVerifier,
            redirect_uri: this.#options.callbackUrl,
          }).toString(),
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        },
        deadline,
      );
      const parsed = tokenSchema.safeParse(response);
      if (!parsed.success) denied();
      return Buffer.from(parsed.data.access_token);
    });
    try {
      const account = await this.#verifyOwner(
        session.installationId,
        token,
        deadline,
      );
      this.#validateIdentity(session);
      const identity = identitySchema.parse(session);
      return {
        ...identity,
        callbackReceipt: await this.#seal("receipt", {
          ...identity,
          accountId: account.id,
          accountType: account.type,
          installationId: session.installationId,
          setupAction: "install",
        }),
      };
    } finally {
      token.fill(0);
    }
  }

  async verifyCallbackReceipt(
    callbackReceipt: string,
    context?: CallbackContext,
  ): Promise<VerifiedGitHubInstallationLinkCallback> {
    const parsed = receiptSchema.safeParse(
      await this.#open("receipt", callbackReceipt),
    );
    if (!parsed.success || context?.sessionId === undefined) denied();
    const receipt = parsed.data;
    this.#validateIdentity(receipt);
    if (
      !equal(receipt.intentId, context.intentId) ||
      !equal(receipt.organizationId, context.organizationId) ||
      !equal(receipt.principalId, context.principalId) ||
      !equal(receipt.sessionId, context.sessionId)
    )
      denied();
    return {
      installationId: receipt.installationId,
      setupAction: "install",
      state: receipt.state,
      verifiedAccount: {
        accountId: receipt.accountId,
        accountType: receipt.accountType,
        repositorySelection: "selected",
      },
    };
  }

  #validateIdentity(identity: Identity): void {
    const now = this.#clock().getTime();
    const issuedAt = Date.parse(identity.issuedAt);
    const expiresAt = Date.parse(identity.expiresAt);
    const prefix = `/organizations/${encodeURIComponent(identity.organizationId)}`;
    if (
      issuedAt > now ||
      expiresAt <= now ||
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > MAX_SESSION_SECONDS * 1_000 ||
      !(
        identity.returnPath === prefix ||
        identity.returnPath.startsWith(`${prefix}/`)
      ) ||
      /[\\?#%\s]/.test(identity.returnPath) ||
      identity.returnPath.includes("//") ||
      identity.returnPath
        .split("/")
        .some((part) => part === "." || part === "..")
    )
      denied();
  }

  async #openBrowser(cookie: string): Promise<BrowserSession> {
    const parsed = browserSchema.safeParse(await this.#open("browser", cookie));
    if (!parsed.success) denied();
    this.#validateIdentity(parsed.data);
    return parsed.data;
  }

  async #withSecret<T>(operation: (secret: Buffer) => Promise<T>): Promise<T> {
    let raw: Uint8Array | undefined;
    let value: Buffer | undefined;
    try {
      raw = await this.#options.secrets.resolveSecret(
        this.#options.clientSecretReference,
      );
      if (raw.byteLength > 4_096) throw new Error("Invalid secret shape");
      let decoded = Buffer.from(raw).toString("utf8");
      if (this.#options.clientSecretJsonField !== undefined) {
        const record: unknown = JSON.parse(decoded);
        const parsed = z.record(z.string(), z.string()).safeParse(record);
        if (!parsed.success || Object.keys(parsed.data).length !== 1)
          throw new Error("Invalid secret shape");
        decoded = parsed.data[this.#options.clientSecretJsonField] ?? "";
      }
      if (!/^[A-Za-z0-9_-]{20,256}$/.test(decoded))
        throw new Error("Invalid secret shape");
      value = Buffer.from(decoded);
    } catch {
      throw new GitHubExportError("secret-unavailable", { transient: true });
    } finally {
      raw?.fill(0);
    }
    try {
      return await operation(value);
    } finally {
      value.fill(0);
    }
  }

  async #seal(purpose: "browser" | "receipt", value: unknown): Promise<string> {
    return this.#withSecret((secret) => {
      const key = Buffer.from(
        hkdfSync(
          "sha256",
          secret,
          this.#audience,
          `cloudmarkup.github-link.v1.${purpose}`,
          32,
        ),
      );
      const clear = Buffer.from(JSON.stringify(value));
      try {
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(Buffer.from(`${this.#audience}:${purpose}:v1`));
        const ciphertext = Buffer.concat([
          cipher.update(clear),
          cipher.final(),
        ]);
        return Promise.resolve(
          `v1.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`,
        );
      } finally {
        key.fill(0);
        clear.fill(0);
      }
    });
  }

  async #open(
    purpose: "browser" | "receipt",
    opaque: string,
  ): Promise<unknown> {
    if (!opaqueTokenSchema.safeParse(opaque).success) denied();
    const parts = opaque.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") denied();
    const iv = Buffer.from(parts[1] ?? "", "base64url");
    const ciphertext = Buffer.from(parts[2] ?? "", "base64url");
    const tag = Buffer.from(parts[3] ?? "", "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0)
      denied();
    return this.#withSecret((secret) => {
      const key = Buffer.from(
        hkdfSync(
          "sha256",
          secret,
          this.#audience,
          `cloudmarkup.github-link.v1.${purpose}`,
          32,
        ),
      );
      let clear: Buffer | undefined;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(Buffer.from(`${this.#audience}:${purpose}:v1`));
        decipher.setAuthTag(tag);
        clear = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return Promise.resolve(JSON.parse(clear.toString("utf8")) as unknown);
      } catch {
        denied();
      } finally {
        key.fill(0);
        clear?.fill(0);
      }
    });
  }

  async #verifyOwner(
    installationId: number,
    token: Buffer,
    deadline: number,
  ): Promise<z.output<typeof accountSchema>> {
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token.toString("utf8")}`,
      "User-Agent": "CloudMarkup-GitHub-Link",
      "X-GitHub-Api-Version": "2026-03-10",
    };
    const user = userSchema.safeParse(
      await this.#request("https://api.github.com/user", { headers }, deadline),
    );
    if (!user.success) denied();
    let installation: z.output<typeof installationSchema> | undefined;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = installationPageSchema.safeParse(
        await this.#request(
          `https://api.github.com/user/installations?per_page=100&page=${String(page)}`,
          { headers },
          deadline,
        ),
      );
      if (!result.success) denied();
      const matches = result.data.installations.filter(
        (item) =>
          z
            .object({ id: z.literal(installationId) })
            .loose()
            .safeParse(item).success,
      );
      if (matches.length > 1) denied();
      if (matches.length === 1) {
        const parsed = installationSchema.safeParse(matches[0]);
        if (!parsed.success || parsed.data.app_id !== this.#options.appId)
          denied();
        installation = parsed.data;
        break;
      }
      if (
        result.data.installations.length < 100 ||
        page * 100 >= result.data.total_count
      )
        break;
    }
    if (installation === undefined) denied();
    if (installation.account.type === "User") {
      if (installation.account.id !== user.data.id) denied();
      return installation.account;
    }
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = z
        .array(z.unknown())
        .max(100)
        .safeParse(
          await this.#request(
            `https://api.github.com/user/memberships/orgs?state=active&per_page=100&page=${String(page)}`,
            { headers },
            deadline,
          ),
        );
      if (!result.success) denied();
      for (const candidate of result.data) {
        const membership = membershipSchema.safeParse(candidate);
        if (
          membership.success &&
          membership.data.organization.id === installation.account.id &&
          membership.data.user.id === user.data.id &&
          membership.data.role === "admin" &&
          membership.data.state === "active"
        )
          return installation.account;
      }
      if (result.data.length < 100) break;
    }
    denied();
  }

  async #request(
    url: string,
    init: RequestInit,
    deadline: number,
  ): Promise<unknown> {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new GitHubExportError("service-unavailable", { transient: true });
    try {
      const response = await this.#fetch(url, {
        ...init,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(Math.min(5_000, remaining)),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        if (response.status === 429 || response.status >= 500)
          throw new GitHubExportError("service-unavailable", {
            transient: true,
          });
        denied();
      }
      const reader = response.body?.getReader();
      if (reader === undefined) denied();
      const chunks: Uint8Array[] = [];
      let body: Buffer | undefined;
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          if (!(part.value instanceof Uint8Array)) denied();
          size += part.value.byteLength;
          if (size > MAX_RESPONSE_BYTES) {
            part.value.fill(0);
            denied();
          }
          chunks.push(part.value);
        }
        body = Buffer.concat(chunks);
        return JSON.parse(body.toString("utf8")) as unknown;
      } finally {
        try {
          await reader.cancel();
        } finally {
          body?.fill(0);
          for (const chunk of chunks) chunk.fill(0);
        }
      }
    } catch (error) {
      if (error instanceof GitHubExportError) throw error;
      throw new GitHubExportError("service-unavailable", { transient: true });
    }
  }
}
