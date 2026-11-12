import { createHash } from "node:crypto";

/** Bounded existing-owner protocol. Ports are trusted composition boundaries,
 * not authentication of request JSON. No schedule or deletion is activated. */
export interface CleanupIdentity {
  readonly organizationId: string;
  readonly reservationId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly purpose: "proposal" | "application-source";
  readonly requestSha256: string;
}
export interface CleanupOutcome extends CleanupIdentity {
  readonly financial: "released" | "pending" | "conflict";
  readonly cleanup: "complete" | "pending";
  readonly accounting: "known" | "not-incurred" | "unresolved" | "conflict";
}
export interface CleanupPage {
  readonly identities: readonly CleanupIdentity[];
  readonly nextCursor: string | null;
}
export interface CleanupCheckpoint {
  readonly organizationId: string;
  readonly restoreEpoch: string;
  readonly generation: string;
  readonly sweep: string;
  readonly cursor: string | null;
  readonly pending: (CleanupPage & { readonly pageId: string }) | null;
}
export interface CleanupChange {
  readonly organizationId: string;
  readonly operationId: string;
  readonly payloadSha256: string;
  readonly expectedGeneration: string;
  readonly kind: "prepare" | "complete";
  readonly next: CleanupCheckpoint;
  readonly outcomes: readonly CleanupOutcome[];
}
export interface CleanupReceipt {
  readonly organizationId: string;
  readonly operationId: string;
  readonly payloadSha256: string;
  readonly checkpoint: CleanupCheckpoint;
  /** Assigned by the durable store only when it atomically verifies the exact
   * completion and outcomes. Pending/unknown/conflict results MUST be null. */
  readonly verifiedCompletedAt: string | null;
}
export interface CleanupCheckpointStore {
  /** Trusted store admission, NOT caller configuration. Restore must rotate the
   * epoch and block resumption until checkpoints/receipts/evidence are reconciled.
   * Existing holds remain independently owned; this protocol cannot clear them. */
  load(organizationId: string): Promise<{
    readonly organizationId: string;
    readonly restoreEpoch: string;
    readonly resumeAllowed: boolean;
    readonly retentionHolds: readonly string[];
    readonly checkpoint: CleanupCheckpoint | null;
  }>;
  /** CAS + immutable operation receipt + all outcomes in ONE transaction.
   * Matching replay returns the original receipt; conflicting replay fails.
   * Hold/dependency and restore-fence state must survive every update. Check
   * the expected epoch and admission IN the same transaction as the CAS. */
  commit(change: CleanupChange): Promise<CleanupReceipt>;
  receipt(
    organizationId: string,
    operationId: string,
  ): Promise<CleanupReceipt | null>;
}
export interface CleanupMeter {
  /** Future meter split: same released-only keyset predicate, at most 25 rows,
   * NO release/cleanup until this exact selection is durably checkpointed. */
  select(organizationId: string, cursor: string | null): Promise<CleanupPage>;
  /** Exact canonical existing release/replay; never a provider dispatch. Must
   * reauthorize its SQL boundary, and must not infer terminal identity from
   * status alone. No new charges/refunds or payload/idempotency changes. */
  reconcile(identity: CleanupIdentity): Promise<CleanupOutcome>;
}
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const reservation = /^beta-ai\.[a-f0-9]{64}$/u;
const version = /^(0|[1-9][0-9]*)$/u;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const nextVersion = (value: string) => (BigInt(value) + 1n).toString();
function checkedIdentity(
  value: CleanupIdentity,
  organizationId: string,
): CleanupIdentity {
  if (
    value.organizationId !== organizationId ||
    !id.test(value.projectId) ||
    !id.test(value.jobId) ||
    !["proposal", "application-source"].includes(value.purpose) ||
    !/^[a-f0-9]{64}$/u.test(value.requestSha256) ||
    value.reservationId !==
      "beta-ai." +
        createHash("sha256")
          .update([organizationId, value.purpose, value.jobId].join("\0"))
          .digest("hex")
  )
    throw Error("Cleanup invocation identity conflicts.");
  return Object.freeze({
    organizationId,
    reservationId: value.reservationId,
    projectId: value.projectId,
    jobId: value.jobId,
    purpose: value.purpose,
    requestSha256: value.requestSha256,
  });
}
function checkedPage(
  value: CleanupPage,
  organizationId: string,
  cursor: string | null,
): CleanupPage {
  if (value.identities.length > 25)
    throw Error("Cleanup page exceeds its bound.");
  const identities = value.identities.map((item) =>
    checkedIdentity(item, organizationId),
  );
  let previous = cursor ?? "";
  for (const item of identities) {
    if (item.reservationId <= previous)
      throw Error("Cleanup page order conflicts.");
    previous = item.reservationId;
  }
  const nextCursor =
    identities.length === 25
      ? (identities.at(-1)?.reservationId ?? null)
      : null;
  if (nextCursor !== value.nextCursor) throw Error("Cleanup cursor conflicts.");
  return Object.freeze({ identities: Object.freeze(identities), nextCursor });
}
export function checkpoint(
  value: CleanupCheckpoint | null,
  organizationId: string,
  restoreEpoch: string,
): CleanupCheckpoint {
  if (value === null)
    return {
      organizationId,
      restoreEpoch,
      generation: "0",
      sweep: "0",
      cursor: null,
      pending: null,
    };
  if (
    value.organizationId !== organizationId ||
    value.restoreEpoch !== restoreEpoch ||
    !version.test(value.generation) ||
    !version.test(value.sweep) ||
    (value.cursor !== null && !reservation.test(value.cursor))
  )
    throw Error("Cleanup checkpoint scope conflicts.");
  const pending =
    value.pending === null
      ? null
      : {
          ...checkedPage(value.pending, organizationId, value.cursor),
          pageId: value.pending.pageId,
        };
  if (pending !== null && !/^[a-f0-9]{64}$/u.test(pending.pageId))
    throw Error("Cleanup page identity conflicts.");
  return Object.freeze({
    organizationId,
    restoreEpoch,
    generation: value.generation,
    sweep: value.sweep,
    cursor: value.cursor,
    pending,
  });
}
async function load(
  store: CleanupCheckpointStore,
  organizationId: string,
  expectedEpoch?: string,
) {
  const state = await store.load(organizationId);
  if (
    state.organizationId !== organizationId ||
    !state.resumeAllowed ||
    !id.test(state.restoreEpoch) ||
    (expectedEpoch !== undefined && expectedEpoch !== state.restoreEpoch)
  )
    throw Error("Cleanup restore admission is required.");
  return checkpoint(state.checkpoint, organizationId, state.restoreEpoch);
}
export function change(
  kind: CleanupChange["kind"],
  current: CleanupCheckpoint,
  next: CleanupCheckpoint,
  outcomes: readonly CleanupOutcome[],
): CleanupChange {
  const body = {
    organizationId: current.organizationId,
    expectedGeneration: current.generation,
    kind,
    next,
    outcomes,
  };
  return Object.freeze({
    ...body,
    operationId: digest({
      organizationId: current.organizationId,
      restoreEpoch: current.restoreEpoch,
      generation: current.generation,
      kind,
    }),
    payloadSha256: digest(body),
  });
}
function checkedReceipt(
  value: CleanupReceipt | null,
  expected: CleanupChange,
): CleanupReceipt | null {
  if (value === null) return null;
  if (
    value.organizationId !== expected.organizationId ||
    value.operationId !== expected.operationId ||
    value.payloadSha256 !== expected.payloadSha256 ||
    !same(
      checkpoint(
        value.checkpoint,
        expected.organizationId,
        expected.next.restoreEpoch,
      ),
      checkpoint(
        expected.next,
        expected.organizationId,
        expected.next.restoreEpoch,
      ),
    ) ||
    (value.verifiedCompletedAt !== null &&
      (expected.kind !== "complete" ||
        !Number.isFinite(Date.parse(value.verifiedCompletedAt))))
  )
    throw Error("Cleanup acknowledgement conflicts.");
  return value;
}
export class CleanupCheckpointPending extends Error {
  readonly change: CleanupChange;
  constructor(value: CleanupChange) {
    super(
      "Cleanup checkpoint acknowledgement remains uncertain; retained page must be resumed.",
    );
    this.change = value;
  }
}
async function persist(
  store: CleanupCheckpointStore,
  value: CleanupChange,
): Promise<CleanupReceipt> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await load(store, value.organizationId, value.next.restoreEpoch);
    let response: CleanupReceipt | null | undefined;
    try {
      response = await store.commit(value);
    } catch {
      /* The same operation may have committed. Read its exact receipt. */
    }
    if (response === undefined) {
      try {
        response = await store.receipt(value.organizationId, value.operationId);
      } catch {
        continue;
      }
    }
    const receipt = checkedReceipt(response, value);
    if (receipt !== null) {
      // A matching old receipt does not unpause or authorize a restored store.
      await load(store, value.organizationId, value.next.restoreEpoch);
      return receipt;
    }
  }
  throw new CleanupCheckpointPending(value);
}

