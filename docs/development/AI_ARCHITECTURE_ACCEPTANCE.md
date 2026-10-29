# Architecture AI acceptance runbook

Audit source baseline: public `641ed0822598be162df2e67155e40484d67b5579`.
Catalog:
`sha256:8e9b1b23bbcdf723352044baddd8e79468d70ed5a719af914036992daf91fb94`. This
procedure is not a live success receipt or spending authorization.

## Verified state at the October 29 source review

| Area                                              | Evidence                                                                                                                              | Remaining qualification                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Creation v6/capability/draft guards               | Merged in public PR #5 at 641ed082; reviewed source is present                                                                        | Release-owner deployment receipt and live verification are required                                                         |
| Creation proof handoff                            | Confirmed source gap: six invalid-proof controls left Apply enabled; local correction passes the focused creation/editor/recovery run | New correction requires release-owner integration and live verification                                                     |
| Availability and source/export advertisement      | Twelve synthetic runtime/API cases pass; no tenant lookup or inference is needed for capability reads                                 | Read actual post-deployment capabilities; advertisement alone is not provider or executor proof                             |
| Editor proposal validation and interruption/retry | Existing v6 checks and recovery cases pass within the 74-case focused web run                                                         | Coordinated live create/adjust/stale/cancel evidence is not yet recorded                                                    |
| Completed unaccepted preview after reload         | Source handoff is RAM-only; automatic preview restoration is unsupported                                                              | Preserve this recovery limitation; further paid generation needs its existing bounded authorization                         |
| Infrastructure export                             | Source profile and capability tests cover the configured infrastructure-only target                                                   | Actual immutable revision, job, downloaded bytes and archive validation are still required                                  |
| Runnable application generation                   | Default generator/build stages are refusal adapters; source-draft capability is separate                                              | Application owner must supply a qualified existing executor and complete typed workload contracts; do not activate one here |

The historical root-validation rejection is established, but its original model
content was not retained. Neither the merged fix nor these local tests prove
that specific live model failure is resolved. The browser owner's live feature
matrix remains the authority for actual observed behavior.

## Admission and evidence

The parent supplies the campaign identifier, original authorization evidence,
maximum requests, aggregate credit/provider-spend ceilings and stopping rules.
The nominal matrix has **40 requests: ten creates and three follow-ups each**.
Extra smoke requests, retries and recovery submissions require an explicit place
within those bounds. An available balance or renewed AWS SSO is not that record.
Record actual campaign, project and request identities from their authorized
receipts; proposed names are not receipts.

The release owner supplies exact public/private deployed revisions and asset
identity. The sole browser owner checks the existing signed-in workspace,
current credits, normal AI availability and export capabilities before any paid
request. The current client requires advertised proposal version 6; it must not
probe an older server with a paid request or downgrade to version 5. Source,
merge, CI, deployment, live generation, download and application execution are
distinct states. Rebind this procedure if the catalog differs.

Use a fresh name `QA-20261029-<campaign>-AI-01` through `AI-10` in the **New
project** name field. Enter each C prompt below in the requirements field; this
does not authorize the model to create another project. Record the actual
project and request IDs as returned. Existing customer and previous QA projects
remain untouched. Retry a failed generation in its saved project, subject to the
parent limits, rather than creating another project with the same name.

Record for C/E1/E2/E3: prompt, timestamps, served identity, requested/returned
version, catalog digest, safe failure reference, credit receipt, proposal
outcome, preview, actual before/after graph and stable node/edge IDs. Never
retain tokens, credentials or unrelated tenant data. Status is one of `NOT_RUN`,
`BLOCKED`, `FAILED`, `QUESTIONS`, `ASSESSMENT`, `REVIEWED_NOT_APPLIED` or
`APPLIED_RELOADED`. Questions or an assessment can be a correct response but do
not prove a generated diagram or completed edit. Scores for unexecuted/dependent
work remain null.

For every prompt, append this exact common text:

