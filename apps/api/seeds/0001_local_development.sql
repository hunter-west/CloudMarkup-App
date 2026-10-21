-- Deterministic relational seed for credentialless local development.
-- Canonical documents and revisions are object-backed and are created by the
-- object-aware local seeder; this SQL never fabricates stored-object references.

INSERT INTO principals (
  principal_id,
  display_name,
  email,
  lifecycle_status,
  created_at,
  updated_at
) VALUES
  (
    'principal_local_owner',
    'Local CloudMarkup Owner',
    'owner@example.test',
    'active',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z'
  ),
  (
    'principal_local_team_owner',
    'Local Team Owner',
    'team-owner@example.test',
    'active',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z'
  ),
  (
    'principal_local_team_administrator',
    'Local Team Administrator',
    'team-administrator@example.test',
    'active',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z'
  ),
  (
    'principal_local_team_editor',
    'Local Team Editor',
    'team-editor@example.test',
    'active',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z'
  ),
  (
    'principal_local_team_viewer',
    'Local Team Viewer',
    'team-viewer@example.test',
    'active',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z'
  )
ON CONFLICT (principal_id) DO NOTHING;

INSERT INTO principal_identity_references (
  identity_reference_id,
  principal_id,
  identity_provider,
  issuer,
  subject_reference,
  created_at
) VALUES
  (
    'identity_local_owner',
    'principal_local_owner',
    'local-development',
    'https://identity.example.test/local',
    'local-owner',
    '2026-01-01T00:00:00Z'
  ),
  (
    'identity_local_team_owner',
    'principal_local_team_owner',
    'local-development',
    'https://identity.example.test/local',
    'local-team-owner',
    '2026-01-01T00:00:00Z'
  ),
  (
    'identity_local_team_administrator',
    'principal_local_team_administrator',
    'local-development',
    'https://identity.example.test/local',
    'local-team-administrator',
    '2026-01-01T00:00:00Z'
  ),
  (
    'identity_local_team_editor',
    'principal_local_team_editor',
    'local-development',
    'https://identity.example.test/local',
    'local-team-editor',
    '2026-01-01T00:00:00Z'
  ),
  (
    'identity_local_team_viewer',
    'principal_local_team_viewer',
    'local-development',
    'https://identity.example.test/local',
    'local-team-viewer',
    '2026-01-01T00:00:00Z'
  )
ON CONFLICT (identity_reference_id) DO NOTHING;

INSERT INTO user_presentation_preferences (
  principal_id,
  experience_mode,
  contextual_learning_enabled,
  sync_version,
  updated_at
) VALUES
  ('principal_local_owner', 'guided', TRUE, 1, '2026-01-01T00:00:00Z'),
  ('principal_local_team_owner', 'professional', TRUE, 1, '2026-01-01T00:00:00Z'),
  (
    'principal_local_team_administrator',
    'professional',
    TRUE,
    1,
    '2026-01-01T00:00:00Z'
  ),
  ('principal_local_team_editor', 'guided', TRUE, 1, '2026-01-01T00:00:00Z'),
  ('principal_local_team_viewer', 'guided', FALSE, 1, '2026-01-01T00:00:00Z')
ON CONFLICT (principal_id) DO NOTHING;

INSERT INTO organizations (
  organization_id,
  display_name,
  slug,
  lifecycle_status,
  created_at,
  updated_at
) VALUES
  (
    'org_local',
    'Local Individual Organization',
    'local-cloudmarkup',
    'active',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z'
  ),
  (
    'org_local_team',
    'Local Team Organization',
    'local-cloudmarkup-team',
    'active',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z'
  )
ON CONFLICT (organization_id) DO NOTHING;

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
  local_organization.organization_id,
  canonical_role.role_key,
  'authorization-v2',
  canonical_role.role_key = 'owner',
  cloudmarkup_authorization_v2_permissions(canonical_role.role_key),
  '2026-01-01T00:00:00Z',
  '2026-01-01T00:00:00Z'
