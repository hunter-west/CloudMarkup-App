import { describe, expect, it } from "vitest";

import {
  solutionExportWorkflowDiagnosticV1Schema,
  type SolutionExportWorkflowDiagnosticV1,
} from "./contracts.js";
import {
  diagnosticSourceReferences,
  mergeSanitizedWorkflowDiagnostics,
} from "./diagnostics.js";

function terraformDiagnostic(order: "forward" | "reverse") {
  return {
    code: "terraform.validation.reviewed-check-failed",
    edgeIds: order === "forward" ? ["edge_b", "edge_a"] : ["edge_a", "edge_b"],
    nodeIds: order === "forward" ? ["node_b", "node_a"] : ["node_a", "node_b"],
    ownedPolicyIds:
      order === "forward" ? ["policy_b", "policy_a"] : ["policy_a", "policy_b"],
    path: "infrastructure/main.tf",
    severity: "error" as const,
  };
}

describe("solution export workflow diagnostic provenance", () => {
  it("retains canonical Terraform node, edge, policy, and path references", () => {
    const diagnostics: SolutionExportWorkflowDiagnosticV1[] = [];

    mergeSanitizedWorkflowDiagnostics(
      diagnostics,
      "validate-infrastructure",
      "terraform-validation",
      [terraformDiagnostic("forward")],
    );

    expect(diagnostics).toMatchObject([
      {
        code: "terraform.validation.reviewed-check-failed",
        edgeId: "edge_a",
        nodeId: "node_a",
        origin: "terraform-validation",
        ownedPolicyId: "policy_a",
        path: "infrastructure/main.tf",
        severity: "error",
        stage: "validate-infrastructure",
      },
    ]);
    expect(diagnostics[0]?.recoveryReferences?.locations).toHaveLength(7);
    expect(diagnostics[0]?.recoveryReferences?.locations).toEqual(
      expect.arrayContaining([
        { kind: "node", id: "node_a" },
        { kind: "node", id: "node_b" },
        { kind: "edge", id: "edge_a" },
        { kind: "edge", id: "edge_b" },
        { kind: "owned-policy", id: "policy_a" },
        { kind: "owned-policy", id: "policy_b" },
        { kind: "repository", path: "infrastructure/main.tf" },
      ]),
    );
  });

  it("retains application workload and repository-path references", () => {
    const diagnostics: SolutionExportWorkflowDiagnosticV1[] = [];

    mergeSanitizedWorkflowDiagnostics(
      diagnostics,
      "generate-application",
      "application-generator",
      [
        {
          code: "application.generation.source-conflict",
          path: "application/src/handler.ts",
          severity: "error",
          workloadId: "workload_notes_api",
          references: [
            ...diagnosticSourceReferences({
              document: "architecture",
              nodeId: "node_worker",
              path: "$.nodes[2].semantic.configuration.values.health.startPeriodSeconds",
            }),
            ...diagnosticSourceReferences({
              document: "architecture",
              nodeId: "node_port",
              path: "$.semantic.configuration.values.containerPort",
            }),
          ],
        },
      ],
    );

    expect(diagnostics[0]).toMatchObject({
      path: "application/src/handler.ts",
      workloadId: "workload_notes_api",
    });
    expect(diagnostics[0]?.recoveryReferences?.locations).toContainEqual({
      kind: "node",
      id: "node_worker",
      fieldPath: ["health", "startPeriodSeconds"],
    });
    expect(diagnostics[0]?.recoveryReferences?.locations).toContainEqual({
      kind: "node",
      id: "node_port",
      fieldPath: ["containerPort"],
    });
  });

  it("is stable across input/reference order and keeps distinct source findings", () => {
    const forward: SolutionExportWorkflowDiagnosticV1[] = [];
    const reverse: SolutionExportWorkflowDiagnosticV1[] = [];
    const secondPath = {
      ...terraformDiagnostic("forward"),
      path: "infrastructure/outputs.tf",
    };

    mergeSanitizedWorkflowDiagnostics(
      forward,
      "validate-infrastructure",
      "terraform-validation",
      [
        terraformDiagnostic("forward"),
        secondPath,
        terraformDiagnostic("forward"),
      ],
    );
    mergeSanitizedWorkflowDiagnostics(
      reverse,
      "validate-infrastructure",
      "terraform-validation",
      [secondPath, terraformDiagnostic("reverse")],
    );

    expect(reverse).toEqual(forward);
    expect(forward).toHaveLength(2);
  });

  it.each([
    "../secret.tf",
    "C:/Users/operator/private.tf",
    "infrastructure\\private.tf",
  ])("fails closed without retaining an unsafe path: %s", (path) => {
    const diagnostics: SolutionExportWorkflowDiagnosticV1[] = [];

    mergeSanitizedWorkflowDiagnostics(
      diagnostics,
      "validate-infrastructure",
      "terraform-validation",
      [{ ...terraformDiagnostic("forward"), path }],
    );

    expect(diagnostics).toEqual([
      {
        code: "cloudmarkup.export.diagnostic-invalid",
        origin: "workflow",
        severity: "error",
        stage: "validate-infrastructure",
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain(path);
    expect(
      solutionExportWorkflowDiagnosticV1Schema.safeParse({
        ...diagnostics[0],
        path,
      }).success,
    ).toBe(false);
  });

  it("fails closed without retaining malformed opaque references", () => {
    const diagnostics: SolutionExportWorkflowDiagnosticV1[] = [];

    for (const invalid of [
      { nodeIds: ["node/goodbye"] },
      { nodeIds: Array.from({ length: 33 }, (_, i) => `node_${String(i)}`) },
      {
        references: [
          {
            kind: "node" as const,
            id: "node_worker",
            fieldPath: ["__proto__"],
          },
        ],
      },
    ]) {
      diagnostics.splice(0);
      mergeSanitizedWorkflowDiagnostics(
        diagnostics,
        "validate-infrastructure",
        "terraform-validation",
        [{ ...terraformDiagnostic("forward"), ...invalid }],
      );

      expect(diagnostics[0]).toEqual({
        code: "cloudmarkup.export.diagnostic-invalid",
        origin: "workflow",
        severity: "error",
        stage: "validate-infrastructure",
      });
    }
  });
});
