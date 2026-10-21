import {
  digestStructuredValue,
  serializedByteLength,
  intentPreviewGenerationEvidenceV1,
  intentPreviewCommercialOutcomeV1,
  modelUsageToCommercialAttemptV1,
  type ModelGateway,
  type ModelRuntimeControlServiceV1,
  type ModelRuntimeSanitizedOutputEvidenceV1,
  type ModelCommercialInvocationContextV1,
  type ModelRuntimeControlledInvocationResultV1,
} from "@cloudmarkup/model-gateway";
import { modelTestContext } from "@cloudmarkup/model-gateway/testing";
import { modelRuntimeHostEvidenceV1Schema } from "@cloudmarkup/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aiPreviewFixture } from "../adapters/persistence/ai-intent-preview-test-helpers.js";
import {
  AiIntentPreviewApplication,
  aiIntentPreviewBindingV1,
  type AiIntentPreviewResolvedV1,
} from "./ai-intent-preview.js";
import {
  AiIntentPreviewError,
  type AiIntentPreviewDeliveryOutcomeV1,
  type AiIntentPreviewJournalV1,
} from "./ai-intent-preview-journal.js";

/** Synthetic callback orchestration only: this runtime double grants no real
 * admission, evaluation recommendation, spending authority or SQL persistence.
 * Real runtime leases/strict verifier and SQL recovery have separate suites. */
