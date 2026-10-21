import {
  parseArchitectureDocument,
  type ValidationReport,
} from "@cloudmarkup/domain";
import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { awsEditorArchitectureInput } from "../../../provider-catalog/aws-editor-fixture.js";
import { awsEditorValidationEvaluator } from "../../../provider-catalog/aws-editor-validation.js";
import {
  createEditorSessionStore,
  type EditorSessionStore,
} from "../session/editor-session-store.js";
import {
  snapshotFromValidationState,
  type EditorValidationEvaluationRequest,
  type EditorValidationEvaluator,
} from "./editor-validation.js";
import { useEditorValidation } from "./use-editor-validation.js";

function documentAt(x: number) {
  const input = structuredClone(awsEditorArchitectureInput);
  return parseArchitectureDocument({
    ...input,
    nodes: input.nodes.map((node, index) =>
      index === 0
        ? {
            ...node,
            presentation: {
              ...node.presentation,
              position: { ...node.presentation.position, x },
            },
          }
        : node,
    ),
  });
}

function Harness({
  document,
  evaluator,
  sessionStore,
}: {
  readonly document: ReturnType<typeof documentAt>;
  readonly evaluator: EditorValidationEvaluator;
  readonly sessionStore?: EditorSessionStore;
}) {
  const [defaultStore] = useState(createEditorSessionStore);
  const store = sessionStore ?? defaultStore;
  const validation = useEditorValidation({
    debounceMilliseconds: 300,
    document,
    evaluator,
    sessionStore: store,
  });
  const snapshot = snapshotFromValidationState(validation.state);

  return (
    <div>
      <span data-testid="validation-status">{validation.state.status}</span>
      <span data-testid="validation-visual-hash">
        {snapshot?.hashes.visualHash ?? "none"}
      </span>
      <button onClick={validation.requestValidation} type="button">
        Run again
      </button>
    </div>
  );
}

interface DeferredEvaluation {
  readonly request: EditorValidationEvaluationRequest;
  complete(): Promise<void>;
}

function pendingEvaluationAt(
  pending: readonly DeferredEvaluation[],
  index: number,
): DeferredEvaluation {
  const evaluation = pending[index];
  if (evaluation === undefined) {
    throw new Error(`Missing deferred validation evaluation ${String(index)}.`);
  }
  return evaluation;
}

function controlledEvaluator(): {
  readonly evaluator: EditorValidationEvaluator;
  readonly pending: DeferredEvaluation[];
} {
  const pending: DeferredEvaluation[] = [];
  return {
    evaluator: {
      environment: "unknown",
      evaluate(request) {
        return new Promise<ValidationReport>((resolve, reject) => {
          pending.push({
            request,
            async complete() {
              try {
                resolve(await awsEditorValidationEvaluator.evaluate(request));
              } catch (error) {
                reject(
                  error instanceof Error ? error : new Error(String(error)),
                );
              }
            },
          });
        });
      },
    },
    pending,
  };
}

