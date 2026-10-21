import { describe, expect, it } from "vitest";
import { modelHostSeedRepairRequestV2Schema } from "@cloudmarkup/schemas";
import {
  measureModelHostSeedRuntimeRequestV2,
  measureModelRuntimeRequestV1,
} from "./index.js";
import { createHostSeedRepairTestRequest } from "./host-seed-test-helpers.js";
import { digestStructuredValue, sha256Text } from "./security.js";
import { modelTestRequests } from "./test-helpers.js";
function setContent(
  request: ReturnType<typeof createHostSeedRepairTestRequest>,
  content: string,
) {
  const file = request.failedCandidates[0];
  if (!file) throw Error("Missing synthetic source");
  file.content = content;
  file.contentDigest = sha256Text(content);
  request.failedOutputDigest = digestStructuredValue(request.failedCandidates);
}
describe("explicit fixed-host V2 runtime measurements", () => {
  it("counts actual UTF-8 source and paths and retains the full two-attempt bound", () => {
    const request = createHostSeedRepairTestRequest();
    const content = 'export const message = "café ☁️";\n';
    setContent(request, content);
    const before = structuredClone(request);
    const measured = measureModelHostSeedRuntimeRequestV2(request);
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
        digestStructuredValue(request.boundary),
        digestStructuredValue(request.hostSeed),
      ].sort(),
    );
    expect(measured).not.toHaveProperty("evidenceDigest");
    expect(measured.requested).not.toHaveProperty("promptBytes");
    expect(measured.requested).not.toHaveProperty("outputBytes");
    expect(measured.requested).not.toHaveProperty("outputTokens");
    expect(
      measureModelHostSeedRuntimeRequestV2(structuredClone(request)),
    ).toEqual(measured);
    expect(request).toEqual(before);
  });
  it("keeps V1 and V2 requests in separate entry points", () => {
    const request = createHostSeedRepairTestRequest();
    expect(() => measureModelRuntimeRequestV1(request)).toThrow();
    const legacy = modelTestRequests().find(
      (value) => value.operation === "candidate.repair",
    );
    expect(legacy).toBeDefined();
    expect(() => measureModelHostSeedRuntimeRequestV2(legacy)).toThrow();
  });
  it.each([
    "caller-counts",
    "context",
    "attempt",
    "repair-limit",
    "second-file",
    "ownership",
    "checksum",
  ] as const)(
    "rejects %s without clamping or trusting claimed bounds",
    (kind) => {
      const request = createHostSeedRepairTestRequest();
      if (kind === "caller-counts")
        Object.assign(request, { requested: { repositoryBytes: 0 } });
      if (kind === "context") Object.assign(request, { generationContext: {} });
      if (kind === "attempt") Object.assign(request, { currentAttempt: 2 });
      if (kind === "repair-limit")
        Object.assign(request, { maximumRepairAttempts: 3 });
      const first = request.failedCandidates[0];
      if (!first) throw Error("Missing synthetic source");
      if (kind === "second-file")
        request.failedCandidates.push({ ...first, path: "src/another.ts" });
      if (kind === "ownership")
        Object.assign(first, { ownership: "ai-generated-candidate" });
      if (kind === "checksum")
        first.contentDigest = sha256Text("different bytes");
      request.failedOutputDigest = digestStructuredValue(
        request.failedCandidates,
      );
      expect(() => measureModelHostSeedRuntimeRequestV2(request)).toThrow();
    },
  );
  it("rejects secret-bearing content even with coherent hashes and valid schema", () => {
    const request = createHostSeedRepairTestRequest();
    setContent(
      request,
      ["aws_secret_access_key", "=", "synthetic-sensitive-value"].join(""),
    );
    expect(modelHostSeedRepairRequestV2Schema.safeParse(request).success).toBe(
      true,
    );
    expect(() => measureModelHostSeedRuntimeRequestV2(request)).toThrow();
  });
});
