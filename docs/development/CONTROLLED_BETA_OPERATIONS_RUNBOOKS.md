# Controlled-beta operations runbooks

## Scope and authority

These runbooks describe safe investigation and recovery for a future controlled
beta. They do not authorize deployment, a Terraform apply, CloudFormation
change-set execution, drift remediation, GitHub merge/default-branch write, live
Stripe action, refund, credit-policy invention, live model activation, or direct
database/object editing.

The repository currently provides deterministic contracts, tests, and
synthesized alarms for only part of this inventory. Alarm thresholds are
fixtures and no notification recipient is configured. A production operator must
not call a contract-only signal “monitored” until the metric, alarm, dashboard,
recipient, escalation route, and drill are deployed and evidenced.

Billing-specific setup, secret overlap, subscription incidents, and payment
procedures remain in
[Billing Operations Runbooks](BILLING_OPERATIONS_RUNBOOKS.md). Data handling
follows
[Data Classification, Retention, and Deletion](../architecture/DATA_CLASSIFICATION_RETENTION_AND_DELETION.md).

## Universal safety rules

1. Verify environment, actor/operator identity, ticket/incident, organization
   and project scope, current revision/commit, and evidence timestamp before
   action. Never derive tenant scope from a payload or support-entered ID alone.
2. Record only safe IDs, digests, counts, fixed reason/status codes, versions,
   timestamps, and source/confidence. Never paste credentials, secret values,
   signatures, authorization headers, card data, raw webhook bodies, raw prompts
   or model output, private repository/source bodies, state, plaintext plans,
   sensitive plan values, or unrestricted tenant content.
3. Preserve immutable source, receipt, ledger, audit, plan, deployment, and
   drift evidence. Do not repair by editing a row, balance, projection,
   manifest, receipt, or generated file directly.
4. Prefer safe degradation: suspend the affected expensive or mutating operation
   while preserving authorized manual editing, existing-project reads, and
   policy-approved export. Do not delete projects because entitlement or an
   integration changes.
5. Retry only a documented idempotent operation with the original immutable
   authority plus a fresh operator idempotency key where required. Do not loop a
   poison event or rerun uncertain model/build/deploy work.
6. If identity, tenant scope, integrity, secret exposure, plan identity, or
   deployment authority cannot be established, stop and escalate. Unknown means
   denied or unavailable, not success.
7. Drift and repository reconciliation produce an issue or reviewed pull request
   only. No runbook authorizes automatic remediation.

## Common alarms and dashboards

The expected safe observability inventory is below. `synthesized` means the
current CDK contains the named static resource but has not deployed it.
`contract` means a safe event/metric seam and deterministic tests exist.
`pending` means a production emitter/composition, deployment, or manual proof
remains; no row claims operational monitoring.

