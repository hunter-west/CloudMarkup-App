import { applyGraphCommand, hashCanonicalValue } from "@cloudmarkup/domain";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import {
  DraftCommandDrain,
  type CommandDraftHead,
  type DraftCommandRecovery,
} from "./draft-command-drain.js";
import {
  createEditorRecoveryBindingV1,
  EDITOR_RECOVERY_MAX_CANONICAL_BYTES,
  prepareEditorRecoverySnapshotV1,
} from "./editor-recovery-envelope.js";

export const DRAFT_COMMAND_RECOVERY_DATABASE =
  "cloudmarkup-draft-command-recovery-v1";
const STORE = "drafts";
const MAX_SCOPES = 32;
interface RecordV1 {
  readonly key: string;
  readonly generation: number;
  readonly digest: string;
  readonly latest: DraftCommandRecovery;
  readonly previous: DraftCommandRecovery | null;
  readonly operationId?: string;
}
interface QuarantineV1 {
  readonly key: string;
  readonly kind: "rejected-command-recovery";
  readonly scopeKey: string;
  readonly record: unknown;
}
interface UnacknowledgedCheckpoint {
  readonly data: DraftCommandRecovery;
  readonly reset: boolean;
  readonly expected: string | null;
  readonly retired: boolean;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fingerprint(value: unknown): string | null {
  return value === undefined ? null : hashCanonicalValue(value);
}
function inspectRecord(raw: unknown, expected?: CommandDraftHead): RecordV1 {
  if (
    !object(raw) ||
    typeof raw["key"] !== "string" ||
    !Number.isSafeInteger(raw["generation"]) ||
    Number(raw["generation"]) < 1 ||
    !object(raw["latest"]) ||
    !object(raw["latest"]["baseline"])
  )
    throw new Error("Invalid command recovery record.");
  const latest = DraftCommandDrain.restore(
    raw["latest"],
    expected ?? (raw["latest"]["baseline"] as unknown as CommandDraftHead),
  ).recovery();
  if (hashCanonicalValue(latest) !== raw["digest"])
    throw new Error("Command recovery integrity mismatch.");
  return raw as unknown as RecordV1;
}
function completed(data: DraftCommandRecovery): boolean {
  return (
    data.pending.length === 0 && data.attempt === null && !data.reviewRequired
  );
}
/** Previous pending work must be exactly accounted for by the completed head.
 * Rejected, uncertain and quarantined records are never capacity victims. */
function retirable(raw: unknown): raw is RecordV1 {
  try {
    const record = inspectRecord(raw);
    if (!completed(record.latest)) return false;
    if (record.previous === null) return true;
    const previous = DraftCommandDrain.restore(
      record.previous,
      record.latest.baseline,
    ).recovery();
    if (previous.reviewRequired) return false;
    if (completed(previous))
      return (
        previous.baseline.draft.version <= record.latest.baseline.draft.version
      );
    return (
      record.latest.baseline.draft.version ===
        previous.baseline.draft.version + previous.pending.length &&
      hashCanonicalValue(previous.document) ===
        hashCanonicalValue(record.latest.document)
    );
  } catch {
    return false;
  }
}

/** Browser recovery, never an authentication source. The key binds the current
 * principal, organization, project and draft. Server authorization is repeated on
 * every replay. Existing snapshot recovery records are not changed or erased. */
export class DraftCommandCheckpoint {
  readonly #key: string;
  readonly #expected: CommandDraftHead;
  readonly #factory: IDBFactory | undefined;
  #db: Promise<IDBDatabase> | null = null;
  #head: string | null = null;
  #loaded = false;
  #checked = false;
  #observed: unknown;
  #invalidated = false;
  #unacknowledged: UnacknowledgedCheckpoint | null = null;
  #tail: Promise<void> = Promise.resolve();
  constructor(
    scope: readonly [string, string, string, string],
    expected: CommandDraftHead,
    factory?: IDBFactory,
  ) {
    this.#key = hashCanonicalValue(scope);
    this.#expected = expected;
    this.#factory = typeof factory?.open === "function" ? factory : undefined;
  }
  get available() {
    return this.#factory !== undefined;
  }
  get previousValid(): DraftCommandRecovery | null {
    if (!object(this.#observed)) return null;
    try {
      return this.#validate(this.#observed["previous"]);
    } catch {
      return null;
    }
  }
  async #open(): Promise<IDBDatabase> {
    if (this.#invalidated)
      throw new Error(
        "Command recovery was cleared or changed in another tab. Reload before editing.",
      );
    const factory = this.#factory;
    if (!factory)
      throw new Error(
        "Command recovery storage is unavailable. Keep this tab open or download the draft.",
      );
    this.#db ??= new Promise((resolve, reject) => {
      const request = factory.open(DRAFT_COMMAND_RECOVERY_DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: "key" });
      };
      request.onerror = () => {
        reject(new Error("Command recovery storage could not open."));
      };
      request.onblocked = () => {
        reject(
          new Error(
            "Another browser version is using command recovery storage.",
          ),
        );
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          this.#invalidated = true;
          request.result.close();
        };
        resolve(request.result);
      };
    });
    return this.#db;
  }
  #validate(raw: unknown): DraftCommandRecovery {
    const data = DraftCommandDrain.restore(raw, this.#expected).recovery();
    if (
      new TextEncoder().encode(serializeCanonicalJson(data)).length >
      EDITOR_RECOVERY_MAX_CANONICAL_BYTES
    )
      throw new Error(
        "The unsaved command checkpoint exceeds the recovery limit. Save or download existing work first.",
      );
    let document = data.baseline.draft.architectureDocument;
    const inspect = () => {
      const binding = createEditorRecoveryBindingV1({
        scopeKey: this.#key,
        seedDocument: document,
      });
      if (!prepareEditorRecoverySnapshotV1(binding, document).ok)
        throw new Error(
          "This command history cannot be safely stored in browser recovery. Download or review the local draft.",
        );
    };
    inspect();
    for (const entry of data.pending) {
      document = applyGraphCommand(document, entry.body.command).document;
      inspect();
    }
    return data;
  }
  async load(): Promise<DraftCommandRecovery | null> {
    if (!this.available) {
      this.#loaded = true;
      this.#checked = true;
      return null;
    }
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly"),
        request = tx.objectStore(STORE).get(this.#key);
      let data: DraftCommandRecovery | null = null,
        raw: unknown,
        head: string | null = null;
      let failure: Error | undefined;
      request.onsuccess = () => {
        raw = request.result as unknown;
        try {
          head = fingerprint(raw);
          if (raw !== undefined) {
            const record = inspectRecord(raw, this.#expected);
            if (record.key !== this.#key)
              throw new Error("Invalid command recovery scope.");
            if (completed(record.latest) && !retirable(record))
              throw new Error(
                "Previous command completion needs review. Retained work was not discarded.",
              );
            data = this.#validate(record.latest);
          }
        } catch (error) {
          failure =
            error instanceof Error
              ? error
              : new Error("Invalid command recovery data.");
        }
      };
      tx.oncomplete = () => {
        this.#observed = raw;
        this.#head = head;
        this.#checked = true;
        this.#loaded = failure === undefined;
        if (failure !== undefined) reject(failure);
        else resolve(data);
      };
      tx.onabort = () => {
        reject(
          new Error(
            "Command recovery could not be read; existing records were retained.",
          ),
        );
      };
      tx.onerror = () => {
        /* The abort handler owns transaction failure. */
      };
    });
  }
  /** Explicit user-confirmed remediation. A prior load, including rejection,
   * binds the exact record to quarantine; another writer is never overwritten. */
  reset(raw: DraftCommandRecovery): Promise<void> {
    return this.#queue(raw, true);
  }
  save(raw: DraftCommandRecovery): Promise<void> {
    return this.#queue(raw, false);
  }
  #queue(raw: DraftCommandRecovery, reset: boolean): Promise<void> {
    const data = this.#validate(raw);
    const next = this.#tail
      .catch(() => {
        /* Permit explicit retry. */
      })
      .then(async () => {
        const prior = this.#unacknowledged;
        if (prior !== null) {
          // Reconcile the original operation, not a newer optimistic snapshot.
          // This preserves its CAS/retry identity even after another edit.
          await this.#write(prior.data, prior.reset, prior);
          if (
            prior.reset === reset &&
            hashCanonicalValue(prior.data) === hashCanonicalValue(data)
          )
            return;
        }
        await this.#write(data, reset);
      });
    this.#tail = next;
    return next;
  }
  async #write(
    data: DraftCommandRecovery,
    reset: boolean,
    retry?: UnacknowledgedCheckpoint,
  ): Promise<void> {
    if (!this.available) return; // Visible memory-only mode; no durability claim.
    if (!(reset ? this.#checked : this.#loaded))
      throw new Error("Command recovery has not been checked yet.");
    const db = await this.#open(),
      digest = hashCanonicalValue(data);
    const expected = retry === undefined ? this.#head : retry.expected;
    const operationId = hashCanonicalValue({
      scope: this.#key,
      expected,
      digest,
      reset,
    });
    let written: unknown = this.#observed;
    let retired = retry?.retired ?? false;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite"),
        store = tx.objectStore(STORE),
        request = store.get(this.#key);
      let failure: Error | undefined;
      const fail = (error: unknown) => {
        failure =
          error instanceof Error
            ? error
            : new Error("Command recovery could not be replaced.");
        tx.abort();
      };
      request.onsuccess = () => {
        try {
          const rawCurrent: unknown = request.result;
          let current: RecordV1 | undefined;
          try {
            if (rawCurrent !== undefined)
              current = inspectRecord(rawCurrent, this.#expected);
          } catch {
            if (!reset)
              throw new Error(
                "The existing command checkpoint is inconsistent. It was retained for recovery.",
              );
          }
          if (
            current?.operationId === operationId &&
            current.digest === digest
          ) {
            written = rawCurrent;
            return;
          }
          // Absence resolves only an initially empty scope or this exact
          // outstanding retirement. It does not authorize a new pending write.
          if (
            !reset &&
            rawCurrent === undefined &&
            completed(data) &&
            (expected === null || retry?.retired === true)
          ) {
            written = undefined;
            return;
          }
          if (fingerprint(rawCurrent) !== expected)
            throw new Error(
              "Another tab changed this draft's recovery checkpoint. Keep local work and review it.",
            );
          if (!reset && current?.digest === digest && !retirable(current)) {
            written = rawCurrent;
            return;
          }
          const generation = (current?.generation ?? 0) + 1;
          if (!Number.isSafeInteger(generation))
            throw new Error(
              "The command recovery generation limit was reached.",
            );
          // Reset keeps the WHOLE original record in quarantine. Its uncertain
          // history must not masquerade as a predecessor of the new server head.
          const previous = reset
            ? null
            : (current?.latest ?? this.previousValid);
          const next: RecordV1 = {
            key: this.#key,
            generation,
            digest,
            latest: data,
            previous,
            operationId,
          };
          if (!reset && retirable(next)) {
            store.delete(this.#key);
            written = undefined;
            retired = true;
            return;
          }
          const archive: QuarantineV1 | null =
            reset && rawCurrent !== undefined
              ? {
                  key: "quarantine:" + this.#key + ":" + String(expected),
                  kind: "rejected-command-recovery",
                  scopeKey: this.#key,
                  record: rawCurrent,
                }
              : null;
          const all = store.getAll();
          all.onsuccess = () => {
            try {
              const records: unknown[] = all.result;
              let count = records.length;
              const needed =
                (rawCurrent === undefined ? 1 : 0) +
                (archive !== null &&
                !records.some(
                  (row) => object(row) && row["key"] === archive.key,
                )
                  ? 1
                  : 0);
              for (const record of records) {
                if (count + needed <= MAX_SCOPES) break;
                if (retirable(record) && record.key !== this.#key) {
                  store.delete(record.key);
                  count--;
                }
              }
              if (count + needed > MAX_SCOPES)
                throw new Error(
                  "Browser command recovery is full. Pending and quarantined drafts were retained. Download recovery before using the confirmed clear action.",
                );
              if (archive !== null) store.put(archive);
              store.put(next);
              written = next;
            } catch (error) {
              fail(error);
            }
          };
        } catch (error) {
          fail(error);
        }
      };
      tx.oncomplete = () => {
        resolve();
      };
      tx.onabort = () => {
        if (failure === undefined)
          this.#unacknowledged = { data, reset, expected, retired };
        reject(
          failure ??
            new Error(
              "The command checkpoint was not acknowledged. Keep local work and retry the same save or reset.",
            ),
        );
      };
      tx.onerror = () => {
        /* Aborts never install a replacement in memory. */
      };
    });
    this.#head = fingerprint(written);
    this.#observed = written;
    this.#loaded = true;
    this.#unacknowledged = null;
  }
  /** User-requested evidence download. Rejected bytes are never replay input. */
  async evidence(): Promise<unknown> {
    if (!this.available)
      return {
        scopeKey: this.#key,
        record: this.#observed ?? null,
        quarantines: [],
        pendingCheckpoint: this.#unacknowledged,
      };
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly"),
        request = tx.objectStore(STORE).getAll();
      let records: unknown[] = [];
      request.onsuccess = () => {
        records = request.result as unknown[];
      };
      tx.oncomplete = () => {
        resolve({
          scopeKey: this.#key,
          record:
            records.find((row) => object(row) && row["key"] === this.#key) ??
            null,
          quarantines: records.filter(
            (row) =>
              object(row) &&
              row["kind"] === "rejected-command-recovery" &&
              row["scopeKey"] === this.#key,
          ),
          pendingCheckpoint: this.#unacknowledged,
        });
      };
      tx.onabort = () => {
        reject(new Error("Recovery evidence could not be read."));
      };
      tx.onerror = () => {
        /* The abort handler owns failure. */
      };
    });
  }
  close() {
    void this.#tail
      .catch(() => {
        /* Failed writes are already surfaced to the caller. */
      })
      .then(async () => {
        (await this.#db)?.close();
      })
      .catch(() => {
        /* A failed database open has no connection to close. */
      });
  }
}
