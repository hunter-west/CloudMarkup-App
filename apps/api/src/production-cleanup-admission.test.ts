import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectCleanupAdmissionWake } from "./application/project-cleanup-wake.js";
import type {
  SqlDatabase,
  SqlResult,
  SqlRow,
} from "./adapters/persistence/sql.js";
const assigned = vi.hoisted(() => ({
  version: "synthetic_assigned",
  checksumSha256: "a".repeat(64),
}));
vi.mock("./production-cleanup-schema.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./production-cleanup-schema.js")>()),
  CLEANUP_ADMISSION_SCHEMA: assigned,
}));
import { optionalCleanupWakeAdmission } from "./production-project-cleanup-wake.js";
const account = "123456789012",
  region = "us-east-1",
  table = "cloudmarkup-beta-cleanup-wakes";
const environment = {
  CLOUDMARKUP_ENVIRONMENT: "beta",
  AWS_REGION: region,
  CLOUDMARKUP_ACCOUNT_ID: account,
  CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: "0138",
  CLOUDMARKUP_PROJECT_CLEANUP_ENABLED: "true",
  CLOUDMARKUP_CLEANUP_WAKE_ENABLED: "true",
  CLOUDMARKUP_CLEANUP_ADMISSION_ENABLED: "true",
  CLOUDMARKUP_CLEANUP_HISTORY_ENABLED: "true",
  CLOUDMARKUP_DELETION_RECOVERY_ENABLED: "true",
  CLOUDMARKUP_CLEANUP_HISTORY_TABLE_ID: "12345678-1234-1234-1234-123456789012",
  CLOUDMARKUP_CLEANUP_DATABASE_RESOURCE_ID: "cluster-ABCDEFGHIJKLMNOPQRSTUVWX",
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
const wake = projectCleanupAdmissionWake({
  organizationId: "org_test",
  projectId: "project_test",
  recordVersion: 2,
  deletionRequestedAt: "2026-10-03T00:00:00.000Z",
  admissionDeadline: "2026-10-03T00:01:00.000Z",
  admissionId: "a".repeat(64),
});
function fixture(valid = true) {
  const query = vi.fn();
  const database: SqlDatabase = {
    query: <T extends SqlRow>(): Promise<SqlResult<T>> => {
      query();
      return Promise.resolve({
        rows: [
          {
            version: assigned.version,
            checksum_sha256: valid ? assigned.checksumSha256 : "b".repeat(64),
          },
        ] as unknown as T[],
        rowCount: 1,
      });
    },
    transaction: (work) => work(database),
    close: () => Promise.resolve(),
  };
  const dynamodb = vi
    .spyOn(DynamoDBClient.prototype, "send")
    .mockImplementation((command) => {
      if (command instanceof PutItemCommand)
        return Promise.resolve({}) as never;
      if (command instanceof GetItemCommand)
        return Promise.resolve({
          Item: {
            PK: {
              S: `WAKE#${String(Number.parseInt(wake.wakeId[0] ?? "", 16) % 4)}`,
            },
            SK: { S: wake.wakeId },
            binding: { S: JSON.stringify(wake) },
          },
        }) as never;
      throw Error("Unexpected synthetic command");
    });
  const sqs = vi
    .spyOn(SQSClient.prototype, "send")
    .mockResolvedValue({ MessageId: "synthetic_message" } as never);
  const ports = optionalCleanupWakeAdmission(environment, database);
  if (ports === undefined) throw Error("Missing synthetic ports");
  return { query, dynamodb, sqs, ports };
}
afterEach(() => vi.restoreAllMocks());
describe("production admission ports with a synthetic assigned schema", () => {
  it("checks the source checksum before each durable put/read and opaque queue hint", async () => {
    const f = fixture();
    await f.ports.ledger.put(wake);
    expect(await f.ports.ledger.get(wake.wakeId)).toEqual(wake);
    await f.ports.publisher.send(wake.wakeId);
    expect(f.query).toHaveBeenCalledTimes(3);
    expect(
      (f.dynamodb.mock.calls[0]?.[0] as PutItemCommand).input.Item?.["binding"]
        ?.S,
    ).toBe(JSON.stringify(wake));
    expect(
      (f.dynamodb.mock.calls[1]?.[0] as GetItemCommand).input.ConsistentRead,
    ).toBe(true);
    const command = f.sqs.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(SendMessageCommand);
    expect((command as SendMessageCommand).input.MessageBody).toBe(
      JSON.stringify({ schemaVersion: 1, wakeId: wake.wakeId }),
    );
  });
  it("fails a changed schema before external ledger or queue I/O", async () => {
    const f = fixture(false);
    await expect(f.ports.ledger.put(wake)).rejects.toThrow();
    await expect(f.ports.ledger.get(wake.wakeId)).rejects.toThrow();
    await expect(f.ports.publisher.send(wake.wakeId)).rejects.toThrow();
    expect(f.dynamodb).not.toHaveBeenCalled();
    expect(f.sqs).not.toHaveBeenCalled();
  });
  it("requires the exact beta wake environment even with a synthetic assigned slot", () => {
    const f = fixture();
    for (const changed of [
      { CLOUDMARKUP_CLEANUP_WAKE_ENABLED: "false" },
      { CLOUDMARKUP_ENVIRONMENT: "prod" },
      { CLOUDMARKUP_CLEANUP_WAKE_TABLE: "foreign" },
    ])
      expect(() =>
        optionalCleanupWakeAdmission(
          { ...environment, ...changed },
          {} as SqlDatabase,
        ),
      ).toThrow();
    expect(f.query).not.toHaveBeenCalled();
    expect(f.dynamodb).not.toHaveBeenCalled();
    expect(f.sqs).not.toHaveBeenCalled();
  });
});
