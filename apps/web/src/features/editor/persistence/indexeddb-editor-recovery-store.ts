import type { Sha256Digest } from "@cloudmarkup/schemas";

import {
  createEditorRecoveryEnvelopeV1,
  inspectEditorRecoveryEnvelopeV1,
  prepareEditorRecoverySnapshotV1,
} from "./editor-recovery-envelope.js";
import {
  EDITOR_RECOVERY_STORE_CONTRACT_VERSION,
  type EditorRecoveryBindingV1,
  type EditorRecoveryCheckpointRequest,
  type EditorRecoveryCheckpointResult,
  type EditorRecoveryDiagnosticClassification,
  type EditorRecoveryDiagnosticV1,
  type EditorRecoveryDiscardRequest,
  type EditorRecoveryDiscardResult,
  type EditorRecoveryHead,
  type EditorRecoveryHeadNotice,
  type EditorRecoveryLoadResult,
  type EditorRecoveryReady,
  type EditorRecoveryRejected,
  type EditorRecoveryRejectedRemediationRequest,
  type EditorRecoveryRejectedRemediationResult,
  type EditorRecoveryStoreV1,
  type EditorRecoveryUnavailable,
} from "./editor-recovery-store.js";

export const EDITOR_RECOVERY_INDEXED_DB_NAME =
  "cloudmarkup-editor-recovery-v1" as const;
export const EDITOR_RECOVERY_INDEXED_DB_VERSION = 1 as const;
export const EDITOR_RECOVERY_INDEXED_DB_STORE_NAME = "recovery-scopes" as const;
export const EDITOR_RECOVERY_BROADCAST_CHANNEL_NAME =
  "cloudmarkup-editor-recovery-head-v1" as const;
export const EDITOR_RECOVERY_MAXIMUM_SCOPES = 32 as const;

const STORED_RECORD_KIND = "cloudmarkup.editor-recovery-record" as const;
const STORED_RECORD_SCHEMA_VERSION = 1 as const;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

interface EditorRecoveryBroadcastChannel {
  close(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
}

interface StoredEditorRecoveryRecordV1 {
  readonly head: EditorRecoveryHead;
  readonly kind: typeof STORED_RECORD_KIND;
  readonly latest: unknown;
  readonly previous: unknown;
  readonly schemaVersion: typeof STORED_RECORD_SCHEMA_VERSION;
  readonly scopeFingerprint: Sha256Digest;
}

interface ValidStoredRecord {
  readonly ok: true;
  readonly record: StoredEditorRecoveryRecordV1;
}

interface InvalidStoredRecord {
  readonly ok: false;
  readonly rejection: EditorRecoveryRejected;
}

type StoredRecordInspection = InvalidStoredRecord | ValidStoredRecord;

export interface IndexedDbEditorRecoveryStoreOptions {
  /**
   * Test and embedding seam. Omit this option to use the browser's IndexedDB
   * factory. Pass null to exercise the explicit unsupported path.
   */
  readonly indexedDb?: IDBFactory | null;
  /**
   * A lower value is useful for bounded-capacity tests. The adapter never
   * permits a configured capacity above EDITOR_RECOVERY_MAXIMUM_SCOPES.
   */
  readonly maximumScopes?: number;
  /**
   * Each logical database gets an isolated notification channel by default.
   */
  readonly databaseName?: string;
  /**
   * Omit to use BroadcastChannel when present. Pass null to disable early
   * notices; transaction-time compare-and-swap remains authoritative.
   */
  readonly createBroadcastChannel?:
    ((name: string) => EditorRecoveryBroadcastChannel) | null;
}

export interface IndexedDbEditorRecoveryStoreV1 extends EditorRecoveryStoreV1 {
  close(): void;
}

class RecoveryUnavailableError extends Error {
  public readonly code: EditorRecoveryUnavailable["code"];

