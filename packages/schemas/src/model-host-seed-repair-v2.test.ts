import { firstHostSeedRepairRequestFixture as request } from "./model-host-repair-request-test-helpers.js";
import { describe, expect, it } from "vitest";
import { digestCanonicalValue } from "./canonical-digest.js";
import {
  modelGatewayRequestV1Schema,
  modelFileCandidateV1Schema,
} from "./model-gateway-v1.js";
import { modelHostSeedRepairRequestV2Schema } from "./model-host-seed-repair-v2.js";

const digest = digestCanonicalValue({ synthetic: true });
function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw Error("Missing synthetic fixture element");
  return value;
}
describe("explicit first host-seed repair input v2", () => {
  it("preserves host provenance and owned-source meaning without asserting issuance", () => {
    const input = request();
    expect(modelHostSeedRepairRequestV2Schema.parse(input)).toEqual(input);
    expect(input.failedCandidates[0]?.ownership).toBe("user-owned");
    expect(JSON.stringify(input)).not.toContain("issuanceVerified");
  });
  it("keeps the new input outside the historical V1 gateway and model output contracts", () => {
    const input = request();
    expect(modelGatewayRequestV1Schema.safeParse(input).success).toBe(false);
    expect(
      modelGatewayRequestV1Schema.safeParse({ ...input, contractVersion: 1 })
        .success,
    ).toBe(false);
    expect(
      modelFileCandidateV1Schema.safeParse(input.failedCandidates[0]).success,
    ).toBe(false);
  });
  const changes: readonly [
    string,
    (value: ReturnType<typeof request>) => void,
  ][] = [
    [
      "content substitution",
      (v) => {
        first(v.failedCandidates).content += "changed";
      },
    ],
    [
      "file digest substitution",
      (v) => {
        first(v.failedCandidates).contentDigest = digest;
      },
    ],
    [
      "output digest substitution",
      (v) => {
        v.failedOutputDigest = digest;
      },
    ],
    [
      "additional path authority",
      (v) => {
        v.boundary.ownedPaths.push("application/other.ts");
      },
    ],
    [
      "different owned path",
      (v) => {
        v.boundary.ownedPaths[0] = "application/other.ts";
      },
    ],
    [
      "missing source",
      (v) => {
        v.failedCandidates = [];
      },
    ],
    [
      "duplicate source",
      (v) => {
        v.failedCandidates.push({ ...first(v.failedCandidates) });
      },
    ],
    [
      "model ownership substitution",
      (v) => {
        first(v.failedCandidates).ownership = "ai-authored-candidate";
      },
    ],
    [
      "source provenance substitution",
      (v) => {
        first(v.failedCandidates).sourceAuthority = "model-output";
      },
    ],
    [
      "duplicate diagnostic",
      (v) => {
        v.diagnostics.push({ ...first(v.diagnostics) });
      },
    ],
    [
      "different diagnosed file",
      (v) => {
        first(v.diagnostics).path = "application/other.ts";
      },
    ],
    [
      "different diagnosed candidate",
      (v) => {
        first(v.diagnostics).candidateId = "different";
      },
    ],
    [
      "missing diagnostics",
      (v) => {
        v.diagnostics = [];
      },
    ],
    [
      "second repair",
      (v) => {
        v.currentAttempt = 2;
      },
    ],
    [
      "changed repair budget",
      (v) => {
        v.maximumRepairAttempts = 3;
      },
    ],
    [
      "historical recipe substitution",
      (v) => {
        v.hostSeed.recipeVersion = "1.0.0";
      },
    ],
    [
      "unknown recipe",
      (v) => {
        v.hostSeed.recipeId = "cloudmarkup.arbitrary";
      },
    ],
  ];
  it.each(changes)("rejects %s", (_name, change) => {
    const input = request();
    expect(modelHostSeedRepairRequestV2Schema.safeParse(input).success).toBe(
      true,
    );
    change(input);
    if (
      [
        "content substitution",
        "file digest substitution",
        "missing source",
        "duplicate source",
        "model ownership substitution",
        "source provenance substitution",
      ].includes(_name)
    ) {
      input.failedOutputDigest = digestCanonicalValue(input.failedCandidates);
    }
    expect(modelHostSeedRepairRequestV2Schema.safeParse(input).success).toBe(
      false,
    );
  });
  it("rejects additional source, prior model context, execution or receipt assertions", () => {
    for (const extra of [
      { priorCandidateContext: {} },
      { operatorApproved: true },
      { execute: "shell" },
      { generationContextDigest: digest },
      { generationContext: {} },
      { generationContext: {}, generationContextDigest: digest },
    ])
      expect(
        modelHostSeedRepairRequestV2Schema.safeParse({ ...request(), ...extra })
          .success,
      ).toBe(false);
    expect(
      modelHostSeedRepairRequestV2Schema.safeParse({
        ...request(),
        hostSeed: { ...request().hostSeed, issuanceVerified: true },
      }).success,
    ).toBe(false);
  });
});
