import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ModelLiveEvaluationPlanError,
  ModelRuntimeControlError,
  digestStructuredValue,
} from "@cloudmarkup/model-gateway";
import { syntheticLiveEvaluationFixtureV2 } from "@cloudmarkup/model-gateway/testing";
import {
  sha256Text,
  modelLiveEvaluationDefinitionV2Schema,
} from "@cloudmarkup/schemas";
import type { Principal } from "../../application/identity.js";
import {
  PostgresModelLiveEvaluationPlans,
  type ModelLiveEvaluationConfigurationV2,
} from "./model-live-evaluation-plans.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { sql } from "./sql.js";
import { PostgresModelRuntimeAdmissionStore } from "./model-runtime-admission-store.js";
import { PostgresModelLiveRuntimeAdmissionStore } from "./model-live-runtime-admission-store.js";
import { liveRuntimeAdmissionFixture } from "./model-live-runtime-admission-test-helpers.js";
import { runtimeAdmissionFixture } from "./model-runtime-admission-test-helpers.js";

const configuredUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integrationDescribe =
  configuredUrl === undefined || configuredUrl === ""
    ? describe.skip
    : describe;
const runId = randomUUID().replaceAll("-", "");
const schemaName = "cm_live_plans_it_" + runId;
const marker = "CloudMarkup synthetic live plan approval " + runId;
const id = (prefix: string) => prefix + "_" + randomUUID().replaceAll("-", "");
function loopbackUrl() {
  if (configuredUrl === undefined || configuredUrl === "")
    throw Error("Explicit synthetic loopback PostgreSQL required.");
  const parsed = new URL(configuredUrl);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(parsed.pathname)
  )
    throw Error(
      "Live plan tests require an explicit loopback database without overrides.",
    );
  return configuredUrl;
}
integrationDescribe(
  "durable V2 evaluation approval on isolated PostgreSQL",
  () => {
    let admin: PostgresDatabase | undefined,
      opened: PostgresDatabase | undefined,
      database: PostgresDatabase;
    let created = false;
    let previousConstraints: readonly unknown[] = [];
    const constraints = (excluded: readonly string[]) =>
      database.query(
        sql(
          "SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='model_runtime_admissions'::regclass AND conname NOT IN (SELECT jsonb_array_elements_text($1::jsonb)) ORDER BY conname",
          [JSON.stringify(excluded)],
        ),
      );
    beforeAll(async () => {
      const connectionString = loopbackUrl();
      if (!/^cm_live_plans_it_[a-f0-9]{32}$/u.test(schemaName))
        throw Error("Unsafe synthetic schema.");
      admin = new PostgresDatabase({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      await admin.transaction(async (tx) => {
        await tx.query(sql(`CREATE SCHEMA "${schemaName}"`));
        await tx.query(sql(`COMMENT ON SCHEMA "${schemaName}" IS '${marker}'`));
      });
      created = true;
      database = new PostgresDatabase({
        connectionString,
        max: 5,
        connectionTimeoutMillis: 5000,
        options: `-c search_path=${schemaName} -c timezone=UTC -c statement_timeout=5000`,
      });
      opened = database;
      const migrations = await loadHistoricalBetaMigrations(
        fileURLToPath(new URL("../../../migrations", import.meta.url)),
      );
      expect(migrations.at(-2)?.version).toBe("0098");
      expect(migrations.at(-2)?.statements).toHaveLength(21);
      expect(migrations.at(-1)?.version).toBe("0138");
      expect(
        migrations.find(({ version }) => version === "0093")?.statements,
      ).toHaveLength(11);
      expect(
        migrations.find(({ version }) => version === "0091")?.statements,
      ).toHaveLength(15);
      expect(
        migrations.find(({ version }) => version === "0090")?.statements,
      ).toHaveLength(6);
      expect(
        migrations.find(({ version }) => version === "0084")?.statements,
      ).toHaveLength(10);
      expect(
        migrations.find(({ version }) => version === "0079")?.statements,
      ).toHaveLength(1);
      expect(
        migrations.find(({ version }) => version === "0078")?.statements,
      ).toHaveLength(4);
      expect(
        migrations.find(({ version }) => version === "0059")?.statements,
      ).toHaveLength(3);
      expect(
        migrations.find((migration) => migration.version === "0057")
          ?.statements,
      ).toHaveLength(9);
      await runMigrations(database, migrations.slice(0, 36));
      previousConstraints = (
        await constraints([
          "model_runtime_admissions_check",
          "model_runtime_admissions_snapshot_check1",
          "model_runtime_admissions_snapshot_check2",
        ])
      ).rows;
      await runMigrations(database, migrations);
      await runMigrations(database, migrations);
      await database.query(
        sql(
          "CREATE TABLE synthetic_live_plan_work (organization_id text PRIMARY KEY)",
        ),
      );
    }, 60000);
    afterAll(async () => {
      try {
        await opened?.close();
        if (created && admin !== undefined) {
          const found = await admin.query(
            sql(
              "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
              [schemaName],
            ),
          );
          if (
            found.rows[0]?.["marker"] !== marker ||
            !/^cm_live_plans_it_[a-f0-9]{32}$/u.test(schemaName)
          )
            throw Error("Refusing to remove unverified synthetic schema.");
          await admin.transaction(async (tx) => {
            await tx.query(sql(`DROP SCHEMA "${schemaName}" CASCADE`));
          });
        }
      } finally {
        await admin?.close();
      }
    }, 30000);
    async function fixture(role: "owner" | "editor" | "viewer" = "owner") {
      const userId = id("principal"),
        organizationId = id("org"),
        projectId = id("project"),
        keeper = id("principal");
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES ($1,'Synthetic operator'),($2,'Synthetic keeper')",
            [userId, keeper],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organizations(organization_id,display_name,slug) VALUES ($1,'Synthetic live evaluation',$2)",
            [organizationId, organizationId.replaceAll("_", "-")],
          ),
        );
        for (const key of ["owner", "editor", "viewer"])
          await tx.query(
            sql(
              "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES ($1,$2::text,'authorization-v2',$3,cloudmarkup_authorization_v2_permissions($2::text))",
              [organizationId, key, key === "owner"],
            ),
          );
        await tx.query(
          sql(
            "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES ($1,$2,$3,$4),($5,$2,$6,'owner')",
            [
              id("membership"),
              organizationId,
              userId,
              role,
              id("membership"),
              keeper,
            ],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO projects(project_id,organization_id,name,created_by_principal_id) VALUES ($1,$2,'Synthetic live evaluation',$3)",
            [projectId, organizationId, userId],
          ),
        );
      });
      const now = new Date().toISOString();
      const f = syntheticLiveEvaluationFixtureV2({
        organizationId,
        projectId,
        userId,
        now,
        definitionId: id("definition"),
      });
      const principal: Principal = {
        principalId: userId,
        sessionId: id("session"),
        authenticationSource: "cognito",
        authenticatedAt: now,
        expiresAt: new Date(Date.parse(now) + 3600000).toISOString(),
      };
      let available = true;
      let operators: readonly string[] = [userId];
      const configuration: ModelLiveEvaluationConfigurationV2 = {
        environment: "development",
        resolveOperatorPrincipalIds: () => Promise.resolve(operators),
        resolveDefinition: (definitionId) =>
          Promise.resolve(
            available && definitionId === f.definition.definitionId
              ? {
                  definition: f.definition,
                  dataset: f.dataset,
                  policy: f.policy,
                }
              : null,
          ),
      };
      const make = (
        overrides: Partial<{
          principal: Principal;
          configuration: ModelLiveEvaluationConfigurationV2;
        }> = {},
      ) =>
        new PostgresModelLiveEvaluationPlans({
          database,
          scope: f.scope,
          principal,
          configuration,
          ...overrides,
        });
      const request = {
        definitionId: f.definition.definitionId,
        expectedDefinitionDigest: f.definition.definitionDigest,
      };
      const approve = () => make().approve(request);
      return {
        ...f,
        keeper,
        principal,
        configuration,
        make,
        request,
        approve,
        removeConfiguration: () => {
          available = false;
        },
        removeOperators: () => {
          operators = [];
        },
      };
    }
    async function runtimeFixture(maximumInvocations = 21) {
      const base = await fixture();
      const { definitionDigest: oldDigest, ...definitionMetadata } =
        base.definition;
      void oldDigest;
      const body = {
        ...definitionMetadata,
        limits: { ...base.definition.limits, maximumInvocations },
      };
      const definition = modelLiveEvaluationDefinitionV2Schema.parse({
        ...body,
        definitionDigest: digestStructuredValue(body),
      });
      const configuration: ModelLiveEvaluationConfigurationV2 = {
        ...base.configuration,
        resolveDefinition: async (definitionId) => {
          const configured =
            await base.configuration.resolveDefinition(definitionId);
          return configured === null ? null : { ...configured, definition };
        },
      };
      const plans = base.make({ configuration });
      const plan = await plans.approve({
        definitionId: definition.definitionId,
        expectedDefinitionDigest: definition.definitionDigest,
      });
      const next = (key = "first live admission") =>
        liveRuntimeAdmissionFixture(
          {
            organizationId: base.scope.organizationId,
            projectId: base.scope.projectId,
            userId: base.scope.userId,
            now: base.now,
            definitionId: definition.definitionId,
          },
          plan,
          key,
        );
      const data = next();
      const makeStore = () =>
        new PostgresModelLiveRuntimeAdmissionStore({
          database,
          scope: data.scope,
          plans,
          definitionId: definition.definitionId,
          planDigest: plan.planDigest,
        });
      const store = makeStore();
      const admit = async () => {
        const input = data.claim(await store.inspect(data.state));
        const result = await store.claim(input);
        if (result.kind !== "claimed")
          throw Error("Missing synthetic live runtime claim: " + result.kind);
        return { input, result };
      };
      return { ...data, base, plans, makeStore, store, next, admit };
    }
    async function counts(organizationId: string) {
      const r = await database.query(
        sql(
          "SELECT (SELECT count(*)::int FROM model_live_evaluation_plans WHERE organization_id=$1) AS plans,(SELECT count(*)::int FROM model_live_evaluation_revocations WHERE organization_id=$1) AS revocations",
          [organizationId],
        ),
      );
      return r.rows[0];
    }
    it("preserves every historical runtime constraint except the three replaced version bindings", async () => {
      expect(previousConstraints.length).toBeGreaterThan(10);
      expect(
        (
          await constraints([
            "model_runtime_admission_version",
            "model_runtime_admission_scope",
          ])
        ).rows,
      ).toEqual(previousConstraints);
    });
    it("issues immutable approval, verifies current issuance and retains metadata only", async () => {
      const f = await fixture(),
        plan = await f.approve();
      expect(plan.definition).toEqual(f.definition);
      expect(plan.approval.operatorUserId).toBe(f.principal.principalId);
      expect(plan.approval.approvalId).not.toBe(f.approval.approvalId);
      expect(
        await f.make().requireCurrent({
          definitionId: f.request.definitionId,
          planDigest: plan.planDigest,
        }),
      ).toEqual(plan);
      const rows = await database.query(
        sql(
          "SELECT plan_record FROM model_live_evaluation_plans WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      const stored = JSON.stringify(rows.rows[0]);
      expect(stored).not.toContain(f.dataset.cases[0]?.input.requirements);
      expect(stored).not.toContain('"sourceInput"');
      expect(stored).not.toContain('"candidate"');
      expect(await counts(f.scope.organizationId)).toEqual({
        plans: 1,
        revocations: 0,
      });
    });
    it("serializes concurrent approvals and replays the first immutable plan after reconstruction", async () => {
      const f = await fixture();
      const results = await Promise.all([f.approve(), f.approve()]);
      expect(results[0]).toEqual(results[1]);
      expect(await f.approve()).toEqual(results[0]);
      expect(await counts(f.scope.organizationId)).toEqual({
        plans: 1,
        revocations: 0,
      });
    });
    it("rejects self-authored approval metadata without durable issuance", async () => {
      const f = await fixture();
      await expect(
        f.make().requireCurrent({
          definitionId: f.request.definitionId,
          planDigest: f.plan.planDigest,
        }),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
      expect(await counts(f.scope.organizationId)).toEqual({
        plans: 0,
        revocations: 0,
      });
    });
    it("requires the exact reviewed definition digest before issuing any row", async () => {
      const f = await fixture();
      await expect(
        f.make().approve({
          ...f.request,
          expectedDefinitionDigest: sha256Text("another reviewed definition"),
        }),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
      expect(await counts(f.scope.organizationId)).toEqual({
        plans: 0,
        revocations: 0,
      });
    });
    it.each(["editor", "viewer"] as const)(
      "denies %s operators despite configured platform membership",
      async (role) => {
        const f = await fixture(role);
        await expect(f.approve()).rejects.toBeInstanceOf(
          ModelLiveEvaluationPlanError,
        );
        expect(await counts(f.scope.organizationId)).toEqual({
          plans: 0,
          revocations: 0,
        });
      },
    );
    it("denies organization owners absent from the configured operator set", async () => {
      const f = await fixture();
      const store = f.make({
        configuration: {
          ...f.configuration,
          resolveOperatorPrincipalIds: () =>
            Promise.resolve(["not_this_operator"]),
        },
      });
      await expect(store.approve(f.request)).rejects.toBeInstanceOf(
        ModelLiveEvaluationPlanError,
      );
      expect(await counts(f.scope.organizationId)).toEqual({
        plans: 0,
        revocations: 0,
      });
    });
    it.each(["local-development", "test"] as const)(
      "rejects %s authentication as live authority",
      async (authenticationSource) => {
        const f = await fixture();
        expect(() =>
          f.make({ principal: { ...f.principal, authenticationSource } }),
        ).toThrow(ModelLiveEvaluationPlanError);
        expect(await counts(f.scope.organizationId)).toEqual({
          plans: 0,
          revocations: 0,
        });
      },
    );
    it("denies stale or expired operator authentication", async () => {
      const f = await fixture();
      const old = new Date(Date.now() - 20 * 60000).toISOString();
      await expect(
        f
          .make({ principal: { ...f.principal, authenticatedAt: old } })
          .approve(f.request),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
      await expect(
        f
          .make({ principal: { ...f.principal, expiresAt: old } })
          .approve(f.request),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
      expect(await counts(f.scope.organizationId)).toEqual({
        plans: 0,
        revocations: 0,
      });
    });
    it("rejects another tenant's exact plan identity and digest", async () => {
      const a = await fixture(),
        b = await fixture(),
        plan = await a.approve();
      await expect(
        b.make().requireCurrent({
          definitionId: a.request.definitionId,
          planDigest: plan.planDigest,
        }),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
      expect(await counts(b.scope.organizationId)).toEqual({
        plans: 0,
        revocations: 0,
      });
    });
    it("rechecks removed host operators on an already constructed store", async () => {
      const f = await fixture();
      const store = f.make();
      const plan = await store.approve(f.request);
      f.removeOperators();
      await expect(
        store.requireCurrent({
          definitionId: f.request.definitionId,
          planDigest: plan.planDigest,
        }),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
      await expect(store.approve(f.request)).rejects.toBeInstanceOf(
        ModelLiveEvaluationPlanError,
      );
      expect(await counts(f.scope.organizationId)).toEqual({
        plans: 1,
        revocations: 0,
      });
    });
    it("rolls back issuance when the operator is removed before commit", async () => {
      const f = await fixture();
      const store = f.make({
        configuration: {
          ...f.configuration,
          resolveDefinition: async (definitionId: string) => {
            const definition =
              await f.configuration.resolveDefinition(definitionId);
            f.removeOperators();
            return definition;
          },
        },
      });
      await expect(store.approve(f.request)).rejects.toBeInstanceOf(
        ModelLiveEvaluationPlanError,
      );
      expect(await counts(f.scope.organizationId)).toEqual({
        plans: 0,
        revocations: 0,
      });
    });
    it("denies current reads after configuration removal and still permits exact revocation", async () => {
      const f = await fixture(),
        plan = await f.approve(),
        identity = {
          definitionId: f.request.definitionId,
          planDigest: plan.planDigest,
        };
      f.removeConfiguration();
      await expect(f.make().requireCurrent(identity)).rejects.toBeInstanceOf(
        ModelLiveEvaluationPlanError,
      );
      await f.make().revoke(identity);
      expect(await counts(f.scope.organizationId)).toEqual({
        plans: 1,
        revocations: 1,
      });
    });
    it("revokes once, makes exact revocation retries harmless, and never reissues a revoked plan", async () => {
      const f = await fixture(),
        plan = await f.approve(),
        identity = {
          definitionId: f.request.definitionId,
          planDigest: plan.planDigest,
        };
      await Promise.all([f.make().revoke(identity), f.make().revoke(identity)]);
      await expect(f.make().requireCurrent(identity)).rejects.toBeInstanceOf(
        ModelLiveEvaluationPlanError,
      );
      await expect(f.approve()).rejects.toBeInstanceOf(
        ModelLiveEvaluationPlanError,
      );
      expect(await counts(f.scope.organizationId)).toEqual({
        plans: 1,
        revocations: 1,
      });
    });
    it("rejects forged revocation digests and preserves the approved plan", async () => {
      const f = await fixture(),
        plan = await f.approve();
      await expect(
        f.make().revoke({
          definitionId: f.request.definitionId,
          planDigest: sha256Text("forged plan"),
        }),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
      expect(
        await f.make().requireCurrent({
          definitionId: f.request.definitionId,
          planDigest: plan.planDigest,
        }),
      ).toEqual(plan);
      expect(await counts(f.scope.organizationId)).toEqual({
        plans: 1,
        revocations: 0,
      });
    });
    it("rechecks current operator ownership after issuance", async () => {
      const f = await fixture(),
        plan = await f.approve();
      await database.query(
        sql(
          "UPDATE memberships SET role_key='editor' WHERE organization_id=$1 AND principal_id=$2",
          [f.scope.organizationId, f.scope.userId],
        ),
      );
      await expect(
        f.make().requireCurrent({
          definitionId: f.request.definitionId,
          planDigest: plan.planDigest,
        }),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
    });
    it("rechecks current project lifecycle before using an issued plan", async () => {
      const f = await fixture(),
        plan = await f.approve();
      await database.query(
        sql(
          "UPDATE projects SET lifecycle_status='archived' WHERE organization_id=$1 AND project_id=$2",
          [f.scope.organizationId, f.scope.projectId],
        ),
      );
      await expect(
        f.make().requireCurrent({
          definitionId: f.request.definitionId,
          planDigest: plan.planDigest,
        }),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
    });
    it("rechecks a distinct approving operator independently of the execution user", async () => {
      const f = await fixture();
      const configuration = {
        ...f.configuration,
        resolveOperatorPrincipalIds: () => Promise.resolve([f.keeper]),
      };
      const operator = {
        ...f.principal,
        principalId: f.keeper,
        sessionId: id("session"),
      };
      const plan = await f
        .make({ configuration, principal: operator })
        .approve(f.request);
      const identity = {
        definitionId: f.request.definitionId,
        planDigest: plan.planDigest,
      };
      expect(await f.make({ configuration }).requireCurrent(identity)).toEqual(
        plan,
      );
      await database.query(
        sql(
          "UPDATE memberships SET role_key='editor' WHERE organization_id=$1 AND principal_id=$2",
          [f.scope.organizationId, f.keeper],
        ),
      );
      await expect(
        f.make({ configuration }).requireCurrent(identity),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
    });
    it("denies an issued plan when a permanent project write fence exists", async () => {
      const f = await fixture(),
        plan = await f.approve();
      await database.query(
        sql(
          "INSERT INTO project_content_write_scopes(organization_id,project_id,closed_at) VALUES($1,$2,clock_timestamp())",
          [f.scope.organizationId, f.scope.projectId],
        ),
      );
      await expect(
        f.make().requireCurrent({
          definitionId: f.request.definitionId,
          planDigest: plan.planDigest,
        }),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
      await expect(f.approve()).rejects.toBeInstanceOf(
        ModelLiveEvaluationPlanError,
      );
    });
    it("rolls back issuance if the current definition disappears before commit", async () => {
      const f = await fixture();
      let reads = 0;
      const configuration = {
        ...f.configuration,
        resolveDefinition: async (id: string) => {
          reads += 1;
          return reads === 1 ? f.configuration.resolveDefinition(id) : null;
        },
      };
      await expect(
        f.make({ configuration }).approve(f.request),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
      expect(await counts(f.scope.organizationId)).toEqual({
        plans: 0,
        revocations: 0,
      });
    });
    it("owns an atomic current-approval transaction and invalidates its callbacks after return", async () => {
      const f = await fixture(),
        plan = await f.approve(),
        store = f.make();
      let lateCheck: (() => Promise<void>) | undefined;
      let lateQuery: (() => Promise<unknown>) | undefined;
      await store.withIssuedMetadata(
        { definitionId: f.request.definitionId, planDigest: plan.planDigest },
        async (context) => {
          expect(context.plan).toEqual(plan);
          expect(context.principal).toEqual(f.principal);
          expect(context.principal).not.toBe(f.principal);
          expect(Object.isFrozen(context.principal)).toBe(true);
          await context.requireCurrentApproval();
          await context.transaction.query(
            sql("INSERT INTO synthetic_live_plan_work VALUES($1)", [
              f.scope.organizationId,
            ]),
          );
          lateCheck = context.requireCurrentApproval;
          lateQuery = async () => context.transaction.query(sql("SELECT 1"));
        },
      );
      expect(
        (
          await database.query(
            sql(
              "SELECT * FROM synthetic_live_plan_work WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(1);
      if (lateCheck === undefined || lateQuery === undefined)
        throw Error("Missing synthetic callbacks.");
      await expect(lateCheck()).rejects.toBeInstanceOf(
        ModelLiveEvaluationPlanError,
      );
      await expect(lateQuery()).rejects.toBeInstanceOf(
        ModelLiveEvaluationPlanError,
      );
    });
    it("holds the shared organization runtime lock and the exact plan lock for the transaction", async () => {
      const f = await fixture(),
        plan = await f.approve();
      const keys = [
        `runtime-admission:${f.scope.organizationId}`,
        `live-evaluation-plan:${f.scope.organizationId}:${f.scope.projectId}:${f.scope.userId}`,
      ];
      const available = (key: string) =>
        database.transaction(
          async (tx) =>
            (
              await tx.query(
                sql(
                  "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS available",
                  [key],
                ),
              )
            ).rows[0]?.["available"],
        );
      await f
        .make()
        .withIssuedMetadata(
          { definitionId: f.request.definitionId, planDigest: plan.planDigest },
          async (context) => {
            await context.requireCurrentApproval();
            for (const key of keys) expect(await available(key)).toBe(false);
          },
        );
      for (const key of keys) expect(await available(key)).toBe(true);
    });
    it("rolls back downstream metadata if the configured operator disappears during current work", async () => {
      const f = await fixture(),
        plan = await f.approve();
      await expect(
        f.make().withIssuedMetadata(
          {
            definitionId: f.request.definitionId,
            planDigest: plan.planDigest,
          },
          async (context) => {
            await context.requireCurrentApproval();
            await context.transaction.query(
              sql("INSERT INTO synthetic_live_plan_work VALUES($1)", [
                f.scope.organizationId,
              ]),
            );
            f.removeOperators();
          },
        ),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
      expect(
        (
          await database.query(
            sql(
              "SELECT * FROM synthetic_live_plan_work WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(0);
    });
    it("permits issued metadata recovery after revocation and configuration removal without current authority", async () => {
      const f = await fixture(),
        plan = await f.approve(),
        store = f.make();
      const identity = {
        definitionId: f.request.definitionId,
        planDigest: plan.planDigest,
      };
      await store.revoke(identity);
      f.removeConfiguration();
      f.removeOperators();
      expect(
        await store.withIssuedMetadata(identity, async (context) => {
          await context.transaction.query(
            sql("INSERT INTO synthetic_live_plan_work VALUES($1)", [
              f.scope.organizationId,
            ]),
          );
          return context.plan;
        }),
      ).toEqual(plan);
      await expect(store.requireCurrent(identity)).rejects.toBeInstanceOf(
        ModelLiveEvaluationPlanError,
      );
      expect(
        (
          await database.query(
            sql(
              "SELECT * FROM synthetic_live_plan_work WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(1);
    });
    it("cannot suppress a failed current-approval check and commit downstream writes", async () => {
      const f = await fixture(),
        plan = await f.approve(),
        store = f.make();
      const identity = {
        definitionId: f.request.definitionId,
        planDigest: plan.planDigest,
      };
      await store.revoke(identity);
      await expect(
        store.withIssuedMetadata(identity, async (context) => {
          await context.requireCurrentApproval().catch(() => undefined);
          await context.transaction.query(
            sql("INSERT INTO synthetic_live_plan_work VALUES($1)", [
              f.scope.organizationId,
            ]),
          );
        }),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
      expect(
        (
          await database.query(
            sql(
              "SELECT * FROM synthetic_live_plan_work WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(0);
    });
    it("keeps a caught approval failure sticky when host configuration is restored", async () => {
      const f = await fixture(),
        plan = await f.approve();
      let missing = true;
      const store = f.make({
        configuration: {
          ...f.configuration,
          resolveOperatorPrincipalIds: () =>
            Promise.resolve(missing ? [] : [f.principal.principalId]),
        },
      });
      await expect(
        store.withIssuedMetadata(
          { definitionId: f.request.definitionId, planDigest: plan.planDigest },
          async (context) => {
            await context.requireCurrentApproval().catch(() => {
              missing = false;
            });
            await context.transaction.query(
              sql("INSERT INTO synthetic_live_plan_work VALUES($1)", [
                f.scope.organizationId,
              ]),
            );
          },
        ),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
      expect(missing).toBe(false);
      expect(
        (
          await database.query(
            sql(
              "SELECT * FROM synthetic_live_plan_work WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(0);
    });
    it("rejects work that returns before its approval check has settled", async () => {
      const f = await fixture(),
        plan = await f.approve();
      const pending: Promise<void>[] = [];
      await expect(
        f.make().withIssuedMetadata(
          {
            definitionId: f.request.definitionId,
            planDigest: plan.planDigest,
          },
          async (context) => {
            await context.transaction.query(
              sql("INSERT INTO synthetic_live_plan_work VALUES($1)", [
                f.scope.organizationId,
              ]),
            );
            pending.push(
              context.requireCurrentApproval().catch(() => undefined),
            );
          },
        ),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
      await Promise.all(pending);
      expect(
        (
          await database.query(
            sql(
              "SELECT * FROM synthetic_live_plan_work WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(0);
    });
    it("rolls back callback failures and changed exposed plan metadata", async () => {
      for (const mutate of [false, true]) {
        const f = await fixture(),
          plan = await f.approve();
        await expect(
          f.make().withIssuedMetadata(
            {
              definitionId: f.request.definitionId,
              planDigest: plan.planDigest,
            },
            async (context) => {
              await context.requireCurrentApproval();
              await context.transaction.query(
                sql("INSERT INTO synthetic_live_plan_work VALUES($1)", [
                  f.scope.organizationId,
                ]),
              );
              if (mutate) context.plan.expiresAt = context.plan.issuedAt;
              else throw Error("Synthetic downstream failure.");
            },
          ),
        ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
        expect(
          (
            await database.query(
              sql(
                "SELECT * FROM synthetic_live_plan_work WHERE organization_id=$1",
                [f.scope.organizationId],
              ),
            )
          ).rowCount,
        ).toBe(0);
      }
    });
    it("rejects unissued metadata before running transaction work", async () => {
      const f = await fixture();
      let called = false;
      await expect(
        f.make().withIssuedMetadata(
          {
            definitionId: f.request.definitionId,
            planDigest: f.plan.planDigest,
          },
          () => {
            called = true;
            return Promise.resolve();
          },
        ),
      ).rejects.toBeInstanceOf(ModelLiveEvaluationPlanError);
      expect(called).toBe(false);
    });
    it("shares one V2 idempotency decision and cumulative debit across independent stores", async () => {
      const f = await runtimeFixture();
      const input = f.claim(await f.store.inspect(f.state));
      const results = await Promise.all([
        f.store.claim(input),
        f.makeStore().claim(input),
      ]);
      expect(results.map((result) => result.kind).sort()).toEqual([
        "claimed",
        "duplicate-in-progress",
      ]);
      const claimed = results.find((result) => result.kind === "claimed");
      if (claimed?.kind !== "claimed") throw Error("Missing claimed result.");
      await f.store.release({
        executionLease: claimed.executionLease,
        tenantScopeDigest: f.state.tenantScopeDigest,
      });
      const after = await f.store.inspect(f.state);
      expect(after.windows.organization).toMatchObject({
        requestCount: 1,
        activeConcurrentJobs: 0,
      });
      expect(after.liveAuthorityUsage).toMatchObject({
        activeConcurrentJobs: 0,
        reservedInvocations: 1,
        reservedCreditUnits: 1,
        reservedInputTokens: 100,
        reservedOutputTokens: 1000,
        reservedTotalTokens: 1100,
      });
      const stored = await database.query(
        sql(
          "SELECT snapshot FROM model_runtime_admissions WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      expect(stored.rowCount).toBe(1);
      expect(JSON.stringify(stored.rows)).not.toMatch(
        /candidateText|promptText|responseText/u,
      );
    });
    it("shares request counts and active concurrency with normal execution in both directions", async () => {
      const f = await runtimeFixture();
      const live = await f.admit();
      const normal = runtimeAdmissionFixture(f.scope, f.now);
      const normalStore = new PostgresModelRuntimeAdmissionStore({
        database,
        scope: f.scope,
      });
      const observed = await normalStore.inspect(normal.state);
      expect(observed.windows.user).toMatchObject({
        requestCount: 1,
        activeConcurrentJobs: 1,
      });
      const normalClaim = normal.claim(observed);
      expect(
        await normalStore.claim({
          ...normalClaim,
          limits: {
            ...normalClaim.limits,
            maximumConcurrentOrganizationJobs: 1,
            maximumConcurrentUserJobs: 1,
          },
        }),
      ).toMatchObject({
        kind: "limit-changed",
        reason: "concurrency-limit-exceeded",
      });
      await f.store.release({
        executionLease: live.result.executionLease,
        tenantScopeDigest: f.state.tenantScopeDigest,
      });
      const admittedNormal = await normal.admit(normalStore);
      const next = f.next("second live admission");
      const nextSnapshot = await f.store.inspect(next.state);
      expect(nextSnapshot.windows.organization).toMatchObject({
        requestCount: 2,
        activeConcurrentJobs: 1,
      });
      expect(await f.store.claim(next.claim(nextSnapshot))).toMatchObject({
        kind: "limit-changed",
        reason: "concurrency-limit-exceeded",
      });
      await normalStore.release({
        executionLease: admittedNormal.result.executionLease,
        tenantScopeDigest: normal.state.tenantScopeDigest,
      });
    });
    it("serializes simultaneous normal and live claims against the same organization snapshot", async () => {
      const f = await runtimeFixture();
      const normal = runtimeAdmissionFixture(f.scope, f.now);
      const normalStore = new PostgresModelRuntimeAdmissionStore({
        database,
        scope: f.scope,
      });
      const liveClaim = f.claim(await f.store.inspect(f.state));
      const normalClaim = normal.claim(await normalStore.inspect(normal.state));
      const results = await Promise.all([
        f.store.claim(liveClaim),
        normalStore.claim(normalClaim),
      ]);
      expect(results.map((result) => result.kind).sort()).toEqual([
        "claimed",
        "conflict",
      ]);
      expect(
        (await f.store.inspect(f.state)).windows.organization,
      ).toMatchObject({
        requestCount: 1,
        activeConcurrentJobs: 1,
      });
    });
    it("never refunds cumulative live capacity when an execution lease is released", async () => {
      const f = await runtimeFixture(1);
      const admitted = await f.admit();
      await f.store.release({
        executionLease: admitted.result.executionLease,
        tenantScopeDigest: f.state.tenantScopeDigest,
      });
      const next = f.next("beyond one invocation");
      const snapshot = await f.store.inspect(next.state);
      expect(snapshot.liveAuthorityUsage).toMatchObject({
        activeConcurrentJobs: 0,
        reservedInvocations: 1,
      });
      expect(await f.store.claim(next.claim(snapshot))).toMatchObject({
        kind: "limit-changed",
        reason: "live-evaluation-not-authorized",
      });
      expect(
        (await f.store.inspect(next.state)).windows.organization.requestCount,
      ).toBe(1);
    });
    it.each([true, false])(
      "fences an expired lease across execution versions (live first: %s)",
      async (liveFirst) => {
        const f = await runtimeFixture();
        const normal = runtimeAdmissionFixture(
          f.scope,
          f.now,
          id("normal"),
          "live_concurrency_synthetic",
        );
        const normalStore = new PostgresModelRuntimeAdmissionStore({
          database,
          scope: f.scope,
        });
        const expiresAt = new Date(Date.now() + 1500).toISOString();
        const first = liveFirst
          ? await f.store.claim({
              ...f.claim(await f.store.inspect(f.state)),
              executionLeaseExpiresAt: expiresAt,
            })
          : await normalStore.claim({
              ...normal.claim(await normalStore.inspect(normal.state)),
              executionLeaseExpiresAt: expiresAt,
            });
        if (first.kind !== "claimed") throw Error("Missing first lease.");
        const milliseconds =
          Math.max(0, Date.parse(first.executionLease.expiresAt) - Date.now()) +
          30;
        await database.query(
          sql("SELECT pg_sleep($1::double precision)", [milliseconds / 1000]),
        );
        const second = liveFirst
          ? await normalStore.claim(
              normal.claim(await normalStore.inspect(normal.state)),
            )
          : await f.store.claim(f.claim(await f.store.inspect(f.state)));
        expect(second.kind).toBe("claimed");
        const previousScope = liveFirst
          ? f.state.tenantScopeDigest
          : normal.state.tenantScopeDigest;
        const previous = await database.query(
          sql(
            "SELECT snapshot->'executionLease' AS lease,snapshot->'recoveryRequired' AS recovery FROM model_runtime_admissions WHERE organization_id=$1 AND scope_sha256=$2",
            [f.scope.organizationId, previousScope.slice(7)],
          ),
        );
        expect(previous.rows[0]).toEqual({ lease: null, recovery: true });
        await expect(
          (liveFirst ? f.store : normalStore).release({
            executionLease: first.executionLease,
            tenantScopeDigest: previousScope,
          }),
        ).rejects.toBeInstanceOf(ModelRuntimeControlError);
        expect(
          (await normalStore.inspect(normal.state)).windows.organization
            .requestCount,
        ).toBe(2);
      },
    );
    it("denies new live admission and usable execution after approval is revoked", async () => {
      const f = await runtimeFixture();
      const input = f.claim(await f.store.inspect(f.state));
      await f.plans.revoke({
        definitionId: f.definition.definitionId,
        planDigest: f.plan.planDigest,
      });
      await expect(f.store.claim(input)).rejects.toBeInstanceOf(
        ModelRuntimeControlError,
      );
      expect(
        (
          await database.query(
            sql(
              "SELECT * FROM model_runtime_admissions WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(0);
    });
    it("allows exact recovery after revocation and configuration removal without reissuing execution", async () => {
      const f = await runtimeFixture();
      const admitted = await f.admit();
      await f.plans.revoke({
        definitionId: f.definition.definitionId,
        planDigest: f.plan.planDigest,
      });
      f.base.removeConfiguration();
      f.base.removeOperators();
      await expect(
        f.store.assertExecutionLease({
          executionLease: admitted.result.executionLease,
          tenantScopeDigest: f.state.tenantScopeDigest,
          commercialExpiresAt: admitted.input.commercialExpiresAt,
          trustedNow: new Date().toISOString(),
        }),
      ).rejects.toBeInstanceOf(ModelRuntimeControlError);
      await f.store.release({
        executionLease: admitted.result.executionLease,
        tenantScopeDigest: f.state.tenantScopeDigest,
      });
      const recovered = await f.store.claim({
        ...admitted.input,
        decidedAt: new Date().toISOString(),
        executionLeaseExpiresAt: new Date(Date.now() + 120000).toISOString(),
      });
      expect(recovered.kind).toBe("claimed");
      if (recovered.kind !== "claimed") throw Error("Missing recovery lease.");
      expect(recovered.executionLease.recoveryOnly).toBe(true);
      await f.store.completeAndRelease({
        executionLease: recovered.executionLease,
        fingerprint: admitted.input.fingerprint,
        tenantScopeDigest: f.state.tenantScopeDigest,
        terminal: f.terminal,
        terminalOutbox: [],
        trustedNow: new Date().toISOString(),
      });
      expect(await f.store.claim(admitted.input)).toEqual({
        kind: "duplicate-terminal",
        terminal: f.terminal,
      });
      const normal = runtimeAdmissionFixture(f.scope, f.now);
      const observer = new PostgresModelRuntimeAdmissionStore({
        database,
        scope: f.scope,
      });
      expect(
        (await observer.inspect(normal.state)).windows.organization,
      ).toMatchObject({ requestCount: 1, activeConcurrentJobs: 0 });
    });
    it("rejects attempts to relax the issued policy or cumulative limits", async () => {
      const f = await runtimeFixture();
      const input = f.claim(await f.store.inspect(f.state));
      for (const change of [
        {
          limits: {
            ...input.limits,
            maximumOrganizationRequests:
              input.limits.maximumOrganizationRequests + 1,
          },
        },
        {
          liveAuthorityReservation: {
            ...input.liveAuthorityReservation,
            limits: {
              ...input.liveAuthorityReservation.limits,
              maximumInvocations: 100,
            },
          },
        },
      ])
        await expect(
          f.store.claim({ ...input, ...change }),
        ).rejects.toBeInstanceOf(ModelRuntimeControlError);
      expect(
        (
          await database.query(
            sql(
              "SELECT * FROM model_runtime_admission_debits WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(0);
    });
    it("keeps normal owned-record reads strict when a live record uses the same tenant scope digest", async () => {
      const f = await runtimeFixture();
      const admitted = await f.admit();
      const normalStore = new PostgresModelRuntimeAdmissionStore({
        database,
        scope: f.scope,
      });
      await expect(
        normalStore.release({
          executionLease: admitted.result.executionLease,
          tenantScopeDigest: f.state.tenantScopeDigest,
        }),
      ).rejects.toBeInstanceOf(ModelRuntimeControlError);
      await f.store.release({
        executionLease: admitted.result.executionLease,
        tenantScopeDigest: f.state.tenantScopeDigest,
      });
    });
    it("database triggers prevent plan and revocation rewriting or deletion", async () => {
      const f = await fixture(),
        plan = await f.approve();
      await f.make().revoke({
        definitionId: f.request.definitionId,
        planDigest: plan.planDigest,
      });
      for (const table of [
        "model_live_evaluation_plans",
        "model_live_evaluation_revocations",
      ] as const) {
        await expect(
          database.query(
            sql(
              `UPDATE ${table} SET operator_principal_id=operator_principal_id WHERE organization_id=$1`,
              [f.scope.organizationId],
            ),
          ),
        ).rejects.toThrow();
        await expect(
          database.query(
            sql(`DELETE FROM ${table} WHERE organization_id=$1`, [
              f.scope.organizationId,
            ]),
          ),
        ).rejects.toThrow();
      }
      expect(await counts(f.scope.organizationId)).toEqual({
        plans: 1,
        revocations: 1,
      });
    });
  },
);
