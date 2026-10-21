import {
  applyGraphCommand,
  getArchitectureDocumentHashes,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  operationIdSchema,
  parseGraphCommandV1,
  semanticVersionSchema,
  type ArchitectureNodeV1,
  type GraphCommandV1,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  canRedoEditorCommand,
  canUndoEditorCommand,
  createEditorCommandHistory,
  getEditorCommandHistorySummary,
  recordEditorCommand,
  redoEditorCommand,
  undoEditorCommand,
  type EditorCommandHistory,
  type EditorCommandHistoryRecordResult,
  type EditorCommandHistoryTransitionResult,
} from "./editor-command-history.js";
import { loadFoundationArchitectureDocument } from "./foundation-editor-fixture.js";
import { createMoveNodeCommand } from "./move-node-command.js";

function sequentialIds(prefix: string): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `${prefix}_${String(sequence)}`;
  };
}

function moveCommand(
  document: ArchitectureDocument,
  x: number,
  y: number,
  prefix: string,
  nodeId = "node_application",
): GraphCommandV1 {
  return createMoveNodeCommand({
    createId: sequentialIds(prefix),
    document,
    nodeId,
    position: { x, y },
  });
}

function successfulRecord(
  result: EditorCommandHistoryRecordResult,
): Extract<EditorCommandHistoryRecordResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result;
}

function successfulTransition(
  result: EditorCommandHistoryTransitionResult,
): Extract<EditorCommandHistoryTransitionResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result;
}

function applyAndRecord(
  history: EditorCommandHistory,
  document: ArchitectureDocument,
  command: GraphCommandV1,
  label: string,
): Extract<EditorCommandHistoryRecordResult, { ok: true }> {
  return successfulRecord(
    recordEditorCommand(
      history,
      command,
      applyGraphCommand(document, command),
      label,
    ),
  );
}

