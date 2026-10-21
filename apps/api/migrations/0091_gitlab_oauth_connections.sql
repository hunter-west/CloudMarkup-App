-- No plaintext provider credential, authorization code or PKCE verifier is stored.
CREATE TABLE gitlab_oauth_link_intents (
  intent_id TEXT PRIMARY KEY CHECK(intent_id ~ '^gitlablink_[a-f0-9]{32}$'),
  connection_id TEXT NOT NULL UNIQUE CHECK(connection_id ~ '^gitlab_[a-f0-9]{32}$'),
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id),
  principal_id TEXT NOT NULL REFERENCES principals(principal_id),
  application_id TEXT NOT NULL CHECK(application_id ~ '^[a-f0-9]{64}$'),
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
  UNIQUE(organization_id,principal_id,application_id,intent_id,connection_id)
);
CREATE FUNCTION guard_gitlab_oauth_link_intent_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR
    (NEW.intent_id,NEW.connection_id,NEW.organization_id,NEW.principal_id,NEW.application_id,NEW.session_sha256,NEW.state_sha256,NEW.created_at,NEW.expires_at)
    IS DISTINCT FROM
    (OLD.intent_id,OLD.connection_id,OLD.organization_id,OLD.principal_id,OLD.application_id,OLD.session_sha256,OLD.state_sha256,OLD.created_at,OLD.expires_at)
    OR NOT ((OLD.lifecycle_status='pending' AND NEW.lifecycle_status='consumed')
      OR (OLD.lifecycle_status='consumed' AND NEW.lifecycle_status='completed' AND NEW.consumed_at=OLD.consumed_at)) THEN
    RAISE EXCEPTION 'GitLab OAuth intent transition rejected';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER gitlab_oauth_link_intent_v1 BEFORE UPDATE OR DELETE ON gitlab_oauth_link_intents
FOR EACH ROW EXECUTE FUNCTION guard_gitlab_oauth_link_intent_v1();
CREATE INDEX gitlab_oauth_link_intent_actor_expiry ON gitlab_oauth_link_intents(organization_id,principal_id,application_id,expires_at)
WHERE lifecycle_status='pending';

