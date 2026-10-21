import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  DatabaseResumingException,
  ExecuteStatementCommand,
  RDSDataClient,
  RollbackTransactionCommand,
} from "@aws-sdk/client-rds-data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RdsDataApiDatabase,
  convertPositionalParameters,
  type RdsDataApiResumeRetryPolicy,
} from "./rds-data-driver.js";
import { sql } from "./sql.js";

describe("RDS Data API executor", () => {
  it("converts positional values to named parameters without interpolating SQL", () => {
    const injection = "organization' OR TRUE --";
    const converted = convertPositionalParameters(
      sql(
        "SELECT * FROM projects WHERE organization_id = $1 AND record_version = $2",
        [injection, 7],
      ),
    );

    expect(converted.sql).toBe(
      "SELECT * FROM projects WHERE organization_id = :p1 AND record_version = :p2",
    );
    expect(converted.sql).not.toContain(injection);
    expect(converted.parameters).toEqual([
      { name: "p1", value: { stringValue: injection } },
      { name: "p2", value: { longValue: 7 } },
    ]);
  });

  it("uses Data API begin, statement, and commit operations", async () => {
    const commands: object[] = [];
    const client = {
      destroy: () => undefined,
      send(command: object): Promise<object> {
        commands.push(command);
        if (command instanceof BeginTransactionCommand) {
          return Promise.resolve({ transactionId: "transaction_test" });
        }
        if (command instanceof ExecuteStatementCommand) {
          return Promise.resolve({
            formattedRecords: '[{"value":"9007199254740993"}]',
          });
        }
        return Promise.resolve({});
      },
    } as unknown as RDSDataClient;
    const database = new RdsDataApiDatabase({
      client,
      database: "cloudmarkup",
      resourceArn: "arn:aws:rds:us-east-1:111111111111:cluster:test",
      secretArn: "arn:aws:secretsmanager:us-east-1:111111111111:secret:test",
    });

    const result = await database.transaction((transaction) =>
      transaction.query(sql("SELECT $1 AS value", [1])),
    );

    expect(result.rows).toEqual([{ value: "9007199254740993" }]);
    expect(commands).toHaveLength(3);
    expect(commands[0]).toBeInstanceOf(BeginTransactionCommand);
    expect(commands[1]).toBeInstanceOf(ExecuteStatementCommand);
    expect(commands[2]).toBeInstanceOf(CommitTransactionCommand);
    expect((commands[1] as ExecuteStatementCommand).input).toMatchObject({
      formatRecordsAs: "JSON",
      resultSetOptions: {
        decimalReturnType: "STRING",
        longReturnType: "STRING",
      },
    });
  });

  it.each(
    [
      {
        formattedRecords: '[{"value":"one"},{"value":"two"}]',
        numberOfRecordsUpdated: 0,
        count: 2,
      },
      { formattedRecords: '[{"value":"one"}]', count: 1 },
      { formattedRecords: "[]", numberOfRecordsUpdated: 0, count: 0 },
      { numberOfRecordsUpdated: 2, count: 2 },
      { numberOfRecordsUpdated: 0, count: 0 },
      {
        formattedRecords: '[{"value":"one"}]',
        numberOfRecordsUpdated: 2,
        count: 2,
      },
    ].filter((_, index) => index !== 4),
  )(
    "preserves returned and affected row counts (%#)",
    async ({ count, ...response }) => {
      const client = {
        send: () => Promise.resolve(response),
      } as unknown as RDSDataClient;
      const database = new RdsDataApiDatabase({
        client,
        database: "cloudmarkup",
        resourceArn: "arn:aws:rds:us-east-1:111111111111:cluster:test",
        secretArn: "arn:aws:secretsmanager:us-east-1:111111111111:secret:test",
      });
      expect((await database.query(sql("SELECT 1"))).rowCount).toBe(count);
    },
  );

  it("rolls back and preserves the original failure", async () => {
    const commands: object[] = [];
    const client = {
      destroy: () => undefined,
      send(command: object): Promise<object> {
        commands.push(command);
        if (command instanceof BeginTransactionCommand) {
          return Promise.resolve({ transactionId: "transaction_test" });
        }
        if (command instanceof ExecuteStatementCommand) {
          return Promise.reject(new Error("controlled database failure"));
        }
        return Promise.resolve({});
      },
    } as unknown as RDSDataClient;
    const database = new RdsDataApiDatabase({
      client,
      database: "cloudmarkup",
      resourceArn: "arn:aws:rds:us-east-1:111111111111:cluster:test",
      secretArn: "arn:aws:secretsmanager:us-east-1:111111111111:secret:test",
    });

    await expect(
      database.transaction((transaction) =>
        transaction.query(sql("SELECT $1", [1])),
      ),
    ).rejects.toThrow("controlled database failure");
    expect(commands.at(-1)).toBeInstanceOf(RollbackTransactionCommand);
  });
});

