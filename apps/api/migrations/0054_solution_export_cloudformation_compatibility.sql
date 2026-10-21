-- Add the already-versioned CloudFormation export target without changing any
-- tenant, immutable-revision, execution, commercial or publication authority.
ALTER TABLE solution_export_runs
  DROP CONSTRAINT solution_export_runs_target_profile_id_check,
  DROP CONSTRAINT solution_export_runs_progress_stage_v2_check,
  ADD CONSTRAINT solution_export_runs_target_profile_id_v2_check CHECK (
    target_profile_id IN (
      'cloudmarkup.export.terraform-nodejs24-v1',
      'cloudmarkup.export.cloudformation-nodejs24-v1'
    )
  ),
  ADD CONSTRAINT solution_export_runs_progress_stage_v3_check CHECK (
    progress_stage IS NULL OR progress_stage IN (
      'authorization', 'compilation', 'application-generation',
      'application-build', 'diagram-rendering', 'packaging', 'publication'
    ) OR (
      progress_stage = 'terraform-validation'
      AND target_profile_id = 'cloudmarkup.export.terraform-nodejs24-v1'
    ) OR (
      progress_stage = 'cloudformation-validation'
      AND target_profile_id = 'cloudmarkup.export.cloudformation-nodejs24-v1'
    )
  );

ALTER TABLE solution_export_artifact_files
  DROP CONSTRAINT solution_export_artifact_files_media_type_v2_check,
  ADD CONSTRAINT solution_export_artifact_files_media_type_v3_check CHECK (
    media_type IN (
      'application/json', 'application/pdf',
      'application/vnd.cyclonedx+json',
      'application/vnd.hashicorp.terraform',
      'application/vnd.amazon.cloudformation.template+json',
      'application/yaml', 'application/zip', 'image/png', 'image/svg+xml',
      'text/markdown', 'text/plain', 'text/typescript'
    )
  );
