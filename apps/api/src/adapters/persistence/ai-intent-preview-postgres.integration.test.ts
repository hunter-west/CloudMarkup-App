import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  digestStructuredValue,
  type ModelCommercialInvocationContextV1,
} from "@cloudmarkup/model-gateway";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AiIntentPreviewError,
  type AiIntentPreviewDeliveryProofV1,
} from "../../application/ai-intent-preview-journal.js";
import { aiPreviewFixture } from "./ai-intent-preview-test-helpers.js";
import { PostgresAiIntentPreviewJournal } from "./ai-intent-preview.js";
import { PostgresModelCommercialWorkflowStore } from "./model-commercial-workflow-store.js";
import { commercialHarness } from "./model-commercial-workflow-test-helpers.js";
import { PostgresIntentRuntimeHostEvidence } from "./model-runtime-host-evidence.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { sql, type SqlDatabase } from "./sql.js";

const configuredUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integrationDescribe =
  configuredUrl === undefined || configuredUrl === ""
    ? describe.skip
    : describe;
const runId = randomUUID().replaceAll("-", "");
const schemaName = "cm_ai_preview_it_" + runId;
const schemaMarker = "CloudMarkup synthetic AI preview " + runId;
const id = (prefix: string) => prefix + "_" + randomUUID().replaceAll("-", "");
function loopbackUrl() {
  if (configuredUrl === undefined || configuredUrl === "")
    throw new Error("Explicit synthetic PostgreSQL URL required.");
  const parsed = new URL(configuredUrl);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(parsed.pathname)
  )
    throw new Error(
      "Only explicit loopback PostgreSQL without overrides is allowed.",
    );
  return configuredUrl;
}

