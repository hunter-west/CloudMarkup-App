import { createHash, randomUUID } from "node:crypto";
import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { createProjectContentCleanup } from "./project-content-cleanup.js";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { permissionsForRole } from "../../application/authorization.js";
import type {
  AuthorizedOrganizationScope,
  StageObjectInput,
} from "../../application/persistence.js";
import { InMemoryObjectStore } from "./memory-object-store.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { sql, type SqlDatabase } from "./sql.js";
import {
  assertProjectContentErasureAuthority,
  closeProjectContentWrites,
  createProjectWriteFencedObjectStore,
} from "./project-content-write-fence.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const suite = configured ? describe : describe.skip;
const nonce = randomUUID().replaceAll("-", "");
const schema = "cm_content_fence_it_" + nonce;
const marker = "CloudMarkup synthetic content fence " + nonce;
const id = (kind: string) => kind + "_" + randomUUID().replaceAll("-", "");
suite("project content write fencing on genuine PostgreSQL", () => {
  let database: PostgresDatabase;
  let admin: PostgresDatabase | undefined;
  let opened: PostgresDatabase | undefined;
  let created = false;
  beforeAll(async () => {
    const url = new URL(configured ?? "");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.search !== "" ||
      url.hash !== "" ||
      !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(url.pathname)
    )
      throw new Error("Loopback test database required");
    admin = new PostgresDatabase({
      connectionString: configured ?? "",
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    await admin.transaction(async (tx) => {
      await tx.query(sql('CREATE SCHEMA "' + schema + '"'));
      await tx.query(
        sql('COMMENT ON SCHEMA "' + schema + '" IS ' + "'" + marker + "'"),
      );
    });
    created = true;
    database = new PostgresDatabase({
      connectionString: configured ?? "",
      max: 4,
      connectionTimeoutMillis: 5000,
      options:
        "-c search_path=" +
        schema +
        " -c timezone=Pacific/Honolulu -c statement_timeout=5000",
    });
    opened = database;
    await runMigrations(
      database,
      await loadHistoricalBetaMigrations(
        fileURLToPath(new URL("../../../migrations", import.meta.url)),
      ),
    );
  }, 60_000);
  afterAll(async () => {
    try {
      await opened?.close();
      if (created && admin) {
        const found = await admin.query(
          sql(
            "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
            [schema],
          ),
        );
        if (
          !/^cm_content_fence_it_[a-f0-9]{32}$/u.test(schema) ||
          found.rows[0]?.["marker"] !== marker
        )
          throw new Error("Unsafe test schema");
        await admin.query(sql('DROP SCHEMA "' + schema + '" CASCADE'));
      }
    } finally {
      await admin?.close();
    }
  }, 30_000);

  async function fixture(createProject = true) {
    const principalId = id("principal"),
      organizationId = id("organization"),
      membershipId = id("membership"),
      projectId = id("project");
    const scope: AuthorizedOrganizationScope = {
      principalId,
      organizationId,
      membershipId,
      sessionId: id("session"),
      correlationId: id("correlation"),
      roleKey: "owner",
      capabilities: permissionsForRole("owner"),
    };
    await database.transaction(async (tx) => {
      await tx.query(
        sql(
          "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic content writer')",
          [principalId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO organizations(organization_id,display_name,slug) VALUES($1,'Synthetic content fence',$2)",
          [organizationId, id("slug").replaceAll("_", "-")],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES($1,'owner','authorization-v2',true,cloudmarkup_authorization_v2_permissions('owner'))",
          [organizationId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
          [membershipId, organizationId, principalId],
        ),
      );
    });
    async function insertProject() {
      await database.query(
        sql(
          "INSERT INTO projects(project_id,organization_id,name,created_by_principal_id) VALUES($1,$2,'Synthetic content fence',$3)",
          [projectId, organizationId, principalId],
        ),
      );
    }
    if (createProject) await insertProject();
    const delegate = new InMemoryObjectStore();
    const stage = vi.spyOn(delegate, "stage");
    const store = createProjectWriteFencedObjectStore({
      database,
      delegate,
      storageNamespace: "documents",
    });
    const bytes = Buffer.from("Synthetic project bytes");
    const input: StageObjectInput = {
      owner: { organizationId, projectId },
      objectId: id("object"),
      purpose: "architecture-draft",
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
      mediaType: "application/json",
      sizeBytes: bytes.byteLength,
      open: () => Readable.from([bytes]),
    };
    const selector = { organizationId, projectId };
    async function requestDeletion() {
      await database.query(
        sql(
          "UPDATE projects SET lifecycle_status='deletion-pending',deletion_requested_at=clock_timestamp(),record_version=record_version+1 WHERE organization_id=$1 AND project_id=$2",
          [organizationId, projectId],
        ),
      );
    }
    const states = async () =>
      (
        await database.query(
          sql(
            "SELECT lifecycle_status FROM project_content_writes WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at",
            [organizationId, projectId],
          ),
        )
      ).rows;
    return {
      scope,
      delegate,
      stage,
      store,
      input,
      selector,
      insertProject,
      requestDeletion,
      states,
    };
  }
  async function cleanupFixture() {
    const f = await fixture();
    await f.store.stage(f.scope, f.input);
    const root =
      "v1/organizations/" +
      f.selector.organizationId +
      "/projects/" +
      f.selector.projectId +
      "/";
    const key =
      "documents/" +
      root +
      "architecture-draft/" +
      f.input.objectId +
      "/" +
      f.input.contentSha256;
    await database.query(
      sql(
        `INSERT INTO stored_objects(object_id,organization_id,project_id,storage_provider,object_purpose,
        storage_key,object_version,content_sha256,size_bytes,media_type,created_by_principal_id)
        VALUES($1,$2,$3,'s3','architecture-draft',$4,'version-1',$5,$6,$7,$8)`,
        [
          f.input.objectId,
          f.selector.organizationId,
          f.selector.projectId,
          key,
          f.input.contentSha256,
          f.input.sizeBytes,
          f.input.mediaType,
          f.scope.principalId,
        ],
      ),
    );
    // Synthetic S3 state includes a historical version and an unregistered
    // staged object; the genuine erasure adapter must remove both.
    const versions = new Map([
      [key, ["version-1", "version-older"]],
      ["evidence/" + root + "report/orphan", ["orphan"]],
      ["documents/v1/organizations/other/projects/other/retained", ["foreign"]],
    ]);
    const send = vi.fn(
      (command: ListObjectVersionsCommand | DeleteObjectsCommand) => {
        if (command.input.ExpectedBucketOwner !== "123456789012")
          throw new Error("Owner mismatch");
        if (command instanceof ListObjectVersionsCommand) {
          const all = [...versions]
            .flatMap(([Key, values]) =>
              values.map((VersionId) => ({ Key, VersionId })),
            )
            .filter(({ Key }) =>
              Key.startsWith(command.input.Prefix ?? "invalid"),
            );
          return Promise.resolve({
            Name: "cloudmarkup-test",
            Prefix: command.input.Prefix,
            IsTruncated: all.length > 1000,
            Versions: all.slice(0, 1000),
          });
        }
        const objects = command.input.Delete?.Objects ?? [];
        for (const object of objects) {
          const retained = (versions.get(object.Key ?? "") ?? []).filter(
            (version) => version !== object.VersionId,
          );
          if (retained.length === 0) versions.delete(object.Key ?? "");
          else versions.set(object.Key ?? "", retained);
        }
        return Promise.resolve({ Deleted: objects });
      },
    );
    const cleanup = createProjectContentCleanup({
      database,
      client: { send } as unknown as S3Client,
      bucket: "cloudmarkup-test",
      expectedBucketOwner: "123456789012",
      prefixes: {
        documents: "documents/",
        artifacts: "artifacts/",
        evidence: "evidence/",
      },
    });
    await f.requestDeletion();
    return { ...f, cleanup, send, versions };
  }
  it("erases current, historical and unregistered project objects before an atomic completion receipt", async () => {
    const f = await cleanupFixture();
    expect(await f.cleanup.process(f.selector)).toEqual({ state: "completed" });
    expect([...f.versions.keys()]).toEqual([
      "documents/v1/organizations/other/projects/other/retained",
    ]);
    const evidence = await database.query(
      sql(
        `SELECT p.lifecycle_status,p.name,p.description,r.policy_version,r.object_metadata_count::text,
        o.lifecycle_state AS object_state,o.published_at FROM projects p
        JOIN project_content_erasure_receipts r USING(organization_id,project_id)
        JOIN stored_objects o USING(organization_id,project_id) WHERE p.project_id=$1`,
        [f.selector.projectId],
      ),
    );
    expect(evidence.rows).toEqual([
      {
        lifecycle_status: "deleted",
        name: "Deleted project",
        description: null,
        policy_version: 1,
        object_metadata_count: "1",
        object_state: "deleted",
        published_at: null,
      },
    ]);
    const calls = f.send.mock.calls.length;
    expect(await f.cleanup.process(f.selector)).toEqual({ state: "completed" });
    expect(f.send).toHaveBeenCalledTimes(calls);
    await expect(
      database.query(
        sql(
          `INSERT INTO stored_objects(object_id,organization_id,project_id,storage_provider,object_purpose,
        storage_key,object_version,content_sha256,size_bytes,media_type,created_by_principal_id)
        VALUES($1,$2,$3,'s3','architecture-draft','documents/late','late',$4,1,'application/json',$5)`,
          [
            id("object"),
            f.selector.organizationId,
            f.selector.projectId,
            f.input.contentSha256,
            f.scope.principalId,
          ],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        sql(
          "DELETE FROM project_content_erasure_receipts WHERE project_id=$1",
          [f.selector.projectId],
        ),
      ),
    ).rejects.toThrow();
  });
  it("resumes after a storage failure and never reports an incomplete erase as completed", async () => {
    const f = await cleanupFixture();
    f.send.mockRejectedValueOnce(new Error("Synthetic S3 failure"));
    expect(await f.cleanup.process(f.selector)).toEqual({
      state: "pending",
      reason: "storage",
    });
    const before = await database.query(
      sql(
        "SELECT count(*)::text AS count FROM project_content_erasure_receipts WHERE project_id=$1",
        [f.selector.projectId],
      ),
    );
    expect(before.rows[0]?.["count"]).toBe("0");
    expect(await f.cleanup.process(f.selector)).toEqual({ state: "completed" });
  });
  it("denies a foreign metadata footprint before any S3 call", async () => {
    const f = await cleanupFixture();
    // The new metadata barrier already rejects corruption after deletion.
    await expect(
      database.query(
        sql(
          "UPDATE stored_objects SET storage_key='documents/v1/organizations/other/projects/other/private' WHERE object_id=$1",
          [f.input.objectId],
        ),
      ),
    ).rejects.toThrow();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("allows concurrent cleanup callers to converge on one immutable receipt", async () => {
    const f = await cleanupFixture();
    const results = await Promise.all([
      f.cleanup.process(f.selector),
      f.cleanup.process(f.selector),
    ]);
    expect(results).toEqual([{ state: "completed" }, { state: "completed" }]);
    const receipts = await database.query(
      sql(
        "SELECT count(*)::text AS count FROM project_content_erasure_receipts WHERE project_id=$1",
        [f.selector.projectId],
      ),
    );
    expect(receipts.rows[0]?.["count"]).toBe("1");
  });

  it("replays a competing completion between the initial status read and write closure", async () => {
    const f = await cleanupFixture();
    const query = database.query.bind(database);
    const interleave = vi
      .spyOn(database, "query")
      .mockImplementationOnce(async (statement) => {
        const result = await query(statement);
        expect(statement.text).toContain(
          "LEFT JOIN project_content_erasure_receipts",
        );
        expect(await f.cleanup.process(f.selector)).toEqual({
          state: "completed",
        });
        return result;
      });
    try {
      expect(await f.cleanup.process(f.selector)).toEqual({
        state: "completed",
      });
    } finally {
      interleave.mockRestore();
    }
    const receipts = await database.query(
      sql(
        "SELECT count(*)::text AS count FROM project_content_erasure_receipts WHERE project_id=$1",
        [f.selector.projectId],
      ),
    );
    expect(receipts.rows[0]?.["count"]).toBe("1");
  });

  it("records successful uploads and closes their project irreversibly before erasure", async () => {
    const f = await fixture();
    const object = await f.store.stage(f.scope, f.input);
    expect(object.contentSha256).toBe(f.input.contentSha256);
    expect(await f.states()).toEqual([{ lifecycle_status: "completed" }]);
    await expect(
      closeProjectContentWrites(database, f.selector),
    ).rejects.toThrow();
    await f.requestDeletion();
    const closed = await closeProjectContentWrites(database, f.selector);
    expect(closed.ready).toBe(true);
    expect(await closeProjectContentWrites(database, f.selector)).toEqual(
      closed,
    );
    await expect(
      assertProjectContentErasureAuthority(database, closed.binding),
    ).resolves.toBeUndefined();
    await expect(
      assertProjectContentErasureAuthority(database, {
        ...closed.binding,
        recordVersion: closed.binding.recordVersion + 1,
      }),
    ).rejects.toThrow();
    await expect(
      f.store.stage(f.scope, { ...f.input, objectId: id("object") }),
    ).rejects.toThrow();
    expect(f.stage).toHaveBeenCalledTimes(1);
    await expect(
      database.query(
        sql(
          "UPDATE project_content_write_scopes SET closed_at=NULL WHERE organization_id=$1 AND project_id=$2",
          [f.selector.organizationId, f.selector.projectId],
        ),
      ),
    ).rejects.toThrow();
  });
  it.each([true, false])(
    "waits for an admitted upload, including pre-creation staging (%s)",
    async (existing) => {
      const f = await fixture(existing);
      const actual = InMemoryObjectStore.prototype.stage.bind(f.delegate);
      f.stage.mockRestore();
      let release: () => void = () => {
        throw new Error("Write not waiting");
      };
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = vi
        .spyOn(f.delegate, "stage")
        .mockImplementation(async (scope, input) => {
          await wait;
          return actual(scope, input);
        });
      const inFlight = f.store.stage(f.scope, f.input);
      try {
        await vi.waitFor(
          () => {
            expect(started).toHaveBeenCalledTimes(1);
          },
          { timeout: 5000 },
        );
        if (!existing) await f.insertProject();
        await f.requestDeletion();
        expect(
          (await closeProjectContentWrites(database, f.selector)).ready,
        ).toBe(false);
      } finally {
        release();
      }
      await inFlight;
      expect(
        (await closeProjectContentWrites(database, f.selector)).ready,
      ).toBe(true);
    },
  );
  it("retains uncertain external writes and prevents invented completion or deletion of their evidence", async () => {
    const f = await fixture();
    f.stage.mockRejectedValueOnce(new Error("Synthetic provider uncertainty"));
    await expect(f.store.stage(f.scope, f.input)).rejects.toThrow();
    expect(await f.states()).toEqual([{ lifecycle_status: "uncertain" }]);
    await f.requestDeletion();
    expect((await closeProjectContentWrites(database, f.selector)).ready).toBe(
      false,
    );
    await expect(
      database.query(
        sql(
          "UPDATE project_content_writes SET lifecycle_status='completed' WHERE organization_id=$1 AND project_id=$2",
          [f.selector.organizationId, f.selector.projectId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        sql(
          "DELETE FROM project_content_writes WHERE organization_id=$1 AND project_id=$2",
          [f.selector.organizationId, f.selector.projectId],
        ),
      ),
    ).rejects.toThrow();
  });
  it("denies foreign project, altered membership and deleted-project uploads before storage", async () => {
    const f = await fixture(),
      other = await fixture();
    await expect(
      f.store.stage(f.scope, {
        ...f.input,
        owner: { ...f.input.owner, projectId: other.selector.projectId },
      }),
    ).rejects.toThrow();
    await expect(
      f.store.stage(
        { ...f.scope, membershipId: other.scope.membershipId },
        f.input,
      ),
    ).rejects.toThrow();
    await f.requestDeletion();
    await expect(f.store.stage(f.scope, f.input)).rejects.toThrow();
    expect(f.stage).not.toHaveBeenCalled();
    expect(await f.states()).toEqual([]);
  });
  it("keeps real object bytes behind an uncertain journal result if final SQL recording fails", async () => {
    const f = await fixture();
    let failOnce = true;
    const failed: SqlDatabase = {
      transaction: database.transaction.bind(database),
      close: database.close.bind(database),
      async query(statement) {
        if (failOnce) {
          failOnce = false;
          throw new Error("Synthetic final recording failure");
        }
        return database.query(statement);
      },
    };
    const store = createProjectWriteFencedObjectStore({
      database: failed,
      delegate: f.delegate,
      storageNamespace: "documents",
    });
    await expect(store.stage(f.scope, f.input)).rejects.toThrow();
    expect(await f.states()).toEqual([{ lifecycle_status: "uncertain" }]);
    await f.requestDeletion();
    expect((await closeProjectContentWrites(database, f.selector)).ready).toBe(
      false,
    );
  });
});
