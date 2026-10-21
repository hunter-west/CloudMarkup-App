import {
  createValidationDocumentationId,
  createValidationDocumentationPath,
  createValidationDocumentPath,
  createValidationFindingCode,
  defineValidationRuleV1,
  getArchitectureDocumentHashes,
  parseArchitectureDocument,
  validateArchitectureDocumentWithRules,
  type ValidationFinding,
  type ValidationFindingCandidate,
  type ValidationReport,
  type ValidationSeverity,
} from "@cloudmarkup/domain";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "../../../notifications/index.js";
import {
  ModePreferenceProvider,
  type ExperienceMode,
  type ModePreferenceStorage,
} from "../../../preferences/index.js";
import { ModeSwitch } from "../../../preferences/ModeSwitch.js";
import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import {
  awsEditorArchitectureInput,
  loadDynamoDbEncryptionFixArchitectureDocument,
} from "../../../provider-catalog/aws-editor-fixture.js";
import { awsEditorValidationEvaluator } from "../../../provider-catalog/aws-editor-validation.js";
import { awsIconRegistry } from "../../../provider-icons/aws-icon-registry.js";
import { EditorSessionProvider } from "../session/index.js";
import type {
  EditorValidationEvaluationRequest,
  EditorValidationEvaluator,
} from "./editor-validation.js";
import { IssuesPanel, type AiRepairAvailability } from "./IssuesPanel.js";
import {
  VALIDATION_FILTERS,
  VALIDATION_SEVERITY_PRESENTATION,
} from "./validation-presentation.js";

const validationStylesPath = join(
  process.cwd(),
  "src",
  "features",
  "editor",
  "validation",
  "validation.css",
);
const validationStyles = readFileSync(
  existsSync(validationStylesPath)
    ? validationStylesPath
    : join(
        process.cwd(),
        "apps",
        "web",
        "src",
        "features",
        "editor",
        "validation",
        "validation.css",
      ),
  "utf8",
);

const severities: readonly ValidationSeverity[] = [
  "error",
  "security-error",
  "warning",
  "cost-warning",
  "recommendation",
  "educational-note",
];

function emptyAwsDocument() {
  return parseArchitectureDocument({
    ...structuredClone(awsEditorArchitectureInput),
    edges: [],
    nodes: [],
    workloadBehavior: {
      contractVersion: 1,
      workloads: [],
    },
  });
}

const allSeverityCandidates: readonly ValidationFindingCandidate[] =
  severities.map((severity) => ({
    affected: [
      {
        kind: "document",
        path: createValidationDocumentPath("$"),
      },
    ],
    beginnerExplanation: `Plain-language ${severity}`,
    code: createValidationFindingCode(`test.validation.issues.${severity}`),
    documentationReferences:
      severity === "error"
        ? [
            {
              id: createValidationDocumentationId(
                "cloudmarkup.docs.testing.validation-issues",
              ),
              kind: "cloudmarkup-document",
              path: createValidationDocumentationPath(
                "docs/architecture/TESTING_STRATEGY.md#browser-end-to-end-tests",
              ),
              title: "Validation testing",
            },
          ]
        : [],
    severity,
    technicalExplanation: `Technical ${severity}`,
    title: `Finding ${severity}`,
  }));

const allSeverityRule = defineValidationRuleV1({
  applicability: {
    catalogs: { kind: "all" as const },
    environments: ["unknown" as const],
    providers: { kind: "all" as const },
    targets: ["draft" as const, "compilation" as const],
  },
  evaluate: () => allSeverityCandidates,
  id: "test.validation.issues-all-severities",
  input: "architecture-document" as const,
  interfaceVersion: 1 as const,
  ruleVersion: "1.0.0" as const,
});

const allSeverityEvaluator: EditorValidationEvaluator = {
  environment: "unknown",
  evaluate({ document, target }) {
    return validateArchitectureDocumentWithRules({
      additionalRules: [allSeverityRule],
      document,
      environment: "unknown",
      target,
    });
  },
};

function modeStorage(mode: ExperienceMode): ModePreferenceStorage {
  return {
    getItem: () => mode,
    setItem: () => undefined,
  };
}

function markupSignature(root: HTMLElement): readonly string[] {
  return [root, ...root.querySelectorAll<HTMLElement>("*")].map((element) =>
    [
      element.tagName,
      element.getAttribute("class") ?? "",
      element.getAttribute("role") ?? "",
      element.getAttribute("type") ?? "",
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("href") ?? "",
    ].join("|"),
  );
}

