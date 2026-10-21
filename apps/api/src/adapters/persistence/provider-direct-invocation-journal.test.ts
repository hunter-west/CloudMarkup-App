import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { RetainedProviderDirectDispatchFence } from "../../self-host/retained-provider-dispatch.js";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  digestCanonicalValue as digest,
  normalizedModelUsageV1Schema,
} from "@cloudmarkup/schemas";
import type {
  ServerByokInvocationIdentityV1,
  ServerByokInvocationLeaseV1,
} from "@cloudmarkup/model-gateway/server-byok";
import {
  requireProviderDirectBindingV1,
  requireProviderDirectJobAuthorityV1,
  createProviderDirectInvocationPolicyV1,
} from "../../self-host/provider-direct-invocation-policy.js";
import { PostgresProviderDirectInvocationJournalV1 } from "./provider-direct-invocation-journal.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";
function fixture() {
  const binding = requireProviderDirectBindingV1({
    attemptNumber: 1,
    feature: "architecture.propose",
    idempotencyKeyDigest: digest("synthetic key"),
    invocationId: "synthetic_invocation",
    usageRecordId: "synthetic_usage",
    scope: {
      organizationId: "synthetic_org",
      projectId: "synthetic_project",
      userId: "synthetic_user",
      jobId: "synthetic_job",
    },
    contractVersion: 1,
    fundingSource: "provider-direct",
    providerId: "openai.responses",
    modelId: "openai.gpt-5-4-2026-03-05",
    modelVersion: "gpt-5.4-2026-03-05",
    role: "architecture",
    operationVersion: 1,
    promptTemplateId: "cloudmarkup.synthetic",
    promptVersion: "1.0.0",
    promptDigest: digest("prompt"),
    inputDigest: digest("input"),
    wireDigest: digest("wire"),
    schemaDigest: digest("schema"),
    configurationDigest: digest("config"),
    maximumOutputTokens: 100,
    maximumInputBytes: 1000,
    maximumRequestBytes: 2000,
    maximumResponseBytes: 1000,
    deadlineMilliseconds: 1000,
  });
  const identity: ServerByokInvocationIdentityV1 = {
    attemptNumber: binding.attemptNumber,
    feature: binding.feature,
    idempotencyKeyDigest: binding.idempotencyKeyDigest,
    invocationId: binding.invocationId,
    usageRecordId: binding.usageRecordId,
    scope: binding.scope,
  };
  const authority = requireProviderDirectJobAuthorityV1({
    attemptId: "synthetic_attempt",
    workerReference: "synthetic_worker",
    jobInputDigest: digest("job input"),
    correlationId: "synthetic_correlation",
  });
  const quota = {
    windowId: "synthetic_window",
    startsAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    maximumRequests: 10,
    maximumOutputTokenUnits: "1000",
    maximumConcurrent: 2,
  };
  const usage = normalizedModelUsageV1Schema.parse({
    ...identity,
    contractVersion: 1,
    inputDigest: binding.inputDigest,
    providerId: binding.providerId,
    modelId: binding.modelId,
    modelVersion: binding.modelVersion,
    promptTemplateId: binding.promptTemplateId,
    promptVersion: binding.promptVersion,
    inputUnits: "20",
    outputUnits: "7",
    cacheReadUnits: "4",
    cacheWriteUnits: "0",
    thinkingUnits: "0",
    providerRequestId: "req_synthetic",
    startedAt: "2026-10-12T00:00:00.000Z",
    completedAt: "2026-10-12T00:00:00.100Z",
    durationMilliseconds: 100,
    result: "invalid-output",
  });
  const { result, ...observation } = usage;
  void result;
  return { binding, identity, authority, quota, usage, observation };
}

