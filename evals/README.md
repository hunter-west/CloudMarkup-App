# Evaluations

> Public distribution note: links to internal historical plans and operational
> records are omitted here; the retained text describes the original decision or
> design.

The frozen [full beta source](datasets-full-beta-v1/README.md) contains a
separately versioned 21-family dataset with Intent extraction and the exact
71-definition AWS 0.30.0 catalog. Its historical catalog artifact remains
available for exact model-input interpretation. The separately versioned
[regional WAF input](datasets-regional-waf-v1/README.md) binds the current
73-definition catalog. Both are input data only. Deterministic catalog support
does not issue provider observations, a hosted report or model promotion. The
historical suites below retain their original scope and artifacts.

Prompt 38 evaluation assets live here. The canonical source for the frozen
synthetic dataset is `frozenModelEvaluationDatasetV1` in
`packages/model-gateway/src/model-evaluation.ts`; the checked-in JSON under
`datasets-v1/` is a generated, byte-verified mirror.

Normal CI uses only network-free deterministic fake execution and deterministic
scoring. The default `FrozenSyntheticModelEvaluationAdapterV1` runner is
harness-contract smoke: its expectation-shaped observations verify the
evaluation contract but are not validator Evidence. Its policy digest binds the
exact frozen dataset ID/version/digest and scoring policy, and the runner
accepts only that dataset/policy plus its exact synthetic
route/model/profile/prompt/response-schema/catalog tuples. A schema-valid,
self-rehashed substitute fails before adapter or judge invocation. Every
required dimension must have applicable deterministic Evidence; zero-applicable
dimensions cannot pass. Optional model-judge scoring is reported separately and
cannot change a pass. Current evaluator execution hardcodes
`activationRecommendation: "hold"` with `capabilityActivated: false`. The
contract's reserved `eligible-for-reviewed-beta` value requires a future
separately reviewed, resolver-verified host recommendation authority and cannot
be emitted now. Live-evaluation records are providerless contracts with no
evaluator execution composition or CLI here. Prompt 35's Bedrock adapter is not
a live-evaluation execution port. The reviewed evaluation-policy, runtime policy
identity/version, cycle-free `runtimeControlConfigurationDigest`,
case/model/prompt/schema/catalog, environment, and budget authority is necessary
but not sufficient. The configuration digest excludes the final policy digest
and report-instance data; the final policy binds the report one-way.

Every direct live runner attempt fails with
`model-evaluation.live-execution-port-required` before adapter or judge use. A
future reviewed host-owned port must atomically combine a trusted-time fenced
runtime lease/revision, `recoveryOnly` state, and
quota/concurrency/cache-inclusive authority-capacity claim; persisted
`ModelCommercialReservationIntentV1`/`ModelCommercialReservationReceiptV1` plus
read-only `recoverExistingReservation` that refreshes stored receipts in
recovery-only mode, with no generic accounting expiration mutation or clock-only
credit release; reservation-pinned `ModelCommercialDispatchIntentV1` and
`ModelCommercialHostInvocationReceiptV1` plus reconciliation evidence, with
coordinator-owned or externally verified not-dispatched Evidence, explicit
compensated post-dispatch release, and atomic replay-drained
`ModelRuntimeTelemetryOutboxEntryV1` records; and deterministic validator
Evidence. This coordination state cannot replace canonical accounting. Until
then, these assets cannot execute or produce a live report.

- `datasets-v1/model-evaluation-v1.json` mirrors all 21 frozen case kinds and 19
  score dimensions.
- `datasets-v1/generate.mjs --check` verifies that mirror after the schemas and
  ModelGateway packages are built.
- `datasets-v2/model-evaluation-networking-v2.json` is an additive five-case
  suite for private database, avoid NAT, invalid CIDR, broad ingress, and
  multi-AZ requirements. It binds exact catalog-approved service, relationship,
  and configuration-field identifiers, accepts deterministic validator findings
  only from its allowlist, preserves managed-service and Lambda association
  semantics, and rejects automatic mutation. It does not alter the v1 dataset,
  policy, runner, or 21-case digest.
- `datasets-v2/generate.mjs --check` also verifies the networking mirror and
  checks its copied authority against the generated AWS catalog.
- `pnpm check:e2e:assistant-evaluation` runs the separate validator-backed
  fake-model E2E through concrete assistant, repository, application, Terraform,
  CloudFormation, security, ownership, and repair probes, plus a web companion
  that renders the actual `AssistantWorkspace` in both preferences for semantic,
  keyboard, and screen-reader parity. Repository cases materialize exact frozen
  fixture bytes, verify snapshot checksum/size/path/`sourceMode`, and reject
  digest/path/source-mode mutation. The E2E invokes the canonical workflow
  validator through the host Node executable with shell execution disabled and
  keeps its digest-bound CI-workflow-validity probe separate from the
  application-plus-Terraform generation-chain probe. Every case must exact-match
  its execution-derived issue severity, and every declared safety outcome and
  generation target must bind to named passing probe groups; evidence-removal
  mutations prove omissions are rejected. The gate has no network, live-model,
  repository-write, recommendation, deployment, or activation authority.
- `HUMAN_TEST_SCRIPTS.md` covers activation denial, evaluation, reconciliation,
  generation, safety, metering, accessibility, and operator-control flows.
- `../scripts/run-model-evaluation.mjs` prints the safe deterministic fake
  report and accepts no live/provider arguments; `pnpm eval:model:deterministic`
  is the normal entry point and is part of the full repository gate.

No customer data, credentials, raw prompts or responses, repository contents, or
generated candidates belong in evaluation fixtures or reports.
