ALTER TABLE organizations
  ADD COLUMN deletion_requested_at TIMESTAMPTZ,
  ADD COLUMN deleted_at TIMESTAMPTZ;

ALTER TABLE organizations
  DROP CONSTRAINT organizations_lifecycle_status_check,
  ADD CONSTRAINT organizations_lifecycle_status_check
    CHECK (lifecycle_status IN (
      'active', 'suspended', 'deletion-pending', 'deleted'
    )),
  ADD CONSTRAINT organizations_deletion_state_check
    CHECK (
      (lifecycle_status NOT IN ('deletion-pending', 'deleted')
        AND deletion_requested_at IS NULL AND deleted_at IS NULL)
      OR (lifecycle_status = 'deletion-pending'
        AND deletion_requested_at IS NOT NULL AND deleted_at IS NULL)
      OR (lifecycle_status = 'deleted'
        AND deletion_requested_at IS NOT NULL AND deleted_at IS NOT NULL)
    );

ALTER TABLE projects
  ADD COLUMN deletion_requested_at TIMESTAMPTZ,
  ADD COLUMN deleted_at TIMESTAMPTZ;

ALTER TABLE projects
  DROP CONSTRAINT projects_lifecycle_status_check,
  ADD CONSTRAINT projects_lifecycle_status_check
    CHECK (lifecycle_status IN (
      'active', 'archived', 'deletion-pending', 'deleted'
    )),
  ADD CONSTRAINT projects_deletion_state_check
    CHECK (
      (lifecycle_status NOT IN ('deletion-pending', 'deleted')
        AND deletion_requested_at IS NULL AND deleted_at IS NULL)
      OR (lifecycle_status = 'deletion-pending'
        AND deletion_requested_at IS NOT NULL AND deleted_at IS NULL)
      OR (lifecycle_status = 'deleted'
        AND deletion_requested_at IS NOT NULL AND deleted_at IS NOT NULL)
    );

ALTER TABLE project_environments
  ADD COLUMN lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'active',
  ADD COLUMN deletion_requested_at TIMESTAMPTZ,
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD CONSTRAINT project_environments_lifecycle_status_check
    CHECK (lifecycle_status IN ('active', 'deletion-pending', 'deleted')),
  ADD CONSTRAINT project_environments_deletion_state_check
    CHECK (
      (lifecycle_status = 'active'
        AND deletion_requested_at IS NULL AND deleted_at IS NULL)
      OR (lifecycle_status = 'deletion-pending'
        AND deletion_requested_at IS NOT NULL AND deleted_at IS NULL)
      OR (lifecycle_status = 'deleted'
        AND deletion_requested_at IS NOT NULL AND deleted_at IS NOT NULL)
    );

ALTER TABLE architecture_revisions
  ADD COLUMN revision_name VARCHAR(120),
  ADD COLUMN revision_number BIGINT,
  ADD COLUMN compiler_input_contract_version INTEGER,
  ADD COLUMN minimum_compiler_version VARCHAR(64),
  ADD COLUMN maximum_compiler_version_exclusive VARCHAR(64);

-- The immutable-row trigger is suspended only for this reviewed compatibility
-- backfill. The enclosing migration transaction restores it on any failure.
ALTER TABLE architecture_revisions
  DISABLE TRIGGER architecture_revisions_are_immutable;

WITH numbered_revisions AS (
  SELECT revision_id,
         ROW_NUMBER() OVER (
           PARTITION BY project_id ORDER BY created_at, revision_id
         ) AS revision_number
  FROM architecture_revisions
)
UPDATE architecture_revisions AS revision
SET revision_name = revision.revision_id,
    revision_number = numbered.revision_number,
    compiler_input_contract_version = 1,
    minimum_compiler_version = '0.0.0'
FROM numbered_revisions AS numbered
WHERE numbered.revision_id = revision.revision_id;
ALTER TABLE architecture_revisions
  ENABLE TRIGGER architecture_revisions_are_immutable;