```text
Use only the supplied current catalog and proposal version. Propose infrastructure only; identify unimplemented application behavior and unresolved inputs. Use least privilege, preserve generated ownership and stable existing identities, and do not deploy, execute source, fetch images, contact external services or invent credentials. For a follow-up, change only the requested settings. Do not change unrelated resources, routes, policies, references, workloads or contracts. Return blocking questions with no proposed changes when a consequential requirement cannot be represented safely.
```

Run AI-01 C first. Stop the campaign if its response is malformed, cannot pass
actual deterministic preview, has uncertain accounting or does not match the
deployed source. Preserve its request reference and fixed diagnostic categories;
do not repeatedly submit the same failing prompt. Accept a valid proposal only
through normal explicit review, then save/reload before the next request. For
edits, compare the exact expected fields and all unrelated identities/settings.
Exercise one Undo/Redo per project and verify the same identities return.

## Exact prompts and expected outcomes

### AI-01: authenticated notes read API

| ID  | Prompt body                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | Design a JWT-authenticated GET /notes API with Cognito user pool/client, HTTP API, one Lambda labeled Notes Reader, a DynamoDB table keyed by noteId, its execution role and logs. The intended reader uses the verified owner claim, but business logic remains unimplemented. Set Lambda memoryMegabytes=256 and timeoutSeconds=10, and log retentionDays=30. |
| E1  | Change only Notes Reader memoryMegabytes to 512.                                                                                                                                                                                                                                                                                                                |
| E2  | Change only Notes Reader timeoutSeconds to 15.                                                                                                                                                                                                                                                                                                                  |
| E3  | Change only the Notes Reader log group's retentionDays to 14.                                                                                                                                                                                                                                                                                                   |

Expected diagram: explicit JWT authorization and API-to-Lambda route, execution
role, logging and table-read relationships. A purpose description is not an
implemented ownership check or runnable notes API. After E3 the Lambda is 512
MB/15 seconds and its log retention is 14 days; original route, table keys and
all unrelated identities remain. Infrastructure export is eligible only after
normal immutable-revision validation; no application-code success is implied.

### AI-02: authenticated product lookup

| ID  | Prompt body                                                                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | Design a JWT-authenticated GET /products/{productId} lookup using HTTP API, Cognito, one Lambda labeled Product Reader, an execution role, logs and a DynamoDB table with partitionKeyName=productId. Include read permissions only; do not add writes or claim a category index exists. Set Lambda memoryMegabytes=128, timeoutSeconds=3 and reservedConcurrency=10. |
| E1  | Change only Product Reader memoryMegabytes to 256.                                                                                                                                                                                                                                                                                                                    |
| E2  | Change only Product Reader timeoutSeconds to 10.                                                                                                                                                                                                                                                                                                                      |
| E3  | Change only Product Reader reservedConcurrency to 5.                                                                                                                                                                                                                                                                                                                  |

Expected: one public-facing API protected by JWT, a read-only table grant and no
write endpoint. Final Lambda settings are 256/10/5. Preserve productId and the
route identity. Export proves the declared infrastructure, not successful reads.

### AI-03: private upload metadata ingestion

| ID  | Prompt body                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | Design a private S3 bucket where incoming/ JSON uploads trigger a Lambda labeled Upload Metadata that may read the source object and write metadata to DynamoDB. Include the supported notification, invocation, role, logging and data permissions; no arbitrary file transformation. Set Lambda memoryMegabytes=256, timeoutSeconds=10 and reservedConcurrency=10. |
| E1  | Change only Upload Metadata memoryMegabytes to 512.                                                                                                                                                                                                                                                                                                                  |
| E2  | Change only Upload Metadata timeoutSeconds to 30.                                                                                                                                                                                                                                                                                                                    |
| E3  | Change only Upload Metadata reservedConcurrency to 5.                                                                                                                                                                                                                                                                                                                |

Expected: source notification and invocation permission are distinct from object
read/table write permissions; the trigger binds the correct workload operation.
Bucket public-access blocking, encryption, retention and identity remain. Final
Lambda settings are 512/30/5. Duplicate-event handling remains unimplemented
unless separately represented and tested. Export must preserve those bindings.

