import { afterEach, describe, expect, it, vi } from "vitest";
import { BETA_AI_PRICING_V1 } from "../../application/beta-ai-pricing.js";
import {
  BetaAiFinancialReleasePending,
  PostgresBetaAiCreditMeter,
  betaAiReservationId,
  type BetaAiCreditIdentity,
} from "./beta-ai-credit-meter.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";
import { createBetaAiSourceCredits } from "./beta-ai-source-credits.js";
import type { SolutionExportWorkerAuthority } from "./solution-export-worker-authority.js";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import type { BetaApplicationSource } from "@cloudmarkup/model-gateway";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

const identity: BetaAiCreditIdentity = {
  organizationId: "org_accounting_fixture",
  projectId: "project_fixture",
  jobId: "job_fixture",
  purpose: "proposal",
  requestSha256: "a".repeat(64),
};
const usage = {
  inputTokens: 1200,
  outputTokens: 300,
  cacheReadInputTokens: 0,
  providerRequestId: "synthetic-response",
};
const keys = [
  identity.organizationId,
  betaAiReservationId(identity),
  identity.projectId,
  identity.jobId,
  identity.purpose,
  identity.requestSha256,
];

/** Explicit SQL/financial doubles exercise orchestration, not PostgreSQL,
 * privileges, real balances, isolation or actual uncertain commits. */
class EvidenceDatabase implements SqlDatabase {
  row: Record<string, unknown> = {
    state: "dispatched",
    dispatched_at: "2026-11-11T00:00:00Z",
  };
  financial: "active" | "released" = "active";
  observationFailures = 2;
  cleanupFails = false;
  cleanupAttempts = 0;
  close() {
    return Promise.resolve();
  }
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>) {
    return work(this);
  }
  query<T extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<T>> {
    const { text, values } = statement;
    let rows: SqlRow[] = [],
      rowCount = 1;
    if (text.startsWith("SELECT pricing_version_id,")) {
      expect(values).toEqual([keys[0], keys[1], keys[2], keys[3], keys[5]]);
      rows = [
        {
          pricing_version_id: BETA_AI_PRICING_V1.pricingVersionId,
          charging_policy_version: BETA_AI_PRICING_V1.chargingPolicyVersion,
        },
      ];
    } else {
      expect(values.slice(0, 6)).toEqual(keys);
      if (text.startsWith("SELECT state")) rows = [structuredClone(this.row)];
      else if (
        text.startsWith("UPDATE beta_ai_invocations SET usage_observed_at=")
      ) {
        if (this.observationFailures-- > 0)
          return Promise.reject(new Error("synthetic-observation-failure"));
        if (this.row["usage_observed_at"] != null) rowCount = 0;
        else this.observe(values.slice(6));
      } else if (
        text.startsWith("UPDATE beta_ai_invocations SET state='released'")
      ) {
        this.cleanupAttempts++;
        expect(this.financial).toBe("released");
        if (this.cleanupFails)
          return Promise.reject(new Error("synthetic-cleanup-failure"));
        if (this.row["usage_observed_at"] == null) {
          if (values[6]) this.observe(values.slice(7));
          else if (this.row["usage_recorded_at"] != null)
            this.observe([
              this.row["provider_request_id"],
              this.row["input_tokens"],
              this.row["output_tokens"],
              this.row["cached_input_tokens"],
            ]);
        }
        Object.assign(this.row, {
          state: "released",
          usage_recorded_at: null,
          provider_request_id: null,
          input_tokens: null,
          output_tokens: null,
          cached_input_tokens: null,
        });
      } else throw new Error("Unexpected accounting fixture query: " + text);
    }
    return Promise.resolve({ rowCount, rows } as SqlResult<T>);
  }
  observe(values: readonly unknown[]) {
    Object.assign(this.row, {
      usage_observed_at: "2026-11-11T00:01:00Z",
      observed_provider_request_id: values[0],
      observed_input_tokens: String(values[1]),
      observed_output_tokens: String(values[2]),
      observed_cached_input_tokens: String(values[3]),
    });
  }
}
const terminal = () =>
  ({}) as Awaited<
    ReturnType<PostgresCommercialPersistenceRepository["releaseReservation"]>
  >;
