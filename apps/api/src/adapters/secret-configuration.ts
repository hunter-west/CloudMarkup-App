import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { SecretConfigurationResolver } from "@cloudmarkup/github-repository-export";

const referencePattern =
  /^arn:aws:secretsmanager:[a-z]{2}-[a-z]+-\d:\d{12}:secret:[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/u;
function unavailable(): never {
  throw new Error("The configured provider secret is unavailable.");
}

/** Only exact, reviewed ARNs can be resolved. No secret values are cached,
 * logged, serialized into configuration, or written to the filesystem. */
export class SecretsManagerConfigurationResolver implements SecretConfigurationResolver {
  readonly #allowed: ReadonlySet<string>;
  readonly #client: Pick<SecretsManagerClient, "send">;
  constructor(input: {
    readonly allowedReferences: readonly string[];
    readonly client?: Pick<SecretsManagerClient, "send">;
  }) {
    if (
      input.allowedReferences.length === 0 ||
      input.allowedReferences.length > 8 ||
      input.allowedReferences.some(
        (reference) => !referencePattern.test(reference),
      ) ||
      new Set(input.allowedReferences).size !== input.allowedReferences.length
    )
      unavailable();
    this.#allowed = new Set(input.allowedReferences);
    this.#client = input.client ?? new SecretsManagerClient({ maxAttempts: 2 });
  }
  async resolveSecret(reference: string): Promise<Uint8Array> {
    if (!this.#allowed.has(reference)) return unavailable();
    try {
      const result = await this.#client.send(
        new GetSecretValueCommand({
          SecretId: reference,
          VersionStage: "AWSCURRENT",
        }),
        { abortSignal: AbortSignal.timeout(5_000) },
      );
      if (
        result.ARN !== reference ||
        typeof result.SecretString !== "string" ||
        result.SecretString.length === 0 ||
        Buffer.byteLength(result.SecretString, "utf8") > 65_536 ||
        result.SecretBinary !== undefined ||
        !result.VersionStages?.includes("AWSCURRENT")
      )
        return unavailable();
      return new TextEncoder().encode(result.SecretString);
    } catch {
      return unavailable();
    }
  }
}
