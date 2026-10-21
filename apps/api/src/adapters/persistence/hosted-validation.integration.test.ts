import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import type { CreateValidationRunV1 } from "@cloudmarkup/api-contract";
import { parseArchitectureDocument } from "@cloudmarkup/domain";
import {
  AWS_CATALOG_DIGEST_V1,
  awsCatalogV1,
} from "@cloudmarkup/provider-aws/catalog";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createInitialArchitectureDocument } from "../../application/architecture-document-storage.js";
import type { ObjectStore } from "../../application/persistence.js";
import type {
  CloudMarkupApplication,
  PrincipalContext,
} from "../../application/ports.js";
import { ProductionIdentityApplication } from "../../application/production-identity-application.js";
import { createProductionRepositoryBackedApplication } from "../../production-composition.js";
import { createHostedValidationOverrides } from "./hosted-validation.js";
import { InMemoryObjectStore } from "./memory-object-store.js";
import { runMigrations, runSeedFile } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { PostgresCloudMarkupRepository } from "./repositories.js";
import {
  sql,
  type SqlDatabase,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

const databaseUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"];
const integrationDescribe =
  databaseUrl === undefined ? describe.skip : describe;
const runId = randomUUID().replaceAll("-", "");
const schemaName = `cloudmarkup_validation_test_${runId}`;
const schemaMarker = `CloudMarkup synthetic validation integration ${runId}`;

function localDatabaseUrl(): string {
  if (databaseUrl === undefined || databaseUrl === "")
    throw new Error("A loopback PostgreSQL test URL is required.");
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    // Native URL errors may include credentials; expose only a bounded error.
    throw new Error("The PostgreSQL integration URL is invalid.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(parsed.pathname)
  )
    throw new Error(
      "Validation integration accepts only an explicit loopback PostgreSQL URL, database name, and no query/fragment overrides.",
    );
  return databaseUrl;
}

function principal(principalId = "principal_local_owner"): PrincipalContext {
  return {
    authenticatedAt: new Date().toISOString(),
    authenticationSource: "cognito",
    correlationId: `correlation_${randomUUID()}`,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    principalId,
    sessionId: "session_validation_integration",
  };
}

function documentFixture() {
  const document = createInitialArchitectureDocument({
    blank: true,
    infrastructureOnly: true,
    identity: {
      architectureId: "architecture_validation_integration",
      documentId: "document_validation_integration",
      draftId: "draft_validation_integration",
      principalId: "principal_local_owner",
      revisionId: "revision_validation_integration",
    },
  });
  return parseArchitectureDocument({
    ...document,
    provider: { id: awsCatalogV1.artifact.provider.id, region: "us-east-1" },
    catalog: {
      id: awsCatalogV1.artifact.catalog.id,
      version: awsCatalogV1.artifact.catalog.version,
      digest: AWS_CATALOG_DIGEST_V1,
    },
  });
}

integrationDescribe("hosted validation with real local PostgreSQL", () => {
  let admin: PostgresDatabase | undefined;
  let database: PostgresDatabase | undefined;
  let createdSchema = false;
  const documentStore = new InMemoryObjectStore();
  const reportStore = new InMemoryObjectStore();

  function currentDatabase() {
    if (database === undefined)
      throw new Error("Local database was not initialized.");
    return database;
  }

  function application(
    validationReportStore: ObjectStore = reportStore,
    repository = new PostgresCloudMarkupRepository(currentDatabase()),
  ) {
    const db = currentDatabase();
    const identity = new ProductionIdentityApplication(db);
    return createProductionRepositoryBackedApplication(identity, {
      additionalOverrides: createHostedValidationOverrides({
        database: db,
        documentStore,
        reportStore: validationReportStore,
        repository,
        organizationForProject: (actor, projectId) =>
          identity.organizationForProject(actor, projectId),
      }),
      fallback: {} as CloudMarkupApplication,
      identifierNamespace: "validation-integration",
      objectStore: documentStore,
      repository,
    });
  }

  // Faults are injected only at the object-port boundary. All reads, locks,
  // receipts, mutations, and constraints still run in real PostgreSQL.
  function reportStoreWithHooks(hooks: {
    readonly beforeStage?: () => Promise<void>;
    readonly beforePublish?: () => Promise<void>;
  }): ObjectStore {
    return {
      stage: async (scope, input) => {
        await hooks.beforeStage?.();
        return reportStore.stage(scope, input);
      },
      publish: async (scope, object) => {
        await hooks.beforePublish?.();
        await reportStore.publish(scope, object);
      },
      open: (scope, object) => reportStore.open(scope, object),
      head: (scope, object) => reportStore.head(scope, object),
      discardStaged: (scope, object) =>
        reportStore.discardStaged(scope, object),
      requestDeletion: (scope, object) =>
        reportStore.requestDeletion(scope, object),
    };
  }

  async function validationState(projectId: string) {
    return currentDatabase().query(
      sql(
        `SELECT v.validation_run_id, v.lifecycle_status AS run_status,
        o.lifecycle_state AS object_status, i.lifecycle_status AS receipt_status
      FROM validation_runs v
      JOIN stored_objects o ON o.organization_id = v.organization_id AND o.object_id = v.report_object_id
      JOIN idempotency_records i ON i.organization_id = v.organization_id
        AND i.principal_id = v.created_by_principal_id AND i.resource_id = v.validation_run_id
        AND i.operation_name = 'validation-runs.create'
      WHERE v.project_id = $1`,
        [projectId],
      ),
    );
  }

  function twoRequestStageBarrier() {
    let releaseBoth: () => void = () => {
      throw new Error("Stage barrier was not initialized.");
    };
    const bothReachedStage = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    let stageCount = 0;
    const store = reportStoreWithHooks({
      beforeStage: async () => {
        stageCount += 1;
        if (stageCount === 2) releaseBoth();
        await bothReachedStage;
      },
    });
    return { store, stageCount: () => stageCount };
  }

  async function advanceDraft(actor: PrincipalContext, projectId: string) {
    const draft = await application().getDraft(actor, projectId);
    return application().saveDraft(
      actor,
      projectId,
      {
        contractVersion: 1,
        architectureDocument: draft.value.architectureDocument,
      },
      draft.etag,
    );
  }

  async function createProject(
    organizationId = "org_local",
    actor = principal(),
  ) {
    return application().createProject(
      actor,
      organizationId,
      {
        creationMode: "draft-copy",
        name: "Persisted validation integration",
        architectureDocument: documentFixture(),
      },
      `project_${randomUUID()}`,
    );
  }

  beforeAll(async () => {
    const connectionString = localDatabaseUrl();
    if (!/^cloudmarkup_validation_test_[a-f0-9]{32}$/u.test(schemaName))
      throw new Error("Invalid test schema.");
    admin = new PostgresDatabase({
      application_name: "cloudmarkup-validation-integration-admin",
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    await admin.transaction(async (transaction) => {
      await transaction.query(sql(`CREATE SCHEMA "${schemaName}"`));
      await transaction.query(
        sql(`COMMENT ON SCHEMA "${schemaName}" IS '${schemaMarker}'`),
      );
    });
    createdSchema = true;
    database = new PostgresDatabase({
      application_name: "cloudmarkup-validation-integration",
      connectionString,
      max: 4,
      options: `-c search_path=${schemaName} -c timezone=UTC`,
      connectionTimeoutMillis: 5000,
    });
    const apiDirectory = fileURLToPath(new URL("../../../", import.meta.url));
    const migrations = await loadHistoricalBetaMigrations(
      `${apiDirectory}migrations`,
    );
    await runMigrations(database, migrations);
    await runMigrations(database, migrations);
    await runSeedFile(
      database,
      `${apiDirectory}seeds/0001_local_development.sql`,
    );
  }, 60_000);

  afterAll(async () => {
    try {
      await database?.close();
      if (createdSchema && admin !== undefined) {
        const marker = await admin.query(
          sql(
            "SELECT obj_description(oid, 'pg_namespace') AS marker FROM pg_namespace WHERE nspname = $1",
            [schemaName],
          ),
        );
        if (
          marker.rows[0]?.["marker"] !== schemaMarker ||
          !/^cloudmarkup_validation_test_[a-f0-9]{32}$/u.test(schemaName)
        )
          throw new Error(
            "Refusing cleanup of an unverified integration schema.",
          );
        await admin.transaction(async (transaction) => {
          await transaction.query(sql(`DROP SCHEMA "${schemaName}" CASCADE`));
        });
      }
    } finally {
      await admin?.close();
    }
  }, 30_000);

  async function lifecycleFixture() {
    const actor = principal(`principal_lifecycle_${randomUUID()}`);
    const membershipId = `membership_lifecycle_${randomUUID()}`;
    const organizationId = "org_local_team";
    const db = currentDatabase();
    await db.transaction(async (tx) => {
      await tx.query(
        sql("INSERT INTO principals(principal_id,display_name) VALUES($1,$2)", [
          actor.principalId,
          "Synthetic lifecycle actor",
        ]),
      );
      await tx.query(
        sql(
          "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
          [membershipId, organizationId, actor.principalId],
        ),
      );
    });
    const created = await createProject(organizationId, actor);
    const projectId = created.project.id;
    const current = await application().getProject(actor, projectId);
    const repository = new PostgresCloudMarkupRepository(db);
    const scope = await repository.resolveOrganizationScope(
      actor,
      organizationId,
    );
    if (scope === null)
      throw new Error("Synthetic lifecycle scope is missing.");
    const project = await repository.getProject(scope, projectId);
    if (project === null)
      throw new Error("Synthetic lifecycle project is missing.");
    return {
      actor,
      current,
      membershipId,
      organizationId,
      projectId,
      repository,
      scope,
      input: {
        expectedRecordVersion: project.recordVersion,
        idempotencyKey: `lifecycle_${randomUUID()}`,
        projectId,
        requestSha256: "a".repeat(64),
      },
    };
  }

  async function lifecycleState(projectId: string) {
    return (
      await currentDatabase().query(
        sql(
          `SELECT to_jsonb(p) AS project, to_jsonb(d) AS draft,
           (SELECT count(*)::text FROM idempotency_records i
             WHERE i.organization_id=p.organization_id AND i.resource_id=p.project_id) AS receipts,
           (SELECT count(*)::text FROM audit_events a
             WHERE a.organization_id=p.organization_id AND a.target_id=p.project_id) AS audits
           FROM projects p LEFT JOIN architecture_drafts d
             ON d.organization_id=p.organization_id AND d.draft_id=p.current_draft_id
           WHERE p.project_id=$1`,
          [projectId],
        ),
      )
    ).rows;
  }

  for (const operation of ["archive", "delete"] as const) {
    it.each([
      "demotion",
      "membership-suspension",
      "principal-suspension",
    ] as const)(
      `lifecycle ${operation} rejects %s after genuine draft metadata I/O`,
      async (change) => {
        const f = await lifecycleFixture();
        const before = await lifecycleState(f.projectId);
        const readDraft = f.repository.getDraft.bind(f.repository);
        let intercepted = 0;
        const draftRead = vi
          .spyOn(f.repository, "getDraft")
          .mockImplementation(async (scope, projectId) => {
            const metadata = await readDraft(scope, projectId);
            if (projectId === f.projectId && intercepted === 0) {
              intercepted += 1;
              expect(metadata).not.toBeNull();
              if (change === "demotion") {
                await currentDatabase().query(
                  sql(
                    "UPDATE memberships SET role_key=$2 WHERE membership_id=$1",
                    [
                      f.membershipId,
                      operation === "archive" ? "viewer" : "editor",
                    ],
                  ),
                );
              } else if (change === "membership-suspension") {
                await currentDatabase().query(
                  sql(
                    "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
                    [f.membershipId],
                  ),
                );
              } else {
                await currentDatabase().query(
                  sql(
                    "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
                    [f.actor.principalId],
                  ),
                );
              }
            }
            return metadata;
          });
        try {
          const app = application(reportStore, f.repository);
          await expect(
            operation === "archive"
              ? app.archiveProject(
                  f.actor,
                  f.projectId,
                  { contractVersion: 1 },
                  f.current.etag,
                  f.input.idempotencyKey,
                )
              : app.deleteProject(
                  f.actor,
                  f.projectId,
                  f.current.etag,
                  f.input.idempotencyKey,
                ),
          ).rejects.toMatchObject({ code: "access_denied" });
          expect(intercepted).toBe(1);
          expect(await lifecycleState(f.projectId)).toEqual(before);
        } finally {
          draftRead.mockRestore();
        }
      },
    );

    it(`lifecycle ${operation} holds project and current authority locks until its write`, async () => {
      const f = await lifecycleFixture();
      const db = currentDatabase();
      const statements: string[] = [];
      let checked = 0;
      const bounded: SqlDatabase = {
        close: () => db.close(),
        query: (statement) => db.query(statement),
        transaction: (work) =>
          db.transaction((tx) =>
            work({
              query: async <TRow extends SqlRow = SqlRow>(
                statement: SqlStatement,
              ) => {
                statements.push(statement.text);
                if (
                  /^\s*UPDATE projects\s+SET lifecycle_status/u.test(
                    statement.text,
                  )
                ) {
                  checked += 1;
                  // NO KEY UPDATE conflicts with the authority's SHARE locks,
                  // unlike FK KEY SHARE locks; NOWAIT makes the proof deterministic.
                  const probes = [
                    sql(
                      "SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2 FOR NO KEY UPDATE NOWAIT",
                      [f.organizationId, f.projectId],
                    ),
                    sql(
                      "SELECT membership_id FROM memberships WHERE membership_id=$1 FOR NO KEY UPDATE NOWAIT",
                      [f.membershipId],
                    ),
                    sql(
                      "SELECT principal_id FROM principals WHERE principal_id=$1 FOR NO KEY UPDATE NOWAIT",
                      [f.actor.principalId],
                    ),
                    sql(
                      "SELECT organization_id FROM organizations WHERE organization_id=$1 FOR NO KEY UPDATE NOWAIT",
                      [f.organizationId],
                    ),
                    sql(
                      "SELECT role_key FROM organization_roles WHERE organization_id=$1 AND role_key='owner' FOR NO KEY UPDATE NOWAIT",
                      [f.organizationId],
                    ),
                  ];
                  for (const probe of probes) {
                    await expect(
                      db.transaction((other) => other.query(probe)),
                    ).rejects.toMatchObject({ code: "55P03" });
                  }
                }
                return tx.query<TRow>(statement);
              },
            }),
          ),
      };
      const repository = new PostgresCloudMarkupRepository(bounded);
      const result =
        operation === "archive"
          ? await repository.archiveProject(f.scope, f.input)
          : await repository.deleteProject(f.scope, f.input);
      expect(result.lifecycleStatus).toBe(
        operation === "archive" ? "archived" : "deletion-pending",
      );
      expect(checked).toBe(1);
      expect(statements[0]).toContain("SELECT project_id FROM projects");
      expect(statements[0]).toContain("FOR UPDATE");
      expect(statements[0]).not.toContain("lifecycle_status = 'active'");
      expect(statements[1]).toContain("FOR SHARE OF m, principal_record, o, r");
    });

    it(`lifecycle ${operation} replays a closed project without another write but rechecks current principal`, async () => {
      const f = await lifecycleFixture();
      const mutate = () =>
        operation === "archive"
          ? f.repository.archiveProject(f.scope, f.input)
          : f.repository.deleteProject(f.scope, f.input);
      const result = await mutate();
      const before = await lifecycleState(f.projectId);
      await expect(mutate()).resolves.toEqual(result);
      expect(await lifecycleState(f.projectId)).toEqual(before);
      await currentDatabase().query(
        sql(
          "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
          [f.actor.principalId],
        ),
      );
      await expect(mutate()).rejects.toMatchObject({ code: "access-denied" });
      expect(await lifecycleState(f.projectId)).toEqual(before);
    });
  }

  it("lifecycle current editor can archive with projects.mutate but cannot delete with stale owner scope", async () => {
    const f = await lifecycleFixture();
    await currentDatabase().query(
      sql("UPDATE memberships SET role_key='editor' WHERE membership_id=$1", [
        f.membershipId,
      ]),
    );
    const archived = await f.repository.archiveProject(f.scope, f.input);
    expect(archived.lifecycleStatus).toBe("archived");
    const before = await lifecycleState(f.projectId);
    await expect(
      f.repository.deleteProject(f.scope, {
        ...f.input,
        expectedRecordVersion: archived.recordVersion,
        idempotencyKey: `delete_editor_${randomUUID()}`,
        requestSha256: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "access-denied" });
    expect(await lifecycleState(f.projectId)).toEqual(before);
  });

  it("persists a validation run and returns its original evidence after application re-composition and a newer draft save", async () => {
    const actor = principal();
    const created = await createProject();
    const input: CreateValidationRunV1 = {
      contractVersion: 1,
      environment: "production",
      target: "draft",
      input: { kind: "draft", draftId: created.draft.id, draftVersion: 1 },
    };
    const key = `validation_${randomUUID()}`;
    const run = await application().createValidationRun(
      actor,
      created.project.id,
      input,
      key,
    );
    expect(run.status).toBe("succeeded");
    expect(
      await application().getValidationRun(actor, created.project.id, run.id),
    ).toEqual(run);
    const saved = await advanceDraft(actor, created.project.id);
    expect(saved.value.version).toBe(2);
    expect(
      await application().createValidationRun(
        actor,
        created.project.id,
        input,
        key,
      ),
    ).toEqual(run);
    await expect(
      application().createValidationRun(
        actor,
        created.project.id,
        input,
        `stale_${randomUUID()}`,
      ),
    ).rejects.toMatchObject({ code: "precondition_failed" });
    const receipts = await currentDatabase().query(
      sql(
        "SELECT lifecycle_status FROM idempotency_records WHERE resource_id = $1",
        [run.id],
      ),
    );
    expect(receipts.rows).toEqual([{ lifecycle_status: "completed" }]);
  });

  it("recovers interrupted report publication with the original POST after the draft advances", async () => {
    const actor = principal();
    const created = await createProject();
    const input: CreateValidationRunV1 = {
      contractVersion: 1,
      environment: "production",
      target: "draft",
      input: { kind: "draft", draftId: created.draft.id, draftVersion: 1 },
    };
    const key = `publication_${randomUUID()}`;
    let failPublication = true;
    const interruptedStore = reportStoreWithHooks({
      beforePublish: () => {
        if (failPublication) {
          failPublication = false;
          return Promise.reject(
            new Error("Simulated object publication interruption."),
          );
        }
        return Promise.resolve();
      },
    });
    await expect(
      application(interruptedStore).createValidationRun(
        actor,
        created.project.id,
        input,
        key,
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    const pending = await validationState(created.project.id);
    expect(pending.rows).toHaveLength(1);
    const runId = pending.rows[0]?.["validation_run_id"];
    expect(typeof runId).toBe("string");
    if (typeof runId !== "string")
      throw new Error("Expected a persisted validation run.");
    expect(pending.rows[0]).toMatchObject({
      run_status: "running",
      object_status: "publication-pending",
      receipt_status: "in-progress",
    });
    expect(
      await application(interruptedStore).getValidationRun(
        actor,
        created.project.id,
        runId,
      ),
    ).toMatchObject({ id: runId, status: "running", input: input.input });
    expect((await advanceDraft(actor, created.project.id)).value.version).toBe(
      2,
    );
    const recovered = await application(interruptedStore).createValidationRun(
      actor,
      created.project.id,
      input,
      key,
    );
    expect(recovered).toMatchObject({
      id: runId,
      status: "succeeded",
      input: input.input,
    });
    expect(recovered.summary?.reportId).toBe(runId);
    expect((await validationState(created.project.id)).rows).toEqual([
      {
        validation_run_id: runId,
        run_status: "succeeded",
        object_status: "published",
        receipt_status: "completed",
      },
    ]);
  });

  it("rolls back a receipt and run when the draft changes after source read but before persistence", async () => {
    const actor = principal();
    const created = await createProject();
    const input: CreateValidationRunV1 = {
      contractVersion: 1,
      environment: "test",
      target: "draft",
      input: { kind: "draft", draftId: created.draft.id, draftVersion: 1 },
    };
    let changed = false;
    const changedSourceStore = reportStoreWithHooks({
      beforeStage: async () => {
        if (!changed) {
          changed = true;
          expect(
            (await advanceDraft(actor, created.project.id)).value.version,
          ).toBe(2);
        }
      },
    });
    const receiptsBefore = await currentDatabase().query(
      sql(
        "SELECT COUNT(*)::integer AS count FROM idempotency_records WHERE operation_name = 'validation-runs.create'",
      ),
    );
    await expect(
      application(changedSourceStore).createValidationRun(
        actor,
        created.project.id,
        input,
        `changed_${randomUUID()}`,
      ),
    ).rejects.toMatchObject({ code: "precondition_failed" });
    expect(changed).toBe(true);
    expect((await validationState(created.project.id)).rows).toHaveLength(0);
    expect(
      (
        await currentDatabase().query(
          sql(
            "SELECT COUNT(*)::integer AS count FROM idempotency_records WHERE operation_name = 'validation-runs.create'",
          ),
        )
      ).rows,
    ).toEqual(receiptsBefore.rows);
    expect(
      (
        await currentDatabase().query(
          sql(
            "SELECT object_id FROM stored_objects WHERE project_id = $1 AND object_purpose = 'validation-report'",
            [created.project.id],
          ),
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("serializes simultaneous matching requests into one persisted run", async () => {
    const actor = principal();
    const created = await createProject();
    const input: CreateValidationRunV1 = {
      contractVersion: 1,
      environment: "development",
      target: "draft",
      input: { kind: "draft", draftId: created.draft.id, draftVersion: 1 },
    };
    const key = `concurrent_${randomUUID()}`;
    const barrier = twoRequestStageBarrier();
    const runs = await Promise.all([
      application(barrier.store).createValidationRun(
        actor,
        created.project.id,
        input,
        key,
      ),
      application(barrier.store).createValidationRun(
        actor,
        created.project.id,
        input,
        key,
      ),
    ]);
    expect(barrier.stageCount()).toBe(2);
    expect(runs[0]).toEqual(runs[1]);
    const rows = await currentDatabase().query(
      sql(
        "SELECT validation_run_id FROM validation_runs WHERE project_id = $1",
        [created.project.id],
      ),
    );
    expect(rows.rows).toHaveLength(1);
    expect((await validationState(created.project.id)).rows).toEqual([
      {
        validation_run_id: runs[0].id,
        run_status: "succeeded",
        object_status: "published",
        receipt_status: "completed",
      },
    ]);
  });

  it("returns a key-reuse conflict for simultaneous requests in different projects", async () => {
    const actor = principal();
    const first = await createProject();
    const second = await createProject();
    const key = `different_${randomUUID()}`;
    const barrier = twoRequestStageBarrier();
    const results = await Promise.allSettled(
      [first, second].map((created) =>
        application(barrier.store).createValidationRun(
          actor,
          created.project.id,
          {
            contractVersion: 1,
            environment: "production",
            target: "draft",
            input: {
              kind: "draft",
              draftId: created.draft.id,
              draftVersion: 1,
            },
          },
          key,
        ),
      ),
    );
    expect(barrier.stageCount()).toBe(2);
    const successes = results.filter((result) => result.status === "fulfilled");
    const failures = results.filter((result) => result.status === "rejected");
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(successes[0]?.value.status).toBe("succeeded");
    expect(failures[0]?.reason).toMatchObject({
      code: "idempotency_key_reused",
    });
    const states = await Promise.all(
      [first, second].map((created) => validationState(created.project.id)),
    );
    expect(states.flatMap((state) => state.rows)).toEqual([
      {
        validation_run_id: successes[0]?.value.id,
        run_status: "succeeded",
        object_status: "published",
        receipt_status: "completed",
      },
    ]);
  });

  it("rejects cross-project key reuse and cross-tenant reads without creating another run", async () => {
    const actor = principal();
    const first = await createProject();
    const second = await createProject();
    const input: CreateValidationRunV1 = {
      contractVersion: 1,
      environment: "test",
      target: "draft",
      input: { kind: "draft", draftId: first.draft.id, draftVersion: 1 },
    };
    const key = `scoped_${randomUUID()}`;
    const run = await application().createValidationRun(
      actor,
      first.project.id,
      input,
      key,
    );
    await expect(
      application().createValidationRun(
        actor,
        second.project.id,
        {
          ...input,
          input: {
            ...input.input,
            kind: "draft",
            draftId: second.draft.id,
            draftVersion: 1,
          },
        },
        key,
      ),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    await expect(
      application().getValidationRun(
        principal("principal_local_team_owner"),
        first.project.id,
        run.id,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    const rows = await currentDatabase().query(
      sql(
        "SELECT validation_run_id FROM validation_runs WHERE project_id = $1",
        [second.project.id],
      ),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("denies a current viewer and rechecks revoked membership before reading persisted evidence", async () => {
    const owner = principal("principal_local_team_owner");
    const created = await createProject("org_local_team", owner);
    const input: CreateValidationRunV1 = {
      contractVersion: 1,
      environment: "production",
      target: "draft",
      input: { kind: "draft", draftId: created.draft.id, draftVersion: 1 },
    };
    await expect(
      application().createValidationRun(
        principal("principal_local_team_viewer"),
        created.project.id,
        input,
        `denied_${randomUUID()}`,
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    const run = await application().createValidationRun(
      owner,
      created.project.id,
      input,
      `owner_${randomUUID()}`,
    );
    await expect(
      application().getValidationRun(
        principal("principal_local_team_viewer"),
        created.project.id,
        run.id,
      ),
    ).resolves.toEqual(run);
    await currentDatabase().query(
      sql(
        "UPDATE memberships SET lifecycle_status = 'suspended' WHERE principal_id = $1 AND organization_id = $2",
        [owner.principalId, "org_local_team"],
      ),
    );
    try {
      await expect(
        application().getValidationRun(owner, created.project.id, run.id),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        application().createValidationRun(
          owner,
          created.project.id,
          input,
          `revoked_${randomUUID()}`,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      expect((await validationState(created.project.id)).rows).toHaveLength(1);
    } finally {
      await currentDatabase().query(
        sql(
          "UPDATE memberships SET lifecycle_status = 'active' WHERE principal_id = $1 AND organization_id = $2",
          [owner.principalId, "org_local_team"],
        ),
      );
    }
  });

  it("shares an owner-created draft with its organization editor, excludes other tenants, and denies tombstoned edits", async () => {
    const owner = principal("principal_local_team_owner");
    const editor = principal("principal_local_team_editor");
    const outsider = principal("principal_local_owner");
    const created = await createProject("org_local_team", owner);
    const projectId = created.project.id;
    const page = { filters: {}, limit: 50 };

    expect(editor.principalId).not.toBe(owner.principalId);
    expect(
      (await application().listProjects(editor, "org_local_team", page)).items,
    ).toContainEqual(expect.objectContaining({ id: projectId }));
    expect(
      (await application().getProject(editor, projectId)).value,
    ).toMatchObject({ id: projectId, organizationId: "org_local_team" });
    const original = await application().getDraft(editor, projectId);
    const saved = await application().saveDraft(
      editor,
      projectId,
      {
        contractVersion: 1,
        architectureDocument: original.value.architectureDocument,
      },
      original.etag,
    );
    expect(saved.value.version).toBe(2);
    expect(await application().getDraft(owner, projectId)).toMatchObject({
      etag: saved.etag,
      value: {
        architectureDocument: saved.value.architectureDocument,
        documentDigest: saved.value.documentDigest,
        id: saved.value.id,
        projectId,
        version: 2,
      },
    });
    const persistedDraft = () =>
      currentDatabase().query(
        sql(
          `SELECT p.created_by_principal_id, p.lifecycle_status,
             d.draft_version::text, d.document_object_id, d.content_sha256
           FROM projects p JOIN architecture_drafts d
             ON d.organization_id = p.organization_id
             AND d.draft_id = p.current_draft_id
           WHERE p.organization_id = $1 AND p.project_id = $2`,
          ["org_local_team", projectId],
        ),
      );
    const beforeDenied = (await persistedDraft()).rows;
    expect(beforeDenied).toEqual([
      expect.objectContaining({
        created_by_principal_id: owner.principalId,
        draft_version: "2",
        lifecycle_status: "active",
      }),
    ]);

    for (const attempt of [
      () => application().getProject(outsider, projectId),
      () => application().getDraft(outsider, projectId),
      () => application().listProjects(outsider, "org_local_team", page),
      () =>
        application().saveDraft(
          outsider,
          projectId,
          {
            contractVersion: 1,
            architectureDocument: saved.value.architectureDocument,
          },
          saved.etag,
        ),
    ])
      await expect(attempt()).rejects.toMatchObject({ code: "not_found" });
    expect(
      (await application().listProjects(outsider, "org_local", page)).items,
    ).not.toContainEqual(expect.objectContaining({ id: projectId }));
    expect((await persistedDraft()).rows).toEqual(beforeDenied);

    const current = await application().getProject(owner, projectId);
    await expect(
      application().deleteProject(
        editor,
        projectId,
        current.etag,
        `editor_denied_${randomUUID()}`,
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    const archived = await application().archiveProject(
      owner,
      projectId,
      { contractVersion: 1 },
      current.etag,
      `owner_archive_${randomUUID()}`,
    );
    expect(archived.value.lifecycleStatus).toBe("archived");
    const closed = await application().deleteProject(
      owner,
      projectId,
      archived.etag,
      `owner_delete_${randomUUID()}`,
    );
    expect(closed.value.lifecycleStatus).toBe("deletion-pending");
    expect(closed.value.tombstoneRequestedAt).toBeDefined();
    await expect(
      application().getDraft(editor, projectId),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      application().saveDraft(
        editor,
        projectId,
        {
          contractVersion: 1,
          architectureDocument: saved.value.architectureDocument,
        },
        saved.etag,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await persistedDraft()).rows).toEqual(
      beforeDenied.map((row) => ({
        ...row,
        lifecycle_status: "deletion-pending",
      })),
    );
  });
});
