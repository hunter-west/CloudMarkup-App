import { createHash } from "node:crypto";

import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  ExecuteStatementCommand,
  RDSDataClient,
  RollbackTransactionCommand,
  type ExecuteStatementCommandOutput,
  type SqlParameter,
} from "@aws-sdk/client-rds-data";
import type {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
} from "aws-lambda";

import migration0001 from "../../../apps/api/migrations/0001_identity_and_tenancy.sql";
import migration0002 from "../../../apps/api/migrations/0002_projects_and_architecture.sql";
import migration0003 from "../../../apps/api/migrations/0003_jobs_integrations_and_audit.sql";
import migration0004 from "../../../apps/api/migrations/0004_billing_usage_placeholders.sql";
import migration0005 from "../../../apps/api/migrations/0005_canonical_organization_authorization.sql";
import migration0006 from "../../../apps/api/migrations/0006_project_revision_lifecycle.sql";
import migration0007 from "../../../apps/api/migrations/0007_commercial_domain_foundation.sql";
import migration0008 from "../../../apps/api/migrations/0008_stripe_billing_adapter.sql";
import migration0009 from "../../../apps/api/migrations/0009_canonical_solution_records.sql";
import migration0010 from "../../../apps/api/migrations/0010_provider_neutral_async_jobs.sql";
import migration0011 from "../../../apps/api/migrations/0011_commercial_trigger_record_safety.sql";
import migration0012 from "../../../apps/api/migrations/0012_solution_export_read_model.sql";
import migration0013 from "../../../apps/api/migrations/0013_model_gateway_commercial_lifecycle.sql";
import migration0014 from "../../../apps/api/migrations/0014_github_app_repository_export.sql";
import migration0015 from "../../../apps/api/migrations/0015_github_app_installation_link_intents.sql";
import migration0016 from "../../../apps/api/migrations/0016_github_repository_import_sync.sql";
import migration0017 from "../../../apps/api/migrations/0017_async_job_runtime_metadata.sql";
import migration0018 from "../../../apps/api/migrations/0018_billing_audit_target_compatibility.sql";
import migration0019 from "../../../apps/api/migrations/0019_model_runtime_invocation_persistence.sql";
import migration0020 from "../../../apps/api/migrations/0020_model_platform_spend_reservations.sql";
import migration0021 from "../../../apps/api/migrations/0021_billing_checkout_attempts.sql";
import migration0022 from "../../../apps/api/migrations/0022_model_commercial_workflows.sql";
import migration0023 from "../../../apps/api/migrations/0023_editor_integration_read_policy.sql";
import migration0024 from "../../../apps/api/migrations/0024_model_runtime_host_evidence.sql";
import migration0025 from "../../../apps/api/migrations/0025_project_editing_leases.sql";
import migration0026 from "../../../apps/api/migrations/0026_ai_intent_previews.sql";
import migration0027 from "../../../apps/api/migrations/0027_model_runtime_admissions.sql";
import migration0028 from "../../../apps/api/migrations/0028_model_commercial_accounting.sql";
import migration0029 from "../../../apps/api/migrations/0029_model_commercial_terminal_accounting.sql";
import migration0030 from "../../../apps/api/migrations/0030_solution_export_terminal_compatibility.sql";
import migration0031 from "../../../apps/api/migrations/0031_ai_intent_preview_authorities.sql";
import migration0032 from "../../../apps/api/migrations/0032_organization_invitations_and_sharing_plans.sql";
import migration0033 from "../../../apps/api/migrations/0033_project_content_write_fences.sql";
import migration0034 from "../../../apps/api/migrations/0034_project_content_erasure_receipts.sql";
import migration0035 from "../../../apps/api/migrations/0035_draft_command_receipts.sql";
import migration0036 from "../../../apps/api/migrations/0036_model_live_evaluation_plans.sql";
import migration0037 from "../../../apps/api/migrations/0037_model_live_runtime_admissions.sql";
import migration0038 from "../../../apps/api/migrations/0038_model_live_commercial_reservations.sql";
import migration0039 from "../../../apps/api/migrations/0039_model_live_invocation_journal.sql";
import migration0040 from "../../../apps/api/migrations/0040_model_live_terminal_failures.sql";
import migration0041 from "../../../apps/api/migrations/0041_model_live_runtime_host_evidence.sql";
import migration0042 from "../../../apps/api/migrations/0042_model_live_no_dispatch_expiry.sql";
import migration0043 from "../../../apps/api/migrations/0043_model_live_proposal_validation_receipts.sql";
import migration0044 from "../../../apps/api/migrations/0044_model_live_evaluation_settlement.sql";
import migration0045 from "../../../apps/api/migrations/0045_model_live_unvalidated_completion_expiry.sql";
import migration0046 from "../../../apps/api/migrations/0046_accepted_intents.sql";
import migration0047 from "../../../apps/api/migrations/0047_model_live_intent_validation_receipts.sql";
import migration0048 from "../../../apps/api/migrations/0048_model_live_private_vpc_validation_receipts.sql";
import migration0049 from "../../../apps/api/migrations/0049_model_live_questions_validation_receipts.sql";
import migration0050 from "../../../apps/api/migrations/0050_model_live_bounded_refusal_validation_receipts.sql";
import migration0051 from "../../../apps/api/migrations/0051_model_live_repository_validation_receipts.sql";
import migration0052 from "../../../apps/api/migrations/0052_model_live_external_validation_receipts.sql";
import migration0053 from "../../../apps/api/migrations/0053_model_live_event_validation_receipts.sql";
import migration0054 from "../../../apps/api/migrations/0054_solution_export_cloudformation_compatibility.sql";
import migration0055 from "../../../apps/api/migrations/0055_cloudformation_export_pro_plan.sql";
import migration0056 from "../../../apps/api/migrations/0056_model_live_invocation_sets.sql";
import migration0057 from "../../../apps/api/migrations/0057_model_live_parser_input_receipts.sql";
import migration0058 from "../../../apps/api/migrations/0058_model_live_sequences.sql";
import migration0059 from "../../../apps/api/migrations/0059_model_live_event_criterion_policy.sql";
import migration0078 from "../../../apps/api/migrations/0078_browser_refresh_sessions.sql";
import migration0079 from "../../../apps/api/migrations/0079_deleted_proposal_erasure.sql";
import migration0080 from "../../../apps/api/migrations/0080_beta_ai_credits.sql";
import migration0081 from "../../../apps/api/migrations/0081_pro_monthly_credits.sql";
import migration0082 from "../../../apps/api/migrations/0082_beta_ai_credit_conversion.sql";
import migration0083 from "../../../apps/api/migrations/0083_credit_top_up_purchases.sql";
import migration0084 from "../../../apps/api/migrations/0084_personal_workspace_ownership.sql";
import migration0085 from "../../../apps/api/migrations/0085_account_profiles.sql";
import migration0086 from "../../../apps/api/migrations/0086_recipient_bound_organization_invitations.sql";
import migration0087 from "../../../apps/api/migrations/0087_organization_membership_lifecycle.sql";
import migration0088 from "../../../apps/api/migrations/0088_account_session_revocation.sql";
import migration0089 from "../../../apps/api/migrations/0089_account_credential_audit.sql";
import migration0090 from "../../../apps/api/migrations/0090_account_authenticator_enrollments.sql";
import migration0091 from "../../../apps/api/migrations/0091_gitlab_oauth_connections.sql";
import migration0092 from "../../../apps/api/migrations/0092_platform_staff_accounts.sql";
import migration0093 from "../../../apps/api/migrations/0093_live_stripe_provenance.sql";
import migration0094 from "../../../apps/api/migrations/0094_hosted_terraform_validation_submissions.sql";
import migration0095 from "../../../apps/api/migrations/0095_bitbucket_oauth_connections.sql";
import migration0096 from "../../../apps/api/migrations/0096_project_cleanup_precommit_admissions.sql";
import migration0097 from "../../../apps/api/migrations/0097_account_photos.sql";
import migration0098 from "../../../apps/api/migrations/0098_staff_trial_access.sql";
import migration0099 from "../../../apps/api/migrations/0099_model_live_seed_validation_receipts.sql";
import migration0100 from "../../../apps/api/migrations/0100_model_live_sequence_inputs.sql";
import migration0101 from "../../../apps/api/migrations/0101_model_live_seed_runtime_admissions.sql";
import migration0102 from "../../../apps/api/migrations/0102_model_live_seed_commercial_reservations.sql";
import migration0103 from "../../../apps/api/migrations/0103_model_live_seed_sequence_runtime.sql";
import migration0104 from "../../../apps/api/migrations/0104_model_live_seed_sequence_reservations.sql";
import migration0105 from "../../../apps/api/migrations/0105_model_live_sequence_attempt_journal.sql";
import migration0106 from "../../../apps/api/migrations/0106_model_live_sequence_usage_observations.sql";
import migration0107 from "../../../apps/api/migrations/0107_model_live_sequence_candidate_validations.sql";
import migration0108 from "../../../apps/api/migrations/0108_model_live_repair_successor_inputs.sql";
import migration0109 from "../../../apps/api/migrations/0109_model_live_repair_successor_dispatches.sql";
import migration0110 from "../../../apps/api/migrations/0110_model_live_repair_successor_usage_observations.sql";
import migration0111 from "../../../apps/api/migrations/0111_model_live_repair_successor_candidate_validations.sql";
import migration0112 from "../../../apps/api/migrations/0112_model_live_repair_unused_stages.sql";
import migration0113 from "../../../apps/api/migrations/0113_model_live_repair_recorded_receipts.sql";
import migration0114 from "../../../apps/api/migrations/0114_model_live_repair_terminal_accounting.sql";
import migration0115 from "../../../apps/api/migrations/0115_model_live_repair_known_failure.sql";
import migration0116 from "../../../apps/api/migrations/0116_model_live_repair_expiry_receipts.sql";
import migration0117 from "../../../apps/api/migrations/0117_model_gpt6_whole_request_pricing.sql";
import migration0118 from "../../../apps/api/migrations/0118_model_gpt6_exact_repair_effort.sql";
import migration0119 from "../../../apps/api/migrations/0119_model_gpt6_reports_and_promotions.sql";
import migration0120 from "../../../apps/api/migrations/0120_model_live_typed_application_criterion.sql";
import migration0121 from "../../../apps/api/migrations/0121_model_live_generation_criterion.sql";
import migration0122 from "../../../apps/api/migrations/0122_model_live_ci_package_successor.sql";
import migration0123 from "../../../apps/api/migrations/0123_model_native_zero_and_product_receipts.sql";
import migration0124 from "../../../apps/api/migrations/0124_model_gpt6_mixed_report_shape.sql";
import migration0125 from "../../../apps/api/migrations/0125_standard_shared_ui_and_beta_bootstrap.sql";
import migration0126 from "../../../apps/api/migrations/0126_notes_native_publication.sql";
import migration0127 from "../../../apps/api/migrations/0127_private_notes_and_gpt6_receipt_authorities.sql";
import migration0128 from "../../../apps/api/migrations/0128_model_repair_invalid_output_terminal_successor.sql";
import migration0129 from "../../../apps/api/migrations/0129_model_gpt6_publication_binding_successor.sql";
import migration0130 from "../../../apps/api/migrations/0130_model_native_zero_binding_successor.sql";
import migration0131 from "../../../apps/api/migrations/0131_standard_shared_ui_private_lock_successor.sql";
import migration0132 from "../../../apps/api/migrations/0132_ordinary_fixed_lock_foundation.sql";
import migration0133 from "../../../apps/api/migrations/0133_ordinary_authorization_lock_helpers.sql";
import migration0134 from "../../../apps/api/migrations/0134_ordinary_invoker_successors.sql";
import migration0135 from "../../../apps/api/migrations/0135_ordinary_preview_canonical_verifier.sql";
import migration0136 from "../../../apps/api/migrations/0136_model_private_runtime_definitions.sql";
import migration0137 from "../../../apps/api/migrations/0137_provider_direct_usage_journal_definitions.sql";
import migration0138 from "../../../apps/api/migrations/0138_staff_credit_ai_access.sql";
import bundledMigrationManifest from "../../../apps/api/migrations/manifest.json" with { type: "json" };