  public constructor(code: EditorRecoveryUnavailable["code"], message: string) {
    super(message);
    this.name = "RecoveryUnavailableError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  const expected = new Set(keys);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key)) &&
    actual.every((key) => expected.has(key))
  );
}

function isSha256Digest(value: unknown): value is Sha256Digest {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID_PATTERN.test(value);
}

function isHead(value: unknown): value is EditorRecoveryHead {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["generation", "snapshotDigest"]) &&
    Number.isSafeInteger(value["generation"]) &&
    (value["generation"] as number) >= 1 &&
    isSha256Digest(value["snapshotDigest"])
  );
}

function headsEqual(
  left: EditorRecoveryHead | null,
  right: EditorRecoveryHead | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.generation === right.generation &&
    left.snapshotDigest === right.snapshotDigest
  );
}

function createStoreDiagnostic(
  classification: EditorRecoveryDiagnosticClassification,
  code: string,
  message: string,
  path: string,
  scopeFingerprint: Sha256Digest,
  record: unknown,
): EditorRecoveryDiagnosticV1 {
  const possibleHead =
    isRecord(record) && isHead(record["head"]) ? record["head"] : undefined;
  return {
    kind: "cloudmarkup.editor-recovery-diagnostic",
    schemaVersion: 1,
    classification,
    diagnostics: [
      {
        code,
        message,
        path,
      },
    ],
    scopeFingerprint,
    ...(possibleHead === undefined
      ? {}
      : { generation: possibleHead.generation }),
  };
}

function rejectStoredRecord(
  classification: EditorRecoveryDiagnosticClassification,
  code: string,
  message: string,
  path: string,
  binding: EditorRecoveryBindingV1,
  value: unknown,
): InvalidStoredRecord {
  const possibleHead =
    isRecord(value) && isHead(value["head"]) ? value["head"] : undefined;
  return {
    ok: false,
    rejection: {
      status: "rejected",
      classification,
      diagnostic: createStoreDiagnostic(
        classification,
        code,
        message,
        path,
        binding.scopeFingerprint,
        value,
      ),
      ...(possibleHead === undefined ? {} : { actualHead: possibleHead }),
    },
  };
}

function inspectStoredRecord(
  value: unknown,
  binding: EditorRecoveryBindingV1,
): StoredRecordInspection {
  if (
    isRecord(value) &&
    Number.isSafeInteger(value["schemaVersion"]) &&
    (value["schemaVersion"] as number) > STORED_RECORD_SCHEMA_VERSION
  ) {
    return rejectStoredRecord(
      "envelope-unsupported-future",
      "unsupported-record-version",
      "The local recovery record was written by a newer unsupported version.",
      "$.schemaVersion",
      binding,
      value,
    );
  }

  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "head",
      "kind",
      "latest",
      "previous",
      "schemaVersion",
      "scopeFingerprint",
    ]) ||
    value["kind"] !== STORED_RECORD_KIND ||
    value["schemaVersion"] !== STORED_RECORD_SCHEMA_VERSION ||
    !isHead(value["head"]) ||
    !isSha256Digest(value["scopeFingerprint"])
  ) {
    return rejectStoredRecord(
      "envelope-malformed",
      "malformed-recovery-record",
      "The local recovery record does not match the strict v1 storage contract.",
      "$",
      binding,
      value,
    );
  }

  if (value["scopeFingerprint"] !== binding.scopeFingerprint) {
    return rejectStoredRecord(
      "binding-mismatch",
      "record-scope-mismatch",
      "The local recovery record does not match this recovery scope.",
      "$.scopeFingerprint",
      binding,
      value,
    );
  }

  return {
    ok: true,
    record: value as unknown as StoredEditorRecoveryRecordV1,
  };
}

function comparableStoredHead(
  value: unknown,
  binding: EditorRecoveryBindingV1,
): EditorRecoveryHead | undefined {
  if (
    !isRecord(value) ||
    value["kind"] !== STORED_RECORD_KIND ||
    value["scopeFingerprint"] !== binding.scopeFingerprint ||
    !isHead(value["head"])
  ) {
    return undefined;
  }
  return value["head"];
}

function previousValidCheckpoint(
  record: StoredEditorRecoveryRecordV1,
  binding: EditorRecoveryBindingV1,
): EditorRecoveryReady | undefined {
  if (record.previous === null) {
    return undefined;
  }
  const inspected = inspectEditorRecoveryEnvelopeV1(record.previous, binding);
  return inspected.status === "ready" &&
    inspected.head.generation < record.head.generation
    ? inspected
    : undefined;
}