### AI-04: queue consumer and dead letter queue

| ID  | Prompt body                                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | Design a standard SQS queue labeled Orders with a standard DLQ and a Lambda consumer labeled Order Worker, its role and logs. Set worker memoryMegabytes=256 and timeoutSeconds=15; main queue visibilityTimeoutSeconds=120, receiveWaitTimeSeconds=0 and messageRetentionSeconds=345600. Redrive after 5 receives with manual replay. No automatic replay or exactly-once claim. |
| E1  | Change only Orders visibilityTimeoutSeconds to 300.                                                                                                                                                                                                                                                                                                                               |
| E2  | Change only Orders receiveWaitTimeSeconds to 20.                                                                                                                                                                                                                                                                                                                                  |
| E3  | Change only Order Worker memoryMegabytes to 512.                                                                                                                                                                                                                                                                                                                                  |

Expected: typed queue-consumer and main-to-DLQ relationships, matching queue
types, correct polling permissions and no redrive cycle. Final main queue is
300/20/345600 and worker 512 MB/15 seconds. DLQ/replay settings and all IDs
remain. The earlier proposed value 180 is unsupported; do not substitute it
here.

### AI-05: independent fanout subscribers

| ID  | Prompt body                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | Design one standard SNS topic with two independent standard SQS subscriptions labeled Billing Events and Analytics Events, with explicit subscription ownership and least-privilege delivery policies. Set both queues visibilityTimeoutSeconds=60 and receiveWaitTimeSeconds=0; Billing messageRetentionSeconds=345600 and Analytics messageRetentionSeconds=86400. No email, SMS, HTTP or external endpoint. |
| E1  | Change only Analytics Events messageRetentionSeconds to 1209600.                                                                                                                                                                                                                                                                                                                                               |
| E2  | Change only Billing Events receiveWaitTimeSeconds to 20.                                                                                                                                                                                                                                                                                                                                                       |
| E3  | Change only Billing Events messageRetentionSeconds to 1209600.                                                                                                                                                                                                                                                                                                                                                 |

Expected: two separate subscription targets/policies, with neither queue
consuming the other. Final queue retention is 14 days for both; Billing polls 20
seconds and Analytics remains at zero. Generated policy nodes are preserved.
Seven-day retention is not a supported literal in this catalog. Export must
include both independent deliveries; no producer/consumer code is claimed.

### AI-06: supported custom-bus event filter

| ID  | Prompt body                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | Design a custom EventBridge bus, an enabled EVENT_PATTERN rule with sourceKinds=["cloudmarkup.application"], detailTypes=["Application Event"], scheduleExpression="NONE" and filterKeys=[], and a target Lambda labeled Event Worker with role/logs. Use only the supported source/detail enums; no invented qa.orders or OrderCreated field values. Set Lambda timeoutSeconds=10. |
| E1  | Change only this rule's enabled setting to false.                                                                                                                                                                                                                                                                                                                                   |
| E2  | Change only this same rule's enabled setting to true, preserving its ID and exact event filters.                                                                                                                                                                                                                                                                                    |
| E3  | Change only Event Worker timeoutSeconds to 15.                                                                                                                                                                                                                                                                                                                                      |

Expected: bus/rule ownership, one exact target, invocation permission and event
workload binding. Disable/enable changes only the same rule; final worker
timeout is 15. A business OrderCreated format requires separate supported
contracts; export must not silently fabricate an arbitrary event pattern.

### AI-07: daily private report job

| ID  | Prompt body                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | Design an enabled EventBridge rule with triggerMode="SCHEDULE" and scheduleExpression="RATE_1_DAY", targeting a Lambda labeled Report Worker and a private output S3 bucket. Include invocation, execution role, logs and output-write permissions. Set worker memoryMegabytes=256 and timeoutSeconds=10. Report-content logic is unimplemented; no email or external data retrieval. |
| E1  | Change only Report Worker memoryMegabytes to 512.                                                                                                                                                                                                                                                                                                                                     |
| E2  | Change only Report Worker timeoutSeconds to 30.                                                                                                                                                                                                                                                                                                                                       |
| E3  | Disable only the daily schedule rule, preserving its interval, target and IDs.                                                                                                                                                                                                                                                                                                        |