let renderSequence = 0;

function renderIssues({
  document = emptyAwsDocument(),
  evaluator,
  mode = "guided",
  onRequestAiFix,
  getAiRepairAvailability,
}: {
  readonly document?: ReturnType<typeof emptyAwsDocument>;
  readonly evaluator: EditorValidationEvaluator;
  readonly mode?: ExperienceMode;
  readonly onRequestAiFix?: (finding: ValidationFinding) => void;
  readonly getAiRepairAvailability?: (
    finding: ValidationFinding,
  ) => AiRepairAvailability;
}) {
  renderSequence += 1;
  let commandSequence = 0;

  return render(
    <NotificationProvider>
      <ModePreferenceProvider
        actorId={`validation-issues-${String(renderSequence)}`}
        storage={modeStorage(mode)}
      >
        <EditorSessionProvider
          catalog={awsEditorCatalog}
          createId={() => {
            commandSequence += 1;
            return `validation_issues_command_${String(commandSequence)}`;
          }}
          document={document}
          iconRegistry={awsIconRegistry}
          scopeKey={`validation-issues-${String(renderSequence)}`}
          validationDebounceMilliseconds={0}
          validationEvaluator={evaluator}
        >
          <ModeSwitch />
          <IssuesPanel
            {...(onRequestAiFix ? { onRequestAiFix } : {})}
            {...(getAiRepairAvailability ? { getAiRepairAvailability } : {})}
          />
        </EditorSessionProvider>
      </ModePreferenceProvider>
    </NotificationProvider>,
  );
}

function baseReport(
  request: EditorValidationEvaluationRequest,
): ValidationReport {
  return validateArchitectureDocumentWithRules({
    document: request.document,
    environment: "unknown",
    target: request.target,
  });
}

