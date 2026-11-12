import { describe, expect, it } from "vitest";

import { CommercialPersistenceError } from "../../application/commercial-persistence.js";
import type {
  AppendModelUsageEventDetailInput,
  CreateCreditNormalizationPolicyVersionInput,
  CreateModelProviderPricingVersionInput,
} from "../../application/model-commercial-persistence.js";
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

/** Explicit SQL/transaction double; this checks repository mapping and replay,
 * not PostgreSQL encoding, constraints, authority joins or transaction locks. */
async function verifyTimestampReplay<T extends object>(options: {
  input: T;
  timestamps: readonly (keyof T & string)[];
  call: (
    repository: PostgresModelCommercialPersistenceRepository,
    input: T,
  ) => Promise<unknown>;
  conflicts: readonly Partial<T>[];
}) {
  for (const representation of ["date", "data-api", "offset", "microseconds"]) {
    const input = structuredClone(options.input);
    for (const key of options.timestamps) {
      const raw = input[key];
      if (typeof raw !== "string") throw Error("Missing timestamp fixture");
      const seconds = raw.replace(/\.\d+Z$/u, "Z");
      Object.assign(input, {
        [key]:
          representation === "microseconds"
            ? seconds.replace("Z", ".123456Z")
            : seconds,
      });
    }
    const persisted: Record<string, unknown> = Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key.replace(/[A-Z]/gu, (letter) => "_" + letter.toLowerCase()),
        value,
      ]),
    );
    Object.assign(persisted, {
      created_at: "2026-08-21T11:00:00.000Z",
      model_key: "claude_sonnet",
      model_version: "sonnet_config_v1",
      pricing_status: "enabled",
      policy_status: "enabled",
      lifecycle_status: "completed",
      feature_key: "architecture-generate",
      job_id: "job_one",
      organization_id: "org_one",
      project_id: "project_one",
      provider_key: "provider-test",
      request_id: "request_one",
      reservation_id: "reservation_one",
      acting_principal_id: "principal_one",
    });
    for (const key of [...options.timestamps, "createdAt"]) {
      const column = key.replace(
        /[A-Z]/gu,
        (letter) => "_" + letter.toLowerCase(),
      );
      const value = persisted[column];
      if (typeof value !== "string") throw Error("Missing stored timestamp");
      persisted[column] =
        representation === "date"
          ? new Date(value)
          : representation === "data-api"
            ? new Date(value).toISOString().replace("T", " ").replace("Z", "")
            : representation === "offset"
              ? value.replace("Z", "+00:00")
              : value;
    }
    let stored = false;
    let writes = 0;
    let rollbacks = 0;
    const statements: SqlStatement[] = [];
    const database: SqlDatabase = {
      close: () => Promise.resolve(),
      query: <TRow extends SqlRow>(statement: SqlStatement) => {
        statements.push(statement);
        let rows: readonly SqlRow[] = [];
        if (statement.text.includes("pg_advisory_xact_lock")) rows = [];
        else if (statement.text.includes("FROM usage_ledger_entries event"))
          rows = [persisted];
        else if (statement.text.startsWith("INSERT INTO")) {
          const columns = statement.text.slice(
            statement.text.indexOf("(") + 1,
            statement.text.indexOf(") VALUES"),
          );
          expect(columns).toMatch(/^\w+(?:,\s*\w+)*$/u);
          stored = true;
          writes += 1;
          rows = [persisted];
        } else if (statement.text.startsWith("SELECT"))
          rows = stored ? [persisted] : [];
        else throw Error("Unexpected synthetic statement");
        return Promise.resolve({
          rows,
          rowCount: rows.length,
        } as SqlResult<TRow>);
      },
      transaction: async (work) => {
        const before = stored;
        try {
          return await work(database);
        } catch (error) {
          stored = before;
          rollbacks += 1;
          throw error;
        }
      },
    };
    const repository = new PostgresModelCommercialPersistenceRepository(
      database,
    );
    const first = await options.call(repository, input);
    await expect(options.call(repository, input)).resolves.toEqual(first);
    const equivalent = structuredClone(input);
    for (const key of options.timestamps) {
      const value = equivalent[key];
      if (typeof value !== "string") throw Error("Missing timestamp");
      Object.assign(equivalent, {
        [key]: value.includes(".")
          ? value.replace("Z", "+00:00")
          : value.replace("Z", ".000000Z"),
      });
    }
    await expect(options.call(repository, equivalent)).resolves.toEqual(first);
    expect(writes).toBe(1);
    for (const key of options.timestamps) {
      const value = input[key];
      if (typeof value !== "string") throw Error("Missing timestamp");
      await expectPersistenceError(
        options.call(repository, {
          ...input,
          [key]: value.includes(".123456")
            ? value.replace(".123456", ".123457")
            : value.replace("Z", ".000001Z"),
        }),
        "idempotency-conflict",
      );
    }
    for (const conflict of options.conflicts)
      await expectPersistenceError(
        options.call(repository, { ...input, ...conflict }),
        "idempotency-conflict",
      );
    expect(rollbacks).toBe(
      options.timestamps.length + options.conflicts.length,
    );
    expect(writes).toBe(1);
    expect(stored).toBe(true);
    await expect(options.call(repository, input)).resolves.toEqual(first);
    // Native pg Date conversion must not erase fractional identity in production.
    for (const key of options.timestamps) {
      const column = key.replace(
        /[A-Z]/gu,
        (letter) => "_" + letter.toLowerCase(),
      );
      expect(
        statements.some(
          (statement) =>
            statement.text.includes("to_char(") &&
            statement.text.includes(column + " AT TIME ZONE 'UTC'") &&
            statement.text.includes('HH24:MI:SS.US"Z"'),
        ),
      ).toBe(true);
    }
  }
}

