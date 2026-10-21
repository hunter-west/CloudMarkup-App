import { randomBytes } from "node:crypto";
import {
  DecryptCommand,
  GenerateDataKeyCommand,
  type DecryptCommandOutput,
  type GenerateDataKeyCommandOutput,
  type KMSClient,
} from "@aws-sdk/client-kms";
import { describe, expect, it, vi } from "vitest";
import {
  GitLabGrantVault,
  gitLabSealedGrantV1Schema,
  type GitLabGrantBindingV1,
  type GitLabSealedGrantV1,
} from "./gitlab-grant-vault.js";
import { GitLabTokenMaterial } from "./gitlab-token-material.js";

const key =
  "arn:aws:kms:us-east-1:111122223333:key/11111111-1111-4111-8111-111111111111";
const nextKey =
  "arn:aws:kms:us-east-1:111122223333:key/22222222-2222-4222-8222-222222222222";
const binding: GitLabGrantBindingV1 = {
  schemaVersion: 1,
  applicationId: "a".repeat(64),
  organizationId: "workspace-a",
  connectionId: "connection-a",
  principalId: "actor-a",
  providerUserId: 17,
  grantVersion: 1,
};
const admission = { assertCurrentAdmission: () => Promise.resolve() };
function tokens(size?: number) {
  return {
    accessToken: Buffer.from(
      size ? "a".repeat(size) : "synthetic-access-token-for-vault-tests",
    ),
    refreshToken: Buffer.from(
      size ? "r".repeat(size) : "synthetic-refresh-token-for-vault-tests",
    ),
  };
}
type Command = GenerateDataKeyCommand | DecryptCommand;
type KeyResponse = GenerateDataKeyCommandOutput | DecryptCommandOutput;
function fixture() {
  const records = new Map<
    string,
    { key: Buffer; arn: string; context: string }
  >();
  const issued: Uint8Array[] = [];
  const send = vi.fn<
    (
      command: Command,
      options?: { abortSignal?: AbortSignal },
    ) => Promise<KeyResponse>
  >((command) => {
    if (command instanceof GenerateDataKeyCommand) {
      const wrapped = randomBytes(32);
      const plain = randomBytes(32);
      issued.push(plain);
      records.set(wrapped.toString("base64"), {
        key: Buffer.from(plain),
        arn: command.input.KeyId ?? "",
        context: JSON.stringify(command.input.EncryptionContext),
      });
      return Promise.resolve({
        $metadata: {},
        KeyId: command.input.KeyId,
        Plaintext: plain,
        CiphertextBlob: wrapped,
      });
    }
    const record = records.get(
      Buffer.from(command.input.CiphertextBlob ?? []).toString("base64"),
    );
    if (
      !record ||
      record.arn !== command.input.KeyId ||
      record.context !== JSON.stringify(command.input.EncryptionContext)
    ) {
      return Promise.reject(Error("synthetic-provider-secret-must-not-escape"));
    }
    const plain = Buffer.from(record.key);
    issued.push(plain);
    return Promise.resolve({
      $metadata: {},
      KeyId: record.arn,
      Plaintext: plain,
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
    });
  });
  const client = { send: send as KMSClient["send"] };
  return {
    send,
    client,
    issued,
    vault: new GitLabGrantVault({ activeKeyArn: key, client }),
  };
}
function flip(value: string) {
  const bytes = Buffer.from(value, "base64");
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return bytes.toString("base64");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("GitLab encrypted grants", () => {
  it("observes a rejected authorization promise that synchronously aborts the operation", async () => {
    const { vault, send } = fixture();
    const controller = new AbortController();
    await expect(
      vault.seal(binding, tokens(), {
        signal: controller.signal,
        assertCurrentAdmission: () => {
          controller.abort();
          return Promise.reject(Error("private-denial"));
        },
      }),
    ).rejects.toMatchObject({ problem: "unavailable" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(send).not.toHaveBeenCalled();
  });
  it.each([undefined, 20, 4096])(
    "round-trips bounded credentials (%s bytes) with exact context and clears keys",
    async (size) => {
      const { vault, send, issued } = fixture();
      const source = tokens(size);
      const sealed = await vault.seal(binding, source, admission);
      expect(gitLabSealedGrantV1Schema.safeParse(sealed).success).toBe(true);
      expect(JSON.stringify(sealed)).not.toContain(
        source.accessToken.toString(),
      );
      expect(JSON.stringify(sealed)).not.toContain(
        source.refreshToken.toString(),
      );
      expect(issued.every((bytes) => bytes.every((byte) => byte === 0))).toBe(
        true,
      );
      expect(send.mock.calls[0]?.[0].input).toEqual({
        KeyId: key,
        KeySpec: "AES_256",
        EncryptionContext: {
          cloudmarkupPurpose: "gitlab-oauth-grant-v1",
          bindingSha256: sealed.bindingSha256,
        },
      });
      expect(JSON.stringify(send.mock.calls[0]?.[0].input)).not.toContain(
        binding.organizationId,
      );
      const opened = await vault.open(binding, sealed, admission);
      expect(JSON.stringify(opened)).toBe("{}");
      let consumed: Uint8Array | undefined;
      await opened.consume((value) => {
        expect(Buffer.from(value.accessToken)).toEqual(source.accessToken);
        expect(Buffer.from(value.refreshToken)).toEqual(source.refreshToken);
        consumed = value.accessToken;
        return Promise.resolve();
      });
      expect(consumed?.every((byte) => byte === 0)).toBe(true);
      expect(issued.every((bytes) => bytes.every((byte) => byte === 0))).toBe(
        true,
      );
      await expect(
        opened.consume(() => Promise.resolve()),
      ).rejects.toMatchObject({ problem: "invalid-input" });
    },
  );
  it("uses a fresh nonce and data key for each envelope", async () => {
    const { vault } = fixture();
    const first = await vault.seal(binding, tokens(), admission);
    const second = await vault.seal(binding, tokens(), admission);
    expect(first.iv).not.toBe(second.iv);
    expect(first.encryptedDataKey).not.toBe(second.encryptedDataKey);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });
  it.each([
    { applicationId: "b".repeat(64) },
    { organizationId: "workspace-b" },
    { connectionId: "connection-b" },
    { principalId: "actor-b" },
    { providerUserId: 18 },
    { grantVersion: 2 },
  ])("rejects substituted grant ownership before KMS: %j", async (change) => {
    const { vault, send } = fixture();
    const sealed = await vault.seal(binding, tokens(), admission);
    send.mockClear();
    await expect(
      vault.open({ ...binding, ...change }, sealed, admission),
    ).rejects.toMatchObject({ outcome: "not-sent", problem: "invalid-input" });
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    "ciphertext",
    "iv",
    "authenticationTag",
    "encryptedDataKey",
  ] as const)(
    "rejects tampered %s without exposing provider details",
    async (field) => {
      const { vault, issued } = fixture();
      const sealed = await vault.seal(binding, tokens(), admission);
      await expect(
        vault.open(
          binding,
          { ...sealed, [field]: flip(sealed[field]) },
          admission,
        ),
      ).rejects.toMatchObject({
        name: "GitLabProviderError",
        message: "The GitLab operation could not be confirmed.",
      });
      expect(issued.every((bytes) => bytes.every((byte) => byte === 0))).toBe(
        true,
      );
    },
  );
  it("authenticates envelope metadata even if the bound digest is changed together", async () => {
    const { vault } = fixture();
    const original = await vault.seal(binding, tokens(), admission);
    const another = await vault.seal(
      { ...binding, organizationId: "workspace-b" },
      tokens(),
      admission,
    );
    await expect(
      vault.open(
        { ...binding, organizationId: "workspace-b" },
        { ...original, bindingSha256: another.bindingSha256 },
        admission,
      ),
    ).rejects.toMatchObject({ problem: "unavailable" });
  });
  it("reads an explicitly retained key after rotation and rejects a removed key", async () => {
    const { vault, client, send } = fixture();
    const sealed = await vault.seal(binding, tokens(), admission);
    const rotated = new GitLabGrantVault({
      activeKeyArn: nextKey,
      previousKeyArns: [key],
      client,
    });
    const material = await rotated.open(binding, sealed, admission);
    await material.consume((value) => {
      expect(Buffer.from(value.accessToken)).toEqual(tokens().accessToken);
      return Promise.resolve();
    });
    expect((await rotated.seal(binding, tokens(), admission)).keyArn).toBe(
      nextKey,
    );
    send.mockClear();
    const retired = new GitLabGrantVault({ activeKeyArn: nextKey, client });
    await expect(
      retired.open(binding, sealed, admission),
    ).rejects.toMatchObject({ problem: "invalid-input" });
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    { activeKeyArn: "alias/gitlab" },
    { activeKeyArn: key, previousKeyArns: [key] },
    {
      activeKeyArn: key,
      previousKeyArns: [nextKey.replace("us-east-1", "us-west-2")],
    },
    {
      activeKeyArn: key,
      previousKeyArns: [nextKey.replace("111122223333", "444455556666")],
    },
    {
      activeKeyArn: key,
      previousKeyArns: [
        nextKey,
        "arn:aws:kms:us-east-1:111122223333:key/33333333-3333-4333-8333-333333333333",
        "arn:aws:kms:us-east-1:111122223333:key/44444444-4444-4444-8444-444444444444",
        "arn:aws:kms:us-east-1:111122223333:key/55555555-5555-4555-8555-555555555555",
      ],
    },
  ])(
    "rejects ambiguous or cross-boundary key configuration: %j",
    (configuration) => {
      expect(() => new GitLabGrantVault(configuration)).toThrow(
        "The GitLab operation could not be confirmed.",
      );
    },
  );
  it.each([0, 19, 4097].filter((_, index) => index !== 0))(
    "rejects invalid token lengths before KMS: %s",
    async (length) => {
      const { vault, send } = fixture();
      await expect(
        vault.seal(
          binding,
          {
            accessToken: Buffer.alloc(length, 97),
            refreshToken: tokens().refreshToken,
          },
          admission,
        ),
      ).rejects.toMatchObject({ problem: "invalid-input" });
      expect(send).not.toHaveBeenCalled();
    },
  );
  it.each([
    { schemaVersion: 2 },
    { algorithm: "aes-128-gcm" },
    { iv: "invalid" },
    { authenticationTag: "" },
    { ciphertext: "" },
    { encryptedDataKey: "" },
    { extra: "unknown" },
  ])("rejects malformed envelopes before KMS: %j", async (change) => {
    const { vault, send } = fixture();
    const sealed = await vault.seal(binding, tokens(), admission);
    send.mockClear();
    await expect(
      vault.open(
        binding,
        { ...sealed, ...change } as GitLabSealedGrantV1,
        admission,
      ),
    ).rejects.toMatchObject({ problem: "invalid-input" });
    expect(send).not.toHaveBeenCalled();
  });
  it.each([1, 2, 3])(
    "rechecks authorization at stage %s and erases returned keys",
    async (deniedAt) => {
      const { vault, send, issued } = fixture();
      let calls = 0;
      const denied = {
        assertCurrentAdmission: () =>
          ++calls === deniedAt
            ? Promise.reject(Error("private-authority-detail"))
            : Promise.resolve(),
      };
      await expect(vault.seal(binding, tokens(), denied)).rejects.toMatchObject(
        {
          problem: "unavailable",
          message: "The GitLab operation could not be confirmed.",
        },
      );
      expect(send).toHaveBeenCalledTimes(deniedAt === 1 ? 0 : 1);
      expect(issued.every((bytes) => bytes.every((byte) => byte === 0))).toBe(
        true,
      );
    },
  );
  it.each([2, 3])(
    "clears decrypted material if current admission fails at stage %s",
    async (deniedAt) => {
      const { vault, issued } = fixture();
      const sealed = await vault.seal(binding, tokens(), admission);
      let calls = 0;
      const dispose = vi.spyOn(GitLabTokenMaterial.prototype, "dispose");
      try {
        await expect(
          vault.open(binding, sealed, {
            assertCurrentAdmission: () =>
              ++calls === deniedAt
                ? Promise.reject(Error("private-revocation-detail"))
                : Promise.resolve(),
          }),
        ).rejects.toMatchObject({ problem: "unavailable" });
        expect(issued.every((bytes) => bytes.every((byte) => byte === 0))).toBe(
          true,
        );
        expect(dispose).toHaveBeenCalledTimes(deniedAt === 3 ? 1 : 0);
      } finally {
        dispose.mockRestore();
      }
    },
  );
  it("bounds a stalled admission within the same five-second operation deadline", async () => {
    const { vault, send } = fixture();
    const deadline = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(deadline.signal);
    const gate = deferred<undefined>();
    try {
      const task = vault.seal(binding, tokens(), {
        assertCurrentAdmission: () => gate.promise,
      });
      const rejected = expect(task).rejects.toMatchObject({
        problem: "unavailable",
      });
      expect(timeout).toHaveBeenCalledWith(5000);
      deadline.abort();
      await rejected;
      gate.resolve(undefined);
      await Promise.resolve();
      expect(send).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
    }
  });
  it("snapshots caller-owned grant fields and tokens before asynchronous admission", async () => {
    const { vault } = fixture();
    const gate = deferred<undefined>();
    const original = tokens();
    const input = { ...binding };
    const task = vault.seal(input, original, {
      assertCurrentAdmission: () => gate.promise,
    });
    input.organizationId = "workspace-changed";
    original.accessToken.fill(120);
    gate.resolve(undefined);
    const material = await vault.open(binding, await task, admission);
    await material.consume((value) => {
      expect(Buffer.from(value.accessToken)).toEqual(tokens().accessToken);
      return Promise.resolve();
    });
  });
  it("denies already-aborted operations without calling KMS", async () => {
    const { vault, send } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      vault.seal(binding, tokens(), {
        ...admission,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ problem: "unavailable" });
    expect(send).not.toHaveBeenCalled();
  });
  it("erases a key that arrives after cancellation without returning an envelope", async () => {
    const { vault, send } = fixture();
    const pending = deferred<KeyResponse>();
    send.mockImplementationOnce(() => pending.promise);
    const controller = new AbortController();
    const task = vault.seal(binding, tokens(), {
      ...admission,
      signal: controller.signal,
    });
    const rejected = expect(task).rejects.toMatchObject({
      problem: "unavailable",
    });
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    controller.abort();
    await rejected;
    const lateKey = randomBytes(32);
    pending.resolve({
      $metadata: {},
      KeyId: key,
      Plaintext: lateKey,
      CiphertextBlob: randomBytes(32),
    });
    await vi.waitFor(() => {
      expect(lateKey.every((byte) => byte === 0)).toBe(true);
    });
  });
  it.each([
    { Plaintext: Buffer.alloc(31) },
    { KeyId: nextKey },
    { CiphertextForRecipient: Buffer.from("unsupported-recipient") },
    { CiphertextBlob: Buffer.alloc(0) },
    { CiphertextBlob: Buffer.alloc(6145) },
  ])("rejects malformed KMS data-key responses: %j", async (change) => {
    const { vault, send } = fixture();
    const bytes = randomBytes(32);
    const response = {
      $metadata: {},
      KeyId: key,
      Plaintext: bytes,
      CiphertextBlob: randomBytes(32),
      ...change,
    };
    send.mockResolvedValueOnce(response);
    await expect(
      vault.seal(binding, tokens(), admission),
    ).rejects.toMatchObject({ problem: "unavailable" });
    expect(response.Plaintext.every((byte) => byte === 0)).toBe(true);
  });
});

describe("one-use GitLab token material", () => {
  it("clears both buffers when a consumer throws and refuses reuse", async () => {
    const source = tokens();
    const material = new GitLabTokenMaterial(
      source.accessToken,
      source.refreshToken,
    );
    await expect(
      material.consume(() => {
        throw Error("synthetic-consumer-failure");
      }),
    ).rejects.toThrow("synthetic-consumer-failure");
    expect(source.accessToken.every((byte) => byte === 0)).toBe(true);
    expect(source.refreshToken.every((byte) => byte === 0)).toBe(true);
    await expect(
      material.consume(() => Promise.resolve()),
    ).rejects.toMatchObject({ problem: "invalid-input" });
  });
  it("rejects concurrent consumption and supports explicit abandonment", async () => {
    const source = tokens();
    const material = new GitLabTokenMaterial(
      source.accessToken,
      source.refreshToken,
    );
    const gate = deferred<undefined>();
    const running = material.consume(() => gate.promise);
    await expect(
      material.consume(() => Promise.resolve()),
    ).rejects.toMatchObject({ problem: "invalid-input" });
    gate.resolve(undefined);
    await running;
    const unused = tokens();
    const abandoned = new GitLabTokenMaterial(
      unused.accessToken,
      unused.refreshToken,
    );
    abandoned.dispose();
    expect(unused.accessToken.every((byte) => byte === 0)).toBe(true);
    expect(unused.refreshToken.every((byte) => byte === 0)).toBe(true);
    await expect(
      abandoned.consume(() => Promise.resolve()),
    ).rejects.toMatchObject({ problem: "invalid-input" });
  });
});
