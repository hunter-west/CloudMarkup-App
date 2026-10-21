/* eslint-disable @typescript-eslint/require-await -- callback fakes intentionally satisfy the asynchronous invocation seam without I/O. */

import { describe, expect, it } from "vitest";

import type {
  ModelProviderPricingVersionV1,
  ModelUsageUnitsV1,
} from "@cloudmarkup/domain";

import {
  MODEL_COMMERCIAL_LIFECYCLE_VERSION,
  ModelCommercialLifecycleCoordinator,
  projectModelCommercialPendingReviewV2,
  digestModelCommercialVerifiedScopeV1,
  type ModelCommercialAuthorizationDecisionV1,
  type ModelCommercialInvocationResultV1,
  type ModelCommercialOperationRequestV1,
  type ModelCommercialScopeResolverV1,
  type ModelCommercialWorkflowStore,
  type ModelCommercialInvocationRecoveryPortV1,
} from "./commercial-lifecycle.js";
import { digestStructuredValue } from "./security.js";
import {
  intentPreviewCommercialOutcomeV1,
  intentPreviewGenerationEvidenceV1,
} from "./intent-preview-delivery.js";
import {
  InMemoryCanonicalModelCommercialAccounting,
  InMemoryModelCommercialAuthorization,
  InMemoryModelCommercialHostAttestations,
  InMemoryModelCommercialPricing,
  InMemoryModelCommercialScopeResolver,
  InMemoryModelCommercialWorkflowStore,
} from "./commercial-lifecycle-fakes.js";

import {
  requestedAt,
  completedAt,
  standardRoute,
  deepRoute,
  usage,
  pricingFor,
  normalizationPolicy,
  authorization,
  request,
  primaryPlannedCall,
  attempt,
  invocation,
} from "./commercial-lifecycle-test-helpers.js";

type CapturedReservationInput = Parameters<
  InMemoryCanonicalModelCommercialAccounting["reserve"]
>[0];

class CapturingCanonicalModelCommercialAccounting extends InMemoryCanonicalModelCommercialAccounting {
  public readonly reservationInputs: CapturedReservationInput[] = [];

  public override reserve(
    input: CapturedReservationInput,
  ): ReturnType<InMemoryCanonicalModelCommercialAccounting["reserve"]> {
    this.reservationInputs.push(structuredClone(input));
    return super.reserve(input);
  }
}
class FaultInjectingWorkflowStore implements ModelCommercialWorkflowStore {
  readonly #delegate: InMemoryModelCommercialWorkflowStore;
  #failDispatchIntentSave = false;
  #failReceiptSave = false;
  #failReservationIntentSave = false;
  #failReservationReceiptSave = false;
  #failReservedStateSave = false;

  #strandNextRelease = false;
  #tamperReservationIntentOnClaim = false;
  #tamperOnClaim: "cost" | "normalization" | "pricing" | null = null;

  public constructor(delegate = new InMemoryModelCommercialWorkflowStore()) {
    this.#delegate = delegate;
  }

  public failNextDispatchIntentSave(): void {
    this.#failDispatchIntentSave = true;
  }

  public failNextReceiptSave(): void {
    this.#failReceiptSave = true;
  }

  public failNextReservationIntentSave(): void {
    this.#failReservationIntentSave = true;
  }

  public failNextReservationReceiptSave(): void {
    this.#failReservationReceiptSave = true;
  }

  public failNextReservedStateSave(): void {
    this.#failReservedStateSave = true;
  }

  public tamperNextReservationIntentClaim(): void {
    this.#tamperReservationIntentOnClaim = true;
  }

  public strandNextRelease(): void {
    this.#strandNextRelease = true;
  }

  public tamperNextClaim(kind: "cost" | "normalization" | "pricing"): void {
    this.#tamperOnClaim = kind;
  }

