# Platform infrastructure instructions

These rules specialize the repository [instructions](../../AGENTS.md) for
`infra/platform`.

- This package is an AWS CDK delivery adapter, not a home for product domain
  behavior or provider-neutral contracts.
- The platform has four resource-bearing capability/lifecycle stacks:
  Observability, Stateful, Application, then Edge. Preserve their one-way
  dependency order and the platform/customer-IaC separation. Local synthesis
  verifies these definitions; an existing deployed beta does not grant a task
  permission to deploy or extend its activation scope.
- The reviewed development account/Region are non-secret synthesis coordinates,
  not deployment authority. Staging and production require separate explicit
  targets. Add no deploy or bootstrap command, credential requirement, AWS
  lookup/call, deployment workflow, customer-cloud permission, or customer-IaC
  execution path.
- Synthesis must remain local, deterministic, and credentialless. The root
  verifier must prove exactly four nonempty development templates and review
  IAM, secret, customer-IaC, and deployment-command boundaries without
  contacting AWS.
- Use least-privilege IAM and explicit tenant/data boundaries. Do not hide
  permissions in convenience constructs or broaden the reviewed wildcard
  allowlist without a new security review and test evidence. In particular, the
  KMS literal Resource `"*"` exception applies only inside `AWS::KMS::Key`
  `KeyPolicy` with the exact enumerated account-root key-admin actions or exact
  `kms:Decrypt`, `kms:GenerateDataKey`, and
  `kms:GenerateDataKeyWithoutPlaintext` publisher actions and reviewed
  source-account/source-ARN conditions; wildcard Actions remain forbidden.
- Preserve runtime validation of the exact feature-key set and Boolean values
  and the SQS worker-concurrency minimum of two before configuration affects IAM
  or event-source mappings.
- A non-production `DESTROY` policy must not auto-empty buckets. Any future
  cleanup must explicitly target the exact development buckets, versions, and
  delete markers through a separately reviewed operator action.
- Keep generated `cdk.out` untracked. Do not suppress CDK warnings broadly.
- Preserve the documented TypeScript exact-optional compatibility exception only
  as narrowly as current CDK declarations require.

For infrastructure changes, use `pnpm check:infra` and `pnpm security:check`
under the root [verification cadence](../../AGENTS.md#verification-cadence).
Review with the security, correctness, dependency, and generated-files sections
of [CODE_REVIEW.md](../../docs/engineering/CODE_REVIEW.md).
