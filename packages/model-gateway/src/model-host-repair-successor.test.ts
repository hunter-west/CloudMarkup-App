import { reviewedHostSeedPatchRepairPromptV3 } from "./prompts/host-seed-patch-repair.js";
import { reviewedHostBoundedRepairPromptV4 } from "./prompts/host-bounded-repair.js";
import { describe, expect, it } from "vitest";
import {
  modelLiveSeedInvocationDescriptorV3Schema,
  modelHostSeedRepairRequestV2Schema,
} from "@cloudmarkup/schemas";
import { createHostSeedPatchResponseFixtureV2 } from "./host-seed-response-test-helpers.js";
import { createHostRepairSuccessorResponseFixtureV4 as fixture } from "./host-repair-successor-test-helpers.js";
import { parseHostRepairSuccessorInvocationV4 } from "./host-repair-successor-binding.js";
import {
  digestStructuredValue,
  parseModelHostRepairSuccessorPatchResponseV4,
  parseModelHostSeedPatchResponseV2,
  serializedByteLength,
  sha256Text,
} from "./security.js";
import { getModelResponseToolV1 } from "./tools.js";

describe("distinct final repair transport and response", () => {
  it("preserves actual candidate lineage, original seed and a distinct invocation", () => {
    const f = fixture();
    expect(parseHostRepairSuccessorInvocationV4(f.invocation)).toEqual(
      f.invocation,
    );
    expect(parseModelHostRepairSuccessorPatchResponseV4(f.input)).toEqual(
      f.response,
    );
    expect(f.input.request.hostSeed).toEqual(f.first.input.request.hostSeed);
    expect(f.patch.baseDigest).not.toBe(f.first.source.contentDigest);
    expect(
      modelLiveSeedInvocationDescriptorV3Schema.safeParse(f.input.descriptor)
        .success,
    ).toBe(false);
    expect(
      modelHostSeedRepairRequestV2Schema.safeParse(f.input.request).success,
    ).toBe(false);
    expect(() => {
      Reflect.apply(parseModelHostSeedPatchResponseV2, undefined, [f.input]);
    }).toThrow();
    expect(
      () =>
        void Reflect.apply(
          parseModelHostRepairSuccessorPatchResponseV4,
          undefined,
          [f.first.input],
        ),
    ).toThrow();
  });

  it.each([
    "cache",
    "prompt",
    "tool",
    "content",
    "self-predecessor",
    "old-request",
    "old-descriptor",
    "predecessor",
    "policy",
    "third-attempt",
    "authority",
  ] as const)("denies %s input substitution before transport", (kind) => {
    const f = fixture();
    if (kind === "cache")
      Object.assign(f.invocation, { promptCacheKey: undefined });
    if (kind === "prompt")
      Object.assign(f.invocation, {
        prompt: reviewedHostSeedPatchRepairPromptV3,
      });
    if (kind === "tool")
      Object.assign(f.invocation, {
        responseTool: getModelResponseToolV1("candidate.repair"),
      });
    if (kind === "content") {
      const file = f.invocation.request.failedCandidates[0];
      if (file) file.content += "changed";
    }
    if (kind === "self-predecessor")
      Object.assign(f.invocation.descriptor, {
        invocationId: f.invocation.request.predecessor.invocationId,
      });
    if (kind === "old-request")
      Object.assign(f.invocation, { request: f.first.input.request });
    if (kind === "old-descriptor")
      Object.assign(f.invocation, { descriptor: f.first.input.descriptor });
    if (kind === "predecessor")
      f.invocation.request.predecessor.outcomeDigest = sha256Text("foreign");
    if (kind === "policy")
      Object.assign(f.invocation.descriptor.routing, {
        evaluationPolicyVersion: "9.0.0",
      });
    if (kind === "third-attempt")
      Object.assign(f.invocation.request, { currentAttempt: 3 });
    if (kind === "authority")
      Object.assign(f.invocation.descriptor.routing, {
        routingDecisionDigest: sha256Text("unissued"),
      });
    expect(() => parseHostRepairSuccessorInvocationV4(f.invocation)).toThrow();
  });

  it.each([
    "provenance",
    "original-base",
    "foreign-base",
    "path",
    "digest",
    "dependency",
    "tool",
    "text",
    "multiple",
    "prompt",
    "diagnostic",
    "limit",
    "predecessor",
  ] as const)("rejects %s response substitution", (kind) => {
    const f = fixture();
    if (kind === "provenance")
      f.response.provenance.inputDigest = sha256Text("foreign");
    if (kind === "original-base")
      f.patch.baseDigest = f.first.source.contentDigest;
    if (kind === "foreign-base") f.patch.baseDigest = sha256Text("foreign");
    if (kind === "path") f.patch.path = "application/foreign.ts";
    if (kind === "digest")
      Object.assign(f.patch, { proposedResultDigest: sha256Text("invented") });
    if (kind === "dependency")
      Object.assign(f.response.candidateBundle, {
        dependencies: [{ packageName: "arbitrary", version: "1" }],
      });
    if (kind === "tool")
      f.input.content.toolName =
        getModelResponseToolV1("candidate.repair").toolName;
    if (kind === "text")
      Object.assign(f.input, {
        content: { kind: "text", text: JSON.stringify(f.response) },
      });
    if (kind === "multiple")
      f.response.candidateBundle.candidates.push({ ...f.patch });
    if (kind === "prompt")
      Object.assign(f.input.descriptor, { promptVersion: "9.0.0" });
    if (kind === "diagnostic")
      Object.assign(f.response, { resolvedDiagnosticIds: ["foreign"] });
    if (kind === "limit")
      f.input.maximumOutputBytes = serializedByteLength(f.input.content) - 1;
    if (kind === "predecessor")
      f.input.request.predecessor.responseDigest = sha256Text("foreign");
    expect(() =>
      parseModelHostRepairSuccessorPatchResponseV4(f.input),
    ).toThrow();
  });

  it("treats coherent predecessor references as data, not current authority", () => {
    const f = fixture();
    f.invocation.request.predecessor.outcomeDigest =
      sha256Text("other-reference");
    f.invocation.descriptor.inputDigest = digestStructuredValue({
      request: f.invocation.request,
      scope: f.invocation.descriptor.scope,
    });
    expect(parseHostRepairSuccessorInvocationV4(f.invocation)).toEqual(
      f.invocation,
    );
    expect(JSON.stringify(f.invocation)).not.toMatch(
      /issuanceVerified|currentAuthorityVerified/,
    );
  });
  it("uses the same reviewed prompt for a separately bound first response", () => {
    const first = createHostSeedPatchResponseFixtureV2();
    const prompt = reviewedHostBoundedRepairPromptV4;
    const fields = {
      promptDigest: prompt.digest,
      promptTemplateId: prompt.templateId,
      promptVersion: prompt.version,
    };
    Object.assign(first.input.descriptor, fields);
    Object.assign(first.response.provenance, fields);
    Object.assign(first.response.candidateBundle.provenance, fields);
    first.input.maximumOutputBytes =
      serializedByteLength(first.input.content) + 1000;
    expect(parseModelHostSeedPatchResponseV2(first.input)).toEqual(
      first.response,
    );
    expect(() => {
      Reflect.apply(parseModelHostRepairSuccessorPatchResponseV4, undefined, [
        first.input,
      ]);
    }).toThrow();
  });
});
