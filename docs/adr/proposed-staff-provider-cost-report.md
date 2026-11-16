# Organization-scoped staff provider-cost reporting

- **Status:** Proposed; restricted staff audience approved, native and release
  admission pending
- **Date:** 2026-11-11
- **Owners:** Cloud Markup product and platform
- **Supersedes:** None

## Context

The retained provider-usage projection is internal accounting evidence. Customer
credit summaries intentionally exclude provider costs. The existing staff table
authorizes principals globally, so adding a permission alone cannot implement
access for explicitly authorized staff of a particular organization.

The
[refactor plan](../roadmap/plans/repository-local-simplification-20261109.md)
tracks implementation and incomplete qualification. The canonical operator and
staff-session rules in [ADR-0081](0081-live-billing-and-platform-staff.md)
remain.

## Proposed implementation

Require both explicit `provider-costs.read` permission and an active grant for
the exact organization. No existing permission or organization membership
implies either grant. The server derives the principal from verified context,
rechecks its current session, and resolves the requested organization through
canonical grant rows. A route parameter only selects the requested target.

Migration 0141 adds organization grants pinned to the global staff authorization
version, plus immutable authorization events. Changing the global grant
invalidates old organization grants until explicitly reviewed again. The
existing operator preview/apply path gains `staff-cost-authorize` and
`staff-cost-revoke`, each requiring one `--organization-id`; global
`staff-authorize` must explicitly include `provider-costs.read`. No default
grant or HTTP enrollment is added. Failed/uncertain operator acknowledgements
require state inspection and a fresh preview, not blind mutation retries.

The report owner uses separate short authorization transactions before and after
each repeatable-read/read-only page. Canonical session locking remains outside
the cost transaction. Permission and organization-grant reads are SELECT-only;
report access adds no permission to update authorization records. Both grant
versions must remain equal at final authorization. A global revocation/regrant
does not revive an old organization grant.

The dedicated validated response exposes bounded accounting status, counts,
original pricing pins and page-level completeness. Provider request identifiers,
architecture content, prompts and responses are omitted. Cursors bind the
organization and exact cohort but do not confer authority. Every page is
authorized again. API no-store headers and ephemeral actor/organization-bound UI
state prevent a shared report cache. Page sums are not promised to be one
point-in-time cohort expenditure.

Reading a report performs no account initialization, provider request, financial
mutation or evidence cleanup. Customer summaries, original prices, reservation
caps, refunds and retained financial records are unchanged. Public local-owner
configuration does not enroll staff or bind the hosted report owner.

## Consequences and alternatives

The two explicit grants and reauthorization add operator work and database
reads. Global staff-permission changes require reviewing organization grants
again. Broad `accounts.read` access, customer ownership, email/JWT allowlists
and client-supplied authority tags would exceed the approved audience. A new
report service or global role is unnecessary for this bounded existing owner.

The migration is additive; historical migration files and financial records stay
unchanged. Ordinary-role SELECT deltas remain an unapplied proposal. Native
transactions, revocation ordering, denied mutation attempts, restore and exact
source-pair admission are required. Rollback can unbind report routing while
preserving new audit/evidence records; it must not silently remove their schema.

No retention duration or deletion is selected. A tentative thirty-day suggestion
does not govern unique usage, pending recovery or canonical audit/financial
evidence. Operational checkpoint persistence and any future retirement rule need
verified completion, holds, CAS/replay and restore admission under the existing
[data policy](../architecture/DATA_CLASSIFICATION_RETENTION_AND_DELETION.md).
Native role grants and live staff enrollment require separate reviewed actions.

## Verification

Focused fixtures cover customer/accounts.read denial, revoked sessions and
permissions, organization substitution, continuation binding, mid-read
revocation, read-only query separation, exact scoped operator previews and
atomic audit failure. HTTP and staff UI checks protect no-store and incomplete
cost presentation. These tests use doubles; they do not certify PostgreSQL role
permissions, browser multi-tab behavior, production activation or legal periods.
