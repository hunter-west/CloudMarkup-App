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
      'evidence',
      'input-payload',
      'checkpoint-state',
      'proposal',
      'generated-source',
      'build-output',
      'export-package',
      'repository-export-receipt',
      'plan-result',
      'deployment-result',
      'smoke-integration-result',
      'drift-result',
      'billing-reconciliation-result',
      'accepted-intent'
    ));

-- Explicit acceptance retains only the accepted Intent object. Preview bodies,
-- prompt content, delivery tokens and editing/session credentials remain absent.
CREATE TABLE accepted_intents (
  accepted_intent_id VARCHAR(128) NOT NULL,
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  invocation_id VARCHAR(128) NOT NULL,
  contract_version SMALLINT NOT NULL DEFAULT 1 CHECK (contract_version=1),
  content_object_id VARCHAR(128) NOT NULL,
  intent_sha256 CHAR(64) NOT NULL CHECK (intent_sha256 ~ '^[a-f0-9]{64}$'),
  output_sha256 CHAR(64) NOT NULL CHECK (output_sha256 ~ '^[a-f0-9]{64}$'),
  request_sha256 CHAR(64) NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key_sha256 CHAR(64) NOT NULL CHECK (idempotency_key_sha256 ~ '^[a-f0-9]{64}$'),
  source_draft_id VARCHAR(128) NOT NULL,
  source_draft_version BIGINT NOT NULL CHECK (source_draft_version>0),
  audit_event_id VARCHAR(128) NOT NULL REFERENCES audit_events(audit_event_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,project_id,accepted_intent_id),
  UNIQUE (organization_id,project_id,principal_id,invocation_id),
  UNIQUE (organization_id,project_id,principal_id,idempotency_key_sha256),
  UNIQUE (organization_id,content_object_id),
  CHECK (accepted_intent_id ~ '^accepted_intent_[a-f0-9]{48}$'),
  FOREIGN KEY (organization_id,project_id,principal_id,invocation_id)
    REFERENCES ai_intent_preview_authorities(organization_id,project_id,principal_id,invocation_id),
  FOREIGN KEY (organization_id,project_id,content_object_id)
    REFERENCES stored_objects(organization_id,project_id,object_id),
  FOREIGN KEY (organization_id,project_id,source_draft_id)
    REFERENCES architecture_drafts(organization_id,project_id,draft_id)
);

CREATE FUNCTION validate_accepted_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at:=clock_timestamp();
  IF NOT EXISTS (
    SELECT 1 FROM ai_intent_previews p JOIN ai_intent_preview_authorities a
      ON a.organization_id=p.organization_id AND a.project_id=p.project_id
      AND a.principal_id=p.principal_id AND a.invocation_id=p.invocation_id
    JOIN stored_objects obj ON obj.organization_id=p.organization_id
      AND obj.project_id=p.project_id AND obj.object_id=NEW.content_object_id
    JOIN audit_events audit ON audit.audit_event_id=NEW.audit_event_id
    WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id
      AND p.principal_id=NEW.principal_id AND p.invocation_id=NEW.invocation_id
      AND p.gateway_state='complete' AND p.output_sha256=NEW.output_sha256
      AND p.generation_evidence IS NOT NULL AND p.normalized_usage IS NOT NULL
      AND p.binding_sha256=a.binding_sha256
      AND a.draft_id=NEW.source_draft_id AND a.draft_version=NEW.source_draft_version
      AND obj.object_purpose='accepted-intent' AND obj.content_sha256=NEW.intent_sha256
      AND obj.created_by_principal_id=NEW.principal_id AND obj.media_type='application/json'
      AND obj.size_bytes>0 AND obj.size_bytes<=262144
      AND obj.lifecycle_state IN ('publication-pending','published')
      AND audit.organization_id=NEW.organization_id AND audit.actor_principal_id=NEW.principal_id
      AND audit.action='ai-intent.accepted' AND audit.target_kind='project'
      AND audit.target_id=NEW.project_id AND audit.outcome='succeeded'
  ) THEN
    RAISE EXCEPTION 'accepted Intent requires exact completed preview, object and audit' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accepted_intents_validate BEFORE INSERT ON accepted_intents
FOR EACH ROW EXECUTE FUNCTION validate_accepted_intent();

CREATE TRIGGER accepted_intents_immutable BEFORE UPDATE OR DELETE ON accepted_intents
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

-- Reuse the original, unchanged request-authority commit guard. Its non-preview
-- branch checks current principal/role, exact session hash, original lease epoch,
-- original authentication ceiling and exact published draft after all locks.
CREATE CONSTRAINT TRIGGER accepted_intents_authority_commit AFTER INSERT ON accepted_intents
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_ai_intent_preview_authority_commit();

COMMENT ON TABLE accepted_intents IS
'Immutable explicit acceptance metadata and exact accepted Intent object; no prompts, preview bodies, raw proofs, graph write, invocation, settlement or promotion authority.';

-- A generic pending-object writer cannot persist accepted content without the
-- closed acceptance receipt in the same transaction. Lifecycle cleanup remains
-- possible, but accepted object identity/content cannot be retargeted.
CREATE FUNCTION verify_accepted_intent_object_commit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.object_purpose='accepted-intent' AND
    ROW(NEW.object_id,NEW.organization_id,NEW.project_id,NEW.object_purpose,NEW.storage_provider,NEW.storage_key,NEW.object_version,NEW.content_sha256,NEW.size_bytes,NEW.media_type,NEW.created_by_principal_id)
      IS DISTINCT FROM
    ROW(OLD.object_id,OLD.organization_id,OLD.project_id,OLD.object_purpose,OLD.storage_provider,OLD.storage_key,OLD.object_version,OLD.content_sha256,OLD.size_bytes,OLD.media_type,OLD.created_by_principal_id) THEN
    RAISE EXCEPTION 'accepted Intent object identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.object_purpose='accepted-intent' AND NOT EXISTS (
    SELECT 1 FROM accepted_intents a WHERE a.organization_id=NEW.organization_id
      AND a.project_id=NEW.project_id AND a.content_object_id=NEW.object_id
      AND a.principal_id=NEW.created_by_principal_id AND a.intent_sha256=NEW.content_sha256
  ) THEN
    RAISE EXCEPTION 'accepted Intent object requires explicit acceptance' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER stored_objects_accepted_intent_commit AFTER INSERT OR UPDATE ON stored_objects
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_accepted_intent_object_commit();
