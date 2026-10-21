CREATE FUNCTION cloudmarkup_authorization_v1_permissions(role_key TEXT)
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT CASE role_key
    WHEN 'viewer' THEN ARRAY[
      'organizations.read',
      'projects.read',
      'artifacts.read'
    ]::TEXT[]
    WHEN 'editor' THEN ARRAY[
      'organizations.read',
      'projects.read',
      'artifacts.read',
      'projects.create',
      'projects.mutate',
      'environments.create',
      'revisions.create',
      'validation.run',
      'generation.run',
      'exports.run'
    ]::TEXT[]
    WHEN 'administrator' THEN ARRAY[
      'organizations.read',
      'projects.read',
      'artifacts.read',
      'projects.create',
      'projects.mutate',
      'environments.create',
      'revisions.create',
      'validation.run',
      'generation.run',
      'exports.run',
      'memberships.read',
      'memberships.manage',
      'projects.delete',
      'integrations.read',
      'integrations.manage',
      'audit.read'
    ]::TEXT[]
    WHEN 'owner' THEN ARRAY[
      'organizations.read',
      'projects.read',
      'artifacts.read',
      'projects.create',
      'projects.mutate',
      'environments.create',
      'revisions.create',
      'validation.run',
      'generation.run',
      'exports.run',
      'memberships.read',
      'memberships.manage',
      'projects.delete',
      'integrations.read',
      'integrations.manage',
      'audit.read',
      'memberships.assign-owner',
      'organizations.delete'
    ]::TEXT[]
    ELSE NULL
  END
$$;

INSERT INTO organization_roles (
  organization_id,
  role_key,
  policy_version,
  is_owner,
  capabilities,
  created_at,
  updated_at
)
SELECT
  organization_id,
  role_key,
  'authorization-v1',
  role_key = 'owner',
  cloudmarkup_authorization_v1_permissions(role_key),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM organizations
CROSS JOIN (
  VALUES ('owner'), ('administrator'), ('editor'), ('viewer')
) AS canonical_role(role_key)
ON CONFLICT (organization_id, role_key) DO NOTHING;

UPDATE memberships
SET role_key = 'owner', updated_at = CURRENT_TIMESTAMP
WHERE membership_id = 'membership_local_owner'
  AND organization_id = 'organization_local'
  AND principal_id = 'principal_local_owner'
  AND role_key = 'local-owner';

ALTER TABLE organization_roles
  ADD CONSTRAINT organization_roles_authorization_v1_canonical_check
  CHECK (
    role_key NOT IN ('owner', 'administrator', 'editor', 'viewer')
    OR (
      policy_version = 'authorization-v1'
      AND is_owner = (role_key = 'owner')
      AND capabilities = cloudmarkup_authorization_v1_permissions(role_key)
    )
  );

COMMENT ON FUNCTION cloudmarkup_authorization_v1_permissions(TEXT) IS
  'Mirrors authorization-v1 role permissions for migration checks only; application policy remains the runtime authority.';

COMMENT ON TABLE organization_roles IS
  'Canonical roles use authorization-v1; legacy noncanonical rows cannot grant application access and remain only for explicit review.';
