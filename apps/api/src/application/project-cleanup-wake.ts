import { createHash } from "node:crypto";
import { z } from "zod";
import {
  cleanupHistoryId,
  parseCleanupHistoryEnvelope,
  confirmCleanupHistory,
  type CleanupAdmissionEnvelope,
  type CleanupHistoryPort,
} from "./project-cleanup-history.js";
import { RepositoryError, type ProjectRecord } from "./persistence.js";

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const bindingSchema = z
  .object({
    schemaVersion: z.literal(1),
    organizationId: identifier,
    projectId: identifier.refine((value) => value !== "organization"),
    recordVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    deletionRequestedAt: z.iso.datetime({ precision: 3 }),
  })
  .strict();
const wakeSchema = bindingSchema
  .extend({ wakeId: z.string().regex(/^[a-f0-9]{64}$/u) })
  .strict();
const admissionBindingSchema = bindingSchema
  .extend({
    schemaVersion: z.literal(2),
    admissionId: z.string().regex(/^[a-f0-9]{64}$/u),
    admissionDeadline: z.iso.datetime({ precision: 3 }),
  })
  .strict();
const admissionWakeSchema = admissionBindingSchema
  .extend({
    wakeId: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export type ProjectCleanupAdmissionWake = z.infer<typeof admissionWakeSchema>;
export type ProjectCleanupWake =
  z.infer<typeof wakeSchema> | ProjectCleanupAdmissionWake;
export function parseProjectCleanupWake(value: unknown): ProjectCleanupWake {
  const parsed = z.union([wakeSchema, admissionWakeSchema]).parse(value);
  const { wakeId, ...binding } = parsed;
  const canonical =
    parsed.schemaVersion === 1
      ? bindingSchema.parse(binding)
      : admissionBindingSchema.parse(binding);
  if (bindingDigest(canonical) !== wakeId)
    throw new Error("The cleanup wake binding is invalid.");
  if (
    parsed.schemaVersion === 2 &&
    parsed.admissionDeadline <= parsed.deletionRequestedAt
  )
    throw new Error("The cleanup admission deadline is invalid.");
  return parsed;
}
function bindingDigest(
  binding:
    z.infer<typeof bindingSchema> | z.infer<typeof admissionBindingSchema>,
): string {
  return createHash("sha256").update(JSON.stringify(binding)).digest("hex");
}
export function projectCleanupAdmissionWake(
  input: Omit<ProjectCleanupAdmissionWake, "wakeId" | "schemaVersion">,
): ProjectCleanupAdmissionWake {
  const binding = admissionBindingSchema.parse({ ...input, schemaVersion: 2 });
  const wake = { ...binding, wakeId: bindingDigest(binding) };
  parseProjectCleanupWake(wake);
  return wake;
}
export function projectCleanupWake(
  project: Pick<
    ProjectRecord,
    | "organizationId"
    | "projectId"
    | "lifecycleStatus"
    | "recordVersion"
    | "deletionRequestedAt"
  >,
): ProjectCleanupWake {
  if (project.lifecycleStatus !== "deletion-pending")
    throw new Error("A cleanup wake requires committed deletion intent.");
  const binding = bindingSchema.parse({
    schemaVersion: 1,
    organizationId: project.organizationId,
    projectId: project.projectId,
    recordVersion: project.recordVersion,
    deletionRequestedAt: project.deletionRequestedAt,
  });
  return { ...binding, wakeId: bindingDigest(binding) };
}
export interface CleanupWakeLedger {
  put(wake: ProjectCleanupWake): Promise<void>;
  get(wakeId: string): Promise<ProjectCleanupWake | null>;
  page(
    shard: number,
    cursor: string | undefined,
  ): Promise<{
    readonly wakes: readonly ProjectCleanupWake[];
    readonly nextCursor?: string;
  }>;
  cursor(shard: number): Promise<string | undefined>;
  advance(shard: number, cursor: string | undefined): Promise<void>;
  claim(wake: ProjectCleanupWake, token: string, now: number): Promise<boolean>;
  release(wake: ProjectCleanupWake, token: string): Promise<void>;
  complete(wake: ProjectCleanupWake, token: string): Promise<void>;
}
export interface CleanupWakePublisher {
  send(wakeId: string): Promise<void>;
}
export interface CleanupWakeAdmissionPorts {
  readonly ledger: Pick<CleanupWakeLedger, "put" | "get">;
  readonly publisher: CleanupWakePublisher;
  readonly history?: CleanupHistoryPort;
}
export interface CleanupWakeAuthority {
  inspect(
    wake: ProjectCleanupWake,
  ): Promise<"pending" | "completed" | "aborted" | "unconfirmed">;
  process(wake: ProjectCleanupWake): Promise<{
    readonly state: "completed" | "pending";
  }>;
}
/** PREPARED SQL metadata authorizes no erasure. Durable exact readback must
 * precede the deletion transaction; commit ambiguity never triggers replay. */
export async function admitProjectDeletionWithCleanupWake(input: {
  readonly prepare: () => Promise<ProjectCleanupAdmissionWake>;
  readonly commit: (
    wake: ProjectCleanupAdmissionWake,
  ) => Promise<ProjectRecord>;
  readonly ledger: Pick<CleanupWakeLedger, "put" | "get">;
  readonly publisher: CleanupWakePublisher;
  readonly history?: CleanupHistoryPort;
  readonly envelope?: (
    wake: ProjectCleanupAdmissionWake,
  ) => Promise<CleanupAdmissionEnvelope>;
}): Promise<ProjectRecord> {
  const wake = await input.prepare();
  if (parseProjectCleanupWake(wake).schemaVersion !== 2)
    throw new Error("A durable cleanup admission is required.");
  let envelope: CleanupAdmissionEnvelope | undefined;
  try {
    if (input.history !== undefined) {
      if (input.envelope === undefined)
        throw Error("History envelope authority is missing.");
      const raw = parseCleanupHistoryEnvelope(await input.envelope(wake));
      if (
        raw.kind !== "admission" ||
        JSON.stringify(raw.wake) !== JSON.stringify(wake)
      )
        throw Error("History envelope mismatch.");
      envelope = raw;
      await input.history.prepare(envelope);
      const record = await input.history.read(cleanupHistoryId(envelope));
      if (
        record === null ||
        JSON.stringify(record.envelope) !== JSON.stringify(envelope) ||
        !["prepared", "committed"].includes(record.state)
      )
        throw Error("Durable preparation is unconfirmed.");
    }
    await input.ledger.put(wake);
    const observed = await input.ledger.get(wake.wakeId);
    if (
      observed === null ||
      JSON.stringify(parseProjectCleanupWake(observed)) !== JSON.stringify(wake)
    )
      throw new Error("Durable cleanup admission is unavailable.");
  } catch {
    // Preserve the existing service_unavailable response; transport payloads
    // and tenant metadata never become public errors.
    throw new RepositoryError(
      "persistence-unavailable",
      "The deletion admission is unavailable.",
    );
  }
  const project = await input.commit(wake);
  if (input.history !== undefined && envelope !== undefined) {
    try {
      await input.history.transition(envelope, "prepared", "committed");
      await confirmCleanupHistory({
        history: input.history,
        envelope,
        state: "committed",
      });
    } catch {
      throw new RepositoryError(
        "persistence-unavailable",
        "The deletion history is unavailable.",
      );
    }
  }
  try {
    await input.publisher.send(wake.wakeId);
  } catch {
    // Retained base-table dispatch recovers a lost kick. No committed result changes.
  }
  return project;
}

/** A deadline only requests locked resolution. Only a committed ABORTED row
 * prevents late admission and authorizes wake removal. */
export function createAdmissionCleanupWakeAuthority(input: {
  readonly resolve: (
    wake: ProjectCleanupAdmissionWake,
  ) => Promise<"prepared" | "committed" | "aborted" | "unconfirmed">;
  readonly cleanup: CleanupWakeAuthority;
}): CleanupWakeAuthority {
  return {
    async inspect(wake) {
      if (wake.schemaVersion === 1) return input.cleanup.inspect(wake);
      const state = await input.resolve(wake);
      if (state === "aborted") return "aborted";
      if (state !== "committed") return "unconfirmed";
      return input.cleanup.inspect(wake);
    },
    async process(wake) {
      if (
        wake.schemaVersion === 2 &&
        (await input.resolve(wake)) !== "committed"
      )
        return { state: "pending" };
      return input.cleanup.process(wake);
    },
  };
}
/** A shadow observer. SQL polling remains the required recovery oracle. */
export function createCleanupWakeNotifier(input: {
  readonly enabled: boolean;
  readonly ledger: CleanupWakeLedger;
  readonly publisher: CleanupWakePublisher;
}) {
  return async (project: ProjectRecord): Promise<void> => {
    if (!input.enabled) return;
    const wake = projectCleanupWake(project);
    await input.ledger.put(wake);
    await input.publisher.send(wake.wakeId);
  };
}
/** Strong base-table pages, all shards each tick; queue failure preserves cursor. */
export function createCleanupWakeDispatcher(input: {
  readonly enabled: boolean;
  readonly ledger: CleanupWakeLedger;
  readonly publisher: CleanupWakePublisher;
}) {
  return async () => {
    if (!input.enabled) return { enabled: false as const, dispatched: 0 };
    let dispatched = 0;
    let failed = false;
    for (let shard = 0; shard < 4; shard += 1) {
      try {
        const page = await input.ledger.page(
          shard,
          await input.ledger.cursor(shard),
        );
        for (const wake of page.wakes) {
          await input.publisher.send(parseProjectCleanupWake(wake).wakeId);
          dispatched += 1;
        }
        await input.ledger.advance(shard, page.nextCursor);
      } catch {
        failed = true; // Preserve this shard's cursor and still visit the others.
      }
    }
    if (failed) throw new Error("Cleanup wake dispatch is incomplete.");
    return { enabled: true as const, dispatched };
  };
}
/** A wake cannot authorize erasure or completion. Existing SQL fences do that. */
export function createCleanupWakeProcessor(input: {
  readonly enabled: boolean;
  readonly ledger: CleanupWakeLedger;
  readonly authority: CleanupWakeAuthority;
  readonly clock: () => number;
  readonly token: () => string;
}) {
  return async (wakeId: string) => {
    if (!input.enabled)
      return { enabled: false as const, state: "disabled" as const };
    const wake = await input.ledger.get(wakeId);
    if (wake === null)
      return { enabled: true as const, state: "missing" as const };
    parseProjectCleanupWake(wake);
    const token = input.token();
    if (!(await input.ledger.claim(wake, token, input.clock())))
      return { enabled: true as const, state: "busy" as const };
    try {
      let authority = await input.authority.inspect(wake);
      if (authority === "pending") {
        await input.authority.process(wake);
        authority = await input.authority.inspect(wake);
      }
      // Process's return value alone never permits removing the durable wake.
      if (authority === "completed" || authority === "aborted") {
        await input.ledger.complete(wake, token);
        return { enabled: true as const, state: authority };
      }
      return { enabled: true as const, state: "pending" as const };
    } finally {
      // Failed release retains the wake and its bounded lease for recovery.
      await input.ledger.release(wake, token);
    }
  };
}
