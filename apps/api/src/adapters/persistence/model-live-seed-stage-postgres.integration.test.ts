import { waitForLiveAccountingPgTestWindow } from "./model-live-commercial-accounting-pg-test-helpers.js";

import {
  applyRepairExpiryProposalV4,
  applyRepairKnownFailureProposalV4,
  applyRepairRecordedReceiptProposalV4,
  applyRepairSuccessorCandidateProposalV4,
  applyRepairSuccessorDispatchProposalV4,
  applyRepairSuccessorInputProposalV4,
  applyRepairSuccessorUsageProposalV4,
  applyRepairTerminalAccountingProposalV4,
  applyRepairUnusedStageProposalV4,
  applySeedCandidateValidationProposalV4,
  applySeedCommercialReservationProposal,
  applySeedDispatchProposalV4,
  applySeedRuntimeAdmissionProposal,
  applySeedSequenceReservationProposalV4,
  applySeedSequenceRuntimeProposalV4,
  applySeedStageInputProposal,
  applySeedUsageObservationProposalV4,
  applySeedValidationProposal,
} from "./model-live-proposal-migrations-test-helpers.js";

import { executeProductionFinalSeedRepairV4 } from "../../production-model-live-repair-successor-dispatch.js";
import {
  syntheticRepairDispatchPricing,
  syntheticRepairFullWindowCost,
} from "../../production-model-live-dispatch-test-helpers.js";

import { BedrockGlobalFullWindowCostAuthority } from "../bedrock-global-pricing.js";

import { seedCandidateExecutionFixture } from "../../production-model-live-seed-candidate-test-helpers.js";
import { result as candidateCommandResult } from "../../production-model-live-host-runner-test-helpers.js";
import type { ProductionSeedCandidateHostConfiguration } from "../../production-model-live-seed-candidate-host.js";

import { randomUUID } from "node:crypto";
import { PostgresModelPlatformSpendStore } from "./model-platform-spend-store.js";
import {
  modelPlatformReservationInputSchema,
  modelPlatformReservationReceiptSchema,
} from "../model-platform-spend.js";

import { seedSequenceRuntimeAdmissionFixtureV4 } from "./model-live-seed-runtime-admission-v4-test-helpers.js";
import {
  prepareProductionSeedRepairRequestV3,
  prepareProductionSeedSequenceRequestV4,
} from "../../production-model-live-seed-request.js";
import {
  seedAccountingFixture,
  seedSequenceAccountingFixtureV4,
} from "./model-live-seed-commercial-accounting-test-helpers.js";

import { PostgresModelCommercialWorkflowStore } from "./model-commercial-workflow-store.js";
import { commercialClaim } from "./model-commercial-workflow-test-helpers.js";
import {
  plan as accountingPlan,
  charging as accountingCharging,
  entitlement as accountingEntitlement,
} from "./model-commercial-accounting-pg-test-helpers.js";
import { runtimeAdmissionFixture } from "./model-runtime-admission-test-helpers.js";
import { liveRuntimeAdmissionFixture } from "./model-live-runtime-admission-test-helpers.js";
import { seedRuntimeAdmissionFixture } from "./model-live-seed-runtime-admission-test-helpers.js";

import {
  seedRuntimeExecutionForPrepared,
  seedRuntimeExecutionForPreparedV4,
} from "./model-live-seed-runtime-host-test-helpers.js";
import { prepareModelLiveSeedStageInputV3 } from "./model-live-runtime-host-evidence-codec.js";
import { parseSeedRuntimeRecord } from "./model-live-seed-runtime-admission-codec.js";
import {
  parseModelLiveSeedRuntimeExecutionV3,
  parseModelLiveSeedRuntimeExecutionV4,
  prepareModelLiveSeedRuntimeExecutionV4,
  projectModelLiveSeedRuntimeExecutionIdentityV4,
  prepareModelLiveSeedRuntimeExecutionV3,
  projectModelLiveSeedRuntimeExecutionIdentityV3,
} from "@cloudmarkup/model-gateway";
import { prepareProductionSeedRepairCountV3 } from "../../production-model-live-seed-counted-preparation.js";
import type { BedrockCountHttpRequestV1 } from "@cloudmarkup/model-gateway";
import type {
  ModelProviderPricingVersionV1,
  CreditNormalizationPolicyVersionV1,
} from "@cloudmarkup/domain";
import {
  parseModelLiveSequenceCommercialReadSelectorsV3,
  parseModelSeedSequenceReadRuntimeRowV4,
  parseModelReadRuntimeRow,
  parseModelLiveReadRuntimeRow,
} from "./model-commercial-read-host-codec.js";
import { seedModelCommercialReadPriceFixture } from "./model-commercial-read-host-test-helpers.js";
import { PostgresModelLiveSequences } from "./model-live-sequences.js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  digestStructuredValue as digest,
  sha256Text,
  normalizeModelHostSeedUsageV3,
  normalizeModelHostRepairSuccessorUsageV4,
  reviewedHostBoundedRepairPromptV4,
  type ReviewedPromptTemplateV1,
  type ModelProviderHostRepairSuccessorInvocationV4,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveSequenceDefinitionV3Schema,
  normalizedModelUsageV1Schema,
  modelLiveSeedInvocationDescriptorV3Schema,
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
} from "@cloudmarkup/schemas";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";

