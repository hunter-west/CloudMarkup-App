import {
  parseArchitectureDocument,
  type ValidationFinding,
} from "@cloudmarkup/domain";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { awsEditorArchitectureInput } from "../../../provider-catalog/aws-editor-fixture.js";
import { awsEditorValidationEvaluator } from "../../../provider-catalog/aws-editor-validation.js";
import { awsIconRegistry } from "../../../provider-icons/aws-icon-registry.js";
import {
  snapshotFromValidationState,
  type EditorValidationEvaluator,
  type EditorValidationTarget,
} from "../validation/editor-validation.js";
import { EditorSessionProvider } from "./EditorSessionProvider.js";
import {
  useEditorDocumentSession,
  useEditorSessionState,
} from "./editor-session-hooks.js";

function architectureWithoutTableEncryptionSetting() {
  const input = structuredClone(awsEditorArchitectureInput);
  const table = input.nodes.find((node) => node.id === "node_notes_table");
  if (table === undefined) {
    throw new Error("The AWS editor fixture must include the notes table.");
  }

  const values = table.semantic.configuration.values as Record<string, unknown>;
  if (!("serverSideEncryptionEnabled" in values)) {
    throw new Error("The AWS editor fixture must default table encryption.");
  }
  delete values["serverSideEncryptionEnabled"];

  return parseArchitectureDocument({
    ...input,
    nodes: input.nodes.filter((node) => node.id !== "node_imported_unknown"),
  });
}

function configurationBoolean(
  values: Readonly<Record<string, Readonly<ConfigurationValue>>>,
  property: string,
): boolean | undefined {
  const value = values[property];
  return value?.kind === "boolean" ? value.value : undefined;
}

type MutableValidationFinding = {
  -readonly [Key in keyof ValidationFinding]: ValidationFinding[Key];
};

function withoutAutoFix(finding: ValidationFinding): ValidationFinding {
  const copy = structuredClone(finding) as MutableValidationFinding;
  delete copy.autoFix;
  return copy;
}
function ValidationFixProbe({
  target = "draft",
}: {
  readonly target?: EditorValidationTarget;
}) {
  const session = useEditorDocumentSession();
  const announcement = useEditorSessionState((state) => state.liveAnnouncement);
  const [lastAction, setLastAction] = useState("none");
  const snapshot = snapshotFromValidationState(session.validation);
  const report =
    snapshot === null
      ? undefined
      : target === "draft"
        ? snapshot.draftReport
        : snapshot.compilationReport;
  const safeFinding = report?.findings.find(
    (finding) => finding.autoFix !== undefined,
  );
  const table =
    session.status === "ready"
      ? session.document.nodes.find((node) => node.id === "node_notes_table")
      : undefined;
  const encryption =
    table === undefined
      ? undefined
      : configurationBoolean(
          table.semantic.configuration.values,
          "serverSideEncryptionEnabled",
        );

  return (
    <div>
      <output data-testid="validation-status">
        {session.validation.status}
      </output>
      <output data-testid="validation-evaluation-status">
        {snapshot?.draftReport.evaluationStatus ?? "none"}
      </output>
      <output data-testid="compilation-validation-evaluation-status">
        {snapshot?.compilationReport.evaluationStatus ?? "none"}
      </output>
      <output data-testid="validation-fix">
        {safeFinding?.autoFix === undefined
          ? "none"
          : [
              safeFinding.findingId,
              safeFinding.autoFix.command.kind,
              String(safeFinding.autoFix.command.commands.length),
              String(safeFinding.autoFix.changes.length),
            ].join("|")}
      </output>
      <output data-testid="validation-fix-result-hash">
        {safeFinding?.autoFix?.resultingDocumentHash ?? "none"}
      </output>
      <output data-testid="validation-document-hash">
        {session.status === "ready"
          ? session.hashes.contentHash
          : "unavailable"}
      </output>
      <output data-testid="validation-encryption">
        {encryption === undefined ? "missing" : String(encryption)}
      </output>
      <output data-testid="validation-history">
        {[
          String(session.history.canUndo),
          String(session.history.canRedo),
          session.history.undoLabel ?? "none",
          session.history.redoLabel ?? "none",
        ].join("|")}
      </output>
      <output data-testid="validation-action">{lastAction}</output>
      <output data-testid="validation-announcement">{announcement}</output>

      <button
        onClick={() => {
          const result =
            safeFinding === undefined
              ? { message: "missing safe finding", ok: false as const }
              : session.applyValidationFix(safeFinding.findingId, target);
          setLastAction(result.ok ? "fix-applied" : result.message);
        }}
        type="button"
      >
        Apply validation fix
      </button>
      <button
        onClick={() => {
          if (session.status !== "ready" || safeFinding === undefined) {
            setLastAction("missing ready session or safe finding");
            return;
          }
          const tableNode = session.document.nodes.find(
            (node) => node.id === "node_notes_table",
          );
          if (tableNode === undefined) {
            setLastAction("missing table");
            return;
          }
          const move = session.moveNode(tableNode.id, {
            x: tableNode.presentation.position.x + 16,
            y: tableNode.presentation.position.y,
          });
          if (!move.ok) {
            setLastAction(move.message);
            return;
          }
          const result = session.applyValidationFix(
            safeFinding.findingId,
            target,
          );
          setLastAction(result.ok ? "unexpected-stale-fix" : result.message);
        }}
        type="button"
      >
        Move table then apply stale validation fix
      </button>
      <button
        onClick={() => {
          const result =
            safeFinding === undefined
              ? { message: "missing safe finding", ok: false as const }
              : session.applyValidationFix(
                  safeFinding.findingId,
                  "revision" as EditorValidationTarget,
                );
          setLastAction(result.ok ? "unexpected-revision-fix" : result.message);
        }}
        type="button"
      >
        Apply unsupported revision fix
      </button>
      <button
        onClick={() => {
          const result = session.undo();
          setLastAction(result.ok ? "undo-applied" : result.message);
        }}
        type="button"
      >
        Undo validation fix
      </button>
      <button
        onClick={() => {
          const result = session.redo();
          setLastAction(result.ok ? "redo-applied" : result.message);
        }}
        type="button"
      >
        Redo validation fix
      </button>
    </div>
  );
}

