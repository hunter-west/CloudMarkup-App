# Data classification, retention, and deletion

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

## Status and authority

This document is the controlled-beta engineering policy for classifying Cloud
Markup data and for preventing accidental disclosure or deletion. It does not
invent legal, tax, contractual, privacy-notice, litigation-hold, or
accounting-retention requirements. Exact business/legal retention periods,
regional requirements, backup erasure objectives, and customer communication
remain approval blockers recorded below.

The owner has resolved the beta project-content choice: erase active project
content immediately through verified cleanup, with backups expiring under their
configured retention. This does not resolve account-wide or production minimum
metadata-retention periods.

A controlled beta is deployed; its exact verified release is recorded in
[Project Status](../PUBLIC_STATUS.md). Deployment does not approve the
business/legal retention periods or deletion objectives below. Synthesized and
deployed engineering defaults are not approved legal-retention periods.

Related documents:

- Controlled-beta Threat Model
- [Security Principles](SECURITY_PRINCIPLES.md)
- [Authorization Model](AUTHORIZATION_MODEL.md)
- [Solution, Repository, and Continuous-Evidence Contracts](SOLUTION_REPOSITORY_AND_EVIDENCE.md)
- [Billing and Usage](BILLING_AND_USAGE.md)
- [AWS Platform Deployment](AWS_PLATFORM_DEPLOYMENT.md)

## Protection levels

| Level                   | Meaning                                                                                                                                                                              | Baseline handling                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `restricted-secret`     | A credential, signing key, token, card detail, raw state/plan sensitive value, or other value that can grant authority or cause material disclosure.                                 | Never enter ordinary application data, source, fixtures, prompts, logs, Evidence, exports, support cases, or analytics. Resolve through an approved secret/credential boundary only.       |
| `restricted-content`    | Raw prompt/model content, private repository/source bodies, unrestricted architecture/application bodies, or diagnostic bytes whose disclosure could expose customer intent or code. | Minimum-purpose access, tenant/project scope, encryption, no normal logging/analytics, no customer-safe projection unless explicitly reviewed, and no default raw model-content retention. |
| `customer-confidential` | Tenant-owned account, source-document, contract, generated, diagram, artifact, or Evidence content intended for authorized members and approved exports.                             | Verify tenant/object authorization on every access; encrypt transport/storage; redact telemetry; integrity-bind exports; apply project/account deletion workflow.                          |
| `sensitive-operational` | Usage, billing identifiers, audit, reconciliation, provenance, safe plan/drift summaries, security findings, and operational metadata.                                               | Narrow role/field access, append-only or immutable where required, safe identifiers/digests, no unrestricted bodies, explicit retention and legal review.                                  |
| `internal`              | Non-customer configuration, policy versions, build/tool pins, safe aggregate metrics, and operational documentation.                                                                 | Least-privilege staff access; may not contain a secret or unrestricted tenant content.                                                                                                     |
| `public-reviewed`       | Content intentionally approved for public distribution, such as product documentation and released schema/catalog metadata.                                                          | Integrity/version review before publication; no customer or secret data.                                                                                                                   |

Encoding, hashing, or calling an identifier “metadata” does not lower its
classification automatically. A hash that enables correlation, a provider ID, or
an opaque object key may remain sensitive operational data.

## Prohibited normal-log and export content

Normal logs, metrics, traces, dashboards, audit summaries, support cases,
Evidence, diagrams, and standard solution exports must not contain:

- cloud credentials, private keys, passwords, API keys, signing secrets,
  authorization headers, session/access/installation tokens, or signed URLs;
- Stripe secret values, webhook signatures, raw webhook bodies, card numbers,
  card verification data, or payment-method details;
- raw model prompts, raw provider/model responses, protected reasoning, or
  unrestricted repair diagnostics;
- unrestricted private repository content or user-owned application source;
- Terraform state, plaintext saved plans, plan before/after values, provider
  configuration, sensitive outputs, or unredacted change-set values; or
- unrestricted Architecture, Workload, Solution, contract, diagram, artifact, or
  tenant payload bodies.

Safe telemetry uses fixed event names, trusted tenant-safe correlation IDs,
opaque record IDs, hashes, counts, durations, sizes, route classes, status and
reason codes, Evidence/findings IDs, and configured environment identifiers.
Even safe fields remain access-controlled and retention-bound.

## Data-class register

### Account data

**Examples:** application principal, name/email from the identity adapter,
organization, membership, role, invitation and lifecycle state, recent-
authentication time, support case reference.

**Classification:** `customer-confidential`; authentication and security-event
metadata is also `sensitive-operational`.

