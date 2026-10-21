# ADR-0041: Cross-account beta DNS ownership and CloudFormation trust

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-09-01
- **Owners:** Cloud Markup product, platform, operations, and security
- **Supersedes:** None
- **Refines:** ADR-0005, ADR-0011, ADR-0012, ADR-0027, ADR-0028, and ADR-0040
- **Superseded by:** None

> Public examples below use synthetic DNS account, hosted-zone, and repository
> identity values. Exact operations values remain in the private repository.

## Context

The Cloud Markup beta application target is AWS account `000000000000` in
`us-east-1`, while the existing authoritative `cloudmarkup.com` Route 53 hosted
zone belongs to DNS account `000000000001`. The beta hostname is
`beta.example.invalid`. CloudFront is the public application ingress. Its ACM
viewer certificate must be owned by the application account in `us-east-1`, even
though DNS validation and public routing records are owned by the DNS account.

Copying the hosted zone into the application account would create split
authority. Giving the GitHub OIDC entry role or a cross-account delivery role
direct Route 53 permissions would mix deployment orchestration with DNS
execution and expose a broader live-data boundary than delivery requires.
Certificate setup also precedes the CloudFront distribution, so certificate
validation and final application aliases must be separate, ordered
CloudFormation operations.

The repository needs a repeatable main-branch delivery path without static AWS
keys or direct DNS mutation. Account IDs, role ARNs, synthesized templates, and
unexecuted workflows remain configuration rather than live evidence. This
decision must not authorize customer-IaC execution, product-runtime DNS access,
or unrelated hosted-zone changes.

## Decision

### Resource ownership

AWS account `000000000001` remains the sole authority for hosted zone
`ZSYNTHETIC123456` and every `beta.example.invalid` Route 53 record. AWS account
`000000000000` owns the beta application, its CloudFront distribution, and its
`beta.example.invalid` ACM certificate in `us-east-1`.

Native CloudFormation owns the durable bootstrap resources:

- the application-account GitHub OIDC entry role, beta-specific CDK deploy,
  file-publishing, lookup, and CloudFormation execution roles, and DNS
  assumption policy;
- the application-account ACM certificate;
- the DNS-account delivery and CloudFormation execution roles; and
- the DNS-account certificate-validation and application-alias records.

The application CDK receives `BETA_CREATE_DNS_RECORDS=false`. It does not look
up, import, create, or modify the hosted zone or its records. The product
runtime and the customer-IaC compiler remain outside every role in this trust
path.

### Application-account GitHub entry role

The application account owns the retained CloudFormation-managed role
`arn:aws:iam::000000000000:role/CloudMarkup-Beta-GitHub`. Its web-identity trust
is limited to the existing GitHub OIDC provider, audience `sts.amazonaws.com`,
and exact protected `Development` environment subject
`repo:sample-owner@135792469/CloudMarkup-Operations@246813580:environment:Development`.
The role is tagged `Environment=beta`, `ManagedBy=CloudFormation`, and
`Project=CloudMarkup`.

This dedicated role may assume only
`arn:aws:iam::000000000000:role/CloudMarkup-Beta-CDK-Deploy`,
`arn:aws:iam::000000000000:role/CloudMarkup-Beta-CDK-File-Publishing`, and
`arn:aws:iam::000000000000:role/CloudMarkup-Beta-CDK-Lookup`, and it may read
only the `us-east-1` API Gateway account preflight. The file-publishing role is
limited to the beta asset bucket and prefix, while the lookup role is read-only
over the four beta stacks and the beta bootstrap-version parameter. The deploy
role may mutate only `cloudmarkup-beta-observability`,
`cloudmarkup-beta-stateful`, `cloudmarkup-beta-application`, and
`cloudmarkup-beta-edge`, and may pass only
`arn:aws:iam::000000000000:role/CloudMarkup-Beta-CloudFormation-Execution` to
CloudFormation. That execution role trusts only CloudFormation and receives the
fixed data, operations, application, and edge execution policies.

