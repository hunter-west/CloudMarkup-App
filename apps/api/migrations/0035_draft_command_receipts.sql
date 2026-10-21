-- Accepted graph commands retain metadata only; bytes use the existing draft
-- object store and project-content erasure policy. Old migrations are unchanged.
CREATE TABLE draft_command_receipts (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  idempotency_key_sha256 CHAR(64) NOT NULL CHECK (idempotency_key_sha256 ~ '^[a-f0-9]{64}$'),
  request_sha256 CHAR(64) NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  command_id VARCHAR(128) NOT NULL CHECK (length(command_id)>0),
  draft_id VARCHAR(128) NOT NULL,
  draft_version BIGINT NOT NULL CHECK (draft_version>1),
  document_schema_version SMALLINT NOT NULL CHECK (document_schema_version=3),
  document_object_id VARCHAR(128) NOT NULL,
  content_sha256 CHAR(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  semantic_sha256 CHAR(64) NOT NULL CHECK (semantic_sha256 ~ '^[a-f0-9]{64}$'),
  visual_sha256 CHAR(64) NOT NULL CHECK (visual_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id,project_id,principal_id,idempotency_key_sha256),
  UNIQUE (organization_id,document_object_id),
  FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,project_id),
  FOREIGN KEY (organization_id,project_id,document_object_id) REFERENCES stored_objects(organization_id,project_id,object_id)
);
CREATE FUNCTION enforce_draft_command_receipt() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM architecture_drafts d JOIN projects p
      ON p.organization_id=d.organization_id AND p.project_id=d.project_id
    JOIN stored_objects o ON o.organization_id=d.organization_id
      AND o.project_id=d.project_id AND o.object_id=d.pending_document_object_id
    WHERE d.organization_id=NEW.organization_id AND d.project_id=NEW.project_id
      AND d.draft_id=NEW.draft_id AND p.lifecycle_status='active'
      AND d.pending_draft_version=NEW.draft_version
      AND d.pending_document_schema_version=NEW.document_schema_version
      AND d.pending_document_object_id=NEW.document_object_id
      AND d.pending_content_sha256=NEW.content_sha256
      AND d.pending_semantic_sha256=NEW.semantic_sha256
      AND d.pending_visual_sha256=NEW.visual_sha256
      AND d.updated_by_principal_id=NEW.principal_id
      AND o.content_sha256=NEW.content_sha256
      AND o.object_purpose='architecture-draft' AND o.lifecycle_state='publication-pending'
  ) THEN
    RAISE EXCEPTION 'draft command receipt does not bind an accepted pending draft' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER draft_command_receipt_requires_pending_draft
  BEFORE INSERT ON draft_command_receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_draft_command_receipt();
CREATE TRIGGER draft_command_receipts_are_immutable
  BEFORE UPDATE OR DELETE ON draft_command_receipts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
