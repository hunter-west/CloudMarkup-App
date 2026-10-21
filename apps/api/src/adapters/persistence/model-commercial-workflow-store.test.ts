import { readFile } from "node:fs/promises";

import {
  digestStructuredValue,
  type ModelCommercialWorkflowRecordV1,
} from "@cloudmarkup/model-gateway";
import { describe, expect, it, vi } from "vitest";

import {
  ModelCommercialWorkflowPersistenceError,
  parseWorkflowRecord,
  parseWorkflowScope,
  assertWorkflowTransition,
  workflowJson,
  COMMERCIAL_WORKFLOW_MAXIMUM_BYTES,
} from "./model-commercial-workflow-codec.js";
import { PostgresModelCommercialWorkflowStore } from "./model-commercial-workflow-store.js";
import {
  commercialClaim,
  commercialHarness,
  commercialInvocation,
  commercialRequest,
  commercialScope,
  workflowTestTime,
  WorkflowStatementDatabase,
} from "./model-commercial-workflow-test-helpers.js";
import { splitPostgresStatements } from "./migrations.js";

function fixture() {
  const database = new WorkflowStatementDatabase();
  const scope = commercialScope();
  const request = commercialRequest(scope);
  const store = new PostgresModelCommercialWorkflowStore({ database, scope });
  return {
    database,
    scope,
    request,
    store,
    ...commercialHarness(store, request, () => database.now),
  };
}
async function acquired(f: ReturnType<typeof fixture>) {
  const claimed = await f.store.claimExecution(
    commercialClaim(f.request, f.database.now),
  );
  if (claimed.kind !== "acquired")
    throw new Error("Synthetic lease acquisition failed.");
  return claimed;
}
const snapshotRecord = (value: unknown): ModelCommercialWorkflowRecordV1 =>
  parseWorkflowRecord(value, commercialScope());

