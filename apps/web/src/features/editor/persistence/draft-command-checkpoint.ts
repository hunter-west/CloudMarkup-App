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

const DATABASE = "cloudmarkup-draft-command-recovery-v1";
const STORE = "drafts";
const MAX_SCOPES = 32;
interface RecordV1 {
  readonly key: string;
  readonly generation: number;
  readonly digest: string;
  readonly latest: DraftCommandRecovery;
  readonly previous: DraftCommandRecovery | null;
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
  async #open(): Promise<IDBDatabase> {
    const factory = this.#factory;
    if (!factory)
      throw new Error(
        "Command recovery storage is unavailable. Keep this tab open or download the draft.",
      );
    this.#db ??= new Promise((resolve, reject) => {
      const request = factory.open(DATABASE, 1);
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
      return null;
    }
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly"),
        request = tx.objectStore(STORE).get(this.#key);
      let data: DraftCommandRecovery | null = null;
      let digest: string | null = null;
      request.onsuccess = () => {
        try {
          const record = request.result as RecordV1 | undefined;
          if (record) {
            if (
              record.key !== this.#key ||
              !Number.isSafeInteger(record.generation) ||
              record.generation < 1
            )
              throw new Error("Invalid command recovery record.");
            data = this.#validate(record.latest);
            digest = hashCanonicalValue(data);
            if (digest !== record.digest)
              throw new Error("Command recovery integrity mismatch.");
          }
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error("Invalid command recovery data."),
          );
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        this.#head = digest;
        this.#loaded = true;
        resolve(data);
      };
      tx.onabort = () => {
        reject(
          new Error(
            "Command recovery could not be read; existing records were retained.",
          ),
        );
      };
      tx.onerror = () => {
        /* The abort handler owns the transaction failure. */
      };
    });
  }
  save(raw: DraftCommandRecovery): Promise<void> {
    const data = this.#validate(raw);
    const next = this.#tail
      .catch(() => {
        /* A failed write must permit explicit retry. */
      })
      .then(() => this.#write(data));
    this.#tail = next;
    return next;
  }
  async #write(data: DraftCommandRecovery): Promise<void> {
    if (!this.available) return; // Explicitly visible memory-only mode; no false durability claim.
    if (!this.#loaded)
      throw new Error("Command recovery has not been checked yet.");
    const db = await this.#open(),
      digest = hashCanonicalValue(data);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite"),
        store = tx.objectStore(STORE),
        request = store.get(this.#key);
      let failure: Error | undefined;
      const fail = (message: string) => {
        failure = new Error(message);
        tx.abort();
      };
      request.onsuccess = () => {
        const current = request.result as RecordV1 | undefined;
        if (
          current &&
          (current.key !== this.#key ||
            !Number.isSafeInteger(current.generation) ||
            current.generation < 1 ||
            hashCanonicalValue(current.latest) !== current.digest)
        ) {
          fail(
            "The existing command checkpoint is inconsistent. It was retained for recovery.",
          );
          return;
        }
        // Resolves a committed write with a lost acknowledgement without replacing another writer.
        if (current?.digest === digest) return;
        if ((current?.digest ?? null) !== this.#head) {
          fail(
            "Another tab changed this draft's recovery checkpoint. Keep local work and review it.",
          );
          return;
        }
        const put = () =>
          store.put({
            key: this.#key,
            generation: (current?.generation ?? 0) + 1,
            digest,
            latest: data,
            previous: current?.latest ?? null,
          } satisfies RecordV1);
        if (current) put();
        else {
          const count = store.count();
          count.onsuccess = () => {
            if (count.result >= MAX_SCOPES)
              fail(
                "Browser command recovery is full. Existing drafts were retained.",
              );
            else put();
          };
        }
      };
      tx.oncomplete = () => {
        this.#head = digest;
        resolve();
      };
      tx.onabort = () => {
        reject(
          failure ??
            new Error(
              "The command checkpoint was not acknowledged. Keep local work and retry the same save.",
            ),
        );
      };
      tx.onerror = () => {
        /* The abort handler reports acknowledgement uncertainty. */
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
