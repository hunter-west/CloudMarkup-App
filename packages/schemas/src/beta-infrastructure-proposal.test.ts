import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  betaInfrastructureProposalSchema,
  betaInfrastructureProposalV1Schema,
  betaInfrastructureProposalV2Schema,
  betaInfrastructureProposalV3Schema,
  betaInfrastructureProposalV4Schema,
  betaInfrastructureProposalV5Schema,
  betaInfrastructureProposalV6Schema,
} from "./beta-infrastructure-proposal-v1.js";
const resource = {
  key: "new",
  serviceType: "aws.lambda.function",
  label: "Handler",
  parentKey: null,
};
it("v6 retains exactly v5 mutation schema and rejects IAM/edge/workload operation additions", () => {
  const v5 = z.toJSONSchema(betaInfrastructureProposalV5Schema);
  const v6 = z.toJSONSchema(betaInfrastructureProposalV6Schema);
  expect({
    ...v6,
    properties: {
      ...v6.properties,
      contractVersion: { type: "number", const: 5 },
    },
  }).toEqual(v5);
  const assessment = {
    contractVersion: 6,
    summary: "Use the permissions editor",
    resources: [],
    connections: [],
    existingResources: [],
    updates: [],
    limitations: [],
    review: {
      intent: "Assess permissions",
      assumptions: [],
      checks: ["No mutation is supported"],
      questions: [],
    },
  };
  expect(betaInfrastructureProposalV6Schema.safeParse(assessment).success).toBe(
    true,
  );
  for (const key of [
    "policyUpdates",
    "edgeUpdates",
    "referenceUpdates",
    "workloadUpdates",
  ])
    expect(
      betaInfrastructureProposalV6Schema.safeParse({ ...assessment, [key]: [] })
        .success,
    ).toBe(false);
});
const v1 = {
  contractVersion: 1,
  summary: "Add a handler",
  resources: [resource],
  connections: [],
  limitations: [],
};
const v2 = {
  ...v1,
  contractVersion: 2,
  existingResources: [{ key: "input", nodeId: "node_input" }],
  connections: [
    {
      ruleId: "aws.s3.bucket-notifies-lambda",
      sourceKey: "input",
      targetKey: "new",
      configuration: {},
    },
  ],
};
const v5 = {
  ...v2,
  contractVersion: 5,
  resources: [{ ...resource, configuration: { filterKeys: ["category"] } }],
  connections: [{ ...v2.connections[0], configuration: { filterKeys: [] } }],
  updates: [
    {
      resourceKey: "input",
      configuration: { filterKeys: ["type", "source"] },
      reason: "Match requested events.",
    },
  ],
  review: {
    intent: "Configure event selection",
    assumptions: [],
    checks: ["Reviewed requested filters."],
    questions: [],
  },
};

describe("version 5 bounded list proposals", () => {
  it("accepts flat lists in resources, connections and updates, including explicit clearing", () => {
    expect(betaInfrastructureProposalSchema.parse(v5)).toEqual(v5);
  });
  it("accepts the exact transport boundary without truncating values", () => {
    const values = Array.from({ length: 16 }, (_, index) =>
      String(index).padEnd(256, "x"),
    );
    const candidate = {
      ...v5,
      updates: [{ ...v5.updates[0], configuration: { values } }],
    };
    expect(betaInfrastructureProposalSchema.parse(candidate)).toEqual(
      candidate,
    );
  });
  it.each([4])(
    "retains scalar-only connection settings for version %s",
    (version) => {
      const legacy =
        version === 1
          ? v1
          : version === 4
            ? { ...v2, updates: [], review: v5.review }
            : v2;
      expect(
        betaInfrastructureProposalSchema.safeParse({
          ...legacy,
          contractVersion: version,
          connections: [
            {
              ruleId: "test",
              sourceKey: "new",
              targetKey: "second",
              configuration: { values: ["a"] },
            },
          ],
          resources: [resource, { ...resource, key: "second" }],
        }).success,
      ).toBe(false);
    },
  );
  it.each(
    [
      [["nested"]],
      Array.from({ length: 17 }, () => "a"),
      ["a".repeat(257)],
    ].map((value) => ({ value })),
  )("rejects malformed or oversized lists $value", ({ value }) => {
    for (const location of ["resources", "connections", "updates"] as const) {
      const entries = v5[location].map((entry) => ({
        ...entry,
        configuration: { filterKeys: value },
      }));
      expect(
        betaInfrastructureProposalSchema.safeParse({
          ...v5,
          [location]: entries,
        }).success,
      ).toBe(false);
    }
  });
  it("preserves review, reference and update boundaries in v5", () => {
    for (const invalid of [
      { ...v5, existingResources: [] },
      { ...v5, updates: [...v5.updates, ...v5.updates] },
      { ...v5, review: { ...v5.review, questions: ["Which events?"] } },
      { ...v5, updates: [{ ...v5.updates[0], configuration: {} }] },
      { ...v5, contractVersion: 7 },
    ])
      expect(betaInfrastructureProposalSchema.safeParse(invalid).success).toBe(
        false,
      );
  });
});
describe("compatible incremental diagram proposal schemas", () => {
  it("preserves v1 and accepts v2 existing references and workload purpose", () => {
    expect(betaInfrastructureProposalSchema.parse(v1)).toEqual(v1);
    expect(
      betaInfrastructureProposalSchema.parse({
        ...v2,
        resources: [{ ...resource, purpose: "Process uploaded files." }],
      }),
    ).toMatchObject({ contractVersion: 2 });
    expect(
      betaInfrastructureProposalSchema.safeParse({
        ...v1,
        existingResources: [],
      }).success,
    ).toBe(false);
  });
  it("allows connections between existing resources without new resources", () => {
    expect(
      betaInfrastructureProposalSchema.safeParse({
        ...v2,
        resources: [],
        existingResources: [
          ...v2.existingResources,
          { key: "new", nodeId: "node_handler" },
        ],
      }).success,
    ).toBe(true);
  });
  it.each([
    { ...v2, resources: [], connections: [] },
    { ...v2, existingResources: [{ key: "new", nodeId: "node_input" }] },
    {
      ...v2,
      existingResources: [
        ...v2.existingResources,
        { key: "alias", nodeId: "node_input" },
      ],
    },
    { ...v2, connections: [{ ...v2.connections[0], targetKey: "missing" }] },
    { ...v2, connections: [{ ...v2.connections[0], targetKey: "input" }] },
    { ...v2, resources: [{ ...resource, parentKey: "missing" }] },
    { ...v2, resources: [{ ...resource, sourceCode: "untrusted" }] },
  ])(
    "rejects ambiguous, unbound, empty, or executable proposals",
    (invalid) => {
      expect(betaInfrastructureProposalSchema.safeParse(invalid).success).toBe(
        false,
      );
    },
  );
});