CREATE TABLE gitlab_oauth_connections (
  connection_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  provider_user_id BIGINT NOT NULL CHECK(provider_user_id BETWEEN 1 AND 9007199254740991),
  provider_username TEXT NOT NULL CHECK(length(provider_username) BETWEEN 1 AND 255),
  lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle_status IN ('active','refreshing','reconnect-required','disconnected','revoked')),
  provider_revocation_uncertain BOOLEAN NOT NULL DEFAULT FALSE,
  grant_version BIGINT NOT NULL DEFAULT 1 CHECK(grant_version BETWEEN 1 AND 9007199254740991),
  record_version BIGINT NOT NULL DEFAULT 1 CHECK(record_version BETWEEN 1 AND 9007199254740991),
  sealed_grant JSONB,
  grant_expires_at TIMESTAMPTZ NOT NULL,
  refresh_attempt_id TEXT CHECK(refresh_attempt_id ~ '^gitlabrefresh_[a-f0-9]{32}$'),
  refresh_session_sha256 TEXT CHECK(refresh_session_sha256 ~ '^[a-f0-9]{64}$'),
  refresh_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(organization_id,principal_id,application_id,intent_id,connection_id)
    REFERENCES gitlab_oauth_link_intents(organization_id,principal_id,application_id,intent_id,connection_id),
  CHECK((refresh_attempt_id IS NULL AND refresh_session_sha256 IS NULL AND refresh_deadline IS NULL)
    OR (refresh_attempt_id IS NOT NULL AND refresh_session_sha256 IS NOT NULL AND refresh_deadline IS NOT NULL)),
  CHECK(lifecycle_status<>'refreshing' OR refresh_attempt_id IS NOT NULL),
  CHECK((lifecycle_status='revoked' AND sealed_grant IS NULL) OR (lifecycle_status<>'revoked' AND sealed_grant IS NOT NULL)),
  CHECK(sealed_grant IS NULL OR (jsonb_typeof(sealed_grant)='object' AND octet_length(sealed_grant::text)<=24000
    AND sealed_grant->>'schemaVersion'='1' AND sealed_grant->>'algorithm'='aes-256-gcm'
    AND sealed_grant ?& ARRAY['schemaVersion','algorithm','keyArn','bindingSha256','encryptedDataKey','iv','authenticationTag','ciphertext']
    AND sealed_grant-ARRAY['schemaVersion','algorithm','keyArn','bindingSha256','encryptedDataKey','iv','authenticationTag','ciphertext']='{}'::jsonb))
);
CREATE FUNCTION guard_gitlab_oauth_connection_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR
    (NEW.connection_id,NEW.intent_id,NEW.organization_id,NEW.principal_id,NEW.application_id,NEW.provider_user_id,NEW.created_at)
    IS DISTINCT FROM
    (OLD.connection_id,OLD.intent_id,OLD.organization_id,OLD.principal_id,OLD.application_id,OLD.provider_user_id,OLD.created_at)
    OR NEW.record_version<>OLD.record_version+1 OR NEW.updated_at<OLD.updated_at
    OR (OLD.provider_revocation_uncertain AND NOT NEW.provider_revocation_uncertain)
    OR (NEW.lifecycle_status='revoked' AND NEW.provider_revocation_uncertain) THEN
    RAISE EXCEPTION 'GitLab connection identity transition rejected';
  END IF;
  IF NOT ((OLD.lifecycle_status='active' AND NEW.lifecycle_status IN ('refreshing','reconnect-required','disconnected'))
    OR (OLD.lifecycle_status='refreshing' AND NEW.lifecycle_status IN ('active','reconnect-required','disconnected'))
    OR (OLD.lifecycle_status='reconnect-required' AND NEW.lifecycle_status='disconnected')
    OR (OLD.lifecycle_status='disconnected' AND NEW.lifecycle_status='revoked')) THEN
    RAISE EXCEPTION 'GitLab connection lifecycle transition rejected';
  END IF;
  IF OLD.lifecycle_status='refreshing' AND NEW.lifecycle_status='active' THEN
    IF NEW.grant_version<>OLD.grant_version+1 OR NEW.sealed_grant IS NOT DISTINCT FROM OLD.sealed_grant THEN
      RAISE EXCEPTION 'GitLab refreshed grant must advance exactly once';
    END IF;
  ELSE
    IF NEW.grant_version<>OLD.grant_version OR NEW.provider_username<>OLD.provider_username OR NEW.grant_expires_at<>OLD.grant_expires_at
      OR (NEW.lifecycle_status<>'revoked' AND NEW.sealed_grant IS DISTINCT FROM OLD.sealed_grant) THEN
      RAISE EXCEPTION 'GitLab grant changed outside refresh';
    END IF;
  END IF;
  IF NEW.lifecycle_status='refreshing' THEN
    IF NEW.refresh_attempt_id IS NOT DISTINCT FROM OLD.refresh_attempt_id OR NEW.refresh_deadline<=clock_timestamp()
      OR NEW.refresh_deadline>clock_timestamp()+INTERVAL '1 minute' THEN
      RAISE EXCEPTION 'GitLab refresh needs a new bounded claim';
    END IF;
  ELSIF (NEW.refresh_attempt_id,NEW.refresh_session_sha256,NEW.refresh_deadline)
    IS DISTINCT FROM (OLD.refresh_attempt_id,OLD.refresh_session_sha256,OLD.refresh_deadline) THEN
    RAISE EXCEPTION 'GitLab refresh claim identity changed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER gitlab_oauth_connection_v1 BEFORE UPDATE OR DELETE ON gitlab_oauth_connections
