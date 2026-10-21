# Existing serverless catalog audit

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

Reviewed October 2, 2026 against the local 0.18.0 artifact and its actual
configuration and validation code. This supplements the 50-family plan; it does
not enlarge supported configuration or imply that every service property has
been audited.

Exa searched Lambda, S3, DynamoDB and HTTP/JWT documentation, then fetched the
relevant primary AWS pages. Current behavior below comes from the compiled
catalog and executable local checks. Proposed expansion remains separate from
confirmed defects.

## Current configuration and next implementation requirements

| Family      | Verified current slice                                                                                                                                                                                                           | Configuration and connection work still needed                                                                                                                                                                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lambda      | Node.js 24 ZIP functions; arm64/x86_64; 128/256/512/1024 MiB; 1–30 second timeout; reserved concurrency 1–100; tracing; reviewed VPC/event relationships.                                                                        | These are intentional curated limits, not AWS-wide maxima. Add other runtimes, memory values, ephemeral storage or packaging only with exact artifact/build/runtime evidence. Preserve separate invocation permission, execution role, event-source mapping and network association ownership.                                       |
| S3          | Private, versioned, retained general-purpose buckets; SSE-S3; bucket-owner-enforced ownership; bounded CORS/lifecycle configurations; direct Lambda and EventBridge notifications.                                               | Fix naming and overlapping-filter defects below. Expand KMS, SNS/SQS destinations, replication or public website modes only with destination policies, service-specific readiness and explicit ownership. Never imply an ACL grants access when owner-enforced mode disables ACLs.                                                   |
| DynamoDB    | PAY_PER_REQUEST; one string partition key; encryption required; configurable PITR and deletion protection.                                                                                                                       | Sort keys, number/binary key variants, TTL, indexes, streams, provisioned capacity and replicas need new schemas and renderers. Attribute definitions describe table/index keys, not all application fields. Streams require a separate Lambda poller and role actions; a read/write edge does not enable a stream.                  |
| API Gateway | HTTP protocol only; JWT authorization required; CORS disabled; reviewed Cognito issuer/audience and Lambda integration.                                                                                                          | CORS needs origins, methods, headers, credentials and OPTIONS behavior together. REST/WebSocket APIs, WAF applicability, private integrations and domains are separate variants. Route authorization must remain explicit rather than inferred from one API-level link.                                                              |
| Cognito     | Email alias, case-insensitive usernames, optional/required MFA, verified-email recovery, protected pool and controlled signup. Browser client has no secret, SRP/refresh support, token lifetimes and user-existence protection. | Hosted login/domain/callbacks, federation, custom attributes, passwordless modes and recovery combinations need explicit resources/contracts. Preserve immutable subject/username identity separately from mutable application handles. The platform's own account feature does not imply these customer-catalog capabilities exist. |