**Access/export:** a verified principal may access only fields allowed by the
current role and object policy. Support cannot browse an unrestricted tenant. An
account-wide machine-readable data export is not implemented; the existing
solution ZIP is not a substitute.

**Retention/deletion:** retain while the account/organization is active.
Deletion requests enter an authorized `deletion-pending` tombstone; API calls do
not synchronously erase rows or objects. Session revocation, relationship
handling, backup/noncurrent-version erasure, minimum security/accounting
evidence, and final receipt are required before completion. The production
deletion worker and approved completion objective are absent, so controlled-
beta account deletion is a blocker rather than a promised immediate operation.

### Raw prompts and model output

**Examples:** user prompt text, provider request body, provider response,
protected reasoning, repair section, unrestricted model diagnostics.

**Classification:** `restricted-content`; secret-shaped content remains
`restricted-secret` and must be rejected/redacted before invocation.

**Access/export:** never included in normal logs, audit summaries, usage events,
customer-safe Evidence, support views, diagrams, ZIPs, or shared caches. Models
receive only the minimum authorized, redacted context. Synthetic frozen
evaluation fixtures contain no customer content and are separate public/internal
test data.

**Retention/deletion:** provider/application content logging and retention are
disabled by default. Ordinary operation retains no raw prompt or response.
Current candidate contracts have a restricted-retention port for invalid or
reviewable model bytes, but no production store is composed; enabling one
requires separate approval of purpose, exact maximum period, encryption, tenant
access, legal basis, deletion job, and audit. The default therefore remains **do
not persist**. A digest, bounded category, and safe attempt summary may be
retained under the related Evidence/audit policy.

### Intent, Architecture, Workload, External Resource, and Solution documents

**Examples:** typed graph, approved Workload behavior, external references,
assumptions, unresolved questions, immutable revisions, and Solution Revision
manifest.

**Classification:** `customer-confidential`.

**Access/export:** exact organization/project authorization is required. The
reviewed solution export may include the specific immutable source documents
listed in its manifest after content screening. Secret references may be
exported as opaque names only; values never are.

**Retention/deletion:** immutable revision history is retained while the project
is active or archived. Supersession does not erase it. The approved beta project
policy erases these active object bodies through the verified worker described
below; backups follow their configured expiry. The content bucket has no
age-based document expiry that could substitute for that worker. Broader
organization/account deletion and production legal periods remain separate.

### Application contracts

**Examples:** HTTP/event/data/auth/operation/test contracts and event fixtures.

**Classification:** `customer-confidential`, except deliberately released
generic schemas that are `public-reviewed`.

**Access/export:** same project authorization and manifest-bound solution export
rules as source documents. Fixtures must be synthetic or derived only from the
authorized contract without production payloads.

**Retention/deletion:** bind to the owning project/revision lifecycle. Preserve
immutable versions needed to explain a generated artifact or Evidence record;
delete through project/organization workflow subject to approved minimum audit
or legal retention.

### Generated source and IaC

**Examples:** generated Lambda TypeScript, Terraform HCL, CloudFormation JSON,
README/parameters, manifests, ownership records, and validated AI-assisted
candidate source.

**Classification:** `customer-confidential`; unaccepted raw AI candidate bytes
are `restricted-content`.

**Access/export:** exact revision/ownership/baseline authorization. Standard
exports contain only manifest-listed, checksum-verified, screened files.
Generated and user-owned paths remain distinct; regeneration never silently
overwrites or deletes user content.

**Retention/deletion:** replaceable generated versions may follow the artifact
lifecycle only after no retained manifest/Evidence requires their bytes.
Accepted immutable exports remain linked to their revision until project
deletion or an approved archival policy. Rejected/invalid candidate retention is
disabled unless the separately approved restricted-retention boundary exists.

### Diagrams

**Examples:** deterministic SVG/PNG, scene/profile metadata, labels, legend, and
renderer/asset provenance.

**Classification:** `customer-confidential` because labels and topology can
reveal architecture even when no secret is present.

**Access/export:** tenant-authorized image preview and manifest-bound ZIP/GitHub
export only. SVG is never injected as active markup. Exports omit secret values,
raw prompt/model content, plan sensitive values, state, private repository
bodies, and internal traces.

**Retention/deletion:** diagrams are replaceable generated artifacts but remain
integrity-bound to retained exports/Evidence. Apply the artifact lifecycle only
when those references are resolved. Customer-downloaded copies are outside Cloud
Markup deletion control and must be disclosed as such.

### Application artifacts

**Examples:** Lambda ZIP, artifact manifest, CycloneDX SBOM, build/test/security
Evidence, dependency inventory, and smoke-test specification.

**Classification:** `customer-confidential`; vulnerability findings and detailed
dependency/provenance information are also `sensitive-operational`.

