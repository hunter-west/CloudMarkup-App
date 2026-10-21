# Proposed: independent audited staff trial access

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Proposed
- **Date:** 2026-10-06
- **Owners:** Cloud Markup product and platform
- **Supersedes:** None; extends ADR-0081's explicitly excluded temporary access

## Context

Staff need bounded evaluation access for an unsubscribed organization.
Complimentary credits currently require an active paid plan. Forging a
subscription or globally enabling operations would confuse payment authority
with trial access.

## Decision under review

Create a separate version-1 staff trial and a promotional ledger grant in one
transaction with the immutable staff receipt. A dedicated immutable trial
profile copies every feature and limit from Professional version
planver_pro_2026_09_30_v5: manual work, beta AI, Terraform/CloudFormation and
repository exports, team sharing, 25 projects, 10 members and two concurrent AI
jobs. The owner selected the full paid feature set. Runtime activation and
customer infrastructure deployment boundaries remain unchanged. Credit
purchases, recurring allowances and provider trial configuration stay separate.

Use separate canonical trials.grant and trials.revoke permissions; existing
staff gain neither automatically. Require a current session, recent
authentication, exact account confirmation, ETag, same-origin writes, bounded
reason and actor-bound idempotency. Self-trials use the same rules. Provisional
bounds are one lifetime grant per billing account, 1–30 days and 1–1,000
credits. No extension, refill or automatic paid conversion exists.

The paid subscription projection is never changed by a trial command. The shared
effective entitlement projection may select the independent trial profile while
the organization is unsubscribed/canceled. Nonactive paid observations preserve
the trial projection; active paid reconciliation replaces it with its own
verified evidence. Trial credits cannot fund paid operations and paid credits
cannot extend the trial budget. Paid conversion supersedes trial admission;
cancellation cannot revive it.

Expiry is evaluated against the database clock (half-open start/expiry interval)
on every new reservation, undispatched claim, export stage and invitation
admission. Export decisions pin independent trial identity/expiry while their
paid subscription evidence remains empty; expiry has no paid grace policy.
Revocation retains the original grant, debits its available unreserved credits
through a compensating ledger entry, disables only its own effective projection,
and permanently makes remaining trial credits ineligible even after release.
Reserved work already dispatched settles with its original pricing; queued work
fails before dispatch. Revocation/expiry never changes paid grants or access.
The immutable grant receipt records expiry; derived expired state requires no
cleanup job to enforce it.

## Consequences and alternatives

Separate provenance preserves payment authority and auditability, at the cost of
a dedicated trial profile, grant filters and dispatch checks. Reusing Stripe
trials or manufacturing an active subscription is rejected. A global credit
counter loses allocation and settlement evidence. Automatic renewals/refills
invite unbounded spend and are deferred. Larger caps or repeat grants require a
successor reviewed policy.

The additive migration preserves historical bytes and creates no account grant
or permission. Existing v1 paid fields retain meaning; staff commands and
optional trial detail are additive. Runtime release must apply the schema before
admitting trial commands. Disable trial admission to roll back; preserve
terminal settlement and historical receipts. Retain a manifest/migrator that
recognizes the full applied history and guards, or use a reviewed forward fix.
Replaying a pre-trial 0096 assembly after this migration is incompatible with
its older manifest; no down migration is permitted. Allocation and beta dispatch
triggers deny trial use by an older runtime after rollback. Local verification
and this proposal authorize no production migration, staff bootstrap, balance
change or deployment.

## References

- Execution plan
- [Paid and staff authority](0081-live-billing-and-platform-staff.md)
- [Billing architecture](../architecture/BILLING_AND_USAGE.md)
- [Commercial model](../product/COMMERCIAL_MODEL.md)

Existing paid requests and responses retain their fields and semantics. Older
staff clients with closed v1 enums/strict objects intentionally refuse the new
trial commands, permissions and trial history; reload the matching web release
before using trial administration. No compatibility fallback may interpret a
trial as a paid subscription.
