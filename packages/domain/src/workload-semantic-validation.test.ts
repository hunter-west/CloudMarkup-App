import { readFile } from "node:fs/promises";

import {
  parseArchitectureDocumentV2,
  parseArchitectureDocumentV2Json,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  ArchitectureDocumentSemanticError,
  parseArchitectureDocument,
  validateArchitectureDocumentSemantics,
} from "./index.js";

async function representativeDocument() {
  return parseArchitectureDocumentV2Json(
    await readFile(
      new URL(
        "../../test-fixtures/fixtures/architecture-document/v2/valid/representative.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

describe("Workload Behavior v1 semantic validation", () => {
  it("accepts the representative owner, operation, edge, environment, and requirement bindings", async () => {
    const document = await representativeDocument();

    expect(validateArchitectureDocumentSemantics(document)).toEqual([]);
    const migrated = parseArchitectureDocument(document);
    expect(migrated.schemaVersion).toBe(3);
    expect(validateArchitectureDocumentSemantics(migrated)).toEqual([]);
    expect(migrated.workloadBehavior.workloads[0]).toEqual(
      expect.objectContaining(document.workloadBehavior.workloads[0]),
    );
  });

  it("allows multiple homogeneous triggers with single-handler dispatch", async () => {
    const document = await representativeDocument();
    const [workload] = document.workloadBehavior.workloads;
    const triggerEdge = document.edges.find(
      (edge) => edge.id === "edge_trigger",
    );
    const [trigger] = workload?.triggers ?? [];
    if (
      workload === undefined ||
      triggerEdge === undefined ||
      trigger === undefined
    ) {
      throw new Error("Representative fixture must contain a trigger binding.");
    }

    const multiple = parseArchitectureDocumentV2({
      ...document,
      edges: [
        ...document.edges,
        {
          ...triggerEdge,
          id: "edge_trigger_secondary",
        },
      ],
      workloadBehavior: {
        ...document.workloadBehavior,
        workloads: [
          {
            ...workload,
            triggers: [
              ...workload.triggers,
              {
                ...trigger,
                id: "workload_trigger_secondary",
                edgeId: "edge_trigger_secondary",
              },
            ],
          },
        ],
      },
    });

    expect(multiple.workloadBehavior.workloads[0]?.triggerDispatch.mode).toBe(
      "single",
    );
    expect(validateArchitectureDocumentSemantics(multiple)).toEqual([]);
  });

  it("accepts every implementation and dispatch ownership boundary", async () => {
    const document = await representativeDocument();
    const [workload] = document.workloadBehavior.workloads;
    const [operation] = workload?.operations ?? [];
    if (workload === undefined || operation === undefined) {
      throw new Error(
        "Representative fixture must contain a workload operation.",
      );
    }

    const cases = [
      {
        implementation: { mode: "infrastructure-only" },
        triggerDispatch: { mode: "single" },
      },
      {
        implementation: {
          mode: "user-provided",
          runtimeFamily: "example.runtime.nodejs",
          handler: "src/index.handler",
          sourceOwnership: "user",
        },
        triggerDispatch: { mode: "single" },
      },
      {
        implementation: {
          mode: "user-provided",
          runtimeFamily: "example.runtime.nodejs",
          handler: "src/index.handler",
          sourceOwnership: "user",
        },
        triggerDispatch: {
          mode: "user-provided",
          dispatcherOperationId: operation.id,
        },
      },
      {
        implementation: {
          mode: "generated-starter",
          runtimeFamily: "example.runtime.nodejs",
          handler: "src/index.handler",
          sourceOwnership: "cloudmarkup",
        },
        triggerDispatch: { mode: "single" },
      },
      {
        implementation: {
          mode: "generated-starter",
          runtimeFamily: "example.runtime.nodejs",
          handler: "src/index.handler",
          sourceOwnership: "cloudmarkup",
        },
        triggerDispatch: {
          mode: "generated-supported",
          dispatcherId: "example.dispatcher.multi-trigger",
          dispatcherVersion: "1.0.0",
          dispatcherOperationId: operation.id,
        },
      },
      {
        implementation: {
          mode: "external-artifact",
          runtimeFamily: "example.runtime.nodejs",
          handler: "src/index.handler",
          sourceOwnership: "external",
          artifact: {
            artifactId: "artifact_external_workload",
            digest:
              "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        },
        triggerDispatch: { mode: "single" },
      },
      {
        implementation: {
          mode: "external-artifact",
          runtimeFamily: "example.runtime.nodejs",
          handler: "src/index.handler",
          sourceOwnership: "external",
          artifact: {
            artifactId: "artifact_external_workload",
            digest:
              "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        },
        triggerDispatch: {
          mode: "user-provided",
          dispatcherOperationId: operation.id,
        },
      },
    ] as const;

    for (const testCase of cases) {
      const candidate = parseArchitectureDocumentV2({
        ...document,
        workloadBehavior: {
          ...document.workloadBehavior,
          workloads: [
            {
              ...workload,
              implementation: testCase.implementation,
              triggerDispatch: testCase.triggerDispatch,
            },
          ],
        },
      });

      expect(
        validateArchitectureDocumentSemantics(candidate),
        `${testCase.implementation.mode}/${testCase.triggerDispatch.mode}`,
      ).toEqual([]);
    }
  });

  it("rejects dispatch ownership that contradicts the implementation mode", async () => {
    const document = await representativeDocument();
    const [workload] = document.workloadBehavior.workloads;
    const [operation] = workload?.operations ?? [];
    if (workload === undefined || operation === undefined) {
      throw new Error(
        "Representative fixture must contain a workload operation.",
      );
    }

    const userDispatch = {
      mode: "user-provided",
      dispatcherOperationId: operation.id,
    } as const;
    const generatedDispatch = {
      mode: "generated-supported",
      dispatcherId: "example.dispatcher.multi-trigger",
      dispatcherVersion: "1.0.0",
      dispatcherOperationId: operation.id,
    } as const;
    const cases = [
      {
        implementation: { mode: "infrastructure-only" },
        triggerDispatch: userDispatch,
      },
      {
        implementation: { mode: "infrastructure-only" },
        triggerDispatch: generatedDispatch,
      },
      {
        implementation: {
          mode: "user-provided",
          runtimeFamily: "example.runtime.nodejs",
          handler: "src/index.handler",
          sourceOwnership: "user",
        },
        triggerDispatch: generatedDispatch,
      },
      {
        implementation: {
          mode: "generated-starter",
          runtimeFamily: "example.runtime.nodejs",
          handler: "src/index.handler",
          sourceOwnership: "cloudmarkup",
        },
        triggerDispatch: userDispatch,
      },
      {
        implementation: {
          mode: "external-artifact",
          runtimeFamily: "example.runtime.nodejs",
          handler: "src/index.handler",
          sourceOwnership: "external",
          artifact: {
            artifactId: "artifact_external_workload",
            digest:
              "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        },
        triggerDispatch: generatedDispatch,
      },
    ] as const;

    for (const testCase of cases) {
      const candidate = parseArchitectureDocumentV2({
        ...document,
        workloadBehavior: {
          ...document.workloadBehavior,
          workloads: [
            {
              ...workload,
              implementation: testCase.implementation,
              triggerDispatch: testCase.triggerDispatch,
            },
          ],
        },
      });
      const issues = validateArchitectureDocumentSemantics(candidate);

      expect(
        issues,
        `${testCase.implementation.mode}/${testCase.triggerDispatch.mode}`,
      ).toContainEqual({
        code: "invalid_workload_dispatch_mode_for_implementation",
        message:
          "Workload trigger dispatch mode is incompatible with its implementation source ownership.",
        path: "$.workloadBehavior.workloads[0].triggerDispatch.mode",
      });
      expect(
        issues.filter(
          (issue) =>
            issue.code === "invalid_workload_dispatch_mode_for_implementation",
        ),
      ).toHaveLength(1);
    }
  });

  it("allows one invocation edge as caller action and callee trigger", async () => {
    const document = await representativeDocument();
    const [callee] = document.workloadBehavior.workloads;
    if (callee === undefined) {
      throw new Error("Representative fixture must contain a workload.");
    }

    const caller = {
      id: "workload_source",
      owningNodeId: "node_source",
      implementation: {
        mode: "user-provided",
        runtimeFamily: "example.runtime.nodejs",
        handler: "src/source.main",
        sourceOwnership: "user",
      },
      operations: [
        {
          id: "workload_operation_emit",
          capability: "example.workload.emit-event",
          inputContract: { kind: "none" },
          outputContract: { kind: "none" },
        },
      ],
      triggers: [],
      downstreamActions: [
        {
          id: "workload_action_invoke",
          edgeId: "edge_trigger",
          sourceOperationId: "workload_operation_emit",
        },
      ],
      environment: [],
      errorBehavior: { mode: "fail-invocation" },
      executionAssumptions: {
        timeout: { kind: "unresolved" },
        retry: { kind: "unresolved" },
      },
      triggerDispatch: { mode: "single" },
      unresolvedRequirementIds: [],
    };
    const composed = parseArchitectureDocumentV2({
      ...document,
      workloadBehavior: {
        ...document.workloadBehavior,
        workloads: [caller, callee],
      },
    });

    expect(validateArchitectureDocumentSemantics(composed)).toEqual([]);
  });

  it("allows distinct operations to share one downstream edge but rejects a duplicate pair", async () => {
    const document = await representativeDocument();
    const [workload] = document.workloadBehavior.workloads;
    const [operation] = workload?.operations ?? [];
    const [action] = workload?.downstreamActions ?? [];
    if (
      workload === undefined ||
      operation === undefined ||
      action === undefined
    ) {
      throw new Error(
        "Representative fixture must contain one downstream action.",
      );
    }
    const secondOperation = {
      ...operation,
      id: "workload_operation_shared_read",
    };
    const sharedEdge = parseArchitectureDocumentV2({
      ...document,
      workloadBehavior: {
        ...document.workloadBehavior,
        workloads: [
          {
            ...workload,
            operations: [...workload.operations, secondOperation],
            downstreamActions: [
              ...workload.downstreamActions,
              {
                ...action,
                id: "workload_action_shared_read",
                sourceOperationId: secondOperation.id,
              },
            ],
          },
        ],
      },
    });

    expect(validateArchitectureDocumentSemantics(sharedEdge)).toEqual([]);

    const sharedWorkload = sharedEdge.workloadBehavior.workloads[0];
    if (sharedWorkload === undefined) {
      throw new Error("Expected the shared-edge workload.");
    }
    const duplicatePair = parseArchitectureDocumentV2({
      ...sharedEdge,
      workloadBehavior: {
        ...sharedEdge.workloadBehavior,
        workloads: [
          {
            ...sharedWorkload,
            downstreamActions: [
              ...sharedWorkload.downstreamActions,
              {
                ...action,
                id: "workload_action_duplicate_pair",
              },
            ],
          },
        ],
      },
    });

    expect(validateArchitectureDocumentSemantics(duplicatePair)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_workload_downstream_edge_binding",
        }),
      ]),
    );
  });

  it("rejects duplicate workload ownership and nested stable identities", async () => {
    const document = await representativeDocument();
    const [workload] = document.workloadBehavior.workloads;
    const [operation] = workload?.operations ?? [];
    const [trigger] = workload?.triggers ?? [];
    const [environment] = workload?.environment ?? [];
    if (
      workload === undefined ||
      operation === undefined ||
      trigger === undefined ||
      environment === undefined
    ) {
      throw new Error(
        "Representative fixture must populate workload collections.",
      );
    }

    const invalid = parseArchitectureDocumentV2({
      ...document,
      workloadBehavior: {
        ...document.workloadBehavior,
        workloads: [
          {
            ...workload,
            operations: [...workload.operations, operation],
            triggers: [...workload.triggers, trigger],
            environment: [...workload.environment, environment],
            unresolvedRequirementIds: [
              ...workload.unresolvedRequirementIds,
              ...workload.unresolvedRequirementIds,
            ],
          },
          { ...workload, id: "workload_same_owner" },
          { ...workload, owningNodeId: "node_source" },
        ],
      },
    });
    const codes = validateArchitectureDocumentSemantics(invalid).map(
      (issue) => issue.code,
    );

    expect(codes).toEqual(
      expect.arrayContaining([
        "duplicate_workload_environment_binding_id",
        "duplicate_workload_environment_name",
        "duplicate_workload_id",
        "duplicate_workload_operation_id",
        "duplicate_workload_owner",
        "duplicate_workload_requirement_reference",
        "duplicate_workload_trigger_binding_id",
        "duplicate_workload_trigger_edge_binding",
      ]),
    );
  });

  it("rejects missing trigger and downstream edge references", async () => {
    const document = await representativeDocument();
    const [workload] = document.workloadBehavior.workloads;
    const [trigger] = workload?.triggers ?? [];
    const [action] = workload?.downstreamActions ?? [];
    if (
      workload === undefined ||
      trigger === undefined ||
      action === undefined
    ) {
      throw new Error("Representative fixture must contain edge bindings.");
    }

    const invalid = parseArchitectureDocumentV2({
      ...document,
      workloadBehavior: {
        ...document.workloadBehavior,
        workloads: [
          {
            ...workload,
            triggers: [{ ...trigger, edgeId: "edge_missing_trigger" }],
            downstreamActions: [
              { ...action, edgeId: "edge_missing_downstream" },
            ],
          },
        ],
      },
    });

    expect(
      validateArchitectureDocumentSemantics(invalid).map((issue) => issue.code),
    ).toEqual([
      "broken_workload_downstream_edge_reference",
      "broken_workload_trigger_edge_reference",
    ]);
  });

  it("rejects broken references and wrong trigger/action ownership deterministically", async () => {
    const document = await representativeDocument();
    const [workload] = document.workloadBehavior.workloads;
    const [trigger] = workload?.triggers ?? [];
    const [action] = workload?.downstreamActions ?? [];
    const [environment] = workload?.environment ?? [];
    if (
      workload === undefined ||
      trigger === undefined ||
      action === undefined ||
      environment === undefined
    ) {
      throw new Error(
        "Representative fixture must populate workload bindings.",
      );
    }

    const invalid = parseArchitectureDocumentV2({
      ...document,
      workloadBehavior: {
        ...document.workloadBehavior,
        workloads: [
          {
            ...workload,
            owningNodeId: "node_missing",
            triggers: [
              {
                ...trigger,
                edgeId: action.edgeId,
                targetOperationId: "operation_missing",
              },
            ],
            downstreamActions: [
              {
                ...action,
                edgeId: trigger.edgeId,
                sourceOperationId: "operation_missing",
              },
            ],
            environment: [
              {
                ...environment,
                value: {
                  kind: "variable-reference",
                  variableId: "variable_missing",
                },
              },
              {
                ...environment,
                id: "workload_env_missing_node",
                name: "MISSING_NODE",
                value: {
                  kind: "node-attribute-reference",
                  nodeId: "node_missing",
                  attribute: "example.node.id",
                },
              },
            ],
            triggerDispatch: {
              mode: "user-provided",
              dispatcherOperationId: "operation_missing",
            },
            unresolvedRequirementIds: ["requirement_missing"],
          },
        ],
      },
    });
    const issues = validateArchitectureDocumentSemantics(invalid);

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "broken_workload_dispatcher_operation_reference",
        "broken_workload_downstream_operation_reference",
        "broken_workload_environment_node_reference",
        "broken_workload_environment_variable_reference",
        "broken_workload_owner_reference",
        "broken_workload_requirement_reference",
        "broken_workload_trigger_operation_reference",
        "invalid_workload_downstream_edge_ownership",
        "invalid_workload_trigger_edge_ownership",
      ]),
    );
    expect(issues).toEqual(
      [...issues].sort(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          left.code.localeCompare(right.code) ||
          left.message.localeCompare(right.message),
      ),
    );
    expect(() => parseArchitectureDocument(invalid)).toThrow(
      ArchitectureDocumentSemanticError,
    );
  });
});
