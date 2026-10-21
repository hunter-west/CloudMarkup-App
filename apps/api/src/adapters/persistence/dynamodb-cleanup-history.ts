import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  QueryCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";
import {
  cleanupHistoryId,
  parseCleanupHistoryEnvelope,
  parseCleanupHistoryRecord,
  type CleanupHistoryEnvelope,
  type CleanupHistoryPort,
  type CleanupHistoryRecord,
} from "../../application/project-cleanup-history.js";
import { cleanupRequired } from "./cleanup-required.js";
const shard = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 0 || n > 3)
    throw Error("Invalid history shard.");
  return `HISTORY#${String(n)}`;
};
const key = (id: string) => {
  if (!/^[a-f0-9]{64}$/u.test(id)) throw Error("Invalid history ID.");
  return {
    PK: { S: shard(parseInt(cleanupRequired(id[0]), 16) % 4) },
    SK: { S: id },
  };
};
export class DynamoDbCleanupHistory implements CleanupHistoryPort {
  readonly client: DynamoDBClient;
  readonly table: string;
  readonly expectedTableId: string;
  constructor(input: {
    client: DynamoDBClient;
    table: string;
    expectedTableId: string;
  }) {
    if (input.table !== "cloudmarkup-beta-cleanup-wakes")
      throw Error("Invalid history table.");
    if (!/^[a-f0-9-]{36}$/u.test(input.expectedTableId))
      throw Error("History table incarnation is required.");
    this.client = input.client;
    this.table = input.table;
    this.expectedTableId = input.expectedTableId;
  }
  async assertIncarnation() {
    if ((await this.client.config.maxAttempts()) !== 1)
      throw Error("History identity requires one SDK attempt.");
    const r = await this.client.send(
      new DescribeTableCommand({ TableName: this.table }),
    );
    if (
      r.Table?.TableId !== this.expectedTableId ||
      r.Table.TableStatus !== "ACTIVE"
    )
      throw Error(
        "Cleanup history incarnation changed; restore is quarantined.",
      );
  }
  async prepare(raw: CleanupHistoryEnvelope) {
    await this.assertIncarnation();
    const envelope = parseCleanupHistoryEnvelope(raw),
      id = cleanupHistoryId(envelope);
    try {
      await this.client.send(
        new PutItemCommand({
          TableName: this.table,
          Item: {
            ...key(id),
            envelope: { S: JSON.stringify(envelope) },
            state: { S: "prepared" },
          },
          ConditionExpression: "attribute_not_exists(PK)",
        }),
      );
    } catch {
      const current = await this.read(id);
      if (
        current === null ||
        JSON.stringify(current.envelope) !== JSON.stringify(envelope)
      )
        throw Error("Immutable cleanup history conflicts.");
    }
    await this.assertIncarnation();
  }
  async read(id: string) {
    await this.assertIncarnation();
    const r = await this.client.send(
      new GetItemCommand({
        TableName: this.table,
        Key: key(id),
        ConsistentRead: true,
      }),
    );
    await this.assertIncarnation();
    if (r.Item === undefined) return null;
    return this.decode(r.Item);
  }
  decode(
    item: Record<string, import("@aws-sdk/client-dynamodb").AttributeValue>,
  ): CleanupHistoryRecord {
    const raw = item["envelope"]?.S;
    if (raw === undefined || raw.length > 8192)
      throw Error("Invalid history envelope.");
    const record = parseCleanupHistoryRecord({
      envelope: JSON.parse(raw) as unknown,
      state: item["state"]?.S,
      ...(item["completion"]?.S === undefined
        ? {}
        : { completion: JSON.parse(item["completion"].S) as unknown }),
    });
    const k = key(cleanupHistoryId(record.envelope));
    if (item["PK"]?.S !== k.PK.S || item["SK"]?.S !== k.SK.S)
      throw Error("Invalid history binding.");
    return record;
  }
  async transition(
    raw: CleanupHistoryEnvelope,
    from: "prepared" | "issued",
    to: "issued" | "committed" | "aborted" | "completed",
    completion?: CleanupHistoryRecord["completion"],
  ) {
    await this.assertIncarnation();
    const envelope = parseCleanupHistoryEnvelope(raw),
      target = parseCleanupHistoryRecord({
        envelope,
        state: to,
        ...(completion === undefined ? {} : { completion }),
      });
    if (
      envelope.kind !== "write"
        ? from !== "prepared" || !["committed", "aborted"].includes(to)
        : !(
            (from === "prepared" && ["issued", "aborted"].includes(to)) ||
            (from === "issued" && to === "completed")
          )
    )
      throw Error("History transition cannot weaken a hold.");
    try {
      await this.client.send(
        new UpdateItemCommand({
          TableName: this.table,
          Key: key(cleanupHistoryId(envelope)),
          ConditionExpression: "envelope=:envelope AND #state=:from",
          UpdateExpression:
            completion === undefined
              ? "SET #state=:to"
              : "SET #state=:to,completion=:completion",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: {
            ":envelope": { S: JSON.stringify(envelope) },
            ":from": { S: from },
            ":to": { S: to },
            ...(completion === undefined
              ? {}
              : { ":completion": { S: JSON.stringify(completion) } }),
          },
        }),
      );
    } catch {
      const current = await this.read(cleanupHistoryId(envelope));
      if (JSON.stringify(current) !== JSON.stringify(target))
        throw Error("History outcome is unconfirmed.");
    }
    await this.assertIncarnation();
  }
  async page(n: number, cursor?: string) {
    await this.assertIncarnation();
    const pk = shard(n);
    if (cursor !== undefined && !/^[a-f0-9]{64}$/u.test(cursor))
      throw Error("Invalid history cursor.");
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        ConsistentRead: true,
        Limit: 25,
        KeyConditionExpression: "PK=:pk",
        ExpressionAttributeValues: { ":pk": { S: pk } },
        ...(cursor === undefined
          ? {}
          : { ExclusiveStartKey: { PK: { S: pk }, SK: { S: cursor } } }),
      }),
    );
    const records = (result.Items ?? []).map((r) => this.decode(r));
    if (records.some((r) => key(cleanupHistoryId(r.envelope)).PK.S !== pk))
      throw Error("History shard mismatch.");
    const next = result.LastEvaluatedKey;
    if (
      next !== undefined &&
      (next["PK"]?.S !== pk || !/^[a-f0-9]{64}$/u.test(next["SK"]?.S ?? ""))
    )
      throw Error("History cursor mismatch.");
    await this.assertIncarnation();
    return {
      records,
      ...(next === undefined
        ? {}
        : { nextCursor: cleanupRequired(next["SK"]?.S) }),
    };
  }
}
