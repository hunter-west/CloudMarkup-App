-- CloudMarkup additive migration 0124; fixed reviewed source closure.
-- PROPOSAL ONLY. Local label 0085 is NOT a migration version.
-- Registered versions already end at 0098; integration owner must allocate 0099+.
-- Never replace/admit this label or alter historical SQL. Unregistered/unapplied.
-- UNAPPLIED NEXT 0085. Requires 0084. This broadens SOURCE KIND only; it does
-- not weaken frozen scoring, current owner/approval/immutable publication guards.
CREATE FUNCTION cloudmarkup_gpt6_mixed_held_shape(r JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE e JSONB; regular_count INTEGER:=0; zero_count INTEGER:=0; repair_count INTEGER:=0; cases TEXT[]:='{}';
BEGIN
  IF r->'contractVersion'='2'::jsonb THEN RETURN TRUE; END IF;
  IF (r->'contractVersion'='3'::jsonb AND jsonb_typeof(r->'evidence')='array'
    AND jsonb_array_length(r->'evidence')=21 AND r#>>'{report,datasetDigest}'='sha256:031b0b5695f432d959de1eb3f6706099f4f26dd3a4ecdca60b076c3018fd7b59'
    AND r#>>'{report,evaluationPolicyDigest}'='sha256:b8a5d03d5dcb4d8949d58bb2516d7ccf4bdface5f547d31facc5af14ea467ba2') IS NOT TRUE THEN RETURN FALSE; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(r->'evidence') LOOP
    IF e->>'caseId'=ANY(cases) OR e->>'caseId' IS NULL THEN RETURN FALSE; END IF;
    cases:=array_append(cases,e->>'caseId');
    IF e->>'kind'='regular' THEN
      regular_count:=regular_count+1;
      IF e->>'caseId' IN ('evaluation_case_supported_application_generation_full_beta_v1','evaluation_case_repair_success_full_beta_v1','evaluation_case_repair_exhaustion_full_beta_v1')
        OR (e ?& ARRAY['invocationId','validationReceiptDigest','canonicalTerminalDigest','journalBindingDigest','observationDigest']) IS NOT TRUE THEN RETURN FALSE; END IF;
    ELSIF e->>'kind'='native-zero' THEN
      zero_count:=zero_count+1;
      IF (e->>'caseId'='evaluation_case_supported_application_generation_full_beta_v1'
        AND e#>>'{reference,planDigest}'=r#>>'{reference,planDigest}' AND e->>'nativeResultDigest' ~ '^sha256:[a-f0-9]{64}$'
        AND e#>>'{reference,receiptDigest}' ~ '^sha256:[a-f0-9]{64}$') IS NOT TRUE THEN RETURN FALSE; END IF;
    ELSIF e->>'kind'='recorded-repair' THEN
      repair_count:=repair_count+1;
      IF (e->>'caseId' IN ('evaluation_case_repair_success_full_beta_v1','evaluation_case_repair_exhaustion_full_beta_v1')
        AND e->>'executionDigest' ~ '^sha256:[a-f0-9]{64}$' AND e->>'evidenceDigest' ~ '^sha256:[a-f0-9]{64}$'
        AND e->>'observationDigest' ~ '^sha256:[a-f0-9]{64}$') IS NOT TRUE THEN RETURN FALSE; END IF;
    ELSE RETURN FALSE; END IF;
  END LOOP;
  RETURN regular_count=18 AND zero_count=1 AND repair_count=2;
END;
$$;

-- Replace only the prior table-level JSON shape check, retaining every original
-- bound column and all existing triggers/FKs. Abort for an unexpected catalog.
DO $$ DECLARE c RECORD; hits INTEGER:=0;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='model_gpt6_held_reports'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%contractVersion%' AND pg_get_constraintdef(oid) LIKE '%evidence%' LOOP
    hits:=hits+1;EXECUTE format('ALTER TABLE model_gpt6_held_reports DROP CONSTRAINT %I',c.conname);
  END LOOP;
  IF hits<>1 THEN RAISE EXCEPTION 'exact predecessor held shape constraint required'; END IF;
END $$;

ALTER TABLE model_gpt6_held_reports ADD CONSTRAINT model_gpt6_held_exact_mixed_shape CHECK ((
  octet_length(record::text)<=1048576 AND record->'contractVersion' IN ('2'::jsonb,'3'::jsonb)
  AND record->>'recordKind'='issued-gpt6-held-report' AND record#>>'{report,evaluationReportId}'=report_id
  AND record#>>'{report,reportDigest}'='sha256:'||report_sha256 AND record#>>'{report,activationRecommendation}'='hold'
  AND record#>'{report,capabilityActivated}'='false'::jsonb AND record#>>'{reference,planDigest}'='sha256:'||plan_sha256
  AND record->>'operatorPrincipalId'=operator_principal_id AND jsonb_typeof(record->'evidence')='array'
  AND jsonb_array_length(record->'evidence')=21 AND (record->>'issuedAt')::TIMESTAMPTZ=issued_at
  AND cloudmarkup_gpt6_mixed_held_shape(record)) IS TRUE);

CREATE FUNCTION enforce_gpt6_mixed_source_receipts() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE e JSONB;
BEGIN
  IF NEW.record->'contractVersion'<>'3'::jsonb THEN RETURN NEW; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(NEW.record->'evidence') LOOP
    IF e->>'kind'='native-zero' THEN
      IF NOT EXISTS(SELECT 1 FROM model_live_native_zero_receipts n WHERE n.organization_id=NEW.organization_id
        AND n.project_id=NEW.project_id AND n.principal_id=NEW.principal_id AND n.plan_sha256=NEW.plan_sha256
        AND n.receipt_id=e#>>'{reference,receiptId}' AND 'sha256:'||n.receipt_sha256=e#>>'{reference,receiptDigest}'
        AND n.record->>'nativeResultDigest'=e->>'nativeResultDigest')
      THEN RAISE EXCEPTION 'actual issued native zero-call receipt required' USING ERRCODE='23514'; END IF;
    ELSIF e->>'kind'='recorded-repair' THEN
      IF NOT EXISTS(SELECT 1 FROM model_live_sequence_plans p WHERE p.organization_id=NEW.organization_id
        AND p.project_id=NEW.project_id AND p.principal_id=NEW.principal_id AND p.definition_id=e#>>'{reference,definitionId}'
        AND 'sha256:'||p.plan_sha256=e#>>'{reference,planDigest}' AND p.expires_at>clock_timestamp()
        AND NOT EXISTS(SELECT 1 FROM model_live_sequence_revocations v WHERE v.organization_id=p.organization_id
          AND v.project_id=p.project_id AND v.principal_id=p.principal_id AND v.plan_sha256=p.plan_sha256))
      THEN RAISE EXCEPTION 'actual current recorded repair source approval required' USING ERRCODE='23514'; END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_gpt6_mixed_exact_sources BEFORE INSERT ON model_gpt6_held_reports
  FOR EACH ROW EXECUTE FUNCTION enforce_gpt6_mixed_source_receipts();

CREATE FUNCTION enforce_gpt6_mixed_promotion_sources() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE h JSONB; e JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('runtime-admission:'||NEW.organization_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('live-evaluation-plan:'||NEW.organization_id||':'||NEW.project_id||':'||NEW.principal_id,0));
  SELECT record INTO h FROM model_gpt6_held_reports WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id
    AND principal_id=NEW.principal_id AND report_id=NEW.report_id AND report_sha256=NEW.report_sha256 FOR SHARE;
  IF h->'contractVersion'='3'::jsonb THEN
    FOR e IN SELECT value FROM jsonb_array_elements(h->'evidence') LOOP
      IF e->>'kind'='recorded-repair' AND NOT EXISTS(SELECT 1 FROM model_live_sequence_plans p
        WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id AND p.principal_id=NEW.principal_id
          AND p.definition_id=e#>>'{reference,definitionId}' AND 'sha256:'||p.plan_sha256=e#>>'{reference,planDigest}'
          AND p.expires_at>clock_timestamp() AND NEW.expires_at<=p.expires_at
          AND NOT EXISTS(SELECT 1 FROM model_live_sequence_revocations v WHERE v.organization_id=p.organization_id
            AND v.project_id=p.project_id AND v.principal_id=p.principal_id AND v.plan_sha256=p.plan_sha256))
      THEN RAISE EXCEPTION 'mixed publication requires current bounded repair sources' USING ERRCODE='23514'; END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER model_gpt6_mixed_promotion_sources BEFORE INSERT ON model_gpt6_promotions
  FOR EACH ROW EXECUTE FUNCTION enforce_gpt6_mixed_promotion_sources();
