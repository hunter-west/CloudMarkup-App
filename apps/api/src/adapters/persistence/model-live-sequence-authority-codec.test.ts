import { describe, expect, it } from "vitest";
import { syntheticSequenceFixtureV3 } from "@cloudmarkup/model-gateway/testing";
import {
  digestCanonicalValue,
  utcTimestampSchema,
  modelLiveEvaluationPlanV2Schema,
} from "@cloudmarkup/schemas";
import {
  parseModelLiveSequencePlanRow,
  parseIssuedModelLiveSequencePlanRow,
  parseModelLiveSequenceSelectionRow,
} from "./model-live-sequence-authority-codec.js";
const hash = <T extends object>(value: T, key: string): T => ({
  ...value,
  [key]: digestCanonicalValue(
    Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)),
  ),
});
function fixture() {
  const f = syntheticSequenceFixtureV3();
  const p = f.plan,
    s = f.selection,
    scope = p.definition.scope;
  const planRow = {
    organization_id: scope.organizationId,
    project_id: scope.projectId,
    principal_id: scope.userId,
    operator_principal_id: p.approval.operatorUserId,
    definition_id: p.definition.definitionId,
    definition_sha256: p.definition.definitionDigest.slice(7),
    approval_sha256: p.approval.approvalDigest.slice(7),
    plan_sha256: p.planDigest.slice(7),
    plan_id: p.planId,
    plan_record: p,
    issued_at_text: p.issuedAt,
    expires_at_text: p.expiresAt,
    revoked: false,
  };
  const selectionRow = {
    organization_id: scope.organizationId,
    project_id: scope.projectId,
    principal_id: scope.userId,
    plan_sha256: p.planDigest.slice(7),
    selection_id: s.selectionId,
    selection_sha256: s.selectionDigest.slice(7),
    selection_record: s,
    issued_at_text: s.issuedAt,
  };
  return { ...f, planRow, selectionRow };
}
describe("private V3 persisted authority restoration", () => {
  it("restores exact detached object and encoded metadata without V2 execution authority", () => {
    const f = fixture(),
      plan = parseModelLiveSequencePlanRow(f.planRow, f.definition.scope);
    expect(plan).toEqual(f.plan);
    expect(plan).not.toBe(f.plan);
    expect(
      parseModelLiveSequencePlanRow(
        { ...f.planRow, plan_record: JSON.stringify(f.plan) },
        f.definition.scope,
      ),
    ).toEqual(f.plan);
    expect(
      parseModelLiveSequenceSelectionRow(
        { ...f.selectionRow, selection_record: JSON.stringify(f.selection) },
        plan,
      ),
    ).toEqual(f.selection);
    expect(modelLiveEvaluationPlanV2Schema.safeParse(plan).success).toBe(false);
  });
  it.each([
    "organization_id",
    "project_id",
    "principal_id",
    "operator_principal_id",
    "definition_id",
    "definition_sha256",
    "approval_sha256",
    "plan_sha256",
    "plan_id",
  ])("rejects substituted plan column %s", (key) => {
    const f = fixture();
    expect(() =>
      parseModelLiveSequencePlanRow(
        { ...f.planRow, [key]: "foreign" },
        f.definition.scope,
      ),
    ).toThrow();
  });
  it.each(["issued_at_text", "expires_at_text"])(
    "rejects substituted plan time %s",
    (key) => {
      const f = fixture();
      expect(() =>
        parseModelLiveSequencePlanRow(
          { ...f.planRow, [key]: "2020-01-01T00:00:00.000Z" },
          f.definition.scope,
        ),
      ).toThrow();
    },
  );
  it("rejects revoked, extra-content and oversized plan records", () => {
    const f = fixture();
    expect(() =>
      parseModelLiveSequencePlanRow(
        { ...f.planRow, revoked: true },
        f.definition.scope,
      ),
    ).toThrow();
    expect(() =>
      parseModelLiveSequencePlanRow(
        {
          ...f.planRow,
          plan_record: { ...f.plan, prompt: "synthetic forbidden content" },
        },
        f.definition.scope,
      ),
    ).toThrow();
    expect(() =>
      parseModelLiveSequencePlanRow(
        { ...f.planRow, plan_record: " ".repeat(49 * 1024) },
        f.definition.scope,
      ),
    ).toThrow();
  });
  it("restores revoked metadata explicitly without changing the current reader", () => {
    const f = fixture(),
      row = { ...f.planRow, revoked: true };
    expect(
      parseIssuedModelLiveSequencePlanRow(row, f.definition.scope),
    ).toEqual({ plan: f.plan, revoked: true });
    expect(() =>
      parseModelLiveSequencePlanRow(row, f.definition.scope),
    ).toThrow();
    for (const key of [
      "organization_id",
      "project_id",
      "principal_id",
      "operator_principal_id",
      "plan_sha256",
      "approval_sha256",
      "issued_at_text",
    ]) {
      expect(() =>
        parseIssuedModelLiveSequencePlanRow(
          { ...row, [key]: "substituted" },
          f.definition.scope,
        ),
      ).toThrow();
    }
    for (const revoked of [undefined, null, "false", 0])
      expect(() =>
        parseIssuedModelLiveSequencePlanRow(
          { ...row, revoked },
          f.definition.scope,
        ),
      ).toThrow();
  });
  it("rejects a coherently rehashed original-operator substitution", () => {
    const f = fixture(),
      approval = hash(
        { ...f.plan.approval, operatorUserId: "principal_foreign" },
        "approvalDigest",
      ),
      plan = hash({ ...f.plan, approval }, "planDigest");
    expect(() =>
      parseModelLiveSequencePlanRow(
        {
          ...f.planRow,
          plan_record: plan,
          approval_sha256: approval.approvalDigest.slice(7),
          plan_sha256: plan.planDigest.slice(7),
        },
        f.definition.scope,
      ),
    ).toThrow();
  });
  it.each([
    "organization_id",
    "project_id",
    "principal_id",
    "plan_sha256",
    "selection_id",
    "selection_sha256",
  ])("rejects substituted selection column %s", (key) => {
    const f = fixture();
    expect(() =>
      parseModelLiveSequenceSelectionRow(
        { ...f.selectionRow, [key]: "foreign" },
        f.plan,
      ),
    ).toThrow();
  });
  it.each([
    "scope",
    "approval",
    "definition",
    "order",
    "missing-case",
    "before-plan",
    "at-expiry",
  ])("rejects coherent selection %s substitution", (kind) => {
    const f = fixture(),
      record = structuredClone(f.selection);
    if (kind === "scope") record.scope.organizationId = "org_foreign";
    if (kind === "approval")
      record.approvalDigest = digestCanonicalValue("foreign");
    if (kind === "definition") record.definitionId = "definition_foreign";
    if (kind === "order")
      record.stages = [...record.stages.slice(2), ...record.stages.slice(0, 2)];
    if (kind === "missing-case") record.stages = record.stages.slice(0, 2);
    if (kind === "before-plan")
      record.issuedAt = utcTimestampSchema.parse(
        new Date(Date.parse(f.plan.issuedAt) - 1).toISOString(),
      );
    if (kind === "at-expiry") record.issuedAt = f.plan.expiresAt;
    const altered = hash(record, "selectionDigest");
    expect(() =>
      parseModelLiveSequenceSelectionRow(
        {
          ...f.selectionRow,
          selection_record: altered,
          selection_sha256: altered.selectionDigest.slice(7),
          issued_at_text: altered.issuedAt,
        },
        f.plan,
      ),
    ).toThrow();
  });
});