/** One bounded request-owner step. A caller supplies the EXISTING canonical
 * organization authorizer (not client JSON). No endpoint, job or schedule.
 * The store independently verifies canonical evidence; optimistic outcomes
 * never establish completion or authorize retirement. */
export async function runAuthorizedCleanupPage(options: {
  readonly authorize: () => Promise<{ readonly organizationId: string }>;
  readonly checkpoints: CleanupCheckpointStore;
  readonly meter: CleanupMeter;
}) {
  const scope = await options.authorize();
  const organizationId = scope.organizationId;
  if (!id.test(organizationId)) throw Error("Cleanup organization is invalid.");
  const authorize = async () => {
    if ((await options.authorize()).organizationId !== organizationId)
      throw Error("Cleanup authority changed.");
  };
  let current = await load(options.checkpoints, organizationId);
  if (current.pending === null) {
    await authorize();
    const page = checkedPage(
      await options.meter.select(organizationId, current.cursor),
      organizationId,
      current.cursor,
    );
    // An already-empty sweep has no work or detail history to persist. A final
    // empty page after a non-null cursor still durably restarts that sweep.
    if (page.identities.length === 0 && current.cursor === null)
      return { receipt: null, outcomes: [], sweepFinished: true };
    const pending = {
      ...page,
      pageId: digest({
        organizationId,
        sweep: current.sweep,
        cursor: current.cursor,
        page,
      }),
    };
    const next = {
      ...current,
      generation: nextVersion(current.generation),
      pending,
    };
    await authorize();
    current = (
      await persist(options.checkpoints, change("prepare", current, next, []))
    ).checkpoint;
  }
  const page = current.pending;
  if (page === null) throw Error("A durable selected page is required.");
  const outcomes: CleanupOutcome[] = [];
  for (const identity of page.identities) {
    // Revocation prevents further work; the exact pending page remains durable.
    await authorize();
    await load(options.checkpoints, organizationId, current.restoreEpoch);
    let result: CleanupOutcome;
    try {
      result = await options.meter.reconcile(identity);
      if (
        !same(checkedIdentity(result, organizationId), identity) ||
        !["released", "pending", "conflict"].includes(result.financial) ||
        !["complete", "pending"].includes(result.cleanup) ||
        !["known", "not-incurred", "unresolved", "conflict"].includes(
          result.accounting,
        )
      )
        result = {
          ...identity,
          financial: "conflict",
          cleanup: "pending",
          accounting: "conflict",
        };
    } catch {
      // Record the selected identity without leaking arbitrary errors or
      // claiming zero usage. This row does not prevent scanning later rows.
      result = {
        ...identity,
        financial: "pending",
        cleanup: "pending",
        accounting: "unresolved",
      };
    }
    outcomes.push(
      Object.freeze({
        ...identity,
        financial: result.financial,
        cleanup: result.cleanup,
        accounting: result.accounting,
      }),
    );
  }
  const next = {
    ...current,
    generation: nextVersion(current.generation),
    pending: null,
    cursor: page.nextCursor,
    sweep:
      page.nextCursor === null ? nextVersion(current.sweep) : current.sweep,
  };
  await authorize();
  const receipt = await persist(
    options.checkpoints,
    change("complete", current, next, outcomes),
  );
  return { receipt, outcomes, sweepFinished: page.nextCursor === null };
}
