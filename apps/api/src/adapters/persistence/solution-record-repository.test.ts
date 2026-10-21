import { describe, expect, it } from "vitest";
import { createDataApiJsonDatabase } from "./data-api-json-test-helpers.js";

import type {
  AuthorizedOrganizationScope,
  StoredObjectReference,
} from "../../application/persistence.js";
import type { CreateSolutionRecordInput } from "../../application/solution-record-persistence.js";
import { PostgresSolutionRecordRepository } from "./solution-record-repository.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

class RecordingDatabase implements SqlDatabase {
  public readonly statements: SqlStatement[] = [];
  readonly #results: SqlResult[];

  public constructor(results: readonly SqlResult[]) {
    this.#results = [...results];
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }

  public query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    this.statements.push(statement);
    const result = this.#results.shift();
    if (result === undefined) {
      throw new Error("Missing controlled SQL result.");
    }
    return Promise.resolve(result as SqlResult<TRow>);
  }

  public transaction<TResult>(
    work: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult> {
    return work(this);
  }
}

const digest = "a".repeat(64);
const requestDigest = "b".repeat(64);
const scope: AuthorizedOrganizationScope = {
  capabilities: ["projects.read", "projects.mutate"],
  correlationId: "correlation_solution_record",
  membershipId: "membership_solution_record",
  organizationId: "organization_solution_record",
  principalId: "principal_solution_record",
  roleKey: "editor",
  sessionId: "session_solution_record",
};

const input: CreateSolutionRecordInput = {
  contentSha256: digest,
  contractVersion: 1,
  idempotencyKey: "idempotency-solution-record",
  projectId: "project_solution_record",
  recordKind: "repository-snapshot",
  requestSha256: requestDigest,
  solutionRecordId: "record_solution_snapshot",
  subjectId: "snapshot_solution_record",
};

const object: StoredObjectReference = {
  contentSha256: digest,
  entityTag: `"${digest}"`,
  mediaType: "application/vnd.cloudmarkup.repository-snapshot+json",
  objectId: "object_solution_snapshot",
  objectVersion: `sha256-${digest}`,
  owner: {
    organizationId: scope.organizationId,
    projectId: input.projectId,
  },
  purpose: "repository-snapshot",
  sizeBytes: 512,
  storageKey: `v1/organizations/${scope.organizationId}/projects/${input.projectId}/repository-snapshot/object_solution_snapshot/${digest}`,
  storageProvider: "memory",
};

function result(
  rows: readonly SqlRow[] = [],
  rowCount = rows.length,
): SqlResult {
  return { rowCount, rows };
}

function recordRow(overrides: SqlRow = {}): SqlRow {
  return {
    architecture_revision_id: null,
    content_object_id: object.objectId,
    content_sha256: digest,
    contract_version: 1,
    created_at: "2026-08-14T12:00:00.000Z",
    created_by_principal_id: scope.principalId,
    organization_id: scope.organizationId,
    previous_solution_record_id: null,
    project_id: input.projectId,
    record_kind: input.recordKind,
    solution_record_id: input.solutionRecordId,
    subject_id: input.subjectId,
    ...overrides,
  };
}

function objectRow(overrides: SqlRow = {}): SqlRow {
  return {
    content_sha256: object.contentSha256,
    entity_tag: object.entityTag,
    lifecycle_state: "publication-pending",
    media_type: object.mediaType,
    object_id: object.objectId,
    object_purpose: object.purpose,
    object_version: object.objectVersion,
    organization_id: scope.organizationId,
    project_id: input.projectId,
    size_bytes: object.sizeBytes,
    storage_key: object.storageKey,
    storage_provider: object.storageProvider,
    ...overrides,
  };
}

