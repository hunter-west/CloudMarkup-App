CREATE TABLE projects (
  project_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500),
  lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'active',
  record_version BIGINT NOT NULL DEFAULT 1,
  current_draft_id VARCHAR(128),
  latest_revision_id VARCHAR(128),
  created_by_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (project_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 500),
  CHECK (lifecycle_status IN ('active', 'archived')),
  CHECK (record_version > 0),
  UNIQUE (organization_id, project_id)
);

CREATE TABLE project_environments (
  environment_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  name VARCHAR(120) NOT NULL,
  environment_type VARCHAR(32) NOT NULL,
  region VARCHAR(64),
  record_version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (environment_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CHECK (environment_type IN (
    'development', 'test', 'staging', 'production',
    'disaster-recovery', 'multi-environment'
  )),
  CHECK (region IS NULL OR length(btrim(region)) BETWEEN 1 AND 64),
  CHECK (record_version > 0),
  UNIQUE (organization_id, project_id, environment_id),
  UNIQUE (project_id, name),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id)
);

CREATE TABLE stored_objects (
  object_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  project_id VARCHAR(128),
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  storage_provider VARCHAR(32) NOT NULL,
  object_purpose VARCHAR(64) NOT NULL,
  storage_key VARCHAR(1024) NOT NULL,
  object_version VARCHAR(1024) NOT NULL,
  entity_tag VARCHAR(512),
  content_sha256 CHAR(64) NOT NULL,
  size_bytes BIGINT NOT NULL,
  media_type VARCHAR(128) NOT NULL,
  lifecycle_state VARCHAR(32) NOT NULL DEFAULT 'publication-pending',
  created_by_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMPTZ,
  CHECK (object_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (storage_provider IN ('s3', 'filesystem', 'memory')),
  CHECK (object_purpose IN (
    'architecture-draft', 'architecture-revision', 'validation-report',
    'generated-code', 'diagram', 'report', 'artifact-manifest',
    'combined-artifact'
  )),
  CHECK (length(storage_key) BETWEEN 1 AND 1024),
  CHECK (length(object_version) BETWEEN 1 AND 1024),
  CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (size_bytes >= 0),
  CHECK (length(media_type) BETWEEN 1 AND 128),
  CHECK (lifecycle_state IN (
    'publication-pending', 'published', 'delete-pending'
  )),
  CHECK ((lifecycle_state = 'published') = (published_at IS NOT NULL)),
  UNIQUE (storage_provider, storage_key, object_version),
  UNIQUE (organization_id, project_id, object_id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id)
);

COMMENT ON TABLE stored_objects IS
  'Authorized metadata for immutable object versions; storage keys never grant access.';

CREATE INDEX stored_objects_pending_idx
  ON stored_objects (lifecycle_state, created_at)
  WHERE lifecycle_state = 'publication-pending';

CREATE TABLE architecture_drafts (
  draft_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  draft_version BIGINT NOT NULL,
  document_schema_version INTEGER NOT NULL,
  document_object_id VARCHAR(128) NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  semantic_sha256 CHAR(64) NOT NULL,
  visual_sha256 CHAR(64) NOT NULL,
  pending_draft_version BIGINT,
  pending_document_schema_version INTEGER,
  pending_document_object_id VARCHAR(128),
  pending_content_sha256 CHAR(64),
  pending_semantic_sha256 CHAR(64),
  pending_visual_sha256 CHAR(64),
  updated_by_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (draft_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (draft_version > 0),
  CHECK (document_schema_version > 0),
  CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (semantic_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (visual_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (pending_draft_version IS NULL OR pending_draft_version = draft_version + 1),
  CHECK (pending_document_schema_version IS NULL OR pending_document_schema_version > 0),
  CHECK (pending_content_sha256 IS NULL OR pending_content_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (pending_semantic_sha256 IS NULL OR pending_semantic_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (pending_visual_sha256 IS NULL OR pending_visual_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (
    (pending_draft_version IS NULL
      AND pending_document_schema_version IS NULL
      AND pending_document_object_id IS NULL
      AND pending_content_sha256 IS NULL
      AND pending_semantic_sha256 IS NULL
      AND pending_visual_sha256 IS NULL)
    OR
    (pending_draft_version IS NOT NULL
      AND pending_document_schema_version IS NOT NULL
      AND pending_document_object_id IS NOT NULL
      AND pending_content_sha256 IS NOT NULL
      AND pending_semantic_sha256 IS NOT NULL
      AND pending_visual_sha256 IS NOT NULL)
  ),
  UNIQUE (organization_id, project_id, draft_id),
  UNIQUE (project_id),
  UNIQUE (draft_id, draft_version),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, project_id, document_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id),
  FOREIGN KEY (organization_id, project_id, pending_document_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id)
);

CREATE TABLE architecture_revisions (
  revision_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  storage_contract_version SMALLINT NOT NULL DEFAULT 1,
  document_object_id VARCHAR(128) NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  semantic_sha256 CHAR(64) NOT NULL,
  visual_sha256 CHAR(64) NOT NULL,
  graph_schema_version INTEGER NOT NULL,
  workload_behavior_version INTEGER NOT NULL,
  catalog_id VARCHAR(128) NOT NULL,
  catalog_version VARCHAR(64) NOT NULL,
  catalog_sha256 CHAR(64) NOT NULL,
  source_draft_id VARCHAR(128) NOT NULL,
  source_draft_version BIGINT NOT NULL,
  previous_revision_id VARCHAR(128),
  validation_run_id VARCHAR(128) NOT NULL,
  created_by_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (revision_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (storage_contract_version = 1),
  CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (semantic_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (visual_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (catalog_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (graph_schema_version > 0),
  CHECK (workload_behavior_version > 0),
  CHECK (source_draft_version > 0),
  CHECK (previous_revision_id IS NULL OR previous_revision_id <> revision_id),
  UNIQUE (organization_id, project_id, revision_id),
  UNIQUE (project_id, source_draft_id, source_draft_version, content_sha256),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, project_id, document_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id),
  FOREIGN KEY (organization_id, project_id, source_draft_id)
    REFERENCES architecture_drafts(organization_id, project_id, draft_id),
  FOREIGN KEY (organization_id, project_id, previous_revision_id)
    REFERENCES architecture_revisions(organization_id, project_id, revision_id)
);

ALTER TABLE projects
  ADD CONSTRAINT projects_current_draft_fk
  FOREIGN KEY (organization_id, project_id, current_draft_id)
  REFERENCES architecture_drafts(organization_id, project_id, draft_id);

ALTER TABLE projects
  ADD CONSTRAINT projects_latest_revision_fk
  FOREIGN KEY (organization_id, project_id, latest_revision_id)
  REFERENCES architecture_revisions(organization_id, project_id, revision_id);

CREATE OR REPLACE FUNCTION reject_immutable_row_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable record cannot be changed'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER architecture_revisions_are_immutable
BEFORE UPDATE OR DELETE ON architecture_revisions
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE INDEX projects_organization_updated_idx
  ON projects (organization_id, updated_at DESC, project_id);

CREATE INDEX revisions_project_created_idx
  ON architecture_revisions (organization_id, project_id, created_at DESC, revision_id);
