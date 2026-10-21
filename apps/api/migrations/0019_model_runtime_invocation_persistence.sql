-- Gateway claim/result evidence only. No prompt bodies, model invocation,
-- pricing, credits, runtime admission leases, or commercial state authority.
CREATE TABLE model_runtime_invocations (
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  project_id VARCHAR(128),
  principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  scope_sha256 CHAR(64) NOT NULL CHECK (scope_sha256 ~ '^[0-9a-f]{64}$'),
  invocation_id VARCHAR(128) NOT NULL CHECK (invocation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  claim_sha256 CHAR(64) NOT NULL CHECK (claim_sha256 ~ '^[0-9a-f]{64}$'),
  claim_metadata JSONB NOT NULL CHECK (jsonb_typeof(claim_metadata) = 'object' AND octet_length(claim_metadata::text) <= 16384),
  idempotency_key_sha256 CHAR(64) NOT NULL CHECK (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  escalation_lineage_sha256 CHAR(64) CHECK (escalation_lineage_sha256 ~ '^[0-9a-f]{64}$'),
  original_invocation_id VARCHAR(128),
  state VARCHAR(16) NOT NULL CHECK (state IN ('in-progress', 'complete', 'failed')),
  result_object_id VARCHAR(128),
  result_sha256 CHAR(64) CHECK (result_sha256 ~ '^[0-9a-f]{64}$'),
  result_size_bytes BIGINT CHECK (result_size_bytes BETWEEN 1 AND 16777216),
  failure_code VARCHAR(128) CHECK (failure_code ~ '^model-[a-z-]+\.[a-z][a-z0-9-]{0,95}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, scope_sha256, invocation_id),
  UNIQUE (organization_id, scope_sha256, idempotency_key_sha256),
  UNIQUE (organization_id, scope_sha256, escalation_lineage_sha256),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, scope_sha256, original_invocation_id)
    REFERENCES model_runtime_invocations(organization_id, scope_sha256, invocation_id),
  FOREIGN KEY (organization_id, result_object_id) REFERENCES stored_objects(organization_id, object_id),
  FOREIGN KEY (organization_id, project_id, result_object_id)
    REFERENCES stored_objects(organization_id, project_id, object_id),
  CHECK ((escalation_lineage_sha256 IS NULL) = (original_invocation_id IS NULL)),
  CHECK (original_invocation_id IS NULL OR original_invocation_id <> invocation_id),
  CHECK ((state = 'failed') = (failure_code IS NOT NULL)),
  CHECK ((state = 'complete' AND result_object_id IS NOT NULL AND result_sha256 IS NOT NULL AND result_size_bytes IS NOT NULL)
    OR (state <> 'complete' AND result_object_id IS NULL AND result_sha256 IS NULL AND result_size_bytes IS NULL))
);

CREATE FUNCTION validate_model_runtime_invocation_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'in-progress' THEN
      RAISE EXCEPTION 'model invocation must begin with a claim' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF OLD.state <> 'in-progress' OR NEW.state NOT IN ('complete', 'failed')
      OR ROW(NEW.organization_id, NEW.project_id, NEW.principal_id, NEW.scope_sha256,
        NEW.invocation_id, NEW.claim_sha256, NEW.claim_metadata, NEW.idempotency_key_sha256,
        NEW.escalation_lineage_sha256, NEW.original_invocation_id, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.organization_id, OLD.project_id, OLD.principal_id, OLD.scope_sha256,
        OLD.invocation_id, OLD.claim_sha256, OLD.claim_metadata, OLD.idempotency_key_sha256,
        OLD.escalation_lineage_sha256, OLD.original_invocation_id, OLD.created_at) THEN
      RAISE EXCEPTION 'model invocation transition is immutable or contradictory' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.state = 'complete' THEN
    PERFORM 1 FROM stored_objects
      WHERE organization_id = NEW.organization_id AND project_id IS NOT DISTINCT FROM NEW.project_id
        AND object_id = NEW.result_object_id AND content_sha256 = NEW.result_sha256
        AND size_bytes = NEW.result_size_bytes AND media_type = 'application/json'
        AND object_purpose = 'report' AND lifecycle_state = 'published';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'model result requires an exact published owner object' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_runtime_invocations_validate_transition
BEFORE INSERT OR UPDATE ON model_runtime_invocations
FOR EACH ROW EXECUTE FUNCTION validate_model_runtime_invocation_transition();

CREATE TRIGGER model_runtime_invocations_reject_delete
BEFORE DELETE ON model_runtime_invocations
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

COMMENT ON TABLE model_runtime_invocations IS
  'Scope-bound gateway claim and sanitized typed proposal-result reference; not runtime admission, lease ownership, raw-response retention, or commercial accounting authority.';
