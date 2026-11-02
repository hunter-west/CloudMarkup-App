import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import axe from "axe-core";

import {
  EDITOR_RECOVERY_INDEXED_DB_NAME,
  EDITOR_RECOVERY_INDEXED_DB_STORE_NAME,
} from "../src/features/editor/persistence/indexeddb-editor-recovery-store.js";

const editorRoutePath =
  "/organizations/local-org/projects/field-notes/editor" as const;
const manualNotesPath = `${editorRoutePath}?fixture=manual-notes-api` as const;
const nestedBoundariesPath =
  `${editorRoutePath}?fixture=nested-boundaries` as const;
const encryptionFixPath =
  `${editorRoutePath}?fixture=dynamodb-encryption-fix` as const;

interface ServiceAddition {
  readonly displayName: string;
  readonly drag?: boolean;
  readonly nodeId: string;
  readonly search: string;
}

function editor(page: Page) {
  return page.locator(".architecture-editor");
}

function recoveryStatus(page: Page) {
  return page.getByRole("region", { name: "Development fixture status" });
}

async function waitForEditorReady(page: Page): Promise<void> {
  await expect(editor(page)).toBeVisible({ timeout: 30_000 });
  await expect(recoveryStatus(page)).toContainText(
    "Local draft recovery is ready",
  );
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

interface GraphProjectionCounts {
  readonly architecture: {
    readonly edges: number;
    readonly nodes: number;
  };
  readonly visibleCanvas: {
    readonly edges: number;
    readonly nodes: number;
  };
}

async function visibleNodeCount(page: Page): Promise<number> {
  return editor(page).locator("[data-architecture-node-id]").count();
}

async function visibleEdgeCount(page: Page): Promise<number> {
  return editor(page).locator(".react-flow__edge").count();
}

async function checkpointGraphCounts(
  page: Page,
): Promise<GraphProjectionCounts["architecture"]> {
  return page.evaluate(
    async ({ databaseName, storeName }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = window.indexedDB.open(databaseName);
        request.onerror = () => {
          reject(
            request.error ?? new Error("Could not open recovery storage."),
          );
        };
        request.onsuccess = () => {
          resolve(request.result);
        };
      });
      try {
        if (!database.objectStoreNames.contains(storeName)) {
          throw new Error("The recovery object store is unavailable.");
        }
        const transaction = database.transaction(storeName, "readonly");
        const records = await new Promise<unknown[]>((resolve, reject) => {
          const request = transaction.objectStore(storeName).getAll();
          request.onerror = () => {
            reject(
              request.error ?? new Error("Could not read recovery storage."),
            );
          };
          request.onsuccess = () => {
            resolve(request.result as unknown[]);
          };
        });
        if (records.length !== 1) {
          throw new Error("Expected one exact editor recovery scope.");
        }
        const isRecord = (
          value: unknown,
        ): value is Readonly<Record<string, unknown>> =>
          typeof value === "object" && value !== null && !Array.isArray(value);
        const record = records[0];
        if (!isRecord(record) || !isRecord(record["latest"])) {
          throw new Error("The recovery record has no latest checkpoint.");
        }
        const canonicalDocument = record["latest"]["canonicalDocument"];
        if (typeof canonicalDocument !== "string") {
          throw new Error("The recovery checkpoint has no canonical document.");
        }
        const architecture: unknown = JSON.parse(canonicalDocument);
        if (
          !isRecord(architecture) ||
          !Array.isArray(architecture["nodes"]) ||
          !Array.isArray(architecture["edges"])
        ) {
          throw new Error("The checkpoint is not an Architecture Document.");
        }
        return {
          edges: architecture["edges"].length,
          nodes: architecture["nodes"].length,
        };
      } finally {
        database.close();
      }
    },
    {
      databaseName: EDITOR_RECOVERY_INDEXED_DB_NAME,
      storeName: EDITOR_RECOVERY_INDEXED_DB_STORE_NAME,
    },
  );
}

