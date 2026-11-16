interface FakeRequest<T> {
  error: DOMException | null;
  onerror: (() => void) | null;
  onsuccess: (() => void) | null;
  result: T | undefined;
}

interface FakeOpenRequest extends FakeRequest<IDBDatabase> {
  onblocked: (() => void) | null;
  onupgradeneeded: ((event: { readonly oldVersion: number }) => void) | null;
  result: IDBDatabase;
  transaction: IDBTransaction | null;
}

interface MutableRecoveryEnvelope {
  canonicalDocument: string;
  schemaVersion: number;
}

interface MutableRecoveryRecord {
  latest: MutableRecoveryEnvelope;
}

export function structuredCopy<T>(value: T): T {
  return structuredClone(value);
}

class MemoryTransaction {
  public error: DOMException | null = null;
  public onabort: (() => void) | null = null;
  public oncomplete: (() => void) | null = null;
  public onerror: (() => void) | null = null;

  readonly #records: Map<string, unknown>;
  readonly #staged: Map<string, unknown>;
  readonly #keyPath: string;
  readonly #lostAcknowledgement: boolean;
  readonly #failBeforeCommit: boolean;
  readonly #readwrite: boolean;
  readonly #failRequest: () => boolean;
  #aborted = false;
  #completed = false;
  #completionTimer: ReturnType<typeof setTimeout> | undefined;
  #pending = 0;

  public constructor(
    records: Map<string, unknown>,
    keyPath: string,
    lostAcknowledgement = false,
    failBeforeCommit = false,
    readwrite = false,
    failRequest: () => boolean = () => false,
  ) {
    this.#failRequest = failRequest;
    this.#lostAcknowledgement = lostAcknowledgement;
    this.#keyPath = keyPath;
    this.#records = records;
    this.#staged = new Map(records);
    this.#failBeforeCommit = failBeforeCommit;
    this.#readwrite = readwrite;
    this.#scheduleCompletion();
  }

  public abort(): void {
    if (this.#completed || this.#aborted) {
      return;
    }
    this.#aborted = true;
    if (this.#completionTimer !== undefined) {
      clearTimeout(this.#completionTimer);
    }
    queueMicrotask(() => {
      this.onabort?.();
    });
  }

  public objectStore(): IDBObjectStore {
    return {
      count: () => this.#request(() => this.#staged.size),
      getAll: () =>
        this.#request(() => [...this.#staged.values()].map(structuredCopy)),
      delete: (key: IDBValidKey) =>
        this.#request(() => {
          if (typeof key !== "string") {
            throw new DOMException("Expected a string key.", "DataError");
          }
          this.#staged.delete(key);
          return undefined;
        }),
      get: (key: IDBValidKey) =>
        this.#request(() => {
          if (typeof key !== "string") {
            throw new DOMException("Expected a string key.", "DataError");
          }
          const value = this.#staged.get(key);
          return value === undefined ? undefined : structuredCopy(value);
        }),
      put: (value: unknown) =>
        this.#request(() => {
          if (
            typeof value !== "object" ||
            value === null ||
            !(this.#keyPath in value) ||
            typeof Reflect.get(value, this.#keyPath) !== "string"
          ) {
            throw new DOMException("Missing scope fingerprint.", "DataError");
          }
          this.#staged.set(
            Reflect.get(value, this.#keyPath) as string,
            structuredCopy(value),
          );
          return Reflect.get(value, this.#keyPath) as string;
        }),
    } as unknown as IDBObjectStore;
  }

  public toIdbTransaction(): IDBTransaction {
    return this as unknown as IDBTransaction;
  }

  #request<T>(operation: () => T): IDBRequest<T> {
    this.#pending += 1;
    const request: FakeRequest<T> = {
      error: null,
      onerror: null,
      onsuccess: null,
      result: undefined,
    };
    queueMicrotask(() => {
      if (this.#aborted) {
        return;
      }
      try {
        if (this.#failRequest()) {
          throw new DOMException("Synthetic request failure.", "UnknownError");
        }
        request.result = operation();
        request.onsuccess?.();
      } catch (error) {
        request.error =
          error instanceof DOMException
            ? error
            : new DOMException("Memory request failed.", "UnknownError");
        request.onerror?.();
        this.error = request.error;
        this.onerror?.();
        this.abort();
      } finally {
        this.#pending -= 1;
        this.#scheduleCompletion();
      }
    });
    return request as unknown as IDBRequest<T>;
  }

  #scheduleCompletion(): void {
    if (
      this.#aborted ||
      this.#completed ||
      this.#pending > 0 ||
      this.#completionTimer !== undefined
    ) {
      return;
    }
    this.#completionTimer = setTimeout(() => {
      this.#completionTimer = undefined;
      if (this.#pending === 0 && !this.#aborted && !this.#completed) {
        if (this.#failBeforeCommit) {
          this.abort();
          return;
        }
        if (this.#readwrite) {
          this.#records.clear();
          for (const [key, value] of this.#staged)
            this.#records.set(key, value);
        }
        this.#completed = true;
        if (this.#lostAcknowledgement) this.onabort?.();
        else this.oncomplete?.();
      }
    }, 0);
  }
}