describe("IssuesPanel validation states and presentation", () => {
  it("keeps only the compact target and filter strip sticky", async () => {
    renderIssues({ evaluator: allSeverityEvaluator });
    await screen.findByText("Current and complete");

    const controls = document.querySelector<HTMLElement>(
      ".validation-issues__controls",
    );
    const header = document.querySelector<HTMLElement>(
      ".validation-issues__header",
    );
    const description = document.querySelector<HTMLElement>(
      ".validation-target-description",
    );
    const layout = document.querySelector<HTMLElement>(
      ".validation-issues__layout",
    );
    if (
      controls === null ||
      header === null ||
      description === null ||
      layout === null
    ) {
      throw new Error(
        "Expected Issues header, controls, description, and layout.",
      );
    }

    expect(
      within(controls).queryByRole("heading", { name: "Issues" }),
    ).toBeNull();
    expect(controls.contains(header)).toBe(false);
    expect(controls.contains(description)).toBe(false);
    expect(
      within(header).getByRole("heading", { name: "Issues" }),
    ).toBeVisible();
    expect(
      within(controls).getByRole("combobox", { name: "Validation target" }),
    ).toBeVisible();
    expect(
      within(controls).getByRole("group", {
        name: "Filter finding categories",
      }),
    ).toBeVisible();
    expect(
      within(controls).getByText("Filter finding categories", {
        selector: "legend",
      }),
    ).toHaveClass("visually-hidden");
    expect(
      header.compareDocumentPosition(controls) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      controls.compareDocumentPosition(layout) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    const controlsRule = /\.validation-issues__controls \{[^}]*\}/u.exec(
      validationStyles,
    )?.[0];
    if (controlsRule === undefined) {
      throw new Error("Expected the Issues controls stylesheet rule.");
    }
    expect(controlsRule).toContain("display: flex;");
    expect(controlsRule).toContain(
      "padding: var(--cm-space-2) var(--cm-space-3);",
    );
    expect(controlsRule).toContain(
      "margin-inline: calc(var(--cm-space-3) * -1);",
    );
    expect(controlsRule).toContain("inset-block-start: 0;");
    expect(controlsRule).toContain("position: sticky;");
    expect(controlsRule).toContain("z-index: var(--cm-z-base);");
    expect(controlsRule).not.toMatch(
      /(?:overflow(?:-[a-z]+)?|max-(?:block-size|height))\s*:/u,
    );
    expect(validationStyles).toMatch(
      /\.validation-issues__controls \{[^}]*background: var\(--cm-color-surface\);[^}]*z-index: var\(--cm-z-base\);/u,
    );
    expect(validationStyles).not.toMatch(
      /\.validation-(?:issues(?:__controls|__layout)?|findings-tree|finding-detail) \{[^}]*(?:overflow(?:-[a-z]+)?|max-(?:block-size|height))\s*:/u,
    );
  });

  it.each([
    ["minimum", "160px"],
    ["default", "200px"],
    ["tall", "480px"],
  ] as const)(
    "keeps findings and selected detail reachable at the %s Workspace height",
    async (_label, blockSize) => {
      renderIssues({ evaluator: allSeverityEvaluator });
      await screen.findByText("Current and complete");

      const issues = document.querySelector<HTMLElement>(
        "#validation-issues-panel",
      );
      const controls = document.querySelector<HTMLElement>(
        ".validation-issues__controls",
      );
      if (issues === null || controls === null) {
        throw new Error("Expected the Issues panel and compact controls.");
      }
      issues.style.blockSize = blockSize;

      const navigation = within(issues).getByRole("navigation", {
        name: "Validation findings",
      });
      const findingButton = within(navigation).getByRole("button", {
        name: "Finding error",
      });
      fireEvent.click(findingButton);
      const detail = within(issues).getByRole("article");

      expect(
        within(controls).getByRole("combobox", { name: "Validation target" }),
      ).toBeVisible();
      expect(
        within(controls).getByRole("group", {
          name: "Filter finding categories",
        }),
      ).toBeVisible();
      expect(findingButton).toBeVisible();
      expect(
        within(detail).getByRole("heading", { name: "Finding error" }),
      ).toBeVisible();
      expect(
        within(detail).getByRole("button", {
          name: "Go to project",
        }),
      ).toBeVisible();
      expect(issues.contains(navigation)).toBe(true);
      expect(issues.contains(detail)).toBe(true);
      expect(
        controls.compareDocumentPosition(navigation) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
      expect(
        controls.compareDocumentPosition(detail) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
    },
  );

  it("filters findings and dismisses contextual learning without changing canonical identities", async () => {
    const document = emptyAwsDocument();
    const initialHashes = getArchitectureDocumentHashes(document);
    const initialReport = await allSeverityEvaluator.evaluate({
      document,
      target: "draft",
    });
    const initialFinding = initialReport.findings.find(
      (finding) => finding.severity === "error",
    );
    if (initialFinding === undefined) {
      throw new Error(
        "The all-severity fixture must include an error finding.",
      );
    }

    renderIssues({
      document,
      evaluator: allSeverityEvaluator,
      mode: "professional",
    });

    await screen.findByText("Current and complete");
    fireEvent.click(screen.getByRole("button", { name: initialFinding.title }));
    fireEvent.click(
      screen.getByText("Technical details", { selector: "summary" }),
    );
    expect(screen.getByText(initialFinding.findingId)).toBeVisible();
    expect(
      screen.getByText("Validation testing", { exact: false }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Hide learning links" }),
    );
    expect(
      screen.queryByText("Validation testing", { exact: false }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Show learning links" }),
    );
    expect(
      screen.getByText("Validation testing", { exact: false }),
    ).toBeVisible();

    const errorFilter = screen.getByRole("checkbox", { name: "Errors" });
    fireEvent.click(errorFilter);
    expect(errorFilter).not.toBeChecked();
    expect(
      screen.queryByRole("button", { name: initialFinding.title }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(initialFinding.findingId),
    ).not.toBeInTheDocument();

    fireEvent.click(errorFilter);
    fireEvent.click(screen.getByRole("button", { name: initialFinding.title }));
    expect(screen.getByText(initialFinding.findingId)).toBeInTheDocument();

    const finalReport = await allSeverityEvaluator.evaluate({
      document,
      target: "draft",
    });
    expect(getArchitectureDocumentHashes(document)).toEqual(initialHashes);
    expect(finalReport.documentHash).toBe(initialReport.documentHash);
    expect(
      finalReport.findings.find((finding) => finding.severity === "error")
        ?.findingId,
    ).toBe(initialFinding.findingId);
  });

  it("keeps warning review state isolated by validation target", async () => {
    renderIssues({ evaluator: allSeverityEvaluator });
    await screen.findByText("Current and complete");

    fireEvent.click(screen.getByRole("button", { name: "Finding warning" }));
    const draftReview = screen.getByRole("button", {
      name: "Mark reviewed this session",
    });
    fireEvent.click(draftReview);
    expect(draftReview).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".validation-readiness")).toHaveTextContent(
      "1 of 2 draft warnings and 0 of 2 compilation warnings",
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Validation target" }),
      { target: { value: "compilation" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Finding warning" }));
    const compilationReview = screen.getByRole("button", {
      name: "Mark reviewed this session",
    });
    expect(compilationReview).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(compilationReview);
    expect(document.querySelector(".validation-readiness")).toHaveTextContent(
      "1 of 2 draft warnings and 1 of 2 compilation warnings",
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Validation target" }),
      { target: { value: "draft" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Finding warning" }));
    expect(
      screen.getByRole("button", { name: "Reviewed this session" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps compilation finding controls and evidence in one live mode-independent tree", async () => {
    const document = emptyAwsDocument();
    const compilationOnlyRule = defineValidationRuleV1({
      applicability: {
        catalogs: { kind: "all" as const },
        environments: ["unknown" as const],
        providers: { kind: "all" as const },
        targets: ["compilation" as const],
      },
      evaluate: () => [
        {
          affected: [
            {
              kind: "document" as const,
              path: createValidationDocumentPath("$"),
            },
          ],
          beginnerExplanation: "This finding applies only during compilation.",
          code: createValidationFindingCode(
            "test.validation.issues.compilation-only",
          ),
          documentationReferences: [],
          severity: "error" as const,
          technicalExplanation:
            "The test evaluator emits this finding only for the compilation target.",
          title: "Compilation-only finding",
        },
      ],
      id: "test.validation.issues-compilation-only",
      input: "architecture-document" as const,
      interfaceVersion: 1 as const,
      ruleVersion: "1.0.0" as const,
    });
    const compilationOnlyEvaluator: EditorValidationEvaluator = {
      environment: "unknown",
      evaluate({ document: input, target }) {
        return validateArchitectureDocumentWithRules({
          additionalRules: [compilationOnlyRule],
          document: input,
          environment: "unknown",
          target,
        });
      },
    };
    const compilationReport = await compilationOnlyEvaluator.evaluate({
      document,
      target: "compilation",
    });
    const compilationOnlyFinding = compilationReport.findings.find(
      (finding) => finding.code === "test.validation.issues.compilation-only",
    );
    if (compilationOnlyFinding === undefined) {
      throw new Error(
        "The AWS fixture must include a compilation-only finding.",
      );
    }

    renderIssues({
      document,
      evaluator: compilationOnlyEvaluator,
    });
    await screen.findByText("Current and complete");
    expect(
      screen.queryByRole("button", { name: compilationOnlyFinding.title }),
    ).not.toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Validation target" }),
      { target: { value: "compilation" } },
    );

    const navigation = screen.getByRole("navigation", {
      name: "Validation findings",
    });
    const findingIds = [
      ...navigation.querySelectorAll<HTMLElement>(
        "[data-validation-finding-id]",
      ),
    ].map((entry) => entry.dataset["validationFindingId"]);
    const findingButton = within(navigation).getAllByRole("button", {
      name: compilationOnlyFinding.title,
    })[0];
    if (findingButton === undefined) {
      throw new Error("The compilation finding must be navigable.");
    }
    fireEvent.click(findingButton);

    const detail = screen.getByRole("article");
    const technicalSummary = within(detail).getByText("Technical details", {
      selector: "summary",
    });
    const technicalDetails = technicalSummary.closest("details");
    if (technicalDetails === null) {
      throw new Error("Expected finding technical details.");
    }
    const guidedMarkup = markupSignature(detail);
    expect(technicalDetails).not.toHaveAttribute("open");
    expect(
      within(detail).getByText(compilationOnlyFinding.technicalExplanation),
    ).not.toBeVisible();
    expect(
      within(detail).getByRole("button", {
        name: "Go to project",
      }),
    ).toBeVisible();
    expect(
      within(detail).queryByRole("button", { name: /\$/u }),
    ).not.toBeInTheDocument();
    fireEvent.click(technicalSummary);
    expect(screen.getByText(compilationOnlyFinding.findingId)).toBeVisible();
    expect(
      screen.getByText(/Target applicability \(evaluated locally\)/u),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Professional" }));

    expect(screen.getByRole("article")).toBe(detail);
    expect(
      screen.getByRole("navigation", { name: "Validation findings" }),
    ).toBe(navigation);
    expect(
      [
        ...navigation.querySelectorAll<HTMLElement>(
          "[data-validation-finding-id]",
        ),
      ].map((entry) => entry.dataset["validationFindingId"]),
    ).toEqual(findingIds);
    expect(
      within(detail).getByText("Technical details", { selector: "summary" }),
    ).toBe(technicalSummary);
    expect(technicalDetails).toHaveAttribute("open");
    expect(markupSignature(detail)).toEqual(guidedMarkup);
  });
  it("renders every severity with text and a supplemental non-color symbol in both modes", async () => {
    renderIssues({ evaluator: allSeverityEvaluator });

    await screen.findByText("Current and complete");
    const navigation = screen.getByRole("navigation", {
      name: "Validation findings",
    });
    expect(
      navigation.querySelectorAll("[data-validation-finding-navigation]"),
    ).toHaveLength(severities.length);

    for (const filter of VALIDATION_FILTERS) {
      const severity = filter.severities[0];
      const label = `${VALIDATION_SEVERITY_PRESENTATION[severity].label} (1)`;
      const labelElement = screen.getByText(label);
      const badge = labelElement.closest(".cm-status-badge");
      const symbol = badge?.querySelector<HTMLElement>(
        ".cm-status-badge__symbol",
      );

      expect(labelElement).toBeVisible();
      expect(symbol).toHaveAttribute("aria-hidden", "true");
      expect(symbol?.textContent.trim()).not.toBe("");
    }

    const detail = screen.getByRole("article");
    const technicalSummary = within(detail).getByText("Technical details", {
      selector: "summary",
    });
    const technicalDetails = technicalSummary.closest("details");
    if (technicalDetails === null) {
      throw new Error("Expected finding technical details.");
    }
    const guidedMarkup = markupSignature(detail);
    expect(
      screen.getByRole("heading", { name: "What happened" }),
    ).toBeVisible();
    expect(screen.getByText("Plain-language error")).toBeVisible();
    expect(screen.getByText("Finding ID")).toBeInTheDocument();
    expect(technicalDetails).not.toHaveAttribute("open");
    fireEvent.click(technicalSummary);

    fireEvent.click(screen.getByRole("button", { name: "Professional" }));

    expect(
      screen.getByRole("navigation", { name: "Validation findings" }),
    ).toBe(navigation);
    expect(screen.getByRole("article")).toBe(detail);
    expect(
      within(detail).getByText("Technical details", { selector: "summary" }),
    ).toBe(technicalSummary);
    expect(technicalDetails).toHaveAttribute("open");
    expect(markupSignature(detail)).toEqual(guidedMarkup);
    for (const severity of severities) {
      expect(
        within(navigation).getByRole("button", {
          name: new RegExp(`Finding ${severity}`, "u"),
        }),
      ).toBeVisible();
    }
    expect(
      screen.getByText(/Target applicability \(evaluated locally\)/u),
    ).toBeVisible();
    expect(screen.getByText("Finding ID")).toBeVisible();
    expect(screen.getByText("Technical error")).toBeVisible();
  });
  it("suppresses readiness while a previous complete report is stale", async () => {
    let evaluationCount = 0;
    const evaluator: EditorValidationEvaluator = {
      environment: "unknown",
      evaluate(request) {
        evaluationCount += 1;
        if (evaluationCount <= 2) {
          return baseReport(request);
        }
        return new Promise<ValidationReport>(() => undefined);
      },
    };
    renderIssues({ evaluator });

    expect(await screen.findByText("Local draft review")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Run validation" }));

    expect(
      await screen.findByText(
        "The displayed previous report is stale and cannot establish readiness or apply a fix.",
      ),
    ).toBeVisible();
    expect(
      screen.getAllByRole("heading", { name: "Readiness unavailable" }),
    ).not.toHaveLength(0);
    expect(screen.queryByText("Local draft review")).not.toBeInTheDocument();
  });

  it("never presents an incomplete zero-finding report as clean or ready", async () => {
    const evaluator: EditorValidationEvaluator = {
      environment: "unknown",
      evaluate(request) {
        const report = baseReport(request);
        return {
          ...report,
          diagnostics: [
            {
              code: "rule_execution_failed",
              message: "A synthetic rule did not complete.",
              path: createValidationDocumentPath("$"),
            },
          ],
          evaluationStatus: "incomplete",
        };
      },
    };
    renderIssues({ evaluator });

    await waitFor(() => {
      expect(
        screen.getAllByText("Validation incomplete").length,
      ).toBeGreaterThan(0);
    });
    expect(
      screen.getAllByRole("heading", { name: "Readiness unavailable" }),
    ).not.toHaveLength(0);
    expect(
      screen.getByText(
        "No findings are visible in this stale or incomplete draft report; readiness is unavailable.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Structurally valid")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No findings in the complete current draft report."),
    ).not.toBeInTheDocument();
  });
  it("withholds overall readiness when only compilation validation is incomplete", async () => {
    const evaluator: EditorValidationEvaluator = {
      environment: "unknown",
      evaluate(request) {
        const report = baseReport(request);
        if (request.target === "draft") {
          return report;
        }
        return {
          ...report,
          diagnostics: [
            {
              code: "rule_execution_failed",
              message: "A synthetic compilation rule did not complete.",
              path: createValidationDocumentPath("$"),
            },
          ],
          evaluationStatus: "incomplete",
        };
      },
    };
    renderIssues({ evaluator });

    await waitFor(() => {
      expect(
        screen.getAllByText("Validation incomplete").length,
      ).toBeGreaterThan(0);
    });
    expect(
      screen.getAllByRole("heading", { name: "Readiness unavailable" }),
    ).not.toHaveLength(0);
    expect(screen.queryByText("Local draft review")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByText("Validation engine diagnostics", { exact: false }),
    );
    expect(
      screen
        .getByText("Validation engine diagnostics", { exact: false })
        .closest("details"),
    ).toHaveTextContent("A synthetic compilation rule did not complete.");
  });
  it("keeps safe-fix disclosures and controls stable while assistance wording changes", async () => {
    renderIssues({
      document: loadDynamoDbEncryptionFixArchitectureDocument(),
      evaluator: awsEditorValidationEvaluator,
    });

    const findingButton = await screen.findByRole("button", {
      name: "DynamoDB encryption is not explicitly enabled",
    });
    fireEvent.click(findingButton);

    const detail = screen.getByRole("article");
    const reviewFix = within(detail).getByRole("button", {
      name: "Review safe fix",
    });
    const findingSummary = within(detail).getByText("Technical details", {
      selector: "summary",
    });
    const findingDetails = findingSummary.closest("details");
    if (findingDetails === null) {
      throw new Error("Expected finding technical details.");
    }
    const guidedFindingMarkup = markupSignature(detail);
    expect(findingDetails).not.toHaveAttribute("open");
    expect(within(detail).getByText(/Recommended next action:/u)).toBeVisible();
    fireEvent.click(findingSummary);

    fireEvent.click(screen.getByRole("button", { name: "Professional" }));

    expect(screen.getByRole("article")).toBe(detail);
    expect(
      within(detail).getByRole("button", { name: "Review safe fix" }),
    ).toBe(reviewFix);
    expect(
      within(detail).getByText("Technical details", { selector: "summary" }),
    ).toBe(findingSummary);
    expect(findingDetails).toHaveAttribute("open");
    expect(markupSignature(detail)).toEqual(guidedFindingMarkup);
    expect(
      within(detail).getByText(/inspect its exact atomic command batch/iu),
    ).toBeVisible();
    expect(
      within(detail).queryByText(/Recommended next action:/u),
    ).not.toBeInTheDocument();

    fireEvent.click(reviewFix);
    const dialog = screen.getByRole("dialog");
    const dialogSummary = within(dialog).getByText("Technical details", {
      selector: "summary",
    });
    const dialogDetails = dialogSummary.closest("details");
    if (dialogDetails === null) {
      throw new Error("Expected safe-fix technical details.");
    }
    const professionalDialogMarkup = markupSignature(dialog);
    expect(dialogDetails).not.toHaveAttribute("open");
    expect(within(dialog).getByText("Professional review")).toBeVisible();
    expect(
      within(dialog).getByText(
        /Inspect the complete, preconditioned Graph Command batch/u,
      ),
    ).toBeVisible();
    fireEvent.click(dialogSummary);
    const commandBatch = within(dialog).getByRole("region", {
      name: "Full Graph Command batch",
    });
    expect(commandBatch).toBeVisible();

    fireEvent.click(within(dialog).getByRole("button", { name: "Guided" }));

    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(
      within(dialog).getByText("Technical details", { selector: "summary" }),
    ).toBe(dialogSummary);
    expect(dialogDetails).toHaveAttribute("open");
    expect(
      within(dialog).getByRole("region", { name: "Full Graph Command batch" }),
    ).toBe(commandBatch);
    expect(markupSignature(dialog)).toEqual(professionalDialogMarkup);
    expect(within(dialog).getByText("Guided review")).toBeVisible();
    expect(
      within(dialog).getByText(/Recommended because the provider rule/u),
    ).toBeVisible();
  });

  it("requires manual action and hides fix review for a conflicting batch", async () => {
    const evaluator: EditorValidationEvaluator = {
      environment: "unknown",
      async evaluate(request) {
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
    renderIssues({
      document: loadDynamoDbEncryptionFixArchitectureDocument(),
      evaluator,
    });

    const findingButton = await screen.findByRole("button", {
      name: "DynamoDB encryption is not explicitly enabled",
    });
    fireEvent.click(findingButton);

    expect(screen.getByText("Manual action required")).toBeVisible();
    expect(
      screen.getByText(
        /proposed batch conflicts with one or more other reviewed changes/iu,
      ),
    ).toBeVisible();
    expect(screen.getByText(/^Conflicting finding IDs:/u)).not.toBeVisible();
    fireEvent.click(
      screen.getByText("Technical details", { selector: "summary" }),
    );
    expect(screen.getByText(/^Conflicting finding IDs:/u)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Review safe fix" }),
    ).not.toBeInTheDocument();
  });
});

it("hands a current finding to the reviewed AI flow only when available", async () => {
  const onRequestAiFix = vi.fn();
  renderIssues({ evaluator: allSeverityEvaluator, onRequestAiFix });
  await screen.findByText("Current and complete");
  fireEvent.click(screen.getByRole("button", { name: "Finding error" }));
  fireEvent.click(screen.getByRole("button", { name: "Review a fix with AI" }));
  expect(onRequestAiFix).toHaveBeenCalledWith(
    expect.objectContaining({
      code: "test.validation.issues.error",
      title: "Finding error",
    }),
  );
});
it("does not advertise an unavailable AI fix action", async () => {
  renderIssues({ evaluator: allSeverityEvaluator });
  await screen.findByText("Current and complete");
  fireEvent.click(screen.getByRole("button", { name: "Finding error" }));
  expect(
    screen.queryByRole("button", { name: "Review a fix with AI" }),
  ).not.toBeInTheDocument();
});

it("explains unavailable AI review and retains manual recovery when eligibility guidance fails", async () => {
  const onRequestAiFix = vi.fn();
  const getAiRepairAvailability = vi.fn((): AiRepairAvailability => ({
    available: false,
    reason: "This finding requires manual configuration.",
  }));
  renderIssues({
    evaluator: allSeverityEvaluator,
    onRequestAiFix,
    getAiRepairAvailability,
  });
  await screen.findByText("Current and complete");
  fireEvent.click(screen.getByRole("button", { name: "Finding error" }));
  const review = screen.getByRole("button", { name: "Review a fix with AI" });
  const reason = screen.getByText(
    "This finding requires manual configuration.",
  );
  expect(review).toBeDisabled();
  expect(review).toHaveAttribute("aria-describedby", reason.id);
  expect(screen.getByRole("button", { name: "Go to project" })).toBeEnabled();
  fireEvent.click(review);
  expect(onRequestAiFix).not.toHaveBeenCalled();
  getAiRepairAvailability.mockImplementation(() => {
    throw new Error("INTERNAL_PROVIDER_TRACE_SHOULD_NOT_RENDER");
  });
  fireEvent.click(screen.getByRole("button", { name: "Professional" }));
  expect(review).toBeDisabled();
  expect(
    screen.getByText(
      "AI review is unavailable for this finding. Use the manual review controls.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByText("INTERNAL_PROVIDER_TRACE_SHOULD_NOT_RENDER"),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Go to project" })).toBeEnabled();
  fireEvent.click(review);
  expect(onRequestAiFix).not.toHaveBeenCalled();
});
