import { fileURLToPath } from "node:url";
import { loadMigrations } from "./migrations.js";
import { describe, expect, it } from "vitest";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import { syntheticLiveEvaluationFixtureV2 } from "@cloudmarkup/model-gateway/testing";
import {
  modelLiveInvocationSetV2Schema,
  parseModelLiveInvocationSetRow,
} from "./model-live-invocation-set-codec.js";

function fixture() {
  const { plan } = syntheticLiveEvaluationFixtureV2();
  const body = {
    contractVersion: 2,
    recordKind: "model-live-invocation-set",
    issuerId: "cloudmarkup.model-live-invocation-set",
    issuerVersion: "1.0.0",
    setId: "live_set_" + "a".repeat(32),
    scope: plan.definition.scope,
    definitionId: plan.definition.definitionId,
    definitionDigest: plan.definition.definitionDigest,
    planDigest: plan.planDigest,
    approvalDigest: plan.approval.approvalDigest,
    issuedAt: plan.issuedAt,
    entries: plan.definition.cases.map((c, i) => ({
      caseId: c.caseId,
      caseDigest: c.caseDigest,
      sourceInputDigest: c.sourceInputDigest,
      authorityTupleDigest: c.authorityBinding.authorityTupleDigest,
      invocationId: "invocation_" + i.toString(16).padStart(32, "0"),
    })),
  };
  const record = { ...body, setDigest: digestCanonicalValue(body) };
  const row = {
    organization_id: body.scope.organizationId,
    project_id: body.scope.projectId,
    principal_id: body.scope.userId,
    plan_sha256: plan.planDigest.slice(7),
    set_id: body.setId,
    set_sha256: record.setDigest.slice(7),
    set_record: record,
  };
  return { plan, record, row };
}
describe("private immutable evaluation invocation set metadata", () => {
  it("loads the exact registered immutable invocation-set migration", async () => {
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    const migration = migrations.find(({ version }) => version === "0056");
    expect(migration).toMatchObject({
      file: "0056_model_live_invocation_sets.sql",
      checksumSha256:
        "6b753f02718875609a1c39b526569bb385901372ffbc6ae26c402a5ce98371a2",
    });
    expect(migration?.statements).toHaveLength(6);
    expect(migration?.statements.join("\n")).toContain(
      "CREATE TABLE model_live_invocation_sets",
    );
  });
  it("binds exact ordered plan entries without report or activation authority", () => {
    const f = fixture();
    expect(parseModelLiveInvocationSetRow(f.row, f.plan)).toEqual(f.record);
    expect(
      modelLiveInvocationSetV2Schema.parse(
        JSON.parse(JSON.stringify(f.record)),
      ),
    ).toEqual(f.record);
    expect(f.record).not.toHaveProperty("report");
    expect(f.record).not.toHaveProperty("capabilityActivated");
  });
  it.each(["prompt", "response", "approved", "report", "capabilityActivated"])(
    "rejects added %s authority/content",
    (key) => {
      expect(() =>
        modelLiveInvocationSetV2Schema.parse({
          ...fixture().record,
          [key]: true,
        }),
      ).toThrow();
    },
  );
  it.each(["caseId", "caseDigest", "invocationId"] as const)(
    "rejects duplicate %s even with a recomputed digest",
    (key) => {
      const { record } = fixture();
      const second = record.entries[1],
        first = record.entries[0];
      if (!first || !second) throw Error("Synthetic case matrix missing.");
      Object.assign(second, { [key]: first[key] });
      const body = Object.fromEntries(
        Object.entries(record).filter(([key]) => key !== "setDigest"),
      );
      expect(() =>
        modelLiveInvocationSetV2Schema.parse({
          ...body,
          setDigest: digestCanonicalValue(body),
        }),
      ).toThrow();
    },
  );
  it.each([
    "order",
    "caseDigest",
    "sourceInputDigest",
    "authorityTupleDigest",
    "scope",
    "definition",
    "approval",
    "time",
  ] as const)(
    "rejects coherent %s substitution against its issued plan",
    (kind) => {
      const f = fixture();
      const entry = f.record.entries[0];
      if (!entry) throw Error("Synthetic entry missing.");
      if (kind === "order") f.record.entries.reverse();
      else if (kind === "scope")
        f.record.scope = { ...f.record.scope, userId: "user_other" };
      else if (kind === "definition")
        f.record.definitionId = "definition_other";
      else if (kind === "approval")
        f.record.approvalDigest = digestCanonicalValue("other");
      else if (kind === "time") f.record.issuedAt = f.plan.expiresAt;
      else entry[kind] = digestCanonicalValue("other");
      const body = Object.fromEntries(
        Object.entries(f.record).filter(([key]) => key !== "setDigest"),
      );
      f.record.setDigest = digestCanonicalValue(body);
      const row = {
        ...f.row,
        set_sha256: f.record.setDigest.slice(7),
        set_record: f.record,
      };
      expect(() => parseModelLiveInvocationSetRow(row, f.plan)).toThrow();
    },
  );
  it.each([
    "organization_id",
    "project_id",
    "principal_id",
    "plan_sha256",
    "set_id",
    "set_sha256",
  ])("rejects substituted row column %s", (key) => {
    const f = fixture();
    expect(() =>
      parseModelLiveInvocationSetRow({ ...f.row, [key]: "different" }, f.plan),
    ).toThrow();
  });
});