describe("PostgresSolutionRecordRepository", () => {
  it("normalizes Data API record metadata without altering content bindings", async () => {
    const { database, commands } = createDataApiJsonDatabase([
      [recordRow({ created_at: "2026-08-14 12:00:00.123456" })],
    ]);
    const record = await new PostgresSolutionRecordRepository(database).get(
      scope,
      input.projectId,
      input.solutionRecordId,
    );
    expect(record).toMatchObject({
      createdAt: "2026-08-14T12:00:00.123Z",
      contentSha256: digest,
      organizationId: scope.organizationId,
      solutionRecordId: input.solutionRecordId,
    });
    expect(
      commands[0]?.input.parameters?.map((item) => item.value?.stringValue),
    ).toEqual([
      scope.membershipId,
      scope.principalId,
      scope.organizationId,
      input.projectId,
      input.solutionRecordId,
    ]);
  });
  it("requires create authority and retains tenant, creator, object and lifecycle bindings for publication recovery", async () => {
    const database = new RecordingDatabase([
      result([recordRow({ record_kind: "solution-revision-manifest" })]),
    ]);
    const repository = new PostgresSolutionRecordRepository(database);
    await expect(
      repository.getManifestForPublication(
        scope,
        input.projectId,
        input.solutionRecordId,
      ),
    ).rejects.toMatchObject({ code: "access-denied" });
    expect(database.statements).toHaveLength(0);
    await expect(
      repository.getManifestForPublication(
        { ...scope, capabilities: [...scope.capabilities, "revisions.create"] },
        input.projectId,
        input.solutionRecordId,
      ),
    ).resolves.toMatchObject({ solutionRecordId: input.solutionRecordId });
    const query = database.statements[0];
    expect(query?.text).toContain(
      "o.lifecycle_state IN ('publication-pending', 'published')",
    );
    expect(query?.text).toContain("r.created_by_principal_id = $2");
    expect(query?.text).toContain(
      "r.record_kind = 'solution-revision-manifest'",
    );
    expect(query?.text).toContain("o.content_sha256 = r.content_sha256");
    expect(query?.text).toContain("o.project_id = r.project_id");
    expect(query?.text).toContain("m.lifecycle_status = 'active'");
    expect(query?.values).toEqual([
      scope.membershipId,
      scope.principalId,
      scope.organizationId,
      input.projectId,
      input.solutionRecordId,
    ]);
  });

  it.each([1, 1n, "1"])(
    "reads exact positive SQL integer projection %s",
    async (contractVersion) => {
      const repository = new PostgresSolutionRecordRepository(
        new RecordingDatabase([
          result([recordRow({ contract_version: contractVersion })]),
        ]),
      );
      await expect(
        repository.get(scope, input.projectId, input.solutionRecordId),
      ).resolves.toMatchObject({ contractVersion: 1 });
    },
  );
  it.each(["", " ", "1e1", "1.5", "-1", "01", "9007199254740992", "0"])(
    "rejects invalid positive SQL integer %s",
    async (contractVersion) => {
      const repository = new PostgresSolutionRecordRepository(
        new RecordingDatabase([
          result([recordRow({ contract_version: contractVersion })]),
        ]),
      );
      await expect(
        repository.get(scope, input.projectId, input.solutionRecordId),
      ).rejects.toMatchObject({ code: "invalid-input" });
    },
  );
  it.each(["", " ", "1e1", "1.5", "-1", "0512", "9007199254740992"])(
    "rejects invalid stored object size %s",
    async (size) => {
      const repository = new PostgresSolutionRecordRepository(
        new RecordingDatabase([
          result([{}]),
          result([{ resource_id: input.solutionRecordId }]),
          result([{}]),
          result([], 1),
          result([objectRow({ size_bytes: size })]),
        ]),
      );
      await expect(
        repository.create(scope, input, object),
      ).rejects.toMatchObject({ code: "invalid-input" });
    },
  );
  it("rejects mismatched tenant ownership, purpose, or digest before SQL", async () => {
    const database = new RecordingDatabase([]);
    const repository = new PostgresSolutionRecordRepository(database);

    await expect(
      repository.create(scope, input, {
        ...object,
        owner: {
          organizationId: "organization_other",
          projectId: input.projectId,
        },
      }),
    ).rejects.toMatchObject({
      code: "invalid-input",
    });
    await expect(
      repository.create(scope, input, {
        ...object,
        purpose: "evidence",
      }),
    ).rejects.toMatchObject({
      code: "invalid-input",
    });
    await expect(
      repository.create(scope, input, {
        ...object,
        contentSha256: "c".repeat(64),
      }),
    ).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(database.statements).toHaveLength(0);
  });

  it("requires a solution manifest to bind an architecture revision without collapsing identities", async () => {
    const database = new RecordingDatabase([]);
    const repository = new PostgresSolutionRecordRepository(database);
    const manifestInput: CreateSolutionRecordInput = {
      ...input,
      recordKind: "solution-revision-manifest",
      solutionRecordId: "record_solution_manifest",
      subjectId: "revision_solution_record",
    };

    await expect(
      repository.create(scope, manifestInput, {
        ...object,
        objectId: "object_solution_manifest",
        purpose: "solution-revision-manifest",
      }),
    ).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(database.statements).toHaveLength(0);
  });

  it("persists distinct Solution Revision and Architecture Revision identities", async () => {
    const manifestInput: CreateSolutionRecordInput = {
      ...input,
      architectureRevisionId: "architecture_revision_1",
      recordKind: "solution-revision-manifest",
      solutionRecordId: "record_solution_manifest",
      subjectId: "solution_revision_1",
    };
    const manifestObject: StoredObjectReference = {
      ...object,
      objectId: "object_solution_manifest",
      purpose: "solution-revision-manifest",
    };
    const database = new RecordingDatabase([
      result([{}]),
      result([{ resource_id: manifestInput.solutionRecordId }]),
      result([{}]),
      result([], 1),
      result([
        objectRow({
          object_id: manifestObject.objectId,
          object_purpose: manifestObject.purpose,
        }),
      ]),
      result([
        recordRow({
          architecture_revision_id: manifestInput.architectureRevisionId,
          content_object_id: manifestObject.objectId,
          record_kind: manifestInput.recordKind,
          solution_record_id: manifestInput.solutionRecordId,
          subject_id: manifestInput.subjectId,
        }),
      ]),
      result([], 1),
    ]);
    const repository = new PostgresSolutionRecordRepository(database);

    await expect(
      repository.create(scope, manifestInput, manifestObject),
    ).resolves.toEqual(
      expect.objectContaining({
        architectureRevisionId: "architecture_revision_1",
        recordKind: "solution-revision-manifest",
        solutionRecordId: "record_solution_manifest",
        subjectId: "solution_revision_1",
      }),
    );
  });

  it("creates tenant-scoped immutable metadata using parameterized values", async () => {
    const database = new RecordingDatabase([
      result([{}]),
      result([{ resource_id: input.solutionRecordId }]),
      result([{}]),
      result([], 1),
      result([objectRow()]),
      result([recordRow()]),
      result([], 1),
    ]);
    const repository = new PostgresSolutionRecordRepository(database);

    await expect(repository.create(scope, input, object)).resolves.toEqual({
      contentObjectId: object.objectId,
      contentSha256: digest,
      contractVersion: 1,
      createdAt: "2026-08-14T12:00:00.000Z",
      createdByPrincipalId: scope.principalId,
      organizationId: scope.organizationId,
      projectId: input.projectId,
      recordKind: input.recordKind,
      solutionRecordId: input.solutionRecordId,
      subjectId: input.subjectId,
    });
    const sqlText = database.statements
      .map((statement) => statement.text)
      .join("\n");
    expect(sqlText).toContain("m.organization_id = $3");
    expect(sqlText).toContain("INSERT INTO solution_records");
    expect(sqlText).not.toContain(input.solutionRecordId);
    expect(database.statements.flatMap(({ values }) => values)).toContain(
      input.solutionRecordId,
    );
  });

  it("hides pending and cross-tenant records behind membership and publication predicates", async () => {
    const database = new RecordingDatabase([result()]);
    const repository = new PostgresSolutionRecordRepository(database);

    await expect(
      repository.get(scope, input.projectId, input.solutionRecordId),
    ).resolves.toBeNull();
    expect(database.statements[0]?.text).toContain(
      "o.lifecycle_state = 'published'",
    );
    expect(database.statements[0]?.text).toContain("m.membership_id = $1");
    expect(database.statements[0]?.values).toEqual([
      scope.membershipId,
      scope.principalId,
      scope.organizationId,
      input.projectId,
      input.solutionRecordId,
    ]);
  });

  it("fails a changed idempotent replay closed", async () => {
    const database = new RecordingDatabase([
      result([{}]),
      result(),
      result([
        {
          lifecycle_status: "completed",
          principal_id: scope.principalId,
          request_sha256: "c".repeat(64),
          resource_id: input.solutionRecordId,
          resource_kind: "solution-record",
        },
      ]),
    ]);
    const repository = new PostgresSolutionRecordRepository(database);

    await expect(repository.create(scope, input, object)).rejects.toMatchObject(
      { code: "idempotency-conflict" },
    );
  });

  it("replays a completed solution record after the project is archived", async () => {
    const database = new RecordingDatabase([
      result([{}]),
      result(),
      result([
        {
          lifecycle_status: "completed",
          principal_id: scope.principalId,
          request_sha256: input.requestSha256,
          resource_id: input.solutionRecordId,
          resource_kind: "solution-record",
        },
      ]),
      result([recordRow()]),
    ]);
    const repository = new PostgresSolutionRecordRepository(database);

    await expect(
      repository.create(scope, input, object),
    ).resolves.toMatchObject({
      solutionRecordId: input.solutionRecordId,
    });
    expect(
      database.statements.some((statement) =>
        statement.text.includes("FROM projects p"),
      ),
    ).toBe(false);
    expect(
      database.statements.some((statement) =>
        statement.text.includes("INSERT INTO stored_objects"),
      ),
    ).toBe(false);
  });
});