| Area                        | Safe signal and correlation                                                                                  | Required alarm/dashboard                                                                 | Current evidence                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| API and authentication      | route class, status family, latency, principal-present flag, safe denial reason, correlation                 | 5xx, sustained 401/403/hidden-object anomaly, latency, origin-bypass/rate denial         | API/origin/throttle filters and aggregate alarm `synthesized`; complete emitters/deployment `pending`                                           |
| Tenant authorization        | operation, role class, object family, allow/deny reason, tenant-safe correlation                             | cross-tenant invariant failure is immediate security incident; denial-rate anomaly       | domain/API `contract`; safe filter/aggregate alarm `synthesized`; production emitter `pending`                                                  |
| Async jobs                  | kind, state, attempt, queue age/depth, lease/orphan/retry/DLQ safe code                                      | backlog, oldest age, repeated failure, orphan/stale claim, DLQ                           | baseline worker/queue/DLQ `synthesized`; lifecycle metrics `contract`                                                                           |
| Model routes and usage      | feature, route class, attempt/result, normalized units, credits, aggregate estimated cost, source/confidence | route-distribution drift, token/credit/cost anomaly, reconciliation backlog, kill switch | runtime/ledger `contract`; filters/aggregate alarm `synthesized`; live emitter `pending`                                                        |
| Credit ledger               | reservation/grant/settlement state, age, duplicate/missing/impossible finding                                | open/expired reservation, negative/impossible balance, missing usage, mapping mismatch   | reconciliation `contract`; filter/aggregate alarm `synthesized`; scheduler/emitter `pending`                                                    |
| Compiler/generator          | tool/version, revision/target, result code, duration, file/byte counts, determinism digest                   | failure-rate, timeout, nondeterminism, unsupported-target spike                          | deterministic tests `contract`; filters/aggregate alarm `synthesized`; runtime emitter `pending`                                                |
| Application build/test      | profile, tool/image pins, result category, duration, queue age, scan/test counts                             | queue/concurrency, timeout, scan failure, nondeterminism, cleanup failure                | log group/project and failed-build aggregate alarm `synthesized`; execution `pending`                                                           |
| Terraform validation        | tool/image/policy pins, result category, duration, diagnostics count                                         | queue/concurrency, timeout, policy/tool failure, cleanup failure                         | log group/project and failed-build aggregate alarm `synthesized`; execution `pending`                                                           |
| Diagram and ZIP             | renderer/export version, revision, file/byte/pixel counts, result code                                       | size rejection anomaly, render/archive/checksum failure                                  | package `contract`; filters/aggregate alarm `synthesized`; runtime emitter `pending`                                                            |
| GitHub import/export        | installation/repository opaque ID, operation, provider status class, rate-limit class, result                | auth/revocation, webhook failure, rate limit, stale base, repeated partial failure       | adapters `contract`; export filter/aggregate alarm `synthesized`; import emitter/filter and all production emitters `pending`                   |
| Workflow generation         | profile/version, file count/digest, validator result                                                         | pin/permission/policy drift or generation failure                                        | CI validator `contract`; filter/aggregate alarm `synthesized`; runtime emitter `pending`                                                        |
| Plan Evidence               | target/environment, revision/commit/manifest identity, checksum/expiry result, operation counts              | checksum/commit/backend/workspace/expiry mismatch, sensitive-value rejection             | deterministic `contract`; filter/aggregate alarm `synthesized`; ingestion/emitter `pending`                                                     |
| Deployment/smoke Evidence   | approved-plan identity, receipt chain, environment/commit, smoke result                                      | missing/mismatched receipt, missing/failed smoke, stale projection                       | deterministic `contract`; filter/aggregate alarm `synthesized`; ingestion/emitter `pending`                                                     |
| Drift Evidence              | baseline receipt, completeness/freshness, drift class/count                                                  | IAM/public-network drift, unmanaged resource, invalid/stale/unknown collection           | deterministic `contract`; filter/aggregate alarm `synthesized`; collector/emitter `pending`                                                     |
| Stripe projection           | signature/processing result, queue age/depth, DLQ, mapping/endpoint version, stale age                       | signature failures, processing failures, backlog/age, DLQ, stale projection              | queue/Lambda/filters/alarms `synthesized`; durable consumer `pending`                                                                           |
| Throttling and abuse        | surface, tenant/actor hash, limit kind, denied count, cost/concurrency                                       | sustained denial, WAF rate rule, model/build/storage anomaly                             | model/plan limits `contract`; enabled-WAF blocked-request metric/alarm and API/filter aggregate alarm `synthesized`; deployment/drill `pending` |
| Support/admin               | operator/principal, exact organization, operation, outcome/reason, case/correlation                          | repeated denial, cross-scope invariant, adjustment/replay/suspension anomaly             | support operation `contract`; filters/denial alarm `synthesized`; production host/emitter `pending`                                             |
| Artifact/Evidence retention | object class, lifecycle job, count/bytes, result, overdue age                                                | publication failure, deletion/retention backlog, policy mismatch                         | filters/aggregate alarm `synthesized`; lifecycle worker/emitter `pending`                                                                       |
| Object store/database       | operation class, safe error, latency, retry count, publication stage                                         | availability/error rate, publication orphan, backup/restore, capacity                    | write-failure baseline `synthesized`; complete service alarms `pending`                                                                         |
| Platform budget             | environment, budget period, forecast/actual percentage, anomaly category                                     | budget thresholds, anomaly hook, service cost dimensions                                 | budget plus service cost-anomaly monitor/subscription `synthesized`; recipient/provider-context test/drill `pending`                            |

All metrics and traces must be content-free. A trace may carry safe correlation,
tenant-scoped opaque IDs, operation/version, timing, and result code; it must
not carry a request/response body, prompt, source, plan value, state, token,
secret, payment data, or unrestricted document/artifact. Sampling must never be
used to justify logging prohibited content.

### Common alarm intake

1. Acknowledge the alarm and record its environment, metric/alarm identity,
   threshold, first/last time, dashboard, and incident ticket.
2. Confirm the signal is real and current. Check missing-data behavior, metric
   dimensions, deployment/configuration version, clock, and duplicate alarm
   delivery without mutating the monitored system.
3. Establish the smallest affected organization/project/integration scope from
   trusted metadata. If scope is unknown, treat it as platform-wide for
   containment without exposing tenant data.
