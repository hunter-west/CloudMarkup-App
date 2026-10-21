import { describe, expect, it } from "vitest";

import { CommercialPersistenceError } from "../../application/commercial-persistence.js";
import type { AppendModelUsageEventDetailInput } from "../../application/model-commercial-persistence.js";
import type { SqlDatabase, SqlResult, SqlRow, SqlStatement } from "./sql.js";
import { PostgresModelCommercialPersistenceRepository } from "./model-commercial-repository.js";

class NeverSqlDatabase implements SqlDatabase {
  public queryCount = 0;

  public close(): Promise<void> {
    return Promise.resolve();
  }

  public query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    void statement;
    this.queryCount += 1;
    return Promise.reject(new Error("The database should not be called."));
  }

  public transaction<TResult>(
    work: (transaction: Pick<SqlDatabase, "query">) => Promise<TResult>,
  ): Promise<TResult> {
    void work;
    this.queryCount += 1;
    return Promise.reject(new Error("The database should not be called."));
  }
}

const accountingContext = {
  actorId: "worker_accounting",
  authority: "internal-accounting",
  correlationId: "correlation-model-usage",
  organizationId: "org_one",
} as const;

const administrationContext = {
  actorId: "worker_administration",
  actorPrincipalId: "principal_admin",
  authority: "internal-administration",
  correlationId: "correlation-model-pricing",
  organizationId: "org_one",
} as const;

function usageDetail(): AppendModelUsageEventDetailInput {
  return {
    attempts: [
      {
        attemptId: "attempt_one",
        attemptKind: "primary",
        attemptNumber: "1",
        callId: "call_one",
        completedAt: "2026-08-21T12:00:01.000Z",
        estimatedProviderCostMicros: "135",
        inferenceProfileId: "profile_standard",
        invocationId: "invocation_one",
        latencyMilliseconds: "1000",
        mayHaveBeenProcessed: true,
        modelId: "claude_sonnet",
        modelVersion: "sonnet_config_v1",
        normalizationPolicyVersionId: "normalization_v1",
        pricingVersionId: "pricing_standard_v1",
        promptId: "prompt_architecture",
        promptVersion: "prompt_architecture_v1",
        providerKey: "provider-test",
        providerRequestId: "provider_request_one",
        routeId: "route_standard",
        startedAt: "2026-08-21T12:00:00.000Z",
        status: "succeeded",
        usage: {
          cacheReadUnits: "10",
          cacheWriteUnits: "5",
          inputUnits: "100",
          outputUnits: "20",
          providerSpecificUnits: [],
          totalUnits: "135",
        },
        usageRecordId: "usage_record_one",
      },
    ],
    cacheReadUnits: "10",
    cacheWriteUnits: "5",
    chargedCreditUnits: "2",
    compensatedCreditUnits: "0",
    completedAt: "2026-08-21T12:00:01.000Z",
    environment: "test",
    estimatedProviderCostMicros: "135",
    inferenceProfileId: "profile_standard",
    inputUnits: "100",
    ledgerEntryId: "ledger_settlement_one",
    modelRoute: "standard",
    modelRouteId: "route_standard",
    modelUsageEventId: "usage_model_one",
    modelUsageIdempotencyKeySha256: "a".repeat(64),
    multiCallWorkflowId: "workflow_one",
    normalizationPolicyVersionId: "normalization_v1",
    occurredAt: "2026-08-21T12:00:01.000Z",
    outputUnits: "20",
    pricingVersionId: "pricing_standard_v1",
    promptId: "prompt_architecture",
    promptVersion: "prompt_architecture_v1",
    providerSpecificUnits: [],
    reconciliationState: "not-required",
    reservedCreditUnits: "4",
    startedAt: "2026-08-21T12:00:00.000Z",
    status: "completed",
    totalUnits: "135",
  };
}

async function expectPersistenceError(
  action: Promise<unknown>,
  code: CommercialPersistenceError["code"],
): Promise<void> {
  try {
    await action;
    throw new Error("Expected a persistence error.");
  } catch (error) {
    expect(error).toBeInstanceOf(CommercialPersistenceError);
    expect((error as CommercialPersistenceError).code).toBe(code);
  }
}

describe("PostgresModelCommercialPersistenceRepository input boundary", () => {
  it("rejects raw prompt content before a database call", async () => {
    const database = new NeverSqlDatabase();
    const repository = new PostgresModelCommercialPersistenceRepository(
      database,
    );
    const input = usageDetail();
    const attemptWithRawPrompt = {
      ...input.attempts[0],
      rawPrompt: "secret customer prompt",
    };
    await expectPersistenceError(
      repository.appendUsageEventDetail(accountingContext, {
        ...input,
        attempts: [attemptWithRawPrompt] as typeof input.attempts,
      }),
      "invalid-input",
    );
    expect(database.queryCount).toBe(0);
  });

  it("rejects technical usage reads without the restricted capability", async () => {
    const database = new NeverSqlDatabase();
    const repository = new PostgresModelCommercialPersistenceRepository(
      database,
    );
    await expectPersistenceError(
      repository.getUsageEventDetail(
        {
          capabilities: ["commercial.summary.read"],
          correlationId: "correlation-usage-read",
          membershipId: "membership_one",
          organizationId: "org_one",
          principalId: "principal_one",
          roleKey: "editor",
          sessionId: "session_one",
        },
        "usage_model_one",
      ),
      "access-denied",
    );
    expect(database.queryCount).toBe(0);
  });

  it("rejects invalid pricing and normalization ranges before persistence", async () => {
    const database = new NeverSqlDatabase();
    const repository = new PostgresModelCommercialPersistenceRepository(
      database,
    );
    await expectPersistenceError(
      repository.createModelProviderPricingVersion(administrationContext, {
        costCurrency: "USD",
        effectiveFrom: "2026-08-21T12:00:00.000Z",
        effectiveUntil: "2026-08-21T12:00:00.000Z",
        environment: "test",
        inputMicrosPerMillionUnits: "100",
        modelId: "claude_sonnet",
        modelVersion: "sonnet_config_v1",
        outputMicrosPerMillionUnits: "100",
        pricingVersionId: "pricing_standard_v1",
        providerKey: "provider-test",
        providerSpecificUnitRates: [],
        status: "enabled",
      }),
      "invalid-input",
    );
    await expectPersistenceError(
      repository.createCreditNormalizationPolicyVersion(administrationContext, {
        costCurrency: "USD",
        creditUnitMicros: "0",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        normalizationPolicyVersionId: "normalization_v1",
        operatingBufferBasisPoints: "1000",
        status: "enabled",
      }),
      "invalid-input",
    );
    expect(database.queryCount).toBe(0);
  });
});