describe("durable commercial workflow coordinator and statement boundaries", () => {
  it("completes and replays across store instances without another reservation or invocation", async () => {
    const f = fixture();
    const invoke = vi.fn().mockResolvedValue(commercialInvocation(f.request));
    const result = await f.coordinator.execute(f.request, invoke);
    expect(result.state).toBe("completed");
    const restarted = new PostgresModelCommercialWorkflowStore({
      database: f.database,
      scope: f.scope,
    });
    const replay = await commercialHarness(
      restarted,
      f.request,
    ).coordinator.execute(f.request, invoke);
    expect(replay).toEqual(result);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(f.accounting.reserveCalls).toBe(1);
    expect(f.database.history.length).toBeGreaterThan(5);
    for (const snapshot of f.database.history)
      expect(snapshotRecord(snapshot)).toEqual(snapshot);
  });
  it("allows only one concurrent claim, then increments the fence across release and expired takeover", async () => {
    const f = fixture();
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        f.store.claimExecution(commercialClaim(f.request)),
      ),
    );
    expect(outcomes.filter((value) => value.kind === "acquired")).toHaveLength(
      1,
    );
    expect(
      outcomes.filter((value) => value.kind === "in-progress"),
    ).toHaveLength(5);
    const first = outcomes.find((value) => value.kind === "acquired");
    if (first?.kind !== "acquired") throw new Error("Missing synthetic lease.");
    await f.store.releaseExecution({
      lease: first.lease,
      multiCallWorkflowId: f.request.multiCallWorkflowId,
      tenantScopeDigest: f.scope.tenantScopeDigest,
    });
    const second = await acquired(f);
    expect(second.lease.fencingToken).toBe("2");
    f.database.now = new Date(
      Date.parse(workflowTestTime) + 300001,
    ).toISOString();
    const third = await acquired(f);
    expect(third.lease.fencingToken).toBe("3");
    await f.store.releaseExecution({
      lease: second.lease,
      multiCallWorkflowId: f.request.multiCallWorkflowId,
      tenantScopeDigest: f.scope.tenantScopeDigest,
    });
    expect(
      (await f.store.claimExecution(commercialClaim(f.request, f.database.now)))
        .kind,
    ).toBe("in-progress");
    await expect(
      f.store.compareAndSet({
        expectedRevision: 0,
        lease: second.lease,
        record: second.record,
        tenantScopeDigest: f.scope.tenantScopeDigest,
        trustedNow: f.database.now,
      }),
    ).rejects.toThrow(ModelCommercialWorkflowPersistenceError);
  });
  it("recovery-only never creates a missing workflow or credit reservation", async () => {
    const f = fixture();
    expect(
      await f.store.claimExecution({
        ...commercialClaim(f.request),
        recoveryOnly: true,
      }),
    ).toEqual({ kind: "missing" });
    expect((await f.coordinator.recover(f.request)).state).toBe(
      "reservation-denied",
    );
    expect(f.database.rows.size).toBe(0);
    expect(f.accounting.reserveCalls).toBe(0);
  });
  it("recovers a credit reservation committed before receipt CAS without dispatching or reserving twice", async () => {
    const f = fixture();
    f.database.failNextSnapshot = (value) =>
      snapshotRecord(value).reservationReceipt !== null;
    const invoke = vi.fn().mockResolvedValue(commercialInvocation(f.request));
    await expect(
      f.coordinator.execute(f.request, invoke),
    ).rejects.toMatchObject({ code: "dependency-failure" });
    expect(invoke).not.toHaveBeenCalled();
    expect(f.accounting.reserveCalls).toBe(1);
    expect((await f.coordinator.recover(f.request)).state).toBe(
      "reconciliation-required",
    );
    expect(f.accounting.reserveCalls).toBe(1);
    expect(f.accounting.recoverExistingReservationCalls).toBe(1);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("never redispatches after the provider returned but receipt persistence failed", async () => {
    const f = fixture();
    f.database.failNextSnapshot = (value) =>
      snapshotRecord(value).invocationReceipt !== null;
    const invoke = vi.fn().mockResolvedValue(commercialInvocation(f.request));
    await expect(
      f.coordinator.execute(f.request, invoke),
    ).rejects.toMatchObject({ code: "dependency-failure" });
    expect((await f.coordinator.execute(f.request, invoke)).state).toBe(
      "reconciliation-required",
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(f.accounting.reserveCalls).toBe(1);
  });
  it("keeps settlement pending response null and recovers settlement without a second provider call", async () => {
    const f = fixture();
    f.accounting.failNextSettlements();
    const invoke = vi.fn().mockResolvedValue(commercialInvocation(f.request));
    expect((await f.coordinator.execute(f.request, invoke)).state).toBe(
      "settlement-pending",
    );
    const row = [...f.database.rows.values()][0];
    expect(snapshotRecord(row?.["snapshot"]).response).toBeNull();
    expect((await f.coordinator.recover(f.request)).state).toBe("completed");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(f.accounting.reserveCalls).toBe(1);
  });
  it("rejects stale revisions and database-expired leases even with a stale host clock", async () => {
    const f = fixture();
    const claim = await acquired(f);
    const input = {
      expectedRevision: 0,
      lease: claim.lease,
      record: claim.record,
      tenantScopeDigest: f.scope.tenantScopeDigest,
      trustedNow: f.database.now,
    };
    expect((await f.store.compareAndSet(input)).revision).toBe(1);
    await expect(f.store.compareAndSet(input)).rejects.toThrow(
      ModelCommercialWorkflowPersistenceError,
    );
    f.database.now = claim.lease.expiresAt;
    await expect(
      f.store.compareAndSet({
        ...input,
        expectedRevision: 1,
        record: { ...claim.record, revision: 1 },
      }),
    ).rejects.toThrow(ModelCommercialWorkflowPersistenceError);
  });
  it.each(["organizationId", "projectId", "userId"] as const)(
    "rejects changed %s or a substituted verified digest before SQL",
    async (field) => {
      const f = fixture();
      const request = { ...f.request, [field]: "different_owner" };
      await expect(
        f.store.claimExecution(commercialClaim(request)),
      ).rejects.toThrow(ModelCommercialWorkflowPersistenceError);
      expect(() =>
        parseWorkflowScope({ ...f.scope, [field]: "different_owner" }),
      ).toThrow(ModelCommercialWorkflowPersistenceError);
      expect(f.database.statements).toEqual([]);
    },
  );
  it("rejects changed request fingerprints and duplicate idempotency or reservation IDs", async () => {
    const f = fixture();
    const claim = await acquired(f);
    expect(
      (
        await f.store.claimExecution(
          commercialClaim({ ...f.request, estimateAccepted: false }),
        )
      ).kind,
    ).toBe("conflict");
    await f.store.releaseExecution({
      lease: claim.lease,
      multiCallWorkflowId: f.request.multiCallWorkflowId,
      tenantScopeDigest: f.scope.tenantScopeDigest,
    });
    expect(
      (
        await f.store.claimExecution(
          commercialClaim({
            ...f.request,
            multiCallWorkflowId: "workflow_other",
            reservationId: "reservation_other",
          }),
        )
      ).kind,
    ).toBe("conflict");
  });
  it("rejects SQL metadata tampering, raw prompt fields, corrupt pricing digests and terminal erasure", async () => {
    const f = fixture();
    await f.coordinator.execute(
      f.request,
      vi.fn().mockResolvedValue(commercialInvocation(f.request)),
    );
    const row = [...f.database.rows.values()][0];
    const record = snapshotRecord(row?.["snapshot"]);
    expect(() =>
      parseWorkflowRecord(
        {
          ...record,
          request: { ...record.request, prompt: "untrusted raw content" },
        },
        f.scope,
      ),
    ).toThrow(ModelCommercialWorkflowPersistenceError);
    expect(() =>
      parseWorkflowRecord(
        {
          ...record,
          invocationReceipt: {
            ...record.invocationReceipt,
            rawResponse: "not metadata",
          },
        },
        f.scope,
      ),
    ).toThrow(ModelCommercialWorkflowPersistenceError);
    expect(() =>
      parseWorkflowRecord(
        {
          ...record,
          resolvedContext: {
            ...record.resolvedContext,
            estimateResult: {
              ...record.resolvedContext?.estimateResult,
              pricingAuthority: {
                ...record.resolvedContext?.estimateResult.pricingAuthority,
                authorityDigest: digestStructuredValue("changed"),
              },
            },
          },
        },
        f.scope,
      ),
    ).toThrow(ModelCommercialWorkflowPersistenceError);
    expect(() => {
      assertWorkflowTransition(record, { ...record, response: null });
    }).toThrow(ModelCommercialWorkflowPersistenceError);
    if (row === undefined) throw new Error("Missing row.");
    row["snapshot_sha256"] = "0".repeat(64);
    await expect(
      f.store.claimExecution(commercialClaim(f.request)),
    ).rejects.toThrow(ModelCommercialWorkflowPersistenceError);
  });
  it("never exposes raw SQL exception details", async () => {
    const f = fixture();
    vi.spyOn(f.database, "transaction").mockRejectedValue(
      new Error("sensitive SQL duplicate key value"),
    );
    await expect(
      f.store.claimExecution(commercialClaim(f.request)),
    ).rejects.toThrow(
      "Commercial workflow persistence is unavailable or contradictory.",
    );
  });
  it("retains the original unverified receipt before a fail-closed attestation downgrade", async () => {
    const f = fixture();
    const result = await f.coordinator.execute(f.request, (context) =>
      Promise.resolve({
        attempts: [],
        completedAt: f.database.now,
        failureCategory: "host-attested-pre-dispatch-no-usage",
        resultId: "result_attested",
        status: "internal-failure",
        usefulOutputDelivered: false,
        preDispatchNoUsageAttestation: {
          attestationId: "attestation_one",
          authority: "host-dispatch-v1",
          dispatchIntentId: context.dispatchIntentId,
          multiCallWorkflowId: f.request.multiCallWorkflowId,
          organizationId: f.scope.organizationId,
          projectId: f.scope.projectId,
          reservationId: f.request.reservationId,
          noUsageObserved: true,
          providerDispatchStarted: false,
          verifierId: "unrecognized_verifier",
          verifierVersion: "1",
        },
      }),
    );
    expect(result.state).toBe("reconciliation-required");
    const receipts = f.database.history
      .map(snapshotRecord)
      .map((record) => record.invocationReceipt)
      .filter((receipt) => receipt !== null);
    expect(
      receipts.some(
        (receipt) =>
          receipt.result.preDispatchNoUsageAttestation?.verifierId ===
          "unrecognized_verifier",
      ),
    ).toBe(true);
    expect(receipts.at(-1)?.result.failureCategory).toBe(
      "unsafe-provider-receipt",
    );
    expect(f.accounting.releaseCalls).toBe(0);
  });
  it("bounds canonical metadata and preserves uncertain dispatch when a later receipt exceeds the row budget", async () => {
    const f = fixture();
    const planned = f.request.plannedCalls[0];
    if (planned === undefined) throw new Error("Missing planned call.");
    const request = {
      ...f.request,
      plannedCalls: Array.from({ length: 16 }, () => planned),
    };
    const invocation = commercialInvocation(request);
    const attempt = invocation.attempts[0];
    if (attempt === undefined) throw new Error("Missing attempt.");
    const largeReceipt = {
      ...invocation,
      attempts: Array.from({ length: 16 }, (_, index) => ({
        ...attempt,
        callId: `call_${String(index)}`,
        attemptId: `attempt_${String(index)}`,
        invocationId: `invocation_${String(index)}`,
        usageRecordId: `usage_${String(index)}`,
        attemptNumber: index + 1,
        retryOfAttemptId: index === 0 ? null : `attempt_${String(index - 1)}`,
        providerRequestId: `provider_${String(index)}_` + "x".repeat(100),
      })),
    };
    expect(() =>
      workflowJson({ padding: "x".repeat(COMMERCIAL_WORKFLOW_MAXIMUM_BYTES) }),
    ).toThrow(ModelCommercialWorkflowPersistenceError);
    const h = commercialHarness(f.store, request, () => f.database.now);
    const invoke = vi.fn().mockResolvedValue(largeReceipt);
    await expect(h.coordinator.execute(request, invoke)).rejects.toMatchObject({
      code: "dependency-failure",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    const stored = [...f.database.rows.values()][0];
    expect(stored).toBeDefined();
    const bounded = snapshotRecord(stored?.["snapshot"]);
    expect(bounded.dispatchIntent).not.toBeNull();
    expect(bounded.invocationReceipt).toBeNull();
    expect(
      new TextEncoder().encode(JSON.stringify(stored)).byteLength,
    ).toBeLessThan(65536);
    expect((await h.coordinator.recover(request)).state).toBe(
      "reconciliation-required",
    );
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("pins metadata history, tenant ownership, and irreversible SQL transition guards", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0022_model_commercial_workflows.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(splitPostgresStatements(source)).toHaveLength(12);
    for (const evidence of [
      "REFERENCES memberships(organization_id, principal_id)",
      "REFERENCES projects(organization_id, project_id)",
      "commercial history requires exact current workflow evidence",
      "NEW.fence <> OLD.fence + 1",
      "OLD.lease_expires_at <= clock_timestamp()",
      "BEFORE UPDATE OR DELETE ON model_commercial_workflow_revisions",
      "unsafe-provider-receipt",
    ])
      expect(source).toContain(evidence);
  });
  it("groups JSON extraction before subtraction and retains the exact request key allow-list", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0022_model_commercial_workflows.sql",
        import.meta.url,
      ),
      "utf8",
    );
    // PostgreSQL assigns '-' higher precedence than '->'. Without grouping,
    // 'request' is coerced to JSONB and CREATE TABLE fails with SQLSTATE22P02.
    expect(source).not.toMatch(/(?:->>?|#>>?)\s*'[^']*'\s*[-+*/%^]/u);
    const required = /\(snapshot->'request'\) \?& ARRAY\[([^\]]+)\]/u.exec(
      source,
    )?.[1];
    const allowed =
      /\(snapshot->'request'\) - ARRAY\[([^\]]+)\] = '\{\}'::jsonb/u.exec(
        source,
      )?.[1];
    expect(required).toBeDefined();
    expect(allowed).toBe(required);
    expect(
      required
        ?.split(",")
        .map((key) => key.replaceAll("'", ""))
        .sort(),
    ).toEqual(Object.keys(commercialRequest()).sort());
    expect(source).toContain(
      "CHECK (jsonb_typeof(snapshot->'request') = 'object'",
    );
  });
});
