import { describe, expect, it } from "vitest";

import {
  customerCiLifecycleResultV1Schema,
  type CustomerCiLifecycleResultV1,
} from "./contracts.js";
import { runFakeCustomerCiLifecycleV1 } from "./lifecycle.js";
import { canonicalJson, sha256 } from "./security.js";
import { createSavedTerraformPlanTestPairV1 } from "./testing.js";

function receiptAt(
  result: CustomerCiLifecycleResultV1,
  index: number,
): CustomerCiLifecycleResultV1["receipts"][number] {
  const receipt = result.receipts[index];
  if (receipt === undefined) {
    throw new Error(`Expected lifecycle receipt at index ${String(index)}.`);
  }
  return receipt;
}

describe("fake customer-owned CI lifecycle", () => {
  it("records a deterministic revision-bound plan, deploy, smoke, and drift receipt chain", () => {
    const pair = createSavedTerraformPlanTestPairV1();
    const input = {
      approval: "approved" as const,
      drift: "clean" as const,
      expected: pair.expected,
      manifest: pair.manifest,
      smoke: "passed" as const,
    };
    const first = runFakeCustomerCiLifecycleV1(input);
    const replay = runFakeCustomerCiLifecycleV1(structuredClone(input));

    expect(first).toEqual(replay);
    expect(first.state).toBe("verified");
    expect(first.issues).toEqual([]);
    expect(
      first.receipts.map(({ stage, status }) => ({ stage, status })),
    ).toEqual([
      { stage: "plan", status: "passed" },
      { stage: "deploy", status: "passed" },
      { stage: "smoke", status: "passed" },
      { stage: "drift", status: "passed" },
    ]);
    expect(first.evidence.map(({ checks }) => checks[0]?.checkId)).toEqual([
      "cloudmarkup.customer-ci.saved-plan-integrity",
      "cloudmarkup.customer-ci.smoke-integration",
      "cloudmarkup.customer-ci.deployed-drift",
    ]);

    const [plan, deploy, smoke, drift] = first.receipts;
    expect(deploy?.predecessorReceiptDigest).toBe(sha256(canonicalJson(plan)));
    expect(smoke?.predecessorReceiptDigest).toBe(sha256(canonicalJson(deploy)));
    expect(drift?.predecessorReceiptDigest).toBe(sha256(canonicalJson(deploy)));
    expect(drift?.inputDigests).toContain(sha256(canonicalJson(smoke)));
    expect(
      first.receipts.every(
        ({ targetAuthorityDigest }) =>
          targetAuthorityDigest === pair.manifest.environmentConfigDigest,
      ),
    ).toBe(true);
    expect(
      first.receipts.every(
        ({ commitSha, environment, solutionRevision }) =>
          commitSha === pair.manifest.commitSha &&
          environment === pair.manifest.environment &&
          solutionRevision.id === pair.manifest.solutionRevision.id &&
          solutionRevision.digest === pair.manifest.solutionRevision.digest,
      ),
    ).toBe(true);
  });

  it("reports failed Evidence and blocks deployment when plan integrity is tampered", () => {
    const pair = createSavedTerraformPlanTestPairV1();
    const manifest = structuredClone(pair.manifest);
    manifest.planChecksum = sha256("tampered-saved-plan");

    const result = runFakeCustomerCiLifecycleV1({
      approval: "approved",
      drift: "clean",
      expected: pair.expected,
      manifest,
      smoke: "passed",
    });

    expect(result.state).toBe("deployment-blocked");
    expect(result.receipts).toEqual([
      expect.objectContaining({ stage: "plan", status: "failed" }),
    ]);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.checks[0]).toMatchObject({
      checkId: "cloudmarkup.customer-ci.saved-plan-integrity",
      status: "failed",
    });
    expect(result.evidence[0]?.checks[0]?.redactedFailure).toContain(
      "bounded failure",
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SAVED_PLAN_PLAN_CHECKSUM_MISMATCH" }),
      ]),
    );
  });

  it.each(["missing", "denied"] as const)(
    "blocks exact-plan deployment when approval is %s",
    (approval) => {
      const pair = createSavedTerraformPlanTestPairV1();
      const result = runFakeCustomerCiLifecycleV1({
        approval,
        drift: "not-run",
        expected: pair.expected,
        manifest: pair.manifest,
        smoke: "not-run",
      });

      expect(result.state).toBe("deployment-blocked");
      expect(result.evidence).toHaveLength(1);
      expect(
        result.receipts.map(({ stage, status }) => ({ stage, status })),
      ).toEqual([
        { stage: "plan", status: "passed" },
        { stage: "deploy", status: "blocked" },
      ]);
      expect(result.receipts[1]?.predecessorReceiptDigest).toBe(
        sha256(canonicalJson(result.receipts[0])),
      );
      expect(result.issues).toEqual([
        expect.objectContaining({ code: "CUSTOMER_CI_APPROVAL_REQUIRED" }),
      ]);
    },
  );

  it("records sanitized failed smoke Evidence and stops promotion", () => {
    const pair = createSavedTerraformPlanTestPairV1();
    const result = runFakeCustomerCiLifecycleV1({
      approval: "approved",
      drift: "changed",
      expected: pair.expected,
      manifest: pair.manifest,
      smoke: "failed",
    });

    expect(result.state).toBe("smoke-failed");
    expect(
      result.receipts.map(({ stage, status }) => ({ stage, status })),
    ).toEqual([
      { stage: "plan", status: "passed" },
      { stage: "deploy", status: "passed" },
      { stage: "smoke", status: "failed" },
    ]);
    expect(result.evidence.at(-1)?.checks[0]).toMatchObject({
      checkId: "cloudmarkup.customer-ci.smoke-integration",
      status: "failed",
    });
    expect(result.evidence.at(-1)?.checks[0]?.redactedFailure).toBe(
      "The customer-owned fake lifecycle reported a bounded failure; no raw response or credential data was retained.",
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CUSTOMER_CI_SMOKE_FAILED",
          severity: "warning",
        }),
      ]),
    );
    expect(result.receipts.some(({ stage }) => stage === "drift")).toBe(false);
  });

  it("records changed drift as a review issue without claiming an apply", () => {
    const pair = createSavedTerraformPlanTestPairV1();
    const result = runFakeCustomerCiLifecycleV1({
      approval: "approved",
      drift: "changed",
      expected: pair.expected,
      manifest: pair.manifest,
      smoke: "passed",
    });

    expect(result.state).toBe("verified");
    expect(result.receipts.at(-1)).toMatchObject({
      stage: "drift",
      status: "passed",
    });
    const driftCheck = result.evidence.at(-1)?.checks[0];
    expect(driftCheck).toMatchObject({
      checkId: "cloudmarkup.customer-ci.deployed-drift",
      status: "passed",
    });
    expect(driftCheck?.summary).toContain("found a change");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "CUSTOMER_CI_DRIFT_FOUND",
    });
    expect(result.issues[0]?.message).toContain("nothing was applied");
  });

  it("rejects duplicate identities and impossible stage-specific receipt bindings", () => {
    const pair = createSavedTerraformPlanTestPairV1();
    const valid = runFakeCustomerCiLifecycleV1({
      approval: "approved",
      drift: "clean",
      expected: pair.expected,
      manifest: pair.manifest,
      smoke: "passed",
    });

    const duplicateReceiptId = structuredClone(valid);
    receiptAt(duplicateReceiptId, 1).receiptId = receiptAt(
      duplicateReceiptId,
      0,
    ).receiptId;
    expect(
      customerCiLifecycleResultV1Schema.safeParse(duplicateReceiptId).success,
    ).toBe(false);

    const duplicateIdempotencyKey = structuredClone(valid);
    receiptAt(duplicateIdempotencyKey, 1).idempotencyKey = receiptAt(
      duplicateIdempotencyKey,
      0,
    ).idempotencyKey;
    expect(
      customerCiLifecycleResultV1Schema.safeParse(duplicateIdempotencyKey)
        .success,
    ).toBe(false);

    const planWithPredecessor = structuredClone(valid);
    receiptAt(planWithPredecessor, 0).predecessorReceiptDigest = sha256(
      "unexpected-plan-predecessor",
    );
    expect(
      customerCiLifecycleResultV1Schema.safeParse(planWithPredecessor).success,
    ).toBe(false);

    const deployWithoutPredecessor = structuredClone(valid);
    delete receiptAt(deployWithoutPredecessor, 1).predecessorReceiptDigest;
    expect(
      customerCiLifecycleResultV1Schema.safeParse(deployWithoutPredecessor)
        .success,
    ).toBe(false);

    const devWithPromotion = structuredClone(valid);
    receiptAt(devWithPromotion, 1).promotionPredecessorReceiptDigest = sha256(
      "unexpected-dev-promotion",
    );
    expect(
      customerCiLifecycleResultV1Schema.safeParse(devWithPromotion).success,
    ).toBe(false);

    const stagingWithoutPromotion = structuredClone(valid);
    receiptAt(stagingWithoutPromotion, 1).environment = "staging";
    expect(
      customerCiLifecycleResultV1Schema.safeParse(stagingWithoutPromotion)
        .success,
    ).toBe(false);

    const smokeWithPromotion = structuredClone(valid);
    receiptAt(smokeWithPromotion, 2).promotionPredecessorSmokeReceiptDigest =
      sha256("unexpected-smoke-promotion");
    expect(
      customerCiLifecycleResultV1Schema.safeParse(smokeWithPromotion).success,
    ).toBe(false);
  });
});
