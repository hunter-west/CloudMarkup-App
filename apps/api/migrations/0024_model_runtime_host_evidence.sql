-- Deterministic Intent host verification metadata, not customer content, model
-- activation, request capacity, credits, result storage or spending authority.
CREATE TABLE model_runtime_host_evidence (
  organization_id VARCHAR(128) NOT NULL REFERENCES organizations(organization_id),
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  evidence_id VARCHAR(128) NOT NULL CHECK (evidence_id ~ '^evidence_[a-f0-9]{64}$'),
  evidence_kind VARCHAR(32) NOT NULL CHECK (evidence_kind IN ('input','allow-listed-operations','source-ownership')),
  evidence_sha256 CHAR(64) NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  invocation_sha256 CHAR(64) NOT NULL CHECK (invocation_sha256 ~ '^[0-9a-f]{64}$'),
  input_sha256 CHAR(64) NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  input_evidence_id VARCHAR(128),
  evidence_record JSONB NOT NULL CHECK (jsonb_typeof(evidence_record) = 'object' AND octet_length(evidence_record::text) <= 16384),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id,project_id,principal_id,evidence_id),
  FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,project_id),
  FOREIGN KEY (organization_id,principal_id) REFERENCES memberships(organization_id,principal_id),
  FOREIGN KEY (organization_id,project_id,principal_id,input_evidence_id)
    REFERENCES model_runtime_host_evidence(organization_id,project_id,principal_id,evidence_id),
  CHECK ((evidence_kind = 'input') = (input_evidence_id IS NULL)),
  CHECK ((evidence_record->>'evidenceId' = evidence_id
    AND evidence_record->>'organizationId' = organization_id
    AND evidence_record->>'projectId' = project_id
    AND evidence_record->>'evidenceDigest' = 'sha256:' || evidence_sha256
    AND evidence_record->>'inputDigest' = 'sha256:' || input_sha256
    AND evidence_record->'contractVersion' = '1'::jsonb
    AND evidence_record->>'operation' = 'intent.extract'
    AND evidence_record->>'verifierId' = 'cloudmarkup.intent-host-evidence.v1'
    AND evidence_record->>'verifierVersion' = '1.0.0') IS TRUE),
  CHECK ((CASE WHEN evidence_kind = 'input' THEN
    evidence_record ?& ARRAY['authority','contractVersion','evidenceDigest','evidenceId','inputDigest','inputSanitized','noRawSensitiveContent','operation','organizationId','projectId','recordKind','requested','secretRedactionApplied','sourceOwnership','userId','verifierId','verifierVersion']
    AND evidence_record - ARRAY['authority','contractVersion','evidenceDigest','evidenceId','inputDigest','inputSanitized','noRawSensitiveContent','operation','organizationId','projectId','recordKind','requested','secretRedactionApplied','sourceOwnership','userId','verifierId','verifierVersion'] = '{}'::jsonb
    AND evidence_record->>'recordKind' = 'model-runtime-input-evidence'
    AND evidence_record->>'userId' = principal_id
    AND evidence_record->'authority' = '{"credential":false,"deployment":false,"shell":false,"tool":false,"url":false}'::jsonb
    AND evidence_record->'sourceOwnership' = '{"evidenceDigests":[],"status":"not-applicable"}'::jsonb
    AND evidence_record->'inputSanitized' = 'true'::jsonb
    AND evidence_record->'noRawSensitiveContent' = 'true'::jsonb
    AND evidence_record->'secretRedactionApplied' = 'true'::jsonb
    AND (evidence_record->'requested') ?& ARRAY['dependencyNames','edgeCount','fileCount','moduleSources','nodeCount','outputBytes','outputTokens','promptBytes','providerSources','repairAttempts','repositoryBytes','repositoryFiles']
    AND (evidence_record->'requested') - ARRAY['dependencyNames','edgeCount','fileCount','moduleSources','nodeCount','outputBytes','outputTokens','promptBytes','providerSources','repairAttempts','repositoryBytes','repositoryFiles'] = '{}'::jsonb
    AND (evidence_record->'requested') - ARRAY['outputBytes','outputTokens','promptBytes'] = '{"dependencyNames":[],"edgeCount":0,"fileCount":0,"moduleSources":[],"nodeCount":0,"providerSources":[],"repairAttempts":0,"repositoryBytes":0,"repositoryFiles":0}'::jsonb
    AND jsonb_typeof(evidence_record#>'{requested,outputBytes}') = 'number'
    AND jsonb_typeof(evidence_record#>'{requested,outputTokens}') = 'number'
    AND jsonb_typeof(evidence_record#>'{requested,promptBytes}') = 'number'
    AND (evidence_record#>>'{requested,outputBytes}')::numeric BETWEEN 1 AND 16777216
    AND (evidence_record#>>'{requested,outputTokens}')::numeric BETWEEN 1 AND 131072
    AND (evidence_record#>>'{requested,promptBytes}')::numeric BETWEEN 1 AND 16777216
    AND (evidence_record#>>'{requested,outputBytes}')::numeric = trunc((evidence_record#>>'{requested,outputBytes}')::numeric)
    AND (evidence_record#>>'{requested,outputTokens}')::numeric = trunc((evidence_record#>>'{requested,outputTokens}')::numeric)
    AND (evidence_record#>>'{requested,promptBytes}')::numeric = trunc((evidence_record#>>'{requested,promptBytes}')::numeric)
  ELSE
    evidence_record ?& ARRAY['contractVersion','evidenceDigest','evidenceId','evidenceKind','catalogDigest','inputDigest','operation','organizationId','outputBytes','outputDigest','outputTokens','passed','projectId','recordKind','responseSchemaDigest','runtimePolicyDigest','verifierId','verifierVersion']
    AND evidence_record - ARRAY['contractVersion','evidenceDigest','evidenceId','evidenceKind','catalogDigest','inputDigest','operation','organizationId','outputBytes','outputDigest','outputTokens','passed','projectId','recordKind','responseSchemaDigest','runtimePolicyDigest','verifierId','verifierVersion'] = '{}'::jsonb
    AND evidence_record->>'recordKind' = 'model-runtime-host-evidence'
    AND evidence_record->>'evidenceKind' = evidence_kind
    AND evidence_record->'passed' = 'true'::jsonb
    AND jsonb_typeof(evidence_record->'outputBytes') = 'number'
    AND jsonb_typeof(evidence_record->'outputTokens') = 'number'
    AND (evidence_record->>'outputBytes')::numeric BETWEEN 1 AND 16777216
    AND (evidence_record->>'outputTokens')::numeric BETWEEN 0 AND 131072
    AND (evidence_record->>'outputBytes')::numeric = trunc((evidence_record->>'outputBytes')::numeric)
    AND (evidence_record->>'outputTokens')::numeric = trunc((evidence_record->>'outputTokens')::numeric)
    AND evidence_record->>'outputDigest' ~ '^sha256:[a-f0-9]{64}$'
    AND evidence_record->>'catalogDigest' ~ '^sha256:[a-f0-9]{64}$'
    AND evidence_record->>'responseSchemaDigest' ~ '^sha256:[a-f0-9]{64}$'
    AND evidence_record->>'runtimePolicyDigest' ~ '^sha256:[a-f0-9]{64}$'
  END) IS TRUE)
);

CREATE FUNCTION validate_model_runtime_host_evidence_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM memberships m
    JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
    JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
      AND 'commercial.expensive.use'=ANY(r.capabilities) AND 'projects.mutate'=ANY(r.capabilities)
    JOIN projects pr ON pr.organization_id=m.organization_id AND pr.project_id=NEW.project_id AND pr.lifecycle_status='active'
    WHERE m.organization_id=NEW.organization_id AND m.principal_id=NEW.principal_id AND m.lifecycle_status='active'
    FOR SHARE OF m,p,o,r,pr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'model evidence requires current authorized scope' USING ERRCODE='23514';
  END IF;
  IF NEW.evidence_kind <> 'input' THEN
    PERFORM 1 FROM model_runtime_host_evidence
      WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND principal_id=NEW.principal_id
        AND evidence_id=NEW.input_evidence_id AND evidence_kind='input'
        AND invocation_sha256=NEW.invocation_sha256 AND input_sha256=NEW.input_sha256;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'model output evidence requires exact issued input' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_runtime_host_evidence_validate_insert
BEFORE INSERT ON model_runtime_host_evidence
FOR EACH ROW EXECUTE FUNCTION validate_model_runtime_host_evidence_insert();

CREATE TRIGGER model_runtime_host_evidence_reject_mutation
BEFORE UPDATE OR DELETE ON model_runtime_host_evidence
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

COMMENT ON TABLE model_runtime_host_evidence IS
  'Append-only, current-tenant deterministic Intent verification metadata only. No prompt or response content, operational-outcome authority, route activation, runtime capacity, customer credits or USD dispatch permission.';
