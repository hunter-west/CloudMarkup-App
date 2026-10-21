-- Original request authority for content-free, fresh-process delivery ACKs.
-- No prompt, candidate, raw token, session credential or redispatch authority.
CREATE TABLE ai_intent_preview_authorities (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  invocation_id VARCHAR(128) NOT NULL,
  binding_sha256 CHAR(64) NOT NULL CHECK (binding_sha256 ~ '^[0-9a-f]{64}$'),
  draft_id VARCHAR(128) NOT NULL,
  draft_version BIGINT NOT NULL CHECK (draft_version>0),
  content_sha256 CHAR(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  lease_id TEXT NOT NULL CHECK (lease_id ~ '^projectlease_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  session_sha256 CHAR(64) NOT NULL CHECK (session_sha256 ~ '^[0-9a-f]{64}$'),
  authentication_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,project_id,principal_id,invocation_id),
  FOREIGN KEY (organization_id,project_id,principal_id,invocation_id)
    REFERENCES ai_intent_previews(organization_id,project_id,principal_id,invocation_id),
  FOREIGN KEY (organization_id,project_id,draft_id)
    REFERENCES architecture_drafts(organization_id,project_id,draft_id),
  CHECK (authentication_expires_at>created_at)
);

CREATE FUNCTION validate_ai_intent_preview_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at:=clock_timestamp();
  IF NOT EXISTS (SELECT 1 FROM ai_intent_previews p
    WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id
      AND p.principal_id=NEW.principal_id AND p.invocation_id=NEW.invocation_id
      AND p.binding_sha256=NEW.binding_sha256 AND p.gateway_state='registered' AND p.delivery_state='none') THEN
    RAISE EXCEPTION 'preview authority requires original undispatched binding' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_intent_preview_authorities_validate BEFORE INSERT ON ai_intent_preview_authorities
FOR EACH ROW EXECUTE FUNCTION validate_ai_intent_preview_authority();

CREATE TRIGGER ai_intent_preview_authorities_immutable BEFORE UPDATE OR DELETE ON ai_intent_preview_authorities
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE FUNCTION verify_ai_intent_preview_authority_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt ai_intent_preview_authorities%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='ai_intent_previews' THEN
    IF NOT (
      (OLD.gateway_state='registered' AND NEW.gateway_state='claimed')
      OR (OLD.delivery_state='none' AND NEW.delivery_state='pending')
      OR (OLD.delivery_state='pending' AND NEW.delivery_state='acknowledged')) THEN
      RETURN NULL;
    END IF;
  END IF;
  SELECT * INTO receipt FROM ai_intent_preview_authorities a
    WHERE a.organization_id=NEW.organization_id AND a.project_id=NEW.project_id
      AND a.principal_id=NEW.principal_id AND a.invocation_id=NEW.invocation_id;
  IF NOT FOUND THEN
    -- Existing internal journals retain metadata compatibility. The production
    -- host requires issuance; an issued receipt cannot be removed for fallback.
    RETURN NULL;
  END IF;
  -- Normal application transactions take project -> role/lease/draft ->
  -- workflow -> preview locks before mutation. Recheck time at deferred commit.
  PERFORM 1 FROM projects p
    WHERE p.organization_id=receipt.organization_id AND p.project_id=receipt.project_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'preview original project is unavailable' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM projects p
    JOIN organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'
    JOIN principals actor ON actor.principal_id=receipt.principal_id AND actor.lifecycle_status='active'
    JOIN memberships m ON m.organization_id=p.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'
    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
    JOIN project_editing_leases l ON l.organization_id=p.organization_id AND l.project_id=p.project_id
    JOIN architecture_drafts d ON d.organization_id=p.organization_id AND d.project_id=p.project_id AND d.draft_id=p.current_draft_id
    JOIN stored_objects obj ON obj.organization_id=d.organization_id AND obj.project_id=d.project_id AND obj.object_id=d.document_object_id
    JOIN ai_intent_previews preview ON preview.organization_id=receipt.organization_id AND preview.project_id=receipt.project_id
      AND preview.principal_id=receipt.principal_id AND preview.invocation_id=receipt.invocation_id
    WHERE p.organization_id=receipt.organization_id AND p.project_id=receipt.project_id AND p.lifecycle_status='active'
      AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
      AND l.lease_id=receipt.lease_id AND l.principal_id=receipt.principal_id
      AND encode(sha256(convert_to(l.session_id,'UTF8')),'hex')=receipt.session_sha256
      AND l.released_at IS NULL AND l.expires_at>clock_timestamp() AND l.authentication_expires_at>clock_timestamp()
      AND receipt.authentication_expires_at>clock_timestamp()
      AND d.draft_id=receipt.draft_id AND d.draft_version=receipt.draft_version AND d.content_sha256=receipt.content_sha256
      AND d.pending_document_object_id IS NULL AND obj.lifecycle_state='published' AND obj.content_sha256=d.content_sha256
      AND obj.object_purpose='architecture-draft' AND preview.binding_sha256=receipt.binding_sha256
    FOR SHARE OF o,actor,m,r,l,d,obj;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'preview original request authority expired or changed' USING ERRCODE='23514';
  END IF;
  -- Locks can themselves wait beyond an expiry. Evaluate the clocks after all
  -- locks are acquired; release/takeover/draft mutations cannot race this read.
  IF receipt.authentication_expires_at<=clock_timestamp() OR NOT EXISTS (
    SELECT 1 FROM project_editing_leases l
    WHERE l.organization_id=receipt.organization_id AND l.project_id=receipt.project_id
      AND l.lease_id=receipt.lease_id AND l.released_at IS NULL
      AND l.expires_at>clock_timestamp() AND l.authentication_expires_at>clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'preview original request authority expired at commit' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='ai_intent_previews' THEN
    IF OLD.delivery_state='pending' AND NEW.delivery_state='acknowledged'
      AND NEW.delivery_expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'preview acknowledgement expired at commit' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ai_intent_preview_authorities_commit AFTER INSERT ON ai_intent_preview_authorities
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_ai_intent_preview_authority_commit();

CREATE CONSTRAINT TRIGGER ai_intent_previews_authority_commit AFTER UPDATE ON ai_intent_previews
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_ai_intent_preview_authority_commit();

COMMENT ON TABLE ai_intent_preview_authorities IS
'Immutable original session hash, editing epoch and published draft metadata for authenticated non-replayable preview delivery. No content or token retention; no accounting, dispatch or acceptance authority.';
