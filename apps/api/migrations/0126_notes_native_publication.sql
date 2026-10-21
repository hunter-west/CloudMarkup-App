-- CloudMarkup additive migration 0126; fixed reviewed source closure.
-- UNAPPLIED, UNREGISTERED source proposal. No application role receives INSERT,
-- UPDATE or DELETE. It supplies no native approval, migration, seed or grants.
-- The activation owner must approve exact issuance/revocation authority and the
-- proposal before any migration or privileged publication. Model-route
-- promotions and notes_native_pilot lease/cost rows cannot authorize this host.
CREATE TABLE notes_native_publications (
  organization_id varchar(128) NOT NULL REFERENCES organizations(organization_id),
  project_id varchar(128) NOT NULL,
  principal_id varchar(128) NOT NULL REFERENCES principals(principal_id),
  environment text NOT NULL CHECK (environment='beta'),
  publication_id varchar(128) NOT NULL,
  publication_sha256 char(64) NOT NULL CHECK (publication_sha256 ~ '^[a-f0-9]{64}$'),
  operator_principal_id varchar(128) NOT NULL REFERENCES principals(principal_id),
  binding jsonb NOT NULL CHECK (jsonb_typeof(binding)='object' AND octet_length(binding::text)<=8192),
  issued_at timestamptz NOT NULL,
  effective_from timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id,project_id,principal_id,publication_id),
  UNIQUE (organization_id,project_id,principal_id,publication_id,publication_sha256),
  FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,project_id),
  FOREIGN KEY (organization_id,principal_id) REFERENCES memberships(organization_id,principal_id),
  FOREIGN KEY (organization_id,operator_principal_id) REFERENCES memberships(organization_id,principal_id),
  CHECK (issued_at<=effective_from AND effective_from<expires_at AND expires_at<=issued_at+interval '30 days'),
  CHECK ((binding ?& ARRAY['environment','ownership','principalId','sourceCommit','sourceTree','nativeHostDigest','targetSettingsDigest','manifestDigest','placementDigest','privateImageReceiptDigest']
    AND binding-ARRAY['environment','ownership','principalId','sourceCommit','sourceTree','nativeHostDigest','targetSettingsDigest','manifestDigest','placementDigest','privateImageReceiptDigest']='{}'::jsonb
    AND binding->>'environment'=environment AND binding->>'principalId'=principal_id
    AND binding#>>'{ownership,organizationId}'=organization_id AND binding#>>'{ownership,projectId}'=project_id
    AND (binding->'ownership')-ARRAY['organizationId','projectId']='{}'::jsonb
    AND binding->>'sourceCommit' ~ '^[a-f0-9]{40}$' AND binding->>'sourceTree' ~ '^[a-f0-9]{40}$'
    AND binding->>'nativeHostDigest' ~ '^sha256:[a-f0-9]{64}$'
    AND binding->>'targetSettingsDigest' ~ '^sha256:[a-f0-9]{64}$'
    AND binding->>'manifestDigest' ~ '^sha256:[a-f0-9]{64}$'
    AND binding->>'placementDigest' ~ '^sha256:[a-f0-9]{64}$'
    AND binding->>'privateImageReceiptDigest' ~ '^sha256:[a-f0-9]{64}$') IS TRUE)
);

CREATE TABLE notes_native_publication_revocations (
  organization_id varchar(128) NOT NULL,
  project_id varchar(128) NOT NULL,
  principal_id varchar(128) NOT NULL,
  publication_id varchar(128) NOT NULL,
  publication_sha256 char(64) NOT NULL,
  operator_principal_id varchar(128) NOT NULL REFERENCES principals(principal_id),
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,project_id,principal_id,publication_id),
  FOREIGN KEY (organization_id,project_id,principal_id,publication_id,publication_sha256)
    REFERENCES notes_native_publications(organization_id,project_id,principal_id,publication_id,publication_sha256),
  FOREIGN KEY (organization_id,operator_principal_id) REFERENCES memberships(organization_id,principal_id)
);

CREATE FUNCTION notes_native_publication_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'native publication metadata is append-only' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER notes_native_publication_append_only BEFORE UPDATE OR DELETE ON notes_native_publications
  FOR EACH ROW EXECUTE FUNCTION notes_native_publication_append_only();

CREATE TRIGGER notes_native_publication_revocation_append_only BEFORE UPDATE OR DELETE ON notes_native_publication_revocations
  FOR EACH ROW EXECUTE FUNCTION notes_native_publication_append_only();

-- Deliberately no INSERT, approved principal IDs, GRANT, migration registration,
-- live SQL, environment mutation or activation statement.;