async function expectGraphProjectionCounts(
  page: Page,
  expected: GraphProjectionCounts,
): Promise<void> {
  await expect
    .poll(async () => visibleNodeCount(page))
    .toBe(expected.visibleCanvas.nodes);
  await expect
    .poll(async () => visibleEdgeCount(page))
    .toBe(expected.visibleCanvas.edges);
  await expect
    .poll(async () => checkpointGraphCounts(page), { timeout: 30_000 })
    .toEqual(expected.architecture);
}

async function addService(
  page: Page,
  addition: ServiceAddition,
): Promise<void> {
  await page
    .getByRole("searchbox", { name: "Search services" })
    .fill(addition.search);
  if (addition.displayName.startsWith("CloudWatch")) {
    await page
      .getByRole("button", { name: "Set up CloudWatch", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Resource type", exact: true })
      .selectOption({ label: addition.displayName });
    await page
      .getByRole("button", { name: "Add to canvas", exact: true })
      .click();
  } else {
    const add = page.getByRole("button", {
      name: `Drag or add ${addition.displayName} to canvas`,
    });
    await expect(add).toBeEnabled();
    if (addition.drag) {
      await add.dragTo(page.locator(".architecture-canvas__flow"), {
        targetPosition: { x: 640, y: 420 },
      });
    } else {
      const addWithoutDragging = page.getByRole("button", {
        exact: true,
        name: `Add ${addition.displayName} to canvas`,
      });
      await addWithoutDragging.focus();
      await addWithoutDragging.press("Enter");
    }
  }
  await expect(
    editor(page).locator(`[data-architecture-node-id="${addition.nodeId}"]`),
  ).toHaveCount(1);
}

async function configureNode(
  page: Page,
  input: {
    readonly fieldName: RegExp;
    readonly nodeId: string;
    readonly value: string;
  },
): Promise<void> {
  const architectureList = await openArchitectureList(page);
  await architectureList
    .locator(`[data-architecture-tree-node-id="${input.nodeId}"]`)
    .click();
  await page
    .getByRole("navigation", { name: "Inspector tools" })
    .getByRole("button", { exact: true, name: "Configure" })
    .click();
  const configureInspector = page.getByRole("dialog", {
    name: "Configure inspector",
  });
  await expect(configureInspector).toBeVisible();
  const field = configureInspector.getByLabel(input.fieldName);
  if (!(await field.isVisible())) {
    await configureInspector
      .locator("summary")
      .filter({ hasText: /^Optional settings \(/u })
      .click();
  }
  await expect(field).toBeVisible();
  await field.fill(input.value);
  await configureInspector
    .getByRole("button", { name: "Review changes" })
    .click();
  await expect(
    configureInspector.getByRole("button", { name: "Apply configuration" }),
  ).toBeEnabled();
  await configureInspector
    .getByRole("button", { name: "Apply configuration" })
    .click();
  await expect(field).toHaveValue(input.value);
}

async function openArchitectureList(page: Page): Promise<Locator> {
  const list = page.getByRole("region", { name: "Architecture list" });
  if (await list.isVisible()) {
    return list;
  }
  await page.getByRole("button", { name: "Open Canvas menu" }).click();
  const canvasActions = page.getByRole("dialog", { name: "Canvas actions" });
  await expect(canvasActions).toBeVisible();
  await canvasActions
    .getByRole("button", { name: "Architecture list" })
    .click();
  await expect(canvasActions).toHaveCount(0);
  await expect(list).toBeVisible();
  return list;
}

async function advanceConnectionToReview(
  wizard: Locator,
  options: {
    readonly routeKey?: string;
  } = {},
): Promise<void> {
  const route = wizard.getByLabel(
    /Which HTTP method and path should invoke this function/u,
  );
  if (await route.isVisible()) {
    await route.fill(options.routeKey ?? "GET /notes");
  }
  const review = wizard.getByRole("button", { name: "Review connection" });
  if (await review.isVisible()) {
    await review.click();
  }
  await expect(
    wizard.getByRole("heading", {
      name: "What will change",
    }),
  ).toBeVisible();
}

async function connectFromPort(
  page: Page,
  sourceActionName: string,
  options: {
    readonly checkAccessibility?: boolean;
    readonly routeKey?: string;
  } = {},
): Promise<void> {
  const list = await openArchitectureList(page);
  const connectAction = list.getByRole("button", { name: sourceActionName });
  if (!(await connectAction.isVisible())) {
    const prefix = "Connect ";
    const separatorIndex = sourceActionName.indexOf(" using ");
    if (
      !sourceActionName.startsWith(prefix) ||
      separatorIndex <= prefix.length
    ) {
      throw new Error(
        `Unsupported Architecture-list action: ${sourceActionName}`,
      );
    }
    const nodeLabel = sourceActionName.slice(prefix.length, separatorIndex);
    await list
      .getByRole("button", { name: `Show details for ${nodeLabel}` })
      .click();
  }
  await expect(connectAction).toBeVisible();
  await connectAction.click();
  const wizard = page.locator('.connection-wizard[role="dialog"]');
  await expect(wizard).toBeVisible();
  await advanceConnectionToReview(wizard, options);
  if (options.checkAccessibility === true) {
    await expectNoAxeViolations(page, "connection confirmation dialog");
  }
  await wizard.getByRole("button", { exact: true, name: "Connect" }).click();
  await expect(wizard).toHaveCount(0);
}

async function openIssues(
  page: Page,
  options: {
    readonly requireCurrentValidation?: boolean;
  } = {},
): Promise<Locator> {
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
  if (options.requireCurrentValidation === false) {
    const issuesPanel = issuesDialog.getByRole("tabpanel", {
      name: "Issues",
    });
    await expect(issuesPanel).toBeVisible();
    return issuesPanel;
  }
  const issues = issuesDialog.locator(".validation-issues");
  await expect(issues).toBeVisible();
  await expect(issues).toHaveAttribute("data-validation-current", "true", {
    timeout: 30_000,
  });
  return issues;
}

async function expectNoAxeViolations(
  page: Page,
  context: string,
  rootSelector?: string,
): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async (rootSelector) => {
    const runtime = (
      globalThis as typeof globalThis & {
        axe: {
          run(
            root: Document | Element,
            options: {
              runOnly: {
                type: "tag";
                values: string[];
              };
            },
          ): Promise<{
            violations: {
              id: string;
              impact: string | null;
              nodes: {
                failureSummary: string | null;
                html: string;
                target: string[];
              }[];
            }[];
          }>;
        };
      }
    ).axe;
    const root =
      rootSelector === undefined
        ? document
        : document.querySelector(rootSelector);
    if (root === null) {
      throw new Error(
        "Axe root selector did not match: " + String(rootSelector),
      );
    }
    const result = await runtime.run(root, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        failureSummary: node.failureSummary,
        html: node.html,
        target: node.target,
      })),
    }));
  }, rootSelector);
  expect(
    violations,
    `${context} axe violations:\n${JSON.stringify(violations, null, 2)}`,
  ).toEqual([]);
}