Expected: schedule target and bucket write grant, no source-object notification
or unrelated networking. Final worker is 512/30; the same daily rule is
disabled. An infrastructure export must keep the disabled state and daily
interval.

### AI-08: private static origin with public HTTPS delivery

| ID  | Prompt body                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | Design CloudFront delivery for synthetic public website objects from a private S3 origin using origin access control, the default CloudFront hostname/certificate, HTTPS redirect and index.html. Include an explicit custom cache policy with minTtl=0, defaultTtl=60 and maxTtl=300. No custom domain, SPA fallback or generated website source. |
| E1  | Change only this custom cache policy's defaultTtl to 120.                                                                                                                                                                                                                                                                                          |
| E2  | Change only the same cache policy's maxTtl to 600.                                                                                                                                                                                                                                                                                                 |
| E3  | Change only the same cache policy's defaultTtl to 300.                                                                                                                                                                                                                                                                                             |

Expected: origin access control, scoped bucket policy and exact cache
association. The origin stays private while viewer delivery is public. Final
TTLs are 0/300/600; policy identity and origin/behavior references remain.
minTtl is fixed at zero in this catalog. Export must preserve the private-origin
boundary.

### AI-09: private PostgreSQL foundation

| ID  | Prompt body                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | Propose a private PostgreSQL 16 RDS foundation: VPC 10.42.0.0/16, private subnets 10.42.1.0/24 in us-east-1a and 10.42.2.0/24 in us-east-1b, explicit route table associations, DB subnet group, TLS-enforcing parameter group and DB security group with no public ingress. Use RDS-managed master authentication and encrypted gp3 storageGiB=20, backupRetentionDays=7, deletion protection and retention. Use supported instanceClass=db.t4g.micro. Ask for any engine, name or account-specific input that remains required; never invent a secret or claim actual AWS availability. |
| E1  | Change only the DB instance's backupRetentionDays to 14.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| E2  | Change only that DB instance's storageGiB to 40.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| E3  | Change only that DB instance's backupRetentionDays to 21.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Expected: a private, reference-complete topology if sufficient inputs are given,
or blocking questions with no changes. Missing engine/name inputs must not
become fabricated defaults. If C is questions-only, E1-E3 and export remain
blocked; further answers need parent-approved request allocation. If a graph is
admitted, final DB values are 40 GiB/21 days and protection/network identities
remain. Schema validation is not real-account provisioning or engine
availability proof.

### AI-10: container foundation with missing image input

| ID  | Prompt body                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C   | Propose a private ECS Fargate foundation for a TypeScript service on port 8080: cluster, task definition, container, service, ECR repository, role/logs and required private network relationships. Set task cpu=256 and memoryMiB=512, non-root user, read-only root filesystem and service desiredCount=0. No published image digest has been supplied. Do not invent or fetch an image or claim the service is runnable; ask for a required image binding before proposing an unusable replacement. |
| E1  | If the referenced task is editable, change only cpu to 512 and memoryMiB to 1024. Otherwise ask the exact blocking question with no changes.                                                                                                                                                                                                                                                                                                                                                           |
| E2  | Change only that same task's cpu to 1024 and memoryMiB to 2048, preserving service desiredCount=0 and all existing identities.                                                                                                                                                                                                                                                                                                                                                                         |
| E3  | Explain the missing image/runtime inputs and exact next manual step. Make no graph changes and do not claim a built or runnable application.                                                                                                                                                                                                                                                                                                                                                           |

Expected: explicit unresolved image input, no placeholder masquerading as a
published artifact, no execution and no desired-count activation. Questions-only
C blocks dependent edits. An admitted partial foundation is not a runnable
service or complete deployment export; the missing image remains a blocker.

## Stale, interrupted and failed work controls

Use these controls within planned requests, or as synthetic tests. Do not add
paid requests beyond the parent's allocation merely to fill a checklist.

