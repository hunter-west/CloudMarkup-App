import { describe, expect, it, vi } from "vitest";

import { createImmutableAttemptCoordinator } from "./immutable-attempt.js";

interface RevisionAttempt {
  readonly body: {
    readonly contractVersion: 1;
    readonly draftId: string;
    readonly draftVersion: number;
    readonly name: string;
  };
  readonly headers: {
    readonly "idempotency-key": string;
    readonly "if-match": string;
  };
}

interface SavedDraftHead {
  readonly draftId: string;
  readonly etag: string;
  readonly version: number;
}

interface RevisionResult {
  readonly revisionId: string;
}

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly reject: (reason: unknown) => void;
} {
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  return { promise, reject };
}

describe("immutable mutation attempt coordinator", () => {
  it("replays the exact failed revision attempt without saving again", async () => {
    const coordinator = createImmutableAttemptCoordinator<RevisionAttempt>();
    const firstSend = deferred<RevisionResult>();
    const savedHeads: SavedDraftHead[] = [
      {
        draftId: "draft_exact",
        etag: '"draft:2"',
        version: 2,
      },
      {
        draftId: "draft_exact",
        etag: '"draft:3"',
        version: 3,
      },
    ];
    const save = vi.fn((): Promise<SavedDraftHead> => {
      const head = savedHeads.shift();
      if (head === undefined) throw new Error("No saved head is available.");
      return Promise.resolve(head);
    });
    let sendCount = 0;
    const sentVersions: number[] = [];
    const send = vi.fn((attempt: RevisionAttempt): Promise<RevisionResult> => {
      sendCount += 1;
      sentVersions.push(attempt.body.draftVersion);
      return sendCount === 1
        ? firstSend.promise
        : Promise.resolve({ revisionId: "revision_exact" });
    });
    const createAttempt = async (): Promise<RevisionAttempt> => {
      const head = await save();
      return {
        body: {
          contractVersion: 1,
          draftId: head.draftId,
          draftVersion: head.version,
          name: `Solution revision ${String(head.version)}`,
        },
        headers: {
          "idempotency-key": "solution-revision:exact-attempt",
          "if-match": head.etag,
        },
      };
    };
    const run = async () => {
      const attempt = await coordinator.prepare(createAttempt);
      if (attempt === null) throw new Error("Expected a revision attempt.");
      const result = await send(attempt);
      coordinator.complete(attempt);
      return result;
    };

    const initialRun = run();
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    const initialFailure = expect(initialRun).rejects.toThrow(
      "revision transport failed",
    );
    firstSend.reject(new Error("revision transport failed"));
    await initialFailure;

    await expect(run()).resolves.toEqual({ revisionId: "revision_exact" });
    expect(save).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sentVersions).toEqual([2, 2]);
    expect(JSON.stringify(send.mock.calls[1]?.[0])).toBe(
      JSON.stringify(send.mock.calls[0]?.[0]),
    );
    expect(send.mock.calls[1]?.[0]).toEqual({
      body: {
        contractVersion: 1,
        draftId: "draft_exact",
        draftVersion: 2,
        name: "Solution revision 2",
      },
      headers: {
        "idempotency-key": "solution-revision:exact-attempt",
        "if-match": '"draft:2"',
      },
    });
  });

  it("requires explicit abandonment before creating a newer attempt", async () => {
    const coordinator = createImmutableAttemptCoordinator<RevisionAttempt>();
    const attempts: RevisionAttempt[] = [
      {
        body: {
          contractVersion: 1,
          draftId: "draft_exact",
          draftVersion: 2,
          name: "Solution revision 2",
        },
        headers: {
          "idempotency-key": "solution-revision:first",
          "if-match": '"draft:2"',
        },
      },
      {
        body: {
          contractVersion: 1,
          draftId: "draft_exact",
          draftVersion: 3,
          name: "Solution revision 3",
        },
        headers: {
          "idempotency-key": "solution-revision:second",
          "if-match": '"draft:3"',
        },
      },
    ];
    const createAttempt = vi.fn((): Promise<RevisionAttempt> => {
      const attempt = attempts.shift();
      if (attempt === undefined) throw new Error("No attempt is available.");
      return Promise.resolve(attempt);
    });

    const first = await coordinator.prepare(createAttempt);
    expect(await coordinator.prepare(createAttempt)).toBe(first);
    expect(createAttempt).toHaveBeenCalledTimes(1);
    expect(coordinator.abandon()).toBe(true);
    expect((await coordinator.prepare(createAttempt))?.body.draftVersion).toBe(
      3,
    );
    expect(createAttempt).toHaveBeenCalledTimes(2);
  });
});
