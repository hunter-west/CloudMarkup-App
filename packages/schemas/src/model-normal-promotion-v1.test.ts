import { describe, expect, it } from "vitest";

import { digestCanonicalValue, sha256Text } from "./canonical-digest.js";
import { modelEvaluationCaseKindV1Values } from "./model-evaluation-v1.js";
import {
  digestModelNormalPromotionReceiptV1,
  modelNormalPromotionReceiptV1Schema,
} from "./model-normal-promotion-v1.js";

/** Synthetic metadata shape only: no report/receipt issuance or runtime use. */
function draft() {
  const tuple = {
    capabilityRegistryDigest: sha256Text("synthetic capabilities"),
    catalogDigest: sha256Text("synthetic catalog"),
    inferenceProfileId: "inference.synthetic.standard",
    modelConfigurationReference: "model.synthetic.standard",
    operation: "intent.extract",
    promptTemplateDigest: sha256Text("synthetic prompt"),
    promptTemplateId: "prompt.synthetic.intent",
    promptTemplateVersion: "1.0.0",
    responseSchemaDigest: sha256Text("synthetic response"),
    role: "low-cost-extraction-help",
    routeDefinitionDigest: sha256Text("synthetic route"),
    routeRegistryDigest: sha256Text("synthetic routes"),
  };
  return {
    authorityBinding: {
      authorityTuple: tuple,
      authorityTupleDigest: digestCanonicalValue(tuple),
    },
    contractVersion: 1,
    effectiveFrom: "2026-09-07T12:00:01.000Z",
    expiresAt: "2026-09-07T12:05:00.000Z",
    issuedAt: "2026-09-07T12:00:00.000Z",
    issuerId: "issuer.synthetic.review",
    issuerVersion: "1.0.0",
    receiptId: "receipt.synthetic.unissued",
    recordKind: "model-normal-promotion-receipt",
    routeId: "standard-design",
    scope: {
      environment: "production",
      organizationId: "org.synthetic",
      projectId: "project.synthetic",
      userId: "user.synthetic",
    },
    evaluation: {
      datasetCaseDigests: modelEvaluationCaseKindV1Values.map(sha256Text),
      datasetDigest: sha256Text("synthetic dataset"),
      environment: "staging",
      evaluationPolicyDigest: sha256Text("synthetic evaluation policy"),
      evaluationPolicyId: "policy.synthetic.evaluation",
      evaluationPolicyVersion: "1.0.0",
      liveEvaluationAuthorityDigest: sha256Text(
        "unissued synthetic live metadata",
      ),
      reportDigest: sha256Text("synthetic held report"),
      reportId: "report.synthetic.held",
      resultSetDigest: sha256Text("synthetic results"),
    },
    runtimePolicy: {
      policyDigest: sha256Text("synthetic final policy"),
      policyId: "policy.synthetic.normal",
      policyVersion: "1.0.0",
      runtimeControlConfigurationDigest: sha256Text("synthetic configuration"),
    },
  };
}
const envelope = (metadata: Record<string, unknown>) => ({
  ...metadata,
  authorityDigest: digestCanonicalValue(metadata),
});

describe("proposed normal promotion receipt metadata", () => {
  it("roundtrips exact closed metadata and canonical digest without granting authority", () => {
    const metadata = draft();
    const input = {
      ...metadata,
      authorityDigest: digestCanonicalValue(metadata),
    };
    const parsed = modelNormalPromotionReceiptV1Schema.parse(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.evaluation.datasetCaseDigests).not.toBe(
      input.evaluation.datasetCaseDigests,
    );
    const { authorityDigest, ...withoutDigest } = parsed;
    expect(digestModelNormalPromotionReceiptV1(withoutDigest)).toBe(
      authorityDigest,
    );
    expect(
      modelNormalPromotionReceiptV1Schema.parse(
        JSON.parse(JSON.stringify(input)),
      ),
    ).toEqual(parsed);
    expect(Object.keys(parsed)).not.toContain("capabilityActivated");
  });
  it.each([
    "prompt",
    "candidate",
    "token",
    "approved",
    "revoked",
    "capabilityActivated",
    "authorization",
  ])("rejects extra %s even when the content hash is recomputed", (field) => {
    const metadata = { ...draft(), [field]: "untrusted" };
    const parsed = modelNormalPromotionReceiptV1Schema.safeParse(
      envelope(metadata),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unrecognized_keys",
            path: [],
            keys: [field],
          }),
        ]),
      );
    }
  });
  it.each([
    { contractVersion: 2 },
    { routeId: "deep-design" },
    { expiresAt: "2026-09-07T12:00:01.000Z" },
    { effectiveFrom: "2026-09-07T11:59:59.000Z" },
  ])("rejects invalid identity/version/time %#", (change) => {
    expect(
      modelNormalPromotionReceiptV1Schema.safeParse(
        envelope({ ...draft(), ...change }),
      ).success,
    ).toBe(false);
  });
  it("preserves the full21-case binding and rejects duplicates, omissions and extra nested fields", () => {
    const metadata = draft();
    for (const evaluation of [
      {
        ...metadata.evaluation,
        datasetCaseDigests: metadata.evaluation.datasetCaseDigests.slice(1),
      },
      {
        ...metadata.evaluation,
        datasetCaseDigests: Array.from({ length: 21 }, () =>
          sha256Text("same case"),
        ),
      },
      {
        ...metadata.evaluation,
        activationRecommendation: "eligible-for-reviewed-beta",
      },
    ]) {
      const parsed = modelNormalPromotionReceiptV1Schema.safeParse(
        envelope({ ...metadata, evaluation }),
      );
      expect(parsed.success).toBe(false);
      if (!parsed.success && "activationRecommendation" in evaluation) {
        expect(parsed.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "unrecognized_keys",
              path: ["evaluation"],
              keys: ["activationRecommendation"],
            }),
          ]),
        );
      }
    }
  });
  it("rejects changed content or tuple digest and unsupported operation/role", () => {
    const metadata = draft();
    expect(
      modelNormalPromotionReceiptV1Schema.safeParse({
        ...envelope(metadata),
        issuerId: "issuer.changed",
      }).success,
    ).toBe(false);
    for (const tuple of [
      {
        ...metadata.authorityBinding.authorityTuple,
        operation: "operations.propose",
      },
      {
        ...metadata.authorityBinding.authorityTuple,
        role: "repair-escalation",
      },
    ])
      expect(
        modelNormalPromotionReceiptV1Schema.safeParse(
          envelope({
            ...metadata,
            authorityBinding: {
              authorityTuple: tuple,
              authorityTupleDigest: digestCanonicalValue(tuple),
            },
          }),
        ).success,
      ).toBe(false);
    expect(
      modelNormalPromotionReceiptV1Schema.safeParse(
        envelope({
          ...metadata,
          authorityBinding: {
            ...metadata.authorityBinding,
            authorityTupleDigest: sha256Text("changed"),
          },
        }),
      ).success,
    ).toBe(false);
  });
});
