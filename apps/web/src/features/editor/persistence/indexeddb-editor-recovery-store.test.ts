import { describe, expect, it } from "vitest";
import { getArchitectureDocumentHashes } from "@cloudmarkup/domain";

import { loadFoundationArchitectureDocument } from "../model/foundation-editor-fixture.js";
import { dispatchMoveNodeCommand } from "../model/move-node-command.js";
import { createEditorRecoveryBindingV1 } from "./editor-recovery-envelope.js";
import type {
  EditorRecoveryBindingV1,
  EditorRecoveryHead,
  EditorRecoveryHeadNotice,
} from "./editor-recovery-store.js";
import { createIndexedDbEditorRecoveryStore } from "./indexeddb-editor-recovery-store.js";

import {
  MemoryIndexedDb,
  structuredCopy,
} from "./indexeddb-recovery.test-support.js";

interface TestChannel {
  close(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
}

class MemoryBroadcastHub {
  readonly #channels = new Map<string, Set<TestChannel>>();

  public createChannel = (name: string): TestChannel => {
    const peers = this.#channels.get(name) ?? new Set<TestChannel>();
    const channel: TestChannel = {
      close: () => {
        peers.delete(channel);
      },
      onmessage: null,
      postMessage: (message) => {
        for (const peer of peers) {
          if (peer === channel) {
            continue;
          }
          const copy = structuredCopy(message);
          queueMicrotask(() => {
            peer.onmessage?.({ data: copy } as MessageEvent<unknown>);
          });
        }
      },
    };
    peers.add(channel);
    this.#channels.set(name, peers);
    return channel;
  };
}

function sequentialIds(prefix: string): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `${prefix}_${String(sequence)}`;
  };
}

function createBinding(scopeKey: string): Readonly<{
  binding: EditorRecoveryBindingV1;
  document: ReturnType<typeof loadFoundationArchitectureDocument>;
}> {
  const document = loadFoundationArchitectureDocument();
  return {
    binding: createEditorRecoveryBindingV1({
      scopeKey,
      seedDocument: document,
    }),
    document,
  };
}

function movedDocument(
  document: ReturnType<typeof loadFoundationArchitectureDocument>,
  x: number,
  y: number,
  prefix: string,
): ReturnType<typeof loadFoundationArchitectureDocument> {
  return dispatchMoveNodeCommand({
    createId: sequentialIds(prefix),
    document,
    nodeId: "node_application",
    position: { x, y },
  }).document;
}

function checkpointRequest(
  binding: EditorRecoveryBindingV1,
  document: ReturnType<typeof loadFoundationArchitectureDocument>,
  expectedHead: EditorRecoveryHead | null,
  writerId: string,
) {
  return {
    binding,
    document,
    expectedHead,
    savedAt: "2026-07-30T12:00:00.000Z",
    writerId,
  } as const;
}

