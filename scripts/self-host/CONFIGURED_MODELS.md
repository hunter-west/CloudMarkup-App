# Configured proposal and export candidate

This is the same application and image as the core route. A disposable local
PostgreSQL 17 installation and authenticated browser have exercised a configured
infrastructure-only export through durable job execution and verified ZIP
download. That synthetic result does not establish hosted release, live model
provider support/cost, application-code generation or every restore scenario.

The current implemented targets are durable architecture proposals, with a
server-owned OpenAI Responses key, and infrastructure-only CloudFormation ZIP
exports using the packaged Go compiler, icons and exact SFNT fonts.
Deterministic exports require no model key. Terraform execution, application
source/build, repository delivery, conformance and project erasure remain
unavailable here. The shared model gateway supports application-source calls,
but this artifact does not advertise an application-source workflow without its
real child worker and native build admission. Hosted beta keeps its existing
funding defaults.

## Export configuration without a provider key

Start from [runtime.example.json](./runtime.example.json), retain its identity,
database and server configuration, and replace only `adapters.solutionExports`:

```json
{
  "adapterReference": "self-host.solution-exports-v1",
  "configurationReference": "operator.exports",
  "credentialReferences": []
}
```

Add this server-only entry to `credentialSources`:

```json
{
  "operator.exports": {
    "kind": "file",
    "path": "/opt/cloudmarkup/export/native-export-settings.json"
  }
}
```

The shared image build generates this file from its actual compiler bytes and
the existing hosted asset collector/profile. Do not substitute a copied pin,
arbitrary tool path or ready Boolean. Runtime and every export stage recheck the
native profile and current `exports.run` authority. Freeze a new solution
revision with these exact compiler/diagram pins before exporting. A revision
requiring unsupported application generation refuses. No subscription, credit
grant or commercial balance is manufactured.

## Server-owned BYOK architecture proposals

Apply migration `0137` through the existing explicit standalone migration
procedure, preserving all existing checksums. Select `provider-direct-v1` in the
stage-specific provisioning document and use `providerDirectAclManifestSha256`
from the matching image's `bootstrap.mjs inspect` as its `aclManifestSha256`.
Run the existing explicit roles/ACL/check stages. The full policy includes all
three reviewed source inputs; the default `local-editor-core-v1` policy still
has only its two original inputs. Startup cannot create a role or grant access.

Set `adapters.proposalJobs` to:

```json
{
  "adapterReference": "self-host.proposal-jobs-v1",
  "configurationReference": "operator.proposals",
  "credentialReferences": []
}
```

Reference a private settings file containing
`{"schemaVersion":1,"pollIntervalMilliseconds":1000}`. Add `models` with
`fundingSource: "provider-direct"`,
`policyReference: "provider-direct-journal-v1"`,
`policyConfigurationReference: "operator.model-policy"`,
`maximumInFlightInvocations: 2`, `journalCloseTimeoutMilliseconds: 10000`, and
this `configuration` shape:

```json
{
  "contractVersion": 1,
  "provider": "openai-responses",
  "endpoint": "https://api.openai.com/v1/responses",
  "credentialReference": "operator.openai",
  "usageSemantics": "openai-responses-tokens.v1",
  "roles": {
    "architecture": {
      "model": "operator-reviewed-snapshot-2026-10-15",
      "maximumOutputTokens": 6144
    },
    "applicationSource": {
      "model": "operator-reviewed-snapshot-2026-10-15",
      "maximumOutputTokens": 12000
    }
  },
  "limits": {
    "maximumInputBytes": 1048576,
    "maximumRequestBytes": 2097152,
    "maximumResponseBytes": 1048576,
    "deadlineMilliseconds": 60000
  }
}
```

The two model strings above are deliberately invalid provider placeholders.
Choose actual supported, dated snapshots after checking the provider's current
model/deprecation documentation. There is no default model or key. Keep all four
references (`operator.proposals`, `operator.model-policy`, `operator.openai` and
the existing database/identity references) declared in `credentialSources`;
unused or unresolved references refuse. Only `operator.openai` contains the
provider key, in its private server-mounted file. Never place it in the browser,
Vite variables, build arguments, image layers, command arguments or logs.

The private model-policy document has this shape; choose explicit current UTC
quota times and real independent storage identity rather than copying them:

```json
{
  "contractVersion": 1,
  "quota": {
    "windowId": "operator.reviewed-window",
    "startsAt": "2026-10-15T00:00:00.000Z",
    "expiresAt": "2026-10-16T00:00:00.000Z",
    "maximumRequests": 100,
    "maximumOutputTokenUnits": "614400",
    "maximumConcurrent": 2
  },
  "statementTimeoutMilliseconds": 5000,
  "retainedDispatch": {
    "root": "/data/cloudmarkup-dispatch/records",
    "identity": "0000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

Both ordinary purpose journals share this exact quota. Expired, contradictory or
exhausted quotas refuse. Counts and output-token bounds are conservative spend
controls; they are not currency estimates or a guarantee of invoice cost.
Input/output/cached/reasoning usage is recorded without double-counting. Unknown
dispatch or usage remains held; there is no automatic paid retry or financial
completion. Provider invoices and the operator own monetary cost.

## Independently retained dispatch history

For configured models only, set absolute private paths outside the repository:

```text
CLOUDMARKUP_PROVIDER_DISPATCH_DIRECTORY=<operator-owned retained Linux directory>
CLOUDMARKUP_PROVIDER_DISPATCH_CONFIGURATION_SOURCE=<private offline approval JSON>
```

The foreground launcher selects the existing Compose file plus
`compose.models.yml`. Use durable Linux storage supporting the actual file,
hard-link and directory-fsync checks, owned by UID/GID `10001:10001`, with
private regular ancestry. Do not use NTFS/shared/ephemeral storage, a link or
the project object directory. The launcher does not create or change its
ownership.

The offline approval file contains `contractVersion: 1`,
`acknowledge: "new-independent-provider-dispatch-v1"`, the exact matching-image
`profileManifestSha256`, `objectRoot: "/data/cloudmarkup/objects"`, and
`settings` with the same retained `root` and operator-chosen 64-hex `identity`.
With the app stopped, initialize a **new** `records` directory exactly once:

```powershell
node --env-file=scripts/self-host/.env scripts/self-host/self-host.mjs models:initialize
```

The initializer has no network or database credential and cannot reset an
existing directory. The normal server never initializes it. Keep the complete
original directory, its physical identity, catalogue and all dispatch records
independently across SQL/object backups and restores. Only hashes are retained;
prompts, responses and provider credentials are absent.

An old SQL snapshot cannot reopen an existing retained job/role dispatch.
Missing records, a replaced root, unknown staging, an abandoned operation lock
or contradictory inventory refuses. Do not delete locks or recreate an empty
journal to recover readiness. Independent retention and recovery/restore
admission still require native evidence and an operator recovery procedure.
