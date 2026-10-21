import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  digestStructuredValue,
  type ModelProviderResultV1,
} from "@cloudmarkup/model-gateway";
import { utcTimestampSchema } from "@cloudmarkup/schemas";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  ModelPlatformSpendError,
  PlatformSpendBoundHostSeedProviderAdapterV2,
} from "../model-platform-spend.js";
import { PostgresModelPlatformSpendStore } from "./model-platform-spend-store.js";
import {
  platformSpendReservation,
  platformSpendInvocation,
  platformSpendHostSeedInvocation,
  platformSpendCeiling,
} from "./model-platform-spend-test-helpers.js";
import { parseScope } from "./model-runtime-invocation-codec.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { sql } from "./sql.js";

const configuredUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integrationDescribe =
  configuredUrl === undefined || configuredUrl === ""
    ? describe.skip
    : describe;
const runId = randomUUID().replaceAll("-", "");
const schemaName = `cm_model_spend_it_${runId}`;
const schemaMarker = `CloudMarkup synthetic model spend integration ${runId}`;
const id = (prefix: string): string =>
  `${prefix}_${randomUUID().replaceAll("-", "")}`;
function loopbackUrl(): string {
  if (configuredUrl === undefined || configuredUrl === "")
    throw new Error("An explicit loopback PostgreSQL URL is required.");
  let parsed: URL;
  try {
    parsed = new URL(configuredUrl);
  } catch {
    throw new Error("Invalid PostgreSQL integration URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(parsed.pathname)
  )
    throw new Error(
      "Model spend integration accepts only an explicit loopback database without overrides.",
    );
  return configuredUrl;
}

integrationDescribe(
  "platform-wide monthly model spend on isolated real PostgreSQL",
  () => {
    let administration: PostgresDatabase | undefined;
    let database: PostgresDatabase;
    let opened: PostgresDatabase | undefined;
    let createdSchema = false;
    async function verifySchema(): Promise<void> {
      if (
        administration === undefined ||
        !/^cm_model_spend_it_[a-f0-9]{32}$/u.test(schemaName)
      )
        throw new Error("Unsafe synthetic spend schema.");
      const found = await administration.query(
        sql(
          "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
          [schemaName],
        ),
      );
      if (found.rows[0]?.["marker"] !== schemaMarker)
        throw new Error(
          "Refusing to mutate an unverified synthetic spend schema.",
        );
    }
    beforeAll(async () => {
      const connectionString = loopbackUrl();
      if (!/^cm_model_spend_it_[a-f0-9]{32}$/u.test(schemaName))
        throw new Error("Unsafe synthetic schema.");
      administration = new PostgresDatabase({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      await administration.transaction(async (tx) => {
        await tx.query(sql(`CREATE SCHEMA "${schemaName}"`));
        await tx.query(
          sql(`COMMENT ON SCHEMA "${schemaName}" IS '${schemaMarker}'`),
        );
      });
      createdSchema = true;
      database = new PostgresDatabase({
        connectionString,
        max: 3,
        connectionTimeoutMillis: 5000,
        options: `-c search_path=${schemaName} -c timezone=Pacific/Honolulu`,
      });
      opened = database;
      const migrations = await loadHistoricalBetaMigrations(
        fileURLToPath(new URL("../../../migrations", import.meta.url)),
      );
      await runMigrations(database, migrations);
      await runMigrations(database, migrations);
    }, 60000);
    beforeEach(async () => {
      await verifySchema();
      // This isolated test ledger contains synthetic reservations only. Reset it
      // between cap tests; production has no corresponding release/delete API.
      await database.query(
        sql(`TRUNCATE TABLE "${schemaName}".model_platform_spend_reservations`),
      );
    });
    afterAll(async () => {
      try {
        await opened?.close();
        if (createdSchema && administration !== undefined) {
          await verifySchema();
          await administration.query(
            sql(`DROP SCHEMA "${schemaName}" CASCADE`),
          );
        }
      } finally {
        await administration?.close();
      }
    }, 30000);

    async function fixture(cost = 1_000_000) {
      const scope = parseScope({
        organizationId: id("organization"),
        projectId: id("project"),
        userId: id("principal"),
        jobId: id("job"),
      });
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES ($1,'Synthetic spend fixture')",
            [scope.userId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organizations(organization_id,display_name,slug) VALUES ($1,'Synthetic spend fixture',$2)",
            [
              scope.organizationId,
              `spend-${scope.organizationId.replaceAll("_", "-")}`,
            ],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO projects(project_id,organization_id,name,created_by_principal_id) VALUES ($1,$2,'Synthetic spend fixture',$3)",
            [scope.projectId ?? null, scope.organizationId, scope.userId],
          ),
        );
      });
      return {
        input: platformSpendReservation(scope, cost),
        scope,
        store: new PostgresModelPlatformSpendStore({ database, scope }),
      };
    }

    it.each([
      "success",
      "unknown",
      "revoked",
      "expired-count",
      "second-send",
      "other-tenant",
      "cap",
    ] as const)(
      "binds V2 physical dispatch to real retained PostgreSQL reservations: %s",
      async (outcome) => {
        const f = await fixture();
        const other = outcome === "other-tenant" ? await fixture() : undefined;
        const invocation = platformSpendHostSeedInvocation(
          platformSpendInvocation(f.scope),
        );
        const response: ModelProviderResultV1 = {
          content: { kind: "text", text: "Synthetic repair transport output" },
        };
        const clock = { current: Date.now() };
        const http = vi
          .fn()
          .mockImplementation(() =>
            outcome === "unknown"
              ? Promise.reject(
                  new Error("Synthetic uncertain physical handover"),
                )
              : Promise.resolve(response),
          );
        const beforeDispatch = vi.fn().mockImplementation(() => {
          if (outcome === "revoked")
            return Promise.reject(
              new Error("Synthetic revoked current authority"),
            );
          if (outcome === "expired-count") clock.current += 2_000;
          return Promise.resolve({
            expiresAt: new Date(clock.current + 30_000).toISOString(),
          });
        });
        if (outcome === "cap")
          await f.store.reserve(platformSpendReservation(f.scope, 50_000_000));
        const bound = new PlatformSpendBoundHostSeedProviderAdapterV2({
          scope: f.scope,
          reservations: other?.store ?? f.store,
          now: () => new Date(clock.current),
          beforeDispatch,
          costs: {
            resolveHostSeedV2: (payload) =>
              Promise.resolve({
                ...platformSpendCeiling(payload, 1_000_000),
                dispatchValidUntil: utcTimestampSchema.parse(
                  new Date(
                    clock.current +
                      (outcome === "expired-count" ? 1_000 : 30_000),
                  ).toISOString(),
                ),
              }),
          },
          httpHandler: { handle: http },
          createDelegate: (handler) => ({
            profile: {
              providerFamily: "amazon-bedrock",
              providerId: invocation.descriptor.providerId,
              profileVersion: "1.0.0",
              enabled: true,
              capabilities: [],
            },
            invokeHostSeedV2: async (payload, signal) => {
              await handler.handle(payload, { abortSignal: signal });
              if (outcome === "second-send")
                await handler.handle(payload, { abortSignal: signal });
              return response;
            },
          }),
        });
        if (outcome === "success")
          await expect(bound.invokeHostSeedV2(invocation)).resolves.toEqual(
            response,
          );
        else await expect(bound.invokeHostSeedV2(invocation)).rejects.toThrow();
        expect(http).toHaveBeenCalledTimes(
          ["success", "unknown", "second-send"].includes(outcome) ? 1 : 0,
        );
        expect(beforeDispatch).toHaveBeenCalledTimes(
          ["other-tenant", "cap"].includes(outcome) ? 0 : 1,
        );
        const total = await database.query(
          sql(
            "SELECT COUNT(*)::text AS count,COALESCE(SUM(maximum_cost_micro_usd),0)::text AS total FROM model_platform_spend_reservations",
          ),
        );
        expect(total.rows[0]).toEqual({
          count: outcome === "other-tenant" ? "0" : "1",
          total:
            outcome === "other-tenant"
              ? "0"
              : outcome === "cap"
                ? "50000000"
                : "1000000",
        });
        if (outcome !== "other-tenant" && outcome !== "cap") {
          const row = await database.query(
            sql(
              "SELECT invocation_sha256 FROM model_platform_spend_reservations",
            ),
          );
          expect(row.rows[0]?.["invocation_sha256"]).toBe(
            digestStructuredValue(invocation).slice("sha256:".length),
          );
        }
      },
    );

    it("checks count freshness with the database clock before reserving and retains one exact claim", async () => {
      const f = await fixture();
      const expired = {
        ...f.input,
        ceiling: {
          ...f.input.ceiling,
          dispatchValidUntil: utcTimestampSchema.parse(
            new Date(Date.now() - 1_000).toISOString(),
          ),
        },
      };
      await expect(f.store.reserve(expired)).rejects.toBeInstanceOf(
        ModelPlatformSpendError,
      );
      expect(
        (
          await database.query(
            sql(
              "SELECT COUNT(*)::text AS count FROM model_platform_spend_reservations",
            ),
          )
        ).rows[0],
      ).toEqual({ count: "0" });
      const fresh = {
        ...f.input,
        ceiling: {
          ...f.input.ceiling,
          dispatchValidUntil: utcTimestampSchema.parse(
            new Date(Date.now() + 30_000).toISOString(),
          ),
        },
      };
      await expect(f.store.reserve(fresh)).resolves.toMatchObject({
        kind: "reserved",
      });
      await expect(f.store.reserve(fresh)).resolves.toEqual({
        kind: "duplicate",
      });
      await expect(
        f.store.reserve({
          ...fresh,
          ceiling: {
            ...fresh.ceiling,
            dispatchValidUntil: expired.ceiling.dispatchValidUntil,
          },
        }),
      ).rejects.toBeInstanceOf(ModelPlatformSpendError);
      expect(
        (
          await database.query(
            sql(
              "SELECT COUNT(*)::text AS count FROM model_platform_spend_reservations",
            ),
          )
        ).rows[0],
      ).toEqual({ count: "1" });
    });

    it("atomically caps concurrent attempts across distinct tenants at exactly USD50", async () => {
      const tenants = await Promise.all(
        Array.from({ length: 8 }, () => fixture(10_000_000)),
      );
      const results = await Promise.allSettled(
        tenants.map((f) => f.store.reserve(f.input)),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(5);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(3);
      const total = await database.query(
        sql(
          "SELECT SUM(maximum_cost_micro_usd)::text AS total,COUNT(*)::text AS count FROM model_platform_spend_reservations",
        ),
      );
      expect(total.rows[0]).toEqual({ total: "50000000", count: "5" });
      const additional = await fixture(1);
      await expect(
        additional.store.reserve(additional.input),
      ).rejects.toMatchObject({ code: "model-platform.cap-exceeded" });
    });
    it("persists exactly one reservation through duplicate races and restart", async () => {
      const f = await fixture();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => f.store.reserve(f.input)),
      );
      expect(results.filter(({ kind }) => kind === "reserved")).toHaveLength(1);
      expect(results.filter(({ kind }) => kind === "duplicate")).toHaveLength(
        5,
      );
      const restarted = new PostgresModelPlatformSpendStore({
        database,
        scope: f.scope,
      });
      await expect(restarted.reserve(f.input)).resolves.toEqual({
        kind: "duplicate",
      });
      await expect(
        restarted.reserve({
          ...f.input,
          ceiling: { ...f.input.ceiling, maximumCostMicroUsd: 2_000_000 },
        }),
      ).rejects.toBeInstanceOf(ModelPlatformSpendError);
    });
    it("assigns the trusted database UTC month regardless of session timezone", async () => {
      const f = await fixture();
      const result = await f.store.reserve(f.input);
      if (result.kind !== "reserved")
        throw new Error("Synthetic reservation missing.");
      const databaseMonth = await database.query(
        sql(
          "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM') AS month",
        ),
      );
      expect(result.monthUtc).toBe(databaseMonth.rows[0]?.["month"]);
      expect(result.reservedAt.slice(0, 7)).toBe(result.monthUtc);
      expect(
        Date.parse(result.dispatchBefore) - Date.parse(result.reservedAt),
      ).toBeLessThanOrEqual(5000);
      expect(Date.parse(result.dispatchBefore)).toBeGreaterThan(
        Date.parse(result.reservedAt),
      );
    });
    it("denies scope substitution, expired pricing and invented ownership without reserving", async () => {
      const a = await fixture();
      const b = await fixture();
      await expect(a.store.reserve(b.input)).rejects.toBeInstanceOf(
        ModelPlatformSpendError,
      );
      await expect(
        a.store.reserve({
          ...a.input,
          ceiling: {
            ...a.input.ceiling,
            validUntil: utcTimestampSchema.parse("2021-01-01T00:00:00.000Z"),
          },
        }),
      ).rejects.toBeInstanceOf(ModelPlatformSpendError);
      const invented = parseScope({
        ...a.scope,
        projectId: "nonexistent-project",
      });
      const store = new PostgresModelPlatformSpendStore({
        database,
        scope: invented,
      });
      await expect(
        store.reserve(platformSpendReservation(invented)),
      ).rejects.toBeInstanceOf(ModelPlatformSpendError);
      const count = await database.query(
        sql(
          "SELECT COUNT(*)::text AS count FROM model_platform_spend_reservations",
        ),
      );
      expect(count.rows[0]?.["count"]).toBe("0");
    });
    it("rejects direct SQL mutation and retains reservations without a release path", async () => {
      const f = await fixture(50_000_000);
      await f.store.reserve(f.input);
      await expect(
        database.query(
          sql(
            "UPDATE model_platform_spend_reservations SET maximum_cost_micro_usd=1 WHERE dispatch_id=$1",
            [f.input.dispatchId],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          sql(
            "DELETE FROM model_platform_spend_reservations WHERE dispatch_id=$1",
            [f.input.dispatchId],
          ),
        ),
      ).rejects.toThrow();
      const retry = platformSpendReservation(f.scope, 1);
      await expect(f.store.reserve(retry)).rejects.toMatchObject({
        code: "model-platform.cap-exceeded",
      });
    });
    it("also enforces the global cap for concurrent direct SQL inserts", async () => {
      const f = await fixture(10_000_000);
      await f.store.reserve(f.input);
      const clone = (dispatchId: string) =>
        database.query(
          sql(
            `INSERT INTO model_platform_spend_reservations(dispatch_id,organization_id,project_id,principal_id,scope_sha256,invocation_id,claim_sha256,invocation_sha256,provider_id,model_id,model_version,inference_profile_id,pricing_version_id,pricing_version_sha256,maximum_cost_micro_usd,pricing_valid_from,pricing_valid_until,month_utc,reserved_at,dispatch_before)
      SELECT $1,organization_id,project_id,principal_id,scope_sha256,invocation_id,claim_sha256,invocation_sha256,provider_id,model_id,model_version,inference_profile_id,pricing_version_id,pricing_version_sha256,maximum_cost_micro_usd,pricing_valid_from,pricing_valid_until,'2000-01','2000-01-01T00:00:00Z','2000-01-01T00:00:01Z' FROM model_platform_spend_reservations WHERE dispatch_id=$2`,
            [dispatchId, f.input.dispatchId],
          ),
        );
      const results = await Promise.allSettled(
        Array.from({ length: 7 }, () =>
          clone(`dispatch_${randomUUID().replaceAll("-", "")}`),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(4);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(3);
      const total = await database.query(
        sql(
          "SELECT SUM(maximum_cost_micro_usd)::text AS total,COUNT(DISTINCT month_utc)::text AS months FROM model_platform_spend_reservations",
        ),
      );
      expect(total.rows[0]).toEqual({ total: "50000000", months: "1" });
    });
  },
);
