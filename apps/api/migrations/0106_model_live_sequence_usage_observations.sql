-- CloudMarkup additive migration 0106; fixed reviewed source closure.
-- Private additive proposal after exact 0066. Not registered for deployment.
-- Actual known usage survives approval withdrawal; no send or settlement grant.
CREATE TABLE model_live_sequence_observations (
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL,
  stage_id VARCHAR(128) NOT NULL,
  invocation_id VARCHAR(128) NOT NULL,
  usage_record_id VARCHAR(128) NOT NULL,
  normalized_usage JSONB NOT NULL CHECK(jsonb_typeof(normalized_usage)='object' AND octet_length(normalized_usage::text)<=8192),
  canonical_attempt JSONB NOT NULL CHECK(jsonb_typeof(canonical_attempt)='object' AND octet_length(canonical_attempt::text)<=8192),
  observation_record JSONB NOT NULL CHECK(jsonb_typeof(observation_record)='object' AND octet_length(observation_record::text)<=8192),
  observation_sha256 CHAR(64) NOT NULL CHECK(observation_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,project_id,principal_id,stage_id),
  UNIQUE(organization_id,invocation_id),
  UNIQUE(organization_id,usage_record_id),
  FOREIGN KEY(organization_id,project_id,principal_id,stage_id)
    REFERENCES model_live_sequence_dispatches(organization_id,project_id,principal_id,stage_id),
  FOREIGN KEY(organization_id,invocation_id) REFERENCES model_live_sequence_dispatches(organization_id,invocation_id)
);

