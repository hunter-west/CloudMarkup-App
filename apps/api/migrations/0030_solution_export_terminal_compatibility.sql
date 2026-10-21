-- Additive compatibility with the already-versioned eight-stage export and
-- its mandatory credentialless YAML workflow. No target or execution authority.
DO $$
DECLARE
  target RECORD;
  found_constraint RECORD;
  found_count INTEGER;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('solution_export_runs', 'progress_completed_stages'),
      ('solution_export_runs', 'progress_stage'),
      ('solution_export_artifact_files', 'media_type')
    ) AS targets(table_name, column_name)
  LOOP
    found_count := 0;
    FOR found_constraint IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid
        AND a.attname=target.column_name AND NOT a.attisdropped
      WHERE c.conrelid=target.table_name::regclass AND c.contype='c'
        AND c.conkey=ARRAY[a.attnum]::smallint[]
    LOOP
      found_count := found_count + 1;
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',
        target.table_name, found_constraint.conname);
    END LOOP;
    IF found_count <> 1 THEN
      RAISE EXCEPTION 'expected exactly one canonical export compatibility check'
        USING ERRCODE='23514';
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE solution_export_runs
  ADD CONSTRAINT solution_export_runs_progress_count_v2_check
    CHECK (progress_completed_stages BETWEEN 0 AND 8),
  ADD CONSTRAINT solution_export_runs_progress_stage_v2_check
    CHECK (progress_stage IS NULL OR progress_stage IN (
      'authorization', 'compilation', 'application-generation',
      'application-build', 'terraform-validation', 'diagram-rendering',
      'packaging', 'publication'
    ));

ALTER TABLE solution_export_artifact_files
  ADD CONSTRAINT solution_export_artifact_files_media_type_v2_check
    CHECK (media_type IN (
      'application/json', 'application/pdf',
      'application/vnd.cyclonedx+json', 'application/vnd.hashicorp.terraform',
      'application/yaml', 'application/zip', 'image/png', 'image/svg+xml',
      'text/markdown', 'text/plain', 'text/typescript'
    ));
