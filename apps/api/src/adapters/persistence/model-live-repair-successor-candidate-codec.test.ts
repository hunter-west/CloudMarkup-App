import { beforeAll, describe, expect, it } from "vitest";
import { digestCanonicalValue as digest } from "@cloudmarkup/schemas";
import { finalRepairCandidateFixtureV4 } from "./model-live-repair-successor-candidate-test-helpers.js";
import { modelLiveSeedCandidateReceiptV1Schema } from "./model-live-seed-candidate-codec.js";
import {
  prepareFinalRepairCandidateOutcomeV4,
  projectFinalRepairCandidateOutcomeV4,
} from "./model-live-repair-successor-candidate-codec.js";
let valid: Awaited<ReturnType<typeof finalRepairCandidateFixtureV4>>;
let invalid: typeof valid;
beforeAll(async () => {
  valid = await finalRepairCandidateFixtureV4();
  invalid = await finalRepairCandidateFixtureV4(false);
}, 60_000);
describe("final candidate receipt from actual retained validation", () => {
  it.each([true, false])(
    "projects terminal native validation without another repair: %s",
    (success) => {
      const f = success ? valid : invalid;
      const r = prepareFinalRepairCandidateOutcomeV4(f);
      expect(r.receipt).toMatchObject({
        contractVersion: 2,
        disposition: success ? "valid" : "invalid-nonrepairable",
        predecessorValidationReceiptDigest: f.predecessor.receipt.receiptDigest,
      });
      expect(r.outcome).toMatchObject({
        stageKey: "repair-2",
        validation: {
          status: success ? "valid" : "invalid",
          repairable: false,
        },
      });
      expect(
        projectFinalRepairCandidateOutcomeV4(
          f.stage,
          f.attemptObservation,
          r.receipt,
          f.predecessor,
        ),
      ).toEqual(r.outcome);
      expect(
        modelLiveSeedCandidateReceiptV1Schema.safeParse(r.receipt).success,
      ).toBe(false);
      expect(JSON.stringify(r)).not.toMatch(
        /repairSeedTypeWitness|unifiedDiff|bytesBase64/,
      );
    },
  );
  it.each([
    "first-stage",
    "configuration",
    "seed",
    "candidate-base",
    "predecessor-outcome",
    "predecessor-report",
    "unknown-usage",
    "foreign-scope",
    "early-native",
    "early-issued",
    "cleanup",
  ] as const)("rejects %s", (kind) => {
    const f = structuredClone(valid);
    if (kind === "first-stage") f.stage = f.predecessor.stage;
    if (kind === "configuration")
      f.host.configurationDigest = digest("foreign config");
    if (kind === "seed") f.host.seedReceiptDigest = digest("foreign seed");
    if (kind === "candidate-base")
      Object.assign(f.host.candidate, { baseDigest: digest("wrong base") });
    if (kind === "predecessor-outcome")
      f.host.predecessorOutcomeDigest = digest("wrong outcome");
    if (kind === "predecessor-report")
      f.predecessor.receipt.reportDigest = digest("wrong report");
    if (kind === "unknown-usage") f.usage.result = "provider-error";
    if (kind === "foreign-scope") f.scope.userId = "foreign_user";
    if (kind === "early-native") f.host.startedAt = f.usage.startedAt;
    if (kind === "early-issued") f.issuedAt = f.usage.startedAt;
    if (kind === "cleanup")
      Object.assign(f.host.observation, { cleanup: "failed" });
    expect(() => prepareFinalRepairCandidateOutcomeV4(f)).toThrow();
  });
});
