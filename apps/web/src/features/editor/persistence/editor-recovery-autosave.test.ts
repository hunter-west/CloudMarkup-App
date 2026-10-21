import {
  hashCanonicalValue,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import { loadFoundationArchitectureDocument } from "../model/foundation-editor-fixture.js";
import { dispatchMoveNodeCommand } from "../model/move-node-command.js";
import { createEditorRecoveryBindingV1 } from "./editor-recovery-envelope.js";
import {
  createEditorRecoveryAutosaveController,
  type EditorRecoveryAutosaveScheduler,
  type EditorRecoveryAutosaveState,
} from "./editor-recovery-autosave.js";
import {
  EDITOR_RECOVERY_STORE_CONTRACT_VERSION,
  type EditorRecoveryBindingV1,
  type EditorRecoveryCheckpointRequest,
  type EditorRecoveryCheckpointResult,
  type EditorRecoveryDiagnosticV1,
  type EditorRecoveryDiscardRequest,
  type EditorRecoveryDiscardResult,
  type EditorRecoveryHead,
  type EditorRecoveryHeadNotice,
  type EditorRecoveryLoadResult,
  type EditorRecoveryRejectedRemediationRequest,
  type EditorRecoveryRejectedRemediationResult,
  type EditorRecoveryStoreV1,
} from "./editor-recovery-store.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      if (resolvePromise === undefined) {
        throw new Error("Deferred promise was not initialized.");
      }
      resolvePromise(value);
    },
  };
}

function requiredAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Expected value at index ${String(index)}.`);
  }
  return value;
}

class TestScheduler implements EditorRecoveryAutosaveScheduler {
  readonly #callbacks = new Map<number, () => void>();
  #nextHandle = 0;

  public get size(): number {
    return this.#callbacks.size;
  }

  public clearTimeout(handle: unknown): void {
    if (typeof handle === "number") {
      this.#callbacks.delete(handle);
    }
  }

  public runAll(): void {
    const callbacks = [...this.#callbacks.entries()].sort(
      ([left], [right]) => left - right,
    );
    this.#callbacks.clear();
    for (const [, callback] of callbacks) {
      callback();
    }
  }

  public setTimeout(callback: () => void): unknown {
    this.#nextHandle += 1;
    this.#callbacks.set(this.#nextHandle, callback);
    return this.#nextHandle;
  }
}

type CheckpointImplementation = (
  request: EditorRecoveryCheckpointRequest,
) => Promise<EditorRecoveryCheckpointResult>;

class RecordingRecoveryStore implements EditorRecoveryStoreV1 {
  public readonly contractVersion = EDITOR_RECOVERY_STORE_CONTRACT_VERSION;
  public readonly requests: EditorRecoveryCheckpointRequest[] = [];

  readonly #checkpoint: CheckpointImplementation;
  readonly #listeners = new Set<(notice: EditorRecoveryHeadNotice) => void>();

  public constructor(checkpoint: CheckpointImplementation) {
    this.#checkpoint = checkpoint;
  }

  public async checkpoint(
    request: EditorRecoveryCheckpointRequest,
  ): Promise<EditorRecoveryCheckpointResult> {
    this.requests.push(request);
    return this.#checkpoint(request);
  }

  public discard(
    request: EditorRecoveryDiscardRequest,
  ): Promise<EditorRecoveryDiscardResult> {
    void request;
    return Promise.resolve({ status: "empty" });
  }

  public emit(notice: EditorRecoveryHeadNotice): void {
    for (const listener of this.#listeners) {
      listener(notice);
    }
  }

  public load(
    binding: EditorRecoveryBindingV1,
  ): Promise<EditorRecoveryLoadResult> {
    void binding;
    return Promise.resolve({ status: "empty" });
  }

  public remediateRejected(
    request: EditorRecoveryRejectedRemediationRequest,
  ): Promise<EditorRecoveryRejectedRemediationResult> {
    void request;
    return Promise.resolve({
      status: "unavailable",
      code: "database-error",
      message: "Rejected-record remediation is not used by autosave tests.",
    });
  }

  public subscribe(
    _binding: EditorRecoveryBindingV1,
    listener: (notice: EditorRecoveryHeadNotice) => void,
  ): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}

function sequentialIds(prefix: string): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `${prefix}_${String(sequence)}`;
  };
}

function movedDocument(
  document: ArchitectureDocument,
  x: number,
  y: number,
  prefix: string,
): ArchitectureDocument {
  return dispatchMoveNodeCommand({
    createId: sequentialIds(prefix),
    document,
    nodeId: "node_application",
    position: { x, y },
  }).document;
}

function documentPosition(document: ArchitectureDocument) {
  return document.nodes.find((node) => node.id === "node_application")
    ?.presentation.position;
}

function recoveryFixture(scopeKey: string) {
  const document = loadFoundationArchitectureDocument();
  const binding = createEditorRecoveryBindingV1({
    scopeKey,
    seedDocument: document,
  });
  return { binding, document };
}

function head(generation: number): EditorRecoveryHead {
  return {
    generation,
    snapshotDigest: hashCanonicalValue({
      kind: "autosave-test-head",
      generation,
    }),
  };
}

function diagnostic(
  binding: EditorRecoveryBindingV1,
): EditorRecoveryDiagnosticV1 {
  return {
    kind: "cloudmarkup.editor-recovery-diagnostic",
    schemaVersion: 1,
    classification: "credential-literal",
    diagnostics: [
      {
        code: "credential-literal-refused",
        message: "A credential-shaped literal was refused.",
        path: "$.nodes[0].semantic.configuration.values",
      },
    ],
    scopeFingerprint: binding.scopeFingerprint,
  };
}

describe("editor recovery autosave controller", () => {
  it("coalesces trailing changes and tracks the expected CAS head", async () => {
    const scheduler = new TestScheduler();
    const firstHead = head(1);
    const results: EditorRecoveryCheckpointResult[] = [
      {
        status: "stored",
        head: firstHead,
        envelope: {} as never,
      },
      {
        status: "unchanged",
        head: firstHead,
      },
    ];
    const store = new RecordingRecoveryStore(() => {
      const result = results.shift();
      if (result === undefined) {
        throw new Error("Unexpected checkpoint.");
      }
      return Promise.resolve(result);
    });
    const { binding, document } = recoveryFixture("autosave-coalescing");
    const controller = createEditorRecoveryAutosaveController({
      binding,
      initialHead: null,
      now: () => "2026-07-30T13:00:00.000Z",
      scheduler,
      store,
      writerId: "writer_autosave",
    });
    const statuses: EditorRecoveryAutosaveState["status"][] = [];
    controller.subscribe((state) => {
      statuses.push(state.status);
    });

    controller.queue(
      movedDocument(document, 120, 220, "autosave_coalesce_one"),
    );
    controller.queue(
      movedDocument(document, 320, 420, "autosave_coalesce_two"),
    );
    expect(store.requests).toHaveLength(0);
    expect(scheduler.size).toBe(1);
    expect(controller.getState()).toMatchObject({
      status: "dirty",
      hasPendingChanges: true,
      expectedHead: null,
    });

    scheduler.runAll();
    await controller.flush();
    expect(store.requests).toHaveLength(1);
    expect(documentPosition(requiredAt(store.requests, 0).document)).toEqual({
      x: 320,
      y: 420,
    });
    expect(requiredAt(store.requests, 0).expectedHead).toBeNull();
    expect(controller.expectedHead).toEqual(firstHead);
    expect(controller.getState()).toMatchObject({
      status: "saved",
      head: firstHead,
      savedAt: "2026-07-30T13:00:00.000Z",
    });
    expect(statuses).toEqual(["dirty", "dirty", "saving", "saved"]);

    controller.queue(document);
    await controller.flush();
    expect(scheduler.size).toBe(0);
    expect(requiredAt(store.requests, 1).expectedHead).toEqual(firstHead);
    expect(controller.getState().status).toBe("saved");
  });

  it("preserves a newer queued document while a checkpoint is in flight", async () => {
    const scheduler = new TestScheduler();
    const firstResult = deferred<EditorRecoveryCheckpointResult>();
    const firstHead = head(1);
    const secondHead = head(2);
    let call = 0;
    const store = new RecordingRecoveryStore(() => {
      call += 1;
      return call === 1
        ? firstResult.promise
        : Promise.resolve({
            status: "stored",
            head: secondHead,
            envelope: {} as never,
          });
    });
    const { binding, document } = recoveryFixture("autosave-in-flight");
    const controller = createEditorRecoveryAutosaveController({
      binding,
      initialHead: null,
      scheduler,
      store,
      writerId: "writer_in_flight",
    });
    const first = movedDocument(document, 140, 240, "autosave_in_flight_one");
    const second = movedDocument(document, 440, 540, "autosave_in_flight_two");

    controller.queue(first);
    const firstFlush = controller.flush();
    expect(controller.getState()).toMatchObject({
      status: "saving",
      hasPendingChanges: true,
    });
    controller.queue(second);
    expect(controller.getState().status).toBe("dirty");

    firstResult.resolve({
      status: "stored",
      head: firstHead,
      envelope: {} as never,
    });
    await firstFlush;
    expect(controller.getState().status).toBe("dirty");
    await controller.flush();

    expect(store.requests).toHaveLength(2);
    expect(requiredAt(store.requests, 1).expectedHead).toEqual(firstHead);
    expect(documentPosition(requiredAt(store.requests, 1).document)).toEqual({
      x: 440,
      y: 540,
    });
    expect(controller.expectedHead).toEqual(secondHead);
  });

  it("surfaces transaction and external-notice conflicts without retrying", async () => {
    const scheduler = new TestScheduler();
    const expectedHead = head(1);
    const actualHead = head(2);
    const store = new RecordingRecoveryStore((request) =>
      Promise.resolve({
        status: "conflict",
        actualHead,
        expectedHead: request.expectedHead,
      }),
    );
    const { binding, document } = recoveryFixture("autosave-conflicts");
    const controller = createEditorRecoveryAutosaveController({
      binding,
      initialHead: expectedHead,
      scheduler,
      store,
      writerId: "writer_conflict",
    });

    controller.queue(document);
    await controller.flush();
    expect(controller.getState()).toEqual({
      status: "conflict",
      source: "checkpoint",
      actualHead,
      expectedHead,
      hasPendingChanges: true,
    });
    controller.queue(
      movedDocument(document, 640, 440, "autosave_conflict_newer"),
    );
    scheduler.runAll();
    await controller.flush();
    expect(store.requests).toHaveLength(1);

    const observerStore = new RecordingRecoveryStore(() =>
      Promise.resolve({
        status: "unchanged",
        head: expectedHead,
      }),
    );
    const observer = createEditorRecoveryAutosaveController({
      binding,
      initialHead: expectedHead,
      scheduler,
      store: observerStore,
      writerId: "writer_observer",
    });
    observerStore.emit({
      kind: "checkpoint",
      scopeFingerprint: binding.scopeFingerprint,
      writerId: "writer_observer",
      head: actualHead,
    });
    expect(observer.getState().status).toBe("saved");

    observerStore.emit({
      kind: "checkpoint",
      scopeFingerprint: binding.scopeFingerprint,
      writerId: "writer_other",
      head: actualHead,
    });
    expect(observer.getState()).toEqual({
      status: "conflict",
      source: "external-notice",
      actualHead,
      expectedHead,
      hasPendingChanges: false,
    });
    observer.queue(document);
    await observer.flush();
    expect(observerStore.requests).toHaveLength(0);
    expect(observer.getState()).toMatchObject({
      status: "conflict",
      hasPendingChanges: true,
    });
  });

  it("makes rejected and unavailable writes observable and retryable", async () => {
    const scheduler = new TestScheduler();
    const { binding, document } = recoveryFixture("autosave-failures");
    const results: EditorRecoveryCheckpointResult[] = [
      {
        status: "rejected",
        diagnostic: diagnostic(binding),
      },
      {
        status: "unavailable",
        code: "quota-exceeded",
        message: "Quota exceeded.",
      },
      {
        status: "capacity-exceeded",
        maximumScopes: 32,
      },
    ];
    const store = new RecordingRecoveryStore(() => {
      const result = results.shift();
      if (result === undefined) {
        throw new Error("Unexpected retry.");
      }
      return Promise.resolve(result);
    });
    const controller = createEditorRecoveryAutosaveController({
      binding,
      initialHead: null,
      scheduler,
      store,
      writerId: "writer_failures",
    });

    controller.queue(document);
    await controller.flush();
    expect(controller.getState()).toMatchObject({
      status: "rejected",
      hasPendingChanges: true,
      diagnostic: {
        classification: "credential-literal",
      },
    });

    controller.queue(document);
    await controller.flush();
    expect(controller.getState()).toMatchObject({
      status: "unavailable",
      code: "quota-exceeded",
      hasPendingChanges: true,
    });

    controller.queue(document);
    await controller.flush();
    expect(controller.getState()).toMatchObject({
      status: "unavailable",
      code: "capacity-exceeded",
      hasPendingChanges: true,
    });
    expect(store.requests).toHaveLength(3);
  });

  it("dispose cancels trailing work and ignores later notices", async () => {
    const scheduler = new TestScheduler();
    const currentHead = head(1);
    const store = new RecordingRecoveryStore(() =>
      Promise.resolve({
        status: "unchanged",
        head: currentHead,
      }),
    );
    const { binding, document } = recoveryFixture("autosave-dispose");
    const controller = createEditorRecoveryAutosaveController({
      binding,
      initialHead: currentHead,
      scheduler,
      store,
      writerId: "writer_dispose",
    });

    controller.queue(document);
    const stateBeforeDispose = controller.getState();
    controller.dispose();
    expect(scheduler.size).toBe(0);
    scheduler.runAll();
    await controller.flush();
    store.emit({
      kind: "discard",
      scopeFingerprint: binding.scopeFingerprint,
      writerId: "writer_other",
    });
    controller.queue(document);
    expect(store.requests).toHaveLength(0);
    expect(controller.getState()).toBe(stateBeforeDispose);
  });
});