describe("PostgresModelCommercialPersistenceRepository input boundary", () => {
  it("replays pricing timestamps without weakening immutable money or identity", async () => {
    const input: CreateModelProviderPricingVersionInput = {
      costCurrency: "USD",
      effectiveFrom: "2026-08-21T12:00:00Z",
      effectiveUntil: "2026-08-22T12:00:00Z",
      environment: "test",
      inputMicrosPerMillionUnits: "100",
      modelId: "claude_sonnet",
      modelVersion: "sonnet_config_v1",
      outputMicrosPerMillionUnits: "100",
      pricingVersionId: "pricing_standard_v1",
      providerKey: "provider-test",
      providerSpecificUnitRates: [],
      status: "enabled",
    };
    const openEnded = { ...input };
    Reflect.deleteProperty(openEnded, "effectiveUntil");
    for (const value of [input, openEnded])
      await verifyTimestampReplay({
        input: value,
        timestamps:
          value.effectiveUntil === undefined
            ? ["effectiveFrom"]
            : ["effectiveFrom", "effectiveUntil"],
        call: (repository, value) =>
          repository.createModelProviderPricingVersion(
            administrationContext,
            value,
          ),
        conflicts: [
          { inputMicrosPerMillionUnits: "101" },
          { costCurrency: "EUR" },
          { modelId: "other_model" },
        ],
      });
  });
  it("replays normalization timestamps without weakening immutable policy", async () => {
    const input: CreateCreditNormalizationPolicyVersionInput = {
      costCurrency: "USD",
      effectiveFrom: "2026-08-21T12:00:00Z",
      effectiveUntil: "2026-08-22T12:00:00Z",
      creditUnitMicros: "100",
      normalizationPolicyVersionId: "normalization_v1",
      operatingBufferBasisPoints: "1000",
      status: "enabled",
    };
    const openEnded = { ...input };
    Reflect.deleteProperty(openEnded, "effectiveUntil");
    for (const value of [input, openEnded])
      await verifyTimestampReplay({
        input: value,
        timestamps:
          value.effectiveUntil === undefined
            ? ["effectiveFrom"]
            : ["effectiveFrom", "effectiveUntil"],
        call: (repository, value) =>
          repository.createCreditNormalizationPolicyVersion(
            administrationContext,
            value,
          ),
        conflicts: [{ creditUnitMicros: "101" }, { costCurrency: "EUR" }],
      });
  });
  it("replays top-level usage timestamps while preserving exact attempt evidence", async () => {
    const input = usageDetail();
    await verifyTimestampReplay({
      input,
      timestamps: ["occurredAt", "startedAt", "completedAt"],
      call: (repository, value) =>
        repository.appendUsageEventDetail(accountingContext, value),
      conflicts: [
        { chargedCreditUnits: "1" },
        { promptId: "different_prompt" },
        {
          attempts: input.attempts.map((attempt) => ({
            ...attempt,
            startedAt: attempt.startedAt.replace(".000Z", "Z"),
          })),
        },
      ],
    });
  });
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
    for (const effectiveFrom of [
      "2026-08-21T12:00:00",
      "2026-08-21 12:00:00",
      "2026-02-29T12:00:00Z",
      "2026-08-21T12:00:00.1234567Z",
    ]) {
      await expectPersistenceError(
        repository.createCreditNormalizationPolicyVersion(
          administrationContext,
          {
            costCurrency: "USD",
            creditUnitMicros: "100",
            effectiveFrom,
            normalizationPolicyVersionId: "normalization_v1",
            operatingBufferBasisPoints: "1000",
            status: "enabled",
          },
        ),
        "invalid-input",
      );
    }
    expect(database.queryCount).toBe(0);
  });
});
