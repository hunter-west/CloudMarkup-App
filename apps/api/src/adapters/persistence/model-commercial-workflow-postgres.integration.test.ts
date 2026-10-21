import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  digestStructuredValue,
  type ModelCommercialWorkflowStore,
} from "@cloudmarkup/model-gateway";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ModelCommercialWorkflowPersistenceError } from "./model-commercial-workflow-codec.js";
import { PostgresModelCommercialWorkflowStore } from "./model-commercial-workflow-store.js";
import {
  commercialClaim,
  commercialHarness,
  commercialInvocation,
  commercialRequest,
  commercialScope,
} from "./model-commercial-workflow-test-helpers.js";
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
const schemaName = "cm_commercial_workflow_it_" + runId;
const schemaMarker = "CloudMarkup synthetic commercial workflow " + runId;
const id = (prefix: string) => prefix + "_" + randomUUID().replaceAll("-", "");
function loopbackUrl(): string {
  if (configuredUrl === undefined || configuredUrl === "")
    throw new Error("Explicit loopback PostgreSQL URL required.");
  const parsed = new URL(configuredUrl);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(parsed.pathname)
  )
    throw new Error(
      "Commercial workflow tests require an explicit loopback database without overrides.",
    );
  return configuredUrl;
}
integrationDescribe(
  "commercial workflow store on isolated loopback PostgreSQL",
  () => {
    let administration: PostgresDatabase | undefined;
    let database: PostgresDatabase;
    let opened: PostgresDatabase | undefined;
    let createdSchema = false;
    beforeAll(async () => {
      const connectionString = loopbackUrl();
      if (!/^cm_commercial_workflow_it_[a-f0-9]{32}$/u.test(schemaName))
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
            !/^cm_commercial_workflow_it_[a-f0-9]{32}$/u.test(schemaName)
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
      const scope = commercialScope(id("org"), id("project"), id("principal"));
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES ($1,'Synthetic commercial workflow')",
            [scope.userId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organizations(organization_id,display_name,slug) VALUES ($1,'Synthetic commercial workflow',$2)",
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
            "INSERT INTO projects(project_id,organization_id,name,created_by_principal_id) VALUES ($1,$2,'Synthetic commercial workflow',$3)",
            [scope.projectId, scope.organizationId, scope.userId],
          ),
        );
      });
      const request = commercialRequest(scope, new Date().toISOString());
      const store = new PostgresModelCommercialWorkflowStore({
        database,
        scope,
      });
      return { scope, request, store };
    }
    it("evaluates the exact migration request-shape constraint without coercing the key literal to JSONB", async () => {
      const source = await readFile(
        new URL(
          "../../../migrations/0022_model_commercial_workflows.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const constraint =
        /CHECK \((jsonb_typeof\(snapshot->'request'\)[\s\S]+?)\),\r?\n {2}CHECK \(\(/u.exec(
          source,
        )?.[1];
      if (constraint === undefined)
        throw new Error("Missing exact commercial request-shape constraint.");
      const request = commercialRequest();
      const { userId: omittedUser, ...missingUser } = request;
      expect(omittedUser).toBeDefined();
      for (const [candidate, accepted] of [
        [request, true],
        [{ ...request, rawPrompt: "Synthetic disallowed field" }, false],
        [missingUser, false],
        [null, false],
        [[], false],
        ["request", false],
      ] as const) {
        const found = await database.query(
          sql(
            `SELECT (${constraint}) AS accepted FROM (SELECT $1::jsonb AS snapshot) AS candidate`,
            [JSON.stringify({ request: candidate })],
          ),
        );
        expect(found.rows[0]?.["accepted"]).toBe(accepted);
      }
    });
    it("serializes six claims, persists real coordinator settlement, and replays without new effects", async () => {
      const f = await fixture();
      const outcomes = await Promise.all(
        Array.from({ length: 6 }, () =>
          f.store.claimExecution(commercialClaim(f.request)),
        ),
      );
      expect(
        outcomes.filter((value) => value.kind === "acquired"),
      ).toHaveLength(1);
      expect(
        outcomes.filter((value) => value.kind === "in-progress"),
      ).toHaveLength(5);
      const first = outcomes.find((value) => value.kind === "acquired");
      if (first?.kind !== "acquired")
        throw new Error("Missing synthetic lease.");
      await f.store.releaseExecution({
        lease: first.lease,
        multiCallWorkflowId: f.request.multiCallWorkflowId,
        tenantScopeDigest: f.scope.tenantScopeDigest,
      });
      const h = commercialHarness(f.store, f.request);
      const invoke = vi.fn().mockResolvedValue(commercialInvocation(f.request));
      const completed = await h.coordinator.execute(f.request, invoke);
      expect(completed.state).toBe("completed");
      const restarted = new PostgresModelCommercialWorkflowStore({
        database,
        scope: f.scope,
      });
      expect(
        await restarted.claimExecution(commercialClaim(f.request)),
      ).toEqual({ kind: "terminal", response: completed });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(h.accounting.reserveCalls).toBe(1);
      const revisions = await database.query(
        sql(
          "SELECT revision,snapshot FROM model_commercial_workflow_revisions WHERE organization_id=$1 ORDER BY revision",
          [f.scope.organizationId],
        ),
      );
      expect(revisions.rows.length).toBeGreaterThan(5);
      expect(revisions.rows.map((row) => Number(row["revision"]))).toEqual(
        Array.from({ length: revisions.rows.length }, (_, index) => index),
      );
    });
    it("never creates rows for recovery-only and enforces database tenant ownership", async () => {
      const f = await fixture();
      expect(
        await f.store.claimExecution({
          ...commercialClaim(f.request),
          recoveryOnly: true,
        }),
      ).toEqual({ kind: "missing" });
      const other = await fixture();
      const forgedScope = commercialScope(
        f.scope.organizationId,
        other.scope.projectId,
        f.scope.userId,
      );
      const forgedStore = new PostgresModelCommercialWorkflowStore({
        database,
        scope: forgedScope,
      });
      await expect(
        forgedStore.claimExecution(
          commercialClaim(
            commercialRequest(forgedScope, f.request.requestedAt),
          ),
        ),
      ).rejects.toThrow(ModelCommercialWorkflowPersistenceError);
      expect(
        (
          await database.query(
            sql(
              "SELECT workflow_id FROM model_commercial_workflows WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(0);
    });
    it("uses database expiry and monotonic fencing across takeover; stale release cannot clear the new owner", async () => {
      const f = await fixture();
      const now = new Date().toISOString();
      const first = await f.store.claimExecution({
        ...commercialClaim(f.request, now),
        leaseExpiresAt: new Date(Date.parse(now) + 500).toISOString(),
      });
      if (first.kind !== "acquired")
        throw new Error("Missing synthetic lease.");
      await database.query(sql("SELECT pg_sleep(0.65)"));
      const second = await f.store.claimExecution(
        commercialClaim(f.request, new Date().toISOString()),
      );
      if (second.kind !== "acquired")
        throw new Error("Missing takeover lease.");
      expect(second.lease.fencingToken).toBe("2");
      await expect(
        f.store.compareAndSet({
          expectedRevision: 0,
          lease: first.lease,
          record: first.record,
          tenantScopeDigest: f.scope.tenantScopeDigest,
          trustedNow: now,
        }),
      ).rejects.toThrow(ModelCommercialWorkflowPersistenceError);
      await f.store.releaseExecution({
        lease: first.lease,
        multiCallWorkflowId: f.request.multiCallWorkflowId,
        tenantScopeDigest: f.scope.tenantScopeDigest,
      });
      expect(
        (
          await f.store.claimExecution(
            commercialClaim(f.request, new Date().toISOString()),
          )
        ).kind,
      ).toBe("in-progress");
    });
    it("turns concurrent cross-scope reservation collisions into bounded outcomes, never duplicate effects", async () => {
      const f = await fixture();
      const userId = id("principal");
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES ($1,'Synthetic second member')",
            [userId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES ($1,$2,$3,'owner')",
            [id("membership"), f.scope.organizationId, userId],
          ),
        );
      });
      const scope = commercialScope(
        f.scope.organizationId,
        f.scope.projectId,
        userId,
      );
      const other = new PostgresModelCommercialWorkflowStore({
        database,
        scope,
      });
      const outcomes = await Promise.allSettled([
        f.store.claimExecution(commercialClaim(f.request)),
        other.claimExecution(
          commercialClaim(commercialRequest(scope, f.request.requestedAt)),
        ),
      ]);
      expect(
        outcomes.filter(
          (value) =>
            value.status === "fulfilled" && value.value.kind === "acquired",
        ),
      ).toHaveLength(1);
      for (const outcome of outcomes) {
        if (outcome.status === "rejected")
          expect(outcome.reason).toBeInstanceOf(
            ModelCommercialWorkflowPersistenceError,
          );
        else expect(["acquired", "conflict"]).toContain(outcome.value.kind);
      }
      expect(
        (
          await database.query(
            sql(
              "SELECT workflow_id FROM model_commercial_workflows WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(1);
    });
    it("retains dispatch through a crashed receipt save and never invokes again during recovery", async () => {
      const f = await fixture();
      let failReceipt = true;
      const wrapper: ModelCommercialWorkflowStore = {
        claimExecution: (input) => f.store.claimExecution(input),
        releaseExecution: (input) => f.store.releaseExecution(input),
        compareAndSet: (input) => {
          if (failReceipt && input.record.invocationReceipt !== null) {
            failReceipt = false;
            return Promise.reject(
              new Error("Synthetic crash before receipt commit."),
            );
          }
          return f.store.compareAndSet(input);
        },
      };
      const h = commercialHarness(wrapper, f.request);
      const invoke = vi.fn().mockResolvedValue(commercialInvocation(f.request));
      await expect(
        h.coordinator.execute(f.request, invoke),
      ).rejects.toMatchObject({ code: "dependency-failure" });
      expect((await h.coordinator.recover(f.request)).state).toBe(
        "reconciliation-required",
      );
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(h.accounting.reserveCalls).toBe(1);
      await expect(
        database.query(
          sql(
            "UPDATE model_commercial_workflows SET snapshot=jsonb_set(snapshot,'{dispatchIntent}','null'::jsonb),revision=revision+1 WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        ),
      ).rejects.toThrow();
    });
    it("rejects fabricated history insertion, history mutation, and terminal workflow deletion", async () => {
      const f = await fixture();
      const h = commercialHarness(f.store, f.request);
      await h.coordinator.execute(
        f.request,
        vi.fn().mockResolvedValue(commercialInvocation(f.request)),
      );
      await expect(
        database.query(
          sql(
            "INSERT INTO model_commercial_workflow_revisions(organization_id,scope_sha256,workflow_id,revision,fence,snapshot,snapshot_sha256) SELECT organization_id,scope_sha256,workflow_id,revision+100,fence,snapshot,snapshot_sha256 FROM model_commercial_workflows WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          sql(
            "UPDATE model_commercial_workflow_revisions SET snapshot_sha256=$2 WHERE organization_id=$1",
            [f.scope.organizationId, digestStructuredValue("forged").slice(7)],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          sql(
            "DELETE FROM model_commercial_workflows WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        ),
      ).rejects.toThrow();
      expect(
        (await f.store.claimExecution(commercialClaim(f.request))).kind,
      ).toBe("terminal");
    });
  },
);
