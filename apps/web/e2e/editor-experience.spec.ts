import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const projectsPath =
  "/organizations/local-org/projects?fixture=local-app" as const;
const editorPath =
  "/organizations/local-org/projects/field-notes/editor" as const;

function editor(page: Page): Locator {
  return page.locator(".architecture-editor");
}

function recoveryStatus(page: Page): Locator {
  return page.getByRole("region", { name: "Development fixture status" });
}

async function waitForEditorReady(page: Page): Promise<void> {
  await expect(editor(page)).toBeVisible({ timeout: 30_000 });
  await expect(recoveryStatus(page)).toContainText(
    "Local draft recovery is ready",
  );
}

async function expectPhoneArchitectureTarget(
  page: Page,
  region: string,
): Promise<void> {
  const desktopViewport = page.viewportSize();
  if (desktopViewport === null) {
    throw new Error(
      "The editor experience test requires a configured viewport.",
    );
  }

  const architectureTarget = page.getByTestId("architecture-document-target");
  await page.setViewportSize({ height: 844, width: 390 });
  try {
    await expect(architectureTarget).toBeVisible();
    await expect(architectureTarget).toHaveAttribute(
      "data-region-source",
      "preference",
    );
    await expect(architectureTarget).toHaveText(`Region ${region}`);
  } finally {
    await page.setViewportSize(desktopViewport);
  }
  await expect(architectureTarget).toHaveCount(0);
}

async function documentHashes(
  page: Page,
): Promise<{ readonly content: string; readonly visual: string }> {
  const content = await editor(page).getAttribute("data-content-hash");
  const visual = await editor(page).getAttribute("data-visual-hash");
  if (content === null || visual === null) {
    throw new Error("The editor did not expose both document hashes.");
  }
  return { content, visual };
}

async function runPaletteCommand(
  page: Page,
  query: string,
  commandName: string | RegExp,
): Promise<void> {
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  const search = palette.getByRole("searchbox", { name: "Search commands" });
  await expect(search).toBeFocused();
  await search.fill(query);
  const command = palette.getByRole("button", { name: commandName });
  await expect(command).toBeVisible();
  await search.press("ArrowDown");
  const availableCommandCount = await palette
    .locator(".editor-command-list__item:not(:disabled)")
    .count();
  for (let attempt = 0; attempt < availableCommandCount; attempt += 1) {
    if (
      await command.evaluate(
        (element) => element === element.ownerDocument.activeElement,
      )
    ) {
      break;
    }
    await page.keyboard.press("ArrowDown");
  }
  await expect(command).toBeFocused();
  await command.press("Enter");
  await expect(palette).toBeHidden();
}

async function openIssues(page: Page): Promise<Locator> {
  const issuesDialog = page.getByRole("dialog", { name: "Issues workspace" });
  if (!(await issuesDialog.isVisible())) {
    const desktopIssues = page
      .getByRole("navigation", { name: "Workspace tools" })
      .getByRole("button", { exact: true, name: "Issues" });
    const phoneIssues = page
      .getByRole("navigation", { name: "Phone workspace navigation" })
      .getByRole("button", { exact: true, name: "Issues" });
    if (await desktopIssues.isVisible()) {
      await desktopIssues.click();
    } else if (await phoneIssues.isVisible()) {
      await phoneIssues.click();
    } else {
      await page
        .getByRole("button", { exact: true, name: "Workspace" })
        .click();
      const issuesTab = page.getByRole("tab", { name: "Issues" });
      await expect(issuesTab).toBeVisible();
      if ((await issuesTab.getAttribute("aria-selected")) !== "true") {
        await issuesTab.click();
      }
    }
  }
  await expect(issuesDialog).toBeVisible();
  const issues = issuesDialog.locator("#validation-issues-panel");
  await expect(issues).toBeVisible();
  await expect(issues).toHaveAttribute("data-validation-current", "true", {
    timeout: 30_000,
  });
  return issues;
}