| Control                      | Action                                                                                                                                            | Expected result and required evidence                                                                                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 stale while pending       | During one planned edit, make and save a small manual change before its response is admitted                                                      | Draft/baseline check refuses stale delivery; no old proposal overwrites the newer graph. Record the actual credit receipt; do not infer no charge.                                                                                                                            |
| S2 stale after review        | Receive a planned proposal, make a manual change before Apply, then try the old preview                                                           | Explicit rejection or disabled Apply; the latest draft and unrelated IDs remain. Rejected apply is not a completed edit.                                                                                                                                                      |
| S3 proof mismatch            | Synthetic only: start from a valid v6 creation response, remove its proof or change its architecture, catalog, proposal, command or result digest | No enabled Apply and a useful fixed error. Existing editor and creation review must enforce the same binding; no model call is needed.                                                                                                                                        |
| I1 cancellation              | Use Cancel during one planned queued/running request, including a simulated POST-response delay                                                   | Finish exact admission/cancel the exact job; no second POST or duplicate reservation. Preserve the saved project and observe the real terminal credit state.                                                                                                                  |
| I2 uncertain POST/retry      | Synthetic lost-response fixture, followed by an identical request with the same project/ETag/baseline in the same tab                             | Same idempotency key and one reservation; no downgrade. Changed prompt or baseline is a distinct request. Live use only if naturally encountered and still inside the approved allocation.                                                                                    |
| I3 hidden tab                | Hide one planned in-flight request's tab and return                                                                                               | Durable job continues; browser status reads resume on visibility with current auth, without a second generation request.                                                                                                                                                      |
| I4 completed proposal/reload | Reload after a response was delivered but before applying it                                                                                      | Current handoff is RAM-only with a 30-minute lifetime: the unaccepted preview is not automatically restored after reload. Saved graph remains intact and no automatic paid redispatch occurs. Record this recovery limitation, rather than a successful proposal restoration. |
| E1 unavailable version       | Read normal availability on a server without v6                                                                                                   | Visible unavailable/manual path and no paid fallback; distinguish source not deployed from provider inference failure.                                                                                                                                                        |
| E2 denied/expired session    | Synthetic 401/403 and stale 412 responses; live only through naturally observed state                                                             | Locally classified sign-in/access/save guidance; one admission attempt, no raw remote message, no permission change.                                                                                                                                                          |
| E3 malformed/failed result   | Synthetic shape/root/proof failures, or an actual terminal model failure                                                                          | Original diagram unchanged; strict rejection and request reference. Refresh actual credit receipt; released/not-metered is no-charge, unavailable is unknown. Stop repetitive paid retries and retain fixed diagnostic categories.                                            |

Do not force these controls by changing security settings, signing out the user,
disconnecting credentials or altering shared network configuration. A reload
cannot prove new-account creation, email verification or a model-quality pass.

## Export and application-code handoff

After each admitted baseline and completed edit sequence, validate the saved
draft and create an immutable solution revision through normal UI. Preserve
revision, semantic/workload/catalog/compiler bindings and the exact export job.
Request only an enabled target, inspect the real downloaded archive and its
manifest/template/diagram contents, and compare them to that revision. A denied
entitlement, missing artifact, stale binding or failed compile is a blocker or
failure, not a successful export. Undo/Redo and reload must preserve the same
deployment identities.

The production source advertises CloudFormation **infrastructure-only** export
when its existing service is configured.
`applicationSources=["ai-source-draft-v3"]` means optional source-draft
capability, not an approved runnable build executor. The default
application-generator/build stages remain refusal adapters until an
independently approved host composes qualified stages. An architecture purpose
or infrastructure-only Lambda is not a complete typed application contract.

Hand application work to its owner with immutable revision ID,
workload/operation and trigger bindings, unresolved requirements, current source
capability, generation job/artifact identity, actual archive bytes and
validation reports. The owner must distinguish source generation, static
validation, compilation, tests, packaging, runnable local/backend behavior and
deployment. No flag, credentials, budget, billing policy or executor may be
changed by this runbook.
