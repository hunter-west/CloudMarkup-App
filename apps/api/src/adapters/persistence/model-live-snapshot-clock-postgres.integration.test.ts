import { ModelRuntimeControlError } from "@cloudmarkup/model-gateway";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  currentLiveAccountingPgSnapshotState,
  waitForLiveAccountingPgTestWindow,
  inspectCurrentLiveAccountingPgSnapshot,
  createLiveAccountingPgFixture,
} from "./model-live-commercial-accounting-pg-test-helpers.js";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { liveRuntimeAdmissionFixture } from "./model-live-runtime-admission-test-helpers.js";
import { runtimeWindow } from "./model-runtime-admission-codec.js";
import {
  sql,
  type SqlDatabase,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

function clockDatabase(value: unknown, fails = false) {
  const statements: SqlStatement[] = [];
  const database: Pick<SqlDatabase, "query"> = {
    query<R extends SqlRow>(statement: SqlStatement): Promise<SqlResult<R>> {
      statements.push(statement);
      if (fails) {
        return Promise.reject(new Error("Synthetic clock read failed."));
      }
      const rows = value === undefined ? [] : [{ runtime_snapshot_now: value }];
      return Promise.resolve({
        rowCount: rows.length,
        rows: rows as unknown as readonly R[],
      });
    },
  };
  return { database, statements };
}

describe("live accounting fixture snapshot clock", () => {
  it("uses current database time across a UTC hour without changing issued decision bindings", async () => {
    const issuedAt = "2026-09-12T19:59:59.900Z";
    const observedAt = "2026-09-12T20:00:00.100Z";
    const f = liveRuntimeAdmissionFixture({ now: issuedAt });
    const original = structuredClone(f.state);
    Object.freeze(f.state);
    const clock = clockDatabase(observedAt);
    const state = await currentLiveAccountingPgSnapshotState(
      clock.database,
      f.state,
    );
    expect(runtimeWindow(f.state.decidedAt, 3600)).not.toEqual(
      runtimeWindow(observedAt, 3600),
    );
    expect(runtimeWindow(state.decidedAt, 3600)).toEqual(
      runtimeWindow(observedAt, 3600),
    );
    expect(state).toEqual({ ...original, decidedAt: observedAt });
    expect(f.state).toEqual(original);
    expect(f.decision.decidedAt).toBe(issuedAt);
    expect(clock.statements).toHaveLength(1);
    expect(clock.statements[0]?.text).toContain("clock_timestamp()");
    expect(clock.statements[0]?.values).toEqual([]);
  });

  it.each(["missing", "malformed", "query-failed"] as const)(
    "does not substitute host time or retry when the database clock is %s",
    async (kind) => {
      const f = liveRuntimeAdmissionFixture();
      const clock = clockDatabase(
        kind === "missing" ? undefined : "not-a-time",
        kind === "query-failed",
      );
      await expect(
        currentLiveAccountingPgSnapshotState(clock.database, f.state),
      ).rejects.toThrow();
      expect(clock.statements).toHaveLength(1);
    },
  );
});

function clockSequence(values: readonly unknown[]) {
  let calls = 0;
  const database: Pick<SqlDatabase, "query"> = {
    query<R extends SqlRow>(statement: SqlStatement): Promise<SqlResult<R>> {
      return clockDatabase(values[calls++]).database.query<R>(statement);
    },
  };
  return { database, calls: () => calls };
}

describe("pre-fixture hourly headroom", () => {
  it("waits only before fixture creation and verifies an actual database rollover", async () => {
    const clock = clockSequence([
      "2026-09-14T14:59:59.900Z",
      "2026-09-14T15:00:00.001Z",
    ]);
    const wait = vi.fn(() => Promise.resolve());
    await waitForLiveAccountingPgTestWindow(clock.database, wait);
    expect(wait).toHaveBeenCalledExactlyOnceWith(101);
    expect(clock.calls()).toBe(2);
  });
  it("does not wait when the full setup margin remains", async () => {
    const clock = clockSequence(["2026-09-14T14:59:00.000Z"]);
    const wait = vi.fn(() => Promise.resolve());
    await waitForLiveAccountingPgTestWindow(clock.database, wait);
    expect(wait).not.toHaveBeenCalled();
    expect(clock.calls()).toBe(1);
  });
  it("caps waiting at sixty seconds", async () => {
    const clock = clockSequence([
      "2026-09-14T14:59:00.001Z",
      "2026-09-14T15:00:00.001Z",
    ]);
    const wait = vi.fn(() => Promise.resolve());
    await waitForLiveAccountingPgTestWindow(clock.database, wait);
    expect(wait).toHaveBeenCalledExactlyOnceWith(60000);
  });
  it.each([
    "2026-09-14T14:59:59.950Z",
    "2026-09-14T13:00:00.000Z",
    "2026-09-14T15:59:59.900Z",
    "malformed",
    undefined,
  ])("denies unproven clock movement without retry (%s)", async (next) => {
    const clock = clockSequence(["2026-09-14T14:59:59.900Z", next]);
    const wait = vi.fn(() => Promise.resolve());
    await expect(
      waitForLiveAccountingPgTestWindow(clock.database, wait),
    ).rejects.toThrow();
    expect(wait).toHaveBeenCalledTimes(1);
    expect(clock.calls()).toBe(2);
  });
  it("does not retry failed clock reads or waits", async () => {
    const wait = vi.fn(() =>
      Promise.reject(new Error("Synthetic timer failure")),
    );
    const clock = clockSequence(["2026-09-14T14:59:59.900Z"]);
    await expect(
      waitForLiveAccountingPgTestWindow(clock.database, wait),
    ).rejects.toThrow("timer failure");
    expect(clock.calls()).toBe(1);
    const failed = clockDatabase(undefined, true);
    await expect(
      waitForLiveAccountingPgTestWindow(failed.database, wait),
    ).rejects.toThrow("clock read failed");
    expect(failed.statements).toHaveLength(1);
    expect(wait).toHaveBeenCalledTimes(1);
  });
});

describe("bounded fixture-only snapshot rollover retry", () => {
  it("retries only the read-only inspection after one captured stale error and an advanced database window", async () => {
    const f = liveRuntimeAdmissionFixture({ now: "2026-09-12T19:59:59.900Z" });
    const original = structuredClone(f.state);
    const clock = clockSequence([
      f.state.decidedAt,
      "2026-09-12T20:00:00.100Z",
    ]);
    const errors: unknown[] = [new Error("An unrelated earlier failure")];
    const sanitized = new ModelRuntimeControlError(
      "routing-authority-mismatch",
    );
    const inspect = vi.fn((state: typeof f.state) => {
      if (errors.length === 1) {
        errors.push(
          new ModelRuntimeControlError("stale-or-duplicate-conflict"),
        );
        return Promise.reject(sanitized);
      }
      return Promise.resolve(state);
    });
    const result = await inspectCurrentLiveAccountingPgSnapshot(
      clock.database,
      f.state,
      inspect,
      errors,
    );
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(clock.calls()).toBe(2);
    expect(inspect.mock.calls[0]?.[0]).toEqual(original);
    expect(result.state).toEqual({
      ...original,
      decidedAt: "2026-09-12T20:00:00.100Z",
    });
    expect(result.snapshot).toEqual(result.state);
    expect(f.state).toEqual(original);
    expect(f.decision.decidedAt).toBe(original.decidedAt);
  });

  it.each([
    "same-window",
    "backward-clock",
    "arbitrary-inner",
    "missing-inner",
    "multiple-inner",
    "second-stale",
    "preexisting-stale",
  ] as const)(
    "fails without an unbounded or unproven retry for %s",
    async (kind) => {
      const f = liveRuntimeAdmissionFixture({
        now: "2026-09-12T19:59:59.900Z",
      });
      const next =
        kind === "same-window"
          ? "2026-09-12T19:59:59.950Z"
          : kind === "backward-clock"
            ? "2026-09-12T18:59:59.900Z"
            : "2026-09-12T20:00:00.100Z";
      const clock = clockSequence([f.state.decidedAt, next]);
      const stale = () =>
        new ModelRuntimeControlError("stale-or-duplicate-conflict");
      const errors: unknown[] = kind === "preexisting-stale" ? [stale()] : [];
      const sanitized = new ModelRuntimeControlError(
        "routing-authority-mismatch",
      );
      const inspect = vi.fn(() => {
        if (kind === "arbitrary-inner")
          errors.push(
            new ModelRuntimeControlError("routing-authority-mismatch"),
          );
        else if (kind !== "missing-inner" && kind !== "preexisting-stale")
          errors.push(stale());
        if (kind === "multiple-inner") errors.push(stale());
        return Promise.reject(sanitized);
      });
      await expect(
        inspectCurrentLiveAccountingPgSnapshot(
          clock.database,
          f.state,
          inspect,
          errors,
        ),
      ).rejects.toBe(sanitized);
      expect(inspect).toHaveBeenCalledTimes(kind === "second-stale" ? 2 : 1);
      expect(clock.calls()).toBe(
        ["same-window", "backward-clock", "second-stale"].includes(kind)
          ? 2
          : 1,
      );
    },
  );
});

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
integration("real live admission keeps its stale-window guard", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(() => harness.setup(), 120000);
  afterAll(() => harness.teardown(), 30000);

  it("rejects the previous-hour snapshot and accepts a fresh read without changing decision or financial state", async () => {
    const f = await createLiveAccountingPgFixture(harness);
    const decision = structuredClone(f.runtime.decision);
    const priorState = {
      ...f.snapshotState,
      decidedAt: new Date(
        Date.parse(f.snapshotState.decidedAt) - 3_600_000,
      ).toISOString(),
    };
    const counts = async () =>
      (
        await harness.database.query(
          sql(
            `SELECT
        (SELECT count(*)::int FROM model_runtime_admissions WHERE organization_id=$1) AS admissions,
        (SELECT count(*)::int FROM credit_reservations WHERE organization_id=$1) AS reservations,
        (SELECT count(*)::int FROM usage_ledger_entries WHERE organization_id=$1) AS ledger`,
            [f.scope.organizationId],
          ),
        )
      ).rows;
    const before = await counts();
    const stored = await f.persistedRuntime();
    const errors = f.errors.length;
    await expect(f.runtimeStore.inspect(priorState)).rejects.toMatchObject({
      safeCode: "routing-authority-mismatch",
    });
    expect(f.errors.slice(errors)).toContainEqual(
      expect.objectContaining({
        name: "ModelRuntimeControlError",
        safeCode: "stale-or-duplicate-conflict",
      }),
    );
    let clockReads = 0;
    const crossingClock: Pick<SqlDatabase, "query"> = {
      query<R extends SqlRow>(statement: SqlStatement): Promise<SqlResult<R>> {
        clockReads++;
        return clockReads === 1
          ? clockDatabase(priorState.decidedAt).database.query<R>(statement)
          : harness.database.query<R>(statement);
      },
    };
    const { state: current, snapshot } =
      await inspectCurrentLiveAccountingPgSnapshot(
        crossingClock,
        priorState,
        (state) => f.runtimeStore.inspect(state),
        f.errors,
      );
    expect(clockReads).toBe(2);
    expect(snapshot.capturedAt).toBe(current.decidedAt);
    expect(snapshot.windows.organization.windowStartedAt).toBe(
      runtimeWindow(current.decidedAt, current.organizationWindowSeconds)
        .startsAt,
    );
    expect(f.runtime.decision).toEqual(decision);
    expect(await f.persistedRuntime()).toEqual(stored);
    expect(await counts()).toEqual(before);
  }, 120000);
});
