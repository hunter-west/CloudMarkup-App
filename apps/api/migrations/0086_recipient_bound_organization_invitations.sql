-- Existing short-lived bearer invitations retain their immutable identity.
ALTER TABLE organization_invitations
  ADD COLUMN recipient_principal_id VARCHAR(128) REFERENCES principals(principal_id),
  ADD COLUMN declined_by_recipient BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT organization_invitation_recipient_decline CHECK (
    NOT declined_by_recipient OR (recipient_principal_id IS NOT NULL AND lifecycle_state='revoked')
  ),
  ADD CONSTRAINT organization_invitation_recipient CHECK (
    recipient_principal_id IS NULL OR (
      recipient_principal_id<>issuer_principal_id AND
      (accepted_principal_id IS NULL OR accepted_principal_id=recipient_principal_id)
    )
  );
-- Identity, including the recipient, remains immutable. The only new lifecycle
-- field records recipient decline of a pending invitation.
CREATE INDEX organization_invitation_recipient_inbox
  ON organization_invitations(recipient_principal_id,invitation_id)
  WHERE recipient_principal_id IS NOT NULL;
CREATE INDEX organization_invitation_pending_recipient
  ON organization_invitations(organization_id,recipient_principal_id,expires_at)
  WHERE lifecycle_state='pending' AND recipient_principal_id IS NOT NULL;

CREATE OR REPLACE FUNCTION guard_organization_invitation_identity_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'invitation history is retained' USING ERRCODE='23514';
  END IF;
  IF OLD.lifecycle_state<>'pending' OR
     (to_jsonb(NEW)-ARRAY['lifecycle_state','accepted_principal_id','accepted_membership_id','accepted_at','accepted_auth_expires_at','revoked_at','declined_by_recipient'])
       IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['lifecycle_state','accepted_principal_id','accepted_membership_id','accepted_at','accepted_auth_expires_at','revoked_at','declined_by_recipient'])
  THEN RAISE EXCEPTION 'invitation identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
