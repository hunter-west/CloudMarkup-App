import { afterEach, describe, expect, it, vi } from "vitest";
import { BETA_AI_PRICING_V1 as pricing } from "../../application/beta-ai-pricing.js";
import {
  runAuthorizedCleanupPage,
  CleanupCheckpointPending,
  type CleanupIdentity,
} from "../../application/beta-ai-cleanup-owner.js";
import {
  CLEANUP_RETENTION_POLICY,
  cleanupRetentionEligibility,
} from "../../application/beta-ai-cleanup-retention.js";
import {
  PostgresBetaAiCleanupStore,
  readCleanupCompletionProof,
} from "./beta-ai-cleanup-store.js";
import {
  PostgresBetaAiCreditMeter,
  betaAiReservationId,
} from "./beta-ai-credit-meter.js";
import { AuthorizedBetaAiCleanupDatabase } from "../../production-beta-ai-cleanup.js";
import { permissionsForRole } from "../../application/authorization.js";
import type { PrincipalContext } from "../../application/ports.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

const org = "org_cleanup",
  epoch = "restore_fixture";
const identity = (n = 0): CleanupIdentity => {
  const value = {
    organizationId: org,
    projectId: "project_fixture",
    jobId: "job_" + String(n),
    purpose: "proposal" as const,
    requestSha256: "a".repeat(64),
  };
  return { ...value, reservationId: betaAiReservationId(value) };
};
const actor: PrincipalContext = {
  principalId: "principal_fixture",
  authenticationSource: "cognito",
  authenticatedAt: "2026-11-12T00:00:00.000Z",
  expiresAt: "2026-11-12T03:00:00.000Z",
  sessionId: "session_fixture",
  correlationId: "correlation_fixture",
};
const canonical = (id: CleanupIdentity): Record<string, unknown> => ({
  organization_id: id.organizationId,
  reservation_id: id.reservationId,
  project_id: id.projectId,
  job_id: id.jobId,
  purpose: id.purpose,
  request_sha256: id.requestSha256,
  reservation_project_id: id.projectId,
  reservation_job_id: id.jobId,
  reservation_request_sha256: id.requestSha256,
  request_id: id.reservationId,
  state: "released",
  financial_status: "released",
  dispatched_at: "2026-11-12T00:00:00.000Z",
  usage_observed_at: "2026-11-12T00:00:01.000Z",
  observed_input_tokens: "1200",
  observed_output_tokens: "300",
  observed_cached_input_tokens: "0",
  observed_provider_request_id: "synthetic",
  pricing_version_id: pricing.pricingVersionId,
  charging_policy_version: pricing.chargingPolicyVersion,
  provider_key: pricing.providerKey,
  model_key: pricing.modelId,
  model_version: pricing.modelVersion,
  price_provider_key: pricing.providerKey,
  price_model_key: pricing.modelId,
  price_model_version: pricing.modelVersion,
  price_currency: "USD",
  price_input_rate: String(pricing.inputMicrosPerMillionTokens),
  price_output_rate: String(pricing.outputMicrosPerMillionTokens),
  price_cached_rate: String(pricing.cachedInputMicrosPerMillionTokens),
});

/** SQL/transaction doubles only. Native privileges, locks, isolation and driver
 * fault behaviour remain separate gates. No provider, account or real data. */
