import type { CloudMarkupClient } from "@cloudmarkup/api-contract";
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectEditingLease } from "./use-project-editing-lease.js";

const projectId = "project_lease_test";
const leaseId = "projectlease_00000000-0000-4000-8000-000000000001";
const owned = () => ({
  data: {
    contractVersion: 1,
    projectId,
    state: "owned",
    leaseId,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
});
const available = () => ({
  data: { contractVersion: 1, projectId, state: "available" },
});
type LeaseRequest = (
  operation: string,
  input: {
    path: { projectId: string };
    body: { contractVersion: 1; token?: string; leaseId?: string };
  },
) => Promise<unknown>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}
function setup(
  request = vi
    .fn<LeaseRequest>()
    .mockImplementation((operation: string) =>
      Promise.resolve(operation.endsWith("release") ? available() : owned()),
    ),
  readHead = vi
    .fn<() => Promise<{ version: number }>>()
    .mockResolvedValue({ version: 1 }),
) {
  const client = { request } as unknown as CloudMarkupClient;
  const args = { client, enabled: true, projectId, readHead };
  return { args, request, readHead };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("per-tab shared-project editing lease", () => {
  it("waits for a post-acquisition server head and sends only a fresh opaque token", async () => {
    const pending = deferred<{ version: number }>();
    const f = setup(
      undefined,
      vi
        .fn<() => Promise<{ version: number }>>()
        .mockReturnValue(pending.promise),
    );
    const { result } = renderHook(() => useProjectEditingLease(f.args));
    await settle();
    expect(result.current.status).toBe("checking");
    expect(f.readHead).toHaveBeenCalledOnce();
    const token = f.request.mock.calls[0]?.[1].body.token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(f.request).toHaveBeenCalledWith("project-editing-leases.acquire", {
      path: { projectId },
      body: {
        contractVersion: 1,
        token,
      },
    });
    await act(async () => {
      pending.resolve({ version: 3 });
      await Promise.resolve();
    });
    expect(result.current).toMatchObject({
      status: "owned",
      head: { version: 3 },
    });
    expect(result.current.getProof()).toMatchObject({ leaseId });
  });
  it("renews at20seconds and loses ownership immediately when renewal fails", async () => {
    const f = setup();
    f.request.mockImplementation((operation: string) =>
      operation.endsWith("renew")
        ? Promise.reject(new Error("Session no longer matches"))
        : Promise.resolve(owned()),
    );
    const { result } = renderHook(() => useProjectEditingLease(f.args));
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(result.current.status).toBe("lost");
    expect(result.current.getProof()).toBeNull();
    expect(
      f.request.mock.calls.filter(
        ([operation]) => operation === "project-editing-leases.renew",
      ),
    ).toHaveLength(1);
  });
  it("expires independently when renewal is stalled and never overlaps renewals", async () => {
    const pending = deferred<ReturnType<typeof owned>>();
    const initialLease = {
      data: {
        ...owned().data,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      },
    };
    const f = setup();
    f.request.mockImplementation((operation: string) =>
      operation.endsWith("renew")
        ? pending.promise
        : Promise.resolve(initialLease),
    );
    const { result } = renderHook(() => useProjectEditingLease(f.args));
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(result.current.status).toBe("owned");
    expect(result.current.getProof()).not.toBeNull();
    expect(
      f.request.mock.calls.filter(
        ([operation]) => operation === "project-editing-leases.renew",
      ),
    ).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.status).toBe("lost");
    expect(result.current.getProof()).toBeNull();
    expect(
      f.request.mock.calls.filter(
        ([operation]) => operation === "project-editing-leases.renew",
      ),
    ).toHaveLength(1);
    await act(async () => {
      pending.resolve(owned());
      await Promise.resolve();
    });
    expect(result.current.status).toBe("lost");
  });
  it("serializes StrictMode cleanup and creates a distinct replacement token", async () => {
    const pending = deferred<ReturnType<typeof owned>>();
    const f = setup();
    let acquisition = 0;
    f.request.mockImplementation((operation: string) => {
      if (operation.endsWith("acquire")) {
        acquisition += 1;
        return acquisition === 1 ? pending.promise : Promise.resolve(owned());
      }
      return Promise.resolve(available());
    });
    const { result, rerender } = renderHook(
      ({ enabled }) => useProjectEditingLease({ ...f.args, enabled }),
      {
        initialProps: { enabled: true },
        wrapper: ({ children }: { children: ReactNode }) => (
          <StrictMode>{children}</StrictMode>
        ),
      },
    );
    await settle();
    rerender({ enabled: false });
    rerender({ enabled: true });
    await act(async () => {
      pending.resolve(owned());
      await Promise.resolve();
    });
    await settle();
    expect(result.current.status).toBe("owned");
    const calls = f.request.mock.calls;
    expect(calls.map(([operation]) => operation)).toEqual([
      "project-editing-leases.acquire",
      "project-editing-leases.release",
      "project-editing-leases.acquire",
    ]);
    expect(calls[0]?.[1].body.token).not.toBe(calls[2]?.[1].body.token);
    expect(calls[1]?.[1].body.token).toBe(calls[0]?.[1].body.token);
  });
  it("shows checking while a previous release is still draining", async () => {
    const release = deferred<ReturnType<typeof available>>();
    const f = setup();
    f.request.mockImplementation((operation: string) =>
      operation.endsWith("release")
        ? release.promise
        : Promise.resolve(owned()),
    );
    const { result, rerender } = renderHook(
      ({ enabled }) => useProjectEditingLease({ ...f.args, enabled }),
      { initialProps: { enabled: true } },
    );
    await settle();
    expect(result.current.status).toBe("owned");
    rerender({ enabled: false });
    rerender({ enabled: true });
    await settle();
    expect(result.current.status).toBe("checking");
    expect(result.current.getProof()).toBeNull();
    await act(async () => {
      release.resolve(available());
      await Promise.resolve();
    });
    expect(result.current.status).toBe("owned");
  });
  it("releases a late acquisition after unmount without reading a draft", async () => {
    const pending = deferred<ReturnType<typeof owned>>();
    const f = setup();
    f.request.mockImplementation((operation: string) =>
      operation.endsWith("acquire")
        ? pending.promise
        : Promise.resolve(available()),
    );
    const { unmount } = renderHook(() => useProjectEditingLease(f.args));
    await settle();
    unmount();
    await act(async () => {
      pending.resolve(owned());
      await Promise.resolve();
    });
    expect(f.readHead).not.toHaveBeenCalled();
    expect(f.request.mock.calls.map(([operation]) => operation)).toEqual([
      "project-editing-leases.acquire",
      "project-editing-leases.release",
    ]);
  });
  it("keeps a second tab read-only even when both tabs have the same principal", async () => {
    const f = setup();
    let held = false;
    f.request.mockImplementation((operation: string) => {
      if (operation.endsWith("release")) return Promise.resolve(available());
      if (held)
        return Promise.resolve({
          data: {
            contractVersion: 1,
            projectId,
            state: "held",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        });
      held = true;
      return Promise.resolve(owned());
    });
    const first = renderHook(() => useProjectEditingLease(f.args));
    const second = renderHook(() => useProjectEditingLease(f.args));
    await settle();
    expect(first.result.current.status).toBe("owned");
    expect(second.result.current.status).toBe("held");
    expect(second.result.current.getProof()).toBeNull();
    expect(f.readHead).toHaveBeenCalledOnce();
    expect(f.request.mock.calls[0]?.[1].body.token).not.toBe(
      f.request.mock.calls[1]?.[1].body.token,
    );
  });
  it("retains the last observed held expiry without acquiring until explicit retry reads a fresh head", async () => {
    const pendingHead = deferred<{ version: number }>();
    const f = setup(
      undefined,
      vi
        .fn<() => Promise<{ version: number }>>()
        .mockReturnValue(pendingHead.promise),
    );
    const lastObservedExpiresAt = new Date(Date.now() + 60_000).toISOString();
    f.request.mockResolvedValueOnce({
      data: {
        contractVersion: 1,
        projectId,
        state: "held",
        expiresAt: lastObservedExpiresAt,
      },
    });
    const { result } = renderHook(() => useProjectEditingLease(f.args));
    await settle();
    expect(result.current).toMatchObject({
      status: "held",
      lastObservedExpiresAt,
    });
    expect(result.current.getProof()).toBeNull();
    expect(f.readHead).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000);
    });
    expect(result.current).toMatchObject({
      status: "held",
      lastObservedExpiresAt,
    });
    expect(result.current.getProof()).toBeNull();
    expect(result.current.retained).toBeNull();
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.readHead).not.toHaveBeenCalled();
    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });
    await settle();
    expect(f.request.mock.calls.map(([operation]) => operation)).toEqual([
      "project-editing-leases.acquire",
      "project-editing-leases.acquire",
    ]);
    expect(f.request.mock.calls[0]?.[1].body.token).not.toBe(
      f.request.mock.calls[1]?.[1].body.token,
    );
    expect(f.readHead).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("checking");
    expect(result.current.getProof()).toBeNull();
    await act(async () => {
      pendingHead.resolve({ version: 4 });
      await Promise.resolve();
    });
    expect(result.current).toMatchObject({
      status: "owned",
      head: { version: 4 },
    });
    expect(result.current.getProof()).toMatchObject({ leaseId });
  });
  it("reacquires only on explicit retry and reads a new server head", async () => {
    const f = setup();
    f.readHead
      .mockResolvedValueOnce({ version: 1 })
      .mockResolvedValueOnce({ version: 4 });
    f.request.mockImplementation((operation: string) =>
      operation.endsWith("renew")
        ? Promise.reject(new Error("Lost lease"))
        : Promise.resolve(
            operation.endsWith("release") ? available() : owned(),
          ),
    );
    const { result } = renderHook(() => useProjectEditingLease(f.args));
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(result.current.status).toBe("lost");
    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });
    await settle();
    expect(result.current).toMatchObject({
      status: "owned",
      head: { version: 4 },
    });
    expect(f.readHead).toHaveBeenCalledTimes(2);
  });
  it("does not fabricate a held reservation or ownership from an available acquire response", async () => {
    const f = setup();
    f.request.mockResolvedValue(available());
    const { result } = renderHook(() => useProjectEditingLease(f.args));
    await settle();
    expect(result.current.status).toBe("unavailable");
    expect(result.current.getProof()).toBeNull();
    expect(f.readHead).not.toHaveBeenCalled();
  });
  it.each(["service", "binding", "head"])(
    "fails closed for a %s failure",
    async (failure) => {
      const f = setup();
      if (failure === "service")
        f.request.mockRejectedValue(new Error("Unavailable"));
      if (failure === "binding")
        f.request.mockResolvedValue({
          data: { ...owned().data, projectId: "project_other" },
        });
      if (failure === "head")
        f.readHead.mockRejectedValue(new Error("Draft unavailable"));
      const { result } = renderHook(() => useProjectEditingLease(f.args));
      await settle();
      expect(result.current.status).toBe("unavailable");
      expect(result.current.getProof()).toBeNull();
    },
  );
  it.each(["head", "renew"])(
    "can retry after a never-settling %s request without waiting forever",
    async (kind) => {
      const pending = deferred<{ version: number }>();
      const renewal = deferred<ReturnType<typeof owned>>();
      const f = setup();
      if (kind === "head")
        f.readHead
          .mockReturnValueOnce(pending.promise)
          .mockResolvedValue({ version: 5 });
      else
        f.request.mockImplementation((operation: string) =>
          operation.endsWith("renew")
            ? renewal.promise
            : Promise.resolve(
                operation.endsWith("release") ? available() : owned(),
              ),
        );
      const { result } = renderHook(() => useProjectEditingLease(f.args));
      await settle();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(kind === "head" ? 15_000 : 35_000);
      });
      expect(result.current.getProof()).toBeNull();
      await act(async () => {
        result.current.retry();
        await Promise.resolve();
      });
      await settle();
      expect(result.current.status).toBe("owned");
      expect(
        f.request.mock.calls.filter(([operation]) =>
          operation.endsWith("acquire"),
        ),
      ).toHaveLength(2);
    },
  );
  it("releases an acquisition that arrives after its timeout without releasing the replacement token", async () => {
    const pending = deferred<ReturnType<typeof owned>>();
    const f = setup();
    f.request.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useProjectEditingLease(f.args));
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(result.current.status).toBe("unavailable");
    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });
    await settle();
    const replacement = result.current.getProof();
    expect(replacement).not.toBeNull();
    await act(async () => {
      pending.resolve(owned());
      await Promise.resolve();
    });
    const release = f.request.mock.calls.find(([operation]) =>
      operation.endsWith("release"),
    );
    expect(release?.[1].body.token).toBe(
      f.request.mock.calls[0]?.[1].body.token,
    );
    expect(release?.[1].body.token).not.toBe(replacement?.token);
    expect(result.current.getProof()).toEqual(replacement);
  });
});