FOR EACH ROW EXECUTE FUNCTION guard_gitlab_oauth_connection_v1();
CREATE INDEX gitlab_oauth_connections_actor ON gitlab_oauth_connections(organization_id,principal_id,application_id,connection_id);

-- The immutable provider ID is authority; mutable repository names are not persisted.
CREATE TABLE gitlab_project_selections (
  connection_id TEXT NOT NULL REFERENCES gitlab_oauth_connections(connection_id),
  provider_project_id BIGINT NOT NULL CHECK(provider_project_id BETWEEN 1 AND 9007199254740991),
  selection_version BIGINT NOT NULL CHECK(selection_version BETWEEN 1 AND 9007199254740990),
  enabled BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(connection_id,provider_project_id)
);
CREATE FUNCTION guard_gitlab_project_selection_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR
    (NEW.connection_id,NEW.provider_project_id,NEW.created_at) IS DISTINCT FROM (OLD.connection_id,OLD.provider_project_id,OLD.created_at)
    OR NEW.selection_version<>OLD.selection_version+1 OR NEW.updated_at<OLD.updated_at THEN
    RAISE EXCEPTION 'GitLab project selection transition rejected';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER gitlab_project_selection_v1 BEFORE UPDATE OR DELETE ON gitlab_project_selections
FOR EACH ROW EXECUTE FUNCTION guard_gitlab_project_selection_v1();

