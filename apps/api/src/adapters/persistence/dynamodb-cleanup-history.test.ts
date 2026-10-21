import {
  DynamoDBClient,
  DescribeTableCommand,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  QueryCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { afterEach, describe, it, expect, vi } from "vitest";
import { DynamoDbCleanupHistory } from "./dynamodb-cleanup-history.js";
import {
  cleanupHistoryId,
  type CleanupHistoryEnvelope,
} from "../../application/project-cleanup-history.js";
import { projectCleanupAdmissionWake } from "../../application/project-cleanup-wake.js";
import { cleanupRequired } from "./cleanup-required.js";
const tableId = "12345678-1234-1234-1234-123456789012",
  wake = projectCleanupAdmissionWake({
    organizationId: "org_test",
    projectId: "project_test",
    recordVersion: 2,
    deletionRequestedAt: "2026-10-03T00:00:00.000Z",
    admissionId: "a".repeat(64),
    admissionDeadline: "2026-10-03T00:01:00.000Z",
  }),
  envelope: CleanupHistoryEnvelope = {
    kind: "admission",
    wake,
    principalId: "principal_test",
    idempotencyKeySha256: "b".repeat(64),
    requestSha256: "c".repeat(64),
    expectedRecordVersion: 1,
  };
function fixture() {
  const items = new Map<string, Record<string, AttributeValue>>();
  let actualId = tableId,
    loseUpdate = false;
  const client = new DynamoDBClient({ maxAttempts: 1 }),
    send = vi.spyOn(client, "send").mockImplementation((command) => {
      if (command instanceof DescribeTableCommand)
        return Promise.resolve({
          Table: { TableId: actualId, TableStatus: "ACTIVE" },
        }) as never;
      if (command instanceof GetItemCommand) {
        expect(command.input.ConsistentRead).toBe(true);
        return Promise.resolve({
          Item: items.get(cleanupRequired(command.input.Key?.["SK"]?.S)),
        }) as never;
      }
      if (command instanceof PutItemCommand) {
        const id = cleanupRequired(command.input.Item?.["SK"]?.S);
        if (items.has(id)) return Promise.reject(Error("conditional")) as never;
        items.set(id, structuredClone(cleanupRequired(command.input.Item)));
        return Promise.resolve({}) as never;
      }
      if (command instanceof UpdateItemCommand) {
        const id = cleanupRequired(command.input.Key?.["SK"]?.S),
          item = items.get(id),
          v = cleanupRequired(command.input.ExpressionAttributeValues);
        if (
          item === undefined ||
          item["state"]?.S !== v[":from"]?.S ||
          item["envelope"]?.S !== v[":envelope"]?.S
        )
          return Promise.reject(Error("conditional")) as never;
        item["state"] = { S: cleanupRequired(v[":to"]?.S) };
        if (v[":completion"] !== undefined)
          item["completion"] = v[":completion"];
        if (loseUpdate) {
          loseUpdate = false;
          return Promise.reject(Error("lost response")) as never;
        }
        return Promise.resolve({}) as never;
      }
      if (command instanceof QueryCommand) {
        expect(command.input.ConsistentRead).toBe(true);
        expect(command.input.Limit).toBe(25);
        return Promise.resolve({
          Items: [...items.values()].filter(
            (item) =>
              item["PK"]?.S ===
              command.input.ExpressionAttributeValues?.[":pk"]?.S,
          ),
        }) as never;
      }
      throw Error("Unsupported synthetic command");
    });
  const history = new DynamoDbCleanupHistory({
    client,
    table: "cloudmarkup-beta-cleanup-wakes",
    expectedTableId: tableId,
  });
  return {
    history,
    send,
    items,
    change: () => {
      actualId = "87654321-4321-4321-4321-210987654321";
    },
    lose: () => {
      loseUpdate = true;
    },
  };
}
afterEach(() => vi.restoreAllMocks());
describe("retained DynamoDB cleanup history", () => {
  it("conditional preparation and strong exact read preserve immutable binding without TTL", async () => {
    const f = fixture();
    await f.history.prepare(envelope);
    await f.history.prepare(envelope);
    expect(await f.history.read(wake.wakeId)).toEqual({
      envelope,
      state: "prepared",
    });
    const put = cleanupRequired(
      f.send.mock.calls.find(([c]) => c instanceof PutItemCommand),
    )[0] as PutItemCommand;
    expect(put.input.ConditionExpression).toBe("attribute_not_exists(PK)");
    expect(Object.keys(cleanupRequired(put.input.Item)).sort()).toEqual([
      "PK",
      "SK",
      "envelope",
      "state",
    ]);
  });
  it("wrong same-ID principal cannot overwrite retained history", async () => {
    const f = fixture();
    await f.history.prepare(envelope);
    await expect(
      f.history.prepare({ ...envelope, principalId: "other" }),
    ).rejects.toThrow();
    expect((await f.history.read(wake.wakeId))?.envelope).toEqual(envelope);
  });
  it("committed history cannot become aborted or be deleted by this port", async () => {
    const f = fixture();
    await f.history.prepare(envelope);
    await f.history.transition(envelope, "prepared", "committed");
    await expect(
      f.history.transition(envelope, "prepared", "aborted"),
    ).rejects.toThrow();
    expect((await f.history.read(wake.wakeId))?.state).toBe("committed");
    expect("complete" in f.history).toBe(false);
  });
  it("an ambiguous terminal update converges only through exact strong read", async () => {
    const f = fixture();
    await f.history.prepare(envelope);
    f.lose();
    await f.history.transition(envelope, "prepared", "committed");
    expect((await f.history.read(wake.wakeId))?.state).toBe("committed");
  });
  it("issued writer cannot timeout-abort or complete without a returned provider version", async () => {
    const f = fixture();
    const e: CleanupHistoryEnvelope = {
      kind: "write",
      writeId: "write_test",
      organizationId: "org_test",
      projectId: "project_test",
      objectId: "object_test",
      contentSha256: "d".repeat(64),
      sizeBytes: 2,
      purpose: "report",
      mediaType: "application/json",
      storageNamespace: "documents",
      principalId: "principal_test",
    };
    await f.history.prepare(e);
    await f.history.transition(e, "prepared", "issued");
    await expect(
      f.history.transition(e, "issued", "aborted"),
    ).rejects.toThrow();
    await expect(
      f.history.transition(e, "issued", "completed"),
    ).rejects.toThrow();
    await f.history.transition(e, "issued", "completed", {
      objectVersion: "actual-version",
    });
    expect(
      (await f.history.read(cleanupHistoryId(e)))?.completion?.objectVersion,
    ).toBe("actual-version");
  });
  it("fresh table identity rejects replacement before any mutation or query", async () => {
    const f = fixture();
    f.change();
    await expect(f.history.prepare(envelope)).rejects.toThrow(/incarnation/);
    expect(
      f.send.mock.calls.every(([c]) => c instanceof DescribeTableCommand),
    ).toBe(true);
  });
  it("a warm instance rechecks table identity for every strong read", async () => {
    const f = fixture();
    await f.history.prepare(envelope);
    await f.history.read(wake.wakeId);
    f.change();
    await expect(f.history.read(wake.wakeId)).rejects.toThrow();
  });
  it("even an empty strong read rejects a table replacement during the read", async () => {
    const f = fixture();
    f.send
      .mockImplementationOnce(
        () =>
          Promise.resolve({
            Table: { TableId: tableId, TableStatus: "ACTIVE" },
          }) as never,
      )
      .mockImplementationOnce(() => {
        f.change();
        return Promise.resolve({}) as never;
      });
    await expect(f.history.read(wake.wakeId)).rejects.toThrow(/incarnation/);
  });
  it("refuses retrying management clients before any history operation", async () => {
    const client = new DynamoDBClient({ maxAttempts: 3 }),
      send = vi.spyOn(client, "send");
    const history = new DynamoDbCleanupHistory({
      client,
      table: "cloudmarkup-beta-cleanup-wakes",
      expectedTableId: tableId,
    });
    await expect(history.read(wake.wakeId)).rejects.toThrow(/one SDK attempt/);
    expect(send).not.toHaveBeenCalled();
  });
  it("base-table pages retain completed records and use no secondary index", async () => {
    const f = fixture();
    await f.history.prepare(envelope);
    await f.history.transition(envelope, "prepared", "committed");
    const page = await f.history.page(
      parseInt(cleanupRequired(wake.wakeId[0]), 16) % 4,
    );
    expect(page.records[0]?.state).toBe("committed");
    const query = cleanupRequired(
      f.send.mock.calls.find(([c]) => c instanceof QueryCommand),
    )[0] as QueryCommand;
    expect(query.input.IndexName).toBeUndefined();
  });
});
