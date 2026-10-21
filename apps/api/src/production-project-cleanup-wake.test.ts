import { describe, expect, it, vi } from "vitest";
import {
  createCleanupWakeDispatchHandler,
  createCleanupWakeQueueHandler,
  optionalCleanupWakeObserver,
  optionalCleanupWakeAdmission,
  readCleanupWakeEnvironment,
  workerHandler,
  dispatchHandler,
} from "./production-project-cleanup-wake.js";
import {
  createProjectCleanupScheduledHandler,
  readProjectCleanupEnvironment,
} from "./production-project-content-cleanup.js";
import type {
  SqlDatabase,
  SqlRow,
  SqlResult,
} from "./adapters/persistence/sql.js";
function environment() {
  const account = "123456789012",
    region = "us-east-1",
    table = "cloudmarkup-beta-cleanup-wakes";
  return {
    CLOUDMARKUP_ENVIRONMENT: "beta",
    AWS_REGION: region,
    CLOUDMARKUP_ACCOUNT_ID: account,
    CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: "0138",
    CLOUDMARKUP_PROJECT_CLEANUP_ENABLED: "true",
    CLOUDMARKUP_CLEANUP_WAKE_ENABLED: "true",
    CLOUDMARKUP_DATABASE_ARN: `arn:aws:rds:${region}:${account}:cluster:cloudmarkup-beta-postgresql`,
    CLOUDMARKUP_DATABASE_SECRET_ARN: `arn:aws:secretsmanager:${region}:${account}:secret:cloudmarkup-beta/database/admin-ABC123`,
    CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
    CLOUDMARKUP_CONTENT_BUCKET: `cloudmarkup-beta-${account}-${region}-content`,
    CLOUDMARKUP_CLEANUP_SCHEDULE_ARN: `arn:aws:events:${region}:${account}:rule/cloudmarkup-beta-project-content-cleanup`,
    CLOUDMARKUP_CLEANUP_WAKE_TABLE: table,
    CLOUDMARKUP_CLEANUP_WAKE_QUEUE_URL: `https://sqs.${region}.amazonaws.com/${account}/${table}`,
    CLOUDMARKUP_CLEANUP_WAKE_SCHEDULE_ARN: `arn:aws:events:${region}:${account}:rule/cloudmarkup-beta-cleanup-wake-dispatch`,
    CLOUDMARKUP_CLEANUP_WAKE_STREAM_ARN: `arn:aws:dynamodb:${region}:${account}:table/${table}/stream/2026-10-02T00:00:00.000`,
  };
}
function config() {
  const value = readCleanupWakeEnvironment(environment());
  if (value === undefined) throw Error("Missing fixture config");
  return value;
}
describe("inactive cleanup wake hosts and private envelopes", () => {
  it("defaults off before requiring credentials or constructing ports", async () => {
    expect(readCleanupWakeEnvironment({})).toBeUndefined();
    expect(optionalCleanupWakeObserver({})).toBeUndefined();
    vi.stubEnv("CLOUDMARKUP_CLEANUP_WAKE_ENABLED", "false");
    try {
      expect(await dispatchHandler({})).toEqual({ enabled: false });
      await expect(workerHandler({})).rejects.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("keeps admission off and verifies the registered source schema before external work", async () => {
    const query = vi.fn(),
      transaction = vi.fn();
    const database = {
      query,
      transaction,
      close: vi.fn(),
    } as unknown as SqlDatabase;
    expect(optionalCleanupWakeAdmission({}, database)).toBeUndefined();
    expect(
      optionalCleanupWakeAdmission(
        { CLOUDMARKUP_CLEANUP_ADMISSION_ENABLED: "false" },
        database,
      ),
    ).toBeUndefined();
    for (const flag of ["TRUE", "1", ""])
      expect(() =>
        optionalCleanupWakeAdmission(
          { ...environment(), CLOUDMARKUP_CLEANUP_ADMISSION_ENABLED: flag },
          database,
        ),
      ).toThrow();
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(() =>
      optionalCleanupWakeAdmission(
        { ...environment(), CLOUDMARKUP_CLEANUP_ADMISSION_ENABLED: "true" },
        database,
      ),
    ).toThrow("The cleanup wake host configuration is invalid.");
    const ports = optionalCleanupWakeAdmission(
      {
        ...environment(),
        CLOUDMARKUP_CLEANUP_ADMISSION_ENABLED: "true",
        CLOUDMARKUP_CLEANUP_HISTORY_ENABLED: "true",
        CLOUDMARKUP_DELETION_RECOVERY_ENABLED: "true",
        CLOUDMARKUP_CLEANUP_HISTORY_TABLE_ID:
          "123e4567-e89b-12d3-a456-426614174000",
        CLOUDMARKUP_CLEANUP_DATABASE_RESOURCE_ID:
          "cluster-ABCDEFGHIJKLMNOPQRSTUVWX123456",
      },
      database,
    );
    if (ports === undefined)
      throw Error("Registered admission ports are missing");
    expect(query).not.toHaveBeenCalled();
    query.mockResolvedValue({
      rowCount: 1,
      rows: [{ version: "0093", checksum_sha256: "0".repeat(64) }],
    });
    await expect(ports.publisher.send("a".repeat(64))).rejects.toThrow(
      "The cleanup schema binding is invalid.",
    );
    expect(query).toHaveBeenCalledTimes(1);
  });
  it.each([
    "CLOUDMARKUP_CLEANUP_WAKE_TABLE",
    "CLOUDMARKUP_CLEANUP_WAKE_QUEUE_URL",
    "CLOUDMARKUP_CLEANUP_WAKE_STREAM_ARN",
    "CLOUDMARKUP_CLEANUP_WAKE_SCHEDULE_ARN",
  ])("rejects a mismatched %s", (key) => {
    expect(() =>
      readCleanupWakeEnvironment({ ...environment(), [key]: "untrusted" }),
    ).toThrow();
  });
  it("rejects malformed opt-in flags and disabling canonical SQL recovery", () => {
    expect(() =>
      readCleanupWakeEnvironment({ CLOUDMARKUP_CLEANUP_WAKE_ENABLED: "TRUE" }),
    ).toThrow();
    expect(() =>
      readCleanupWakeEnvironment({
        ...environment(),
        CLOUDMARKUP_PROJECT_CLEANUP_ENABLED: "false",
      }),
    ).toThrow();
  });
  it("validates the whole SQS batch before any processing and reports only failed message IDs", async () => {
    const configuration = config();
    const process = vi
      .fn()
      .mockRejectedValueOnce(Error("Unavailable"))
      .mockResolvedValue(undefined);
    const record = {
      messageId: "message_1",
      eventSource: "aws:sqs",
      eventSourceARN: configuration.queueArn,
      awsRegion: configuration.region,
      body: JSON.stringify({ schemaVersion: 1, wakeId: "a".repeat(64) }),
    };
    const handler = createCleanupWakeQueueHandler({ configuration, process });
    await expect(
      handler({ Records: [record, { ...record, eventSourceARN: "foreign" }] }),
    ).rejects.toThrow();
    expect(process).not.toHaveBeenCalled();
    expect(
      await handler({
        Records: [record, { ...record, messageId: "message_2" }],
      }),
    ).toEqual({ batchItemFailures: [{ itemIdentifier: "message_1" }] });
    await expect(
      handler({
        Records: [
          {
            ...record,
            body: JSON.stringify({
              schemaVersion: 1,
              wakeId: "a".repeat(64),
              organizationId: "forbidden",
            }),
          },
        ],
      }),
    ).rejects.toThrow();
  });
  it("admits only the exact schedule or INSERT stream and treats them as ledger-read hints", async () => {
    const configuration = config();
    const dispatch = vi.fn().mockResolvedValue({ dispatched: 0 });
    const handler = createCleanupWakeDispatchHandler({
      configuration,
      dispatch,
    });
    const scheduled = {
      source: "aws.events",
      "detail-type": "Scheduled Event",
      account: configuration.account,
      region: configuration.region,
      resources: [configuration.scheduleArn],
    };
    await handler(scheduled);
    const stream = {
      Records: [
        {
          eventSource: "aws:dynamodb",
          eventName: "INSERT",
          eventSourceARN: configuration.streamArn,
          awsRegion: configuration.region,
        },
      ],
    };
    await handler(stream);
    await expect(
      handler({ ...scheduled, account: "999999999999" }),
    ).rejects.toThrow();
    await expect(
      handler({
        Records: stream.Records.map((record) => ({
          ...record,
          eventName: "MODIFY",
        })),
      }),
    ).rejects.toThrow();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
  it("minute SQL recovery proceeds and retries mirroring after notification is lost or the ledger is unavailable", async () => {
    const configuration = readProjectCleanupEnvironment(environment());
    const mirrorPending = vi
      .fn()
      .mockRejectedValueOnce(Error("Ledger unavailable"))
      .mockResolvedValue(undefined);
    const cleanup = {
      listPending: vi
        .fn()
        .mockResolvedValue([
          { organizationId: "org_test", projectId: "project_test" },
        ]),
      process: vi.fn().mockResolvedValue({ state: "pending" }),
    };
    const rows = [
      {
        version: "0138",
        checksum_sha256:
          "b5cd0bcb42f94baaa6266ed43e0222a89af7c4bd2b84535d9e6949a5c7a0ad4b",
      },
    ];
    const database: SqlDatabase = {
      query: <T extends SqlRow>(): Promise<SqlResult<T>> =>
        Promise.resolve({
          rows: rows as unknown as T[],
          rowCount: 1,
        }),
      transaction: async (work) => work(database),
      close: () => Promise.resolve(),
    };
    const handler = createProjectCleanupScheduledHandler({
      configuration,
      database,
      cleanup,
      mirrorPending,
    });
    const event = {
      source: "aws.events",
      "detail-type": "Scheduled Event",
      account: configuration.account,
      region: configuration.region,
      resources: [configuration.scheduleArn],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await handler(event);
      await handler(event);
      expect(cleanup.process).toHaveBeenCalledTimes(2);
      expect(mirrorPending).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});
