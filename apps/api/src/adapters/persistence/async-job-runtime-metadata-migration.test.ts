import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../migrations/0017_async_job_runtime_metadata.sql",
  import.meta.url,
);
const priorMigrationUrl = new URL(
  "../../../migrations/0010_provider_neutral_async_jobs.sql",
  import.meta.url,
);
const manifestUrl = new URL(
  "../../../migrations/manifest.json",
  import.meta.url,
);

function tableDefinition(migration: string, tableName: string): string {
  const start = migration.indexOf(`CREATE TABLE ${tableName} (`);
  const end = migration.indexOf("\n);", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end + 3);
}

describe("async-job runtime metadata migration", () => {
  it("pins additive migration 0017 after 0016 without changing migration 0010", async () => {
    const [migration, priorMigration, manifestText] = await Promise.all([
      readFile(migrationUrl),
      readFile(priorMigrationUrl),
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
      manifest.migrations.find(({ version }) => version === "0017"),
    ).toEqual({
      checksumSha256: createHash("sha256").update(migration).digest("hex"),
      file: "0017_async_job_runtime_metadata.sql",
      version: "0017",
    });
    expect(
      manifest.migrations.findIndex(({ version }) => version === "0017"),
    ).toBe(
      manifest.migrations.findIndex(({ version }) => version === "0016") + 1,
    );
    expect(createHash("sha256").update(priorMigration).digest("hex")).toBe(
      "05face90ac08f89ba6d08799d0fea1ca921577ea9afce22038309c606a7a6071",
    );
  });

  it("extends only creation-claim family checks for solution-export orchestration", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    expect(migration).toContain(
      "DROP CONSTRAINT async_job_creation_claims_family_check",
    );
    expect(migration).toContain(
      "ADD CONSTRAINT async_job_creation_claims_environment_family_check_v2 CHECK",
    );
    expect(migration).toContain(
      "ADD CONSTRAINT async_job_creation_claims_family_subject_check_v2 CHECK",
    );
    expect(migration.match(/'solution-export-orchestration'/gu)).toHaveLength(
      4,
    );
    expect(migration).toContain(
      "expected exactly one creation-claim environment-family check",
    );
    expect(migration).toContain(
      "expected exactly one creation-claim family-subject check",
    );
    expect(migration).not.toContain("DROP CONSTRAINT async_jobs_family_check");
  });

  it("adds lossless bounded failure, output-size, denial-source, and transition metadata", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("measured_output_size_bytes BIGINT");
    expect(migration).not.toContain(
      "SET measured_output_size_bytes = output_size_bytes",
    );
    expect(migration).toContain(
      "(job.output_object_id IS NULL) = (job.measured_output_size_bytes IS NULL)",
    );
    expect(migration).toContain(
      "measured_output_size_bytes BETWEEN 0 AND max_output_bytes",
    );
    expect(
      migration.match(/failure_retry_after_seconds INTEGER/gu),
    ).toHaveLength(2);
    expect(
      migration.match(/failure_retry_after_seconds BETWEEN 1 AND 86400/gu),
    ).toHaveLength(2);
    expect(
      migration.match(
        /failure_classification IS NOT DISTINCT FROM 'transient'/gu,
      ),
    ).toHaveLength(2);
    expect(migration).toContain("denial_source VARCHAR(16)");
    expect(migration).toContain(
      "denial_source IN ('entitlement', 'recovery', 'reservation')",
    );
    expect(migration).toContain("transition_at TIMESTAMPTZ");
    expect(migration).not.toContain("SET transition_at = occurred_at");
    expect(migration).toContain(
      "transition_at IS NULL OR to_status IS NOT NULL",
    );
    expect(migration).toContain(
      "(NEW.to_status IS NULL) <> (NEW.transition_at IS NULL)",
    );
    expect(migration).toContain(
      "(NEW.event_kind = 'creation-denied') <> (NEW.denial_source IS NOT NULL)",
    );
  });

  it("binds immutable job snapshots to the current normalized version and exact published object", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const snapshots = tableDefinition(migration, "async_job_record_snapshots");

    expect(snapshots).toContain(
      "PRIMARY KEY (organization_id, job_id, record_version)",
    );
    expect(snapshots).toContain("project_id VARCHAR(128)");
    expect(snapshots).toContain("snapshot_object_id VARCHAR(128) NOT NULL");
    expect(snapshots).toContain("snapshot_sha256 CHAR(64) NOT NULL");
    expect(snapshots).toContain("snapshot_size_bytes BIGINT NOT NULL");
    expect(snapshots).toContain("snapshot_size_bytes BETWEEN 1 AND 4194304");
    expect(snapshots).toContain(
      "REFERENCES async_jobs(organization_id, job_id)",
    );
    expect(snapshots).toContain(
      "REFERENCES stored_objects(organization_id, object_id)",
    );
    expect(snapshots).toContain(
      "REFERENCES stored_objects(organization_id, project_id, object_id)",
    );
    expect(migration).toContain(
      "job.project_id IS NOT DISTINCT FROM NEW.project_id",
    );
    expect(migration).toContain("job.record_version = NEW.record_version");
    expect(migration).toContain("async_job_record_snapshots_are_immutable");
  });

  it("binds immutable claim snapshots to the current normalized claim and exact tenant scope", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const snapshots = tableDefinition(migration, "async_job_claim_snapshots");

    expect(snapshots).toMatch(
      /PRIMARY KEY \(\s*organization_id, operation_id, idempotency_key_sha256, record_version\s*\)/u,
    );
    expect(snapshots).toContain("project_id VARCHAR(128)");
    expect(snapshots).toContain("REFERENCES async_job_creation_claims");
    expect(snapshots).toContain(
      "REFERENCES stored_objects(organization_id, object_id)",
    );
    expect(snapshots).toContain(
      "REFERENCES stored_objects(organization_id, project_id, object_id)",
    );
    expect(migration).toContain(
      "claim.project_id IS NOT DISTINCT FROM NEW.project_id",
    );
    expect(migration).toContain("claim.record_version = NEW.record_version");
    expect(migration).toContain("async_job_claim_snapshots_are_immutable");
  });

  it("validates both snapshot kinds as bounded published JSON reports without storing bodies", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(
      migration.match(/snapshot_object\.object_purpose = 'report'/gu),
    ).toHaveLength(2);
    expect(
      migration.match(/snapshot_object\.media_type = 'application\/json'/gu),
    ).toHaveLength(2);
    expect(
      migration.match(
        /snapshot_object\.content_sha256 = NEW\.snapshot_sha256/gu,
      ),
    ).toHaveLength(2);
    expect(
      migration.match(
        /snapshot_object\.size_bytes = NEW\.snapshot_size_bytes/gu,
      ),
    ).toHaveLength(2);
    expect(
      migration.match(/snapshot_object\.lifecycle_state = 'published'/gu),
    ).toHaveLength(2);
    expect(migration).not.toMatch(
      /\b(?:JSONB|BYTEA)\b|raw_(?:input|output|prompt|response)|credential_value|access_token|private_key/iu,
    );
    expect(migration).not.toMatch(
      /^\s*(?:DROP\s+(?:TABLE|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/imu,
    );
  });
});
