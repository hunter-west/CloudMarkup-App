import { describe, expect, it, vi } from "vitest";

import { createLatestSaveDrain } from "./latest-save-drain.js";

interface TestDocument {
  readonly name: "A" | "B";
}

interface TestHead {
  readonly etag: string;
  readonly version: number;
}

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("latest save drain", () => {
  it("saves an edit queued immediately after an empty flush before returning its head", async () => {
    const headB = { etag: '"draft:2"', version: 2 } satisfies TestHead;
    let currentHead: TestHead = { etag: '"draft:1"', version: 1 };
    const save = vi.fn(() => {
      currentHead = headB;
      return Promise.resolve(headB);
    });
    const drain = createLatestSaveDrain<TestDocument, TestHead>();
    const options = {
      currentHead: () => currentHead,
      isBlocked: () => false,
      save,
    };

    const emptyFlush = drain.flush(options);
    drain.queue({ name: "B" });
    const revisionFlush = drain.flush(options);

    expect(revisionFlush).toBe(emptyFlush);
    expect(await revisionFlush).toEqual(headB);
    expect(save).toHaveBeenCalledExactlyOnceWith({ name: "B" });
  });

  it.each(["rejection", "null"] as const)(
    "retries the newer document after a save returns %s",
    async (failure) => {
      const headB = { etag: '"draft:2"', version: 2 } satisfies TestHead;
      let currentHead: TestHead = { etag: '"draft:1"', version: 1 };
      const drain = createLatestSaveDrain<TestDocument, TestHead>();
      const save = vi.fn((document: TestDocument) => {
        if (document.name === "A") {
          drain.queue({ name: "B" });
          if (failure === "rejection") {
            return Promise.reject(new Error("Save failed."));
          }
          return Promise.resolve(null);
        }
        currentHead = headB;
        return Promise.resolve(headB);
      });
      const options = {
        currentHead: () => currentHead,
        isBlocked: () => false,
        save,
      };

      drain.queue({ name: "A" });
      const firstFlush = drain.flush(options);
      if (failure === "rejection") {
        await expect(firstFlush).rejects.toThrow("Save failed.");
      } else {
        expect(await firstFlush).toBeNull();
      }

      expect(await drain.flush(options)).toEqual(headB);
      expect(save.mock.calls.map(([document]) => document.name)).toEqual([
        "A",
        "B",
      ]);
    },
  );

  it("retains the latest edit while a queued flush is blocked", async () => {
    const headB = { etag: '"draft:2"', version: 2 } satisfies TestHead;
    let blocked = false;
    const save = vi.fn(() => Promise.resolve(headB));
    const drain = createLatestSaveDrain<TestDocument, TestHead>();
    const options = {
      currentHead: () => ({ etag: '"draft:1"', version: 1 }),
      isBlocked: () => blocked,
      save,
    };

    const emptyFlush = drain.flush(options);
    drain.queue({ name: "B" });
    blocked = true;
    expect(await emptyFlush).toBeNull();
    expect(save).not.toHaveBeenCalled();

    blocked = false;
    expect(await drain.flush(options)).toEqual(headB);
    expect(save).toHaveBeenCalledExactlyOnceWith({ name: "B" });
  });

  it("binds a revision caller to current B after deferred save A", async () => {
    const deferredA = deferred<TestHead | null>();
    const headA = { etag: '"draft:2"', version: 2 } satisfies TestHead;
    const headB = { etag: '"draft:3"', version: 3 } satisfies TestHead;
    let currentHead: TestHead = { etag: '"draft:1"', version: 1 };
    const save = vi.fn(async (document: TestDocument) => {
      const saved = document.name === "A" ? await deferredA.promise : headB;
      if (saved !== null) currentHead = saved;
      return saved;
    });
    const drain = createLatestSaveDrain<TestDocument, TestHead>();
    const options = {
      currentHead: () => currentHead,
      isBlocked: () => false,
      save,
    };

    drain.queue({ name: "A" });
    const autosave = drain.flush(options);
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });

    drain.queue({ name: "B" });
    const revisionFlush = drain.flush(options);
    expect(revisionFlush).toBe(autosave);
    deferredA.resolve(headA);

    const exactHead = await revisionFlush;
    expect(exactHead).toEqual(headB);
    if (exactHead === null) throw new Error("Expected the current saved head.");
    const createRevision = vi.fn();
    createRevision({
      body: { draftVersion: exactHead.version },
      headers: { "if-match": exactHead.etag },
    });

    expect(save.mock.calls.map(([document]) => document.name)).toEqual([
      "A",
      "B",
    ]);
    expect(createRevision).toHaveBeenCalledWith({
      body: { draftVersion: 3 },
      headers: { "if-match": '"draft:3"' },
    });
  });
});