async function startFromFirstUse(
  page: Page,
  input: {
    readonly mode: "Guided" | "Professional";
    readonly region?: string;
    readonly start: "Start from a template" | "Start with a blank canvas";
  },
): Promise<void> {
  await page.goto(projectsPath);
  await expect(
    page.getByRole("heading", { name: "How would you like to begin?" }),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: new RegExp(`^${input.mode}`, "u") })
    .check();
  await page
    .getByRole("radio", { name: new RegExp(`^${input.start}`, "u") })
    .check();
  if (input.region !== undefined) {
    await page
      .getByText("Optional defaults and teaching", { exact: true })
      .click();
    await page
      .getByRole("textbox", { name: /Default Region, when known/u })
      .fill(input.region);
  }
  const start = page.getByRole("button", { name: "Start local experience" });
  await start.focus();
  await start.press("Enter");
}

test.describe("Prompt 20A product experience", () => {
  test("offers the lightweight first-use choices and opens a valid blank Architecture Document", async ({
    page,
  }) => {
    await page.goto(projectsPath);

    await expect(page.getByTestId("first-use-experience")).toBeVisible();
    const defaults = page.getByText("Optional defaults and teaching", {
      exact: true,
    });
    await expect(
      page.getByRole("combobox", { name: "Preferred cloud provider" }),
    ).toBeHidden();
    await defaults.focus();
    await defaults.press("Enter");
    await expect(
      page.getByRole("combobox", { name: "Preferred cloud provider" }),
    ).toHaveValue("aws");
    await expect(
      page.getByRole("combobox", { name: "Preferred cloud provider" }),
    ).toContainText("AWS (currently available)");
    await expect(
      page.getByRole("radio", { name: /^Describe with AI/u }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /^Start from a template/u }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /^Start with a blank canvas/u }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", {
        name: /^Show the editor tour/u,
      }),
    ).toBeChecked();

    await page
      .getByRole("radio", { name: /^Start with a blank canvas/u })
      .check();
    await page
      .getByRole("textbox", { name: /Default Region, when known/u })
      .fill("us-east-1");
    const start = page.getByRole("button", {
      name: "Start local experience",
    });
    await start.focus();
    await start.press("Enter");

    await expect(page).toHaveURL(`${editorPath}?start=blank`);
    await waitForEditorReady(page);
    await expectPhoneArchitectureTarget(page, "us-east-1");
    await expect(
      editor(page).locator("[data-architecture-node-id]"),
    ).toHaveCount(0);
    const preference = await page.evaluate(() => {
      const key = Object.keys(window.localStorage).find((candidate) =>
        candidate.startsWith("cloudmarkup.web.experience-preferences.v1:"),
      );
      return key === undefined
        ? null
        : (JSON.parse(window.localStorage.getItem(key) ?? "null") as unknown);
    });
    expect(preference).toMatchObject({
      contextualTeachingEnabled: true,
      defaultRegion: "us-east-1",
      firstUseStatus: "completed",
      preferredProvider: "aws",
      startChoice: "blank",
    });
  });

  test("guides a novice through the notes API and preserves keyboard-only alternatives", async ({
    page,
  }) => {
    await startFromFirstUse(page, {
      mode: "Guided",
      region: "us-west-2",
      start: "Start from a template",
    });
    await expect(page).toHaveURL(`${editorPath}?start=template`);
    await waitForEditorReady(page);
    await expectPhoneArchitectureTarget(page, "us-west-2");

    const walkthrough = page.getByTestId("guided-walkthrough");
    await expect(walkthrough).toContainText("Step 1 of 7");
    await expect(
      walkthrough.getByRole("heading", { name: "Add a service" }),
    ).toBeVisible();
    const showMe = walkthrough.getByRole("button", { name: "Show me" });
    await showMe.focus();
    await showMe.press("Enter");
    await expect(
      page.getByRole("searchbox", { name: "Search services" }),
    ).toBeFocused();

    const dismiss = walkthrough.getByRole("button", { name: "Dismiss" });
    await dismiss.focus();
    await dismiss.press("Enter");
    await expect(walkthrough).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Help and keyboard shortcuts" }),
    ).toBeFocused();

    await runPaletteCommand(
      page,
      "restart notes walkthrough",
      /Restart notes API walkthrough/u,
    );
    await expect(walkthrough).toContainText("Step 1 of 7");
    for (let step = 2; step <= 7; step += 1) {
      const next = walkthrough.getByRole("button", { name: "Next" });
      await next.focus();
      await next.press("Enter");
      await expect(walkthrough).toContainText(`Step ${String(step)} of 7`);
      await expect(
        walkthrough.locator("#guided-walkthrough-title"),
      ).toBeFocused();

      if (step === 4) {
        const showCurrentStep = walkthrough.getByRole("button", {
          name: "Show me",
        });
        await showCurrentStep.focus();
        await showCurrentStep.press("Enter");
        await expect(page.locator(".architecture-live-region")).toContainText(
          "No current relationship declares permission effects",
        );
      }
      if (step === 5) {
        const showCurrentStep = walkthrough.getByRole("button", {
          name: "Show me",
        });
        await showCurrentStep.focus();
        await showCurrentStep.press("Enter");
        await expect(page.locator("#validation-issues-panel")).toHaveAttribute(
          "data-validation-current",
          "true",
          { timeout: 30_000 },
        );
      }
      if (step === 6) {
        const showCurrentStep = walkthrough.getByRole("button", {
          name: "Show me",
        });
        await showCurrentStep.focus();
        await showCurrentStep.press("Enter");
        await expect(
          page.locator("#responsive-review-revision-entry-point"),
        ).toBeFocused();
      }
      if (step === 7) {
        const showCurrentStep = walkthrough.getByRole("button", {
          name: "Show me",
        });
        await showCurrentStep.focus();
        await showCurrentStep.press("Enter");
        await expect(page.getByRole("tab", { name: "Code" })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await expect(page.locator("#editor-code-workspace")).toBeFocused();
        await expect(page.locator("#editor-code-workspace")).toContainText(
          /Infrastructure code|No resource selected/u,
        );
      }
    }
    const complete = walkthrough.getByRole("button", {
      name: "Complete walkthrough",
    });
    await complete.focus();
    await complete.press("Enter");
    await expect(walkthrough).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Help and keyboard shortcuts" }),
    ).toBeFocused();

    const beforeAdd = await documentHashes(page);
    await runPaletteCommand(page, "add lambda", /^Add Lambda function/u);
    await expect(
      editor(page).locator(
        '[data-architecture-node-id="node_lambda_function"]',
      ),
    ).toHaveCount(1);
    expect((await documentHashes(page)).content).not.toBe(beforeAdd.content);

    await page.reload();
    await expect(editor(page)).toBeVisible();
    await expect(walkthrough).toHaveCount(0);
  });

  test("supports a Professional rapid edit while mode, fit, and learning remain presentation-only", async ({
    page,
  }) => {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await startFromFirstUse(page, {
      mode: "Professional",
      start: "Start from a template",
    });
    await expect(page).toHaveURL(`${editorPath}?start=template`);
    await waitForEditorReady(page);
    await expect(editor(page)).toHaveAttribute(
      "data-editor-mode",
      "professional",
    );
    await expect(page.getByTestId("guided-walkthrough")).toHaveCount(0);

    const initialHashes = await documentHashes(page);
    await runPaletteCommand(page, "add lambda", /^Add Lambda function/u);
    await expect(
      editor(page).locator(
        '[data-architecture-node-id="node_lambda_function"]',
      ),
    ).toHaveCount(1);
    const afterAdd = await documentHashes(page);
    expect(afterAdd.content).not.toBe(initialHashes.content);

    const inspector = page.locator("#selected-resource-inspector");
    await inspector.getByText(/^Optional settings \(/u).click();
    const functionName = inspector.getByLabel(/^Function name/u);
    const preview = inspector.getByRole("button", { name: "Review changes" });
    await functionName.fill("invalid function name!");
    await preview.click();
    await expect(functionName).toHaveAttribute("aria-invalid", "true");
    await expect(
      inspector.getByRole("button", { name: "Apply configuration" }),
    ).toHaveCount(0);
    expect(await documentHashes(page)).toEqual(afterAdd);

    await functionName.fill("professional-notes-handler");
    await preview.click();
    const apply = inspector.getByRole("button", {
      name: "Apply configuration",
    });
    await expect(apply).toBeVisible();
    expect(await documentHashes(page)).toEqual(afterAdd);
    await apply.focus();
    await apply.press("Enter");
    const editedHashes = await documentHashes(page);
    expect(editedHashes.content).not.toBe(afterAdd.content);

    await inspector.getByRole("tab", { name: "Learn", exact: true }).click();
    await inspector
      .getByRole("region", { name: "Selected architecture element" })
      .locator("summary")
      .filter({ hasText: "Selected architecture element details:" })
      .click();
    await inspector.getByText("Technical identity", { exact: true }).click();
    await inspector
      .getByRole("button", { name: "Copy stable identifier" })
      .click();
    await expect(inspector.getByRole("status")).toContainText(
      "Stable identifier node_lambda_function copied.",
    );
    expect(
      await page.evaluate(() => window.navigator.clipboard.readText()),
    ).toBe("node_lambda_function");

    const undoLabelBeforeModeSwitch = await page
      .getByRole("button", { name: /^Undo /u })
      .getAttribute("aria-label");
    const issues = await openIssues(page);
    const draftConsequentialIds = await issues
      .locator(
        '[data-validation-severity="error"], [data-validation-severity="security-error"]',
      )
      .evaluateAll((findings) =>
        Array.from(
          new Set(
            findings
              .map((finding) =>
                finding.getAttribute("data-validation-finding-id"),
              )
              .filter((findingId): findingId is string => findingId !== null),
          ),
        ),
      );
    await issues
      .getByRole("combobox", { name: "Validation target" })
      .selectOption("compilation");
    const compilationFindingIds = await issues
      .locator("[data-validation-finding-navigation]")
      .evaluateAll((findings) =>
        findings.map((finding) =>
          finding.getAttribute("data-validation-finding-id"),
        ),
      );
    const compilationConsequentialIds = await issues
      .locator(
        '[data-validation-severity="error"], [data-validation-severity="security-error"]',
      )
      .evaluateAll((findings) =>
        Array.from(
          new Set(
            findings
              .map((finding) =>
                finding.getAttribute("data-validation-finding-id"),
              )
              .filter((findingId): findingId is string => findingId !== null),
          ),
        ),
      );
    const compilationFindingId = compilationConsequentialIds[0];
    expect(compilationFindingId).toBeDefined();
    let reachedCompilationFinding = false;
    const maximumJumps =
      draftConsequentialIds.length + compilationConsequentialIds.length + 1;
    for (let jump = 0; jump < maximumJumps; jump += 1) {
      await runPaletteCommand(
        page,
        "next error",
        "Next error or security finding",
      );
      const currentIssues = await openIssues(page);
      if (
        (await currentIssues.getAttribute("data-validation-target")) ===
          "compilation" &&
        (await currentIssues
          .locator(
            `[data-validation-finding-id=${JSON.stringify(compilationFindingId)}][aria-current="true"]`,
          )
          .count()) > 0
      ) {
        reachedCompilationFinding = true;
        break;
      }
    }
    expect(reachedCompilationFinding).toBe(true);

    await runPaletteCommand(page, "learn selection", "Learn about selection");
    await expect(inspector.getByRole("tab", { name: "Learn" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(inspector).toContainText("Service guidance");
    await expect(inspector).toContainText("What to review");
    await expect(inspector).toContainText("Connections");
    await expect(inspector).toContainText("Security");
    await expect(inspector).toContainText("Cost");
    await expect(inspector).toContainText("Operations");
    await expect(inspector).not.toContainText("Glossary");
    await expect(inspector).toContainText("Reliability and availability");
    await expect(
      inspector.getByRole("heading", { name: "Official documentation" }),
    ).toBeVisible();
    const showMe = inspector.getByRole("button", {
      name: "Show me on the architecture",
    });
    await showMe.click();
    await expect(
      page.locator("#validation-architecture-node-node_lambda_function"),
    ).toBeFocused();

    const beforeFit = await documentHashes(page);
    await runPaletteCommand(page, "fit selection", "Fit selection");
    expect(await documentHashes(page)).toEqual(beforeFit);

    await page.keyboard.press("Control+/");
    const shortcutHelp = page.getByRole("dialog", {
      name: "Keyboard shortcuts",
    });
    await expect(shortcutHelp).toBeVisible();
    await expect(shortcutHelp).toContainText("Ctrl/Command + K");
    await expect(shortcutHelp).toContainText("Alt + Arrow keys");
    await expect(shortcutHelp).toContainText("Ctrl/Command + Enter");
    await page.keyboard.press("Escape");
    await expect(shortcutHelp).toBeHidden();

    const professionalHashes = await documentHashes(page);
    const guided = page
      .locator(".top-mode-switch")
      .getByRole("button", { name: "Guided" });
    await guided.focus();
    await guided.press("Enter");
    await expect(editor(page)).toHaveAttribute("data-editor-mode", "guided");
    expect(await documentHashes(page)).toEqual(professionalHashes);
    await expect(page.getByRole("button", { name: /^Undo /u })).toHaveAttribute(
      "aria-label",
      undoLabelBeforeModeSwitch ?? "",
    );
    const guidedIssues = await openIssues(page);
    await expect(guidedIssues).toHaveAttribute(
      "data-validation-current",
      "true",
    );
    await expect(guidedIssues).toHaveAttribute(
      "data-validation-target",
      "compilation",
    );
    expect(
      await guidedIssues
        .locator("[data-validation-finding-navigation]")
        .evaluateAll((findings) =>
          findings.map((finding) =>
            finding.getAttribute("data-validation-finding-id"),
          ),
        ),
    ).toEqual(compilationFindingIds);
    await expect(page.getByTestId("guided-walkthrough")).toBeVisible();

    const professional = page
      .locator(".top-mode-switch")
      .getByRole("button", { name: "Professional" });
    await professional.focus();
    await professional.press("Enter");
    await expect(editor(page)).toHaveAttribute(
      "data-editor-mode",
      "professional",
    );
    expect(await documentHashes(page)).toEqual(professionalHashes);
    await expect(page.getByRole("button", { name: /^Undo /u })).toHaveAttribute(
      "aria-label",
      undoLabelBeforeModeSwitch ?? "",
    );
    const restoredProfessionalIssues = await openIssues(page);
    await expect(restoredProfessionalIssues).toHaveAttribute(
      "data-validation-current",
      "true",
    );
    await expect(restoredProfessionalIssues).toHaveAttribute(
      "data-validation-target",
      "compilation",
    );
    expect(
      await restoredProfessionalIssues
        .locator("[data-validation-finding-navigation]")
        .evaluateAll((findings) =>
          findings.map((finding) =>
            finding.getAttribute("data-validation-finding-id"),
          ),
        ),
    ).toEqual(compilationFindingIds);
    await expect(page.getByTestId("guided-walkthrough")).toHaveCount(0);

    await runPaletteCommand(
      page,
      "future export",
      "Open future code and diagram export",
    );
    await expect(page.getByRole("tab", { name: "Code" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#editor-code-workspace")).toBeFocused();
    await expect(page.locator("#editor-code-workspace")).toContainText(
      /Infrastructure code|No resource selected/u,
    );
    expect(await documentHashes(page)).toEqual(professionalHashes);

    await expect(recoveryStatus(page)).toContainText(
      "Local recovery checkpoint saved.",
    );
    await page.reload();
    await expect(editor(page)).toHaveAttribute(
      "data-editor-mode",
      "professional",
    );
    await expect(editor(page)).toHaveAttribute(
      "data-content-hash",
      professionalHashes.content,
    );
  });
});
