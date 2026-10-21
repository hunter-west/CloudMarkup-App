import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  normalizeArchitectureDocumentV2,
  parseArchitectureDocumentV2,
  parseArchitectureDocumentV2Json,
  serializeArchitectureDocumentV2,
  type ArchitectureDocumentV2,
} from "./index.js";
import { ArchitectureDocumentSchemaError } from "./validation.js";

async function readFixture(): Promise<string> {
  return readFile(
    new URL(
      "../../test-fixtures/fixtures/architecture-document/v2/valid/representative.json",
      import.meta.url,
    ),
    "utf8",
  );
}

function withImplementation(
  document: ArchitectureDocumentV2,
  implementation: unknown,
): unknown {
  const [workload] = document.workloadBehavior.workloads;
  if (workload === undefined) {
    throw new Error("Representative fixture must contain a workload.");
  }

  return {
    ...document,
    workloadBehavior: {
      ...document.workloadBehavior,
      workloads: [{ ...workload, implementation }],
    },
  };
}

describe("Architecture Document v2 and Workload Behavior v1 schemas", () => {
  it("orders multiple items in every nested workload collection", async () => {
    const document = parseArchitectureDocumentV2Json(await readFixture());
    const [workload] = document.workloadBehavior.workloads;
    const [operation] = workload?.operations ?? [];
    const [trigger] = workload?.triggers ?? [];
    const [action] = workload?.downstreamActions ?? [];
    if (
      workload === undefined ||
      operation === undefined ||
      trigger === undefined ||
      action === undefined
    ) {
      throw new Error(
        "Representative fixture must contain a workload with operation bindings.",
      );
    }

    const expanded = parseArchitectureDocumentV2({
      ...document,
      workloadBehavior: {
        contractVersion: 1,
        workloads: [
          {
            ...workload,
            id: "workload_z",
            operations: [
              { ...operation, id: "workload_operation_z" },
              { ...operation, id: "workload_operation_a" },
            ],
            triggers: [
              { ...trigger, id: "workload_trigger_z" },
              { ...trigger, id: "workload_trigger_a" },
            ],
            downstreamActions: [
              { ...action, id: "workload_action_z" },
              { ...action, id: "workload_action_a" },
            ],
            environment: [...workload.environment].reverse(),
            unresolvedRequirementIds: ["requirement_z", "requirement_a"],
          },
          {
            ...workload,
            id: "workload_a",
            owningNodeId: "node_source",
            operations: [],
            triggers: [],
            downstreamActions: [],
            environment: [],
            unresolvedRequirementIds: [],
          },
        ],
      },
    });

    const normalized = normalizeArchitectureDocumentV2(expanded);
    expect(normalized.workloadBehavior.workloads.map(({ id }) => id)).toEqual([
      "workload_a",
      "workload_z",
    ]);
    const normalizedNested = normalized.workloadBehavior.workloads[1];
    expect(normalizedNested?.operations.map(({ id }) => id)).toEqual([
      "workload_operation_a",
      "workload_operation_z",
    ]);
    expect(normalizedNested?.triggers.map(({ id }) => id)).toEqual([
      "workload_trigger_a",
      "workload_trigger_z",
    ]);
    expect(normalizedNested?.downstreamActions.map(({ id }) => id)).toEqual([
      "workload_action_a",
      "workload_action_z",
    ]);
    expect(normalizedNested?.environment.map(({ id }) => id)).toEqual([
      "workload_env_secret",
      "workload_env_source",
      "workload_env_stage",
    ]);
    expect(normalizedNested?.unresolvedRequirementIds).toEqual([
      "requirement_a",
      "requirement_z",
    ]);
  });

  it("round-trips and normalizes every semantically unordered collection", async () => {
    const document = parseArchitectureDocumentV2Json(await readFixture());
    const [workload] = document.workloadBehavior.workloads;
    if (workload === undefined) {
      throw new Error("Representative fixture must contain a workload.");
    }
    const reordered = {
      ...document,
      nodes: [...document.nodes].reverse(),
      edges: [...document.edges].reverse(),
      variables: [...document.variables].reverse(),
      unresolvedRequirements: [...document.unresolvedRequirements].reverse(),
      workloadBehavior: {
        ...document.workloadBehavior,
        workloads: [
          {
            ...workload,
            operations: [...workload.operations].reverse(),
            triggers: [...workload.triggers].reverse(),
            downstreamActions: [...workload.downstreamActions].reverse(),
            environment: [...workload.environment].reverse(),
            unresolvedRequirementIds: [
              ...workload.unresolvedRequirementIds,
            ].reverse(),
          },
        ],
      },
    };
    const before = JSON.stringify(reordered);
    const serialized = serializeArchitectureDocumentV2(reordered);

    expect(parseArchitectureDocumentV2Json(serialized)).toEqual(
      normalizeArchitectureDocumentV2(document),
    );
    expect(serialized).toBe(serializeArchitectureDocumentV2(document));
    expect(JSON.stringify(reordered)).toBe(before);
  });

  it("accepts exactly the four implementation modes", async () => {
    const document = parseArchitectureDocumentV2Json(await readFixture());
    const executable = {
      runtimeFamily: "example.runtime.nodejs",
      handler: "src/handler.main",
    } as const;
    const implementations = [
      { mode: "infrastructure-only" },
      { ...executable, mode: "user-provided", sourceOwnership: "user" },
      {
        ...executable,
        mode: "generated-starter",
        sourceOwnership: "cloudmarkup",
      },
      {
        ...executable,
        mode: "external-artifact",
        sourceOwnership: "external",
        artifact: {
          artifactId: "artifact_fixture",
          digest:
            "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        },
      },
    ] as const;

    expect(
      implementations.map(
        (implementation) =>
          parseArchitectureDocumentV2(
            withImplementation(document, implementation),
          ).workloadBehavior.workloads[0]?.implementation.mode,
      ),
    ).toEqual([
      "infrastructure-only",
      "user-provided",
      "generated-starter",
      "external-artifact",
    ]);

    expect(() =>
      parseArchitectureDocumentV2(
        withImplementation(document, {
          mode: "infrastructure-only",
          sourceText: "forbidden",
        }),
      ),
    ).toThrow(ArchitectureDocumentSchemaError);
    expect(() =>
      parseArchitectureDocumentV2(
        withImplementation(document, { mode: "managed" }),
      ),
    ).toThrow(ArchitectureDocumentSchemaError);
  });

  it.each(["sourceText", "credentials", "unknownField"])(
    "rejects prohibited workload field %s by schema closure",
    async (field) => {
      const document = parseArchitectureDocumentV2Json(await readFixture());
      const [workload] = document.workloadBehavior.workloads;
      if (workload === undefined) {
        throw new Error("Representative fixture must contain a workload.");
      }

      expect(() =>
        parseArchitectureDocumentV2({
          ...document,
          workloadBehavior: {
            ...document.workloadBehavior,
            workloads: [{ ...workload, [field]: "must-not-be-retained" }],
          },
        }),
      ).toThrow(ArchitectureDocumentSchemaError);
    },
  );

  it("rejects inline environment literals", async () => {
    const document = parseArchitectureDocumentV2Json(await readFixture());
    const [workload] = document.workloadBehavior.workloads;
    const [binding] = workload?.environment ?? [];
    if (workload === undefined || binding === undefined) {
      throw new Error(
        "Representative fixture must contain a workload environment binding.",
      );
    }

    expect(() =>
      parseArchitectureDocumentV2({
        ...document,
        workloadBehavior: {
          ...document.workloadBehavior,
          workloads: [
            {
              ...workload,
              environment: [
                {
                  ...binding,
                  value: {
                    kind: "non-secret-literal",
                    value: "must-not-be-retained",
                  },
                },
                ...workload.environment.slice(1),
              ],
            },
          ],
        },
      }),
    ).toThrow(ArchitectureDocumentSchemaError);
  });

  it("keeps secret bindings reference-only and handlers non-executable", async () => {
    const document = parseArchitectureDocumentV2Json(await readFixture());
    const [workload] = document.workloadBehavior.workloads;
    if (workload === undefined) {
      throw new Error("Representative fixture must contain a workload.");
    }
    const secretIndex = workload.environment.findIndex(
      (binding) => binding.value.kind === "secret-reference",
    );
    const secretBinding = workload.environment[secretIndex];
    if (secretBinding?.value.kind !== "secret-reference") {
      throw new Error(
        "Representative fixture must contain a secret reference.",
      );
    }

    expect(() =>
      parseArchitectureDocumentV2({
        ...document,
        workloadBehavior: {
          ...document.workloadBehavior,
          workloads: [
            {
              ...workload,
              environment: workload.environment.map((binding, index) =>
                index === secretIndex
                  ? {
                      ...secretBinding,
                      value: {
                        ...secretBinding.value,
                        value: "must-not-be-retained",
                      },
                    }
                  : binding,
              ),
            },
          ],
        },
      }),
    ).toThrow(ArchitectureDocumentSchemaError);

    expect(() =>
      parseArchitectureDocumentV2(
        withImplementation(document, {
          mode: "user-provided",
          runtimeFamily: "example.runtime.nodejs",
          handler: "node -e process.exit(1)",
          sourceOwnership: "user",
        }),
      ),
    ).toThrow(ArchitectureDocumentSchemaError);
  });
});
