import { randomUUID } from "node:crypto";
import { utcTimestampSchema } from "@cloudmarkup/schemas";
import type { Principal } from "../../application/identity.js";
import { seedValidationHostFixture } from "../../production-model-live-seed-validation-test-helpers.js";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import {
  PostgresModelLiveSequences,
  type ModelLiveSequenceConfigurationV3,
} from "./model-live-sequences.js";
import {
  sql,
  type SqlDatabase,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";
export type SeedValidationAdapterOverrides = {
  -readonly [
    K in keyof ConstructorParameters<typeof PostgresModelLiveSequences>[0]
  ]?: ConstructorParameters<typeof PostgresModelLiveSequences>[0][K];
};
/** Shared synthetic tenant/native fixture; never production authentication or tool evidence. */
export function createSeedValidationPgFixture(
  harness: ReturnType<typeof createModelAccountingPgTestHarness>,
) {
  return async function fixture(
    fault?: Parameters<typeof seedValidationHostFixture>[0],
  ) {
    const tenant = await harness.tenant();
    const clock = await harness.database.query(
      sql(
        "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS now",
      ),
    );
    const now = utcTimestampSchema.parse(clock.rows[0]?.["now"]);
    const scope = {
      organizationId: tenant.scope.organizationId,
      projectId: tenant.scope.projectId,
      userId: tenant.scope.userId,
      environment: "development" as const,
      plan: "pro" as const,
    };
    const principal: Principal = {
      principalId: scope.userId,
      sessionId: "session_" + randomUUID().replaceAll("-", ""),
      authenticationSource: "cognito",
      authenticatedAt: now,
      expiresAt: new Date(Date.parse(now) + 3600000).toISOString(),
    };
    const host = seedValidationHostFixture(fault);
    const state = {
      available: true,
      operators: [scope.userId] as readonly string[],
      transactionDepth: 0,
      afterInsert: undefined as (() => Promise<void>) | undefined,
    };
    const database: SqlDatabase = {
      close: () => Promise.resolve(),
      query: (statement) => harness.database.query(statement),
      transaction: (work) =>
        harness.database.transaction(async (tx) => {
          state.transactionDepth += 1;
          try {
            return await work({
              async query<TRow extends SqlRow = SqlRow>(
                statement: SqlStatement,
              ) {
                const result = await tx.query<TRow>(statement);
                if (statement.text.startsWith("INSERT INTO model_live_"))
                  await state.afterInsert?.();
                return result;
              },
            });
          } finally {
            state.transactionDepth -= 1;
          }
        }),
    };
    const config: ModelLiveSequenceConfigurationV3 = {
      environment: scope.environment,
      resolveOperatorPrincipalIds: () => Promise.resolve(state.operators),
      resolveDefinition: () => Promise.resolve(null),
      resolveSeedValidationHost: () =>
        Promise.resolve(state.available ? host.configuration : null),
    };
    const make = (overrides: SeedValidationAdapterOverrides = {}) =>
      new PostgresModelLiveSequences({
        database,
        scope,
        principal,
        configuration: config,
        ...overrides,
      });
    const count = async () => {
      const found = await harness.database.query(
        sql(
          "SELECT count(*)::int AS count FROM model_live_seed_validation_receipts WHERE organization_id=$1",
          [scope.organizationId],
        ),
      );
      return found.rows[0]?.["count"];
    };
    return {
      administration: tenant.administration,
      scope,
      principal,
      host,
      state,
      config,
      database,
      make,
      count,
    };
  };
}
