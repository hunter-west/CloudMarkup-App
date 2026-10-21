-- Repair the SQL mirror of the already-deployed authorization-v2 editor policy.
-- The migration runner wraps all statements and its ledger insert in one
-- transaction. Hold role writes and reads until the canonical check is restored.
LOCK TABLE organization_roles IN ACCESS EXCLUSIVE MODE;

-- Refuse unexpected prior policy or stored metadata instead of normalizing it.
DO $$
DECLARE
  expected_role TEXT;
  expected_permissions TEXT[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'organization_roles'::regclass
      AND conname = 'organization_roles_authorization_v2_canonical_check'
      AND contype = 'c' AND convalidated
  ) THEN
    RAISE EXCEPTION 'expected validated authorization-v2 canonical role check'
      USING ERRCODE = '55000';
  END IF;

  FOR expected_role, expected_permissions IN
    SELECT * FROM (VALUES
      ('viewer', ARRAY[
        'organizations.read', 'projects.read', 'artifacts.read',
        'commercial.summary.read'
      ]::TEXT[]),
      ('editor', ARRAY[
        'organizations.read', 'projects.read', 'artifacts.read',
        'commercial.summary.read', 'projects.create', 'projects.mutate',
        'environments.create', 'revisions.create', 'validation.run',
        'generation.run', 'exports.run', 'commercial.expensive.use'
      ]::TEXT[]),
      ('administrator', ARRAY[
        'organizations.read', 'projects.read', 'artifacts.read',
        'commercial.summary.read', 'projects.create', 'projects.mutate',
        'environments.create', 'revisions.create', 'validation.run',
        'generation.run', 'exports.run', 'commercial.expensive.use',
        'memberships.read', 'memberships.manage', 'projects.delete',
        'integrations.read', 'integrations.manage', 'audit.read',
        'billing.manage', 'usage.read-technical'
      ]::TEXT[]),
      ('owner', ARRAY[
        'organizations.read', 'projects.read', 'artifacts.read',
        'commercial.summary.read', 'projects.create', 'projects.mutate',
        'environments.create', 'revisions.create', 'validation.run',
        'generation.run', 'exports.run', 'commercial.expensive.use',
        'memberships.read', 'memberships.manage', 'projects.delete',
        'integrations.read', 'integrations.manage', 'audit.read',
        'billing.manage', 'usage.read-technical',
        'memberships.assign-owner', 'organizations.delete'
      ]::TEXT[])
    ) AS prior_policy(role_key, capabilities)
  LOOP
    IF cloudmarkup_authorization_v2_permissions(expected_role)
         IS DISTINCT FROM expected_permissions
      OR EXISTS (
        SELECT 1 FROM organization_roles
        WHERE role_key = expected_role
          AND (policy_version = 'authorization-v2'
            AND is_owner = (expected_role = 'owner')
            AND capabilities = expected_permissions) IS NOT TRUE
      ) THEN
      RAISE EXCEPTION 'authorization-v2 canonical role mirror differs from expected prior policy'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE organization_roles
  DROP CONSTRAINT organization_roles_authorization_v2_canonical_check;

CREATE OR REPLACE FUNCTION cloudmarkup_authorization_v2_permissions(role_key TEXT)
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT CASE role_key
    WHEN 'viewer' THEN ARRAY[
      'organizations.read', 'projects.read', 'artifacts.read',
      'commercial.summary.read'
    ]::TEXT[]
    WHEN 'editor' THEN ARRAY[
      'organizations.read', 'projects.read', 'artifacts.read',
      'commercial.summary.read', 'projects.create', 'projects.mutate',
      'environments.create', 'revisions.create', 'validation.run',
      'generation.run', 'exports.run', 'integrations.read',
      'commercial.expensive.use'
    ]::TEXT[]
    WHEN 'administrator' THEN ARRAY[
      'organizations.read', 'projects.read', 'artifacts.read',
      'commercial.summary.read', 'projects.create', 'projects.mutate',
      'environments.create', 'revisions.create', 'validation.run',
      'generation.run', 'exports.run', 'commercial.expensive.use',
      'memberships.read', 'memberships.manage', 'projects.delete',
      'integrations.read', 'integrations.manage', 'audit.read',
      'billing.manage', 'usage.read-technical'
    ]::TEXT[]
    WHEN 'owner' THEN ARRAY[
      'organizations.read', 'projects.read', 'artifacts.read',
      'commercial.summary.read', 'projects.create', 'projects.mutate',
      'environments.create', 'revisions.create', 'validation.run',
      'generation.run', 'exports.run', 'commercial.expensive.use',
      'memberships.read', 'memberships.manage', 'projects.delete',
      'integrations.read', 'integrations.manage', 'audit.read',
      'billing.manage', 'usage.read-technical',
      'memberships.assign-owner', 'organizations.delete'
    ]::TEXT[]
    ELSE NULL
  END
$$;

UPDATE organization_roles
SET capabilities = cloudmarkup_authorization_v2_permissions(role_key),
    updated_at = CURRENT_TIMESTAMP
WHERE role_key = 'editor'
  AND policy_version = 'authorization-v2'
  AND is_owner = FALSE;

ALTER TABLE organization_roles
  ADD CONSTRAINT organization_roles_authorization_v2_canonical_check
  CHECK (
    role_key NOT IN ('owner', 'administrator', 'editor', 'viewer')
    OR (
      policy_version = 'authorization-v2'
      AND is_owner = (role_key = 'owner')
      AND capabilities = cloudmarkup_authorization_v2_permissions(role_key)
    )
  ) NOT VALID;

ALTER TABLE organization_roles
  VALIDATE CONSTRAINT organization_roles_authorization_v2_canonical_check;