interface ManifestEntry {
  readonly checksumSha256: string;
  readonly file: string;
  readonly version: string;
}

interface Migration extends ManifestEntry {
  readonly statements: readonly string[];
}

interface MigrationManifest {
  readonly migrations: readonly ManifestEntry[];
  readonly storageContractVersion: 1;
}

interface AppliedMigrationRow {
  readonly checksum_sha256: string;
  readonly version: string;
}

const sourceByFile: Readonly<Record<string, string>> = Object.freeze({
  "0001_identity_and_tenancy.sql": migration0001,
  "0002_projects_and_architecture.sql": migration0002,
  "0003_jobs_integrations_and_audit.sql": migration0003,
  "0004_billing_usage_placeholders.sql": migration0004,
  "0005_canonical_organization_authorization.sql": migration0005,
  "0006_project_revision_lifecycle.sql": migration0006,
  "0007_commercial_domain_foundation.sql": migration0007,
  "0008_stripe_billing_adapter.sql": migration0008,
  "0009_canonical_solution_records.sql": migration0009,
  "0010_provider_neutral_async_jobs.sql": migration0010,
  "0011_commercial_trigger_record_safety.sql": migration0011,
  "0012_solution_export_read_model.sql": migration0012,
  "0013_model_gateway_commercial_lifecycle.sql": migration0013,
  "0014_github_app_repository_export.sql": migration0014,
  "0015_github_app_installation_link_intents.sql": migration0015,
  "0016_github_repository_import_sync.sql": migration0016,
  "0017_async_job_runtime_metadata.sql": migration0017,
  "0018_billing_audit_target_compatibility.sql": migration0018,
  "0019_model_runtime_invocation_persistence.sql": migration0019,
  "0020_model_platform_spend_reservations.sql": migration0020,
  "0021_billing_checkout_attempts.sql": migration0021,
  "0022_model_commercial_workflows.sql": migration0022,
  "0023_editor_integration_read_policy.sql": migration0023,
  "0024_model_runtime_host_evidence.sql": migration0024,
  "0025_project_editing_leases.sql": migration0025,
  "0026_ai_intent_previews.sql": migration0026,
  "0027_model_runtime_admissions.sql": migration0027,
  "0028_model_commercial_accounting.sql": migration0028,
  "0029_model_commercial_terminal_accounting.sql": migration0029,
  "0030_solution_export_terminal_compatibility.sql": migration0030,
  "0031_ai_intent_preview_authorities.sql": migration0031,
  "0032_organization_invitations_and_sharing_plans.sql": migration0032,
  "0033_project_content_write_fences.sql": migration0033,
  "0034_project_content_erasure_receipts.sql": migration0034,
  "0035_draft_command_receipts.sql": migration0035,
  "0036_model_live_evaluation_plans.sql": migration0036,
  "0037_model_live_runtime_admissions.sql": migration0037,
  "0038_model_live_commercial_reservations.sql": migration0038,
  "0039_model_live_invocation_journal.sql": migration0039,
  "0040_model_live_terminal_failures.sql": migration0040,
  "0041_model_live_runtime_host_evidence.sql": migration0041,
  "0042_model_live_no_dispatch_expiry.sql": migration0042,
  "0043_model_live_proposal_validation_receipts.sql": migration0043,
  "0044_model_live_evaluation_settlement.sql": migration0044,
  "0045_model_live_unvalidated_completion_expiry.sql": migration0045,
  "0046_accepted_intents.sql": migration0046,
  "0047_model_live_intent_validation_receipts.sql": migration0047,
  "0048_model_live_private_vpc_validation_receipts.sql": migration0048,
  "0049_model_live_questions_validation_receipts.sql": migration0049,
  "0050_model_live_bounded_refusal_validation_receipts.sql": migration0050,
  "0051_model_live_repository_validation_receipts.sql": migration0051,
  "0052_model_live_external_validation_receipts.sql": migration0052,
  "0053_model_live_event_validation_receipts.sql": migration0053,
  "0054_solution_export_cloudformation_compatibility.sql": migration0054,
  "0055_cloudformation_export_pro_plan.sql": migration0055,
  "0056_model_live_invocation_sets.sql": migration0056,
  "0057_model_live_parser_input_receipts.sql": migration0057,
  "0058_model_live_sequences.sql": migration0058,
  "0059_model_live_event_criterion_policy.sql": migration0059,
  "0078_browser_refresh_sessions.sql": migration0078,
  "0079_deleted_proposal_erasure.sql": migration0079,
  "0080_beta_ai_credits.sql": migration0080,
  "0081_pro_monthly_credits.sql": migration0081,
  "0082_beta_ai_credit_conversion.sql": migration0082,
  "0083_credit_top_up_purchases.sql": migration0083,
  "0084_personal_workspace_ownership.sql": migration0084,
  "0085_account_profiles.sql": migration0085,
  "0086_recipient_bound_organization_invitations.sql": migration0086,
  "0087_organization_membership_lifecycle.sql": migration0087,
  "0088_account_session_revocation.sql": migration0088,
  "0089_account_credential_audit.sql": migration0089,
  "0090_account_authenticator_enrollments.sql": migration0090,
  "0091_gitlab_oauth_connections.sql": migration0091,
  "0092_platform_staff_accounts.sql": migration0092,
  "0093_live_stripe_provenance.sql": migration0093,
  "0094_hosted_terraform_validation_submissions.sql": migration0094,
  "0095_bitbucket_oauth_connections.sql": migration0095,
  "0096_project_cleanup_precommit_admissions.sql": migration0096,
  "0097_account_photos.sql": migration0097,
  "0098_staff_trial_access.sql": migration0098,
  "0099_model_live_seed_validation_receipts.sql": migration0099,
  "0100_model_live_sequence_inputs.sql": migration0100,
  "0101_model_live_seed_runtime_admissions.sql": migration0101,
  "0102_model_live_seed_commercial_reservations.sql": migration0102,
  "0103_model_live_seed_sequence_runtime.sql": migration0103,
  "0104_model_live_seed_sequence_reservations.sql": migration0104,
  "0105_model_live_sequence_attempt_journal.sql": migration0105,
  "0106_model_live_sequence_usage_observations.sql": migration0106,
  "0107_model_live_sequence_candidate_validations.sql": migration0107,
  "0108_model_live_repair_successor_inputs.sql": migration0108,
  "0109_model_live_repair_successor_dispatches.sql": migration0109,
  "0110_model_live_repair_successor_usage_observations.sql": migration0110,
  "0111_model_live_repair_successor_candidate_validations.sql": migration0111,
  "0112_model_live_repair_unused_stages.sql": migration0112,
  "0113_model_live_repair_recorded_receipts.sql": migration0113,
  "0114_model_live_repair_terminal_accounting.sql": migration0114,
  "0115_model_live_repair_known_failure.sql": migration0115,
  "0116_model_live_repair_expiry_receipts.sql": migration0116,
  "0117_model_gpt6_whole_request_pricing.sql": migration0117,
  "0118_model_gpt6_exact_repair_effort.sql": migration0118,
  "0119_model_gpt6_reports_and_promotions.sql": migration0119,
  "0120_model_live_typed_application_criterion.sql": migration0120,
  "0121_model_live_generation_criterion.sql": migration0121,
  "0122_model_live_ci_package_successor.sql": migration0122,
  "0123_model_native_zero_and_product_receipts.sql": migration0123,
  "0124_model_gpt6_mixed_report_shape.sql": migration0124,
  "0125_standard_shared_ui_and_beta_bootstrap.sql": migration0125,
  "0126_notes_native_publication.sql": migration0126,
  "0127_private_notes_and_gpt6_receipt_authorities.sql": migration0127,
  "0128_model_repair_invalid_output_terminal_successor.sql": migration0128,
  "0129_model_gpt6_publication_binding_successor.sql": migration0129,
  "0130_model_native_zero_binding_successor.sql": migration0130,
  "0131_standard_shared_ui_private_lock_successor.sql": migration0131,
  "0132_ordinary_fixed_lock_foundation.sql": migration0132,
  "0133_ordinary_authorization_lock_helpers.sql": migration0133,
  "0134_ordinary_invoker_successors.sql": migration0134,
  "0135_ordinary_preview_canonical_verifier.sql": migration0135,
  "0136_model_private_runtime_definitions.sql": migration0136,
  "0137_provider_direct_usage_journal_definitions.sql": migration0137,
  "0138_staff_credit_ai_access.sql": migration0138,
});