import { createSeedBoundSequencePgFixture } from "./model-live-seed-sequence-test-helpers.js";
import { syntheticSeedStageInput } from "./model-live-seed-stage-test-helpers.js";
import {
  sql,
  type SqlDatabase,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";
import type { ModelLiveSequenceConfigurationV3 } from "./model-live-sequences.js";
// Instrumented canonical hashing needs more wall time in these full SQL flows.
// Only the test deadline changes; production authority and lease windows remain real.
const isRepositoryCoverage =
  process.env["npm_lifecycle_event"] === "test:coverage";
const coverageScale = isRepositoryCoverage ? 3 : 1;
const timeout30Seconds = 30_000 * coverageScale;
const timeout60Seconds = 60_000 * coverageScale;
const timeout120Seconds = 120_000 * coverageScale;

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
if (
  process.env["CI"] === "true" &&
  process.env["npm_lifecycle_event"] === "test:live-counted-seed-preparation" &&
  !configured
)
  throw new Error("Counted seed preparation requires its test database in CI.");
// Five production preparation cases enforce real short-lived authorization.
// The full-profile counted-execution gate runs them before coverage, without
// instrumentation; coverage must not weaken those production freshness checks.
// The functional beta does not register or activate this proposed AI accounting
// path. Keep its extended suite in the full profile; do not count deferral as a pass.
const deferredForFunctionalBeta =
  process.env["CLOUDMARKUP_TEST_DEFER_EXTENDED_MODEL_ACCOUNTING"] === "true";
const integration =
  configured && !deferredForFunctionalBeta ? describe : describe.skip;
const hash = <T extends object>(value: T, key: string): T => ({
  ...value,
  [key]: digest(
    Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)),
  ),
});
const denied = { code: "model-live.sequence-unavailable" };
integration(
  "authenticated first-stage input issuer on actual PostgreSQL",
  () => {
    const harness = createModelAccountingPgTestHarness(configured);
    const seedFixture = createSeedBoundSequencePgFixture(harness);
    beforeAll(async () => {
      await harness.setup();
      await applySeedValidationProposal(harness.database);
      await applySeedStageInputProposal(harness.database);
      await applySeedRuntimeAdmissionProposal(harness.database);
      await applySeedCommercialReservationProposal(harness.database);
      await applySeedSequenceRuntimeProposalV4(harness.database);
      await applySeedSequenceReservationProposalV4(harness.database);
      await applySeedDispatchProposalV4(harness.database);
      await applySeedUsageObservationProposalV4(harness.database);
      await applySeedCandidateValidationProposalV4(harness.database);
      await applyRepairSuccessorInputProposalV4(harness.database);
      await applyRepairSuccessorDispatchProposalV4(harness.database);
      await applyRepairSuccessorUsageProposalV4(harness.database);
      await applyRepairSuccessorCandidateProposalV4(harness.database);
      await applyRepairUnusedStageProposalV4(harness.database);
      await applyRepairRecordedReceiptProposalV4(harness.database);
      await applyRepairTerminalAccountingProposalV4(harness.database);
      await applyRepairKnownFailureProposalV4(harness.database);
      await applyRepairExpiryProposalV4(harness.database);
    }, 120000);
    afterAll(() => harness.teardown(), 30000);
    beforeEach(async () => {
      await waitForLiveAccountingPgTestWindow(harness.database);
      vi.stubEnv("AWS_ACCESS_KEY_ID", "SYNTHETIC_COUNT_TEST");
      vi.stubEnv("AWS_SECRET_ACCESS_KEY", "synthetic-count-test-value");
      vi.stubEnv("AWS_SESSION_TOKEN", undefined);
      vi.stubEnv("AWS_PROFILE", undefined);
      vi.stubEnv("AWS_EC2_METADATA_DISABLED", "true");
    }, 120000);
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });
    async function fixture(prompt?: ReviewedPromptTemplateV1) {
      const f = await seedFixture();
      const receipts = await f.seeds();
      const receipt = receipts[0];
      if (!receipt) throw Error("Missing synthetic issued seed");
      const preparedSeed = await f.adapter.prepareSeedRepair(
        receipt.caseId,
        "guided",
      );
      const now = new Date().toISOString();
      const prepared = await syntheticSeedStageInput(
        {
          seedReceipt: receipt,
          preparedSeed,
          now,
        },
        prompt,
      );
      const originalCases = f.definitionState.definition.cases;
      f.definitionState.definition = modelLiveSequenceDefinitionV3Schema.parse(
        hash(
          {
            ...prepared.plan.definition,
            cases: prepared.plan.definition.cases.map((entry) => {
              const original = originalCases.find(
                (candidate) => candidate.caseId === entry.caseId,
              );
              if (!original) throw Error("Missing original case");
              return { ...entry, seed: original.seed };
            }),
          },
          "definitionDigest",
        ),
      );
      const modelState = {
        available: true,
        configuration: prepared.configuration,
      };
      const candidateState: {
        configuration: ProductionSeedCandidateHostConfiguration | null;
      } = { configuration: null };
      const configuration: ModelLiveSequenceConfigurationV3 = {
        resolveSeedCandidateValidationHost: () =>
          Promise.resolve(candidateState.configuration),
        ...f.configuration,
        resolveDefinition: (id) =>
          Promise.resolve(
            f.definitionState.available &&
              id === f.definitionState.definition.definitionId
              ? {
                  definition: f.definitionState.definition,
                  dataset: f.template.dataset,
                  policy: f.definitionState.definition.policy,
                }
              : null,
          ),
        resolveModelHostConfiguration: () =>
          Promise.resolve(
            modelState.available ? modelState.configuration : null,
          ),
      };
      const make = (overrides: Parameters<typeof f.make>[0] = {}) =>
        f.make({ configuration, ...overrides });
      const adapter = make();
      const plan = await adapter.approve(f.approval());
      const reference = {
        definitionId: plan.definition.definitionId,
        planDigest: plan.planDigest,
      };
      const selection = await adapter.issueSelection(reference);
      const stage = selection.stages.find(
        (entry) =>
          entry.caseId === receipt.caseId && entry.stageKey === "repair-1",
      );
      if (!stage) throw Error("Missing issued stage");
      const invocation = structuredClone(prepared.invocation);
      Object.assign(invocation, {
        descriptor: modelLiveSeedInvocationDescriptorV3Schema.parse({
          ...invocation.descriptor,
          invocationId: stage.invocationId,
        }),
      });
      const input = {
        reference: {
          ...reference,
          selectionId: selection.selectionId,
          selectionDigest: selection.selectionDigest,
        },
        caseId: receipt.caseId,
        invocation,
      };
      const count = async () =>
        (
          await harness.database.query(
            sql(
              "SELECT COUNT(*)::int AS count FROM model_live_sequence_inputs WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rows[0]?.["count"];
      return {
        ...f,
        configuration,
        candidateState,
        modelState,
        prepared,
        make,
        adapter,
        plan,
        selection,
        input,
        count,
      };
    }

    it("preserves historical SQL version readers beside strict V3 metadata", async () => {
      const f = runtimeAdmissionFixture();
      const input = f.claim(f.emptySnapshot());
      const record = {
        request: f.request,
        decision: f.decision,
        originalSnapshot: f.emptySnapshot(),
        fingerprint: input.fingerprint,
        tenantScopeDigest: f.state.tenantScopeDigest,
        commercialExpiresAt: input.commercialExpiresAt,
        concurrencyLeaseId: input.leaseId,
        revision: 0,
        recoveryRequired: false,
        executionLease: {
          acquiredAt: f.now,
          executionLeaseId: "runtime_execution_fixture",
          expiresAt: input.executionLeaseExpiresAt,
          fencingToken: "runtime_fence_1",
          recoveryOnly: false,
          revision: 0,
        },
        pending: null,
        terminal: null,
      };

      for (const [candidateRecord, version] of [
        [record, 1],
        [liveRuntimeAdmissionFixture().record(), 2],
        [seedRuntimeAdmissionFixture().record(), 3],
      ] as const) {
        const found = await harness.database.query(
          sql(
            "SELECT cloudmarkup_runtime_admission_version_valid($1::jsonb) AS historical, cloudmarkup_seed_runtime_admission_version_valid($1::jsonb) AS seed",
            [JSON.stringify(candidateRecord)],
          ),
        );
        expect(found.rows[0]).toEqual({
          historical: version !== 3,
          seed: version === 3,
        });
      }
    });

    it("keeps V4 SQL metadata separate and rejects partial two-slot bindings", async () => {
      const record = seedSequenceRuntimeAdmissionFixtureV4().record();
      const read = async (value: unknown) =>
        (
          await harness.database.query(
            sql(
              "SELECT cloudmarkup_seed_runtime_admission_version_valid($1::jsonb) AS historical, cloudmarkup_seed_sequence_runtime_admission_v4_valid($1::jsonb) AS sequence",
              [JSON.stringify(value)],
            ),
          )
        ).rows[0];
      expect(await read(record)).toEqual({ historical: false, sequence: true });
      for (const kind of [
        "one-call",
        "one-output",
        "parent",
        "digest",
      ] as const) {
        const invalid = structuredClone(record);
        if (kind === "one-call")
          invalid.liveAuthorityReservation.planned.invocations = 1;
        if (kind === "one-output") {
          invalid.liveAuthorityReservation.planned.outputTokens /= 2;
          invalid.liveAuthorityReservation.planned.totalTokens =
            invalid.liveAuthorityReservation.planned.inputTokens +
            invalid.liveAuthorityReservation.planned.outputTokens;
        }
        if (kind === "parent")
          Object.assign(invalid.request, { parentSequenceContractVersion: 2 });
        if (kind === "digest")
          Object.assign(invalid.request, {
            canonicalPlannedCallsDigest: digest("other calls"),
          });
        expect(await read(invalid)).toEqual({
          historical: false,
          sequence: false,
        });
      }
    });
    async function runtimeFixtureV4() {
      const f = await fixture();
      Object.assign(f.input.invocation, {
        maximumOutputTokens: 1000,
        timeoutMilliseconds: 10000,
      });
      const issued = await f.adapter.issueSeedRepairInput(f.input);
      const prepared = prepareModelLiveSeedStageInputV3({
        ...f.prepared,
        plan: f.plan,
        selection: f.selection,
        invocation: f.input.invocation,
        observedAt: issued.record.issuedAt,
      });
      const execution = seedRuntimeExecutionForPreparedV4(
        prepared,
        issued.record,
      );
      const parsed = parseModelLiveSeedRuntimeExecutionV4(execution);
      const identity =
        projectModelLiveSeedRuntimeExecutionIdentityV4(execution);
      const store = await f.adapter.createSeedRuntimeAdmissionV4({
        ...f.input,
        execution,
      });
      const policy = f.plan.definition.policy;
      const state = {
        organizationId: f.scope.organizationId,
        projectId: f.scope.projectId,
        userId: f.scope.userId,
        decidedAt: execution.admissionDecision.decidedAt,
        idempotencyKeyDigest: execution.admissionRequest.idempotencyKeyDigest,
        liveAuthorityReservation: parsed.liveAuthorityReservation,
        organizationWindowSeconds:
          policy.requestWindows.organization.windowSeconds,
        userWindowSeconds: policy.requestWindows.user.windowSeconds,
        requestDigest: execution.admissionRequest.requestDigest,
        runtimePolicyDigest: policy.policyDigest,
        tenantScopeDigest: identity.tenantScopeDigest,
      };
      const snapshot = await store.inspect(state);
      const expiresAt = execution.admissionDecision.expiresAt;
      const leaseId =
        execution.admissionDecision.authorization.concurrencyLeaseId;
      if (!expiresAt || !leaseId)
        throw Error("Missing synthetic two-slot lease");
      const claim = {
        ...state,
        admissionRequest: execution.admissionRequest,
        admissionDecision: execution.admissionDecision,
        acquire: true,
        claimOutbox: [],
        commercialExpiresAt: expiresAt,
        executionLeaseExpiresAt: expiresAt,
        fingerprint: identity.fingerprint,
        leaseId,
        limits: {
          maximumConcurrentOrganizationJobs:
            policy.requestWindows.organization.maximumConcurrentJobs,
          maximumConcurrentUserJobs:
            policy.requestWindows.user.maximumConcurrentJobs,
          maximumOrganizationRequests:
            policy.requestWindows.organization.maximumRequests,
          maximumUserRequests: policy.requestWindows.user.maximumRequests,
        },
        snapshotDigest: snapshot.snapshotDigest,
        snapshotId: snapshot.snapshotId,
      };
      const recovery = () =>
        f.adapter.openSeedRuntimeRecoveryV4({
          reference: f.input.reference,
          tenantScopeDigest: identity.tenantScopeDigest,
        });
      return {
        ...f,
        preparedRuntime: prepared,
        execution,
        store,
        state,
        snapshot,
        claim,
        identity,
        recovery,
      };
    }
    it("admits V4 capacity once, retains both calls and recovers without new send authority", async () => {
      const f = await runtimeFixtureV4();
      const before = await harness.database.query(
        sql(
          "SELECT count(*)::int AS count FROM credit_reservations WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      const { admissionDecision, ...metadata } = f.execution;
      const leaseId = admissionDecision.authorization.concurrencyLeaseId;
      if (!leaseId) throw Error("Missing synthetic lease");
      const execution = await prepareModelLiveSeedRuntimeExecutionV4({
        metadata,
        observedAt: f.state.decidedAt,
        decisionId: admissionDecision.decisionId,
        concurrencyLeaseId: leaseId,
        store: {
          inspect: (state) =>
            f.adapter.inspectSeedRuntimeCapacityV4({
              ...f.input,
              request: metadata.admissionRequest,
              commercialRequest: metadata.commercialRequest,
              state,
            }),
        },
      });
      expect(execution.admissionDecision.outcome).toBe("allowed");
      const results = await Promise.all([
        f.store.claim(f.claim),
        f.store.claim(f.claim),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual([
        "claimed",
        "duplicate-in-progress",
      ]);
      const claimed = results.find((r) => r.kind === "claimed");
      if (claimed?.kind !== "claimed")
        throw Error("Expected synthetic V4 claim");
      const inspected = await f.adapter.inspectSeedRuntimeCapacityV4({
        ...f.input,
        request: f.execution.admissionRequest,
        commercialRequest: f.execution.commercialRequest,
        state: f.state,
      });
      expect(inspected.liveAuthorityUsage).toMatchObject({
        reservedInvocations: 2,
        reservedOutputTokens: 2000,
        activeConcurrentJobs: 1,
      });
      expect(
        (
          await harness.database.query(
            sql(
              "SELECT count(*)::int AS count FROM credit_reservations WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rows,
      ).toEqual(before.rows);
      await expect(
        f.adapter.openSeedRuntimeRecovery({
          reference: f.input.reference,
          tenantScopeDigest: f.identity.tenantScopeDigest,
        }),
      ).rejects.toThrow();
      await f.adapter.revoke({
        definitionId: f.plan.definition.definitionId,
        planDigest: f.plan.planDigest,
      });
      f.modelState.available = false;
      await expect(
        f.store.assertExecutionLease({
          commercialExpiresAt: f.claim.commercialExpiresAt,
          executionLease: claimed.executionLease,
          tenantScopeDigest: f.identity.tenantScopeDigest,
          trustedNow: new Date().toISOString(),
        }),
      ).rejects.toThrow();
      await f.store.release({
        executionLease: claimed.executionLease,
        tenantScopeDigest: f.identity.tenantScopeDigest,
      });
      const recovery = await f.recovery();
      await expect(recovery.inspect(f.state)).rejects.toThrow();
      const recovered = await recovery.claim(f.claim);
      if (recovered.kind !== "claimed") throw Error("Expected recovery claim");
      expect(recovered.executionLease.recoveryOnly).toBe(true);
      expect(recovered.snapshot.liveAuthorityUsage?.reservedInvocations).toBe(
        2,
      );
    }, 60000);
    it.each(["tenant", "configuration", "revoked"] as const)(
      "denies V4 fresh %s without an admission",
      async (kind) => {
        const f = await runtimeFixtureV4();
        if (kind === "tenant") {
          await expect(
            f
              .make({ scope: { ...f.scope, organizationId: "org_foreign" } })
              .createSeedRuntimeAdmissionV4({
                ...f.input,
                execution: f.execution,
              }),
          ).rejects.toThrow();
        } else {
          if (kind === "configuration") f.modelState.available = false;
          if (kind === "revoked")
            await f.adapter.revoke({
              definitionId: f.plan.definition.definitionId,
              planDigest: f.plan.planDigest,
            });
          await expect(f.store.claim(f.claim)).rejects.toThrow();
        }
        expect(
          (
            await harness.database.query(
              sql(
                "SELECT count(*)::int AS count FROM model_runtime_admissions WHERE organization_id=$1",
                [f.scope.organizationId],
              ),
            )
          ).rows[0]?.["count"],
        ).toBe(0);
      },
      60000,
    );

    async function runtimeFixture() {
      const f = await fixture();
      const issued = await f.adapter.issueSeedRepairInput(f.input);
      const prepared = prepareModelLiveSeedStageInputV3({
        ...f.prepared,
        plan: f.plan,
        selection: f.selection,
        invocation: f.input.invocation,
        observedAt: issued.record.issuedAt,
      });
      const execution = seedRuntimeExecutionForPrepared(
        prepared,
        issued.record,
      );
      const parsed = parseModelLiveSeedRuntimeExecutionV3(execution);
      const identity =
        projectModelLiveSeedRuntimeExecutionIdentityV3(execution);
      const store = await f.adapter.createSeedRuntimeAdmission({
        ...f.input,
        execution,
      });
      const policy = f.plan.definition.policy;
      const state = {
        organizationId: f.scope.organizationId,
        projectId: f.scope.projectId,
        userId: f.scope.userId,
        decidedAt: execution.admissionDecision.decidedAt,
        idempotencyKeyDigest: execution.admissionRequest.idempotencyKeyDigest,
        liveAuthorityReservation: parsed.liveAuthorityReservation,
        organizationWindowSeconds:
          policy.requestWindows.organization.windowSeconds,
        userWindowSeconds: policy.requestWindows.user.windowSeconds,
        requestDigest: execution.admissionRequest.requestDigest,
        runtimePolicyDigest: policy.policyDigest,
        tenantScopeDigest: identity.tenantScopeDigest,
      };
      const snapshot = await store.inspect(state);
      const expiresAt = execution.admissionDecision.expiresAt;
      const leaseId =
        execution.admissionDecision.authorization.concurrencyLeaseId;
      if (!expiresAt || !leaseId)
        throw Error("Missing synthetic allowed lease");
      const claim = {
        ...state,
        admissionRequest: execution.admissionRequest,
        admissionDecision: execution.admissionDecision,
        acquire: true,
        claimOutbox: [],
        commercialExpiresAt: expiresAt,
        executionLeaseExpiresAt: expiresAt,
        fingerprint: identity.fingerprint,
        leaseId,
        limits: {
          maximumConcurrentOrganizationJobs:
            policy.requestWindows.organization.maximumConcurrentJobs,
          maximumConcurrentUserJobs:
            policy.requestWindows.user.maximumConcurrentJobs,
          maximumOrganizationRequests:
            policy.requestWindows.organization.maximumRequests,
          maximumUserRequests: policy.requestWindows.user.maximumRequests,
        },
        snapshotDigest: snapshot.snapshotDigest,
        snapshotId: snapshot.snapshotId,
      };
      const recovery = () =>
        f.adapter.openSeedRuntimeRecovery({
          reference: f.input.reference,
          tenantScopeDigest: identity.tenantScopeDigest,
        });
      return {
        ...f,
        execution,
        store,
        state,
        snapshot,
        claim,
        identity,
        recovery,
      };
    }

    it("prepares a real capacity decision without a provisional admission or financial writes", async () => {
      const f = await runtimeFixture();
      const rows = () =>
        harness.database.query(
          sql(
            "SELECT (SELECT count(*)::int FROM model_runtime_admissions WHERE organization_id=$1) AS admissions, (SELECT count(*)::int FROM model_runtime_admission_debits WHERE organization_id=$1) AS debits, (SELECT count(*)::int FROM credit_reservations WHERE organization_id=$1) AS commercial, (SELECT count(*)::int FROM usage_ledger_entries WHERE organization_id=$1) AS ledger",
            [f.scope.organizationId],
          ),
        );
      const before = (await rows()).rows;
      const { admissionDecision, ...metadata } = f.execution;
      const leaseId = admissionDecision.authorization.concurrencyLeaseId;
      if (!leaseId) throw Error("Missing synthetic lease identifier");
      const prepared = await prepareModelLiveSeedRuntimeExecutionV3({
        metadata,
        observedAt: f.state.decidedAt,
        decisionId: admissionDecision.decisionId,
        concurrencyLeaseId: leaseId,
        store: {
          inspect: (state) =>
            f.adapter.inspectSeedRuntimeCapacity({
              ...f.input,
              request: metadata.admissionRequest,
              state,
            }),
        },
      });
      expect(prepared.admissionDecision.outcome).toBe("allowed");
      expect(prepared.stageInput).toEqual(f.execution.stageInput);
      expect((await rows()).rows).toEqual(before);
      expect(before[0]).toMatchObject({
        admissions: 0,
        debits: 0,
        commercial: 0,
      });
    }, 30000);
    it("reads actual retained capacity after the stage is claimed", async () => {
      const f = await runtimeFixture();
      expect((await f.store.claim(f.claim)).kind).toBe("claimed");
      const snapshot = await f.adapter.inspectSeedRuntimeCapacity({
        ...f.input,
        request: f.execution.admissionRequest,
        state: f.state,
      });
      expect(snapshot.idempotencyReplay).toBe(true);
      expect(snapshot.liveAuthorityUsage).toMatchObject({
        reservedInvocations: 1,
        activeConcurrentJobs: 1,
        reservedCreditUnits:
          f.state.liveAuthorityReservation.planned.creditUnits,
      });
    }, 30000);
    it.each([
      "revoked",
      "configuration",
      "tenant",
      "resources",
      "cancelled",
    ] as const)(
      "denies %s read-only seed capacity",
      async (kind) => {
        const f = await runtimeFixture();
        const input = {
          ...f.input,
          request: structuredClone(f.execution.admissionRequest),
          state: structuredClone(f.state),
        };
        const signal = new AbortController();
        if (kind === "revoked")
          await f.adapter.revoke({
            definitionId: f.input.reference.definitionId,
            planDigest: f.input.reference.planDigest,
          });
        if (kind === "configuration") f.modelState.available = false;
        if (kind === "tenant")
          input.invocation.descriptor.scope.organizationId =
            "other_organization";
        if (kind === "resources") {
          input.request.requested.promptBytes += 1;
          Object.assign(input.request, hash(input.request, "requestDigest"));
          input.state.requestDigest = input.request.requestDigest;
        }
        if (kind === "cancelled") signal.abort();
        await expect(
          f.adapter.inspectSeedRuntimeCapacity(input, signal.signal),
        ).rejects.toMatchObject(denied);
        const rows = await harness.database.query(
          sql(
            "SELECT count(*)::int AS count FROM model_runtime_admissions WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        );
        expect(rows.rows[0]?.["count"]).toBe(0);
      },
      30000,
    );

    it(
      "admits one exact issued seed input, counts it once, and returns recovery-only leases after release",
      async () => {
        const f = await runtimeFixture();
        const result = await f.store.claim(f.claim);
        expect(result.kind).toBe("claimed");
        if (result.kind !== "claimed")
          throw Error("Expected initial synthetic claim");
        expect(result.executionLease.recoveryOnly).toBe(false);
        await f.store.assertExecutionLease({
          commercialExpiresAt: f.claim.commercialExpiresAt,
          executionLease: result.executionLease,
          tenantScopeDigest: f.identity.tenantScopeDigest,
          trustedNow: new Date().toISOString(),
        });
        expect((await f.store.claim(f.claim)).kind).toBe(
          "duplicate-in-progress",
        );
        await f.store.release({
          executionLease: result.executionLease,
          tenantScopeDigest: f.identity.tenantScopeDigest,
        });
        const recovered = await (await f.recovery()).claim(f.claim);
        expect(recovered.kind).toBe("claimed");
        if (recovered.kind !== "claimed")
          throw Error("Expected synthetic recovery");
        expect(recovered.executionLease.recoveryOnly).toBe(true);
        expect(recovered.snapshot.liveAuthorityUsage?.reservedInvocations).toBe(
          1,
        );
        const rows = await harness.database.query(
          sql(
            "SELECT (SELECT count(*)::int FROM model_runtime_admissions WHERE organization_id=$1) AS admissions, (SELECT count(*)::int FROM model_runtime_admission_debits WHERE organization_id=$1) AS debits",
            [f.scope.organizationId],
          ),
        );
        expect(rows.rows[0]).toMatchObject({ admissions: 1, debits: 1 });
      },
      timeout30Seconds,
    );
    it(
      "serializes concurrent claims for the same issued stage",
      async () => {
        const f = await runtimeFixture();
        const results = await Promise.all([
          f.store.claim(f.claim),
          f.store.claim(f.claim),
        ]);
        expect(results.map((r) => r.kind).sort()).toEqual([
          "claimed",
          "duplicate-in-progress",
        ]);
      },
      timeout30Seconds,
    );
    it(
      "rejects fresh admission after revocation while preserving metadata-only recovery",
      async () => {
        const f = await runtimeFixture();
        const result = await f.store.claim(f.claim);
        if (result.kind !== "claimed")
          throw Error("Expected initial synthetic claim");
        await f.adapter.revoke({
          definitionId: f.plan.definition.definitionId,
          planDigest: f.plan.planDigest,
        });
        f.modelState.available = false;
        await expect(
          f.store.assertExecutionLease({
            commercialExpiresAt: f.claim.commercialExpiresAt,
            executionLease: result.executionLease,
            tenantScopeDigest: f.identity.tenantScopeDigest,
            trustedNow: new Date().toISOString(),
          }),
        ).rejects.toThrow();
        await f.store.release({
          executionLease: result.executionLease,
          tenantScopeDigest: f.identity.tenantScopeDigest,
        });
        const recovery = await f.recovery();
        await expect(recovery.inspect(f.state)).rejects.toThrow();
        const recovered = await recovery.claim(f.claim);
        expect(recovered.kind).toBe("claimed");
        if (recovered.kind !== "claimed")
          throw Error("Expected recovery-only result");
        expect(recovered.executionLease.recoveryOnly).toBe(true);
        expect(recovered.snapshot.liveAuthorityUsage?.reservedInvocations).toBe(
          1,
        );
      },
      timeout30Seconds,
    );
    it("rejects recovery before an admission exists and fresh use after configuration loss", async () => {
      const f = await runtimeFixture();
      await expect(f.recovery()).rejects.toThrow();
      f.modelState.available = false;
      await expect(f.store.claim(f.claim)).rejects.toThrow();
      expect(
        (
          await harness.database.query(
            sql(
              "SELECT count(*)::int AS count FROM model_runtime_admissions WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rows[0]?.["count"],
      ).toBe(0);
    }, 30000);
    it("binds current source, resources and original tenant before admitting", async () => {
      const f = await runtimeFixture();
      const changed = structuredClone(f.execution);
      Object.assign(changed.admissionRequest.requested, {
        promptBytes: changed.admissionRequest.requested.promptBytes + 1,
      });
      Object.assign(
        changed.admissionRequest,
        hash(changed.admissionRequest, "requestDigest"),
      );
      Object.assign(
        changed.admissionDecision,
        hash(
          {
            ...changed.admissionDecision,
            requestDigest: changed.admissionRequest.requestDigest,
          },
          "decisionDigest",
        ),
      );
      await expect(
        f.adapter.createSeedRuntimeAdmission({
          ...f.input,
          execution: changed,
        }),
      ).rejects.toThrow();
      const source = structuredClone(f.input);
      const file = source.invocation.request.failedCandidates[0];
      if (!file) throw Error("Missing synthetic source");
      file.content += "\n// unexpected edit";
      await expect(
        f.adapter.createSeedRuntimeAdmission({
          ...source,
          execution: f.execution,
        }),
      ).rejects.toThrow();
      await expect(
        f
          .make({ scope: { ...f.scope, organizationId: "org_foreign" } })
          .openSeedRuntimeRecovery({
            reference: f.input.reference,
            tenantScopeDigest: f.identity.tenantScopeDigest,
          }),
      ).rejects.toThrow();
    }, 30000);
    it("rejects direct SQL input substitutions and a second admission for an already used stage", async () => {
      const f = await runtimeFixture();
      const result = await f.store.claim(f.claim);
      if (result.kind !== "claimed") throw Error("Expected synthetic claim");
      const stored = await harness.database.query(
        sql(
          "SELECT snapshot FROM model_runtime_admissions WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      const record = parseSeedRuntimeRecord(
        stored.rows[0]?.["snapshot"],
        f.scope,
      );
      for (const key of [
        "inputDigest",
        "inputBindingDigest",
        "preparedPayloadDigest",
        "selectionDigest",
        "liveEvaluationAuthorityDigest",
      ] as const) {
        const request = hash(
          { ...record.request, [key]: digest("wrong " + key) },
          "requestDigest",
        );
        const decision = hash(
          {
            ...record.decision,
            [key]: digest("wrong " + key),
            requestDigest: request.requestDigest,
          },
          "decisionDigest",
        );
        const invalid = { ...record, request, decision };
        await expect(
          harness.database.query(
            sql(
              "INSERT INTO model_runtime_admissions(organization_id,scope_sha256,project_id,principal_id,snapshot,snapshot_sha256,revision,last_fence,active_concurrency_lease_id,lease_expires_at) SELECT organization_id,scope_sha256,project_id,principal_id,$2::jsonb,$3,revision,last_fence,active_concurrency_lease_id,lease_expires_at FROM model_runtime_admissions WHERE organization_id=$1",
              [
                f.scope.organizationId,
                JSON.stringify(invalid),
                digest(invalid).slice(7),
              ],
            ),
          ),
        ).rejects.toThrow();
      }
      await f.store.release({
        executionLease: result.executionLease,
        tenantScopeDigest: f.identity.tenantScopeDigest,
      });

      // Both serialized versions must share one immutable issued-stage slot.
      for (const version of [3, 4] as const) {
        const factor = version === 4 ? 2 : 1;
        const canonicalPlannedCallsDigest = digest([
          ...f.execution.commercialRequest.plannedCalls,
          ...f.execution.commercialRequest.plannedCalls,
        ]);
        const commercialEstimate = hash(
          {
            ...record.request.commercialEstimate,
            estimatedMicroUsd:
              record.request.commercialEstimate.estimatedMicroUsd * factor,
            maximumCreditUnits:
              record.request.commercialEstimate.maximumCreditUnits * factor,
          },
          "estimateDigest",
        );
        const request = hash(
          {
            ...record.request,
            ...(version === 4
              ? {
                  contractVersion: 4,
                  parentSequenceContractVersion: 3,
                  canonicalPlannedCallsDigest,
                }
              : {}),
            commercialEstimate,
          },
          "requestDigest",
        );
        const nextDecision = hash(
          {
            ...record.decision,
            ...(version === 4
              ? {
                  contractVersion: 4,
                  parentSequenceContractVersion: 3,
                  canonicalPlannedCallsDigest,
                }
              : {}),
            requestDigest: request.requestDigest,
            commercialEstimateDigest: commercialEstimate.estimateDigest,
            authorization: {
              ...record.decision.authorization,
              concurrencyLeaseId: "second_seed_lease",
            },
          },
          "decisionDigest",
        );
        const planned = record.liveAuthorityReservation.planned;
        const next = {
          ...record,
          request,
          decision: nextDecision,
          originalSnapshot: hash(
            {
              ...record.originalSnapshot,
              requestDigest: request.requestDigest,
            },
            "snapshotDigest",
          ),
          liveAuthorityReservation: {
            ...record.liveAuthorityReservation,
            planned: {
              ...planned,
              invocations: factor,
              creditUnits: planned.creditUnits * factor,
              estimatedMicroUsd: planned.estimatedMicroUsd * factor,
              inputTokens: planned.inputTokens * factor,
              outputTokens: planned.outputTokens * factor,
              totalTokens: planned.totalTokens * factor,
            },
          },
          concurrencyLeaseId: "second_seed_lease",
          tenantScopeDigest: digest("second scope"),
        };
        await expect(
          harness.database.query(
            sql(
              "INSERT INTO model_runtime_admissions(organization_id,scope_sha256,project_id,principal_id,snapshot,snapshot_sha256,revision,last_fence,active_concurrency_lease_id,lease_expires_at) VALUES($1,$2,$5,$6,$3::jsonb,$4,0,$7,'second_seed_lease',$8::timestamptz)",
              [
                f.scope.organizationId,
                next.tenantScopeDigest.slice(7),
                JSON.stringify(next),
                digest(next).slice(7),
                f.scope.projectId,
                f.scope.userId,
                Number(
                  result.executionLease.fencingToken.slice(
                    "runtime_fence_".length,
                  ),
                ),
                result.executionLease.expiresAt,
              ],
            ),
          ),
        ).rejects.toMatchObject({
          code: "23505",
          constraint: "model_seed_runtime_stage_once",
        });
      }
    }, 30000);

    let price: ModelProviderPricingVersionV1 | undefined;
    let normalization: CreditNormalizationPolicyVersionV1 | undefined;
    async function preflightFixture(prompt?: ReviewedPromptTemplateV1) {
      const f = await fixture(prompt);
      const descriptor = f.input.invocation.descriptor;
      const route = descriptor.routing;
      if (!price || !normalization) {
        price = {
          version: 1,
          pricingVersionId: route.pricingVersionReference,
          providerKey: descriptor.providerId,
          modelId: descriptor.modelId,
          modelVersion: descriptor.modelVersion,
          inferenceProfileId: descriptor.inferenceProfileId ?? null,
          environment: "development",
          currencyCode: "USD",
          effectiveFrom: "2026-09-01T00:00:00.000Z",
          effectiveUntil: null,
          status: "enabled",
          inputMicrosPerMillionUnits: 3000000,
          outputMicrosPerMillionUnits: 15000000,
          cacheReadMicrosPerMillionUnits: null,
          cacheWriteMicrosPerMillionUnits: null,
          providerSpecificUnitRates: [],
        };
        normalization = {
          version: 1,
          normalizationPolicyVersionId:
            "normalization.seed-preflight.synthetic",
          currencyCode: "USD",
          creditUnitMicros: 10000,
          operatingBufferBasisPoints: 3000,
          effectiveFrom: "2026-09-01T00:00:00.000Z",
          effectiveUntil: null,
          status: "enabled",
        };
        await seedModelCommercialReadPriceFixture(
          harness.database,
          f.administration,
          price,
          normalization,
        );
      }
      const policy = f.plan.definition.policy;
      const selectors = parseModelLiveSequenceCommercialReadSelectorsV3({
        contractVersion: 3,
        executionClass: "live-evaluation",
        routeId: "internal-escalation",
        routeDefinitionDigest: route.routeDefinitionDigest,
        modelConfigurationReference: route.modelConfigurationReference,
        pricingVersionId: price.pricingVersionId,
        pricingVersionDigest: digest(price),
        normalizationPolicyVersionId:
          normalization.normalizationPolicyVersionId,
        normalizationPolicyDigest: digest(normalization),
        runtimePolicyId: policy.policyId,
        runtimePolicyVersion: policy.policyVersion,
        runtimePolicyDigest: policy.policyDigest,
      });
      const request = { ...f.input, selectors };
      const rows = async () =>
        (
          await harness.database.query(
            sql(
              "SELECT (SELECT count(*)::int FROM model_live_sequence_inputs WHERE organization_id=$1) AS inputs, (SELECT count(*)::int FROM model_runtime_admissions WHERE organization_id=$1) AS admissions, (SELECT count(*)::int FROM credit_reservations WHERE organization_id=$1) AS reservations, (SELECT count(*)::int FROM usage_ledger_entries WHERE organization_id=$1) AS ledger",
              [f.scope.organizationId],
            ),
          )
        ).rows;
      return { ...f, request, rows, price, normalization };
    }

    async function seedCanonicalFixture() {
      const f = await preflightFixture();
      const issued = await f.adapter.issueSeedRepairInput(f.input);
      if (issued.kind !== "issued")
        throw Error("Missing newly issued seed input");
      const prepared = prepareModelLiveSeedStageInputV3({
        ...f.prepared,
        plan: f.plan,
        selection: f.selection,
        invocation: f.input.invocation,
        observedAt: issued.record.issuedAt,
      });
      const accounting = await seedAccountingFixture(
        seedRuntimeExecutionForPrepared(prepared, issued.record),
        {
          pricing: f.price,
          normalization: f.normalization,
          authorization: {
            planVersionId: accountingPlan,
            chargingPolicyVersion: accountingCharging,
            entitlementPolicyVersion: accountingEntitlement,
            maximumInputUnits: 100000,
            maximumOutputUnits: 100000,
          },
        },
      );
      const execution = accounting.execution;
      const runtimeStore = await f.adapter.createSeedRuntimeAdmission({
        ...f.input,
        execution,
      });
      const policy = f.plan.definition.policy;
      const state = {
        organizationId: f.scope.organizationId,
        projectId: f.scope.projectId,
        userId: f.scope.userId,
        decidedAt: execution.admissionDecision.decidedAt,
        idempotencyKeyDigest: execution.admissionRequest.idempotencyKeyDigest,
        liveAuthorityReservation: accounting.runtime.liveAuthorityReservation,
        organizationWindowSeconds:
          policy.requestWindows.organization.windowSeconds,
        userWindowSeconds: policy.requestWindows.user.windowSeconds,
        requestDigest: execution.admissionRequest.requestDigest,
        runtimePolicyDigest: policy.policyDigest,
        tenantScopeDigest: accounting.identity.tenantScopeDigest,
      };
      const snapshot = await runtimeStore.inspect(state);
      const claim = {
        ...seedRuntimeAdmissionFixture().claim(snapshot),
        ...state,
        admissionRequest: execution.admissionRequest,
        admissionDecision: execution.admissionDecision,
        fingerprint: accounting.identity.fingerprint,
        leaseId: execution.admissionDecision.authorization.concurrencyLeaseId,
        commercialExpiresAt: execution.commercialRequest.expiresAt,
        executionLeaseExpiresAt: execution.commercialRequest.expiresAt,
        limits: {
          maximumConcurrentOrganizationJobs:
            policy.requestWindows.organization.maximumConcurrentJobs,
          maximumConcurrentUserJobs:
            policy.requestWindows.user.maximumConcurrentJobs,
          maximumOrganizationRequests:
            policy.requestWindows.organization.maximumRequests,
          maximumUserRequests: policy.requestWindows.user.maximumRequests,
        },
      };
      if (claim.leaseId === undefined)
        throw Error("Missing admitted concurrency lease");
      const admitted = await runtimeStore.claim({
        ...claim,
        leaseId: claim.leaseId,
      });
      if (admitted.kind !== "claimed")
        throw Error("Missing admitted seed runtime");
      const workflows = new PostgresModelCommercialWorkflowStore({
        database: harness.database,
        scope: accounting.fixture.scope,
      });
      const lease = await workflows.claimExecution(
        commercialClaim(accounting.workflow.request),
      );
      if (lease.kind !== "acquired")
        throw Error("Missing commercial workflow lease");
      await workflows.compareAndSet({
        expectedRevision: 0,
        lease: lease.lease,
        record: accounting.workflow,
        tenantScopeDigest: accounting.fixture.scope.tenantScopeDigest,
        trustedNow: new Date().toISOString(),
      });
      const request = {
        ...f.input,
        execution,
        accountingBinding: accounting.binding,
      };
      const reservations =
        await f.adapter.createSeedCommercialReservations(request);
      const rows = async () =>
        (
          await harness.database.query(
            sql(
              "SELECT (SELECT count(*)::int FROM credit_reservations WHERE organization_id=$1) AS reservations, (SELECT count(*)::int FROM model_commercial_reservation_decisions WHERE organization_id=$1) AS decisions, (SELECT count(*)::int FROM usage_ledger_entries WHERE organization_id=$1 AND entry_kind='reservation') AS ledger, (SELECT count(*)::int FROM model_commercial_accounting_outcomes WHERE organization_id=$1) AS outcomes",
              [f.scope.organizationId],
            ),
          )
        ).rows[0];
      return {
        ...f,
        accounting,
        execution,
        runtimeStore,
        admitted,
        request,
        reservations,
        rows,
      };
    }

    async function seedCanonicalFixtureV4(
      prompt?: ReviewedPromptTemplateV1,
      lifetimeMilliseconds = 240000,
    ) {
      const f = await preflightFixture(prompt);
      Object.assign(f.input.invocation, {
        maximumOutputTokens: 1000,
        timeoutMilliseconds: 10000,
      });
      const issued = await f.adapter.issueSeedRepairInput(f.input);
      if (issued.kind !== "issued")
        throw Error("Missing newly issued seed input");
      const prepared = prepareModelLiveSeedStageInputV3({
        ...f.prepared,
        plan: f.plan,
        selection: f.selection,
        invocation: f.input.invocation,
        observedAt: issued.record.issuedAt,
      });
      const accounting = await seedSequenceAccountingFixtureV4(
        seedRuntimeExecutionForPreparedV4(
          prepared,
          issued.record,
          lifetimeMilliseconds,
        ),
        {
          pricing: f.price,
          normalization: f.normalization,
          authorization: {
            planVersionId: accountingPlan,
            chargingPolicyVersion: accountingCharging,
            entitlementPolicyVersion: accountingEntitlement,
            maximumInputUnits: 100000,
            maximumOutputUnits: 100000,
          },
        },
      );
      const execution = accounting.execution;
      const runtimeStore = await f.adapter.createSeedRuntimeAdmissionV4({
        ...f.input,
        execution,
      });
      const policy = f.plan.definition.policy;
      const state = {
        organizationId: f.scope.organizationId,
        projectId: f.scope.projectId,
        userId: f.scope.userId,
        decidedAt: execution.admissionDecision.decidedAt,
        idempotencyKeyDigest: execution.admissionRequest.idempotencyKeyDigest,
        liveAuthorityReservation: accounting.runtime.liveAuthorityReservation,
        organizationWindowSeconds:
          policy.requestWindows.organization.windowSeconds,
        userWindowSeconds: policy.requestWindows.user.windowSeconds,
        requestDigest: execution.admissionRequest.requestDigest,
        runtimePolicyDigest: policy.policyDigest,
        tenantScopeDigest: accounting.identity.tenantScopeDigest,
      };
      const snapshot = await runtimeStore.inspect(state);
      const claim = {
        ...seedSequenceRuntimeAdmissionFixtureV4().claim(snapshot),
        ...state,
        admissionRequest: execution.admissionRequest,
        admissionDecision: execution.admissionDecision,
        fingerprint: accounting.identity.fingerprint,
        leaseId: execution.admissionDecision.authorization.concurrencyLeaseId,
        commercialExpiresAt: execution.commercialRequest.expiresAt,
        executionLeaseExpiresAt: execution.commercialRequest.expiresAt,
        limits: {
          maximumConcurrentOrganizationJobs:
            policy.requestWindows.organization.maximumConcurrentJobs,
          maximumConcurrentUserJobs:
            policy.requestWindows.user.maximumConcurrentJobs,
          maximumOrganizationRequests:
            policy.requestWindows.organization.maximumRequests,
          maximumUserRequests: policy.requestWindows.user.maximumRequests,
        },
      };
      if (claim.leaseId === undefined)
        throw Error("Missing admitted concurrency lease");
      const admitted = await runtimeStore.claim({
        ...claim,
        leaseId: claim.leaseId,
      });
      if (admitted.kind !== "claimed")
        throw Error("Missing admitted seed runtime");
      const workflows = new PostgresModelCommercialWorkflowStore({
        database: harness.database,
        scope: accounting.fixture.scope,
      });
      const lease = await workflows.claimExecution(
        commercialClaim(accounting.workflow.request),
      );
      if (lease.kind !== "acquired")
        throw Error("Missing commercial workflow lease");
      await workflows.compareAndSet({
        expectedRevision: 0,
        lease: lease.lease,
        record: accounting.workflow,
        tenantScopeDigest: accounting.fixture.scope.tenantScopeDigest,
        trustedNow: new Date().toISOString(),
      });
      const request = {
        ...f.input,
        execution,
        accountingBinding: accounting.binding,
      };
      const reservations =
        await f.adapter.createSeedCommercialReservationsV4(request);
      const rows = async () =>
        (
          await harness.database.query(
            sql(
              "SELECT (SELECT count(*)::int FROM credit_reservations WHERE organization_id=$1) AS reservations, (SELECT count(*)::int FROM model_commercial_reservation_decisions WHERE organization_id=$1) AS decisions, (SELECT count(*)::int FROM usage_ledger_entries WHERE organization_id=$1 AND entry_kind='reservation') AS ledger, (SELECT count(*)::int FROM model_commercial_accounting_outcomes WHERE organization_id=$1) AS outcomes",
              [f.scope.organizationId],
            ),
          )
        ).rows[0];
      return {
        ...f,
        accounting,
        execution,
        runtimeStore,
        admitted,
        request,
        workflows,
        workflowLease: lease.lease,
        selectors: f.request.selectors,
        reservations,
        rows,
      };
    }

    async function seedDispatchFixtureV4(
      signal?: AbortSignal,
      prompt?: ReviewedPromptTemplateV1,
      lifetimeMilliseconds = 240000,
    ) {
      const f = await seedCanonicalFixtureV4(prompt, lifetimeMilliseconds);
      const result = await f.reservations.reserve(f.accounting.fixture.input);
      const synthetic = f.accounting.fixture.dispatchedRecord;
      if (
        !result.accepted ||
        synthetic?.reservationReceipt == null ||
        synthetic.dispatchIntent === null
      )
        throw Error(
          "Missing actual canonical reservation and synthetic coordinator intent",
        );
      const now = new Date().toISOString();
      const receiptBody = {
        accountingStatus: "active" as const,
        authority: "canonical-commercial-reservation-receipt-v1" as const,
        intentId: synthetic.reservationReceipt.intentId,
        receivedAt: now,
        result,
      };
      await f.workflows.compareAndSet({
        expectedRevision: 1,
        lease: f.workflowLease,
        record: {
          ...synthetic,
          revision: 1,
          reservationReceipt: {
            ...receiptBody,
            receiptId:
              "commercial_reservation_receipt_" +
              digest(receiptBody).slice(7, 55),
          },
          dispatchIntent: { ...synthetic.dispatchIntent, recordedAt: now },
        },
        tenantScopeDigest: f.accounting.fixture.scope.tenantScopeDigest,
        trustedNow: now,
      });
      const journal = await f.adapter.createSeedDispatchJournalV4(
        f.request,
        signal,
      );
      const reservePlatform = async (
        invocation:
          | typeof f.input.invocation
          | ModelProviderHostRepairSuccessorInvocationV4 = f.input.invocation,
      ) => {
        const descriptor = invocation.descriptor;
        const claim = modelPlatformReservationInputSchema.parse({
          dispatchId: "dispatch_" + randomUUID().replaceAll("-", ""),
          scope: descriptor.scope,
          invocationId: descriptor.invocationId,
          ceiling: {
            contractVersion: 1,
            invocationDigest: digest(invocation),
            providerId: descriptor.providerId,
            modelId: descriptor.modelId,
            modelVersion: descriptor.modelVersion,
            inferenceProfileId: descriptor.inferenceProfileId,
            pricingVersionId:
              f.execution.routingDecision.pricingVersionReference,
            pricingVersionDigest: digest("synthetic counted pricing policy"),
            maximumCostMicroUsd: 1,
            validFrom: f.execution.commercialRequest.requestedAt,
            validUntil: f.execution.commercialRequest.expiresAt,
            dispatchValidUntil: new Date(
              Math.min(
                Date.now() + 30000,
                Date.parse(f.execution.commercialRequest.expiresAt),
              ),
            ).toISOString(),
          },
        });
        const store = new PostgresModelPlatformSpendStore({
          database: harness.database,
          scope: descriptor.scope,
        });
        const receipt = await store.reserve(claim);
        if (receipt.kind !== "reserved")
          throw Error("Fresh synthetic platform receipt required");
        return { claim, receipt };
      };
      const dispatchRows = async () =>
        (
          await harness.database.query(
            sql(
              "SELECT * FROM model_live_sequence_dispatches WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rows;
      return { ...f, journal, reservePlatform, dispatchRows };
    }

    it.each([
      "success",
      "unknown",
      "invalid-output",
      "revoked-after-count",
      "revoked-after-response",
      "revoked-before-send",
      "missing-host",
      "foreign-tenant",
    ] as const)(
      "executes the first V4 stage through actual SDK and PostgreSQL: %s",
      async (mode) => {
        const f = await seedDispatchFixtureV4();
        const candidate = seedCandidateExecutionFixture(f.input.invocation, {
          opened: () => {
            expect(f.state.transactionDepth).toBe(0);
          },
        });
        f.candidateState.configuration = {
          seed: f.host.configuration,
          policy: candidate.policy,
          executor: candidate.h.executor,
        };
        const invocation = f.input.invocation;
        const pricing = syntheticRepairDispatchPricing(invocation);
        vi.spyOn(
          BedrockGlobalFullWindowCostAuthority.prototype,
          "resolveHostSeedV3",
        ).mockImplementation((actual) =>
          Promise.resolve(syntheticRepairFullWindowCost(actual)),
        );
        let counts = 0,
          sends = 0;
        const http = vi
          .fn()
          .mockImplementation(async (request: BedrockCountHttpRequestV1) => {
            expect(f.state.transactionDepth).toBe(0);
            if (request.path.endsWith("/count-tokens")) {
              counts++;
              if (mode === "revoked-after-count") f.state.operators = [];
              return {
                response: {
                  statusCode: 200,
                  headers: {
                    "content-type": "application/json",
                    "x-amzn-requestid": "synthetic-bridge-count",
                  },
                  body: Buffer.from(JSON.stringify({ inputTokens: 20 })),
                },
              };
            }
            expect(request.path).toBe(
              "/model/" +
                encodeURIComponent(
                  invocation.descriptor.inferenceProfileId ?? "",
                ) +
                "/converse",
            );
            sends++;
            expect(await f.dispatchRows()).toHaveLength(1);
            if (mode === "unknown")
              throw Error("Synthetic uncertain HTTP result");
            if (mode === "revoked-after-response")
              f.modelState.available = false;
            return {
              response: {
                statusCode: 200,
                headers: {
                  "content-type": "application/json",
                  "x-amzn-requestid": "synthetic-bridge-result",
                },
                body: Buffer.from(
                  JSON.stringify({
                    stopReason: "tool_use",
                    output: {
                      message: {
                        role: "assistant",
                        content:
                          mode === "invalid-output"
                            ? [{ text: "invalid proposal" }]
                            : [
                                {
                                  toolUse: {
                                    name: invocation.responseTool.toolName,
                                    toolUseId: "synthetic-bridge-tool",
                                    input:
                                      candidate.providerResult.content.input,
                                  },
                                },
                              ],
                      },
                    },
                    usage: {
                      inputTokens: 20,
                      outputTokens: 10,
                      totalTokens: 30,
                    },
                  }),
                ),
              },
            };
          });
        if (mode === "revoked-before-send") {
          const open = f.adapter.createSeedDispatchJournalV4.bind(f.adapter);
          vi.spyOn(f.adapter, "createSeedDispatchJournalV4").mockImplementation(
            async (...args) => {
              const journal = await open(...args);
              return {
                ...journal,
                recordFirstDispatch: async (...dispatchArgs) => {
                  const receipt = await journal.recordFirstDispatch(
                    ...dispatchArgs,
                  );
                  f.modelState.available = false;
                  return receipt;
                },
              };
            },
          );
        }
        if (mode === "missing-host") f.candidateState.configuration = null;
        const input = {
          ...f.request,
          selectors: f.selectors,
          pricing,
          httpHandler: { handle: http },
        };
        if (mode === "foreign-tenant") {
          input.invocation = structuredClone(input.invocation);
          input.invocation.descriptor.scope.userId =
            "principal_other_synthetic";
        }
        if (mode === "success") {
          const result = await f.adapter.executeFirstSeedRepairV4(input);
          expect(result.kind).toBe("validated");
          expect(result.validation).toMatchObject({
            receipt: { disposition: "valid" },
          });
          expect(JSON.stringify(result)).not.toContain("repairSeedTypeWitness");
          await expect(
            f.make().executeFirstSeedRepairV4(input),
          ).rejects.toThrow();
        } else {
          await expect(
            f.adapter.executeFirstSeedRepairV4(input),
          ).rejects.toThrow();
        }
        const sent = [
          "success",
          "unknown",
          "invalid-output",
          "revoked-after-response",
        ].includes(mode);
        expect(sends).toBe(sent ? 1 : 0);
        expect(counts).toBe(
          ["missing-host", "foreign-tenant"].includes(mode) ? 0 : 1,
        );
        const rows = (
          await harness.database.query(
            sql(
              "SELECT (SELECT count(*)::int FROM model_platform_spend_reservations WHERE organization_id=$1) AS spending,(SELECT count(*)::int FROM model_live_sequence_dispatches WHERE organization_id=$1) AS dispatches,(SELECT count(*)::int FROM model_live_sequence_observations WHERE organization_id=$1) AS observations,(SELECT count(*)::int FROM model_live_sequence_candidate_validations WHERE organization_id=$1) AS validations",
              [f.scope.organizationId],
            ),
          )
        ).rows[0];
        expect(rows).toEqual({
          spending: sent || mode === "revoked-before-send" ? 1 : 0,
          dispatches: sent || mode === "revoked-before-send" ? 1 : 0,
          observations: [
            "success",
            "invalid-output",
            "revoked-after-response",
          ].includes(mode)
            ? 1
            : 0,
          validations: mode === "success" ? 1 : 0,
        });
      },
      60000,
    );

    it("records V4 first dispatch once under racing attempts without a second permission", async () => {
      const f = await seedDispatchFixtureV4();
      const { claim, receipt } = await f.reservePlatform();
      const results = await Promise.all([
        f.journal.recordFirstDispatch(claim, receipt),
        f.journal.recordFirstDispatch(claim, receipt),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual([
        "duplicate",
        "recorded",
      ]);
      const result = results.find((r) => r.kind === "recorded");
      expect(result).toMatchObject({
        record: {
          contractVersion: 4,
          canonicalAttemptOrdinal: 1,
          platformReservationDigest: digest(receipt),
        },
      });
      await expect(
        harness.database.query(
          sql(
            "INSERT INTO model_live_sequence_dispatches SELECT (jsonb_populate_record(NULL::model_live_sequence_dispatches, to_jsonb(d)||jsonb_build_object('descriptor',d.descriptor||jsonb_build_object('content','forbidden-source')))).* FROM model_live_sequence_dispatches d WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
      const rows = await f.dispatchRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.["descriptor"]).toEqual(f.input.invocation.descriptor);
      expect(await f.rows()).toEqual({
        reservations: 1,
        decisions: 1,
        ledger: 1,
        outcomes: 0,
      });
      await expect(
        harness.database.query(
          sql(
            "UPDATE model_live_sequence_dispatches SET created_at=clock_timestamp() WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        harness.database.query(
          sql(
            "DELETE FROM model_live_sequence_dispatches WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        ),
      ).rejects.toMatchObject({ code: "55000" });
    }, 60000);

    it("rejects V4 first dispatch receipt and claim substitutions against actual platform rows", async () => {
      const f = await seedDispatchFixtureV4();
      const { claim, receipt } = await f.reservePlatform();
      for (const changed of [
        {
          ...receipt,
          dispatchBefore: new Date(
            Date.parse(receipt.dispatchBefore) + 1,
          ).toISOString(),
        },
        { ...receipt, claimDigest: digest("other claim") },
      ])
        await expect(
          f.journal.recordFirstDispatch(
            claim,
            modelPlatformReservationReceiptSchema.parse(changed),
          ),
        ).rejects.toMatchObject(denied);
      const altered = structuredClone(claim);
      altered.ceiling.maximumCostMicroUsd += 1;
      await expect(
        f.journal.recordFirstDispatch(altered, {
          ...receipt,
          claimDigest: digest(altered),
        }),
      ).rejects.toMatchObject(denied);
      expect(await f.dispatchRows()).toHaveLength(0);
      expect(await f.journal.recordFirstDispatch(claim, receipt)).toMatchObject(
        { kind: "recorded" },
      );
    }, 60000);

    it.each([
      "revoked",
      "configuration",
      "runtime-released",
      "cancelled",
    ] as const)(
      "denies V4 first dispatch after %s",
      async (kind) => {
        const controller = new AbortController();
        const f = await seedDispatchFixtureV4(controller.signal);
        if (kind === "revoked")
          await f.adapter.revoke({
            definitionId: f.plan.definition.definitionId,
            planDigest: f.plan.planDigest,
          });
        if (kind === "configuration") f.modelState.available = false;
        if (kind === "runtime-released")
          await f.runtimeStore.release({
            tenantScopeDigest: f.accounting.identity.tenantScopeDigest,
            executionLease: f.admitted.executionLease,
          });
        if (kind === "cancelled") controller.abort();
        const { claim, receipt } = await f.reservePlatform();
        await expect(
          f.journal.recordFirstDispatch(claim, receipt),
        ).rejects.toMatchObject(denied);
        expect(await f.dispatchRows()).toHaveLength(0);
        expect(await f.rows()).toEqual({
          reservations: 1,
          decisions: 1,
          ledger: 1,
          outcomes: 0,
        });
      },
      60000,
    );

    it("denies V4 first dispatch journal creation for foreign scope or changed RAM input", async () => {
      const f = await seedCanonicalFixtureV4();
      await expect(
        f
          .make({ scope: { ...f.scope, organizationId: "org_foreign" } })
          .createSeedDispatchJournalV4(f.request),
      ).rejects.toThrow();
      const changed = structuredClone(f.request);
      Object.assign(changed.invocation, { maximumOutputTokens: 999 });
      await expect(
        f.adapter.createSeedDispatchJournalV4(changed),
      ).rejects.toThrow();
      expect(await f.rows()).toEqual({
        reservations: 0,
        decisions: 0,
        ledger: 0,
        outcomes: 0,
      });
    }, 60000);

    async function seedObservedFixtureV4(
      prompt?: ReviewedPromptTemplateV1,
      lifetimeMilliseconds = 240000,
    ) {
      const f = await seedDispatchFixtureV4(
        undefined,
        prompt,
        lifetimeMilliseconds,
      );
      const { claim, receipt } = await f.reservePlatform();
      const sent = await f.journal.recordFirstDispatch(claim, receipt);
      if (sent.kind !== "recorded")
        throw Error("Fresh synthetic dispatch required");
      const descriptor = f.input.invocation.descriptor;
      const usage = normalizedModelUsageV1Schema.parse({
        contractVersion: 1,
        attemptNumber: 1,
        inputUnits: "10",
        outputUnits: "20",
        cacheReadUnits: "0",
        cacheWriteUnits: "0",
        thinkingUnits: "5",
        startedAt: sent.record.dispatchedAt,
        completedAt: new Date(
          Date.parse(sent.record.dispatchedAt) + 1,
        ).toISOString(),
        durationMilliseconds: 1,
        feature: descriptor.feature,
        inputDigest: descriptor.inputDigest,
        idempotencyKeyDigest: descriptor.idempotencyKeyDigest,
        invocationId: descriptor.invocationId,
        modelId: descriptor.modelId,
        modelVersion: descriptor.modelVersion,
        providerId: descriptor.providerId,
        inferenceProfileId: descriptor.inferenceProfileId,
        promptTemplateId: descriptor.promptTemplateId,
        promptVersion: descriptor.promptVersion,
        scope: descriptor.scope,
        providerRequestId: "synthetic_provider_" + descriptor.invocationId,
        usageRecordId: "synthetic_usage_" + descriptor.invocationId,
        result: "succeeded",
      });
      const observationRows = async () =>
        (
          await harness.database.query(
            sql(
              "SELECT * FROM model_live_sequence_observations WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rows;
      return { ...f, usage, sent, observationRows };
    }

    it.each(["none", "known-first", "unknown-first"] as const)(
      "recovers expired repair only with database-proven complete usage: %s",
      async (mode) => {
        const observed =
          mode === "none"
            ? undefined
            : await seedObservedFixtureV4(
                reviewedHostBoundedRepairPromptV4,
                30000,
              );
        const f =
          observed ??
          (await seedDispatchFixtureV4(
            undefined,
            reviewedHostBoundedRepairPromptV4,
            30000,
          ));
        if (mode === "known-first" && observed !== undefined)
          await observed.journal.recordKnownUsage(observed.usage);
        const recover = () =>
          f.make().recoverRecordedSeedRepairAccountingV4({
            reference: f.input.reference,
            execution: f.execution,
          });
        expect(await recover()).toEqual({ kind: "pending" });
        await expect(
          harness.database.query(
            sql(
              "INSERT INTO model_live_repair_expiry_receipts_v4(organization_id,project_id,principal_id,workflow_scope_sha256,workflow_id,source_revision,observed_at,receipt) SELECT organization_id,project_id,principal_id,scope_sha256,workflow_id,(snapshot->>'revision')::bigint,clock_timestamp()+interval '1 year','{}'::jsonb FROM model_commercial_workflows WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          ),
        ).rejects.toMatchObject({ code: "23514" });
        const remaining =
          Date.parse(f.execution.commercialRequest.expiresAt) - Date.now();
        expect(remaining).toBeGreaterThan(0);
        await new Promise((resolve) => setTimeout(resolve, remaining + 50));
        await expect(f.journal.assertCurrentDispatch()).rejects.toThrow();
        f.state.operators = [];
        f.candidateState.configuration = null;
        const result = await recover();
        const caseResult = await f.make().readRecordedSeedRepairCaseV4({
          reference: f.input.reference,
          execution: f.execution,
        });
        if (mode === "unknown-first")
          expect(caseResult).toEqual({ kind: "pending" });
        else {
          expect(caseResult.kind).toBe("found");
          if (caseResult.kind === "found") {
            expect(caseResult.outcomes.map((o) => o.status)).toEqual([
              mode === "none" ? "not-dispatched" : "dispatch-unknown",
              "not-dispatched",
            ]);
            expect(caseResult.receipt.result.usefulOutputDelivered).toBe(false);
          }
        }
        if (mode === "unknown-first")
          expect(result).toEqual({ kind: "pending" });
        else {
          expect(result.kind).toBe("released");
          if (result.kind !== "released")
            throw Error("Verified expiry must release");
          expect(result.outcome.event.chargedCreditUnits).toBe(0);
          expect(result.outcome.event.attempts).toHaveLength(
            mode === "none" ? 0 : 1,
          );
          expect(await recover()).toEqual({ ...result, replayed: true });
          await expect(
            harness.database.query(
              sql(
                "DELETE FROM model_live_repair_expiry_receipts_v4 WHERE organization_id=$1",
                [f.scope.organizationId],
              ),
            ),
          ).rejects.toMatchObject({ code: "55000" });
          await expect(
            f
              .make({ scope: { ...f.scope, projectId: "project_foreign" } })
              .recoverRecordedSeedRepairAccountingV4({
                reference: f.input.reference,
                execution: f.execution,
              }),
          ).rejects.toThrow();
        }
        const rows = await harness.database.query(
          sql(
            "SELECT r.status,(SELECT count(*)::int FROM model_live_repair_expiry_receipts_v4 x WHERE x.organization_id=r.organization_id) AS proofs,(SELECT count(*)::int FROM usage_ledger_entries e WHERE e.organization_id=r.organization_id AND e.reservation_id=r.reservation_id AND e.entry_kind<>'reservation') AS terminals FROM credit_reservations r WHERE r.organization_id=$1",
            [f.scope.organizationId],
          ),
        );
        expect(rows.rows).toEqual([
          {
            status: mode === "unknown-first" ? "active" : "released",
            proofs: mode === "unknown-first" ? 0 : 1,
            terminals: mode === "unknown-first" ? 0 : 1,
          },
        ]);
      },
      90000,
    );

    it.each([
      "first-provider-error",
      "final-provider-error",
      "final-canceled",
    ] as const)(
      "releases only immutable known failed repair usage: %s",
      async (mode) => {
        const final = mode.startsWith("final-");
        const finalFixture = final
          ? await finalRepairInputFixtureV4()
          : undefined;
        const f =
          finalFixture ??
          (await seedObservedFixtureV4(reviewedHostBoundedRepairPromptV4));
        let usage = normalizedModelUsageV1Schema.parse({
          ...f.usage,
          result: mode.endsWith("canceled")
            ? ("canceled" as const)
            : ("provider-error" as const),
        });
        if (finalFixture !== undefined) {
          await f.journal.issueSuccessorInput(finalFixture.invocation);
          const journal = await f.journal.createSuccessorDispatchJournal(
            finalFixture.invocation,
          );
          const platform = await f.reservePlatform(finalFixture.invocation);
          const sent = await journal.recordFinalDispatch(
            platform.claim,
            platform.receipt,
          );
          if (sent.kind !== "recorded")
            throw Error("Fresh final dispatch required");
          const descriptor = finalFixture.invocation.descriptor;
          const completedAt = new Date().toISOString();
          usage = normalizedModelUsageV1Schema.parse({
            ...usage,
            invocationId: descriptor.invocationId,
            inputDigest: descriptor.inputDigest,
            idempotencyKeyDigest: descriptor.idempotencyKeyDigest,
            usageRecordId: "synthetic_failed_final_" + descriptor.invocationId,
            providerRequestId: "synthetic-failed-final-provider-request",
            startedAt: sent.record.dispatchedAt,
            completedAt,
            durationMilliseconds:
              Date.parse(completedAt) - Date.parse(sent.record.dispatchedAt),
          });
          await journal.recordKnownUsage(usage);
        } else await f.journal.recordKnownUsage(usage);
        f.state.operators = [];
        f.candidateState.configuration = null;
        const recover = () =>
          f.make().recoverRecordedSeedRepairAccountingV4({
            reference: f.input.reference,
            execution: f.execution,
          });
        const read = () =>
          f.make().readRecordedSeedRepairCaseV4({
            reference: f.input.reference,
            execution: f.execution,
          });
        const beforeAccounting = await read();
        expect(beforeAccounting.kind).toBe("found");
        const beforeTerminal = await harness.database.query(
          sql(
            "SELECT count(*)::int AS count FROM model_commercial_accounting_outcomes WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        );
        expect(beforeTerminal.rows[0]?.["count"]).toBe(0);
        await expect(
          f
            .make({ scope: { ...f.scope, organizationId: "org_foreign" } })
            .readRecordedSeedRepairCaseV4({
              reference: f.input.reference,
              execution: f.execution,
            }),
        ).rejects.toThrow();
        const result = await recover();
        const caseResult = await f.make().readRecordedSeedRepairCaseV4({
          reference: f.input.reference,
          execution: f.execution,
        });
        expect(caseResult).toEqual(beforeAccounting);
        expect(await read()).toEqual(caseResult);
        expect(caseResult.kind).toBe("found");
        if (caseResult.kind === "found") {
          expect(caseResult.outcomes.map((o) => o.status)).toEqual(
            final
              ? ["validated", "provider-failed"]
              : ["provider-failed", "not-dispatched"],
          );
          expect(caseResult.receipt.result.usefulOutputDelivered).toBe(false);
        }
        expect(result.kind).toBe("released");
        if (result.kind !== "released")
          throw Error("Known failure must release");
        expect(result.replayed).toBe(false);
        expect(result.outcome.kind).toBe("release");
        expect(result.outcome.event.chargedCreditUnits).toBe(0);
        expect(
          result.outcome.event.estimatedProviderCostMicros,
        ).toBeGreaterThan(0);
        expect(result.outcome.event.attempts).toHaveLength(final ? 2 : 1);
        expect(await recover()).toEqual({ ...result, replayed: true });
        await expect(
          f
            .make({ scope: { ...f.scope, organizationId: "org_foreign" } })
            .recoverRecordedSeedRepairAccountingV4({
              reference: f.input.reference,
              execution: f.execution,
            }),
        ).rejects.toThrow();
        const rows = await harness.database.query(
          sql(
            "SELECT r.status,(SELECT count(*)::int FROM model_commercial_accounting_outcomes o WHERE o.organization_id=r.organization_id) AS outcomes,(SELECT count(*)::int FROM usage_ledger_entries e WHERE e.organization_id=r.organization_id AND e.reservation_id=r.reservation_id AND entry_kind<>'reservation') AS terminals FROM credit_reservations r WHERE r.organization_id=$1",
            [f.scope.organizationId],
          ),
        );
        expect(rows.rows).toEqual([
          { status: "released", outcomes: 1, terminals: 1 },
        ]);
      },
      60000,
    );

    it("records V4 first usage once under concurrent observations and restores exact metadata", async () => {
      const f = await seedObservedFixtureV4();
      expect(await f.journal.recoverKnownUsage()).toEqual({ kind: "missing" });
      const results = await Promise.all([
        f.journal.recordKnownUsage(f.usage),
        f.journal.recordKnownUsage(f.usage),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual([
        "recorded",
        "replayed",
      ]);
      const result = results.find((r) => r.kind === "recorded");
      expect(result).toMatchObject({
        observation: {
          canonicalAttemptOrdinal: 1,
          normalizedUsageDigest: digest(f.usage),
        },
        attempt: {
          attemptKind: "repair",
          usage: {
            inputUnits: 10,
            outputUnits: 20,
            totalUnits: 30,
            providerSpecificUnits: [],
          },
        },
      });
      const rows = await f.observationRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.["normalized_usage"]).toEqual(f.usage);
      const recovery = await f.adapter.openSeedUsageRecoveryV4(f.request);
      expect(Object.keys(recovery)).toEqual([
        "recoverValidatedResult",
        "recoverFinalInput",
        "recoverFinalKnownUsage",
        "recoverFinalCandidateValidation",
        "recoverUnusedFinalStage",
        "recoverCandidateValidation",
        "recoverKnownUsage",
      ]);
      expect(await recovery.recoverKnownUsage()).toMatchObject({
        kind: "found",
        usage: f.usage,
      });
      expect(await f.rows()).toEqual({
        reservations: 1,
        decisions: 1,
        ledger: 1,
        outcomes: 0,
      });
      await expect(
        harness.database.query(
          sql(
            "UPDATE model_live_sequence_observations SET created_at=clock_timestamp() WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        harness.database.query(
          sql(
            "DELETE FROM model_live_sequence_observations WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        harness.database.query(
          sql(
            "INSERT INTO model_live_sequence_observations SELECT (jsonb_populate_record(NULL::model_live_sequence_observations, to_jsonb(o)||jsonb_build_object('normalized_usage',o.normalized_usage||jsonb_build_object('content','forbidden-output')))).* FROM model_live_sequence_observations o WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }, 60000);

    it("records V4 first usage after revocation, configuration loss and lease release without a new send", async () => {
      const f = await seedObservedFixtureV4();
      await f.adapter.revoke({
        definitionId: f.plan.definition.definitionId,
        planDigest: f.plan.planDigest,
      });
      f.modelState.available = false;
      await f.runtimeStore.release({
        tenantScopeDigest: f.accounting.identity.tenantScopeDigest,
        executionLease: f.admitted.executionLease,
      });
      expect(await f.journal.recordKnownUsage(f.usage)).toMatchObject({
        kind: "recorded",
      });
      const recovery = await f.adapter.openSeedUsageRecoveryV4(f.request);
      expect(await recovery.recoverKnownUsage()).toMatchObject({
        kind: "found",
        usage: f.usage,
      });
      expect(recovery).not.toHaveProperty("recordKnownUsage");
      expect(recovery).not.toHaveProperty("recordFirstDispatch");
      expect(await f.rows()).toEqual({
        reservations: 1,
        decisions: 1,
        ledger: 1,
        outcomes: 0,
      });
    }, 60000);

    it("rejects V4 first usage substitutions and unknown provider usage", async () => {
      const f = await seedObservedFixtureV4();
      for (const kind of ["scope", "input", "model", "unknown"] as const) {
        const usage = structuredClone(f.usage);
        if (kind === "scope") usage.scope.userId = "foreign_principal";
        if (kind === "input") usage.inputDigest = digest("foreign-input");
        if (kind === "model")
          Object.assign(usage, { modelVersion: "foreign-model" });
        if (kind === "unknown")
          Reflect.deleteProperty(usage, "providerRequestId");
        await expect(f.journal.recordKnownUsage(usage)).rejects.toMatchObject(
          denied,
        );
      }
      expect(await f.observationRows()).toHaveLength(0);
      expect(await f.journal.recoverKnownUsage()).toEqual({ kind: "missing" });
    }, 60000);

    it("preserves V4 first usage on known provider failure and rejects a changed replay", async () => {
      const f = await seedObservedFixtureV4();
      f.usage.result = "provider-error";
      f.usage.outputUnits = "100000";
      expect(await f.journal.recordKnownUsage(f.usage)).toMatchObject({
        kind: "recorded",
        attempt: {
          status: "provider-failure",
          usage: { inputUnits: 10, outputUnits: 100000, totalUnits: 100010 },
        },
      });
      const changed = structuredClone(f.usage);
      changed.outputUnits = "99999";
      await expect(f.journal.recordKnownUsage(changed)).rejects.toMatchObject(
        denied,
      );
      expect(await f.journal.recoverKnownUsage()).toMatchObject({
        kind: "found",
        usage: f.usage,
      });
      expect(await f.rows()).toEqual({
        reservations: 1,
        decisions: 1,
        ledger: 1,
        outcomes: 0,
      });
    }, 60000);

    it(
      "rejects V4 first usage without an issued dispatch",
      async () => {
        const f = await seedObservedFixtureV4();
        const other = await seedDispatchFixtureV4();
        const descriptor = other.input.invocation.descriptor;
        const observedNow = new Date().toISOString();
        const usage = normalizedModelUsageV1Schema.parse({
          ...f.usage,
          scope: descriptor.scope,
          invocationId: descriptor.invocationId,
          inputDigest: descriptor.inputDigest,
          idempotencyKeyDigest: descriptor.idempotencyKeyDigest,
          startedAt: observedNow,
          completedAt: observedNow,
          durationMilliseconds: 0,
        });
        await expect(
          other.journal.recordKnownUsage(usage),
        ).rejects.toMatchObject(denied);
        expect(await other.journal.recoverKnownUsage()).toEqual({
          kind: "missing",
        });
      },
      timeout60Seconds,
    );

    it("rejects V4 first usage recovery for a foreign tenant or substituted workflow", async () => {
      const f = await seedObservedFixtureV4();
      await f.journal.recordKnownUsage(f.usage);
      await expect(
        f
          .make({ scope: { ...f.scope, organizationId: "org_foreign" } })
          .openSeedUsageRecoveryV4(f.request),
      ).rejects.toThrow();
      const changed = structuredClone(f.request);
      Object.assign(changed.execution.commercialRequest, {
        multiCallWorkflowId: "workflow_foreign",
      });
      const changedRecovery = await f.adapter.openSeedUsageRecoveryV4(changed);
      await expect(changedRecovery.recoverKnownUsage()).rejects.toThrow();
      await expect(changedRecovery.recoverValidatedResult()).rejects.toThrow();
      expect(await f.observationRows()).toHaveLength(1);
    }, 60000);

    it("rejects V4 first usage row digest corruption during authenticated recovery", async () => {
      const f = await seedObservedFixtureV4();
      await f.journal.recordKnownUsage(f.usage);
      const observed: SqlDatabase = {
        query: harness.database.query.bind(harness.database),
        close: () => Promise.resolve(),
        transaction: (work) =>
          harness.database.transaction((tx) =>
            work({
              query: async <R extends SqlRow>(statement: SqlStatement) => {
                const result = await tx.query<R>(statement);
                if (
                  statement.text.includes(
                    "SELECT * FROM model_live_sequence_observations",
                  ) &&
                  result.rows[0]
                )
                  Object.assign(result.rows[0], {
                    observation_sha256: "0".repeat(64),
                  });
                return result;
              },
            }),
          ),
      };
      const recovery = await f
        .make({ database: observed })
        .openSeedUsageRecoveryV4(f.request);
      await expect(recovery.recoverKnownUsage()).rejects.toMatchObject(denied);
      await expect(recovery.recoverValidatedResult()).rejects.toMatchObject(
        denied,
      );
      expect(await f.journal.recoverKnownUsage()).toMatchObject({
        kind: "found",
        usage: f.usage,
      });
    }, 60000);

    async function seedCandidateFixtureV4(
      kind: "valid" | "repairable" | "failure" = "valid",
      prompt?: ReviewedPromptTemplateV1,
    ) {
      const f = await seedObservedFixtureV4(prompt);
      const source = f.input.invocation.request.failedCandidates[0];
      if (source === undefined) throw Error("Missing synthetic candidate");
      const line =
        source.content
          .split("\n")
          .findIndex(
            (s) =>
              s === 'export const repairSeedTypeWitness: number = "invalid";',
          ) + 1;
      const candidate = seedCandidateExecutionFixture(
        f.input.invocation,
        {
          opened: () => {
            expect(f.state.transactionDepth).toBe(0);
          },
          execute: (_n, command) =>
            command.step === "typecheck" && kind !== "valid"
              ? candidateCommandResult(
                  kind === "repairable"
                    ? source.path +
                        "(" +
                        String(line) +
                        ",14): error TS2322: Type 'string' is not assignable to type 'number'.\n"
                    : "unrelated failure\n",
                  { exitCode: 2 },
                )
              : undefined,
        },
        kind === "repairable",
      );
      f.candidateState.configuration = {
        seed: f.host.configuration,
        policy: candidate.policy,
        executor: candidate.h.executor,
      };
      const usage = normalizeModelHostSeedUsageV3({
        descriptor: f.input.invocation.descriptor,
        providerUsage: candidate.providerResult.usage,
        result: "succeeded",
        startedAtMilliseconds: Date.parse(f.usage.startedAt),
        completedAtMilliseconds: Date.parse(f.usage.completedAt),
      });
      const rows = async () =>
        (
          await harness.database.query(
            sql(
              "SELECT * FROM model_live_sequence_candidate_validations WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rows;
      return { ...f, candidate, usage, candidateRows: rows };
    }

    it.each([
      "first-valid",
      "first-invalid",
      "final-valid",
      "final-invalid",
      "final-unknown",
      "withdrawn-between",
      "recover-first-valid",
      "recover-final-valid",
    ] as const)(
      "executes a retained two-repair case through actual SDK and PostgreSQL: %s",
      async (rawMode) => {
        const recoveryOnly = rawMode.startsWith("recover-");
        const mode =
          rawMode === "recover-first-valid"
            ? "first-valid"
            : rawMode === "recover-final-valid"
              ? "final-valid"
              : rawMode;
        const f = await seedDispatchFixtureV4(
          undefined,
          reviewedHostBoundedRepairPromptV4,
        );
        const requiresFinal = !mode.startsWith("first-");
        const source = f.input.invocation.request.failedCandidates[0];
        if (!source) throw Error("Missing source");
        const line =
          source.content
            .split("\n")
            .findIndex(
              (text) =>
                text ===
                'export const repairSeedTypeWitness: number = "invalid";',
            ) + 1;
        const firstCandidate = seedCandidateExecutionFixture(
          f.input.invocation,
          {
            opened: () => {
              expect(f.state.transactionDepth).toBe(0);
            },
            execute: (_, command) =>
              command.step === "typecheck" && mode !== "first-valid"
                ? candidateCommandResult(
                    requiresFinal
                      ? source.path +
                          "(" +
                          String(line) +
                          ",14): error TS2322: Type 'string' is not assignable to type 'number'.\n"
                      : "Unrelated failure\n",
                    { exitCode: 2 },
                  )
                : undefined,
          },
          requiresFinal,
        );
        f.candidateState.configuration = {
          seed: f.host.configuration,
          policy: firstCandidate.policy,
          executor: firstCandidate.h.executor,
        };
        let successor: ModelProviderHostRepairSuccessorInvocationV4 | undefined;
        const open = f.adapter.createSeedDispatchJournalV4.bind(f.adapter);
        vi.spyOn(f.adapter, "createSeedDispatchJournalV4").mockImplementation(
          async (...args) => {
            const journal = await open(...args);
            return {
              ...journal,
              prepareSuccessorInput: async () => {
                const prepared = await journal.prepareSuccessorInput();
                successor = prepared.invocation;
                if (mode === "withdrawn-between") f.state.operators = [];
                return prepared;
              },
            };
          },
        );
        for (const method of [
          "resolveHostSeedV3",
          "resolveHostRepairSuccessorV4",
        ] as const)
          vi.spyOn(
            BedrockGlobalFullWindowCostAuthority.prototype,
            method,
          ).mockImplementation(
            (actual: Parameters<typeof syntheticRepairFullWindowCost>[0]) =>
              Promise.resolve(syntheticRepairFullWindowCost(actual)),
          );
        let counts = 0,
          sends = 0;
        const http = vi
          .fn()
          .mockImplementation(async (request: BedrockCountHttpRequestV1) => {
            expect(f.state.transactionDepth).toBe(0);
            if (request.path.endsWith("/count-tokens")) {
              counts++;
              return {
                response: {
                  statusCode: 200,
                  headers: {
                    "content-type": "application/json",
                    "x-amzn-requestid":
                      "synthetic-case-count-" + String(counts),
                  },
                  body: Buffer.from(JSON.stringify({ inputTokens: 20 })),
                },
              };
            }
            sends++;
            expect(sends).toBeLessThanOrEqual(2);
            let invocation:
              | typeof f.input.invocation
              | ModelProviderHostRepairSuccessorInvocationV4 =
              f.input.invocation;
            let candidate = firstCandidate;
            if (sends === 2) {
              if (!successor) throw Error("No retained successor");
              invocation = successor;
              const rows = await harness.database.query(
                sql(
                  "SELECT count(*)::int AS count FROM model_live_repair_successor_dispatches_v4 WHERE organization_id=$1",
                  [f.scope.organizationId],
                ),
              );
              expect(rows.rows[0]?.["count"]).toBe(1);
              if (mode === "final-unknown")
                throw Error("Synthetic unknown final response");
              candidate = seedCandidateExecutionFixture(invocation, {
                opened: () => {
                  expect(f.state.transactionDepth).toBe(0);
                },
                execute: (_, command) =>
                  mode === "final-invalid" && command.step === "typecheck"
                    ? candidateCommandResult("Unrelated final failure\n", {
                        exitCode: 2,
                      })
                    : undefined,
              });
              f.candidateState.configuration = {
                seed: f.host.configuration,
                policy: candidate.policy,
                executor: candidate.h.executor,
              };
            }
            return {
              response: {
                statusCode: 200,
                headers: {
                  "content-type": "application/json",
                  "x-amzn-requestid":
                    "synthetic-case-response-" + String(sends),
                },
                body: Buffer.from(
                  JSON.stringify({
                    stopReason: "tool_use",
                    output: {
                      message: {
                        role: "assistant",
                        content: [
                          {
                            toolUse: {
                              name: invocation.responseTool.toolName,
                              toolUseId: "synthetic-case-tool",
                              input: candidate.providerResult.content.input,
                            },
                          },
                        ],
                      },
                    },
                    usage: {
                      inputTokens: 20,
                      outputTokens: 10,
                      totalTokens: 30,
                    },
                  }),
                ),
              },
            };
          });
        const input = {
          ...f.request,
          selectors: f.selectors,
          pricing: syntheticRepairDispatchPricing(f.input.invocation),
          httpHandler: { handle: http },
        };
        if (mode === "final-unknown" || mode === "withdrawn-between") {
          await expect(
            f.adapter.executeSeedRepairCaseV4(input),
          ).rejects.toThrow();
          if (mode === "final-unknown")
            expect(
              await f.adapter.completeRecordedSeedRepairV4(f.request),
            ).toEqual({ kind: "pending" });
          else
            await expect(
              f.adapter.completeRecordedSeedRepairV4(f.request),
            ).rejects.toThrow();
          const held = await harness.database.query(
            sql(
              "SELECT r.status,(SELECT count(*)::int FROM model_commercial_accounting_outcomes o WHERE o.organization_id=r.organization_id) AS outcomes FROM credit_reservations r WHERE r.organization_id=$1",
              [f.scope.organizationId],
            ),
          );
          expect(held.rows).toEqual([{ status: "active", outcomes: 0 }]);
          expect(
            await f.make().recoverRecordedSeedRepairAccountingV4({
              reference: f.input.reference,
              execution: f.execution,
            }),
          ).toEqual({ kind: "pending" });
        } else {
          const result = await f.adapter.executeSeedRepairCaseV4(input);
          expect(result.kind).toBe("validated-attempts");
          expect(result.accounting).toBe("pending");
          for (const tamper of ["receipt", "amount"] as const) {
            let mutations = 0;
            const altered: SqlDatabase = {
              query: harness.database.query.bind(harness.database),
              close: () => Promise.resolve(),
              transaction: (work) =>
                harness.database.transaction((tx) =>
                  work({
                    query: async <R extends SqlRow>(
                      statement: SqlStatement,
                    ) => {
                      if (
                        !statement.text.startsWith(
                          "INSERT INTO model_commercial_accounting_outcomes(",
                        )
                      )
                        return tx.query<R>(statement);
                      mutations += 1;
                      const values = [...statement.values];
                      if (tamper === "receipt") {
                        const receipt = JSON.parse(String(values[13])) as {
                          result: { resultId: string };
                        };
                        receipt.result.resultId += "_changed";
                        values[13] = JSON.stringify(receipt);
                      } else {
                        const outcome = JSON.parse(String(values[14])) as {
                          event: { estimatedProviderCostMicros: number };
                        };
                        outcome.event.estimatedProviderCostMicros += 1;
                        values[14] = JSON.stringify(outcome);
                        values[15] = digest(outcome).slice(7);
                      }
                      return tx.query<R>({ ...statement, values });
                    },
                  }),
                ),
            };
            await expect(
              f
                .make({ database: altered })
                .completeRecordedSeedRepairV4(f.request),
            ).rejects.toThrow();
            expect(mutations).toBe(1);
          }
          const operators = f.state.operators;
          f.state.operators = [];
          await expect(
            f.adapter.completeRecordedSeedRepairV4(f.request),
          ).rejects.toThrow();
          const candidateConfiguration = f.candidateState.configuration;
          if (recoveryOnly) f.candidateState.configuration = null;
          else f.state.operators = operators;
          const complete = () =>
            recoveryOnly
              ? f.make().recoverRecordedSeedRepairAccountingV4({
                  reference: f.input.reference,
                  execution: f.execution,
                })
              : f.adapter.completeRecordedSeedRepairV4(f.request);
          if (recoveryOnly) {
            await expect(
              f.make().recoverRecordedSeedRepairAccountingV4({
                reference: f.input.reference,
                execution: {
                  ...f.execution,
                  commercialRequest: {
                    ...f.execution.commercialRequest,
                    reservationId:
                      f.execution.commercialRequest.reservationId + "_changed",
                  },
                },
              }),
            ).rejects.toThrow();
          }
          const completion = await complete();
          expect(completion.kind).toBe("settled");
          if (completion.kind === "settled") {
            expect(completion.replayed).toBe(false);
            expect(completion.outcome.kind).toBe("settlement");
            expect(completion.outcome.event.attempts).toHaveLength(
              requiresFinal ? 2 : 1,
            );
            expect(await complete()).toEqual({ ...completion, replayed: true });
          }
          f.state.operators = operators;
          f.candidateState.configuration = candidateConfiguration;
          expect(result.first.validation.receipt.disposition).toBe(
            requiresFinal
              ? "invalid-repairable"
              : mode === "first-valid"
                ? "valid"
                : "invalid-nonrepairable",
          );
          if (requiresFinal) {
            expect(result.final?.validation.receipt.disposition).toBe(
              mode === "final-valid" ? "valid" : "invalid-nonrepairable",
            );
            expect(successor?.descriptor.invocationId).toBe(
              f.selection.stages.find(
                (stage) =>
                  stage.caseId === f.input.caseId &&
                  stage.stageKey === "repair-2",
              )?.invocationId,
            );
            expect(successor?.descriptor.idempotencyKeyDigest).not.toBe(
              f.input.invocation.descriptor.idempotencyKeyDigest,
            );
          } else {
            expect(result.final).toBeNull();
            expect(result.unused?.outcome).toMatchObject({
              status: "not-dispatched",
              reason:
                mode === "first-valid"
                  ? "predecessor-valid"
                  : "predecessor-nonrepairable",
            });
            const replays = await Promise.all([
              f.journal.recordUnusedFinalStage(),
              f.journal.recordUnusedFinalStage(),
            ]);
            expect(replays.every((value) => value.kind === "replayed")).toBe(
              true,
            );
            await expect(
              harness.database.query(
                sql(
                  "UPDATE model_live_repair_unused_stages_v4 SET proof_record=proof_record WHERE organization_id=$1",
                  [f.scope.organizationId],
                ),
              ),
            ).rejects.toThrow();
            f.state.operators = [];
            f.candidateState.configuration = null;
            const recovery = await f.make().openSeedUsageRecoveryV4({
              reference: f.input.reference,
              execution: f.execution,
            });
            const restored = await recovery.recoverUnusedFinalStage();
            expect(restored.kind).toBe("found");
            if (restored.kind !== "missing")
              expect(restored.outcome).toEqual(result.unused?.outcome);
          }
          expect(JSON.stringify(result)).not.toMatch(
            /repairSeedTypeWitness|unifiedDiff/,
          );
        }
        const expectedSends =
          requiresFinal && mode !== "withdrawn-between" ? 2 : 1;
        expect(sends).toBe(expectedSends);
        expect(counts).toBe(expectedSends);
        const rows = await harness.database.query(
          sql(
            "SELECT (SELECT count(*)::int FROM credit_reservations WHERE organization_id=$1) AS reservations,(SELECT count(*)::int FROM model_live_sequence_observations WHERE organization_id=$1) AS first_usage,(SELECT count(*)::int FROM model_live_repair_successor_observations_v4 WHERE organization_id=$1) AS final_usage,(SELECT count(*)::int FROM model_live_repair_successor_candidate_validations_v4 WHERE organization_id=$1) AS final_validation",
            [f.scope.organizationId],
          ),
        );
        const finalKnown =
          mode === "final-valid" || mode === "final-invalid" ? 1 : 0;
        expect(rows.rows[0]).toEqual({
          reservations: 1,
          first_usage: 1,
          final_usage: finalKnown,
          final_validation: finalKnown,
        });
        // A reopened reader retains financial/validation metadata after host
        // withdrawal, but cannot restore candidate content or acquire a send.
        f.state.operators = [];
        f.candidateState.configuration = null;
        // Data API JSON fields can be text; only the known JSON result is decoded.
        const textJson: SqlDatabase = {
          query: harness.database.query.bind(harness.database),
          close: () => Promise.resolve(),
          transaction: (work) =>
            harness.database.transaction((tx) =>
              work({
                query: async <R extends SqlRow>(statement: SqlStatement) => {
                  const result = await tx.query<R>(statement);
                  if (
                    statement.text.startsWith(
                      "SELECT cloudmarkup_recorded_repair_receipt_v4",
                    )
                  )
                    for (const row of result.rows)
                      Object.assign(row, {
                        receipt: JSON.stringify(row["receipt"]),
                      });
                  return result;
                },
              }),
            ),
        };
        const recovery = await f
          .make({ database: textJson })
          .openSeedUsageRecoveryV4({
            reference: f.input.reference,
            execution: f.execution,
          });
        const projected = await harness.database.query(
          sql(
            `SELECT cloudmarkup_recorded_repair_receipt_v4(organization_id,project_id,principal_id,scope_sha256,workflow_id,(snapshot->>'revision')::bigint) AS receipt,
          cloudmarkup_recorded_repair_receipt_v4('org_foreign',project_id,principal_id,scope_sha256,workflow_id,(snapshot->>'revision')::bigint) AS foreign_org,
          cloudmarkup_recorded_repair_receipt_v4(organization_id,'project_foreign',principal_id,scope_sha256,workflow_id,(snapshot->>'revision')::bigint) AS foreign_project,
          cloudmarkup_recorded_repair_receipt_v4(organization_id,project_id,'principal_foreign',scope_sha256,workflow_id,(snapshot->>'revision')::bigint) AS foreign_principal
          FROM model_commercial_workflows WHERE organization_id=$1 AND workflow_id=$2`,
            [
              f.scope.organizationId,
              f.execution.commercialRequest.multiCallWorkflowId,
            ],
          ),
        );
        expect(projected.rows).toHaveLength(1);
        expect(projected.rows[0]).toMatchObject({
          foreign_org: null,
          foreign_project: null,
          foreign_principal: null,
        });
        const restoredResult = await recovery.recoverValidatedResult();
        expect(
          await f.make().readRecordedSeedRepairCaseV4({
            reference: f.input.reference,
            execution: f.execution,
          }),
        ).toEqual(restoredResult);
        expect(projected.rows[0]?.["receipt"]).toEqual(
          restoredResult.kind === "found" ? restoredResult.receipt : null,
        );
        expect(restoredResult.kind).toBe(
          mode === "final-unknown" || mode === "withdrawn-between"
            ? "pending"
            : "found",
        );
        if (restoredResult.kind === "found") {
          expect(restoredResult.accounting).toBe("not-projected");
          expect(restoredResult.receipt.result.attempts).toHaveLength(
            expectedSends,
          );
          expect(restoredResult.receipt.result.status).toBe("completed");
          expect(restoredResult.outcomes).toHaveLength(2);
          expect(await recovery.recoverValidatedResult()).toEqual(
            restoredResult,
          );
          const terminalRows = await harness.database.query(
            sql(
              "SELECT count(*)::int AS count FROM model_commercial_accounting_outcomes WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          );
          expect(terminalRows.rows[0]?.["count"]).toBe(1);
          const ledger = await harness.database.query(
            sql(
              "SELECT r.status,(SELECT count(*)::int FROM usage_ledger_entries e WHERE e.organization_id=r.organization_id AND e.reservation_id=r.reservation_id AND e.entry_kind='settlement') AS settlements FROM credit_reservations r WHERE r.organization_id=$1",
              [f.scope.organizationId],
            ),
          );
          expect(ledger.rows).toEqual([{ status: "settled", settlements: 1 }]);
        }
        expect(JSON.stringify(restoredResult)).not.toMatch(
          /repairSeedTypeWitness|unifiedDiff/,
        );
        const restoredInput = await recovery.recoverFinalInput();
        expect(restoredInput !== null).toBe(expectedSends === 2);
        const restoredUsage = await recovery.recoverFinalKnownUsage();
        expect(restoredUsage.kind).toBe(finalKnown === 1 ? "found" : "missing");
        const restoredValidation =
          await recovery.recoverFinalCandidateValidation();
        expect(restoredValidation.kind).toBe(
          finalKnown === 1 ? "found" : "missing",
        );
        if (restoredValidation.kind !== "missing")
          expect(restoredValidation.receipt.disposition).toBe(
            mode === "final-valid" ? "valid" : "invalid-nonrepairable",
          );
        expect(
          JSON.stringify({ restoredInput, restoredUsage, restoredValidation }),
        ).not.toMatch(/repairSeedTypeWitness|unifiedDiff/);
        expect(sends).toBe(expectedSends);
        expect(counts).toBe(expectedSends);
      },
      timeout120Seconds,
    );

    it.each(["repairable", "commit-revoked"] as const)(
      "rejects unsupported unused final-stage issuance: %s",
      async (mode) => {
        const f = await seedCandidateFixtureV4(
          mode === "repairable" ? "repairable" : "valid",
          reviewedHostBoundedRepairPromptV4,
        );
        await f.journal.recordKnownUsage(f.usage);
        await f.journal.validateKnownResponse(f.candidate.providerResult);
        await expect(
          f
            .make({ scope: { ...f.scope, organizationId: "org_foreign" } })
            .openSeedUsageRecoveryV4({
              reference: f.input.reference,
              execution: f.execution,
            }),
        ).rejects.toMatchObject(denied);
        const operators = f.state.operators;
        if (mode === "commit-revoked")
          f.state.afterInsert = () => {
            f.state.operators = [];
            return Promise.resolve();
          };
        await expect(f.journal.recordUnusedFinalStage()).rejects.toThrow();
        f.state.afterInsert = undefined;
        f.state.operators = operators;
        const recovery = await f.make().openSeedUsageRecoveryV4({
          reference: f.input.reference,
          execution: f.execution,
        });
        expect(await recovery.recoverUnusedFinalStage()).toEqual({
          kind: "missing",
        });
        expect(
          (
            await harness.database.query(
              sql(
                "SELECT count(*)::int AS count FROM model_live_repair_unused_stages_v4 WHERE organization_id=$1",
                [f.scope.organizationId],
              ),
            )
          ).rows[0]?.["count"],
        ).toBe(0);
        expect(await recovery.recoverKnownUsage()).toMatchObject({
          kind: "found",
        });
      },
      60_000,
    );

    async function finalRepairInputFixtureV4() {
      const f = await seedCandidateFixtureV4(
        "repairable",
        reviewedHostBoundedRepairPromptV4,
      );
      await f.journal.recordKnownUsage(f.usage);
      const validation = await f.journal.validateKnownResponse(
        f.candidate.providerResult,
      );
      if (validation.kind === "missing")
        throw Error("Missing actual recorded validation");
      const next = await f.journal.prepareSuccessorInput();
      const second = f.selection.stages.find(
        (stage) =>
          stage.caseId === f.input.caseId && stage.stageKey === "repair-2",
      );
      if (!second) throw Error("Missing selected final stage");
      const invocation: ModelProviderHostRepairSuccessorInvocationV4 = {
        ...f.input.invocation,
        request: next.request,
        descriptor: modelLiveRepairSuccessorInvocationDescriptorV4Schema.parse({
          ...f.input.invocation.descriptor,
          contractVersion: 4,
          recordKind: "model-live-repair-successor-invocation-descriptor",
          invocationId: second.invocationId,
          inputDigest: digest({
            request: next.request,
            scope: f.input.invocation.descriptor.scope,
          }),
          idempotencyKeyDigest: digest("synthetic-second-stage-idempotency"),
        }),
      };
      return { ...f, validation, invocation };
    }

    it("issues final repair input only from retained actual validation and preserves one reservation", async () => {
      const f = await finalRepairInputFixtureV4();
      const { validation, invocation } = f;
      const issue = () => f.journal.issueSuccessorInput(invocation);
      const reopened = await f.make().createSeedDispatchJournalV4(f.request);
      await expect(
        reopened.issueSuccessorInput(invocation),
      ).rejects.toMatchObject(denied);
      const changed = structuredClone(invocation);
      const substitutedCandidate = changed.request.failedCandidates[0];
      if (!substitutedCandidate)
        throw Error("Missing synthetic final candidate");
      substitutedCandidate.content += "\n// substituted";
      await expect(
        f.journal.issueSuccessorInput(changed),
      ).rejects.toMatchObject(denied);
      const operators = f.state.operators;
      f.state.afterInsert = () => {
        f.state.operators = [];
        return Promise.resolve();
      };
      await expect(issue()).rejects.toMatchObject(denied);
      f.state.afterInsert = undefined;
      f.state.operators = operators;
      expect(
        (
          await harness.database.query(
            sql(
              "SELECT count(*)::int AS count FROM model_live_repair_successor_inputs_v4 WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          )
        ).rows[0]?.["count"],
      ).toBe(0);
      const issued = await issue();
      expect(issued.kind).toBe("issued");
      expect(issued.record).toMatchObject({
        stageKey: "repair-2",
        predecessor: {
          kind: "stage",
          outcomeDigest: validation.outcome.outcomeDigest,
        },
      });
      if (issued.kind !== "issued") throw Error("New final input required");
      expect(issued.invocation.request.failedCandidates[0]?.content).toBe(
        f.candidate.repaired,
      );
      expect(await issue()).toEqual({
        kind: "existing",
        record: issued.record,
      });
      const rows = await harness.database.query(
        sql(
          "SELECT * FROM model_live_repair_successor_inputs_v4 WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      expect(rows.rows).toHaveLength(1);
      expect(JSON.stringify(rows.rows)).not.toMatch(
        /repairSeedTypeWitness|unifiedDiff|bytesBase64/,
      );
      await expect(
        harness.database.query(
          sql(
            "UPDATE model_live_repair_successor_inputs_v4 SET input_record=input_record WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        ),
      ).rejects.toThrow();
      const original = f.candidateState.configuration;
      f.candidateState.configuration = null;
      await expect(issue()).rejects.toMatchObject(denied);
      f.candidateState.configuration = original;
      await f.adapter.revoke({
        definitionId: f.plan.definition.definitionId,
        planDigest: f.plan.planDigest,
      });
      await expect(issue()).rejects.toMatchObject(denied);
      expect(await f.rows()).toMatchObject({
        reservations: 1,
        decisions: 1,
        ledger: 1,
        outcomes: 0,
      });
    }, 60000);

    it(
      "records final repair dispatch against retained predecessor and one original reservation",
      async () => {
        const f = await finalRepairInputFixtureV4();
        const { invocation } = f;
        expect(await f.journal.recoverFinalKnownUsage()).toEqual({
          kind: "missing",
        });
        await expect(
          f.journal.createSuccessorDispatchJournal(invocation),
        ).rejects.toMatchObject(denied);
        const issued = await f.journal.issueSuccessorInput(invocation);
        if (issued.kind !== "issued") throw Error("Fresh final input required");
        const reopened = await f.make().createSeedDispatchJournalV4(f.request);
        await expect(
          reopened.createSuccessorDispatchJournal(invocation),
        ).rejects.toMatchObject(denied);
        const substituted = structuredClone(invocation);
        substituted.descriptor.invocationId =
          modelLiveRepairSuccessorInvocationDescriptorV4Schema.parse({
            ...substituted.descriptor,
            invocationId: "invocation_substituted",
          }).invocationId;
        await expect(
          f.journal.createSuccessorDispatchJournal(substituted),
        ).rejects.toMatchObject(denied);
        const journal =
          await f.journal.createSuccessorDispatchJournal(invocation);
        const competitor =
          await f.journal.createSuccessorDispatchJournal(invocation);
        expect(journal.reservedTokenCeiling).toEqual({
          input: Number(
            f.execution.commercialRequest.plannedCalls[1]?.maximumUsage
              .inputUnits,
          ),
          output: Number(
            f.execution.commercialRequest.plannedCalls[1]?.maximumUsage
              .outputUnits,
          ),
        });
        expect(
          Date.parse((await journal.assertCurrentDispatch()).expiresAt),
        ).toBeGreaterThan(Date.now());
        const rows = async () =>
          (
            await harness.database.query(
              sql(
                "SELECT * FROM model_live_repair_successor_dispatches_v4 WHERE organization_id=$1",
                [f.scope.organizationId],
              ),
            )
          ).rows;
        const operators = f.state.operators;
        let platform = await f.reservePlatform(invocation);
        f.state.operators = [];
        await expect(
          journal.recordFinalDispatch(platform.claim, platform.receipt),
        ).rejects.toMatchObject(denied);
        f.state.operators = operators;
        f.state.afterInsert = () => {
          f.state.operators = [];
          return Promise.resolve();
        };
        platform = await f.reservePlatform(invocation);
        await expect(
          journal.recordFinalDispatch(platform.claim, platform.receipt),
        ).rejects.toMatchObject(denied);
        f.state.afterInsert = undefined;
        f.state.operators = operators;
        expect(await rows()).toHaveLength(0);
        platform = await f.reservePlatform(invocation);
        const record = await journal.recordFinalDispatch(
          platform.claim,
          platform.receipt,
        );
        expect(record.kind).toBe("recorded");
        if (record.kind !== "recorded")
          throw Error("Fresh final dispatch required");
        expect(record.record).toMatchObject({
          stageId: issued.record.stageId,
          invocationId: invocation.descriptor.invocationId,
          inputBindingDigest: issued.record.inputBindingDigest,
          canonicalAttemptOrdinal: 2,
          canonicalPlannedCallDigest: digest(
            f.execution.commercialRequest.plannedCalls[1],
          ),
        });
        expect(await rows()).toHaveLength(1);
        expect(JSON.stringify(await rows())).not.toMatch(
          /repairSeedTypeWitness|unifiedDiff|bytesBase64/,
        );
        expect(
          Date.parse((await journal.assertCurrentDispatch()).expiresAt),
        ).toBeGreaterThan(Date.now());
        expect(
          await competitor.recordFinalDispatch(
            platform.claim,
            platform.receipt,
          ),
        ).toEqual({ kind: "duplicate" });
        await expect(competitor.assertCurrentDispatch()).rejects.toMatchObject(
          denied,
        );
        await expect(
          harness.database.query(
            sql(
              "UPDATE model_live_repair_successor_dispatches_v4 SET descriptor=descriptor WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          ),
        ).rejects.toThrow();
        await expect(
          harness.database.query(
            sql(
              "DELETE FROM model_live_repair_successor_dispatches_v4 WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          ),
        ).rejects.toThrow();
        const original = f.candidateState.configuration;
        f.candidateState.configuration = null;
        await expect(journal.assertCurrentDispatch()).rejects.toMatchObject(
          denied,
        );
        f.candidateState.configuration = original;
        await f.adapter.revoke({
          definitionId: f.plan.definition.definitionId,
          planDigest: f.plan.planDigest,
        });
        await expect(journal.assertCurrentDispatch()).rejects.toMatchObject(
          denied,
        );
        expect(await journal.recoverKnownUsage()).toEqual({ kind: "missing" });
        const completedAt = new Date().toISOString();
        const finalUsage = normalizedModelUsageV1Schema.parse({
          ...f.usage,
          invocationId: invocation.descriptor.invocationId,
          inputDigest: invocation.descriptor.inputDigest,
          idempotencyKeyDigest: invocation.descriptor.idempotencyKeyDigest,
          usageRecordId:
            "synthetic_final_usage_" + invocation.descriptor.invocationId,
          providerRequestId: "synthetic-final-provider-request",
          startedAt: record.record.dispatchedAt,
          completedAt,
          durationMilliseconds:
            Date.parse(completedAt) - Date.parse(record.record.dispatchedAt),
        });
        const unknown = structuredClone(finalUsage);
        void Reflect.deleteProperty(unknown, "providerRequestId");
        await expect(journal.recordKnownUsage(unknown)).rejects.toThrow();
        // Actual billing truth remains recordable after operator/plan withdrawal.
        const [knownA, knownB] = await Promise.all([
          journal.recordKnownUsage(finalUsage),
          reopened.recordFinalKnownUsage(finalUsage),
        ]);
        expect([knownA.kind, knownB.kind].sort()).toEqual([
          "recorded",
          "replayed",
        ]);
        if (knownA.kind === "missing") throw Error("Missing known final usage");
        expect(knownA.attempt).toMatchObject({
          attemptNumber: 2,
          attemptKind: "repair",
          retryOfAttemptId:
            f.input.invocation.descriptor.invocationId + ".attempt.1",
        });
        expect(await reopened.recoverFinalKnownUsage()).toMatchObject({
          kind: "found",
          observation: knownA.observation,
          usage: finalUsage,
        });
        await expect(
          journal.recordKnownUsage(
            normalizedModelUsageV1Schema.parse({
              ...finalUsage,
              outputUnits: "999999",
            }),
          ),
        ).rejects.toThrow();
        const usageRows = await harness.database.query(
          sql(
            "SELECT * FROM model_live_repair_successor_observations_v4 WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        );
        expect(usageRows.rows).toHaveLength(1);
        expect(JSON.stringify(usageRows.rows)).not.toMatch(
          /repairSeedTypeWitness|unifiedDiff|bytesBase64/,
        );
        await expect(
          harness.database.query(
            sql(
              "UPDATE model_live_repair_successor_observations_v4 SET normalized_usage=normalized_usage WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          ),
        ).rejects.toThrow();
        expect(await f.rows()).toMatchObject({
          reservations: 1,
          decisions: 1,
          ledger: 1,
          outcomes: 0,
        });
      },
      timeout60Seconds,
    );

    it.each(["valid", "invalid", "native-revoked", "commit-revoked"] as const)(
      "records final native candidate with original authority: %s",
      async (mode) => {
        const f = await finalRepairInputFixtureV4();
        const { invocation } = f;
        await f.journal.issueSuccessorInput(invocation);
        const journal =
          await f.journal.createSuccessorDispatchJournal(invocation);
        const candidate = seedCandidateExecutionFixture(invocation, {
          opened: () => {
            expect(f.state.transactionDepth).toBe(0);
            if (mode === "native-revoked") f.state.operators = [];
          },
          execute: (_n, command) =>
            mode === "invalid" && command.step === "typecheck"
              ? candidateCommandResult("Unrelated failure\n", { exitCode: 2 })
              : undefined,
        });
        candidate.providerResult.usage.providerRequestId =
          "synthetic-final-provider-request";
        f.candidateState.configuration = {
          seed: f.host.configuration,
          policy: candidate.policy,
          executor: candidate.h.executor,
        };
        const platform = await f.reservePlatform(invocation);
        const sent = await journal.recordFinalDispatch(
          platform.claim,
          platform.receipt,
        );
        if (sent.kind !== "recorded")
          throw Error("Fresh final dispatch required");
        await expect(
          journal.validateKnownResponse(candidate.providerResult),
        ).rejects.toMatchObject(denied);
        const usage = normalizeModelHostRepairSuccessorUsageV4({
          descriptor: invocation.descriptor,
          providerUsage: candidate.providerResult.usage,
          result: "succeeded",
          startedAtMilliseconds: Date.parse(sent.record.dispatchedAt),
          completedAtMilliseconds: Date.now(),
        });
        await journal.recordKnownUsage(usage);
        const operators = f.state.operators;
        if (mode === "commit-revoked")
          f.state.afterInsert = () => {
            f.state.operators = [];
            return Promise.resolve();
          };
        const result = journal.validateKnownResponse(candidate.providerResult);
        if (mode === "native-revoked" || mode === "commit-revoked") {
          await expect(result).rejects.toMatchObject(denied);
          f.state.afterInsert = undefined;
          f.state.operators = operators;
          expect(await f.journal.recoverFinalCandidateValidation()).toEqual({
            kind: "missing",
          });
          expect(await journal.recoverKnownUsage()).toMatchObject({
            kind: "found",
            usage,
          });
        } else {
          const actual = await result;
          expect(actual.kind).toBe("recorded");
          if (actual.kind === "missing")
            throw Error("Missing final validation");
          expect(actual.receipt).toMatchObject({
            contractVersion: 2,
            disposition: mode === "valid" ? "valid" : "invalid-nonrepairable",
            predecessorValidationReceiptDigest:
              f.validation.receipt.receiptDigest,
          });
          expect(actual.outcome).toMatchObject({
            stageKey: "repair-2",
            validation: {
              status: mode === "valid" ? "valid" : "invalid",
              repairable: false,
            },
          });
          const opens = candidate.h.open.mock.calls.length;
          expect(
            await journal.validateKnownResponse(candidate.providerResult),
          ).toMatchObject({
            kind: "found",
            receipt: actual.receipt,
            outcome: actual.outcome,
          });
          expect(candidate.h.open).toHaveBeenCalledTimes(opens);
          const reopened = await f
            .make()
            .createSeedDispatchJournalV4(f.request);
          expect(
            await reopened.recoverFinalCandidateValidation(),
          ).toMatchObject({
            kind: "found",
            receipt: actual.receipt,
            outcome: actual.outcome,
          });
          const rows = await harness.database.query(
            sql(
              "SELECT * FROM model_live_repair_successor_candidate_validations_v4 WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          );
          expect(rows.rows).toHaveLength(1);
          expect(JSON.stringify(rows.rows)).not.toMatch(
            /repairSeedTypeWitness|unifiedDiff|bytesBase64/,
          );
          await expect(
            harness.database.query(
              sql(
                "UPDATE model_live_repair_successor_candidate_validations_v4 SET receipt_record=receipt_record WHERE organization_id=$1",
                [f.scope.organizationId],
              ),
            ),
          ).rejects.toThrow();
        }
        expect(await f.rows()).toMatchObject({
          reservations: 1,
          decisions: 1,
          ledger: 1,
          outcomes: 0,
        });
      },
      timeout60Seconds,
    );

    it.each([
      "success",
      "unknown",
      "invalid-output",
      "revoked-after-count",
      "over-reserved-input",
      "revoked-before-send",
      "revoked-after-response",
    ] as const)(
      "executes the final V4 stage through actual SDK and PostgreSQL: %s",
      async (mode) => {
        const f = await finalRepairInputFixtureV4();
        const { invocation } = f;
        await f.journal.issueSuccessorInput(invocation);
        const originalJournal =
          await f.journal.createSuccessorDispatchJournal(invocation);
        const journal = {
          ...originalJournal,
          recordFinalDispatch: async (
            ...args: Parameters<typeof originalJournal.recordFinalDispatch>
          ) => {
            const recorded = await originalJournal.recordFinalDispatch(...args);
            if (mode === "revoked-before-send") f.modelState.available = false;
            return recorded;
          },
        };
        const candidate = seedCandidateExecutionFixture(invocation, {
          opened: () => {
            expect(f.state.transactionDepth).toBe(0);
          },
        });
        candidate.providerResult.usage.providerRequestId =
          "synthetic-final-provider-request";
        f.candidateState.configuration = {
          seed: f.host.configuration,
          policy: candidate.policy,
          executor: candidate.h.executor,
        };
        vi.spyOn(
          BedrockGlobalFullWindowCostAuthority.prototype,
          "resolveHostRepairSuccessorV4",
        ).mockImplementation((actual) =>
          Promise.resolve(syntheticRepairFullWindowCost(actual)),
        );
        const readers = await f.adapter.createSeedCommercialReadPortsV4({
          ...f.request,
          selectors: f.selectors,
        });
        let counts = 0,
          sends = 0;
        const http = vi
          .fn()
          .mockImplementation(async (request: BedrockCountHttpRequestV1) => {
            expect(f.state.transactionDepth).toBe(0);
            if (request.path.endsWith("/count-tokens")) {
              counts++;
              if (mode === "revoked-after-count") f.state.operators = [];
              return {
                response: {
                  statusCode: 200,
                  headers: {
                    "content-type": "application/json",
                    "x-amzn-requestid": "synthetic-final-count",
                  },
                  body: Buffer.from(
                    JSON.stringify({
                      inputTokens:
                        mode === "over-reserved-input"
                          ? journal.reservedTokenCeiling.input + 1
                          : 20,
                    }),
                  ),
                },
              };
            }
            expect(request.path).toBe(
              "/model/" +
                encodeURIComponent(
                  invocation.descriptor.inferenceProfileId ?? "",
                ) +
                "/converse",
            );
            sends++;
            const row = await harness.database.query(
              sql(
                "SELECT count(*)::int AS count FROM model_live_repair_successor_dispatches_v4 WHERE organization_id=$1",
                [f.scope.organizationId],
              ),
            );
            expect(row.rows[0]?.["count"]).toBe(1);
            if (mode === "unknown")
              throw Error("Synthetic uncertain final HTTP result");
            if (mode === "revoked-after-response")
              f.modelState.available = false;
            return {
              response: {
                statusCode: 200,
                headers: {
                  "content-type": "application/json",
                  "x-amzn-requestid": "synthetic-final-provider-request",
                },
                body: Buffer.from(
                  JSON.stringify({
                    stopReason: "tool_use",
                    output: {
                      message: {
                        role: "assistant",
                        content:
                          mode === "invalid-output"
                            ? [{ text: "invalid proposal" }]
                            : [
                                {
                                  toolUse: {
                                    name: invocation.responseTool.toolName,
                                    toolUseId: "synthetic-final-tool",
                                    input:
                                      candidate.providerResult.content.input,
                                  },
                                },
                              ],
                      },
                    },
                    usage: {
                      inputTokens: 20,
                      outputTokens: 10,
                      totalTokens: 30,
                    },
                  }),
                ),
              },
            };
          });
        const input = {
          database: f.database,
          configuration: f.modelState.configuration,
          journal,
          pricing: syntheticRepairDispatchPricing(invocation),
          httpHandler: { handle: http },
          authorizeCommercial: async () => {
            const current = await readers.resolve(
              f.execution.commercialRequest,
            );
            if (
              !current.allowed ||
              !current.featureEntitled ||
              current.commercialState !== "active"
            )
              throw Error("Current canonical commercial authority required");
          },
        };
        if (mode === "success") {
          const actual = await executeProductionFinalSeedRepairV4(input);
          expect(actual).toMatchObject({
            kind: "validated",
            observation: { observation: { canonicalAttemptOrdinal: 2 } },
            validation: {
              receipt: { contractVersion: 2, disposition: "valid" },
            },
          });
          expect(JSON.stringify(actual)).not.toContain("repairSeedTypeWitness");
          // Same retained journal cannot repeat CountTokens, reserve or send.
          await expect(
            executeProductionFinalSeedRepairV4(input),
          ).rejects.toThrow();
        } else
          await expect(
            executeProductionFinalSeedRepairV4(input),
          ).rejects.toThrow();
        const sent = [
          "success",
          "unknown",
          "invalid-output",
          "revoked-after-response",
        ].includes(mode);
        expect(counts).toBe(1);
        expect(sends).toBe(sent ? 1 : 0);
        const rows = (
          await harness.database.query(
            sql(
              "SELECT (SELECT count(*)::int FROM model_live_repair_successor_dispatches_v4 WHERE organization_id=$1) AS dispatches,(SELECT count(*)::int FROM model_live_repair_successor_observations_v4 WHERE organization_id=$1) AS observations,(SELECT count(*)::int FROM model_live_repair_successor_candidate_validations_v4 WHERE organization_id=$1) AS validations",
              [f.scope.organizationId],
            ),
          )
        ).rows[0];
        expect(rows).toEqual({
          dispatches: sent || mode === "revoked-before-send" ? 1 : 0,
          observations: [
            "success",
            "invalid-output",
            "revoked-after-response",
          ].includes(mode)
            ? 1
            : 0,
          validations: mode === "success" ? 1 : 0,
        });
        expect(await f.rows()).toMatchObject({
          reservations: 1,
          decisions: 1,
          ledger: 1,
          outcomes: 0,
        });
      },
      timeout60Seconds,
    );

    it.each(["valid", "repairable", "failure"] as const)(
      "issues V4 candidate %s from actual owned validation and recovers metadata",
      async (kind) => {
        const f = await seedCandidateFixtureV4(kind);
        await expect(f.journal.prepareSuccessorInput()).rejects.toMatchObject(
          denied,
        );
        await f.journal.recordKnownUsage(f.usage);
        const issued = await f.journal.validateKnownResponse(
          f.candidate.providerResult,
        );
        expect(issued.kind).toBe("recorded");
        if (issued.kind === "missing") throw Error("Missing validation");
        expect(issued.outcome).toMatchObject({
          status: "validated",
          validation: {
            status: kind === "valid" ? "valid" : "invalid",
            repairable: kind === "repairable",
          },
        });
        expect(f.candidate.h.open).toHaveBeenCalledTimes(
          kind === "valid" ? 2 : 1,
        );
        const replay = await f.journal.validateKnownResponse(
          f.candidate.providerResult,
        );
        expect(replay).toEqual({ ...issued, kind: "found" });
        expect(f.candidate.h.open).toHaveBeenCalledTimes(
          kind === "valid" ? 2 : 1,
        );
        if (kind === "repairable") {
          const next = await f.journal.prepareSuccessorInput();
          expect(next.authority).toBe("ram-only-unissued-repair-successor");
          expect(next.request.failedCandidates[0]?.content).toBe(
            f.candidate.repaired,
          );
          expect(next.request.predecessor.validationReceiptDigest).toBe(
            issued.receipt.receiptDigest,
          );
          expect(next.request.predecessor.outcomeDigest).toBe(
            issued.outcome.outcomeDigest,
          );
          expect(await f.journal.prepareSuccessorInput()).toEqual(next);
          const reopened = await f
            .make()
            .createSeedDispatchJournalV4(f.request);
          expect(
            await reopened.validateKnownResponse(f.candidate.providerResult),
          ).toEqual({ ...issued, kind: "found" });
          await expect(reopened.prepareSuccessorInput()).rejects.toMatchObject(
            denied,
          );
          const original = f.candidateState.configuration;
          f.candidateState.configuration = null;
          await expect(f.journal.prepareSuccessorInput()).rejects.toMatchObject(
            denied,
          );
          f.candidateState.configuration = original;
        } else {
          await expect(f.journal.prepareSuccessorInput()).rejects.toMatchObject(
            denied,
          );
        }
        const rows = await f.candidateRows();
        expect(rows).toHaveLength(1);
        expect(JSON.stringify(rows)).not.toMatch(
          /repairSeedTypeWitness|bytesBase64|unifiedDiff/,
        );
        await f.adapter.revoke({
          definitionId: f.plan.definition.definitionId,
          planDigest: f.plan.planDigest,
        });
        await expect(f.journal.prepareSuccessorInput()).rejects.toMatchObject(
          denied,
        );
        f.candidateState.configuration = null;
        f.modelState.available = false;
        const recovery = await f.adapter.openSeedUsageRecoveryV4(f.request);
        expect(await recovery.recoverCandidateValidation()).toEqual({
          ...issued,
          kind: "found",
        });
        await expect(
          f.journal.validateKnownResponse(f.candidate.providerResult),
        ).rejects.toMatchObject(denied);
        expect(await f.rows()).toMatchObject({
          reservations: 1,
          ledger: 1,
          outcomes: 0,
        });
      },
      timeout60Seconds,
    );
    it.each([
      "unknown-usage",
      "foreign-response",
      "missing-host",
      "revoked",
    ] as const)(
      "denies V4 candidate %s before opening a native session",
      async (kind) => {
        const f = await seedCandidateFixtureV4();
        if (kind !== "unknown-usage") await f.journal.recordKnownUsage(f.usage);
        if (kind === "foreign-response")
          f.candidate.providerResult.usage.providerRequestId =
            "foreign-response";
        if (kind === "missing-host") f.candidateState.configuration = null;
        if (kind === "revoked")
          await f.adapter.revoke({
            definitionId: f.plan.definition.definitionId,
            planDigest: f.plan.planDigest,
          });
        await expect(
          f.journal.validateKnownResponse(f.candidate.providerResult),
        ).rejects.toMatchObject(denied);
        expect(f.candidate.h.open).not.toHaveBeenCalled();
        expect(await f.candidateRows()).toHaveLength(0);
      },
      timeout60Seconds,
    );
    it("rejects V4 candidate authority withdrawal during native validation and retains known usage", async () => {
      const f = await seedCandidateFixtureV4();
      await f.journal.recordKnownUsage(f.usage);
      f.host.assertHostIsolation.mockImplementation(() => {
        f.candidateState.configuration = null;
        return Promise.resolve();
      });
      await expect(
        f.journal.validateKnownResponse(f.candidate.providerResult),
      ).rejects.toMatchObject(denied);
      expect(await f.candidateRows()).toHaveLength(0);
      expect(await f.journal.recoverKnownUsage()).toMatchObject({
        kind: "found",
        usage: f.usage,
      });
    }, 60000);
    it("keeps V4 candidate receipts immutable and rejects unknown SQL fields", async () => {
      const f = await seedCandidateFixtureV4();
      await f.journal.recordKnownUsage(f.usage);
      await f.journal.validateKnownResponse(f.candidate.providerResult);
      for (const command of [
        "UPDATE model_live_sequence_candidate_validations SET receipt_sha256=receipt_sha256",
        "DELETE FROM model_live_sequence_candidate_validations",
      ])
        await expect(
          harness.database.query(
            sql(command + " WHERE organization_id=$1", [
              f.scope.organizationId,
            ]),
          ),
        ).rejects.toMatchObject({ code: "55000" });
      await expect(
        harness.database.query(
          sql(
            "INSERT INTO model_live_sequence_candidate_validations SELECT (jsonb_populate_record(NULL::model_live_sequence_candidate_validations,to_jsonb(v)||jsonb_build_object('receipt_record',v.receipt_record||jsonb_build_object('content','forbidden')))).* FROM model_live_sequence_candidate_validations v WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }, 60000);

    it(
      "denies V4 candidate recovery under a foreign tenant and corrupted row metadata",
      async () => {
        const f = await seedCandidateFixtureV4();
        await f.journal.recordKnownUsage(f.usage);
        await f.journal.validateKnownResponse(f.candidate.providerResult);
        const foreign = await seedCandidateFixtureV4();
        await expect(
          f
            .make({ scope: foreign.scope, principal: foreign.principal })
            .openSeedUsageRecoveryV4(f.request),
        ).rejects.toMatchObject(denied);
        const database: SqlDatabase = {
          close: () => Promise.resolve(),
          query: (statement) => harness.database.query(statement),
          transaction: (work) =>
            harness.database.transaction((tx) =>
              work({
                async query<TRow extends SqlRow = SqlRow>(
                  statement: SqlStatement,
                ) {
                  const result = await tx.query<TRow>(statement);
                  if (
                    statement.text.startsWith(
                      "SELECT * FROM model_live_sequence_candidate_validations",
                    )
                  )
                    for (const row of result.rows)
                      Object.assign(row, { stage_id: "foreign_stage" });
                  return result;
                },
              }),
            ),
        };
        const recovery = await f
          .make({ database })
          .openSeedUsageRecoveryV4(f.request);
        await expect(recovery.recoverCandidateValidation()).rejects.toThrow();
      },
      timeout60Seconds,
    );
    it("records racing V4 candidate validations once with exact content agreement", async () => {
      const f = await seedCandidateFixtureV4();
      await f.journal.recordKnownUsage(f.usage);
      const candidate = seedCandidateExecutionFixture(f.input.invocation);
      let starts = 0;
      let release: () => void = () => {
        throw Error("Candidate overlap barrier was not initialized");
      };
      const bothStarted = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.candidateState.configuration = {
        seed: f.host.configuration,
        policy: candidate.policy,
        executor: {
          open: async (input) => {
            const session = await candidate.h.executor.open(input);
            starts += 1;
            if (starts === 2) release();
            if (starts <= 2) await bothStarted;
            return session;
          },
        },
      };
      const results = await Promise.all([
        f.journal.validateKnownResponse(candidate.providerResult),
        f.journal.validateKnownResponse(candidate.providerResult),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual([
        "recorded",
        "replayed",
      ]);
      expect(await f.candidateRows()).toHaveLength(1);
      if (results[0].kind === "missing" || results[1].kind === "missing")
        throw Error("Missing validation");
      expect(results[0].receipt).toEqual(results[1].receipt);
      const changed = structuredClone(candidate.providerResult);
      changed.usage.providerRequestId = "foreign-response";
      await expect(
        f.journal.validateKnownResponse(changed),
      ).rejects.toMatchObject(denied);
      expect(await f.candidateRows()).toHaveLength(1);
    }, 60000);

    it("rejects V4 canonical runtime row drift and preserves historical reader closure", async () => {
      const f = await seedCanonicalFixtureV4();
      const row = (
        await harness.database.query(
          sql(
            "SELECT organization_id,project_id,principal_id,scope_sha256,snapshot,snapshot_sha256,revision::text,active_concurrency_lease_id,to_char(lease_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS lease_expires_at FROM model_runtime_admissions WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        )
      ).rows[0];
      if (row === undefined) throw Error("Missing actual V4 admission");
      expect(
        parseModelSeedSequenceReadRuntimeRowV4(row, f.scope).fingerprint,
      ).toBe(f.accounting.identity.fingerprint);
      expect(() => parseModelReadRuntimeRow(row, f.scope)).toThrow();
      expect(() => parseModelLiveReadRuntimeRow(row, f.scope)).toThrow();
      for (const key of [
        "organization_id",
        "project_id",
        "principal_id",
        "scope_sha256",
        "snapshot_sha256",
        "revision",
        "active_concurrency_lease_id",
        "lease_expires_at",
      ]) {
        expect(() =>
          parseModelSeedSequenceReadRuntimeRowV4(
            { ...row, [key]: key === "revision" ? "999" : "changed" },
            f.scope,
          ),
        ).toThrow();
      }
    }, 60000);

    it("reads V4 canonical two-slot limits, current balance and exact prices without writes", async () => {
      const f = await seedCanonicalFixtureV4();
      const reader = await f.adapter.createSeedCommercialReadPortsV4({
        ...f.request,
        selectors: f.selectors,
      });
      const before = await f.rows();
      const authorization = await reader.resolve(f.execution.commercialRequest);
      expect(authorization).toMatchObject({
        allowed: true,
        maximumInputUnits:
          f.execution.commercialRequest.requestedMaximumInputUnits,
        maximumOutputUnits: 2000,
        featureRequests: { current: 0 },
        organizationConcurrentReservations: { current: 0 },
      });
      expect(await reader.listProviderPricingVersions()).toEqual([f.price]);
      expect(await reader.listCreditNormalizationPolicies()).toEqual([
        f.normalization,
      ]);
      expect(await f.rows()).toEqual(before);
      await f.reservations.reserve(f.accounting.fixture.input);
      const after = await reader.resolve(f.execution.commercialRequest);
      expect(after.featureRequests.current).toBe(1);
      expect(after.organizationConcurrentReservations.current).toBe(1);
      expect(after.availableCreditUnits).toBe(
        authorization.availableCreditUnits -
          f.accounting.fixture.input.requestedCreditUnits,
      );
    }, 60000);

    it.each([
      "revoked",
      "configuration",
      "runtime-released",
      "cancelled",
    ] as const)(
      "denies V4 canonical reads after %s",
      async (kind) => {
        const f = await seedCanonicalFixtureV4();
        const controller = new AbortController();
        const reader = await f.adapter.createSeedCommercialReadPortsV4(
          { ...f.request, selectors: f.selectors },
          controller.signal,
        );
        if (kind === "revoked")
          await f.adapter.revoke({
            definitionId: f.plan.definition.definitionId,
            planDigest: f.plan.planDigest,
          });
        if (kind === "configuration") f.modelState.available = false;
        if (kind === "runtime-released")
          await f.runtimeStore.release({
            tenantScopeDigest: f.accounting.identity.tenantScopeDigest,
            executionLease: f.admitted.executionLease,
          });
        if (kind === "cancelled") controller.abort();
        await expect(
          reader.resolve(f.execution.commercialRequest),
        ).rejects.toThrow();
        await expect(reader.listProviderPricingVersions()).rejects.toThrow();
        await expect(
          reader.listCreditNormalizationPolicies(),
        ).rejects.toThrow();
        expect(await f.rows()).toEqual({
          reservations: 0,
          decisions: 0,
          ledger: 0,
          outcomes: 0,
        });
      },
      timeout60Seconds,
    );

    it(
      "rejects V4 canonical read scope, call and pinned-selector substitutions",
      async () => {
        const f = await seedCanonicalFixtureV4();
        const request = { ...f.request, selectors: f.selectors };
        const reader = await f.adapter.createSeedCommercialReadPortsV4(request);
        await expect(
          reader.resolve({
            ...f.execution.commercialRequest,
            organizationId: "org_foreign",
          }),
        ).rejects.toThrow();
        await expect(
          reader.resolve({
            ...f.execution.commercialRequest,
            requestedMaximumOutputUnits: 3000,
          }),
        ).rejects.toThrow();
        await expect(
          f
            .make({ scope: { ...f.scope, organizationId: "org_foreign" } })
            .createSeedCommercialReadPortsV4(request),
        ).rejects.toThrow();
        await expect(
          f.adapter.createSeedCommercialReadPortsV4({
            ...request,
            selectors: {
              ...f.selectors,
              routeDefinitionDigest: sha256Text("foreign route"),
            },
          }),
        ).rejects.toThrow();
        for (const key of [
          "pricingVersionDigest",
          "normalizationPolicyDigest",
        ] as const) {
          const changed = await f.adapter.createSeedCommercialReadPortsV4({
            ...request,
            selectors: {
              ...f.selectors,
              [key]: sha256Text("foreign pinned row"),
            },
          });
          await expect(
            changed.resolve(f.execution.commercialRequest),
          ).rejects.toThrow();
        }
        expect(await f.rows()).toEqual({
          reservations: 0,
          decisions: 0,
          ledger: 0,
          outcomes: 0,
        });
      },
      timeout60Seconds,
    );

    it("reserves V4 two-slot credits once under racing requests and recovers the exact decision", async () => {
      const f = await seedCanonicalFixtureV4();
      const results = await Promise.all([
        f.reservations.reserve(f.accounting.fixture.input),
        f.reservations.reserve(f.accounting.fixture.input),
      ]);
      expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
      expect(results.every((r) => r.accepted)).toBe(true);
      expect(await f.rows()).toEqual({
        reservations: 1,
        decisions: 1,
        ledger: 1,
        outcomes: 0,
      });
      const metadata = await harness.database.query(
        sql(
          "SELECT d.mapping_version,r.reserved_credit_units FROM model_commercial_reservation_decisions d JOIN credit_reservations r ON r.organization_id=d.organization_id AND r.reservation_id=d.canonical_reservation_id WHERE d.organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      expect(metadata.rows[0]?.["mapping_version"]).toBe(
        "seed-sequence-runtime-windows-v4",
      );
      expect(Number(metadata.rows[0]?.["reserved_credit_units"])).toBe(
        f.accounting.fixture.input.requestedCreditUnits,
      );
      expect(
        f.accounting.runtime.liveAuthorityReservation.planned.invocations,
      ).toBe(2);
      const sqlBinding = async (workflow: unknown) =>
        (
          await harness.database.query(
            sql(
              "SELECT cloudmarkup_seed_sequence_accounting_v4_binding_valid($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb) AS valid",
              [
                JSON.stringify(workflow),
                JSON.stringify(f.accounting.runtime),
                JSON.stringify(f.accounting.binding),
                JSON.stringify(f.plan),
                JSON.stringify(f.accounting.stageInput),
              ],
            ),
          )
        ).rows[0]?.["valid"];
      expect(await sqlBinding(f.accounting.workflow)).toBe(true);
      for (const kind of [
        "missing-call",
        "second-kind",
        "second-minimum",
      ] as const) {
        const altered = structuredClone(f.accounting.workflow);
        const calls = altered.request.plannedCalls;
        const second = calls[1];
        if (!second) throw Error("Missing synthetic second call");
        if (kind === "missing-call")
          Object.assign(altered.request, { plannedCalls: [calls[0]] });
        if (kind === "second-kind") Object.assign(second, { kind: "primary" });
        if (kind === "second-minimum")
          Object.assign(second.minimumUsage, { inputUnits: 1, totalUnits: 1 });
        expect(await sqlBinding(altered)).toBe(false);
      }
      await f.adapter.revoke({
        definitionId: f.plan.definition.definitionId,
        planDigest: f.plan.planDigest,
      });
      f.modelState.available = false;
      const recovery = await f.adapter.openSeedCommercialReservationRecoveryV4({
        reference: f.input.reference,
        accountingBinding: f.accounting.binding,
      });
      expect(recovery).not.toHaveProperty("reserve");
      expect(
        await recovery.recoverExistingReservation(f.accounting.fixture.input),
      ).toMatchObject({
        kind: "found",
        accountingStatus: "active",
        result: { accepted: true, replayed: true },
      });
      expect(await f.rows()).toEqual({
        reservations: 1,
        decisions: 1,
        ledger: 1,
        outcomes: 0,
      });
    }, 60000);
    it.each(["revoked", "configuration", "runtime-released"] as const)(
      "denies V4 canonical reservation after %s without a ledger write",
      async (kind) => {
        const f = await seedCanonicalFixtureV4();
        if (kind === "revoked")
          await f.adapter.revoke({
            definitionId: f.plan.definition.definitionId,
            planDigest: f.plan.planDigest,
          });
        if (kind === "configuration") f.modelState.available = false;
        if (kind === "runtime-released")
          await f.runtimeStore.release({
            tenantScopeDigest: f.accounting.identity.tenantScopeDigest,
            executionLease: f.admitted.executionLease,
          });
        await expect(
          f.reservations.reserve(f.accounting.fixture.input),
        ).rejects.toThrow();
        expect(await f.rows()).toEqual({
          reservations: 0,
          decisions: 0,
          ledger: 0,
          outcomes: 0,
        });
      },
      60000,
    );
    it("rejects V4 foreign canonical scope and substituted binding before reservation", async () => {
      const f = await seedCanonicalFixtureV4();
      await expect(
        f.adapter.createSeedCommercialReservationsV4({
          ...f.request,
          accountingBinding: {
            ...f.accounting.binding,
            workflowFingerprint: digest("other workflow"),
          },
        }),
      ).rejects.toThrow();
      await expect(
        f
          .make({ scope: { ...f.scope, organizationId: "org_foreign" } })
          .openSeedCommercialReservationRecoveryV4({
            reference: f.input.reference,
            accountingBinding: f.accounting.binding,
          }),
      ).rejects.toThrow();
      expect(await f.rows()).toEqual({
        reservations: 0,
        decisions: 0,
        ledger: 0,
        outcomes: 0,
      });
    }, 60000);

    it(
      "reserves one canonical first-seed credit entry and replays the exact decision",
      async () => {
        const f = await seedCanonicalFixture();
        const result = await f.reservations.reserve(f.accounting.fixture.input);
        expect(result).toMatchObject({ accepted: true, replayed: false });
        expect(await f.rows()).toEqual({
          reservations: 1,
          decisions: 1,
          ledger: 1,
          outcomes: 0,
        });
        expect(
          await f.reservations.reserve(f.accounting.fixture.input),
        ).toMatchObject({ accepted: true, replayed: true });
        expect(await f.rows()).toEqual({
          reservations: 1,
          decisions: 1,
          ledger: 1,
          outcomes: 0,
        });
      },
      timeout30Seconds,
    );
    it(
      "serializes racing first-seed canonical reservations",
      async () => {
        const f = await seedCanonicalFixture();
        const results = await Promise.all([
          f.reservations.reserve(f.accounting.fixture.input),
          f.reservations.reserve(f.accounting.fixture.input),
        ]);
        expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
        expect(results.every((r) => r.accepted)).toBe(true);
        expect(await f.rows()).toEqual({
          reservations: 1,
          decisions: 1,
          ledger: 1,
          outcomes: 0,
        });
      },
      timeout30Seconds,
    );
    it.each(["revoked", "configuration", "runtime-released"] as const)(
      "denies fresh canonical reservation after %s without a ledger write",
      async (kind) => {
        const f = await seedCanonicalFixture();
        if (kind === "revoked")
          await f.adapter.revoke({
            definitionId: f.plan.definition.definitionId,
            planDigest: f.plan.planDigest,
          });
        if (kind === "configuration") f.modelState.available = false;
        if (kind === "runtime-released")
          await f.runtimeStore.release({
            tenantScopeDigest: f.accounting.identity.tenantScopeDigest,
            executionLease: f.admitted.executionLease,
          });
        await expect(
          f.reservations.reserve(f.accounting.fixture.input),
        ).rejects.toThrow();
        expect(await f.rows()).toEqual({
          reservations: 0,
          decisions: 0,
          ledger: 0,
          outcomes: 0,
        });
      },
      timeout30Seconds,
    );
    it(
      "recovers canonical reservation metadata after revocation and model configuration loss",
      async () => {
        const f = await seedCanonicalFixture();
        await f.reservations.reserve(f.accounting.fixture.input);
        await f.adapter.revoke({
          definitionId: f.plan.definition.definitionId,
          planDigest: f.plan.planDigest,
        });
        f.modelState.available = false;
        const recovery = await f.adapter.openSeedCommercialReservationRecovery({
          reference: f.input.reference,
          accountingBinding: f.accounting.binding,
        });
        expect(recovery).not.toHaveProperty("reserve");
        expect(
          await recovery.recoverExistingReservation(f.accounting.fixture.input),
        ).toMatchObject({
          kind: "found",
          accountingStatus: "active",
          result: { accepted: true, replayed: true },
        });
        expect(await f.rows()).toEqual({
          reservations: 1,
          decisions: 1,
          ledger: 1,
          outcomes: 0,
        });
      },
      timeout30Seconds,
    );
    it(
      "rejects altered seed accounting bindings and another tenant before reservation",
      async () => {
        const f = await seedCanonicalFixture();
        await expect(
          f.adapter.createSeedCommercialReservations({
            ...f.request,
            accountingBinding: {
              ...f.accounting.binding,
              workflowFingerprint: digest("another workflow"),
            },
          }),
        ).rejects.toThrow();
        await expect(
          f
            .make({
              scope: { ...f.scope, organizationId: "foreign_synthetic_org" },
            })
            .openSeedCommercialReservationRecovery({
              reference: f.input.reference,
              accountingBinding: f.accounting.binding,
            }),
        ).rejects.toThrow();
        expect(await f.rows()).toEqual({
          reservations: 0,
          decisions: 0,
          ledger: 0,
          outcomes: 0,
        });
      },
      timeout30Seconds,
    );

    it(
      "rolls back first-seed canonical credits when current model authority changes before commit",
      async () => {
        const f = await seedCanonicalFixture();
        const observed: SqlDatabase = {
          query: harness.database.query.bind(harness.database),
          close: () => Promise.resolve(),
          transaction: (work) =>
            harness.database.transaction((tx) =>
              work({
                query: async <R extends SqlRow>(statement: SqlStatement) => {
                  const result = await tx.query<R>(statement);
                  if (
                    statement.text.includes(
                      "INSERT INTO model_commercial_reservation_decisions",
                    )
                  )
                    f.modelState.available = false;
                  return result;
                },
              }),
            ),
        };
        const reservations = await f
          .make({ database: observed })
          .createSeedCommercialReservations(f.request);
        await expect(
          reservations.reserve(f.accounting.fixture.input),
        ).rejects.toThrow();
        expect(f.modelState.available).toBe(false);
        expect(await f.rows()).toEqual({
          reservations: 0,
          decisions: 0,
          ledger: 0,
          outcomes: 0,
        });
      },
      timeout30Seconds,
    );
    it("keeps first-seed canonical SQL bindings distinct from historical primary calls", async () => {
      const f = await seedCanonicalFixture();
      const row = (
        await harness.database.query(
          sql(
            "SELECT snapshot FROM model_runtime_admissions WHERE organization_id=$1 AND scope_sha256=$2",
            [
              f.scope.organizationId,
              f.accounting.identity.tenantScopeDigest.slice(7),
            ],
          ),
        )
      ).rows[0];
      if (row === undefined) throw Error("Missing persisted V3 runtime");
      const runtime = parseSeedRuntimeRecord(row["snapshot"], f.scope);
      const values = [
        f.accounting.workflow,
        runtime,
        f.accounting.binding,
        f.plan,
        f.accounting.stageInput,
      ];
      const valid = await harness.database.query(
        sql(
          "SELECT cloudmarkup_seed_accounting_binding_valid($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb) AS seed, cloudmarkup_live_accounting_binding_valid($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) AS historical",
          values.map((value) => JSON.stringify(value)),
        ),
      );
      expect(valid.rows[0]).toEqual({ seed: true, historical: false });
      for (const key of [
        "stageId",
        "invocationId",
        "inputBindingDigest",
      ] as const) {
        const input = {
          ...f.accounting.stageInput,
          [key]: "foreign_synthetic_binding",
        };
        const changed = [...values.slice(0, 4), input];
        const result = await harness.database.query(
          sql(
            "SELECT cloudmarkup_seed_accounting_binding_valid($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb) AS seed",
            changed.map((value) => JSON.stringify(value)),
          ),
        );
        expect(result.rows[0]?.["seed"]).toBe(false);
      }
      expect(await f.rows()).toEqual({
        reservations: 0,
        decisions: 0,
        ledger: 0,
        outcomes: 0,
      });
    }, 30000);

    it("reads actual canonical credits and pricing with complete resources and no writes", async () => {
      const f = await preflightFixture();
      const before = await f.rows();
      const snapshot = await f.adapter.readSeedRepairCommercialPreflight(
        f.request,
      );
      expect(snapshot).toMatchObject({
        contractVersion: 3,
        recordKind: "model-live-sequence-commercial-preflight",
        executionClass: "live-evaluation",
        planDigest: f.plan.planDigest,
        selectionId: f.selection.selectionId,
        selectionDigest: f.selection.selectionDigest,
        preparedPayloadDigest: digest(f.input.invocation),
        featureEnabled: true,
        entitlement: { planKey: "pro" },
        balance: { availableCreditUnits: "100" },
        requested: { repairAttempts: 2, fileCount: 1, repositoryFiles: 1 },
      });
      expect(snapshot.price).toEqual(f.price);
      expect(snapshot.normalization).toEqual(f.normalization);
      expect(snapshot.requested.promptBytes).toBeGreaterThan(
        snapshot.requested.repositoryBytes,
      );
      expect(snapshot.requested.outputBytes).toBe(
        f.input.invocation.maximumOutputBytes,
      );
      expect(snapshot.requested.outputTokens).toBe(
        f.input.invocation.maximumOutputTokens,
      );
      expect(Date.parse(snapshot.expiresAt)).toBeLessThanOrEqual(
        Date.parse(f.plan.expiresAt),
      );
      expect(snapshot).not.toHaveProperty("invocation");
      expect(snapshot).not.toHaveProperty("inputBindingDigest");
      expect(await f.rows()).toEqual(before);
      const issued = await f.adapter.issueSeedRepairInput(f.input);
      expect(issued.kind).toBe("issued");
    }, 30000);
    it.each([
      "price-digest",
      "normalization-digest",
      "policy",
      "route",
      "source",
      "tenant",
      "revoked",
      "operator",
      "model",
      "cancelled",
      "subscription",
      "stale-entitlement",
    ] as const)(
      "denies changed %s during canonical preflight without writes",
      async (kind) => {
        const f = await preflightFixture();
        const request = structuredClone(f.request);
        const signal = new AbortController();
        if (kind === "price-digest")
          request.selectors.pricingVersionDigest = sha256Text("wrong price");
        if (kind === "normalization-digest")
          request.selectors.normalizationPolicyDigest = sha256Text(
            "wrong normalization",
          );
        if (kind === "policy")
          request.selectors.runtimePolicyDigest = sha256Text("wrong policy");
        if (kind === "route")
          request.selectors.routeDefinitionDigest = sha256Text("wrong route");
        if (kind === "source") {
          const file = request.invocation.request.failedCandidates[0];
          if (!file) throw Error("Missing source");
          file.content += "\n// changed";
          file.contentDigest = sha256Text(file.content);
          request.invocation.request.failedOutputDigest = digest(
            request.invocation.request.failedCandidates,
          );
          Object.assign(request.invocation.descriptor, {
            inputDigest: digest({
              request: request.invocation.request,
              scope: request.invocation.descriptor.scope,
            }),
          });
        }
        if (kind === "tenant")
          Object.assign(request.invocation.descriptor.scope, {
            organizationId: "org_other_synthetic",
          });
        if (kind === "revoked")
          await f.adapter.revoke({
            definitionId: f.plan.definition.definitionId,
            planDigest: f.plan.planDigest,
          });
        if (kind === "operator") f.state.operators = [];
        if (kind === "model") f.modelState.available = false;
        if (kind === "cancelled") signal.abort();
        if (kind === "subscription")
          await harness.database.query(
            sql(
              "UPDATE organization_subscription_projections SET normalized_status='canceled' WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          );
        if (kind === "stale-entitlement")
          await harness.database.query(
            sql(
              "UPDATE organization_subscription_projections SET record_version=record_version+1 WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          );
        const before = await f.rows();
        await expect(
          f.adapter.readSeedRepairCommercialPreflight(request, signal.signal),
        ).rejects.toMatchObject(denied);
        expect(await f.rows()).toEqual(before);
      },
      30000,
    );
    it("reports a disabled canonical account without claiming permission", async () => {
      const f = await preflightFixture();
      await harness.database.query(
        sql(
          "UPDATE organization_billing_accounts SET expensive_operations_enabled=FALSE WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      const before = await f.rows();
      const snapshot = await f.adapter.readSeedRepairCommercialPreflight(
        f.request,
      );
      expect(snapshot.featureEnabled).toBe(false);
      expect(await f.rows()).toEqual(before);
    }, 30000);
    it.each(["model", "operator", "cancelled"] as const)(
      "rechecks %s after the actual price read",
      async (kind) => {
        const f = await preflightFixture();
        const signal = new AbortController();
        const database: SqlDatabase = {
          close: () => Promise.resolve(),
          query: f.database.query.bind(f.database),
          transaction: (work) =>
            f.database.transaction((tx) =>
              work({
                query: async <R extends SqlRow>(statement: SqlStatement) => {
                  const result = await tx.query<R>(statement);
                  if (
                    statement.text.includes(
                      "FROM model_provider_pricing_versions",
                    )
                  ) {
                    if (kind === "model") f.modelState.available = false;
                    if (kind === "operator") f.state.operators = [];
                    if (kind === "cancelled") signal.abort();
                  }
                  return result;
                },
              }),
            ),
        };
        const adapter = new PostgresModelLiveSequences({
          database,
          scope: f.scope,
          principal: f.principal,
          configuration: f.configuration,
        });
        const before = await f.rows();
        await expect(
          adapter.readSeedRepairCommercialPreflight(f.request, signal.signal),
        ).rejects.toMatchObject(denied);
        expect(await f.rows()).toEqual(before);
      },
      30000,
    );

    async function countedFixture() {
      const f = await preflightFixture();
      const control = {
        tokens: 20,
        unavailable: false,
        afterHttp: undefined as (() => void) | undefined,
      };
      const http = vi.fn((request: BedrockCountHttpRequestV1) => {
        expect(request.method).toBe("POST");
        expect(request.hostname).toBe(
          "bedrock-runtime.us-east-1.amazonaws.com",
        );
        expect(request.path).toBe(
          "/model/" +
            encodeURIComponent(f.input.invocation.descriptor.modelId) +
            "/count-tokens",
        );
        const body =
          typeof request.body === "string"
            ? request.body
            : request.body instanceof Uint8Array
              ? new TextDecoder().decode(request.body)
              : "";
        expect(body).toContain("repairSeedTypeWitness");
        expect(body).not.toContain("routingDecisionDigest");
        expect(body).not.toContain("acceptedMaximumCreditUnits");
        expect(body).toContain(
          JSON.stringify(f.input.invocation.prompt.content).slice(1, -1),
        );
        control.afterHttp?.();
        return Promise.resolve({
          response: {
            statusCode: 200,
            headers: {
              "content-type": "application/json",
              "x-amzn-requestid": "synthetic_seed_count",
            },
            body: Buffer.from(
              JSON.stringify(
                control.unavailable ? {} : { inputTokens: control.tokens },
              ),
            ),
          },
        });
      });
      const input = {
        ...f.request,
        sequences: f.adapter,
        configuration: f.modelState.configuration,
        httpHandler: { handle: http },
      };
      return { ...f, control, http, input };
    }

    function productionRequestIds(
      f: Awaited<ReturnType<typeof countedFixture>>,
    ) {
      const suffix = f.input.invocation.descriptor.invocationId;
      return {
        eventIdPrefix: "seed_event_" + suffix,
        idempotencyKey: "synthetic_seed_stage_idempotency",
        multiCallWorkflowId: "seed_workflow_" + suffix,
        requestId: "seed_request_" + suffix,
        reservationId: "seed_reservation_" + suffix,
        admissionDecisionId: "seed_decision_" + suffix,
        concurrencyLeaseId: "seed_lease_" + suffix,
      };
    }

    function productionSeedRequest(
      f: Awaited<ReturnType<typeof countedFixture>>,
      ids = productionRequestIds(f),
    ) {
      return {
        sequences: f.adapter,
        reference: f.input.reference,
        caseId: f.input.caseId,
        selectors: f.input.selectors,
        httpHandler: f.input.httpHandler,
        requestedMode: "guided" as const,
        jobId: f.input.invocation.descriptor.scope.jobId,
        maximumOutputBytes: 100000,
        maximumOutputTokens: 1000,
        timeoutMilliseconds: 10000,
        ids,
      };
    }
    it.skipIf(isRepositoryCoverage)(
      "assembles a production seed request from the authenticated source and canonical observations",
      async () => {
        const f = await countedFixture();
        const input = productionSeedRequest(f);
        const before = await f.rows();
        const result = await prepareProductionSeedRepairRequestV3(input);
        expect(result.kind).toBe("prepared");
        if (result.kind !== "prepared")
          throw Error("Expected fresh prepared request");
        expect(result.execution.admissionDecision.outcome).toBe("allowed");
        expect(result.execution.routingDecision).toMatchObject({
          contractVersion: 3,
          routeId: "internal-escalation",
          maximumAttempts: 1,
          customerCharge: { acceptedMaximumCreditUnits: 2 },
          seedInputBindingDigest:
            result.execution.stageInput.inputBindingDigest,
        });
        expect(result.execution.routingRequest).not.toHaveProperty(
          "priorAttempt",
        );
        expect(result.invocation.descriptor.routing).not.toHaveProperty(
          "routingDecisionDigest",
        );
        expect(result.invocation.request).toEqual(f.input.invocation.request);
        expect(result.invocation.descriptor.scope).toEqual(
          f.input.invocation.descriptor.scope,
        );
        expect(result.invocation.descriptor.budgetDecisionId).toBe(
          input.ids.reservationId,
        );
        expect(result.invocation.descriptor.entitlementDecisionId).toBe(
          result.counted.snapshot.entitlement.entitlementSnapshotId,
        );
        expect(result.counted.count.invocationDigest).toBe(
          digest(result.invocation),
        );
        expect(result.execution.stageInput.preparedPayloadDigest).toBe(
          digest(result.invocation),
        );
        expect(result.execution.commercialRequest.plannedCalls).toEqual([
          result.counted.plannedCall,
        ]);
        expect(
          result.execution.admissionRequest.commercialEstimate,
        ).toMatchObject({ maximumCreditUnits: 2, estimatedMicroUsd: 15060 });
        expect(f.http).toHaveBeenCalledTimes(1);
        expect(before).toMatchObject([
          { inputs: 0, admissions: 0, reservations: 0 },
        ]);
        expect(await f.rows()).toEqual([{ ...before[0], inputs: 1 }]);
      },
      60000,
    );
    it.skipIf(isRepositoryCoverage)(
      "assembles a two-slot production seed request from one real counted input without reserving",
      async () => {
        const f = await countedFixture();
        const input = productionSeedRequest(f);
        const before = await f.rows();
        const result = await prepareProductionSeedSequenceRequestV4(input);
        expect(result.kind).toBe("prepared");
        if (result.kind !== "prepared")
          throw Error("Expected current two-slot budget");
        expect(result.execution.commercialRequest.plannedCalls).toEqual(
          result.budget.plannedCalls,
        );
        expect(
          result.execution.commercialRequest.plannedCalls.map(
            (call) => call.kind,
          ),
        ).toEqual(["repair", "repair"]);
        expect(result.execution.commercialRequest.reservationId).toBe(
          input.ids.reservationId,
        );
        expect(result.execution.commercialRequest.multiCallWorkflowId).toBe(
          input.ids.multiCallWorkflowId,
        );
        expect(
          result.execution.commercialRequest.requestedMaximumInputUnits,
        ).toBe(result.budget.maximumUsage.inputUnits);
        expect(
          result.execution.commercialRequest.requestedMaximumOutputUnits,
        ).toBe(2000);
        expect(result.execution.commercialRequest.expiresAt).toBe(
          result.budget.expiresAt,
        );
        expect(Date.parse(result.budget.expiresAt)).toBeGreaterThan(
          Date.parse(result.counted.count.expiresAt),
        );
        expect(result.budget.slots[0]?.invocationId).toBe(
          result.invocation.descriptor.invocationId,
        );
        expect(result.budget.slots[1]?.invocationId).not.toBe(
          result.invocation.descriptor.invocationId,
        );
        expect(result.execution.stageInput.preparedPayloadDigest).toBe(
          digest(result.invocation),
        );
        expect(result.counted.count.invocationDigest).toBe(
          digest(result.invocation),
        );
        expect(result.execution.admissionRequest.contractVersion).toBe(4);
        expect(result.execution.admissionDecision.outcome).toBe("allowed");
        expect(
          result.execution.admissionRequest.canonicalPlannedCallsDigest,
        ).toBe(digest(result.budget.plannedCalls));
        expect(
          result.execution.routingDecision.customerCharge
            .acceptedMaximumCreditUnits,
        ).toBe(result.budget.maximumCreditUnits);
        expect(result.execution.admissionRequest.requested.outputTokens).toBe(
          1000,
        );
        expect(typeof result.store.claim).toBe("function");
        expect(f.http).toHaveBeenCalledTimes(1);
        expect(await f.rows()).toEqual([{ ...before[0], inputs: 1 }]);
      },
      60000,
    );
    it
      .skipIf(isRepositoryCoverage)
      .each([
        prepareProductionSeedRepairRequestV3,
        prepareProductionSeedSequenceRequestV4,
      ])(
      "returns only existing metadata for a production seed request retry %#",
      async (prepareRequest) => {
        const f = await countedFixture();
        const input = productionSeedRequest(f);
        const result = await prepareRequest(input);
        if (result.kind !== "prepared")
          throw Error("Expected fresh prepared request");
        const before = await f.rows();
        const replay = await prepareRequest(input);
        expect(replay).toEqual({
          kind: "existing",
          record: result.execution.stageInput,
        });
        expect(replay).not.toHaveProperty("invocation");
        expect(replay).not.toHaveProperty("store");
        expect(await f.rows()).toEqual(before);
      },
      60000,
    );
    it.each([
      "operator",
      "configuration",
      "foreign-tenant",
      "selector",
      "output-bound",
      "cancelled",
      "disabled-account",
      "changed-after-price",
    ] as const)(
      "denies production seed source %s without issuing or sending",
      async (kind) => {
        const f = await countedFixture();
        const ids = productionRequestIds(f);
        const request = {
          reference: f.input.reference,
          caseId: f.input.caseId,
          requestedMode: "guided" as const,
          selectors: structuredClone(f.input.selectors),
          controls: {
            jobId: f.input.invocation.descriptor.scope.jobId,
            idempotencyKey: ids.idempotencyKey,
            reservationId: ids.reservationId,
            maximumOutputBytes: 100000,
            maximumOutputTokens: 1000,
            timeoutMilliseconds: 10000,
          },
        };
        const signal = new AbortController();
        let adapter = f.adapter;
        if (kind === "operator") f.state.operators = [];
        if (kind === "configuration") f.modelState.available = false;
        if (kind === "foreign-tenant")
          adapter = f.make({
            scope: { ...f.scope, organizationId: "foreign_synthetic_org" },
          });
        if (kind === "selector")
          request.selectors.pricingVersionDigest =
            sha256Text("different price");
        if (kind === "output-bound")
          request.controls.maximumOutputTokens =
            f.plan.definition.limits.maximumOutputTokens + 1;
        if (kind === "cancelled") signal.abort();
        if (kind === "disabled-account")
          await harness.database.query(
            sql(
              "UPDATE organization_billing_accounts SET expensive_operations_enabled=FALSE WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          );
        if (kind === "changed-after-price") {
          const database: SqlDatabase = {
            close: () => Promise.resolve(),
            query: f.database.query.bind(f.database),
            transaction: (work) =>
              f.database.transaction((tx) =>
                work({
                  query: async <R extends SqlRow>(statement: SqlStatement) => {
                    const result = await tx.query<R>(statement);
                    if (
                      statement.text.includes(
                        "FROM model_provider_pricing_versions",
                      )
                    )
                      f.modelState.available = false;
                    return result;
                  },
                }),
              ),
          };
          adapter = new PostgresModelLiveSequences({
            database,
            scope: f.scope,
            principal: f.principal,
            configuration: f.configuration,
          });
        }
        const before = await f.rows();
        await expect(
          adapter.prepareSeedRepairInvocation(request, signal.signal),
        ).rejects.toMatchObject(denied);
        expect(f.http).not.toHaveBeenCalled();
        expect(await f.rows()).toEqual(before);
      },
      60000,
    );

    it.each(["idempotency", "cancelled", "withdrawn-before-issue"] as const)(
      "denies production seed request %s without issuing or reserving",
      async (kind) => {
        const f = await countedFixture();
        const ids = productionRequestIds(f);
        const signal = new AbortController();
        if (kind === "idempotency") ids.idempotencyKey = "";
        if (kind === "cancelled") signal.abort();
        if (kind === "withdrawn-before-issue") {
          const issue = f.adapter.issueSeedRepairInput.bind(f.adapter);
          vi.spyOn(f.adapter, "issueSeedRepairInput").mockImplementation(
            async (...args) => {
              f.state.operators = [];
              return issue(...args);
            },
          );
        }
        const before = await f.rows();
        await expect(
          prepareProductionSeedRepairRequestV3({
            ...productionSeedRequest(f, ids),
            signal: signal.signal,
          }),
        ).rejects.toThrow();
        expect(f.http).toHaveBeenCalledTimes(
          kind === "withdrawn-before-issue" ? 1 : 0,
        );
        expect(await f.rows()).toEqual(before);
      },
      60000,
    );

    it.skipIf(isRepositoryCoverage)(
      "counts the full fixed-host SDK input and canonical credit bounds without issuing or reserving",
      async () => {
        const f = await countedFixture();
        const before = await f.rows();
        expect(f.input.invocation.descriptor.contractVersion).toBe(3);
        const counted = await prepareProductionSeedRepairCountV3(f.input);
        expect(counted).toMatchObject({
          contractVersion: 3,
          authority: "unissued-counted-seed-input",
          requestedMaximumInputUnits: 20,
          requestedMaximumOutputUnits: 1000,
          minimumCreditUnits: 1,
          maximumCreditUnits: 2,
          maximumEstimatedProviderCostMicros: 15060,
          plannedCall: {
            kind: "repair",
            routeId: "internal-escalation",
            maximumUsage: {
              inputUnits: 20,
              outputUnits: 1000,
              totalUnits: 1020,
            },
          },
        });
        expect(counted.count.invocationDigest).toBe(digest(f.input.invocation));
        expect(f.http).toHaveBeenCalledTimes(1);
        expect(await f.rows()).toEqual(before);
        expect(counted).not.toHaveProperty("inputEvidence");
        expect(counted).not.toHaveProperty("record");
        expect(Date.parse(counted.expiresAt)).toBeLessThanOrEqual(
          Date.parse(counted.count.expiresAt),
        );
      },
      30000,
    );
    it.each([
      "legacy-descriptor",
      "final-decision",
      "static-configuration",
      "cache",
      "disabled-account",
      "revoked",
      "output-limit",
      "configuration",
    ] as const)(
      "denies %s before sending CountTokens",
      async (kind) => {
        const f = await countedFixture();
        if (kind === "legacy-descriptor")
          Object.assign(f.input.invocation.descriptor, { contractVersion: 1 });
        if (kind === "final-decision")
          Object.assign(f.input.invocation.descriptor.routing, {
            routingDecisionDigest: digest("substituted"),
          });
        if (kind === "static-configuration")
          Object.assign(f.input.invocation.descriptor.routing, {
            routingConfigurationDigest: digest("substituted"),
          });
        if (kind === "cache")
          Object.assign(f.input.invocation.promptCachePolicy, {
            enabled: true,
          });
        if (kind === "disabled-account")
          await harness.database.query(
            sql(
              "UPDATE organization_billing_accounts SET expensive_operations_enabled=FALSE WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          );
        if (kind === "revoked")
          await f.adapter.revoke({
            definitionId: f.plan.definition.definitionId,
            planDigest: f.plan.planDigest,
          });
        if (kind === "output-limit")
          Object.assign(f.input.invocation, {
            maximumOutputTokens:
              f.plan.definition.limits.maximumOutputTokens + 1,
          });
        if (kind === "configuration") f.modelState.available = false;
        const before = await f.rows();
        await expect(
          prepareProductionSeedRepairCountV3(f.input),
        ).rejects.toThrow();
        expect(f.http).not.toHaveBeenCalled();
        expect(await f.rows()).toEqual(before);
      },
      30000,
    );
    it.each([
      "model",
      "operator",
      "cancelled",
      "missing-count",
      "input-limit",
    ] as const)(
      "denies %s after a real SDK count response without issuing authority",
      async (kind) => {
        const f = await countedFixture();
        const abort = new AbortController();
        if (kind === "missing-count") f.control.unavailable = true;
        if (kind === "input-limit")
          f.control.tokens = f.plan.definition.limits.maximumInputTokens + 1;
        f.control.afterHttp = () => {
          if (kind === "model") f.modelState.available = false;
          if (kind === "operator") f.state.operators = [];
          if (kind === "cancelled") abort.abort();
        };
        const before = await f.rows();
        await expect(
          prepareProductionSeedRepairCountV3({
            ...f.input,
            signal: abort.signal,
          }),
        ).rejects.toThrow();
        expect(f.http).toHaveBeenCalledTimes(1);
        expect(await f.rows()).toEqual(before);
      },
      30000,
    );
    it("issues once from host reconstruction and replays metadata only after restart", async () => {
      const f = await fixture();
      const openCount = f.host.open.mock.calls.length;
      const first = await f.adapter.issueSeedRepairInput(f.input);
      expect(first.kind).toBe("issued");
      if (first.kind !== "issued") throw Error("Expected first issue");
      expect(first.invocation).toEqual(f.input.invocation);
      expect(first.record.preparedPayloadDigest).toBe(digest(first.invocation));
      expect(first.record.operationInputDigest).toBe(
        first.invocation.descriptor.inputDigest,
      );
      expect(f.host.open).toHaveBeenCalledTimes(openCount);
      const replay = await f.make().issueSeedRepairInput(f.input);
      expect(replay).toEqual({ kind: "existing", record: first.record });
      expect(replay).not.toHaveProperty("invocation");
      expect(await f.count()).toBe(1);
      const rows = await harness.database.query(
        sql(
          "SELECT input_record::text AS record FROM model_live_sequence_inputs WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
      expect(rows.rows[0]?.["record"]).not.toContain("repairSeedTypeWitness");
      expect(rows.rows[0]?.["record"]).not.toContain('"content"');
    }, 30000);
    it("allows exactly one RAM payload through concurrent issuance", async () => {
      const f = await fixture();
      const results = await Promise.all([
        f.adapter.issueSeedRepairInput(f.input),
        f.make().issueSeedRepairInput(f.input),
      ]);
      expect(results.filter((result) => result.kind === "issued")).toHaveLength(
        1,
      );
      expect(
        results.filter((result) => result.kind === "existing"),
      ).toHaveLength(1);
      expect(results[0].record).toEqual(results[1].record);
      expect(await f.count()).toBe(1);
    }, 30000);
    it.each([
      "source",
      "tenant",
      "selection",
      "child-stage",
      "missing-model",
      "revoked",
      "cancelled",
    ] as const)(
      "denies %s without inserting input metadata",
      async (kind) => {
        const f = await fixture();
        const input = structuredClone(f.input);
        const abort = new AbortController();
        if (kind === "source") {
          const file = input.invocation.request.failedCandidates[0];
          if (!file) throw Error("Missing synthetic file");
          file.content += "// coherently altered caller source\n";
          file.contentDigest = sha256Text(file.content);
          input.invocation.request.failedOutputDigest = digest(
            input.invocation.request.failedCandidates,
          );
          input.invocation.descriptor.inputDigest = digest({
            request: input.invocation.request,
            scope: input.invocation.descriptor.scope,
          });
        }
        if (kind === "tenant")
          input.invocation.descriptor.scope.userId = "principal_other";
        if (kind === "selection")
          Object.assign(input.reference, {
            selectionDigest: sha256Text("other"),
          });
        if (kind === "child-stage")
          Object.assign(input.invocation.descriptor, {
            invocationId: f.selection.stages[1]?.invocationId,
          });
        if (kind === "missing-model") f.modelState.available = false;
        if (kind === "revoked")
          await f.adapter.revoke({
            definitionId: input.reference.definitionId,
            planDigest: input.reference.planDigest,
          });
        if (kind === "cancelled") abort.abort();
        await expect(
          f.adapter.issueSeedRepairInput(input, abort.signal),
        ).rejects.toMatchObject(denied);
        expect(await f.count()).toBe(0);
      },
      30000,
    );
    it.each(["model", "seed", "operator", "cancelled"] as const)(
      "rolls back if %s authority is withdrawn after insertion",
      async (kind) => {
        const f = await fixture();
        const abort = new AbortController();
        f.state.afterInsert = () => {
          if (kind === "model") f.modelState.available = false;
          if (kind === "seed") f.state.available = false;
          if (kind === "operator") f.state.operators = [];
          if (kind === "cancelled") abort.abort();
          return Promise.resolve();
        };
        await expect(
          f.adapter.issueSeedRepairInput(f.input, abort.signal),
        ).rejects.toMatchObject(denied);
        expect(await f.count()).toBe(0);
      },
      30000,
    );
    it("rejects a coherently changed invocation on replay and keeps the original record", async () => {
      const f = await fixture();
      const first = await f.adapter.issueSeedRepairInput(f.input);
      const changed = structuredClone(f.input);
      Object.assign(changed.invocation, {
        maximumOutputTokens: changed.invocation.maximumOutputTokens - 1,
      });
      await expect(
        f.make().issueSeedRepairInput(changed),
      ).rejects.toMatchObject(denied);
      expect(await f.adapter.issueSeedRepairInput(f.input)).toEqual({
        kind: "existing",
        record: first.record,
      });
      expect(await f.count()).toBe(1);
    }, 30000);
    it("rejects direct SQL mutation or source-bearing metadata", async () => {
      const f = await fixture();
      await f.adapter.issueSeedRepairInput(f.input);
      await expect(
        harness.database.query(
          sql(
            "UPDATE model_live_sequence_inputs SET model_configuration_sha256=$1 WHERE organization_id=$2",
            ["1".repeat(64), f.scope.organizationId],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        harness.database.query(
          sql(
            "DELETE FROM model_live_sequence_inputs WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        harness.database.query(
          sql(
            "INSERT INTO model_live_sequence_inputs SELECT organization_id,project_id,principal_id,operator_principal_id,plan_sha256,selection_id,stage_id,invocation_id,input_sha256,model_configuration_sha256,seed_configuration_sha256,input_record || jsonb_build_object('content','forbidden-source'),issued_at FROM model_live_sequence_inputs WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
      expect(await f.count()).toBe(1);
    }, 30000);
  },
);
