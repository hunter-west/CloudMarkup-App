import { describe, expect, it } from "vitest";
import { modelHostRepairSuccessorRequestV3Schema } from "@cloudmarkup/schemas";
import {
  measureModelHostRepairSuccessorRuntimeRequestV3,
  measureModelHostSeedRuntimeRequestV2,
  measureModelRuntimeRequestV1,
} from "./model-runtime-request-measurements.js";
import { createHostSeedRepairTestRequest } from "./host-seed-test-helpers.js";
import { createHostRepairSuccessorTestRequestV3 } from "./host-repair-successor-test-helpers.js";
import { digestStructuredValue, sha256Text } from "./security.js";

function request() {
  return createHostRepairSuccessorTestRequestV3(
    createHostSeedRepairTestRequest(),
  );
}
function setContent(value: ReturnType<typeof request>, content: string) {
  const file = value.failedCandidates[0];
  if (!file) throw Error("Missing synthetic successor file");
  file.content = content;
  file.contentDigest = sha256Text(content);
  value.predecessor.contentDigest = file.contentDigest;
  value.failedOutputDigest = digestStructuredValue(value.failedCandidates);
}

describe("explicit final-repair V3 runtime measurements", () => {
  it("counts actual UTF-8 prior-model bytes while preserving original ownership and the two-call ceiling", () => {
    const value = request();
    const content = 'export const message = "café ☁️";\n';
    setContent(value, content);
    const before = structuredClone(value);
    const measured = measureModelHostRepairSuccessorRuntimeRequestV3(value);
    expect(measured.requested).toEqual({
      dependencyNames: [],
      edgeCount: 0,
      fileCount: 1,
      moduleSources: [],
      nodeCount: 0,
      providerSources: [],
      repairAttempts: 2,
      repositoryBytes: new TextEncoder().encode(content).byteLength,
      repositoryFiles: 1,
    });
    expect(measured.requested.repositoryBytes).toBeGreaterThan(content.length);
    expect(measured.sourceOwnershipBindingDigests).toEqual(
      [
        digestStructuredValue(value.boundary),
        digestStructuredValue(value.hostSeed),
      ].sort(),
    );
    expect(measured).not.toHaveProperty("evidenceDigest");
    expect(measured.requested).not.toHaveProperty("promptBytes");
    expect(
      measureModelHostRepairSuccessorRuntimeRequestV3(structuredClone(value)),
    ).toEqual(measured);
    expect(value).toEqual(before);
    setContent(value, content + "// actual additional source\n");
    expect(
      measureModelHostRepairSuccessorRuntimeRequestV3(value).requested
        .repositoryBytes,
    ).toBeGreaterThan(measured.requested.repositoryBytes);
  });

  it("rejects first-seed input and preserves historical readers' version separation", () => {
    const value = request();
    expect(() =>
      measureModelHostRepairSuccessorRuntimeRequestV3(
        createHostSeedRepairTestRequest(),
      ),
    ).toThrow();
    expect(() => measureModelHostSeedRuntimeRequestV2(value)).toThrow();
    expect(() => measureModelRuntimeRequestV1(value)).toThrow();
  });

  it.each([
    "caller-counts",
    "attempt",
    "repair-limit",
    "ownership",
    "predecessor",
    "checksum",
    "second-file",
  ] as const)(
    "rejects %s instead of manufacturing resource or source authority",
    (kind) => {
      const value = request();
      const file = value.failedCandidates[0];
      if (!file) throw Error("Missing synthetic successor file");
      if (kind === "caller-counts")
        Object.assign(value, { requested: { repositoryBytes: 0 } });
      if (kind === "attempt") Object.assign(value, { currentAttempt: 3 });
      if (kind === "repair-limit")
        Object.assign(value, { maximumRepairAttempts: 3 });
      if (kind === "ownership")
        Object.assign(file, { sourceAuthority: "fixed-host-seed" });
      if (kind === "predecessor")
        value.predecessor.contentDigest = sha256Text("other source");
      if (kind === "checksum") file.contentDigest = sha256Text("other source");
      if (kind === "second-file")
        value.failedCandidates.push({ ...file, path: "src/second.ts" });
      value.failedOutputDigest = digestStructuredValue(value.failedCandidates);
      expect(() =>
        measureModelHostRepairSuccessorRuntimeRequestV3(value),
      ).toThrow();
    },
  );

  it("rejects secret-bearing prior-model source even when all content bindings are coherent", () => {
    const value = request();
    setContent(
      value,
      ["aws_secret_access_key", "=", "synthetic-sensitive-value"].join(""),
    );
    expect(
      modelHostRepairSuccessorRequestV3Schema.safeParse(value).success,
    ).toBe(true);
    expect(() =>
      measureModelHostRepairSuccessorRuntimeRequestV3(value),
    ).toThrow();
  });
});
