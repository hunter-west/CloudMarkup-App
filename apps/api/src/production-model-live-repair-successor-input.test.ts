import { describe, expect, it } from "vitest";
import {
  digestCanonicalValue as digest,
  sha256Text,
} from "@cloudmarkup/schemas";
import { firstSeedCandidateObservationFixture } from "./adapters/persistence/model-live-seed-candidate-test-helpers.js";
import { prepareFirstSeedCandidateOutcomeV4 } from "./adapters/persistence/model-live-seed-candidate-codec.js";
import { prepareProductionRepairSuccessorInput } from "./production-model-live-repair-successor-input.js";
async function fixture(
  kind: "valid" | "repairable" | "nonrepairable" = "repairable",
) {
  const first = await firstSeedCandidateObservationFixture(kind);
  return {
    invocation: first.invocation,
    first,
    recorded: prepareFirstSeedCandidateOutcomeV4(first),
  };
}
// Real deterministic parsing/materialization with synthetic model/native fixtures.
// This is not authenticated issuance or live model evidence.
describe("actual first-candidate successor derivation", () => {
  it("uses the actual prior model bytes and all recorded predecessor identities", async () => {
    const f = await fixture(),
      result = prepareProductionRepairSuccessorInput(f);
    expect(result.authority).toBe("ram-only-unissued-repair-successor");
    expect(result.request.currentAttempt).toBe(2);
    expect(result.request.maximumRepairAttempts).toBe(2);
    expect(result.request.failedCandidates[0]?.content).toBe(
      f.first.host.candidate.content,
    );
    expect(result.request.failedCandidates[0]?.content).not.toBe(
      f.invocation.request.failedCandidates[0]?.content,
    );
    expect(result.request.failedCandidates[0]).toMatchObject({
      ownership: "user-owned-preserved",
      sourceAuthority: "unaccepted-model-repair",
    });
    expect(result.request.predecessor).toEqual({
      stageId: f.recorded.receipt.stageId,
      invocationId: f.recorded.receipt.invocationId,
      inputDigest: f.recorded.receipt.lineage.inputDigest,
      responseDigest: f.recorded.receipt.lineage.responseDigest,
      sourceTreeDigest: f.recorded.receipt.bindings.sourceTreeDigest,
      contentDigest: f.first.host.candidate.digest,
      validationReceiptDigest: f.recorded.receipt.receiptDigest,
      outcomeDigest: f.recorded.outcome.outcomeDigest,
    });
    expect(result.request.hostSeed).toEqual(f.invocation.request.hostSeed);
    expect(result.request.diagnostics).toEqual([
      expect.objectContaining({
        diagnosticId: "host_repair_successor_ts2322",
        toolId: "compiler.typescript",
        toolVersion: "6.0.3",
      }),
    ]);
    expect(result.inputDigest).toBe(digest(result.request));
    f.invocation.request.boundary.ownedPaths.push("other.ts");
    expect(result.request.boundary.ownedPaths).toHaveLength(1);
  });
  it.each(["valid", "nonrepairable"] as const)(
    "does not retry a %s first outcome",
    async (kind) => {
      const f = await fixture(kind);
      expect(() => prepareProductionRepairSuccessorInput(f)).toThrow(
        "prior repair candidate",
      );
    },
  );
  const changes: readonly [
    string,
    (f: Awaited<ReturnType<typeof fixture>>) => void,
  ][] = [
    [
      "changed candidate bytes",
      (f) => {
        f.first.host.candidate = {
          ...f.first.host.candidate,
          content: "changed",
        };
      },
    ],
    [
      "coherently rehashed candidate bytes",
      (f) => {
        f.first.host.candidate = {
          ...f.first.host.candidate,
          content: "changed",
          digest: sha256Text("changed"),
        };
      },
    ],
    [
      "rewind to original seed",
      (f) => {
        const source = f.invocation.request.failedCandidates[0];
        if (!source) throw Error("fixture");
        f.first.host.candidate = {
          ...f.first.host.candidate,
          content: source.content,
          digest: source.contentDigest,
        };
      },
    ],
    [
      "different patch",
      (f) => {
        f.first.host.candidate = {
          ...f.first.host.candidate,
          patchDigest: digest("other-patch"),
        };
      },
    ],
    [
      "different response",
      (f) => {
        f.first.host.candidate = {
          ...f.first.host.candidate,
          responseDigest: digest("other-response"),
        };
      },
    ],
    [
      "different owned path",
      (f) => {
        f.first.host.candidate = {
          ...f.first.host.candidate,
          path: "application/other.ts",
        };
      },
    ],
    [
      "different scope",
      (f) => {
        f.first.scope.userId = "foreign_principal";
      },
    ],
    [
      "different usage",
      (f) => {
        f.first.usage.outputUnits = "999";
      },
    ],
    [
      "accepted ownership relabel",
      (f) => {
        const candidate = structuredClone(f.first.host.candidate);
        Reflect.set(candidate, "ownership", "user-owned");
        f.first.host.candidate = candidate;
      },
    ],
    [
      "fixed seed provenance relabel",
      (f) => {
        const candidate = structuredClone(f.first.host.candidate);
        Reflect.set(candidate, "sourceAuthority", "fixed-host-synthetic");
        f.first.host.candidate = candidate;
      },
    ],
    [
      "different input",
      (f) => {
        f.invocation.descriptor.inputDigest = digest("other-input");
      },
    ],
    [
      "changed initial request",
      (f) => {
        f.invocation.request.hostSeed.ownershipDigest = digest("other-owner");
      },
    ],
    [
      "coherently changed initial request",
      (f) => {
        f.invocation.request.hostSeed.ownershipDigest = digest("other-owner");
        f.invocation.descriptor.inputDigest = digest({
          request: f.invocation.request,
          scope: f.invocation.descriptor.scope,
        });
      },
    ],
    [
      "changed recorded receipt",
      (f) => {
        f.recorded.receipt.providerResultDigest = digest(
          "other-provider-result",
        );
      },
    ],
    [
      "coherently changed outcome",
      (f) => {
        const { outcomeDigest: ignored, ...body } = f.recorded.outcome;
        void ignored;
        const next = { ...body, observedAt: f.first.usage.startedAt };
        f.recorded.outcome = { ...next, outcomeDigest: digest(next) };
      },
    ],
  ];
  it.each(changes)("denies %s", async (_label, change) => {
    const f = await fixture();
    change(f);
    expect(() => prepareProductionRepairSuccessorInput(f)).toThrow(
      "prior repair candidate",
    );
  });
});
