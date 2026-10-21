-- A deleted project cannot dispatch or publish a proposal. Retain active
-- execution leases and uncertain writes; an undispatched/expired proposal alone
-- must not prevent verified erasure of deletion-requested project content.
CREATE OR REPLACE FUNCTION enforce_project_content_erasure_receipt() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects p
    JOIN project_content_write_scopes s ON s.organization_id=p.organization_id AND s.project_id=p.project_id
    WHERE p.organization_id=NEW.organization_id AND p.project_id=NEW.project_id
      AND p.lifecycle_status='deletion-pending' AND p.record_version=NEW.deletion_record_version
      AND p.deletion_requested_at=NEW.deletion_requested_at AND s.closed_at=NEW.write_scope_closed_at) OR
    EXISTS(SELECT 1 FROM project_content_writes w WHERE w.organization_id=NEW.organization_id AND w.project_id=NEW.project_id AND w.lifecycle_status<>'completed') OR
    EXISTS(SELECT 1 FROM async_jobs j WHERE j.organization_id=NEW.organization_id AND j.project_id=NEW.project_id
      AND j.lifecycle_status NOT IN ('succeeded','failed','canceled','expired','superseded')
      AND (j.family<>'architecture-proposal'
              OR j.idempotency_scope IS DISTINCT FROM 'cloudmarkup.beta-infrastructure-proposals.create'
              OR j.parent_job_id IS NOT NULL OR j.root_job_id IS DISTINCT FROM j.job_id
              OR EXISTS(
        SELECT 1 FROM async_job_attempts a WHERE a.organization_id=j.organization_id
          AND a.job_id=j.job_id AND a.lifecycle_status='running'
          AND a.lease_expires_at > clock_timestamp()))) OR
    EXISTS(SELECT 1 FROM solution_export_runs x WHERE x.organization_id=NEW.organization_id AND x.project_id=NEW.project_id AND x.lifecycle_status NOT IN ('succeeded','failed','canceled')) OR
    EXISTS(SELECT 1 FROM credit_reservations c WHERE c.organization_id=NEW.organization_id AND c.project_id=NEW.project_id AND c.status='active') OR
    EXISTS(SELECT 1 FROM stored_objects o WHERE o.organization_id=NEW.organization_id AND o.project_id=NEW.project_id AND o.lifecycle_state<>'deleted') OR
    NEW.object_metadata_count<>(SELECT count(*) FROM stored_objects o WHERE o.organization_id=NEW.organization_id AND o.project_id=NEW.project_id) THEN
    RAISE EXCEPTION 'project content erasure evidence is incomplete' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
