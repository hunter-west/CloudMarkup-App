import { describe, expect, it } from "vitest";
import {
  digestCanonicalValue,
  modelLiveSequenceInputV3Schema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { prepareModelLiveSeedStageInputV3 } from "./model-live-runtime-host-evidence-codec.js";
import { syntheticSeedStageInput } from "./model-live-seed-stage-test-helpers.js";
import { ModelLiveSequenceAuthorityError } from "./model-live-sequence-authority-codec.js";
import {
  parseIssuedModelLiveSeedStageInputRow,
  parseModelLiveSeedStageInputRow,
} from "./model-live-seed-stage-input-codec.js";

async function fixture() {
  const input = await syntheticSeedStageInput();
  const prepared = prepareModelLiveSeedStageInputV3(input);
  const body = { ...prepared.fields, issuedAt: input.observedAt };
  const record = modelLiveSequenceInputV3Schema.parse({
    ...body,
    inputBindingDigest: digestCanonicalValue(body),
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
  return { input, prepared, record, row };
}
describe("issued first-seed metadata recovery", () => {
  it("restores exact detached metadata after plan expiry without reconstructing source", async () => {
    const f = await fixture();
    const result = parseIssuedModelLiveSeedStageInputRow(
      { ...f.row, input_record: JSON.stringify(f.record) },
      f.prepared.plan,
      f.prepared.selection,
      f.prepared.plan.expiresAt,
    );
    expect(result).toEqual({
      record: f.record,
      configurationDigest: f.prepared.configurationDigest,
      seedConfigurationDigest: f.prepared.seedConfigurationDigest,
    });
    expect(result.record).not.toBe(f.record);
    expect(
      parseModelLiveSeedStageInputRow(f.row, f.prepared, f.input.observedAt),
    ).toEqual(f.record);
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
    const f = await fixture();
    if (key === "issued_at_text") {
      expect(
        parseIssuedModelLiveSeedStageInputRow(
          f.row,
          f.prepared.plan,
          f.prepared.selection,
          f.input.observedAt,
        ).record,
      ).toEqual(f.record);
      const issuedAt = utcTimestampSchema.parse(
        new Date(Date.parse(f.record.issuedAt) + 1).toISOString(),
      );
      expect(Date.parse(issuedAt)).toBeLessThan(
        Date.parse(f.prepared.plan.expiresAt),
      );
      expect(() =>
        parseIssuedModelLiveSeedStageInputRow(
          { ...f.row, issued_at_text: issuedAt },
          f.prepared.plan,
          f.prepared.selection,
          f.input.observedAt,
        ),
      ).toThrow(ModelLiveSequenceAuthorityError);
      return;
    }
    expect(() =>
      parseIssuedModelLiveSeedStageInputRow(
        { ...f.row, [key]: "substituted" },
        f.prepared.plan,
        f.prepared.selection,
        f.input.observedAt,
      ),
    ).toThrow();
  });
  it.each(["configurationDigest", "seedConfigurationDigest"] as const)(
    "current input matching rejects a different %s",
    async (key) => {
      const f = await fixture();
      expect(() =>
        parseModelLiveSeedStageInputRow(
          f.row,
          { ...f.prepared, [key]: digestCanonicalValue("changed") },
          f.input.observedAt,
        ),
      ).toThrow();
    },
  );
  it("rejects rehashed predecessor substitution, forbidden content, and future issuance", async () => {
    const f = await fixture();
    const { inputBindingDigest: ignored, ...body } = f.record;
    void ignored;
    const changed = {
      ...body,
      predecessor: {
        ...body.predecessor,
        validationReceiptDigest: digestCanonicalValue("foreign receipt"),
      },
    };
    const record = modelLiveSequenceInputV3Schema.parse({
      ...changed,
      inputBindingDigest: digestCanonicalValue(changed),
    });
    expect(() =>
      parseIssuedModelLiveSeedStageInputRow(
        {
          ...f.row,
          input_record: record,
          input_sha256: record.inputBindingDigest.slice(7),
        },
        f.prepared.plan,
        f.prepared.selection,
        f.input.observedAt,
      ),
    ).toThrow();
    expect(() =>
      parseIssuedModelLiveSeedStageInputRow(
        {
          ...f.row,
          input_record: { ...f.record, content: "synthetic forbidden source" },
        },
        f.prepared.plan,
        f.prepared.selection,
        f.input.observedAt,
      ),
    ).toThrow();
    expect(() =>
      parseIssuedModelLiveSeedStageInputRow(
        f.row,
        f.prepared.plan,
        f.prepared.selection,
        new Date(Date.parse(f.record.issuedAt) - 1).toISOString(),
      ),
    ).toThrow();
  });
});
