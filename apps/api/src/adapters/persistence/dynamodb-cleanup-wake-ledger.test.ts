import {
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  type DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { describe, expect, it, vi } from "vitest";
import {
  projectCleanupWake,
  projectCleanupAdmissionWake,
} from "../../application/project-cleanup-wake.js";
import { DynamoDbCleanupWakeLedger } from "./dynamodb-cleanup-wake-ledger.js";
const wake = projectCleanupWake({
  organizationId: "org_test",
  projectId: "project_test",
  recordVersion: 2,
  lifecycleStatus: "deletion-pending",
  deletionRequestedAt: "2026-10-02T00:00:00.000Z",
});
const shard = Number.parseInt(wake.wakeId[0] ?? "", 16) % 4;
const item = {
  PK: { S: `WAKE#${String(shard)}` },
  SK: { S: wake.wakeId },
  binding: { S: JSON.stringify(wake) },
};
function fixture() {
  const send = vi
    .fn<(command: unknown) => Promise<unknown>>()
    .mockResolvedValue({});
  return {
    send,
    ledger: new DynamoDbCleanupWakeLedger({
      client: { send } as unknown as DynamoDBClient,
      table: "cloudmarkup-beta-cleanup-wakes",
    }),
  };
}
describe("DynamoDB retained cleanup wake adapter", () => {
  it("retains version-two admission binding exactly and reads it strongly", async () => {
    const f = fixture();
    const admission = projectCleanupAdmissionWake({
      organizationId: "org_test",
      projectId: "project_test",
      recordVersion: 2,
      deletionRequestedAt: "2026-10-03T00:00:00.000Z",
      admissionDeadline: "2026-10-03T00:01:00.000Z",
      admissionId: "c".repeat(64),
    });
    await f.ledger.put(admission);
    const put = f.send.mock.calls[0]?.[0];
    expect(put).toBeInstanceOf(PutItemCommand);
    if (!(put instanceof PutItemCommand)) throw Error("Expected durable put");
    expect(put.input.ConditionExpression).toBe("attribute_not_exists(PK)");
    expect(put.input.Item?.["binding"]?.S).toBe(JSON.stringify(admission));
    f.send.mockResolvedValueOnce({ Item: put.input.Item });
    expect(await f.ledger.get(admission.wakeId)).toEqual(admission);
    const get = f.send.mock.calls[1]?.[0];
    expect(get).toBeInstanceOf(GetItemCommand);
    if (!(get instanceof GetItemCommand))
      throw Error("Expected durable readback");
    expect(get.input.ConsistentRead).toBe(true);
  });
  it("only accepts the fixed beta ledger and validated bindings", async () => {
    const f = fixture();
    expect(
      () =>
        new DynamoDbCleanupWakeLedger({
          client: { send: f.send } as unknown as DynamoDBClient,
          table: "another-table",
        }),
    ).toThrow();
    await expect(f.ledger.put({ ...wake, recordVersion: 3 })).rejects.toThrow();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("uses conditional immutable puts and converges an ambiguous success through strong readback", async () => {
    const f = fixture();
    f.send
      .mockRejectedValueOnce(Error("Lost response"))
      .mockResolvedValueOnce({ Item: item });
    await f.ledger.put(wake);
    const put = f.send.mock.calls[0]?.[0] as PutItemCommand;
    const get = f.send.mock.calls[1]?.[0] as GetItemCommand;
    expect(put).toBeInstanceOf(PutItemCommand);
    expect(put.input.ConditionExpression).toBe("attribute_not_exists(PK)");
    expect(put.input.Item).toEqual(item);
    expect(get.input.ConsistentRead).toBe(true);
    expect(JSON.stringify(put.input)).not.toMatch(/ttl|expires/iu);
  });
  it("never reports failed or mismatched publication as durable", async () => {
    const f = fixture();
    f.send
      .mockRejectedValueOnce(Error("Unavailable"))
      .mockResolvedValueOnce({});
    await expect(f.ledger.put(wake)).rejects.toThrow();
    f.send.mockResolvedValueOnce({
      Item: { ...item, PK: { S: "WAKE#wrong" } },
    });
    await expect(f.ledger.get(wake.wakeId)).rejects.toThrow();
  });
  it("queries the base table strongly with a full cursor and finite page", async () => {
    const f = fixture();
    f.send.mockResolvedValueOnce({
      Items: [item],
      LastEvaluatedKey: { PK: item.PK, SK: item.SK },
    });
    expect(await f.ledger.page(shard, wake.wakeId)).toEqual({
      wakes: [wake],
      nextCursor: wake.wakeId,
    });
    const command = f.send.mock.calls[0]?.[0] as QueryCommand;
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input).toMatchObject({
      ConsistentRead: true,
      Limit: 25,
      ExclusiveStartKey: { PK: item.PK, SK: item.SK },
    });
    expect(command.input).not.toHaveProperty("IndexName");
    expect(command.input).not.toHaveProperty("FilterExpression");
  });
  it("cannot confuse a conditional lease conflict with a transport outage", async () => {
    const f = fixture();
    f.send.mockRejectedValueOnce(
      new ConditionalCheckFailedException({ message: "Busy", $metadata: {} }),
    );
    expect(await f.ledger.claim(wake, "a".repeat(32), 10)).toBe(false);
    f.send.mockRejectedValueOnce(Error("Unavailable"));
    await expect(f.ledger.claim(wake, "a".repeat(32), 10)).rejects.toThrow();
  });
  it("bounds advisory leases and conditionally deletes only the exact token and binding", async () => {
    const f = fixture();
    await f.ledger.claim(wake, "a".repeat(32), 10);
    await f.ledger.complete(wake, "a".repeat(32));
    const claim = f.send.mock.calls[0]?.[0] as UpdateItemCommand;
    const complete = f.send.mock.calls[1]?.[0] as DeleteItemCommand;
    expect(claim.input.ExpressionAttributeValues?.[":until"]).toEqual({
      N: "300010",
    });
    expect(complete.input.ConditionExpression).toBe(
      "binding = :binding AND lease_owner = :owner",
    );
    expect(complete.input.ExpressionAttributeValues?.[":binding"]).toEqual({
      S: JSON.stringify(wake),
    });
  });
});
