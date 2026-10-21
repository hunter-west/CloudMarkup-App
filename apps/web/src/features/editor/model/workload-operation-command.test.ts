import {
  getArchitectureDocumentHashes,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import type { ApplicationContractRecordV1 } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { loadAwsEditorArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import {
  prepareWorkloadOperationCommand,
  resolveWorkloadOperationDraft,
  WorkloadOperationPreparationError,
  type WorkloadOperationDraft,
} from "./workload-operation-command.js";

const workloadId = "workload_notes_api_handler";
const operationId = "operation_handle_request";

function prepare(draft: WorkloadOperationDraft, suffix = "one") {
  return prepareWorkloadOperationCommand({
    commandId: `operation_behavior_${suffix}`,
    document: loadAwsEditorArchitectureDocument(),
    draft,
    inverseCommandId: `operation_behavior_${suffix}_inverse`,
    operationId,
    workloadId,
  });
}

const validDraft: WorkloadOperationDraft = {
  description:
    "Accept a note request, validate its portable fields, and return the saved note identifier.",
  displayName: "Save note",
  inputFields: [
    "noteId:uuid:internal:required",
    "body:string:confidential:required",
  ].join(String.fromCharCode(10)),
  outputFields: "noteId:uuid:internal:required",
};

type ManagedContractCollisionRole = "behavior" | "input" | "output";
type ApplicationContractSource =
  ApplicationContractRecordV1["provenance"]["source"];

const managedContractCollisionRoles: readonly ManagedContractCollisionRole[] = [
  "behavior",
  "input",
  "output",
];
const foreignContractSources: readonly Exclude<
  ApplicationContractSource,
  "designed"
>[] = [
  "repository-observation",
  "deterministic-generator",
  "ai-accepted",
  "migration",
];

function managedContractForRole(
  contracts: readonly ApplicationContractRecordV1[],
  role: ManagedContractCollisionRole,
): ApplicationContractRecordV1 {
  const contract = contracts.find((candidate) =>
    candidate.contractId.endsWith(`.${role}`),
  );
  if (contract === undefined) {
    throw new TypeError(`Expected a managed ${role} contract fixture.`);
  }
  return contract;
}

function documentWithManagedContractCollision(input: {
  readonly role: ManagedContractCollisionRole;
  readonly source: ApplicationContractSource;
  readonly sourceReferenceIds?: readonly string[];
}) {
  const document = loadAwsEditorArchitectureDocument();
  const prepared = prepare(validDraft, `collision_template_${input.role}`);
  const template = managedContractForRole(
    prepared.command.applicationContracts.contracts,
    input.role,
  );
  const collision = {
    ...structuredClone(template),
    ...(template.contractKind === "behavior-operation"
      ? {
          input: { kind: "none" as const },
          output: { kind: "none" as const },
        }
      : {}),
    provenance: {
      ...template.provenance,
      source: input.source,
      sourceReferenceIds:
        input.sourceReferenceIds ?? template.provenance.sourceReferenceIds,
    },
  };

  return parseArchitectureDocument({
    ...document,
    applicationContracts: {
      ...document.applicationContracts,
      contracts: [collision],
    },
  });
}

function expectManagedContractCollisionBlocked(
  document: ReturnType<typeof loadAwsEditorArchitectureDocument>,
  suffix: string,
): void {
  const before = getArchitectureDocumentHashes(document);
  const resolution = resolveWorkloadOperationDraft({
    document,
    fallbackDisplayName: "Fallback",
    operationId,
    workloadId,
  });

  expect(resolution).toEqual({
    editable: false,
    reason:
      "A reserved compact-editor contract identity is already owned by another source. Review that contract in the architecture source before changing it.",
  });
  try {
    prepareWorkloadOperationCommand({
      commandId: `operation_behavior_collision_${suffix}`,
      document,
      draft: validDraft,
      inverseCommandId: `operation_behavior_collision_${suffix}_inverse`,
      operationId,
      workloadId,
    });
    throw new Error("Expected managed contract ownership rejection.");
  } catch (error) {
    expect(error).toBeInstanceOf(WorkloadOperationPreparationError);
    expect((error as WorkloadOperationPreparationError).issues).toEqual([
      expect.objectContaining({
        code: "existing-contract-not-editable",
        path: "$.applicationContracts",
      }),
    ]);
  }
  expect(getArchitectureDocumentHashes(document)).toEqual(before);
}

describe("workload operation command preparation", () => {
  it("prepares one atomic workload and Application Contract replacement", () => {
    const document = loadAwsEditorArchitectureDocument();
    const prepared = prepareWorkloadOperationCommand({
      commandId: "operation_behavior_success",
      document,
      draft: validDraft,
      inverseCommandId: "operation_behavior_success_inverse",
      operationId,
      workloadId,
    });

    expect(prepared.command.kind).toBe(
      "replace-workload-and-application-contracts",
    );
    expect(prepared.command.expectedWorkloadBehavior).toEqual(
      document.workloadBehavior,
    );
    expect(prepared.command.expectedApplicationContracts).toEqual(
      document.applicationContracts,
    );
    expect(prepared.inputFieldCount).toBe(2);
    expect(prepared.outputFieldCount).toBe(1);
    expect(
      prepared.previewDocument.applicationContracts.contracts,
    ).toHaveLength(3);
    expect(
      prepared.previewDocument.applicationContracts.contracts.map(
        (contract) => contract.contractKind,
      ),
    ).toEqual(["behavior-operation", "data-entity", "data-entity"]);
    const workload = prepared.previewDocument.workloadBehavior.workloads.find(
      (candidate) => candidate.id === workloadId,
    );
    expect(workload?.behaviorContracts).toHaveLength(1);
    expect(workload?.operations[0]?.inputContract.kind).toBe(
      "contract-reference",
    );
    expect(workload?.operations[0]?.outputContract.kind).toBe(
      "contract-reference",
    );
    expect(prepared.previewHashes.visualHash).toBe(
      getArchitectureDocumentHashes(document).visualHash,
    );
    expect(prepared.previewHashes.contentHash).not.toBe(
      getArchitectureDocumentHashes(document).contentHash,
    );
  });

  it("projects the managed contract back into the same strict editor grammar", () => {
    const prepared = prepare(validDraft, "projection");
    const resolution = resolveWorkloadOperationDraft({
      document: prepared.previewDocument,
      fallbackDisplayName: "Fallback",
      operationId,
      workloadId,
    });

    expect(resolution).toEqual({
      draft: {
        ...validDraft,
        inputFields: [
          "body:string:confidential:required",
          "noteId:uuid:internal:required",
        ].join(String.fromCharCode(10)),
      },
      editable: true,
    });
  });

  it("records role-specific compact-editor ownership provenance", () => {
    const prepared = prepare(validDraft, "ownership_provenance");
    const ownerReferenceIds: Record<ManagedContractCollisionRole, string> = {
      behavior: "cloudmarkup.editor.workload-operation.behavior.v1",
      input: "cloudmarkup.editor.workload-operation.input.v1",
      output: "cloudmarkup.editor.workload-operation.output.v1",
    };

    for (const role of managedContractCollisionRoles) {
      const contract = managedContractForRole(
        prepared.command.applicationContracts.contracts,
        role,
      );
      expect(contract.provenance).toMatchObject({
        source: "designed",
        sourceReferenceIds: [ownerReferenceIds[role], operationId, workloadId],
      });
    }
  });

  it.each(managedContractCollisionRoles)(
    "refuses non-editor provenance at the managed %s identity",
    (role) => {
      for (const source of foreignContractSources) {
        const document = documentWithManagedContractCollision({
          role,
          source,
        });
        expectManagedContractCollisionBlocked(document, `${role}_${source}`);
      }
    },
  );

  it.each(managedContractCollisionRoles)(
    "refuses a designed contract without the %s editor-owner marker",
    (role) => {
      const document = documentWithManagedContractCollision({
        role,
        source: "designed",
        sourceReferenceIds: ["requirement_foreign_contract_owner"],
      });
      expectManagedContractCollisionBlocked(document, `${role}_foreign_owner`);
    },
  );

  it("is deterministic apart from command-envelope identities", () => {
    const first = prepare(validDraft, "deterministic_a");
    const second = prepare(validDraft, "deterministic_b");

    expect(first.command.workloadBehavior).toEqual(
      second.command.workloadBehavior,
    );
    expect(first.command.applicationContracts).toEqual(
      second.command.applicationContracts,
    );
    expect(first.previewHashes).toEqual(second.previewHashes);
  });

  it("keeps managed ownership IDs distinct when opaque IDs normalize alike", () => {
    const documentFor = (nextOperationId: string) => {
      const document = loadAwsEditorArchitectureDocument();
      return parseArchitectureDocument({
        ...document,
        workloadBehavior: {
          ...document.workloadBehavior,
          workloads: document.workloadBehavior.workloads.map((workload) => ({
            ...workload,
            operations: workload.operations.map((operation) => ({
              ...operation,
              id: nextOperationId,
            })),
          })),
        },
      });
    };
    const contractIdFor = (nextOperationId: string) => {
      const document = documentFor(nextOperationId);
      const prepared = prepareWorkloadOperationCommand({
        commandId: `operation_behavior_${nextOperationId}`,
        document,
        draft: validDraft,
        inverseCommandId: `operation_behavior_${nextOperationId}_inverse`,
        operationId: nextOperationId,
        workloadId,
      });
      return prepared.command.applicationContracts.contracts.find(
        (contract) => contract.contractKind === "behavior-operation",
      )?.contractId;
    };

    expect(contractIdFor("operation-a-b")).not.toBe(
      contractIdFor("operation-a_b"),
    );
  });

  it.each([
    {
      label: "unknown field type",
      draft: { ...validDraft, inputFields: "value:object:internal:required" },
    },
    {
      label: "missing classification",
      draft: { ...validDraft, inputFields: "value:string:required" },
    },
    {
      label: "duplicate field",
      draft: {
        ...validDraft,
        inputFields: [
          "value:string:internal:required",
          "value:string:internal:optional",
        ].join(String.fromCharCode(10)),
      },
    },
    {
      label: "control character",
      draft: {
        ...validDraft,
        description: `safe${String.fromCharCode(1)}unsafe`,
      },
    },
    {
      label: "bidirectional override",
      draft: {
        ...validDraft,
        description: `safe${String.fromCodePoint(8_238)}unsafe`,
      },
    },
  ])("rejects $label without changing the document", ({ draft }) => {
    const document = loadAwsEditorArchitectureDocument();
    expect(() =>
      prepareWorkloadOperationCommand({
        commandId: "operation_behavior_invalid",
        document,
        draft,
        inverseCommandId: "operation_behavior_invalid_inverse",
        operationId,
        workloadId,
      }),
    ).toThrow(WorkloadOperationPreparationError);
    expect(document.applicationContracts.contracts).toEqual([]);
  });

  it("rejects credential values without reflecting them in diagnostics", () => {
    const sensitive = "must-never-appear";
    try {
      prepare({
        ...validDraft,
        description: `Save a note with password=${sensitive}`,
      });
      throw new Error("Expected credential rejection.");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkloadOperationPreparationError);
      expect((error as Error).message).not.toContain(sensitive);
    }
  });

  it("allows explicit no-input and no-output behavior without inventing fields", () => {
    const prepared = prepare({
      ...validDraft,
      inputFields: "",
      outputFields: "",
    });
    const operation =
      prepared.previewDocument.workloadBehavior.workloads[0]?.operations[0];

    expect(
      prepared.previewDocument.applicationContracts.contracts,
    ).toHaveLength(1);
    expect(operation?.inputContract).toEqual({ kind: "none" });
    expect(operation?.outputContract).toEqual({ kind: "none" });
  });
});