**Access/export:** exact project/revision/workload authorization and checksum
validation. No source map, environment file, credential, cache, state, plan,
test secret, or user-owned extension is included unless a separately approved
custom build contract permits it.

**Retention/deletion:** the synthesized platform artifact prefix uses a fixture
lifecycle of 30 days outside production and 365 days in the production fixture.
Those values are engineering defaults, not approved legal policy. Expiration
must not remove the only bytes required by a retained manifest, SBOM, Evidence,
or active support/security case. Failed/partial builds return no deployable
artifact; temporary workspaces are removed immediately after bounded evidence
collection.

### Evidence, plan, deployment, and drift summaries

**Examples:** Evidence records, Active Issues, sanitized
Terraform/CloudFormation plan facts, saved-plan identity/checksum/expiry,
deployment/smoke receipts, read-only drift facts, and conformance reports.

**Classification:** `customer-confidential` and `sensitive-operational`.

**Access/export:** tenant/project/environment authorization; exact revision and
provenance; only sanitized values, hashed IAM/resource identities, safe change
classes, completeness, and staleness. A plan artifact expiry or conformance
freshness deadline is a validity rule, not a deletion schedule.

**Retention/deletion:** raw Terraform state, raw plan JSON, plaintext saved
plan, and sensitive change-set values are prohibited from Cloud Markup Evidence.
A customer workflow may retain an encrypted saved plan in customer GitHub for
its bounded validity; Cloud Markup does not store customer Terraform state. The
synthesized Evidence prefix is `retain`, and no production retention worker
exists. Approved policy must define active Evidence, historical Evidence,
security-case hold, and deletion periods without silently rewriting immutable
history.

### Usage events and credit records

**Examples:** grants, reservations, allocations, settlement/release/expiration,
provider usage, pricing/charging versions, compensation, reconciliation, and
aggregate estimates.

**Classification:** `sensitive-operational`; tenant-safe summaries are
`customer-confidential`.

**Access/export:** organization members receive only policy-authorized
summaries; technical provider/cost detail requires narrower permission. Records
contain no raw prompt, response, card data, credential, or unrestricted
architecture. Aggregate provider evidence must retain source/confidence and
cannot be described as exact request reconciliation.

**Retention/deletion:** canonical events are append-only and are never corrected
by overwrite. Customer compensation does not erase provider-cost history. Exact
accounting, tax, legal, dispute, and privacy retention periods are unresolved.
Deletion may later restrict or de-identify customer access only under approved
policy while preserving the minimum lawful ledger/audit evidence; it may not
fabricate a zero balance or destroy reconciliation lineage.

### Billing identifiers

**Examples:** Stripe customer/subscription/event/Product/Price/Portal IDs,
mapping/endpoint versions, period identity, payload digest, and safe outcome.

**Classification:** `sensitive-operational`. Product and Price IDs are not
secrets but alter entitlement mapping and remain controlled configuration.

**Access/export:** tenant-safe projection only. No API key, signing secret,
signature, raw webhook body, card data, invoice body, or payment-method detail
enters normal storage, logs, support, or exports.

**Retention/deletion:** retain only the identifiers and digests required for
subscription projection, replay defense, grants, reconciliation, disputes, and
audit. Exact legal/accounting retention and deleted/merged-organization behavior
require business/legal approval. Unknown-tenant events are quarantined, never
attached to a guessed organization.

### Audit records

**Examples:** trusted actor/system, tenant, action, target, outcome, safe
reason, correlation, policy/version, occurrence time, and related Evidence.

**Classification:** `sensitive-operational`.

**Access/export:** append-only, protected from ordinary user mutation, and
limited to authorized tenant-safe or security/operator views. Summaries contain
no credentials, secrets, prompts, model output, payment data, private source,
unrestricted architecture/artifacts, state, or plan values.

**Retention/deletion:** preserve the minimum record needed for security,
authorization, financial, and lifecycle accountability. The synthesized log
fixture is 30 days outside production and 365 days for production; database
audit retention is not established by that log setting. Exact audit retention,
legal hold, de-identification, and access-review periods are unresolved and must
be approved before production.

### Operational logs, metrics, traces, and support cases

**Examples:** safe structured events, counts, latency, denial and failure codes,
alarm state, trace/correlation IDs, case/ticket, decision, and runbook outcome.

**Classification:** `sensitive-operational`; any accidentally captured body is
immediately treated as `restricted-content` or `restricted-secret` and triggers
the incident runbook.

**Access/export:** operator/security need-to-know. Customer-safe exports may
include only deliberately projected audit/Evidence summaries, never raw
operational telemetry.