const sha256Pattern = /^[0-9a-f]{64}$/u;
const migrationFilePattern = /^\d{4}_[a-z0-9_]+\.sql$/u;
const migrationManifestSource = `${JSON.stringify(
  bundledMigrationManifest,
  null,
  2,
)}\n`;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new TypeError(`Missing required environment value ${name}.`);
  }
  return value;
}

function parseManifest(value: unknown): MigrationManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("The migration manifest must be an object.");
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (
    candidate["storageContractVersion"] !== 1 ||
    !Array.isArray(candidate["migrations"])
  ) {
    throw new TypeError("The migration manifest contract is invalid.");
  }
  const migrations = candidate["migrations"].map((rawEntry) => {
    if (
      typeof rawEntry !== "object" ||
      rawEntry === null ||
      Array.isArray(rawEntry)
    ) {
      throw new TypeError("A migration manifest entry is invalid.");
    }
    const entry = rawEntry as Readonly<Record<string, unknown>>;
    const checksumSha256 = entry["checksumSha256"];
    const file = entry["file"];
    const version = entry["version"];
    if (
      typeof checksumSha256 !== "string" ||
      typeof file !== "string" ||
      typeof version !== "string" ||
      !sha256Pattern.test(checksumSha256) ||
      !migrationFilePattern.test(file) ||
      file.slice(0, 4) !== version
    ) {
      throw new TypeError("A migration manifest entry is invalid.");
    }
    return { checksumSha256, file, version };
  });
  const ordered = [...migrations].sort((left, right) =>
    left.version.localeCompare(right.version),
  );
  if (
    migrations.length === 0 ||
    migrations.length !== Object.keys(sourceByFile).length ||
    new Set(migrations.map(({ version }) => version)).size !==
      migrations.length ||
    ordered.some(({ version }, index) => version !== migrations[index]?.version)
  ) {
    throw new TypeError("The migration manifest ordering is invalid.");
  }
  return { migrations, storageContractVersion: 1 };
}