function integrityRejection(
  record: StoredEditorRecoveryRecordV1,
  binding: EditorRecoveryBindingV1,
  previous: EditorRecoveryReady | undefined,
): EditorRecoveryRejected {
  return {
    status: "rejected",
    classification: "integrity-mismatch",
    actualHead: record.head,
    diagnostic: createStoreDiagnostic(
      "integrity-mismatch",
      "record-head-mismatch",
      "The local recovery record head does not match its newest validated checkpoint.",
      "$.head",
      binding.scopeFingerprint,
      record,
    ),
    ...(previous === undefined ? {} : { previousValidCheckpoint: previous }),
  };
}

function loadStoredRecord(
  record: StoredEditorRecoveryRecordV1,
  binding: EditorRecoveryBindingV1,
): EditorRecoveryReady | EditorRecoveryRejected {
  const previous = previousValidCheckpoint(record, binding);
  const latest = inspectEditorRecoveryEnvelopeV1(record.latest, binding);
  if (latest.status === "rejected") {
    return {
      ...latest,
      actualHead: record.head,
      ...(previous === undefined ? {} : { previousValidCheckpoint: previous }),
    };
  }
  if (!headsEqual(latest.head, record.head)) {
    return integrityRejection(record, binding, previous);
  }
  return latest;
}

function isHeadNotice(value: unknown): value is EditorRecoveryHeadNotice {
  if (
    !isRecord(value) ||
    !isSha256Digest(value["scopeFingerprint"]) ||
    !isOpaqueId(value["writerId"])
  ) {
    return false;
  }
  if (value["kind"] === "discard") {
    return hasExactKeys(value, ["kind", "scopeFingerprint", "writerId"]);
  }
  return (
    value["kind"] === "checkpoint" &&
    hasExactKeys(value, ["head", "kind", "scopeFingerprint", "writerId"]) &&
    isHead(value["head"])
  );
}

function unavailableFrom(error: unknown): EditorRecoveryUnavailable {
  if (error instanceof RecoveryUnavailableError) {
    return {
      status: "unavailable",
      code: error.code,
      message: error.message,
    };
  }

  const name =
    isRecord(error) && typeof error["name"] === "string"
      ? error["name"]
      : undefined;
  if (name === "QuotaExceededError") {
    return {
      status: "unavailable",
      code: "quota-exceeded",
      message:
        "The browser refused the local recovery write because its storage quota was exceeded.",
    };
  }
  if (name === "VersionError") {
    return {
      status: "unavailable",
      code: "version-error",
      message:
        "The local recovery database uses an unsupported future version.",
    };
  }
  if (name === "InvalidStateError") {
    return {
      status: "unavailable",
      code: "closed",
      message: "The local recovery database is closed.",
    };
  }
  return {
    status: "unavailable",
    code: "database-error",
    message:
      "The browser could not complete the local recovery database operation.",
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(
        request.error ??
          new RecoveryUnavailableError(
            "database-error",
            "The local recovery database request failed.",
          ),
      );
    };
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onabort = () => {
      reject(
        transaction.error ??
          new RecoveryUnavailableError(
            "database-error",
            "The local recovery database transaction was aborted.",
          ),
      );
    };
    transaction.onerror = () => {
      reject(
        transaction.error ??
          new RecoveryUnavailableError(
            "database-error",
            "The local recovery database transaction failed.",
          ),
      );
    };
  });
}

