import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BETA_CREDIT_PRO_PLAN_ID,
  BETA_EXPORT_PRO_PLAN_ID,
  BETA_SHARING_PLAN_IDS,
} from "@cloudmarkup/domain";
import type { OrganizationRole } from "../../application/authorization.js";
import type { TrustedCommercialAdministrationContext } from "../../application/commercial-persistence.js";
import { OrganizationInvitationApplication } from "../../application/organization-invitations.js";
import { createApp } from "../../app.js";
import { ProductionIdentityApplication } from "../../application/production-identity-application.js";
import { createProductionOrganizationInvitations } from "../../production-organization-invitations.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "../../testing/in-memory-adapters.js";
import {
  acceptedOrganizationInvitationResponseV1Schema,
  organizationInvitationResponseV1Schema,
  currentPrincipalResponseV1Schema,
} from "@cloudmarkup/api-contract";
import type { PrincipalContext } from "../../application/ports.js";
import { PostgresBillingPersistence } from "./billing-persistence.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresOrganizationInvitationRepository } from "./organization-invitations.js";
import { PostgresDatabase } from "./postgres-driver.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"];
const integration = configured === undefined ? describe.skip : describe;
const runId = randomUUID().replaceAll("-", "");
const schema = `cloudmarkup_invitation_test_${runId}`;
const marker = `CloudMarkup synthetic invitation test ${runId}`;
const legacyPlan = "planver_starter_2026_08_14_v1";
const staffCreditsPlan = "planver_staff_credits_2026_10_15_v1";
const id = (prefix: string): string => `${prefix}_${randomUUID()}`;
const secretHash = (token: string): string =>
  createHash("sha256")
    .update(JSON.stringify(["organization-invitation-v1", "secret", token]))
    .digest("hex");
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function awaitCheckpoint(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error("Synthetic transaction checkpoint was not reached."),
          );
        }, 5000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

