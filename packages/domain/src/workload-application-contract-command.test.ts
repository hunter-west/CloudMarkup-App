import { readFile } from "node:fs/promises";

import {
  GraphCommandSchemaError,
  applicationContractRecordV1Schema,
  applicationContractsV1Schema,
  parseGraphCommandV1,
  parseGraphCommandV1Json,
  serializeArchitectureDocumentV3,
  serializeCanonicalJson,
  workloadBehaviorV2Schema,
  type ArchitectureDocumentV3,
  type GraphCommandV1,
  type ReplaceWorkloadAndApplicationContractsCommandV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  GraphCommandApplicationError,
  applyGraphCommand,
  getApplicationContractRecordContentHash,
  parseArchitectureDocument,
} from "./index.js";

async function representativeDocument(): Promise<ArchitectureDocumentV3> {
  return parseArchitectureDocument(
    JSON.parse(
      await readFile(
        new URL(
          "../../test-fixtures/fixtures/architecture-document/v3/valid/representative.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown,
  );
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function targetOf(document: ArchitectureDocumentV3) {
  return {
    documentId: document.documentId,
    architectureId: document.architectureId,
    revisionId: document.revision.revisionId,
  };
}

function commandEnvelope(
  document: ArchitectureDocumentV3,
  commandId: string,
  inverseCommandId = `${commandId}_inverse`,
) {
  return {
    schemaVersion: 1 as const,
    commandId,
    inverseCommandId,
    origin: "user" as const,
    target: targetOf(document),
  };
}

function exactReplacementCommand(
  document: ArchitectureDocumentV3,
  commandId = "operation_replace_solution_behavior",
): ReplaceWorkloadAndApplicationContractsCommandV1 {
  const workload = document.workloadBehavior.workloads[0];
  const operation = workload?.operations[0];
  if (workload === undefined || operation === undefined) {
    throw new Error(
      "Representative fixture must contain a workload operation.",
    );
  }

  const contract = applicationContractRecordV1Schema.parse({
    contractKind: "behavior-operation",
    contractId: "application.notes.process",
    contractVersion: "1.0.0",
    displayName: "Process notes",
    description:
      "Accepts the declared input contract and produces the declared output contract.",
    provenance: {
      source: "designed",
      sourceReferenceIds: ["requirement_notes_behavior"],
      recordedAt: document.revision.createdAt,
      recordedBy: document.revision.createdBy,
    },
    capability: operation.capability,
    input: { kind: "none" },
    output: { kind: "none" },
    failureOutcomes: [],
  });
  const reference = {
    contractKind: contract.contractKind,
    contractId: contract.contractId,
    contractVersion: contract.contractVersion,
    digest: getApplicationContractRecordContentHash(contract),
  };
  const workloadBehavior = workloadBehaviorV2Schema.parse({
    ...document.workloadBehavior,
    workloads: [
      {
        ...workload,
        behaviorContracts: [...workload.behaviorContracts, reference],
      },
      ...document.workloadBehavior.workloads.slice(1),
    ],
  });
  const applicationContracts = applicationContractsV1Schema.parse({
    ...document.applicationContracts,
    contracts: [...document.applicationContracts.contracts, contract],
  });
  const parsed = parseGraphCommandV1({
    ...commandEnvelope(document, commandId),
    kind: "replace-workload-and-application-contracts",
    expectedWorkloadBehavior: document.workloadBehavior,
    workloadBehavior,
    expectedApplicationContracts: document.applicationContracts,
    applicationContracts,
  });

  if (parsed.kind !== "replace-workload-and-application-contracts") {
    throw new Error("Expected a workload/application-contract replacement.");
  }
  return parsed;
}

function availableInverse(
  inversion: ReturnType<typeof applyGraphCommand>["inversion"],
): GraphCommandV1 {
  if (inversion.kind !== "available") {
    throw new Error("Expected an available inverse command.");
  }
  return inversion.command;
}

function expectApplicationIssue(
  action: () => unknown,
  path: string,
  semanticCode?: string,
): void {
  try {
    action();
    throw new Error("Expected GraphCommandApplicationError.");
  } catch (error) {
    expect(error).toBeInstanceOf(GraphCommandApplicationError);
    const applicationError = error as GraphCommandApplicationError;
    expect(applicationError.issues.some((issue) => issue.path === path)).toBe(
      true,
    );
    if (semanticCode !== undefined) {
      expect(
        applicationError.issues.some(
          (issue) => issue.semanticCode === semanticCode,
        ),
      ).toBe(true);
    }
  }
}

describe("workload and Application Contract Graph Command", () => {
  it("atomically replaces both semantic sources and exposes an exact inverse", async () => {
    const document = await representativeDocument();
    const command = exactReplacementCommand(document);
    const documentBefore = serializeArchitectureDocumentV3(document);
    const commandBefore = serializeCanonicalJson(command);
    expect(parseGraphCommandV1Json(commandBefore)).toEqual(command);

    const applied = applyGraphCommand(document, command);

    expect(applied.document.workloadBehavior).toEqual(command.workloadBehavior);
    expect(applied.document.applicationContracts).toEqual(
      command.applicationContracts,
    );
    expect(applied.document.documentId).toBe(document.documentId);
    expect(applied.document.architectureId).toBe(document.architectureId);
    expect(applied.document.revision).toEqual(document.revision);
    expect(applied.changes).toEqual([
      {
        kind: "workload-and-application-contracts-replaced",
        commandId: command.commandId,
        previousWorkloadCount: 1,
        workloadCount: 1,
        previousApplicationContractCount: 0,
        applicationContractCount: 1,
      },
    ]);
    expect(serializeArchitectureDocumentV3(document)).toBe(documentBefore);
    expect(serializeCanonicalJson(command)).toBe(commandBefore);

    const inverse = availableInverse(applied.inversion);
    expect(inverse.kind).toBe("replace-workload-and-application-contracts");
    const undone = applyGraphCommand(applied.document, inverse);
    expect(serializeArchitectureDocumentV3(undone.document)).toBe(
      documentBefore,
    );
    expect(availableInverse(undone.inversion)).toEqual(command);
  });

  it("fails closed when either exact prior-value precondition is stale", async () => {
    const document = await representativeDocument();
    const command = exactReplacementCommand(document);
    const before = serializeArchitectureDocumentV3(document);
    const staleWorkload = parseGraphCommandV1({
      ...command,
      expectedWorkloadBehavior: workloadBehaviorV2Schema.parse({
        contractVersion: 2,
        workloads: [],
      }),
    });
    const staleContracts = parseGraphCommandV1({
      ...command,
      expectedApplicationContracts: command.applicationContracts,
    });

    expectApplicationIssue(
      () => applyGraphCommand(document, staleWorkload),
      "$.expectedWorkloadBehavior",
    );
    expectApplicationIssue(
      () => applyGraphCommand(document, staleContracts),
      "$.expectedApplicationContracts",
    );
    expect(serializeArchitectureDocumentV3(document)).toBe(before);
  });

  it("preserves contract-set, document, and revision identities", async () => {
    const document = await representativeDocument();
    const command = exactReplacementCommand(document);
    const cases: readonly {
      readonly path: string;
      readonly command: ReplaceWorkloadAndApplicationContractsCommandV1;
    }[] = [
      {
        path: "$.applicationContracts.documentId",
        command: {
          ...command,
          applicationContracts: {
            ...command.applicationContracts,
            documentId:
              "document_other" as typeof command.applicationContracts.documentId,
          },
        },
      },
      {
        path: "$.applicationContracts.revision",
        command: {
          ...command,
          applicationContracts: {
            ...command.applicationContracts,
            revision: {
              ...command.applicationContracts.revision,
              revisionId:
                "revision_other" as typeof command.applicationContracts.revision.revisionId,
            },
          },
        },
      },
      {
        path: "$.applicationContracts.contractSetId",
        command: {
          ...command,
          applicationContracts: {
            ...command.applicationContracts,
            contractSetId:
              "contract_set_other" as typeof command.applicationContracts.contractSetId,
          },
        },
      },
    ];
    const before = serializeArchitectureDocumentV3(document);

    cases.forEach((candidate) => {
      expectApplicationIssue(
        () => applyGraphCommand(document, candidate.command),
        candidate.path,
      );
    });
    expect(serializeArchitectureDocumentV3(document)).toBe(before);
  });

  it("rejects malformed, oversized, and executable-shaped untrusted fields through strict schemas", async () => {
    const document = await representativeDocument();
    const command = exactReplacementCommand(document);
    const malformed = cloneJson(command) as unknown as Record<string, unknown>;
    delete malformed["expectedApplicationContracts"];
    const oversized = cloneJson(command) as unknown as {
      applicationContracts: {
        contracts: Record<string, unknown>[];
      };
    };
    const contract = oversized.applicationContracts.contracts[0];
    if (contract === undefined) {
      throw new Error("Replacement must contain an Application Contract.");
    }
    contract["description"] = "x".repeat(8_001);
    const untrusted = cloneJson(command) as unknown as {
      workloadBehavior: {
        workloads: Record<string, unknown>[];
      };
    };
    const workload = untrusted.workloadBehavior.workloads[0];
    if (workload === undefined) {
      throw new Error("Replacement must contain a workload.");
    }
    workload["shellCommand"] = "must-not-appear-in-errors";

    expect(() => applyGraphCommand(document, malformed)).toThrow(
      GraphCommandSchemaError,
    );
    expect(() => applyGraphCommand(document, oversized)).toThrow(
      GraphCommandSchemaError,
    );
    try {
      applyGraphCommand(document, untrusted);
      throw new Error("Expected GraphCommandSchemaError.");
    } catch (error) {
      expect(error).toBeInstanceOf(GraphCommandSchemaError);
      expect((error as Error).message).not.toContain(
        "must-not-appear-in-errors",
      );
    }
  });

  it("rejects dangling references as one semantic atomic failure", async () => {
    const document = await representativeDocument();
    const command = exactReplacementCommand(document);
    const dangling = parseGraphCommandV1({
      ...command,
      commandId: "operation_replace_dangling",
      inverseCommandId: "operation_replace_dangling_inverse",
      applicationContracts: document.applicationContracts,
    });
    const before = serializeArchitectureDocumentV3(document);

    expectApplicationIssue(
      () => applyGraphCommand(document, dangling),
      "$.document.workloadBehavior.workloads[0].behaviorContracts[0]",
      "broken_application_contract_reference",
    );
    expect(serializeArchitectureDocumentV3(document)).toBe(before);
  });

  it("participates in successful and failed atomic batches without exposing intermediate state", async () => {
    const document = await representativeDocument();
    const command = exactReplacementCommand(
      document,
      "operation_batch_replace_behavior",
    );
    const node = document.nodes[0];
    if (node === undefined) {
      throw new Error("Representative fixture must contain a node.");
    }
    const move = {
      ...commandEnvelope(document, "operation_batch_move_behavior"),
      kind: "move-node" as const,
      nodeId: node.id,
      expectedPosition: node.presentation.position,
      position: {
        x: node.presentation.position.x + 24,
        y: node.presentation.position.y + 16,
      },
    };
    const batch = parseGraphCommandV1({
      ...commandEnvelope(document, "operation_batch_solution_behavior"),
      kind: "batch",
      commands: [move, command],
    });
    const before = serializeArchitectureDocumentV3(document);

    const applied = applyGraphCommand(document, batch);
    expect(applied.changes.map(({ kind }) => kind)).toEqual([
      "node-moved",
      "workload-and-application-contracts-replaced",
      "batch-applied",
    ]);
    const undone = applyGraphCommand(
      applied.document,
      availableInverse(applied.inversion),
    );
    expect(serializeArchitectureDocumentV3(undone.document)).toBe(before);

    const staleMove = {
      ...move,
      commandId: "operation_batch_stale_move_behavior",
      inverseCommandId: "operation_batch_stale_move_behavior_inverse",
      expectedPosition: { x: -999, y: -999 },
    };
    const failingBatch = parseGraphCommandV1({
      ...commandEnvelope(document, "operation_batch_solution_behavior_failure"),
      kind: "batch",
      commands: [command, staleMove],
    });
    expectApplicationIssue(
      () => applyGraphCommand(document, failingBatch),
      "$.commands[1].expectedPosition",
    );
    expect(serializeArchitectureDocumentV3(document)).toBe(before);
  });
});
