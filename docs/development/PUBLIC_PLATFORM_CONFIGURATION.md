# Platform configuration in this source distribution

The included CDK package describes the AWS platform architecture. Its checked-in
account `000000000000`, `beta.example.invalid` origin, provider IDs, VPC and
subnet IDs are **non-deployable examples**. They are not an account, hosted
environment, entitlement, or permission to activate billing, GitHub connections,
or infrastructure export. Local editor and standalone core use do not need them.

An operator considering a hosted installation must supply their own AWS target,
public domain and certificate, network, provider application IDs, secret
references, and billing products where applicable. These must be reviewed
together with the environment's exact-account/Region validation, role scope,
data retention and release checks before any deployment. Do not insert secret
values into source, CDK context, logs or this repository. The omitted private
beta runbooks and historical deployment evidence do not establish acceptance for
another account.

Start with the [platform package](../../infra/platform/README.md),
[system overview](../architecture/SYSTEM_OVERVIEW.md), and
[local development](LOCAL_DEVELOPMENT.md). Cloud provider contracts and the
deterministic customer IaC compiler remain in this distribution; customer
artifacts are generated and reviewed separately from deploying this platform.
