-- Immediate erasure must not race a write whose bytes have not reached storage.
-- These rows contain only identities, hashes and outcomes, never project bytes.
CREATE TABLE project_content_write_scopes (
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  project_id VARCHAR(128) NOT NULL,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, project_id),
  CHECK (project_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (project_id <> 'organization')
);

-- No project FK: initial draft staging precedes project creation. The scope
-- remains reserved so a later deletion can still see every unfinished write.
CREATE TABLE project_content_writes (
  write_id VARCHAR(128) PRIMARY KEY,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  storage_namespace VARCHAR(128) NOT NULL,
  object_id VARCHAR(128) NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  created_by_principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'in-flight',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finalized_at TIMESTAMPTZ,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES project_content_write_scopes(organization_id, project_id),
  CHECK (write_id ~ '^write_[a-f0-9]{32}$'),
  CHECK (storage_namespace ~ '^[a-z][a-z0-9._-]{0,127}$'),
  CHECK (object_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (lifecycle_status IN ('in-flight','completed','uncertain')),
  CHECK ((lifecycle_status='in-flight') = (finalized_at IS NULL))
);
CREATE INDEX project_content_writes_unfinished_idx
  ON project_content_writes(organization_id,project_id)
  WHERE lifecycle_status <> 'completed';

CREATE FUNCTION enforce_project_content_write_scope() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP='DELETE' OR
    (to_jsonb(NEW)-'closed_at') IS DISTINCT FROM (to_jsonb(OLD)-'closed_at') OR
    OLD.closed_at IS NOT NULL OR NEW.closed_at IS NULL THEN
    RAISE EXCEPTION 'project write scope is immutable or already closed' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM projects p
    WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id
      AND p.lifecycle_status='deletion-pending' AND p.deletion_requested_at IS NOT NULL) THEN
    RAISE EXCEPTION 'project deletion intent is required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER project_content_write_scope_is_fenced
  BEFORE UPDATE OR DELETE ON project_content_write_scopes
  FOR EACH ROW EXECUTE FUNCTION enforce_project_content_write_scope();

CREATE FUNCTION enforce_project_content_write() RETURNS TRIGGER AS $$
DECLARE scope_closed TIMESTAMPTZ;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT closed_at INTO scope_closed FROM project_content_write_scopes
      WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id FOR UPDATE;
    IF NOT FOUND OR scope_closed IS NOT NULL OR NEW.lifecycle_status <> 'in-flight' THEN
      RAISE EXCEPTION 'project write scope is closed' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' OR
    (to_jsonb(NEW)-ARRAY['lifecycle_status','finalized_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['lifecycle_status','finalized_at']) OR
    OLD.lifecycle_status <> 'in-flight' OR NEW.lifecycle_status NOT IN ('completed','uncertain') OR
    NEW.finalized_at IS NULL OR NEW.finalized_at < OLD.created_at THEN
    RAISE EXCEPTION 'project write outcome is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER project_content_write_is_fenced
  BEFORE INSERT OR UPDATE OR DELETE ON project_content_writes
  FOR EACH ROW EXECUTE FUNCTION enforce_project_content_write();