class CleanupDatabase implements SqlDatabase {
  rows = new Map<string, Record<string, unknown>>();
  ledger = new Map<string, SqlRow[]>();
  operations = new Map<string, Record<string, unknown>>();
  diagnostics = new Map<string, Record<string, unknown>>();
  outcomes = new Map<string, unknown>();
  snapshot: unknown = null;
  now = "2026-11-12T00:00:02.000Z";
  active = true;
  held = false;
  epoch = epoch;
  session = true;
  member = true;
  failBefore: "prepare" | "complete" | null = null;
  loseAck: "prepare" | "complete" | "retire" | null = null;
  queries: SqlStatement[] = [];
  onQuery: ((statement: SqlStatement) => void) | undefined;
  constructor(ids = [identity()]) {
    for (const id of ids) {
      this.rows.set(id.reservationId, canonical(id));
      this.ledger.set(id.reservationId, [
        {
          organization_id: org,
          reservation_id: id.reservationId,
          project_id: id.projectId,
          job_id: id.jobId,
          request_id: id.reservationId,
          entry_kind: "release",
          ledger_entry_id: "ledger.release." + id.reservationId,
        },
      ]);
    }
  }
  close() {
    return Promise.resolve();
  }
  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const before = structuredClone({
      operations: this.operations,
      diagnostics: this.diagnostics,
      outcomes: this.outcomes,
      snapshot: this.snapshot,
    });
    let result: T;
    try {
      result = await work(this);
    } catch (error) {
      Object.assign(this, before);
      throw error;
    }
    const last = [...this.operations.values()].at(-1);
    if (
      this.loseAck &&
      (last?.["kind"] === this.loseAck ||
        (this.loseAck === "retire" &&
          [...this.diagnostics.values()].some((d) => d["retired_at"])))
    ) {
      this.loseAck = null;
      throw Error("synthetic lost acknowledgement");
    }
    return result;
  }
  query<T extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<T>> {
    this.queries.push(statement);
    this.onQuery?.(statement);
    const { text, values: v } = statement;
    let rows: SqlRow[] = [],
      rowCount = 1;
    if (text.includes("pg_advisory_xact_lock")) rows = [];
    else if (text.includes("FROM principals WHERE")) rows = [];
    else if (text.includes("cloudmarkup_account_session_allowed_v1"))
      rows = [{ allowed: this.session }];
    else if (text.includes("capabilities_json"))
      rows =
        this.member && v[1] === org
          ? [
              {
                membership_id: "membership_fixture",
                role_key: "owner",
                capabilities_json: JSON.stringify(permissionsForRole("owner")),
              },
            ]
          : [];
    else if (text.startsWith("SELECT organization_id,restore_epoch"))
      rows = [
        {
          organization_id: org,
          restore_epoch: this.epoch,
          resume_allowed: this.active,
          held: this.held,
        },
      ];
    else if (text.startsWith("SELECT snapshot"))
      rows = this.snapshot
        ? [{ snapshot: structuredClone(this.snapshot) }]
        : [];
    else if (text.startsWith("SELECT payload_sha256")) {
      const r = this.operations.get(String(v[2]));
      rows = r ? [structuredClone(r)] : [];
    } else if (text.startsWith("SELECT r.status AS financial_status")) {
      const r = this.rows.get(String(v[1]));
      rows = r ? [{ financial_status: r["financial_status"] }] : [];
      expect(v).toEqual([
        org,
        identity().reservationId,
        "project_fixture",
        "job_0",
        "proposal",
        "a".repeat(64),
      ]);
    } else if (text.startsWith("SELECT i.organization_id")) {
      const r = this.rows.get(String(v[1]));
      rows = r ? [structuredClone(r)] : [];
    } else if (text.includes("FROM usage_ledger_entries"))
      rows = structuredClone(this.ledger.get(String(v[1])) ?? []);
    else if (text.startsWith("INSERT INTO beta_ai_cleanup_outcomes"))
      this.outcomes.set(String(v[1]), v[6]);
    else if (text.startsWith("INSERT INTO beta_ai_cleanup_operations")) {
      if (v[4] === this.failBefore) throw Error("synthetic before commit");
      expect(this.operations.has(String(v[2]))).toBe(false);
      this.operations.set(String(v[2]), {
        payload_sha256: v[3],
        kind: v[4],
        checkpoint: JSON.parse(String(v[5])),
        identities: JSON.parse(String(v[6])),
        verification_sha256: v[7],
        verified_completed_at: v[7] !== null ? this.now : null,
      });
    } else if (text.startsWith("INSERT INTO beta_ai_cleanup_diagnostics"))
      this.diagnostics.set(String(v[2]), {
        details: JSON.parse(String(v[3])),
        retired_at: null,
      });
    else if (text.startsWith("INSERT INTO beta_ai_cleanup_checkpoints")) {
      const old = this.snapshot as { generation: string } | null;
      if (old && old.generation !== v[4]) rowCount = 0;
      else this.snapshot = JSON.parse(String(v[3]));
    } else if (text.startsWith("SELECT o.identities")) {
      const o = this.operations.get(String(v[2])),
        d = this.diagnostics.get(String(v[2]));
      rows =
        o && d
          ? [{ ...structuredClone(o), ...structuredClone(d), now: this.now }]
          : [];
    } else if (
      text.startsWith("SELECT operation_id FROM beta_ai_cleanup_diagnostics")
    )
      rows = [...this.diagnostics.keys()]
        .sort()
        .filter((k) => k > String(v[2]))
        .slice(0, 25)
        .map((operation_id) => ({ operation_id }));
    else if (text.startsWith("UPDATE beta_ai_cleanup_diagnostics")) {
      const d = this.diagnostics.get(String(v[2]));
      if (!d || d["retired_at"]) rowCount = 0;
      else Object.assign(d, { details: null, retired_at: this.now });
    } else throw Error("Unexpected synthetic cleanup query: " + text);
    return Promise.resolve({
      rows: rows as T[],
      rowCount: rows.length || rowCount,
    });
  }
}
function fixture(ids = [identity()]) {
  const db = new CleanupDatabase(ids),
    admission = { currentEpoch: () => Promise.resolve(epoch) },
    store = new PostgresBetaAiCleanupStore(db, org, admission);
  const selected: (string | null)[] = [],
    called: string[] = [],
    failed = new Set<string>();
  const f = {
    db,
    store,
    selected,
    called,
    failed,
    allowed: true,
    authorize: () => {
      if (!f.allowed) throw Error("revoked");
      return Promise.resolve({ organizationId: org });
    },
    checkpoints: store,
    meter: {
      select: (_org: string, cursor: string | null) => {
        selected.push(cursor);
        const page = ids
          .filter((i) => cursor === null || i.reservationId > cursor)
          .slice(0, 25);
        return Promise.resolve({
          identities: page,
          nextCursor:
            page.length === 25 ? required(page.at(-1)).reservationId : null,
        });
      },
      reconcile: (id: CleanupIdentity) => {
        called.push(id.reservationId);
        return Promise.resolve({
          ...id,
          financial: failed.has(id.reservationId)
            ? ("conflict" as const)
            : ("released" as const),
          cleanup: "complete" as const,
          accounting: "known" as const,
        });
      },
    },
  };
  return f;
}
afterEach(() => vi.restoreAllMocks());

