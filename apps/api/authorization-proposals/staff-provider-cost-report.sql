-- UNAPPLIED delta for the existing API service owner. No role membership or
-- operator grant is activated by this file. Native ordinary-role proof required.
GRANT SELECT (record_version) ON TABLE public.platform_staff_authorizations TO cloudmarkup_beta_api_runtime;
GRANT SELECT (principal_id,organization_id,staff_authorization_version,record_version,revoked_at)
 ON TABLE public.platform_staff_provider_cost_authorizations TO cloudmarkup_beta_api_runtime;
-- The report reuses existing API pricing/reservation/ledger SELECT columns and
-- the observation SELECT additions in beta-ai-usage-evidence.sql. No SELECT *,
-- SECURITY DEFINER, BYPASSRLS, DELETE, staff-enrollment or financial-write grant.
-- Scope grants/revocations use only the existing separately authorized audited
-- operator path; the HTTP reporting owner cannot create or alter staff grants.
