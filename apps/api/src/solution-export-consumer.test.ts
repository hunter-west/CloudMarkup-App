import { describe, expect, it, vi } from "vitest";
import { createSolutionExportQueueHandler } from "./solution-export-consumer.js";

const queueArn =
  "arn:aws:sqs:us-east-1:123456789012:cloudmarkup-beta-jobs.fifo";
const record = (id: string, body = "{}") => ({
  messageId: id,
  body,
  eventSource: "aws:sqs",
  eventSourceARN: queueArn,
});
function setup() {
  const processEnvelope = vi.fn(() =>
    Promise.resolve({
      state: "completed" as const,
      jobId: "job.test",
    }),
  );
  return {
    processEnvelope,
    handler: createSolutionExportQueueHandler({
      expectedQueueArn: queueArn,
      worker: { processEnvelope },
    }),
  };
}
describe("delivered FIFO export transport", () => {
  it("admits only the dedicated beta export FIFO when configured", async () => {
    const f = setup();
    const dedicated = queueArn.replace("-jobs.fifo", "-solution-exports.fifo");
    const handler = createSolutionExportQueueHandler({
      expectedQueueArn: dedicated,
      worker: { processEnvelope: f.processEnvelope },
    });
    await expect(
      handler({ Records: [{ ...record("one"), eventSourceARN: dedicated }] }),
    ).resolves.toEqual({ batchItemFailures: [] });
    expect(() =>
      createSolutionExportQueueHandler({
        expectedQueueArn: dedicated.replace("-beta-", "-prod-"),
        worker: { processEnvelope: f.processEnvelope },
      }),
    ).toThrow();
  });

  it("acknowledges only fully reconciled results", async () => {
    const f = setup();
    expect(
      await f.handler({ Records: [record("first"), record("second")] }),
    ).toEqual({ batchItemFailures: [] });
    expect(f.processEnvelope).toHaveBeenCalledTimes(2);
  });
  it("retains pending and later FIFO messages without running later work", async () => {
    const processEnvelope = vi.fn(() =>
      Promise.resolve({
        state: "pending" as const,
        jobId: "job.test",
      }),
    );
    const handler = createSolutionExportQueueHandler({
      expectedQueueArn: queueArn,
      worker: { processEnvelope },
    });
    expect(
      await handler({ Records: [record("first"), record("second")] }),
    ).toEqual({
      batchItemFailures: [
        { itemIdentifier: "first" },
        { itemIdentifier: "second" },
      ],
    });
    expect(processEnvelope).toHaveBeenCalledTimes(1);
  });
  it("retains a failed terminal reconciliation", async () => {
    const f = setup();
    f.processEnvelope.mockRejectedValueOnce(
      new Error("Synthetic persistence failure."),
    );
    expect(await f.handler({ Records: [record("first")] })).toEqual({
      batchItemFailures: [{ itemIdentifier: "first" }],
    });
  });
  it.each([
    { eventSourceARN: queueArn.replace("123456789012", "999999999999") },
    { eventSource: "unexpected" },
    { body: "x".repeat(8193) },
    { messageId: "" },
  ])(
    "validates every source and bound before executing any item: %j",
    async (change) => {
      const f = setup();
      await expect(
        f.handler({
          Records: [record("first"), { ...record("second"), ...change }],
        }),
      ).rejects.toThrow();
      expect(f.processEnvelope).not.toHaveBeenCalled();
    },
  );
  it("rejects duplicate identities and oversized batches before execution", async () => {
    const f = setup();
    await expect(
      f.handler({ Records: [record("same"), record("same")] }),
    ).rejects.toThrow();
    await expect(
      f.handler({
        Records: Array.from({ length: 11 }, (_, i) => record(String(i))),
      }),
    ).rejects.toThrow();
    expect(f.processEnvelope).not.toHaveBeenCalled();
  });
  it("retains malformed payloads without sending them to the executor", async () => {
    const f = setup();
    expect(await f.handler({ Records: [record("first", "{")] })).toEqual({
      batchItemFailures: [{ itemIdentifier: "first" }],
    });
    expect(f.processEnvelope).not.toHaveBeenCalled();
  });
});