export function splitPostgresStatements(source: string): readonly string[] {
  const statements: string[] = [];
  let start = 0;
  let index = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockCommentDepth = 0;
  let dollarTag: string | undefined;

  while (index < source.length) {
    const current = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (lineComment) {
      if (current === "\n") lineComment = false;
      index += 1;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (current === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 2;
      } else if (current === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (dollarTag !== undefined) {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        dollarTag = undefined;
      } else {
        index += 1;
      }
      continue;
    }
    if (singleQuoted) {
      if (current === "'" && next === "'") {
        index += 2;
      } else {
        if (current === "'") singleQuoted = false;
        index += 1;
      }
      continue;
    }
    if (doubleQuoted) {
      if (current === '"' && next === '"') {
        index += 2;
      } else {
        if (current === '"') doubleQuoted = false;
        index += 1;
      }
      continue;
    }
    if (current === "-" && next === "-") {
      lineComment = true;
      index += 2;
      continue;
    }
    if (current === "/" && next === "*") {
      blockCommentDepth = 1;
      index += 2;
      continue;
    }
    if (current === "'") {
      singleQuoted = true;
      index += 1;
      continue;
    }
    if (current === '"') {
      doubleQuoted = true;
      index += 1;
      continue;
    }
    if (current === "$") {
      const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(
        source.slice(index),
      );
      if (match?.[0] !== undefined) {
        dollarTag = match[0];
        index += dollarTag.length;
        continue;
      }
    }
    if (current === ";") {
      const statement = source.slice(start, index).trim();
      if (statement.length > 0) statements.push(statement);
      start = index + 1;
    }
    index += 1;
  }
  if (
    singleQuoted ||
    doubleQuoted ||
    blockCommentDepth > 0 ||
    dollarTag !== undefined
  ) {
    throw new TypeError("A migration contains unterminated SQL syntax.");
  }
  const trailing = source.slice(start).trim();
  if (trailing.length > 0) statements.push(trailing);
  return statements;
}

export function loadMigrations(): readonly Migration[] {
  const expectedManifestSha256 = requiredEnvironment(
    "CLOUDMARKUP_MIGRATION_MANIFEST_SHA256",
  );
  const actualManifestSha256 = createHash("sha256")
    .update(migrationManifestSource)
    .digest("hex");
  if (
    !sha256Pattern.test(expectedManifestSha256) ||
    actualManifestSha256 !== expectedManifestSha256
  ) {
    throw new TypeError("The migration manifest checksum is invalid.");
  }
  const manifest = parseManifest(bundledMigrationManifest);
  const expectedVersion = requiredEnvironment(
    "CLOUDMARKUP_MIGRATION_EXPECTED_VERSION",
  );
  if (manifest.migrations.at(-1)?.version !== expectedVersion) {
    throw new TypeError("The migration manifest version is invalid.");
  }
  const manifestFiles = new Set(manifest.migrations.map(({ file }) => file));
  if (Object.keys(sourceByFile).some((file) => !manifestFiles.has(file))) {
    throw new TypeError("The bundled migration file set is invalid.");
  }
  return manifest.migrations.map((entry) => {
    const source = sourceByFile[entry.file];
    if (
      source === undefined ||
      createHash("sha256").update(source).digest("hex") !== entry.checksumSha256
    ) {
      throw new TypeError("A bundled migration checksum is invalid.");
    }
    return { ...entry, statements: splitPostgresStatements(source) };
  });
}

function rowsFrom(records: string | undefined): readonly AppliedMigrationRow[] {
  if (records === undefined) return [];
  const parsed: unknown = JSON.parse(records);
  if (!Array.isArray(parsed)) {
    throw new TypeError("The database returned invalid migration evidence.");
  }
  return parsed.map((row) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new TypeError("The database returned invalid migration evidence.");
    }
    const candidate = row as Readonly<Record<string, unknown>>;
    const version = candidate["version"];
    const checksumSha256 = candidate["checksum_sha256"];
    if (typeof version !== "string" || typeof checksumSha256 !== "string") {
      throw new TypeError("The database returned invalid migration evidence.");
    }
    return { checksum_sha256: checksumSha256.trim(), version };
  });
}