describe("editor Graph Command history", () => {
  it("undoes and redoes one command through the inverses returned by the domain", () => {
    const document = loadFoundationArchitectureDocument();
    const beforeHashes = getArchitectureDocumentHashes(document);
    const command = moveCommand(document, 56, 176, "operation_history_single");
    const recorded = applyAndRecord(
      createEditorCommandHistory(document),
      document,
      command,
      "Move Application",
    );

    expect(recorded.status).toBe("recorded");
    expect(recorded.history.entries).toHaveLength(1);
    expect(getEditorCommandHistorySummary(recorded.history)).toMatchObject({
      canRedo: false,
      canUndo: true,
      cursor: 1,
      entryCount: 1,
      undoLabel: "Move Application",
    });

    const undone = successfulTransition(
      undoEditorCommand(recorded.history, recorded.document),
    );
    expect(getArchitectureDocumentHashes(undone.document)).toEqual(
      beforeHashes,
    );
    expect(undone.history.entries[0]?.forwardCommand).toEqual(
      undone.application.inversion.kind === "available"
        ? undone.application.inversion.command
        : null,
    );
    expect(getEditorCommandHistorySummary(undone.history)).toMatchObject({
      canRedo: true,
      canUndo: false,
      redoLabel: "Move Application",
    });

    const redone = successfulTransition(
      redoEditorCommand(undone.history, undone.document),
    );
    expect(getArchitectureDocumentHashes(redone.document)).toEqual(
      getArchitectureDocumentHashes(recorded.document),
    );
    expect(redone.history.entries[0]?.undoCommand).toEqual(
      redone.application.inversion.kind === "available"
        ? redone.application.inversion.command
        : null,
    );
  });

  it("keeps an atomic batch as one history entry", () => {
    const document = loadFoundationArchitectureDocument();
    const applicationMove = moveCommand(
      document,
      64,
      184,
      "operation_history_batch_application",
    );
    const networkMove = moveCommand(
      document,
      96,
      56,
      "operation_history_batch_network",
      "node_network",
    );
    const batch = parseGraphCommandV1({
      schemaVersion: 1,
      commandId: "operation_history_batch",
      inverseCommandId: "operation_history_batch_inverse",
      origin: "user",
      target: applicationMove.target,
      kind: "batch",
      commands: [applicationMove, networkMove],
    });
    const recorded = applyAndRecord(
      createEditorCommandHistory(document),
      document,
      batch,
      "Arrange two resources",
    );

    expect(recorded.history.entries).toHaveLength(1);
    expect(recorded.history.entries[0]?.forwardCommand.kind).toBe("batch");
    const undone = successfulTransition(
      undoEditorCommand(recorded.history, recorded.document),
    );
    expect(getArchitectureDocumentHashes(undone.document)).toEqual(
      getArchitectureDocumentHashes(document),
    );
    expect(undone.application.changes.at(-1)).toMatchObject({
      commandCount: 2,
      kind: "batch-applied",
    });
    const redone = successfulTransition(
      redoEditorCommand(undone.history, undone.document),
    );
    expect(getArchitectureDocumentHashes(redone.document)).toEqual(
      getArchitectureDocumentHashes(recorded.document),
    );
  });

  it("invalidates redo only after a new changing command", () => {
    const document = loadFoundationArchitectureDocument();
    const first = applyAndRecord(
      createEditorCommandHistory(document),
      document,
      moveCommand(document, 52, 172, "operation_history_branch_first"),
      "First move",
    );
    const undone = successfulTransition(
      undoEditorCommand(first.history, first.document),
    );
    expect(canRedoEditorCommand(undone.history)).toBe(true);

    const noChange = moveCommand(
      undone.document,
      40,
      160,
      "operation_history_branch_no_change",
    );
    const ignored = applyAndRecord(
      undone.history,
      undone.document,
      noChange,
      "No move",
    );
    expect(ignored.status).toBe("no-change");
    expect(ignored.history).toBe(undone.history);
    expect(canRedoEditorCommand(ignored.history)).toBe(true);

    const replacement = moveCommand(
      ignored.document,
      68,
      188,
      "operation_history_branch_replacement",
    );
    const branched = applyAndRecord(
      ignored.history,
      ignored.document,
      replacement,
      "Replacement move",
    );
    expect(branched.history.entries).toHaveLength(1);
    expect(branched.history.cursor).toBe(1);
    expect(canRedoEditorCommand(branched.history)).toBe(false);
    expect(getEditorCommandHistorySummary(branched.history).undoLabel).toBe(
      "Replacement move",
    );
  });

  it("advances its validated checkpoint when the entry-count limit is crossed", () => {
    const original = loadFoundationArchitectureDocument();
    let document = original;
    let history = createEditorCommandHistory(original, { maxEntries: 2 });
    const acceptedDocuments: ArchitectureDocument[] = [];

    for (const [index, position] of [52, 64, 76].entries()) {
      const command = moveCommand(
        document,
        position,
        172 + index * 12,
        `operation_history_count_${String(index)}`,
      );
      const recorded = applyAndRecord(
        history,
        document,
        command,
        `Move ${String(index + 1)}`,
      );
      history = recorded.history;
      document = recorded.document;
      acceptedDocuments.push(document);
    }

    expect(history.entries).toHaveLength(2);
    expect(history.cursor).toBe(2);
    expect(history.barrier).toMatchObject({
      code: "history-truncated",
      kind: "limit",
    });
    expect(getArchitectureDocumentHashes(history.checkpoint)).toEqual(
      getArchitectureDocumentHashes(acceptedDocuments[0]),
    );

    const undoThird = successfulTransition(
      undoEditorCommand(history, document),
    );
    const undoSecond = successfulTransition(
      undoEditorCommand(undoThird.history, undoThird.document),
    );
    expect(getArchitectureDocumentHashes(undoSecond.document)).toEqual(
      getArchitectureDocumentHashes(acceptedDocuments[0]),
    );
    expect(canUndoEditorCommand(undoSecond.history)).toBe(false);
  });

  it("enforces the UTF-8 command budget and checkpoints an oversized entry", () => {
    const original = loadFoundationArchitectureDocument();
    const firstCommand = moveCommand(
      original,
      52,
      172,
      "operation_history_bytes_first",
    );
    const firstWide = applyAndRecord(
      createEditorCommandHistory(original),
      original,
      firstCommand,
      "First move",
    );
    const secondCommand = moveCommand(
      firstWide.document,
      64,
      184,
      "operation_history_bytes_second",
    );
    const secondWide = applyAndRecord(
      firstWide.history,
      firstWide.document,
      secondCommand,
      "Second move",
    );
    const firstBytes =
      firstWide.history.entries[0]?.serializedCommandBytes ?? 0;
    const secondBytes =
      secondWide.history.entries[1]?.serializedCommandBytes ?? 0;
    const oneEntryBudget = Math.max(firstBytes, secondBytes);

    const limitedFirst = applyAndRecord(
      createEditorCommandHistory(original, {
        maxSerializedCommandBytes: oneEntryBudget,
      }),
      original,
      firstCommand,
      "First move",
    );
    const limitedSecond = applyAndRecord(
      limitedFirst.history,
      limitedFirst.document,
      secondCommand,
      "Second move",
    );
    expect(limitedSecond.history.entries).toHaveLength(1);
    expect(limitedSecond.history.serializedCommandBytes).toBeLessThanOrEqual(
      oneEntryBudget,
    );
    expect(limitedSecond.history.barrier).toMatchObject({
      code: "history-truncated",
      kind: "limit",
    });
    expect(
      getArchitectureDocumentHashes(limitedSecond.history.checkpoint),
    ).toEqual(getArchitectureDocumentHashes(firstWide.document));

    const oversized = applyAndRecord(
      createEditorCommandHistory(original, {
        maxSerializedCommandBytes: firstBytes - 1,
      }),
      original,
      firstCommand,
      "Oversized move",
    );
    expect(oversized.status).toBe("checkpointed");
    expect(oversized.history.entries).toHaveLength(0);
    expect(oversized.history.barrier).toMatchObject({
      code: "entry-too-large",
      kind: "limit",
    });
    expect(getArchitectureDocumentHashes(oversized.history.checkpoint)).toEqual(
      getArchitectureDocumentHashes(oversized.document),
    );
  });

  it("turns a non-invertible mutation into a visible checkpoint barrier", () => {
    const original = loadFoundationArchitectureDocument();
    const source = original.nodes.find(
      (node) => node.id === "node_application",
    );
    if (source === undefined) {
      throw new Error("The fixture must contain the application node.");
    }
    const generatedNode: ArchitectureNodeV1 = {
      ...source,
      id: "node_history_generated" as ArchitectureNodeV1["id"],
      semantic: {
        ...source.semantic,
        deploymentKey:
          "history_generated" as ArchitectureNodeV1["semantic"]["deploymentKey"],
        lifecycle: {
          ownership: "generated",
          origin: "connection-rule",
          provenance: {
            generatorKind: "connection-rule",
            generatorId: "example.generator.history" as Extract<
              ArchitectureNodeV1["semantic"]["lifecycle"],
              { ownership: "generated" }
            >["provenance"]["generatorId"],
            generatorVersion: semanticVersionSchema.parse("1.0.0"),
            operationId: operationIdSchema.parse("operation_history_generator"),
            dependentNodeIds: [],
            dependentEdgeIds: [],
          },
        },
      },
    };
    const addGenerated = parseGraphCommandV1({
      schemaVersion: 1,
      commandId: "operation_history_add_generated",
      inverseCommandId: "operation_history_add_generated_inverse",
      origin: "connection-rule",
      target: {
        architectureId: original.architectureId,
        documentId: original.documentId,
        revisionId: original.revision.revisionId,
      },
      kind: "add-node",
      node: generatedNode,
    });
    const generatedDocument = applyGraphCommand(
      original,
      addGenerated,
    ).document;
    const prior = applyAndRecord(
      createEditorCommandHistory(generatedDocument),
      generatedDocument,
      moveCommand(
        generatedDocument,
        52,
        172,
        "operation_history_before_adoption",
      ),
      "Move before adoption",
    );
    const generated = prior.document.nodes.find(
      (node) => node.id === generatedNode.id,
    );
    if (generated?.semantic.lifecycle.ownership !== "generated") {
      throw new Error("The generated history node is unavailable.");
    }
    const adopt = parseGraphCommandV1({
      schemaVersion: 1,
      commandId: "operation_history_adopt_generated",
      inverseCommandId: "operation_history_adopt_generated_inverse",
      origin: "user",
      target: {
        architectureId: prior.document.architectureId,
        documentId: prior.document.documentId,
        revisionId: prior.document.revision.revisionId,
      },
      kind: "adopt-generated-resource",
      resource: { kind: "node", nodeId: generated.id },
      expectedLifecycle: generated.semantic.lifecycle,
      adoptedBy: "actor_history",
      adoptedAt: "2026-07-29T12:00:00Z",
    });
    const checkpointed = applyAndRecord(
      prior.history,
      prior.document,
      adopt,
      "Adopt generated node",
    );

    expect(checkpointed.status).toBe("checkpointed");
    expect(checkpointed.history.entries).toHaveLength(0);
    expect(checkpointed.history.barrier).toMatchObject({
      kind: "non-invertible",
      reason: { code: "adoption_requires_explicit_policy" },
    });
    expect(canUndoEditorCommand(checkpointed.history)).toBe(false);
    expect(
      getArchitectureDocumentHashes(checkpointed.history.checkpoint),
    ).toEqual(getArchitectureDocumentHashes(checkpointed.document));
  });

  it("fails closed and invalidates history when the current document is stale", () => {
    const original = loadFoundationArchitectureDocument();
    const recorded = applyAndRecord(
      createEditorCommandHistory(original),
      original,
      moveCommand(original, 52, 172, "operation_history_stale_recorded"),
      "Recorded move",
    );
    const externalCommand = moveCommand(
      recorded.document,
      80,
      200,
      "operation_history_stale_external",
    );
    const externalDocument = applyGraphCommand(
      recorded.document,
      externalCommand,
    ).document;
    const externalHashes = getArchitectureDocumentHashes(externalDocument);

    const rejected = undoEditorCommand(recorded.history, externalDocument);
    expect(rejected).toMatchObject({
      code: "current-document-mismatch",
      ok: false,
    });
    expect("document" in rejected).toBe(false);
    expect(rejected.history.entries).toHaveLength(0);
    expect(rejected.history.barrier).toMatchObject({
      code: "current-document-mismatch",
      kind: "invalidated",
    });
    expect(getArchitectureDocumentHashes(externalDocument)).toEqual(
      externalHashes,
    );
  });

  it("treats normalized collection order as nonsemantic during history replay", () => {
    const original = loadFoundationArchitectureDocument();
    const recorded = applyAndRecord(
      createEditorCommandHistory(original),
      original,
      moveCommand(original, 52, 172, "operation_history_reordered"),
      "Move before collection reorder",
    );
    const reordered = {
      ...recorded.document,
      edges: [...recorded.document.edges].reverse(),
      nodes: [...recorded.document.nodes].reverse(),
    };
    expect(getArchitectureDocumentHashes(reordered)).toEqual(
      getArchitectureDocumentHashes(recorded.document),
    );

    const undone = successfulTransition(
      undoEditorCommand(recorded.history, reordered),
    );
    const redone = successfulTransition(
      redoEditorCommand(undone.history, undone.document),
    );

    expect(getArchitectureDocumentHashes(redone.document)).toEqual(
      getArchitectureDocumentHashes(recorded.document),
    );
  });

  it("rejects a full-document mismatch even when both published hashes match", () => {
    const original = loadFoundationArchitectureDocument();
    const command = moveCommand(
      original,
      52,
      172,
      "operation_history_mismatch_expected",
    );
    const application = applyGraphCommand(original, command);
    const mismatchRevision = {
      ...application.document.applicationContracts.revision,
      createdAt: utcTimestampSchema.parse("2026-07-29T13:00:00Z"),
    };
    const auditOnlyMismatch: ArchitectureDocument = {
      ...application.document,
      revision: {
        ...application.document.revision,
        ...mismatchRevision,
      },
      applicationContracts: {
        ...application.document.applicationContracts,
        revision: mismatchRevision,
      },
      externalResources: {
        ...application.document.externalResources,
        revision: mismatchRevision,
      },
    };
    expect(getArchitectureDocumentHashes(auditOnlyMismatch)).toEqual(
      getArchitectureDocumentHashes(application.document),
    );
    const history = createEditorCommandHistory(original);
    const rejected = recordEditorCommand(
      history,
      command,
      {
        ...application,
        document: auditOnlyMismatch,
      },
      "Mismatched move",
    );

    expect(rejected).toMatchObject({
      code: "application-mismatch",
      history,
      ok: false,
    });
    expect(canUndoEditorCommand(rejected.history)).toBe(false);
    expect(rejected.history.barrier).toBeNull();
  });
});