**Retention/deletion:** apply the reviewed log-group period and support/security
case policy. Current 30/365-day CDK values are fixtures pending policy approval.
Retention-processing failures are alarmable security/operational events; they
must not be fixed by broadening access or deleting evidence without review.

## Deletion workflow

The owner selected immediate active **project-content** erasure with backups
expiring under their configured retention on 2026-09-08. This resolves that beta
policy choice, not the separate production/account-wide periods below.
[ADR-0046](../adr/0046-project-content-erasure.md) records the proposed
technical implementation, exact retained metadata and activation conditions.

The current authenticated project deletion API records `deletion-pending`, an
idempotent mutation receipt and audit history. Current project authority then
denies editing and export execution. It does not enqueue a cleanup job, settle
financial holds or synchronously remove object versions. The local candidate now
includes a dedicated worker, permanent upload fence and immutable completion
receipt. Both its schedule and runtime switch remain disabled. Uncertain writes,
unfinished jobs/export reconciliation and active credit holds block physical
erasure. Recovery and hosted writer-drain acceptance remain full-beta gaps.
Existing bucket age limits do not establish completion.

The worker verifies removal of all project versions/delete markers, including
unpublished bytes, before marking the project deleted. It clears mutable
project/environment labels but retains immutable accounting/security/provenance
metadata, including revision/export descriptors. It does not claim account-wide
erasure or removal of external copies. Backups follow their configured expiry;
restore procedures must reapply deletion restrictions before granting access.

Ordinary API input, support actions, subscription events, model output and
repository webhooks cannot grant physical erasure authority. The dedicated
project worker derives it from the canonical authorized deletion request.
Broader account-wide production deletion must implement the complete order
below; the beta project worker implements only its documented scoped subset:

1. authenticate the current principal and require the exact destructive
   permission plus recent authentication;
2. resolve organization/project ownership server-side and create an immutable
   request/audit record with scope and idempotency identity;
3. place the account, organization, project, or environment in
   `deletion-pending`, deny new expensive work, and prevent new publication
   without deleting existing projects merely because a subscription changed;
4. offer the policy-approved export before deletion when authorized, while
   making clear that customer-downloaded or GitHub copies remain customer-owned;
5. inventory database rows, object versions/delete markers, caches, queued jobs,
   artifacts, Evidence, integration mappings, audit/ledger exceptions, backups,
   and external provider actions without following caller-supplied object keys;
6. cancel/revoke sessions, jobs, signed downloads, and integration sessions
   using their own authority boundaries;
7. delete or cryptographically render inaccessible only the approved scope,
   preserving explicitly required legal/security/accounting records and their
   documented access restrictions;
8. process object versions, delete markers, replicas, caches, and backups under
   the accepted objective rather than claiming immediate erasure;
9. verify absence/restriction through tenant-scoped reconciliation, record
   partial failures, retry idempotently, and alarm on overdue work; and
10. issue a safe completion or blocked receipt containing only IDs, scope,
    retained-category reasons, counts, times, and Evidence references.

Support cannot bypass these steps. A deletion request never authorizes a Stripe
refund/cancellation, GitHub repository deletion, customer cloud deletion,
Terraform destroy, or removal of customer-downloaded artifacts.

## Retention and deletion failure behavior

- Expiration never upgrades Evidence, closes an issue, changes the approved
  graph, settles credits, or proves data was deleted.
- A lifecycle failure retains the item, emits a safe finding/alarm, and requires
  operator review. It does not widen IAM, disable encryption, or issue an
  unverified completion receipt.
- Object-store unavailability preserves metadata and retries boundedly; it does
  not publish a manifest before all bytes are verified.
- Legal/security hold is a separately authorized immutable record with scope,
  reason, approver, start/review/end times, and audit Evidence. It cannot be
  invented by ordinary support.
- Stale caches and browser storage cannot restore authority after membership,
  session, project, or deletion state changes.

## Decisions required before controlled-beta approval

The following require named business/legal/security owners and cannot be
selected by application code alone:

- account, source document, contract, generated artifact, Evidence, usage,
  billing identifier, audit, log, support-case, backup, and delete-marker
  retention periods;
- data-subject/account export scope, format, identity verification, response
  objective, regional disclosures, and authorized exceptions;
- deletion completion objective for primary data, object versions, caches,
  replicas, and backups;
- minimum lawful accounting, fraud, security, tax, dispute, and audit evidence;
- litigation/security hold authority and review cadence;
- provider deletion obligations for Cognito, Stripe, GitHub, model providers,
  and any later subprocessors; and
- privacy notice, terms, incident notification, and tenant communication.

Until those decisions and the production workers are approved, documentation
must say **retention/deletion unavailable for production**, not “retain
forever,” “delete immediately,” or “privacy compliant.”
