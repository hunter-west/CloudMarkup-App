# ADR-0034: Provider-neutral ModelGateway boundary

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

- **Status:** Accepted
- **Date:** 2026-08-20
- **Owners:** Cloud Markup engineering
- **Supersedes:** None
- **Superseded by:** None

## Context

Cloud Markup needs AI assistance for requirements extraction, architecture and
workload planning, bounded repository interpretation, explanations, and custom
application or IaC candidates. Canonical solution documents, the versioned
command engine, source ownership, Evidence, async jobs, and the commercial usage
ledger already own their respective truths. A model cannot become an alternate
domain, repository, billing, compiler, or deployment authority.

Provider capability, model quality, entitlement, budget, and evaluation results
will change independently. The domain must not import Amazon Bedrock or another
provider SDK, hard-code a model identifier, or trust a browser-selected model.
Machine-consumed output also needs a stable compatibility boundary; prompt prose
or provider-native response shapes are not sufficient contracts.

## Decision

Introduce `@cloudmarkup/model-gateway` as the provider-neutral AI boundary and
put its versioned wire schemas in `@cloudmarkup/schemas`.

ModelGateway v1 exposes named operations for intent extraction, blocking
questions, architecture/workload/external-resource and operation proposals,
repository interpretation, issue and deterministic-fix explanations, AI-proposed
fixes, application and Terraform/CloudFormation candidates, bounded repair, and
plain-language or technical summaries. Requests and responses are strict
discriminated unions. Every machine-consumed response must pass the v1 schema
plus deterministic provenance, catalog, evidence-grounding, ownership,
dependency-approval, validation-expectation, and tool-authority checks.

Routing selects configured roles rather than embedded model names: low-cost
extraction/help, standard planning/generation, deep architecture/custom
generation, repair/escalation, and an optional fallback. Selection uses trusted
complexity, plan entitlement, budget, requested assistance mode, configured
provider capabilities, and versioned evaluation results. Browser claims cannot
choose a provider, model, inference profile, or price tier.

Provider adapters receive a reviewed prompt template and strict invocation data
with exactly one operation-specific schema-only response tool. That response
channel grants no execution authority, and prose or an unknown tool name cannot
be consumed as machine state. Amazon Bedrock is the first production provider
family represented by the capability contract; future providers implement the
same adapter without changing domain code. Prompt 34 supplies no Bedrock SDK,
credentials, Region, or live invocation.

Reviewed prompts live in separate owned source files with stable template IDs,
semantic versions, digests, operation ownership, and categories. Default logs
contain safe metadata, hashes, counts, and results only. Prompts, model
responses, secret values, and unrestricted customer content are excluded.

Invocation descriptors bind organization, user, project, Solution Revision,
repository snapshot, job, feature, provider/model/inference profile, prompt,
idempotency, input digest, and zero tool authority. Normalized usage records
input, output, cache, and thinking units plus the result. The injected usage
recorder fails closed but owns no reservation, settlement, release, expiry,
adjustment, pricing, or reconciliation transition.

Generated output is untrusted candidate data inside an exact candidate-artifact
boundary. Dependency/module/provider requests require a request-declared and
operator-allow-listed approval path. The gateway cannot retrieve arbitrary URLs,
write files, mutate repositories, install packages, call a shell, compile,
deploy, access payments, or mutate solution truth. Deterministic fake adapters
cover every operation for local development and CI.

The first versioned Bedrock capability registry represents Claude Sonnet 5 as
the `standard-design` candidate and Claude Opus 5 as the `deep-design` and
single `internal-escalation` candidate. Standard is available to Starter and
Pro. Customer-selected Deep requires Pro plus accepted estimate confirmation.
Internal escalation is permitted at most once after a Standard deterministic
validation, build, compiler, or supported-coverage failure; it preserves the
original result and sanitized-diagnostics digest and adds zero customer credits
beyond the accepted estimate. The records are unevaluated lifecycle candidates,
so this decision does not enable a live provider path.

Route selection is a pure strict-schema policy over trusted complexity, plan,
credit authorization, requested mode, environment, configured capabilities, kill
switches, and evaluation results. Models and browsers cannot select the route,
effort, retry count, entitlement, price, or model. Prompt-cache keys bind
content digests to organization-safe policy scope, residency, provider/model
configuration, capability, prompt, catalog, and schema versions; cache content
cannot cross tenant or residency boundaries.

## Consequences

### Positive

- Domain and provider contracts stay independent of Bedrock and model churn.
- Strict schemas and deterministic checks make invalid or unsafe output fail
  closed before it reaches a review or command boundary.
- Exact prompt/model/source provenance and normalized usage support later audit,
  evaluation, and commercial integration without logging raw content.
- Local development and CI remain deterministic and require no model account,
  credentials, network, or spend.

### Negative

- Adapters must translate provider-specific structured output and usage into the
  gateway contracts and reject missing metadata.
- Adding an operation, prompt version, routing role, capability, or output shape
  requires explicit compatibility and evaluation work.
- The boundary intentionally cannot perform convenient tool calls or directly
  materialize a candidate; callers need separate reviewed services for those
  actions.

### Follow-up

- Prompt 34A may integrate durable commercial reservation/metering only through
  the existing usage-ledger authority.
- A later prompt must review the production Bedrock adapter, enabled models,
  Regions, retention, IAM, timeout, retry, and evaluation configuration before
  any live call.
- Candidate validation, acceptance, materialization, and any repository workflow
  remain separate authorization and Evidence boundaries.

## Alternatives considered

### Import Bedrock directly into application or domain services

Not selected because provider SDK types and model identifiers would leak into
canonical semantics and make later provider or routing changes invasive.

### Expose a generic chat completion or tool-calling interface

Not selected because an open-ended surface cannot express operation-specific
bounds, provenance, ownership, evidence grounding, or the prohibition on shell,
repository, compiler, payment, and deployment authority.

### Hard-code one model per operation

Not selected because capability, cost, entitlement, mode, availability, and
evaluation quality are deployment decisions. A stable role is the durable
contract; a model identifier is not.

### Accept provider JSON and validate it only in each caller

Not selected because validation and safe telemetry would diverge across callers,
and malformed or oversized responses could cross the trust boundary before a
common fail-closed check.

## References

- [ModelGateway architecture](../architecture/MODEL_GATEWAY.md)
- [System overview](../architecture/SYSTEM_OVERVIEW.md)
- [Security principles](../architecture/SECURITY_PRINCIPLES.md)
- [Billing and usage](../architecture/BILLING_AND_USAGE.md)
- [Testing strategy](../architecture/TESTING_STRATEGY.md)
- [ADR-0010](0010-ai-credits-usage-ledger.md)
- [ADR-0025](0025-canonical-solution-repository-and-evidence-contracts.md)
- [ADR-0026](0026-provider-neutral-durable-async-job-framework.md)
- Prompt 34 execution plan
- Prompt 34R routing plan
