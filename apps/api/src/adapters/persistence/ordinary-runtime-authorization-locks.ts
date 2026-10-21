// Source-only authorization successor. Central adapter integration belongs to
// the ordinary runtime owner; registered SQL/EXECUTE admission to the integrator.
export const ordinaryAuthorizationReceiptColumn =
  "__cloudmarkup_ordinary_authorization_key";

/** Exact SQL and argument bindings. Purposes are source literals, never request
 * SQL/table/column/lock-mode inputs. Business results stay ordinary invoker reads. */
export const ordinaryAuthorizationLockReads = [
  {
    inventoryId: 1,
    sourceSha256:
      "cf8d53ea4794a6cb5597a22efa02fbfcfe17d429e77168b50707cd055a7cfc42",
    name: "project_request_authorization",
    purpose: "intent-scope",
    statement:
      "SELECT p.organization_id,m.membership_id,r.role_key,array_to_json(r.capabilities)::text AS capabilities_json\n      FROM projects p JOIN organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'\n      JOIN memberships m ON m.organization_id=p.organization_id AND m.principal_id=$1 AND m.lifecycle_status='active'\n      JOIN principals actor ON actor.principal_id=m.principal_id AND actor.lifecycle_status='active'\n      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key\n      WHERE p.project_id=$2 AND (p.lifecycle_status='active' OR ($3='projects.read' AND p.lifecycle_status='archived'))\n        AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)\n        AND r.capabilities @> ARRAY[$3]::text[] AND $4::timestamptz>clock_timestamp() AND $5::timestamptz<=clock_timestamp()+INTERVAL '60 seconds'\n      FOR UPDATE OF p FOR SHARE OF o,m,actor,r",
    reread:
      "SELECT p.organization_id,m.membership_id,r.role_key,array_to_json(r.capabilities)::text AS capabilities_json, jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,p.project_id)::text AS __cloudmarkup_ordinary_authorization_key FROM projects p JOIN organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'\n      JOIN memberships m ON m.organization_id=p.organization_id AND m.principal_id=$1 AND m.lifecycle_status='active'\n      JOIN principals actor ON actor.principal_id=m.principal_id AND actor.lifecycle_status='active'\n      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key\n      WHERE p.project_id=$2 AND (p.lifecycle_status='active' OR ($3='projects.read' AND p.lifecycle_status='archived'))\n        AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)\n        AND r.capabilities @> ARRAY[$3]::text[] AND $4::timestamptz>clock_timestamp() AND $5::timestamptz<=clock_timestamp()+INTERVAL '60 seconds'\n       ",
    parameterCount: 5,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: false,
    helperArguments: [
      { literal: "intent-scope" },
      { valueIndex: 0 },
      { valueIndex: 1 },
      { valueIndex: 2 },
      { valueIndex: 3 },
      { valueIndex: 4 },
    ],
  },
  {
    inventoryId: 2,
    sourceSha256:
      "cb2bf4eecf32028cc21dceefce2cb6252e58263c176149a3bc3695bf4817bd78",
    name: "project_request_authorization",
    purpose: "preview-resolve",
    statement:
      "SELECT p.organization_id FROM projects p\n        JOIN organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'\n        JOIN memberships m ON m.organization_id=p.organization_id AND m.principal_id=$1 AND m.lifecycle_status='active'\n        JOIN principals actor ON actor.principal_id=m.principal_id AND actor.lifecycle_status='active'\n        JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key\n        WHERE p.project_id=$2 AND p.lifecycle_status='active'\n          AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)\n          AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]\n          AND $3::timestamptz>clock_timestamp() AND $4::timestamptz<=clock_timestamp()+INTERVAL '60 seconds'\n        FOR UPDATE OF p FOR SHARE OF o,m,actor,r",
    reread:
      "SELECT p.organization_id, jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,p.project_id)::text AS __cloudmarkup_ordinary_authorization_key FROM projects p\n        JOIN organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'\n        JOIN memberships m ON m.organization_id=p.organization_id AND m.principal_id=$1 AND m.lifecycle_status='active'\n        JOIN principals actor ON actor.principal_id=m.principal_id AND actor.lifecycle_status='active'\n        JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key\n        WHERE p.project_id=$2 AND p.lifecycle_status='active'\n          AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)\n          AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]\n          AND $3::timestamptz>clock_timestamp() AND $4::timestamptz<=clock_timestamp()+INTERVAL '60 seconds'\n         ",
    parameterCount: 4,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: false,
    helperArguments: [
      { literal: "preview-resolve" },
      { valueIndex: 0 },
      { valueIndex: 1 },
      { valueIndex: 2 },
      { valueIndex: 3 },
      { literal: null },
    ],
  },
  {
    inventoryId: 3,
    sourceSha256:
      "f8b76a130674de67b89d279c45ebf0ded93366561518945ac69242dee6feaed3",
    name: "project_request_authorization",
    purpose: "preview-current",
    statement:
      "SELECT p.current_draft_id FROM projects p\n      JOIN organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'\n      JOIN principals actor ON actor.principal_id=$3 AND actor.lifecycle_status='active'\n      JOIN memberships m ON m.organization_id=p.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'\n      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key\n      WHERE p.organization_id=$1 AND p.project_id=$2 AND p.lifecycle_status='active'\n        AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)\n        AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]\n      FOR UPDATE OF p FOR SHARE OF o,actor,m,r",
    reread:
      "SELECT p.current_draft_id, jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,p.project_id)::text AS __cloudmarkup_ordinary_authorization_key FROM projects p\n      JOIN organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'\n      JOIN principals actor ON actor.principal_id=$3 AND actor.lifecycle_status='active'\n      JOIN memberships m ON m.organization_id=p.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'\n      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key\n      WHERE p.organization_id=$1 AND p.project_id=$2 AND p.lifecycle_status='active'\n        AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)\n        AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]\n       ",
    parameterCount: 3,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: false,
    helperArguments: [
      { literal: "preview-current" },
      { valueIndex: 0 },
      { valueIndex: 1 },
      { valueIndex: 2 },
      { literal: null },
      { literal: null },
    ],
  },
  {
    inventoryId: 6,
    sourceSha256:
      "b6fa63eba663fa10422437c17ea5ca3605675919a52d8c312fa0211f8cc9d978",
    name: "project_request_authorization",
    purpose: "preview-journal",
    statement:
      "SELECT 1 AS authorized FROM memberships m\n          JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'\n          JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'\n          JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key\n          JOIN projects pr ON pr.organization_id=m.organization_id AND pr.project_id=$2 AND pr.lifecycle_status='active'\n          WHERE m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active'\n            AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)\n            AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]\n          FOR SHARE OF m,p,o,r,pr",
    reread:
      "SELECT 1 AS authorized, jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,pr.project_id)::text AS __cloudmarkup_ordinary_authorization_key FROM memberships m\n          JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'\n          JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'\n          JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key\n          JOIN projects pr ON pr.organization_id=m.organization_id AND pr.project_id=$2 AND pr.lifecycle_status='active'\n          WHERE m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active'\n            AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)\n            AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]\n          ",
    parameterCount: 3,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: false,
    helperArguments: [
      { literal: "preview-journal" },
      { valueIndex: 0 },
      { valueIndex: 1 },
      { valueIndex: 2 },
      { literal: null },
      { literal: null },
    ],
  },
  {
    inventoryId: 7,
    sourceSha256:
      "2f7206789d8cad82af4f5887153d3dc8612262aacaaf9097d109b74a3e467ae5",
    name: "preview_ack_workflow",
    purpose: null,
    statement:
      "SELECT 1 FROM model_commercial_workflows\n            WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3\n              AND workflow_id=$4 AND scope_sha256=$5 FOR SHARE",
    reread:
      "SELECT locked_keys_json FROM cloudmarkup_ordinary_private.lock_preview_ack_workflow($1::text,$2::text,$3::text,$4::text,$5::text)",
    parameterCount: 5,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: false,
    helperArguments: [
      { valueIndex: 0 },
      { valueIndex: 1 },
      { valueIndex: 2 },
      { valueIndex: 3 },
      { valueIndex: 4 },
    ],
  },
  {
    inventoryId: 8,
    sourceSha256:
      "16608723af0ded22a13a3dc2096bd49c18e3659ecc06fb0f5df8928896b7768b",
    name: "billing_request_authorization",
    purpose: "billing-session",
    statement:
      "SELECT account.billing_account_id, account.organization_id,\n                account.lifecycle_status,\n                account.expensive_operations_enabled,\n                subscription.provider_customer_reference,\n                subscription.provider_subscription_reference AS current_subscription_reference,\n                subscription.normalized_status AS current_subscription_state\n         FROM memberships membership\n         JOIN principals principal\n           ON principal.principal_id = membership.principal_id\n         JOIN organizations organization\n           ON organization.organization_id = membership.organization_id\n         JOIN organization_roles role\n           ON role.organization_id = membership.organization_id\n          AND role.role_key = membership.role_key\n         JOIN organization_billing_accounts account\n           ON account.organization_id = membership.organization_id\n         LEFT JOIN organization_subscription_projections subscription\n           ON subscription.organization_id = account.organization_id\n          AND subscription.billing_account_id = account.billing_account_id\n          AND subscription.provider_environment = $4\n         WHERE membership.membership_id = $1\n           AND membership.principal_id = $2\n           AND membership.organization_id = $3\n           AND membership.lifecycle_status = 'active'\n           AND principal.lifecycle_status = 'active'\n           AND organization.lifecycle_status = 'active'\n           AND role.policy_version = 'authorization-v2'\n           AND 'billing.manage' = ANY(role.capabilities)\n         FOR UPDATE OF account FOR SHARE OF membership, principal, organization, role",
    reread:
      "SELECT account.billing_account_id, account.organization_id,\n                account.lifecycle_status,\n                account.expensive_operations_enabled,\n                subscription.provider_customer_reference,\n                subscription.provider_subscription_reference AS current_subscription_reference,\n                subscription.normalized_status AS current_subscription_state, jsonb_build_array(membership.organization_id,membership.principal_id,membership.membership_id,membership.role_key,account.billing_account_id)::text AS __cloudmarkup_ordinary_authorization_key FROM memberships membership\n         JOIN principals principal\n           ON principal.principal_id = membership.principal_id\n         JOIN organizations organization\n           ON organization.organization_id = membership.organization_id\n         JOIN organization_roles role\n           ON role.organization_id = membership.organization_id\n          AND role.role_key = membership.role_key\n         JOIN organization_billing_accounts account\n           ON account.organization_id = membership.organization_id\n         LEFT JOIN organization_subscription_projections subscription\n           ON subscription.organization_id = account.organization_id\n          AND subscription.billing_account_id = account.billing_account_id\n          AND subscription.provider_environment = $4\n         WHERE membership.membership_id = $1\n           AND membership.principal_id = $2\n           AND membership.organization_id = $3\n           AND membership.lifecycle_status = 'active'\n           AND principal.lifecycle_status = 'active'\n           AND organization.lifecycle_status = 'active'\n           AND role.policy_version = 'authorization-v2'\n           AND 'billing.manage' = ANY(role.capabilities)\n          ",
    parameterCount: 4,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: false,
    helperArguments: [
      { literal: "billing-session" },
      { valueIndex: 0 },
      { valueIndex: 1 },
      { valueIndex: 2 },
      { valueIndex: 3 },
    ],
  },
  {
    inventoryId: 12,
    sourceSha256:
      "5be0b0146c4394a7a5fadba09a272b0491c5fff91f1d595d9562c047fec0c5b2",
    name: "billing_request_authorization",
    purpose: "credit-top-up",
    statement:
      "SELECT a.billing_account_id FROM organization_billing_accounts a\n     JOIN memberships m ON m.organization_id=a.organization_id AND m.principal_id=$3 AND m.membership_id=$4 AND m.lifecycle_status='active'\n     JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'\n     JOIN organizations o ON o.organization_id=a.organization_id AND o.lifecycle_status='active'\n     JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2' AND 'billing.manage'=ANY(r.capabilities)\n     WHERE a.organization_id=$1 AND a.billing_account_id=$2 AND a.lifecycle_status='active'\n     FOR UPDATE OF a FOR SHARE OF m,p,o,r",
    reread:
      "SELECT a.billing_account_id, jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,a.billing_account_id)::text AS __cloudmarkup_ordinary_authorization_key FROM organization_billing_accounts a\n     JOIN memberships m ON m.organization_id=a.organization_id AND m.principal_id=$3 AND m.membership_id=$4 AND m.lifecycle_status='active'\n     JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'\n     JOIN organizations o ON o.organization_id=a.organization_id AND o.lifecycle_status='active'\n     JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2' AND 'billing.manage'=ANY(r.capabilities)\n     WHERE a.organization_id=$1 AND a.billing_account_id=$2 AND a.lifecycle_status='active'\n      ",
    parameterCount: 4,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: false,
    helperArguments: [
      { literal: "credit-top-up" },
      { valueIndex: 0 },
      { valueIndex: 1 },
      { valueIndex: 2 },
      { valueIndex: 3 },
    ],
  },
  {
    inventoryId: 15,
    sourceSha256:
      "15dffd0e3f63e8ba490f7a51fcc803daa8e6f84a87bf9ce5e6fcb1cb037b3a73",
    name: "project_request_authorization",
    purpose: "hosted-validation",
    statement:
      "SELECT m.role_key\n    FROM memberships m\n    JOIN principals u ON u.principal_id = m.principal_id AND u.lifecycle_status = 'active'\n    JOIN organizations o ON o.organization_id = m.organization_id AND o.lifecycle_status = 'active'\n    JOIN organization_roles r ON r.organization_id = m.organization_id AND r.role_key = m.role_key AND r.policy_version = 'authorization-v2'\n    JOIN projects p ON p.organization_id = m.organization_id AND p.project_id = $4 AND p.lifecycle_status = 'active'\n    WHERE m.membership_id = $1 AND m.principal_id = $2 AND m.organization_id = $3 AND m.lifecycle_status = 'active'\n    FOR SHARE OF m, u, o, r, p",
    reread:
      "SELECT m.role_key, jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,p.project_id)::text AS __cloudmarkup_ordinary_authorization_key FROM memberships m\n    JOIN principals u ON u.principal_id = m.principal_id AND u.lifecycle_status = 'active'\n    JOIN organizations o ON o.organization_id = m.organization_id AND o.lifecycle_status = 'active'\n    JOIN organization_roles r ON r.organization_id = m.organization_id AND r.role_key = m.role_key AND r.policy_version = 'authorization-v2'\n    JOIN projects p ON p.organization_id = m.organization_id AND p.project_id = $4 AND p.lifecycle_status = 'active'\n    WHERE m.membership_id = $1 AND m.principal_id = $2 AND m.organization_id = $3 AND m.lifecycle_status = 'active'\n    ",
    parameterCount: 4,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: false,
    helperArguments: [
      { literal: "hosted-validation" },
      { valueIndex: 0 },
      { valueIndex: 1 },
      { valueIndex: 2 },
      { valueIndex: 3 },
      { literal: null },
    ],
  },
  {
    inventoryId: 16,
    sourceSha256:
      "9bed57ca6a70f25cad295fafee7e5559e47a02bcecfc6c8b4d75ca97de90e1a6",
    name: "organization_policy_membership",
    purpose: "invitation-issuer",
    statement:
      "SELECT m.membership_id,m.role_key,r.capabilities,o.workspace_kind\n      FROM memberships m JOIN principals p ON p.principal_id=m.principal_id\n      JOIN organizations o ON o.organization_id=m.organization_id\n      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key\n      WHERE m.organization_id=$1 AND m.principal_id=$2 AND m.lifecycle_status='active'\n        AND p.lifecycle_status='active' AND o.lifecycle_status='active'\n        AND r.policy_version='authorization-v2'\n        AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)\n      FOR SHARE OF m,p,o,r",
    reread:
      "SELECT m.membership_id,m.role_key,r.capabilities,o.workspace_kind, jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key)::text AS __cloudmarkup_ordinary_authorization_key FROM memberships m JOIN principals p ON p.principal_id=m.principal_id\n      JOIN organizations o ON o.organization_id=m.organization_id\n      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key\n      WHERE m.organization_id=$1 AND m.principal_id=$2 AND m.lifecycle_status='active'\n        AND p.lifecycle_status='active' AND o.lifecycle_status='active'\n        AND r.policy_version='authorization-v2'\n        AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)\n      ",
    parameterCount: 2,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: false,
    helperArguments: [
      { literal: "invitation-issuer" },
      { valueIndex: 0 },
      { valueIndex: 1 },
    ],
  },
  {
    inventoryId: 17,
    sourceSha256:
      "d7185319fa66d8d2497db8f01f725e52145a312202b398658a0f5926f31d4645",
    name: "organization_policy_membership",
    purpose: "invitation-target",
    statement:
      "SELECT m.membership_id,m.role_key,m.lifecycle_status,to_jsonb(m)->>'end_reason' AS end_reason FROM memberships m\n      JOIN organization_roles role ON role.organization_id=m.organization_id AND role.role_key=m.role_key\n      WHERE m.organization_id=$1 AND m.principal_id=$2 AND role.policy_version='authorization-v2'\n        AND role.capabilities=cloudmarkup_authorization_v2_permissions(role.role_key)\n      FOR SHARE OF m,role",
    reread:
      "SELECT m.membership_id,m.role_key,m.lifecycle_status,to_jsonb(m)->>'end_reason' AS end_reason, jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key)::text AS __cloudmarkup_ordinary_authorization_key FROM memberships m\n      JOIN organization_roles role ON role.organization_id=m.organization_id AND role.role_key=m.role_key\n      WHERE m.organization_id=$1 AND m.principal_id=$2 AND role.policy_version='authorization-v2'\n        AND role.capabilities=cloudmarkup_authorization_v2_permissions(role.role_key)\n      ",
    parameterCount: 2,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: false,
    helperArguments: [
      { literal: "invitation-target" },
      { valueIndex: 0 },
      { valueIndex: 1 },
    ],
  },
  {
    inventoryId: 19,
    sourceSha256:
      "aa82e31a7d6ac03cb0fce4ebb063ba205935873c4f1badea854bc8d064bf0a2f",
    name: "organization_policy_membership",
    purpose: "member-view",
    statement:
      "SELECT m.*,p.display_name,p.public_username,p.lifecycle_status AS principal_status,\n  to_char(m.joined_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS joined_iso,\n  to_char(m.ended_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS ended_iso FROM memberships m JOIN principals p ON p.principal_id=m.principal_id\n  JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key WHERE m.organization_id=$1 AND m.principal_id=$2 AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key) FOR SHARE OF m,r",
    reread:
      "SELECT m.*,p.display_name,p.public_username,p.lifecycle_status AS principal_status,\n  to_char(m.joined_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS joined_iso,\n  to_char(m.ended_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS ended_iso, jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key)::text AS __cloudmarkup_ordinary_authorization_key FROM memberships m JOIN principals p ON p.principal_id=m.principal_id\n  JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key WHERE m.organization_id=$1 AND m.principal_id=$2 AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key) ",
    parameterCount: 2,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: false,
    helperArguments: [
      { literal: "member-view" },
      { valueIndex: 0 },
      { valueIndex: 1 },
    ],
  },
  {
    inventoryId: 20,
    sourceSha256:
      "2d944b7400c92808539d21f1ed1ac742b76e4d62c2d0cd5dacc442519467203e",
    name: "project_request_authorization",
    purpose: "editing-lease",
    statement:
      "SELECT project.organization_id, project.current_draft_id, m.membership_id, m.role_key,\n    to_json(r.capabilities)::text AS capabilities_json\n    FROM projects project\n    JOIN organizations o ON o.organization_id=project.organization_id AND o.lifecycle_status='active'\n    JOIN memberships m ON m.organization_id=o.organization_id AND m.principal_id=$1 AND m.lifecycle_status='active'\n    JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'\n    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'\n    WHERE project.project_id=$2 AND project.lifecycle_status='active'\n    FOR UPDATE OF project FOR SHARE OF m,p,o,r",
    reread:
      "SELECT project.organization_id, project.current_draft_id, m.membership_id, m.role_key,\n    to_json(r.capabilities)::text AS capabilities_json, jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,project.project_id)::text AS __cloudmarkup_ordinary_authorization_key FROM projects project\n    JOIN organizations o ON o.organization_id=project.organization_id AND o.lifecycle_status='active'\n    JOIN memberships m ON m.organization_id=o.organization_id AND m.principal_id=$1 AND m.lifecycle_status='active'\n    JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'\n    JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'\n    WHERE project.project_id=$2 AND project.lifecycle_status='active'\n     ",
    parameterCount: 2,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: false,
    helperArguments: [
      { literal: "editing-lease" },
      { valueIndex: 0 },
      { valueIndex: 1 },
      { literal: null },
      { literal: null },
      { literal: null },
    ],
  },
  {
    inventoryId: 21,
    sourceSha256:
      "475eef3a31bb0375faeb04c34c44a2efc0b56bb94e105f57deabfd5882ec5704",
    name: "request_membership",
    purpose: null,
    statement:
      "SELECT m.membership_id, m.role_key\n       FROM memberships m\n       JOIN principals principal_record\n         ON principal_record.principal_id = m.principal_id\n        AND principal_record.lifecycle_status = 'active'\n       JOIN organizations o\n         ON o.organization_id = m.organization_id\n        AND o.lifecycle_status = 'active'\n       JOIN organization_roles r\n        ON r.organization_id = m.organization_id\n        AND r.role_key = m.role_key\n        AND r.policy_version = 'authorization-v2'\n       WHERE \n  m.membership_id = $1\n  AND m.principal_id = $2\n  AND m.organization_id = $3\n  AND m.lifecycle_status = 'active'\n\n       FOR SHARE OF m, principal_record, o, r",
    reread:
      "SELECT m.membership_id, m.role_key, m.membership_id::text AS __cloudmarkup_ordinary_authorization_key FROM memberships m\n       JOIN principals principal_record\n         ON principal_record.principal_id = m.principal_id\n        AND principal_record.lifecycle_status = 'active'\n       JOIN organizations o\n         ON o.organization_id = m.organization_id\n        AND o.lifecycle_status = 'active'\n       JOIN organization_roles r\n        ON r.organization_id = m.organization_id\n        AND r.role_key = m.role_key\n        AND r.policy_version = 'authorization-v2'\n       WHERE \n  m.membership_id = $1\n  AND m.principal_id = $2\n  AND m.organization_id = $3\n  AND m.lifecycle_status = 'active'\n\n       ",
    parameterCount: 3,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: false,
    helperArguments: [{ valueIndex: 1 }, { valueIndex: 2 }],
  },
  {
    inventoryId: 22,
    sourceSha256:
      "93398b168ac439671412a19b3655d4f5457feb9b8526d0681dc906ea16f39614",
    name: "project_request_authorization",
    purpose: "approved-package",
    statement:
      "SELECT m.membership_id, m.role_key, to_json(r.capabilities)::text AS capabilities_json\n       FROM memberships m\n       JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'\n       JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'\n       JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'\n       JOIN projects project ON project.organization_id=m.organization_id AND project.project_id=$3 AND project.lifecycle_status='active'\n       WHERE m.principal_id=$1 AND m.organization_id=$2 AND m.lifecycle_status='active'\n       FOR SHARE OF m, p, o, r, project",
    reread:
      "SELECT m.membership_id, m.role_key, to_json(r.capabilities)::text AS capabilities_json, jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,project.project_id)::text AS __cloudmarkup_ordinary_authorization_key FROM memberships m\n       JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'\n       JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'\n       JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'\n       JOIN projects project ON project.organization_id=m.organization_id AND project.project_id=$3 AND project.lifecycle_status='active'\n       WHERE m.principal_id=$1 AND m.organization_id=$2 AND m.lifecycle_status='active'\n       ",
    parameterCount: 3,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: false,
    helperArguments: [
      { literal: "approved-package" },
      { valueIndex: 0 },
      { valueIndex: 1 },
      { valueIndex: 2 },
      { literal: null },
      { literal: null },
    ],
  },
  {
    inventoryId: 23,
    sourceSha256:
      "b6d2b7f0448ebb25b0d0c42c92d2aa77521749f1a77a0816e260fcdd775b50d4",
    name: "project_request_authorization",
    purpose: "active-project-lookup",
    statement:
      "\n      WITH authorized_project AS MATERIALIZED (\n        SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2\n          AND lifecycle_status='active' FOR SHARE\n      ), authorized_membership AS MATERIALIZED (\n        SELECT m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json\n        FROM authorized_project project\n        JOIN memberships m ON m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active'\n        JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'\n        JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'\n        JOIN organization_roles r ON r.organization_id=m.organization_id\n          AND r.role_key=m.role_key AND r.policy_version='authorization-v2'\n        FOR SHARE OF m,p,o,r\n      )\n      SELECT $4::timestamptz > clock_timestamp() AS authenticated,\n        m.membership_id,m.role_key,m.capabilities_json\n      FROM (SELECT 1) anchor LEFT JOIN authorized_membership m ON TRUE\n      ",
    reread:
      "\n      WITH authorized_project AS MATERIALIZED (\n        SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2\n          AND lifecycle_status='active' \n      ), authorized_membership AS MATERIALIZED (\n        SELECT m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json\n        FROM authorized_project project\n        JOIN memberships m ON m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active'\n        JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'\n        JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'\n        JOIN organization_roles r ON r.organization_id=m.organization_id\n          AND r.role_key=m.role_key AND r.policy_version='authorization-v2'\n        \n      )\n      SELECT $4::timestamptz > clock_timestamp() AS authenticated,\n        m.membership_id,m.role_key,m.capabilities_json, CASE WHEN m.membership_id IS NULL THEN NULL ELSE jsonb_build_array($1::text,$2::text,$3::text,m.membership_id,m.role_key)::text END AS __cloudmarkup_ordinary_authorization_key\n      FROM (SELECT 1) anchor LEFT JOIN authorized_membership m ON TRUE\n      ",
    parameterCount: 4,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: true,
    helperArguments: [
      { literal: "active-project-lookup" },
      { valueIndex: 0 },
      { valueIndex: 1 },
      { valueIndex: 2 },
      { valueIndex: 3 },
      { literal: null },
    ],
  },
  {
    inventoryId: 24,
    sourceSha256:
      "f69cd9cd2d3133648a05ad9a822e2882580c9bf540340fe321ef5da57bdd4bec",
    name: "project_request_authorization",
    purpose: "active-project-lookup",
    statement:
      "\n      WITH authorized_project AS MATERIALIZED (\n        SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2\n          AND lifecycle_status='active' FOR SHARE\n      ), authorized_membership AS MATERIALIZED (\n        SELECT m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json\n        FROM authorized_project project\n        JOIN memberships m ON m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active'\n        JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'\n        JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'\n        JOIN organization_roles r ON r.organization_id=m.organization_id\n          AND r.role_key=m.role_key AND r.policy_version='authorization-v2'\n        FOR SHARE OF m,p,o,r\n      )\n      SELECT $4::timestamptz > clock_timestamp() AS authenticated,\n        m.membership_id,m.role_key,m.capabilities_json, CASE WHEN s.object_id IS NULL THEN NULL ELSE row_to_json(s)::text END AS object_json\n      FROM (SELECT 1) anchor LEFT JOIN authorized_membership m ON TRUE\n      LEFT JOIN stored_objects s ON m.membership_id IS NOT NULL AND s.organization_id=$1 AND s.project_id=$2 AND s.object_id=$5",
    reread:
      "\n      WITH authorized_project AS MATERIALIZED (\n        SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2\n          AND lifecycle_status='active' \n      ), authorized_membership AS MATERIALIZED (\n        SELECT m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json\n        FROM authorized_project project\n        JOIN memberships m ON m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active'\n        JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'\n        JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'\n        JOIN organization_roles r ON r.organization_id=m.organization_id\n          AND r.role_key=m.role_key AND r.policy_version='authorization-v2'\n        \n      )\n      SELECT $4::timestamptz > clock_timestamp() AS authenticated,\n        m.membership_id,m.role_key,m.capabilities_json, CASE WHEN m.membership_id IS NULL THEN NULL ELSE jsonb_build_array($1::text,$2::text,$3::text,m.membership_id,m.role_key)::text END AS __cloudmarkup_ordinary_authorization_key, CASE WHEN s.object_id IS NULL THEN NULL ELSE row_to_json(s)::text END AS object_json\n      FROM (SELECT 1) anchor LEFT JOIN authorized_membership m ON TRUE\n      LEFT JOIN stored_objects s ON m.membership_id IS NOT NULL AND s.organization_id=$1 AND s.project_id=$2 AND s.object_id=$5",
    parameterCount: 5,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: true,
    helperArguments: [
      { literal: "active-project-lookup" },
      { valueIndex: 0 },
      { valueIndex: 1 },
      { valueIndex: 2 },
      { valueIndex: 3 },
      { literal: null },
    ],
  },
  {
    inventoryId: 34,
    sourceSha256:
      "a0e28e41157c72a558cbfd31b477d22d598ec22116421ab1f7edbc2bc6c9e1a5",
    name: "request_membership",
    purpose: null,
    statement:
      "SELECT m.membership_id, m.role_key, to_json(r.capabilities)::text AS capabilities_json FROM memberships m\n       JOIN principals p ON p.principal_id = m.principal_id AND p.lifecycle_status = 'active'\n       JOIN organizations o ON o.organization_id = m.organization_id AND o.lifecycle_status = 'active'\n       JOIN organization_roles r ON r.organization_id = m.organization_id AND r.role_key = m.role_key AND r.policy_version = 'authorization-v2'\n       WHERE m.principal_id = $1 AND m.organization_id = $2 AND m.lifecycle_status = 'active'\n       FOR SHARE OF m, p, o, r",
    reread:
      "SELECT m.membership_id, m.role_key, to_json(r.capabilities)::text AS capabilities_json, m.membership_id::text AS __cloudmarkup_ordinary_authorization_key FROM memberships m\n       JOIN principals p ON p.principal_id = m.principal_id AND p.lifecycle_status = 'active'\n       JOIN organizations o ON o.organization_id = m.organization_id AND o.lifecycle_status = 'active'\n       JOIN organization_roles r ON r.organization_id = m.organization_id AND r.role_key = m.role_key AND r.policy_version = 'authorization-v2'\n       WHERE m.principal_id = $1 AND m.organization_id = $2 AND m.lifecycle_status = 'active'\n       ",
    parameterCount: 2,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: false,
    helperArguments: [{ valueIndex: 0 }, { valueIndex: 1 }],
  },
  {
    inventoryId: 35,
    sourceSha256:
      "3352043d62d44f7c0ac7c3767cd8f3d7f428adfe2246af6482dff1de893e4753",
    name: "request_membership",
    purpose: null,
    statement:
      "SELECT m.role_key FROM memberships m\n       JOIN principals u ON u.principal_id = m.principal_id AND u.lifecycle_status = 'active'\n       JOIN organizations o ON o.organization_id = m.organization_id AND o.lifecycle_status = 'active'\n       JOIN organization_roles r ON r.organization_id = m.organization_id AND r.role_key = m.role_key AND r.policy_version = 'authorization-v2'\n       WHERE m.principal_id = $1 AND m.organization_id = $2 AND m.lifecycle_status = 'active'\n       FOR SHARE OF m, u, o, r",
    reread:
      "SELECT m.role_key, m.membership_id::text AS __cloudmarkup_ordinary_authorization_key FROM memberships m\n       JOIN principals u ON u.principal_id = m.principal_id AND u.lifecycle_status = 'active'\n       JOIN organizations o ON o.organization_id = m.organization_id AND o.lifecycle_status = 'active'\n       JOIN organization_roles r ON r.organization_id = m.organization_id AND r.role_key = m.role_key AND r.policy_version = 'authorization-v2'\n       WHERE m.principal_id = $1 AND m.organization_id = $2 AND m.lifecycle_status = 'active'\n       ",
    parameterCount: 2,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["api"],
    nullableAnchor: false,
    helperArguments: [{ valueIndex: 0 }, { valueIndex: 1 }],
  },
  {
    inventoryId: 41,
    sourceSha256:
      "9720a02e3896978c99a17b9dbc9e813c559848d86d20e61a5c7f5df05c0b50d3",
    name: "export_initial_claim_authorization",
    purpose: null,
    statement:
      "SELECT m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json,\n      j.created_by_principal_id AS actor_id,j.correlation_id,j.record_version,\n      x.record_version AS run_record_version,\n      j.lifecycle_status AS root_state,x.lifecycle_status AS run_state,\n      j.attempt_count,j.interaction_state,\n      j.cancellation_requested_at IS NOT NULL AS root_canceled,\n      x.cancellation_requested_at IS NOT NULL AS run_canceled,\n      j.input_sha256,\n      to_char(COALESCE((SELECT a.retry_not_before FROM async_job_attempts a\n        WHERE a.organization_id=j.organization_id AND a.job_id=j.job_id\n          AND a.attempt_number=j.attempt_count AND a.lifecycle_status IN ('failed','orphaned')\n          AND a.retry_disposition='retry'),j.queued_at)\n        AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS queued_at\n     FROM solution_export_runs x\n     JOIN async_jobs j ON j.organization_id=x.organization_id AND j.project_id=x.project_id\n       AND j.job_id=x.root_job_id AND j.job_id=x.solution_export_run_id\n     JOIN principals actor ON actor.principal_id=x.created_by_principal_id AND actor.lifecycle_status='active'\n     JOIN memberships m ON m.organization_id=x.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'\n     JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'\n     JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'\n     WHERE x.organization_id=$1 AND x.project_id=$2 AND x.solution_export_run_id=$3\n       AND j.root_job_id=j.job_id AND j.parent_job_id IS NULL\n       AND j.family='solution-export-orchestration' AND j.subject_kind='solution-revision'\n       AND j.created_by_actor_kind='principal' AND j.idempotency_scope='solution-export-jobs.create'\n       AND j.created_by_principal_id=x.created_by_principal_id AND j.idempotency_actor_id=x.created_by_principal_id\n       AND j.solution_revision_id=x.solution_revision_id\n       AND j.solution_manifest_record_id=x.solution_manifest_record_id AND j.solution_manifest_sha256=x.solution_manifest_sha256\n       AND j.environment_type=x.environment_type AND j.environment_id IS NOT DISTINCT FROM x.environment_id\n       AND j.input_object_id=x.orchestration_input_object_id AND j.input_sha256=x.orchestration_input_sha256\n       AND j.entitlement_decision_reference=x.entitlement_decision_reference\n     FOR SHARE OF x,actor,m,o,r",
    reread:
      "SELECT m.membership_id,m.role_key,to_json(r.capabilities)::text AS capabilities_json,\n      j.created_by_principal_id AS actor_id,j.correlation_id,j.record_version,\n      x.record_version AS run_record_version,\n      j.lifecycle_status AS root_state,x.lifecycle_status AS run_state,\n      j.attempt_count,j.interaction_state,\n      j.cancellation_requested_at IS NOT NULL AS root_canceled,\n      x.cancellation_requested_at IS NOT NULL AS run_canceled,\n      j.input_sha256,\n      to_char(COALESCE((SELECT a.retry_not_before FROM async_job_attempts a\n        WHERE a.organization_id=j.organization_id AND a.job_id=j.job_id\n          AND a.attempt_number=j.attempt_count AND a.lifecycle_status IN ('failed','orphaned')\n          AND a.retry_disposition='retry'),j.queued_at)\n        AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS queued_at, jsonb_build_array(m.organization_id,m.principal_id,m.membership_id,m.role_key,x.project_id,x.solution_export_run_id)::text AS __cloudmarkup_ordinary_authorization_key FROM solution_export_runs x\n     JOIN async_jobs j ON j.organization_id=x.organization_id AND j.project_id=x.project_id\n       AND j.job_id=x.root_job_id AND j.job_id=x.solution_export_run_id\n     JOIN principals actor ON actor.principal_id=x.created_by_principal_id AND actor.lifecycle_status='active'\n     JOIN memberships m ON m.organization_id=x.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'\n     JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'\n     JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'\n     WHERE x.organization_id=$1 AND x.project_id=$2 AND x.solution_export_run_id=$3\n       AND j.root_job_id=j.job_id AND j.parent_job_id IS NULL\n       AND j.family='solution-export-orchestration' AND j.subject_kind='solution-revision'\n       AND j.created_by_actor_kind='principal' AND j.idempotency_scope='solution-export-jobs.create'\n       AND j.created_by_principal_id=x.created_by_principal_id AND j.idempotency_actor_id=x.created_by_principal_id\n       AND j.solution_revision_id=x.solution_revision_id\n       AND j.solution_manifest_record_id=x.solution_manifest_record_id AND j.solution_manifest_sha256=x.solution_manifest_sha256\n       AND j.environment_type=x.environment_type AND j.environment_id IS NOT DISTINCT FROM x.environment_id\n       AND j.input_object_id=x.orchestration_input_object_id AND j.input_sha256=x.orchestration_input_sha256\n       AND j.entitlement_decision_reference=x.entitlement_decision_reference\n     ",
    parameterCount: 3,
    identityColumn: "__cloudmarkup_ordinary_authorization_key",
    hosts: ["export"],
    nullableAnchor: false,
    helperArguments: [{ valueIndex: 0 }, { valueIndex: 1 }, { valueIndex: 2 }],
  },
] as const;

/** Dedicated executor alias; the central registry consumes LockReads only with
 * the reviewed reread/nullable-anchor contract extension. */
export const ordinaryAuthorizationLocks = ordinaryAuthorizationLockReads;
