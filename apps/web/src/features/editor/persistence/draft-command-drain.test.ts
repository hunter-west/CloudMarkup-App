import representative from "../../../../../../packages/test-fixtures/fixtures/architecture-document/v1/valid/representative.json";
import { describe, expect, it } from "vitest";
import {
  ApiClientError,
  type ProjectEditingLeaseProofV1,
} from "@cloudmarkup/api-contract";
import {
  applyGraphCommand,
  getArchitectureDocumentHashes,
  hashCanonicalValue,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import type {
  ArchitectureDocumentV3,
  GraphCommandV1,
} from "@cloudmarkup/schemas";
import { operationIdSchema } from "@cloudmarkup/schemas";
import {
  DraftCommandDrain,
  type CommandDraftHead,
  type DraftCommandRequest,
  type DraftCommandRecovery,
} from "./draft-command-drain.js";
import { DraftCommandCheckpoint } from "./draft-command-checkpoint.js";
import { MemoryIndexedDb } from "./indexeddb-recovery.test-support.js";

function head(): Promise<CommandDraftHead> {
  return Promise.resolve().then(() => {
    const document = parseArchitectureDocument(representative);
    return {
      draft: {
        architectureDocument: document,
        contentDigest: getArchitectureDocumentHashes(document).contentHash,
        id: required(document.revision.sourceDraftId),
        projectId: "project_drain",
        updatedAt: "2026-11-11T17:00:00.000Z",
        version: 1,
      },
      etag: '"draft:fixture:v1"',
    };
  });
}
const lease: ProjectEditingLeaseProofV1 = {
  leaseId: "projectlease_11111111-1111-1111-1111-111111111111",
  token: "a".repeat(42) + "A",
};
function move(
  document: ArchitectureDocumentV3,
  id: string,
  x: number,
): GraphCommandV1 {
  const node = required(document.nodes[0]);
  return {
    schemaVersion: 1,
    commandId: operationIdSchema.parse(id),
    inverseCommandId: operationIdSchema.parse(id + "_inverse"),
    origin: "user",
    target: {
      documentId: document.documentId,
      architectureId: document.architectureId,
      revisionId: document.revision.revisionId,
    },
    kind: "move-node",
    nodeId: node.id,
    expectedPosition: structuredClone(node.presentation.position),
    position: { ...node.presentation.position, x },
  };
}
function response(baseline: CommandDraftHead, request: DraftCommandRequest) {
  const document = applyGraphCommand(
    baseline.draft.architectureDocument,
    request.body.command,
  ).document;
  return {
    value: {
      appliedCommandId: request.body.command.commandId,
      draft: {
        ...baseline.draft,
        architectureDocument: document,
        version: baseline.draft.version + 1,
      },
    },
    etag: `"draft:fixture:v${String(baseline.draft.version + 1)}"`,
  };
}
describe("draft command drain", () => {
  it("retires acknowledged queues across more than 32 scopes while retaining pending work and stale-writer fencing", async () => {
    const db = new MemoryIndexedDb(),
      original = await head();
    for (let index = 0; index < 40; index++) {
      const scope = [
        "principal_one",
        "org_one",
        "project_" + String(index),
        original.draft.id,
      ] as const;
      const baseline = {
        ...original,
        draft: { ...original.draft, projectId: scope[2] },
      };
      const checkpoint = new DraftCommandCheckpoint(
        scope,
        baseline,
        db.factory,
      );
      await checkpoint.load();
      const drain = new DraftCommandDrain(baseline);
      drain.enqueue(
        move(
          baseline.draft.architectureDocument,
          "command_sequential_" + String(index),
          310,
        ),
        "request-sequential-" + String(index),
      );
      await drain.flush({
        editingLease: () => lease,
        isCurrent: () => true,
        checkpoint: (data) => checkpoint.save(data),
        send: (request) => Promise.resolve(response(baseline, request)),
      });
      expect(
        await new DraftCommandCheckpoint(scope, baseline, db.factory).load(),
      ).toBeNull();
      checkpoint.close();
    }
    const scope = [
      "principal_one",
      "org_one",
      original.draft.projectId,
      original.draft.id,
    ] as const;
    const stale = new DraftCommandCheckpoint(scope, original, db.factory),
      writer = new DraftCommandCheckpoint(scope, original, db.factory);
    await stale.load();
    await writer.load();
    const pending = new DraftCommandDrain(original);
    pending.enqueue(
      move(original.draft.architectureDocument, "command_still_pending", 320),
      "request-still-pending",
    );
    await writer.save(pending.recovery());
    await expect(
      stale.save(new DraftCommandDrain(original).recovery()),
    ).rejects.toThrow("Another tab");
    expect((await writer.load())?.pending).toHaveLength(1);
  });
  it("reclaims legacy completed records but refuses to evict 32 unresolved scopes", async () => {
    const original = await head(),
      db = new MemoryIndexedDb();
    const recovery = new DraftCommandDrain(original).recovery();
    for (let index = 0; index < 32; index++) {
      const key = hashCanonicalValue(["legacy", String(index)]);
      db.setRaw(key, {
        key,
        generation: 1,
        digest: hashCanonicalValue(recovery),
        latest: recovery,
        previous: null,
      });
    }
    for (let index = 0; index < 32; index++) {
      const scope = [
        "principal_one",
        "org_one",
        "project_pending_" + String(index),
        original.draft.id,
      ] as const;
      const baseline = {
        ...original,
        draft: { ...original.draft, projectId: scope[2] },
      };
      const checkpoint = new DraftCommandCheckpoint(
        scope,
        baseline,
        db.factory,
      );
      await checkpoint.load();
      const drain = new DraftCommandDrain(baseline);
      drain.enqueue(
        move(
          baseline.draft.architectureDocument,
          "command_pending_" + String(index),
          310,
        ),
        "request-pending-" + String(index),
      );
      await checkpoint.save(drain.recovery());
    }
    const last = new DraftCommandCheckpoint(
      ["principal_one", "org_one", original.draft.projectId, original.draft.id],
      original,
      db.factory,
    );
    await last.load();
    const drain = new DraftCommandDrain(original);
    drain.enqueue(
      move(original.draft.architectureDocument, "command_over_capacity", 315),
      "request-over-capacity",
    );
    await expect(last.save(drain.recovery())).rejects.toThrow("full");
    const retained = await new DraftCommandCheckpoint(
      ["principal_one", "org_one", "project_pending_0", original.draft.id],
      {
        ...original,
        draft: { ...original.draft, projectId: "project_pending_0" },
      },
      db.factory,
    ).load();
    expect(retained?.pending).toHaveLength(1);
  });
  it.each(["latest", "digest"] as const)(
    "quarantines rejected %s with valid previous recovery and resolves a lost reset acknowledgement without replacing a competitor",
    async (field) => {
      const original = await head(),
        db = new MemoryIndexedDb();
      const scope = [
        "principal_one",
        "org_one",
        original.draft.projectId,
        original.draft.id,
      ] as const;
      const first = new DraftCommandCheckpoint(scope, original, db.factory),
        drain = new DraftCommandDrain(original);
      await first.load();
      const local = drain.enqueue(
        move(original.draft.architectureDocument, "command_reset_first", 310),
        "request-reset-first",
      );
      await first.save(drain.recovery());
      const previous = drain.recovery();
      drain.enqueue(
        move(local, "command_reset_second", 320),
        "request-reset-second",
      );
      await first.save(drain.recovery());
      db.replaceField(
        hashCanonicalValue(scope),
        field,
        field === "latest" ? null : "sha256:" + "f".repeat(64),
      );
      const rejected = new DraftCommandCheckpoint(scope, original, db.factory),
        competitor = new DraftCommandCheckpoint(scope, original, db.factory);
      await expect(rejected.load()).rejects.toThrow();
      await expect(competitor.load()).rejects.toThrow();
      expect(rejected.previousValid).toEqual(previous);
      const before = await rejected.evidence(),
        fresh = new DraftCommandDrain(original).recovery();
      db.failNextCommit();
      await expect(rejected.reset(fresh)).rejects.toThrow("not acknowledged");
      expect(await rejected.evidence()).toEqual(before);
      db.loseNextCommitAcknowledgement();
      await expect(rejected.reset(fresh)).rejects.toThrow("not acknowledged");
      await expect(rejected.reset(fresh)).resolves.toBeUndefined();
      const evidence = await rejected.evidence();
      expect(evidence).toMatchObject({
        quarantines: [{ record: (before as { record: unknown }).record }],
      });
      expect((evidence as { quarantines: unknown[] }).quarantines).toHaveLength(
        1,
      );
      await expect(competitor.reset(previous)).rejects.toThrow("Another tab");
      expect(await rejected.evidence()).toEqual(evidence);
      await rejected.load();
      await rejected.reset(previous);
      expect((await rejected.load())?.pending).toHaveLength(1);
    },
  );
  it("closes command-store connections on cross-tab deletion and prevents a stale tab from recreating recovery", async () => {
    const original = await head(),
      db = new MemoryIndexedDb();
    const scope = [
      "principal_one",
      "org_one",
      original.draft.projectId,
      original.draft.id,
    ] as const;
    const first = new DraftCommandCheckpoint(scope, original, db.factory),
      second = new DraftCommandCheckpoint(scope, original, db.factory);
    await first.load();
    await second.load();
    expect(db.openConnections).toBe(2);
    db.requestVersionChange();
    expect(db.openConnections).toBe(0);
    await expect(
      first.save(new DraftCommandDrain(original).recovery()),
    ).rejects.toThrow("cleared or changed");
    await expect(second.load()).rejects.toThrow("cleared or changed");
  });
  it("reconciles a lost checkpoint acknowledgement and refuses stale writers, other scopes and corrupted history", async () => {
    const original = await head(),
      drain = new DraftCommandDrain(original),
      db = new MemoryIndexedDb();
    const scope = [
      "principal_one",
      "org_one",
      original.draft.projectId,
      original.draft.id,
    ] as const;
    const first = new DraftCommandCheckpoint(scope, original, db.factory);
    expect(await first.load()).toBeNull();
    const local = drain.enqueue(
      move(original.draft.architectureDocument, "command_store_one", 310),
      "request-store-first-0001",
    );
    db.loseNextCommitAcknowledgement();
    await expect(first.save(drain.recovery())).rejects.toThrow(
      "not acknowledged",
    );
    await expect(first.save(drain.recovery())).resolves.toBeUndefined();
    const stale = new DraftCommandCheckpoint(scope, original, db.factory),
      stored = await stale.load();
    expect(stored?.document).toEqual(local);
    const changed = drain.enqueue(
      move(local, "command_store_two", 320),
      "request-store-second-0001",
    );
    await first.save(drain.recovery());
    await expect(stale.save(required(stored))).rejects.toThrow("Another tab");
    expect((await stale.load())?.document).toEqual(changed);
    expect(
      await new DraftCommandCheckpoint(
        [
          "principal_other",
          "org_one",
          original.draft.projectId,
          original.draft.id,
        ],
        original,
        db.factory,
      ).load(),
    ).toBeNull();
    const corrupt = structuredClone(drain.recovery());
    required(corrupt.document.nodes[0]).presentation.position.x = 999;
    db.replaceField(hashCanonicalValue(scope), "latest", corrupt);
    await expect(stale.load()).rejects.toThrow("does not reproduce");
    await expect(first.save(drain.recovery())).rejects.toThrow("inconsistent");
    first.close();
    stale.close();
  });
  it("restores the same original request after a lost committed response and refuses substituted history", async () => {
    const original = await head(),
      drain = new DraftCommandDrain(original);
    const command = move(
      original.draft.architectureDocument,
      "command_restore",
      444,
    );
    drain.enqueue(command, "request-restore-0001");
    let stored: DraftCommandRecovery | undefined;
    let accepted: ReturnType<typeof response> | undefined;
    const requests: DraftCommandRequest[] = [];
    await expect(
      drain.flush({
        editingLease: () => lease,
        isCurrent: () => true,
        checkpoint: (data) => {
          return Promise.resolve().then(() => {
            stored = structuredClone(data);
          });
        },
        send: (request) => {
          return Promise.resolve().then(() => {
            requests.push(request);
            accepted = response(original, request);
            throw new Error("ack-lost");
          });
        },
      }),
    ).rejects.toThrow("ack-lost");
    expect(stored?.attempt?.originalEtag).toBe(original.etag);
    const restored = DraftCommandDrain.restore(stored, {
      draft: required(accepted).value.draft,
      etag: required(accepted).etag,
    });
    const result = await restored.flush({
      editingLease: () => lease,
      isCurrent: () => true,
      checkpoint: (data) => {
        return Promise.resolve().then(() => {
          stored = structuredClone(data);
        });
      },
      send: (request) => {
        return Promise.resolve().then(() => {
          requests.push(request);
          return required(accepted);
        });
      },
    });
    expect(requests[1]).toEqual(requests[0]);
    expect(result.draft.version).toBe(2);
    expect(stored?.pending).toEqual([]);
    expect(JSON.stringify(stored)).not.toContain(lease.token);
    const mismatched = structuredClone(drain.recovery());
    required(mismatched.document.nodes[0]).presentation.position.x = 999;
    expect(() => DraftCommandDrain.restore(mismatched, original)).toThrow(
      "does not reproduce",
    );
    expect(() =>
      DraftCommandDrain.restore(drain.recovery(), {
        ...original,
        draft: { ...original.draft, projectId: "project_other" },
      }),
    ).toThrow("another draft");
  });
  it("does not dispatch without its checkpoint and preserves an accepted command when acknowledgement checkpointing fails", async () => {
    const original = await head(),
      drain = new DraftCommandDrain(original);
    drain.enqueue(
      move(original.draft.architectureDocument, "command_checkpoint", 222),
      "request-checkpoint-0001",
    );
    let sends = 0,
      checkpoints = 0,
      failBefore = true,
      failAfter = true;
    const transport = {
      editingLease: () => lease,
      isCurrent: () => true,
      checkpoint: () => {
        return Promise.resolve().then(() => {
          checkpoints++;
          if (failBefore) throw new Error("checkpoint-before");
          if (sends > 0 && failAfter) throw new Error("checkpoint-after");
        });
      },
      send: (request: DraftCommandRequest) => {
        return Promise.resolve().then(() => {
          sends++;
          return response(original, request);
        });
      },
    };
    await expect(drain.flush(transport)).rejects.toThrow("checkpoint-before");
    expect(sends).toBe(0);
    expect(drain.recovery().pending).toHaveLength(1);
    failBefore = false;
    await expect(drain.flush(transport)).rejects.toThrow("checkpoint-after");
    expect(sends).toBe(1);
    expect(drain.recovery().baseline.draft.version).toBe(2);
    failAfter = false;
    await expect(drain.flush(transport)).resolves.toMatchObject({
      draft: { version: 2 },
    });
    expect(sends).toBe(1);
    expect(checkpoints).toBe(4);
  });
  it("delivers explicit undo and redo with distinct acceptance identities", async () => {
    const original = await head(),
      drain = new DraftCommandDrain(original);
    const forward = move(
      original.draft.architectureDocument,
      "command_history_forward",
      333,
    );
    const application = applyGraphCommand(
      original.draft.architectureDocument,
      forward,
    );
    if (application.inversion.kind !== "available")
      throw new Error("Expected inverse.");
    drain.enqueue(forward, "request-history-forward");
    expect(
      drain.enqueue(application.inversion.command, "request-history-undo"),
    ).toEqual(original.draft.architectureDocument);
    expect(() => drain.enqueue(forward, "request-history-reused")).toThrow(
      "new command/request identity",
    );
    // A redo is a NEW acceptance, not a retry of the original forward receipt.
    drain.enqueue(
      {
        ...forward,
        commandId: operationIdSchema.parse("command_history_redo"),
        inverseCommandId: operationIdSchema.parse(
          "command_history_redo_inverse",
        ),
      },
      "request-history-redo",
    );
    let server = original;
    const ids: string[] = [];
    const saved = await drain.flush({
      editingLease: () => lease,
      isCurrent: () => true,
      send: (request) => {
        return Promise.resolve().then(() => {
          ids.push(request.body.command.commandId);
          const result = response(server, request);
          server = { draft: result.value.draft, etag: result.etag };
          return result;
        });
      },
    });
    expect(ids).toEqual([
      forward.commandId,
      application.inversion.command.commandId,
      "command_history_redo",
    ]);
    expect(saved.draft.architectureDocument).toEqual(application.document);
    expect(saved.draft.version).toBe(4);
  });
  it("keeps ordered edits and the original attempt after a committed response is lost", async () => {
    const original = await head(),
      drain = new DraftCommandDrain(original),
      requests: DraftCommandRequest[] = [];
    const first = move(
      original.draft.architectureDocument,
      "command_drain_first",
      300,
    );
    const local = drain.enqueue(first, "request-drain-first-0001");
    let server = original,
      accepted: ReturnType<typeof response> | undefined,
      lost = true;
    const transport = {
      editingLease: () => lease,
      isCurrent: () => true,
      send: (request: DraftCommandRequest) => {
        return Promise.resolve().then(() => {
          requests.push(structuredClone(request));
          if (request.body.command.commandId === first.commandId) {
            accepted ??= response(original, request);
            server = { draft: accepted.value.draft, etag: accepted.etag };
            if (lost) {
              lost = false;
              drain.enqueue(
                move(local, "command_drain_second", 400),
                "request-drain-second-0001",
              );
              throw new Error("fixture-response-lost-after-commit");
            }
            return accepted;
          }
          const next = response(server, request);
          server = { draft: next.value.draft, etag: next.etag };
          return next;
        });
      },
    };
    await expect(drain.flush(transport)).rejects.toThrow("response-lost");
    expect(drain.recovery().pending).toHaveLength(2);
    expect(
      required(drain.recovery().document.nodes[0]).presentation.position.x,
    ).toBe(400);
    const saved = await drain.flush(transport);
    expect(requests.map((r) => r.body.command.commandId)).toEqual([
      first.commandId,
      first.commandId,
      "command_drain_second",
    ]);
    expect(requests[1]).toEqual(requests[0]);
    expect(required(requests[2]).headers["if-match"]).toBe(
      '"draft:fixture:v2"',
    );
    expect(saved.draft.version).toBe(3);
    expect(
      required(saved.draft.architectureDocument.nodes[0]).presentation.position
        .x,
    ).toBe(400);
    expect(drain.recovery().pending).toHaveLength(0);
    expect(JSON.stringify(drain.recovery())).not.toContain(lease.token);
  });
  it("joins one drain and retains the original command when the lease changes during acceptance", async () => {
    const original = await head(),
      drain = new DraftCommandDrain(original);
    drain.enqueue(
      move(original.draft.architectureDocument, "command_lease", 300),
      "request-lease-0001",
    );
    let proof = lease,
      calls = 0;
    const requests: DraftCommandRequest[] = [];
    const transport = {
      editingLease: () => proof,
      isCurrent: () => true,
      send: (request: DraftCommandRequest) => {
        return Promise.resolve().then(() => {
          requests.push(structuredClone(request));
          calls++;
          if (calls === 1) proof = { ...lease, token: "b".repeat(42) + "A" };
          return response(original, request);
        });
      },
    };
    const first = drain.flush(transport);
    expect(drain.flush(transport)).toBe(first);
    await expect(first).rejects.toMatchObject({
      reason: "editing-interrupted",
    });
    expect(drain.recovery().baseline.etag).toBe(original.etag);
    expect(drain.recovery().pending).toHaveLength(1);
    await drain.flush(transport);
    expect(required(requests[1]).headers).toEqual(
      required(requests[0]).headers,
    );
    expect(required(requests[1]).body.command).toEqual(
      required(requests[0]).body.command,
    );
    expect(required(requests[1]).body.contentBinding).toEqual(
      required(requests[0]).body.contentBinding,
    );
    expect(required(requests[1]).body.editingLease).toEqual(proof);
    expect(drain.recovery().pending).toHaveLength(0);
  });
  it("retains unsaved work and blocks automatic rebasing after typed stale-client or stale-head refusal", async () => {
    for (const code of [
      "precondition_failed",
      "unsupported_version",
    ] as const) {
      const original = await head(),
        drain = new DraftCommandDrain(original);
      drain.enqueue(
        move(original.draft.architectureDocument, "command_stale", 450),
        "request-stale-0001",
      );
      let calls = 0;
      const error = new ApiClientError(
        code === "precondition_failed" ? 412 : 422,
        {
          apiVersion: "v1",
          error: {
            code,
            correlationId: "correlation_stale",
            message: "Review the saved baseline.",
            fieldIssues: [
              {
                code: "draft.command-history-required",
                message: "Keep unsaved work.",
                path: ["body"],
              },
            ],
          },
        },
      );
      const transport = {
        editingLease: () => lease,
        isCurrent: () => true,
        send: () => {
          return Promise.resolve().then(() => {
            calls++;
            throw error;
          });
        },
      };
      await expect(drain.flush(transport)).rejects.toBe(error);
      await expect(drain.flush(transport)).rejects.toMatchObject({
        reason: "review-required",
      });
      expect(calls).toBe(1);
      expect(drain.recovery().pending).toHaveLength(1);
      expect(drain.recovery().attempt?.originalEtag).toBe(original.etag);
      expect(
        required(drain.recovery().document.nodes[0]).presentation.position.x,
      ).toBe(450);
      expect(JSON.stringify(drain.recovery())).not.toContain(lease.token);
    }
  });
  it("refuses mismatched receipts without clearing queued edits", async () => {
    const original = await head(),
      drain = new DraftCommandDrain(original);
    drain.enqueue(
      move(original.draft.architectureDocument, "command_receipt", 300),
      "request-receipt-0001",
    );
    await expect(
      drain.flush({
        editingLease: () => lease,
        isCurrent: () => true,
        send: (request) => {
          return Promise.resolve().then(() => {
            const result = response(original, request);
            return {
              ...result,
              value: { ...result.value, appliedCommandId: "other-command" },
            };
          });
        },
      }),
    ).rejects.toMatchObject({ reason: "receipt-mismatch" });
    expect(drain.recovery().pending).toHaveLength(1);
    expect(drain.recovery().reviewRequired).toBe(true);
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error("Required synthetic fixture value is missing.");
  return value;
}
