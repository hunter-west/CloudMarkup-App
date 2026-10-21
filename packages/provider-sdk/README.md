# `@cloudmarkup/provider-sdk`

## Responsibility

Own the provider-neutral Provider Catalog contract version `1`, the separately
versioned connection-presentation and service-extension contracts, deterministic
compilation/validation and canonical hashing, Node-free read-only accessors, and
reviewed implementation-registration interfaces.

The strict semantic catalog contract covers:

- provider and catalog metadata;
- resource and semantic-boundary node kinds;
- allowed parent types and placement rules;
- bounded Draft 2020-12 configuration JSON Schema plus UI hints;
- literal/reference source and security/cost impact metadata for every
  configuration field;
- exact typed input/output capability ports with direction, required state, and
  aggregate one/many cardinality;
- authoritative exact-port connection rules with
  per-source/per-target/endpoint-pair maxima, configuration, questions/defaults,
  generated supporting changes, IAM effects, missing-information findings,
  lifecycle, and implementation status;
- validation-rule descriptors and TypeScript registrations;
- Guided and Professional educational content plus Cloud Markup and official
  HTTPS documentation references;
- metadata-only or implemented Terraform and CloudFormation mapping
  declarations;
- known or explicitly unknown region availability;
- catalog migration descriptors and reviewed migration implementations;
- opaque icon IDs that carry no file path or runtime image dependency; only a
  graph-only, nondeployable internal configuration concept may explicitly omit
  one; and
- explicit unsupported-capability records for deliberately bounded services.

Connection-presentation v1 binds one exact catalog ID, version, and digest. It
assigns every semantic port to exactly one stable dock with a provider-neutral
category, label, description, boundary placement, order, direction policy,
explicit cardinality range, multiplicity/exclusivity facts, and
Guided/Professional assistance. It also supplies one concise label for every
connection rule. Dock IDs are presentation-only and never replace exact ports in
an Architecture edge.

Service-extension v1 binds the same exact catalog and supplies every service's
six-part target-readiness matrix plus graph-backed owned-configuration slots.
Slots declare graph binding, explicit range, allowed user/generated ownership,
adoption, policy kinds, readiness, and assistance. Shared canonical policy
contracts distinguish document kind from statement effect and type actions,
resource scopes, principals, conditions, lifecycle, and provenance.

## Compiler and accessors

`@cloudmarkup/provider-sdk/compiler` owns the Node.js hashing boundary. It
exports deterministic compilers for the semantic catalog, connection-
presentation artifact, and service-extension artifact plus deterministic
accessor-module renderers. Each compiler parses strict data, validates exact
references/bindings, normalizes unordered collections, emits canonical JSON, and
calculates a lowercase SHA-256 digest.

Semantic catalog compilation rejects duplicate identities, inconsistent schemas
and UI hints, broken endpoint/binding references, cardinality drift, invalid
migrations/regions, unsupported mappings, and false maturity claims.
Presentation compilation additionally proves exact catalog binding, total
one-dock-per-port assignment, direction/range/multiplicity consistency, unique
dock ID/order, and one label per rule. Service-extension compilation proves
exact catalog binding, one entry per service, unique and valid owned slots,
graph bindings, ownership/adoption/cardinality/policy-kind consistency, exact
target-readiness shapes, and exactly one semantic ownership relationship per
slot. Both extension compilers verify catalog content against its claimed
digest.

Generated TypeScript modules construct `ProviderCatalogAccessorsV1`,
`ProviderConnectionPresentationAccessorsV1`, or
`ProviderServiceExtensionAccessorsV1` over local JSON. The package root exports
contracts and read-only accessors without importing Node built-ins. Accessors
perform exact lookups without I/O, expose port-to-dock and
service-slot/readiness facts, and supply the provider/catalog-version-bound port
inventory consumed by Validation Engine v1. Semantic catalog accessors also
validate tagged configuration, apply reviewed defaults deterministically, reject
unknown fields, and return value-safe issues without echoing input data.

## Connection resolution

`createProviderConnectionResolverV1` pairs an exact catalog artifact with
reviewed TypeScript registrations. Compatibility discovery returns canonical
source-to-target candidates for exact endpoints, ports, nodes, or a generated
connection edit anchor, including explicit unavailable findings. A dock start is
only a presentation filter over its assigned semantic ports; a reviewed
candidate still identifies exact source and target ports before resolution.

Resolution validates catalog binding, direction, service/port compatibility,
effective port minimum/maximum occupancy, rule source/target/pair limits, strict
configuration, and recipe output. Duplicate nonexclusive endpoint pairs are
accepted or rejected by the exact rule and provider recipe rather than a global
duplicate check. It returns a Graph Command v1 atomic batch plus its preview;
the caller's document is never mutated.

Rules are the authoritative compatibility records. Services and capability ports
do not reciprocally name target-specific rules, so a provider can bind a generic
workload capability to a later service without modifying the workload
definition. Declared ports with no rule remain unsupported. Several semantic
ports and exact edges may share one presentation dock without becoming one
relationship.

## Owned configurations and policy contracts

The SDK's owned-slot and canonical-policy types are provider-neutral data
contracts. Providers use the existing Architecture graph for persisted owned
configuration: a typed node is bound to exactly one owner slot by an exact typed
edge. The slot contract carries range, allowed ownership, adoption, policy
kinds, readiness, and assistance; it does not create another command engine or
attachment store.

Canonical policy documents contain typed canonical statements and conditions.
Identity/generated policies forbid principals; trust/resource/service-grant
policies require them; non-trust statements require resource scope. Managed-
policy attachments and permissions boundaries remain distinct policy kinds.
Provider-owned projections and validators supply service/action, wildcard,
resource-binding, ownership, duplicate, and target-specific checks.

The resolver previews stable-identity editing, provenance-aware cleanup, and
explicit adoption. Editing verifies the complete generated recipe and returns
cleanup plus replacement as one atomic batch. Cleanup accepts only the stable
direct edge whose rule/version/relationship/ports/services exactly match its
resolver provenance. It closes over every generated node/edge from that exact
rule/version/operation, releases children and reference sources before their
dependencies, requires the direct edge to be removed, retains legitimately
shared generated resources, and rejects cycles, orphaned leftovers, and
adopted/customized resources. User-owned configurations are outside the
generated closure. Replaying a prepared cleanup after references change fails
the command disposition precondition atomically. Operation IDs are caller-
supplied deterministic seeds; the SDK does not use randomness, clocks, provider
retrieval, or network access.

## Trust and dependency boundary

Catalog artifacts contain data only. Connection, validator, and migration
implementations are reviewed TypeScript registrations paired with serialized
descriptors; the artifact never supplies callbacks, templates, module paths,
scripts, or dynamic imports. Catalog compilation, access, and connection
resolution perform no network retrieval.

The SDK depends inward on public schema and domain types. The domain and schema
packages do not depend on the SDK. This package contains no AWS SDK, UI,
persistence, model, credential, IaC rendering, cloud, or deployment behavior.

See [Provider catalog development](../../docs/development/PROVIDER_CATALOG.md)
for the authoring workflow.