The GitHub entry role's separate retained policy permits `sts:AssumeRole` and
`sts:TagSession` only for `arn:aws:iam::000000000001:role/CloudMarkup-Beta-DNS`.
It has no Route 53 permission and cannot assume either CloudFormation execution
role directly. The legacy shared `CloudMarkup-GitHub` role is not part of this
beta trust path.

Allowing `sts:TagSession` on both the source permission and destination trust is
intentional: GitHub's role-chained session tags can cross the account boundary
without broadening the exact-principal or exact-resource restrictions. No static
AWS access key is stored in GitHub or the repository.

### DNS-account delivery boundary

The DNS account owns the retained role
`arn:aws:iam::000000000001:role/CloudMarkup-Beta-DNS`. Its trust policy names
only the exact `CloudMarkup-Beta-GitHub` role and permits only `sts:AssumeRole`
and `sts:TagSession`. It does not trust an account root, a wildcard principal,
an arbitrary GitHub subject, a user, or a product runtime.

This delivery role has no Route 53 permissions. It may read and update only the
exact retained CloudFormation stack
`arn:aws:cloudformation:us-east-1:000000000001:stack/cloudmarkup-beta-dns-records/*`
and may pass only
`arn:aws:iam::000000000001:role/CloudMarkup-Beta-DNS-CloudFormation`,
conditioned on `iam:PassedToService=cloudformation.amazonaws.com`.
CloudFormation's service role remains attached to the records stack for later
updates, so delivery does not acquire the execution role's DNS authority.

### DNS-account execution boundary

The separate retained
`arn:aws:iam::000000000001:role/CloudMarkup-Beta-DNS-CloudFormation` role trusts
only `cloudformation.amazonaws.com`. It scopes Route 53 reads and changes to
hosted zone `ZSYNTHETIC123456`. Within that zone it may reconcile only:

- the exact `beta.example.invalid` A and AAAA aliases; and
- a single-label `_*.beta.example.invalid` CNAME used for ACM validation.

Nested validation names are explicitly denied. The role can poll Route 53 change
stabilization and use `ListResourceRecordSets` only because CloudFormation needs
that read to reconcile the narrowly scoped records stack. That shared-zone read
is not exposed to GitHub or the cross-account delivery session. The execution
role has no hosted-zone creation, domain-registration, DNSSEC, health-check,
IAM, or unrelated-record authority.

### Certificate and output-bound records

The retained application-account certificate deliberately omits `HostedZoneId`
because validation occurs in another account. Its stack can remain
`CREATE_IN_PROGRESS` until an authorized operator deploys the DNS records stack
with ACM's exact validation CNAME name and value.

The records stack retains the validation CNAME with `DeletionPolicy` and
`UpdateReplacePolicy`. A later main-branch delivery updates that same stack,
preserves the validation parameters with `UsePreviousValue`, and supplies only
the exact CloudFront `DnsTarget` emitted by the deployed application. The stack
then owns retained A and AAAA aliases for `beta.example.invalid` using
CloudFront hosted zone `Z2FDTNDATAQYW2`. An omitted alias target cannot create
aliases, and an alias update cannot silently replace or remove certificate
validation.

### Evidence, compatibility, and rollback

Policy and template tests must reject alternate principals, accounts, stack
ARNs, service roles, hosted zones, record names, record types, and direct Route
53 permission on either delivery role. Deployment evidence must bind the
CloudFront output, DNS stack update, Route 53 stabilization, and smoke result to
the delivered source revision.

The retained resources favor recoverability over automatic deletion. Rollback or
stack deletion therefore does not remove the certificate, validation CNAME,
aliases, or IAM roles; an authorized operator must review and remove retained
resources explicitly. This decision changes no tenant-data schema, migration,
public API version, provider-neutral domain contract, or customer-IaC behavior.