describe("durable cleanup owner and operational retention", () => {
  it("checkpoints before execution, advances a failing prefix, revisits unresolved rows and restarts sweeps", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => identity(i)).sort((a, b) =>
      a.reservationId.localeCompare(b.reservationId),
    );
    const f = fixture(ids);
    ids.slice(0, 25).forEach((i) => f.failed.add(i.reservationId));
    const first = await runAuthorizedCleanupPage(f);
    expect(first.receipt?.verifiedCompletedAt).toBeNull();
    expect(f.db.outcomes.size).toBe(25);
    const second = await runAuthorizedCleanupPage(f);
    expect(second.sweepFinished).toBe(true);
    expect(second.receipt?.verifiedCompletedAt).toBe(f.db.now);
    await runAuthorizedCleanupPage(f);
    expect(f.selected).toEqual([null, required(ids[24]).reservationId, null]);
    expect(f.called).toHaveLength(55);
    expect([...f.db.outcomes.values()].filter((v) => v === null)).toHaveLength(
      25,
    );
  });
  it.each(["prepare", "complete"] as const)(
    "retains exact page and timestamp across %s precommit and lost-ack failures",
    async (kind) => {
      const f = fixture();
      const commits = vi.spyOn(f.store, "commit");
      f.db.failBefore = kind;
      await expect(runAuthorizedCleanupPage(f)).rejects.toBeInstanceOf(
        CleanupCheckpointPending,
      );
      expect(f.called).toHaveLength(kind === "prepare" ? 0 : 1);
      f.db.failBefore = null;
      f.db.loseAck = kind;
      const recovered = await runAuthorizedCleanupPage(f);
      expect(recovered.receipt?.verifiedCompletedAt).toBe(f.db.now);
      const saved = required(recovered.receipt);
      f.db.now = "2026-11-13T00:00:00.000Z";
      expect(await f.store.receipt(org, saved.operationId)).toEqual(saved);
      expect(f.selected).toHaveLength(kind === "prepare" ? 2 : 1);
      if (kind === "complete") {
        const exact = required(
          commits.mock.calls.findLast(([c]) => c.kind === "complete"),
        )[0];
        expect(await f.store.commit(exact)).toEqual(saved);
        await expect(
          f.store.commit({
            ...exact,
            outcomes: [
              { ...required(exact.outcomes[0]), accounting: "unresolved" },
            ],
          }),
        ).rejects.toThrow("conflicts");
      }
    },
  );
  it("rejects competing CAS, foreign scope, revocation and restored old epochs before executing more work", async () => {
    const f = fixture(
      [identity(), identity(1)].sort((a, b) =>
        a.reservationId.localeCompare(b.reservationId),
      ),
    );
    f.meter.reconcile = (id) => {
      f.called.push(id.reservationId);
      f.allowed = false;
      return Promise.resolve({
        ...id,
        financial: "released",
        cleanup: "complete",
        accounting: "known",
      });
    };
    await expect(runAuthorizedCleanupPage(f)).rejects.toThrow("revoked");
    expect(f.called).toHaveLength(1);
    expect((f.db.snapshot as { pending: unknown }).pending).not.toBeNull();
    await expect(f.store.load("org_other")).rejects.toThrow("conflicts");
    f.allowed = true;
    f.db.epoch = "restored_old";
    await expect(runAuthorizedCleanupPage(f)).rejects.toThrow(
      "restore admission",
    );
    expect(f.called).toHaveLength(1);
    const g = fixture();
    const select = g.meter.select;
    g.meter.select = async (...args) => {
      const page = await select(...args);
      g.db.snapshot = {
        organizationId: org,
        restoreEpoch: epoch,
        generation: "999",
        sweep: "0",
        cursor: null,
        pending: null,
      };
      return page;
    };
    await expect(runAuthorizedCleanupPage(g)).rejects.toBeInstanceOf(
      CleanupCheckpointPending,
    );
    expect(g.called).toHaveLength(0);
  });
  it("proves original pricing and surviving canonical usage instead of trusting known outcome flags", async () => {
    const f = fixture(),
      row = required(f.db.rows.get(identity().reservationId));
    expect(await readCleanupCompletionProof(f.db, identity())).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    const reversed = Object.fromEntries(
      Object.entries(identity()).reverse(),
    ) as unknown as CleanupIdentity;
    expect(await readCleanupCompletionProof(f.db, reversed)).toBe(
      await readCleanupCompletionProof(f.db, identity()),
    );
    row["reservation_request_sha256"] = "b".repeat(64);
    expect(await readCleanupCompletionProof(f.db, identity())).toBeNull();
    row["reservation_request_sha256"] = "a".repeat(64);
    row["price_input_rate"] = "1";
    expect(await readCleanupCompletionProof(f.db, identity())).toBeNull();
    row["price_input_rate"] = String(pricing.inputMicrosPerMillionTokens);
    row["usage_observed_at"] = null;
    row["usage_recorded_at"] = f.db.now;
    row["input_tokens"] = "1200";
    row["output_tokens"] = "300";
    row["cached_input_tokens"] = "0";
    row["provider_request_id"] = "synthetic";
    const r = await runAuthorizedCleanupPage(f);
    expect(r.outcomes[0]?.accounting).toBe("known");
    expect(r.receipt?.verifiedCompletedAt).toBeNull();
    expect((await f.store.retentionPage()).records[0]?.blocked).toContain(
      "completion-unverified",
    );
  });
  it("keeps exact receipts after synthetic retirement, rechecks holds, resolves lost acknowledgements and never recreates details", async () => {
    const f = fixture();
    const r = await runAuthorizedCleanupPage(f);
    const operation = required(r.receipt).operationId;
    f.db.now = "2027-01-11T00:00:02.000Z";
    expect((await f.store.retentionPage()).records[0]?.eligible).toBe(true);
    f.db.held = true;
    const authorize = vi.fn(() => Promise.resolve());
    expect(
      (await f.store.retireDiagnostics(operation, authorize)).blocked,
    ).toContain("held");
    expect(f.db.diagnostics.get(operation)?.["details"]).not.toBeNull();
    f.db.held = false;
    f.db.loseAck = "retire";
    await expect(
      f.store.retireDiagnostics(operation, authorize),
    ).rejects.toThrow("lost acknowledgement");
    expect(
      (await f.store.retireDiagnostics(operation, authorize)).alreadyRetired,
    ).toBe(true);
    expect(f.db.diagnostics.get(operation)?.["details"]).toBeNull();
    expect(await f.store.receipt(org, operation)).toEqual(r.receipt);
    expect(
      f.db.rows.get(identity().reservationId)?.["observed_input_tokens"],
    ).toBe("1200");
    expect(
      f.db.queries.some((q) =>
        /DELETE|UPDATE (?:credit_reservations|usage_ledger_entries|beta_ai_invocations)/u.test(
          q.text,
        ),
      ),
    ).toBe(false);
  });
  it("enforces completion-relative 60-day boundary and excludes clocks, pending work, unique classes, restore and changed evidence", () => {
    const proof = "f".repeat(64),
      at = "2026-11-12T00:00:00.000Z";
    const e = {
      recordClass: "redundant-page-details",
      policy: CLEANUP_RETENTION_POLICY,
      verifiedCompletedAt: at,
      now: "2027-01-11T00:00:00.000Z",
      restoreAdmitted: true,
      sameEpoch: true,
      held: false,
      pending: false,
      dependenciesRetained: true,
      originalProof: proof,
      currentProof: proof,
    };
    expect(
      cleanupRetentionEligibility({ ...e, now: "2027-01-10T23:59:59.999Z" })
        .eligible,
    ).toBe(false);
    expect(cleanupRetentionEligibility(e).eligible).toBe(true);
    expect(
      cleanupRetentionEligibility({ ...e, now: "2027-01-11T00:00:00.001Z" })
        .eligible,
    ).toBe(true);
    for (const override of [
      { recordClass: "provider-observation" },
      { recordClass: "browser-quarantine" },
      { recordClass: "exact-operation-receipt" },
      { verifiedCompletedAt: null },
      { now: "invalid" },
      { now: "2026-11-11T00:00:00.000Z" },
      { held: true },
      { pending: true },
      { sameEpoch: false },
      { restoreAdmitted: false },
      { dependenciesRetained: false },
      { currentProof: null },
      { currentProof: "e".repeat(64) },
    ])
      expect(cleanupRetentionEligibility({ ...e, ...override }).eligible).toBe(
        false,
      );
  });
  it("checks canonical current sessions at transaction boundaries; ordinary membership alone cannot authorize cleanup", async () => {
    const db = new CleanupDatabase(),
      admission = { currentEpoch: () => Promise.resolve(epoch) };
    const guarded = new AuthorizedBetaAiCleanupDatabase(
      db,
      actor,
      org,
      admission,
      () => new Date("2026-11-12T01:00:00.000Z"),
    );
    await expect(guarded.context()).resolves.toMatchObject({
      organizationId: org,
    });
    db.session = false;
    await expect(guarded.context()).rejects.toMatchObject({
      code: "authentication_required",
    });
    db.session = true;
    db.member = false;
    await expect(guarded.context()).rejects.toMatchObject({
      code: "not_found",
    });
    db.member = true;
    await expect(
      guarded.transaction(() => {
        db.session = false;
        return Promise.resolve("must not escape");
      }),
    ).rejects.toMatchObject({ code: "authentication_required" });
    db.session = true;
    const foreign = new AuthorizedBetaAiCleanupDatabase(
      db,
      actor,
      "org_other",
      admission,
      () => new Date("2026-11-12T01:00:00.000Z"),
    );
    await expect(foreign.context()).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it("selects without financial writes and executes only the exact retained identity through the existing release owner", async () => {
    const id = identity(),
      db = new CleanupDatabase();
    const original = db.query.bind(db);
    db.query = async <T extends SqlRow>(
      s: SqlStatement,
    ): Promise<SqlResult<T>> =>
      s.text.startsWith("SELECT i.reservation_id")
        ? {
            rowCount: 1,
            rows: [
              {
                reservation_id: id.reservationId,
                project_id: id.projectId,
                job_id: id.jobId,
                purpose: id.purpose,
                request_sha256: id.requestSha256,
              },
            ] as unknown as T[],
          }
        : original<T>(s);
    const meter = new PostgresBetaAiCreditMeter(db, db),
      release = vi
        .spyOn(meter, "release")
        .mockResolvedValue({ cleanup: "complete", accounting: "known" });
    expect((await meter.selectReleasedAccounting(org)).identities).toEqual([
      id,
    ]);
    expect(release).not.toHaveBeenCalled();
    expect(await meter.reconcileReleasedAccountingIdentity(id)).toMatchObject({
      financial: "released",
      accounting: "known",
    });
    expect(release).toHaveBeenCalledExactlyOnceWith(id);
    await expect(
      meter.reconcileReleasedAccountingIdentity({
        ...id,
        reservationId: "beta-ai." + "0".repeat(64),
      }),
    ).rejects.toThrow("identity conflicts");
    expect(release).toHaveBeenCalledTimes(1);
    required(db.rows.get(id.reservationId))["financial_status"] = "active";
    expect(await meter.reconcileReleasedAccountingIdentity(id)).toMatchObject({
      financial: "conflict",
      cleanup: "pending",
    });
    expect(release).toHaveBeenCalledTimes(1);
    expect(
      db.queries.some((q) => /^INSERT|^UPDATE|^DELETE/u.test(q.text)),
    ).toBe(false);
  });
});

function required<T>(value: T | null | undefined): T {
  if (value == null) throw Error("Missing synthetic fixture value");
  return value;
}
