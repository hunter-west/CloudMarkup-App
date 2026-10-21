import { describe, expect, it } from "vitest";
import {
  digestCanonicalValue,
  sha256Text,
  modelLiveEvaluationDefinitionV2Schema,
  modelLiveEvaluationApprovalV2Schema,
  modelLiveEvaluationPlanV2Schema,
  modelLiveRuntimeAdmissionRequestV2Schema,
  type ModelLiveEvaluationDefinitionV2,
} from "@cloudmarkup/schemas";
import { syntheticLiveEvaluationFixtureV2 } from "./model-live-evaluation-fakes.js";
import {
  ModelLiveEvaluationPlanError,
  validateModelLiveEvaluationDefinitionV2,
  validateModelLiveEvaluationRequestV2,
} from "./model-live-evaluation-plan.js";

function rehash<T extends object>(value: T, key: keyof T): T {
  const metadata = Object.fromEntries(
    Object.entries(value).filter(([name]) => name !== key),
  );
  return { ...value, [key]: digestCanonicalValue(metadata) };
}
function definitionCheck(definition: ModelLiveEvaluationDefinitionV2) {
  const f = syntheticLiveEvaluationFixtureV2();
  return validateModelLiveEvaluationDefinitionV2({
    definition,
    dataset: f.dataset,
    expectedPolicy: f.policy,
  });
}
describe("scoped report-free live evaluation plans", () => {
  it("constructs the entire frozen case matrix and verifies it against frozen source", () => {
    const f = syntheticLiveEvaluationFixtureV2();
    expect(definitionCheck(f.definition)).toEqual(f.definition);
    expect(f.definition.cases).toHaveLength(f.dataset.cases.length);
    expect(f.definition).not.toHaveProperty("report");
    expect(f.approval).not.toHaveProperty("approved");
    expect(f.plan).not.toHaveProperty("capabilityActivated");
    expect(
      validateModelLiveEvaluationRequestV2({ ...f, observedAt: f.now }).request,
    ).toEqual(f.request);
  });
  it.each(["prompt", "candidate", "approved", "capabilityActivated"])(
    "rejects added %s content or self-authorization in every persisted record",
    (key) => {
      const f = syntheticLiveEvaluationFixtureV2();
      const results = [
        modelLiveEvaluationDefinitionV2Schema.safeParse(
          rehash({ ...f.definition, [key]: true }, "definitionDigest"),
        ),
        modelLiveEvaluationApprovalV2Schema.safeParse(
          rehash({ ...f.approval, [key]: true }, "approvalDigest"),
        ),
        modelLiveEvaluationPlanV2Schema.safeParse(
          rehash({ ...f.plan, [key]: true }, "planDigest"),
        ),
      ];
      for (const result of results) {
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                code: "unrecognized_keys",
                keys: [key],
                path: [],
              }),
            ]),
          );
        }
      }
    },
  );
  it("rejects reordered or duplicated case identities even with a recalculated digest", () => {
    const { definition } = syntheticLiveEvaluationFixtureV2();
    expect(
      modelLiveEvaluationDefinitionV2Schema.safeParse(
        rehash(
          { ...definition, cases: [...definition.cases].reverse() },
          "definitionDigest",
        ),
      ).success,
    ).toBe(false);
    const cases = structuredClone(definition.cases);
    const a = cases[0],
      b = cases[1];
    if (a === undefined || b === undefined) throw Error("Missing test cases");
    b.caseId = a.caseId;
    expect(
      modelLiveEvaluationDefinitionV2Schema.safeParse(
        rehash({ ...definition, cases }, "definitionDigest"),
      ).success,
    ).toBe(false);
  });
  it("rejects widening concurrent capacity beyond the shared policy", () => {
    const { definition } = syntheticLiveEvaluationFixtureV2();
    expect(
      modelLiveEvaluationDefinitionV2Schema.safeParse(
        rehash(
          {
            ...definition,
            limits: { ...definition.limits, maximumConcurrentJobs: 2 },
          },
          "definitionDigest",
        ),
      ).success,
    ).toBe(false);
  });
  it("rejects changed frozen source input even when metadata is rehashed", () => {
    const f = syntheticLiveEvaluationFixtureV2();
    const entry = f.definition.cases[0];
    if (entry === undefined) throw Error("Missing test case");
    entry.sourceInputDigest = sha256Text("different synthetic source");
    const changed = rehash(f.definition, "definitionDigest");
    expect(
      modelLiveEvaluationDefinitionV2Schema.safeParse(changed).success,
    ).toBe(true);
    expect(() => definitionCheck(changed)).toThrow(
      ModelLiveEvaluationPlanError,
    );
  });
  it("rejects a well-formed tuple from another case's operation or role", () => {
    const f = syntheticLiveEvaluationFixtureV2();
    const entry = f.definition.cases[0];
    if (entry === undefined) throw Error("Missing test case");
    const other = f.definition.cases.find(
      (c) =>
        c.authorityBinding.authorityTuple.operation !==
        entry.authorityBinding.authorityTuple.operation,
    );
    if (other === undefined) throw Error("Missing distinct test operation");
    entry.authorityBinding = other.authorityBinding;
    const changed = rehash(f.definition, "definitionDigest");
    expect(
      modelLiveEvaluationDefinitionV2Schema.safeParse(changed).success,
    ).toBe(true);
    expect(() => definitionCheck(changed)).toThrow(
      ModelLiveEvaluationPlanError,
    );
  });
  it.each(["organizationId", "projectId", "userId"])(
    "rejects approval scope substitution of %s",
    (key) => {
      const f = syntheticLiveEvaluationFixtureV2();
      const approval = rehash(
        { ...f.approval, scope: { ...f.scope, [key]: "other_scope" } },
        "approvalDigest",
      );
      expect(
        modelLiveEvaluationPlanV2Schema.safeParse(
          rehash({ ...f.plan, approval }, "planDigest"),
        ).success,
      ).toBe(false);
    },
  );
  it.each([0, 24 * 60 * 60 * 1000 + 1])(
    "rejects approval lifetime %s milliseconds",
    (duration) => {
      const f = syntheticLiveEvaluationFixtureV2();
      const expiresAt = new Date(Date.parse(f.now) + duration).toISOString();
      expect(
        modelLiveEvaluationApprovalV2Schema.safeParse(
          rehash({ ...f.approval, expiresAt }, "approvalDigest"),
        ).success,
      ).toBe(false);
    },
  );
  it("rejects plan expiry past the approved interval and issuance before approval", () => {
    const f = syntheticLiveEvaluationFixtureV2();
    expect(
      modelLiveEvaluationPlanV2Schema.safeParse(
        rehash(
          {
            ...f.plan,
            expiresAt: new Date(Date.parse(f.plan.expiresAt) + 1).toISOString(),
          },
          "planDigest",
        ),
      ).success,
    ).toBe(false);
    expect(
      modelLiveEvaluationPlanV2Schema.safeParse(
        rehash(
          {
            ...f.plan,
            issuedAt: new Date(
              Date.parse(f.approval.approvedAt) - 1,
            ).toISOString(),
          },
          "planDigest",
        ),
      ).success,
    ).toBe(false);
  });
  it.each([
    "capabilityRegistryDigest",
    "catalogDigest",
    "evaluationAuthorityTupleDigest",
    "evaluationCaseDigest",
    "inputDigest",
    "inputEvidenceDigest",
    "liveEvaluationAuthorityDigest",
    "liveEvaluationPlanDigest",
    "promptTemplateDigest",
    "responseSchemaDigest",
    "routeRegistryDigest",
    "runtimePolicyDigest",
  ] as const)("rejects self-rehashed request substitution of %s", (key) => {
    const f = syntheticLiveEvaluationFixtureV2();
    const request = rehash(
      { ...f.request, [key]: sha256Text("changed " + key) },
      "requestDigest",
    );
    expect(
      modelLiveRuntimeAdmissionRequestV2Schema.safeParse(request).success,
    ).toBe(true);
    expect(() =>
      validateModelLiveEvaluationRequestV2({
        ...f,
        request,
        observedAt: f.now,
      }),
    ).toThrow(ModelLiveEvaluationPlanError);
  });
  it.each([
    "organizationId",
    "projectId",
    "userId",
    "evaluationCaseId",
  ] as const)("rejects a changed %s despite a valid request digest", (key) => {
    const f = syntheticLiveEvaluationFixtureV2();
    const request = rehash(
      { ...f.request, [key]: "different_identity" },
      "requestDigest",
    );
    expect(() =>
      validateModelLiveEvaluationRequestV2({
        ...f,
        request,
        observedAt: f.now,
      }),
    ).toThrow(ModelLiveEvaluationPlanError);
  });
  it.each(["before", "at-expiry"] as const)(
    "denies %s plan authority",
    (boundary) => {
      const f = syntheticLiveEvaluationFixtureV2();
      const observedAt =
        boundary === "before"
          ? new Date(Date.parse(f.now) - 1).toISOString()
          : f.plan.expiresAt;
      expect(() =>
        validateModelLiveEvaluationRequestV2({ ...f, observedAt }),
      ).toThrow(ModelLiveEvaluationPlanError);
    },
  );
  it("rejects underreported evidence even when both evidence and request digests are recalculated", () => {
    const f = syntheticLiveEvaluationFixtureV2();
    const inputEvidence = rehash(
      {
        ...f.inputEvidence,
        requested: { ...f.inputEvidence.requested, outputTokens: 1 },
      },
      "evidenceDigest",
    );
    const request = rehash(
      { ...f.request, inputEvidenceDigest: inputEvidence.evidenceDigest },
      "requestDigest",
    );
    expect(() =>
      validateModelLiveEvaluationRequestV2({
        ...f,
        inputEvidence,
        request,
        observedAt: f.now,
      }),
    ).toThrow(ModelLiveEvaluationPlanError);
  });
});