// Test-only SQL fixture. Real transaction, RLS, privileges, triggers and restart
// semantics still need the coordinator's separately assigned PostgreSQL scope.
class SyntheticDatabase implements SqlDatabase {
  rows = new Map<string, Record<string, unknown>>();
  statements: SqlStatement[] = [];
  allowed = true;
  login = "cloudmarkup_beta_proposal_runtime";
  isolation = "read committed";
  windowCurrent = true;
  failUpdate = false;
  loseCommit = false;
  afterAuthority: (() => void) | undefined;
  afterUpdate: (() => void) | undefined;
  close = vi.fn(() => Promise.resolve());
  #tail: Promise<void> = Promise.resolve();
  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    this.statements.push(statement);
    const text = statement.text,
      v = statement.values;
    const result = (rows: SqlRow[] = [], rowCount = rows.length) =>
      Promise.resolve({ rows, rowCount } as SqlResult<TRow>);
    if (text.includes("set_config") || text.includes("pg_advisory_xact_lock"))
      return result([{}]);
    if (text.includes("session_user::text"))
      return result([
        {
          login: this.login,
          effective_role: this.login,
          isolation: this.isolation,
        },
      ]);
    if (text.includes("cloudmarkup_provider_direct_assert_authority_v1")) {
      this.afterAuthority?.();
      return result([{ allowed: this.allowed }]);
    }
    if (text.startsWith("SELECT binding_metadata")) {
      const row = this.rows.get(String(v[3]));
      return result(
        row !== undefined &&
          row["organization_id"] === v[0] &&
          row["project_id"] === v[1] &&
          row["principal_id"] === v[2]
          ? [structuredClone(row)]
          : [],
      );
    }
    if (text.startsWith("SELECT invocation_id")) {
      return result(
        [...this.rows.values()].filter(
          (row) =>
            row["organization_id"] === v[0] &&
            (row["idempotency_key_sha256"] === v[1] ||
              row["usage_record_id"] === v[2] ||
              (row["job_id"] === v[3] &&
                row["feature"] === v[4] &&
                row["model_role"] === v[5])),
        ),
      );
    }
    if (text.startsWith("SELECT count(*)")) {
      const rows = [...this.rows.values()].filter(
        (row) => row["organization_id"] === v[0],
      );
      const open = (row: SqlRow) =>
        ["claimed", "dispatched", "observed", "uncertain"].includes(
          String(row["state"]),
        );
      const relevant = rows.filter(
        (row) => row["quota_window_id"] === v[1] || open(row),
      );
      let units = BigInt(0);
      for (const row of relevant) {
        const usage: unknown =
          typeof row["usage_metadata"] === "string"
            ? JSON.parse(row["usage_metadata"])
            : row["usage_metadata"];
        if (
          usage !== null &&
          typeof usage === "object" &&
          "outputUnits" in usage
        )
          units += BigInt(String(usage.outputUnits));
        else if (row["state"] !== "not-dispatched")
          units += BigInt(String(row["reserved_output_units"]));
      }
      const current = rows.filter((row) => row["quota_window_id"] === v[1]);
      return result([
        {
          requests: String(
            rows.filter(
              (row) =>
                (row["quota_window_id"] === v[1] &&
                  row["state"] !== "not-dispatched") ||
                (row["quota_window_id"] !== v[1] && open(row)),
            ).length,
          ),
          concurrent: String(rows.filter(open).length),
          output_units: String(units),
          window_current: this.windowCurrent,
          configuration_matches:
            current.length === 0
              ? null
              : current.every((row) => row["quota_sha256"] === v[2]),
        },
      ]);
    }
    if (text.startsWith("INSERT INTO")) {
      const fields = [
        "organization_id",
        "project_id",
        "principal_id",
        "invocation_id",
        "job_id",
        "attempt_number",
        "feature",
        "model_role",
        "idempotency_key_sha256",
        "usage_record_id",
        "binding_metadata",
        "binding_sha256",
        "authority_metadata",
        "authority_sha256",
        "lease_token",
        "quota_window_id",
        "quota_metadata",
        "quota_sha256",
        "reserved_output_units",
      ];
      const row: Record<string, unknown> = Object.fromEntries(
        fields.map((key, index) => [key, v[index]]),
      );
      row["state"] = "claimed";
      row["revision"] = 1;
      row["usage_metadata"] = null;
      row["usage_sha256"] = null;
      row["outcome_metadata"] = null;
      this.rows.set(String(v[3]), row);
      return result([], 1);
    }
    if (text.startsWith("UPDATE provider_direct")) {
      if (this.failUpdate) throw Error("Synthetic write failure; no live SQL");
      const row = this.rows.get(String(v[3]));
      if (
        row === undefined ||
        row["lease_token"] !== v[10] ||
        row["state"] !== v[11] ||
        String(row["revision"]) !== v[12]
      )
        return result([], 0);
      row["state"] = v[4];
      if (v[5] !== null) {
        row["usage_metadata"] = v[5];
        row["usage_sha256"] = v[6];
      }
      if (v[7] !== null) {
        row["outcome_metadata"] = v[7];
        row["outcome_sha256"] = v[8];
      }
      row["uncertain_reason"] = v[9];
      row["revision"] = Number(row["revision"]) + 1;
      this.afterUpdate?.();
      return result([], 1);
    }
    throw Error("Unrecognized synthetic SQL fixture statement");
  }
  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release: (() => void) | undefined;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const before = structuredClone(this.rows);
    let committed = false;
    try {
      const value = await work(this);
      committed = true;
      if (this.loseCommit) {
        this.loseCommit = false;
        throw Error("Synthetic lost COMMIT acknowledgement");
      }
      return value;
    } catch (error) {
      if (!committed) this.rows = before;
      throw error;
    } finally {
      release?.();
    }
  }
}