function expectKnown(db: EvidenceDatabase) {
  expect(db.row).toMatchObject({
    observed_provider_request_id: usage.providerRequestId,
    observed_input_tokens: "1200",
    observed_output_tokens: "300",
    observed_cached_input_tokens: "0",
  });
}
afterEach(() => vi.restoreAllMocks());

describe("beta AI evidence recovery without another provider invocation", () => {
  it.each(["observation", "publication"] as const)(
    "passes the same source response to release after %s failure",
    async (stage) => {
      const db = new EvidenceDatabase();
      const scope: AuthorizedOrganizationScope = {
        organizationId: identity.organizationId,
        principalId: "principal_fixture",
        sessionId: "session_fixture",
        membershipId: "membership_fixture",
        roleKey: "owner",
        correlationId: "correlation_fixture",
        capabilities: ["projects.mutate", "commercial.expensive.use"],
      };
      // This fixture represents prior admission; it does not test worker authorization.
      const authority = {
        database: db,
        identity,
        scope: () => Promise.resolve(scope),
      } as unknown as SolutionExportWorkerAuthority;
      vi.spyOn(
        PostgresBetaAiCreditMeter.prototype,
        "reserve",
      ).mockImplementation(
        (_scope, reservedIdentity, estimatedCreditUnits, reservedCreditUnits) =>
          Promise.resolve({
            reservationId: betaAiReservationId(reservedIdentity),
            estimatedCreditUnits,
            reservedCreditUnits,
          }),
      );
      vi.spyOn(PostgresBetaAiCreditMeter.prototype, "claim").mockResolvedValue(
        "dispatch",
      );
      const failure = new Error("synthetic-source-" + stage);
      const observe = vi.spyOn(PostgresBetaAiCreditMeter.prototype, "observe");
      if (stage === "observation") observe.mockRejectedValue(failure);
      else observe.mockResolvedValue(undefined);
      const release = vi
        .spyOn(PostgresBetaAiCreditMeter.prototype, "release")
        .mockResolvedValue({ cleanup: "complete", accounting: "known" });
      const record = vi.spyOn(PostgresBetaAiCreditMeter.prototype, "record"),
        settle = vi.spyOn(PostgresBetaAiCreditMeter.prototype, "settle");
      // Output validation belongs to the separately exercised model adapter; only its callback is supplied here.
      const output = {} as BetaApplicationSource;
      const invoke = vi.fn(
        async (onUsage: (actual: typeof usage) => Promise<void>) => {
          await onUsage(usage);
          return output;
        },
      );
      const persist = vi.fn(() => Promise.reject(failure));
      await expect(
        createBetaAiSourceCredits(authority).generate({
          cacheKey: "sha256:" + identity.requestSha256,
          context: {},
          invoke,
          persist,
        }),
      ).rejects.toBe(failure);
      expect(invoke).toHaveBeenCalledOnce();
      expect(persist).toHaveBeenCalledTimes(stage === "publication" ? 1 : 0);
      expect(record).not.toHaveBeenCalled();
      expect(settle).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledExactlyOnceWith(
        { ...identity, purpose: "application-source" },
        usage,
      );
    },
  );

  it("resolves a lost financial acknowledgement with the identical operation and retains the known response", async () => {
    const db = new EvidenceDatabase(),
      meter = new PostgresBetaAiCreditMeter(db, db);
    await expect(meter.observe(identity, usage)).rejects.toThrow(
      "preservation is unresolved",
    );
    let commits = 0;
    const release = vi
      .spyOn(
        PostgresCommercialPersistenceRepository.prototype,
        "releaseReservation",
      )
      .mockImplementation(() => {
        if (db.financial === "active") {
          commits++;
          db.financial = "released";
          return Promise.reject(new Error("synthetic-commit-ack-lost"));
        }
        return Promise.resolve(terminal());
      });
    expect(await meter.release(identity, usage)).toEqual({
      cleanup: "complete",
      accounting: "known",
    });
    expect(release).toHaveBeenCalledTimes(2);
    expect(release.mock.calls[1]).toEqual(release.mock.calls[0]);
    expect(release.mock.calls[0]?.[1]).toMatchObject({
      chargingPolicyVersion: BETA_AI_PRICING_V1.chargingPolicyVersion,
      idempotencyKey: "beta-ai:release:" + betaAiReservationId(identity),
    });
    expect(commits).toBe(1);
    expect(db.row["state"]).toBe("released");
    expectKnown(db);
  });

  it.each(["before-commit", "terminal-conflict"] as const)(
    "preserves evidence during %s and only completes cleanup after matching financial recovery",
    async (mode) => {
      const db = new EvidenceDatabase(),
        meter = new PostgresBetaAiCreditMeter(db, db);
      await expect(meter.observe(identity, usage)).rejects.toThrow(
        "preservation is unresolved",
      );
      const failure = Object.assign(
        new Error("synthetic-financial-failure"),
        mode === "terminal-conflict" ? { code: "reservation-terminal" } : {},
      );
      const release = vi
        .spyOn(
          PostgresCommercialPersistenceRepository.prototype,
          "releaseReservation",
        )
        .mockRejectedValue(failure);
      const pending: unknown = await meter
        .release(identity, usage)
        .catch((error: unknown) => error);
      expect(pending).toBeInstanceOf(BetaAiFinancialReleasePending);
      expect(pending).toMatchObject({
        identity,
        knownUsage: usage,
        accounting: "known",
        financial: mode === "terminal-conflict" ? "conflict" : "pending",
      });
      expect(
        Object.isFrozen((pending as BetaAiFinancialReleasePending).knownUsage),
      ).toBe(true);
      expect(db.row["state"]).toBe("dispatched");
      expect(db.cleanupAttempts).toBe(0);
      expectKnown(db);
      expect(release).toHaveBeenCalledTimes(2);
      expect(release.mock.calls[1]).toEqual(release.mock.calls[0]);
      // A conflicting terminal is not automatically reclassified as released.
      if (mode === "before-commit") {
        release.mockImplementation(() => {
          db.financial = "released";
          return Promise.resolve(terminal());
        });
        expect(await meter.release(identity)).toEqual({
          cleanup: "complete",
          accounting: "known",
        });
        expectKnown(db);
        expect(release.mock.calls[2]).toEqual(release.mock.calls[0]);
      }
    },
  );

  it("keeps legacy durable usage when cleanup fails without withholding an available refund", async () => {
    const db = new EvidenceDatabase(),
      meter = new PostgresBetaAiCreditMeter(db, db);
    Object.assign(db.row, {
      state: "usage-recorded",
      usage_recorded_at: "2026-11-11T00:00:30Z",
      provider_request_id: usage.providerRequestId,
      input_tokens: "1200",
      output_tokens: "300",
      cached_input_tokens: "0",
    });
    db.cleanupFails = true;
    const release = vi
      .spyOn(
        PostgresCommercialPersistenceRepository.prototype,
        "releaseReservation",
      )
      .mockImplementation(() => {
        db.financial = "released";
        return Promise.resolve(terminal());
      });
    expect(await meter.release(identity)).toEqual({
      cleanup: "pending",
      accounting: "known",
    });
    expect(db.financial).toBe("released");
    expect(db.row).toMatchObject({
      state: "usage-recorded",
      input_tokens: "1200",
      output_tokens: "300",
    });
    expect(release).toHaveBeenCalledOnce();
    db.cleanupFails = false;
    expect(await meter.release(identity)).toEqual({
      cleanup: "complete",
      accounting: "known",
    });
    expectKnown(db);
    expect(db.row["input_tokens"]).toBeNull();
    expect(release.mock.calls[1]).toEqual(release.mock.calls[0]);
  });
});
