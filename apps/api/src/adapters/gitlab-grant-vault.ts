import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  DecryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
} from "@aws-sdk/client-kms";
import { z } from "zod";
import {
  GitLabProviderError,
  gitLabSecretText,
  type GitLabTransportOptions,
} from "./gitlab-http.js";
import { GitLabTokenMaterial } from "./gitlab-token-material.js";

const opaqueId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const keyArn = z
  .string()
  .regex(
    /^arn:aws:kms:([a-z]{2}-[a-z]+-\d):([0-9]{12}):key\/(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|mrk-[a-f0-9]{32})$/u,
  );
export const gitLabGrantBindingV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    applicationId: z.string().regex(/^[a-f0-9]{64}$/u),
    organizationId: opaqueId,
    connectionId: opaqueId,
    principalId: opaqueId,
    providerUserId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    grantVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type GitLabGrantBindingV1 = z.output<typeof gitLabGrantBindingV1Schema>;

function base64(minBytes: number, maxBytes: number) {
  return z
    .string()
    .min(Math.ceil(minBytes / 3) * 4)
    .max(Math.ceil(maxBytes / 3) * 4)
    .refine((value) => {
      const bytes = Buffer.from(value, "base64");
      return (
        bytes.byteLength >= minBytes &&
        bytes.byteLength <= maxBytes &&
        bytes.toString("base64") === value
      );
    });
}
export const gitLabSealedGrantV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    algorithm: z.literal("aes-256-gcm"),
    keyArn,
    bindingSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    encryptedDataKey: base64(1, 6144),
    iv: base64(12, 12),
    authenticationTag: base64(16, 16),
    ciphertext: base64(45, 8197),
  })
  .strict();
export type GitLabSealedGrantV1 = z.output<typeof gitLabSealedGrantV1Schema>;
type Admission = Pick<
  GitLabTransportOptions,
  "assertCurrentAdmission" | "signal"
>;

export interface GitLabGrantVaultConfiguration {
  readonly activeKeyArn: string;
  /** At most three former exact keys in the same account/Region; never aliases. */
  readonly previousKeyArns?: readonly string[];
  readonly client?: Pick<KMSClient, "send">;
}

function invalid(): never {
  throw new GitLabProviderError("not-sent", "invalid-input");
}
function unavailable(): never {
  throw new GitLabProviderError("uncertain", "unavailable");
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const value = schema.safeParse(input);
  if (!value.success) invalid();
  return value.data;
}
export function gitLabGrantBindingDigestV1(
  input: GitLabGrantBindingV1,
): string {
  return bindingDigest(gitLabGrantBindingV1Schema.parse(input));
}
function bindingDigest(binding: GitLabGrantBindingV1): string {
  // This fixed-order v1 tuple is also authenticated as AES-GCM additional data.
  return createHash("sha256")
    .update(
      JSON.stringify([
        "cloudmarkup.gitlab.oauth-grant",
        1,
        binding.applicationId,
        binding.organizationId,
        binding.connectionId,
        binding.principalId,
        binding.providerUserId,
        binding.grantVersion,
      ]),
    )
    .digest("hex");
}
function context(digest: string) {
  // Context is visible in CloudTrail: no tokens, names, source or raw tenant IDs.
  return { cloudmarkupPurpose: "gitlab-oauth-grant-v1", bindingSha256: digest };
}
function additionalData(
  digest: string,
  arn: string,
  wrappedKey: string,
): Buffer {
  return Buffer.from(
    JSON.stringify([
      "cloudmarkup.gitlab.oauth-grant",
      1,
      "aes-256-gcm",
      arn,
      digest,
      wrappedKey,
    ]),
  );
}
function payload(tokens: {
  readonly accessToken: Uint8Array;
  readonly refreshToken: Uint8Array;
}): Buffer {
  gitLabSecretText(tokens.accessToken);
  gitLabSecretText(tokens.refreshToken);
  const result = Buffer.alloc(
    5 + tokens.accessToken.byteLength + tokens.refreshToken.byteLength,
  );
  result[0] = 1;
  result.writeUInt16BE(tokens.accessToken.byteLength, 1);
  result.writeUInt16BE(tokens.refreshToken.byteLength, 3);
  result.set(tokens.accessToken, 5);
  result.set(tokens.refreshToken, 5 + tokens.accessToken.byteLength);
  return result;
}
function material(plaintext: Buffer): GitLabTokenMaterial {
  if (
    plaintext.byteLength < 45 ||
    plaintext.byteLength > 8197 ||
    plaintext[0] !== 1
  )
    unavailable();
  const accessLength = plaintext.readUInt16BE(1);
  const refreshLength = plaintext.readUInt16BE(3);
  if (
    accessLength < 20 ||
    accessLength > 4096 ||
    refreshLength < 20 ||
    refreshLength > 4096 ||
    accessLength + refreshLength + 5 !== plaintext.byteLength
  )
    unavailable();
  const access = plaintext.subarray(5, 5 + accessLength);
  const refresh = plaintext.subarray(5 + accessLength);
  gitLabSecretText(access);
  gitLabSecretText(refresh);
  return new GitLabTokenMaterial(
    new Uint8Array(access),
    new Uint8Array(refresh),
  );
}