it("requires v3 for resource settings and rejects executable/structured settings", () => {
  const v3 = {
    ...v2,
    contractVersion: 3,
    resources: [{ ...resource, configuration: { memoryMegabytes: 256 } }],
  };
  expect(betaInfrastructureProposalSchema.safeParse(v3).success).toBe(true);
  for (const invalid of [
    { ...v3, contractVersion: 2 },
    {
      ...v3,
      resources: [
        {
          ...resource,
          configuration: { memoryMegabytes: { expression: "eval()" } },
        },
      ],
    },
    { ...v3, resources: [{ ...resource, sourceCode: "eval()" }] },
  ])
    expect(betaInfrastructureProposalSchema.safeParse(invalid).success).toBe(
      false,
    );
});

describe("version 4 reviewed configuration proposals", () => {
  const v4 = {
    contractVersion: 4,
    summary: "Tune the existing function",
    resources: [],
    connections: [],
    existingResources: [{ key: "handler", nodeId: "node_handler" }],
    updates: [
      {
        resourceKey: "handler",
        configuration: { memoryMegabytes: 512 },
        reason: "Handle the stated workload.",
      },
    ],
    review: {
      intent: "Tune memory",
      assumptions: [],
      checks: ["Checked configured runtime"],
      questions: [],
    },
    limitations: [],
  };
  it("accepts bounded existing-resource edits without changing old contracts", () => {
    expect(betaInfrastructureProposalSchema.parse(v4)).toEqual(v4);
    expect(
      betaInfrastructureProposalSchema.safeParse({ ...v4, contractVersion: 3 })
        .success,
    ).toBe(false);
    expect(
      betaInfrastructureProposalSchema.safeParse({
        ...v4,
        updates: [],
        review: { ...v4.review, questions: ["What is the budget?"] },
      }).success,
    ).toBe(true);
  });
});

it("allows an assessment without inventing changes, but rejects empty responses", () => {
  const assessment = {
    contractVersion: 4,
    summary: "The requested configuration is already present.",
    resources: [],
    connections: [],
    existingResources: [],
    updates: [],
    limitations: [],
    review: {
      intent: "Explain this architecture",
      assumptions: [],
      checks: ["The queue delivers work to the handler."],
      questions: [],
    },
  };
  expect(betaInfrastructureProposalSchema.safeParse(assessment).success).toBe(
    true,
  );
  expect(
    betaInfrastructureProposalSchema.safeParse({
      ...assessment,
      review: { ...assessment.review, checks: [] },
    }).success,
  ).toBe(false);
});

// Captured from released df8e1602, before the v5 schema extension.
it.each([
  [
    betaInfrastructureProposalV1Schema,
    "6184cf2cd95272d6c17396686db1fbe909db852fa95f57e96fbb7af3c0f1add5",
  ],
  [
    betaInfrastructureProposalV2Schema,
    "7d5f00711617633067f27484d181651f24bd16790f0e2ede746a68a34e7fa296",
  ],
  [
    betaInfrastructureProposalV3Schema,
    "f5df84751ee836baae32cd8e94c6bf57757ce526170824a43df05c62d221afb1",
  ],
  [
    betaInfrastructureProposalV4Schema,
    "044c843b1a714f5d15012c7501d1b450e60dca62fa77f58e357d736f4ee5b06f",
  ],
] as const)(
  "preserves the released proposal JSON schema fingerprint",
  (schema, expected) => {
    expect(
      createHash("sha256")
        .update(JSON.stringify(z.toJSONSchema(schema)))
        .digest("hex"),
    ).toBe(expected);
  },
);