FROM (
  VALUES
    ('org_local'),
    ('org_local_team')
) AS local_organization(organization_id)
CROSS JOIN (
  VALUES
    ('owner'),
    ('administrator'),
    ('editor'),
    ('viewer')
) AS canonical_role(role_key)
ON CONFLICT (organization_id, role_key) DO NOTHING;

INSERT INTO memberships (
  membership_id,
  organization_id,
  principal_id,
  role_key,
  lifecycle_status,
  joined_at,
  updated_at
) VALUES
  (
    'membership_local_owner',
    'org_local',
    'principal_local_owner',
    'owner',
    'active',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z'
  ),
  (
    'membership_local_team_owner',
    'org_local_team',
    'principal_local_team_owner',
    'owner',
    'active',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z'
  ),
  (
    'membership_local_team_administrator',
    'org_local_team',
    'principal_local_team_administrator',
    'administrator',
    'active',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z'
  ),
  (
    'membership_local_team_editor',
    'org_local_team',
    'principal_local_team_editor',
    'editor',
    'active',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z'
  ),
  (
    'membership_local_team_viewer',
    'org_local_team',
    'principal_local_team_viewer',
    'viewer',
    'active',
    '2026-01-01T00:00:00Z',
    '2026-01-01T00:00:00Z'
  )
ON CONFLICT (membership_id) DO NOTHING;

INSERT INTO organization_billing_accounts (
  billing_account_id,
  organization_id,
  lifecycle_status,
  expensive_operations_enabled,
  record_version,
  created_at,
  updated_at
) VALUES
  (
    'billing_account_local_individual',
    'org_local',
    'active',
    TRUE,
    1,
    '2026-08-15T00:00:00Z',
    '2026-08-15T00:00:00Z'
  ),
  (
    'billing_account_local_team',
    'org_local_team',
    'active',
    TRUE,
    1,
    '2026-08-15T00:00:00Z',
    '2026-08-15T00:00:00Z'
  )
ON CONFLICT (billing_account_id) DO NOTHING;

INSERT INTO organization_subscription_projections (
  subscription_projection_id,
  organization_id,
  billing_account_id,
  billing_provider,
  provider_customer_reference,
  provider_subscription_reference,
  provider_product_reference,
  provider_price_reference,
  normalized_status,
  plan_version_id,
  billable_seat_quantity,
  effective_at,
  record_version,
  created_at,
  updated_at,
  cancel_at_period_end
) VALUES
  (
    'subscription_projection_local_individual',
    'org_local',
    'billing_account_local_individual',
    'fake',
    'customer_fake_local_individual',
    'subscription_fake_local_individual',
    'product_fake_starter',
    'price_fake_starter_monthly',
    'active',
    'planver_starter_2026_08_14_v1',
    1,
    '2026-08-15T00:00:00Z',
    1,
    '2026-08-15T00:00:00Z',
    '2026-08-15T00:00:00Z',
    FALSE
  ),
  (
    'subscription_projection_local_team',
    'org_local_team',
    'billing_account_local_team',
    'fake',
    'customer_fake_local_team',
    'subscription_fake_local_team',
    'product_fake_pro',
    'price_fake_pro_monthly',
    'active',
    'planver_pro_2026_08_14_v2',
    1,
    '2026-08-15T00:00:00Z',
    1,
    '2026-08-15T00:00:00Z',
    '2026-08-15T00:00:00Z',
    FALSE
  )
ON CONFLICT (subscription_projection_id) DO NOTHING;

INSERT INTO organization_entitlement_snapshots (
  organization_id,
  storage_contract_version,
  entitlement_snapshot_id,
  billing_account_id,
  subscription_projection_id,
  plan_version_id,
  entitlement_policy_version,
  source_record_version,
  expensive_operations_enabled,
  record_version,
  effective_at,
  created_at,
  updated_at
) VALUES
  (
    'org_local',
    1,
    'entitlement_snapshot_local_individual',
    'billing_account_local_individual',
    'subscription_projection_local_individual',
    'planver_starter_2026_08_14_v1',
    'cloudmarkup-entitlements-v1',
    1,
    TRUE,
    1,
    '2026-08-15T00:00:00Z',
    '2026-08-15T00:00:00Z',
    '2026-08-15T00:00:00Z'
  ),
  (
    'org_local_team',
    1,
    'entitlement_snapshot_local_team',
    'billing_account_local_team',
    'subscription_projection_local_team',
    'planver_pro_2026_08_14_v2',
    'cloudmarkup-entitlements-v1',
    1,
    TRUE,
    1,
    '2026-08-15T00:00:00Z',
    '2026-08-15T00:00:00Z',
    '2026-08-15T00:00:00Z'
  )
