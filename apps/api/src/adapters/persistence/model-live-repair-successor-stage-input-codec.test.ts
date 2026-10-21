import { parseModelLiveRepairSuccessorInputRowV4 } from "./model-live-repair-successor-input-store.js";
import { ModelLiveSequenceAuthorityError } from "./model-live-sequence-authority-codec.js";
import { parseIssuedModelLiveSeedStageInputRow } from "./model-live-seed-stage-input-codec.js";
import { describe, expect, it } from "vitest";
import {
  digestStructuredValue as digest,
  reviewedHostBoundedRepairPromptV4,
  reviewedHostSeedPatchRepairPromptV3,
  type ModelProviderHostRepairSuccessorInvocationV4,
  type ReviewedPromptTemplateV1,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  modelLiveSeedInvocationDescriptorV3Schema,
  modelLiveSequenceInputV3Schema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { firstSeedCandidateObservationFixture } from "./model-live-seed-candidate-test-helpers.js";
import { prepareFirstSeedCandidateOutcomeV4 } from "./model-live-seed-candidate-codec.js";
import { prepareProductionRepairSuccessorInput } from "../../production-model-live-repair-successor-input.js";
import { prepareModelLiveRepairSuccessorStageInputV4 } from "./model-live-repair-successor-stage-input-codec.js";

async function fixture(
  prompt: ReviewedPromptTemplateV1 = reviewedHostBoundedRepairPromptV4,
) {
  const firstObservation = await firstSeedCandidateObservationFixture(
    "repairable",
    prompt,
  );
  const predecessor = {
    invocation: firstObservation.invocation,
    first: firstObservation,
    recorded: prepareFirstSeedCandidateOutcomeV4(firstObservation),
  };
  const request = prepareProductionRepairSuccessorInput(predecessor).request;
  const first = {
    ...firstObservation.source,
    observedAt: "2026-09-14T12:02:02.000Z",
  };
  const stage = first.selection.stages.find(
    (entry) => entry.caseId === first.caseId && entry.stageKey === "repair-2",
  );
  if (!stage) throw Error("Missing synthetic second stage");
  const invocation: ModelProviderHostRepairSuccessorInvocationV4 = {
    ...first.invocation,
    request,
    prompt: reviewedHostBoundedRepairPromptV4,
    descriptor: modelLiveRepairSuccessorInvocationDescriptorV4Schema.parse({
      ...first.invocation.descriptor,
      contractVersion: 4,
      recordKind: "model-live-repair-successor-invocation-descriptor",
      invocationId: stage.invocationId,
      inputDigest: digest({ request, scope: first.scope }),
      idempotencyKeyDigest: digest("synthetic-second-stage-idempotency"),
      promptDigest: reviewedHostBoundedRepairPromptV4.digest,
      promptTemplateId: reviewedHostBoundedRepairPromptV4.templateId,
      promptVersion: reviewedHostBoundedRepairPromptV4.version,
    }),
  };
  return { first, predecessor, invocation };
}

// Synthetic records exercise pure binding only, never issued/runtime authority.
describe("actual predecessor V4 final-stage input preparation", () => {
  it("preserves actual candidate lineage and measures its complete provider request without issuing authority", async () => {
    const f = await fixture();
    const before = structuredClone(f);
    const result = prepareModelLiveRepairSuccessorStageInputV4(f);
    if (f.predecessor.recorded.outcome.status !== "validated")
      throw new Error("Synthetic predecessor was not validated");
    expect(f).toEqual(before);
    expect(result.authority).toBe("unissued-stage-input");
    expect(result.invocation.descriptor.contractVersion).toBe(4);
    expect(
      modelLiveSeedInvocationDescriptorV3Schema.safeParse(
        result.invocation.descriptor,
      ).success,
    ).toBe(false);
    expect(result.fields).toMatchObject({
      stageKey: "repair-2",
      predecessor: {
        kind: "stage",
        stageId: f.predecessor.recorded.receipt.stageId,
        outputDigest: f.predecessor.recorded.outcome.outputDigest,
        outcomeDigest: f.predecessor.recorded.outcome.outcomeDigest,
        candidateDigest:
          f.predecessor.recorded.receipt.bindings.sourceTreeDigest,
        validationReceiptDigest: f.predecessor.recorded.receipt.receiptDigest,
      },
    });
    expect(result.requested.repositoryBytes).toBe(
      new TextEncoder().encode(f.predecessor.first.host.candidate.content)
        .byteLength,
    );
    expect(result.requested.promptBytes).toBeGreaterThan(
      result.requested.repositoryBytes,
    );
    expect(result.requested.repairAttempts).toBe(2);
    const fields = { ...result.fields, issuedAt: f.first.observedAt };
    expect(
      modelLiveSequenceInputV3Schema.safeParse({
        ...fields,
        inputBindingDigest: digest(fields),
      }).success,
    ).toBe(true);
    expect(result).not.toHaveProperty("evidenceDigest");
  });

  it("rejects the shared final-stage prompt under a historical first-only approval", async () => {
    const f = await fixture(reviewedHostSeedPatchRepairPromptV3);
    expect(() => prepareModelLiveRepairSuccessorStageInputV4(f)).toThrow();
  });

  it.each([
    "first-id",
    "foreign-scope",
    "seed-restart",
    "predecessor",
    "future-outcome",
    "changed-first",
    "extra-field",
    "output-limit",
  ] as const)(
    "rejects %s without relabeling it as final-stage authority",
    async (kind) => {
      const f = await fixture();
      if (kind === "first-id")
        Object.assign(f.invocation.descriptor, {
          invocationId: f.first.invocation.descriptor.invocationId,
        });
      if (kind === "foreign-scope")
        Object.assign(f.invocation.descriptor.scope, {
          organizationId: "another_org",
        });
      if (kind === "seed-restart")
        Object.assign(f.invocation, { request: f.first.invocation.request });
      if (kind === "predecessor")
        Object.assign(f.invocation.request.predecessor, {
          responseDigest: digest("another-response"),
        });
      if (kind === "future-outcome")
        f.first.observedAt = "2026-09-14T12:01:59.000Z";
      if (kind === "changed-first")
        Object.assign(f.predecessor.invocation.descriptor, {
          idempotencyKeyDigest: digest("other-first"),
        });
      if (kind === "extra-field")
        Object.assign(f.invocation, { promptCacheKey: "unreviewed" });
      if (kind === "output-limit")
        Object.assign(f.invocation, { maximumOutputTokens: 1_000_000_000 });
      // Recompute the caller-visible input hash so these cases must fail the
      // actual predecessor/scope binding, not merely a stale digest.
      Object.assign(f.invocation.descriptor, {
        inputDigest: digest({
          request: f.invocation.request,
          scope: f.invocation.descriptor.scope,
        }),
      });
      expect(() => prepareModelLiveRepairSuccessorStageInputV4(f)).toThrow();
    },
  );
});

describe("issued final repair metadata matching", () => {
  async function issuedFixture() {
    const f = await fixture();
    const prepared = prepareModelLiveRepairSuccessorStageInputV4(f);
    const body = { ...prepared.fields, issuedAt: f.first.observedAt };
    const record = modelLiveSequenceInputV3Schema.parse({
      ...body,
      inputBindingDigest: digest(body),
    });
    const row = {
      organization_id: prepared.scope.organizationId,
      project_id: prepared.scope.projectId,
      principal_id: prepared.scope.userId,
      operator_principal_id: prepared.plan.approval.operatorUserId,
      plan_sha256: record.planDigest.slice(7),
      selection_id: record.selectionId,
      stage_id: record.stageId,
      invocation_id: record.invocationId,
      input_sha256: record.inputBindingDigest.slice(7),
      model_configuration_sha256: prepared.configurationDigest.slice(7),
      seed_configuration_sha256: prepared.seedConfigurationDigest.slice(7),
      issued_at_text: record.issuedAt,
      input_record: record,
    };
    return { f, prepared, record, row };
  }
  it("restores detached metadata only while historical first-stage parsing rejects it", async () => {
    const { f, prepared, record, row } = await issuedFixture();
    const restored = parseModelLiveRepairSuccessorInputRowV4(
      row,
      prepared,
      f.first.observedAt,
    );
    expect(restored).toEqual(record);
    expect(restored).not.toBe(record);
    expect(() =>
      parseIssuedModelLiveSeedStageInputRow(
        row,
        prepared.plan,
        prepared.selection,
        f.first.observedAt,
      ),
    ).toThrow();
  });
  it.each([
    "organization_id",
    "project_id",
    "principal_id",
    "operator_principal_id",
    "plan_sha256",
    "selection_id",
    "stage_id",
    "invocation_id",
    "input_sha256",
    "model_configuration_sha256",
    "seed_configuration_sha256",
    "issued_at_text",
  ])("rejects substituted %s", async (key) => {
    const { f, prepared, row } = await issuedFixture();
    if (key === "issued_at_text") {
      const record = parseModelLiveRepairSuccessorInputRowV4(
        row,
        prepared,
        f.first.observedAt,
      );
      expect(record).toEqual(row.input_record);
      const issuedAt = utcTimestampSchema.parse(
        new Date(Date.parse(record.issuedAt) + 1).toISOString(),
      );
      expect(Date.parse(issuedAt)).toBeLessThan(
        Date.parse(prepared.plan.expiresAt),
      );
      expect(() =>
        parseModelLiveRepairSuccessorInputRowV4(
          { ...row, issued_at_text: issuedAt },
          prepared,
          f.first.observedAt,
        ),
      ).toThrow(ModelLiveSequenceAuthorityError);
      return;
    }
    expect(() =>
      parseModelLiveRepairSuccessorInputRowV4(
        { ...row, [key]: "substituted" },
        prepared,
        f.first.observedAt,
      ),
    ).toThrow();
  });
  it("rejects rehashed predecessor substitution, forbidden source, and issuance before validation", async () => {
    const { f, prepared, record, row } = await issuedFixture();
    const { inputBindingDigest, ...body } = record;
    void inputBindingDigest;
    for (const fields of [
      {
        ...body,
        predecessor: { ...body.predecessor, outcomeDigest: digest("foreign") },
      },
      {
        ...body,
        issuedAt: new Date(
          Date.parse(prepared.predecessorObservedAt) - 1,
        ).toISOString(),
      },
    ]) {
      const changed = modelLiveSequenceInputV3Schema.parse({
        ...fields,
        inputBindingDigest: digest(fields),
      });
      expect(() =>
        parseModelLiveRepairSuccessorInputRowV4(
          {
            ...row,
            input_record: changed,
            input_sha256: changed.inputBindingDigest.slice(7),
            issued_at_text: changed.issuedAt,
          },
          prepared,
          f.first.observedAt,
        ),
      ).toThrow();
    }
    expect(() =>
      parseModelLiveRepairSuccessorInputRowV4(
        { ...row, input_record: { ...record, content: "forbidden" } },
        prepared,
        f.first.observedAt,
      ),
    ).toThrow();
  });
});
