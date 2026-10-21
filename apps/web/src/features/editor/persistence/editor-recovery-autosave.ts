import {
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";

import type {
  EditorRecoveryBindingV1,
  EditorRecoveryCheckpointResult,
  EditorRecoveryDiagnosticV1,
  EditorRecoveryHead,
  EditorRecoveryHeadNotice,
  EditorRecoveryStoreV1,
  EditorRecoveryUnavailable,
} from "./editor-recovery-store.js";

export const EDITOR_RECOVERY_AUTOSAVE_DEBOUNCE_MILLISECONDS = 750 as const;
export const EDITOR_RECOVERY_AUTOSAVE_MAXIMUM_DEBOUNCE_MILLISECONDS =
  60_000 as const;

interface EditorRecoveryAutosaveStateBase {
  readonly expectedHead: EditorRecoveryHead | null;
  readonly hasPendingChanges: boolean;
}

export interface EditorRecoveryAutosaveDirty extends EditorRecoveryAutosaveStateBase {
  readonly hasPendingChanges: true;
  readonly status: "dirty";
}

export interface EditorRecoveryAutosaveSaving extends EditorRecoveryAutosaveStateBase {
  readonly status: "saving";
}

export interface EditorRecoveryAutosaveSaved extends EditorRecoveryAutosaveStateBase {
  readonly hasPendingChanges: false;
  readonly head: EditorRecoveryHead | null;
  readonly savedAt: string | null;
  readonly status: "saved";
}

export interface EditorRecoveryAutosaveConflict extends EditorRecoveryAutosaveStateBase {
  readonly actualHead: EditorRecoveryHead | null;
  readonly source: "checkpoint" | "external-notice";
  readonly status: "conflict";
}

export interface EditorRecoveryAutosaveRejected extends EditorRecoveryAutosaveStateBase {
  readonly diagnostic: EditorRecoveryDiagnosticV1;
  readonly status: "rejected";
}

export interface EditorRecoveryAutosaveUnavailable extends EditorRecoveryAutosaveStateBase {
  readonly code:
    | EditorRecoveryUnavailable["code"]
    | "capacity-exceeded"
    | "unexpected-error";
  readonly message: string;
  readonly status: "unavailable";
}

export type EditorRecoveryAutosaveState =
  | EditorRecoveryAutosaveConflict
  | EditorRecoveryAutosaveDirty
  | EditorRecoveryAutosaveRejected
  | EditorRecoveryAutosaveSaved
  | EditorRecoveryAutosaveSaving
  | EditorRecoveryAutosaveUnavailable;

export interface EditorRecoveryAutosaveScheduler {
  clearTimeout(handle: unknown): void;
  setTimeout(callback: () => void, delayMilliseconds: number): unknown;
}

export interface EditorRecoveryAutosaveOptions {
  readonly binding: EditorRecoveryBindingV1;
  readonly debounceMilliseconds?: number;
  readonly initialHead: EditorRecoveryHead | null;
  readonly now?: () => string;
  readonly scheduler?: EditorRecoveryAutosaveScheduler;
  readonly store: EditorRecoveryStoreV1;
  readonly writerId: string;
}

export interface EditorRecoveryAutosaveController {
  readonly expectedHead: EditorRecoveryHead | null;
  dispose(): void;
  flush(): Promise<EditorRecoveryAutosaveState>;
  getState(): EditorRecoveryAutosaveState;
  queue(document: ArchitectureDocument): void;
  subscribe(listener: (state: EditorRecoveryAutosaveState) => void): () => void;
}

interface PendingDocument {
  readonly document: ArchitectureDocument;
  readonly sequence: number;
}

function cloneHead(head: EditorRecoveryHead | null): EditorRecoveryHead | null {
  return head === null
    ? null
    : {
        generation: head.generation,
        snapshotDigest: head.snapshotDigest,
      };
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

function browserScheduler(): EditorRecoveryAutosaveScheduler {
  return {
    clearTimeout: (handle) => {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    setTimeout: (callback, delayMilliseconds) =>
      globalThis.setTimeout(callback, delayMilliseconds),
  };
}

class EditorRecoveryAutosave implements EditorRecoveryAutosaveController {
  readonly #binding: EditorRecoveryBindingV1;
  readonly #debounceMilliseconds: number;
  readonly #listeners = new Set<(state: EditorRecoveryAutosaveState) => void>();
  readonly #now: () => string;
  readonly #scheduler: EditorRecoveryAutosaveScheduler;
  readonly #store: EditorRecoveryStoreV1;
  readonly #unsubscribeFromStore: () => void;
  readonly #writerId: string;

  #conflict: EditorRecoveryAutosaveConflict | null = null;
  #disposed = false;
  #expectedHead: EditorRecoveryHead | null;
  #inFlight: Promise<void> | null = null;
  #pending: PendingDocument | null = null;
  #sequence = 0;
  #state: EditorRecoveryAutosaveState;
  #timer: unknown;

  public constructor(options: EditorRecoveryAutosaveOptions) {
    const debounceMilliseconds =
      options.debounceMilliseconds ??
      EDITOR_RECOVERY_AUTOSAVE_DEBOUNCE_MILLISECONDS;
    if (
      !Number.isSafeInteger(debounceMilliseconds) ||
      debounceMilliseconds < 0 ||
      debounceMilliseconds >
        EDITOR_RECOVERY_AUTOSAVE_MAXIMUM_DEBOUNCE_MILLISECONDS
    ) {
      throw new RangeError(
        `debounceMilliseconds must be between 0 and ${String(EDITOR_RECOVERY_AUTOSAVE_MAXIMUM_DEBOUNCE_MILLISECONDS)}.`,
      );
    }

    this.#binding = options.binding;
    this.#debounceMilliseconds = debounceMilliseconds;
    this.#expectedHead = cloneHead(options.initialHead);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#scheduler = options.scheduler ?? browserScheduler();
    this.#store = options.store;
    this.#writerId = options.writerId;
    this.#state = {
      status: "saved",
      expectedHead: cloneHead(this.#expectedHead),
      hasPendingChanges: false,
      head: cloneHead(this.#expectedHead),
      savedAt: null,
    };
    this.#unsubscribeFromStore = this.#store.subscribe(
      this.#binding,
      (notice) => {
        this.#receiveNotice(notice);
      },
    );
  }

  public get expectedHead(): EditorRecoveryHead | null {
    return cloneHead(this.#expectedHead);
  }

  public getState(): EditorRecoveryAutosaveState {
    return this.#state;
  }

  public queue(document: ArchitectureDocument): void {
    if (this.#disposed) {
      return;
    }
    this.#sequence += 1;
    this.#pending = {
      document: parseArchitectureDocument(document),
      sequence: this.#sequence,
    };
    this.#cancelTimer();
    if (this.#conflict !== null) {
      this.#publish({
        ...this.#conflict,
        hasPendingChanges: true,
      });
      return;
    }
    this.#publishDirty();
    this.#scheduleTimer();
  }

  public async flush(): Promise<EditorRecoveryAutosaveState> {
    if (this.#disposed) {
      return this.#state;
    }
    this.#cancelTimer();

    const active = this.#inFlight;
    if (active !== null) {
      await active;
    }
    if (this.#conflict !== null || this.#pending === null) {
      return this.#state;
    }

    await this.#beginCheckpoint();
    return this.#state;
  }

  public subscribe(
    listener: (state: EditorRecoveryAutosaveState) => void,
  ): () => void {
    if (this.#disposed) {
      return () => undefined;
    }
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      this.#listeners.delete(listener);
    };
  }

  public dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#cancelTimer();
    this.#pending = null;
    this.#unsubscribeFromStore();
    this.#listeners.clear();
  }

  #beginCheckpoint(): Promise<void> {
    const pending = this.#pending;
    if (pending === null) {
      return Promise.resolve();
    }
    this.#pending = null;
    this.#publish({
      status: "saving",
      expectedHead: cloneHead(this.#expectedHead),
      hasPendingChanges: true,
    });

    const operation = this.#checkpoint(pending);
    this.#inFlight = operation;
    void operation.then(() => {
      if (this.#inFlight === operation) {
        this.#inFlight = null;
      }
    });
    return operation;
  }

  async #checkpoint(pending: PendingDocument): Promise<void> {
    const savedAt = this.#now();
    let result: EditorRecoveryCheckpointResult;
    try {
      result = await this.#store.checkpoint({
        binding: this.#binding,
        document: pending.document,
        expectedHead: cloneHead(this.#expectedHead),
        savedAt,
        writerId: this.#writerId,
      });
    } catch {
      if (this.#disposed) {
        return;
      }
      this.#retainPending(pending);
      this.#publish({
        status: "unavailable",
        code: "unexpected-error",
        expectedHead: cloneHead(this.#expectedHead),
        hasPendingChanges: true,
        message: "The local recovery adapter threw an unexpected error.",
      });
      return;
    }

    if (this.#disposed) {
      return;
    }
    if (result.status === "stored" || result.status === "unchanged") {
      this.#expectedHead = cloneHead(result.head);
      if (this.#conflict !== null) {
        this.#publish({
          ...this.#conflict,
          expectedHead: cloneHead(this.#expectedHead),
          hasPendingChanges: this.#pending !== null,
        });
        return;
      }
      if (this.#pending !== null) {
        this.#publishDirty();
        this.#scheduleTimer();
        return;
      }
      this.#publish({
        status: "saved",
        expectedHead: cloneHead(this.#expectedHead),
        hasPendingChanges: false,
        head: cloneHead(this.#expectedHead),
        savedAt,
      });
      return;
    }

    this.#retainPending(pending);
    if (result.status === "conflict") {
      this.#setConflict("checkpoint", result.actualHead, result.expectedHead);
      return;
    }
    if (result.status === "rejected") {
      this.#publish({
        status: "rejected",
        diagnostic: result.diagnostic,
        expectedHead: cloneHead(this.#expectedHead),
        hasPendingChanges: true,
      });
      return;
    }
    if (result.status === "capacity-exceeded") {
      this.#publish({
        status: "unavailable",
        code: "capacity-exceeded",
        expectedHead: cloneHead(this.#expectedHead),
        hasPendingChanges: true,
        message: `Local recovery is limited to ${String(result.maximumScopes)} document scopes.`,
      });
      return;
    }
    this.#publish({
      status: "unavailable",
      code: result.code,
      expectedHead: cloneHead(this.#expectedHead),
      hasPendingChanges: true,
      message: result.message,
    });
  }

  #retainPending(pending: PendingDocument): void {
    if (this.#pending === null || this.#pending.sequence < pending.sequence) {
      this.#pending = pending;
    }
  }

  #receiveNotice(notice: EditorRecoveryHeadNotice): void {
    if (this.#disposed || notice.writerId === this.#writerId) {
      return;
    }
    const actualHead =
      notice.kind === "checkpoint" ? cloneHead(notice.head) : null;
    if (headsEqual(actualHead, this.#expectedHead)) {
      return;
    }
    this.#setConflict("external-notice", actualHead, this.#expectedHead);
  }

  #setConflict(
    source: EditorRecoveryAutosaveConflict["source"],
    actualHead: EditorRecoveryHead | null,
    expectedHead: EditorRecoveryHead | null,
  ): void {
    this.#cancelTimer();
    this.#conflict = {
      status: "conflict",
      source,
      actualHead: cloneHead(actualHead),
      expectedHead: cloneHead(expectedHead),
      hasPendingChanges: this.#pending !== null,
    };
    this.#publish(this.#conflict);
  }

  #publishDirty(): void {
    this.#publish({
      status: "dirty",
      expectedHead: cloneHead(this.#expectedHead),
      hasPendingChanges: true,
    });
  }

  #publish(state: EditorRecoveryAutosaveState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      try {
        listener(state);
      } catch {
        // One observer cannot interrupt autosave or other observers.
      }
    }
  }

  #scheduleTimer(): void {
    if (this.#disposed || this.#conflict !== null || this.#pending === null) {
      return;
    }
    this.#timer = this.#scheduler.setTimeout(() => {
      this.#timer = undefined;
      void this.flush();
    }, this.#debounceMilliseconds);
  }

  #cancelTimer(): void {
    if (this.#timer === undefined) {
      return;
    }
    this.#scheduler.clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

export function createEditorRecoveryAutosaveController(
  options: EditorRecoveryAutosaveOptions,
): EditorRecoveryAutosaveController {
  return new EditorRecoveryAutosave(options);
}