test.describe("Prompt 20 manual editor milestone", () => {
  test("keeps provider validation capability explicit for the provider-neutral nested fixture", async ({
    page,
  }) => {
    await page.goto(nestedBoundariesPath);
    await waitForEditorReady(page);

    const issues = await openIssues(page, {
      requireCurrentValidation: false,
    });

    await expect(
      issues.getByRole("heading", { name: "Validation unavailable" }),
    ).toBeVisible();
    await expect(
      issues.getByRole("combobox", { name: "Validation target" }),
    ).toHaveCount(0);
  });
  test.setTimeout(180_000);

  test("builds, validates, reviews, histories, and recovers the authenticated notes API", async ({
    page,
  }) => {
    await page.goto(manualNotesPath);
    await waitForEditorReady(page);
    await expect(
      page.getByRole("button", { name: "Open local mock account" }),
    ).toContainText("Local mock - not verified");
    await page.getByRole("button", { name: "Guided" }).click();
    await expect(page.getByRole("button", { name: "Guided" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(async () => visibleNodeCount(page)).toBe(2);
    await expect.poll(async () => visibleEdgeCount(page)).toBe(1);
    await expectNoAxeViolations(page, "initial manual editor");

    const additions: readonly ServiceAddition[] = [
      {
        displayName: "API Gateway HTTP API",
        drag: true,
        nodeId: "node_apigateway_http_api",
        search: "API Gateway HTTP API",
      },
      {
        displayName: "IAM role",
        nodeId: "node_iam_role",
        search: "IAM role",
      },
      {
        displayName: "Lambda function",
        nodeId: "node_lambda_function",
        search: "bounded application workload",
      },
      {
        displayName: "DynamoDB table",
        nodeId: "node_dynamodb_table",
        search: "DynamoDB table",
      },
      {
        displayName: "CloudWatch log group",
        nodeId: "node_cloudwatch_log_group",
        search: "CloudWatch log group",
      },
      {
        displayName: "CloudWatch metric alarm",
        nodeId: "node_cloudwatch_metric_alarm",
        search: "CloudWatch metric alarm",
      },
    ];
    for (const addition of additions) {
      await addService(page, addition);
    }
    await expect.poll(async () => visibleNodeCount(page)).toBe(8);

    await configureNode(page, {
      fieldName: /^API name/u,
      nodeId: "node_apigateway_http_api",
      value: "field-notes-api",
    });
    await configureNode(page, {
      fieldName: /^Function name/u,
      nodeId: "node_lambda_function",
      value: "field-notes-handler",
    });
    await configureNode(page, {
      fieldName: /^Table name/u,
      nodeId: "node_dynamodb_table",
      value: "field-notes",
    });

    const issuesWithMissingRole = await openIssues(page);
    const missingRoleFinding = issuesWithMissingRole
      .getByRole("button", {
        name: /Lambda function has no execution role/u,
      })
      .first();
    await expect(missingRoleFinding).toBeVisible();
    await missingRoleFinding.click();
    await expect(
      issuesWithMissingRole.getByRole("heading", { name: "What happened" }),
    ).toBeVisible();
    const technicalDetails = issuesWithMissingRole
      .locator("summary")
      .filter({ hasText: /^Technical details$/u });
    await technicalDetails.click();
    await expect(
      issuesWithMissingRole.getByRole("heading", { name: "Why it matters" }),
    ).toBeVisible();
    await technicalDetails.click();
    await expect(
      issuesWithMissingRole.getByRole("heading", { name: "How to fix it" }),
    ).toBeVisible();
    await expect(
      issuesWithMissingRole.getByText("Manual action required", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(issuesWithMissingRole).toContainText(
      "use Connect to choose one compatible IAM role",
    );
    await issuesWithMissingRole
      .getByRole("button", { name: "Go to Lambda function", exact: true })
      .click();
    await expect(
      page.locator(
        '#validation-architecture-node-node_lambda_function[data-validation-highlight="true"]',
      ),
    ).toBeFocused();

    await connectFromPort(
      page,
      "Connect IAM role using Assumable role output capability",
      { checkAccessibility: true },
    );
    await connectFromPort(
      page,
      "Connect Notes users using JWT issuer output capability",
    );
    await connectFromPort(
      page,
      "Connect Notes web client using JWT audience output capability",
    );
    await connectFromPort(
      page,
      "Connect API Gateway HTTP API using Route invocation output capability",
      { routeKey: "GET /notes" },
    );
    await connectFromPort(
      page,
      "Connect Lambda function using Logging output capability",
    );
    await connectFromPort(
      page,
      "Connect Lambda function using Telemetry output capability",
    );
    await connectFromPort(
      page,
      "Connect Lambda function using Data read output capability",
    );
    await connectFromPort(
      page,
      "Connect Lambda function using Data write output capability",
    );

    await expectGraphProjectionCounts(page, {
      architecture: { edges: 23, nodes: 18 },
      visibleCanvas: { edges: 9, nodes: 8 },
    });
    const completedIssues = await openIssues(page);
    await expect(completedIssues).toContainText("Current and complete");
    const readinessSummary = completedIssues.getByText("Local draft review", {
      exact: true,
    });
    const readinessDisclosure = readinessSummary.locator(
      "xpath=ancestor::details",
    );
    await expect(readinessDisclosure).not.toHaveAttribute("open", "");
    await readinessSummary.click();
    await expect(completedIssues).toContainText("Structurally valid");
    await expect(completedIssues).toContainText(
      "No error or security-error findings",
    );
    await expect(completedIssues).toContainText("IaC-ready revision");
    await expect(completedIssues).toContainText("Not available");
    await expect(completedIssues).toContainText("terraform: Not ready");
    await expect(completedIssues).toContainText("cloudformation: Not ready");
    await expect(
      completedIssues.getByRole("button", {
        name: /AWS Region availability is not verified/u,
      }),
    ).toHaveCount(1);

    const guidedFindingEvidence = await completedIssues
      .locator("[data-validation-finding-id]")
      .evaluateAll((elements) =>
        [
          ...new Set(
            elements.map(
              (element) =>
                `${element.getAttribute("data-validation-finding-id") ?? "missing-id"}|${element.getAttribute("data-validation-severity") ?? "missing-severity"}`,
            ),
          ),
        ].sort(),
      );
    const guidedHash = (await documentHashes(page)).content;
    await page.getByRole("button", { name: "Professional" }).click();
    await expect(editor(page)).toHaveAttribute("data-content-hash", guidedHash);
    const professionalIssues = await openIssues(page);
    const professionalFindingEvidence = await professionalIssues
      .locator("[data-validation-finding-id]")
      .evaluateAll((elements) =>
        [
          ...new Set(
            elements.map(
              (element) =>
                `${element.getAttribute("data-validation-finding-id") ?? "missing-id"}|${element.getAttribute("data-validation-severity") ?? "missing-severity"}`,
            ),
          ),
        ].sort(),
      );
    expect(professionalFindingEvidence).toEqual(guidedFindingEvidence);
    const professionalFindingButtons = professionalIssues.getByRole("button", {
      name: /AWS Region availability is not verified/u,
    });
    const orderedFindingButtons = professionalIssues
      .getByRole("navigation", { name: "Validation findings" })
      .getByRole("button");
    await orderedFindingButtons.first().focus();
    await orderedFindingButtons.first().press("ArrowDown");
    await expect(orderedFindingButtons.nth(1)).toBeFocused();
    await professionalFindingButtons.first().click();
    await expect(professionalIssues).toContainText(
      "The catalog has not verified 7 service types in this Region.",
    );
    await expect(professionalIssues).not.toContainText(
      "CloudMarkup has not bundled",
    );
    await expect(
      professionalIssues.getByText("No automatic fix", { exact: true }),
    ).toBeVisible();
    await expect(professionalIssues).toContainText("Finding ID");
    await expect(professionalIssues).toContainText("Rule IDs");
    await expect(professionalIssues).toContainText("Affected paths");
    await expect(professionalIssues).toContainText("Target applicability");
    await expect(professionalIssues).toContainText(
      "aws.cloudmarkup.validation.region-availability",
    );
    await professionalIssues
      .getByRole("button", { name: "Mark reviewed this session" })
      .click();
    await expect(professionalIssues).toContainText("1 of 2 draft warnings");
    await expect(
      professionalIssues.getByRole("button", {
        name: /AWS Region availability is not verified/u,
      }),
    ).toHaveCount(1);
    const focusedWarningId = await professionalFindingButtons
      .first()
      .getAttribute("data-validation-finding-id");
    expect(focusedWarningId).not.toBeNull();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Issues workspace" }),
    ).toHaveCount(0);
    const reopenedProfessionalIssues = await openIssues(page);
    const reopenedReadinessSummary = reopenedProfessionalIssues.getByText(
      "Local draft review",
      { exact: true },
    );
    const reopenedReadiness = reopenedReadinessSummary.locator(
      "xpath=ancestor::details",
    );
    await expect(reopenedReadiness).not.toHaveAttribute("open", "");
    await reopenedReadinessSummary.click();
    await expect(reopenedProfessionalIssues).toContainText(
      "1 of 2 draft warnings",
    );
    const reopenedFinding = reopenedProfessionalIssues
      .getByRole("navigation", { name: "Validation findings" })
      .locator(`[data-validation-finding-id="${String(focusedWarningId)}"]`);
    await reopenedFinding.click();
    await expect(reopenedFinding).toHaveAttribute("aria-current", "true");
    await expectNoAxeViolations(
      page,
      "populated Professional Issues panel",
      ".validation-issues",
    );

    await page
      .getByRole("button", {
        name: /Undo Connect architecture resources/u,
      })
      .click();
    await expectGraphProjectionCounts(page, {
      architecture: { edges: 19, nodes: 16 },
      visibleCanvas: { edges: 8, nodes: 8 },
    });
    await page
      .getByRole("button", {
        name: /Redo Connect architecture resources/u,
      })
      .click();
    await expectGraphProjectionCounts(page, {
      architecture: { edges: 23, nodes: 18 },
      visibleCanvas: { edges: 9, nodes: 8 },
    });

    await expect(recoveryStatus(page)).toContainText(
      "Local recovery checkpoint saved.",
      { timeout: 30_000 },
    );
    const savedHashes = await documentHashes(page);
    await page.reload();
    await expect(editor(page)).toBeVisible();
    await expect(recoveryStatus(page)).toContainText(
      "Recovered the latest validated local Architecture Document checkpoint.",
    );
    await expect(editor(page)).toHaveAttribute(
      "data-content-hash",
      savedHashes.content,
    );
    await expect(editor(page)).toHaveAttribute(
      "data-visual-hash",
      savedHashes.visual,
    );
    await expectGraphProjectionCounts(page, {
      architecture: { edges: 23, nodes: 18 },
      visibleCanvas: { edges: 9, nodes: 8 },
    });
    await expect(
      page.getByRole("button", { name: "Undo unavailable" }),
    ).toBeDisabled();
    const recoveredIssues = await openIssues(page);
    await expect(recoveredIssues).toContainText("Current and complete");
    await expect(recoveredIssues).toContainText(
      "No error or security-error findings",
    );
  });

  test("focuses, previews, applies, undoes, and redoes the reviewed DynamoDB fix", async ({
    page,
  }) => {
    await page.goto(encryptionFixPath);
    await waitForEditorReady(page);
    const issues = await openIssues(page);
    const findingTitle = "DynamoDB encryption is not explicitly enabled";
    await issues
      .getByRole("button", { name: new RegExp(findingTitle, "u") })
      .click();
    await expect(
      issues.getByRole("heading", { name: "What happened" }),
    ).toBeVisible();
    await issues
      .getByRole("button", { name: /^Go to .+ · Server-side encryption/u })
      .click();
    const encryptionField = page.getByLabel(/^Server-side encryption/u);
    await expect(encryptionField).toBeVisible();
    await expect(encryptionField).toHaveJSProperty("tagName", "OUTPUT");
    await expect(encryptionField).toHaveText("true");
    await expect(
      page
        .getByRole("dialog", { name: "Configure inspector" })
        .getByRole("heading", { name: "Configure inspector", exact: true }),
    ).toBeFocused();
    await expect(
      encryptionField.locator(
        "xpath=ancestor::*[@data-validation-highlight='true']",
      ),
    ).toHaveCount(1);

    await openIssues(page);
    await issues
      .getByRole("button", { name: new RegExp(findingTitle, "u") })
      .click();
    const reviewSafeFix = issues.getByRole("button", {
      name: "Review safe fix",
    });
    await reviewSafeFix.click();
    const dialog = page.getByRole("dialog", {
      name: `Review fix: ${findingTitle}`,
    });
    await expect(dialog).toContainText("1 command");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(reviewSafeFix).toBeFocused();
    await reviewSafeFix.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("serverSideEncryptionEnabled");
    await expect(dialog).toContainText('"value": true');
    await expect(dialog).toContainText("required current-state preconditions");
    await expect(dialog).toContainText("Resulting content hash");
    await expect(dialog).toContainText("Resulting visual hash");
    const technicalDetails = dialog.getByText("Technical details", {
      exact: true,
    });
    await technicalDetails.click();
    const fullBatch = dialog.getByLabel("Full Graph Command batch");
    await expect(fullBatch).toBeVisible();
    await expect(fullBatch).toContainText('"kind": "batch"');
    await dialog.getByRole("button", { name: "Guided" }).click();
    await expect(fullBatch).toBeVisible();
    await dialog.getByRole("button", { name: "Professional" }).click();
    await expect(fullBatch).toBeVisible();
    await expectNoAxeViolations(
      page,
      "safe-fix confirmation dialog",
      ".validation-fix-dialog",
    );
    await dialog.getByRole("button", { name: "Apply safe fix" }).click();
    await expect(dialog).toBeHidden();
    await expect(issues).toBeFocused();

    await expect(issues).toHaveAttribute("data-validation-current", "true", {
      timeout: 30_000,
    });
    await expect(issues.getByText(findingTitle, { exact: true })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", {
        name: /Undo Fix DynamoDB encryption is not explicitly enabled/u,
      })
      .click();
    await expect(issues).toHaveAttribute("data-validation-current", "true", {
      timeout: 30_000,
    });
    await expect(
      issues.getByRole("button", { exact: true, name: findingTitle }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: /Redo Fix DynamoDB encryption is not explicitly enabled/u,
      })
      .click();
    await expect(issues).toHaveAttribute("data-validation-current", "true", {
      timeout: 30_000,
    });
    await expect(issues.getByText(findingTitle, { exact: true })).toHaveCount(
      0,
    );
  });
  test("moves tablet finding focus from the workspace drawer to the accessible architecture fallback", async ({
    page,
  }) => {
    await page.goto(manualNotesPath);
    await waitForEditorReady(page);
    await addService(page, {
      displayName: "Lambda function",
      nodeId: "node_lambda_function",
      search: "bounded application workload",
    });
    await page.setViewportSize({ height: 800, width: 900 });
    await page
      .getByRole("dialog", { name: "Service catalog" })
      .getByRole("button", { name: "Close" })
      .click();

    const issues = await openIssues(page);
    const workspaceDrawer = page.getByRole("dialog", {
      name: "Issues workspace",
    });
    await expect(workspaceDrawer).toBeVisible();
    await issues
      .getByRole("button", {
        name: /Lambda function has no execution role/u,
      })
      .first()
      .click();
    await issues
      .getByRole("button", { name: "Go to Lambda function", exact: true })
      .click();

    await expect(workspaceDrawer).toBeHidden();
    await expect(
      page.getByRole("dialog", { name: "Architecture inspector" }),
    ).toBeVisible();
    const focusedFallback = page.locator(
      '[id^="validation-architecture-node-"][data-validation-highlight="true"]',
    );
    await expect(focusedFallback).toHaveCount(1);
    await expect(focusedFallback).toBeFocused();
    await expectNoAxeViolations(page, "tablet finding focus fallback");
  });

  test("moves phone finding focus out of the workspace focus trap to the primary architecture list", async ({
    page,
  }) => {
    await page.goto(manualNotesPath);
    await waitForEditorReady(page);
    await addService(page, {
      displayName: "Lambda function",
      nodeId: "node_lambda_function",
      search: "bounded application workload",
    });
    await page.setViewportSize({ height: 844, width: 390 });
    await page
      .getByRole("dialog", { name: "Service catalog" })
      .getByRole("button", { name: "Close" })
      .click();

    await page
      .getByRole("navigation", { name: "Phone workspace navigation" })
      .getByRole("button", { exact: true, name: "Issues" })
      .click();
    const workspaceDrawer = page.getByRole("dialog", {
      name: "Issues workspace",
    });
    const issues = workspaceDrawer.locator(".validation-issues");
    await expect(issues).toHaveAttribute("data-validation-current", "true", {
      timeout: 30_000,
    });
    await issues
      .getByRole("combobox", { name: "Validation target" })
      .selectOption("compilation");
    await issues
      .getByRole("button", {
        name: /Lambda function has no execution role/u,
      })
      .first()
      .click();
    await issues
      .getByRole("button", { name: "Go to Lambda function", exact: true })
      .click();

    await expect(workspaceDrawer).toBeHidden();
    await expect(
      page.getByRole("dialog", { name: "Architecture inspector" }),
    ).toBeHidden();
    const focusedPrimaryTarget = page.locator(
      '#architecture-list [id^="validation-architecture-node-"][data-validation-highlight="true"]',
    );
    await expect(focusedPrimaryTarget).toHaveCount(1);
    await expect(focusedPrimaryTarget).toBeFocused();

    await page
      .getByRole("navigation", { name: "Phone workspace navigation" })
      .getByRole("button", { exact: true, name: "Issues" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Issues workspace" }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Validation target" }),
    ).toHaveValue("compilation");
    await expectNoAxeViolations(page, "phone finding focus fallback");
  });
});
