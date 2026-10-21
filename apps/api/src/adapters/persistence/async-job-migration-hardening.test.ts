import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../migrations/0010_provider_neutral_async_jobs.sql",
  import.meta.url,
);

function tableDefinition(migration: string, tableName: string): string {
  const start = migration.indexOf(`CREATE TABLE ${tableName} (`);
  const end = migration.indexOf("\n);", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end + 3);
}

describe("provider-neutral async-job persistence invariants", () => {
  it("persists a bounded immutable creation plan that can reconstruct the exact job", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const claim = tableDefinition(migration, "async_job_creation_claims");

    [
      "creation_plan_contract_version",
      "creation_plan_sha256",
      "family",
      "subject_kind",
      "draft_version",
      "draft_strong_etag",
      "draft_content_sha256",
      "solution_revision_id",
      "solution_manifest_record_id",
      "solution_manifest_sha256",
      "environment_id",
      "environment_type",
      "input_object_id",
      "input_sha256",
      "referenced_input_size_bytes",
      "inline_input_size_bytes",
      "root_job_id",
      "parent_job_id",
      "parent_failure_policy",
      "max_attempts",
      "max_runtime_seconds",
      "max_referenced_input_bytes",
      "max_inline_input_bytes",
      "max_output_bytes",
      "max_checkpoint_bytes",
      "max_checkpoints",
      "max_artifacts",
      "expires_at",
      "reservation_requested",
    ].forEach((field) => {
      expect(claim).toContain(field);
    });
    expect(migration).toContain(
      "async job creation plan identity cannot change",
    );
    expect(migration).toContain("job.input_object_id = NEW.input_object_id");
    expect(migration).toContain("job.family = NEW.family");
    expect(migration).toContain("job.created_at = NEW.claimed_at");
    expect(migration).toContain(
      "completed creation claim does not match its exact job plan",
    );
  });

  it("records full safe commercial outcomes and fails closed before completion", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("entitlement_outcome VARCHAR(16)");
    expect(migration).toContain("entitlement_denial_code");
    expect(migration).toContain("entitlement_public_message");
    expect(migration).toContain("reservation_outcome VARCHAR(16)");
    expect(migration).toContain("reservation_denial_code");
    expect(migration).toContain("reservation_public_message");
    expect(migration).toContain("entitlement_outcome = 'allowed'");
    expect(migration).toContain("reservation_outcome = 'allowed'");
    expect(migration).toContain("NEW.updated_at < OLD.updated_at");
    expect(migration).not.toContain("NEW.updated_at <= OLD.updated_at");
    expect(migration).toContain(
      "async job creation entitlement decision cannot change",
    );
    expect(migration).toContain(
      "async job creation reservation decision cannot change",
    );
  });

  it("stores ordered immutable creation orchestration backed by reserved child identities", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("CREATE TABLE async_job_identity_reservations");
    expect(migration).toContain(
      "async_job_identity_reservations_are_immutable",
    );
    expect(migration).toContain(
      "CREATE TABLE async_job_creation_claim_orchestration_members",
    );
    expect(migration).toContain(
      "relationship_kind IN ('dependency', 'expected-child')",
    );
    expect(migration).toContain("member_ordinal BETWEEN 0 AND 127");
    expect(migration).toContain(
      "async_job_creation_claim_orchestration_are_immutable",
    );
    expect(migration).toContain(
      "expected child member must match its parent reservation",
    );
    expect(migration).toContain(
      "expected child must match a reserved queued parent lineage",
    );
    expect(migration).toContain(
      "claim_member.relationship_kind = 'expected-child'",
    );
  });

  it("prevents unreserved jobs and binds eventual children to exact lineage", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const jobs = tableDefinition(migration, "async_jobs");
    const expectedChildren = tableDefinition(
      migration,
      "async_job_expected_children",
    );

    const exactProjectIdentityFk =
      /REFERENCES async_job_identity_reservations\(\s*organization_id,\s*project_id,\s*job_id\s*\)/u;

    expect(jobs).toContain(
      "REFERENCES async_job_identity_reservations(organization_id, job_id)",
    );
    expect(jobs).toMatch(exactProjectIdentityFk);
    expect(expectedChildren).toContain(
      "REFERENCES async_jobs(organization_id, job_id)",
    );
    expect(expectedChildren).toContain(
      "REFERENCES async_job_identity_reservations(organization_id, job_id)",
    );
    expect(expectedChildren).toMatch(exactProjectIdentityFk);
    expect(migration).toContain(
      "identity_reservation.root_job_id = NEW.root_job_id",
    );
    expect(migration).toContain(
      "identity_reservation.parent_job_id IS NOT DISTINCT FROM NEW.parent_job_id",
    );
    expect(migration).toContain(
      "identity_reservation.correlation_id = NEW.correlation_id",
    );
    expect(migration).toContain(
      "async job identity was not reserved in exact scope",
    );
    expect(migration).toContain(
      "async job child was not in its parent reserved expected set",
    );
    expect(migration).toContain(
      "creation claim job identity was not reserved in exact scope",
    );
    expect(migration).toContain(
      "expected child identity must match its reserved lineage",
    );
    const identityReservations = tableDefinition(
      migration,
      "async_job_identity_reservations",
    );
    expect(identityReservations).not.toMatch(
      /lifecycle_status|input_object_id|output_object_id|artifact/iu,
    );
    expect(migration).toContain(
      "these are not job stubs and never carry lifecycle",
    );
  });
  it("keeps denied creation audit claim-linked, immutable, and safe without a job row", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const creationEvents = tableDefinition(
      migration,
      "async_job_creation_claim_events",
    );

    expect(creationEvents).toContain("organization_id VARCHAR(128) NOT NULL");
    expect(creationEvents).toContain("project_id VARCHAR(128)");
    expect(creationEvents).toContain("request_sha256 CHAR(64) NOT NULL");
    expect(creationEvents).toContain("creation_plan_sha256 CHAR(64) NOT NULL");
    expect(creationEvents).toContain("summary_sha256 CHAR(64) NOT NULL");
    expect(creationEvents).toContain("correlation_id VARCHAR(128) NOT NULL");
    expect(creationEvents).toContain("actor_kind VARCHAR(32) NOT NULL");
    expect(creationEvents).toContain("'recovery-denied'");
    expect(creationEvents).toContain("REFERENCES async_job_creation_claims");
    expect(creationEvents).not.toContain("REFERENCES async_jobs");
    expect(migration).toContain(
      "async_job_creation_claim_events_are_immutable",
    );
    expect(migration).toContain(
      "creation claim event does not match exact claim authority",
    );
  });

  it("keeps every reconciliation cursor tenant-first", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain(
      "CREATE INDEX async_jobs_queued_reconciliation_idx",
    );
    expect(migration).toContain(
      "ON async_jobs (organization_id, project_id, queued_at, job_id)",
    );
    expect(migration).toContain(
      "CREATE INDEX async_jobs_orphan_reconciliation_idx",
    );
    expect(migration).toContain(
      "ON async_jobs (organization_id, project_id, updated_at, job_id)",
    );
    expect(migration).toContain(
      "CREATE INDEX async_jobs_retention_reconciliation_idx",
    );
    expect(migration).toContain(
      "ON async_jobs (organization_id, project_id, expires_at, job_id)",
    );
    expect(migration).toContain(
      "CREATE INDEX async_job_creation_claims_recovery_idx",
    );
    expect(migration).toMatch(
      /ON async_job_creation_claims \(\s*organization_id, project_id, updated_at,/u,
    );
    expect(migration).toContain(
      "CREATE INDEX async_job_creation_claim_events_tenant_cursor_idx",
    );
  });

  it("retains immutable job-linked lifecycle audit for same-transaction writes", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const jobEvents = tableDefinition(migration, "async_job_events");

    expect(jobEvents).toContain(
      "REFERENCES async_jobs(organization_id, job_id)",
    );
    expect(migration).toContain("async_job_events_are_immutable");
    expect(migration).toContain(
      "adapters write state and its event in one database transaction",
    );
  });

  it("persists exact retry, checkpoint, interaction, revision, and Evidence authority", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("failure_classification VARCHAR(32)");
    expect(migration).toContain("retry_disposition VARCHAR(32)");
    expect(migration).toContain("sum(existing_attempt.runtime_seconds)");
    expect(migration).toContain("resumed_from_checkpoint_id");
    expect(migration).toContain("interaction_response_object_id");
    expect(migration).toContain("progress must advance monotonically");
    expect(migration).toContain("CREATE TABLE async_job_evidence_outputs");
    expect(migration).toContain("evidence_record_kind = 'evidence'");
    expect(migration).toContain(
      "job.solution_revision_id = NEW.solution_revision_id",
    );
    expect(migration).toContain(
      "job.environment_id IS NOT DISTINCT FROM NEW.environment_id",
    );
    expect(migration).not.toContain("resumable BOOLEAN");
  });

  it("stores digests and bounded references, never raw idempotency keys or secrets", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).not.toMatch(
      /\bidempotency_key\s+(?:VARCHAR|TEXT|JSONB)|credential_value|access_token|private_key|raw_prompt|raw_response|payload_json|BYTEA/iu,
    );
    expect(migration).toContain("idempotency_key_sha256 CHAR(64) NOT NULL");
    expect(migration).toContain("decision_reference_sha256 CHAR(64)");
    expect(migration).toContain("input_object_id VARCHAR(128) NOT NULL");
  });
  it("persists immutable tenant-scoped audit delivery receipts", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const creationReceipts = tableDefinition(
      migration,
      "async_job_creation_claim_event_delivery_receipts",
    );
    const jobReceipts = tableDefinition(
      migration,
      "async_job_event_delivery_receipts",
    );

    [creationReceipts, jobReceipts].forEach((receipts) => {
      expect(receipts).toContain("organization_id VARCHAR(128) NOT NULL");
      expect(receipts).toContain("project_id VARCHAR(128)");
      expect(receipts).toContain("published_at TIMESTAMPTZ NOT NULL");
    });
    expect(creationReceipts).toContain(
      "REFERENCES async_job_creation_claim_events",
    );
    expect(jobReceipts).toContain("REFERENCES async_job_events");
    expect(migration).toContain(
      "creation claim audit delivery receipt does not match exact event ownership and time",
    );
    expect(migration).toContain(
      "job audit delivery receipt does not match exact event ownership and time",
    );
    expect(migration).toContain(
      "async_job_creation_claim_event_delivery_receipts_are_immutable",
    );
    expect(migration).toContain(
      "async_job_event_delivery_receipts_are_immutable",
    );
    expect(migration).toContain(
      "CREATE INDEX async_job_creation_claim_delivery_tenant_cursor_idx",
    );
    expect(migration).toContain(
      "CREATE INDEX async_job_events_tenant_cursor_idx",
    );
    expect(migration).toContain(
      "CREATE INDEX async_job_event_delivery_tenant_cursor_idx",
    );
    expect(migration).toContain(
      "pending job audit is derived by anti-joining exact events",
    );
  });

  it("freezes attempt history and enforces exact job compare-and-swap versions", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("NEW.record_version <> 1");
    expect(migration).toContain("async job initial record version must be one");
    expect(migration).toContain("NEW.record_version <> OLD.record_version + 1");
    expect(migration).toContain(
      "async job record version must advance by exactly one",
    );
    expect(migration).toContain(
      "async job attempt must be created as a fresh running attempt",
    );
    expect(migration).toContain("async job attempt identity cannot change");
    expect(migration).toContain("OLD.resumed_from_checkpoint_id");
    expect(migration).toContain("NEW.resumed_from_checkpoint_id");
    expect(migration).toContain("OLD.lifecycle_status <> 'running'");
    expect(migration).toContain("terminal async job attempt cannot change");
    expect(migration).toContain(
      "running async job attempt timing must advance monotonically",
    );
    expect(migration).toContain(
      "async job attempt checkpoint lineage cannot be removed",
    );
    expect(migration).toContain("async_job_attempts_reject_delete");
  });
});