function bounded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      reject(new GitLabProviderError("uncertain", "unavailable"));
    };
    signal.addEventListener("abort", abort, { once: true });
    // Always observe the pending rejection, even if admission aborted synchronously.
    pending
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", abort);
      })
      .catch(() => undefined);
    if (signal.aborted) abort();
  });
}

/** KMS envelope encryption only; caller owns current tenant admission and durable grant/refresh claims. */
export class GitLabGrantVault {
  readonly #activeKey: string;
  readonly #allowedKeys: ReadonlySet<string>;
  readonly #client: Pick<KMSClient, "send">;
  constructor(configuration: GitLabGrantVaultConfiguration) {
    this.#activeKey = parse(keyArn, configuration.activeKeyArn);
    const previous = parse(
      z.array(keyArn).max(3),
      configuration.previousKeyArns ?? [],
    );
    const keys = [this.#activeKey, ...previous];
    const prefix = this.#activeKey.split(":").slice(0, 5).join(":");
    if (
      new Set(keys).size !== keys.length ||
      keys.some((key) => key.split(":").slice(0, 5).join(":") !== prefix)
    )
      invalid();
    this.#allowedKeys = new Set(keys);
    const region = this.#activeKey.split(":")[3];
    if (!region) invalid();
    this.#client =
      configuration.client ??
      new KMSClient({
        region,
        endpoint: `https://kms.${region}.amazonaws.com`,
        maxAttempts: 1,
        ignoreConfiguredEndpointUrls: true,
      });
  }
  async seal(
    bindingInput: GitLabGrantBindingV1,
    tokens: {
      readonly accessToken: Uint8Array;
      readonly refreshToken: Uint8Array;
    },
    admission: Admission,
  ): Promise<GitLabSealedGrantV1> {
    const binding = parse(gitLabGrantBindingV1Schema, bindingInput);
    const digest = bindingDigest(binding);
    // Snapshot before the first await; caller mutation cannot retarget ciphertext.
    const plaintext = payload(tokens);
    try {
      return await this.#withKey(
        new GenerateDataKeyCommand({
          KeyId: this.#activeKey,
          KeySpec: "AES_256",
          EncryptionContext: context(digest),
        }),
        admission,
        (key, wrapped) => {
          if (!wrapped) unavailable();
          const encryptedDataKey = Buffer.from(wrapped).toString("base64");
          const iv = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", key, iv);
          cipher.setAAD(
            additionalData(digest, this.#activeKey, encryptedDataKey),
          );
          const ciphertext = Buffer.concat([
            cipher.update(plaintext),
            cipher.final(),
          ]);
          return parse(gitLabSealedGrantV1Schema, {
            schemaVersion: 1,
            algorithm: "aes-256-gcm",
            keyArn: this.#activeKey,
            bindingSha256: digest,
            encryptedDataKey,
            iv: iv.toString("base64"),
            authenticationTag: cipher.getAuthTag().toString("base64"),
            ciphertext: ciphertext.toString("base64"),
          });
        },
      );
    } finally {
      plaintext.fill(0);
    }
  }
  async open(
    bindingInput: GitLabGrantBindingV1,
    envelopeInput: GitLabSealedGrantV1,
    admission: Admission,
  ): Promise<GitLabTokenMaterial> {
    const binding = parse(gitLabGrantBindingV1Schema, bindingInput);
    const envelope = parse(gitLabSealedGrantV1Schema, envelopeInput);
    const digest = bindingDigest(binding);
    if (
      envelope.bindingSha256 !== digest ||
      !this.#allowedKeys.has(envelope.keyArn)
    )
      invalid();
    let result: GitLabTokenMaterial | undefined;
    try {
      return await this.#withKey(
        new DecryptCommand({
          KeyId: envelope.keyArn,
          CiphertextBlob: Buffer.from(envelope.encryptedDataKey, "base64"),
          EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
          EncryptionContext: context(digest),
        }),
        admission,
        (key) => {
          const decipher = createDecipheriv(
            "aes-256-gcm",
            key,
            Buffer.from(envelope.iv, "base64"),
          );
          decipher.setAAD(
            additionalData(digest, envelope.keyArn, envelope.encryptedDataKey),
          );
          decipher.setAuthTag(
            Buffer.from(envelope.authenticationTag, "base64"),
          );
          let partial: Buffer | undefined;
          let tail: Buffer | undefined;
          let plaintext: Buffer | undefined;
          try {
            partial = decipher.update(
              Buffer.from(envelope.ciphertext, "base64"),
            );
            tail = decipher.final();
            plaintext = Buffer.concat([partial, tail]);
            result = material(plaintext);
            return result;
          } finally {
            partial?.fill(0);
            tail?.fill(0);
            plaintext?.fill(0);
          }
        },
      );
    } catch (error) {
      result?.dispose();
      throw error;
    }
  }
  async #withKey<T>(
    command: GenerateDataKeyCommand | DecryptCommand,
    admission: Admission,
    use: (key: Uint8Array, wrapped?: Uint8Array) => T,
  ): Promise<T> {
    const lifetime = new AbortController();
    const signal = AbortSignal.any([
      lifetime.signal,
      AbortSignal.timeout(5000),
      ...(admission.signal ? [admission.signal] : []),
    ]);
    const assertCurrentAdmission = admission.assertCurrentAdmission;
    const current = async () => {
      signal.throwIfAborted();
      await bounded(assertCurrentAdmission(), signal);
      signal.throwIfAborted();
    };
    let plaintextKey: Uint8Array | undefined;
    try {
      await current();
      const pending =
        command instanceof GenerateDataKeyCommand
          ? this.#client.send(command, { abortSignal: signal })
          : this.#client.send(command, { abortSignal: signal });
      void pending
        .then((late) => {
          if (signal.aborted) late.Plaintext?.fill(0);
        })
        .catch(() => undefined);
      const response = await bounded(pending, signal);
      if (response.Plaintext instanceof Uint8Array)
        plaintextKey = response.Plaintext;
      if (
        !(plaintextKey instanceof Uint8Array) ||
        plaintextKey.byteLength !== 32 ||
        response.KeyId !== command.input.KeyId ||
        response.CiphertextForRecipient !== undefined
      )
        unavailable();
      let wrapped: Uint8Array | undefined;
      if (command instanceof GenerateDataKeyCommand) {
        const candidate =
          "CiphertextBlob" in response ? response.CiphertextBlob : undefined;
        if (
          !(candidate instanceof Uint8Array) ||
          candidate.byteLength === 0 ||
          candidate.byteLength > 6144
        )
          unavailable();
        wrapped = candidate;
      } else if (
        !("EncryptionAlgorithm" in response) ||
        response.EncryptionAlgorithm !== "SYMMETRIC_DEFAULT"
      )
        unavailable();
      await current();
      const value = use(plaintextKey, wrapped);
      await current();
      return value;
    } catch {
      return unavailable();
    } finally {
      lifetime.abort();
      plaintextKey?.fill(0);
    }
  }
}
