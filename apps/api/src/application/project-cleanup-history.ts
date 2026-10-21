import { createHash } from "node:crypto";
import { z } from "zod";
import {
  parseProjectCleanupWake,
  type ProjectCleanupAdmissionWake,
  type ProjectCleanupWake,
} from "./project-cleanup-wake.js";
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  sha = z.string().regex(/^[a-f0-9]{64}$/u);
const admission = z
  .object({
    kind: z.literal("admission"),
    wake: z.unknown(),
    principalId: id,
    idempotencyKeySha256: sha,
    requestSha256: sha,
    expectedRecordVersion: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
  .strict();
const legacy = z
  .object({ kind: z.literal("legacy-deletion"), wake: z.unknown() })
  .strict();
const write = z
  .object({
    kind: z.literal("write"),
    writeId: id,
    organizationId: id,
    projectId: id,
    objectId: id,
    contentSha256: sha,
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(64 * 1024 * 1024),
    purpose: id,
    mediaType: z.string().min(1).max(128),
    storageNamespace: id,
    principalId: id,
    recovery: z
      .object({
        jobId: id,
        jobRecordVersion: z.number().int().positive(),
        deletionRecordVersion: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();
export interface CleanupAdmissionEnvelope {
  readonly kind: "admission";
  readonly wake: ProjectCleanupAdmissionWake;
  readonly principalId: string;
  readonly idempotencyKeySha256: string;
  readonly requestSha256: string;
  readonly expectedRecordVersion: number;
}
export type CleanupHistoryEnvelope =
  | CleanupAdmissionEnvelope
  | { readonly kind: "legacy-deletion"; readonly wake: ProjectCleanupWake }
  | z.infer<typeof write>;
export type CleanupHistoryState =
  "prepared" | "issued" | "committed" | "aborted" | "completed";
export interface CleanupHistoryRecord {
  readonly envelope: CleanupHistoryEnvelope;
  readonly state: CleanupHistoryState;
  readonly completion?: {
    readonly objectVersion: string;
    readonly entityTag?: string;
  };
}
export function parseCleanupHistoryEnvelope(
  value: unknown,
): CleanupHistoryEnvelope {
  const parsed = z.union([admission, legacy, write]).parse(value);
  if (parsed.kind === "write") {
    if (
      parsed.projectId === "organization" ||
      (parsed.storageNamespace === "deletion-recovery") !==
        (parsed.recovery !== undefined)
    )
      throw Error("Invalid writer history scope.");
    return {
      ...parsed,
      ...(parsed.recovery === undefined ? {} : { recovery: parsed.recovery }),
    };
  }
  const wake = parseProjectCleanupWake(parsed.wake);
  if (parsed.kind === "legacy-deletion") {
    if (wake.schemaVersion !== 1)
      throw Error("Legacy history must have a canonical v1 binding.");
    return { ...parsed, wake };
  }
  if (
    wake.schemaVersion !== 2 ||
    wake.recordVersion !== parsed.expectedRecordVersion + 1
  )
    throw Error("Invalid deletion history envelope.");
  return { ...parsed, wake };
}
export function cleanupHistoryId(value: CleanupHistoryEnvelope): string {
  const e = parseCleanupHistoryEnvelope(value);
  return e.kind !== "write"
    ? e.wake.wakeId
    : createHash("sha256").update(JSON.stringify(e)).digest("hex");
}
export function parseCleanupHistoryRecord(
  value: unknown,
): CleanupHistoryRecord {
  const parsed = z
    .object({
      envelope: z.unknown(),
      state: z.enum([
        "prepared",
        "issued",
        "committed",
        "aborted",
        "completed",
      ]),
      completion: z
        .object({
          objectVersion: z.string().min(1).max(1024),
          entityTag: z.string().max(1024).optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .parse(value);
  const envelope = parseCleanupHistoryEnvelope(parsed.envelope);
  if (
    envelope.kind !== "write"
      ? !["prepared", "committed", "aborted"].includes(parsed.state)
      : !["prepared", "issued", "completed", "aborted"].includes(parsed.state)
  )
    throw Error("Invalid cleanup history state.");
  if ((parsed.state === "completed") !== (parsed.completion !== undefined))
    throw Error("Invalid completion proof.");
  return {
    envelope,
    state: parsed.state,
    ...(parsed.completion === undefined
      ? {}
      : {
          completion: {
            objectVersion: parsed.completion.objectVersion,
            ...(parsed.completion.entityTag === undefined
              ? {}
              : { entityTag: parsed.completion.entityTag }),
          },
        }),
  };
}
/** All rows are retained, including completed wakes and aborted preparations.
 * No TTL, erase method, timestamp shortcut or SQL-restored state is authority. */
export interface CleanupHistoryPort {
  prepare(envelope: CleanupHistoryEnvelope): Promise<void>;
  read(id: string): Promise<CleanupHistoryRecord | null>;
  transition(
    envelope: CleanupHistoryEnvelope,
    from: "prepared" | "issued",
    to: "issued" | "committed" | "aborted" | "completed",
    completion?: CleanupHistoryRecord["completion"],
  ): Promise<void>;
  page(
    shard: number,
    cursor?: string,
  ): Promise<{
    readonly records: readonly CleanupHistoryRecord[];
    readonly nextCursor?: string;
  }>;
}
export async function confirmCleanupHistory(input: {
  history: CleanupHistoryPort;
  envelope: CleanupHistoryEnvelope;
  state: CleanupHistoryState;
}): Promise<void> {
  const record = await input.history.read(cleanupHistoryId(input.envelope));
  if (
    record === null ||
    JSON.stringify(parseCleanupHistoryEnvelope(record.envelope)) !==
      JSON.stringify(parseCleanupHistoryEnvelope(input.envelope)) ||
    record.state !== input.state
  )
    throw Error("Durable cleanup history is unconfirmed.");
}
/** Full bounded retained-history enumeration for a frozen restore/cutover. An
 * overflow or repeated cursor gives no proof. Runtime dispatch never runs this. */
export async function readCompleteCleanupHistory(
  history: CleanupHistoryPort,
  maximum = 1000,
): Promise<readonly CleanupHistoryRecord[]> {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 10000)
    throw Error("Invalid history bound.");
  const records: CleanupHistoryRecord[] = [],
    ids = new Set<string>();
  for (let shard = 0; shard < 4; shard++) {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const page = await history.page(shard, cursor);
      for (const raw of page.records) {
        const r = parseCleanupHistoryRecord(raw),
          id = cleanupHistoryId(r.envelope);
        if (ids.has(id)) throw Error("Duplicate restore history.");
        ids.add(id);
        records.push(r);
        if (records.length > maximum)
          throw Error("Restore inventory exceeds its proof bound.");
      }
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (cursors.has(cursor)) throw Error("History cursor did not advance.");
        cursors.add(cursor);
      }
    } while (cursor !== undefined);
  }
  return Object.freeze(records);
}
