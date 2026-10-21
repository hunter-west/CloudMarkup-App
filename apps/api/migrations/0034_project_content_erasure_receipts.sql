-- A verified deletion can erase never-published content without inventing a
-- publication timestamp. Published states retain their existing requirement.
ALTER TABLE stored_objects
  DROP CONSTRAINT stored_objects_publication_state_check,
  ADD CONSTRAINT stored_objects_publication_state_check CHECK (
    (lifecycle_state='publication-pending' AND published_at IS NULL)
    OR (lifecycle_state IN ('published','delete-pending') AND published_at IS NOT NULL)
    OR lifecycle_state='deleted'
  );

CREATE TABLE project_content_erasure_receipts (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  policy_version SMALLINT NOT NULL DEFAULT 1 CHECK (policy_version=1),
  deletion_record_version BIGINT NOT NULL CHECK (deletion_record_version>0),
  deletion_requested_at TIMESTAMPTZ NOT NULL,
  write_scope_closed_at TIMESTAMPTZ NOT NULL,
  storage_configuration_sha256 CHAR(64) NOT NULL CHECK (storage_configuration_sha256 ~ '^[a-f0-9]{64}$'),
  object_metadata_count BIGINT NOT NULL CHECK (object_metadata_count>=0),
  content_erased_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,project_id),
  FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,project_id),
  CHECK (content_erased_at>=deletion_requested_at AND content_erased_at>=write_scope_closed_at)
);
CREATE FUNCTION enforce_project_content_erasure_receipt() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects p
    JOIN project_content_write_scopes s ON s.organization_id=p.organization_id AND s.project_id=p.project_id
    WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id
      AND p.lifecycle_status='deletion-pending' AND p.record_version=NEW.deletion_record_version
      AND p.deletion_requested_at=NEW.deletion_requested_at AND s.closed_at=NEW.write_scope_closed_at) OR
    EXISTS(SELECT 1 FROM project_content_writes w WHERE w.organization_id=NEW.organization_id AND w.project_id=NEW.project_id AND w.lifecycle_status<>'completed') OR
    EXISTS(SELECT 1 FROM async_jobs j WHERE j.organization_id=NEW.organization_id AND j.project_id=NEW.project_id AND j.lifecycle_status NOT IN ('succeeded','failed','canceled','expired','superseded')) OR
    EXISTS(SELECT 1 FROM solution_export_runs x WHERE x.organization_id=NEW.organization_id AND x.project_id=NEW.project_id AND x.lifecycle_status NOT IN ('succeeded','failed','canceled')) OR
    EXISTS(SELECT 1 FROM credit_reservations c WHERE c.organization_id=NEW.organization_id AND c.project_id=NEW.project_id AND c.status='active') OR
    EXISTS(SELECT 1 FROM stored_objects o WHERE o.organization_id=NEW.organization_id AND o.project_id=NEW.project_id AND o.lifecycle_state<>'deleted') OR
    NEW.object_metadata_count<>(SELECT count(*) FROM stored_objects o WHERE o.organization_id=NEW.organization_id AND o.project_id=NEW.project_id) THEN
    RAISE EXCEPTION 'project content erasure evidence is incomplete' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER project_content_erasure_receipt_requires_closed_content
  BEFORE INSERT ON project_content_erasure_receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_project_content_erasure_receipt();
CREATE TRIGGER project_content_erasure_receipts_are_immutable
  BEFORE UPDATE OR DELETE ON project_content_erasure_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();


CREATE FUNCTION enforce_closed_project_object_metadata() RETURNS TRIGGER AS $$
DECLARE project_state TEXT;
BEGIN
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  SELECT lifecycle_status INTO project_state FROM projects
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id FOR SHARE;
  IF NOT FOUND OR project_state IN ('active','archived') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND project_state='deletion-pending' AND NEW.lifecycle_state='deleted'
    AND (to_jsonb(NEW)-ARRAY['lifecycle_state','delete_requested_at','deleted_at']) IS NOT DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['lifecycle_state','delete_requested_at','deleted_at'])
    AND EXISTS (SELECT 1 FROM project_content_write_scopes s WHERE s.organization_id=NEW.organization_id
      AND s.project_id=NEW.project_id AND s.closed_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM project_content_writes w WHERE w.organization_id=NEW.organization_id
      AND w.project_id=NEW.project_id AND w.lifecycle_status<>'completed') THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION 'project object metadata is closed for erasure' USING ERRCODE='23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER closed_project_object_metadata_is_fenced
  BEFORE INSERT OR UPDATE ON stored_objects
  FOR EACH ROW EXECUTE FUNCTION enforce_closed_project_object_metadata();


ALTER TABLE projects ADD COLUMN content_cleanup_attempted_at TIMESTAMPTZ;
CREATE INDEX projects_content_cleanup_schedule_idx
  ON projects(content_cleanup_attempted_at NULLS FIRST,deletion_requested_at,project_id)
  WHERE lifecycle_status='deletion-pending';