async function execute(
  client: RDSDataClient,
  sql: string,
  transactionId?: string,
  parameters?: readonly SqlParameter[],
): Promise<ExecuteStatementCommandOutput> {
  return client.send(
    new ExecuteStatementCommand({
      database: requiredEnvironment("CLOUDMARKUP_DATABASE_NAME"),
      formatRecordsAs: "JSON",
      includeResultMetadata: true,
      ...(parameters === undefined ? {} : { parameters: [...parameters] }),
      resourceArn: requiredEnvironment("CLOUDMARKUP_DATABASE_ARN"),
      secretArn: requiredEnvironment("CLOUDMARKUP_DATABASE_SECRET_ARN"),
      sql,
      ...(transactionId === undefined ? {} : { transactionId }),
    }),
  );
}

async function queryAppliedMigrations(
  client: RDSDataClient,
  sql: string,
  transactionId?: string,
  parameters?: readonly SqlParameter[],
): Promise<readonly AppliedMigrationRow[]> {
  const response = await execute(client, sql, transactionId, parameters);
  return rowsFrom(response.formattedRecords);
}

export async function runMigrations(
  client: RDSDataClient,
  migrations: readonly Migration[],
): Promise<readonly AppliedMigrationRow[]> {
  await execute(
    client,
    `CREATE TABLE IF NOT EXISTS cloudmarkup_schema_migrations (
       version VARCHAR(128) PRIMARY KEY,
       checksum_sha256 CHAR(64) NOT NULL,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$')
     )`,
  );
  const expected = new Map(
    migrations.map(({ checksumSha256, version }) => [version, checksumSha256]),
  );
  const validateRows = (rows: readonly AppliedMigrationRow[]): void => {
    for (const row of rows) {
      if (expected.get(row.version) !== row.checksum_sha256) {
        throw new TypeError("Applied migration evidence does not match.");
      }
    }
  };
  validateRows(
    await queryAppliedMigrations(
      client,
      "SELECT version, checksum_sha256 FROM cloudmarkup_schema_migrations",
    ),
  );

  for (const migration of migrations) {
    const begun = await client.send(
      new BeginTransactionCommand({
        database: requiredEnvironment("CLOUDMARKUP_DATABASE_NAME"),
        resourceArn: requiredEnvironment("CLOUDMARKUP_DATABASE_ARN"),
        secretArn: requiredEnvironment("CLOUDMARKUP_DATABASE_SECRET_ARN"),
      }),
    );
    if (begun.transactionId === undefined) {
      throw new TypeError("The database migration transaction did not start.");
    }
    const transactionId = begun.transactionId;
    try {
      await execute(
        client,
        "SELECT pg_advisory_xact_lock(21000000)",
        transactionId,
      );
      const existing = await queryAppliedMigrations(
        client,
        "SELECT version, checksum_sha256 FROM cloudmarkup_schema_migrations WHERE version = :version",
        transactionId,
        [
          {
            name: "version",
            value: { stringValue: migration.version },
          },
        ],
      );
      if (existing.length > 0) {
        validateRows(existing);
      } else {
        const laterApplied = await queryAppliedMigrations(
          client,
          "SELECT version, checksum_sha256 FROM cloudmarkup_schema_migrations WHERE version > :version",
          transactionId,
          [{ name: "version", value: { stringValue: migration.version } }],
        );
        if (laterApplied.length > 0) {
          throw new TypeError(
            "An earlier migration cannot be inserted after an applied successor.",
          );
        }
        for (const statement of migration.statements) {
          await execute(client, statement, transactionId);
        }
        await execute(
          client,
          "INSERT INTO cloudmarkup_schema_migrations (version, checksum_sha256) VALUES (:version, :checksum)",
          transactionId,
          [
            {
              name: "version",
              value: { stringValue: migration.version },
            },
            {
              name: "checksum",
              value: { stringValue: migration.checksumSha256 },
            },
          ],
        );
      }
      await client.send(
        new CommitTransactionCommand({
          resourceArn: requiredEnvironment("CLOUDMARKUP_DATABASE_ARN"),
          secretArn: requiredEnvironment("CLOUDMARKUP_DATABASE_SECRET_ARN"),
          transactionId,
        }),
      );
    } catch (error) {
      try {
        await client.send(
          new RollbackTransactionCommand({
            resourceArn: requiredEnvironment("CLOUDMARKUP_DATABASE_ARN"),
            secretArn: requiredEnvironment("CLOUDMARKUP_DATABASE_SECRET_ARN"),
            transactionId,
          }),
        );
      } catch {
        // Preserve the original migration failure.
      }
      throw error;
    }
  }
  const applied = await queryAppliedMigrations(
    client,
    "SELECT version, checksum_sha256 FROM cloudmarkup_schema_migrations ORDER BY version",
  );
  validateRows(applied);
  if (
    applied.length !== migrations.length ||
    applied.some(({ version }, index) => version !== migrations[index]?.version)
  ) {
    throw new TypeError("The database migration set is incomplete.");
  }
  return applied;
}