4. Apply the relevant safe suspension or feature kill switch. Never raise a
   limit, disable a signature/policy check, broaden IAM, or remove an activation
   hold merely to clear an alarm.
5. Follow the specialized runbook below. Record recovery against the underlying
   signal, not only the alarm state.
6. Close only after the metric is healthy for the approved observation window,
   reconciliation is clean, retained Evidence is current, and the decision owner
   approves. Current fixture thresholds/observation windows require owner
   approval before beta.

## Security incident

Use for suspected cross-tenant access, control bypass, code execution,
credential exposure, unexpected deployment authority, sensitive logging/export,
malicious dependency, or unexplained data/ledger/plan mutation.

1. Open a private incident channel and assign incident commander, security lead,
   service owner, recorder, and communications owner. Do not use a public issue.
2. Preserve safe evidence: commit/configuration and artifact digests, audit and
   alarm IDs, affected record IDs, timestamps, role/policy versions, and bounded
   sanitized diagnostics. Restrict any raw forensic artifact separately.
3. Contain the narrowest capability: disable the integration/model/expensive
   operation, revoke an affected session or credential, stop a worker trigger,
   or activation-hold an export. Do not destroy forensic evidence or customer
   data.
4. Determine affected tenants through trusted ownership queries. Do not ask
   support to browse broadly or copy tenant bodies into the incident record.
5. Check for secret, log, export, repository, plan/state, and deployment impact.
   If a credential may be exposed, follow **Compromised secret** immediately.
6. Correct through a reviewed code/configuration change and the normal
   verification/release path. No emergency action may create an undocumented
   deploy role or bypass saved-plan integrity.
7. Reconcile jobs, ledger, webhooks, artifacts, Evidence, and tenant access as
   applicable; record residual uncertainty and notification/legal decisions.
8. Resume only with approval, current tests/static analysis, clean signals, and
   a documented rollback. Complete a blameless review and update the threat
   model/matrix/runbook.

## Compromised secret or credential

Applies to Stripe secrets, GitHub App keys/webhook secrets, database secrets,
identity client secrets, customer/workflow OIDC trust, AWS sessions, signing/
encryption keys, installation tokens, and any secret accidentally logged or
exported.

1. Do not copy the value. Record only secret purpose, environment, logical
   reference, version/identifier, suspected exposure window, and evidence.
2. Disable or isolate the owning integration/capability. A suspected platform or
   customer-cloud credential requires immediate security escalation and denial
   of new privileged work.
3. Revoke/rotate through the provider's approved secret channel. Use the Stripe
   bounded current/previous overlap only for planned rotation; suspected
   compromise may require immediate invalidation according to incident command.
4. Verify least-privilege access, resource policy, CloudTrail/provider audit,
   recent use, dependent caches/sessions, and every environment separately.
5. Remove any leaked value from active logs/artifacts/support systems through a
   separately authorized incident process. Repository history rewriting is a
   high-risk exceptional action and is not implied here.
6. Reconfigure only the logical reference/version. Never place the replacement
   value in source, fixtures, prompts, tickets, commands that are retained, or
   deployment evidence.
7. Exercise the owner-specific path, reconcile failures/backlogs, and record
   revocation/rotation evidence. Resume only after old authority is rejected and
   the new reference is proven without disclosing it.

## Webhook outage or integrity failure

Applies to Stripe and GitHub webhook ingress.

1. Determine whether failures are signature, timestamp, size, event allow-list,
   replay, provider delivery, queue/backlog, consumer, mapping, or persistence.
2. Preserve safe delivery ID, event name, payload digest, signature version
   (`current`/`previous` only), order key, attempt/outcome, queue/DLQ state, and
   mapping/endpoint version. Never retain the body or signature in ordinary
   evidence.
3. Reject unverified events. Do not temporarily skip signature verification,
   increase timestamp tolerance beyond policy, or accept an unknown event.
4. If compromise is suspected, rotate the owning secret using the compromised-
   secret procedure. Keep Stripe and GitHub secrets/queues/stores separate.
5. Bound retries and move poison events to the reviewed DLQ path. Replay only a
   known persisted identity/digest through the idempotent operator seam.
6. Reconcile subscription/grants or installation/repository lifecycle and
   ordering before clearing stale projections. An older event cannot replace a
   newer projection.
7. Resume after signature failures stop, backlog/age and DLQ are within approved
   limits, projections are current, and a test delivery plus reconciliation
   passes.

## AI cost spike or provider degradation

1. Suspend new expensive model operations with the audited administrative kill
   switch. Do not enable overage, raise caps, or silently route to a broader or
   unevaluated model.
