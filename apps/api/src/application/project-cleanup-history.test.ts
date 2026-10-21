import { cleanupRequired } from "../adapters/persistence/cleanup-required.js";
import { describe, it, expect, vi } from "vitest";
import {
  cleanupHistoryId,
  parseCleanupHistoryEnvelope,
  parseCleanupHistoryRecord,
  readCompleteCleanupHistory,
  type CleanupHistoryPort,
  type CleanupHistoryRecord,
  type CleanupHistoryEnvelope,
} from "./project-cleanup-history.js";
import {
  admitProjectDeletionWithCleanupWake,
  projectCleanupAdmissionWake,
} from "./project-cleanup-wake.js";
import type { ProjectRecord } from "./persistence.js";
const wake = projectCleanupAdmissionWake({
  organizationId: "org_test",
  projectId: "project_test",
  recordVersion: 2,
  deletionRequestedAt: "2026-10-03T00:00:00.000Z",
  admissionId: "a".repeat(64),
  admissionDeadline: "2026-10-03T00:01:00.000Z",
});
const envelope = parseCleanupHistoryEnvelope({
  kind: "admission",
  wake,
  principalId: "principal_test",
  idempotencyKeySha256: "b".repeat(64),
  requestSha256: "c".repeat(64),
  expectedRecordVersion: 1,
});
function memory() {
  const rows = new Map<string, CleanupHistoryRecord>();
  const events: string[] = [];
  const history: CleanupHistoryPort = {
    prepare: async (e) => {
      await Promise.resolve();
      events.push("prepare-history");
      const id = cleanupHistoryId(e),
        r = rows.get(id);
      if (r !== undefined && JSON.stringify(r.envelope) !== JSON.stringify(e))
        throw Error("immutable");
      if (r === undefined) rows.set(id, { envelope: e, state: "prepared" });
    },
    read: async (id) => {
      await Promise.resolve();
      events.push("strong-history");
      return rows.get(id) ?? null;
    },
    transition: async (e, from, to, completion) => {
      await Promise.resolve();
      events.push(to);
      const id = cleanupHistoryId(e),
        prior = rows.get(id);
      if (prior?.state === to) return;
      if (prior?.state !== from) throw Error("conflict");
      rows.set(id, {
        envelope: e,
        state: to,
        ...(completion === undefined ? {} : { completion }),
      });
    },
    page: async (n) =>
      await Promise.resolve({
        records: [...rows.values()].filter(
          (r) =>
            parseInt(cleanupRequired(cleanupHistoryId(r.envelope)[0]), 16) %
              4 ===
            n,
        ),
      }),
  };
  return { rows, events, history };
}
function fixture() {
  const f = memory(),
    ledger = {
      put: vi.fn(async () => {
        await Promise.resolve();
        f.events.push("wake");
      }),
      get: vi.fn(() => Promise.resolve(wake)),
    },
    commit = vi.fn(async () => {
      await Promise.resolve();
      f.events.push("sql-commit");
      return {
        lifecycleStatus: "deletion-pending",
        recordVersion: 2,
      } as ProjectRecord;
    }),
    publisher = {
      send: vi.fn(async () => {
        await Promise.resolve();
        f.events.push("kick");
      }),
    };
  return {
    ...f,
    commit,
    ledger,
    publisher,
    run: () =>
      admitProjectDeletionWithCleanupWake({
        prepare: () => Promise.resolve(wake),
        commit,
        ledger,
        publisher,
        history: f.history,
        envelope: async () => {
          await Promise.resolve();
          if (envelope.kind !== "admission") throw Error("fixture");
          return envelope;
        },
      }),
  };
}
describe("retained deletion history admission and complete inventory", () => {
  it("records exact preparation before SQL and confirms committed history before acknowledgment", async () => {
    const f = fixture();
    await f.run();
    expect(f.events.indexOf("prepare-history")).toBeLessThan(
      f.events.indexOf("wake"),
    );
    expect(f.events.indexOf("wake")).toBeLessThan(
      f.events.indexOf("sql-commit"),
    );
    expect(f.events.indexOf("sql-commit")).toBeLessThan(
      f.events.indexOf("committed"),
    );
    expect(f.events.at(-1)).toBe("kick");
    expect(f.rows.get(wake.wakeId)?.state).toBe("committed");
  });
  it("a failed durable preparation cannot invoke deletion commit", async () => {
    const f = fixture();
    f.history.prepare = async () => {
      await Promise.resolve();
      throw Error("unavailable");
    };
    await expect(f.run()).rejects.toThrow();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.ledger.put).not.toHaveBeenCalled();
  });
  it("a failed commit response leaves preparation and wake, without blind replay", async () => {
    const f = fixture();
    f.commit.mockRejectedValueOnce(Error("ambiguous SQL commit"));
    await expect(f.run()).rejects.toThrow();
    expect(f.commit).toHaveBeenCalledOnce();
    expect(f.rows.get(wake.wakeId)?.state).toBe("prepared");
    expect(f.publisher.send).not.toHaveBeenCalled();
  });
  it("cannot acknowledge SQL success without retained committed history", async () => {
    const f = fixture();
    f.history.transition = async () => {
      await Promise.resolve();
      throw Error("history unavailable");
    };
    await expect(f.run()).rejects.toThrow();
    expect(f.commit).toHaveBeenCalledOnce();
    expect(f.rows.get(wake.wakeId)?.state).toBe("prepared");
    expect(f.publisher.send).not.toHaveBeenCalled();
  });
  it("failed strong committed readback cannot acknowledge or kick", async () => {
    const f = fixture(),
      read = f.history.read.bind(f.history);
    f.history.read = async (id) => {
      const r = await read(id);
      return r?.state === "committed" ? null : r;
    };
    await expect(f.run()).rejects.toThrow();
    expect(f.rows.get(wake.wakeId)?.state).toBe("committed");
    expect(f.publisher.send).not.toHaveBeenCalled();
  });
  it("lost queue kick preserves accepted deletion and permanent history", async () => {
    const f = fixture();
    f.publisher.send.mockRejectedValueOnce(Error("lost"));
    await expect(f.run()).resolves.toMatchObject({ recordVersion: 2 });
    expect(f.rows.get(wake.wakeId)?.state).toBe("committed");
    expect(await readCompleteCleanupHistory(f.history)).toHaveLength(1);
  });
  it("terminal aborted history never permits SQL admission", async () => {
    const f = fixture();
    f.rows.set(wake.wakeId, { envelope, state: "aborted" });
    await expect(f.run()).rejects.toThrow();
    expect(f.commit).not.toHaveBeenCalled();
  });
  it("wrong retained principal or request digest rejects before SQL", async () => {
    const f = fixture();
    const wrong = parseCleanupHistoryEnvelope({
      ...envelope,
      principalId: "other",
    });
    f.rows.set(wake.wakeId, { envelope: wrong, state: "prepared" });
    await expect(f.run()).rejects.toThrow();
    expect(f.commit).not.toHaveBeenCalled();
  });
  it("reads every shard and rejects a repeated cursor", async () => {
    const f = memory();
    await f.history.prepare(envelope);
    const page = vi.spyOn(f.history, "page");
    await expect(readCompleteCleanupHistory(f.history)).resolves.toHaveLength(
      1,
    );
    expect(page.mock.calls.map(([n]) => n)).toEqual([0, 1, 2, 3]);
    f.history.page = async () =>
      await Promise.resolve({ records: [], nextCursor: "a".repeat(64) });
    await expect(readCompleteCleanupHistory(f.history)).rejects.toThrow(
      /advance/,
    );
  });
  it("overflow and duplicate records are never full-history proof", async () => {
    const f = memory();
    await f.history.prepare(envelope);
    f.history.page = async () =>
      await Promise.resolve({
        records: [
          { envelope, state: "prepared" },
          { envelope, state: "prepared" },
        ],
      });
    await expect(readCompleteCleanupHistory(f.history)).rejects.toThrow();
    const second = projectCleanupAdmissionWake({
      organizationId: wake.organizationId,
      projectId: wake.projectId,
      recordVersion: 2,
      deletionRequestedAt: wake.deletionRequestedAt,
      admissionId: "b".repeat(64),
      admissionDeadline: wake.admissionDeadline,
    });
    const other = parseCleanupHistoryEnvelope({ ...envelope, wake: second });
    f.history.page = async () =>
      await Promise.resolve({
        records: [
          { envelope, state: "prepared" },
          { envelope: other, state: "prepared" },
        ],
      });
    await expect(readCompleteCleanupHistory(f.history, 1)).rejects.toThrow(
      /bound/,
    );
  });
  it("rejects content, invented financial outcomes, and invalid state combinations", () => {
    expect(() =>
      parseCleanupHistoryEnvelope({ ...envelope, labels: ["private"] }),
    ).toThrow();
    expect(() =>
      parseCleanupHistoryRecord({
        envelope,
        state: "completed",
        completion: { objectVersion: "v1" },
      }),
    ).toThrow();
    expect(() =>
      parseCleanupHistoryRecord({ envelope, state: "committed", amount: 0 }),
    ).toThrow();
  });
  it("requires exact recovery metadata only for the dedicated recovery namespace", () => {
    const writer: CleanupHistoryEnvelope = {
      kind: "write",
      writeId: "write_test",
      organizationId: "org_test",
      projectId: "project_test",
      objectId: "object_test",
      contentSha256: "a".repeat(64),
      sizeBytes: 1,
      purpose: "report",
      mediaType: "application/json",
      storageNamespace: "documents",
      principalId: "principal_test",
    };
    expect(() =>
      parseCleanupHistoryEnvelope({
        ...writer,
        storageNamespace: "deletion-recovery",
      }),
    ).toThrow();
    expect(() =>
      parseCleanupHistoryRecord({
        envelope: writer,
        state: "issued",
        completion: { objectVersion: "v" },
      }),
    ).toThrow();
  });
});
