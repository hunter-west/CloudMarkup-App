import { describe, expect, it, vi } from "vitest";
import {
  permissionsForRole,
  type OrganizationRole,
} from "../../application/authorization.js";
import { InMemoryObjectStore } from "./memory-object-store.js";
import { SolutionExportArtifactObjects } from "./solution-export-artifact-objects.js";
import {
  exportPrincipal,
  exportScope,
  retainedArtifactFixture,
} from "./solution-export-artifact-test-helpers.js";
import { PostgresApprovedSolutionPackageRepository } from "./solution-export-approved-package-repository.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./sql.js";

class RetainedDatabase implements SqlDatabase {
  role: OrganizationRole = "owner";
  active = true;
  inTransaction = false;
  capabilities: string | undefined;
  row: SqlRow | undefined;
  readonly statements: SqlStatement[] = [];
  close() {
    return Promise.resolve();
  }
  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>) {
    if (this.inTransaction) throw new Error("Nested test transaction.");
    this.inTransaction = true;
    try {
      return await work(this);
    } finally {
      this.inTransaction = false;
    }
  }
  query<T extends SqlRow>(statement: SqlStatement): Promise<SqlResult<T>> {
    expect(this.inTransaction).toBe(true);
    this.statements.push(statement);
    const rows = statement.text.includes("FROM memberships")
      ? this.active
        ? [
            {
              membership_id: "membership.export-owner",
              role_key: this.role,
              capabilities_json:
                this.capabilities ??
                JSON.stringify(permissionsForRole(this.role)),
            },
          ]
        : []
      : this.row === undefined
        ? []
        : [structuredClone(this.row)];
    return Promise.resolve({ rowCount: rows.length, rows: rows as T[] });
  }
}

async function fixture() {
  const store = new InMemoryObjectStore();
  const actor = exportPrincipal();
  const scope = exportScope(actor);
  const artifact = retainedArtifactFixture();
  const input = {
    artifactId: "artifact.export",
    organizationId: scope.organizationId,
    projectId: "project.export",
  };
  const retained = await new SolutionExportArtifactObjects(store).stage(
    { ...input, artifact },
    () => Promise.resolve(scope),
  );
  const database = new RetainedDatabase();
  database.row = {
    archive_file_name: artifact.archiveFileName,
    file_count: artifact.files.length,
    manifest_object_id: retained.manifest.objectId,
    manifest_sha256: retained.manifest.contentSha256,
    manifest_size_bytes: String(retained.manifest.sizeBytes),
    archive_object_id: retained.archive.objectId,
    archive_sha256: retained.archive.contentSha256,
    size_bytes: BigInt(retained.archive.sizeBytes),
    solution_revision_id: artifact.manifest.solutionRevision.id,
    solution_manifest_sha256:
      artifact.manifest.solutionRevision.digest.slice(7),
    request_sha256: "a".repeat(64),
    target_settings_sha256: "b".repeat(64),
    target_profile_id: "cloudmarkup.export.terraform-nodejs24-v1",
    environment_type: "development",
    environment_id: null,
    ...Object.fromEntries(
      (["manifest", "archive"] as const).flatMap((kind) => [
        [`${kind}_storage_provider`, retained[kind].storageProvider],
        [`${kind}_storage_key`, retained[kind].storageKey],
        [`${kind}_object_version`, retained[kind].objectVersion],
        [`${kind}_entity_tag`, retained[kind].entityTag ?? null],
      ]),
    ),
  };
  const open = vi.spyOn(store, "open");
  open.mockImplementation(async (scope, reference) => {
    expect(database.inTransaction).toBe(false);
    return InMemoryObjectStore.prototype.open.call(store, scope, reference);
  });
  const repository = new PostgresApprovedSolutionPackageRepository({
    database,
    objectStore: store,
    principal: actor,
  });
  return { actor, artifact, database, input, open, repository, store };
}

describe("current-authority retained PostgreSQL package adapter", () => {
  it("reconstructs the exact package with checked Data API/PG integer projections and no object waits under locks", async () => {
    const f = await fixture();
    expect(await f.repository.getApprovedPackage(f.input)).toEqual({
      ...f.input,
      artifact: f.artifact,
    });
    expect(f.open).toHaveBeenCalledTimes(2);
    expect(
      f.database.statements.every(({ text }) =>
        text.trimStart().startsWith("SELECT"),
      ),
    ).toBe(true);
    expect(
      f.database.statements.filter(({ text }) =>
        text.includes("FROM solution_export_artifacts"),
      ),
    ).toHaveLength(6);
  });

  it.each(["missing", "viewer", "expired", "corrupt-policy"])(
    "rejects %s authority before storage",
    async (failure) => {
      const f = await fixture();
      if (failure === "missing") f.database.active = false;
      if (failure === "viewer") f.database.role = "viewer";
      if (failure === "corrupt-policy")
        f.database.capabilities = '["exports.run"]';
      const repository =
        failure === "expired"
          ? new PostgresApprovedSolutionPackageRepository({
              database: f.database,
              objectStore: f.store,
              principal: { ...f.actor, expiresAt: "2000-01-01T00:00:00.000Z" },
            })
          : f.repository;
      await expect(repository.getApprovedPackage(f.input)).rejects.toThrow();
      expect(f.open).not.toHaveBeenCalled();
    },
  );

  it("returns no package for absent/expired/unpublished metadata without any write or storage read", async () => {
    const f = await fixture();
    f.database.row = undefined;
    expect(await f.repository.getApprovedPackage(f.input)).toBeNull();
    expect(f.open).not.toHaveBeenCalled();
    const query = f.database.statements.find(({ text }) =>
      text.includes("FROM solution_export_artifacts"),
    );
    expect(query?.text).toContain(
      "a.retention_expires_at > GREATEST(CURRENT_TIMESTAMP",
    );
    expect(query?.text).toContain("j.lifecycle_status='succeeded'");
    expect(query?.text).toContain("m.lifecycle_state='published'");
    expect(query?.text).toContain("z.lifecycle_state='published'");
  });

  it.each(["revoke", "expire", "substitute"])(
    "discards read bytes if current authority changes: %s",
    async (failure) => {
      const f = await fixture();
      f.open.mockImplementation(async (scope, ref) => {
        const stream = await InMemoryObjectStore.prototype.open.call(
          f.store,
          scope,
          ref,
        );
        return (async function* () {
          for await (const chunk of stream) yield chunk;
          if (failure === "revoke") f.database.active = false;
          if (failure === "expire") f.database.row = undefined;
          if (failure === "substitute")
            f.database.row = {
              ...f.database.row,
              archive_object_version: "changed",
            };
        })();
      });
      await expect(f.repository.getApprovedPackage(f.input)).rejects.toThrow();
      expect(f.open).toHaveBeenCalledTimes(1);
    },
  );

  it.each([Number.MAX_SAFE_INTEGER + 1, "9007199254740992", -1, 1.5])(
    "rejects unsafe retained sizes %s",
    async (value) => {
      const f = await fixture();
      f.database.row = { ...f.database.row, size_bytes: value };
      await expect(
        f.repository.getApprovedPackage(f.input),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(f.open).not.toHaveBeenCalled();
    },
  );
});
