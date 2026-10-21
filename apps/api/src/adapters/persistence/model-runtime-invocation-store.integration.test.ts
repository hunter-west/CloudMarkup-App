import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  digestBytes,
  hex,
  ModelRuntimePersistenceError,
  parseClaim,
  parseScope,
  type ModelInvocationScope,
  type ModelResultObjectReference,
} from "./model-runtime-invocation-codec.js";
import {
  PostgresModelInvocationStore,
  type ModelRuntimeResultObjectPort,
} from "./model-runtime-invocation-store.js";
import {
  escalationFixture,
  invocationFixture,
} from "./model-runtime-invocation-test-helpers.js";
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
const schemaName = `cm_model_invocation_it_${runId}`;
const schemaMarker = `CloudMarkup synthetic model invocation integration ${runId}`;
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
      "Model invocation integration accepts only an explicit loopback database without query or fragment overrides.",
    );
  return configuredUrl;
}

/** Only object bodies are synthetic. All metadata, FKs, advisory locks,
 * uniqueness, triggers and terminal concurrency execute in real PostgreSQL. */
class IntegrationObjects implements ModelRuntimeResultObjectPort {
  readonly bodies = new Map<string, Uint8Array>();
  readonly #database: PostgresDatabase;
  readonly #scope: ModelInvocationScope;
  puts = 0;
  constructor(database: PostgresDatabase, scope: ModelInvocationScope) {
    this.#database = database;
    this.#scope = scope;
  }
  async put(
    input: Parameters<ModelRuntimeResultObjectPort["put"]>[0],
  ): Promise<ModelResultObjectReference> {
    expect(input.scope).toEqual(this.#scope);
    expect(digestBytes(input.bytes)).toBe(input.digest);
    this.puts += 1;
    const objectId = id("object");
    await this.#database.query(
      sql(
        `INSERT INTO stored_objects(object_id,organization_id,project_id,storage_provider,object_purpose,storage_key,object_version,content_sha256,size_bytes,media_type,lifecycle_state,created_by_principal_id,created_at,published_at)
       VALUES ($1,$2,$3,'memory','report',$4,'1',$5,$6,'application/json','published',$7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        [
          objectId,
          this.#scope.organizationId,
          this.#scope.projectId ?? null,
          `${schemaName}/${objectId}`,
          hex(input.digest),
          input.bytes.byteLength,
          this.#scope.userId,
        ],
      ),
    );
    this.bodies.set(objectId, input.bytes.slice());
    return {
      objectId,
      digest: input.digest,
      sizeBytes: input.bytes.byteLength,
    };
  }
  async get(
    input: Parameters<ModelRuntimeResultObjectPort["get"]>[0],
  ): Promise<Uint8Array> {
    expect(input.scope).toEqual(this.#scope);
    // A real metadata read also proves result reads do not hold a SQL pool slot
    // while waiting for this object port to acquire one.
    const row = await this.#database.query(
      sql(
        "SELECT object_id FROM stored_objects WHERE organization_id=$1 AND project_id IS NOT DISTINCT FROM $2 AND object_id=$3",
        [
          input.scope.organizationId,
          input.scope.projectId ?? null,
          input.objectId,
        ],
      ),
    );
    expect(row.rowCount).toBe(1);
    const bytes = this.bodies.get(input.objectId);
    if (bytes === undefined) throw new Error("Synthetic result body missing.");
    return bytes.slice();
  }
}

integrationDescribe(
  "model invocation store on isolated loopback PostgreSQL",
  () => {
    let administration: PostgresDatabase | undefined;
    let database: PostgresDatabase;
    let opened: PostgresDatabase | undefined;
    let createdSchema = false;
    beforeAll(async () => {
      const connectionString = loopbackUrl();
      if (!/^cm_model_invocation_it_[a-f0-9]{32}$/u.test(schemaName))
        throw new Error("Unsafe integration schema.");
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
        max: 2,
        connectionTimeoutMillis: 5000,
        options: `-c search_path=${schemaName} -c timezone=UTC`,
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
            !/^cm_model_invocation_it_[a-f0-9]{32}$/u.test(schemaName)
          )
            throw new Error(
              "Refusing to remove an unverified synthetic schema.",
            );
          await administration.transaction(async (tx) => {
            await tx.query(sql(`DROP SCHEMA "${schemaName}" CASCADE`));
          });
        }
      } finally {
        await administration?.close();
      }
    }, 30000);
    async function fixture() {
      const scope = parseScope({
        organizationId: id("organization"),
        projectId: id("project"),
        userId: id("principal"),
        jobId: id("job"),
      });
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES ($1,'Synthetic model integration')",
            [scope.userId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organizations(organization_id,display_name,slug) VALUES ($1,'Synthetic model integration',$2)",
            [
              scope.organizationId,
              `model-${scope.organizationId.replaceAll("_", "-")}`,
            ],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO projects(project_id,organization_id,name,created_by_principal_id) VALUES ($1,$2,'Synthetic model integration',$3)",
            [scope.projectId ?? null, scope.organizationId, scope.userId],
          ),
        );
      });
      const objects = new IntegrationObjects(database, scope);
      return {
        ...invocationFixture(scope),
        scope,
        objects,
        store: new PostgresModelInvocationStore({ database, objects, scope }),
      };
    }
    it("atomically allows one claim and replays exact completion across store instances", async () => {
      const f = await fixture();
      const claims = await Promise.all(
        Array.from({ length: 6 }, () => f.store.claim(f.claim)),
      );
      expect(claims.filter(({ kind }) => kind === "claimed")).toHaveLength(1);
      expect(
        claims.filter(({ kind }) => kind === "duplicate-in-progress"),
      ).toHaveLength(5);
      await f.store.complete(f.claim, f.result);
      const restarted = new PostgresModelInvocationStore({
        database,
        objects: f.objects,
        scope: f.scope,
      });
      expect(await restarted.claim(f.claim)).toEqual({
        kind: "duplicate-complete",
        result: f.result,
      });
      expect(await restarted.loadCompleted(f.claim.invocationId)).toEqual(
        f.result,
      );
      await restarted.complete(f.claim, f.result);
      expect(f.objects.puts).toBe(1);
    });
    it("does not exhaust a two-connection pool during concurrent result publication or replay", async () => {
      const f = await fixture();
      await f.store.claim(f.claim);
      await Promise.all(
        Array.from({ length: 6 }, () => f.store.complete(f.claim, f.result)),
      );
      const results = await Promise.all(
        Array.from({ length: 6 }, () => f.store.claim(f.claim)),
      );
      expect(results.every(({ kind }) => kind === "duplicate-complete")).toBe(
        true,
      );
    }, 15000);
    it("rejects changed authority, same idempotency under another ID, and terminal overwrites", async () => {
      const f = await fixture();
      await f.store.claim(f.claim);
      expect(
        await f.store.claim({
          ...f.claim,
          authorityDigest: digestStructuredValue("changed"),
        }),
      ).toEqual({ kind: "conflict" });
      expect(
        await f.store.claim({
          ...f.claim,
          invocationId: "different-invocation",
        }),
      ).toEqual({ kind: "conflict" });
      await f.store.fail(f.claim, "model-provider.timeout");
      await f.store.fail(f.claim, "model-provider.timeout");
      expect(await f.store.claim(f.claim)).toEqual({ kind: "conflict" });
      await expect(f.store.complete(f.claim, f.result)).rejects.toThrow(
        ModelRuntimePersistenceError,
      );
      await expect(
        f.store.fail(f.claim, "model-provider.permanent"),
      ).rejects.toThrow(ModelRuntimePersistenceError);
      expect(f.objects.puts).toBe(0);
    });
    it("isolates equal caller identities across tenants and rejects cross-scope completion", async () => {
      const [first, second] = await Promise.all([fixture(), fixture()]);
      await first.store.claim(first.claim);
      expect(
        await second.store.loadCompleted(first.claim.invocationId),
      ).toBeNull();
      expect(await second.store.claim(second.claim)).toEqual({
        kind: "claimed",
      });
      await expect(
        second.store.complete(first.claim, first.result),
      ).rejects.toThrow(ModelRuntimePersistenceError);
      await second.store.complete(second.claim, second.result);
      await first.store.complete(first.claim, first.result);
      expect(await first.store.loadCompleted(first.claim.invocationId)).toEqual(
        first.result,
      );
      expect(
        await second.store.loadCompleted(second.claim.invocationId),
      ).toEqual(second.result);
    });
    it("atomically fences one escalation of the exact completed Standard result", async () => {
      const f = await fixture();
      const escalation = escalationFixture(f);
      expect(await f.store.claim(escalation)).toEqual({ kind: "conflict" });
      await f.store.claim(f.claim);
      await f.store.complete(f.claim, f.result);
      const competitors = [escalation, escalationFixture(f, "escalation-2")];
      const claims = await Promise.all(
        competitors.map((claim) => f.store.claim(claim)),
      );
      expect(claims.filter(({ kind }) => kind === "claimed")).toHaveLength(1);
      expect(claims.filter(({ kind }) => kind === "conflict")).toHaveLength(1);
      const winner =
        competitors[claims.findIndex(({ kind }) => kind === "claimed")];
      if (winner === undefined)
        throw new Error("Missing winning synthetic claim.");
      expect(await f.store.claim(winner)).toEqual({
        kind: "duplicate-in-progress",
      });
      await f.store.fail(winner, "model-provider.permanent");
      expect(await f.store.claim(escalationFixture(f, "escalation-3"))).toEqual(
        { kind: "conflict" },
      );
    });
    it("rejects a self-hashed substituted escalation and corrupt stored result bytes", async () => {
      const f = await fixture();
      await f.store.claim(f.claim);
      await f.store.complete(f.claim, f.result);
      const other = invocationFixture(f.scope, "not-original");
      expect(await f.store.claim(escalationFixture(other))).toEqual({
        kind: "conflict",
      });
      const objectId = [...f.objects.bodies.keys()][0];
      if (objectId === undefined) throw new Error("Missing synthetic body.");
      f.objects.bodies.set(objectId, new Uint8Array([1, 2, 3]));
      await expect(f.store.claim(f.claim)).rejects.toThrow(
        ModelRuntimePersistenceError,
      );
    });
    it("enforces immutable claim/terminal SQL constraints and exact published objects", async () => {
      const f = await fixture();
      await f.store.claim(f.claim);
      await expect(
        database.query(
          sql(
            "UPDATE model_runtime_invocations SET claim_sha256=$3 WHERE organization_id=$1 AND invocation_id=$2",
            [f.scope.organizationId, f.claim.invocationId, "a".repeat(64)],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        database.query(
          sql(
            "UPDATE model_runtime_invocations SET state='complete',result_object_id='missing-object',result_sha256=$3,result_size_bytes=1 WHERE organization_id=$1 AND invocation_id=$2",
            [f.scope.organizationId, f.claim.invocationId, "a".repeat(64)],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await f.store.complete(f.claim, f.result);
      await expect(
        database.query(
          sql(
            "DELETE FROM model_runtime_invocations WHERE organization_id=$1 AND invocation_id=$2",
            [f.scope.organizationId, f.claim.invocationId],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        f.store.fail(f.claim, "model-provider.permanent"),
      ).rejects.toThrow(ModelRuntimePersistenceError);
      await expect(
        database.query(
          sql(
            "UPDATE model_runtime_invocations SET state='failed',result_object_id=NULL,result_sha256=NULL,result_size_bytes=NULL,failure_code='model-provider.permanent' WHERE organization_id=$1 AND invocation_id=$2",
            [f.scope.organizationId, f.claim.invocationId],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("rejects missing owner objects and leaves claim retryable without repeating provider dispatch", async () => {
      const f = await fixture();
      await f.store.claim(f.claim);
      const objects: ModelRuntimeResultObjectPort = {
        put(input) {
          return Promise.resolve({
            objectId: "unpublished",
            digest: input.digest,
            sizeBytes: input.bytes.byteLength,
          });
        },
        get(input) {
          return f.objects.get(input);
        },
      };
      const broken = new PostgresModelInvocationStore({
        database,
        objects,
        scope: f.scope,
      });
      await expect(broken.complete(f.claim, f.result)).rejects.toThrow(
        ModelRuntimePersistenceError,
      );
      expect(await f.store.claim(parseClaim(f.claim))).toEqual({
        kind: "duplicate-in-progress",
      });
      await f.store.complete(f.claim, f.result);
      expect(await f.store.loadCompleted(f.claim.invocationId)).toEqual(
        f.result,
      );
    });
  },
);