describe("IndexedDB editor recovery store", () => {
  it("owns request and aborted-transaction failures in every recovery operation", async () => {
    for (const operation of [
      "load",
      "checkpoint",
      "discard",
      "remediate",
    ] as const) {
      // The write controls get through the initial read before failing. Every
      // failing request also rejects the independently observed transaction.
      for (const successfulRequests of operation === "load" ? [0] : [0, 1]) {
        const memory = new MemoryIndexedDb();
        const store = createIndexedDbEditorRecoveryStore({
          indexedDb: memory.factory,
          createBroadcastChannel: null,
          databaseName: "synthetic-request-abort",
        });
        const { binding, document } = createBinding("scope-request-abort");
        const first = await store.checkpoint(
          checkpointRequest(binding, document, null, "writer_one"),
        );
        if (first.status !== "stored")
          throw new Error("Expected synthetic checkpoint");
        const changed = movedDocument(document, 240, 320, "request_abort");
        if (operation === "remediate")
          memory.mutate(binding.scopeFingerprint, (record) => {
            record.latest.canonicalDocument = "{broken";
          });
        const before = await store.load(binding);
        memory.failRequestAfter(successfulRequests);
        const result =
          operation === "load"
            ? await store.load(binding)
            : operation === "checkpoint"
              ? await store.checkpoint(
                  checkpointRequest(binding, changed, first.head, "writer_one"),
                )
              : operation === "discard"
                ? await store.discard({
                    binding,
                    expectedHead: first.head,
                    writerId: "writer_one",
                  })
                : before.status === "rejected"
                  ? await store.remediateRejected({
                      action: "replace",
                      binding,
                      document: changed,
                      expectedClassification: before.classification,
                      expectedHead: first.head,
                      savedAt: "2026-07-30T12:30:00.000Z",
                      writerId: "writer_one",
                    })
                  : undefined;
        expect(result).toMatchObject({
          status: "unavailable",
          code: "database-error",
        });
        // Let the aborted transaction and unhandled-rejection turn complete;
        // Vitest must report no unhandled error and the prior bytes survive.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(await store.load(binding)).toEqual(before);
        store.close();
      }
    }
  });

  it("uses strict CAS and retains one prior validated checkpoint for corrupt recovery", async () => {
    const memory = new MemoryIndexedDb();
    const store = createIndexedDbEditorRecoveryStore({
      indexedDb: memory.factory,
      createBroadcastChannel: null,
      databaseName: "recovery-cas",
    });
    const { binding, document } = createBinding("scope-cas");

    const first = await store.checkpoint(
      checkpointRequest(binding, document, null, "writer_one"),
    );
    expect(first.status).toBe("stored");
    if (first.status !== "stored") {
      throw new Error("Expected the first checkpoint to be stored.");
    }
    expect(first.head.generation).toBe(1);
    expect(await store.load(binding)).toMatchObject({
      status: "ready",
      head: first.head,
    });

    const unchanged = await store.checkpoint(
      checkpointRequest(binding, document, first.head, "writer_one"),
    );
    expect(unchanged).toEqual({
      status: "unchanged",
      head: first.head,
    });

    const moved = movedDocument(document, 240, 320, "recovery_move");
    const second = await store.checkpoint(
      checkpointRequest(binding, moved, first.head, "writer_two"),
    );
    expect(second.status).toBe("stored");
    if (second.status !== "stored") {
      throw new Error("Expected the second checkpoint to be stored.");
    }
    expect(second.head.generation).toBe(2);

    const stale = await store.checkpoint(
      checkpointRequest(
        binding,
        movedDocument(document, 480, 360, "recovery_stale"),
        first.head,
        "writer_stale",
      ),
    );
    expect(stale).toEqual({
      status: "conflict",
      actualHead: second.head,
      expectedHead: first.head,
    });

    memory.mutate(binding.scopeFingerprint, (record) => {
      record.latest.canonicalDocument = "{broken";
    });
    const rejected = await store.load(binding);
    expect(rejected.status).toBe("rejected");
    if (rejected.status !== "rejected") {
      throw new Error("Expected a rejected corrupt checkpoint.");
    }
    expect(rejected.actualHead).toEqual(second.head);
    const previous = rejected.previousValidCheckpoint;
    expect(previous?.head).toEqual(first.head);
    if (previous === undefined) {
      throw new Error("Expected one prior validated checkpoint.");
    }
    expect(getArchitectureDocumentHashes(previous.document)).toEqual(
      getArchitectureDocumentHashes(document),
    );

    await expect(
      store.remediateRejected({
        action: "replace",
        binding,
        document,
        expectedClassification: rejected.classification,
        expectedHead: first.head,
        savedAt: "2026-07-30T12:30:00.000Z",
        writerId: "writer_stale_recovery",
      }),
    ).resolves.toEqual({
      status: "conflict",
      actualClassification: rejected.classification,
      actualHead: second.head,
      expectedClassification: rejected.classification,
      expectedHead: first.head,
    });

    const refusedNormalOverwrite = await store.checkpoint(
      checkpointRequest(binding, document, second.head, "writer_recover"),
    );
    expect(refusedNormalOverwrite).toMatchObject({
      status: "rejected",
      diagnostic: {
        classification: rejected.classification,
      },
    });

    const recovered = await store.remediateRejected({
      action: "replace",
      binding,
      document,
      expectedClassification: rejected.classification,
      expectedHead: second.head,
      savedAt: "2026-07-30T12:30:00.000Z",
      writerId: "writer_recover",
    });
    expect(recovered.status).toBe("stored");
    if (recovered.status !== "stored") {
      throw new Error("Expected the prior checkpoint to be recovered.");
    }
    expect(recovered.head.generation).toBe(3);
    const reloaded = await store.load(binding);
    expect(reloaded.status).toBe("ready");
    if (reloaded.status === "ready") {
      expect(getArchitectureDocumentHashes(reloaded.document)).toEqual(
        getArchitectureDocumentHashes(document),
      );
      expect(reloaded.head).toEqual(recovered.head);
    }

    memory.mutate(binding.scopeFingerprint, (record) => {
      record.latest.schemaVersion = 2;
    });
    const future = await store.load(binding);
    expect(future).toMatchObject({
      status: "rejected",
      classification: "envelope-unsupported-future",
      actualHead: recovered.head,
    });
    await expect(
      store.checkpoint(
        checkpointRequest(
          binding,
          moved,
          recovered.head,
          "writer_future_overwrite",
        ),
      ),
    ).resolves.toMatchObject({
      status: "rejected",
      diagnostic: {
        classification: "envelope-unsupported-future",
      },
    });
  });

  it("enforces bounded scope capacity and compare-and-swap discard", async () => {
    const memory = new MemoryIndexedDb();
    const store = createIndexedDbEditorRecoveryStore({
      indexedDb: memory.factory,
      createBroadcastChannel: null,
      databaseName: "recovery-capacity",
      maximumScopes: 1,
    });
    const firstScope = createBinding("scope-capacity-one");
    const secondScope = createBinding("scope-capacity-two");

    const first = await store.checkpoint(
      checkpointRequest(
        firstScope.binding,
        firstScope.document,
        null,
        "writer_capacity",
      ),
    );
    expect(first.status).toBe("stored");
    if (first.status !== "stored") {
      throw new Error("Expected the first bounded scope to be stored.");
    }
    await expect(
      store.checkpoint(
        checkpointRequest(
          secondScope.binding,
          secondScope.document,
          null,
          "writer_capacity",
        ),
      ),
    ).resolves.toEqual({
      status: "capacity-exceeded",
      maximumScopes: 1,
    });

    const staleHead = {
      ...first.head,
      generation: first.head.generation + 1,
    };
    await expect(
      store.discard({
        binding: firstScope.binding,
        expectedHead: staleHead,
        writerId: "writer_capacity",
      }),
    ).resolves.toEqual({
      status: "conflict",
      actualHead: first.head,
      expectedHead: staleHead,
    });
    await expect(
      store.discard({
        binding: firstScope.binding,
        expectedHead: first.head,
        writerId: "writer_capacity",
      }),
    ).resolves.toEqual({ status: "discarded" });
    await expect(store.load(firstScope.binding)).resolves.toEqual({
      status: "empty",
    });

    const second = await store.checkpoint(
      checkpointRequest(
        secondScope.binding,
        secondScope.document,
        null,
        "writer_capacity",
      ),
    );
    expect(second.status).toBe("stored");
    if (second.status !== "stored") {
      throw new Error("Expected the second scope after capacity was released.");
    }

    memory.replaceField(
      secondScope.binding.scopeFingerprint,
      "latest",
      "corrupt-envelope",
    );
    await expect(store.load(secondScope.binding)).resolves.toMatchObject({
      status: "rejected",
      classification: "envelope-malformed",
      actualHead: second.head,
    });

    memory.replaceField(
      secondScope.binding.scopeFingerprint,
      "schemaVersion",
      2,
    );
    await expect(store.load(secondScope.binding)).resolves.toMatchObject({
      status: "rejected",
      classification: "envelope-unsupported-future",
      actualHead: second.head,
    });
    await expect(
      store.discard({
        binding: secondScope.binding,
        expectedHead: second.head,
        writerId: "writer_capacity",
      }),
    ).resolves.toEqual({ status: "discarded" });
  });

  it("remediates a headless corrupt record explicitly and conflicts with an intervening valid replacement", async () => {
    const memory = new MemoryIndexedDb();
    const store = createIndexedDbEditorRecoveryStore({
      indexedDb: memory.factory,
      createBroadcastChannel: null,
      databaseName: "recovery-headless-remediation",
    });
    const { binding, document } = createBinding("scope-headless-remediation");

    memory.setRaw(binding.scopeFingerprint, "malformed-record");
    const rejected = await store.load(binding);
    expect(rejected).toMatchObject({
      status: "rejected",
      classification: "envelope-malformed",
    });
    if (rejected.status !== "rejected") {
      throw new Error("Expected a headless rejected record.");
    }
    expect(rejected.actualHead).toBeUndefined();

    const recovered = await store.remediateRejected({
      action: "replace",
      binding,
      document,
      expectedClassification: rejected.classification,
      expectedHead: rejected.actualHead ?? null,
      savedAt: "2026-07-30T13:00:00.000Z",
      writerId: "writer_explicit_recovery",
    });
    expect(recovered.status).toBe("stored");
    if (recovered.status !== "stored") {
      throw new Error("Expected explicit headless recovery to be stored.");
    }
    expect(recovered.head.generation).toBe(1);
    await expect(store.load(binding)).resolves.toMatchObject({
      status: "ready",
      head: recovered.head,
    });

    const staleDiscard = await store.remediateRejected({
      action: "discard",
      binding,
      expectedClassification: rejected.classification,
      expectedHead: null,
      writerId: "writer_stale_discard",
    });
    expect(staleDiscard).toEqual({
      status: "conflict",
      actualClassification: "ready",
      actualHead: recovered.head,
      expectedClassification: rejected.classification,
      expectedHead: null,
    });

    memory.setRaw(binding.scopeFingerprint, { schemaVersion: 99 });
    const secondRejected = await store.load(binding);
    expect(secondRejected).toMatchObject({
      status: "rejected",
      classification: "envelope-unsupported-future",
    });
    if (secondRejected.status !== "rejected") {
      throw new Error("Expected the future headless record to be rejected.");
    }
    await expect(
      store.remediateRejected({
        action: "discard",
        binding,
        expectedClassification: secondRejected.classification,
        expectedHead: secondRejected.actualHead ?? null,
        writerId: "writer_explicit_discard",
      }),
    ).resolves.toEqual({ status: "discarded" });
    await expect(store.load(binding)).resolves.toEqual({ status: "empty" });
  });

  it("broadcasts bounded head notices while leaving CAS authoritative", async () => {
    const memory = new MemoryIndexedDb();
    const hub = new MemoryBroadcastHub();
    const common = {
      indexedDb: memory.factory,
      createBroadcastChannel: hub.createChannel,
      databaseName: "recovery-notices",
    } as const;
    const writer = createIndexedDbEditorRecoveryStore(common);
    const observer = createIndexedDbEditorRecoveryStore(common);
    const { binding, document } = createBinding("scope-notices");
    const notices: EditorRecoveryHeadNotice[] = [];
    const unsubscribe = observer.subscribe(binding, (notice) => {
      notices.push(notice);
    });

    const stored = await writer.checkpoint(
      checkpointRequest(binding, document, null, "writer_notice"),
    );
    expect(stored.status).toBe("stored");
    await Promise.resolve();
    expect(notices).toEqual([
      {
        kind: "checkpoint",
        scopeFingerprint: binding.scopeFingerprint,
        writerId: "writer_notice",
        head: stored.status === "stored" ? stored.head : undefined,
      },
    ]);

    if (stored.status !== "stored") {
      throw new Error("Expected a stored checkpoint for discard.");
    }
    await writer.discard({
      binding,
      expectedHead: stored.head,
      writerId: "writer_notice",
    });
    await Promise.resolve();
    expect(notices.at(-1)).toEqual({
      kind: "discard",
      scopeFingerprint: binding.scopeFingerprint,
      writerId: "writer_notice",
    });

    unsubscribe();
    observer.close();
    writer.close();
  });

  it("reports unsupported and closed browser storage without throwing", async () => {
    const { binding, document } = createBinding("scope-unavailable");
    const unsupported = createIndexedDbEditorRecoveryStore({
      indexedDb: null,
      createBroadcastChannel: null,
    });
    await expect(unsupported.load(binding)).resolves.toMatchObject({
      status: "unavailable",
      code: "not-supported",
    });

    const memory = new MemoryIndexedDb();
    const closed = createIndexedDbEditorRecoveryStore({
      indexedDb: memory.factory,
      createBroadcastChannel: null,
    });
    closed.close();
    await expect(
      closed.checkpoint(
        checkpointRequest(binding, document, null, "writer_closed"),
      ),
    ).resolves.toMatchObject({
      status: "unavailable",
      code: "closed",
    });
  });
});