function openDatabase(
  indexedDb: IDBFactory,
  databaseName: string,
): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try {
      request = indexedDb.open(
        databaseName,
        EDITOR_RECOVERY_INDEXED_DB_VERSION,
      );
    } catch (error) {
      reject(
        error instanceof Error
          ? error
          : new Error("Opening IndexedDB threw a non-Error value."),
      );
      return;
    }

    request.onupgradeneeded = (event) => {
      if (
        event.oldVersion !== 0 ||
        request.result.objectStoreNames.contains(
          EDITOR_RECOVERY_INDEXED_DB_STORE_NAME,
        )
      ) {
        request.transaction?.abort();
        return;
      }
      request.result.createObjectStore(EDITOR_RECOVERY_INDEXED_DB_STORE_NAME, {
        keyPath: "scopeFingerprint",
      });
    };
    request.onblocked = () => {
      if (!settled) {
        settled = true;
        reject(
          new RecoveryUnavailableError(
            "blocked",
            "Another tab is blocking the local recovery database from opening.",
          ),
        );
      }
    };
    request.onerror = () => {
      if (!settled) {
        settled = true;
        reject(
          request.error ??
            new RecoveryUnavailableError(
              "database-error",
              "The local recovery database could not be opened.",
            ),
        );
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      if (
        !request.result.objectStoreNames.contains(
          EDITOR_RECOVERY_INDEXED_DB_STORE_NAME,
        )
      ) {
        settled = true;
        request.result.close();
        reject(
          new RecoveryUnavailableError(
            "version-error",
            "The local recovery database schema is incomplete.",
          ),
        );
        return;
      }
      settled = true;
      request.result.onversionchange = () => {
        request.result.close();
      };
      resolve(request.result);
    };
  });
}

function browserIndexedDb(): IDBFactory | null {
  return typeof globalThis.indexedDB === "undefined"
    ? null
    : globalThis.indexedDB;
}

function browserBroadcastChannel(
  name: string,
): EditorRecoveryBroadcastChannel | null {
  return typeof globalThis.BroadcastChannel === "undefined"
    ? null
    : new globalThis.BroadcastChannel(name);
}

class IndexedDbEditorRecoveryStore implements IndexedDbEditorRecoveryStoreV1 {
  public readonly contractVersion = EDITOR_RECOVERY_STORE_CONTRACT_VERSION;

  readonly #broadcastChannel: EditorRecoveryBroadcastChannel | null;
  readonly #databaseName: string;
  readonly #indexedDb: IDBFactory | null;
  readonly #listeners = new Map<
    Sha256Digest,
    Set<(notice: EditorRecoveryHeadNotice) => void>
  >();
  readonly #maximumScopes: number;
  #closed = false;
  #databaseHandle: IDBDatabase | undefined;
  #databasePromise: Promise<IDBDatabase> | undefined;