describe("EditorSessionProvider validation fixes", () => {
  it("applies a reviewed fix as one history batch and preserves atomic undo and redo", async () => {
    render(
      <EditorSessionProvider
        catalog={awsEditorCatalog}
        createId={() => "unused-validation-session-id"}
        document={architectureWithoutTableEncryptionSetting()}
        iconRegistry={awsIconRegistry}
        scopeKey="validation-safe-fix-session"
        validationDebounceMilliseconds={0}
        validationEvaluator={awsEditorValidationEvaluator}
      >
        <ValidationFixProbe />
      </EditorSessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("validation-status")).toHaveTextContent(
        "current",
      );
    });
    expect(
      screen.getByTestId("validation-evaluation-status"),
    ).toHaveTextContent("complete");
    expect(screen.getByTestId("validation-encryption")).toHaveTextContent(
      "missing",
    );
    expect(screen.getByTestId("validation-fix")).toHaveTextContent(
      "|batch|1|2",
    );
    const reviewedResultHash = screen.getByTestId(
      "validation-fix-result-hash",
    ).textContent;

    fireEvent.click(
      screen.getByRole("button", { name: "Apply validation fix" }),
    );

    expect(screen.getByTestId("validation-action")).toHaveTextContent(
      "fix-applied",
    );
    expect(screen.getByTestId("validation-encryption")).toHaveTextContent(
      "true",
    );
    expect(screen.getByTestId("validation-document-hash").textContent).toBe(
      reviewedResultHash,
    );
    expect(screen.getByTestId("validation-history")).toHaveTextContent(
      "true|false|Fix DynamoDB encryption is not explicitly enabled|none",
    );
    expect(screen.getByTestId("validation-announcement")).toHaveTextContent(
      "Validation fix applied as one confirmed atomic Graph Command batch.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Undo validation fix" }),
    );
    expect(screen.getByTestId("validation-action")).toHaveTextContent(
      "undo-applied",
    );
    expect(screen.getByTestId("validation-encryption")).toHaveTextContent(
      "missing",
    );
    expect(screen.getByTestId("validation-history")).toHaveTextContent(
      "false|true|none|Fix DynamoDB encryption is not explicitly enabled",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Redo validation fix" }),
    );
    expect(screen.getByTestId("validation-action")).toHaveTextContent(
      "redo-applied",
    );
    expect(screen.getByTestId("validation-encryption")).toHaveTextContent(
      "true",
    );
    expect(screen.getByTestId("validation-history")).toHaveTextContent(
      "true|false|Fix DynamoDB encryption is not explicitly enabled|none",
    );
  });
  it("applies an exact compilation fix when the same draft finding has no fix", async () => {
    const document = architectureWithoutTableEncryptionSetting();
    const evaluator: EditorValidationEvaluator = {
      environment: "unknown",
      async evaluate(request) {
        const report = await awsEditorValidationEvaluator.evaluate(request);
        return request.target === "draft"
          ? {
              ...report,
              findings: report.findings.map(withoutAutoFix),
            }
          : report;
      },
    };
    const draftReport = await evaluator.evaluate({
      document,
      target: "draft",
    });
    const compilationReport = await evaluator.evaluate({
      document,
      target: "compilation",
    });
    const compilationFix = compilationReport.findings.find(
      (finding) => finding.autoFix !== undefined,
    );
    if (compilationFix === undefined) {
      throw new Error("The compilation fixture must provide a safe fix.");
    }
    expect(
      draftReport.findings.find(
        (finding) => finding.findingId === compilationFix.findingId,
      )?.autoFix,
    ).toBeUndefined();

    render(
      <EditorSessionProvider
        catalog={awsEditorCatalog}
        createId={() => "unused-compilation-validation-id"}
        document={document}
        iconRegistry={awsIconRegistry}
        scopeKey="validation-compilation-fix-session"
        validationDebounceMilliseconds={0}
        validationEvaluator={evaluator}
      >
        <ValidationFixProbe target="compilation" />
      </EditorSessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("validation-status")).toHaveTextContent(
        "current",
      );
    });
    expect(screen.getByTestId("validation-fix")).toHaveTextContent(
      compilationFix.findingId,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply validation fix" }),
    );

    expect(screen.getByTestId("validation-action")).toHaveTextContent(
      "fix-applied",
    );
    expect(screen.getByTestId("validation-encryption")).toHaveTextContent(
      "true",
    );
    expect(screen.getByTestId("validation-history")).toHaveTextContent(
      "true|false|Fix DynamoDB encryption is not explicitly enabled|none",
    );
  });
  it("rejects an unsupported revision target instead of selecting a compilation fix", async () => {
    render(
      <EditorSessionProvider
        catalog={awsEditorCatalog}
        createId={() => "unused-revision-validation-id"}
        document={architectureWithoutTableEncryptionSetting()}
        iconRegistry={awsIconRegistry}
        scopeKey="validation-revision-fix-session"
        validationDebounceMilliseconds={0}
        validationEvaluator={awsEditorValidationEvaluator}
      >
        <ValidationFixProbe />
      </EditorSessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("validation-status")).toHaveTextContent(
        "current",
      );
    });
    expect(screen.getByTestId("validation-fix")).not.toHaveTextContent("none");

    fireEvent.click(
      screen.getByRole("button", { name: "Apply unsupported revision fix" }),
    );

    expect(screen.getByTestId("validation-action")).toHaveTextContent(
      "This finding has no reviewed safe auto-fix.",
    );
    expect(screen.getByTestId("validation-encryption")).toHaveTextContent(
      "missing",
    );
    expect(screen.getByTestId("validation-history")).toHaveTextContent(
      "false|false|none|none",
    );
  });

  it("refuses a draft auto-fix when only compilation validation is incomplete", async () => {
    const incompleteEvaluator = {
      environment: "unknown" as const,
      async evaluate(
        request: Parameters<typeof awsEditorValidationEvaluator.evaluate>[0],
      ) {
        const report = await awsEditorValidationEvaluator.evaluate(request);
        return request.target === "compilation"
          ? { ...report, evaluationStatus: "incomplete" as const }
          : report;
      },
    };
    render(
      <EditorSessionProvider
        catalog={awsEditorCatalog}
        createId={() => "unused-incomplete-validation-id"}
        document={architectureWithoutTableEncryptionSetting()}
        iconRegistry={awsIconRegistry}
        scopeKey="validation-incomplete-fix-session"
        validationDebounceMilliseconds={0}
        validationEvaluator={incompleteEvaluator}
      >
        <ValidationFixProbe />
      </EditorSessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("validation-status")).toHaveTextContent(
        "current",
      );
    });
    expect(
      screen.getByTestId("validation-evaluation-status"),
    ).toHaveTextContent("complete");
    expect(
      screen.getByTestId("compilation-validation-evaluation-status"),
    ).toHaveTextContent("incomplete");
    expect(screen.getByTestId("validation-fix")).not.toHaveTextContent("none");

    fireEvent.click(
      screen.getByRole("button", { name: "Apply validation fix" }),
    );

    expect(screen.getByTestId("validation-action")).toHaveTextContent(
      "A current, complete validation report is required before applying this fix.",
    );
    expect(screen.getByTestId("validation-encryption")).toHaveTextContent(
      "missing",
    );
    expect(screen.getByTestId("validation-history")).toHaveTextContent(
      "false|false|none|none",
    );
  });
  it("rejects a stale fix after a document move without adding fix history", async () => {
    let commandSequence = 0;
    render(
      <EditorSessionProvider
        catalog={awsEditorCatalog}
        createId={() => {
          commandSequence += 1;
          return `stale_validation_command_${String(commandSequence)}`;
        }}
        document={architectureWithoutTableEncryptionSetting()}
        iconRegistry={awsIconRegistry}
        scopeKey="validation-stale-fix-session"
        validationDebounceMilliseconds={0}
        validationEvaluator={awsEditorValidationEvaluator}
      >
        <ValidationFixProbe />
      </EditorSessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("validation-status")).toHaveTextContent(
        "current",
      );
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Move table then apply stale validation fix",
      }),
    );

    expect(screen.getByTestId("validation-action")).toHaveTextContent(
      "The validation fix is stale. Run validation again before reviewing it.",
    );
    expect(screen.getByTestId("validation-encryption")).toHaveTextContent(
      "missing",
    );
    expect(screen.getByTestId("validation-history")).toHaveTextContent(
      "true|false|Move Notes data|none",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Undo validation fix" }),
    );
    expect(screen.getByTestId("validation-history")).toHaveTextContent(
      "false|true|none|Move Notes data",
    );
    expect(screen.getByTestId("validation-encryption")).toHaveTextContent(
      "missing",
    );
  });

  it("rejects a validated auto-fix that conflicts with another finding", async () => {
    const conflictingEvaluator = {
      environment: "unknown" as const,
      async evaluate(
        request: Parameters<typeof awsEditorValidationEvaluator.evaluate>[0],
      ) {
        const report = await awsEditorValidationEvaluator.evaluate(request);
        if (request.target !== "draft") {
          return report;
        }
        return {
          ...report,
          findings: report.findings.map((finding) =>
            finding.autoFix === undefined
              ? finding
              : {
                  ...finding,
                  autoFix: {
                    ...finding.autoFix,
                    conflictsWithFindingIds: [finding.findingId],
                  },
                },
          ),
        };
      },
    };
    render(
      <EditorSessionProvider
        catalog={awsEditorCatalog}
        createId={() => "unused-conflicting-validation-id"}
        document={architectureWithoutTableEncryptionSetting()}
        iconRegistry={awsIconRegistry}
        scopeKey="validation-conflicting-fix-session"
        validationDebounceMilliseconds={0}
        validationEvaluator={conflictingEvaluator}
      >
        <ValidationFixProbe />
      </EditorSessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("validation-status")).toHaveTextContent(
        "current",
      );
    });
    expect(screen.getByTestId("validation-fix")).not.toHaveTextContent("none");
    fireEvent.click(
      screen.getByRole("button", { name: "Apply validation fix" }),
    );

    expect(screen.getByTestId("validation-action")).toHaveTextContent(
      "This auto-fix conflicts with another finding and cannot be applied automatically.",
    );
    expect(screen.getByTestId("validation-encryption")).toHaveTextContent(
      "missing",
    );
    expect(screen.getByTestId("validation-history")).toHaveTextContent(
      "false|false|none|none",
    );
  });
});
