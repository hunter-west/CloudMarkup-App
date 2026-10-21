import {
  digestStructuredValue,
  projectModelCommercialReservationV1,
  type ModelCommercialCapacityReservationV1,
  type ModelCommercialVerifiedScopeV1,
  type ModelCommercialWorkflowRecordV1,
  type ModelCommercialWorkflowStore,
  type ModelCommercialOperationRequestV1,
  type ModelCommercialRouteV1,
} from "@cloudmarkup/model-gateway";
import { InMemoryModelCommercialWorkflowStore } from "@cloudmarkup/model-gateway/testing";
import {
  commercialHarness,
  commercialInvocation,
  commercialRequest,
  commercialScope,
  workflowTestRoute,
} from "./model-commercial-workflow-test-helpers.js";
import { runtimeTestId } from "./model-runtime-admission-test-helpers.js";

/** Synthetic coordinator-produced metadata only; never production admission,
 * model pricing, normalization approval or a provider invocation. */
export async function modelAccountingFixture(
  now = new Date().toISOString(),
  selectedScope?: ModelCommercialVerifiedScopeV1,
  suffix = "",
  capacity?: ModelCommercialCapacityReservationV1,
  preview?: {
    readonly request: ModelCommercialOperationRequestV1;
    readonly route: ModelCommercialRouteV1;
    readonly pricing?: NonNullable<
      Parameters<typeof commercialHarness>[3]
    >["pricing"];
    readonly normalization?: NonNullable<
      Parameters<typeof commercialHarness>[3]
    >["normalization"];
    readonly authorization?: NonNullable<
      Parameters<typeof commercialHarness>[3]
    >["authorization"];
    readonly expiresAfterMilliseconds?: number;
  },
) {
  const scope =
    selectedScope ??
    commercialScope(
      runtimeTestId("org"),
      runtimeTestId("project"),
      runtimeTestId("principal"),
    );
  const request = {
    ...(preview?.request ?? commercialRequest(scope, now)),
    feature: preview?.request.feature ?? "intent.extract",
    expiresAt: new Date(
      Date.parse(now) + (preview?.expiresAfterMilliseconds ?? 240000),
    ).toISOString(),
  };
  if (suffix !== "")
    for (const key of [
      "idempotencyKey",
      "eventIdPrefix",
      "multiCallWorkflowId",
      "requestId",
      "reservationId",
      "jobId",
    ] as const)
      request[key] += suffix;
  const backing = new InMemoryModelCommercialWorkflowStore();
  let captured: ModelCommercialWorkflowRecordV1 | undefined;
  let dispatchedRecord: ModelCommercialWorkflowRecordV1 | undefined;
  const workflows: ModelCommercialWorkflowStore = {
    claimExecution: (input) => backing.claimExecution(input),
    compareAndSet: (input) => {
      if (
        input.record.dispatchIntent !== null &&
        input.record.invocationReceipt === null
      )
        dispatchedRecord = structuredClone(input.record);
      if (
        input.record.reservationIntent !== null &&
        input.record.reservationReceipt === null
      )
        captured = structuredClone(input.record);
      return backing.compareAndSet(input);
    },
    releaseExecution: (input) => backing.releaseExecution(input),
  };
  const route = preview?.route ?? {
    ...workflowTestRoute,
    providerKey: "synthetic-provider",
  };
  const harness = commercialHarness(workflows, request, () => now, {
    route,
    pricingVersionId:
      preview === undefined ? "pricing.synthetic" : "pricing.synthetic.preview",
    ...(preview?.pricing === undefined ? {} : { pricing: preview.pricing }),
    ...(preview?.normalization === undefined
      ? {}
      : { normalization: preview.normalization }),
    authorization: { ...preview?.authorization, ...capacity },
  });
  await harness.coordinator.execute(request, () =>
    Promise.resolve({ ...commercialInvocation(request), attempts: [] }),
  );
  if (captured === undefined)
    throw new Error(
      "Synthetic coordinator did not persist its exact reservation intent.",
    );
  const record: ModelCommercialWorkflowRecordV1 = { ...captured, revision: 0 };
  const input = projectModelCommercialReservationV1(record);
  return {
    scope,
    request,
    record,
    dispatchedRecord,
    input,
    route,
    fingerprint: digestStructuredValue(request),
  };
}
