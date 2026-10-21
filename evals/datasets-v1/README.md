# Frozen synthetic evaluation dataset v1

`model-evaluation-v1.json` is the content-addressed Prompt 38 dataset. It has
exactly one synthetic case for every required architecture, repository,
generation, extension, adversarial, and repair scenario. Every case exercises
both Guided and Professional preferences against the same semantic authority.

The fixture contains no customer data, credentials, repository contents, or
live-model output. Repository inputs are represented by synthetic descriptions
in the canonical deterministic harness fixture and immutable content digests in
the JSON artifact. Normal CI may parse and score this dataset only with
deterministic tools or fake-model adapters.

Regenerate or verify it after building `@cloudmarkup/schemas` and
`@cloudmarkup/model-gateway`:

```powershell
node evals/datasets-v1/generate.mjs --write
node evals/datasets-v1/generate.mjs --check
```

Live evaluation is not authorized by this dataset or generator. Digest-bound
opt-in authority, a restricted environment, allow-listed model/prompt/schema/
catalog configuration, bounded canonical commercial authority, and an unengaged
reviewed kill switch are necessary but insufficient. Direct live runner attempts
fail with `model-evaluation.live-execution-port-required` before adapter or
judge invocation until a separately reviewed host-owned port atomically combines
a trusted-time fenced runtime lease with recovery-only state and cache-inclusive
capacity; persisted reservation intent/receipt plus read-only recovery;
stored-receipt canonical-status refresh in recovery-only mode; no generic
accounting expiration mutation or clock-only credit release; reservation-pinned
dispatch/reconciliation/outbox evidence; and deterministic validator Evidence.
Prompt 35's Bedrock adapter is not that evaluator port, and provider-backed live
evaluation remains absent from normal CI.
