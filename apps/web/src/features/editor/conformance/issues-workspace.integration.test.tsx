import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ExperiencePreferenceProvider,
  ModePreferenceProvider,
} from "../../../preferences/index.js";
import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { awsEditorArchitectureInput } from "../../../provider-catalog/aws-editor-fixture.js";
import { awsEditorValidationEvaluator } from "../../../provider-catalog/aws-editor-validation.js";
import { awsIconRegistry } from "../../../provider-icons/aws-icon-registry.js";
import { BottomWorkspacePanel } from "../EditorWorkspace.js";
import { EditorSessionProvider } from "../session/index.js";
import type { ContinuousConformanceReadModel } from "./model.js";

const report: ContinuousConformanceReadModel = {
  differences: [],
  environmentId: "environment.staging",
  environmentLabel: "Staging",
  issues: [
    {
      evidenceIds: ["evidence.plan.network"],
      issueId: "issue.plan.public-exposure",
      lifecycle: "current",
      severity: "security-error",
      source: "cloud-plan-change-set",
      summary: "A public network exposure requires review.",
    },
  ],
  layers: [],
  reportDigest: `sha256:${"a".repeat(64)}`,
  reportId: "report.issues.workspace",
  solutionRevisionId: "solution-revision.issues.workspace",
};

describe("shared Issues workspace continuous conformance integration", () => {
  it("renders server-authored conformance issues in the shared Issues tab", () => {
    render(
      <ModePreferenceProvider actorId="conformance-issues-test" storage={null}>
        <ExperiencePreferenceProvider
          actorId="conformance-issues-test"
          storage={null}
        >
          <EditorSessionProvider
            catalog={awsEditorCatalog}
            createId={() => "operation_conformance_issues_test"}
            document={awsEditorArchitectureInput}
            iconRegistry={awsIconRegistry}
            validationEvaluator={awsEditorValidationEvaluator}
          >
            <BottomWorkspacePanel
              activeTab="issues"
              conformanceReport={report}
              onActiveTabChange={() => undefined}
            />
          </EditorSessionProvider>
        </ExperiencePreferenceProvider>
      </ModePreferenceProvider>,
    );

    fireEvent.click(screen.getByText("Repository and export checks"));
    expect(screen.getByText("Active conformance issues (1)")).toBeVisible();
    expect(
      screen.getByText("A public network exposure requires review."),
    ).toBeVisible();
    expect(screen.getByText("cloud-plan-change-set")).toBeVisible();
    expect(
      screen.getByText(/cannot close an issue or remediate infrastructure/u),
    ).toBeVisible();
  });
});
