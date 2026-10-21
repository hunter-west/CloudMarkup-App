import { beforeAll, describe, expect, it } from "vitest";
import { sha256Text } from "@cloudmarkup/model-gateway";
import { aiPreviewFixture } from "./ai-intent-preview-test-helpers.js";
import { modelAccountingFixture } from "./model-commercial-accounting-test-helpers.js";
import { modelReadRuntimeFixture } from "./model-commercial-read-host-test-helpers.js";
import { deniedPreviewFactoryFixture } from "../../production-ai-intent-preview-test-helpers.js";
import {
  PostgresModelCommercialPreflight,
  assertModelCommercialPreflightBinding,
  type ModelCommercialPreflightSnapshotV1,
} from "./model-commercial-snapshot.js";

let built: Awaited<ReturnType<typeof modelReadRuntimeFixture>>;
let snapshot: ModelCommercialPreflightSnapshotV1;
beforeAll(async () => {
  // Comparison data ONLY: no canonical database, issuance, runtime.execute,
  // reservation or provider call. The held deterministic report is unchanged.
  const preview = aiPreviewFixture(undefined, "2026-09-07T12:00:00.000Z");
  const accounting = await modelAccountingFixture(
    "2026-09-07T12:00:00.000Z",
    preview.tenant,
    "",
    undefined,
    preview,
  );
  built = await modelReadRuntimeFixture(
    preview,
    accounting.record,
    "planver_pro_2026_08_14_v2",
  );
  const available = String(
    built.runtime.routingRequest.creditAuthorization.availableCreditUnits,
  );
  snapshot = {
    contractVersion: 1,
    observedAt: "2026-09-07T12:00:00.000Z",
    expiresAt: "2026-09-07T12:01:00.000Z",
    descriptor: built.descriptor,
    selectors: built.selectors,
    entitlement: {
      entitlementSnapshotId: "synthetic_snapshot",
      sourceRecordVersion: "1",
      subscriptionProjectionId: "synthetic_subscription",
      planVersionId: "planver_pro_2026_08_14_v2",
      planKey: "pro",
      entitlementPolicyVersion: "cloudmarkup-entitlements-v1",
    },
    featureEnabled: true,
    maximumConcurrentReservations: 2,
    balance: {
      organizationId: preview.scope.organizationId,
      asOf: "2026-09-07T12:00:00.000Z",
      activeGrantedCreditUnits: available,
      availableCreditUnits: available,
      compensatedCreditUnits: "0",
      debitAdjustmentCreditUnits: "0",
      netAdjustmentCreditUnits: "0",
      exhausted: false,
      expiredCreditUnits: "0",
      reservedCreditUnits: "0",
      settledCreditUnits: "0",
      totalGrantedCreditUnits: available,
      unresolvedCreditUnits: "0",
    },
    price: built.pin.pricingVersion,
    normalization: built.pin.normalizationPolicy,
  };
});
describe("non-authorizing canonical preflight comparison", () => {
  it("matches exact comparison metadata without creating runtime or promotion authority", () => {
    expect(() => {
      assertModelCommercialPreflightBinding(snapshot, built.runtime);
    }).not.toThrow();
    expect(built.runtime.evaluationReport).toMatchObject({
      executionMode: "deterministic-fake",
      activationRecommendation: "hold",
      capabilityActivated: false,
    });
    for (const key of [
      "maximumInputUnits",
      "maximumOutputUnits",
      "estimateAccepted",
      "admissionDecision",
      "issuanceVerified",
    ])
      expect(snapshot).not.toHaveProperty(key);
  });
  it.each(["organizationId", "projectId", "userId", "jobId"] as const)(
    "rejects changed original %s comparison",
    (key) => {
      expect(() => {
        assertModelCommercialPreflightBinding(
          {
            ...snapshot,
            descriptor: {
              ...snapshot.descriptor,
              scope: { ...snapshot.descriptor.scope, [key]: "different_scope" },
            },
          },
          built.runtime,
        );
      }).toThrow();
    },
  );
  it.each(["inputDigest", "idempotencyKeyDigest"] as const)(
    "rejects changed original %s",
    (key) => {
      expect(() => {
        assertModelCommercialPreflightBinding(
          {
            ...snapshot,
            descriptor: {
              ...snapshot.descriptor,
              [key]: sha256Text("changed comparison"),
            },
          },
          built.runtime,
        );
      }).toThrow();
    },
  );
  it.each(["planVersionId", "planKey"] as const)(
    "rejects changed canonical %s",
    (key) => {
      expect(() => {
        assertModelCommercialPreflightBinding(
          {
            ...snapshot,
            entitlement: { ...snapshot.entitlement, [key]: "other_plan" },
          },
          built.runtime,
        );
      }).toThrow();
    },
  );
  it.each(["runtimePolicyDigest", "routeDefinitionDigest"] as const)(
    "rejects changed exact selector %s",
    (key) => {
      expect(() => {
        assertModelCommercialPreflightBinding(
          {
            ...snapshot,
            selectors: {
              ...snapshot.selectors,
              [key]: sha256Text("changed selector"),
            },
          },
          built.runtime,
        );
      }).toThrow();
    },
  );
  it("rejects a widened resolved credit balance instead of manufacturing credits", () => {
    expect(() => {
      assertModelCommercialPreflightBinding(snapshot, {
        ...built.runtime,
        routingRequest: {
          ...built.runtime.routingRequest,
          creditAuthorization: {
            ...built.runtime.routingRequest.creditAuthorization,
            availableCreditUnits:
              built.runtime.routingRequest.creditAuthorization
                .availableCreditUnits + 1,
          },
        },
      });
    }).toThrow();
  });
  it("rejects disabled canonical feature and a changed pricing environment", () => {
    expect(() => {
      assertModelCommercialPreflightBinding(
        { ...snapshot, featureEnabled: false },
        built.runtime,
      );
    }).toThrow();
    expect(() => {
      assertModelCommercialPreflightBinding(
        {
          ...snapshot,
          price: { ...snapshot.price, environment: "production" },
        },
        {
          ...built.runtime,
          commercialRequest: {
            ...built.runtime.commercialRequest,
            environment: "test",
          },
        },
      );
    }).toThrow();
  });
  it("rejects wrong original actor and operation before database access", () => {
    const f = deniedPreviewFactoryFixture();
    expect(
      () =>
        new PostgresModelCommercialPreflight({
          ...f.input,
          descriptor: {
            ...f.input.invocation.descriptor,
            scope: {
              ...f.input.invocation.descriptor.scope,
              userId: "different_actor",
            },
          },
          selectors: f.input.commercial.selectors,
        }),
    ).toThrow();
    expect(
      () =>
        new PostgresModelCommercialPreflight({
          ...f.input,
          descriptor: {
            ...f.input.invocation.descriptor,
            feature: "summary.technical",
          },
          selectors: f.input.commercial.selectors,
        }),
    ).toThrow();
    expect(f.unexpected).not.toHaveBeenCalled();
  });
});
