import { describe, expect, it } from "vitest";
import {
  digestStructuredValue as digest,
  reviewedHostSeedPatchRepairPromptV3,
  reviewedHostBoundedRepairPromptV4,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveSequenceInputV3Schema,
  modelLiveSeedInvocationDescriptorV3Schema,
  modelInvocationDescriptorV1Schema,
  modelHostSeedRepairRequestV2Schema,
} from "@cloudmarkup/schemas";
import {
  prepareModelLiveSeedStageInputV3,
  prepareModelLiveRuntimeInputV2,
  ModelLiveRuntimeHostEvidenceError,
} from "./model-live-runtime-host-evidence-codec.js";
import { syntheticSeedStageInput as fixture } from "./model-live-seed-stage-test-helpers.js";
describe("explicit first V3 repair input preparation", () => {
  it.each([
    reviewedHostSeedPatchRepairPromptV3,
    reviewedHostBoundedRepairPromptV4,
  ])(
    "binds real source under reviewed prompt $templateId without issuing authority",
    async (prompt) => {
      const f = await fixture(undefined, prompt);
      const before = structuredClone(f);
      const prepared = prepareModelLiveSeedStageInputV3(f);
      expect(f).toEqual(before);
      expect(prepared.authority).toBe("unissued-stage-input");
      expect(prepared.invocation.descriptor.contractVersion).toBe(3);
      expect(prepared.invocation.descriptor.routing).not.toHaveProperty(
        "routingDecisionDigest",
      );
      expect(
        modelInvocationDescriptorV1Schema.safeParse(
          prepared.invocation.descriptor,
        ).success,
      ).toBe(false);
      expect(prepared.requested).toMatchObject({
        fileCount: 1,
        repositoryFiles: 1,
        repairAttempts: 2,
        outputBytes: f.invocation.maximumOutputBytes,
        outputTokens: f.invocation.maximumOutputTokens,
      });
      expect(prepared.requested.promptBytes).toBeGreaterThan(
        prepared.requested.repositoryBytes,
      );
      expect(prepared.fields).toMatchObject({
        operationInputDigest: digest({
          request: f.invocation.request,
          scope: f.scope,
        }),
        preparedPayloadDigest: digest(f.invocation),
        diagnosticsDigest: digest(f.invocation.request.diagnostics),
        predecessor: {
          kind: "seed",
          candidateDigest: f.seedReceipt.bindings.sourceTreeDigest,
          validationReceiptDigest: f.seedReceipt.receiptDigest,
        },
      });
      const issuedBody = { ...prepared.fields, issuedAt: f.observedAt };
      const parsed = modelLiveSequenceInputV3Schema.parse({
        ...issuedBody,
        inputBindingDigest: digest(issuedBody),
      });
      expect(JSON.stringify(parsed)).not.toContain("repairSeedTypeWitness");
      expect(JSON.stringify(parsed)).not.toContain('"content"');
      expect(() => {
        Reflect.apply(prepareModelLiveRuntimeInputV2, undefined, [f]);
      }).toThrow();
    },
  );
  it.each(
    (
      [
        "legacy-descriptor",
        "final-decision",
        "counted-credits",
        "configured-evaluation",
        "static-configuration",
        "cache-key",
        "changed-source",
        "unscoped",
        "wrong-user",
        "other-stage",
        "other-selection",
        "expired",
        "before-selection",
        "seed-after-plan",
        "seed-configuration",
        "seed-reference",
        "wrong-revision",
        "wrong-diagnostics",
        "old-prompt",
        "response-schema",
        "pricing-reference",
        "route",
        "capability",
        "extra-field",
        "repository-alias",
        "revision-alias",
      ] as const
    ).filter(
      (kind): boolean =>
        !["wrong-revision", "extra-field", "seed-after-plan"].includes(kind),
    ),
  )("denies %s", async (kind) => {
    const f = await fixture();
    if (kind === "legacy-descriptor")
      Object.assign(f.invocation.descriptor, { contractVersion: 1 });
    if (kind === "final-decision")
      Object.assign(f.invocation.descriptor.routing, {
        routingDecisionDigest: digest("substituted"),
      });
    if (kind === "counted-credits")
      Object.assign(f.invocation.descriptor.routing, {
        acceptedMaximumCreditUnits: 100,
      });
    if (kind === "configured-evaluation")
      Object.assign(f.invocation.descriptor.routing, {
        evaluationResultDigest: digest("substituted"),
      });
    if (kind === "static-configuration")
      Object.assign(f.invocation.descriptor.routing, {
        routingConfigurationDigest: digest("substituted"),
      });
    if (kind === "cache-key")
      Object.assign(f.invocation, { promptCacheKey: "untrusted" });
    if (kind === "changed-source") {
      const file = f.invocation.request.failedCandidates[0];
      if (!file) throw Error("Missing synthetic file");
      file.content += "// altered source\n";
      Object.assign(file, { contentDigest: "sha256:" + "1".repeat(64) });
    }
    if (kind === "unscoped")
      f.invocation.descriptor.inputDigest = digest(f.invocation.request);
    if (kind === "wrong-user")
      f.invocation.descriptor.scope.userId = "principal_other";
    if (kind === "other-stage")
      Object.assign(f.invocation.descriptor, {
        invocationId: "invocation_" + "8".repeat(32),
      });
    if (kind === "other-selection")
      Object.assign(f.selection, { planDigest: "sha256:" + "8".repeat(64) });
    if (kind === "expired") f.observedAt = f.plan.expiresAt;
    if (kind === "before-selection") f.observedAt = f.seedReceipt.issuedAt;
    if (kind === "seed-after-plan")
      Object.assign(f.seedReceipt, {
        issuedAt: new Date(Date.parse(f.plan.issuedAt) + 1).toISOString(),
      });
    if (kind === "seed-configuration")
      Object.assign(f.preparedSeed, {
        configurationDigest: "sha256:" + "8".repeat(64),
      });
    if (kind === "seed-reference")
      Object.assign(f.preparedSeed, {
        receiptDigest: "sha256:" + "8".repeat(64),
      });
    if (kind === "wrong-revision")
      Object.assign(f.invocation.request.hostSeed, {
        solutionRevisionDigest: "sha256:" + "8".repeat(64),
      });
    if (kind === "wrong-diagnostics") {
      const diagnostic = f.invocation.request.diagnostics[0];
      if (!diagnostic) throw Error("Missing synthetic diagnostic");
      diagnostic.message = "Changed diagnostic";
      f.invocation.descriptor.inputDigest = digest({
        request: f.invocation.request,
        scope: f.scope,
      });
    }
    if (kind === "old-prompt")
      Object.assign(f.invocation, {
        prompt: { ...f.invocation.prompt, version: "9.0.0" },
      });
    if (kind === "response-schema")
      Object.assign(f.invocation, {
        responseTool: { ...f.invocation.responseTool, inputSchema: {} },
      });
    const routing = f.invocation.descriptor.routing;
    if (kind === "pricing-reference")
      Object.assign(routing, { pricingVersionReference: "pricing.other" });
    if (kind === "route")
      Object.assign(routing, { routeId: "standard-design" });
    if (kind === "capability")
      Object.assign(routing, {
        capabilityRegistryDigest: "sha256:" + "8".repeat(64),
      });
    if (kind === "repository-alias" || kind === "revision-alias") {
      Object.assign(
        f.invocation.descriptor.scope,
        kind === "repository-alias"
          ? { repositorySnapshotId: "repository_snapshot_other" }
          : { solutionRevisionId: "solution_revision_other" },
      );
      Object.assign(f.scope, f.invocation.descriptor.scope);
      f.invocation.descriptor.inputDigest = digest({
        request: f.invocation.request,
        scope: f.scope,
      });
      expect(
        modelLiveSeedInvocationDescriptorV3Schema.safeParse(
          f.invocation.descriptor,
        ).success,
      ).toBe(false);
    }
    if (kind === "extra-field")
      Object.assign(f.invocation, { arbitraryContext: "not admitted" });
    expect(() => prepareModelLiveSeedStageInputV3(f)).toThrow(
      ModelLiveRuntimeHostEvidenceError,
    );
  });
  it("rejects V1 request substitution at the new entry point", async () => {
    const f = await fixture();
    expect(
      modelHostSeedRepairRequestV2Schema.safeParse({
        ...f.invocation.request,
        contractVersion: 1,
      }).success,
    ).toBe(false);
  });
  it("rejects replacing an already approved first-only prompt with the shared prompt", async () => {
    const f = await fixture();
    const prompt = reviewedHostBoundedRepairPromptV4;
    Object.assign(f.invocation, { prompt });
    Object.assign(f.invocation.descriptor, {
      promptDigest: prompt.digest,
      promptTemplateId: prompt.templateId,
      promptVersion: prompt.version,
    });
    expect(() => prepareModelLiveSeedStageInputV3(f)).toThrow(
      ModelLiveRuntimeHostEvidenceError,
    );
  });
});
