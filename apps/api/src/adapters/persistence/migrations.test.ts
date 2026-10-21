import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { RepositoryError } from "../../application/persistence.js";
import { loadMigrations, splitPostgresStatements } from "./migrations.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

const migrationsDirectory = fileURLToPath(
  new URL("../../../migrations", import.meta.url),
);

describe("persistence migrations", () => {
  it("keeps migration bytes portable across operating systems", async () => {
    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(file))
      .sort();
    const sources = await Promise.all(
      migrationFiles.map((file) =>
        readFile(resolve(migrationsDirectory, file)),
      ),
    );

    expect(migrationFiles).toHaveLength(120);
    expect(
      migrationFiles.filter((_, index) => sources[index]?.includes(13)),
    ).toEqual([]);
  });

  it("loads the checksum-pinned ordered migration set", async () => {
    const migrations = await loadMigrations(migrationsDirectory);

    expect(migrations.map(({ file, version }) => ({ file, version }))).toEqual([
      { file: "0001_identity_and_tenancy.sql", version: "0001" },
      { file: "0002_projects_and_architecture.sql", version: "0002" },
      { file: "0003_jobs_integrations_and_audit.sql", version: "0003" },
      { file: "0004_billing_usage_placeholders.sql", version: "0004" },
      {
        file: "0005_canonical_organization_authorization.sql",
        version: "0005",
      },
      {
        file: "0006_project_revision_lifecycle.sql",
        version: "0006",
      },
      {
        file: "0007_commercial_domain_foundation.sql",
        version: "0007",
      },
      {
        file: "0008_stripe_billing_adapter.sql",
        version: "0008",
      },
      {
        file: "0009_canonical_solution_records.sql",
        version: "0009",
      },
      {
        file: "0010_provider_neutral_async_jobs.sql",
        version: "0010",
      },
      {
        file: "0011_commercial_trigger_record_safety.sql",
        version: "0011",
      },
      {
        file: "0012_solution_export_read_model.sql",
        version: "0012",
      },
      {
        file: "0013_model_gateway_commercial_lifecycle.sql",
        version: "0013",
      },
      {
        file: "0014_github_app_repository_export.sql",
        version: "0014",
      },
      {
        file: "0015_github_app_installation_link_intents.sql",
        version: "0015",
      },
      {
        file: "0016_github_repository_import_sync.sql",
        version: "0016",
      },
      {
        file: "0017_async_job_runtime_metadata.sql",
        version: "0017",
      },
      {
        file: "0018_billing_audit_target_compatibility.sql",
        version: "0018",
      },
      {
        file: "0019_model_runtime_invocation_persistence.sql",
        version: "0019",
      },
      {
        file: "0020_model_platform_spend_reservations.sql",
        version: "0020",
      },
      {
        file: "0021_billing_checkout_attempts.sql",
        version: "0021",
      },
      {
        file: "0022_model_commercial_workflows.sql",
        version: "0022",
      },
      {
        file: "0023_editor_integration_read_policy.sql",
        version: "0023",
      },
      {
        file: "0024_model_runtime_host_evidence.sql",
        version: "0024",
      },
      {
        file: "0025_project_editing_leases.sql",
        version: "0025",
      },
      {
        file: "0026_ai_intent_previews.sql",
        version: "0026",
      },
      {
        file: "0027_model_runtime_admissions.sql",
        version: "0027",
      },
      {
        file: "0028_model_commercial_accounting.sql",
        version: "0028",
      },
      {
        file: "0029_model_commercial_terminal_accounting.sql",
        version: "0029",
      },
      {
        file: "0030_solution_export_terminal_compatibility.sql",
        version: "0030",
      },
      {
        file: "0031_ai_intent_preview_authorities.sql",
        version: "0031",
      },
      {
        file: "0032_organization_invitations_and_sharing_plans.sql",
        version: "0032",
      },
      {
        file: "0033_project_content_write_fences.sql",
        version: "0033",
      },
      {
        file: "0034_project_content_erasure_receipts.sql",
        version: "0034",
      },
      {
        file: "0035_draft_command_receipts.sql",
        version: "0035",
      },
      {
        file: "0036_model_live_evaluation_plans.sql",
        version: "0036",
      },
      {
        file: "0037_model_live_runtime_admissions.sql",
        version: "0037",
      },
      { file: "0038_model_live_commercial_reservations.sql", version: "0038" },
      { file: "0039_model_live_invocation_journal.sql", version: "0039" },
      { file: "0040_model_live_terminal_failures.sql", version: "0040" },
      { file: "0041_model_live_runtime_host_evidence.sql", version: "0041" },
      { file: "0042_model_live_no_dispatch_expiry.sql", version: "0042" },
      {
        file: "0043_model_live_proposal_validation_receipts.sql",
        version: "0043",
      },
      { file: "0044_model_live_evaluation_settlement.sql", version: "0044" },
      {
        file: "0045_model_live_unvalidated_completion_expiry.sql",
        version: "0045",
      },
      { file: "0046_accepted_intents.sql", version: "0046" },
      {
        file: "0047_model_live_intent_validation_receipts.sql",
        version: "0047",
      },
      {
        file: "0048_model_live_private_vpc_validation_receipts.sql",
        version: "0048",
      },
      {
        file: "0049_model_live_questions_validation_receipts.sql",
        version: "0049",
      },
      {
        file: "0050_model_live_bounded_refusal_validation_receipts.sql",
        version: "0050",
      },
      {
        file: "0051_model_live_repository_validation_receipts.sql",
        version: "0051",
      },
      {
        file: "0052_model_live_external_validation_receipts.sql",
        version: "0052",
      },
      {
        file: "0053_model_live_event_validation_receipts.sql",
        version: "0053",
      },
      {
        file: "0054_solution_export_cloudformation_compatibility.sql",
        version: "0054",
      },
      { file: "0055_cloudformation_export_pro_plan.sql", version: "0055" },
      { file: "0056_model_live_invocation_sets.sql", version: "0056" },
      { file: "0057_model_live_parser_input_receipts.sql", version: "0057" },
      { file: "0058_model_live_sequences.sql", version: "0058" },
      { file: "0059_model_live_event_criterion_policy.sql", version: "0059" },
      { file: "0078_browser_refresh_sessions.sql", version: "0078" },
      { file: "0079_deleted_proposal_erasure.sql", version: "0079" },
      { file: "0080_beta_ai_credits.sql", version: "0080" },
      { file: "0081_pro_monthly_credits.sql", version: "0081" },
      { file: "0082_beta_ai_credit_conversion.sql", version: "0082" },
      { file: "0083_credit_top_up_purchases.sql", version: "0083" },
      { file: "0084_personal_workspace_ownership.sql", version: "0084" },
      { file: "0085_account_profiles.sql", version: "0085" },
      {
        file: "0086_recipient_bound_organization_invitations.sql",
        version: "0086",
      },
      { file: "0087_organization_membership_lifecycle.sql", version: "0087" },
      { file: "0088_account_session_revocation.sql", version: "0088" },
      { file: "0089_account_credential_audit.sql", version: "0089" },
      { file: "0090_account_authenticator_enrollments.sql", version: "0090" },
      { file: "0091_gitlab_oauth_connections.sql", version: "0091" },
      { file: "0092_platform_staff_accounts.sql", version: "0092" },
      { file: "0093_live_stripe_provenance.sql", version: "0093" },
      {
        file: "0094_hosted_terraform_validation_submissions.sql",
        version: "0094",
      },
      { file: "0095_bitbucket_oauth_connections.sql", version: "0095" },
      {
        file: "0096_project_cleanup_precommit_admissions.sql",
        version: "0096",
      },
      { file: "0097_account_photos.sql", version: "0097" },
      { file: "0098_staff_trial_access.sql", version: "0098" },
      { file: "0099_model_live_seed_validation_receipts.sql", version: "0099" },
      { file: "0100_model_live_sequence_inputs.sql", version: "0100" },
      { file: "0101_model_live_seed_runtime_admissions.sql", version: "0101" },
      {
        file: "0102_model_live_seed_commercial_reservations.sql",
        version: "0102",
      },
      { file: "0103_model_live_seed_sequence_runtime.sql", version: "0103" },
      {
        file: "0104_model_live_seed_sequence_reservations.sql",
        version: "0104",
      },
      { file: "0105_model_live_sequence_attempt_journal.sql", version: "0105" },
      {
        file: "0106_model_live_sequence_usage_observations.sql",
        version: "0106",
      },
      {
        file: "0107_model_live_sequence_candidate_validations.sql",
        version: "0107",
      },
      { file: "0108_model_live_repair_successor_inputs.sql", version: "0108" },
      {
        file: "0109_model_live_repair_successor_dispatches.sql",
        version: "0109",
      },
      {
        file: "0110_model_live_repair_successor_usage_observations.sql",
        version: "0110",
      },
      {
        file: "0111_model_live_repair_successor_candidate_validations.sql",
        version: "0111",
      },
      { file: "0112_model_live_repair_unused_stages.sql", version: "0112" },
      { file: "0113_model_live_repair_recorded_receipts.sql", version: "0113" },
      {
        file: "0114_model_live_repair_terminal_accounting.sql",
        version: "0114",
      },
      { file: "0115_model_live_repair_known_failure.sql", version: "0115" },
      { file: "0116_model_live_repair_expiry_receipts.sql", version: "0116" },
      { file: "0117_model_gpt6_whole_request_pricing.sql", version: "0117" },
      { file: "0118_model_gpt6_exact_repair_effort.sql", version: "0118" },
      { file: "0119_model_gpt6_reports_and_promotions.sql", version: "0119" },
      {
        file: "0120_model_live_typed_application_criterion.sql",
        version: "0120",
      },
      { file: "0121_model_live_generation_criterion.sql", version: "0121" },
      { file: "0122_model_live_ci_package_successor.sql", version: "0122" },
      {
        file: "0123_model_native_zero_and_product_receipts.sql",
        version: "0123",
      },
      { file: "0124_model_gpt6_mixed_report_shape.sql", version: "0124" },
      {
        file: "0125_standard_shared_ui_and_beta_bootstrap.sql",
        version: "0125",
      },
      { file: "0126_notes_native_publication.sql", version: "0126" },
      {
        file: "0127_private_notes_and_gpt6_receipt_authorities.sql",
        version: "0127",
      },
      {
        file: "0128_model_repair_invalid_output_terminal_successor.sql",
        version: "0128",
      },
      {
        file: "0129_model_gpt6_publication_binding_successor.sql",
        version: "0129",
      },
      { file: "0130_model_native_zero_binding_successor.sql", version: "0130" },
      {
        file: "0131_standard_shared_ui_private_lock_successor.sql",
        version: "0131",
      },
      { file: "0132_ordinary_fixed_lock_foundation.sql", version: "0132" },
      { file: "0133_ordinary_authorization_lock_helpers.sql", version: "0133" },
      { file: "0134_ordinary_invoker_successors.sql", version: "0134" },
      { file: "0135_ordinary_preview_canonical_verifier.sql", version: "0135" },
      { file: "0136_model_private_runtime_definitions.sql", version: "0136" },
      {
        file: "0137_provider_direct_usage_journal_definitions.sql",
        version: "0137",
      },
      { file: "0138_staff_credit_ai_access.sql", version: "0138" },
    ]);
    const joined = migrations
      .flatMap((migration) => migration.statements)
      .join("\n");
    expect(joined).toContain("CREATE TABLE architecture_revisions");
    expect(joined).toContain("CREATE TABLE github_app_installations");
    expect(joined).toContain("CREATE TABLE github_webhook_deliveries");
    expect(joined).toContain("event_name ~ '^[a-z][a-z0-9_]{0,63}$'");
    expect(joined).toContain("payload_sha256 VARCHAR(71)");
    expect(joined).toContain("CREATE TABLE github_repository_export_previews");
    expect(joined).toContain(
      "CREATE TABLE github_repository_export_executions",
    );
    expect(joined).toContain(
      "DROP CONSTRAINT audit_events_target_kind_v2_check",
    );
    const githubExportMigration = migrations
      .find((migration) => migration.version === "0014")
      ?.statements.join("\n");
    expect(githubExportMigration).not.toContain(
      "DROP CONSTRAINT audit_events_target_kind_check",
    );
    const billingAuditCompatibility = migrations
      .find((migration) => migration.version === "0018")
      ?.statements.join("\n");
    expect(billingAuditCompatibility).toContain(
      "DROP CONSTRAINT audit_events_target_kind_check",
    );
    expect(joined).not.toMatch(
      /installation_token|private_key_value|raw_webhook_body/i,
    );
    expect(joined).toContain("CREATE TABLE stored_objects");
    expect(joined).toContain(
      "REFERENCES stored_objects(organization_id, project_id, object_id)",
    );
    expect(joined).not.toContain("REFERENCES stored_objects(object_id)");
    expect(joined).toContain("pending_document_object_id");
    expect(joined).toContain("CREATE TABLE organization_entitlement_snapshots");
    expect(joined).toContain("CREATE TABLE usage_ledger_entries");
    expect(joined).not.toMatch(
      /raw_(?:model_)?prompt|model_response|architecture_payload/i,
    );
    // Only the bounded, principal-owned identity-photo table stores binary data.
    expect(
      migrations
        .filter((m) => m.version !== "0097")
        .flatMap((m) => m.statements)
        .join("\n"),
    ).not.toMatch(/BYTEA/i);
    const photo = migrations
      .find((m) => m.version === "0097")
      ?.statements.join("\n");
    expect(photo?.match(/BYTEA/gu)).toHaveLength(1);
    expect(photo).toContain("octet_length(image_bytes) BETWEEN 8 AND 184320");
    expect(photo).toContain(
      "REFERENCES principals(principal_id) ON DELETE CASCADE",
    );
    expect(photo).not.toMatch(
      /organization_id|project_id|url|image_bytes.*principal_account_photo_events/iu,
    );
    expect(joined).toContain("cloudmarkup_authorization_v1_permissions");
    expect(joined).toContain(
      "organization_roles_authorization_v1_canonical_check",
    );
    expect(joined).toContain(
      "DISABLE TRIGGER architecture_revisions_are_immutable",
    );
    expect(joined).toContain(
      "ENABLE TRIGGER architecture_revisions_are_immutable",
    );
    expect(joined).toContain("revision_name VARCHAR(120)");
    expect(joined).toContain("compiler_input_contract_version");
    expect(joined).toContain("content_identity_constraint");
    expect(joined).toContain("lifecycle_status = 'deletion-pending'");
    expect(joined).toContain("cloudmarkup_authorization_v2_permissions");
    expect(joined).toContain("CREATE TABLE commercial_plan_definitions");
    expect(joined).toContain("credit_grants_reconcile_funding_ledger");
    expect(joined).toContain("credit_reservations_reconcile_lifecycle_ledger");
    expect(joined).toContain(
      "credit reservation allocation state does not reconcile",
    );
    expect(joined).toContain(
      "credit reservation allocation evidence does not reconcile",
    );
    expect(joined).toContain("credit_adjustments_preserve_grant_invariants");
    expect(joined).toContain(
      "credit_reservation_allocations_preserve_grant_balance",
    );
    expect(joined).toContain("usage_allocations_reconcile_credit_reservation");
    expect(joined).toContain("terminal_at >= created_at");
    expect(joined).toContain("event.occurred_at >= reservation_row.created_at");
    expect(joined).toContain(
      "event.occurred_at <= reservation_row.terminal_at",
    );
    expect(joined).toContain("event.occurred_at >= reservation_row.expires_at");
    expect(joined).toContain("usage_ledger_entries_kind_metrics_check");
    expect(joined).toContain("provider_pricing_versions_one_way_close");
    expect(joined).toContain("'ai-assisted-operations'");
    expect(joined).toContain(
      "model_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'",
    );
    expect(joined).toContain(
      "commercial-grant-balance:' || NEW.organization_id",
    );
    expect(joined).toContain("usage_grant_event_credit_grant_unique_idx");
    expect(joined).toContain("usage_reservation_event_reservation_unique_idx");
    expect(joined).toContain("usage_terminal_event_reservation_unique_idx");
    expect(joined).toContain("usage_positive_adjustment_grant_unique_idx");
    expect(joined).toContain("credit_reservation_allocations_account_lock");
    expect(joined).toContain("usage_negative_adjustments_account_lock");
    expect(joined).toContain("FOR UPDATE");
    expect(joined).toContain("planver_starter_2026_08_14_v1");
    expect(joined).toContain("planver_pro_2026_08_14_v2");
    expect(joined).toContain("cancel_at_period_end");
    expect(joined).toContain("billing_webhook_events_retry_idx");
    expect(joined).toContain("'billing-account'");
    expect(joined).not.toMatch(
      /card_number|payment_method_data|webhook_signing_secret|stripe_secret_key/i,
    );
    const triggerRepair = migrations
      .find((migration) => migration.version === "0011")
      ?.statements.join("\n");
    expect(triggerRepair).toContain(
      "CREATE OR REPLACE FUNCTION validate_credit_grant_funding_reconciliation()",
    );
    expect(triggerRepair).toContain(
      "CREATE OR REPLACE FUNCTION validate_credit_grant_balance_invariant()",
    );
    expect(triggerRepair).toMatch(
      /IF TG_TABLE_NAME = 'usage_ledger_entry_allocations' THEN\s+IF NEW\.credit_adjustment_units/,
    );
    expect(triggerRepair).not.toMatch(
      /TG_TABLE_NAME = 'usage_ledger_entry_allocations'\s+AND NEW\.credit_adjustment_units/,
    );
  });

  it("keeps presentation preferences outside architecture tables", async () => {
    const migrations = await loadMigrations(migrationsDirectory);
    const identityMigration = migrations[0]?.statements.join("\n") ?? "";
    const architectureMigration = migrations[1]?.statements.join("\n") ?? "";

    expect(identityMigration).toContain("user_presentation_preferences");
    expect(identityMigration).toContain("contextual_learning_enabled");
    expect(architectureMigration).not.toMatch(
      /experience_mode|contextual_learning|open_panel|hover|viewport|selection/,
    );
  });

  it("splits PostgreSQL functions and quoted semicolons deterministically", () => {
    const statements = splitPostgresStatements(`
      INSERT INTO example(value) VALUES ('semi;colon');
      CREATE FUNCTION example() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'still;one;statement';
      END;
      $$ LANGUAGE plpgsql;
      SELECT 1;
    `);

    expect(statements).toHaveLength(3);
    expect(statements[1]).toContain("RAISE EXCEPTION");
  });

  it("fails closed when a migration byte changes without a manifest update", async () => {
    const sourceDirectory = migrationsDirectory;
    const targetDirectory = await mkdtemp(
      resolve(tmpdir(), "cloudmarkup-migrations-"),
    );
    temporaryDirectories.push(targetDirectory);
    for (const file of [
      "manifest.json",
      ...(await readdir(sourceDirectory)).filter((file) =>
        file.endsWith(".sql"),
      ),
    ]) {
      await writeFile(
        resolve(targetDirectory, file),
        await readFile(resolve(sourceDirectory, file)),
      );
    }
    // Establish a complete valid preimage so the refusal below exercises the
    // byte checksum, rather than the earlier missing-file count guard.
    await expect(loadMigrations(targetDirectory)).resolves.toHaveLength(120);
    await writeFile(
      resolve(targetDirectory, "0001_identity_and_tenancy.sql"),
      "SELECT 1;\n",
    );

    await expect(loadMigrations(targetDirectory)).rejects.toMatchObject({
      code: "invalid-input",
    } satisfies Partial<RepositoryError>);
  });
});
