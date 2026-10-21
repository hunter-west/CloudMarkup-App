import { describe, expect, it } from "vitest";
import { seedValidationHostFixture as fixture } from "./production-model-live-seed-validation-test-helpers.js";
const caseId = "evaluation_case_repair_success_full_beta_v1";
const at = "2026-09-14T12:00:00.000Z";
// Fake sessions prove ownership, ordering and denials, never native execution.
describe("private fixed-seed validation host", () => {
  it("owns the fixed failing run and returns only unissued content-free metadata", async () => {
    const f = fixture();
    const observation = await f.host.run(caseId, at);
    expect(f.events).toEqual([
      "preflight",
      "open",
      "install",
      "lint",
      "typecheck",
      "dispose",
    ]);
    expect(observation.authority).toBe("unissued-tool-observation");
    expect(observation.caseBinding.caseId).toBe(caseId);
    expect(observation.configurationDigest).toBe(f.host.configurationDigest);
    const serialized = JSON.stringify(observation);
    expect(serialized).not.toContain("repairSeedTypeWitness");
    expect(serialized).not.toContain("Type 'string'");
    expect(serialized).not.toContain('"files"');
    expect(serialized).not.toContain('"receiptId"');
    expect(Buffer.byteLength(serialized)).toBeLessThan(8192);
  });
  it.each(["preflight", "lint", "diagnostic", "cleanup", "cancel"] as const)(
    "denies %s without issuing a successful observation",
    async (fault) => {
      const f = fixture(fault);
      await expect(f.host.run(caseId, at, f.controller.signal)).rejects.toThrow(
        "fixed seed validation observation",
      );
      if (fault === "preflight") expect(f.open).not.toHaveBeenCalled();
      else expect(f.events.at(-1)).toBe("dispose");
    },
  );
  it("rejects cancellation or unknown case selection before host admission", async () => {
    const f = fixture();
    f.controller.abort();
    await expect(f.host.run(caseId, at, f.controller.signal)).rejects.toThrow();
    await expect(f.host.run("caller-case", at)).rejects.toThrow();
    expect(f.assertHostIsolation).not.toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
  });
  it("reconstructs exact current bindings without executing tools or granting receipt authority", async () => {
    const f = fixture();
    const metadata = await f.host.inspect(caseId, at);
    expect(f.events).toEqual(["preflight"]);
    expect(metadata.authority).toBe("unissued-source-admission");
    expect(f.open).not.toHaveBeenCalled();
    const observation = await f.host.run(caseId, at);
    expect(metadata.bindings).toEqual(observation.bindings);
    expect(JSON.stringify(metadata)).not.toContain("repairSeedTypeWitness");
  });
  it("copies host pins so later external mutation cannot replace the admitted configuration", async () => {
    const f = fixture();
    const before = f.host.configurationDigest;
    f.admission.policy.container.image = "changed.example/untrusted";
    const observation = await f.host.run(caseId, at);
    expect(observation.configurationDigest).toBe(before);
  });
});