The templates and workflow do not by themselves prove that any stack, role,
certificate, or record exists. Acceptance records the reviewed ownership and
trust decision; it does not claim that the final A/AAAA aliases exist or that
public routing succeeded. Live, sanitized readback is required before beta
readiness can be claimed.

## Consequences

### Positive

- DNS ownership remains singular and explicit across accounts.
- The GitHub entry and DNS delivery roles cannot mutate Route 53 directly.
- CloudFormation operations are bounded to one stack and one exact service role,
  while DNS execution is isolated behind CloudFormation service trust.
- The dedicated beta entry role avoids expanding a legacy shared deployment role
  and supports exact contract validation.
- Certificate validation survives later output-bound alias updates.
- Static AWS credentials, customer deployment authority, and product-runtime DNS
  access remain outside the delivery design.

### Negative

- Authorized operators must bootstrap retained stacks in two accounts and
  coordinate the certificate validation CNAME while the certificate stack is
  waiting.
- The DNS execution role can list every record in the shared hosted zone because
  CloudFormation reconciliation requires `ListResourceRecordSets`; the
  permission cannot be restricted by record-name condition keys.
- Retained resources are not automatically removed by rollback or stack deletion
  and therefore require explicit inventory and cleanup decisions.
- Role chaining, session tagging, a sticky CloudFormation service role, and
  cross-account evidence add operational steps that focused policy tests and a
  runbook must preserve.

### Follow-up

- Deploy and read back the application-account role and certificate stacks and
  the DNS-account bootstrap and records stacks with sanitized evidence.
- Keep negative tests for alternate trust principals, missing `sts:TagSession`,
  broader CloudFormation or `iam:PassRole` resources, direct delivery-role Route
  53 actions, and record-scope drift.
- Keep the records-stack update bound to the deployed CloudFront output and
  preserve the ACM validation parameters on every alias update.
- Do not treat this accepted decision as live alias proof; keep beta readiness
  gated on all independent release checks, DNS readback, and public smoke tests.

## Alternatives considered

### Create or import the hosted zone in the application CDK

Rejected because it would duplicate or ambiguously own the existing DNS
authority and couple application-stack deployment to DNS-account state.

### Reuse the legacy shared `CloudMarkup-GitHub` role

Rejected because beta delivery has a durable, exact trust and permission
contract. A dedicated CloudFormation-owned role makes that contract reviewable
without expanding or depending on a shared legacy principal.

### Grant Route 53 permissions to the application-account entry role

Rejected because Route 53 resources live in another account and direct
permission would erase the explicit cross-account audit boundary.

### Grant Route 53 permissions to the DNS delivery role

Rejected because delivery needs only to update one CloudFormation stack and pass
its exact service role. Combining orchestration and execution would expose DNS
authority to the GitHub-chained session and make the stack service-role boundary
ineffective.

### Trust an account root or principal wildcard

Rejected because unrelated principals could acquire deployment or DNS authority.
Both hops name exact principals and resources.

### Omit tagged-session permission

Rejected because GitHub's role-chained session needs `sts:TagSession` allowed by
the source policy and destination trust. Allowing it does not replace the exact
principal and resource bounds.

### Create final aliases during certificate setup

Rejected because the CloudFront distribution and its immutable deployment output
do not yet exist. Aliases are added only after application deployment and are
bound to that output.

## References

- [ADR-0005](0005-export-without-deploy.md)
- [ADR-0011](0011-separate-platform-and-customer-iac.md)
- [ADR-0012](0012-staged-deployment-configuration.md)
- [ADR-0027](0027-aws-platform-capability-lifecycle-topology.md)
- [ADR-0040](0040-regional-rest-ingress-origin-admission.md)
- Application-account GitHub role template
- Application-account certificate template
- DNS-account bootstrap template
- DNS-account records template
- [AWS platform deployment architecture](../architecture/AWS_PLATFORM_DEPLOYMENT.md)
- Controlled-beta threat model
- Beta deployment runbook
- Beta DNS and outputs
- Simplified beta deployment plan
- Controlled-beta readiness