function physicalResourceId(
  event: CloudFormationCustomResourceEvent,
  manifestSha256: string,
): string {
  return "PhysicalResourceId" in event
    ? event.PhysicalResourceId
    : `cloudmarkup-database-migrations-${manifestSha256.slice(0, 20)}`;
}

async function sendResponse(
  event: CloudFormationCustomResourceEvent,
  response: CloudFormationCustomResourceResponse,
): Promise<void> {
  const body = JSON.stringify(response);
  const result = await fetch(event.ResponseURL, {
    body,
    headers: {
      "content-length": String(Buffer.byteLength(body)),
      "content-type": "",
    },
    method: "PUT",
  });
  if (!result.ok) {
    throw new TypeError(
      `CloudFormation response failed with status ${String(result.status)}.`,
    );
  }
}

export async function handler(
  event: CloudFormationCustomResourceEvent,
): Promise<void> {
  const manifestSha256 = requiredEnvironment(
    "CLOUDMARKUP_MIGRATION_MANIFEST_SHA256",
  );
  const expectedVersion = requiredEnvironment(
    "CLOUDMARKUP_MIGRATION_EXPECTED_VERSION",
  );
  const responseBase = {
    LogicalResourceId: event.LogicalResourceId,
    PhysicalResourceId: physicalResourceId(event, manifestSha256),
    RequestId: event.RequestId,
    StackId: event.StackId,
  } as const;
  try {
    if (event.RequestType === "Delete") {
      await sendResponse(event, {
        ...responseBase,
        Data: {
          AppliedVersion: expectedVersion,
          ManifestSha256: manifestSha256,
          MigrationCount: "0",
        },
        Status: "SUCCESS",
      });
      return;
    }
    if (
      event.ResourceProperties["ExpectedSchemaVersion"] !== expectedVersion ||
      event.ResourceProperties["ManifestSha256"] !== manifestSha256
    ) {
      throw new TypeError(
        "CloudFormation migration properties do not match the Lambda bundle.",
      );
    }
    const migrations = loadMigrations();
    const client = new RDSDataClient({});
    try {
      const applied = await runMigrations(client, migrations);
      console.log(
        JSON.stringify({
          appliedVersion: applied.at(-1)?.version,
          event: "database.migration.succeeded",
          manifestSha256,
          migrationCount: applied.length,
        }),
      );
      await sendResponse(event, {
        ...responseBase,
        Data: {
          AppliedVersion: applied.at(-1)?.version ?? "",
          ManifestSha256: manifestSha256,
          MigrationCount: String(applied.length),
        },
        Status: "SUCCESS",
      });
    } finally {
      client.destroy();
    }
  } catch (error) {
    const reason =
      error instanceof Error
        ? `Database migration failed: ${error.name}`
        : "Database migration failed.";
    console.error(
      JSON.stringify({
        errorType: error instanceof Error ? error.name : "UnknownError",
        event: "database.migration.failed",
      }),
    );
    await sendResponse(event, {
      ...responseBase,
      Data: {},
      Reason: reason,
      Status: "FAILED",
    });
  }
}
