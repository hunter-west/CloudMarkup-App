import { describe, expect, it, vi } from "vitest";
import {
  digestStructuredValue,
  ModelRuntimeControlError,
} from "@cloudmarkup/model-gateway";
import { modelRuntimeAdmissionRequestV1Schema } from "@cloudmarkup/schemas";
import {
  admissionJson,
  parseRuntimeClaim,
  parseRuntimeRecord,
  parseRuntimeStateRequest,
  parseRuntimeTerminal,
  runtimeExecutionLeaseSchema,
} from "./model-runtime-admission-codec.js";
import { runtimeAdmissionFixture } from "./model-runtime-admission-test-helpers.js";
import { PostgresModelRuntimeAdmissionStore } from "./model-runtime-admission-store.js";
import type { SqlDatabase } from "./sql.js";

describe("strict normal runtime admission metadata", () => {
  it("roundtrips canonical metadata without retaining mutable caller references", () => {
    const f = runtimeAdmissionFixture();
    const input = f.claim(f.emptySnapshot());
    const parsed = parseRuntimeClaim(input, f.scope);
    expect(parsed).toEqual(input);
    expect(parsed.admissionRequest).not.toBe(input.admissionRequest);
    expect(parseRuntimeTerminal(f.terminal, f.request, f.decision)).toEqual(
      f.terminal,
    );
    const record = {
      request: f.request,
      decision: f.decision,
      originalSnapshot: f.emptySnapshot(),
      fingerprint: input.fingerprint,
      tenantScopeDigest: f.state.tenantScopeDigest,
      commercialExpiresAt: input.commercialExpiresAt,
      concurrencyLeaseId: input.leaseId,
      revision: 0,
      recoveryRequired: false,
      executionLease: {
        acquiredAt: f.now,
        executionLeaseId: "runtime_execution_fixture",
        expiresAt: input.executionLeaseExpiresAt,
        fencingToken: "runtime_fence_1",
        recoveryOnly: false,
        revision: 0,
      },
      pending: null,
      terminal: null,
    };
    expect(parseRuntimeRecord(admissionJson(record), f.scope)).toEqual(record);
  });
  it.each(["live-evaluation", "deterministic-evaluation"])(
    "rejects %s before any database call",
    (executionClass) => {
      const f = runtimeAdmissionFixture();
      const claim = f.claim(f.emptySnapshot());
      const { requestDigest: _old, ...body } = f.request;
      void _old;
      const next = {
        ...body,
        executionClass,
        ...(executionClass === "live-evaluation"
          ? {
              liveEvaluationAuthorityDigest:
                digestStructuredValue("synthetic live"),
            }
          : {}),
      };
      const request = modelRuntimeAdmissionRequestV1Schema.parse({
        ...next,
        requestDigest: digestStructuredValue(next),
      });
      const query = vi.fn<() => never>(() => {
        throw new Error("Unexpected SQL query");
      });
      const transaction = vi.fn<() => never>(() => {
        throw new Error("Unexpected SQL transaction");
      });
      const store = new PostgresModelRuntimeAdmissionStore({
        scope: f.scope,
        database: { query, transaction, close: () => Promise.resolve() },
      });
      expect(() =>
        store.claim({ ...claim, admissionRequest: request }),
      ).toThrow(ModelRuntimeControlError);
      expect(query).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it("rejects live capacity reservations and forged tenant scope digests", () => {
    const f = runtimeAdmissionFixture();
    expect(() =>
      parseRuntimeStateRequest(
        { ...f.state, liveAuthorityReservation: {} as never },
        f.scope,
      ),
    ).toThrow(ModelRuntimeControlError);
    expect(() =>
      parseRuntimeStateRequest(
        { ...f.state, tenantScopeDigest: digestStructuredValue("foreign") },
        f.scope,
      ),
    ).toThrow(ModelRuntimeControlError);
    expect(() =>
      parseRuntimeStateRequest(f.state, {
        ...f.scope,
        userId: "principal_other",
      }),
    ).toThrow(ModelRuntimeControlError);
  });
  it.each(["request", "decision", "state", "terminal"])(
    "rejects unaccepted content in %s metadata",
    (where) => {
      const f = runtimeAdmissionFixture();
      const claim = f.claim(f.emptySnapshot());
      const extra = { candidateText: "Unaccepted synthetic output" };
      expect(() =>
        where === "terminal"
          ? parseRuntimeTerminal(
              { ...f.terminal, ...extra },
              f.request,
              f.decision,
            )
          : where === "state"
            ? parseRuntimeStateRequest({ ...f.state, ...extra }, f.scope)
            : parseRuntimeClaim(
                where === "request"
                  ? { ...claim, admissionRequest: { ...f.request, ...extra } }
                  : {
                      ...claim,
                      admissionDecision: { ...f.decision, ...extra },
                    },
                f.scope,
              ),
      ).toThrow(ModelRuntimeControlError);
    },
  );
  it("rejects oversized rows and contradictory output/lease evidence", () => {
    const f = runtimeAdmissionFixture();
    expect(() => admissionJson({ metadata: "x".repeat(16384) })).toThrow(
      ModelRuntimeControlError,
    );
    expect(() =>
      parseRuntimeTerminal(
        {
          ...f.terminal,
          output: { outputDigest: digestStructuredValue("bad") },
        },
        f.request,
        f.decision,
      ),
    ).toThrow(ModelRuntimeControlError);
    expect(
      runtimeExecutionLeaseSchema.safeParse({
        acquiredAt: f.now,
        executionLeaseId: "runtime_execution_fixture",
        expiresAt: new Date(Date.parse(f.now) + 300001).toISOString(),
        fencingToken: "runtime_fence_1",
        recoveryOnly: false,
        revision: 0,
      }).success,
    ).toBe(false);
  });
  it("ignores undeclared constructor hooks and still requires database authorization", async () => {
    const f = runtimeAdmissionFixture();
    const injected = vi.fn(() => Promise.resolve(f.emptySnapshot()));
    const query: SqlDatabase["query"] = () =>
      Promise.resolve({ rows: [], rowCount: 0 });
    const transaction: SqlDatabase["transaction"] = (work) => work({ query });
    const options = {
      scope: f.scope,
      database: { query, transaction, close: () => Promise.resolve() },
      authorityTransactions: { run: injected },
    };
    const store = new PostgresModelRuntimeAdmissionStore(options);
    await expect(store.inspect(f.state)).rejects.toBeInstanceOf(
      ModelRuntimeControlError,
    );
    expect(injected).not.toHaveBeenCalled();
  });
  it("fails closed with generic errors when current membership is denied", async () => {
    const f = runtimeAdmissionFixture();
    const queried = vi.fn<() => void>();
    const query: SqlDatabase["query"] = () => {
      queried();
      return Promise.resolve({ rows: [], rowCount: 0 });
    };
    const transaction: SqlDatabase["transaction"] = (work) => work({ query });
    const store = new PostgresModelRuntimeAdmissionStore({
      scope: f.scope,
      database: { query, transaction, close: () => Promise.resolve() },
    });
    await expect(store.inspect(f.state)).rejects.toThrow(
      ModelRuntimeControlError,
    );
    expect(queried).toHaveBeenCalledTimes(1);
  });
});
