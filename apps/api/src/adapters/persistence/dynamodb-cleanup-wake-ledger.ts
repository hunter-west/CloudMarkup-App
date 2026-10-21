import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import {
  parseProjectCleanupWake,
  type CleanupWakeLedger,
  type ProjectCleanupWake,
} from "../../application/project-cleanup-wake.js";

function unavailable(): never {
  throw new Error("Cleanup wake storage is unavailable.");
}
function id(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) unavailable();
  return value;
}
function partition(shard: number): string {
  if (!Number.isSafeInteger(shard) || shard < 0 || shard > 3) unavailable();
  return `WAKE#${String(shard)}`;
}
function key(wakeId: string) {
  return {
    PK: { S: partition(Number.parseInt(id(wakeId)[0] ?? "", 16) % 4) },
    SK: { S: wakeId },
  };
}
function decode(item: Record<string, AttributeValue>): ProjectCleanupWake {
  const raw = item["binding"]?.S;
  if (raw === undefined || raw.length > 2_048) unavailable();
  const wake = parseProjectCleanupWake(JSON.parse(raw) as unknown);
  const expected = key(wake.wakeId);
  if (item["PK"]?.S !== expected.PK.S || item["SK"]?.S !== expected.SK.S)
    unavailable();
  return wake;
}
/** Immutable wake rows; no TTL or GSI. Leases never establish deletion authority. */
export class DynamoDbCleanupWakeLedger implements CleanupWakeLedger {
  readonly #client: DynamoDBClient;
  readonly #table: string;
  constructor(input: {
    readonly client: DynamoDBClient;
    readonly table: string;
  }) {
    if (!/^cloudmarkup-beta-cleanup-wakes$/u.test(input.table)) unavailable();
    this.#client = input.client;
    this.#table = input.table;
  }
  async put(input: ProjectCleanupWake): Promise<void> {
    const wake = parseProjectCleanupWake(input);
    try {
      await this.#client.send(
        new PutItemCommand({
          TableName: this.#table,
          Item: { ...key(wake.wakeId), binding: { S: JSON.stringify(wake) } },
          ConditionExpression: "attribute_not_exists(PK)",
        }),
      );
    } catch {
      // A conditional conflict or ambiguous put can only converge through exact
      // strongly consistent readback. Never overwrite another worker's lease.
      const existing = await this.get(wake.wakeId);
      if (
        existing === null ||
        JSON.stringify(existing) !== JSON.stringify(wake)
      )
        unavailable();
    }
  }
  async get(wakeId: string): Promise<ProjectCleanupWake | null> {
    const result = await this.#client.send(
      new GetItemCommand({
        TableName: this.#table,
        Key: key(wakeId),
        ConsistentRead: true,
      }),
    );
    return result.Item === undefined ? null : decode(result.Item);
  }
  async page(shard: number, cursor: string | undefined) {
    const result = await this.#client.send(
      new QueryCommand({
        TableName: this.#table,
        ConsistentRead: true,
        Limit: 25,
        KeyConditionExpression: "PK = :partition",
        ExpressionAttributeValues: { ":partition": { S: partition(shard) } },
        ...(cursor === undefined
          ? {}
          : {
              ExclusiveStartKey: {
                PK: { S: partition(shard) },
                SK: { S: id(cursor) },
              },
            }),
      }),
    );
    const wakes = (result.Items ?? []).map(decode);
    if (wakes.some((wake) => key(wake.wakeId).PK.S !== partition(shard)))
      unavailable();
    const next = result.LastEvaluatedKey;
    if (next !== undefined && next["PK"]?.S !== partition(shard)) unavailable();
    return {
      wakes,
      ...(next === undefined ? {} : { nextCursor: id(next["SK"]?.S ?? "") }),
    };
  }
  async cursor(shard: number): Promise<string | undefined> {
    const result = await this.#client.send(
      new GetItemCommand({
        TableName: this.#table,
        ConsistentRead: true,
        Key: { PK: { S: "CONTROL" }, SK: { S: partition(shard) } },
      }),
    );
    const cursor = result.Item?.["cursor"]?.S;
    return cursor === undefined ? undefined : id(cursor);
  }
  async advance(shard: number, cursor: string | undefined): Promise<void> {
    await this.#client.send(
      new PutItemCommand({
        TableName: this.#table,
        Item: {
          PK: { S: "CONTROL" },
          SK: { S: partition(shard) },
          ...(cursor === undefined ? {} : { cursor: { S: id(cursor) } }),
        },
      }),
    );
  }
  async claim(
    wake: ProjectCleanupWake,
    token: string,
    now: number,
  ): Promise<boolean> {
    if (!/^[a-f0-9]{32}$/u.test(token) || !Number.isSafeInteger(now) || now < 0)
      unavailable();
    try {
      await this.#client.send(
        new UpdateItemCommand({
          TableName: this.#table,
          Key: key(parseProjectCleanupWake(wake).wakeId),
          UpdateExpression: "SET lease_owner = :owner, lease_until = :until",
          ConditionExpression:
            "binding = :binding AND (attribute_not_exists(lease_until) OR lease_until <= :now)",
          ExpressionAttributeValues: {
            ":binding": { S: JSON.stringify(wake) },
            ":owner": { S: token },
            ":now": { N: String(now) },
            ":until": { N: String(now + 300_000) },
          },
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }
  async release(wake: ProjectCleanupWake, token: string): Promise<void> {
    try {
      await this.#client.send(
        new UpdateItemCommand({
          TableName: this.#table,
          Key: key(wake.wakeId),
          UpdateExpression: "REMOVE lease_owner, lease_until",
          ConditionExpression: "binding = :binding AND lease_owner = :owner",
          ExpressionAttributeValues: {
            ":binding": { S: JSON.stringify(wake) },
            ":owner": { S: token },
          },
        }),
      );
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
    }
  }
  async complete(wake: ProjectCleanupWake, token: string): Promise<void> {
    await this.#client.send(
      new DeleteItemCommand({
        TableName: this.#table,
        Key: key(parseProjectCleanupWake(wake).wakeId),
        ConditionExpression: "binding = :binding AND lease_owner = :owner",
        ExpressionAttributeValues: {
          ":binding": { S: JSON.stringify(wake) },
          ":owner": { S: token },
        },
      }),
    );
  }
}
