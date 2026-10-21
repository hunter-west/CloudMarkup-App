ALTER TABLE stored_objects
  DROP CONSTRAINT stored_objects_object_purpose_check,
  ADD CONSTRAINT stored_objects_object_purpose_check
    CHECK (object_purpose IN (
      'architecture-draft',
      'architecture-revision',
      'validation-report',
      'generated-code',
      'diagram',
      'report',
      'artifact-manifest',
      'combined-artifact',
      'repository-snapshot',
      'observed-solution',
      'reconciliation-proposal',
      'solution-revision-manifest',
      'ai-authored-extension',
      'active-issue',
      'evidence'
    ));

CREATE TABLE solution_records (
  solution_record_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  record_kind VARCHAR(64) NOT NULL,
  subject_id VARCHAR(128) NOT NULL,
  contract_version INTEGER NOT NULL,
  content_object_id VARCHAR(128) NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  architecture_revision_id VARCHAR(128),
  previous_solution_record_id VARCHAR(128),
  created_by_principal_id VARCHAR(128) NOT NULL
    REFERENCES principals(principal_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    solution_record_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CHECK (subject_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (record_kind IN (
    'repository-snapshot',
    'observed-solution',
    'reconciliation-proposal',
    'solution-revision-manifest',
    'ai-authored-extension',
    'active-issue',
    'evidence'
  )),
  CHECK (contract_version > 0),
  CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (
    previous_solution_record_id IS NULL
    OR previous_solution_record_id <> solution_record_id
  ),
  CHECK (
    record_kind <> 'solution-revision-manifest'
    OR (
      architecture_revision_id IS NOT NULL
      AND previous_solution_record_id IS NULL
    )
  ),
  UNIQUE (organization_id, project_id, solution_record_id),
  UNIQUE (
    organization_id,
    project_id,
    solution_record_id,
    record_kind,
    subject_id
  ),
  UNIQUE (organization_id, project_id, content_object_id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, project_id, content_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id),
  FOREIGN KEY (organization_id, project_id, architecture_revision_id)
    REFERENCES architecture_revisions(
      organization_id,
      project_id,
      revision_id
    ),
  FOREIGN KEY (
    organization_id,
    project_id,
    previous_solution_record_id,
    record_kind,
    subject_id
  )
    REFERENCES solution_records(
      organization_id,
      project_id,
      solution_record_id,
      record_kind,
      subject_id
    )
);

CREATE FUNCTION validate_solution_record_object()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM stored_objects AS object_record
  WHERE object_record.organization_id = NEW.organization_id
    AND object_record.project_id = NEW.project_id
    AND object_record.object_id = NEW.content_object_id
    AND object_record.object_purpose = NEW.record_kind
    AND object_record.content_sha256 = NEW.content_sha256;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'solution record object metadata does not match'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER solution_records_validate_object
BEFORE INSERT ON solution_records
FOR EACH ROW EXECUTE FUNCTION validate_solution_record_object();

CREATE TRIGGER solution_records_are_immutable
BEFORE UPDATE OR DELETE ON solution_records
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE UNIQUE INDEX solution_manifest_identity_unique_idx
  ON solution_records (organization_id, project_id, subject_id)
  WHERE record_kind = 'solution-revision-manifest';

CREATE INDEX solution_records_project_created_idx
  ON solution_records (
    organization_id,
    project_id,
    created_at DESC,
    solution_record_id
  );

CREATE INDEX solution_records_subject_created_idx
  ON solution_records (
    organization_id,
    project_id,
    record_kind,
    subject_id,
    created_at DESC,
    solution_record_id
  );

COMMENT ON TABLE solution_records IS
  'Tenant-scoped immutable metadata for canonical solution records stored as versioned objects.';