CREATE FUNCTION enforce_model_live_sequence_observation_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  sent model_live_sequence_dispatches%ROWTYPE;
  source model_live_sequence_inputs%ROWTYPE;
  u JSONB:=NEW.normalized_usage; a JSONB:=NEW.canonical_attempt;
  o JSONB:=NEW.observation_record; key TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  SELECT * INTO STRICT sent FROM model_live_sequence_dispatches
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
      AND principal_id=NEW.principal_id AND stage_id=NEW.stage_id FOR SHARE;
  SELECT * INTO STRICT source FROM model_live_sequence_inputs
    WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
      AND principal_id=NEW.principal_id AND stage_id=NEW.stage_id;
  PERFORM model_live_sequence_metadata_object_v3(u, ARRAY['attemptNumber','cacheReadUnits','cacheWriteUnits','completedAt','contractVersion','durationMilliseconds','feature','idempotencyKeyDigest','inferenceProfileId','inputDigest','inputUnits','invocationId','modelId','modelVersion','outputUnits','promptTemplateId','promptVersion','providerId','providerRequestId','result','scope','startedAt','thinkingUnits','usageRecordId']);
  PERFORM model_live_sequence_metadata_object_v3(u->'scope',ARRAY['organizationId','projectId','userId','jobId']);
  PERFORM model_live_sequence_metadata_object_v3(a, ARRAY['attemptId','attemptKind','attemptNumber','callId','completedAt','failureCategory','inferenceProfileId','invocationId','latencyMilliseconds','mayHaveBeenProcessed','modelId','modelVersion','promptId','promptVersion','providerKey','providerRequestId','retryOfAttemptId','routeId','startedAt','status','usage','usageRecordId']);
  PERFORM model_live_sequence_metadata_object_v3(a->'usage',ARRAY['cacheReadUnits','cacheWriteUnits','inputUnits','outputUnits','totalUnits','providerSpecificUnits']);
  PERFORM model_live_sequence_metadata_object_v3(o, ARRAY['contractVersion','parentSequenceContractVersion','selectionId','selectionDigest','planDigest','caseId','caseDigest','stageKey','stageId','invocationId','recordKind','observationDigest','inputBindingDigest','dispatchDigest','canonicalWorkflowFingerprint','canonicalAttemptOrdinal','canonicalAttemptDigest','normalizedUsageDigest','observedAt']);
  FOREACH key IN ARRAY ARRAY['selectionId','selectionDigest','planDigest','caseId','caseDigest','stageKey','stageId','invocationId',
    'inputBindingDigest','dispatchDigest','canonicalWorkflowFingerprint','canonicalAttemptOrdinal'] LOOP
    IF (o->key=sent.dispatch_record->key) IS NOT TRUE THEN
      RAISE EXCEPTION 'observation must bind its exact issued dispatch' USING ERRCODE='23514';
    END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['observationDigest','canonicalAttemptDigest','normalizedUsageDigest'] LOOP
    PERFORM model_live_sequence_metadata_atom_v3(o->key,'digest');
  END LOOP;
  FOREACH key IN ARRAY ARRAY['feature','inputDigest','idempotencyKeyDigest','inferenceProfileId','invocationId',
    'modelId','modelVersion','promptTemplateId','promptVersion','providerId','scope'] LOOP
    IF (u->key=sent.descriptor->key) IS NOT TRUE THEN
      RAISE EXCEPTION 'usage must bind its exact dispatched descriptor' USING ERRCODE='23514';
    END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['inputUnits','outputUnits','cacheReadUnits','cacheWriteUnits','thinkingUnits'] LOOP
    IF (jsonb_typeof(u->key)='string' AND u->>key ~ '^(0|[1-9][0-9]{0,15})$'
      AND (u->>key)::numeric<=9007199254740991) IS NOT TRUE THEN
      RAISE EXCEPTION 'exact known usage units required' USING ERRCODE='23514';
    END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['inputUnits','outputUnits','cacheReadUnits','cacheWriteUnits','totalUnits'] LOOP
    PERFORM model_live_sequence_metadata_atom_v3(a#>ARRAY['usage',key],'integer');
  END LOOP;
  PERFORM model_live_sequence_metadata_atom_v3(u->'durationMilliseconds','integer');
  PERFORM model_live_sequence_metadata_atom_v3(u->'usageRecordId','identifier');
  IF (
    sent.invocation_id=NEW.invocation_id AND source.invocation_id=NEW.invocation_id
    AND u->>'invocationId'=NEW.invocation_id AND u->>'usageRecordId'=NEW.usage_record_id
    AND u->'contractVersion'='1'::jsonb AND u->'attemptNumber'='1'::jsonb
    AND u->>'cacheReadUnits'='0' AND u->>'cacheWriteUnits'='0'
    AND (u->>'thinkingUnits')::numeric<=(u->>'outputUnits')::numeric
    AND u->>'result' IN ('succeeded','provider-error','canceled','invalid-output')
    AND jsonb_typeof(u->'providerRequestId')='string' AND length(u->>'providerRequestId') BETWEEN 1 AND 256
    AND (u->>'completedAt')::timestamptz>=(u->>'startedAt')::timestamptz
    AND (u->>'startedAt')::timestamptz>=(source.input_record->>'issuedAt')::timestamptz
    AND (u->>'durationMilliseconds')::numeric BETWEEN 0 AND 86400000
    AND (u->>'durationMilliseconds')::numeric=EXTRACT(EPOCH FROM ((u->>'completedAt')::timestamptz-(u->>'startedAt')::timestamptz))*1000
    AND a->>'attemptId'=NEW.invocation_id||'.attempt.1' AND a->>'callId'=NEW.invocation_id||'.call.1'
    AND a->>'attemptKind'='repair' AND a->'attemptNumber'='1'::jsonb AND a->'retryOfAttemptId'='null'::jsonb
    AND a->'mayHaveBeenProcessed'='true'::jsonb
    AND a->'invocationId'=u->'invocationId' AND a->'usageRecordId'=u->'usageRecordId'
    AND a->'providerRequestId'=u->'providerRequestId' AND a->'providerKey'=u->'providerId'
    AND a->'modelId'=u->'modelId' AND a->'modelVersion'=u->'modelVersion'
    AND a->'inferenceProfileId'=u->'inferenceProfileId' AND a->'promptId'=u->'promptTemplateId'
    AND a->'promptVersion'=u->'promptVersion' AND a->'routeId'=sent.descriptor#>'{routing,routeId}'
    AND a->'startedAt'=u->'startedAt' AND a->'completedAt'=u->'completedAt'
    AND a->'latencyMilliseconds'=u->'durationMilliseconds'
    AND a->>'status'=CASE u->>'result' WHEN 'succeeded' THEN 'succeeded' WHEN 'provider-error' THEN 'provider-failure'
      WHEN 'canceled' THEN 'cancelled' WHEN 'invalid-output' THEN 'internal-failure' END
    AND a->'failureCategory'=CASE WHEN u->>'result'='succeeded' THEN 'null'::jsonb ELSE to_jsonb('model-gateway.'||(u->>'result')) END
    AND a#>'{usage,cacheReadUnits}'='0'::jsonb AND a#>'{usage,cacheWriteUnits}'='0'::jsonb
    AND a#>'{usage,providerSpecificUnits}'='[]'::jsonb
    AND (a#>>'{usage,inputUnits}')::numeric=(u->>'inputUnits')::numeric
    AND (a#>>'{usage,outputUnits}')::numeric=(u->>'outputUnits')::numeric
    AND (a#>>'{usage,totalUnits}')::numeric=(u->>'inputUnits')::numeric+(u->>'outputUnits')::numeric
    AND (a#>>'{usage,totalUnits}')::numeric<=9007199254740991
    AND o->'contractVersion'='4'::jsonb AND o->'parentSequenceContractVersion'='3'::jsonb
    AND o->>'recordKind'='model-live-sequence-attempt-observation' AND o->>'stageKey'='repair-1'
    AND o->'canonicalAttemptOrdinal'='1'::jsonb AND o->>'observationDigest'='sha256:'||NEW.observation_sha256
    AND (o->>'observedAt')::timestamptz>=(sent.dispatch_record->>'dispatchedAt')::timestamptz
    AND (o->>'observedAt')::timestamptz<=clock_timestamp()
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'actual first-stage known usage and attempt required' USING ERRCODE='23514';
  END IF;
  NEW.created_at:=clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_live_sequence_observation_require_authority
  BEFORE INSERT ON model_live_sequence_observations FOR EACH ROW EXECUTE FUNCTION enforce_model_live_sequence_observation_insert();

CREATE TRIGGER model_live_sequence_observations_are_immutable
  BEFORE UPDATE OR DELETE ON model_live_sequence_observations FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
