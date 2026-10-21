-- Host-authorized accounting metadata only. No prompts, model outputs, credit
-- issuance, provider invocation, or platform USD budget authority is introduced.
CREATE TABLE model_commercial_workflows (
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  scope_sha256 CHAR(64) NOT NULL CHECK (scope_sha256 ~ '^[0-9a-f]{64}$'),
  workflow_id VARCHAR(128) NOT NULL CHECK (workflow_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  fingerprint_sha256 CHAR(64) NOT NULL CHECK (fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  idempotency_sha256 CHAR(64) NOT NULL CHECK (idempotency_sha256 ~ '^[0-9a-f]{64}$'),
  reservation_id VARCHAR(128) NOT NULL,
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 32768),
  snapshot_sha256 CHAR(64) NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  revision BIGINT NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
  state VARCHAR(32) NOT NULL CHECK (state IN ('claimed','reserved','invoked','settlement-pending','reconciliation-required','terminal')),
  fence BIGINT NOT NULL CHECK (fence BETWEEN 1 AND 9007199254740991),
  lease_id VARCHAR(128),
  lease_acquired_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, scope_sha256, workflow_id),
  UNIQUE (organization_id, scope_sha256, idempotency_sha256),
  UNIQUE (organization_id, reservation_id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, project_id),
  FOREIGN KEY (organization_id, principal_id) REFERENCES memberships(organization_id, principal_id),
  CHECK ((lease_id IS NULL AND lease_acquired_at IS NULL AND lease_expires_at IS NULL)
    OR (lease_id IS NOT NULL AND lease_acquired_at IS NOT NULL AND lease_expires_at IS NOT NULL
      AND lease_id ~ '^commercial_lease_[a-f0-9]{32}$'
      AND lease_expires_at > lease_acquired_at
      AND lease_expires_at <= lease_acquired_at + INTERVAL '5 minutes')),
  CHECK (snapshot ?& ARRAY['dispatchIntent','fingerprint','invocationReceipt','invocationResult','request','reservationIntent','reservationReceipt','revision','resolvedContext','response','state']
    AND snapshot - ARRAY['dispatchIntent','fingerprint','invocationReceipt','invocationResult','request','reservationIntent','reservationReceipt','revision','resolvedContext','response','state'] = '{}'::jsonb),
  CHECK (jsonb_typeof(snapshot->'request') = 'object'
    AND (snapshot->'request') ?& ARRAY['confirmationRequired','environment','estimateAccepted','eventIdPrefix','expiresAt','feature','idempotencyKey','includeTechnicalUnitDetail','jobId','multiCallWorkflowId','organizationId','plannedCalls','projectId','promptId','promptVersion','requestedAt','requestedMaximumInputUnits','requestedMaximumOutputUnits','requestedRoute','requestId','reservationId','templateId','templateVersion','userId']
    AND (snapshot->'request') - ARRAY['confirmationRequired','environment','estimateAccepted','eventIdPrefix','expiresAt','feature','idempotencyKey','includeTechnicalUnitDetail','jobId','multiCallWorkflowId','organizationId','plannedCalls','projectId','promptId','promptVersion','requestedAt','requestedMaximumInputUnits','requestedMaximumOutputUnits','requestedRoute','requestId','reservationId','templateId','templateVersion','userId'] = '{}'::jsonb),
  CHECK ((snapshot->>'fingerprint' = 'sha256:' || fingerprint_sha256
    AND snapshot->>'state' = state AND (snapshot->>'revision')::numeric = revision
    AND snapshot#>>'{request,organizationId}' = organization_id
    AND snapshot#>>'{request,projectId}' = project_id AND snapshot#>>'{request,userId}' = principal_id
    AND snapshot#>>'{request,multiCallWorkflowId}' = workflow_id AND snapshot#>>'{request,reservationId}' = reservation_id) IS TRUE),
  CHECK ((state IN ('terminal','reconciliation-required')) = (snapshot->'response' <> 'null'::jsonb)),
  CHECK ((snapshot->'invocationReceipt' = 'null'::jsonb) = (snapshot->'invocationResult' = 'null'::jsonb)),
  CHECK ((snapshot->'invocationReceipt' = 'null'::jsonb OR
    (snapshot#>>'{invocationReceipt,dispatchIntentId}' = snapshot#>>'{dispatchIntent,dispatchIntentId}'
      AND snapshot#>'{invocationReceipt,result}' = snapshot->'invocationResult')) IS TRUE),
  CHECK ((snapshot->'dispatchIntent' = 'null'::jsonb OR snapshot#>'{reservationReceipt,result,accepted}' = 'true'::jsonb) IS TRUE),
  CHECK ((snapshot->'reservationIntent' = 'null'::jsonb OR
    (snapshot->'resolvedContext' <> 'null'::jsonb AND snapshot#>>'{reservationIntent,reservationId}' = reservation_id
      AND snapshot#>'{reservationIntent,expiresAt}' = snapshot#>'{request,expiresAt}')) IS TRUE),
  CHECK ((snapshot->'reservationReceipt' = 'null'::jsonb OR
    (snapshot#>'{reservationReceipt,intentId}' = snapshot#>'{reservationIntent,intentId}'
      AND snapshot#>>'{reservationReceipt,result,reservationId}' = reservation_id)) IS TRUE)
);

CREATE TABLE model_commercial_workflow_revisions (
  organization_id VARCHAR(128) NOT NULL,
  scope_sha256 CHAR(64) NOT NULL,
  workflow_id VARCHAR(128) NOT NULL,
  revision BIGINT NOT NULL,
  fence BIGINT NOT NULL,
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 32768),
  snapshot_sha256 CHAR(64) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, scope_sha256, workflow_id, revision),
  FOREIGN KEY (organization_id, scope_sha256, workflow_id)
    REFERENCES model_commercial_workflows(organization_id, scope_sha256, workflow_id)
);

CREATE FUNCTION validate_model_commercial_workflow_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  evidence_key TEXT;
  old_receipt JSONB;
  new_receipt JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> 0 OR NEW.fence <> 1 OR NEW.state <> 'claimed' OR NEW.lease_id IS NULL
      OR NEW.lease_expires_at <= clock_timestamp() OR NEW.lease_expires_at > clock_timestamp() + INTERVAL '301 seconds'
      OR NEW.snapshot->'dispatchIntent' <> 'null'::jsonb OR NEW.snapshot->'invocationReceipt' <> 'null'::jsonb
      OR NEW.snapshot->'reservationIntent' <> 'null'::jsonb OR NEW.snapshot->'reservationReceipt' <> 'null'::jsonb
      OR NEW.snapshot->'resolvedContext' <> 'null'::jsonb OR NEW.snapshot->'response' <> 'null'::jsonb THEN
      RAISE EXCEPTION 'commercial workflow must begin with an empty leased claim' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF ROW(NEW.organization_id,NEW.project_id,NEW.principal_id,NEW.scope_sha256,NEW.workflow_id,NEW.fingerprint_sha256,NEW.idempotency_sha256,NEW.reservation_id,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.organization_id,OLD.project_id,OLD.principal_id,OLD.scope_sha256,OLD.workflow_id,OLD.fingerprint_sha256,OLD.idempotency_sha256,OLD.reservation_id,OLD.created_at)
      OR NEW.snapshot->'request' IS DISTINCT FROM OLD.snapshot->'request'
      OR NEW.snapshot->'fingerprint' IS DISTINCT FROM OLD.snapshot->'fingerprint' THEN
      RAISE EXCEPTION 'commercial workflow identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.snapshot IS NOT DISTINCT FROM OLD.snapshot THEN
      IF NEW.revision <> OLD.revision OR NEW.snapshot_sha256 <> OLD.snapshot_sha256 OR NEW.state <> OLD.state THEN
        RAISE EXCEPTION 'lease operations cannot change workflow evidence' USING ERRCODE = '23514';
      END IF;
      IF NEW.lease_id IS NULL THEN
        IF NEW.fence <> OLD.fence THEN
          RAISE EXCEPTION 'release cannot reset the fence' USING ERRCODE = '23514';
        END IF;
      ELSIF NEW.fence <> OLD.fence + 1 OR OLD.snapshot->'response' <> 'null'::jsonb
        OR (OLD.lease_id IS NOT NULL AND OLD.lease_expires_at > clock_timestamp())
        OR NEW.lease_expires_at <= clock_timestamp() OR NEW.lease_expires_at > clock_timestamp() + INTERVAL '301 seconds' THEN
        RAISE EXCEPTION 'commercial workflow lease takeover is invalid' USING ERRCODE = '23514';
      END IF;
    ELSE
      IF OLD.snapshot->'response' <> 'null'::jsonb OR NEW.revision <> OLD.revision + 1
        OR OLD.lease_id IS NULL OR OLD.lease_expires_at <= clock_timestamp()
        OR ROW(NEW.fence,NEW.lease_id,NEW.lease_acquired_at,NEW.lease_expires_at)
          IS DISTINCT FROM ROW(OLD.fence,OLD.lease_id,OLD.lease_acquired_at,OLD.lease_expires_at)
        OR array_position(ARRAY['claimed','reserved','invoked','settlement-pending','reconciliation-required','terminal'],NEW.state)
          < array_position(ARRAY['claimed','reserved','invoked','settlement-pending','reconciliation-required','terminal'],OLD.state) THEN
        RAISE EXCEPTION 'commercial workflow CAS is stale or terminal' USING ERRCODE = '23514';
      END IF;
      FOREACH evidence_key IN ARRAY ARRAY['resolvedContext','reservationIntent','dispatchIntent'] LOOP
        IF OLD.snapshot->evidence_key <> 'null'::jsonb AND NEW.snapshot->evidence_key IS DISTINCT FROM OLD.snapshot->evidence_key THEN
          RAISE EXCEPTION 'commercial workflow evidence is immutable' USING ERRCODE = '23514';
        END IF;
      END LOOP;
      old_receipt := OLD.snapshot->'reservationReceipt';
      new_receipt := NEW.snapshot->'reservationReceipt';
      IF old_receipt <> 'null'::jsonb AND (new_receipt = 'null'::jsonb
        OR new_receipt->'intentId' IS DISTINCT FROM old_receipt->'intentId'
        OR new_receipt#>'{result,accepted}' IS DISTINCT FROM old_receipt#>'{result,accepted}'
        OR new_receipt#>'{result,denialReason}' IS DISTINCT FROM old_receipt#>'{result,denialReason}'
        OR new_receipt#>'{result,reservationId}' IS DISTINCT FROM old_receipt#>'{result,reservationId}'
        OR (old_receipt#>'{result,replayed}' = 'true'::jsonb AND new_receipt#>'{result,replayed}' <> 'true'::jsonb)
        OR (old_receipt->>'accountingStatus' <> 'active' AND new_receipt->'accountingStatus' IS DISTINCT FROM old_receipt->'accountingStatus')
        OR (new_receipt->>'receivedAt')::timestamptz < (old_receipt->>'receivedAt')::timestamptz) THEN
        RAISE EXCEPTION 'commercial reservation recovery contradicts prior evidence' USING ERRCODE = '23514';
      END IF;
      old_receipt := OLD.snapshot->'invocationReceipt';
      new_receipt := NEW.snapshot->'invocationReceipt';
      IF old_receipt <> 'null'::jsonb AND old_receipt IS DISTINCT FROM new_receipt THEN
        IF new_receipt = 'null'::jsonb OR new_receipt->'dispatchIntentId' IS DISTINCT FROM old_receipt->'dispatchIntentId'
          OR new_receipt->'dispatchedAt' IS DISTINCT FROM old_receipt->'dispatchedAt'
          OR new_receipt->'receivedAt' IS DISTINCT FROM old_receipt->'receivedAt'
          OR new_receipt->'preDispatchProof' IS DISTINCT FROM 'null'::jsonb
          OR new_receipt#>'{result,preDispatchNoUsageAttestation}' IS NOT NULL
          OR new_receipt#>>'{result,failureCategory}' IS DISTINCT FROM 'unsafe-provider-receipt'
          OR new_receipt#>'{result,usefulOutputDelivered}' IS DISTINCT FROM 'false'::jsonb
          OR new_receipt#>>'{result,status}' IS DISTINCT FROM 'internal-failure'
          OR new_receipt#>'{result,attempts}' IS DISTINCT FROM '[]'::jsonb THEN
          RAISE EXCEPTION 'commercial invocation receipt cannot be replaced with new usage' USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_commercial_workflows_validate_transition
BEFORE INSERT OR UPDATE ON model_commercial_workflows
FOR EACH ROW EXECUTE FUNCTION validate_model_commercial_workflow_transition();

CREATE FUNCTION retain_model_commercial_workflow_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.revision <> OLD.revision THEN
    INSERT INTO model_commercial_workflow_revisions
      (organization_id,scope_sha256,workflow_id,revision,fence,snapshot,snapshot_sha256)
      VALUES (NEW.organization_id,NEW.scope_sha256,NEW.workflow_id,NEW.revision,NEW.fence,NEW.snapshot,NEW.snapshot_sha256);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_commercial_workflows_retain_revision
AFTER INSERT OR UPDATE ON model_commercial_workflows
FOR EACH ROW EXECUTE FUNCTION retain_model_commercial_workflow_revision();

CREATE TRIGGER model_commercial_workflows_reject_delete
BEFORE DELETE ON model_commercial_workflows
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE TRIGGER model_commercial_workflow_revisions_reject_mutation
BEFORE UPDATE OR DELETE ON model_commercial_workflow_revisions
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

CREATE FUNCTION validate_model_commercial_workflow_revision_source()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM model_commercial_workflows
    WHERE organization_id = NEW.organization_id AND scope_sha256 = NEW.scope_sha256
      AND workflow_id = NEW.workflow_id AND revision = NEW.revision AND fence = NEW.fence
      AND snapshot = NEW.snapshot AND snapshot_sha256 = NEW.snapshot_sha256;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commercial history requires exact current workflow evidence' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_commercial_workflow_revisions_validate_source
BEFORE INSERT ON model_commercial_workflow_revisions
FOR EACH ROW EXECUTE FUNCTION validate_model_commercial_workflow_revision_source();

COMMENT ON TABLE model_commercial_workflows IS
  'Metadata-only coordinator journal and lease fence; not authentication, credit accounting, runtime admission, provider result storage, or platform spending authority.';

COMMENT ON TABLE model_commercial_workflow_revisions IS
  'Append-only commercial metadata evidence, including receipts subsequently downgraded to uncertain outcome; no raw prompts or provider response bodies.';
