import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { describe, expect, it, vi } from "vitest";
import { SecretsManagerConfigurationResolver } from "./secret-configuration.js";

const arn =
  "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/provider-fixture-Abc123";
function fixture(override: Record<string, unknown> = {}) {
  const send = vi.fn().mockImplementation(() =>
    Promise.resolve({
      ARN: arn,
      SecretString: "fixture-only",
      VersionStages: ["AWSCURRENT"],
      ...override,
    }),
  );
  const resolver = new SecretsManagerConfigurationResolver({
    allowedReferences: [arn],
    client: { send },
  });
  return { resolver, send };
}
describe("exact-reference provider secrets", () => {
  it("returns fresh mutable bytes and never caches values", async () => {
    const { resolver, send } = fixture();
    const first = await resolver.resolveSecret(arn);
    first.fill(0);
    expect(new TextDecoder().decode(await resolver.resolveSecret(arn))).toBe(
      "fixture-only",
    );
    expect(send).toHaveBeenCalledTimes(2);
    const command: unknown = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(GetSecretValueCommand);
    if (!(command instanceof GetSecretValueCommand))
      throw new Error("Expected secret command");
    expect(command.input).toEqual({
      SecretId: arn,
      VersionStage: "AWSCURRENT",
    });
  });
  it("denies unlisted references without a network request", async () => {
    const { resolver, send } = fixture();
    await expect(
      resolver.resolveSecret(arn.replace("000000000000", "111111111111")),
    ).rejects.toThrow("configured provider secret is unavailable");
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    { ARN: arn + "wrong" },
    { SecretString: "" },
    { SecretString: "x".repeat(65_537) },
    { VersionStages: ["AWSPREVIOUS"] },
    { SecretBinary: new Uint8Array([1]) },
  ])(
    "rejects mismatched, empty, oversized or stale responses",
    async (override) => {
      await expect(
        fixture(override).resolver.resolveSecret(arn),
      ).rejects.toThrow("configured provider secret is unavailable");
    },
  );
  it("redacts provider failures", async () => {
    const { resolver, send } = fixture();
    send.mockRejectedValue(new Error("secret-provider-sensitive-internals"));
    await expect(resolver.resolveSecret(arn)).rejects.toThrow(
      /^The configured provider secret is unavailable\.$/,
    );
  });
});