function withoutProviderBinding(report: ValidationReport): ValidationReport {
  const mutable = { ...report } as {
    -readonly [Key in keyof ValidationReport]: ValidationReport[Key];
  };
  delete mutable.provider;
  return mutable;
}
describe("editor validation controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces serialized edits and exposes scheduled, running, and current states", async () => {
    const evaluator = {
      environment: "unknown" as const,
      evaluate: vi.fn((request: EditorValidationEvaluationRequest) =>
        awsEditorValidationEvaluator.evaluate(request),
      ),
    } satisfies EditorValidationEvaluator;
    const firstDocument = documentAt(80);
    const sessionStore = createEditorSessionStore();
    sessionStore.getState().announce("Graph Command applied.");
    sessionStore.getState().announceValidation("Stale validation summary.");
    const { rerender } = render(
      <Harness
        document={firstDocument}
        evaluator={evaluator}
        sessionStore={sessionStore}
      />,
    );
    expect(sessionStore.getState().liveAnnouncement).toBe(
      "Graph Command applied.",
    );
    expect(sessionStore.getState().validationAnnouncement).toBe("");

    expect(screen.getByTestId("validation-status")).toHaveTextContent(
      "scheduled",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(evaluator.evaluate).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(evaluator.evaluate).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("validation-status")).toHaveTextContent(
      "current",
    );
    expect(sessionStore.getState().liveAnnouncement).toBe(
      "Graph Command applied.",
    );
    expect(sessionStore.getState().validationAnnouncement).toMatch(
      /^Draft validation (?:complete|incomplete): \d+ findings?\. Compilation validation (?:complete|incomplete): \d+ findings?\.$/u,
    );

    rerender(
      <Harness
        document={firstDocument}
        evaluator={evaluator}
        sessionStore={sessionStore}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(evaluator.evaluate).toHaveBeenCalledTimes(2);

    rerender(
      <Harness
        document={documentAt(96)}
        evaluator={evaluator}
        sessionStore={sessionStore}
      />,
    );
    expect(screen.getByTestId("validation-status")).toHaveTextContent(
      "scheduled",
    );
    expect(sessionStore.getState().validationAnnouncement).toBe("");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(evaluator.evaluate).toHaveBeenCalledTimes(4);
    expect(screen.getByTestId("validation-status")).toHaveTextContent(
      "current",
    );
    expect(sessionStore.getState().liveAnnouncement).toBe(
      "Graph Command applied.",
    );
    expect(sessionStore.getState().validationAnnouncement).toMatch(
      /^Draft validation (?:complete|incomplete): \d+ findings?\. Compilation validation (?:complete|incomplete): \d+ findings?\.$/u,
    );
  });

  it("keeps the running state observable while both target evaluations are pending", async () => {
    const controlled = controlledEvaluator();
    render(
      <Harness document={documentAt(80)} evaluator={controlled.evaluator} />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByTestId("validation-status")).toHaveTextContent(
      "running",
    );
    expect(controlled.pending).toHaveLength(2);

    await act(async () => {
      await pendingEvaluationAt(controlled.pending, 0).complete();
      await pendingEvaluationAt(controlled.pending, 1).complete();
      await Promise.resolve();
    });
    expect(screen.getByTestId("validation-status")).toHaveTextContent(
      "current",
    );
  });
  it("suppresses late reports from a superseded document generation", async () => {
    const controlled = controlledEvaluator();
    const firstDocument = documentAt(80);
    const secondDocument = documentAt(112);
    const { rerender } = render(
      <Harness document={firstDocument} evaluator={controlled.evaluator} />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(controlled.pending).toHaveLength(2);

    rerender(
      <Harness document={secondDocument} evaluator={controlled.evaluator} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(controlled.pending).toHaveLength(4);

    await act(async () => {
      await pendingEvaluationAt(controlled.pending, 2).complete();
      await pendingEvaluationAt(controlled.pending, 3).complete();
      await Promise.resolve();
    });
    expect(screen.getByTestId("validation-status")).toHaveTextContent(
      "current",
    );
    const currentVisualHash = screen.getByTestId(
      "validation-visual-hash",
    ).textContent;

    await act(async () => {
      await pendingEvaluationAt(controlled.pending, 0).complete();
      await pendingEvaluationAt(controlled.pending, 1).complete();
      await Promise.resolve();
    });
    expect(screen.getByTestId("validation-visual-hash").textContent).toBe(
      currentVisualHash,
    );
  });

  it("fails closed when reports omit the document provider binding", async () => {
    const evaluator = {
      environment: "unknown" as const,
      async evaluate(request: EditorValidationEvaluationRequest) {
        return withoutProviderBinding(
          await awsEditorValidationEvaluator.evaluate(request),
        );
      },
    } satisfies EditorValidationEvaluator;
    render(<Harness document={documentAt(80)} evaluator={evaluator} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByTestId("validation-status")).toHaveTextContent("failed");
  });
  it.each([
    ["report", { reportVersion: 2 }],
    ["engine", { engineVersion: "2.0.0" }],
  ] as const)(
    "fails closed when matching reports use an unsupported %s version",
    async (_versionKind, override) => {
      const evaluator = {
        environment: "unknown" as const,
        async evaluate(request: EditorValidationEvaluationRequest) {
          const report = await awsEditorValidationEvaluator.evaluate(request);
          return { ...report, ...override } as unknown as ValidationReport;
        },
      } satisfies EditorValidationEvaluator;
      render(<Harness document={documentAt(80)} evaluator={evaluator} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(screen.getByTestId("validation-status")).toHaveTextContent(
        "failed",
      );
    },
  );
  it("fails closed when paired reports use the wrong evaluator environment", async () => {
    const evaluator = {
      environment: "unknown" as const,
      async evaluate(request: EditorValidationEvaluationRequest) {
        const report = await awsEditorValidationEvaluator.evaluate(request);
        return { ...report, environment: "production" as const };
      },
    } satisfies EditorValidationEvaluator;
    render(<Harness document={documentAt(80)} evaluator={evaluator} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByTestId("validation-status")).toHaveTextContent("failed");
  });
  it("fails closed when the evaluator rejects and supports an explicit retry", async () => {
    const evaluator = {
      environment: "unknown" as const,
      evaluate: vi.fn(() => Promise.reject(new Error("synthetic failure"))),
    } satisfies EditorValidationEvaluator;
    const sessionStore = createEditorSessionStore();
    sessionStore.getState().announce("Graph Command applied.");
    render(
      <Harness
        document={documentAt(80)}
        evaluator={evaluator}
        sessionStore={sessionStore}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByTestId("validation-status")).toHaveTextContent("failed");
    expect(sessionStore.getState().liveAnnouncement).toBe(
      "Graph Command applied.",
    );
    expect(sessionStore.getState().validationAnnouncement).toBe(
      "Validation failed closed. The previous report, if any, is stale and cannot establish readiness.",
    );

    act(() => {
      screen.getByRole("button", { name: "Run again" }).click();
    });
    expect(screen.getByTestId("validation-status")).toHaveTextContent(
      "scheduled",
    );
    expect(sessionStore.getState().validationAnnouncement).toBe("");
  });
});