function fixture() {
  const f = aiPreviewFixture();
  const base = {
    ...modelTestContext(f.binding.invocationId),
    scope: f.scope,
    idempotencyKeyDigest: f.binding.idempotencyKeyDigest,
  };
  const routingRequest = { environment: "production" };
  const routingDecision = {
    routeId: "standard-design",
    feature: "intent.extract",
    requestedMode: "guided",
    outcome: "selected",
    modelId: f.route.modelId,
    modelVersion: f.route.modelVersion,
    providerId: f.route.providerKey,
    inferenceProfileId: f.route.inferenceProfileId,
    maximumAttempts: 1,
    maximumOutputTokens: 1024,
  };
  const context = { ...base, routingRequest, routingDecision };
  const runtimeInput = {
    commercialRequest: f.request,
    routingRequest,
    routingDecision,
    admissionRequest: {
      executionClass: "normal",
      operation: "intent.extract",
      organizationId: f.scope.organizationId,
      projectId: f.scope.projectId,
      userId: f.scope.userId,
      inputDigest: f.binding.inputDigest,
      catalogDigest: f.outputInput.catalogDigest,
      responseSchemaDigest: f.outputInput.responseSchemaDigest,
      runtimePolicyDigest: f.outputInput.runtimePolicyDigest,
      requested: { outputBytes: 100000, outputTokens: 1024, repairAttempts: 0 },
    },
    inputEvidence: { inputDigest: f.binding.inputDigest },
    policy: {
      limits: { maximumOutputBytes: 100000, maximumOutputTokens: 1024 },
    },
  };
  const resolved = {
    baseline: {
      draftEtag: '"synthetic-head-1"',
      editingLeaseId: "projectlease_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    },
    context,
    modelRequest: f.modelRequest,
    runtime: runtimeInput,
  } as unknown as AiIntentPreviewResolvedV1;
  const binding = aiIntentPreviewBindingV1(resolved);
  const callback = { route: f.route } as ModelCommercialInvocationContextV1;
  const outputDigest = digestStructuredValue(f.result.response);
  const outputBytes = serializedByteLength(f.result.response);
  const records = (
    ["allow-listed-operations", "source-ownership"] as const
  ).map((evidenceKind) => {
    const draft = {
      contractVersion: 1,
      evidenceId: "evidence_" + evidenceKind,
      evidenceKind,
      responseSchemaDigest: f.outputInput.responseSchemaDigest,
      runtimePolicyDigest: f.outputInput.runtimePolicyDigest,
      catalogDigest: f.outputInput.catalogDigest,
      inputDigest: f.binding.inputDigest,
      operation: "intent.extract",
      organizationId: f.scope.organizationId,
      projectId: f.scope.projectId,
      outputBytes,
      outputDigest,
      outputTokens: Number(f.result.usage.outputUnits),
      passed: true,
      recordKind: "model-runtime-host-evidence",
      verifierId: "test.preview",
      verifierVersion: "1.0.0",
    };
    return modelRuntimeHostEvidenceV1Schema.parse({
      ...draft,
      evidenceDigest: digestStructuredValue(draft),
    });
  });
  const [allowListedOperationsEvidence, sourceOwnershipEvidence] = records;
  if (
    allowListedOperationsEvidence === undefined ||
    sourceOwnershipEvidence === undefined
  )
    throw new Error("Missing synthetic output evidence.");
  const output: ModelRuntimeSanitizedOutputEvidenceV1 = {
    allowListedOperationsEvidence,
    sourceOwnershipEvidence,
    noRawSensitiveContent: true,
    outputBytes,
    outputDigest,
    outputTokens: Number(f.result.usage.outputUnits),
    resultSanitized: true,
    secretRedactionApplied: true,
    structuredOutputValidated: true,
  };
  const generated = intentPreviewGenerationEvidenceV1(
    {
      attempts: [modelUsageToCommercialAttemptV1(f.result.usage)],
      completedAt: f.result.usage.completedAt,
      failureCategory: null,
      resultId: "result_preview",
      status: "completed",
      usefulOutputDelivered: true,
    },
    f.request,
  );
  let outcome: AiIntentPreviewDeliveryOutcomeV1 = { kind: "pending" };
  const terminal = (
    acknowledged: boolean,
  ): AiIntentPreviewDeliveryOutcomeV1 => ({
    kind: "terminal",
    acknowledged,
    commercial: intentPreviewCommercialOutcomeV1({
      generation: generated,
      request: f.request,
      delivery: acknowledged ? "acknowledged" : "unconfirmed",
    }),
  });
  const proof = {
    contractVersion: 1 as const,
    invocationId: binding.invocationId,
    outputDigest,
    token: "A".repeat(43),
    expiresAt: "2026-09-06T12:00:30.000Z",
  };
  const prepare = vi
    .fn<AiIntentPreviewJournalV1["prepare"]>()
    .mockResolvedValue(undefined);
  const close = vi
    .fn<AiIntentPreviewJournalV1["closeDelivery"]>()
    .mockImplementation(() => {
      outcome = terminal(false);
      return Promise.resolve();
    });
  const acknowledge = vi
    .fn<AiIntentPreviewJournalV1["acknowledge"]>()
    .mockImplementation(() => {
      outcome = terminal(true);
      return Promise.resolve();
    });
  const prepareDelivery = vi
    .fn<AiIntentPreviewJournalV1["prepareDelivery"]>()
    .mockResolvedValue(proof);
  const journal: AiIntentPreviewJournalV1 = {
    binding,
    prepare,
    prepareDelivery,
    acknowledge,
    closeDelivery: close,
    deliveryOutcome: () => Promise.resolve(outcome),
    claim: () => Promise.resolve({ kind: "claimed" }),
    complete: () => Promise.resolve(),
    fail: () => Promise.resolve(),
    record: () => Promise.resolve(),
    listByInvocationId: () => Promise.resolve([f.result.usage]),
    recoverVerified: () => Promise.resolve({ kind: "unavailable" }),
  };
  const invoke = vi.fn<ModelGateway["invoke"]>().mockResolvedValue(f.result);
  const assertExecution = vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined);
  const authority = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const issue = vi
    .fn<() => Promise<ModelRuntimeSanitizedOutputEvidenceV1>>()
    .mockResolvedValue(output);
  const verify = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  let supplied: ModelRuntimeControlledInvocationResultV1 | undefined;
  let terminalRuntime:
    Awaited<ReturnType<ModelRuntimeControlServiceV1["execute"]>> | undefined;
  const execute = vi
    .fn<ModelRuntimeControlServiceV1["execute"]>()
    .mockImplementation(async (_input, callback) => {
      if (terminalRuntime !== undefined) return terminalRuntime;
      supplied = await callback({
        commercial: {
          ...f.request,
          ...{ route: f.route },
        } as unknown as ModelCommercialInvocationContextV1,
        inputEvidence: resolved.runtime.inputEvidence,
        assertCurrentExecution: assertExecution,
      });
      terminalRuntime = { outcome: "synthetic-only" } as unknown as Awaited<
        ReturnType<ModelRuntimeControlServiceV1["execute"]>
      >;
      return terminalRuntime;
    });
  const app = new AiIntentPreviewApplication({
    gateway: { invoke } as unknown as ModelGateway,
    runtime: { execute },
    journal,
    host: { assertCurrentAuthority: authority, issueOutputEvidence: issue },
    evidenceVerifier: {
      verify,
      verifyInputEvidence: verify,
      verifyOperationalOutcome: verify,
    },
    now: () => new Date(f.result.usage.completedAt),
  });
  return {
    app,
    resolved,
    binding,
    journal,
    prepare,
    close,
    acknowledge,
    prepareDelivery,
    invoke,
    assertExecution,
    authority,
    issue,
    verify,
    output,
    proof,
    execute,
    callback,
    supplied: () => supplied,
  };
}
afterEach(() => {
  vi.useRealTimers();
});
describe("memory-only Intent preview application", () => {
  it("emits a fully verified RAM candidate, acknowledges once, and replay does not emit or invoke", async () => {
    const f = fixture();
    const emit = vi
      .fn<Parameters<AiIntentPreviewApplication["execute"]>[0]["emit"]>()
      .mockImplementation(async (value) => {
        expect(value.signal.aborted).toBe(false);
        await value.assertCurrentEmission();
        expect(value.candidate.operation).toBe("intent.extract");
        await f.journal.acknowledge(value.delivery);
      });
    expect((await f.app.execute({ resolved: f.resolved, emit })).delivery).toBe(
      "memory-only",
    );
    expect(f.supplied()?.commercial.usefulOutputDelivered).toBe(true);
    expect((await f.app.execute({ resolved: f.resolved, emit })).delivery).toBe(
      "result-unavailable",
    );
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(f.prepare).toHaveBeenCalledTimes(1);
    expect(f.verify).toHaveBeenCalledTimes(2);
  });
  it("checks current authority before journal or runtime work and rejects a changed baseline", async () => {
    const f = fixture();
    const emit = vi.fn().mockResolvedValue(undefined);
    f.authority.mockRejectedValueOnce(new AiIntentPreviewError());
    await expect(
      f.app.execute({ resolved: f.resolved, emit }),
    ).rejects.toBeInstanceOf(AiIntentPreviewError);
    await expect(
      f.app.execute({
        resolved: {
          ...f.resolved,
          baseline: { ...f.resolved.baseline, draftEtag: '"changed"' },
        },
        emit,
      }),
    ).rejects.toBeInstanceOf(AiIntentPreviewError);
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.prepare).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
  it.each(["lease", "tenant", "cancel"] as const)(
    "rechecks %s authority after awaited journal preparation, before model dispatch",
    async (kind) => {
      const f = fixture();
      const abort = new AbortController();
      const emit = vi.fn().mockResolvedValue(undefined);
      f.prepare.mockImplementation(() => {
        if (kind === "lease")
          f.assertExecution.mockRejectedValue(new AiIntentPreviewError());
        if (kind === "tenant")
          f.authority.mockRejectedValue(new AiIntentPreviewError());
        if (kind === "cancel") abort.abort();
        return Promise.resolve();
      });
      await expect(
        f.app.execute({ resolved: f.resolved, emit, signal: abort.signal }),
      ).rejects.toBeInstanceOf(AiIntentPreviewError);
      expect(f.invoke).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    },
  );
  it.each(["oversized", "forged", "lease-expired"] as const)(
    "does not emit %s output after the model returns",
    async (kind) => {
      const f = fixture();
      const emit = vi.fn().mockResolvedValue(undefined);
      if (kind === "oversized")
        f.issue.mockResolvedValue({ ...f.output, outputBytes: 100001 });
      if (kind === "forged") f.verify.mockResolvedValue(false);
      if (kind === "lease-expired")
        f.issue.mockImplementation(() => {
          f.assertExecution.mockRejectedValue(new AiIntentPreviewError());
          return Promise.resolve(f.output);
        });
      await expect(
        f.app.execute({ resolved: f.resolved, emit }),
      ).rejects.toBeInstanceOf(AiIntentPreviewError);
      expect(f.invoke).toHaveBeenCalledTimes(1);
      expect(emit).not.toHaveBeenCalled();
      expect(f.prepareDelivery).not.toHaveBeenCalled();
    },
  );
  it("closes a failed emission without inventing delivery or discarding usage", async () => {
    const f = fixture();
    await expect(
      f.app.execute({
        resolved: f.resolved,
        emit: () =>
          Promise.reject(new Error("Synthetic disconnected transport")),
      }),
    ).rejects.toBeInstanceOf(AiIntentPreviewError);
    expect(f.close).toHaveBeenCalledTimes(1);
    const outcome = await f.journal.deliveryOutcome();
    expect(outcome.kind).toBe("terminal");
    if (outcome.kind !== "terminal") throw new Error("Missing outcome.");
    expect(outcome.acknowledged).toBe(false);
    expect(outcome.commercial.attempts[0]?.usage).not.toBeNull();
  });
  it("aborts a stuck emitter at the shared30-second deadline and never treats late completion as delivered", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const f = fixture();
    let emittedSignal: AbortSignal | undefined;
    let lateAssertion: (() => Promise<void>) | undefined;
    let release: () => void = () => {
      throw new Error("Synthetic deferred completion not initialized.");
    };
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execution = f.app.execute({
      resolved: f.resolved,
      emit: (value) => {
        emittedSignal = value.signal;
        lateAssertion = value.assertCurrentEmission;
        return pending;
      },
    });
    const rejected =
      expect(execution).rejects.toBeInstanceOf(AiIntentPreviewError);
    await vi.advanceTimersByTimeAsync(30001);
    await rejected;
    expect(emittedSignal?.aborted).toBe(true);
    expect(f.close).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    expect(f.supplied()).toBeUndefined();
    expect(f.acknowledge).not.toHaveBeenCalled();
    expect(lateAssertion).toBeDefined();
    await expect(lateAssertion?.()).rejects.toBeInstanceOf(
      AiIntentPreviewError,
    );
  });
  it("invalidates a pending emitter when its final host-owned execution assertion finds a released lease", async () => {
    const f = fixture();
    let emittedSignal: AbortSignal | undefined;
    await expect(
      f.app.execute({
        resolved: f.resolved,
        emit: async (value) => {
          emittedSignal = value.signal;
          f.assertExecution.mockRejectedValue(new AiIntentPreviewError());
          await value.assertCurrentEmission();
          await f.journal.acknowledge(value.delivery);
        },
      }),
    ).rejects.toBeInstanceOf(AiIntentPreviewError);
    expect(emittedSignal?.aborted).toBe(true);
    expect(f.acknowledge).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledTimes(1);
  });
});