const databaseTarget = {
  database: "cloudmarkup",
  resourceArn: "arn:aws:rds:us-east-1:111111111111:cluster:test",
  secretArn: "arn:aws:secretsmanager:us-east-1:111111111111:secret:test",
};

function resuming() {
  return new DatabaseResumingException({
    $metadata: {},
    message: "The canceled request initiated database resume.",
  });
}

function retryFixture(
  policy: RdsDataApiResumeRetryPolicy = {
    maxElapsedMilliseconds: 10_000,
    maxAttempts: 4,
  },
  sdkAttempts = 1,
) {
  const send = vi
    .fn<
      (
        command: object,
        options?: { readonly abortSignal?: AbortSignal },
      ) => Promise<Record<string, unknown>>
    >()
    .mockResolvedValue({ formattedRecords: '[{"value":"ready"}]' });
  const client = {
    send,
    config: { maxAttempts: () => Promise.resolve(sdkAttempts) },
  } as unknown as RDSDataClient;
  const database = new RdsDataApiDatabase({
    ...databaseTarget,
    client,
    resumeRetry: policy,
  });
  return { database, send };
}

describe("explicit Aurora resume retry", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.spyOn(Math, "random").mockReturnValue(1);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("leaves the default host opted out, even for a confirmed resume error", async () => {
    const error = resuming();
    const send = vi.fn().mockRejectedValue(error);
    const database = new RdsDataApiDatabase({
      ...databaseTarget,
      client: { send } as unknown as RDSDataClient,
    });
    await expect(database.query(sql("SELECT 1"))).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toHaveLength(1);
  });

  it("retries a canceled request with exactly the original command and parameters", async () => {
    const f = retryFixture();
    f.send.mockRejectedValueOnce(resuming()).mockRejectedValueOnce(resuming());
    const pending = expect(
      f.database.query(sql("SELECT $1 AS value", ["tenant' OR TRUE --"])),
    ).resolves.toMatchObject({ rows: [{ value: "ready" }] });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    await pending;
    expect(f.send).toHaveBeenCalledTimes(3);
    const command = f.send.mock.calls[0]?.[0] as ExecuteStatementCommand;
    expect(command.input.sql).toBe("SELECT :p1 AS value");
    expect(command.input.parameters).toEqual([
      { name: "p1", value: { stringValue: "tenant' OR TRUE --" } },
    ]);
    expect(f.send.mock.calls.every(([sent]) => sent === command)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(
    [
      new Error("An ambiguous transport timeout."),
      new Error("An access-denied database request."),
      Object.assign(
        new Error("A name alone does not prove request cancellation."),
        {
          name: "DatabaseResumingException",
        },
      ),
    ].filter((_, index) => index !== 1),
  )("does not replay an unconfirmed failure (%#)", async (error) => {
    const f = retryFixture();
    f.send.mockRejectedValue(error);
    await expect(
      f.database.query(sql("UPDATE projects SET name=$1", ["x"])),
    ).rejects.toBe(error);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds total sends independently of the elapsed-time budget", async () => {
    const f = retryFixture();
    f.send.mockRejectedValue(resuming());
    const pending = expect(
      f.database.query(sql("SELECT 1")),
    ).rejects.toMatchObject({
      code: "persistence-unavailable",
      message: "The database is temporarily unavailable.",
    });
    await vi.advanceTimersByTimeAsync(6_000);
    await pending;
    expect(f.send).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses one deadline across backoff and attempts, with no send at expiry", async () => {
    const f = retryFixture({ maxElapsedMilliseconds: 2_500, maxAttempts: 20 });
    f.send.mockRejectedValue(resuming());
    const pending = expect(
      f.database.query(sql("SELECT 1")),
    ).rejects.toMatchObject({
      code: "persistence-unavailable",
    });
    await vi.advanceTimersByTimeAsync(2_500);
    await pending;
    expect(f.send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a stalled transport and never replays a late resume error", async () => {
    const f = retryFixture({ maxElapsedMilliseconds: 2_500, maxAttempts: 20 });
    let rejectSend: ((error: unknown) => void) | undefined;
    f.send.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSend = reject;
        }),
    );
    const pending = expect(
      f.database.query(sql("UPDATE projects SET name=$1", ["x"])),
    ).rejects.toMatchObject({ code: "persistence-unavailable" });
    await vi.advanceTimersByTimeAsync(2_500);
    await pending;
    expect(f.send.mock.calls[0]?.[1]?.abortSignal?.aborted).toBe(true);
    rejectSend?.(resuming());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors cancellation before any database operation", async () => {
    const controller = new AbortController();
    controller.abort();
    const f = retryFixture({
      maxElapsedMilliseconds: 10_000,
      maxAttempts: 4,
      abortSignal: controller.signal,
    });
    await expect(f.database.query(sql("SELECT 1"))).rejects.toMatchObject({
      code: "persistence-unavailable",
    });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("honors cancellation during backoff without another send", async () => {
    const controller = new AbortController();
    const f = retryFixture({
      maxElapsedMilliseconds: 10_000,
      maxAttempts: 4,
      abortSignal: controller.signal,
    });
    f.send.mockRejectedValue(resuming());
    const pending = expect(
      f.database.query(sql("SELECT 1")),
    ).rejects.toMatchObject({
      code: "persistence-unavailable",
    });
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await pending;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts an in-flight request on host cancellation without replay", async () => {
    const controller = new AbortController();
    const f = retryFixture({
      maxElapsedMilliseconds: 10_000,
      maxAttempts: 4,
      abortSignal: controller.signal,
    });
    let rejectSend: ((error: unknown) => void) | undefined;
    f.send.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSend = reject;
        }),
    );
    const pending = expect(
      f.database.query(sql("UPDATE projects SET name=$1", ["x"])),
    ).rejects.toMatchObject({ code: "persistence-unavailable" });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await pending;
    expect(f.send.mock.calls[0]?.[1]?.abortSignal?.aborted).toBe(true);
    rejectSend?.(resuming());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries only transaction admission and runs the callback once", async () => {
    const f = retryFixture();
    f.send
      .mockRejectedValueOnce(resuming())
      .mockResolvedValueOnce({ transactionId: "transaction_test" });
    const work = vi.fn(
      (tx: Parameters<Parameters<typeof f.database.transaction>[0]>[0]) =>
        tx.query(sql("SELECT 1")),
    );
    const pending = expect(f.database.transaction(work)).resolves.toMatchObject(
      {
        rows: [{ value: "ready" }],
      },
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(work).toHaveBeenCalledTimes(1);
    expect(
      f.send.mock.calls.map(([command]) => command.constructor.name),
    ).toEqual([
      "BeginTransactionCommand",
      "BeginTransactionCommand",
      "ExecuteStatementCommand",
      "CommitTransactionCommand",
    ]);
  });

  it.each([
    { failedOperation: "statement", kind: "resume", error: resuming() },
    { failedOperation: "commit", kind: "resume", error: resuming() },
    {
      failedOperation: "statement",
      kind: "ambiguous",
      error: new Error("The statement outcome is unknown after a timeout."),
    },
    {
      failedOperation: "commit",
      kind: "ambiguous",
      error: new Error("The commit outcome is unknown after a timeout."),
    },
  ] as const)(
    "does not replay a $failedOperation $kind failure after transaction admission",
    async ({ failedOperation, error }) => {
      const f = retryFixture();
      const rollbackError = new Error("Rollback also failed.");
      f.send.mockImplementation((command) => {
        if (command instanceof BeginTransactionCommand)
          return Promise.resolve({ transactionId: "transaction_test" });
        if (command instanceof RollbackTransactionCommand)
          return Promise.reject(rollbackError);
        if (
          (failedOperation === "statement" &&
            command instanceof ExecuteStatementCommand) ||
          (failedOperation === "commit" &&
            command instanceof CommitTransactionCommand)
        )
          return Promise.reject(error);
        return Promise.resolve({ formattedRecords: "[]" });
      });
      const work = vi.fn(
        (tx: Parameters<Parameters<typeof f.database.transaction>[0]>[0]) =>
          tx.query(sql("UPDATE projects SET name=$1", ["x"])),
      );
      await expect(f.database.transaction(work)).rejects.toBe(error);
      expect(work).toHaveBeenCalledTimes(1);
      expect(
        f.send.mock.calls.filter(
          ([command]) => command instanceof RollbackTransactionCommand,
        ),
      ).toHaveLength(1);
      expect(
        f.send.mock.calls.filter(([command]) =>
          failedOperation === "statement"
            ? command instanceof ExecuteStatementCommand
            : command instanceof CommitTransactionCommand,
        ),
      ).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([0, 2, 3].filter((_, index) => ![0, 2].includes(index)))(
    "rejects an SDK retry count of %s before sending SQL",
    async (attempts) => {
      const f = retryFixture(undefined, attempts);
      await expect(f.database.query(sql("SELECT 1"))).rejects.toMatchObject({
        code: "persistence-unavailable",
      });
      expect(f.send).not.toHaveBeenCalled();
    },
  );

  it("creates an owned SDK client with exactly one attempt when opted in", async () => {
    const send = vi
      .spyOn(RDSDataClient.prototype, "send")
      .mockResolvedValue({ formattedRecords: "[]" } as never);
    const database = new RdsDataApiDatabase({
      ...databaseTarget,
      resumeRetry: { maxElapsedMilliseconds: 10_000, maxAttempts: 4 },
    });
    await database.query(sql("SELECT 1"));
    const client = send.mock.contexts[0];
    expect(client).toBeInstanceOf(RDSDataClient);
    if (!(client instanceof RDSDataClient))
      throw new Error("The driver must create an owned SDK client.");
    expect(await client.config.maxAttempts()).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    await database.close();
  });

  it.each(
    [
      { maxElapsedMilliseconds: 0, maxAttempts: 4 },
      { maxElapsedMilliseconds: 60_001, maxAttempts: 4 },
      { maxElapsedMilliseconds: 1.5, maxAttempts: 4 },
      { maxElapsedMilliseconds: Number.NaN, maxAttempts: 4 },
      { maxElapsedMilliseconds: 10_000, maxAttempts: 1 },
      { maxElapsedMilliseconds: 10_000, maxAttempts: 21 },
    ].filter((_, index) => ![0, 2, 3].includes(index)),
  )("rejects an unbounded or invalid policy (%#)", (policy) => {
    expect(() => retryFixture(policy)).toThrow(/retry policy is invalid/u);
  });
});
