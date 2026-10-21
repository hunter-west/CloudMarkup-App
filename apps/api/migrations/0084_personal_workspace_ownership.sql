-- Add explicit ownership without inferring or moving existing tenant data.
ALTER TABLE organizations
  ADD COLUMN workspace_kind TEXT NOT NULL DEFAULT 'organization',
  ADD COLUMN personal_owner_principal_id VARCHAR(128) UNIQUE REFERENCES principals(principal_id),
  ADD CONSTRAINT organizations_workspace_ownership CHECK (
    (workspace_kind='organization' AND personal_owner_principal_id IS NULL) OR
    (workspace_kind='personal' AND personal_owner_principal_id IS NOT NULL)
  );

CREATE FUNCTION guard_workspace_ownership_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.workspace_kind='personal' THEN RAISE EXCEPTION 'Personal account lifecycle requires its dedicated workflow' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF ROW(NEW.workspace_kind,NEW.personal_owner_principal_id) IS DISTINCT FROM ROW(OLD.workspace_kind,OLD.personal_owner_principal_id)
    OR (OLD.workspace_kind='personal' AND NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status)
    THEN RAISE EXCEPTION 'Workspace ownership is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_ownership_v1 BEFORE UPDATE OR DELETE ON organizations
  FOR EACH ROW EXECUTE FUNCTION guard_workspace_ownership_v1();

CREATE FUNCTION guard_personal_workspace_membership_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE workspace organizations%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN
    SELECT * INTO workspace FROM organizations WHERE organization_id=OLD.organization_id FOR SHARE;
    IF workspace.workspace_kind='personal' AND (TG_OP='DELETE' OR
      ROW(NEW.organization_id,NEW.membership_id,NEW.principal_id,NEW.role_key,NEW.lifecycle_status)
      IS DISTINCT FROM ROW(OLD.organization_id,OLD.membership_id,OLD.principal_id,OLD.role_key,OLD.lifecycle_status))
      THEN RAISE EXCEPTION 'Personal workspace membership cannot be removed or reassigned' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT * INTO workspace FROM organizations WHERE organization_id=NEW.organization_id FOR SHARE;
  IF workspace.workspace_kind='personal' AND
    (NEW.principal_id<>workspace.personal_owner_principal_id OR NEW.role_key<>'owner' OR NEW.lifecycle_status<>'active')
    THEN RAISE EXCEPTION 'Personal workspace permits only its active owner' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER personal_workspace_membership_v1 BEFORE INSERT OR UPDATE OR DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION guard_personal_workspace_membership_v1();

CREATE FUNCTION guard_personal_workspace_invitation_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind TEXT;
BEGIN
  SELECT workspace_kind INTO kind FROM organizations WHERE organization_id=NEW.organization_id FOR SHARE;
  IF kind='personal' THEN RAISE EXCEPTION 'Personal workspaces cannot be shared' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER personal_workspace_invitation_v1 BEFORE INSERT OR UPDATE ON organization_invitations
  FOR EACH ROW EXECUTE FUNCTION guard_personal_workspace_invitation_v1();

CREATE TABLE workspace_creation_receipts (
  principal_id VARCHAR(128) NOT NULL REFERENCES principals(principal_id),
  request_key_sha256 CHAR(64) NOT NULL CHECK(request_key_sha256 ~ '^[a-f0-9]{64}$'),
  request_sha256 CHAR(64) NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
  organization_id VARCHAR(128) NOT NULL UNIQUE REFERENCES organizations(organization_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(principal_id,request_key_sha256)
);
CREATE FUNCTION retain_workspace_creation_receipt_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Workspace creation receipt is immutable' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER workspace_creation_receipt_v1 BEFORE UPDATE OR DELETE ON workspace_creation_receipts
  FOR EACH ROW EXECUTE FUNCTION retain_workspace_creation_receipt_v1();