-- Approval references immutable retained artifacts; source files and credentials are not copied into SQL.
CREATE TABLE gitlab_export_reviews (
  review_id TEXT PRIMARY KEY CHECK(review_id ~ '^gitlabreview_[a-f0-9]{32}$'),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  principal_id TEXT NOT NULL REFERENCES principals(principal_id),
  application_id TEXT NOT NULL CHECK(application_id ~ '^[a-f0-9]{64}$'),
  connection_id TEXT NOT NULL REFERENCES gitlab_oauth_connections(connection_id),
  provider_project_id BIGINT NOT NULL CHECK(provider_project_id BETWEEN 1 AND 9007199254740991),
  branch_name TEXT NOT NULL CHECK(branch_name ~ '^cloudmarkup/export-[a-f0-9]{32}$'),
  descriptor JSONB NOT NULL CHECK(jsonb_typeof(descriptor)='object' AND octet_length(descriptor::text)<=8192),
  approval_digest TEXT NOT NULL CHECK(approval_digest ~ '^sha256:[a-f0-9]{64}$'),
  lifecycle_status TEXT NOT NULL DEFAULT 'prepared' CHECK(lifecycle_status IN ('prepared','commit-dispatched','verifying','verified','merge-request-dispatched','succeeded')),
  record_version BIGINT NOT NULL DEFAULT 1 CHECK(record_version BETWEEN 1 AND 9007199254740991),
  verified_files INTEGER NOT NULL DEFAULT 0 CHECK(verified_files BETWEEN 0 AND 512),
  commit_sha TEXT CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
  merge_request JSONB CHECK(jsonb_typeof(merge_request)='object' AND octet_length(merge_request::text)<=4096),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,project_id),
  UNIQUE(connection_id,provider_project_id,branch_name),
  CHECK(expires_at>created_at AND expires_at<=created_at+INTERVAL '15 minutes'),
  CHECK(descriptor ?& ARRAY['schemaVersion','reviewId','organizationId','projectId','principalId','applicationId','connectionId','providerProjectId','selectionVersion','artifactId','artifactManifestDigest','artifactZipDigest','artifactReviewDigest','baseCommitSha','baseBranch','branch','destinationFolder','expectedTreeSha','fileCount'] AND descriptor-ARRAY['schemaVersion','reviewId','organizationId','projectId','principalId','applicationId','connectionId','providerProjectId','selectionVersion','artifactId','artifactManifestDigest','artifactZipDigest','artifactReviewDigest','baseCommitSha','baseBranch','branch','destinationFolder','expectedTreeSha','fileCount']='{}'::jsonb),
  CHECK(descriptor->>'schemaVersion'='1' AND descriptor->>'reviewId'=review_id AND descriptor->>'organizationId'=organization_id
    AND descriptor->>'projectId'=project_id AND descriptor->>'principalId'=principal_id AND descriptor->>'applicationId'=application_id
    AND descriptor->>'connectionId'=connection_id AND descriptor->>'providerProjectId'=provider_project_id::text AND descriptor->>'branch'=branch_name),
  CHECK((descriptor->>'fileCount')::integer BETWEEN 1 AND 512 AND verified_files<=(descriptor->>'fileCount')::integer),
  CHECK((lifecycle_status IN ('prepared','commit-dispatched') AND commit_sha IS NULL AND verified_files=0 AND merge_request IS NULL)
    OR (lifecycle_status='verifying' AND commit_sha IS NOT NULL AND merge_request IS NULL)
    OR (lifecycle_status IN ('verified','merge-request-dispatched') AND commit_sha IS NOT NULL AND verified_files=(descriptor->>'fileCount')::integer AND merge_request IS NULL)
    OR (lifecycle_status='succeeded' AND commit_sha IS NOT NULL AND verified_files=(descriptor->>'fileCount')::integer AND merge_request IS NOT NULL))
);
CREATE INDEX gitlab_export_review_actor ON gitlab_export_reviews(organization_id,principal_id,application_id,project_id,review_id);
CREATE FUNCTION guard_gitlab_export_review_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR
    (NEW.review_id,NEW.organization_id,NEW.project_id,NEW.principal_id,NEW.application_id,NEW.connection_id,NEW.provider_project_id,NEW.branch_name,NEW.descriptor,NEW.approval_digest,NEW.created_at,NEW.expires_at)
    IS DISTINCT FROM
    (OLD.review_id,OLD.organization_id,OLD.project_id,OLD.principal_id,OLD.application_id,OLD.connection_id,OLD.provider_project_id,OLD.branch_name,OLD.descriptor,OLD.approval_digest,OLD.created_at,OLD.expires_at)
    OR NEW.record_version<>OLD.record_version+1 OR NEW.updated_at<OLD.updated_at THEN
    RAISE EXCEPTION 'GitLab export approval identity changed';
  END IF;
  IF NOT ((OLD.lifecycle_status='prepared' AND NEW.lifecycle_status='commit-dispatched' AND OLD.expires_at>clock_timestamp())
    OR (OLD.lifecycle_status='commit-dispatched' AND NEW.lifecycle_status='verifying')
    OR (OLD.lifecycle_status='verifying' AND NEW.lifecycle_status IN ('verifying','verified'))
    OR (OLD.lifecycle_status='verified' AND NEW.lifecycle_status='merge-request-dispatched' AND OLD.expires_at>clock_timestamp())
    OR (OLD.lifecycle_status='merge-request-dispatched' AND NEW.lifecycle_status='succeeded')) THEN
    RAISE EXCEPTION 'GitLab export stage transition rejected';
  END IF;
  IF (OLD.lifecycle_status<>'commit-dispatched' AND NEW.commit_sha IS DISTINCT FROM OLD.commit_sha)
    OR (OLD.lifecycle_status<>'merge-request-dispatched' AND NEW.merge_request IS DISTINCT FROM OLD.merge_request) THEN
    RAISE EXCEPTION 'GitLab export receipt changed outside its stage';
  END IF;
  IF OLD.lifecycle_status='verifying' THEN
    IF NEW.verified_files<=OLD.verified_files OR NEW.verified_files>OLD.verified_files+16 THEN
      RAISE EXCEPTION 'GitLab export verification must advance one bounded batch';
    END IF;
  ELSIF NEW.verified_files<>OLD.verified_files THEN
    RAISE EXCEPTION 'GitLab export verification changed outside its stage';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER gitlab_export_review_v1 BEFORE UPDATE OR DELETE ON gitlab_export_reviews
FOR EACH ROW EXECUTE FUNCTION guard_gitlab_export_review_v1();
