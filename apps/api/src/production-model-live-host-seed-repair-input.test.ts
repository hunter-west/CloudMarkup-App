import { describe, expect, it } from "vitest";
import {
  digestCanonicalValue,
  modelGatewayRequestV1Schema,
} from "@cloudmarkup/schemas";
import { seedValidationReceiptFixture as fixture } from "./production-model-live-seed-validation-test-helpers.js";
import {
  identifyModelLiveSeedValidationReceipt,
  type ModelLiveSeedValidationReceiptV1,
} from "./adapters/persistence/model-live-seed-validation-codec.js";

function reidentify(receipt: ModelLiveSeedValidationReceiptV1) {
  const { receiptId, receiptDigest, ...body } = receipt;
  const next = identifyModelLiveSeedValidationReceipt(body);
  expect(next.receiptId).not.toBe(receiptId);
  expect(next.receiptDigest).not.toBe(receiptDigest);
  return next;
}
// Fake native sessions and synthetic receipt metadata prove composition only.
// No database issuer or model is involved in these tests.
describe("private host-owned first repair bytes", () => {
  it("prepares exact fixed bytes only after admission and keeps the payload outside V1 dispatch", async () => {
    const f = await fixture();
    const prepared = await f.host.prepareRepairInput(f.receipt, "guided");
    expect(f.events).toEqual(["preflight"]);
    expect(prepared.authority).toBe("unissued-repair-input");
    expect(prepared.inputDigest).toBe(digestCanonicalValue(prepared.request));
    expect(prepared.receiptDigest).toBe(f.receipt.receiptDigest);
    expect(prepared.request.failedCandidates[0]?.contentDigest).toBe(
      f.receipt.bindings.extensionContentDigest,
    );
    expect(prepared.request.failedCandidates[0]?.content).toContain(
      'repairSeedTypeWitness: number = "invalid"',
    );
    expect(prepared.request.failedCandidates[0]?.ownership).toBe("user-owned");
    expect(prepared.request.hostSeed.sourceTreeDigest).toBe(
      f.receipt.bindings.sourceTreeDigest,
    );
    expect(prepared.request.diagnostics).toEqual([
      expect.objectContaining({
        toolId: "compiler.typescript",
        toolVersion: "6.0.3",
        message: "The fixed TypeScript checker observed TS2322 in this file.",
      }),
    ]);
    expect(
      modelGatewayRequestV1Schema.safeParse(prepared.request).success,
    ).toBe(false);
    const repeated = await f.host.prepareRepairInput(f.receipt, "guided");
    expect(repeated).toEqual(prepared);
  });
  it.each([
    "configurationDigest",
    "ownershipDigest",
    "profileDigest",
    "toolchainDigest",
    "builderDigest",
    "scannerDigest",
    "caseDigest",
    "frozenInputDigest",
    "datasetDigest",
  ] as const)("rejects coherently rehashed %s substitution", async (key) => {
    const f = await fixture();
    f.receipt[key] = digestCanonicalValue({ changed: key });
    await expect(
      f.host.prepareRepairInput(reidentify(f.receipt), "guided"),
    ).rejects.toThrow("fixed seed validation observation");
  });
  it.each([
    "recipeDigest",
    "sourceTreeDigest",
    "extensionContentDigest",
    "requestDigest",
  ] as const)(
    "rejects substituted %s even with a new receipt identity",
    async (key) => {
      const f = await fixture();
      f.receipt.bindings[key] = digestCanonicalValue({ changed: key });
      await expect(
        f.host.prepareRepairInput(reidentify(f.receipt), "guided"),
      ).rejects.toThrow();
    },
  );
  it("denies failed or canceled RAM admission before returning any content", async () => {
    const f = await fixture();
    f.assertHostIsolation.mockRejectedValueOnce(
      Error("Synthetic admission failure"),
    );
    await expect(
      f.host.prepareRepairInput(f.receipt, "guided"),
    ).rejects.toThrow();
    f.controller.abort();
    f.events.splice(0);
    await expect(
      f.host.prepareRepairInput(f.receipt, "guided", f.controller.signal),
    ).rejects.toThrow();
    expect(f.events).toEqual([]);
  });
  it("checks cancellation after admission and copies caller metadata before awaiting", async () => {
    const f = await fixture();
    const original = structuredClone(f.receipt);
    f.assertHostIsolation.mockImplementationOnce(() => {
      f.receipt.bindings.sourceTreeDigest =
        digestCanonicalValue("caller mutation");
      return Promise.resolve();
    });
    const prepared = await f.host.prepareRepairInput(f.receipt, "guided");
    expect(prepared.request.hostSeed.sourceTreeDigest).toBe(
      original.bindings.sourceTreeDigest,
    );
    f.assertHostIsolation.mockImplementationOnce(() => {
      f.controller.abort();
      return Promise.resolve();
    });
    await expect(
      f.host.prepareRepairInput(original, "guided", f.controller.signal),
    ).rejects.toThrow();
  });
  it("rejects caller content or unknown mode before source admission", async () => {
    const f = await fixture();
    await expect(
      f.host.prepareRepairInput(
        { ...f.receipt, source: "caller bytes" },
        "guided",
      ),
    ).rejects.toThrow();
    await expect(
      f.host.prepareRepairInput(f.receipt, "unknown"),
    ).rejects.toThrow();
    expect(f.events).toEqual([]);
  });
});