  public async claimExecution(
    input: Parameters<ModelCommercialWorkflowStore["claimExecution"]>[0],
  ): Promise<
    Awaited<ReturnType<ModelCommercialWorkflowStore["claimExecution"]>>
  > {
    const result = await this.#delegate.claimExecution(input);
    if (
      result.kind === "acquired" &&
      this.#tamperReservationIntentOnClaim &&
      result.record.reservationIntent !== null
    ) {
      this.#tamperReservationIntentOnClaim = false;
      return {
        ...result,
        record: {
          ...result.record,
          reservationIntent: {
            ...result.record.reservationIntent,
            capacityDigest:
              "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        },
      };
    }
    if (
      result.kind !== "acquired" ||
      this.#tamperOnClaim === null ||
      result.record.resolvedContext === null
    ) {
      return result;
    }
    const tamper = this.#tamperOnClaim;
    this.#tamperOnClaim = null;
    const authority =
      result.record.resolvedContext.estimateResult.pricingAuthority;
    const estimateResult =
      tamper === "cost"
        ? {
            ...result.record.resolvedContext.estimateResult,
            maximumEstimatedProviderCostMicros: 1,
          }
        : {
            ...result.record.resolvedContext.estimateResult,
            pricingAuthority: {
              ...authority,
              routePins: authority.routePins.map((pin, index) =>
                index === 0
                  ? tamper === "pricing"
                    ? { ...pin, pricingVersionDigest: "tampered-pricing-pin" }
                    : {
                        ...pin,
                        normalizationPolicyDigest: "tampered-normalization-pin",
                      }
                  : pin,
              ),
            },
          };
    return {
      ...result,
      record: {
        ...result.record,
        resolvedContext: {
          ...result.record.resolvedContext,
          estimateResult,
        },
      },
    };
  }

  public compareAndSet(
    input: Parameters<ModelCommercialWorkflowStore["compareAndSet"]>[0],
  ): ReturnType<ModelCommercialWorkflowStore["compareAndSet"]> {
    if (
      this.#failReservationIntentSave &&
      input.record.reservationIntent !== null &&
      input.record.reservationReceipt === null
    ) {
      this.#failReservationIntentSave = false;
      return Promise.reject(
        new Error("Synthetic reservation-intent persistence crash."),
      );
    }
    if (
      this.#failReservationReceiptSave &&
      input.record.reservationReceipt !== null
    ) {
      this.#failReservationReceiptSave = false;
      return Promise.reject(
        new Error("Synthetic reservation-receipt persistence crash."),
      );
    }
    if (
      this.#failReservedStateSave &&
      input.record.state === "reserved" &&
      input.record.reservationReceipt !== null &&
      input.record.dispatchIntent === null
    ) {
      this.#failReservedStateSave = false;
      return Promise.reject(
        new Error("Synthetic reserved-state persistence crash."),
      );
    }
    if (
      this.#failDispatchIntentSave &&
      input.record.dispatchIntent !== null &&
      input.record.invocationReceipt === null
    ) {
      this.#failDispatchIntentSave = false;
      return Promise.reject(
        new Error("Synthetic dispatch-intent persistence crash."),
      );
    }
    if (this.#failReceiptSave && input.record.invocationReceipt !== null) {
      this.#failReceiptSave = false;
      return Promise.reject(new Error("Synthetic receipt persistence crash."));
    }
    return this.#delegate.compareAndSet(input);
  }

  public releaseExecution(
    input: Parameters<ModelCommercialWorkflowStore["releaseExecution"]>[0],
  ): ReturnType<ModelCommercialWorkflowStore["releaseExecution"]> {
    if (this.#strandNextRelease) {
      this.#strandNextRelease = false;
      return Promise.resolve();
    }
    return this.#delegate.releaseExecution(input);
  }
}
function harness(
  input: {
    readonly accounting?: InMemoryCanonicalModelCommercialAccounting;
    readonly accountingBalance?: number;
    readonly authorization?: ModelCommercialAuthorizationDecisionV1;
    readonly now?: string;
    readonly pricing?: readonly ModelProviderPricingVersionV1[];
    readonly scopeResolver?: ModelCommercialScopeResolverV1;
    readonly trustedNow?: () => string;
    readonly workflows?: ModelCommercialWorkflowStore;
    readonly invocationRecovery?: ModelCommercialInvocationRecoveryPortV1;
  } = {},
) {
  let nowText = input.now ?? requestedAt;
  const accounting =
    input.accounting ??
    new InMemoryCanonicalModelCommercialAccounting({
      org_one: input.accountingBalance ?? 100,
      org_two: 100,
    });
  const authorizationPort = new InMemoryModelCommercialAuthorization(
    input.authorization ?? authorization(),
  );
  const pricingPort = new InMemoryModelCommercialPricing({
    policies: [normalizationPolicy],
    pricing: input.pricing ?? [
      pricingFor(standardRoute, "pricing_standard_v1"),
      pricingFor(deepRoute, "pricing_deep_v1", 2_000_000),
    ],
  });
  const attestations = new InMemoryModelCommercialHostAttestations();
  const workflows =
    input.workflows ?? new InMemoryModelCommercialWorkflowStore();
  return {
    accounting,
    attestations,
    authorization: authorizationPort,
    coordinator: new ModelCommercialLifecycleCoordinator({
      accounting,
      attestations,
      authorization: authorizationPort,
      now: input.trustedNow ?? (() => nowText),
      pricing: pricingPort,
      scopeResolver:
        input.scopeResolver ?? new InMemoryModelCommercialScopeResolver(),
      workflows,
      ...(input.invocationRecovery === undefined
        ? {}
        : { invocationRecovery: input.invocationRecovery }),
    }),
    pricing: pricingPort,
    setNow(value: string): void {
      nowText = value;
    },
    workflows,
  };
}

describe("ModelCommercialLifecycleCoordinator", () => {
  it.each(["standard", "deep"] as const)(
    "projects the actual %s reservation into an uncharged pending review",
    async (requestedRoute) => {
      const workflows = new InMemoryModelCommercialWorkflowStore();
      const test = harness({ workflows });
      const operation = request({ requestedRoute, estimateAccepted: true });
      const route = requestedRoute === "deep" ? deepRoute : standardRoute;
      let callbacks = 0;
      const terminal = await test.coordinator.execute(
        operation,
        async (callback) => {
          callbacks++;
          const record = workflows.get(operation.multiCallWorkflowId);
          if (record === null)
            throw Error("Missing actual coordinator reservation.");
          const original = structuredClone(record);
          const pending = projectModelCommercialPendingReviewV2(record);
          expect(pending).toMatchObject({
            completedCreditUnits: null,
            estimate: record.resolvedContext?.estimateResult.estimate,
            reconciliationState: "pending-settlement",
            reservationAccepted: true,
            reservationId: callback.reservationId,
            route: requestedRoute,
            state: "settlement-pending",
            technicalUnits: null,
          });
          expect(pending.estimate?.maximumCreditUnits).toBe(
            callback.acceptedMaximumCreditUnits,
          );
          expect(
            test.accounting.getReservationStatus(
              operation,
              operation.reservationId,
            ),
          ).toBe("active");
          expect(test.accounting.events).toHaveLength(1);
          expect(test.accounting.releaseCalls).toBe(0);
          const context = record.resolvedContext;
          if (context === null)
            throw Error("Missing actual canonical estimate.");
          const invalid = [
            { ...record, state: "terminal" as const },
            { ...record, dispatchIntent: null },
            { ...record, reservationReceipt: null },
            { ...record, resolvedContext: null },
            { ...record, invocationResult: invocation() },
            { ...record, response: pending },
            {
              ...record,
              request: { ...record.request, organizationId: "org_two" },
            },
            {
              ...record,
              resolvedContext: {
                ...context,
                estimateResult: {
                  ...context.estimateResult,
                  estimate: {
                    ...context.estimateResult.estimate,
                    maximumCreditUnits: 999,
                  },
                },
              },
            },
          ];
          for (const changed of invalid) {
            expect(() =>
              projectModelCommercialPendingReviewV2(changed),
            ).toThrow();
          }
          if (pending.estimate === null)
            throw Error("Missing pending estimate.");
          Object.assign(pending.estimate, { maximumCreditUnits: 999 });
          expect(record).toEqual(original);
          expect(workflows.get(operation.multiCallWorkflowId)).toEqual(
            original,
          );
          return invocation({ attempts: [attempt({ route })] });
        },
      );
      expect(callbacks).toBe(1);
      expect(terminal.state).toBe("completed");
      expect(terminal.completedCreditUnits).toBeGreaterThan(0);
      expect(
        test.accounting.getReservationStatus(
          operation,
          operation.reservationId,
        ),
      ).toBe("settled");
      expect(test.accounting.events).toHaveLength(2);
    },
  );

  it.each(["acknowledged", "unconfirmed"] as const)(
    "recovers verified %s delivery once without another reservation or dispatch",
    async (delivery) => {
      const operation = request({ feature: "intent.extract" });
      const generated = intentPreviewGenerationEvidenceV1(
        invocation(),
        operation,
      );
      let pending = true;
      let calls = 0;
      const workflows = new InMemoryModelCommercialWorkflowStore();
      const test = harness({
        workflows,
        invocationRecovery: {
          recoverVerified: async (input) =>
            pending
              ? { kind: "pending" }
              : {
                  kind: "verified",
                  authority: "intent-preview-delivery-v1",
                  dispatchIntentId: input.dispatchIntent.dispatchIntentId,
                  requestDigest: digestStructuredValue(input.request),
                  result: intentPreviewCommercialOutcomeV1({
                    generation: generated,
                    request: input.request,
                    delivery,
                  }),
                },
        },
      });
      await expect(
        test.coordinator.execute(operation, async () => {
          calls++;
          throw new Error("Synthetic lost delivery.");
        }),
      ).rejects.toMatchObject({ code: "dependency-failure" });
      expect(
        workflows.get(operation.multiCallWorkflowId)?.invocationReceipt,
      ).toBeNull();
      expect(
        test.accounting.getReservationStatus(
          operation,
          operation.reservationId,
        ),
      ).toBe("active");
      expect(test.accounting.events).toHaveLength(1);
      await expect(test.coordinator.recover(operation)).rejects.toMatchObject({
        code: "dependency-failure",
      });
      pending = false;
      const terminal = await test.coordinator.recover(operation);
      expect(terminal.state).toBe(
        delivery === "acknowledged" ? "completed" : "compensated",
      );
      expect(terminal.completedCreditUnits).toBe(
        delivery === "acknowledged" ? 2 : 0,
      );
      expect(test.accounting.events).toHaveLength(2);
      expect(
        test.accounting.events[1]?.estimatedProviderCostMicros,
      ).toBeGreaterThan(0);
      await expect(test.coordinator.recover(operation)).resolves.toEqual(
        terminal,
      );
      expect(test.accounting.events).toHaveLength(2);
      expect(calls).toBe(1);
    },
  );

  it("rejects substituted recovery scope before settlement and retains its reservation", async () => {
    const operation = request();
    const test = harness({
      invocationRecovery: {
        recoverVerified: async (input) => ({
          kind: "verified",
          authority: "intent-preview-delivery-v1",
          dispatchIntentId: input.dispatchIntent.dispatchIntentId,
          requestDigest: digestStructuredValue({
            ...input.request,
            organizationId: "org_two",
          }),
          result: invocation(),
        }),
      },
    });
    await expect(
      test.coordinator.execute(operation, async () => {
        throw new Error("Synthetic delivery failure.");
      }),
    ).rejects.toMatchObject({ code: "policy-violation" });
    expect(
      test.accounting.getReservationStatus(operation, operation.reservationId),
    ).toBe("active");
    expect(test.accounting.events).toHaveLength(1);
  });

  it("does not compensate missing usage when delivery recovery has no evidence", async () => {
    const operation = request();
    const test = harness({
      invocationRecovery: {
        recoverVerified: async () => ({ kind: "unavailable" }),
      },
    });
    const result = await test.coordinator.execute(operation, async () => {
      throw new Error("Synthetic uncertain provider outcome.");
    });
    expect(result.state).toBe("reconciliation-required");
    expect(result.completedCreditUnits).toBeNull();
    expect(
      test.accounting.getReservationStatus(operation, operation.reservationId),
    ).toBe("active");
    expect(
      test.accounting.events.some(
        (event) => event.status === "released" || event.chargedCreditUnits > 0,
      ),
    ).toBe(false);
  });
  it("reserves before callback, settles actual usage, and releases the remainder", async () => {
    const test = harness();
    let callbackCount = 0;
    const response = await test.coordinator.execute(
      request(),
      async (context) => {
        callbackCount += 1;
        expect(context.acceptedMaximumCreditUnits).toBe(2);
        expect(context.acceptedMaximumEstimatedProviderCostMicros).toBe(200);
        expect(context.pricingVersionReference).toBe("pricing_standard_v1");
        expect(
          test.accounting.getReservationStatus(
            request(),
            context.reservationId,
          ),
        ).toBe("active");
        return invocation();
      },
    );

    expect(response).toMatchObject({
      completedCreditUnits: 2,
      compensationStatus: "not-required",
      reservationAccepted: true,
      route: "standard",
      routeLabel: "Standard Design",
      state: "completed",
      version: MODEL_COMMERCIAL_LIFECYCLE_VERSION,
    });
    expect(callbackCount).toBe(1);
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("settled");
    expect(test.accounting.events).toHaveLength(2);
    expect(test.accounting.events[1]).toMatchObject({
      cacheReadUnits: 10,
      cacheWriteUnits: 5,
      chargedCreditUnits: 2,
      feature: "ai-assisted-operations",
      inputUnits: 100,
      multiCallWorkflowId: "workflow_one",
      organizationId: "org_one",
      outputUnits: 20,
      pricingVersionId: "pricing_standard_v1",
      promptId: "prompt_architecture",
      promptVersion: "prompt_architecture_v1",
      projectId: "project_one",
      providerKey: "provider_test",
      status: "completed",
      totalUnits: 135,
      userId: "user_one",
    });
    expect(JSON.stringify(test.accounting.events)).not.toMatch(
      /rawPrompt|rawResponse|responseText|promptText/u,
    );
  });

  it("returns a Deep Design estimate before invocation when confirmation is required", async () => {
    const test = harness();
    let invoked = false;
    const response = await test.coordinator.execute(
      request({
        confirmationRequired: true,
        estimateAccepted: false,
        requestedRoute: "deep",
      }),
      async () => {
        invoked = true;
        return invocation();
      },
    );
    expect(response).toMatchObject({
      denialReason: "confirmation-required",
      reservationAccepted: false,
      route: "deep",
      routeLabel: "Deep Design",
      state: "estimate-confirmation-required",
    });
    expect(response.estimate?.maximumCreditUnits).toBe(4);
    expect(invoked).toBe(false);
    expect(test.accounting.events).toHaveLength(0);
  });

  it.each([
    [
      "organization suspension",
      { organizationStatus: "suspended" as const },
      "organization-suspended",
    ],
    ["plan entitlement", { featureEntitled: false }, "plan-not-entitled"],
    [
      "per-user requests",
      { perUserRequests: { current: 3, maximum: 3 } },
      "per-user-request-limit-reached",
    ],
    [
      "organization concurrency",
      {
        organizationConcurrentReservations: { current: 2, maximum: 2 },
      },
      "organization-concurrent-reservation-limit-reached",
    ],
    [
      "feature requests",
      { featureRequests: { current: 5, maximum: 5 } },
      "feature-limit-reached",
    ],
    ["input settings", { maximumInputUnits: 500 }, "maximum-input-exceeded"],
    ["output settings", { maximumOutputUnits: 100 }, "maximum-output-exceeded"],
  ])("denies exhausted %s before callback", async (_label, change, reason) => {
    const test = harness({
      authorization: authorization(change),
    });
    let invoked = false;
    const response = await test.coordinator.execute(request(), async () => {
      invoked = true;
      return invocation();
    });
    expect(response.denialReason).toBe(reason);
    expect(response.state).toBe("denied");
    expect(invoked).toBe(false);
    expect(test.accounting.events).toHaveLength(0);
  });

  it("fails before invocation when credits are insufficient and never creates overage", async () => {
    const test = harness({
      accountingBalance: 1,
      authorization: authorization({ availableCreditUnits: 1 }),
    });
    let invoked = false;
    const response = await test.coordinator.execute(request(), async () => {
      invoked = true;
      return invocation();
    });
    expect(response.denialReason).toBe("insufficient-credits");
    expect(invoked).toBe(false);
    expect(test.accounting.events).toHaveLength(0);
  });

  it("replays duplicate work without a second callback or charge", async () => {
    const test = harness();
    let callbackCount = 0;
    const callback = async () => {
      callbackCount += 1;
      return invocation();
    };
    const first = await test.coordinator.execute(request(), callback);
    const second = await test.coordinator.execute(request(), callback);
    expect(second).toEqual(first);
    expect(callbackCount).toBe(1);
    expect(test.accounting.events).toHaveLength(2);
    expect(test.accounting.getAvailableCreditUnits("org_one")).toBe(98);
  });

  it("atomically denies a concurrent reservation when pooled credits are already reserved", async () => {
    const test = harness({ accountingBalance: 2 });
    let releaseFirst: () => void = () => {
      throw new Error("The first reservation callback was not initialized.");
    };
    const firstCallback = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = test.coordinator.execute(request(), async () => {
      await firstCallback;
      return invocation();
    });
    await Promise.resolve();
    const secondRequest = request({
      eventIdPrefix: "usage_workflow_two",
      idempotencyKey: "idem_workflow_two",
      jobId: "job_two",
      multiCallWorkflowId: "workflow_two",
      requestId: "request_two",
      reservationId: "reservation_two",
    });
    const second = await test.coordinator.execute(secondRequest, async () =>
      invocation(),
    );
    expect(second.state).toBe("reservation-denied");
    expect(second.denialReason).toBe("insufficient-credits");
    releaseFirst();
    await expect(first).resolves.toMatchObject({ state: "completed" });
    expect(
      test.accounting.events.filter((event) => event.status === "completed"),
    ).toHaveLength(1);
  });

  it("leaves ambiguous missing usage open for reconciliation", async () => {
    const test = harness();
    const response = await test.coordinator.execute(request(), async () =>
      invocation({
        attempts: [
          attempt({
            status: "timed-out",
            usage: null,
            mayHaveBeenProcessed: true,
          }),
        ],
        failureCategory: "provider-timeout",
        status: "timeout",
        usefulOutputDelivered: false,
      }),
    );
    expect(response).toMatchObject({
      compensationStatus: "pending",
      reconciliationState: "pending-missing-usage",
      state: "reconciliation-required",
    });
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("active");
    expect(test.accounting.events[1]?.status).toBe("reconciliation-required");
  });

  it.each([
    ["provider failure", "provider-failure" as const],
    ["cancellation", "cancelled" as const],
    ["internal failure", "internal-failure" as const],
  ])(
    "keeps an unattested zero-attempt %s open for reconciliation",
    async (_label, status) => {
      const test = harness();
      const response = await test.coordinator.execute(request(), async () =>
        invocation({
          attempts: [],
          failureCategory: status,
          status,
          usefulOutputDelivered: false,
        }),
      );
      expect(response).toMatchObject({
        completedCreditUnits: null,
        compensationStatus: "pending",
        state: "reconciliation-required",
      });
      expect(
        test.accounting.getReservationStatus(request(), "reservation_one"),
      ).toBe("active");
    },
  );

  it("releases a callback-origin no-dispatch outcome only after host attestation", async () => {
    const test = harness();
    const response = await test.coordinator.execute(
      request(),
      async (context) =>
        invocation({
          attempts: [],
          failureCategory: "host-attested-pre-dispatch-no-usage",
          preDispatchNoUsageAttestation: {
            attestationId: "attestation_one",
            authority: "host-dispatch-v1",
            dispatchIntentId: context.dispatchIntentId,
            multiCallWorkflowId: "workflow_one",
            noUsageObserved: true,
            organizationId: "org_one",
            projectId: "project_one",
            providerDispatchStarted: false,
            reservationId: "reservation_one",
            verifierId: "cloudmarkup.host-dispatch",
            verifierVersion: "1",
          },
          status: "internal-failure",
          usefulOutputDelivered: false,
        }),
    );
    expect(response).toMatchObject({
      completedCreditUnits: 0,
      compensationStatus: "not-required",
      state: "released",
    });
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("released");
  });

  it("preserves provider cost and compensates timeout usage without charging", async () => {
    const test = harness();
    const response = await test.coordinator.execute(request(), async () =>
      invocation({
        attempts: [attempt({ status: "timed-out" })],
        failureCategory: "provider-timeout",
        status: "timeout",
        usefulOutputDelivered: false,
      }),
    );
    expect(response).toMatchObject({
      completedCreditUnits: 0,
      compensationStatus: "applied",
      state: "compensated",
    });
    expect(test.accounting.events[1]).toMatchObject({
      chargedCreditUnits: 0,
      compensatedCreditUnits: 2,
      estimatedProviderCostMicros: 135,
      status: "provider-failure",
    });
    expect(test.accounting.getAvailableCreditUnits("org_one")).toBe(100);
  });

  it("retries settlement without invoking the callback again", async () => {
    const test = harness();
    test.accounting.failNextSettlements();
    let callbackCount = 0;
    const callback = async () => {
      callbackCount += 1;
      return invocation();
    };
    await expect(
      test.coordinator.execute(request(), callback),
    ).resolves.toMatchObject({
      reconciliationState: "pending-settlement",
      state: "settlement-pending",
    });
    test.authorization.setDecision(
      authorization({
        organizationStatus: "suspended",
        planVersionId: "plan_changed_after_reservation",
      }),
    );
    await expect(
      test.coordinator.execute(request(), callback),
    ).resolves.toMatchObject({
      completedCreditUnits: 2,
      state: "completed",
    });
    expect(callbackCount).toBe(1);
    expect(test.authorization.resolveCount).toBe(1);
    expect(test.accounting.events).toHaveLength(2);
  });

  it("settles a multi-call Standard to Deep system escalation within the accepted estimate", async () => {
    const test = harness();
    const workflowRequest = request({
      plannedCalls: [
        {
          kind: "primary",
          maximumUsage: usage(150, 35),
          minimumUsage: usage(25, 5),
          routeId: standardRoute.routeId,
        },
        {
          kind: "system-escalation",
          maximumUsage: usage(150, 35),
          minimumUsage: usage(0, 0),
          routeId: deepRoute.routeId,
        },
      ],
    });
    const response = await test.coordinator.execute(workflowRequest, async () =>
      invocation({
        attempts: [
          attempt({ suffix: "standard" }),
          attempt({
            attemptKind: "system-escalation",
            attemptNumber: 2,
            retryOfAttemptId: "attempt_standard",
            route: deepRoute,
            suffix: "deep",
            usage: usage(20, 5),
          }),
        ],
      }),
    );
    expect(response).toMatchObject({
      compensationStatus: "not-required",
      state: "completed",
    });
    expect(response.estimate?.maximumCreditUnits).toBe(6);
    expect(test.accounting.events[1]?.attempts).toHaveLength(2);
  });

  it("reconciles an attempt that exceeds its accepted estimate", async () => {
    const test = harness();
    const response = await test.coordinator.execute(request(), async () =>
      invocation({
        attempts: [
          attempt({
            attemptKind: "repair",
            usage: usage(450, 100),
          }),
        ],
      }),
    );
    expect(response).toMatchObject({
      completedCreditUnits: null,
      compensationStatus: "pending",
      reconciliationState: "pending-missing-usage",
      state: "reconciliation-required",
    });
    expect(test.accounting.events[1]).toMatchObject({
      attempts: [],
      chargedCreditUnits: 0,
      failureCategory: "unsafe-provider-receipt",
      status: "reconciliation-required",
    });
    expect(test.accounting.getAvailableCreditUnits("org_one")).toBe(98);
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("active");
  });

  it("accepts a confirmed user-selected Deep Design route with its own estimate", async () => {
    const test = harness();
    const response = await test.coordinator.execute(
      request({
        confirmationRequired: true,
        estimateAccepted: true,
        requestedRoute: "deep",
      }),
      async () =>
        invocation({
          attempts: [attempt({ route: deepRoute })],
        }),
    );
    expect(response).toMatchObject({
      reservationAccepted: true,
      route: "deep",
      routeLabel: "Deep Design",
      state: "completed",
    });
    expect(response.estimate?.maximumCreditUnits).toBe(4);
  });

  it("retains ambiguous post-dispatch reservations after expiry without generic release authority", async () => {
    const test = harness();
    const response = await test.coordinator.execute(request(), async () =>
      invocation({
        attempts: [
          attempt({
            status: "timed-out",
            usage: null,
            mayHaveBeenProcessed: true,
          }),
        ],
        status: "timeout",
        usefulOutputDelivered: false,
      }),
    );
    expect(response).toMatchObject({
      reconciliationState: "pending-missing-usage",
      state: "reconciliation-required",
    });
    const eventCount = test.accounting.events.length;
    expect(test.accounting.getAvailableCreditUnits("org_one")).toBe(98);
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("active");
    expect("expire" in test.accounting).toBe(false);

    test.setNow("2026-08-21T14:00:00.000Z");
    await expect(test.coordinator.recover(request())).resolves.toMatchObject({
      reconciliationState: "pending-missing-usage",
      state: "reconciliation-required",
    });
    expect(test.accounting.events).toHaveLength(eventCount);
    expect(test.accounting.getAvailableCreditUnits("org_one")).toBe(98);
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("active");
  });
  it("rejects a host-expired fresh request before reservation or invocation", async () => {
    const test = harness({ now: "2026-08-21T13:00:00.000Z" });
    let callbackCount = 0;
    await expect(
      test.coordinator.execute(request(), async () => {
        callbackCount += 1;
        return invocation();
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(callbackCount).toBe(0);
    expect(test.accounting.events).toHaveLength(0);
  });

  it("permits terminal replay after expiry without a second invocation", async () => {
    const test = harness();
    let callbackCount = 0;
    const callback = async () => {
      callbackCount += 1;
      return invocation();
    };
    const first = await test.coordinator.execute(request(), callback);
    test.setNow("2026-08-21T14:00:00.000Z");
    await expect(
      test.coordinator.execute(request(), callback),
    ).resolves.toEqual(first);
    expect(callbackCount).toBe(1);
    expect(test.accounting.events).toHaveLength(2);
  });

  it("recovers an expired persisted settlement without reinvoking", async () => {
    const test = harness();
    test.accounting.failNextSettlements();
    let callbackCount = 0;
    const callback = async () => {
      callbackCount += 1;
      return invocation();
    };
    await expect(
      test.coordinator.execute(request(), callback),
    ).resolves.toMatchObject({
      state: "settlement-pending",
    });
    test.setNow("2026-08-21T13:00:00.000Z");
    await expect(
      test.coordinator.execute(request(), callback),
    ).resolves.toMatchObject({
      completedCreditUnits: 2,
      state: "completed",
    });
    expect(callbackCount).toBe(1);
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("settled");
  });

  it("rechecks host expiry after reservation and before dispatch", async () => {
    let hostClockReads = 0;
    const expiry = "2026-08-21T12:01:00.000Z";
    const test = harness({
      trustedNow: () => {
        hostClockReads += 1;
        return hostClockReads >= 10 ? expiry : requestedAt;
      },
    });
    let callbackCount = 0;
    const response = await test.coordinator.execute(
      request({ expiresAt: expiry }),
      async () => {
        callbackCount += 1;
        return invocation();
      },
    );
    expect(callbackCount).toBe(0);
    expect(response).toMatchObject({
      completedCreditUnits: 0,
      state: "released",
    });
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("released");
    expect(test.accounting.events[1]).toMatchObject({
      failureCategory: "reservation-expired-before-dispatch",
      occurredAt: expiry,
      status: "internal-failure",
    });
  });

  it("uses host receipt time and reservation pricing pins despite callback time and catalog rotation", async () => {
    const pinnedPricing = pricingFor(
      standardRoute,
      "pricing_standard_pinned_v1",
    );
    const test = harness({
      pricing: [pinnedPricing, pricingFor(deepRoute, "pricing_deep_v1")],
    });
    const response = await test.coordinator.execute(
      request(),
      async (context) => {
        expect(context.pricingVersionReference).toBe(
          "pricing_standard_pinned_v1",
        );
        expect(context.normalizationPolicyVersionReference).toBe(
          "normalization_test_v1",
        );
        expect(context.pricingAuthorityDigest).toMatch(/^sha256:/u);
        expect(context.pricingCatalogDigest).toMatch(/^sha256:/u);
        expect(context.normalizationPolicyCatalogDigest).toMatch(/^sha256:/u);
        test.pricing.setPricing([
          pricingFor(standardRoute, "pricing_standard_rotated_v2", 9_000_000),
          pricingFor(deepRoute, "pricing_deep_v2", 9_000_000),
        ]);
        test.setNow(completedAt);
        return invocation({
          attempts: [
            {
              ...attempt(),
              completedAt: "1999-01-01T00:00:00.000Z",
              latencyMilliseconds: 999_999,
              startedAt: "2099-01-01T00:00:00.000Z",
            },
          ],
          completedAt: "1999-01-01T00:00:00.000Z",
        });
      },
    );
    expect(response.state).toBe("completed");
    expect(test.accounting.events[1]).toMatchObject({
      completedAt,
      estimatedProviderCostMicros: 135,
      latencyMilliseconds: 1_000,
      occurredAt: completedAt,
      pricingVersionId: "pricing_standard_pinned_v1",
      startedAt: requestedAt,
    });
  });

  it.each(["pricing"] as const)(
    "fails closed when a persisted %s pin is corrupted before settlement retry",
    async (kind) => {
      const workflows = new FaultInjectingWorkflowStore();
      const test = harness({ workflows });
      test.accounting.failNextSettlements();
      let callbackCount = 0;
      const callback = async () => {
        callbackCount += 1;
        return invocation();
      };
      await expect(
        test.coordinator.execute(request(), callback),
      ).resolves.toMatchObject({ state: "settlement-pending" });
      workflows.tamperNextClaim(kind);
      await expect(
        test.coordinator.execute(request(), callback),
      ).rejects.toMatchObject({ code: "policy-violation" });
      expect(callbackCount).toBe(1);
      expect(test.accounting.events).toHaveLength(1);
    },
  );

  it("reconciles when priced attempts exceed the persisted accepted cost maximum", async () => {
    const workflows = new FaultInjectingWorkflowStore();
    const test = harness({ workflows });
    test.accounting.failNextSettlements();
    let callbackCount = 0;
    const callback = async () => {
      callbackCount += 1;
      return invocation();
    };
    await expect(
      test.coordinator.execute(request(), callback),
    ).resolves.toMatchObject({ state: "settlement-pending" });
    workflows.tamperNextClaim("cost");
    await expect(
      test.coordinator.execute(request(), callback),
    ).resolves.toMatchObject({
      reconciliationState: "pending-missing-usage",
      state: "reconciliation-required",
    });
    expect(callbackCount).toBe(1);
    expect(test.accounting.events[1]).toMatchObject({
      attempts: [],
      failureCategory: "unsafe-provider-receipt",
      status: "reconciliation-required",
    });
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("active");
  });
  it("maps an unknown post-dispatch callback exception to safe reconciliation", async () => {
    const test = harness();
    const sensitiveMarker = "sk-provider-secret-must-not-escape";
    let callbackCount = 0;
    const callback = async (): Promise<ModelCommercialInvocationResultV1> => {
      callbackCount += 1;
      throw new Error(sensitiveMarker);
    };
    const first = await test.coordinator.execute(request(), callback);
    expect(first).toMatchObject({
      compensationStatus: "pending",
      reconciliationState: "pending-missing-usage",
      state: "reconciliation-required",
    });
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("active");
    expect(test.accounting.events[1]).toMatchObject({
      attempts: [],
      failureCategory: "callback-outcome-unknown",
      status: "reconciliation-required",
    });
    expect(JSON.stringify(test.accounting.events)).not.toContain(
      sensitiveMarker,
    );
    await expect(
      test.coordinator.execute(request(), callback),
    ).resolves.toEqual(first);
    expect(callbackCount).toBe(1);
  });

  it.each([
    [
      "malformed secret-shaped result id",
      () => ({ ...invocation(), resultId: "result sk-provider-secret" }),
    ],
    [
      "oversized attempt id",
      () => ({
        ...invocation(),
        attempts: [{ ...attempt(), attemptId: "a".repeat(129) }],
      }),
    ],
    [
      "unknown provider failure code",
      () => ({
        ...invocation(),
        attempts: [],
        failureCategory: "provider said sk-provider-secret",
        status: "internal-failure" as const,
        usefulOutputDelivered: false,
      }),
    ],
  ] as const)(
    "sanitizes %s into fixed reconciliation evidence",
    async (_label, makeUnsafe) => {
      const test = harness();
      const response = await test.coordinator.execute(request(), async () =>
        makeUnsafe(),
      );
      expect(response).toMatchObject({
        reconciliationState: "pending-missing-usage",
        state: "reconciliation-required",
      });
      expect(test.accounting.events).toHaveLength(2);
      expect(test.accounting.events[1]).toMatchObject({
        attempts: [],
        failureCategory: "unsafe-provider-receipt",
        status: "reconciliation-required",
      });
      expect(JSON.stringify(test.accounting.events)).not.toMatch(
        /sk-provider-secret|a{129}/u,
      );
      expect(
        test.accounting.getReservationStatus(request(), "reservation_one"),
      ).toBe("active");
    },
  );

  it("does not treat a callback failure code as coordinator no-usage proof", async () => {
    const test = harness();
    const response = await test.coordinator.execute(request(), async () =>
      invocation({
        attempts: [],
        failureCategory: "reservation-expired-before-dispatch",
        status: "internal-failure",
        usefulOutputDelivered: false,
      }),
    );
    expect(response).toMatchObject({
      reconciliationState: "pending-missing-usage",
      state: "reconciliation-required",
    });
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("active");
  });

  it.each([
    ["root extra field", { ...request(), rawProviderText: "unexpected" }],
    [
      "nested usage extra field",
      {
        ...request(),
        plannedCalls: [
          {
            ...primaryPlannedCall(),
            maximumUsage: {
              ...primaryPlannedCall().maximumUsage,
              rawProviderText: "unexpected",
            },
          },
        ],
      },
    ],
    [
      "credential-shaped request id",
      request({ requestId: "sk-provider-secret" }),
    ],
  ] as const)(
    "rejects a commercial request with %s before persistence or accounting",
    async (_label, unsafeRequest) => {
      const workflows = new InMemoryModelCommercialWorkflowStore();
      const test = harness({ workflows });
      let callbackCount = 0;
      await expect(
        test.coordinator.execute(unsafeRequest, async () => {
          callbackCount += 1;
          return invocation();
        }),
      ).rejects.toMatchObject({ code: "invalid-input" });
      expect(callbackCount).toBe(0);
      expect(test.accounting.events).toHaveLength(0);
      expect(workflows.get("workflow_one")).toBeNull();
    },
  );

  it.each([
    [
      "root result extra",
      () => ({ ...invocation(), rawProviderText: "unsafe" }),
    ],
    [
      "nested attempt extra",
      () => ({
        ...invocation(),
        attempts: [{ ...attempt(), rawProviderText: "unsafe" }],
      }),
    ],
    [
      "nested usage extra",
      () => ({
        ...invocation(),
        attempts: [
          {
            ...attempt(),
            usage: { ...usage(), rawProviderText: "unsafe" },
          },
        ],
      }),
    ],
    [
      "nested provider unit extra",
      () => ({
        ...invocation(),
        attempts: [
          {
            ...attempt(),
            usage: {
              ...usage(),
              providerSpecificUnits: [
                { rawProviderText: "unsafe", unitName: "images", units: 1 },
              ],
            },
          },
        ],
      }),
    ],
    [
      "attestation extra",
      () => ({
        ...invocation({
          attempts: [],
          failureCategory: "host-attested-pre-dispatch-no-usage",
          status: "internal-failure",
          usefulOutputDelivered: false,
        }),
        preDispatchNoUsageAttestation: {
          attestationId: "attestation_one",
          authority: "host-dispatch-v1" as const,
          dispatchIntentId: "dispatch_forged",
          multiCallWorkflowId: "workflow_one",
          noUsageObserved: true as const,
          organizationId: "org_one",
          projectId: "project_one",
          providerDispatchStarted: false as const,
          rawProviderText: "unsafe",
          reservationId: "reservation_one",
          verifierId: "cloudmarkup.host-dispatch",
          verifierVersion: "1",
        },
      }),
    ],
    [
      "credential-shaped result id",
      () => ({ ...invocation(), resultId: "sk-provider-secret" }),
    ],
  ] as const)(
    "projects %s into fixed safe reconciliation without retaining extras",
    async (_label, makeUnsafe) => {
      const workflows = new InMemoryModelCommercialWorkflowStore();
      const test = harness({ workflows });
      const response = await test.coordinator.execute(request(), async () =>
        makeUnsafe(),
      );
      expect(response).toMatchObject({
        reconciliationState: "pending-missing-usage",
        state: "reconciliation-required",
      });
      expect(test.accounting.events[1]).toMatchObject({
        attempts: [],
        failureCategory: "unsafe-provider-receipt",
      });
      const retained = JSON.stringify(workflows.get("workflow_one"));
      expect(retained).not.toMatch(/rawProviderText|sk-provider-secret/u);
      expect(
        test.accounting.getReservationStatus(request(), "reservation_one"),
      ).toBe("active");
    },
  );

  it.each([
    [
      "cache units",
      () => ({
        result: invocation({
          attempts: [
            attempt({
              usage: {
                cacheReadUnits: 11,
                cacheWriteUnits: 5,
                inputUnits: 100,
                outputUnits: 20,
                providerSpecificUnits: [],
                totalUnits: 136,
              },
            }),
          ],
        }),
        workflowRequest: request(),
      }),
    ],
    [
      "provider-specific units",
      () => ({
        result: invocation({
          attempts: [
            attempt({
              usage: {
                ...usage(),
                providerSpecificUnits: [{ unitName: "images", units: 2 }],
              },
            }),
          ],
        }),
        workflowRequest: request({
          plannedCalls: [
            {
              ...primaryPlannedCall(),
              maximumUsage: {
                ...primaryPlannedCall().maximumUsage,
                providerSpecificUnits: [{ unitName: "images", units: 1 }],
              },
            },
          ],
        }),
      }),
    ],
    [
      "attempt kind",
      () => ({
        result: invocation({ attempts: [attempt({ attemptKind: "repair" })] }),
        workflowRequest: request(),
      }),
    ],
    [
      "attempt route",
      () => ({
        result: invocation({ attempts: [attempt({ route: deepRoute })] }),
        workflowRequest: request(),
      }),
    ],
  ] as const)(
    "reconciles instead of accounting when actual %s exceeds its planned call",
    async (_label, makeCase) => {
      const test = harness();
      const testCase = makeCase();
      await expect(
        test.coordinator.execute(
          testCase.workflowRequest,
          async () => testCase.result,
        ),
      ).resolves.toMatchObject({
        reconciliationState: "pending-missing-usage",
        state: "reconciliation-required",
      });
      expect(test.accounting.events[1]).toMatchObject({
        attempts: [],
        failureCategory: "unsafe-provider-receipt",
        status: "reconciliation-required",
      });
      expect(
        test.accounting.getReservationStatus(request(), "reservation_one"),
      ).toBe("active");
    },
  );
  it("uses a canonical request digest for reordered-key terminal replay", async () => {
    const test = harness();
    let callbackCount = 0;
    const callback = async () => {
      callbackCount += 1;
      return invocation();
    };
    const original = request();
    const originalPlannedCall = primaryPlannedCall(original);
    const first = await test.coordinator.execute(original, callback);
    const reorderedUsage = Object.fromEntries(
      Object.entries(originalPlannedCall.maximumUsage).reverse(),
    ) as unknown as ModelUsageUnitsV1;
    const reorderedCall = Object.fromEntries(
      Object.entries({
        ...originalPlannedCall,
        maximumUsage: reorderedUsage,
      }).reverse(),
    );
    const reordered = Object.fromEntries(
      Object.entries({ ...original, plannedCalls: [reorderedCall] }).reverse(),
    ) as unknown as ModelCommercialOperationRequestV1;
    await expect(
      test.coordinator.execute(reordered, callback),
    ).resolves.toEqual(first);
    expect(callbackCount).toBe(1);
    expect(test.accounting.events).toHaveLength(2);
  });
  it("fences a concurrent exact commercial replay before a second callback", async () => {
    const test = harness();
    let enterFirst: (() => void) | undefined;
    let releaseFirst: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enterFirst = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let callbackCount = 0;
    const first = test.coordinator.execute(request(), async () => {
      callbackCount += 1;
      enterFirst?.();
      await release;
      return invocation();
    });
    await entered;
    await expect(
      test.coordinator.execute(request(), async () => {
        callbackCount += 1;
        return invocation();
      }),
    ).rejects.toMatchObject({ code: "idempotency-conflict" });
    expect(callbackCount).toBe(1);
    releaseFirst?.();
    await expect(first).resolves.toMatchObject({ state: "completed" });
    expect(test.accounting.events).toHaveLength(2);
  });

  it("does not create a missing commercial workflow during recovery", async () => {
    const test = harness({ now: "2026-08-21T13:00:00.000Z" });
    await expect(test.coordinator.recover(request())).resolves.toMatchObject({
      denialReason: "reservation-denied",
      reservationAccepted: false,
      state: "reservation-denied",
    });
    expect(test.accounting.reserveCalls).toBe(0);
    expect(test.accounting.recoverExistingReservationCalls).toBe(0);
    expect(test.accounting.events).toHaveLength(0);
  });
  it("does not allocate for an existing resolved workflow whose reservation intent never persisted", async () => {
    const workflows = new FaultInjectingWorkflowStore();
    workflows.failNextReservationIntentSave();
    const test = harness({ workflows });
    let callbackCount = 0;
    await expect(
      test.coordinator.execute(request(), async () => {
        callbackCount += 1;
        return invocation();
      }),
    ).rejects.toMatchObject({ code: "dependency-failure" });
    expect(test.accounting.reserveCalls).toBe(0);
    expect(test.accounting.recoverExistingReservationCalls).toBe(0);
    test.setNow("2026-08-21T13:00:00.000Z");
    await expect(test.coordinator.recover(request())).resolves.toMatchObject({
      denialReason: "reservation-denied",
      reservationAccepted: false,
      state: "reservation-denied",
    });
    expect(test.accounting.reserveCalls).toBe(0);
    expect(test.accounting.recoverExistingReservationCalls).toBe(0);
    expect(callbackCount).toBe(0);
  });
  it("recovers a reserve-success receipt-CAS crash after expiry without reserving or invoking again", async () => {
    const workflows = new FaultInjectingWorkflowStore();
    workflows.failNextReservationReceiptSave();
    const test = harness({ workflows });
    let callbackCount = 0;
    await expect(
      test.coordinator.execute(request(), async () => {
        callbackCount += 1;
        return invocation();
      }),
    ).rejects.toMatchObject({ code: "dependency-failure" });
    expect(test.accounting.reserveCalls).toBe(1);
    expect(test.accounting.recoverExistingReservationCalls).toBe(0);
    expect(callbackCount).toBe(0);
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("active");

    test.setNow("2026-08-21T13:00:00.000Z");
    await expect(test.coordinator.recover(request())).resolves.toMatchObject({
      completedCreditUnits: 0,
      state: "released",
    });
    expect(test.accounting.reserveCalls).toBe(1);
    expect(test.accounting.recoverExistingReservationCalls).toBe(1);
    expect(callbackCount).toBe(0);
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("released");
  });

  it("replays an exact denied reservation outcome after receipt persistence crashes", async () => {
    const workflows = new FaultInjectingWorkflowStore();
    workflows.failNextReservationReceiptSave();
    const test = harness({ accountingBalance: 0, workflows });
    let callbackCount = 0;
    await expect(
      test.coordinator.execute(request(), async () => {
        callbackCount += 1;
        return invocation();
      }),
    ).rejects.toMatchObject({ code: "dependency-failure" });
    test.setNow("2026-08-21T13:00:00.000Z");
    await expect(test.coordinator.recover(request())).resolves.toMatchObject({
      denialReason: "insufficient-credits",
      reservationAccepted: false,
      state: "reservation-denied",
    });
    expect(test.accounting.reserveCalls).toBe(1);
    expect(test.accounting.recoverExistingReservationCalls).toBe(1);
    expect(callbackCount).toBe(0);
    expect(test.accounting.events).toHaveLength(0);
  });

  it("rejects a tampered persisted reservation intent without accounting recovery or allocation", async () => {
    const workflows = new FaultInjectingWorkflowStore();
    workflows.failNextReservationReceiptSave();
    const test = harness({ workflows });
    await expect(
      test.coordinator.execute(request(), async () => invocation()),
    ).rejects.toMatchObject({ code: "dependency-failure" });
    workflows.tamperNextReservationIntentClaim();
    test.setNow("2026-08-21T13:00:00.000Z");
    await expect(test.coordinator.recover(request())).rejects.toMatchObject({
      code: "idempotency-conflict",
    });
    expect(test.accounting.reserveCalls).toBe(1);
    expect(test.accounting.recoverExistingReservationCalls).toBe(0);
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("active");
  });

  it("refreshes a persisted active receipt from canonical external release before recovery mutation", async () => {
    const workflows = new FaultInjectingWorkflowStore();
    workflows.failNextReservedStateSave();
    const test = harness({ workflows });
    let callbackCount = 0;
    await expect(
      test.coordinator.execute(request(), async () => {
        callbackCount += 1;
        return invocation();
      }),
    ).rejects.toMatchObject({ code: "dependency-failure" });
    const reservationEvent = test.accounting.events[0];
    if (reservationEvent === undefined) {
      throw new Error("Expected the canonical reservation event.");
    }
    await expect(
      test.accounting.release({
        event: {
          ...reservationEvent,
          completedAt: "2026-08-21T12:30:00.000Z",
          eventId: "usage_workflow_one_external_release",
          idempotencyKey: "idem_workflow_one:external_release",
          occurredAt: "2026-08-21T12:30:00.000Z",
          reconciliationState: "reconciled",
          status: "released",
        },
      }),
    ).resolves.toEqual({ replayed: false });
    const eventCount = test.accounting.events.length;

    test.setNow("2026-08-21T14:00:00.000Z");
    await expect(test.coordinator.recover(request())).resolves.toMatchObject({
      completedCreditUnits: 0,
      state: "released",
    });
    expect(test.accounting.reserveCalls).toBe(1);
    expect(test.accounting.recoverExistingReservationCalls).toBe(1);
    expect(test.accounting.events).toHaveLength(eventCount);
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("released");
    expect(callbackCount).toBe(0);
  });
  it("rejects missing or mismatched canonical status refresh without reserving or invoking", async () => {
    for (const recoveryFault of ["not-found", "reservation-id"] as const) {
      const workflows = new FaultInjectingWorkflowStore();
      workflows.failNextReservedStateSave();
      const test = harness({ workflows });
      let callbackCount = 0;
      await expect(
        test.coordinator.execute(request(), async () => {
          callbackCount += 1;
          return invocation();
        }),
      ).rejects.toMatchObject({ code: "dependency-failure" });
      if (recoveryFault === "not-found") {
        test.accounting.failNextRecoveryAsNotFound();
      } else {
        test.accounting.tamperNextRecoveryReservationId();
      }

      test.setNow("2026-08-21T14:00:00.000Z");
      await expect(test.coordinator.recover(request())).rejects.toMatchObject({
        code: "idempotency-conflict",
      });
      expect(test.accounting.reserveCalls).toBe(1);
      expect(test.accounting.recoverExistingReservationCalls).toBe(1);
      expect(test.accounting.events).toHaveLength(1);
      expect(test.accounting.getAvailableCreditUnits("org_one")).toBe(98);
      expect(
        test.accounting.getReservationStatus(request(), "reservation_one"),
      ).toBe("active");
      expect(callbackCount).toBe(0);
    }
  });
  it("rejects a malformed canonical recovery result before persistence or dispatch", async () => {
    const workflows = new FaultInjectingWorkflowStore();
    workflows.failNextReservationReceiptSave();
    const test = harness({ workflows });
    let callbackCount = 0;
    const callback = async () => {
      callbackCount += 1;
      return invocation();
    };
    await expect(
      test.coordinator.execute(request(), callback),
    ).rejects.toMatchObject({
      code: "dependency-failure",
    });
    expect(test.accounting.reserveCalls).toBe(1);
    expect(test.accounting.recoverExistingReservationCalls).toBe(0);
    expect(test.accounting.releaseCalls).toBe(0);
    expect(callbackCount).toBe(0);

    test.accounting.tamperNextRecoveryStatusResultPair();
    await expect(
      test.coordinator.execute(request(), callback),
    ).rejects.toMatchObject({
      code: "idempotency-conflict",
    });
    expect(test.accounting.reserveCalls).toBe(1);
    expect(test.accounting.recoverExistingReservationCalls).toBe(1);
    expect(test.accounting.releaseCalls).toBe(0);
    expect(test.accounting.events).toHaveLength(1);
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("active");
    expect(callbackCount).toBe(0);
  });

  it("never reinvokes after dispatch intent persisted but receipt persistence failed", async () => {
    const workflows = new FaultInjectingWorkflowStore();
    workflows.failNextReceiptSave();
    const test = harness({ workflows });
    let callbackCount = 0;
    const callback = async () => {
      callbackCount += 1;
      return invocation();
    };
    await expect(
      test.coordinator.execute(request(), callback),
    ).rejects.toMatchObject({
      code: "dependency-failure",
      message: "The commercial lifecycle dependency is unavailable.",
    });
    expect(callbackCount).toBe(1);
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("active");
    const retry = await test.coordinator.execute(request(), callback);
    expect(retry).toMatchObject({
      reconciliationState: "pending-missing-usage",
      state: "reconciliation-required",
    });
    expect(callbackCount).toBe(1);
    expect(test.accounting.events[1]).toMatchObject({
      failureCategory: "callback-outcome-unknown",
      status: "reconciliation-required",
    });
  });

  it("recovers an expired dispatch intent as reconciliation without reinvoking", async () => {
    const workflows = new FaultInjectingWorkflowStore();
    workflows.failNextReceiptSave();
    const test = harness({ workflows });
    let callbackCount = 0;
    const callback = async () => {
      callbackCount += 1;
      return invocation();
    };
    await expect(
      test.coordinator.execute(request(), callback),
    ).rejects.toMatchObject({
      code: "dependency-failure",
      message: "The commercial lifecycle dependency is unavailable.",
    });
    test.setNow("2026-08-21T13:00:00.000Z");
    await expect(
      test.coordinator.execute(request(), callback),
    ).resolves.toMatchObject({
      reconciliationState: "pending-missing-usage",
      state: "reconciliation-required",
    });
    expect(callbackCount).toBe(1);
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("active");
  });

  it("uses coordinator proof to release an expired reservation with no dispatch intent", async () => {
    const workflows = new FaultInjectingWorkflowStore();
    workflows.failNextDispatchIntentSave();
    const test = harness({ workflows });
    let callbackCount = 0;
    const callback = async () => {
      callbackCount += 1;
      return invocation();
    };
    await expect(
      test.coordinator.execute(request(), callback),
    ).rejects.toMatchObject({
      code: "dependency-failure",
      message: "The commercial lifecycle dependency is unavailable.",
    });
    test.setNow("2026-08-21T13:00:00.000Z");
    await expect(
      test.coordinator.execute(request(), callback),
    ).resolves.toMatchObject({
      completedCreditUnits: 0,
      state: "released",
    });
    expect(callbackCount).toBe(0);
    expect(
      test.accounting.getReservationStatus(request(), "reservation_one"),
    ).toBe("released");
  });

  it("takes over a stale pre-dispatch lease without duplicating reservation or invocation", async () => {
    const workflows = new FaultInjectingWorkflowStore();
    workflows.failNextDispatchIntentSave();
    workflows.strandNextRelease();
    const test = harness({ workflows });
    let callbackCount = 0;
    const callback = async () => {
      callbackCount += 1;
      return invocation();
    };
    await expect(
      test.coordinator.execute(request(), callback),
    ).rejects.toMatchObject({
      code: "dependency-failure",
      message: "The commercial lifecycle dependency is unavailable.",
    });
    expect(callbackCount).toBe(0);
    expect(test.accounting.events).toHaveLength(1);
    test.setNow("2026-08-21T12:06:00.000Z");
    await expect(
      test.coordinator.execute(request(), callback),
    ).resolves.toMatchObject({ state: "completed" });
    expect(callbackCount).toBe(1);
    expect(test.accounting.events).toHaveLength(2);
  });

  it("takes over a stale post-dispatch lease only for reconciliation", async () => {
    const workflows = new FaultInjectingWorkflowStore();
    workflows.failNextReceiptSave();
    workflows.strandNextRelease();
    const test = harness({ workflows });
    let callbackCount = 0;
    const callback = async () => {
      callbackCount += 1;
      return invocation();
    };
    await expect(
      test.coordinator.execute(request(), callback),
    ).rejects.toMatchObject({
      code: "dependency-failure",
      message: "The commercial lifecycle dependency is unavailable.",
    });
    test.setNow("2026-08-21T12:06:00.000Z");
    await expect(
      test.coordinator.execute(request(), callback),
    ).resolves.toMatchObject({
      reconciliationState: "pending-missing-usage",
      state: "reconciliation-required",
    });
    expect(callbackCount).toBe(1);
    expect(test.accounting.events).toHaveLength(2);
  });

  it("rejects an old commercial fence after trusted-time lease takeover", async () => {
    const workflows = new InMemoryModelCommercialWorkflowStore();
    const first = await workflows.claimExecution({
      fingerprint: "fingerprint_one",
      leaseExpiresAt: "2026-08-21T12:05:00.000Z",
      recoveryOnly: false,
      request: request(),
      tenantScopeDigest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      trustedNow: requestedAt,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") {
      throw new Error("Expected the initial test lease.");
    }
    await expect(
      workflows.claimExecution({
        fingerprint: "fingerprint_one",
        leaseExpiresAt: "2026-08-21T12:06:00.000Z",
        recoveryOnly: false,
        request: request(),
        tenantScopeDigest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        trustedNow: "2026-08-21T12:01:00.000Z",
      }),
    ).resolves.toEqual({ kind: "in-progress" });
    const takeover = await workflows.claimExecution({
      fingerprint: "fingerprint_one",
      leaseExpiresAt: "2026-08-21T12:11:00.000Z",
      recoveryOnly: false,
      request: request(),
      tenantScopeDigest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      trustedNow: "2026-08-21T12:06:00.000Z",
    });
    expect(takeover.kind).toBe("acquired");
    if (takeover.kind !== "acquired") {
      throw new Error("Expected a stale-lease takeover.");
    }
    await expect(
      workflows.compareAndSet({
        expectedRevision: first.record.revision,
        lease: first.lease,
        record: first.record,
        tenantScopeDigest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        trustedNow: "2026-08-21T12:01:00.000Z",
      }),
    ).rejects.toThrow(/fencing conflict/u);
    await expect(
      workflows.releaseExecution({
        lease: first.lease,
        multiCallWorkflowId: "workflow_one",
        tenantScopeDigest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).rejects.toThrow(/fencing conflict/u);
    await expect(
      workflows.releaseExecution({
        lease: takeover.lease,
        multiCallWorkflowId: "workflow_one",
        tenantScopeDigest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).resolves.toBeUndefined();
  });
  it("rejects a resolver scope mismatch before workflow claim or accounting", async () => {
    const workflows = new InMemoryModelCommercialWorkflowStore();
    const test = harness({
      scopeResolver: new InMemoryModelCommercialScopeResolver({
        organizationId: "org_two",
        projectId: "project_one",
        userId: "user_one",
      }),
      workflows,
    });
    let callbackCount = 0;
    await expect(
      test.coordinator.execute(request(), async () => {
        callbackCount += 1;
        return invocation();
      }),
    ).rejects.toMatchObject({ code: "policy-violation" });
    expect(callbackCount).toBe(0);
    expect(test.accounting.events).toHaveLength(0);
    expect(workflows.get("workflow_one")).toBeNull();
  });

  it("maps an unknown scope-resolver failure to a fixed safe error", async () => {
    const secretMarker = "sk-provider-secret";
    const workflows = new InMemoryModelCommercialWorkflowStore();
    const test = harness({
      scopeResolver: {
        resolve: () => Promise.reject(new Error(secretMarker)),
      },
      workflows,
    });
    let caught: unknown;
    try {
      await test.coordinator.execute(request(), async () => invocation());
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "dependency-failure",
      message: "The commercial lifecycle dependency is unavailable.",
    });
    expect(String(caught)).not.toContain(secretMarker);
    expect(test.accounting.events).toHaveLength(0);
    expect(workflows.get("workflow_one")).toBeNull();
  });

  it("tenant-scopes canonical accounting opaque IDs and denies cross-scope lifecycle access", async () => {
    const accounting = new CapturingCanonicalModelCommercialAccounting({
      org_one: 100,
      org_two: 100,
    });
    const workflows = new InMemoryModelCommercialWorkflowStore();
    const first = harness({ accounting, workflows });
    const second = harness({
      accounting,
      authorization: authorization({ organizationId: "org_two" }),
      workflows,
    });
    const firstRequest = request();
    const secondRequest = request({
      organizationId: "org_two",
      projectId: "project_two",
      userId: "user_two",
    });
    expect(secondRequest.reservationId).toBe(firstRequest.reservationId);
    expect(secondRequest.idempotencyKey).toBe(firstRequest.idempotencyKey);

    let markFirstStarted: (() => void) | undefined;
    let releaseFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstExecution = first.coordinator.execute(firstRequest, async () => {
      markFirstStarted?.();
      await firstRelease;
      return invocation();
    });
    await firstStarted;

    let boundaryFailure: { readonly error: unknown } | null = null;
    try {
      await expect(
        second.coordinator.execute(secondRequest, async () => invocation()),
      ).resolves.toMatchObject({ state: "completed" });
      const firstReservationInput = accounting.reservationInputs.find(
        (input) => input.event.organizationId === firstRequest.organizationId,
      );
      const secondReservationInput = accounting.reservationInputs.find(
        (input) => input.event.organizationId === secondRequest.organizationId,
      );
      if (
        firstReservationInput === undefined ||
        secondReservationInput === undefined
      ) {
        throw new Error("Expected both tenant-scoped reservation inputs.");
      }
      expect(firstReservationInput.event.reservationId).toBe(
        secondReservationInput.event.reservationId,
      );
      expect(firstReservationInput.event.idempotencyKey).toBe(
        secondReservationInput.event.idempotencyKey,
      );
      await expect(
        accounting.reserve(firstReservationInput),
      ).resolves.toMatchObject({ accepted: true, replayed: true });
      await expect(
        accounting.recoverExistingReservation(firstReservationInput),
      ).resolves.toMatchObject({
        accountingStatus: "active",
        kind: "found",
        result: { replayed: true },
      });

      const crossOrganizationEvent = {
        ...firstReservationInput.event,
        completedAt,
        eventId: "cross_scope_settlement",
        idempotencyKey: "cross_scope:settlement",
        occurredAt: completedAt,
        organizationId: secondRequest.organizationId,
        status: "completed" as const,
      };
      const crossProjectEvent = {
        ...firstReservationInput.event,
        completedAt,
        eventId: "cross_scope_release",
        idempotencyKey: "cross_scope:release",
        occurredAt: completedAt,
        projectId: secondRequest.projectId,
        status: "released" as const,
      };
      const crossUserEvent = {
        ...firstReservationInput.event,
        completedAt,
        eventId: "cross_scope_reconciliation",
        idempotencyKey: "cross_scope:reconciliation",
        occurredAt: completedAt,
        reconciliationState: "pending-missing-usage" as const,
        status: "reconciliation-required" as const,
        userId: secondRequest.userId,
      };
      await expect(
        accounting.settle({
          actualCreditUnits: 0,
          chargedCreditUnits: 0,
          event: crossOrganizationEvent,
        }),
      ).rejects.toThrow(/Cross-tenant reservation mutation denied/u);
      await expect(
        accounting.release({ event: crossProjectEvent }),
      ).rejects.toThrow(/Cross-tenant reservation mutation denied/u);
      await expect(
        accounting.markReconciliationRequired({ event: crossUserEvent }),
      ).rejects.toThrow(/Cross-tenant reservation mutation denied/u);
      await expect(
        accounting.recoverExistingReservation({
          ...firstReservationInput,
          event: crossOrganizationEvent,
        }),
      ).resolves.toEqual({ kind: "not-found" });

      expect(
        accounting.getReservationStatus(
          firstRequest,
          firstRequest.reservationId,
        ),
      ).toBe("active");
      expect(
        accounting.getReservationStatus(
          secondRequest,
          secondRequest.reservationId,
        ),
      ).toBe("settled");

      expect(
        accounting.events.filter((event) => event.status === "reserved"),
      ).toHaveLength(2);
    } catch (error) {
      boundaryFailure = { error };
    } finally {
      releaseFirst?.();
    }

    const firstResponse = await firstExecution;
    if (boundaryFailure !== null) {
      throw boundaryFailure.error;
    }
    expect(firstResponse).toMatchObject({ state: "completed" });
    expect(
      accounting.getReservationStatus(firstRequest, firstRequest.reservationId),
    ).toBe("settled");
    expect(
      accounting.getReservationStatus(
        secondRequest,
        secondRequest.reservationId,
      ),
    ).toBe("settled");
    const completedFirstEvent = accounting.events.find(
      (event) =>
        event.organizationId === firstRequest.organizationId &&
        event.status === "completed",
    );
    if (completedFirstEvent === undefined) {
      throw new Error("Expected the first tenant's completed usage event.");
    }
    const eventCount = accounting.events.length;
    await expect(
      accounting.settle({
        actualCreditUnits: completedFirstEvent.chargedCreditUnits,
        chargedCreditUnits: completedFirstEvent.chargedCreditUnits,
        event: completedFirstEvent,
      }),
    ).resolves.toEqual({ replayed: true });
    expect(accounting.events).toHaveLength(eventCount);
  });
  it("isolates the same workflow identity across verified tenant and project scopes", async () => {
    const workflows = new InMemoryModelCommercialWorkflowStore();
    const first = harness({ workflows });
    const projectTwo = harness({ workflows });
    const tenantTwo = harness({
      authorization: authorization({ organizationId: "org_two" }),
      workflows,
    });
    const projectTwoRequest = request({ projectId: "project_two" });
    const tenantTwoRequest = request({
      organizationId: "org_two",
      projectId: "project_two",
      userId: "user_two",
    });
    await expect(
      first.coordinator.execute(request(), async () => invocation()),
    ).resolves.toMatchObject({ state: "completed" });
    await expect(
      projectTwo.coordinator.execute(projectTwoRequest, async () =>
        invocation(),
      ),
    ).resolves.toMatchObject({ state: "completed" });
    await expect(
      tenantTwo.coordinator.execute(tenantTwoRequest, async () => invocation()),
    ).resolves.toMatchObject({ state: "completed" });
    for (const scope of [
      {
        organizationId: "org_one",
        projectId: "project_one",
        userId: "user_one",
      },
      {
        organizationId: "org_one",
        projectId: "project_two",
        userId: "user_one",
      },
      {
        organizationId: "org_two",
        projectId: "project_two",
        userId: "user_two",
      },
    ]) {
      expect(
        workflows.get(
          "workflow_one",
          digestModelCommercialVerifiedScopeV1(scope),
        ),
      ).not.toBeNull();
    }
  });

  it("denies cross-scope commercial CAS and release before record access", async () => {
    const workflows = new InMemoryModelCommercialWorkflowStore();
    const scopeOne = digestModelCommercialVerifiedScopeV1({
      organizationId: "org_one",
      projectId: "project_one",
      userId: "user_one",
    });
    const scopeTwo = digestModelCommercialVerifiedScopeV1({
      organizationId: "org_two",
      projectId: "project_one",
      userId: "user_one",
    });
    const claimed = await workflows.claimExecution({
      fingerprint: "fingerprint_scope",
      leaseExpiresAt: "2026-08-21T12:05:00.000Z",
      recoveryOnly: false,
      request: request(),
      tenantScopeDigest: scopeOne,
      trustedNow: requestedAt,
    });
    if (claimed.kind !== "acquired") {
      throw new Error("Expected a scoped workflow lease.");
    }
    await expect(
      workflows.compareAndSet({
        expectedRevision: claimed.record.revision,
        lease: claimed.lease,
        record: claimed.record,
        tenantScopeDigest: scopeTwo,
        trustedNow: requestedAt,
      }),
    ).rejects.toThrow(/fencing conflict/u);
    await expect(
      workflows.releaseExecution({
        lease: claimed.lease,
        multiCallWorkflowId: "workflow_one",
        tenantScopeDigest: scopeTwo,
      }),
    ).rejects.toThrow(/fencing conflict/u);
    expect(workflows.get("workflow_one", scopeOne)).not.toBeNull();
    expect(workflows.get("workflow_one", scopeTwo)).toBeNull();
  });
  it("atomically fences distinct commercial requests at organization concurrency one", async () => {
    const test = harness({
      authorization: authorization({
        organizationConcurrentReservations: { current: 0, maximum: 1 },
      }),
    });
    let enterFirst: (() => void) | undefined;
    let releaseFirst: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enterFirst = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let callbackCount = 0;
    const first = test.coordinator.execute(request(), async () => {
      callbackCount += 1;
      enterFirst?.();
      await release;
      return invocation();
    });
    await entered;
    const secondRequest = request({
      eventIdPrefix: "usage_capacity_two",
      idempotencyKey: "idem_capacity_two",
      jobId: "job_capacity_two",
      multiCallWorkflowId: "workflow_capacity_two",
      requestId: "request_capacity_two",
      reservationId: "reservation_capacity_two",
    });
    const denied = await test.coordinator.execute(secondRequest, async () => {
      callbackCount += 1;
      return invocation({ resultId: "result_capacity_two" });
    });
    expect(denied).toMatchObject({
      denialReason: "organization-concurrent-reservation-limit-reached",
      state: "reservation-denied",
    });
    expect(callbackCount).toBe(1);
    releaseFirst?.();
    await expect(first).resolves.toMatchObject({ state: "completed" });
    expect(
      test.accounting.events.filter((event) => event.status === "reserved"),
    ).toHaveLength(1);
  });
});
