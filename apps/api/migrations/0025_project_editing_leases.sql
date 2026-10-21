CREATE TABLE project_editing_leases (
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  lease_id TEXT NOT NULL UNIQUE,
  principal_id TEXT NOT NULL REFERENCES principals(principal_id),
  session_id TEXT NOT NULL CHECK (length(session_id) BETWEEN 1 AND 256),
  token_sha256 TEXT NOT NULL CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  acquired_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  authentication_expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  PRIMARY KEY (organization_id, project_id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, project_id),
  CHECK (lease_id ~ '^projectlease_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  CHECK (updated_at >= acquired_at),
  CHECK (expires_at > acquired_at AND expires_at <= authentication_expires_at),
  CHECK (expires_at <= updated_at + INTERVAL '60 seconds'),
  CHECK (released_at IS NULL OR released_at >= acquired_at)
);

ALTER TABLE architecture_drafts
  ADD COLUMN pending_editing_lease_id TEXT,
  ADD CONSTRAINT architecture_drafts_pending_editing_lease_check CHECK (
    pending_editing_lease_id IS NULL OR (
      pending_document_object_id IS NOT NULL
      AND pending_editing_lease_id ~ '^projectlease_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  );

CREATE FUNCTION cloudmarkup_verify_project_editing_commit() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  required_lease_id TEXT;
  holder_expires_at TIMESTAMPTZ;
  holder_authentication_expires_at TIMESTAMPTZ;
BEGIN
  IF OLD.pending_editing_lease_id IS NOT NULL
     AND NEW.pending_document_object_id IS NOT NULL
     AND NEW.pending_editing_lease_id IS NULL THEN
    RAISE EXCEPTION 'project editing lease proof cannot be removed' USING ERRCODE = '23514';
  END IF;

  IF ROW(NEW.draft_version, NEW.document_schema_version, NEW.document_object_id,
         NEW.content_sha256, NEW.semantic_sha256, NEW.visual_sha256)
     IS DISTINCT FROM
     ROW(OLD.draft_version, OLD.document_schema_version, OLD.document_object_id,
         OLD.content_sha256, OLD.semantic_sha256, OLD.visual_sha256) THEN
    required_lease_id := OLD.pending_editing_lease_id;
  ELSIF NEW.pending_document_object_id IS NOT NULL THEN
    required_lease_id := NEW.pending_editing_lease_id;
  ELSE
    -- Exact abandonment preserves the published document and retained objects.
    RETURN NULL;
  END IF;

  IF required_lease_id IS NULL THEN
    -- Serialize with first acquisition: an absent lease row cannot be locked.
    PERFORM 1 FROM projects p
    WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id
    FOR SHARE OF p;
    IF NOT FOUND OR EXISTS (
      SELECT 1 FROM project_editing_leases l
      WHERE l.organization_id=NEW.organization_id AND l.project_id=NEW.project_id
    ) THEN
      RAISE EXCEPTION 'project editing lease proof is required after first acquisition' USING ERRCODE = '23514';
    END IF;
    -- Only untouched historical/local projects may retain untagged writes.
    RETURN NULL;
  END IF;

  SELECT l.expires_at, l.authentication_expires_at
    INTO holder_expires_at, holder_authentication_expires_at
  FROM project_editing_leases l
  JOIN projects p ON p.organization_id=l.organization_id AND p.project_id=l.project_id AND p.lifecycle_status='active'
  JOIN organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'
  JOIN principals actor ON actor.principal_id=l.principal_id AND actor.lifecycle_status='active'
  JOIN memberships m ON m.organization_id=l.organization_id AND m.principal_id=l.principal_id AND m.lifecycle_status='active'
  JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
    AND r.policy_version='authorization-v2'
    AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
    AND 'projects.mutate'=ANY(r.capabilities)
  WHERE l.organization_id=NEW.organization_id AND l.project_id=NEW.project_id
    AND l.lease_id=required_lease_id AND l.principal_id=NEW.updated_by_principal_id
    AND l.released_at IS NULL
  FOR SHARE OF l,p,o,actor,m,r;

  IF NOT FOUND OR holder_expires_at <= clock_timestamp()
     OR holder_authentication_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'project editing lease expired before commit' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER project_editing_draft_commit_fence
AFTER UPDATE ON architecture_drafts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cloudmarkup_verify_project_editing_commit();