integration("registered sharing migration on isolated real PostgreSQL", () => {
  let database: PostgresDatabase;
  let opened: PostgresDatabase | undefined;
  let admin: PostgresDatabase | undefined;
  let created = false;
  let historical: readonly SqlRow[];
  let preExportPlans: readonly SqlRow[];
  let priorPricing: readonly SqlRow[];
  let priorScenarioChecks: readonly SqlRow[];
  let appliedVersions: readonly SqlRow[];
  const application = (port: SqlDatabase = database) =>
    new OrganizationInvitationApplication({
      repository: new PostgresOrganizationInvitationRepository(port),
    });
  function observeQueries(
    observer: (statement: SqlStatement) => Promise<void>,
  ): SqlDatabase {
    return {
      close: () => Promise.resolve(),
      query: <T extends SqlRow = SqlRow>(
        statement: SqlStatement,
      ): Promise<SqlResult<T>> => database.query<T>(statement),
      transaction: <T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> =>
        database.transaction((tx) =>
          work({
            query: async <R extends SqlRow = SqlRow>(
              statement: SqlStatement,
            ): Promise<SqlResult<R>> => {
              const result = await tx.query<R>(statement);
              await observer(statement);
              return result;
            },
          }),
        ),
    };
  }

  async function catalog() {
    return (
      await database.query(
        sql(`SELECT 'plan' AS kind,to_jsonb(t) AS value FROM commercial_plan_versions t WHERE plan_version_id IN ('${legacyPlan}','planver_pro_2026_08_14_v2')
      UNION ALL SELECT 'features',to_jsonb(t) FROM commercial_plan_feature_entitlements t WHERE plan_version_id IN ('${legacyPlan}','planver_pro_2026_08_14_v2')
      UNION ALL SELECT 'limits',to_jsonb(t) FROM commercial_plan_numeric_limits t WHERE plan_version_id IN ('${legacyPlan}','planver_pro_2026_08_14_v2')
      UNION ALL SELECT 'credits',to_jsonb(t) FROM commercial_plan_included_credit_grants t WHERE plan_version_id IN ('${legacyPlan}','planver_pro_2026_08_14_v2')
      UNION ALL SELECT 'seats',to_jsonb(t) FROM commercial_plan_seat_rules t WHERE plan_version_id IN ('${legacyPlan}','planver_pro_2026_08_14_v2') ORDER BY kind,value`),
      )
    ).rows;
  }
  async function priorPlanConfiguration() {
    return (
      await database.query(
        sql(
          "SELECT 'plan' AS kind,to_jsonb(t) AS value FROM commercial_plan_versions t WHERE plan_version_id<>$1 AND plan_version_id<>$2 AND plan_version_id<>$3 AND plan_version_id<>$4 " +
            "UNION ALL SELECT 'features',to_jsonb(t) FROM commercial_plan_feature_entitlements t WHERE plan_version_id<>$1 AND plan_version_id<>$2 AND plan_version_id<>$3 AND plan_version_id<>$4 " +
            "UNION ALL SELECT 'limits',to_jsonb(t) FROM commercial_plan_numeric_limits t WHERE plan_version_id<>$1 AND plan_version_id<>$2 AND plan_version_id<>$3 AND plan_version_id<>$4 " +
            "UNION ALL SELECT 'credits',to_jsonb(t) FROM commercial_plan_included_credit_grants t WHERE plan_version_id<>$1 AND plan_version_id<>$2 AND plan_version_id<>$3 AND plan_version_id<>$4 " +
            "UNION ALL SELECT 'seats',to_jsonb(t) FROM commercial_plan_seat_rules t WHERE plan_version_id<>$1 AND plan_version_id<>$2 AND plan_version_id<>$3 AND plan_version_id<>$4 ORDER BY kind,value",
          [
            BETA_EXPORT_PRO_PLAN_ID,
            BETA_CREDIT_PRO_PLAN_ID,
            "planver_staff_trial_2026_10_06_v1",
            staffCreditsPlan,
          ],
        ),
      )
    ).rows;
  }
  beforeAll(async () => {
    let url: URL | undefined;
    try {
      if (configured !== undefined) url = new URL(configured);
    } catch {
      throw new Error("Invalid local database URL.");
    }
    if (
      configured === undefined ||
      url === undefined ||
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.search !== "" ||
      url.hash !== "" ||
      !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/.test(url.pathname)
    )
      throw new Error("Invitation tests require explicit loopback PostgreSQL.");
    if (!/^cloudmarkup_invitation_test_[a-f0-9]{32}$/.test(schema))
      throw new Error("Invalid synthetic schema.");
    admin = new PostgresDatabase({
      connectionString: configured,
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    await admin.transaction(async (tx) => {
      await tx.query(sql(`CREATE SCHEMA ${schema}`));
      await tx.query(sql(`COMMENT ON SCHEMA ${schema} IS '${marker}'`));
    });
    created = true;
    database = new PostgresDatabase({
      connectionString: configured,
      max: 4,
      connectionTimeoutMillis: 5000,
      options: `-c search_path=${schema} -c timezone=UTC -c statement_timeout=10000`,
    });
    opened = database;
    const migrations = await loadHistoricalBetaMigrations(
      fileURLToPath(new URL("../../../migrations/", import.meta.url)),
    );
    await runMigrations(
      database,
      migrations.filter(({ version }) => version < "0032"),
    );
    historical = await catalog();
    appliedVersions = (
      await database.query(
        sql(
          "SELECT version,checksum_sha256 FROM cloudmarkup_schema_migrations ORDER BY version",
        ),
      )
    ).rows;
    // Apply the complete registered chain, proving old rows/checksums survive
    // the forward-only addition. No separate ignored SQL fixture is executed.
    await runMigrations(
      database,
      migrations.filter(({ version }) => version < "0055"),
    );
    preExportPlans = await priorPlanConfiguration();
    await runMigrations(
      database,
      migrations.filter(({ version }) => version < "0082"),
    );
    priorPricing = (
      await database.query(
        sql(
          "SELECT to_jsonb(p)-'effective_until' AS value FROM provider_pricing_versions p ORDER BY pricing_version_id",
        ),
      )
    ).rows;
    priorScenarioChecks = (
      await database.query(
        sql(
          "SELECT conname,pg_get_expr(conbin,conrelid) AS expression FROM pg_constraint WHERE conrelid='usage_ledger_entries'::regclass AND conname IN ('usage_ledger_entries_scenario_check','usage_ledger_entries_scenario_outcome_check') AND convalidated ORDER BY conname",
        ),
      )
    ).rows;
    await runMigrations(database, migrations);
  }, 60000);
  afterAll(async () => {
    await opened?.close();
    try {
      if (
        created &&
        /^cloudmarkup_invitation_test_[a-f0-9]{32}$/.test(schema)
      ) {
        const observed = await admin?.query(
          sql(
            "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
            [schema],
          ),
        );
        if (observed?.rows[0]?.["marker"] !== marker)
          throw new Error("Refusing unverified schema cleanup.");
        await admin?.query(sql(`DROP SCHEMA ${schema} CASCADE`));
      }
    } finally {
      await admin?.close();
    }
  }, 30000);

  it("closes the old pricing window without changing prior rates and starts the exact approved conversion", async () => {
    const rows = (
      await database.query(
        sql(
          "SELECT to_jsonb(p)-'effective_until' AS value FROM provider_pricing_versions p WHERE pricing_version_id<>'pricing_beta_sonnet46_global_20260930_v2' ORDER BY pricing_version_id",
        ),
      )
    ).rows;
    expect(rows).toEqual(priorPricing);
    const transition = await database.query(
      sql(
        "SELECT old.effective_until=new.effective_from AS contiguous, new.effective_until IS NULL AS current, (4000000*old.credit_conversion_numerator/old.credit_conversion_denominator)::text AS previous_credits, (4000000*new.credit_conversion_numerator/new.credit_conversion_denominator)::text AS current_credits FROM provider_pricing_versions old JOIN provider_pricing_versions new ON new.pricing_version_id='pricing_beta_sonnet46_global_20260930_v2' WHERE old.pricing_version_id='pricing_beta_sonnet46_global_20260925_v1'",
      ),
    );
    expect(transition.rows).toEqual([
      {
        contiguous: true,
        current: true,
        previous_credits: "520",
        current_credits: "400",
      },
    ]);
  });
  it("retains old settlement predicates and admits only delivered settlements for the new pricing version", async () => {
    const checks = (
      await database.query(
        sql(
          "SELECT conname,pg_get_expr(conbin,conrelid) AS expression FROM pg_constraint WHERE conrelid='usage_ledger_entries'::regclass AND conname IN ('usage_ledger_entries_scenario_check','usage_ledger_entries_scenario_outcome_check') AND convalidated ORDER BY conname",
        ),
      )
    ).rows;
    expect(checks).toHaveLength(2);
    expect(priorScenarioChecks).toHaveLength(2);
    for (const check of checks) {
      const expression = check["expression"];
      const previous = priorScenarioChecks.find(
        (row) => row["conname"] === check["conname"],
      )?.["expression"];
      if (typeof expression !== "string" || typeof previous !== "string")
        throw new Error("Missing exact installed scenario checks.");
      for (const pricing of [
        "pricing_beta_sonnet46_global_20260925_v1",
        "pricing_beta_sonnet46_global_20260930_v2",
        "unreviewed_pricing",
      ]) {
        for (const outcome of ["useful-output-delivered", "provider-failure"]) {
          for (const kind of ["settlement", "reservation"]) {
            const result = await database.query(
              sql(
                `SELECT (${expression}) IS TRUE AS accepted, (${previous}) IS TRUE AS previously_accepted FROM (SELECT $1::varchar AS pricing_version_id, 'legacy-provider-v1'::varchar AS pricing_authority, 'beta-ai-output-delivered-v1'::varchar AS charging_scenario, $2::varchar AS outcome, $3::varchar AS entry_kind) candidate`,
                [pricing, outcome, kind],
              ),
            );
            const valid =
              pricing !== "unreviewed_pricing" &&
              outcome === "useful-output-delivered" &&
              kind === "settlement";
            expect(result.rows[0]?.["accepted"]).toBe(valid);
            if (pricing !== "pricing_beta_sonnet46_global_20260930_v2")
              expect(result.rows[0]?.["accepted"]).toBe(
                result.rows[0]?.["previously_accepted"],
              );
          }
        }
      }
    }
  });

  async function principal(): Promise<PrincipalContext> {
    const principalId = id("principal");
    await database.query(
      sql(
        "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic invitation member')",
        [principalId],
      ),
    );
    return {
      principalId,
      sessionId: id("session"),
      correlationId: id("correlation"),
      authenticationSource: "test",
      authenticatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    };
  }
  async function addMember(
    organizationId: string,
    actor: PrincipalContext,
    role: OrganizationRole = "editor",
    state = "active",
  ) {
    const membershipId = id("membership");
    await database.query(
      sql(
        "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key,lifecycle_status) VALUES($1,$2,$3,$4,$5)",
        [membershipId, organizationId, actor.principalId, role, state],
      ),
    );
    return membershipId;
  }
  async function fixture(plan: string | null = BETA_SHARING_PLAN_IDS.starter) {
    const owner = await principal();
    const organizationId = id("org");
    await database.query(
      sql(
        "INSERT INTO organizations(organization_id,display_name,slug) VALUES($1,'Synthetic sharing workspace',$2)",
        [organizationId, `sharing-${randomUUID()}`],
      ),
    );
    for (const role of ["owner", "administrator", "editor", "viewer"] as const)
      await database.query(
        sql(
          "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES($1,$2::text,'authorization-v2',$3,cloudmarkup_authorization_v2_permissions($2::text))",
          [organizationId, role, role === "owner"],
        ),
      );
    const ownerMembershipId = await addMember(organizationId, owner, "owner");
    const commercial = new PostgresCommercialPersistenceRepository(database);
    const context: TrustedCommercialAdministrationContext = {
      authority: "internal-administration",
      actorId: id("synthetic_admin"),
      actorPrincipalId: owner.principalId,
      correlationId: owner.correlationId,
      organizationId,
    };
    if (plan !== null) {
      const account = await commercial.createBillingAccount(context, {
        billingAccountId: id("billing"),
      });
      const now = new Date().toISOString();
      const projection = await commercial.updateSubscriptionProjection(
        context,
        {
          subscriptionProjectionId: id("subscriptionprojection"),
          planVersionId: plan,
          billingProvider: "synthetic-local-provider",
          providerCustomerReference: id("customer"),
          providerSubscriptionReference: id("subscription"),
          billableSeatQuantity: "1",
          cancelAtPeriodEnd: false,
          expectedRecordVersion: "0",
          normalizedStatus: "active",
          effectiveAt: now,
          currentPeriodId: id("period"),
          currentPeriodStart: now,
          currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
        },
      );
      await commercial.updateEntitlementSnapshot(context, {
        entitlementSnapshotId: id("entitlement"),
        entitlementPolicyVersion: "cloudmarkup-entitlements-v1",
        planVersionId: plan,
        subscriptionProjectionId: projection.subscriptionProjectionId,
        sourceRecordVersion: projection.recordVersion,
        expensiveOperationsEnabled: account.expensiveOperationsEnabled,
        expectedRecordVersion: "0",
        effectiveAt: now,
      });
    }
    return { owner, ownerMembershipId, organizationId, commercial, context };
  }
  async function invite(
    f: Awaited<ReturnType<typeof fixture>>,
    role: "administrator" | "editor" | "viewer" = "editor",
    issuer = f.owner,
    key = id("attempt"),
  ) {
    const token = randomBytes(32).toString("base64url");
    const invitation = await application().create(
      issuer,
      f.organizationId,
      { contractVersion: 1, role, token },
      key,
    );
    return { invitation, token, key };
  }
  const accept = (
    actor: PrincipalContext,
    link: Awaited<ReturnType<typeof invite>>,
  ) =>
    application().accept(actor, link.invitation.id, {
      contractVersion: 1,
      token: link.token,
    });
  async function count(organizationId: string) {
    return Number(
      (
        await database.query(
          sql(
            "SELECT count(*) AS total FROM memberships WHERE organization_id=$1 AND lifecycle_status='active'",
            [organizationId],
          ),
        )
      ).rows[0]?.["total"],
    );
  }

  it("adds immutable catalog versions and exact later ledger entries without rewriting history", async () => {
    expect(await catalog()).toEqual(historical);
    expect(
      (
        await database.query(
          sql(
            "SELECT version,checksum_sha256 FROM cloudmarkup_schema_migrations ORDER BY version",
          ),
        )
      ).rows,
    ).toEqual([
      ...appliedVersions,
      {
        version: "0032",
        checksum_sha256:
          "d27a0dc26451dc0e94059f3a19be451a0ff224a9d9d9f6279a4a1772d64e884e",
      },
      {
        version: "0033",
        checksum_sha256:
          "6b37441d222e2c80d9883d260bef05a82ce49a104dbff0e0dc77612086ccef3c",
      },
      {
        version: "0034",
        checksum_sha256:
          "639363fca3eae0b1b16b511584ab3b8eef309d6524a113090cec0be3269e76c8",
      },
      {
        version: "0035",
        checksum_sha256:
          "411d444929340800c0e6c3ac949e4d5ed19627ee4420c36af4d97b59847102eb",
      },
      {
        version: "0036",
        checksum_sha256:
          "f2b07a6039755d63f875a63f71836bd4bb4f9a019fb6f7650dea81def83056b0",
      },
      {
        version: "0037",
        checksum_sha256:
          "e7c152430e8554568ebd5a2e9f3885d5ba40be5b29f590b8a6443f44a18a45ed",
      },
      {
        version: "0038",
        checksum_sha256:
          "645c31be59d93b0d9f849cde24cf498b6320b5ba5b4365ba0111aa46cfdae63a",
      },
      {
        version: "0039",
        checksum_sha256:
          "1e541cbe83d4961636be3330f497ab75be2983f1572ec4ccc80a9388875525ba",
      },
      {
        version: "0040",
        checksum_sha256:
          "69d09aa4098aa4d18f6f2ef90c764c93cdfcb3812bc837c1f8ead6ba00d39d27",
      },
      {
        version: "0041",
        checksum_sha256:
          "b443742e9948fc4aa75ee157ee3d06a6a8d076e592511b781f1b91556e9b4895",
      },
      {
        version: "0042",
        checksum_sha256:
          "c002d77ed254f4f8ca08534bcf2ece8f21fcee51c68b13108ce4d1ebe89e1bf1",
      },
      {
        version: "0043",
        checksum_sha256:
          "d98fdcfa90cd664c9977ea2bf5446da7ad2ac448177f0be3806d3a78c9551b2e",
      },
      {
        version: "0044",
        checksum_sha256:
          "afa6518c2ecdf9b5c7a1eb7c8682e5a6e7b6b9709cdd4b7762aeadd41a37efbf",
      },
      {
        version: "0045",
        checksum_sha256:
          "861026d36e00c73a474a5d45a2dbbf1da7591c9401e61bce5fd00a68182a1b59",
      },
      {
        version: "0046",
        checksum_sha256:
          "5e19f45a4f30f098e5f0f798aab83726edc3d677d4120611c74eda70a43a5c6a",
      },
      {
        version: "0047",
        checksum_sha256:
          "0a48204bc093ee591890e663667dd109dffe1c7a248e0f54724d808eae618545",
      },
      {
        version: "0048",
        checksum_sha256:
          "6c2bff1b3acb0834c1501acd15f85042ad87896e59e5a439bdfa72396fca3e8e",
      },
      {
        version: "0049",
        checksum_sha256:
          "9d89e90c335d4796cdb8ede848bcb38bad302baf2d9e3679b64de13dc09c0c92",
      },
      {
        version: "0050",
        checksum_sha256:
          "a87158fb3de47a71d3b1e811c6ca9fac36182a785065edd9f8ceca71528ac967",
      },
      {
        version: "0051",
        checksum_sha256:
          "a578cb90fecf02f47b95e57c286119283dfe6cc5e2aae532ddd7989ace17e072",
      },
      {
        version: "0052",
        checksum_sha256:
          "6b42af88883716cec63b704d54d0a96794206774910888b734d1a2c7cf001dbd",
      },
      {
        version: "0053",
        checksum_sha256:
          "4ffa2c757313357f39434dac0cfc001d1b21cd33af43a9af598e7ecb05686757",
      },
      {
        version: "0054",
        checksum_sha256:
          "cbe23fc755553e65541dcc16f0f0649edb6ccdc89069d59a3014861b0b3c371b",
      },
      {
        version: "0055",
        checksum_sha256:
          "aaa6e796d8139ab3d3789de119d46f429232585f4b4c20778674c2379a797237",
      },
      {
        version: "0056",
        checksum_sha256:
          "6b753f02718875609a1c39b526569bb385901372ffbc6ae26c402a5ce98371a2",
      },
      {
        version: "0057",
        checksum_sha256:
          "67b5381a6e46f30d3b71635d7fddd6d047a73c66e808106a21e685697a656184",
      },
      {
        version: "0058",
        checksum_sha256:
          "2e9cb6502b4dbd889a671b9df27776d9b9359fa0087ab74c75f4869a06929aa6",
      },
      {
        version: "0059",
        checksum_sha256:
          "0b0b53a8829bc91b3e6748f5aee15e7138a378487b8408ce1da59a9fd056fa31",
      },
      {
        version: "0078",
        checksum_sha256:
          "cad86254f3652dc3d8c6263f574dd21bd7513a7562dfaf516b3d7e00b4768770",
      },
      {
        version: "0079",
        checksum_sha256:
          "05232426bc438ff426935f68e0792fd70304b381179fe283f7bde6cb18f10263",
      },
      {
        version: "0080",
        checksum_sha256:
          "0703ffd7acb54d85ed0502df421baeeb3445a13685f2425b05769c068660ec7e",
      },
      {
        version: "0081",
        checksum_sha256:
          "ec7ae42bb7c195e4fc34d3dde1fe90f413aa6a25d12f6411f0b8c22a16feefec",
      },
      {
        version: "0082",
        checksum_sha256:
          "0db9172cb79285bed9aa6c2ca4d8571395ea901fdbfc53890b335a4c03486df5",
      },
      {
        version: "0083",
        checksum_sha256:
          "98668f75767eb7ecc97c5e3559566f1b503480a7a17f28be35003c86c30ee673",
      },
      {
        version: "0084",
        checksum_sha256:
          "030edbb703a3d7b11f806b16eb4d2fb4706ca426d6656e65fb323a17f9b57c59",
      },
      {
        version: "0085",
        checksum_sha256:
          "fec56172c0f62696c5d64443768f1c2c7d589c10719f9e7f0a417b0dff4f9b8e",
      },
      {
        version: "0086",
        checksum_sha256:
          "d19a8c57c0dcdf7b8795016935a81108acce80e621867dce5556662f0405ae3a",
      },
      {
        version: "0087",
        checksum_sha256:
          "f3f1f0a08b3c81f86e7b522c46d2a4335f18a88e8c7b18b207071d9c6d344e3d",
      },
      {
        version: "0088",
        checksum_sha256:
          "b70831ef15b3d8b557dd4409f4441d74ca66924cb3fa2bc38545696395309da5",
      },
      {
        version: "0089",
        checksum_sha256:
          "56ba4ccb9247786bae5162573f3662ce7328ffd365a7141c00a0a0d2fd31e8ec",
      },
      {
        version: "0090",
        checksum_sha256:
          "e5e20d9850eb2019cea569b890a017feadf5876b9a126916d1bd48fc35d2a4da",
      },
      {
        version: "0091",
        checksum_sha256:
          "f6bb365b9508fa6924a7ef5921ce8530279b1b4b7b834dddcb72b41d72dae052",
      },
      {
        version: "0092",
        checksum_sha256:
          "85b81d68705ed9058e167ebd34030a0449eae39461b48365fdcf8df7c05bf40e",
      },
      {
        version: "0093",
        checksum_sha256:
          "c2b66f185c988b1381510033abf231b252c8ebb15ab3ca274d09c576d1527a5b",
      },
      {
        version: "0094",
        checksum_sha256:
          "eb69f14ffb1051f5c513a7b7824c1acb1b498d67e6f836667eb796c4c9c49a6c",
      },
      {
        version: "0095",
        checksum_sha256:
          "1726be28655d7d0d4fba5723760a74b32c73da53ab8b6a8c4b62cbb271a01041",
      },
      {
        version: "0096",
        checksum_sha256:
          "bdde0198c79619b421803eb9bc1dec339c58cae636f677ed7401c4d8f97cfcba",
      },
      {
        version: "0097",
        checksum_sha256:
          "ddcb8de5857c9ada8d70da10f30d3b820163ad30e0b5578b3b89b1881e7cf820",
      },
      {
        version: "0098",
        checksum_sha256:
          "1ceb0fc0f89f084dc537857718bbb2553b444ce7bbd9bdd669c2b250c583596f",
      },
      {
        version: "0138",
        checksum_sha256:
          "b5cd0bcb42f94baaa6266ed43e0222a89af7c4bd2b84535d9e6949a5c7a0ad4b",
      },
    ]);
    const plans = await database.query(
      sql(
        "SELECT plan_version_id,included_billable_seats,maximum_billable_seats,maximum_nonbillable_viewers,additional_seat_enabled,additional_seat_monthly_price_micros FROM commercial_plan_seat_rules WHERE plan_version_id IN ($1,$2) ORDER BY included_billable_seats",
        [BETA_SHARING_PLAN_IDS.starter, BETA_SHARING_PLAN_IDS.pro],
      ),
    );
    expect(plans.rows).toEqual([
      {
        plan_version_id: BETA_SHARING_PLAN_IDS.starter,
        included_billable_seats: "3",
        maximum_billable_seats: "3",
        maximum_nonbillable_viewers: "3",
        additional_seat_enabled: false,
        additional_seat_monthly_price_micros: null,
      },
      {
        plan_version_id: BETA_SHARING_PLAN_IDS.pro,
        included_billable_seats: "10",
        maximum_billable_seats: "10",
        maximum_nonbillable_viewers: "10",
        additional_seat_enabled: false,
        additional_seat_monthly_price_micros: null,
      },
    ]);
    await expect(
      database.query(
        sql(
          "UPDATE commercial_plan_versions SET proposed_monthly_price_micros=0 WHERE plan_version_id=$1",
          [BETA_SHARING_PLAN_IDS.starter],
        ),
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });
  it("finds an issued upgrade only in its owning organization", async () => {
    const f = await fixture(BETA_CREDIT_PRO_PLAN_ID);
    const creditGrantId = id("grant");
    const policy = "cloudmarkup-paid-period-upgrade-allowance-v1";
    await f.commercial.createCreditGrant(
      { ...f.context, authority: "internal-accounting" },
      {
        chargingPolicyVersion: "cloudmarkup-charging-and-failure-v1",
        consumptionPriority: "100",
        creditGrantId,
        creditUnits: "800",
        expirationPolicy: {
          kind: "expires-at",
          policyVersion: policy,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        grantKind: "promotional",
        grantPolicyVersion: policy,
        idempotencyKey: id("upgrade"),
        ledgerEntryId: id("ledger"),
        planVersionId: BETA_SHARING_PLAN_IDS.starter,
        reasonCode: "billing.paid-period.upgrade-allowance",
        sourceReference: "synthetic:period:pro-upgrade",
        startsAt: new Date().toISOString(),
      },
    );
    const billing = new PostgresBillingPersistence(database);
    await expect(
      billing.hasUpgradeAllowance(f.organizationId, creditGrantId),
    ).resolves.toBe(true);
    await expect(
      billing.hasUpgradeAllowance(id("other_org"), creditGrantId),
    ).resolves.toBe(false);
    await expect(
      billing.hasUpgradeAllowance(f.organizationId, id("missing_grant")),
    ).resolves.toBe(false);
  });
  it("persists the new allowance without modifying historical Pro grants or price", async () => {
    const result = await database.query(
      sql(
        "SELECT plan.plan_version_id, plan.proposed_monthly_price_micros, allowance.credit_units FROM commercial_plan_versions plan JOIN commercial_plan_included_credit_grants allowance USING (plan_version_id) WHERE plan.plan_version_id IN ($1,$2) AND allowance.grant_kind='monthly' ORDER BY plan.version_number",
        [BETA_EXPORT_PRO_PLAN_ID, BETA_CREDIT_PRO_PLAN_ID],
      ),
    );
    expect(result.rows).toEqual([
      {
        plan_version_id: BETA_EXPORT_PRO_PLAN_ID,
        proposed_monthly_price_micros: "39000000",
        credit_units: "1000",
      },
      {
        plan_version_id: BETA_CREDIT_PRO_PLAN_ID,
        proposed_monthly_price_micros: "39000000",
        credit_units: "1250",
      },
    ]);
  });
  it.each([
    [BETA_SHARING_PLAN_IDS.starter, "3"],
    [BETA_SHARING_PLAN_IDS.pro, "10"],
    [BETA_EXPORT_PRO_PLAN_ID, "10"],
    [BETA_CREDIT_PRO_PLAN_ID, "10"],
  ])(
    "keeps %s provider quantity one, rejecting a per-member quantity",
    async (plan, quantity) => {
      const f = await fixture(plan);
      expect(
        (
          await database.query(
            sql(
              "SELECT billable_seat_quantity FROM organization_subscription_projections WHERE organization_id=$1",
              [f.organizationId],
            ),
          )
        ).rows[0]?.["billable_seat_quantity"],
      ).toBe("1");
      await expect(
        f.commercial.updateSubscriptionProjection(f.context, {
          subscriptionProjectionId: id("subscriptionprojection"),
          planVersionId: plan,
          billingProvider: "synthetic-local-provider",
          providerCustomerReference: id("customer"),
          providerSubscriptionReference: id("subscription"),
          billableSeatQuantity: quantity,
          cancelAtPeriodEnd: false,
          expectedRecordVersion: "0",
          normalizedStatus: "active",
          effectiveAt: new Date().toISOString(),
        }),
      ).rejects.toMatchObject({ code: "invalid-input" });
    },
  );
  it("preserves every historical plan, feature, limit, seat and grant configuration through0055", async () => {
    expect(await priorPlanConfiguration()).toEqual(preExportPlans);
    const rows = (
      await database.query(
        sql(
          "SELECT feature_key,entitlement_state FROM commercial_plan_feature_entitlements WHERE plan_version_id=$1 ORDER BY feature_key",
          [BETA_EXPORT_PRO_PLAN_ID],
        ),
      )
    ).rows;
    const prior = (
      await database.query(
        sql(
          "SELECT feature_key,entitlement_state FROM commercial_plan_feature_entitlements WHERE plan_version_id=$1 ORDER BY feature_key",
          [BETA_SHARING_PLAN_IDS.pro],
        ),
      )
    ).rows;
    expect(rows).toEqual(
      prior.map((row) =>
        row["feature_key"] === "cloudformation"
          ? { ...row, entitlement_state: "enabled" }
          : row,
      ),
    );
  });
  it.each([BETA_EXPORT_PRO_PLAN_ID, BETA_CREDIT_PRO_PLAN_ID])(
    "admits exactly one concurrent last %s member, counting an existing viewer and owner",
    async (plan) => {
      const f = await fixture(plan);
      for (let index = 0; index < 8; index++)
        await addMember(f.organizationId, await principal(), "viewer");
      const links = await Promise.all([invite(f), invite(f, "viewer")]);
      const people = await Promise.all([principal(), principal()]);
      const outcomes = await Promise.allSettled(
        links.map((link, index) => {
          const person = people[index];
          if (person === undefined)
            throw new Error("Missing acceptance principal.");
          return accept(person, link);
        }),
      );
      expect(
        outcomes.filter((entry) => entry.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        outcomes.filter((entry) => entry.status === "rejected"),
      ).toHaveLength(1);
      const rejected = outcomes.find((entry) => entry.status === "rejected");
      expect(
        rejected?.status === "rejected" ? rejected.reason : undefined,
      ).toMatchObject({
        code: "conflict",
        fieldIssues: [
          {
            code: "organization-membership.member-limit.v1",
            path: ["organization", "members"],
          },
        ],
      });
      expect(await count(f.organizationId)).toBe(10);
      expect(
        (
          await database.query(
            sql(
              "SELECT lifecycle_state FROM organization_invitations WHERE organization_id=$1 ORDER BY lifecycle_state",
              [f.organizationId],
            ),
          )
        ).rows,
      ).toEqual([
        { lifecycle_state: "accepted" },
        { lifecycle_state: "pending" },
      ]);
    },
  );

  it("admits exactly one concurrent last Starter member, counting an existing viewer and owner", async () => {
    const f = await fixture();
    await addMember(f.organizationId, await principal(), "viewer");
    const links = await Promise.all([invite(f), invite(f, "viewer")]);
    const people = await Promise.all([principal(), principal()]);
    const outcomes = await Promise.allSettled(
      links.map((link, index) => {
        const person = people[index];
        if (person === undefined)
          throw new Error("Missing acceptance principal.");
        return accept(person, link);
      }),
    );
    expect(
      outcomes.filter((entry) => entry.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((entry) => entry.status === "rejected"),
    ).toHaveLength(1);
    const rejected = outcomes.find((entry) => entry.status === "rejected");
    expect(
      rejected?.status === "rejected" ? rejected.reason : undefined,
    ).toMatchObject({
      code: "conflict",
      fieldIssues: [
        {
          code: "organization-membership.member-limit.v1",
          path: ["organization", "members"],
        },
      ],
    });
    expect(await count(f.organizationId)).toBe(3);
    expect(
      (
        await database.query(
          sql(
            "SELECT lifecycle_state FROM organization_invitations WHERE organization_id=$1 ORDER BY lifecycle_state",
            [f.organizationId],
          ),
        )
      ).rows,
    ).toEqual([
      { lifecycle_state: "accepted" },
      { lifecycle_state: "pending" },
    ]);
  });

  it("connects real HTTP create, explicit accept, fresh canonical membership and revoke without changing existing roles", async () => {
    const f = await fixture();
    const recipient = await principal();
    const outsider = await principal();
    const identity = new ProductionIdentityApplication(database, {
      organizationInvitations: true,
    });
    const application = new InMemoryCloudMarkupApplication({});
    application.getCurrentPrincipal = (actor) =>
      identity.getCurrentPrincipal(actor);
    const app = createApp({
      application,
      organizationInvitations:
        createProductionOrganizationInvitations(database),
      principalResolver: new FixedPrincipalResolver({
        "Bearer synthetic-owner": f.owner,
        "Bearer synthetic-recipient": recipient,
        "Bearer synthetic-outsider": outsider,
      }),
    });
    const token = randomBytes(32).toString("base64url");
    const path = `/v1/organizations/${f.organizationId}/invitations`;
    const headers = {
      authorization: "Bearer synthetic-owner",
      "content-type": "application/json",
      "idempotency-key": id("httpattempt"),
    };
    const created = await app.request(path, {
      method: "POST",
      headers,
      body: JSON.stringify({ contractVersion: 1, role: "editor", token }),
    });
    expect(created.status).toBe(201);
    const link = organizationInvitationResponseV1Schema.parse(
      await created.json(),
    ).data;
    const target = `/v1/organization-invitations/${link.id}/accept`;
    expect(
      (
        await app.request(target, {
          headers: { authorization: "Bearer synthetic-recipient" },
        })
      ).status,
    ).toBe(404);
    expect(await count(f.organizationId)).toBe(1);
    const joined = await app.request(target, {
      method: "POST",
      headers: { ...headers, authorization: "Bearer synthetic-recipient" },
      body: JSON.stringify({ contractVersion: 1, token }),
    });
    expect(joined.status).toBe(200);
    const receipt = acceptedOrganizationInvitationResponseV1Schema.parse(
      await joined.json(),
    ).data;
    const fresh = await app.request("/v1/me", {
      headers: { authorization: "Bearer synthetic-recipient" },
    });
    expect(fresh.status).toBe(200);
    const current = currentPrincipalResponseV1Schema.parse(
      await fresh.json(),
    ).data;
    expect(current.id).toBe(recipient.principalId);
    expect(current.organizationContexts).toContainEqual(
      expect.objectContaining({
        organizationId: f.organizationId,
        membershipId: receipt.membershipId,
        role: "editor",
      }),
    );
    expect(
      current.organizationContexts.find(
        (context) => context.membershipId === receipt.membershipId,
      )?.capabilities,
    ).toEqual(expect.arrayContaining(["projects.read", "projects.mutate"]));
    const other = await app.request(path, {
      method: "POST",
      headers: { ...headers, authorization: "Bearer synthetic-outsider" },
      body: JSON.stringify({
        contractVersion: 1,
        role: "viewer",
        token: randomBytes(32).toString("base64url"),
      }),
    });
    expect(other.status).toBe(404);
    const second = await invite(f, "viewer");
    const revoked = await app.request(`${path}/${second.invitation.id}`, {
      method: "DELETE",
      headers,
    });
    expect(revoked.status).toBe(200);
    expect(
      organizationInvitationResponseV1Schema.parse(await revoked.json()).data
        .status,
    ).toBe("revoked");
    await expect(accept(outsider, second)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await count(f.organizationId)).toBe(2);
    expect(
      (await identity.getCurrentPrincipal(f.owner)).organizationContexts,
    ).toContainEqual(
      expect.objectContaining({
        role: "owner",
        membershipId: f.ownerMembershipId,
      }),
    );
  });
  it("uses ten combined Pro places, not separate role pools, while pending links consume none", async () => {
    const f = await fixture(BETA_SHARING_PLAN_IDS.pro);
    for (let index = 0; index < 8; index++)
      await addMember(
        f.organizationId,
        await principal(),
        index % 2 === 0 ? "viewer" : "editor",
      );
    const links = await Promise.all([
      invite(f),
      invite(f),
      invite(f, "viewer"),
    ]);
    expect(await count(f.organizationId)).toBe(9);
    await accept(await principal(), links[0]);
    await expect(accept(await principal(), links[1])).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await count(f.organizationId)).toBe(10);
  });
  it("serializes invitations from different organizations at the recipient workspace limit", async () => {
    const person = await principal(),
      prefix = id("org_capacity");
    await database.query(
      sql(
        "INSERT INTO organizations(organization_id,display_name,slug) SELECT $1||'_'||i,'Synthetic capacity workspace',replace($1,'_','-')||'-'||i FROM generate_series(1,99) AS i",
        [prefix],
      ),
    );
    await database.query(
      sql(
        "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) SELECT organization_id,'viewer','authorization-v2',false,cloudmarkup_authorization_v2_permissions('viewer') FROM organizations WHERE organization_id LIKE $1",
        [prefix + "_%"],
      ),
    );
    await database.query(
      sql(
        "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) SELECT 'membership_'||organization_id,organization_id,$1,'viewer' FROM organizations WHERE organization_id LIKE $2",
        [person.principalId, prefix + "_%"],
      ),
    );
    const first = await fixture(),
      second = await fixture();
    const links = [await invite(first), await invite(second)];
    const outcomes = await Promise.allSettled(
      links.map((link) => accept(person, link)),
    );
    expect(
      outcomes.filter((value) => value.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((value) => value.status === "rejected"),
    ).toMatchObject([{ reason: { code: "conflict" } }]);
    for (const [index, outcome] of outcomes.entries()) {
      const link = links[index];
      if (!link) throw Error("Missing synthetic link");
      if (outcome.status === "fulfilled")
        expect(await accept(person, link)).toEqual(outcome.value);
      else {
        await expect(accept(person, link)).rejects.toMatchObject({
          code: "conflict",
        });
        const row = await database.query(
          sql(
            "SELECT lifecycle_state FROM organization_invitations WHERE invitation_id=$1",
            [link.invitation.id],
          ),
        );
        expect(row.rows[0]?.["lifecycle_state"]).toBe("pending");
      }
    }
    const contexts = await database.query(
      sql(
        "SELECT count(*) AS count FROM memberships WHERE principal_id=$1 AND lifecycle_status='active'",
        [person.principalId],
      ),
    );
    expect(Number(contexts.rows[0]?.["count"])).toBe(100);
  });
  it("accepts reciprocal invitations with stable principal lock ordering", async () => {
    const a = await fixture(),
      b = await fixture();
    const inviteA = await invite(a),
      inviteB = await invite(b);
    const bothAccounts = latch();
    let accounts = 0;
    const port = observeQueries(async (statement) => {
      if (
        statement.text.startsWith(
          "SELECT billing_account_id FROM organization_billing_accounts",
        )
      ) {
        accounts += 1;
        if (accounts === 2) bothAccounts.resolve();
        await awaitCheckpoint(bothAccounts.promise);
      }
    });
    const result = await Promise.all([
      application(port).accept(a.owner, inviteB.invitation.id, {
        contractVersion: 1,
        token: inviteB.token,
      }),
      application(port).accept(b.owner, inviteA.invitation.id, {
        contractVersion: 1,
        token: inviteA.token,
      }),
    ]);
    expect(result.map((value) => value.status)).toEqual([
      "accepted",
      "accepted",
    ]);
    expect(await count(a.organizationId)).toBe(2);
    expect(await count(b.organizationId)).toBe(2);
  }, 15000);
  it("keeps existing account-creation replay compatible with account-first seat admission", async () => {
    const f = await fixture();
    const link = await invite(f);
    const person = await principal();
    const accountId = (
      await database.query(
        sql(
          "SELECT billing_account_id FROM organization_billing_accounts WHERE organization_id=$1",
          [f.organizationId],
        ),
      )
    ).rows[0]?.["billing_account_id"];
    if (typeof accountId !== "string")
      throw new Error("Missing synthetic account.");
    const accountLocked = latch();
    const organizationLocked = latch();
    const continueAcceptance = latch();
    const admissionPort = observeQueries(async (statement) => {
      if (
        statement.text.startsWith(
          "SELECT billing_account_id FROM organization_billing_accounts",
        )
      ) {
        accountLocked.resolve();
        await continueAcceptance.promise;
      }
    });
    const creationPort = observeQueries((statement) => {
      if (
        statement.text.includes("SELECT 1 FROM organizations") &&
        statement.text.includes("FOR UPDATE")
      )
        organizationLocked.resolve();
      return Promise.resolve();
    });
    const accepting = application(admissionPort).accept(
      person,
      link.invitation.id,
      { contractVersion: 1, token: link.token },
    );
    void accepting.catch(() => undefined);
    await awaitCheckpoint(accountLocked.promise);
    const creating = new PostgresCommercialPersistenceRepository(
      creationPort,
    ).createBillingAccount(f.context, { billingAccountId: accountId });
    void creating.catch(() => undefined);
    try {
      await awaitCheckpoint(organizationLocked.promise);
    } finally {
      continueAcceptance.resolve();
    }
    const outcomes = await Promise.allSettled([accepting, creating]);
    expect(outcomes.map((entry) => entry.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
    expect(await count(f.organizationId)).toBe(2);
  }, 15000);
  it("allows one recipient per link and lost-response replay without a second membership or audit", async () => {
    const f = await fixture();
    const link = await invite(f);
    const people = await Promise.all([principal(), principal()]);
    const outcomes = await Promise.allSettled(
      people.map((person) => accept(person, link)),
    );
    const successful = outcomes.findIndex(
      (entry) => entry.status === "fulfilled",
    );
    expect(
      outcomes.filter((entry) => entry.status === "fulfilled"),
    ).toHaveLength(1);
    const first = outcomes[successful];
    const acceptedPrincipal = people[successful];
    if (acceptedPrincipal === undefined)
      throw new Error("Missing accepted principal.");
    expect(await accept(acceptedPrincipal, link)).toEqual(
      first?.status === "fulfilled" ? first.value : undefined,
    );
    expect(await count(f.organizationId)).toBe(2);
    expect(
      (
        await database.query(
          sql(
            "SELECT count(*) AS total FROM audit_events WHERE organization_id=$1 AND action='organization.invitation-accepted'",
            [f.organizationId],
          ),
        )
      ).rows[0]?.["total"],
    ).toBe("1");
  });
  it("preserves an existing active member's role, without promotion or another seat", async () => {
    const f = await fixture();
    const viewer = await principal();
    const membershipId = await addMember(f.organizationId, viewer, "viewer");
    const link = await invite(f, "administrator");
    await expect(accept(viewer, link)).resolves.toMatchObject({
      membershipId,
      role: "viewer",
    });
    expect(await count(f.organizationId)).toBe(2);
    expect(
      (
        await database.query(
          sql("SELECT role_key FROM memberships WHERE membership_id=$1", [
            f.ownerMembershipId,
          ]),
        )
      ).rows,
    ).toEqual([{ role_key: "owner" }]);
  });
  it.each(["suspended-member", "suspended-principal"])(
    "cannot reactivate a %s",
    async (kind) => {
      const f = await fixture();
      const person = await principal();
      if (kind === "suspended-member")
        await addMember(f.organizationId, person, "editor", "suspended");
      else
        await database.query(
          sql(
            "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
            [person.principalId],
          ),
        );
      const link = await invite(f);
      await expect(accept(person, link)).rejects.toMatchObject({
        code:
          kind === "suspended-member" ? "not_found" : "authentication_required",
      });
      expect(await count(f.organizationId)).toBe(1);
      expect(
        (
          await database.query(
            sql(
              "SELECT lifecycle_state FROM organization_invitations WHERE invitation_id=$1",
              [link.invitation.id],
            ),
          )
        ).rows,
      ).toEqual([{ lifecycle_state: "pending" }]);
    },
  );
  it.each(["editor", "suspended"])(
    "rechecks the original issuer after %s authority loss",
    async (change) => {
      const f = await fixture();
      const link = await invite(f, "administrator");
      if (change === "editor")
        await database.query(
          sql(
            "UPDATE memberships SET role_key='editor' WHERE membership_id=$1",
            [f.ownerMembershipId],
          ),
        );
      else
        await database.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
            [f.ownerMembershipId],
          ),
        );
      await expect(accept(await principal(), link)).rejects.toMatchObject({
        code: change === "editor" ? "access_denied" : "not_found",
      });
      expect(
        (
          await database.query(
            sql(
              "SELECT accepted_principal_id FROM organization_invitations WHERE invitation_id=$1",
              [link.invitation.id],
            ),
          )
        ).rows[0]?.["accepted_principal_id"],
      ).toBeNull();
    },
  );
  it("keeps administrator issuance below administrator and owner authority", async () => {
    const f = await fixture();
    const administrator = await principal();
    await addMember(f.organizationId, administrator, "administrator");
    await expect(
      invite(f, "administrator", administrator),
    ).rejects.toMatchObject({ code: "access_denied" });
    await expect(
      application().create(
        administrator,
        f.organizationId,
        {
          contractVersion: 1,
          role: "owner",
          token: randomBytes(32).toString("base64url"),
        },
        id("attempt"),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const link = await invite(f, "viewer", administrator);
    await expect(accept(await principal(), link)).resolves.toMatchObject({
      role: "viewer",
    });
  });
  it.each([null, legacyPlan])(
    "fails closed on a missing or historical sharing plan (%s)",
    async (plan) => {
      const f = await fixture(plan);
      await expect(invite(f)).rejects.toMatchObject({
        code: plan === null ? "not_found" : "access_denied",
      });
      expect(
        (
          await database.query(
            sql(
              "SELECT count(*) AS total FROM organization_invitations WHERE organization_id=$1",
              [f.organizationId],
            ),
          )
        ).rows[0]?.["total"],
      ).toBe("0");
    },
  );
  it("rejects a stale canonical snapshot instead of granting seats from it", async () => {
    const f = await fixture();
    const link = await invite(f);
    await database.query(
      sql(
        "UPDATE organization_subscription_projections SET record_version=record_version+1 WHERE organization_id=$1",
        [f.organizationId],
      ),
    );
    await expect(accept(await principal(), link)).rejects.toMatchObject({
      code: "access_denied",
    });
    expect(await count(f.organizationId)).toBe(1);
  });
  it("binds create replay to exact role/secret and never stores the raw invitation secret", async () => {
    const f = await fixture();
    const link = await invite(f);
    await expect(
      application().create(
        f.owner,
        f.organizationId,
        { contractVersion: 1, role: "editor", token: link.token },
        link.key,
      ),
    ).resolves.toEqual(link.invitation);
    await expect(
      application().create(
        f.owner,
        f.organizationId,
        { contractVersion: 1, role: "viewer", token: link.token },
        link.key,
      ),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    await expect(
      application().create(
        f.owner,
        f.organizationId,
        {
          contractVersion: 1,
          role: "editor",
          token: randomBytes(32).toString("base64url"),
        },
        link.key,
      ),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    const stored = await database.query(
      sql(
        "SELECT to_jsonb(i) AS row FROM organization_invitations i WHERE invitation_id=$1",
        [link.invitation.id],
      ),
    );
    expect(JSON.stringify(stored.rows)).not.toContain(link.token);
    expect(stored.rows[0]?.["row"]).toMatchObject({
      token_sha256: secretHash(link.token),
    });
    expect(
      JSON.stringify(
        (
          await database.query(
            sql(
              "SELECT to_jsonb(a) AS row FROM audit_events a WHERE organization_id=$1",
              [f.organizationId],
            ),
          )
        ).rows,
      ),
    ).not.toContain(link.token);
    await expect(
      database.query(
        sql(
          "UPDATE organization_invitations SET token_sha256=$2 WHERE invitation_id=$1",
          [link.invitation.id, "d".repeat(64)],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("hides wrong-token and cross-tenant revoke, and revoked links cannot add members", async () => {
    const f = await fixture();
    const other = await fixture();
    const link = await invite(f);
    await expect(
      application().accept(await principal(), link.invitation.id, {
        contractVersion: 1,
        token: randomBytes(32).toString("base64url"),
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      application().revoke(
        other.owner,
        other.organizationId,
        link.invitation.id,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      application().revoke(f.owner, f.organizationId, link.invitation.id),
    ).resolves.toMatchObject({ status: "revoked" });
    await expect(
      application().revoke(f.owner, f.organizationId, link.invitation.id),
    ).resolves.toMatchObject({ status: "revoked" });
    await expect(accept(await principal(), link)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await count(f.organizationId)).toBe(1);
  });
  it("rolls back both new membership and invitation acceptance if the audit write fails", async () => {
    const f = await fixture();
    const link = await invite(f);
    const person = await principal();
    const failing: SqlDatabase = {
      close: () => Promise.resolve(),
      query: <T extends SqlRow = SqlRow>(
        statement: SqlStatement,
      ): Promise<SqlResult<T>> => database.query<T>(statement),
      transaction: <T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> =>
        database.transaction((tx) =>
          work({
            query: <R extends SqlRow = SqlRow>(
              statement: SqlStatement,
            ): Promise<SqlResult<R>> =>
              statement.text.includes("INSERT INTO audit_events")
                ? Promise.reject(new Error("Synthetic audit failure."))
                : tx.query<R>(statement),
          }),
        ),
    };
    await expect(
      application(failing).accept(person, link.invitation.id, {
        contractVersion: 1,
        token: link.token,
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(await count(f.organizationId)).toBe(1);
    expect(
      (
        await database.query(
          sql(
            "SELECT lifecycle_state,accepted_principal_id FROM organization_invitations WHERE invitation_id=$1",
            [link.invitation.id],
          ),
        )
      ).rows,
    ).toEqual([{ lifecycle_state: "pending", accepted_principal_id: null }]);
    await expect(accept(person, link)).resolves.toMatchObject({
      status: "accepted",
    });
  });
  it("denies an expired pending invitation without reactivating or exposing membership", async () => {
    const f = await fixture();
    const token = randomBytes(32).toString("base64url");
    const invitationId = id("invitation");
    await database.query(
      sql(
        `WITH instant AS (SELECT clock_timestamp() AS at)
      INSERT INTO organization_invitations(invitation_id,organization_id,issuer_principal_id,issuer_membership_id,target_role,token_sha256,request_sha256,idempotency_key_sha256,created_at,expires_at)
      SELECT $1,$2,$3,$4,'editor',$5,$6,$7,at-INTERVAL '2 days',at-INTERVAL '1 day' FROM instant`,
        [
          invitationId,
          f.organizationId,
          f.owner.principalId,
          f.ownerMembershipId,
          secretHash(token),
          createHash("sha256").update(id("request")).digest("hex"),
          createHash("sha256").update(id("key")).digest("hex"),
        ],
      ),
    );
    await expect(
      application().accept(await principal(), invitationId, {
        contractVersion: 1,
        token,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await count(f.organizationId)).toBe(1);
  });
  it("deferred final authority rejects expiry after every adapter query but before commit", async () => {
    const f = await fixture();
    const link = await invite(f);
    const person = {
      ...(await principal()),
      expiresAt: new Date(Date.now() + 5000).toISOString(),
    };
    let adapterCompleted = false;
    const delayedCommit: SqlDatabase = {
      close: () => Promise.resolve(),
      query: <T extends SqlRow = SqlRow>(
        statement: SqlStatement,
      ): Promise<SqlResult<T>> => database.query<T>(statement),
      transaction: <T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> =>
        database.transaction(async (tx) => {
          const value = await work(tx);
          adapterCompleted = true;
          // Real server clock only: move COMMIT past the original authenticated ceiling.
          await tx.query(
            sql(
              "SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.02)",
              [person.expiresAt],
            ),
          );
          return value;
        }),
    };
    await expect(
      application(delayedCommit).accept(person, link.invitation.id, {
        contractVersion: 1,
        token: link.token,
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(adapterCompleted).toBe(true);
    expect(await count(f.organizationId)).toBe(1);
    expect(
      (
        await database.query(
          sql(
            "SELECT lifecycle_state,accepted_principal_id FROM organization_invitations WHERE invitation_id=$1",
            [link.invitation.id],
          ),
        )
      ).rows,
    ).toEqual([{ lifecycle_state: "pending", accepted_principal_id: null }]);
    expect(
      (
        await database.query(
          sql(
            "SELECT count(*) AS total FROM audit_events WHERE organization_id=$1 AND action='organization.invitation-accepted'",
            [f.organizationId],
          ),
        )
      ).rows[0]?.["total"],
    ).toBe("0");
  }, 15000);
});
