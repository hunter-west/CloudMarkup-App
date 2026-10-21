import { createHash } from "node:crypto";
import {
  SendMessageCommand,
  SQSClient,
  type SendMessageCommandOutput,
  type SQSClientConfig,
} from "@aws-sdk/client-sqs";
import {
  asyncJobQueueEnvelopeV1Schema,
  asyncJobTrustedOwnershipV1Schema,
  serializeCanonicalJson,
} from "@cloudmarkup/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqsJobPublisherV1 } from "./sqs-job-publisher.js";

const at = "2026-09-07T00:00:00.000Z";
const target = {
  queueArn: "arn:aws:sqs:us-east-1:123456789012:synthetic-export.fifo",
  queueUrl:
    "https://sqs.us-east-1.amazonaws.com/123456789012/synthetic-export.fifo",
  region: "us-east-1",
};
const ownership = asyncJobTrustedOwnershipV1Schema.parse({
  organizationId: "org.export",
  projectId: "project.export",
});
function envelope() {
  return asyncJobQueueEnvelopeV1Schema.parse({
    contractVersion: 1,
    jobId: "job.export",
    family: "solution-export-orchestration",
    ownership,
    correlationId: "correlation.export",
    inputDigest: `sha256:${"a".repeat(64)}`,
    recordVersion: 1,
    attemptNumber: 1,
    availableAt: at,
  });
}
function ack(body: string): SendMessageCommandOutput {
  return {
    $metadata: { httpStatusCode: 200 },
    MessageId: "synthetic-message-id",
    MD5OfMessageBody: createHash("md5").update(body).digest("hex"),
  };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred not initialized.");
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(config: SQSClientConfig = {}) {
  const client = new SQSClient({
    region: target.region,
    maxAttempts: 1,
    ...config,
  });
  const send = vi
    .fn<
      (
        command: SendMessageCommand,
        options?: { readonly abortSignal?: AbortSignal },
      ) => Promise<SendMessageCommandOutput>
    >()
    .mockResolvedValue(ack(serializeCanonicalJson(envelope())));
  // Intercept only the actual Promise-based send overload used by this adapter.
  Object.defineProperty(client, "send", { value: send });
  let now = new Date(at);
  const publisher = new SqsJobPublisherV1({
    client,
    target,
    ownership,
    now: () => now,
  });
  return {
    publisher,
    send,
    client,
    setNow: (value: string) => {
      now = new Date(value);
    },
  };
}
function commandAt(f: ReturnType<typeof fixture>, index = 0) {
  const command = f.send.mock.calls[index]?.[0];
  if (!(command instanceof SendMessageCommand))
    throw new Error("Expected exact SendMessage command.");
  return command.input;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("real SQS version-one publisher-only transport", () => {
  it("sends the complete canonical envelope to only its fixed FIFO queue", async () => {
    const f = fixture();
    await f.publisher.publish(envelope());
    expect(f.send).toHaveBeenCalledTimes(1);
    const command = commandAt(f);
    expect(command).toEqual({
      QueueUrl: target.queueUrl,
      MessageBody: serializeCanonicalJson(envelope()),
      MessageGroupId: command.MessageGroupId,
      MessageDeduplicationId: command.MessageDeduplicationId,
    });
    expect(command.MessageGroupId).toMatch(/^[a-f0-9]{64}$/u);
    expect(command.MessageDeduplicationId).toMatch(/^[a-f0-9]{64}$/u);
    const options = f.send.mock.calls[0]?.[1];
    expect(Object.keys(options ?? {})).toEqual(["abortSignal"]);
    expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
    expect("receive" in f.publisher).toBe(false);
    expect("acknowledge" in f.publisher).toBe(false);
    expect("release" in f.publisher).toBe(false);
  });
  it("reuses the whole-envelope identity after five minutes without claiming physical uniqueness", async () => {
    const f = fixture();
    await f.publisher.publish(envelope());
    f.setNow("2026-09-07T00:05:01.000Z");
    await f.publisher.publish(envelope());
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(commandAt(f, 1)).toEqual(commandAt(f));
  });
  it.each([
    { recordVersion: 2 },
    { attemptNumber: 2 },
    { availableAt: "2026-09-06T23:59:59.000Z" },
    { correlationId: "correlation.changed" },
    { inputDigest: `sha256:${"b".repeat(64)}` },
  ])(
    "binds every changed canonical envelope field in deduplication: %j",
    async (change) => {
      const f = fixture();
      await f.publisher.publish(envelope());
      const changed = asyncJobQueueEnvelopeV1Schema.parse({
        ...envelope(),
        ...change,
      });
      f.send.mockResolvedValueOnce(ack(serializeCanonicalJson(changed)));
      await f.publisher.publish(changed);
      expect(commandAt(f, 1).MessageGroupId).toBe(commandAt(f).MessageGroupId);
      expect(commandAt(f, 1).MessageDeduplicationId).not.toBe(
        commandAt(f).MessageDeduplicationId,
      );
    },
  );
  it.each([
    { queueArn: target.queueArn.replace(".fifo", "") },
    { queueUrl: `${target.queueUrl}?override=true` },
    { queueUrl: target.queueUrl.replace("123456789012", "123456789013") },
    { queueUrl: target.queueUrl.replace("synthetic-export", "another-export") },
    { queueUrl: target.queueUrl.replace("https:", "http:") },
    { queueUrl: target.queueUrl.replace("us-east-1", "us-west-2") },
    { region: "us-west-2" },
  ])("refuses a drifted fixed target: %j", (change) => {
    expect(
      () =>
        new SqsJobPublisherV1({ target: { ...target, ...change }, ownership }),
    ).toThrow(expect.objectContaining({ code: "job.publication-invalid" }));
  });
  it.each([
    { ownership: { ...ownership, organizationId: "org.other" } },
    { ownership: { ...ownership, projectId: "project.other" } },
    { family: "intent-extraction" },
    { contractVersion: 2 },
    { extra: "not-allowed" },
  ])(
    "rejects envelope scope/schema drift before any send: %j",
    async (change) => {
      const f = fixture();
      // The runtime boundary validates even callers compiled against a stale contract.
      await expect(
        f.publisher.publish({ ...envelope(), ...change }),
      ).rejects.toMatchObject({ code: "job.publication-invalid" });
      expect(f.send).not.toHaveBeenCalled();
    },
  );
  it("requires a concrete project scope", () => {
    expect(
      () =>
        new SqsJobPublisherV1({
          target,
          ownership: { organizationId: ownership.organizationId },
        }),
    ).toThrow(expect.objectContaining({ code: "job.publication-invalid" }));
  });
  it("rejects future work without inventing FIFO delay and accepts the exact due boundary", async () => {
    const f = fixture();
    f.setNow("2026-09-06T23:59:59.999Z");
    await expect(f.publisher.publish(envelope())).rejects.toMatchObject({
      code: "job.publication-not-due",
    });
    expect(f.send).not.toHaveBeenCalled();
    f.setNow(at);
    await f.publisher.publish(envelope());
    expect(commandAt(f).DelaySeconds).toBeUndefined();
  });
  it("rejects an invalid trusted clock", async () => {
    const f = fixture();
    f.setNow("invalid");
    await expect(f.publisher.publish(envelope())).rejects.toMatchObject({
      code: "job.publication-invalid",
    });
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each([
    { region: "us-west-2" },
    { maxAttempts: 2 },
    { endpoint: "https://example.invalid" },
  ])("rejects incompatible shared SDK configuration: %j", async (config) => {
    const f = fixture(config);
    await expect(f.publisher.publish(envelope())).rejects.toMatchObject({
      code: "job.publication-invalid",
    });
    expect(f.send).not.toHaveBeenCalled();
  });
  it("copies the envelope and target before asynchronous SDK configuration", async () => {
    const pending = deferred<number>();
    const f = fixture({ maxAttempts: () => pending.promise });
    const input = envelope();
    const original = serializeCanonicalJson(input);
    const result = f.publisher.publish(input);
    input.recordVersion = 9;
    input.ownership = asyncJobTrustedOwnershipV1Schema.parse({
      ...ownership,
      projectId: "project.changed",
    });
    pending.resolve(1);
    await result;
    expect(commandAt(f).MessageBody).toBe(original);
  });
  it.each([
    {
      $metadata: {},
      MessageId: "synthetic-message-id",
      MD5OfMessageBody: "wrong",
    },
    {
      $metadata: {},
      MD5OfMessageBody: createHash("md5")
        .update(serializeCanonicalJson(envelope()))
        .digest("hex"),
    },
  ])(
    "treats incomplete or inconsistent service acknowledgements as uncertain",
    async (result) => {
      const f = fixture();
      f.send.mockResolvedValueOnce(result);
      await expect(f.publisher.publish(envelope())).rejects.toMatchObject({
        code: "job.publication-uncertain",
      });
      expect(f.send).toHaveBeenCalledTimes(1);
    },
  );
  it("does not retry or expose raw SDK failure details", async () => {
    const f = fixture();
    f.send.mockRejectedValueOnce(
      new Error("synthetic-sensitive-upstream-detail"),
    );
    const failure = await f.publisher
      .publish(envelope())
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "job.publication-uncertain" });
    expect(String(failure)).not.toContain(
      "synthetic-sensitive-upstream-detail",
    );
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("aborts one stalled send at ten seconds and never turns late acceptance into success", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
    });
    const f = fixture();
    const pending = deferred<SendMessageCommandOutput>();
    f.send.mockReturnValueOnce(pending.promise);
    const result = f.publisher.publish(envelope());
    const rejected = expect(result).rejects.toMatchObject({
      code: "job.publication-uncertain",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    const options = f.send.mock.calls[0]?.[1];
    if (options === undefined) throw new Error("Expected SDK options.");
    expect(options.abortSignal?.aborted).toBe(true);
    pending.resolve(ack(serializeCanonicalJson(envelope())));
    await Promise.resolve();
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds configuration resolution too and never sends after its deadline", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
    });
    const pending = deferred<number>();
    const f = fixture({ maxAttempts: () => pending.promise });
    const result = f.publisher.publish(envelope());
    const rejected = expect(result).rejects.toMatchObject({
      code: "job.publication-uncertain",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    pending.resolve(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(f.send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