ON CONFLICT (organization_id) DO NOTHING;

-- Promotional, non-expiring local credits make the fake summaries stable
-- across calendar time without pretending to be monthly subscription grants.
INSERT INTO credit_grants (
  credit_grant_id,
  organization_id,
  billing_account_id,
  plan_version_id,
  grant_kind,
  credit_units,
  starts_at,
  expiration_policy_kind,
  expiration_policy_version,
  consumption_priority,
  source_reference,
  grant_policy_version,
  idempotency_key_sha256,
  created_by_actor_kind,
  created_by_actor_id,
  created_at
) VALUES
  (
    'credit_grant_local_individual',
    'org_local',
    'billing_account_local_individual',
    'planver_starter_2026_08_14_v1',
    'promotional',
    200,
    '2026-08-15T00:00:00Z',
    'does-not-expire',
    'cloudmarkup-credit-expiration-v1',
    100,
    'local-development:individual:credits:v1',
    'cloudmarkup-local-seed-v1',
    '7dc251155fa36483a3acc6e9262498fbd01ae971f934635da3b9a761b9a0a644',
    'internal-accounting',
    'local-seed-accounting',
    '2026-08-15T00:00:00Z'
  ),
  (
    'credit_grant_local_team',
    'org_local_team',
    'billing_account_local_team',
    'planver_pro_2026_08_14_v2',
    'promotional',
    1000,
    '2026-08-15T00:00:00Z',
    'does-not-expire',
    'cloudmarkup-credit-expiration-v1',
    100,
    'local-development:team:credits:v1',
    'cloudmarkup-local-seed-v1',
    'd96a88c1888b44bcf04120bc3db6058bb07b0ce57d02e99d60f5b31d36744f87',
    'internal-accounting',
    'local-seed-accounting',
    '2026-08-15T00:00:00Z'
  )
ON CONFLICT (credit_grant_id) DO NOTHING;

INSERT INTO usage_ledger_entries (
  organization_id,
  ledger_entry_id,
  idempotency_key_sha256,
  occurred_at,
  entry_kind,
  billing_account_id,
  credit_grant_id,
  plan_version_id,
  recorded_by_actor_kind,
  recorded_by_actor_id,
  granted_credit_units,
  outcome,
  reason_code,
  charging_policy_version,
  correlation_id
) VALUES
  (
    'org_local',
    'ledger_local_individual_credit_grant',
    '9450ed79bdf6c22633f653ce32f12c70bd81df3001457e163bd447ccbe5a861c',
    '2026-08-15T00:00:00Z',
    'grant',
    'billing_account_local_individual',
    'credit_grant_local_individual',
    'planver_starter_2026_08_14_v1',
    'internal-accounting',
    'local-seed-accounting',
    200,
    'granted',
    'local.seed-grant',
    'cloudmarkup-charging-and-failure-v1',
    'correlation_local_individual_seed_v1'
  ),
  (
    'org_local_team',
    'ledger_local_team_credit_grant',
    'd30b74753553d419c20f93ae7d070a2d8dd7b4d68f30cc1894468273ac6163ef',
    '2026-08-15T00:00:00Z',
    'grant',
    'billing_account_local_team',
    'credit_grant_local_team',
    'planver_pro_2026_08_14_v2',
    'internal-accounting',
    'local-seed-accounting',
    1000,
    'granted',
    'local.seed-grant',
    'cloudmarkup-charging-and-failure-v1',
    'correlation_local_team_seed_v1'
  )
ON CONFLICT (organization_id, ledger_entry_id) DO NOTHING;