  public constructor(options: IndexedDbEditorRecoveryStoreOptions) {
    const maximumScopes =
      options.maximumScopes ?? EDITOR_RECOVERY_MAXIMUM_SCOPES;
    if (
      !Number.isSafeInteger(maximumScopes) ||
      maximumScopes < 1 ||
      maximumScopes > EDITOR_RECOVERY_MAXIMUM_SCOPES
    ) {
      throw new RangeError(
        `maximumScopes must be between 1 and ${String(EDITOR_RECOVERY_MAXIMUM_SCOPES)}.`,
      );
    }

    this.#databaseName =
      options.databaseName ?? EDITOR_RECOVERY_INDEXED_DB_NAME;
    this.#indexedDb =
      options.indexedDb === undefined ? browserIndexedDb() : options.indexedDb;
    this.#maximumScopes = maximumScopes;

    const channelName = `${EDITOR_RECOVERY_BROADCAST_CHANNEL_NAME}:${this.#databaseName}`;
    try {
      this.#broadcastChannel =
        options.createBroadcastChannel === null
          ? null
          : options.createBroadcastChannel === undefined
            ? browserBroadcastChannel(channelName)
            : options.createBroadcastChannel(channelName);
    } catch {
      this.#broadcastChannel = null;
    }
    if (this.#broadcastChannel !== null) {
      this.#broadcastChannel.onmessage = (event) => {
        this.#receiveNotice(event.data);
      };
    }
  }

  public async checkpoint(
    request: EditorRecoveryCheckpointRequest,
  ): Promise<EditorRecoveryCheckpointResult> {
    const prepared = prepareEditorRecoverySnapshotV1(
      request.binding,
      request.document,
    );
    if (!prepared.ok) {
      return {
        status: "rejected",
        diagnostic: prepared.diagnostic,
      };
    }

    try {
      // Once load has opened the database, begin the write transaction before
      // the first await. This lets pagehide/unmount flush establish an active
      // IndexedDB transaction before browser teardown can advance.
      const database = this.#databaseHandle ?? (await this.#database());
      const transaction = database.transaction(
        EDITOR_RECOVERY_INDEXED_DB_STORE_NAME,
        "readwrite",
      );
      const completion = transactionCompletion(transaction);
      const objectStore = transaction.objectStore(
        EDITOR_RECOVERY_INDEXED_DB_STORE_NAME,
      );
      const rawCurrent = await requestResult<unknown>(
        objectStore.get(request.binding.scopeFingerprint),
      );

      let current: StoredEditorRecoveryRecordV1 | undefined;
      let currentReady: EditorRecoveryReady | undefined;
      if (rawCurrent !== undefined) {
        const inspected = inspectStoredRecord(rawCurrent, request.binding);
        if (!inspected.ok) {
          await completion;
          return {
            status: "rejected",
            diagnostic: inspected.rejection.diagnostic,
          };
        }
        current = inspected.record;
        const loaded = loadStoredRecord(current, request.binding);
        if (loaded.status === "rejected") {
          await completion;
          return {
            status: "rejected",
            diagnostic: loaded.diagnostic,
          };
        }
        currentReady = loaded;
      }

      const actualHead = current?.head ?? null;
      if (!headsEqual(actualHead, request.expectedHead)) {
        await completion;
        return {
          status: "conflict",
          actualHead,
          expectedHead: request.expectedHead,
        };
      }
      if (
        currentReady?.head.snapshotDigest ===
        prepared.snapshot.integrity.snapshotDigest
      ) {
        await completion;
        return {
          status: "unchanged",
          head: currentReady.head,
        };
      }

      if (current === undefined) {
        const scopeCount = await requestResult(objectStore.count());
        if (scopeCount >= this.#maximumScopes) {
          await completion;
          return {
            status: "capacity-exceeded",
            maximumScopes: this.#maximumScopes,
          };
        }
      }

      const generation = (current?.head.generation ?? 0) + 1;
      if (!Number.isSafeInteger(generation)) {
        transaction.abort();
        await completion;
        throw new RecoveryUnavailableError(
          "database-error",
          "The local recovery generation limit was reached.",
        );
      }
      const envelope = createEditorRecoveryEnvelopeV1(prepared.snapshot, {
        generation,
        savedAt: request.savedAt,
        writerId: request.writerId,
      });
      const previous =
        currentReady?.envelope ??
        (current === undefined
          ? null
          : (previousValidCheckpoint(current, request.binding)?.envelope ??
            null));
      const stored: StoredEditorRecoveryRecordV1 = {
        kind: STORED_RECORD_KIND,
        schemaVersion: STORED_RECORD_SCHEMA_VERSION,
        scopeFingerprint: request.binding.scopeFingerprint,
        head: {
          generation,
          snapshotDigest: envelope.checkpoint.snapshotDigest,
        },
        latest: envelope,
        previous,
      };
      await requestResult(objectStore.put(stored));
      await completion;

      const notice: EditorRecoveryHeadNotice = {
        kind: "checkpoint",
        scopeFingerprint: request.binding.scopeFingerprint,
        writerId: request.writerId,
        head: stored.head,
      };
      this.#postNotice(notice);
      return {
        status: "stored",
        envelope,
        head: stored.head,
      };
    } catch (error) {
      return unavailableFrom(error);
    }
  }

  public async discard(
    request: EditorRecoveryDiscardRequest,
  ): Promise<EditorRecoveryDiscardResult> {
    try {
      const database = await this.#database();
      const transaction = database.transaction(
        EDITOR_RECOVERY_INDEXED_DB_STORE_NAME,
        "readwrite",
      );
      const completion = transactionCompletion(transaction);
      const objectStore = transaction.objectStore(
        EDITOR_RECOVERY_INDEXED_DB_STORE_NAME,
      );
      const rawCurrent = await requestResult<unknown>(
        objectStore.get(request.binding.scopeFingerprint),
      );
      if (rawCurrent === undefined) {
        await completion;
        return { status: "empty" };
      }

      const actualHead = comparableStoredHead(rawCurrent, request.binding);
      if (actualHead === undefined) {
        await completion;
        return {
          status: "unavailable",
          code: "database-error",
          message:
            "The local recovery record has no safely comparable scope and head.",
        };
      }
      if (!headsEqual(actualHead, request.expectedHead)) {
        await completion;
        return {
          status: "conflict",
          actualHead,
          expectedHead: request.expectedHead,
        };
      }

      await requestResult(objectStore.delete(request.binding.scopeFingerprint));
      await completion;
      this.#postNotice({
        kind: "discard",
        scopeFingerprint: request.binding.scopeFingerprint,
        writerId: request.writerId,
      });
      return { status: "discarded" };
    } catch (error) {
      return unavailableFrom(error);
    }
  }

  public async load(
    binding: EditorRecoveryBindingV1,
  ): Promise<EditorRecoveryLoadResult> {
    try {
      const database = await this.#database();
      const transaction = database.transaction(
        EDITOR_RECOVERY_INDEXED_DB_STORE_NAME,
        "readonly",
      );
      const completion = transactionCompletion(transaction);
      const rawRecord = await requestResult<unknown>(
        transaction
          .objectStore(EDITOR_RECOVERY_INDEXED_DB_STORE_NAME)
          .get(binding.scopeFingerprint),
      );
      await completion;
      if (rawRecord === undefined) {
        return { status: "empty" };
      }

      const inspected = inspectStoredRecord(rawRecord, binding);
      return inspected.ok
        ? loadStoredRecord(inspected.record, binding)
        : inspected.rejection;
    } catch (error) {
      return unavailableFrom(error);
    }
  }

  public async remediateRejected(
    request: EditorRecoveryRejectedRemediationRequest,
  ): Promise<EditorRecoveryRejectedRemediationResult> {
    const prepared =
      request.action === "replace"
        ? prepareEditorRecoverySnapshotV1(request.binding, request.document)
        : null;
    if (prepared !== null && !prepared.ok) {
      return { status: "rejected", diagnostic: prepared.diagnostic };
    }

    try {
      const database = await this.#database();
      const transaction = database.transaction(
        EDITOR_RECOVERY_INDEXED_DB_STORE_NAME,
        "readwrite",
      );
      const completion = transactionCompletion(transaction);
      const objectStore = transaction.objectStore(
        EDITOR_RECOVERY_INDEXED_DB_STORE_NAME,
      );
      const rawCurrent = await requestResult<unknown>(
        objectStore.get(request.binding.scopeFingerprint),
      );
      if (rawCurrent === undefined) {
        await completion;
        return {
          status: "conflict",
          actualClassification: "empty",
          actualHead: null,
          expectedClassification: request.expectedClassification,
          expectedHead: request.expectedHead,
        };
      }

      const inspected = inspectStoredRecord(rawCurrent, request.binding);
      const loaded = inspected.ok
        ? loadStoredRecord(inspected.record, request.binding)
        : inspected.rejection;
      if (loaded.status === "ready") {
        await completion;
        return {
          status: "conflict",
          actualClassification: "ready",
          actualHead: loaded.head,
          expectedClassification: request.expectedClassification,
          expectedHead: request.expectedHead,
        };
      }
      const actualHead = loaded.actualHead ?? null;
      if (!headsEqual(actualHead, request.expectedHead)) {
        await completion;
        return {
          status: "conflict",
          actualClassification: loaded.classification,
          actualHead,
          expectedClassification: request.expectedClassification,
          expectedHead: request.expectedHead,
        };
      }
      if (loaded.classification !== request.expectedClassification) {
        await completion;
        return {
          status: "conflict",
          actualClassification: loaded.classification,
          actualHead: loaded.actualHead ?? null,
          expectedClassification: request.expectedClassification,
          expectedHead: request.expectedHead,
        };
      }

      if (request.action === "discard") {
        await requestResult(
          objectStore.delete(request.binding.scopeFingerprint),
        );
        await completion;
        this.#postNotice({
          kind: "discard",
          scopeFingerprint: request.binding.scopeFingerprint,
          writerId: request.writerId,
        });
        return { status: "discarded" };
      }

      if (prepared === null) {
        transaction.abort();
        await completion;
        throw new RecoveryUnavailableError(
          "database-error",
          "The rejected recovery replacement was not prepared.",
        );
      }
      const generation = (loaded.actualHead?.generation ?? 0) + 1;
      if (!Number.isSafeInteger(generation)) {
        transaction.abort();
        await completion;
        throw new RecoveryUnavailableError(
          "database-error",
          "The local recovery generation limit was reached.",
        );
      }
      const envelope = createEditorRecoveryEnvelopeV1(prepared.snapshot, {
        generation,
        savedAt: request.savedAt,
        writerId: request.writerId,
      });
      const stored: StoredEditorRecoveryRecordV1 = {
        kind: STORED_RECORD_KIND,
        schemaVersion: STORED_RECORD_SCHEMA_VERSION,
        scopeFingerprint: request.binding.scopeFingerprint,
        head: {
          generation,
          snapshotDigest: envelope.checkpoint.snapshotDigest,
        },
        latest: envelope,
        previous: loaded.previousValidCheckpoint?.envelope ?? null,
      };
      await requestResult(objectStore.put(stored));
      await completion;
      this.#postNotice({
        kind: "checkpoint",
        scopeFingerprint: request.binding.scopeFingerprint,
        writerId: request.writerId,
        head: stored.head,
      });
      return {
        status: "stored",
        envelope,
        head: stored.head,
      };
    } catch (error) {
      return unavailableFrom(error);
    }
  }

  public subscribe(
    binding: EditorRecoveryBindingV1,
    listener: (notice: EditorRecoveryHeadNotice) => void,
  ): () => void {
    if (this.#closed) {
      return () => undefined;
    }
    const existing = this.#listeners.get(binding.scopeFingerprint);
    const listeners =
      existing ?? new Set<(notice: EditorRecoveryHeadNotice) => void>();
    listeners.add(listener);
    if (existing === undefined) {
      this.#listeners.set(binding.scopeFingerprint, listeners);
    }

    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.#listeners.delete(binding.scopeFingerprint);
      }
    };
  }

  public close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#listeners.clear();
    if (this.#broadcastChannel !== null) {
      this.#broadcastChannel.onmessage = null;
      this.#broadcastChannel.close();
    }
    const databasePromise = this.#databasePromise;
    if (databasePromise !== undefined) {
      void databasePromise.then(
        (database) => {
          database.close();
        },
        () => undefined,
      );
    }
  }

  async #database(): Promise<IDBDatabase> {
    if (this.#closed) {
      throw new RecoveryUnavailableError(
        "closed",
        "The local recovery store is closed.",
      );
    }
    if (this.#indexedDb === null) {
      throw new RecoveryUnavailableError(
        "not-supported",
        "This browser does not support IndexedDB local recovery.",
      );
    }
    this.#databasePromise ??= openDatabase(
      this.#indexedDb,
      this.#databaseName,
    ).then((database) => {
      if (this.#closed) {
        database.close();
        throw new RecoveryUnavailableError(
          "closed",
          "The local recovery store is closed.",
        );
      }
      this.#databaseHandle = database;
      return database;
    });
    return this.#databasePromise;
  }

  #postNotice(notice: EditorRecoveryHeadNotice): void {
    if (this.#broadcastChannel === null || this.#closed) {
      return;
    }
    try {
      this.#broadcastChannel.postMessage(notice);
    } catch {
      // BroadcastChannel is only an early-staleness signal. IndexedDB CAS is
      // authoritative, so notification failure must not invalidate the write.
    }
  }

  #receiveNotice(value: unknown): void {
    if (this.#closed || !isHeadNotice(value)) {
      return;
    }
    const listeners = this.#listeners.get(value.scopeFingerprint);
    if (listeners === undefined) {
      return;
    }
    for (const listener of listeners) {
      listener(value);
    }
  }
}

export function createIndexedDbEditorRecoveryStore(
  options: IndexedDbEditorRecoveryStoreOptions = {},
): IndexedDbEditorRecoveryStoreV1 {
  return new IndexedDbEditorRecoveryStore(options);
}
