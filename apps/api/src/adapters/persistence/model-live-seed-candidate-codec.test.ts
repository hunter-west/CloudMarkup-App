import { describe, expect, it } from "vitest";
import { digestCanonicalValue as digest } from "@cloudmarkup/schemas";
import { firstSeedCandidateObservationFixture as fixture } from "./model-live-seed-candidate-test-helpers.js";
import {
  prepareFirstSeedCandidateOutcomeV4,
  modelLiveSeedCandidateReceiptV1Schema,
  projectFirstSeedCandidateOutcomeV4,
} from "./model-live-seed-candidate-codec.js";
describe("actual candidate observation metadata projection", () => {
  it.each(["valid", "repairable", "nonrepairable"] as const)(
    "preserves %s validation without storing source or artifacts",
    async (kind) => {
      const f = await fixture(kind),
        data = prepareFirstSeedCandidateOutcomeV4(f);
      expect(data.receipt.disposition).toBe(
        kind === "valid" ? "valid" : "invalid-" + kind,
      );
      expect(data.outcome).toMatchObject({
        status: "validated",
        candidateDigest: f.host.observation.bindings.sourceTreeDigest,
        outputDigest: f.host.candidate.responseDigest,
        validationReceiptDigest: data.receipt.receiptDigest,
        validation: {
          status: kind === "valid" ? "valid" : "invalid",
          repairable: kind === "repairable",
        },
      });
      expect(JSON.stringify(data)).not.toContain("repairSeedTypeWitness");
      expect(JSON.stringify(data)).not.toMatch(
        /bytesBase64|content"|unifiedDiff/,
      );
      expect(
        projectFirstSeedCandidateOutcomeV4(
          f.stage,
          f.attemptObservation,
          data.receipt,
        ),
      ).toEqual(data.outcome);
    },
  );
  it.each([
    "scope",
    "usage",
    "stage",
    "candidate",
    "lineage",
    "startedAt",
    "issuedAt",
  ] as const)("denies %s substitution", async (kind) => {
    const f = await fixture();
    if (kind === "scope") f.scope.userId = "foreign_principal";
    if (kind === "usage") f.usage.inputUnits = "999";
    if (kind === "stage") {
      const { inputBindingDigest, ...stageBody } = f.stage;
      void inputBindingDigest;
      stageBody.operationInputDigest = digest("foreign-input");
      f.stage = { ...stageBody, inputBindingDigest: digest(stageBody) };
    }
    if (kind === "candidate")
      f.host.candidate = {
        ...f.host.candidate,
        digest: digest("foreign-content"),
      };
    if (kind === "lineage")
      f.host.candidate = {
        ...f.host.candidate,
        responseDigest: digest("foreign-response"),
      };
    if (kind === "startedAt") f.host.startedAt = f.stage.issuedAt;
    if (kind === "issuedAt") f.issuedAt = f.usage.completedAt;
    expect(() => prepareFirstSeedCandidateOutcomeV4(f)).toThrow();
  });
  it("does not turn missing cleanup into an invalid candidate disposition", async () => {
    const observed = await fixture("cleanup");
    expect(() => prepareFirstSeedCandidateOutcomeV4(observed)).toThrow();
  });
  it("rejects altered receipt metadata and embedded content", async () => {
    const f = await fixture(),
      { receipt } = prepareFirstSeedCandidateOutcomeV4(f);
    expect(
      modelLiveSeedCandidateReceiptV1Schema.safeParse({
        ...receipt,
        disposition: "invalid-repairable",
      }).success,
    ).toBe(false);
    expect(
      modelLiveSeedCandidateReceiptV1Schema.safeParse({
        ...receipt,
        content: "forbidden",
      }).success,
    ).toBe(false);
  });
});
