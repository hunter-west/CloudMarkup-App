import { describe, expect, it, vi } from "vitest";
import {
  createCleanupWakeDispatcher,
  createCleanupWakeNotifier,
  createCleanupWakeProcessor,
  parseProjectCleanupWake,
  projectCleanupWake,
  type CleanupWakeLedger,
  type ProjectCleanupWake,
} from "./project-cleanup-wake.js";
import type { ProjectRecord } from "./persistence.js";

function project(index = 0): ProjectRecord {
  return {
    organizationId: "org_test",
    projectId: `project_${String(index)}`,
    recordVersion: 2,
    lifecycleStatus: "deletion-pending",
    deletionRequestedAt: "2026-10-02T00:00:00.000Z",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    currentDraftId: "draft_test",
    name: "Synthetic",
  };
}
function fixture() {
  const wakes = new Map<string, ProjectCleanupWake>();
  const cursors = new Map<number, string>();
  const claims = new Map<string, string>();
  const ledger: CleanupWakeLedger = {
    put: (wake) => {
      wakes.set(wake.wakeId, wake);
      return Promise.resolve();
    },
    get: (id) => Promise.resolve(wakes.get(id) ?? null),
    page: (shard, cursor) => {
      const all = [...wakes.values()]
        .filter(
          (wake) => Number.parseInt(wake.wakeId[0] ?? "", 16) % 4 === shard,
        )
        .sort((a, b) => a.wakeId.localeCompare(b.wakeId));
      const remaining = all.filter(
        (wake) => cursor === undefined || wake.wakeId > cursor,
      );
      const page = remaining.slice(0, 25);
      return Promise.resolve({
        wakes: page,
        ...(remaining.length > 25
          ? { nextCursor: page.at(-1)?.wakeId ?? "" }
          : {}),
      });
    },
    cursor: (shard) => Promise.resolve(cursors.get(shard)),
    advance: (shard, cursor) => {
      if (cursor === undefined) cursors.delete(shard);
      else cursors.set(shard, cursor);
      return Promise.resolve();
    },
    claim: (wake, token) => {
      if (claims.has(wake.wakeId)) return Promise.resolve(false);
      claims.set(wake.wakeId, token);
      return Promise.resolve(true);
    },
    release: (wake, token) => {
      if (claims.get(wake.wakeId) === token) claims.delete(wake.wakeId);
      return Promise.resolve();
    },
    complete: (wake, token) => {
      if (claims.get(wake.wakeId) !== token) throw Error("Lease lost");
      wakes.delete(wake.wakeId);
      return Promise.resolve();
    },
  };
  return { ledger, wakes, cursors, claims };
}
describe("retained cleanup wake shadow", () => {
  it("ledger failure prevents publication and never manufactures durable coverage", async () => {
    const f = fixture();
    const send = vi.fn();
    f.ledger.put = () => Promise.reject(Error("Ledger unavailable"));
    await expect(
      createCleanupWakeNotifier({
        enabled: true,
        ledger: f.ledger,
        publisher: { send },
      })(project()),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(f.wakes.size).toBe(0);
  });
  it("continues dispatching other shards when one partition is unavailable", async () => {
    const f = fixture();
    for (let i = 0; i < 100; i++)
      await f.ledger.put(projectCleanupWake(project(i)));
    const page = f.ledger.page.bind(f.ledger);
    f.ledger.page = (shard, cursor) =>
      shard === 0
        ? Promise.reject(Error("Partition unavailable"))
        : page(shard, cursor);
    const send = vi.fn().mockResolvedValue(undefined);
    await expect(
      createCleanupWakeDispatcher({
        enabled: true,
        ledger: f.ledger,
        publisher: { send },
      })(),
    ).rejects.toThrow();
    expect(send).toHaveBeenCalled();
    expect(f.wakes.size).toBe(100);
  });
  it("rejects mutable bindings, unknown fields and uncommitted project states", () => {
    const wake = projectCleanupWake(project());
    expect(parseProjectCleanupWake({ ...wake })).toEqual(wake);
    expect(() =>
      parseProjectCleanupWake({ ...wake, recordVersion: 3 }),
    ).toThrow();
    expect(() =>
      parseProjectCleanupWake({ ...wake, content: "forbidden" }),
    ).toThrow();
    expect(() =>
      projectCleanupWake({ ...project(), lifecycleStatus: "active" }),
    ).toThrow();
    expect(() =>
      projectCleanupWake({ ...project(), projectId: "organization" }),
    ).toThrow();
  });
  it("disabled entrypoints perform no ledger, queue or SQL operations", async () => {
    const f = fixture();
    const put = vi.spyOn(f.ledger, "put");
    const get = vi.spyOn(f.ledger, "get");
    const page = vi.spyOn(f.ledger, "page");
    const send = vi.fn();
    const inspect = vi.fn();
    const process = vi.fn();
    await createCleanupWakeNotifier({
      enabled: false,
      ledger: f.ledger,
      publisher: { send },
    })(project());
    await createCleanupWakeDispatcher({
      enabled: false,
      ledger: f.ledger,
      publisher: { send },
    })();
    await createCleanupWakeProcessor({
      enabled: false,
      ledger: f.ledger,
      authority: { inspect, process },
      clock: () => 0,
      token: () => "a".repeat(32),
    })("malformed");
    for (const call of [put, get, page, send, inspect, process])
      expect(call).not.toHaveBeenCalled();
  });
  it("keeps the durable wake after queue notification fails and recovers a missed stream event", async () => {
    const f = fixture();
    const send = vi
      .fn()
      .mockRejectedValueOnce(Error("Queue unavailable"))
      .mockResolvedValue(undefined);
    await expect(
      createCleanupWakeNotifier({
        enabled: true,
        ledger: f.ledger,
        publisher: { send },
      })(project()),
    ).rejects.toThrow();
    expect(f.wakes.size).toBe(1);
    await createCleanupWakeDispatcher({
      enabled: true,
      ledger: f.ledger,
      publisher: { send },
    })();
    expect(send).toHaveBeenLastCalledWith(projectCleanupWake(project()).wakeId);
    expect(f.wakes.size).toBe(1);
  });
  it("an empty ledger dispatches no notifications and cannot invoke SQL", async () => {
    const f = fixture();
    const send = vi.fn();
    const inspect = vi.fn();
    const process = vi.fn();
    expect(
      await createCleanupWakeDispatcher({
        enabled: true,
        ledger: f.ledger,
        publisher: { send },
      })(),
    ).toEqual({ enabled: true, dispatched: 0 });
    await createCleanupWakeProcessor({
      enabled: true,
      ledger: f.ledger,
      authority: { inspect, process },
      clock: () => 0,
      token: () => "a".repeat(32),
    })("a".repeat(64));
    expect(send).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
  });
  it("pages beyond repeatedly blocked early wakes without deleting recovery evidence", async () => {
    const f = fixture();
    for (let i = 0; i < 400; i++)
      await f.ledger.put(projectCleanupWake(project(i)));
    const seen = new Set<string>();
    const dispatch = createCleanupWakeDispatcher({
      enabled: true,
      ledger: f.ledger,
      publisher: {
        send: (id) => {
          seen.add(id);
          return Promise.resolve();
        },
      },
    });
    for (let i = 0; i < 6; i++) await dispatch();
    expect(seen.size).toBe(400);
    expect(f.wakes.size).toBe(400);
  });
  it("preserves the failed page cursor on publication failure", async () => {
    const f = fixture();
    await f.ledger.put(projectCleanupWake(project()));
    const advance = vi.spyOn(f.ledger, "advance");
    await expect(
      createCleanupWakeDispatcher({
        enabled: true,
        ledger: f.ledger,
        publisher: {
          send: () => Promise.reject(Error("Queue unavailable")),
        },
      })(),
    ).rejects.toThrow();
    const shard =
      Number.parseInt(projectCleanupWake(project()).wakeId[0] ?? "", 16) % 4;
    expect(advance.mock.calls.some(([value]) => value === shard)).toBe(false);
    expect(f.wakes.size).toBe(1);
  });
  it("deduplicates concurrent wakes and requires receipt readback after process success", async () => {
    const f = fixture();
    const wake = projectCleanupWake(project());
    await f.ledger.put(wake);
    let state: "pending" | "completed" = "pending";
    let unblock: () => void = () => {
      throw Error("Fixture not ready");
    };
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const process = vi.fn(async () => {
      await blocked;
      return { state: "completed" as const };
    });
    const handler = createCleanupWakeProcessor({
      enabled: true,
      ledger: f.ledger,
      authority: { inspect: () => Promise.resolve(state), process },
      clock: () => 0,
      token: () => "a".repeat(32),
    });
    const first = handler(wake.wakeId);
    await vi.waitFor(() => {
      expect(process).toHaveBeenCalledTimes(1);
    });
    expect((await handler(wake.wakeId)).state).toBe("busy");
    unblock();
    expect((await first).state).toBe("pending");
    expect(f.wakes.size).toBe(1);
    state = "completed";
    expect((await handler(wake.wakeId)).state).toBe("completed");
    expect((await handler(wake.wakeId)).state).toBe("missing");
    expect(process).toHaveBeenCalledTimes(1);
  });
  it.each(["inspect", "process", "complete", "release"])(
    "retains evidence when %s fails",
    async (stage) => {
      const f = fixture();
      const wake = projectCleanupWake(project());
      await f.ledger.put(wake);
      const fail = () => Promise.reject(Error("Unavailable"));
      if (stage === "complete") f.ledger.complete = fail;
      if (stage === "release") f.ledger.release = fail;
      const handler = createCleanupWakeProcessor({
        enabled: true,
        ledger: f.ledger,
        authority: {
          inspect:
            stage === "inspect"
              ? fail
              : () =>
                  Promise.resolve(
                    stage === "complete" ? "completed" : "pending",
                  ),
          process:
            stage === "process"
              ? fail
              : () => Promise.resolve({ state: "pending" }),
        },
        clock: () => 0,
        token: () => "a".repeat(32),
      });
      await expect(handler(wake.wakeId)).rejects.toThrow();
      expect(f.wakes.size).toBe(1);
    },
  );
  it("unconfirmed SQL binding never authorizes work or wake removal", async () => {
    const f = fixture();
    const wake = projectCleanupWake(project());
    await f.ledger.put(wake);
    const process = vi.fn();
    await createCleanupWakeProcessor({
      enabled: true,
      ledger: f.ledger,
      authority: { inspect: () => Promise.resolve("unconfirmed"), process },
      clock: () => 0,
      token: () => "a".repeat(32),
    })(wake.wakeId);
    expect(process).not.toHaveBeenCalled();
    expect(f.wakes.size).toBe(1);
  });
});