AWS documents broader
[Lambda runtime limits](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
including up to 900 seconds and 10,240 MiB. The catalog's smaller bounds should
be labeled as supported CloudMarkup choices. A memory or runtime expansion must
also update application packaging, validation and AI context.

[Lambda VPC access](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
needs compatible subnets/security groups and execution-role ENI permissions. A
public subnet alone does not give a Lambda function internet access.
[Lambda SQS integration](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
is a poller with at-least-once processing; idempotency, partial-batch failure
and visibility/retry behavior must be tied to the event-source mapping and
workload. Do not model it as an SQS push invocation permission.

The
[DynamoDB table resource](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dynamodb-table.html)
distinguishes key/index schema, capacity, streams, retention and protection.
Future editor menus should add these as specific resources/configurations with
replacement implications. No inference about an application's ordinary record
fields should silently create attribute definitions or indexes.

The
[HTTP JWT authorizer](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
checks issuer, audience and time claims; route scopes help distinguish access
tokens from ID tokens. The
[HTTP CORS contract](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html)
also has special OPTIONS behavior when a default route requires authorization.
CORS does not authorize a caller. Keep unsupported controls disabled until both
target mappings and denied browser cases exist.

[Cognito identity attributes](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-attributes.html)
separate the immutable username from mutable preferred username/aliases. The
[app-client resource](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cognito-userpoolclient.html)
separately governs OAuth callback, flow, scope, secret and token settings. A
profile display-name edit must never rewrite an identity or imply a sign-in
alias changed.

## Confirmed S3 corrections for a successor catalog

### General-purpose bucket names

The current bucketName schema accepts each of these correctly encoded string
configuration values:

- example..bucket
- 192.168.5.4
- xn--example
- sample--x-s3

The public awsCatalogV1.validateConfiguration call returned success for all four
on catalog 0.18.0. The schema checks length and a broad character pattern, but
does not reject these additional invalid forms. Inspection found both target
renderers consume the same configured name.

The
[AWS naming contract](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html)
rejects adjacent dots, IP-address formatting and reserved prefixes/suffixes. It
also distinguishes newer account-regional namespace names from the shared
namespace. The current resource has no namespace-selection contract; do not
accept a special namespace solely because its string fits the broad pattern.

Add a deterministic, versioned rule with an exact bucketName path and a plain
explanation. A compiler must reject the same invalid names before emitting a
download. Keep proposed replacements reviewable: renaming a deployed bucket can
replace the resource, so there is no automatic rename fix. Cover valid boundary
lengths, ordinary dotted names, reserved forms and namespace-specific suffixes.
Do not claim global availability from syntax validation.

### Overlapping direct notifications

A synthetic bucket with two direct Lambda notification edges for OBJECT_CREATED,
prefixes images/ and images/raw/, and the same .jpg suffix yields no
event-topology finding. Current code detects only an exact duplicate tuple of
bucket, event type, prefix and suffix.

[AWS filter rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-filtering.html)
also reject overlapping combinations for the same event types. An empty prefix
or suffix matches all names. Two prefixes overlap if one begins with the other;
two suffixes overlap if one ends with the other. For the current exact event
families, reject pairs only when the event sets intersect and both prefix and
suffix conditions can match the same key. Shared prefixes with disjoint suffixes
are valid and need explicit negative-control tests.

A successor rule must reference both offending edges and their exact filter
paths, with deterministic pair ordering and no destination chosen by AI. Cover
nested prefixes, nested suffixes, empty filters, different event types, disjoint
suffixes and unrelated buckets. Future granular event variants need event-set
intersection rather than string equality. Preserve historical rule behavior for
pinned older catalogs and update both compiler targets and AI planning
classifications with the successor descriptor.

[S3 destination permissions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/grant-destinations-permissions-to-s3.html)
and
[notification destinations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html)
also remain part of a complete notification operation. Same-Region resources,
Lambda resource policy and destination KMS/policy requirements must be checked
for each supported destination. SNS/SQS support cannot be inferred merely from
their presence elsewhere in the catalog.

## Reproduction and acceptance

The local audit used public provider-sdk, provider-aws and domain exports,
synthetic graph identities and correctly typed string values. It made no AWS
calls, executed no imported code and changed no architecture. The reproduction
selected the current event-topology rule alone; it establishes that rule's
missing overlap finding, not that an unrelated incomplete graph passed every
deployment-readiness check.

The next correction should be a bounded successor to the FSx catalog checkpoint.
Read the provider validation and mapping skills, preserve immutable historical
catalog/compiler behavior, add descriptor and compiler regressions, migrate
exact AI/catalog bindings, then run the applicable gates. No fix for these two
findings is included in the current FSx patch.

## Local successor verification

The S3 successor implements both reproduced corrections in exact catalog 0.19.0.
Naming is checked by the configuration schema, a field-specific validation rule
and both compiler targets. Notification validation compares decoded
prefix/suffix pairs, reports both affected routes and rejects malformed
encoding. Historical 0.18 behavior and artifacts remain preserved; reviewed
upgrades change no stored values. Focused historical, cross-target,
negative-control and reproducibility tests pass. Contracts, assets, compiler,
backend, web and golden workstream checks pass. Root recovery and full release
verification also pass, with original failed invocations and final-compiler
supplemental evidence recorded in the plan. The opening audit describes the
original 0.18 findings, not the corrected successor.

Further mapping review confirmed a third S3 defect: the old Terraform renderer
emits an empty eventbridge block, while the pinned provider defines a boolean
attribute. The
[6.63.0 provider source](https://github.com/hashicorp/terraform-provider-aws/blob/v6.63.0/internal/service/s3/bucket_notification.go)
and
[6.55.0 resource documentation](https://github.com/hashicorp/terraform-provider-aws/blob/v6.55.0/website/docs/r/s3_bucket_notification.html.markdown)
agree on eventbridge = true. The unpublished 0.19 successor now emits that
attribute. A parsed-HCL regression checks its boolean value, the single owning
notification resource and unchanged historical output. Older catalog exports
retain this known provider-schema limitation; upgrade explicitly for the fix.
