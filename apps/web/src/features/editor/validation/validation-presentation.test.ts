import {
  createValidationDocumentPath,
  createValidationFindingCode,
  defineValidationRuleV1,
  getArchitectureDocumentHashes,
  validateArchitectureDocumentWithRules,
  type ValidationFindingCandidate,
  type ValidationSeverity,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { awsEditorValidationEvaluator } from "../../../provider-catalog/aws-editor-validation.js";
import {
  loadAwsEditorArchitectureDocument,
  loadDynamoDbEncryptionFixArchitectureDocument,
  loadManualNotesApiArchitectureDocument,
} from "../../../provider-catalog/aws-editor-fixture.js";
import type { EditorCatalog } from "../model/editor-catalog.js";
import {
  groupValidationFindings,
  projectEditorReadiness,
  VALIDATION_FILTERS,
  type ValidationFilterId,
} from "./validation-presentation.js";

function requiredAt<Value>(values: readonly Value[], index: number): Value {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Missing required test value at index ${String(index)}.`);
  }
  return value;
}

const severities: readonly ValidationSeverity[] = [
  "error",
  "security-error",
  "warning",
  "cost-warning",
  "recommendation",
  "educational-note",
];

function allFilters(): ReadonlySet<ValidationFilterId> {
  return new Set(VALIDATION_FILTERS.map((filter) => filter.id));
}

function categoryReport() {
  const document = loadAwsEditorArchitectureDocument();
  const candidates: ValidationFindingCandidate[] = severities.map(
    (severity, index) => ({
      affected: [
        {
          kind: "node",
          nodeId: requiredAt(document.nodes, index % document.nodes.length).id,
          path: createValidationDocumentPath(
            `$.nodes[${String(index % document.nodes.length)}]`,
          ),
        },
      ],
      beginnerExplanation: `Beginner ${severity}`,
      code: createValidationFindingCode(`test.validation.${severity}`),
      documentationReferences: [],
      severity,
      technicalExplanation: `Technical ${severity}`,
      title: `Finding ${severity}`,
    }),
  );
  const rule = defineValidationRuleV1({
    applicability: {
      catalogs: { kind: "all" },
      environments: ["unknown"],
      providers: { kind: "all" },
      targets: ["draft"],
    },
    evaluate: () => candidates,
    id: "test.validation.presentation-categories",
    input: "architecture-document",
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
  });
  return {
    document,
    report: validateArchitectureDocumentWithRules({
      additionalRules: [rule],
      document,
      environment: "unknown",
      target: "draft",
    }),
  };
}

describe("validation presentation projections", () => {
  it("filters only by exact canonical severity without changing findings", () => {
    const { document, report } = categoryReport();
    const groups = groupValidationFindings(
      report,
      document,
      new Set<ValidationFilterId>(["security", "cost", "educational"]),
    );

    expect(groups.map((group) => group.severity)).toEqual([
      "security-error",
      "cost-warning",
      "educational-note",
    ]);
    expect(report.findings).toHaveLength(severities.length);
  });

  it("maps every filter one-to-one to its canonical severity without changing the report", () => {
    const { document, report } = categoryReport();
    const originalFindingIds = report.findings.map(
      (finding) => finding.findingId,
    );

    VALIDATION_FILTERS.forEach((filter) => {
      const groups = groupValidationFindings(
        report,
        document,
        new Set<ValidationFilterId>([filter.id]),
      );

      expect(groups.map((group) => group.severity)).toEqual(filter.severities);
      expect(
        groups.flatMap((group) =>
          group.resources.flatMap((resource) =>
            resource.findings.map((finding) => finding.severity),
          ),
        ),
      ).toEqual(filter.severities);
    });
    expect(report.findings.map((finding) => finding.findingId)).toEqual(
      originalFindingIds,
    );
  });

  it("projects exact canonical finding facts without a presentation-mode input", () => {
    const { document, report } = categoryReport();
    const projection = groupValidationFindings(report, document, allFilters());
    const projectedFacts = projection.flatMap((group) =>
      group.resources.flatMap((resource) =>
        resource.findings.map((finding) => ({
          affected: finding.affected,
          beginnerExplanation: finding.beginnerExplanation,
          findingId: finding.findingId,
          severity: finding.severity,
          technicalExplanation: finding.technicalExplanation,
        })),
      ),
    );

    const byFindingId = (
      left: { findingId: string },
      right: { findingId: string },
    ) => left.findingId.localeCompare(right.findingId);
    expect(projectedFacts.sort(byFindingId)).toEqual(
      report.findings
        .map((finding) => ({
          affected: finding.affected,
          beginnerExplanation: finding.beginnerExplanation,
          findingId: finding.findingId,
          severity: finding.severity,
          technicalExplanation: finding.technicalExplanation,
        }))
        .sort(byFindingId),
    );
  });

  it("groups one multi-location finding under each distinct affected resource", () => {
    const document = loadManualNotesApiArchitectureDocument();
    const node = requiredAt(document.nodes, 0);
    const edge = requiredAt(document.edges, 0);
    const rule = defineValidationRuleV1({
      applicability: {
        catalogs: { kind: "all" },
        environments: ["unknown"],
        providers: { kind: "all" },
        targets: ["draft"],
      },
      evaluate: () => [
        {
          affected: [
            {
              kind: "document",
              path: createValidationDocumentPath("$"),
            },
            {
              kind: "node",
              nodeId: node.id,
              path: createValidationDocumentPath("$.nodes[0]"),
            },
            {
              key: "name",
              kind: "configuration",
              owner: { kind: "node", nodeId: node.id },
              path: createValidationDocumentPath(
                "$.nodes[0].semantic.configuration.values.name",
              ),
            },
            {
              edgeId: edge.id,
              kind: "edge",
              path: createValidationDocumentPath("$.edges[0]"),
            },
            {
              edgeId: edge.id,
              endpoint: "source",
              kind: "port",
              nodeId: edge.semantic.source.nodeId,
              path: createValidationDocumentPath(
                "$.edges[0].semantic.source.port",
              ),
              port: edge.semantic.source.port,
            },
          ],
          beginnerExplanation: "One finding affects several resources.",
          code: createValidationFindingCode("test.validation.multi-location"),
          documentationReferences: [],
          severity: "educational-note" as const,
          technicalExplanation:
            "The exact finding retains all affected locations.",
          title: "Several resources are affected",
        },
      ],
      id: "test.validation.multi-location",
      input: "architecture-document",
      interfaceVersion: 1,
      ruleVersion: "1.0.0",
    });
    const report = validateArchitectureDocumentWithRules({
      additionalRules: [rule],
      document,
      environment: "unknown",
      target: "draft",
    });
    const groups = groupValidationFindings(
      report,
      document,
      new Set<ValidationFilterId>(["educational"]),
    );
    const resources = groups[0]?.resources ?? [];

    expect(resources.map((resource) => resource.id).sort()).toEqual([
      "document",
      `edge:${edge.id}`,
      `node:${node.id}`,
    ]);
    expect(
      new Set(
        resources.flatMap((resource) =>
          resource.findings.map((finding) => finding.findingId),
        ),
      ).size,
    ).toBe(1);
    expect(resources.every((resource) => resource.findings.length === 1)).toBe(
      true,
    );
  });

  it("refuses target-ready authority even when all local mappings say implemented", async () => {
    const document = loadDynamoDbEncryptionFixArchitectureDocument();
    const draftReport = await awsEditorValidationEvaluator.evaluate({
      document,
      target: "draft",
    });
    const compilationReport = await awsEditorValidationEvaluator.evaluate({
      document,
      target: "compilation",
    });
    const implementedCatalog: EditorCatalog = {
      ...awsEditorCatalog,
      services: awsEditorCatalog.services.map((service) => ({
        ...service,
        mappings: service.mappings.map((mapping) => ({
          ...mapping,
          implementationStatus: "implemented" as const,
        })),
      })),
    };
    const readiness = projectEditorReadiness({
      reviewedFindingIds: new Set(),
      catalog: implementedCatalog,
      document,
      snapshot: {
        compilationReport,
        draftReport,
        hashes: getArchitectureDocumentHashes(document),
      },
    });

    expect(readiness.targets.length).toBeGreaterThan(0);
    expect(readiness.targets.every((target) => !target.ready)).toBe(true);
    expect(
      readiness.targets.every((target) =>
        target.reason.includes(
          "no immutable revision or target-specific compiler result",
        ),
      ),
    ).toBe(true);
  });
});
