-- Bitbucket Cloud uses confidential consumers with fixed scopes; no plaintext
-- credential, authorization code, raw state or raw session is persisted.
CREATE TABLE bitbucket_oauth_link_intents (
  intent_id TEXT PRIMARY KEY CHECK(intent_id ~ '^bitbucketlink_[a-f0-9]{32}$'),
  connection_id TEXT NOT NULL UNIQUE CHECK(connection_id ~ '^bitbucket_[a-f0-9]{32}$'),
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id),
  principal_id TEXT NOT NULL REFERENCES principals(principal_id),
  client_id TEXT NOT NULL CHECK(client_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  capability TEXT NOT NULL CHECK(capability IN ('repository-read','reviewed-export')),
  session_sha256 TEXT NOT NULL CHECK(session_sha256 ~ '^[a-f0-9]{64}$'),
  state_sha256 TEXT NOT NULL UNIQUE CHECK(state_sha256 ~ '^[a-f0-9]{64}$'),
  lifecycle_status TEXT NOT NULL DEFAULT 'pending' CHECK(lifecycle_status IN ('pending','consumed','completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CHECK(expires_at>created_at AND expires_at<=created_at+INTERVAL '10 minutes'),
  CHECK((lifecycle_status='pending' AND consumed_at IS NULL AND completed_at IS NULL)
    OR (lifecycle_status='consumed' AND consumed_at IS NOT NULL AND completed_at IS NULL)
    OR (lifecycle_status='completed' AND consumed_at IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK(consumed_at IS NULL OR (consumed_at>=created_at AND consumed_at<expires_at)),
  CHECK(completed_at IS NULL OR (completed_at>=consumed_at AND completed_at<expires_at)),
  UNIQUE(organization_id,principal_id,client_id,capability,intent_id,connection_id)
);
CREATE FUNCTION guard_bitbucket_oauth_link_intent_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.lifecycle_status<>'pending' OR NEW.expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'Bitbucket OAuth intent must begin pending';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' OR
    (NEW.intent_id,NEW.connection_id,NEW.organization_id,NEW.principal_id,NEW.client_id,NEW.capability,NEW.session_sha256,NEW.state_sha256,NEW.created_at,NEW.expires_at)
    IS DISTINCT FROM
    (OLD.intent_id,OLD.connection_id,OLD.organization_id,OLD.principal_id,OLD.client_id,OLD.capability,OLD.session_sha256,OLD.state_sha256,OLD.created_at,OLD.expires_at)
    OR OLD.expires_at<=clock_timestamp()
    OR NOT ((OLD.lifecycle_status='pending' AND NEW.lifecycle_status='consumed')
      OR (OLD.lifecycle_status='consumed' AND NEW.lifecycle_status='completed' AND NEW.consumed_at=OLD.consumed_at)) THEN
    RAISE EXCEPTION 'Bitbucket OAuth intent transition rejected';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bitbucket_oauth_link_intent_v1 BEFORE INSERT OR UPDATE OR DELETE ON bitbucket_oauth_link_intents
FOR EACH ROW EXECUTE FUNCTION guard_bitbucket_oauth_link_intent_v1();
CREATE INDEX bitbucket_oauth_link_intent_actor_expiry ON bitbucket_oauth_link_intents(organization_id,principal_id,expires_at)
WHERE lifecycle_status='pending';

CREATE TABLE bitbucket_oauth_connections (
  connection_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  provider_user_id TEXT NOT NULL CHECK(provider_user_id ~ '^\{[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\}$'),
  provider_display_name TEXT NOT NULL CHECK(length(provider_display_name) BETWEEN 1 AND 256 AND provider_display_name !~ '[[:cntrl:]]'),
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle_status IN ('active','refreshing','reconnect-required','disconnected')),
  grant_version BIGINT NOT NULL DEFAULT 1 CHECK(grant_version BETWEEN 1 AND 9007199254740991),
  record_version BIGINT NOT NULL DEFAULT 1 CHECK(record_version BETWEEN 1 AND 9007199254740991),
  sealed_grant JSONB NOT NULL,
  grant_expires_at TIMESTAMPTZ NOT NULL,
  refresh_attempt_id TEXT CHECK(refresh_attempt_id ~ '^bitbucketrefresh_[a-f0-9]{32}$'),
  refresh_session_sha256 TEXT CHECK(refresh_session_sha256 ~ '^[a-f0-9]{64}$'),
  refresh_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(organization_id,principal_id,client_id,capability,intent_id,connection_id)
    REFERENCES bitbucket_oauth_link_intents(organization_id,principal_id,client_id,capability,intent_id,connection_id),
  CHECK((refresh_attempt_id IS NULL AND refresh_session_sha256 IS NULL AND refresh_deadline IS NULL)
    OR (refresh_attempt_id IS NOT NULL AND refresh_session_sha256 IS NOT NULL AND refresh_deadline IS NOT NULL)),
  CHECK(lifecycle_status<>'refreshing' OR refresh_attempt_id IS NOT NULL),
  CHECK((jsonb_typeof(sealed_grant)='object' AND octet_length(sealed_grant::text)<=24000
    AND sealed_grant->>'schemaVersion'='1' AND sealed_grant->>'algorithm'='aes-256-gcm'
    AND sealed_grant ?& ARRAY['schemaVersion','algorithm','keyArn','bindingSha256','encryptedDataKey','iv','authenticationTag','ciphertext']
    AND sealed_grant-ARRAY['schemaVersion','algorithm','keyArn','bindingSha256','encryptedDataKey','iv','authenticationTag','ciphertext']='{}'::jsonb) IS TRUE)
);
CREATE FUNCTION guard_bitbucket_oauth_connection_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.lifecycle_status<>'active' OR NEW.grant_version<>1 OR NEW.record_version<>1 OR NEW.refresh_attempt_id IS NOT NULL
      OR NEW.grant_expires_at<=clock_timestamp() OR NEW.grant_expires_at>clock_timestamp()+INTERVAL '2 hours'
      OR NOT EXISTS (SELECT 1 FROM bitbucket_oauth_link_intents i
        WHERE (i.organization_id,i.principal_id,i.client_id,i.capability,i.intent_id,i.connection_id)=
          (NEW.organization_id,NEW.principal_id,NEW.client_id,NEW.capability,NEW.intent_id,NEW.connection_id)
        AND i.lifecycle_status='completed' AND i.expires_at>clock_timestamp()) THEN
      RAISE EXCEPTION 'Bitbucket connection requires a completed current intent';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' OR
    (NEW.connection_id,NEW.intent_id,NEW.organization_id,NEW.principal_id,NEW.client_id,NEW.capability,NEW.provider_user_id,NEW.created_at)
    IS DISTINCT FROM
    (OLD.connection_id,OLD.intent_id,OLD.organization_id,OLD.principal_id,OLD.client_id,OLD.capability,OLD.provider_user_id,OLD.created_at)
    OR NEW.record_version<>OLD.record_version+1 OR NEW.updated_at<OLD.updated_at THEN
    RAISE EXCEPTION 'Bitbucket connection identity transition rejected';
  END IF;
  IF NOT ((OLD.lifecycle_status='active' AND NEW.lifecycle_status IN ('refreshing','disconnected'))
    OR (OLD.lifecycle_status='refreshing' AND NEW.lifecycle_status IN ('active','reconnect-required','disconnected'))
    OR (OLD.lifecycle_status='reconnect-required' AND NEW.lifecycle_status='disconnected')) THEN
    RAISE EXCEPTION 'Bitbucket connection lifecycle transition rejected';
  END IF;
  IF OLD.lifecycle_status='refreshing' AND NEW.lifecycle_status='active' THEN
    IF NEW.grant_version<>OLD.grant_version+1 OR NEW.sealed_grant IS NOT DISTINCT FROM OLD.sealed_grant
      OR OLD.refresh_deadline<=clock_timestamp() OR NEW.grant_expires_at<=clock_timestamp()
      OR NEW.grant_expires_at>clock_timestamp()+INTERVAL '2 hours' THEN
      RAISE EXCEPTION 'Bitbucket refreshed grant must advance exactly once within its claim';
    END IF;
  ELSIF NEW.grant_version<>OLD.grant_version OR NEW.provider_display_name<>OLD.provider_display_name
    OR NEW.grant_expires_at<>OLD.grant_expires_at OR NEW.sealed_grant IS DISTINCT FROM OLD.sealed_grant THEN
    RAISE EXCEPTION 'Bitbucket grant changed outside refresh';
  END IF;
  IF NEW.lifecycle_status='refreshing' THEN
    IF NEW.refresh_attempt_id IS NOT DISTINCT FROM OLD.refresh_attempt_id OR NEW.refresh_deadline<=clock_timestamp()
      OR NEW.refresh_deadline>clock_timestamp()+INTERVAL '1 minute' THEN
      RAISE EXCEPTION 'Bitbucket refresh needs a new bounded claim';
    END IF;
  ELSIF (NEW.refresh_attempt_id,NEW.refresh_session_sha256,NEW.refresh_deadline)
    IS DISTINCT FROM (OLD.refresh_attempt_id,OLD.refresh_session_sha256,OLD.refresh_deadline) THEN
    RAISE EXCEPTION 'Bitbucket refresh claim identity changed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bitbucket_oauth_connection_v1 BEFORE INSERT OR UPDATE OR DELETE ON bitbucket_oauth_connections
FOR EACH ROW EXECUTE FUNCTION guard_bitbucket_oauth_connection_v1();
CREATE INDEX bitbucket_oauth_connections_actor ON bitbucket_oauth_connections(organization_id,principal_id,client_id,capability,connection_id);

-- A transfer needs explicit selection of its new workspace/repository pair.
-- Provider authority for this exact pair is checked on every use.
CREATE TABLE bitbucket_repository_selections (
  connection_id TEXT NOT NULL REFERENCES bitbucket_oauth_connections(connection_id),
  workspace_id TEXT NOT NULL CHECK(workspace_id ~ '^\{[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\}$'),
  repository_id TEXT NOT NULL CHECK(repository_id ~ '^\{[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\}$'),
  selection_version BIGINT NOT NULL CHECK(selection_version BETWEEN 1 AND 9007199254740990),
  enabled BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(connection_id,workspace_id,repository_id)
);
CREATE FUNCTION guard_bitbucket_repository_selection_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.selection_version<>1 OR NOT NEW.enabled THEN
      RAISE EXCEPTION 'Bitbucket repository selection must begin at version one';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' OR
    (NEW.connection_id,NEW.workspace_id,NEW.repository_id,NEW.created_at) IS DISTINCT FROM (OLD.connection_id,OLD.workspace_id,OLD.repository_id,OLD.created_at)
    OR NEW.selection_version<>OLD.selection_version+1 OR NEW.updated_at<OLD.updated_at THEN
    RAISE EXCEPTION 'Bitbucket repository selection transition rejected';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bitbucket_repository_selection_v1 BEFORE INSERT OR UPDATE OR DELETE ON bitbucket_repository_selections
FOR EACH ROW EXECUTE FUNCTION guard_bitbucket_repository_selection_v1();

-- Reuse the canonical async-job state machine. The additive family observes an
-- immutable revision; it has no deployment, executable-source or Evidence authority.
ALTER TABLE async_jobs
  DROP CONSTRAINT async_jobs_family_check,
  ADD CONSTRAINT async_jobs_family_check CHECK (family IN (
    'intent-extraction','architecture-proposal','workload-contract-proposal',
    'graph-workload-operation-proposal','iac-compilation','application-source-generation',
    'application-build-test-package','static-validation','diagram-rendering',
    'combined-export-packaging','solution-export-orchestration','github-repository-export',
    'customer-owned-plan-evidence','deployment-evidence','smoke-integration-evidence',
    'drift-evidence','billing-usage-reconciliation','repository-import'
  )),
  DROP CONSTRAINT async_jobs_family_subject_check_v2,
  ADD CONSTRAINT async_jobs_family_subject_check_v3 CHECK (
    (family IN ('intent-extraction','architecture-proposal','workload-contract-proposal',
      'graph-workload-operation-proposal') AND subject_kind='draft')
    OR (family='static-validation' AND subject_kind IN ('draft','solution-revision'))
    OR (family IN ('iac-compilation','application-source-generation','application-build-test-package',
      'diagram-rendering','combined-export-packaging','solution-export-orchestration',
      'github-repository-export','customer-owned-plan-evidence','deployment-evidence',
      'smoke-integration-evidence','drift-evidence','repository-import') AND subject_kind='solution-revision')
    OR (family='billing-usage-reconciliation' AND subject_kind='organization')
  );

ALTER TABLE async_job_creation_claims
  DROP CONSTRAINT async_job_creation_claims_family_check,
  ADD CONSTRAINT async_job_creation_claims_family_check CHECK (family IN (
    'intent-extraction','architecture-proposal','workload-contract-proposal',
    'graph-workload-operation-proposal','iac-compilation','application-source-generation',
    'application-build-test-package','static-validation','diagram-rendering',
    'combined-export-packaging','solution-export-orchestration','github-repository-export',
    'customer-owned-plan-evidence','deployment-evidence','smoke-integration-evidence',
    'drift-evidence','billing-usage-reconciliation','repository-import'
  )),
  DROP CONSTRAINT async_job_creation_claims_family_subject_check_v2,
  ADD CONSTRAINT async_job_creation_claims_family_subject_check_v3 CHECK (
    (family IN ('intent-extraction','architecture-proposal','workload-contract-proposal',
      'graph-workload-operation-proposal') AND subject_kind='draft')
    OR (family='static-validation' AND subject_kind IN ('draft','solution-revision'))
    OR (family IN ('iac-compilation','application-source-generation','application-build-test-package',
      'diagram-rendering','combined-export-packaging','solution-export-orchestration',
      'github-repository-export','customer-owned-plan-evidence','deployment-evidence',
      'smoke-integration-evidence','drift-evidence','repository-import') AND subject_kind='solution-revision')
    OR (family='billing-usage-reconciliation' AND subject_kind='organization')
  );

-- Only immutable scope metadata is inline. Source bodies are never persisted;
-- prepared requests and observations use the existing owned, erasable object store.
CREATE TABLE bitbucket_repository_imports (
  import_id TEXT PRIMARY KEY CHECK(import_id ~ '^bitbucketimport_[a-f0-9]{32}$'),
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  input_sha256 CHAR(64) NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
  connection_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  selection_version BIGINT NOT NULL CHECK(selection_version BETWEEN 1 AND 9007199254740990),
  commit_sha CHAR(40) NOT NULL CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
  session_sha256 CHAR(64) NOT NULL CHECK(session_sha256 ~ '^[a-f0-9]{64}$'),
  authenticated_at TIMESTAMPTZ NOT NULL,
  authentication_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK(authentication_expires_at>authenticated_at),
  UNIQUE(organization_id,project_id,import_id),
  FOREIGN KEY(organization_id,project_id,import_id) REFERENCES async_jobs(organization_id,project_id,job_id),
  FOREIGN KEY(connection_id,workspace_id,repository_id)
    REFERENCES bitbucket_repository_selections(connection_id,workspace_id,repository_id)
);
CREATE FUNCTION validate_bitbucket_repository_import_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM async_jobs j
    JOIN projects p ON p.organization_id=j.organization_id AND p.project_id=j.project_id AND p.lifecycle_status='active'
    JOIN bitbucket_oauth_connections c ON c.connection_id=NEW.connection_id
      AND c.organization_id=j.organization_id AND c.principal_id=j.created_by_principal_id
      AND c.capability='repository-read' AND c.lifecycle_status='active' AND c.grant_expires_at>clock_timestamp()
    JOIN bitbucket_repository_selections s ON s.connection_id=c.connection_id AND s.workspace_id=NEW.workspace_id
      AND s.repository_id=NEW.repository_id AND s.enabled AND s.selection_version=NEW.selection_version
    WHERE j.organization_id=NEW.organization_id AND j.project_id=NEW.project_id AND j.job_id=NEW.import_id
      AND j.created_by_principal_id=NEW.principal_id AND j.idempotency_actor_id=NEW.principal_id
      AND j.idempotency_scope='cloudmarkup.bitbucket-imports.create' AND j.input_sha256=NEW.input_sha256
      AND j.family='repository-import' AND j.subject_kind='solution-revision'
      AND j.root_job_id=j.job_id AND j.parent_job_id IS NULL AND j.lifecycle_status='queued'
      AND j.expires_at IS NOT NULL AND j.expires_at<=NEW.authentication_expires_at AND j.expires_at>clock_timestamp()
      AND cloudmarkup_account_session_allowed_v1(NEW.principal_id,NEW.session_sha256,NEW.authenticated_at,NEW.authentication_expires_at)
    FOR SHARE OF j,p,c,s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bitbucket import needs an exact committed, currently authorized queued job';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bitbucket_repository_import_scope_v1 BEFORE INSERT ON bitbucket_repository_imports
FOR EACH ROW EXECUTE FUNCTION validate_bitbucket_repository_import_v1();
CREATE TRIGGER bitbucket_repository_import_is_immutable BEFORE UPDATE OR DELETE ON bitbucket_repository_imports
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();
CREATE INDEX bitbucket_repository_import_actor ON bitbucket_repository_imports(organization_id,project_id,principal_id,import_id);
-- Preserve all existing object purposes; import observations have their own
-- exact purpose so the canonical job repository can verify the output binding.
ALTER TABLE stored_objects
  DROP CONSTRAINT stored_objects_object_purpose_check,
  ADD CONSTRAINT stored_objects_object_purpose_check CHECK (object_purpose IN (
    'architecture-draft','architecture-revision','validation-report','generated-code',
    'diagram','report','artifact-manifest','combined-artifact','repository-snapshot',
    'observed-solution','reconciliation-proposal','solution-revision-manifest',
    'ai-authored-extension','active-issue','evidence','input-payload','checkpoint-state',
    'proposal','generated-source','build-output','export-package','repository-export-receipt',
    'plan-result','deployment-result','smoke-integration-result','drift-result',
    'billing-reconciliation-result','accepted-intent','repository-import-result'
  ));

-- Review claims commit before draft acceptance. Only safe receipt metadata stays
-- inline; explanations and original draft ETags use erasable owned request objects.
CREATE TABLE bitbucket_import_reviews (
  review_id VARCHAR(128) PRIMARY KEY CHECK(review_id ~ '^bitbucket-review[.][a-f0-9]{64}$'),
  organization_id VARCHAR(128) NOT NULL,
  project_id VARCHAR(128) NOT NULL,
  import_id TEXT NOT NULL,
  principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  operation_id VARCHAR(128) NOT NULL CHECK(operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  idempotency_key_sha256 CHAR(64) NOT NULL CHECK(idempotency_key_sha256 ~ '^[a-f0-9]{64}$'),
  request_sha256 CHAR(64) NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
  request_object_id VARCHAR(128) NOT NULL,
  result_sha256 CHAR(64) NOT NULL CHECK(result_sha256 ~ '^[a-f0-9]{64}$'),
  source_sha256 CHAR(64) NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
  decision TEXT NOT NULL CHECK(decision IN ('accept-into-design','keep-observed','ignore','reject')),
  lifecycle_status TEXT NOT NULL DEFAULT 'pending' CHECK(lifecycle_status IN ('pending','completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  reviewed_at TIMESTAMPTZ,
  command_id VARCHAR(128),
  command_key_sha256 CHAR(64) CHECK(command_key_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK((lifecycle_status='completed')=(reviewed_at IS NOT NULL)),
  CHECK(reviewed_at IS NULL OR reviewed_at>=created_at),
  CHECK((decision='accept-into-design' AND lifecycle_status='completed')=(command_id IS NOT NULL)),
  CHECK((command_id IS NULL)=(command_key_sha256 IS NULL)),
  UNIQUE(organization_id,project_id,import_id,operation_id),
  UNIQUE(organization_id,project_id,principal_id,idempotency_key_sha256),
  FOREIGN KEY(organization_id,project_id,import_id) REFERENCES bitbucket_repository_imports(organization_id,project_id,import_id),
  FOREIGN KEY(organization_id,project_id,request_object_id) REFERENCES stored_objects(organization_id,project_id,object_id)
);
CREATE FUNCTION guard_bitbucket_import_review_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Bitbucket review history is immutable'; END IF;
  IF TG_OP='UPDATE' AND (OLD.lifecycle_status<>'pending' OR NEW.lifecycle_status<>'completed'
    OR (to_jsonb(NEW)-ARRAY['lifecycle_status','reviewed_at','command_id','command_key_sha256'])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['lifecycle_status','reviewed_at','command_id','command_key_sha256'])) THEN
    RAISE EXCEPTION 'Only exact pending Bitbucket reviews can complete';
  END IF;
  IF TG_OP='INSERT' AND (NEW.lifecycle_status<>'pending' OR NEW.command_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Bitbucket reviews must first commit a pending claim';
  END IF;
  PERFORM 1 FROM bitbucket_repository_imports i
    JOIN async_jobs j ON j.organization_id=i.organization_id AND j.project_id=i.project_id AND j.job_id=i.import_id
    JOIN projects p ON p.organization_id=i.organization_id AND p.project_id=i.project_id AND p.lifecycle_status='active'
    JOIN stored_objects o ON o.organization_id=i.organization_id AND o.project_id=i.project_id AND o.object_id=NEW.request_object_id
    WHERE i.organization_id=NEW.organization_id AND i.project_id=NEW.project_id AND i.import_id=NEW.import_id
      AND i.principal_id=NEW.principal_id AND j.lifecycle_status='succeeded' AND j.family='repository-import'
      AND j.input_sha256=i.input_sha256 AND j.idempotency_scope='cloudmarkup.bitbucket-imports.create'
      AND j.created_by_principal_id=i.principal_id AND j.idempotency_actor_id=i.principal_id
      AND j.root_job_id=j.job_id AND j.parent_job_id IS NULL
      AND o.lifecycle_state='published' AND o.object_purpose='input-payload' AND o.media_type='application/json'
      AND o.content_sha256=NEW.request_sha256 AND o.created_by_principal_id=NEW.principal_id
    FOR SHARE OF i,j,p,o;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bitbucket review needs an owned completed import and immutable request'; END IF;
  IF NEW.command_id IS NOT NULL THEN
    PERFORM 1 FROM draft_command_receipts d JOIN stored_objects o
      ON o.organization_id=d.organization_id AND o.project_id=d.project_id AND o.object_id=d.document_object_id
      WHERE d.organization_id=NEW.organization_id AND d.project_id=NEW.project_id AND d.principal_id=NEW.principal_id
        AND d.idempotency_key_sha256=NEW.command_key_sha256 AND d.command_id=NEW.command_id
        AND o.lifecycle_state='published' AND o.content_sha256=d.content_sha256
      FOR SHARE OF d,o;
    IF NOT FOUND THEN RAISE EXCEPTION 'Accepted import review needs its published canonical draft command receipt'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bitbucket_import_review_v1 BEFORE INSERT OR UPDATE OR DELETE ON bitbucket_import_reviews
FOR EACH ROW EXECUTE FUNCTION guard_bitbucket_import_review_v1();