export class MemoryIndexedDb {
  readonly #records = new Map<string, unknown>();
  #hasStore = false;
  #keyPath = "scopeFingerprint";
  #loseNextCommit = false;
  #failNextCommit = false;
  #requestsBeforeFailure: number | null = null;
  public failRequestAfter(successfulRequests = 0): void {
    this.#requestsBeforeFailure = successfulRequests;
  }
  readonly #connections = new Set<IDBDatabase>();
  public failNextCommit(): void {
    this.#failNextCommit = true;
  }
  public requestVersionChange(): void {
    for (const connection of [...this.#connections])
      connection.onversionchange?.({
        newVersion: null,
      } as IDBVersionChangeEvent);
  }
  public get openConnections(): number {
    return this.#connections.size;
  }
  /** Synthetic committed write followed by a lost transaction acknowledgement. */
  public loseNextCommitAcknowledgement(): void {
    this.#loseNextCommit = true;
  }

  public readonly factory = {
    open: () => this.#open(),
  } as unknown as IDBFactory;

  public mutate(
    scopeFingerprint: string,
    mutate: (record: MutableRecoveryRecord) => void,
  ): void {
    const rawRecord = this.#records.get(scopeFingerprint);
    if (typeof rawRecord !== "object" || rawRecord === null) {
      throw new Error("Expected a stored recovery record.");
    }
    const record = structuredCopy(rawRecord) as MutableRecoveryRecord;
    mutate(record);
    this.#records.set(scopeFingerprint, record);
  }
  public setRaw(scopeFingerprint: string, value: unknown): void {
    this.#records.set(scopeFingerprint, structuredCopy(value));
  }

  public replaceField(
    scopeFingerprint: string,
    key: "latest" | "schemaVersion" | "digest" | "previous",
    value: unknown,
  ): void {
    const rawRecord = this.#records.get(scopeFingerprint);
    if (typeof rawRecord !== "object" || rawRecord === null) {
      throw new Error("Expected a stored recovery record.");
    }
    const record = structuredCopy(rawRecord) as Record<string, unknown>;
    record[key] = structuredCopy(value);
    this.#records.set(scopeFingerprint, record);
  }

  #database(): IDBDatabase {
    const objectStoreNames = {
      contains: (name: string) => name === "recovery-scopes" && this.#hasStore,
    };
    const database = {
      close: () => {
        this.#connections.delete(database);
      },
      createObjectStore: (
        _name: string,
        options?: IDBObjectStoreParameters,
      ) => {
        if (typeof options?.keyPath === "string")
          this.#keyPath = options.keyPath;
        this.#hasStore = true;
        return {} as IDBObjectStore;
      },
      objectStoreNames,
      onversionchange: null,
      transaction: (_store: string, mode: IDBTransactionMode) => {
        const lost = mode === "readwrite" && this.#loseNextCommit;
        const fail = mode === "readwrite" && this.#failNextCommit;
        if (lost) this.#loseNextCommit = false;
        if (fail) this.#failNextCommit = false;
        return new MemoryTransaction(
          this.#records,
          this.#keyPath,
          lost,
          fail,
          mode === "readwrite",
          () => {
            if (this.#requestsBeforeFailure === null) return false;
            if (this.#requestsBeforeFailure-- > 0) return false;
            this.#requestsBeforeFailure = null;
            return true;
          },
        ).toIdbTransaction();
      },
    } as unknown as IDBDatabase;
    this.#connections.add(database);
    return database;
  }

  #open(): IDBOpenDBRequest {
    const request: FakeOpenRequest = {
      error: null,
      onblocked: null,
      onerror: null,
      onsuccess: null,
      onupgradeneeded: null,
      result: this.#database(),
      transaction: null,
    };
    queueMicrotask(() => {
      if (!this.#hasStore) {
        request.onupgradeneeded?.({ oldVersion: 0 });
      }
      queueMicrotask(() => {
        request.onsuccess?.();
      });
    });
    return request as unknown as IDBOpenDBRequest;
  }
}
