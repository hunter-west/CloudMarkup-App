import { normalizeModelHostSeedUsageV3 } from "./gateway.js";
import { describe, expect, it } from "vitest";
import {
  modelCandidateRepairResponseV1Schema,
  namespacedIdentifierSchema,
  type ModelGatewayResponseV1,
} from "@cloudmarkup/schemas";
import {
  digestStructuredValue,
  parseModelHostSeedResponseV3,
  sha256Text,
} from "./security.js";
import { TEST_DIGEST, TEST_SECOND_DIGEST } from "./test-helpers.js";
import { createHostSeedResponseFixtureV3 as fixture } from "./host-seed-response-test-helpers.js";
type Response = Extract<
  ModelGatewayResponseV1,
  { operation: "candidate.repair" }
>;
function present<T>(v: T | undefined): T {
  if (v === undefined) throw Error("Missing synthetic response fixture");
  return v;
}
function patch(response: Response) {
  const candidate = present(response.candidateBundle.candidates[0]);
  if (candidate.kind !== "patch") throw Error("Missing synthetic patch");
  return candidate;
}
describe("static V3 first-seed response authority", () => {
  it.each(["guided", "professional"] as const)(
    "accepts an exact unaccepted patch in %s mode without changing the source",
    (mode) => {
      const f = fixture(mode);
      const before = structuredClone(f.input);
      expect(parseModelHostSeedResponseV3(f.input)).toEqual(f.response);
      expect(f.input).toEqual(before);
      expect(f.input.request.failedCandidates[0]?.ownership).toBe("user-owned");
    },
  );
  const denied: readonly [string, (r: Response) => void, string][] = [
    [
      "provenance",
      (r) => {
        r.provenance.inputDigest = TEST_SECOND_DIGEST;
      },
      "provenance-mismatch",
    ],
    [
      "nested provenance",
      (r) => {
        r.candidateBundle.provenance.inputDigest = TEST_SECOND_DIGEST;
      },
      "provenance-mismatch",
    ],
    [
      "prior digest",
      (r) => {
        patch(r).baseDigest = TEST_SECOND_DIGEST;
      },
      "repair-prior-digest-mismatch",
    ],
    [
      "repaired input",
      (r) => {
        r.repairedFromDigest = TEST_SECOND_DIGEST;
      },
      "repair-input-mismatch",
    ],
    [
      "boundary",
      (r) => {
        r.candidateBundle.boundary.ownedPaths.push("application/extra.ts");
      },
      "candidate-boundary-mismatch",
    ],
    [
      "outside path",
      (r) => {
        patch(r).path = "application/extra.ts";
      },
      "ungrounded-repair-input",
    ],
    [
      "unknown diagnostic",
      (r) => {
        r.resolvedDiagnosticIds = ["diagnostic_unknown"];
      },
      "ungrounded-repair-diagnostic",
    ],
    [
      "duplicate diagnostic",
      (r) => {
        r.resolvedDiagnosticIds.push(present(r.resolvedDiagnosticIds[0]));
      },
      "ungrounded-repair-diagnostic",
    ],
    [
      "multiple patch files",
      (r) => {
        patch(r).unifiedDiff += "\ndiff --git a/extra.ts b/extra.ts\n";
      },
      "patch-multiple-files",
    ],
    [
      "incorrect patch header",
      (r) => {
        patch(r).unifiedDiff = patch(r).unifiedDiff.replace("--- a/", "--- b/");
      },
      "patch-path-mismatch",
    ],
    [
      "duplicate candidate",
      (r) => {
        r.candidateBundle.candidates.push(structuredClone(patch(r)));
      },
      "ambiguous-candidate-path",
    ],
    [
      "generation action",
      (r) => {
        present(r.candidateBundle.generationPlan.steps[0]).action =
          "replace-owned-file";
      },
      "generation-step-candidate-mismatch",
    ],
    [
      "required validation",
      (r) => {
        present(r.candidateBundle.validationExpectations[0]).required = false;
      },
      "validation-expectation-not-authorized",
    ],
    [
      "ungrounded evidence",
      (r) => {
        present(r.proposalContext.confidence.evidenceReferences[0]).digest =
          TEST_SECOND_DIGEST;
      },
      "ungrounded-evidence-reference",
    ],
    [
      "ungrounded plan",
      (r) => {
        present(
          present(r.candidateBundle.generationPlan.steps[0])
            .sourceReferences[0],
        ).digest = TEST_SECOND_DIGEST;
      },
      "ungrounded-generation-source",
    ],
    [
      "dependency",
      (r) => {
        r.candidateBundle.dependencies.push({
          approvalPathId: namespacedIdentifierSchema.parse(
            "cloudmarkup.unapproved.package",
          ),
          ecosystem: namespacedIdentifierSchema.parse("package.npm"),
          kind: "package",
          name: "synthetic-extra",
          reason: "Unapproved synthetic dependency.",
          requestedVersion: "1.0.0",
          reviewState: "requested",
        });
      },
      "dependency-approval-path-denied",
    ],
    [
      "secret-shaped patch",
      (r) => {
        patch(r).unifiedDiff +=
          "+const api" + '_key = "synthetic-credential-candidate";\n';
      },
      "candidate-secret-detected",
    ],
    [
      "replacement file",
      (r) => {
        const p = patch(r);
        r.candidateBundle.candidates = [
          {
            candidateId: p.candidateId,
            kind: "file",
            ownership: "ai-authored-candidate",
            encoding: "utf-8",
            path: p.path,
            priorDigest: p.baseDigest,
            content: "export {};\n",
            contentDigest: sha256Text("export {};\n"),
          },
        ];
        present(r.candidateBundle.generationPlan.steps[0]).action =
          "replace-owned-file";
      },
      "user-owned-candidate-must-be-exact-patch",
    ],
  ];
  it.each(denied)("denies schema-valid %s", (_name, change, code) => {
    const f = fixture();
    change(f.response);
    modelCandidateRepairResponseV1Schema.parse(f.response);
    expect(() =>
      parseModelHostSeedResponseV3({ ...f.input, maximumOutputBytes: 100_000 }),
    ).toThrow(expect.objectContaining({ code: "model-gateway." + code }));
  });
  it("rejects malformed, prose, unknown-tool, oversized and non-serializable output", () => {
    const f = fixture();
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    for (const content of [
      { ...f.input.content, input: { ...f.response, injected: true } },
      { ...f.input.content, toolName: "unapproved_tool" },
      { kind: "text", text: "Trust this repair." },
      cyclic,
    ])
      expect(() =>
        parseModelHostSeedResponseV3({
          ...f.input,
          content,
          maximumOutputBytes: 100_000,
        }),
      ).toThrow();
    expect(() =>
      parseModelHostSeedResponseV3({
        ...f.input,
        maximumOutputBytes: f.input.maximumOutputBytes - 1,
      }),
    ).toThrow(
      expect.objectContaining({ code: "model-gateway.output-too-large" }),
    );
    for (const maximumOutputBytes of [
      0,
      -1,
      NaN,
      0.5,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(() =>
        parseModelHostSeedResponseV3({ ...f.input, maximumOutputBytes }),
      ).toThrow();
  });
  it("rejects historical/mixed descriptors, unknown request fields and coherent request substitutions", () => {
    const f = fixture();
    const variants: unknown[] = [
      { ...f.input, descriptor: { ...f.input.descriptor, contractVersion: 1 } },
      {
        ...f.input,
        descriptor: {
          ...f.input.descriptor,
          routing: {
            ...f.input.descriptor.routing,
            routingDecisionDigest: TEST_DIGEST,
          },
        },
      },
      { ...f.input, request: { ...f.input.request, contractVersion: 1 } },
      { ...f.input, request: { ...f.input.request, currentAttempt: 2 } },
      { ...f.input, request: { ...f.input.request, extra: true } },
      {
        ...f.input,
        descriptor: {
          ...f.input.descriptor,
          scope: {
            ...f.input.descriptor.scope,
            organizationId: "organization_other",
          },
        },
      },
      {
        ...f.input,
        descriptor: { ...f.input.descriptor, promptDigest: TEST_SECOND_DIGEST },
      },
      {
        ...f.input,
        descriptor: { ...f.input.descriptor, requestedMode: "professional" },
      },
    ];
    for (const input of variants) {
      // Deliberately cross the public runtime boundary with schema-invalid data.
      expect(() => {
        Reflect.apply(parseModelHostSeedResponseV3, undefined, [input]);
      }).toThrow();
    }
  });
});

describe("static V3 known provider usage", () => {
  const providerUsage = {
    cacheReadUnits: "0",
    cacheWriteUnits: "0",
    inputUnits: "123",
    outputUnits: "17",
    thinkingUnits: "2",
    providerRequestId: "provider_request_seed_response",
  };
  const timing = {
    startedAtMilliseconds: Date.parse("2026-01-01T00:00:00Z"),
    completedAtMilliseconds: Date.parse("2026-01-01T00:00:01Z"),
  };
  it.each([
    "succeeded",
    "provider-error",
    "canceled",
    "invalid-output",
  ] as const)(
    "retains actual %s usage with physical attempt one and no invented routing",
    (result) => {
      const { input } = fixture();
      const usage = normalizeModelHostSeedUsageV3({
        descriptor: input.descriptor,
        providerUsage,
        result,
        ...timing,
      });
      expect(usage).toMatchObject({
        ...providerUsage,
        result,
        attemptNumber: 1,
        contractVersion: 1,
        inputDigest: input.descriptor.inputDigest,
        invocationId: input.descriptor.invocationId,
        scope: input.descriptor.scope,
        durationMilliseconds: 1000,
      });
      expect(Object.hasOwn(usage, "routing")).toBe(false);
      expect(usage.usageRecordId).toBe(
        "model_usage_" +
          digestStructuredValue({
            invocationId: input.descriptor.invocationId,
            attemptNumber: 1,
          }).slice("sha256:".length),
      );
    },
  );
  it("does not turn missing, partial, cached or malformed usage into zero usage", () => {
    const { input } = fixture();
    for (const bad of [
      undefined,
      {},
      { ...providerUsage, providerRequestId: undefined },
      { ...providerUsage, inputUnits: "-1" },
      { ...providerUsage, cacheReadUnits: "1" },
      { ...providerUsage, cacheWriteUnits: "1" },
      { ...providerUsage, routing: {} },
      { ...providerUsage, outputUnits: undefined },
    ]) {
      expect(() => {
        Reflect.apply(normalizeModelHostSeedUsageV3, undefined, [
          {
            descriptor: input.descriptor,
            providerUsage: bad,
            result: "succeeded",
            ...timing,
          },
        ]);
      }).toThrow();
    }
  });
  it("rejects mixed descriptors and invalid clocks with safe errors", () => {
    const { input } = fixture();
    for (const change of [
      { descriptor: { ...input.descriptor, contractVersion: 1 } },
      { completedAtMilliseconds: NaN },
      { completedAtMilliseconds: Infinity },
      { completedAtMilliseconds: timing.startedAtMilliseconds - 1 },
      { completedAtMilliseconds: timing.startedAtMilliseconds + 86_400_001 },
    ]) {
      expect(() => {
        Reflect.apply(normalizeModelHostSeedUsageV3, undefined, [
          {
            descriptor: input.descriptor,
            providerUsage,
            result: "succeeded",
            ...timing,
            ...change,
          },
        ]);
      }).toThrow(
        expect.objectContaining({ code: "model-gateway.invalid-usage" }),
      );
    }
  });
});