function setup() {
  const f = fixture(),
    database = new SyntheticDatabase();
  const journal = () =>
    new PostgresProviderDirectInvocationJournalV1({
      database,
      purpose: "proposal",
      quota: f.quota,
      statementTimeoutMilliseconds: 100,
      dispatchFence: new RetainedProviderDirectDispatchFence({
        root: resolve(tmpdir(), "cm-unused-sql-unit-fence"),
        identity: "b".repeat(64),
      }),
    });
  const running = journal(),
    signal = new AbortController().signal;
  const claim = () => running.claim(f.binding, f.authority, signal);
  const lease = async (): Promise<ServerByokInvocationLeaseV1> => {
    const claimed = await claim();
    if (claimed.disposition !== "dispatch")
      throw Error("Missing synthetic lease");
    return claimed.lease;
  };
  return { f, database, journal, running, signal, claim, lease };
}

// SQL algorithm tests use an explicit fence spy; the owning filesystem suite
// separately executes retained no-replace/restart/partial-inventory behavior.
beforeEach(() => {
  vi.spyOn(
    RetainedProviderDirectDispatchFence.prototype,
    "admit",
  ).mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());
describe("production provider-direct transaction journal with synthetic SQL", () => {
  it("atomically admits one competing claim and records exact metadata without hosted credits", async () => {
    const h = setup();
    const claims = await Promise.all([h.claim(), h.claim()]);
    expect(claims.filter((c) => c.disposition === "dispatch")).toHaveLength(1);
    expect(claims.filter((c) => c.disposition === "uncertain")).toHaveLength(1);
    const first = claims[0];
    if (first.disposition !== "dispatch") throw Error("Missing lease");
    await first.lease.assertCurrent();
    await first.lease.markDispatched();
    await first.lease.observeKnownUsage(h.f.observation);
    await first.lease.finish({ state: "invalid-output", usage: h.f.usage });
    expect(h.database.rows.get(h.f.binding.invocationId)?.["state"]).toBe(
      "finished",
    );
    expect(
      JSON.stringify(
        h.database.rows.get(h.f.binding.invocationId)?.["usage_metadata"],
      ),
    ).not.toContain('"result"');
    await expect(h.claim()).resolves.toEqual({ disposition: "recorded" });
    expect(
      h.database.statements.every(
        (s) => !/(credit|commercial|ledger|subscription)/i.test(s.text),
      ),
    ).toBe(true);
  });
  it("rejects identity/key/job replay conflicts rather than replacing a dispatch lease", async () => {
    const h = setup();
    await h.lease();
    await expect(
      h.running.claim(
        { ...h.f.binding, inputDigest: digest("other") },
        h.f.authority,
        h.signal,
      ),
    ).resolves.toEqual({ disposition: "refused" });
    await expect(
      h.running.claim(
        {
          ...h.f.binding,
          invocationId:
            normalizedModelUsageV1Schema.shape.invocationId.parse(
              "second_invocation",
            ),
          usageRecordId: "second_usage",
        },
        h.f.authority,
        h.signal,
      ),
    ).resolves.toEqual({ disposition: "refused" });
    await expect(
      h.running.claim(
        {
          ...h.f.binding,
          invocationId:
            normalizedModelUsageV1Schema.shape.invocationId.parse(
              "second_invocation",
            ),
          usageRecordId: "second_usage",
          idempotencyKeyDigest: digest("another key"),
          attemptNumber: 2,
        },
        h.f.authority,
        h.signal,
      ),
    ).resolves.toEqual({ disposition: "refused" });
    expect(h.database.rows.size).toBe(1);
  });
  it.each(["requests", "tokens", "concurrent", "configuration", "window"])(
    "enforces atomic %s quota without a hosted reservation",
    async (kind) => {
      const h = setup();
      if (kind === "requests") h.f.quota.maximumRequests = 1;
      if (kind === "tokens") h.f.quota.maximumOutputTokenUnits = "100";
      if (kind === "concurrent") h.f.quota.maximumConcurrent = 1;
      const first = h.journal();
      await first.claim(h.f.binding, h.f.authority, h.signal);
      if (kind === "configuration") h.f.quota.maximumRequests = 100;
      if (kind === "window") h.database.windowCurrent = false;
      await expect(
        h.journal().claim(
          {
            ...h.f.binding,
            invocationId:
              normalizedModelUsageV1Schema.shape.invocationId.parse(
                "new_invocation",
              ),
            usageRecordId: "new_usage",
            scope: { ...h.f.binding.scope, jobId: "new_job" },
            idempotencyKeyDigest: digest("new key"),
          },
          h.f.authority,
          h.signal,
        ),
      ).resolves.toEqual({ disposition: "refused" });
      expect(h.database.rows.size).toBe(1);
    },
  );
  it("retains uncertain reservation through restart and future windows", async () => {
    const h = setup();
    const lease = await h.lease();
    await lease.markDispatched();
    await lease.markUncertain("transport");
    await h.running.close();
    const restart = h.journal();
    await expect(
      restart.claim(h.f.binding, h.f.authority, h.signal),
    ).resolves.toEqual({ disposition: "uncertain" });
    h.f.quota.windowId = "later_window";
    h.f.quota.maximumConcurrent = 1;
    await expect(
      h.journal().claim(
        {
          ...h.f.binding,
          invocationId:
            normalizedModelUsageV1Schema.shape.invocationId.parse(
              "new_invocation",
            ),
          usageRecordId: "new_usage",
          scope: { ...h.f.binding.scope, jobId: "new_job" },
          idempotencyKeyDigest: digest("new key"),
        },
        h.f.authority,
        h.signal,
      ),
    ).resolves.toEqual({ disposition: "refused" });
    expect(
      h.database.rows.get(h.f.binding.invocationId)?.["usage_metadata"],
    ).toBeNull();
    expect(h.database.close).not.toHaveBeenCalled();
  });
  it("allows incurred usage and cancellation completion after access withdrawal", async () => {
    const h = setup(),
      lease = await h.lease();
    await lease.markDispatched();
    h.database.allowed = false;
    await lease.observeKnownUsage(h.f.observation);
    await lease.finish({
      state: "canceled",
      usage: { ...h.f.usage, result: "canceled" },
    });
    const stored = h.database.rows.get(h.f.binding.invocationId);
    expect(stored?.["state"]).toBe("finished");
    await expect(
      h.journal().claim(h.f.binding, h.f.authority, h.signal),
    ).resolves.toEqual({ disposition: "recorded" });
  });
  it("rejects stale/withdrawn authority, unsafe purpose and unsupported isolation before insertion", async () => {
    for (const kind of ["authority", "purpose", "isolation"]) {
      const h = setup();
      if (kind === "authority") h.database.allowed = false;
      if (kind === "purpose") h.database.login = "cloudmarkup_admin";
      if (kind === "isolation") h.database.isolation = "repeatable read";
      await expect(h.claim()).rejects.toThrow(
        "Provider-direct invocation journal is unavailable.",
      );
      expect(h.database.rows.size).toBe(0);
    }
  });
  it("cancels before/during the dispatch fence without any provider request", async () => {
    const h = setup(),
      abort = new AbortController();
    const claimed = await h.running.claim(
      h.f.binding,
      h.f.authority,
      abort.signal,
    );
    if (claimed.disposition !== "dispatch") throw Error("Missing lease");
    h.database.afterAuthority = () => {
      abort.abort();
    };
    await expect(claimed.lease.markDispatched()).rejects.toThrow();
    expect(h.database.rows.get(h.f.binding.invocationId)?.["state"]).toBe(
      "claimed",
    );
    await claimed.lease.markUncertain("dispatch-fence-failed");
    await expect(
      h.journal().claim(h.f.binding, h.f.authority, h.signal),
    ).resolves.toEqual({ disposition: "uncertain" });
  });
  it.each(["authority", "write", "cancellation"])(
    "rolls back dispatch when shutdown or cancellation arrives during %s",
    async (point) => {
      const h = setup(),
        abort = new AbortController();
      const claimed = await h.running.claim(
        h.f.binding,
        h.f.authority,
        abort.signal,
      );
      if (claimed.disposition !== "dispatch") throw Error("Missing lease");
      if (point === "authority")
        h.database.afterAuthority = () => {
          h.running.stopClaims();
        };
      else
        h.database.afterUpdate = () => {
          if (point === "cancellation") abort.abort();
          else h.running.stopClaims();
        };
      await expect(claimed.lease.markDispatched()).rejects.toThrow();
      expect(h.database.rows.get(h.f.binding.invocationId)?.["state"]).toBe(
        "claimed",
      );
      h.database.afterAuthority = undefined;
      h.database.afterUpdate = undefined;
      await claimed.lease.markUncertain("dispatch-fence-failed");
      await h.running.close();
      await expect(
        h.journal().claim(h.f.binding, h.f.authority, h.signal),
      ).resolves.toEqual({ disposition: "uncertain" });
      expect(h.database.close).not.toHaveBeenCalled();
    },
  );
  it("persists incurred observations while dispatch admission is stopped for drain", async () => {
    const h = setup(),
      lease = await h.lease();
    await lease.markDispatched();
    h.running.stopClaims();
    await expect(h.claim()).resolves.toEqual({ disposition: "refused" });
    await lease.observeKnownUsage(h.f.observation);
    await lease.finish({ state: "invalid-output", usage: h.f.usage });
    await h.running.close();
    await expect(
      h.journal().claim(h.f.binding, h.f.authority, h.signal),
    ).resolves.toEqual({ disposition: "recorded" });
    expect(h.database.close).not.toHaveBeenCalled();
  });
  it("rejects duplicate/conflicting/late writes and preserves incurred observation", async () => {
    const h = setup(),
      lease = await h.lease();
    await lease.markDispatched();
    await expect(
      lease.observeKnownUsage({
        ...h.f.observation,
        scope: { ...h.f.observation.scope, organizationId: "other_org" },
      }),
    ).rejects.toThrow();
    await lease.observeKnownUsage(h.f.observation);
    await expect(lease.observeKnownUsage(h.f.observation)).rejects.toThrow();
    await expect(
      lease.finish({ state: "succeeded", usage: h.f.usage }),
    ).rejects.toThrow();
    await lease.markUncertain("outcome-journal-failed");
    await expect(
      lease.finish({ state: "invalid-output", usage: h.f.usage }),
    ).rejects.toThrow();
    const row = h.database.rows.get(h.f.binding.invocationId);
    expect(row?.["usage_metadata"]).not.toBeNull();
    expect(row?.["state"]).toBe("uncertain");
  });
  it("retains lost claim/fence/observation commits and never reclaims after restart", async () => {
    const h = setup();
    h.database.loseCommit = true;
    await expect(h.claim()).rejects.toThrow();
    await expect(
      h.journal().claim(h.f.binding, h.f.authority, h.signal),
    ).resolves.toEqual({ disposition: "uncertain" });
    const other = setup(),
      lease = await other.lease();
    other.database.loseCommit = true;
    await expect(lease.markDispatched()).rejects.toThrow();
    await lease.markUncertain("dispatch-fence-failed");
    await expect(
      other.journal().claim(other.f.binding, other.f.authority, other.signal),
    ).resolves.toEqual({ disposition: "uncertain" });
    const known = setup(),
      knownLease = await known.lease();
    await knownLease.markDispatched();
    known.database.loseCommit = true;
    await expect(
      knownLease.observeKnownUsage(known.f.observation),
    ).rejects.toThrow();
    await knownLease.markUncertain("usage-journal-failed");
    expect(
      known.database.rows.get(known.f.binding.invocationId)?.["usage_metadata"],
    ).not.toBeNull();
  });
  it("rolls back partial writes and quarantines leases after drain without closing borrowed pools", async () => {
    const h = setup(),
      lease = await h.lease();
    h.database.failUpdate = true;
    await expect(lease.markDispatched()).rejects.toThrow();
    expect(h.database.rows.get(h.f.binding.invocationId)?.["state"]).toBe(
      "claimed",
    );
    h.database.failUpdate = false;
    await lease.finish({ state: "not-dispatched" });
    h.running.stopClaims();
    await expect(h.claim()).resolves.toEqual({ disposition: "refused" });
    await h.running.close();
    await h.running.close();
    await expect(lease.markUncertain("transport")).rejects.toThrow();
    expect(h.database.close).not.toHaveBeenCalled();
  });
  it("binds the actual policy factory to the production journal", async () => {
    const h = setup();
    const policy = createProviderDirectInvocationPolicyV1({
      journal: h.running,
      identity: h.f.identity,
      authority: h.f.authority,
      signal: h.signal,
    });
    const claimed = await policy.claim(h.f.binding);
    expect(claimed.disposition).toBe("dispatch");
    await expect(
      policy.claim({
        ...h.f.binding,
        scope: { ...h.f.binding.scope, userId: "other_user" },
      }),
    ).resolves.toEqual({ disposition: "refused" });
  });
});
