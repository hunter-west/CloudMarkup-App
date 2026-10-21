import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../migrations/0012_solution_export_read_model.sql",
  import.meta.url,
);
const manifestUrl = new URL(
  "../../../migrations/manifest.json",
  import.meta.url,
);

describe("Solution Export read-model migration", () => {
  it("pins additive migration 0012 without coercing legacy artifacts", async () => {
    const [migration, manifestText] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(manifestUrl, "utf8"),
    ]);
    const manifest = JSON.parse(manifestText) as {
      readonly migrations: readonly {
        readonly checksumSha256: string;
        readonly file: string;
        readonly version: string;
      }[];
    };

    expect(
      manifest.migrations.find(({ version }) => version === "0012"),
    ).toEqual({
      checksumSha256: createHash("sha256").update(migration).digest("hex"),
      file: "0012_solution_export_read_model.sql",
      version: "0012",
    });
    expect(
      manifest.migrations.findIndex(({ version }) => version === "0012"),
    ).toBeLessThan(
      manifest.migrations.findIndex(({ version }) => version === "0013"),
    );
    expect(migration).not.toMatch(/ALTER TABLE\s+artifacts\b/iu);
    expect(migration).not.toMatch(/ALTER TABLE\s+generation_jobs\b/iu);
  });

  it("adds the exact orchestration family and immutable Solution Revision binding", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const normalizedMigration = migration.replaceAll("\r\n", "\n");

    expect(migration).toContain("'solution-export-orchestration'");
    expect(migration).toContain("cardinality(constraint_record.conkey) = 2");
    expect(migration).toContain("constraint_record.conkey @> ARRAY[");
    expect(migration).toContain("attribute_record.attname = 'family'");
    expect(migration).toContain("attribute_record.attname = 'subject_kind'");
    expect(migration).not.toContain("'subject_kind = ''organization'''");
    expect(migration).toContain("CREATE TABLE solution_export_runs");
    expect(migration).toContain("solution_manifest_record_id");
    expect(migration).toContain("solution_manifest_sha256");
    expect(migration).toContain("solution_manifest_record_kind");
    expect(migration).toContain("solution_manifest_subject_id");
    expect(migration).toContain("validate_solution_export_run_binding");
    expect(migration).toContain(
      "immutable solution export run binding cannot change",
    );
    expect(migration).toContain("previous_artifact_id");
    expect(migration).toContain("primary_input_sha256");
    expect(migration).toContain("run_sequence");
    expect(migration).toContain("rerun_of_run_id");
    expect(migration).toContain("request_intent_sha256");
    expect(migration).toContain("workflow_request_object_id");
    expect(migration).toContain("orchestration_input_object_id");
    expect(migration).toContain(
      "root_job.input_object_id = NEW.orchestration_input_object_id",
    );
    expect(migration).toContain(
      "root_job.input_sha256 = NEW.orchestration_input_sha256",
    );
    expect(migration).not.toContain(
      "root_job.input_object_id = NEW.workflow_request_object_id",
    );
    expect(migration).not.toContain(
      "root_job.input_sha256 = NEW.request_sha256",
    );
    expect(migration).toContain(
      "workflow_request_object.object_purpose = 'input-payload'",
    );
    expect(migration).toContain("validateSolutionExportRunInsertionBindingV1");
    expect(migration).toContain("API target policy derives the exact profile");
    expect(normalizedMigration).toContain(
      [
        "UNIQUE (",
        "    organization_id,",
        "    project_id,",
        "    primary_input_sha256,",
        "    run_sequence",
      ].join("\n"),
    );
    expect(migration).not.toContain(
      "UNIQUE (organization_id, project_id, request_sha256)",
    );
    expect(migration).toContain("run_sequence INTEGER NOT NULL,");
    expect(migration).toContain(
      "CREATE INDEX solution_export_runs_previous_artifact_lookup_idx",
    );
    expect(migration).toContain("target_profile_id,");
    expect(migration).toContain("environment_type,");
    expect(migration).toContain("environment_id,");
    expect(migration).toContain("target_settings_sha256");
    expect(migration).toContain(
      "solution export rerun does not follow an eligible terminal exact-input run",
    );
    expect(migration).toContain(
      "preceding_run.run_sequence = NEW.run_sequence - 1",
    );
    expect(migration).toContain(
      "preceding_artifact.retention_expires_at <= NEW.created_at",
    );
  });

  it("keeps verified package, file, and principal-bound grant records separate", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    for (const table of [
      "solution_export_artifacts",
      "solution_export_artifact_files",
      "solution_export_download_grants",
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
    }
    expect(migration).toContain("solution_export_artifacts_are_immutable");
    expect(migration).toContain("solution_export_artifact_files_are_immutable");
    expect(migration).toContain("repository_path !~ '(^|/)\\.{1,2}(/|$)'");
    expect(migration).toContain("repository_path !~ '[\\\\:]'");
    expect(migration).toContain("principal_id VARCHAR(128) NOT NULL");
    expect(migration).toContain(
      "download grant exceeds verified artifact authority",
    );
    expect(migration).toContain(
      "download grant permits only one-way revocation",
    );
    expect(migration).not.toMatch(/signed_url|temporary_url|local_path/iu);
  });

  it("fails closed on mismatched object metadata and oversized grant authority", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    for (const validator of [
      "validate_solution_export_run_objects",
      "validate_solution_export_artifact_objects",
      "validate_solution_export_file_object",
    ]) {
      expect(migration).toContain(`CREATE FUNCTION ${validator}`);
    }
    expect(migration).toContain("manifest_size_bytes BIGINT NOT NULL");
    expect(migration).toContain(
      "manifest_object.object_purpose = 'artifact-manifest'",
    );
    expect(migration).toContain(
      "archive_object.object_purpose = 'export-package'",
    );
    expect(migration).toContain(
      "archive_object.media_type = 'application/zip'",
    );
    expect(migration).toContain(
      "content_object.content_sha256 = NEW.content_sha256",
    );
    expect(migration).toContain("content_object.size_bytes = NEW.size_bytes");
    expect(migration).toContain("content_object.media_type = NEW.media_type");
    expect(migration).toContain("lifecycle_state = 'published'");
    expect(migration).toContain("JOIN solution_export_runs AS export_run");
    expect(migration).toContain("export_run.lifecycle_status = 'succeeded'");
    expect(migration).toContain(
      "export_run.solution_revision_id = NEW.solution_revision_id",
    );
    expect(migration).toContain(
      "export_run.workflow_read_model_object_id IS NOT NULL",
    );
    expect(migration).toContain(
      "CHECK (preview_available = (content_object_id IS NOT NULL))",
    );
    expect(migration).toContain(
      "CHECK (expires_at <= created_at + interval '5 minutes')",
    );
    expect(migration).toContain(
      "previous_run.target_profile_id = NEW.target_profile_id",
    );
    expect(migration).toContain(
      "previous_run.target_settings_sha256 = NEW.target_settings_sha256",
    );
    expect(migration).toContain(
      "previous_run.environment_id IS NOT DISTINCT FROM NEW.environment_id",
    );
    expect(migration).toContain("previous_run.lifecycle_status = 'succeeded'");
    expect(migration).toContain(
      "previous_artifact.retention_expires_at > NEW.created_at",
    );
  });

  it("derives availability from retention instead of persisting a reusable URL", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain(
      "CREATE VIEW solution_export_artifact_read_model_v1",
    );
    expect(migration).toContain(
      "artifact.retention_expires_at > CURRENT_TIMESTAMP",
    );
    expect(migration).toContain("THEN 'available'");
    expect(migration).toContain("ELSE 'expired'");
    expect(migration).toContain("run.run_sequence");
    expect(migration).toContain("run.rerun_of_run_id");
    expect(migration).not.toMatch(/download_url|grant_url/iu);
  });
});
