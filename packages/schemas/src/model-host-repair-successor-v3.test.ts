import { describe, expect, it } from "vitest";
import { digestCanonicalValue, sha256Text } from "./canonical-digest.js";
import { firstHostSeedRepairRequestFixture } from "./model-host-repair-request-test-helpers.js";
import { modelHostSeedRepairRequestV2Schema } from "./model-host-seed-repair-v2.js";
import { modelGatewayRequestV1Schema } from "./model-gateway-v1.js";
import { modelHostRepairSuccessorRequestV3Schema } from "./model-host-repair-successor-v3.js";
function fixture() {
  const first = firstHostSeedRepairRequestFixture();
  const original = first.failedCandidates[0];
  if (!original) throw Error("Missing synthetic source.");
  const content = original.content + "// actual synthetic prior repair\n";
  const file = {
    ...original,
    content,
    contentDigest: sha256Text(content),
    ownership: "user-owned-preserved",
    sourceAuthority: "unaccepted-model-repair",
  };
  return {
    ...first,
    contractVersion: 3,
    currentAttempt: 2,
    failedCandidates: [file],
    failedCandidatesCanonicalization:
      "cloudmarkup.model-host-repair-successor-files.canonical-json.v3",
    failedOutputDigest: digestCanonicalValue([file]),
    predecessor: {
      stageId: "live_stage_" + "1".repeat(32),
      invocationId: "invocation_" + "2".repeat(32),
      inputDigest: digestCanonicalValue("first-input"),
      responseDigest: digestCanonicalValue("first-response"),
      sourceTreeDigest: digestCanonicalValue("first-source-tree"),
      contentDigest: file.contentDigest,
      validationReceiptDigest: digestCanonicalValue("first-validation"),
      outcomeDigest: digestCanonicalValue("first-outcome"),
    },
  };
}
function file(v: ReturnType<typeof fixture>) {
  const f = v.failedCandidates[0];
  if (!f) throw Error("fixture");
  return f;
}
describe("explicit final repair successor input", () => {
  it("retains the original owned seed and distinct prior-model references", () => {
    const v = fixture();
    expect(modelHostRepairSuccessorRequestV3Schema.parse(v)).toEqual(v);
    expect(v.hostSeed).toEqual(firstHostSeedRepairRequestFixture().hostSeed);
    expect(v.predecessor.sourceTreeDigest).not.toBe(
      v.hostSeed.sourceTreeDigest,
    );
  });
  it("keeps history and the new channel mutually separate", () => {
    expect(
      modelHostRepairSuccessorRequestV3Schema.safeParse(
        firstHostSeedRepairRequestFixture(),
      ).success,
    ).toBe(false);
    for (const value of [
      fixture(),
      { ...fixture(), contractVersion: 2 },
      { ...fixture(), contractVersion: 1 },
    ]) {
      expect(modelHostSeedRepairRequestV2Schema.safeParse(value).success).toBe(
        false,
      );
      expect(modelGatewayRequestV1Schema.safeParse(value).success).toBe(false);
    }
  });
  it("does not treat coherent metadata references as issued authority", () => {
    const v = fixture();
    v.predecessor.outcomeDigest = digestCanonicalValue(
      "other-unissued-reference",
    );
    expect(modelHostRepairSuccessorRequestV3Schema.parse(v)).toEqual(v);
    expect(JSON.stringify(v)).not.toMatch(
      /issuanceVerified|currentAuthorityVerified/,
    );
  });
  const changes: readonly [string, (v: ReturnType<typeof fixture>) => void][] =
    [
      [
        "changed bytes",
        (v) => {
          file(v).content += "changed";
        },
      ],
      [
        "changed source digest",
        (v) => {
          file(v).contentDigest = digestCanonicalValue("changed");
        },
      ],
      [
        "changed predecessor digest",
        (v) => {
          v.predecessor.contentDigest = digestCanonicalValue("changed");
        },
      ],
      [
        "changed canonical files",
        (v) => {
          v.failedOutputDigest = digestCanonicalValue("changed");
        },
      ],
      [
        "host source relabel",
        (v) => {
          file(v).sourceAuthority = "fixed-host-synthetic";
        },
      ],
      [
        "accepted ownership relabel",
        (v) => {
          file(v).ownership = "user-owned";
        },
      ],
      [
        "AI ownership relabel",
        (v) => {
          file(v).ownership = "ai-authored-candidate";
        },
      ],
      [
        "first attempt",
        (v) => {
          v.currentAttempt = 1;
        },
      ],
      [
        "third attempt",
        (v) => {
          v.currentAttempt = 3;
        },
      ],
      [
        "expanded budget",
        (v) => {
          v.maximumRepairAttempts = 3;
        },
      ],
      [
        "missing file",
        (v) => {
          v.failedCandidates = [];
        },
      ],
      [
        "extra file",
        (v) => {
          v.failedCandidates.push({ ...file(v) });
        },
      ],
      [
        "extra path",
        (v) => {
          v.boundary.ownedPaths.push("other.ts");
        },
      ],
      [
        "changed path",
        (v) => {
          v.boundary.ownedPaths[0] = "other.ts";
        },
      ],
      [
        "missing diagnostics",
        (v) => {
          v.diagnostics = [];
        },
      ],
      [
        "duplicate diagnostics",
        (v) => {
          const d = v.diagnostics[0];
          if (!d) throw Error("fixture");
          v.diagnostics.push({ ...d });
        },
      ],
      [
        "other diagnostic file",
        (v) => {
          const d = v.diagnostics[0];
          if (!d) throw Error("fixture");
          d.path = "other.ts";
        },
      ],
      [
        "other diagnostic candidate",
        (v) => {
          const d = v.diagnostics[0];
          if (!d) throw Error("fixture");
          d.candidateId = "other";
        },
      ],
      [
        "invalid prior stage",
        (v) => {
          v.predecessor.stageId = "live_stage_invalid";
        },
      ],
      [
        "invalid prior invocation",
        (v) => {
          v.predecessor.invocationId = "invocation_invalid";
        },
      ],
    ];
  it.each(changes)("rejects %s", (_name, change) => {
    const v = fixture();
    change(v);
    expect(modelHostRepairSuccessorRequestV3Schema.safeParse(v).success).toBe(
      false,
    );
  });
  it("rejects unknown authority or persisted-content fields", () => {
    for (const v of [
      { ...fixture(), issuanceVerified: true },
      {
        ...fixture(),
        predecessor: { ...fixture().predecessor, content: "must-not-persist" },
      },
    ])
      expect(modelHostRepairSuccessorRequestV3Schema.safeParse(v).success).toBe(
        false,
      );
  });
});
