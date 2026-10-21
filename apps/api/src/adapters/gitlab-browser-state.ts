import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import {
  gitLabSecretText,
  GitLabProviderError,
  withGitLabOperation,
  type GitLabTransportOptions,
} from "./gitlab-http.js";

const opaqueId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const intentId = z.string().regex(/^gitlablink_[a-f0-9]{32}$/u);
const scope = z
  .object({
    organizationId: opaqueId,
    principalId: opaqueId,
    sessionId: z.string().min(1).max(256),
    intentId,
    state,
  })
  .strict();
const inputSchema = scope
  .extend({
    connectionId: z.string().regex(/^gitlab_[a-f0-9]{32}$/u),
    verifier: z
      .string()
      .min(43)
      .max(128)
      .regex(/^[A-Za-z0-9._~-]+$/u),
    expiresAt: z.iso.datetime(),
  })
  .strict();
const sealedSchema = inputSchema
  .omit({ sessionId: true })
  .extend({
    schemaVersion: z.literal(1),
    sessionSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    issuedAt: z.iso.datetime(),
  })
  .strict();
type SealedState = z.output<typeof sealedSchema>;
type Admission = Omit<GitLabTransportOptions, "fetch">;
const denied = (): never => {
  throw new GitLabProviderError("not-sent", "access-denied");
};
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

/** Short-lived HttpOnly cookie payload only. Durable grants use the independent KMS vault. */
export class GitLabBrowserState {
  readonly #readClientSecret: () => Promise<Uint8Array>;
  readonly #clock: () => Date;
  readonly #audience: string;
  constructor(options: {
    readonly applicationId: string;
    readonly redirectUri: string;
    readonly readClientSecret: () => Promise<Uint8Array>;
    readonly clock?: () => Date;
  }) {
    const redirect = new URL(options.redirectUri);
    if (
      !/^[a-f0-9]{64}$/u.test(options.applicationId) ||
      redirect.protocol !== "https:" ||
      redirect.username ||
      redirect.password ||
      redirect.search ||
      redirect.hash ||
      redirect.href !== options.redirectUri
    )
      throw new TypeError("Invalid GitLab browser state configuration.");
    this.#audience = JSON.stringify([
      "cloudmarkup.gitlab.browser-state",
      1,
      options.applicationId,
      options.redirectUri,
    ]);
    this.#readClientSecret = options.readClientSecret;
    this.#clock = options.clock ?? (() => new Date());
  }
  #validateTime(value: SealedState): void {
    const now = this.#clock().getTime(),
      issued = Date.parse(value.issuedAt),
      expires = Date.parse(value.expiresAt);
    if (
      !Number.isFinite(now) ||
      issued > now + 30000 ||
      expires <= now ||
      expires <= issued ||
      expires - issued > 600000
    )
      denied();
  }
  #withKey<T>(admission: Admission, work: (key: Buffer) => T): Promise<T> {
    return withGitLabOperation(admission, async (operation) => {
      const secret = await this.#readClientSecret();
      let key: Buffer | undefined;
      try {
        if (operation.signal.aborted) return denied();
        gitLabSecretText(secret);
        key = Buffer.from(
          hkdfSync(
            "sha256",
            secret,
            this.#audience,
            "cloudmarkup.gitlab.browser-state.v1",
            32,
          ),
        );
        return work(key);
      } finally {
        key?.fill(0);
        if (secret instanceof Uint8Array) secret.fill(0);
      }
    });
  }
  seal(
    input: z.input<typeof inputSchema>,
    admission: Admission,
  ): Promise<string> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return denied();
    const { sessionId, ...rest } = parsed.data;
    const value: SealedState = {
      ...rest,
      schemaVersion: 1,
      sessionSha256: digest(sessionId),
      issuedAt: this.#clock().toISOString(),
    };
    this.#validateTime(value);
    return this.#withKey(admission, (key) => {
      this.#validateTime(value);
      const clear = Buffer.from(JSON.stringify(value));
      try {
        const iv = randomBytes(12),
          cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(Buffer.from(this.#audience));
        const encrypted = Buffer.concat([cipher.update(clear), cipher.final()]);
        return [
          "v1",
          iv.toString("base64url"),
          encrypted.toString("base64url"),
          cipher.getAuthTag().toString("base64url"),
        ].join(".");
      } finally {
        clear.fill(0);
      }
    });
  }
  open(
    cookie: string,
    expected: z.input<typeof scope>,
    admission: Admission,
  ): Promise<SealedState> {
    const parsed = scope.safeParse(expected);
    if (!parsed.success) return denied();
    const snapshot = parsed.data;
    if (
      typeof cookie !== "string" ||
      cookie.length > 4096 ||
      !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(cookie)
    )
      return denied();
    const parts = cookie.split(".").slice(1);
    const bytes = parts.map((part) => Buffer.from(part, "base64url"));
    const [iv, ciphertext, tag] = bytes;
    if (
      !iv ||
      !ciphertext ||
      !tag ||
      iv.length !== 12 ||
      tag.length !== 16 ||
      ciphertext.length < 1 ||
      ciphertext.length > 3072 ||
      bytes.some((value, index) => value.toString("base64url") !== parts[index])
    )
      return denied();
    return this.#withKey(admission, (key) => {
      let clear: Buffer | undefined;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(Buffer.from(this.#audience));
        decipher.setAuthTag(tag);
        clear = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        const value = sealedSchema.parse(
          JSON.parse(clear.toString("utf8")) as unknown,
        );
        this.#validateTime(value);
        if (
          value.organizationId !== snapshot.organizationId ||
          value.principalId !== snapshot.principalId ||
          value.sessionSha256 !== digest(snapshot.sessionId) ||
          value.intentId !== snapshot.intentId ||
          value.state !== snapshot.state
        )
          return denied();
        return value;
      } catch {
        return denied();
      } finally {
        clear?.fill(0);
      }
    });
  }
}