2. Compare normalized attempts, route distribution, token/cache units, repair
   and escalation counts, credits, reservation state, and aggregate provider
   totals with their source/confidence.
3. Check duplicate dispatch/settlement, unbounded retry symptoms, changed prompt
   or route configuration, repair loops, cache behavior, provider price/policy
   version, and tenant/feature outliers.
4. Preserve uncertain dispatched reservations for reconciliation. Timeouts or
   missing usage alone do not prove no dispatch and do not authorize credit
   release.
5. Correct only reviewed routing/limit/pricing configuration or code. Customer
   compensation is append-only and never erases provider cost evidence.
6. Resume only after cost/route metrics stabilize, ledger reconciliation is
   current, and owner approval is recorded. Continue manual editing and approved
   export during provider outage where authorization/policy permits.

## Ledger mismatch

1. Suspend new expensive operations for affected organizations when entitlement
   or credit correctness is uncertain.
2. Run exact-organization reconciliation for open/expired reservations,
   duplicate/missing usage, provider usage without settlement, monthly grants
   and period boundaries, negative/impossible balances, mapping mismatch,
   outliers, and compensation.
3. Verify plan, entitlement, charging, pricing, normalization, provider/model,
   reservation, dispatch, and usage version pins. Do not reinterpret history
   under current policy.
4. Treat aggregate provider evidence only at its stated aggregate/estimated
   confidence. Do not manufacture an exact request match.
5. Correct through idempotent terminal/compensation/adjustment events with
   reason, actor/system, idempotency, and related Evidence. Never overwrite a
   grant, usage event, balance, or projection.
6. Resume after balances derive consistently, reservations have evidenced
   outcomes or visible findings, duplicate processing is safe, and the mapping/
   provider aggregate is reconciled to the available confidence.

## Application build, generator, compiler, or validation issue

1. Stop publication for the exact affected revision/tool/profile/target. A
   failure returns no deployable artifact and cannot retain complete coverage.
2. Verify input, generator/compiler/tool/image/lock/cache/policy versions and
   digests; source ownership; revision; target; workspace cleanup; and bounded
   result parsing. Never inspect unrestricted tenant source in a normal ticket.
3. Classify admission, deterministic output, test, scanner, dependency, timeout,
   resource, cleanup, or environment failure. Preserve safe step IDs/exit
   categories and checksums, not raw stdout/stderr or workspace paths.
4. For nondeterminism, compare two clean outputs and halt the affected release.
   Do not update a golden merely to accept unexplained bytes.
5. For image/store/mirror/tool failure, keep the runner offline and disabled.
   Publish/attest replacement inputs through the reviewed supply-chain path;
   never allow a runtime download as recovery.
6. Re-run the focused gate, reproducibility, security scans, dependent target
   tests, and export verification. Resume only after new immutable Evidence is
   passing and current.

## Plan mismatch or saved-plan integrity failure

1. Stop before OIDC, decrypt, apply, or change-set execution. Do not re-plan in
   the deploy job and do not extend an expired plan.
2. Compare exact Solution Revision, commit, environment, backend/workspace or
   stack identity, export manifest, repository lock, tool/provider versions,
   workflow/policy, target authority, checksums, encryption descriptor,
   creation, and expiry.
3. Treat any mismatch as invalid plan Evidence. Preserve only sanitized facts
   and digests; do not upload plaintext plan/state or before/after values.
4. Investigate repository transfer/visibility, workflow revision, environment
   configuration, artifact retrieval, clock, and tampering. A changed identifier
   requires a fresh customer-owned plan and approval.
5. Revoke/delete the invalid customer artifact according to its bounded
   retention policy without claiming Cloud Markup controls the customer's state.
6. Resume only with a newly created, independently approved, unexpired plan and
   complete manifest. Prompt 48 performs no such run.

## Deployment or smoke Evidence failure

1. Mark deployment readiness invalid or incomplete. A deployment receipt alone
   is not passing deployment Evidence; smoke must pass where required.
2. Verify exact approved saved-plan/change-set identity, environment, commit,
   workflow revision, target authority, artifact attestations, predecessor
   receipts, and smoke/integration target/results.
3. Do not fabricate a receipt, copy Evidence across environments, reuse an old
   smoke result, or infer success from provider/cloud state.
4. If infrastructure may have changed, escalate to the customer/operator's
   environment-specific incident/rollback procedure. Cloud Markup does not
   apply, roll back, destroy, or create a change set.
5. Preserve partial/unknown state in the deployed projection and create a
   reviewed issue. Resume promotion only after the exact environment has current
   passing Evidence and required approval.