integrationDescribe(
  "metadata-only AI preview journal on real PostgreSQL",
  () => {
    let administration: PostgresDatabase | undefined;
    let database: PostgresDatabase;
    let opened: PostgresDatabase | undefined;
    let createdSchema = false;
    beforeAll(async () => {
      const connectionString = loopbackUrl();
      if (!/^cm_ai_preview_it_[a-f0-9]{32}$/u.test(schemaName))
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
        max: 5,
        connectionTimeoutMillis: 5000,
        options: `-c search_path=${schemaName} -c timezone=UTC -c statement_timeout=5000`,
      });
      opened = database;
      const migrations = await loadHistoricalBetaMigrations(
        fileURLToPath(new URL("../../../migrations", import.meta.url)),
      );
      await runMigrations(database, migrations);
      await runMigrations(database, migrations);
    }, 60000);
    afterAll(async () => {
      try {
        await opened?.close();
        if (createdSchema && administration !== undefined) {
          const found = await administration.query(
            sql(
              "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
              [schemaName],
            ),
          );
          if (
            found.rows[0]?.["marker"] !== schemaMarker ||
            !/^cm_ai_preview_it_[a-f0-9]{32}$/u.test(schemaName)
          )
            throw new Error("Refusing to remove unverified synthetic schema.");
          await administration.transaction(async (tx) => {
            await tx.query(sql(`DROP SCHEMA "${schemaName}" CASCADE`));
          });
        }
      } finally {
        await administration?.close();
      }
    }, 30000);
    async function fixture() {
      const scope = {
        organizationId: id("org"),
        projectId: id("project"),
        userId: id("principal"),
        jobId: id("job"),
      };
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES ($1,'Synthetic preview')",
            [scope.userId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organizations(organization_id,display_name,slug) VALUES ($1,'Synthetic preview',$2)",
            [scope.organizationId, scope.organizationId.replaceAll("_", "-")],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES ($1,'owner','authorization-v2',TRUE,cloudmarkup_authorization_v2_permissions('owner'))",
            [scope.organizationId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES ($1,$2,$3,'owner')",
            [id("membership"), scope.organizationId, scope.userId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO projects(project_id,organization_id,name,created_by_principal_id) VALUES ($1,$2,'Synthetic preview',$3)",
            [scope.projectId, scope.organizationId, scope.userId],
          ),
        );
      });
      const f = aiPreviewFixture(scope, new Date().toISOString());
      const unexpectedErrors: unknown[] = [];
      const observed: SqlDatabase = {
        close: () => Promise.resolve(),
        query: database.query.bind(database),
        transaction: (work) =>
          database.transaction(async (tx) => {
            try {
              return await work(tx);
            } catch (error) {
              unexpectedErrors.push(error);
              throw error;
            }
          }),
      };
      const journal = new PostgresAiIntentPreviewJournal({
        database: observed,
        binding: f.binding,
      });
      const workflows = new PostgresModelCommercialWorkflowStore({
        database,
        scope: f.tenant,
      });
      const h = commercialHarness(
        workflows,
        f.request,
        () => new Date().toISOString(),
        { route: f.route, invocationRecovery: journal },
      );
      const evidence = new PostgresIntentRuntimeHostEvidence({
        database,
        scope,
      });
      async function generate(callback: ModelCommercialInvocationContextV1) {
        await journal.prepare(callback);
        expect(await journal.claim(f.claim)).toEqual({ kind: "claimed" });
        await journal.record(f.result.usage);
        await journal.complete(f.claim, f.result);
      }
      async function delivery(callback: ModelCommercialInvocationContextV1) {
        await generate(callback);
        await evidence.issueInput(f.invocation);
        const output = await evidence.issueOutput(f.outputInput);
        return journal.prepareDelivery(output);
      }
      return {
        ...f,
        ...h,
        journal,
        workflows,
        evidence,
        generate,
        delivery,
        unexpectedErrors,
      };
    }
    it("acknowledges one generated result and retains only immutable metadata across restart", async () => {
      const f = await fixture();
      let proof: AiIntentPreviewDeliveryProofV1 | undefined;
      const invoke = vi.fn(
        async (callback: ModelCommercialInvocationContextV1) => {
          proof = await f.delivery(callback);
          await f.journal.acknowledge(proof);
          await f.journal.acknowledge(proof);
          const outcome = await f.journal.deliveryOutcome();
          if (outcome.kind !== "terminal")
            throw new Error("Missing terminal synthetic delivery.");
          return outcome.commercial;
        },
      );
      const result = await f.coordinator.execute(f.request, invoke);
      expect(f.unexpectedErrors).toEqual([]);
      await expect(invoke.mock.results[0]?.value).resolves.toMatchObject({
        status: "completed",
      });
      expect(result.state).toBe("completed");
      expect(result.completedCreditUnits).toBeGreaterThan(0);
      expect(await f.coordinator.recover(f.request)).toEqual(result);
      expect(f.accounting.reserveCalls).toBe(1);
      expect(invoke).toHaveBeenCalledTimes(1);
      const restarted = new PostgresAiIntentPreviewJournal({
        database,
        binding: f.binding,
      });
      expect(await restarted.claim(f.claim)).toEqual({
        kind: "duplicate-result-unavailable",
      });
      const stored = await database.query(
        sql(
          "SELECT row_to_json(p)::text AS metadata,EXTRACT(EPOCH FROM delivery_expires_at-delivery_opened_at)::integer AS window FROM ai_intent_previews p WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      const metadata = String(stored.rows[0]?.["metadata"]);
      expect(stored.rows[0]?.["window"]).toBe(30);
      expect(metadata).not.toContain(f.modelRequest.source.content);
      expect(metadata).not.toContain(JSON.stringify(f.result.response));
      expect(proof).toBeDefined();
      expect(metadata).not.toContain(proof?.token);
      expect(Buffer.byteLength(metadata)).toBeLessThan(65536);
      await expect(
        database.query(
          sql(
            "UPDATE ai_intent_previews SET delivery_state='unconfirmed' WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          sql("DELETE FROM ai_intent_previews WHERE organization_id=$1", [
            f.scope.organizationId,
          ]),
        ),
      ).rejects.toThrow();
    });
    it.each([true, false])(
      "recovers after lost callback without redispatch; acknowledged=%s",
      async (acknowledged) => {
        const f = await fixture();
        let proof: AiIntentPreviewDeliveryProofV1 | undefined;
        const invoke = vi.fn(
          async (callback: ModelCommercialInvocationContextV1) => {
            proof = await f.delivery(callback);
            throw new Error(
              "Synthetic callback disconnected; no content retained.",
            );
          },
        );
        await expect(
          f.coordinator.execute(f.request, invoke),
        ).rejects.toMatchObject({
          code: "dependency-failure",
        });
        await expect(invoke.mock.results[0]?.value).rejects.toThrow(
          "Synthetic callback disconnected; no content retained.",
        );
        expect(await f.journal.deliveryOutcome()).toEqual({ kind: "pending" });
        await expect(f.coordinator.recover(f.request)).rejects.toMatchObject({
          code: "dependency-failure",
        });
        if (proof === undefined) throw new Error("Missing synthetic proof.");
        const restarted = new PostgresAiIntentPreviewJournal({
          database,
          binding: f.binding,
        });
        if (acknowledged) await restarted.acknowledge(proof);
        else await restarted.closeDelivery();
        const recovered = await f.coordinator.recover(f.request);
        expect(recovered.state).toBe(
          acknowledged ? "completed" : "compensated",
        );
        if (acknowledged)
          expect(recovered.completedCreditUnits).toBeGreaterThan(0);
        else expect(recovered.completedCreditUnits).toBe(0);
        expect(await f.coordinator.recover(f.request)).toEqual(recovered);
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(f.accounting.reserveCalls).toBe(1);
        expect(await restarted.claim(f.claim)).toEqual({
          kind: "duplicate-result-unavailable",
        });
      },
    );
    it("retains unknown usage for reconciliation and never creates a replacement invocation", async () => {
      const f = await fixture();
      const invoke = vi.fn(
        async (callback: ModelCommercialInvocationContextV1) => {
          await f.journal.prepare(callback);
          expect(await f.journal.claim(f.claim)).toEqual({ kind: "claimed" });
          await f.journal.fail(
            f.claim,
            "Do not persist this arbitrary error text",
          );
          throw new Error("Synthetic transport uncertainty.");
        },
      );
      const result = await f.coordinator.execute(f.request, invoke);
      expect(result.state).toBe("reconciliation-required");
      await expect(invoke.mock.results[0]?.value).rejects.toThrow(
        "Synthetic transport uncertainty.",
      );
      expect(result.completedCreditUnits).toBeNull();
      expect(await f.journal.deliveryOutcome()).toEqual({
        kind: "unavailable",
      });
      expect(await f.journal.claim(f.claim)).toEqual({
        kind: "duplicate-result-unavailable",
      });
      expect((await f.coordinator.recover(f.request)).state).toBe(
        "reconciliation-required",
      );
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(f.accounting.reserveCalls).toBe(1);
    });
    it("serializes claims and refuses substituted claim authority and usage", async () => {
      const f = await fixture();
      let reachedTerminal = false;
      const settled = await f.coordinator.execute(
        f.request,
        async (callback) => {
          await f.journal.prepare(callback);
          const claims = await Promise.all(
            Array.from({ length: 5 }, () => f.journal.claim(f.claim)),
          );
          expect(
            claims.filter((claim) => claim.kind === "claimed"),
          ).toHaveLength(1);
          expect(
            claims.filter((claim) => claim.kind === "duplicate-in-progress"),
          ).toHaveLength(4);
          expect(
            await f.journal.claim({
              ...f.claim,
              authorityDigest: digestStructuredValue("substituted"),
            }),
          ).toEqual({ kind: "conflict" });
          await expect(
            f.journal.record({
              ...f.result.usage,
              inputDigest: digestStructuredValue("substituted"),
            }),
          ).rejects.toBeInstanceOf(AiIntentPreviewError);
          await f.journal.record(f.result.usage);
          await f.journal.complete(f.claim, f.result);
          await f.journal.closeDelivery();
          const outcome = await f.journal.deliveryOutcome();
          if (outcome.kind !== "terminal")
            throw new Error("Missing synthetic outcome.");
          reachedTerminal = true;
          return outcome.commercial;
        },
      );
      expect(reachedTerminal).toBe(true);
      expect(settled.state).toBe("compensated");
    });
    it("rejects forged delivery proof and current membership revocation without modifying delivery", async () => {
      const f = await fixture();
      let reachedTerminal = false;
      const settled = await f.coordinator.execute(
        f.request,
        async (callback) => {
          const proof = await f.delivery(callback);
          await expect(
            f.journal.acknowledge({ ...proof, token: "B".repeat(42) + "A" }),
          ).rejects.toBeInstanceOf(AiIntentPreviewError);
          await expect(
            f.journal.acknowledge({
              ...proof,
              outputDigest: digestStructuredValue("other output"),
            }),
          ).rejects.toBeInstanceOf(AiIntentPreviewError);
          await database.query(
            sql(
              "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
              [f.scope.organizationId, f.scope.userId],
            ),
          );
          await expect(f.journal.acknowledge(proof)).rejects.toBeInstanceOf(
            AiIntentPreviewError,
          );
          await database.query(
            sql(
              "UPDATE memberships SET lifecycle_status='active' WHERE organization_id=$1 AND principal_id=$2",
              [f.scope.organizationId, f.scope.userId],
            ),
          );
          expect(await f.journal.deliveryOutcome()).toEqual({
            kind: "pending",
          });
          await f.journal.closeDelivery();
          await expect(f.journal.acknowledge(proof)).rejects.toBeInstanceOf(
            AiIntentPreviewError,
          );
          const outcome = await f.journal.deliveryOutcome();
          if (outcome.kind !== "terminal")
            throw new Error("Missing synthetic outcome.");
          reachedTerminal = true;
          return outcome.commercial;
        },
      );
      expect(reachedTerminal).toBe(true);
      expect(settled.state).toBe("compensated");
    });
    it("cannot bootstrap authority or cross a tenant boundary from a syntactically valid binding", async () => {
      const first = await fixture();
      const second = await fixture();
      expect(await first.journal.deliveryOutcome()).toEqual({
        kind: "unavailable",
      });
      await expect(first.journal.claim(first.claim)).rejects.toBeInstanceOf(
        AiIntentPreviewError,
      );
      const forged = new PostgresAiIntentPreviewJournal({
        database,
        binding: {
          ...first.binding,
          scope: { ...first.scope, userId: second.scope.userId },
          request: { ...first.request, userId: second.scope.userId },
        },
      });
      await expect(forged.deliveryOutcome()).rejects.toBeInstanceOf(
        AiIntentPreviewError,
      );
      const rows = await database.query(
        sql(
          "SELECT count(*)::integer AS count FROM ai_intent_previews WHERE organization_id IN ($1,$2)",
          [first.scope.organizationId, second.scope.organizationId],
        ),
      );
      expect(rows.rows[0]?.["count"]).toBe(0);
    });
  },
);
