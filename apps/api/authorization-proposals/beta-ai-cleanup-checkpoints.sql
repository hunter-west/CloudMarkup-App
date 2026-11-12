-- UNAPPLIED delta for migration 0142. Existing verified API owner only.
-- No staff-report, billing-reader, financial, dispatch, DELETE or control-write
-- privilege is added. Native role/source/restore admission remains required.
GRANT SELECT (organization_id,restore_epoch,resume_allowed,held)
 ON beta_ai_cleanup_control TO cloudmarkup_beta_api_runtime;
GRANT SELECT (organization_id,restore_epoch,generation,snapshot),
 INSERT (organization_id,restore_epoch,generation,snapshot), UPDATE (generation,snapshot)
 ON beta_ai_cleanup_checkpoints TO cloudmarkup_beta_api_runtime;
GRANT SELECT (organization_id,restore_epoch,operation_id,payload_sha256,kind,checkpoint,identities,verification_sha256,verified_completed_at),
 INSERT (organization_id,restore_epoch,operation_id,payload_sha256,kind,checkpoint,identities,verification_sha256)
 ON beta_ai_cleanup_operations TO cloudmarkup_beta_api_runtime;
GRANT SELECT (organization_id,reservation_id,restore_epoch,identity,financial_status,cleanup_status,accounting_status,verification_sha256),
 INSERT (organization_id,reservation_id,restore_epoch,identity,financial_status,cleanup_status,accounting_status,verification_sha256),
 UPDATE (restore_epoch,financial_status,cleanup_status,accounting_status,verification_sha256)
 ON beta_ai_cleanup_outcomes TO cloudmarkup_beta_api_runtime;
GRANT SELECT (organization_id,restore_epoch,operation_id,details,retired_at),
 INSERT (organization_id,restore_epoch,operation_id,details)
 ON beta_ai_cleanup_diagnostics TO cloudmarkup_beta_api_runtime;
-- Specifically no UPDATE(details,retired_at): retirement remains unactivated.
-- No enrollment/admission row, security-definer function, BYPASSRLS or owner role.
