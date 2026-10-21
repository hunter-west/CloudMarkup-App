import { createHash } from "node:crypto";

import { projectEnvironmentV1Schema } from "@cloudmarkup/api-contract";
import { describe, expect, it } from "vitest";
import { createDataApiJsonDatabase } from "./data-api-json-test-helpers.js";

import { permissionsForRole } from "../../application/authorization.js";
import type {
  AuthorizedOrganizationScope,
  StoredObjectReference,
  VerifiedPrincipalContext,
} from "../../application/persistence.js";
import { PostgresCloudMarkupRepository } from "./repositories.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

class RecordingDatabase implements SqlDatabase {
  readonly statements: SqlStatement[] = [];
  readonly #results: SqlResult[];

  constructor(results: readonly SqlResult[]) {
    this.#results = [...results];
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    this.statements.push(statement);
    const result = this.#results.shift();
    if (result === undefined) {
      throw new Error("Missing controlled SQL result.");
    }
    return Promise.resolve(result as SqlResult<TRow>);
  }

  transaction<TResult>(
    work: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult> {
    return work(this);
  }
}

const principal: VerifiedPrincipalContext = {
  correlationId: "correlation_repository_test",
  principalId: "principal_repository_test",
  sessionId: "session_repository_test",
};

const scope: AuthorizedOrganizationScope = {
  ...principal,
  capabilities: permissionsForRole("owner"),
  membershipId: "membership_repository_test",
  organizationId: "organization_repository_test",
  roleKey: "owner",
};

const digest = createHash("sha256").update("repository-test").digest("hex");

function result(
  rows: readonly SqlRow[] = [],
  rowCount = rows.length,
): SqlResult {
  return { rowCount, rows };
}

describe("PostgreSQL repositories", () => {
  it("normalizes Data API environment timestamps for the public response contract", async () => {
    const { database, commands } = createDataApiJsonDatabase([
      [
        {
          environment_id: "env_data_api",
          organization_id: scope.organizationId,
          project_id: "project_data_api",
          name: "Development",
          environment_type: "development",
          region: "us-east-1",
          record_version: "1",
          lifecycle_status: "active",
          deletion_requested_at: null,
          created_at: "2026-09-14 12:34:56.123456",
          updated_at: "2026-09-14 12:34:57",
        },
      ],
    ]);
    const records = await new PostgresCloudMarkupRepository(
      database,
    ).listProjectEnvironments(scope, "project_data_api");
    expect(records[0]).toMatchObject({
      createdAt: "2026-09-14T12:34:56.123Z",
      updatedAt: "2026-09-14T12:34:57.000Z",
    });
    const record = records[0];
    if (record === undefined) throw new Error("Expected environment record");
    expect(() =>
      projectEnvironmentV1Schema.parse({
        createdAt: record.createdAt,
        environmentType: record.environmentType,
        id: record.environmentId,
        lifecycleStatus: record.lifecycleStatus,
        name: record.name,
        projectId: record.projectId,
        region: record.region,
        updatedAt: record.updatedAt,
        version: record.recordVersion,
      }),
    ).not.toThrow();
    expect(commands[0]?.input.formatRecordsAs).toBe("JSON");
    expect(
      commands[0]?.input.parameters?.map((item) => item.value?.stringValue),
    ).toEqual([
      scope.membershipId,
      scope.principalId,
      scope.organizationId,
      "project_data_api",
    ]);
  });

  it("derives an authorized organization scope from active membership data", async () => {
    const database = new RecordingDatabase([
      result([
        {
          membership_id: "membership_repository_test",
          role_key: "owner",
        },
      ]),
    ]);
    const repository = new PostgresCloudMarkupRepository(database);

    await expect(
      repository.resolveOrganizationScope(
        principal,
        "organization_repository_test",
      ),
    ).resolves.toEqual({
      ...scope,
    });
    expect(database.statements[0]?.values).toEqual([
      principal.principalId,
      scope.organizationId,
    ]);
  });

  it("keeps tenant selectors and injection-shaped values out of SQL text", async () => {
    const projectId = "project_repository_test";
    const draftId = "draft_repository_test";
    const objectId = "object_repository_test";
    const idempotencyKey = "idempotency-key-repository-test";
    const projectName = "Name'); DROP TABLE projects; --";
    const object: StoredObjectReference = {
      contentSha256: digest,
      entityTag: `"${digest}"`,
      mediaType: "application/vnd.cloudmarkup.architecture+json",
      objectId,
      objectVersion: `sha256-${digest}`,
      owner: {
        organizationId: scope.organizationId,
        projectId,
      },
      purpose: "architecture-draft",
      sizeBytes: 42,
      storageKey: `v1/organizations/${scope.organizationId}/projects/${projectId}/architecture-draft/${objectId}/${digest}`,
      storageProvider: "memory",
    };
    const database = new RecordingDatabase([
      result([{}]),
      result(),
      result([], 1),
      result([], 1),
      result([], 1),
      result([
        {
          content_sha256: digest,
          entity_tag: object.entityTag,
          lifecycle_state: "publication-pending",
          media_type: object.mediaType,
          object_id: objectId,
          object_purpose: object.purpose,
          object_version: object.objectVersion,
          organization_id: scope.organizationId,
          project_id: projectId,
          size_bytes: object.sizeBytes,
          storage_key: object.storageKey,
          storage_provider: object.storageProvider,
        },
      ]),
      result([], 1),
      result([], 1),
      result([], 1),
      result([], 1),
      result([
        {
          created_at: "2026-08-03 12:00:00.043717",
          current_draft_id: draftId,
          deletion_requested_at: null,
          description: null,
          latest_revision_id: null,
          lifecycle_status: "active",
          name: projectName,
          organization_id: scope.organizationId,
          project_id: projectId,
          record_version: 1,
          updated_at: "2026-08-03 12:00:00.043717",
        },
      ]),
    ]);
    const repository = new PostgresCloudMarkupRepository(database);

    const created = await repository.createProjectWithInitialDraft(
      scope,
      {
        draft: {
          contentSha256: digest,
          documentSchemaVersion: 2,
          draftId,
          semanticSha256: digest,
          visualSha256: digest,
        },
        idempotencyKey,
        name: projectName,
        projectId,
        requestSha256: digest,
      },
      object,
    );

    expect(created.createdAt).toBe("2026-08-03T12:00:00.043Z");
    expect(created.updatedAt).toBe("2026-08-03T12:00:00.043Z");

    const sqlText = database.statements
      .map((statement) => statement.text)
      .join("\n");
    expect(sqlText).not.toContain(projectName);
    expect(sqlText).not.toContain(idempotencyKey);
    expect(sqlText).not.toContain(scope.organizationId);
    expect(
      database.statements.flatMap((statement) => statement.values),
    ).toContain(projectName);
    expect(sqlText).toContain("m.principal_id");
    expect(sqlText).toContain("m.organization_id");
  });

  it("includes membership, principal, tenant, and project predicates on draft reads", async () => {
    const database = new RecordingDatabase([result()]);
    const repository = new PostgresCloudMarkupRepository(database);

    await expect(
      repository.getDraft(scope, "project_repository_test"),
    ).resolves.toBeNull();

    expect(database.statements[0]?.values).toEqual([
      scope.membershipId,
      scope.principalId,
      scope.organizationId,
      "project_repository_test",
    ]);
    expect(database.statements[0]?.text).toContain(
      "o.lifecycle_state = 'published'",
    );
  });

  it("binds immutable revisions to one active successful validated source draft", async () => {
    const projectId = "project_revision_test";
    const validationRunId = "validation_revision_test";
    const revisionDigest = createHash("sha256")
      .update("immutable-revision")
      .digest("hex");
    const divergentDigest = createHash("sha256")
      .update("divergent-draft")
      .digest("hex");
    const object: StoredObjectReference = {
      contentSha256: revisionDigest,
      mediaType: "application/vnd.cloudmarkup.architecture+json",
      objectId: "object_revision_test",
      objectVersion: "sha256-" + revisionDigest,
      owner: {
        organizationId: scope.organizationId,
        projectId,
      },
      purpose: "architecture-revision",
      sizeBytes: 42,
      storageKey:
        "v1/organizations/organization_repository_test/projects/project_revision_test/architecture-revision/object_revision_test",
      storageProvider: "memory",
    };
    const database = new RecordingDatabase([
      result([{}]),
      result(),
      result([], 1),
      result([{}]),
      result([
        {
          content_sha256: digest,
          semantic_sha256: divergentDigest,
          visual_sha256: digest,
        },
      ]),
    ]);
    const repository = new PostgresCloudMarkupRepository(database);

    await expect(
      repository.createRevision(
        scope,
        {
          catalogId: "catalog_revision_test",
          catalogSha256: digest,
          catalogVersion: "1.0.0",
          compilerInputContractVersion: 1,
          contentSha256: revisionDigest,
          createdAt: "2026-08-15T12:00:00.000Z",
          expectedDraftVersion: 3,
          graphSchemaVersion: 3,
          idempotencyKey: "revision-repository-create",
          minimumCompilerVersion: "0.1.0",
          name: "Repository revision",
          projectId,
          revisionId: "revision_repository_test",
          revisionNumber: 1,
          requestSha256: digest,
          semanticSha256: revisionDigest,
          sourceDraftContentSha256: digest,
          sourceDraftId: "draft_repository_test",
          sourceDraftSemanticSha256: digest,
          sourceDraftVisualSha256: digest,
          validationRunId,
          visualSha256: revisionDigest,
          workloadBehaviorVersion: 2,
        },
        object,
      ),
    ).rejects.toMatchObject({ code: "version-conflict" });

    expect(database.statements).toHaveLength(5);
    expect(database.statements[3]?.text).toContain(
      "lifecycle_status = 'active'",
    );
    expect(database.statements[3]?.text).toContain("FOR UPDATE");
    expect(database.statements[4]?.text).toContain(
      "v.lifecycle_status = 'succeeded'",
    );
    expect(database.statements[4]?.text).toContain(
      "p.lifecycle_status = 'active'",
    );
    expect(database.statements[4]?.values).toEqual([
      scope.organizationId,
      projectId,
      "draft_repository_test",
      3,
      validationRunId,
    ]);
  });
  it("persists rebound immutable revision hashes and createdAt after exact source validation", async () => {
    const projectId = "project_revision_success";
    const revisionDigest = createHash("sha256")
      .update("revision-success")
      .digest("hex");
    const createdAt = "2026-08-15T12:00:00.000Z";
    const object: StoredObjectReference = {
      contentSha256: revisionDigest,
      mediaType: "application/vnd.cloudmarkup.architecture+json",
      objectId: "object_revision_success",
      objectVersion: "sha256-" + revisionDigest,
      owner: { organizationId: scope.organizationId, projectId },
      purpose: "architecture-revision",
      sizeBytes: 42,
      storageKey: "local/revision-success",
      storageProvider: "memory",
    };
    const revisionRow = {
      catalog_id: "catalog_revision_test",
      catalog_sha256: digest,
      catalog_version: "1.0.0",
      compiler_input_contract_version: 1,
      content_sha256: revisionDigest,
      created_at: createdAt,
      document_object_id: object.objectId,
      graph_schema_version: 3,
      maximum_compiler_version_exclusive: null,
      minimum_compiler_version: "1.0.0",
      organization_id: scope.organizationId,
      previous_revision_id: null,
      project_id: projectId,
      revision_id: "revision_success",
      revision_name: "Successful revision",
      revision_number: 1,
      semantic_sha256: revisionDigest,
      source_draft_id: "draft_success",
      source_draft_version: 2,
      validation_run_id: "validation_success",
      visual_sha256: revisionDigest,
      workload_behavior_version: 2,
    };
    const database = new RecordingDatabase([
      result([{}]),
      result(),
      result([], 1),
      result([{}]),
      result([
        {
          content_sha256: digest,
          semantic_sha256: digest,
          visual_sha256: digest,
        },
      ]),
      result([], 1),
      result([
        {
          content_sha256: revisionDigest,
          delete_requested_at: null,
          deleted_at: null,
          entity_tag: null,
          lifecycle_state: "publication-pending",
          media_type: object.mediaType,
          object_id: object.objectId,
          object_purpose: object.purpose,
          object_version: object.objectVersion,
          organization_id: scope.organizationId,
          project_id: projectId,
          size_bytes: object.sizeBytes,
          storage_key: object.storageKey,
          storage_provider: object.storageProvider,
        },
      ]),
      result([revisionRow]),
      result([], 1),
      result([], 1),
    ]);
    const repository = new PostgresCloudMarkupRepository(database);

    await expect(
      repository.createRevision(
        scope,
        {
          catalogId: "catalog_revision_test",
          catalogSha256: digest,
          catalogVersion: "1.0.0",
          compilerInputContractVersion: 1,
          contentSha256: revisionDigest,
          createdAt,
          expectedDraftVersion: 2,
          graphSchemaVersion: 3,
          idempotencyKey: "revision-success-create",
          minimumCompilerVersion: "1.0.0",
          name: "Successful revision",
          projectId,
          revisionId: "revision_success",
          revisionNumber: 1,
          requestSha256: digest,
          semanticSha256: revisionDigest,
          sourceDraftContentSha256: digest,
          sourceDraftId: "draft_success",
          sourceDraftSemanticSha256: digest,
          sourceDraftVisualSha256: digest,
          validationRunId: "validation_success",
          visualSha256: revisionDigest,
          workloadBehaviorVersion: 2,
        },
        object,
      ),
    ).resolves.toMatchObject({
      contentSha256: revisionDigest,
      createdAt,
      sourceDraftId: "draft_success",
      sourceDraftVersion: 2,
    });

    const insert = database.statements.find((statement) =>
      statement.text.includes("INSERT INTO architecture_revisions"),
    );
    expect(insert?.values).toHaveLength(23);
    expect(insert?.values[4]).toBe(revisionDigest);
    expect(insert?.values[16]).toBe(createdAt);
  });
  it("uses one atomic draft compare-and-swap guarded by tenant and version", async () => {
    const projectId = "project_draft_cas";
    const draftId = "draft_draft_cas";
    const objectId = "object_draft_cas";
    const storageKey = `v1/organizations/${scope.organizationId}/projects/${projectId}/architecture-draft/${objectId}/${digest}`;
    const object: StoredObjectReference = {
      contentSha256: digest,
      mediaType: "application/vnd.cloudmarkup.architecture+json",
      objectId,
      objectVersion: `sha256-${digest}`,
      owner: { organizationId: scope.organizationId, projectId },
      purpose: "architecture-draft",
      sizeBytes: 42,
      storageKey,
      storageProvider: "memory",
    };
    const database = new RecordingDatabase([
      result([{}]),
      result([
        {
          content_sha256: digest,
          document_object_id: "object_previous_draft",
          document_schema_version: 2,
          draft_id: draftId,
          draft_version: 7,
          organization_id: scope.organizationId,
          pending_content_sha256: null,
          pending_document_object_id: null,
          pending_document_schema_version: null,
          pending_draft_version: null,
          pending_semantic_sha256: null,
          pending_visual_sha256: null,
          project_id: projectId,
          project_lifecycle_status: "active",
          semantic_sha256: digest,
          visual_sha256: digest,
        },
      ]),
      result([], 1),
      result([
        {
          content_sha256: digest,
          delete_requested_at: null,
          deleted_at: null,
          entity_tag: null,
          lifecycle_state: "publication-pending",
          media_type: object.mediaType,
          object_id: object.objectId,
          object_purpose: object.purpose,
          object_version: object.objectVersion,
          organization_id: scope.organizationId,
          project_id: projectId,
          size_bytes: object.sizeBytes,
          storage_key: storageKey,
          storage_provider: object.storageProvider,
        },
      ]),
      result([], 0),
    ]);
    const repository = new PostgresCloudMarkupRepository(database);

    await expect(
      repository.updateDraft(
        scope,
        {
          contentSha256: digest,
          documentSchemaVersion: 2,
          draftId,
          expectedDraftVersion: 7,
          projectId,
          semanticSha256: digest,
          visualSha256: digest,
        },
        object,
      ),
    ).rejects.toMatchObject({ code: "version-conflict" });

    const projectLock = database.statements[1];
    expect(projectLock?.text).toContain("project_lifecycle_status");
    expect(projectLock?.text).toContain("FOR UPDATE");
    const update = database.statements[4];
    expect(update?.text).toContain("draft_version = $10");
    expect(update?.text).toContain("pending_document_object_id IS NULL");
    expect(update?.text).toContain("p.lifecycle_status = 'active'");
    expect(update?.values).toEqual([
      2,
      objectId,
      digest,
      digest,
      digest,
      scope.principalId,
      scope.organizationId,
      projectId,
      draftId,
      7,
    ]);
  });

  it("rejects a draft CAS before staging metadata when the project is not active", async () => {
    const projectId = "project_draft_archived";
    const object: StoredObjectReference = {
      contentSha256: digest,
      mediaType: "application/vnd.cloudmarkup.architecture+json",
      objectId: "object_draft_archived",
      objectVersion: "sha256-" + digest,
      owner: { organizationId: scope.organizationId, projectId },
      purpose: "architecture-draft",
      sizeBytes: 42,
      storageKey: "local/draft-archived",
      storageProvider: "memory",
    };
    const database = new RecordingDatabase([
      result([{}]),
      result([
        {
          content_sha256: digest,
          document_object_id: "object_archived_current",
          document_schema_version: 3,
          draft_id: "draft_archived",
          draft_version: 1,
          organization_id: scope.organizationId,
          pending_content_sha256: null,
          pending_document_object_id: null,
          pending_document_schema_version: null,
          pending_draft_version: null,
          pending_semantic_sha256: null,
          pending_visual_sha256: null,
          project_id: projectId,
          project_lifecycle_status: "archived",
          semantic_sha256: digest,
          visual_sha256: digest,
        },
      ]),
    ]);
    const repository = new PostgresCloudMarkupRepository(database);

    await expect(
      repository.updateDraft(
        scope,
        {
          contentSha256: digest,
          documentSchemaVersion: 3,
          draftId: "draft_archived",
          expectedDraftVersion: 1,
          projectId,
          semanticSha256: digest,
          visualSha256: digest,
        },
        object,
      ),
    ).rejects.toMatchObject({ code: "version-conflict" });

    expect(database.statements).toHaveLength(2);
    expect(database.statements[1]?.text).toContain("FOR UPDATE");
    expect(database.statements[1]?.text).toContain("project_lifecycle_status");
    expect(
      database.statements.some((statement) =>
        statement.text.includes("INSERT INTO stored_objects"),
      ),
    ).toBe(false);
  });

  it("replays an exact published draft save after the project is archived", async () => {
    const projectId = "project_draft_archived_replay";
    const draftId = "draft_archived_replay";
    const object: StoredObjectReference = {
      contentSha256: digest,
      mediaType: "application/vnd.cloudmarkup.architecture+json",
      objectId: "object_draft_archived_replay",
      objectVersion: "sha256-" + digest,
      owner: { organizationId: scope.organizationId, projectId },
      purpose: "architecture-draft",
      sizeBytes: 42,
      storageKey: "local/draft-archived-replay",
      storageProvider: "memory",
    };
    const database = new RecordingDatabase([
      result([{}]),
      result([
        {
          content_sha256: digest,
          document_object_id: object.objectId,
          document_schema_version: 3,
          draft_id: draftId,
          draft_version: 2,
          organization_id: scope.organizationId,
          pending_content_sha256: null,
          pending_document_object_id: null,
          pending_document_schema_version: null,
          pending_draft_version: null,
          pending_semantic_sha256: null,
          pending_visual_sha256: null,
          project_id: projectId,
          project_lifecycle_status: "archived",
          semantic_sha256: digest,
          visual_sha256: digest,
        },
      ]),
      result([
        {
          content_sha256: digest,
          delete_requested_at: null,
          deleted_at: null,
          entity_tag: null,
          lifecycle_state: "published",
          media_type: object.mediaType,
          object_id: object.objectId,
          object_purpose: object.purpose,
          object_version: object.objectVersion,
          organization_id: scope.organizationId,
          project_id: projectId,
          size_bytes: object.sizeBytes,
          storage_key: object.storageKey,
          storage_provider: object.storageProvider,
        },
      ]),
    ]);
    const repository = new PostgresCloudMarkupRepository(database);

    await expect(
      repository.updateDraft(
        scope,
        {
          contentSha256: digest,
          documentSchemaVersion: 3,
          draftId,
          expectedDraftVersion: 1,
          projectId,
          semanticSha256: digest,
          visualSha256: digest,
        },
        object,
      ),
    ).resolves.toMatchObject({
      draftVersion: 2,
      documentObjectId: object.objectId,
    });
    expect(database.statements).toHaveLength(3);
    expect(
      database.statements.some((statement) =>
        statement.text.includes("UPDATE architecture_drafts AS d"),
      ),
    ).toBe(false);
  });

  it("replays exact pending draft metadata without overwriting it", async () => {
    const projectId = "project_draft_pending_replay";
    const draftId = "draft_pending_replay";
    const object: StoredObjectReference = {
      contentSha256: digest,
      mediaType: "application/vnd.cloudmarkup.architecture+json",
      objectId: "object_draft_pending_replay",
      objectVersion: "sha256-" + digest,
      owner: { organizationId: scope.organizationId, projectId },
      purpose: "architecture-draft",
      sizeBytes: 42,
      storageKey: "local/draft-pending-replay",
      storageProvider: "memory",
    };
    const database = new RecordingDatabase([
      result([{}]),
      result([
        {
          content_sha256: digest,
          document_object_id: "object_previous_pending_replay",
          document_schema_version: 3,
          draft_id: draftId,
          draft_version: 1,
          organization_id: scope.organizationId,
          pending_content_sha256: digest,
          pending_document_object_id: object.objectId,
          pending_document_schema_version: 3,
          pending_draft_version: 2,
          pending_semantic_sha256: digest,
          pending_visual_sha256: digest,
          project_id: projectId,
          project_lifecycle_status: "active",
          semantic_sha256: digest,
          visual_sha256: digest,
        },
      ]),
      result([
        {
          content_sha256: digest,
          delete_requested_at: null,
          deleted_at: null,
          entity_tag: null,
          lifecycle_state: "publication-pending",
          media_type: object.mediaType,
          object_id: object.objectId,
          object_purpose: object.purpose,
          object_version: object.objectVersion,
          organization_id: scope.organizationId,
          project_id: projectId,
          size_bytes: object.sizeBytes,
          storage_key: object.storageKey,
          storage_provider: object.storageProvider,
        },
      ]),
    ]);
    const repository = new PostgresCloudMarkupRepository(database);

    await expect(
      repository.updateDraft(
        scope,
        {
          contentSha256: digest,
          documentSchemaVersion: 3,
          draftId,
          expectedDraftVersion: 1,
          projectId,
          semanticSha256: digest,
          visualSha256: digest,
        },
        object,
      ),
    ).resolves.toMatchObject({
      draftVersion: 2,
      documentObjectId: object.objectId,
    });
    expect(database.statements).toHaveLength(3);
    expect(
      database.statements.some((statement) =>
        statement.text.includes("UPDATE architecture_drafts AS d"),
      ),
    ).toBe(false);
  });

  it("rejects a new revision before object metadata when the project is not active", async () => {
    const projectId = "project_revision_archived";
    const object: StoredObjectReference = {
      contentSha256: digest,
      mediaType: "application/vnd.cloudmarkup.architecture+json",
      objectId: "object_revision_archived",
      objectVersion: "sha256-" + digest,
      owner: { organizationId: scope.organizationId, projectId },
      purpose: "architecture-revision",
      sizeBytes: 42,
      storageKey: "local/revision-archived",
      storageProvider: "memory",
    };
    const database = new RecordingDatabase([
      result([{}]),
      result(),
      result([], 1),
      result(),
    ]);
    const repository = new PostgresCloudMarkupRepository(database);

    await expect(
      repository.createRevision(
        scope,
        {
          catalogId: "catalog_revision_test",
          catalogSha256: digest,
          catalogVersion: "1.0.0",
          compilerInputContractVersion: 1,
          contentSha256: digest,
          createdAt: "2026-08-15T12:00:00.000Z",
          expectedDraftVersion: 1,
          graphSchemaVersion: 3,
          idempotencyKey: "revision-archived-create",
          minimumCompilerVersion: "1.0.0",
          name: "Archived revision",
          projectId,
          revisionId: "revision_archived",
          revisionNumber: 1,
          requestSha256: digest,
          semanticSha256: digest,
          sourceDraftContentSha256: digest,
          sourceDraftId: "draft_archived",
          sourceDraftSemanticSha256: digest,
          sourceDraftVisualSha256: digest,
          validationRunId: "validation_archived",
          visualSha256: digest,
          workloadBehaviorVersion: 2,
        },
        object,
      ),
    ).rejects.toMatchObject({ code: "version-conflict" });

    expect(database.statements).toHaveLength(4);
    expect(database.statements[3]?.text).toContain("FOR UPDATE");
    expect(database.statements[3]?.text).toContain(
      "lifecycle_status = 'active'",
    );
    expect(
      database.statements.some(
        (statement) =>
          statement.text.includes("INSERT INTO stored_objects") ||
          statement.text.includes("INSERT INTO architecture_revisions"),
      ),
    ).toBe(false);
  });

  it("keeps authorized environment creation idempotent behind current authority and project locks", async () => {
    const projectId = "project_environment_create";
    const environmentId = "environment_create";
    const idempotencyKey = "environment-create-authorized";
    const environment = {
      created_at: "2026-09-05T12:00:00.000Z",
      deletion_requested_at: null,
      environment_id: environmentId,
      environment_type: "development",
      lifecycle_status: "active",
      name: "Development",
      organization_id: scope.organizationId,
      project_id: projectId,
      record_version: 1,
      region: "us-east-1",
      updated_at: "2026-09-05T12:00:00.000Z",
    };
    const database = new RecordingDatabase([
      result([
        {
          membership_id: scope.membershipId,
          role_key: "editor",
        },
      ]),
      result([{}]),
      result(),
      result([], 1),
      result([], 1),
      result([], 1),
      result([], 1),
      result([environment]),
    ]);
    const repository = new PostgresCloudMarkupRepository(database);

    await expect(
      repository.createProjectEnvironment(scope, {
        environmentId,
        environmentType: "development",
        idempotencyKey,
        name: "Development",
        projectId,
        region: "us-east-1",
        requestSha256: digest,
      }),
    ).resolves.toMatchObject({
      environmentId,
      organizationId: scope.organizationId,
      projectId,
      recordVersion: 1,
    });

    expect(database.statements).toHaveLength(8);
    expect(database.statements[0]?.text).toContain(
      "FOR SHARE OF m, principal_record, o, r",
    );
    expect(database.statements[0]?.text).toContain(
      "principal_record.lifecycle_status = 'active'",
    );
    expect(database.statements[0]?.text).toContain(
      "r.policy_version = 'authorization-v2'",
    );
    expect(database.statements[1]?.text).toContain(
      "lifecycle_status = 'active'",
    );
    expect(database.statements[1]?.text).toContain("FOR UPDATE");
    expect(database.statements[1]?.values).toEqual([
      scope.organizationId,
      projectId,
    ]);
    expect(database.statements[2]?.text).toContain("FROM idempotency_records");
    expect(database.statements[2]?.values.slice(0, 3)).toEqual([
      scope.organizationId,
      scope.principalId,
      "environments.create",
    ]);
    expect(database.statements[4]?.text).toContain(
      "INSERT INTO project_environments",
    );
    expect(database.statements[4]?.values).toEqual([
      environmentId,
      "Development",
      "development",
      "us-east-1",
      scope.organizationId,
      projectId,
    ]);
  });

  it("preserves environment update CAS for a currently authorized editor", async () => {
    const projectId = "project_environment_update";
    const environmentId = "environment_update";
    const database = new RecordingDatabase([
      result([
        {
          membership_id: scope.membershipId,
          role_key: "editor",
        },
      ]),
      result([{}]),
      result([
        {
          created_at: "2026-09-05T12:00:00.000Z",
          deletion_requested_at: null,
          environment_id: environmentId,
          environment_type: "staging",
          lifecycle_status: "active",
          name: "Staging",
          organization_id: scope.organizationId,
          project_id: projectId,
          record_version: 2,
          region: "us-west-2",
          updated_at: "2026-09-05T12:01:00.000Z",
        },
      ]),
      result([], 1),
    ]);
    const repository = new PostgresCloudMarkupRepository(database);

    await expect(
      repository.updateProjectEnvironment(scope, {
        environmentId,
        environmentType: "staging",
        expectedRecordVersion: 1,
        name: "Staging",
        projectId,
        region: "us-west-2",
      }),
    ).resolves.toMatchObject({
      environmentId,
      recordVersion: 2,
    });

    expect(database.statements).toHaveLength(4);
    expect(database.statements[2]?.text).toContain("e.record_version = $9");
    expect(database.statements[2]?.values).toEqual([
      scope.membershipId,
      scope.principalId,
      scope.organizationId,
      "Staging",
      "staging",
      "us-west-2",
      projectId,
      environmentId,
      1,
    ]);
  });

  it("rejects environment writes after demotion, suspension, or project archive interleavings", async () => {
    const projectId = "project_environment_interleaving";
    const environmentId = "environment_interleaving";
    const demoted = new RecordingDatabase([
      result([
        {
          membership_id: scope.membershipId,
          role_key: "viewer",
        },
      ]),
    ]);
    const suspended = new RecordingDatabase([result()]);
    const archived = new RecordingDatabase([
      result([
        {
          membership_id: scope.membershipId,
          role_key: "owner",
        },
      ]),
      result(),
    ]);

    await expect(
      new PostgresCloudMarkupRepository(demoted).createProjectEnvironment(
        scope,
        {
          environmentId,
          environmentType: "development",
          idempotencyKey: "environment-create-interleaving",
          name: "Development",
          projectId,
          requestSha256: digest,
        },
      ),
    ).rejects.toMatchObject({ code: "access-denied" });
    await expect(
      new PostgresCloudMarkupRepository(suspended).updateProjectEnvironment(
        scope,
        {
          environmentId,
          environmentType: "staging",
          expectedRecordVersion: 1,
          name: "Staging",
          projectId,
        },
      ),
    ).rejects.toMatchObject({ code: "access-denied" });
    await expect(
      new PostgresCloudMarkupRepository(archived).deleteProjectEnvironment(
        scope,
        {
          environmentId,
          expectedRecordVersion: 1,
          idempotencyKey: "environment-delete-interleaving",
          projectId,
          requestSha256: digest,
        },
      ),
    ).rejects.toMatchObject({ code: "version-conflict" });

    expect(demoted.statements).toHaveLength(1);
    expect(suspended.statements).toHaveLength(1);
    expect(archived.statements).toHaveLength(2);
    expect(suspended.statements[0]?.text).toContain(
      "m.lifecycle_status = 'active'",
    );
    expect(suspended.statements[0]?.text).toContain(
      "o.lifecycle_status = 'active'",
    );
    expect(suspended.statements[0]?.text).toContain(
      "principal_record.lifecycle_status = 'active'",
    );
    expect(archived.statements[1]?.text).toContain(
      "lifecycle_status = 'active'",
    );
    expect(archived.statements[1]?.text).toContain("FOR UPDATE");
    for (const database of [demoted, suspended, archived]) {
      expect(
        database.statements.some(
          ({ text }) =>
            text.includes("INSERT INTO idempotency_records") ||
            text.includes("INSERT INTO project_environments") ||
            text.includes("UPDATE project_environments"),
        ),
      ).toBe(false);
    }
  });

  it("writes a successful project lifecycle audit in the metadata transaction", async () => {
    const projectId = "project_rename_audit";
    const database = new RecordingDatabase([
      result([{}]),
      result([
        {
          created_at: "2026-08-03T12:00:00.000Z",
          current_draft_id: "draft_rename_audit",
          deletion_requested_at: null,
          description: null,
          latest_revision_id: null,
          lifecycle_status: "active",
          name: "Renamed safely",
          organization_id: scope.organizationId,
          project_id: projectId,
          record_version: 2,
          updated_at: "2026-08-03T12:01:00.000Z",
        },
      ]),
      result([], 1),
    ]);
    const repository = new PostgresCloudMarkupRepository(database);

    await expect(
      repository.renameProject(scope, {
        expectedRecordVersion: 1,
        name: "Renamed safely",
        projectId,
      }),
    ).resolves.toMatchObject({ name: "Renamed safely", recordVersion: 2 });

    expect(database.statements).toHaveLength(3);
    expect(database.statements[2]?.text).toContain("INSERT INTO audit_events");
    expect(database.statements[2]?.values).toContain("project.renamed");
    expect(database.statements[2]?.values).toContain(projectId);
  });
});