## Drift alert

1. Verify the current-drift observation is read-only, unexpired, complete to its
   declared scope, and bound to the exact approved deployment receipt,
   environment, commit, and Solution Revision.
2. Classify managed configuration drift, unmanaged resource, IAM expansion or
   reduction, public/network exposure, application binding, ownership/import
   mismatch, or unknown/partial evidence.
3. Treat permission expansion and public exposure as security escalation. Do not
   expose raw state, resource values, credentials, or sensitive plan data.
4. Create/update a reviewed Active Issue or reconciliation pull-request proposal
   using the fake/reviewed action boundary. Never automatically apply, import,
   adopt, overwrite, or delete a resource.
5. Close only with the issue's exact current passing Evidence. A later scan,
   diagram, or user click does not silently resolve it.

## Object-store or artifact-publication failure

1. Stop publication/download authorization for the affected object and manifest.
   Metadata without verified bytes is not a published artifact.
2. Verify organization/project/purpose prefix, object key from trusted metadata,
   revision/artifact digest, size/media type, version, publication stage, and
   expiry. Do not use a caller-supplied bucket key as authority.
3. Determine database-before-object, object-before-database, checksum, version,
   encryption, permission, quota, lifecycle, or service-availability failure.
4. Reconcile idempotently using the existing staged-publication authority.
   Orphan cleanup must be ownership-scoped and must not delete a retained
   document/Evidence/artifact referenced by a current manifest or case.
5. Alarm on repeated publication, retention, deletion, and reconciliation
   failure. Restore download only after exact bytes and metadata rejoin and
   authorization is rechecked.

## Tenant concern or suspected privacy/security issue

1. Authenticate the reporter through the approved support channel; record case,
   organization, reporter principal, category, and safe affected references. Do
   not request credentials, card details, raw prompts, source, state, or
   unrestricted architecture through support.
2. Authorize every tenant-owned view independently. Support authority does not
   bypass organization/project ownership and does not permit unrestricted
   search.
3. If the concern alleges cross-tenant access, secret exposure, unexpected
   deployment, sensitive export/logging, or account compromise, invoke the
   security-incident procedure immediately.
4. For export/deletion requests, follow the approved data policy. The current
   solution ZIP is not an account-wide privacy export, and the production
   deletion worker is unavailable; communicate that limitation truthfully.
5. Record decisions and findings with bounded safe evidence. Credit adjustment,
   subscription mutation, refund, immediate cancellation, repository change, or
   cloud action requires its separate authorization and policy.
6. Close with reporter communication approved by the case owner and a retained
   safe audit trail. Escalate legal/privacy notification decisions; do not
   invent them.

## Safe degraded behavior

| Dependency unavailable or uncertain | Required degraded behavior                                                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe/webhook projection           | Block new paid entitlement transitions and expensive AI when verified state is unavailable; preserve projects/manual editing/approved export; retain/reconcile events. |
| Model provider                      | Deny new dispatch or use only a separately reviewed route already within policy; do not infer success/free usage; preserve uncertain reservation.                      |
| GitHub                              | Keep local immutable export available when authorized; do not retry a repository mutation without exact idempotent recovery; never merge/default-write.                |
| Generator/compiler/validation/build | Return explicit unavailable/failed/custom-required status and no deployable artifact or higher Evidence.                                                               |
| Plan/deployment system              | Mark readiness invalid/unknown and do not apply, re-plan, promote, or fabricate receipts.                                                                              |
| Drift/evidence system               | Keep all six projections separate; show stale/partial/unknown; do not infer match or remediate.                                                                        |
| Object store                        | Stop publication/download of unverified objects; preserve metadata for scoped reconciliation.                                                                          |
| Audit/metrics pipeline              | Keep authoritative transaction fail-closed where its required audit outbox cannot commit; buffer/retry bounded content-free events without logging bodies.             |

## Drill and exit evidence

Before beta, assign owners, recipients, severity, threshold, observation window,
and escalation objective for every enabled alarm. Run table-top exercises for
all procedures and bounded non-production technical drills for compromised test
secret, webhook outage, model cost spike, ledger mismatch, build/compiler
failure, plan mismatch, deployment Evidence failure, drift alert, object-store
failure, and tenant concern.

Retain only: environment, drill/incident/ticket ID, actor/roles, safe scope,
configuration/tool/policy versions and digests, alarm and Evidence IDs, command
and test outcomes, timestamps/durations, decisions, residual risks, action
owners, and resume/continue-suspension result. A drill is not a production
readiness claim unless it used the approved deployed configuration and its
evidence is current.