ALTER TABLE architecture_revisions
  ALTER COLUMN revision_name SET NOT NULL,
  ALTER COLUMN revision_number SET NOT NULL,
  ALTER COLUMN compiler_input_contract_version SET NOT NULL,
  ALTER COLUMN minimum_compiler_version SET NOT NULL,
  ADD CONSTRAINT architecture_revisions_name_check
    CHECK (length(btrim(revision_name)) BETWEEN 1 AND 120),
  ADD CONSTRAINT architecture_revisions_number_check
    CHECK (revision_number > 0),
  ADD CONSTRAINT architecture_revisions_compiler_contract_check
    CHECK (compiler_input_contract_version > 0),
  ADD CONSTRAINT architecture_revisions_compiler_versions_check
    CHECK (
      length(btrim(minimum_compiler_version)) BETWEEN 1 AND 64
      AND (maximum_compiler_version_exclusive IS NULL
        OR length(btrim(maximum_compiler_version_exclusive)) BETWEEN 1 AND 64)
    ),
  ADD CONSTRAINT architecture_revisions_project_number_unique
    UNIQUE (project_id, revision_number);

-- Content-addressed object bytes may be shared by separate named revision
-- records. Consequential-request idempotency, rather than document identity,
-- controls replay of revision metadata creation.
DO $$
DECLARE
  content_identity_constraint TEXT;
BEGIN
  SELECT constraint_record.conname
  INTO content_identity_constraint
  FROM pg_constraint AS constraint_record
  WHERE constraint_record.conrelid = 'architecture_revisions'::regclass
    AND constraint_record.contype = 'u'
    AND (
      SELECT array_agg(attribute_record.attname ORDER BY key_record.ordinality)
      FROM unnest(constraint_record.conkey)
        WITH ORDINALITY AS key_record(attnum, ordinality)
      JOIN pg_attribute AS attribute_record
        ON attribute_record.attrelid = constraint_record.conrelid
       AND attribute_record.attnum = key_record.attnum
    ) = ARRAY[
      'project_id',
      'source_draft_id',
      'source_draft_version',
      'content_sha256'
    ]::name[];

  IF content_identity_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE architecture_revisions DROP CONSTRAINT %I',
      content_identity_constraint
    );
  END IF;
END;
$$;

ALTER TABLE stored_objects
  ADD COLUMN delete_requested_at TIMESTAMPTZ,
  ADD COLUMN deleted_at TIMESTAMPTZ;

ALTER TABLE stored_objects
  DROP CONSTRAINT stored_objects_lifecycle_state_check,
  DROP CONSTRAINT stored_objects_check,
  ADD CONSTRAINT stored_objects_lifecycle_state_check
    CHECK (lifecycle_state IN (
      'publication-pending', 'published', 'delete-pending', 'deleted'
    )),
  ADD CONSTRAINT stored_objects_publication_state_check
    CHECK (
      (lifecycle_state = 'publication-pending' AND published_at IS NULL)
      OR (lifecycle_state IN ('published', 'delete-pending', 'deleted')
        AND published_at IS NOT NULL)
    ),
  ADD CONSTRAINT stored_objects_deletion_state_check
    CHECK (
      (lifecycle_state IN ('publication-pending', 'published')
        AND delete_requested_at IS NULL AND deleted_at IS NULL)
      OR (lifecycle_state = 'delete-pending'
        AND delete_requested_at IS NOT NULL AND deleted_at IS NULL)
      OR (lifecycle_state = 'deleted'
        AND delete_requested_at IS NOT NULL AND deleted_at IS NOT NULL)
    );

ALTER TABLE idempotency_records
  DROP CONSTRAINT idempotency_records_pkey,
  ADD CONSTRAINT idempotency_records_pkey PRIMARY KEY (
    organization_id, principal_id, operation_name, idempotency_key_sha256
  );

CREATE INDEX projects_deletion_pending_idx
  ON projects (organization_id, deletion_requested_at, project_id)
  WHERE lifecycle_status = 'deletion-pending';

CREATE INDEX organizations_deletion_pending_idx
  ON organizations (deletion_requested_at, organization_id)
  WHERE lifecycle_status = 'deletion-pending';
