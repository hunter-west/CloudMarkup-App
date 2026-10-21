import { readFile } from "node:fs/promises";

import {
  parseArchitectureDocumentV1Json,
  parseArchitectureDocumentV2Json,
  parseGraphCommandV1,
  type ArchitectureDocumentV1,
  type ArchitectureDocumentV2,
  type ArchitectureDocumentV3,
  type GraphCommandBatchV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  VALIDATION_ENVIRONMENTS,
  VALIDATION_TARGETS,
  createValidationDocumentPath,
  createValidationDocumentationId,
  createValidationDocumentationPath,
  createValidationFindingCode,
  defineValidationRuleV1,
  executeArchitectureValidationRules,
  getArchitectureDocumentHashes,
  hashCanonicalValue,
  migrateArchitectureDocumentV2ToV3,
  parseArchitectureDocument,
  validateArchitectureDocumentWithRules,
  type ValidationEnvironment,
  type ValidationFindingCandidate,
  type ValidationRuleApplicabilityV1,
  type ValidationRuleV1,
  type ValidationSeverity,
  type ValidationTarget,
} from "./index.js";

async function readArchitectureFixture(path: string): Promise<string> {
  return readFile(
    new URL(
      `../../test-fixtures/fixtures/architecture-document/v1/${path}`,
      import.meta.url,
    ),
    "utf8",
  );
}

async function representativeDocument(): Promise<ArchitectureDocumentV1> {
  return parseArchitectureDocumentV1Json(
    await readArchitectureFixture("valid/representative.json"),
  );
}

async function representativeDocumentV2(): Promise<ArchitectureDocumentV2> {
  return parseArchitectureDocumentV2Json(
    await readFile(
      new URL(
        "../../test-fixtures/fixtures/architecture-document/v2/valid/representative.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

async function representativeDocumentV3(): Promise<ArchitectureDocumentV3> {
  return migrateArchitectureDocumentV2ToV3(await representativeDocumentV2());
}

const allApplicability: ValidationRuleApplicabilityV1 = {
  providers: { kind: "all" },
  catalogs: { kind: "all" },
  targets: VALIDATION_TARGETS,
  environments: VALIDATION_ENVIRONMENTS,
};

function candidate(
  code: string,
  severity: ValidationSeverity,
  path: string,
  autoFix?: GraphCommandBatchV1,
): ValidationFindingCandidate {
  return {
    code: createValidationFindingCode(code),
    severity,
    title: "Synthetic validation finding",
    beginnerExplanation: "A synthetic condition needs attention.",
    technicalExplanation:
      "This deterministic test rule emitted a synthetic finding.",
    affected: [
      {
        kind: "document",
        path: createValidationDocumentPath(path),
      },
    ],
    documentationReferences: [
      {
        kind: "cloudmarkup-document",
        id: createValidationDocumentationId(
          "cloudmarkup.docs.testing.validation",
        ),
        title: "Validation testing",
        path: createValidationDocumentationPath(
          "docs/architecture/TESTING_STRATEGY.md#domain-unit-and-property-tests",
        ),
      },
    ],
    ...(autoFix === undefined ? {} : { autoFix }),
  };
}

function testRule(
  id: string,
  evaluate: ValidationRuleV1["evaluate"],
  applicability: ValidationRuleApplicabilityV1 = allApplicability,
): ValidationRuleV1 {
  return defineValidationRuleV1({
    interfaceVersion: 1,
    id,
    ruleVersion: "1.0.0",
    input: "architecture-document",
    applicability,
    evaluate,
  });
}

function moveNodeBatch(
  document: ArchitectureDocumentV1,
  suffix: string,
  xOffset: number,
  expectedXOffset = 0,
): GraphCommandBatchV1 {
  const node = document.nodes.find(
    (candidateNode) => candidateNode.id === "node_application",
  );
  if (node === undefined) {
    throw new Error(
      "Representative fixture must contain the application node.",
    );
  }

  const parsed = parseGraphCommandV1({
    schemaVersion: 1,
    commandId: `validation_${suffix}_batch`,
    inverseCommandId: `validation_${suffix}_batch_inverse`,
    origin: "user",
    target: {
      documentId: document.documentId,
      architectureId: document.architectureId,
      revisionId: document.revision.revisionId,
    },
    kind: "batch",
    commands: [
      {
        schemaVersion: 1,
        commandId: `validation_${suffix}_move`,
        inverseCommandId: `validation_${suffix}_move_inverse`,
        origin: "user",
        target: {
          documentId: document.documentId,
          architectureId: document.architectureId,
          revisionId: document.revision.revisionId,
        },
        kind: "move-node",
        nodeId: node.id,
        expectedPosition: {
          x: node.presentation.position.x + expectedXOffset,
          y: node.presentation.position.y,
        },
        position: {
          x: node.presentation.position.x + xOffset,
          y: node.presentation.position.y,
        },
      },
    ],
  });

  if (parsed.kind !== "batch") {
    throw new Error("Expected a parsed batch command.");
  }

  return parsed;
}

describe("provider-extensible validation engine", () => {
  it("can execute one rule in isolation", async () => {
    const document = await representativeDocument();
    const isolated = testRule("example.validation.isolated", () => [
      candidate("example.validation.isolated-finding", "educational-note", "$"),
    ]);

    const report = executeArchitectureValidationRules(
      {
        document,
        target: "draft",
        environment: "development",
      },
      [isolated],
    );

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.rules).toEqual([
      {
        ruleId: isolated.id,
        ruleVersion: isolated.ruleVersion,
      },
    ]);
    expect(report.executedRules).toEqual(report.findings[0]?.rules);
    expect(report.diagnostics).toEqual([]);
  });

  it("orders and deduplicates findings independently of rule registration order", async () => {
    const document = await representativeDocument();
    const first = testRule("example.validation.first", () => [
      candidate("example.validation.shared-condition", "warning", "$.nodes[0]"),
      candidate(
        "example.validation.recommendation",
        "recommendation",
        "$.nodes[1]",
      ),
    ]);
    const second = testRule("example.validation.second", () => [
      candidate(
        "example.validation.shared-condition",
        "security-error",
        "$.nodes[0]",
      ),
      candidate("example.validation.error", "error", "$.edges[0]"),
      candidate("example.validation.cost", "cost-warning", "$.nodes[0]"),
      candidate("example.validation.warning", "warning", "$.nodes[0]"),
      candidate(
        "example.validation.educational",
        "educational-note",
        "$.nodes[0]",
      ),
    ]);

    const request = {
      document,
      target: "revision" as const,
      environment: "staging" as const,
    };
    const left = executeArchitectureValidationRules(request, [first, second]);
    const right = executeArchitectureValidationRules(request, [second, first]);

    expect(left).toEqual(right);
    expect(left.findings.map((finding) => finding.severity)).toEqual([
      "security-error",
      "error",
      "cost-warning",
      "warning",
      "recommendation",
      "educational-note",
    ]);
    expect(left.findings[0]?.rules.map((rule) => rule.ruleId)).toEqual([
      first.id,
      second.id,
    ]);
    expect(left.summary).toEqual(
      expect.objectContaining({
        "security-error": 1,
        error: 1,
        recommendation: 1,
      }),
    );
  });

  it("applies provider, catalog, target, and environment applicability", async () => {
    const document = await representativeDocument();
    const applicable = testRule(
      "example.validation.applicable",
      () => [
        candidate("example.validation.applicable-finding", "warning", "$"),
      ],
      {
        providers: {
          kind: "include",
          providerIds: [document.provider.id],
        },
        catalogs: {
          kind: "include",
          catalogs: [
            {
              catalogId: document.catalog.id,
              versions: [document.catalog.version],
            },
          ],
        },
        targets: ["compilation"],
        environments: ["production", "disaster-recovery"],
      },
    );

    const matching = executeArchitectureValidationRules(
      {
        document,
        target: "compilation",
        environment: "production",
      },
      [applicable],
    );
    const skipped = executeArchitectureValidationRules(
      {
        document,
        target: "draft",
        environment: "production",
      },
      [applicable],
    );
    const disasterRecovery = executeArchitectureValidationRules(
      {
        document,
        target: "compilation",
        environment: "disaster-recovery",
      },
      [applicable],
    );

    expect(matching.findings).toHaveLength(1);
    expect(disasterRecovery.findings).toHaveLength(1);
    expect(skipped.findings).toEqual([]);
    expect(skipped.skippedRuleIds).toEqual([applicable.id]);
  });

  it("snapshots and deeply freezes rule applicability", async () => {
    const document = await representativeDocument();
    const providerIds = [document.provider.id];
    const catalogVersions = [document.catalog.version];
    const catalogs = [
      {
        catalogId: document.catalog.id,
        versions: catalogVersions,
      },
    ];
    const targets: ValidationTarget[] = ["draft"];
    const environments: ValidationEnvironment[] = ["development"];
    const rule = testRule("example.validation.frozen-applicability", () => [], {
      providers: { kind: "include", providerIds },
      catalogs: { kind: "include", catalogs },
      targets,
      environments,
    });

    providerIds.push(document.provider.id);
    catalogVersions.push(document.catalog.version);
    catalogs.push({
      catalogId: document.catalog.id,
      versions: [document.catalog.version],
    });
    targets.push("compilation");
    environments.push("production");

    expect(VALIDATION_ENVIRONMENTS).toContain("multi-environment");
    expect(Object.isFrozen(VALIDATION_ENVIRONMENTS)).toBe(true);
    expect(rule.applicability).toEqual({
      providers: {
        kind: "include",
        providerIds: [document.provider.id],
      },
      catalogs: {
        kind: "include",
        catalogs: [
          {
            catalogId: document.catalog.id,
            versions: [document.catalog.version],
          },
        ],
      },
      targets: ["draft"],
      environments: ["development"],
    });
    expect(Object.isFrozen(rule.applicability)).toBe(true);
    expect(Object.isFrozen(rule.applicability.targets)).toBe(true);
    expect(Object.isFrozen(rule.applicability.environments)).toBe(true);
    expect(
      rule.applicability.catalogs.kind === "include" &&
        Object.isFrozen(rule.applicability.catalogs.catalogs[0]?.versions),
    ).toBe(true);
  });

  it("isolates rule execution from another rule's registry mutation", async () => {
    const document = await representativeDocument();
    const mutableTargets: ValidationTarget[] = ["draft"];
    const targetRule = {
      ...testRule("example.validation.z-target", () => [
        candidate("example.validation.registry-isolation", "warning", "$"),
      ]),
      applicability: {
        ...allApplicability,
        targets: mutableTargets,
      },
    } satisfies ValidationRuleV1;
    const mutator = testRule("example.validation.a-mutator", () => {
      mutableTargets.splice(0);
      return [];
    });

    const report = executeArchitectureValidationRules(
      {
        document,
        target: "draft",
        environment: "development",
      },
      [targetRule, mutator],
    );

    expect(report.findings.map((finding) => finding.code)).toEqual([
      "example.validation.registry-isolation",
    ]);
  });

  it("rejects documentation-reference path traversal", () => {
    expect(() =>
      createValidationDocumentationPath("docs/../README.md"),
    ).toThrow("CloudMarkup documentation references must use a docs/ path.");
  });

  it("previews a deterministic auto-fix only after command-engine validation", async () => {
    const document = await representativeDocument();
    const before = JSON.stringify(document);
    const command = moveNodeBatch(document, "preview", 40);
    const rule = testRule("example.validation.preview", () => [
      candidate(
        "example.validation.preview-position",
        "recommendation",
        "$.nodes[0].presentation.position",
        command,
      ),
    ]);
    const report = executeArchitectureValidationRules(
      {
        document,
        target: "draft",
        environment: "development",
      },
      [rule],
    );
    const preview = report.findings[0]?.autoFix;

    expect(preview?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "node-moved",
          nodeId: "node_application",
        }),
        expect.objectContaining({
          kind: "batch-applied",
          commandCount: 1,
        }),
      ]),
    );
    expect(preview?.resultingDocumentHash).toBe(
      getArchitectureDocumentHashes(parseArchitectureDocument(document))
        .contentHash,
    );
    expect(preview?.resultingVisualHash).not.toBe(
      getArchitectureDocumentHashes(document).visualHash,
    );
    expect(preview?.conflictsWithFindingIds).toEqual([]);
    expect(JSON.stringify(document)).toBe(before);
  });

  it("withholds an auto-fix whose preconditions fail", async () => {
    const document = await representativeDocument();
    const invalidCommand = moveNodeBatch(document, "invalid", 80, 1);
    const rule = testRule("example.validation.invalid-fix", () => [
      candidate(
        "example.validation.invalid-fix-position",
        "warning",
        "$.nodes[0].presentation.position",
        invalidCommand,
      ),
    ]);
    const report = executeArchitectureValidationRules(
      {
        document,
        target: "draft",
        environment: "development",
      },
      [rule],
    );

    expect(report.findings[0]?.autoFix).toBeUndefined();
    expect(report.diagnostics).toEqual([
      expect.objectContaining({
        code: "auto_fix_validation_failed",
        ruleId: rule.id,
      }),
    ]);
    expect(report.evaluationStatus).toBe("incomplete");
  });

  it("marks independently valid auto-fixes that conflict with each other", async () => {
    const document = await representativeDocument();
    const left = testRule("example.validation.move-left", () => [
      candidate(
        "example.validation.move-left-finding",
        "recommendation",
        "$.nodes[0].presentation.position.x",
        moveNodeBatch(document, "left", -30),
      ),
    ]);
    const right = testRule("example.validation.move-right", () => [
      candidate(
        "example.validation.move-right-finding",
        "recommendation",
        "$.nodes[0].presentation.position.x",
        moveNodeBatch(document, "right", 30),
      ),
    ]);
    const report = executeArchitectureValidationRules(
      {
        document,
        target: "draft",
        environment: "development",
      },
      [right, left],
    );
    const [firstFinding, secondFinding] = report.findings;

    expect(firstFinding?.autoFix?.conflictsWithFindingIds).toEqual([
      secondFinding?.findingId,
    ]);
    expect(secondFinding?.autoFix?.conflictsWithFindingIds).toEqual([
      firstFinding?.findingId,
    ]);
  });

  it("contains a rule failure and protects every other rule from mutation", async () => {
    const document = await representativeDocument();
    const before = JSON.stringify(document);
    const failing = testRule("example.validation.failing", (context) => {
      const node = context.document?.nodes[0];
      if (node !== undefined) {
        node.presentation.label = "mutated";
      }
      throw new Error("sensitive-internal-detail");
    });
    const healthy = testRule("example.validation.healthy", (context) => {
      if (context.document?.nodes[0]?.presentation.label === "mutated") {
        throw new Error("Mutation escaped rule isolation.");
      }
      return [
        candidate(
          "example.validation.healthy-finding",
          "warning",
          "$.nodes[0]",
        ),
      ];
    });

    const report = executeArchitectureValidationRules(
      {
        document,
        target: "draft",
        environment: "test",
      },
      [healthy, failing],
    );

    expect(report.findings).toHaveLength(1);
    expect(report.evaluationStatus).toBe("incomplete");
    expect(report.diagnostics).toEqual([
      expect.objectContaining({
        code: "rule_execution_failed",
        ruleId: failing.id,
      }),
    ]);
    expect(JSON.stringify(report.diagnostics)).not.toContain(
      "sensitive-internal-detail",
    );
    expect(JSON.stringify(document)).toBe(before);
  });

  it("contains malformed rule definitions and never freezes malformed input", () => {
    const malformedRule = {
      interfaceVersion: 1,
      id: "example.validation.malformed",
      ruleVersion: "1.0.0",
      input: "architecture-document",
      applicability: undefined,
      evaluate: () => [],
    } as unknown as ValidationRuleV1;
    const malformedDocument: Record<string, unknown> = {
      kind: "cloudmarkup.architecture-document",
      schemaVersion: 1,
    };
    malformedDocument["cycle"] = malformedDocument;

    const report = executeArchitectureValidationRules(
      {
        document: malformedDocument,
        target: "draft",
        environment: "unknown",
      },
      [malformedRule],
    );

    expect(report.evaluationStatus).toBe("incomplete");
    expect(report.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "document_structure_invalid",
        "invalid_rule_definition",
      ]),
    );
    expect(Object.isFrozen(malformedDocument)).toBe(false);
    expect(malformedDocument["cycle"]).toBe(malformedDocument);
  });

  it("rejects extension rules that try to shadow the reserved core namespace", async () => {
    const duplicate = JSON.parse(
      await readArchitectureFixture("invalid/duplicate-node-id.json"),
    ) as unknown;
    const shadow = testRule(
      "cloudmarkup.core.validation.duplicate-identity",
      () => [],
    );
    const namespaceRoot = testRule("cloudmarkup.core", () => []);

    const report = validateArchitectureDocumentWithRules({
      document: duplicate,
      target: "draft",
      environment: "development",
      additionalRules: [namespaceRoot, shadow],
    });

    expect(report.findings.map((finding) => finding.code)).toContain(
      "cloudmarkup.validation.duplicate-node-id",
    );
    expect(
      report.diagnostics
        .filter((entry) => entry.code === "reserved_rule_id")
        .map((entry) => entry.ruleId),
    ).toEqual([namespaceRoot.id, shadow.id]);
    expect(report.evaluationStatus).toBe("incomplete");
  });
});

describe("provider-neutral validation rules", () => {
  it("reports workload semantic references through the Validation Engine", async () => {
    const document = await representativeDocumentV2();
    const invalid = {
      ...document,
      workloadBehavior: {
        ...document.workloadBehavior,
        workloads: document.workloadBehavior.workloads.map((workload, index) =>
          index === 0
            ? { ...workload, owningNodeId: "node_missing" }
            : workload,
        ),
      },
    };

    const report = validateArchitectureDocumentWithRules({
      document: invalid,
      target: "revision",
      environment: "staging",
    });
    const finding = report.findings.find(
      (candidateFinding) =>
        candidateFinding.code ===
        "cloudmarkup.validation.broken-workload-owner-reference",
    );

    expect(finding?.affected).toEqual([
      {
        kind: "document",
        path: "$.workloadBehavior.workloads[0].owningNodeId",
      },
    ]);
  });

  it("reports implementation and dispatch ownership contradictions through the Validation Engine", async () => {
    const document = await representativeDocumentV2();
    const workload = document.workloadBehavior.workloads[0];
    const operation = workload?.operations[0];
    if (workload === undefined || operation === undefined) {
      throw new Error(
        "Representative v2 fixture must contain a workload operation.",
      );
    }
    const invalid = {
      ...document,
      workloadBehavior: {
        ...document.workloadBehavior,
        workloads: [
          {
            ...workload,
            implementation: { mode: "infrastructure-only" },
            triggerDispatch: {
              mode: "user-provided",
              dispatcherOperationId: operation.id,
            },
          },
        ],
      },
    };

    const report = validateArchitectureDocumentWithRules({
      document: invalid,
      target: "revision",
      environment: "staging",
    });
    const finding = report.findings.find(
      (candidateFinding) =>
        candidateFinding.code ===
        "cloudmarkup.validation.invalid-workload-dispatch-mode-for-implementation",
    );

    expect(report.diagnostics).toEqual([]);
    expect(finding).toMatchObject({
      severity: "error",
      affected: [
        {
          kind: "document",
          path: "$.workloadBehavior.workloads[0].triggerDispatch.mode",
        },
      ],
      rules: [
        {
          ruleId: "cloudmarkup.core.validation.broken-reference",
          ruleVersion: "1.0.0",
        },
      ],
    });
  });

  it("reports duplicate IDs, broken references, and invalid parent cycles", async () => {
    const duplicate = JSON.parse(
      await readArchitectureFixture("invalid/duplicate-node-id.json"),
    ) as unknown;
    const broken = JSON.parse(
      await readArchitectureFixture("invalid/broken-references.json"),
    ) as unknown;
    const document = await representativeDocument();
    const applicationNode = document.nodes.find(
      (node) => node.id === "node_application",
    );
    const networkNode = document.nodes.find(
      (node) => node.id === "node_network",
    );
    if (applicationNode === undefined || networkNode === undefined) {
      throw new Error(
        "Representative fixture must contain application and network nodes.",
      );
    }
    const cycle = {
      ...document,
      nodes: document.nodes.map((node) => ({
        ...node,
        semantic: {
          ...node.semantic,
          parent: {
            nodeId:
              node.id === "node_application"
                ? networkNode.id
                : applicationNode.id,
            relationshipType: "example.relationship.contains",
          },
        },
      })),
    };

    const duplicateReport = validateArchitectureDocumentWithRules({
      document: duplicate,
      target: "draft",
      environment: "development",
    });
    const brokenReport = validateArchitectureDocumentWithRules({
      document: broken,
      target: "draft",
      environment: "development",
    });
    const cycleReport = validateArchitectureDocumentWithRules({
      document: cycle,
      target: "draft",
      environment: "development",
    });

    expect(duplicateReport.findings.map((finding) => finding.code)).toContain(
      "cloudmarkup.validation.duplicate-node-id",
    );
    expect(brokenReport.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "cloudmarkup.validation.broken-edge-source-reference",
        "cloudmarkup.validation.broken-edge-target-reference",
        "cloudmarkup.validation.broken-parent-reference",
      ]),
    );
    expect(cycleReport.findings.map((finding) => finding.code)).toContain(
      "cloudmarkup.validation.parent-cycle",
    );
  });

  it("reports missing ports from a matching provider-neutral inventory", async () => {
    const document = await representativeDocument();
    const edge = document.edges[0];
    if (edge === undefined) {
      throw new Error("Representative fixture must contain an edge.");
    }
    const report = validateArchitectureDocumentWithRules({
      document,
      target: "compilation",
      environment: "production",
      portInventory: {
        providerId: document.provider.id,
        catalogId: document.catalog.id,
        catalogVersion: document.catalog.version,
        coverage: "complete",
        nodes: [
          {
            nodeId: edge.semantic.source.nodeId,
            ports: [],
          },
          {
            nodeId: edge.semantic.target.nodeId,
            ports: [edge.semantic.target.port],
          },
        ],
      },
    });
    const finding = report.findings.find(
      (candidateFinding) =>
        candidateFinding.code === "cloudmarkup.validation.missing-port",
    );

    expect(finding?.affected).toEqual([
      expect.objectContaining({
        kind: "port",
        edgeId: edge.id,
        endpoint: "source",
        nodeId: edge.semantic.source.nodeId,
        port: edge.semantic.source.port,
      }),
    ]);
  });

  it("reports invalid variable/output references with configuration paths", async () => {
    const document = await representativeDocument();
    const firstNode = document.nodes[0];
    const firstOutput = document.outputs[0];
    if (firstNode === undefined || firstOutput === undefined) {
      throw new Error("Representative fixture must contain a node and output.");
    }
    const invalid = {
      ...document,
      nodes: document.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                configuration: {
                  ...node.semantic.configuration,
                  values: {
                    ...node.semantic.configuration.values,
                    variableRef: {
                      kind: "variable-reference",
                      variableId: "variable_missing",
                    },
                  },
                },
              },
            }
          : node,
      ),
      outputs: document.outputs.map((output, index) =>
        index === 0
          ? {
              ...firstOutput,
              source: {
                kind: "node-attribute",
                nodeId: "node_missing",
                attribute: "example.attribute.value",
              },
            }
          : output,
      ),
    };
    const report = validateArchitectureDocumentWithRules({
      document: invalid,
      target: "revision",
      environment: "staging",
    });

    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "cloudmarkup.validation.broken-configuration-variable-reference",
        "cloudmarkup.validation.broken-output-node-reference",
      ]),
    );
    expect(
      report.findings
        .flatMap((finding) => finding.affected)
        .map((affected) => affected.kind),
    ).toContain("configuration");
  });

  it("reports malformed provenance even when strict structural parsing fails", async () => {
    const document = await representativeDocument();
    const malformed = {
      ...document,
      nodes: document.nodes.map((node) =>
        node.semantic.lifecycle.ownership === "generated"
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                lifecycle: {
                  ...node.semantic.lifecycle,
                  provenance: {
                    ...node.semantic.lifecycle.provenance,
                    operationId: "not a valid operation id",
                  },
                },
              },
            }
          : node,
      ),
    };
    const report = validateArchitectureDocumentWithRules({
      document: malformed,
      target: "draft",
      environment: "development",
    });

    expect(report.evaluationStatus).toBe("incomplete");
    expect(report.diagnostics.map((entry) => entry.code)).toContain(
      "document_structure_invalid",
    );
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "cloudmarkup.validation.malformed-operation-provenance",
          severity: "security-error",
        }),
      ]),
    );
  });

  it("routes Architecture v3 application contract integrity and duplicate identity findings", async () => {
    const document = await representativeDocumentV3();
    const workload = document.workloadBehavior.workloads[0];
    const operation = workload?.operations[0];
    if (workload === undefined || operation === undefined) {
      throw new Error("Representative v3 fixture must expose an operation.");
    }

    const contract = {
      authenticationMethod: "none",
      claims: [],
      contractId: "contract.auth.primary",
      contractKind: "auth",
      contractVersion: "1.0.0",
      displayName: "Primary authorization",
      provenance: {
        recordedAt: document.revision.createdAt,
        recordedBy: document.revision.createdBy,
        source: "designed",
        sourceReferenceIds: [],
      },
      roles: [],
    } as const;
    const exactDigest = hashCanonicalValue(contract);
    const candidate = {
      ...document,
      applicationContracts: {
        ...document.applicationContracts,
        contracts: [contract, contract],
      },
      workloadBehavior: {
        ...document.workloadBehavior,
        workloads: [
          {
            ...workload,
            authorization: [
              {
                authContract: {
                  contractId: "contract.auth.missing",
                  contractKind: "auth",
                  contractVersion: "1.0.0",
                  digest:
                    "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                },
                bindingId: "authorization_missing_contract",
                deniedBehavior: "reject",
                operationIds: [operation.id],
                permittedRoleIds: [],
              },
              {
                authContract: {
                  contractId: contract.contractId,
                  contractKind: contract.contractKind,
                  contractVersion: contract.contractVersion,
                  digest:
                    "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                },
                bindingId: "authorization_bad_digest",
                deniedBehavior: "reject",
                operationIds: [operation.id],
                permittedRoleIds: [],
              },
            ],
            behaviorContracts: [
              {
                contractId: contract.contractId,
                contractKind: "behavior-operation",
                contractVersion: contract.contractVersion,
                digest: exactDigest,
              },
            ],
          },
        ],
      },
    };
    const report = validateArchitectureDocumentWithRules({
      document: candidate,
      target: "revision",
      environment: "development",
    });

    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "cloudmarkup.validation.application-contract-digest-mismatch",
        "cloudmarkup.validation.application-contract-kind-mismatch",
        "cloudmarkup.validation.broken-application-contract-reference",
        "cloudmarkup.validation.duplicate-application-contract-identity",
      ]),
    );
  });

  it("routes Architecture v3 external resource reference and duplicate identity findings", async () => {
    const document = await representativeDocumentV3();
    const resource = {
      addresses: [],
      architectureNodeIds: ["node_missing"],
      availability: { assumption: "unknown" },
      capability: "external.example.service",
      dataClassifications: [],
      displayName: "External example service",
      evidence: [],
      extractedCandidates: [],
      id: "external_example_service",
      interfaces: [],
      lifecycle: {
        behavior: {
          create: "forbidden",
          dataSource: "allowed",
          import: "unsupported",
          reference: "required",
        },
        iacTargets: [],
        lifecycleAuthority: "third-party-owner",
        ownershipState: "third-party-service-api",
      },
      provider: {
        reason: "The provider has not been reviewed.",
        state: "unknown",
      },
      scope: {},
      trustBoundary: "unknown",
      unresolvedInformation: [],
    } as const;
    const report = validateArchitectureDocumentWithRules({
      document: {
        ...document,
        externalResources: {
          ...document.externalResources,
          resources: [resource, resource],
        },
      },
      target: "revision",
      environment: "development",
    });

    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "cloudmarkup.validation.broken-external-resource-node-reference",
        "cloudmarkup.validation.duplicate-external-resource-id",
      ]),
    );
  });

  it("routes Architecture v3 workload operation and edge reference findings", async () => {
    const document = await representativeDocumentV3();
    const workload = document.workloadBehavior.workloads[0];
    const operation = workload?.operations[0];
    if (
      workload === undefined ||
      operation === undefined ||
      workload.implementation.mode === "infrastructure-only"
    ) {
      throw new Error(
        "Representative v3 fixture must expose a handled operation.",
      );
    }
    const report = validateArchitectureDocumentWithRules({
      document: {
        ...document,
        workloadBehavior: {
          ...document.workloadBehavior,
          workloads: [
            {
              ...workload,
              entrypoints: [
                {
                  entrypointId: "entrypoint_missing_operation",
                  handler: workload.implementation.handler,
                  kind: "request-handler",
                  operationId: "operation_missing",
                },
              ],
              schedules: [
                {
                  bindingId: "schedule_missing_edge",
                  operationId: operation.id,
                  schedule: { kind: "interval", seconds: 60 },
                  triggerEdgeId: "edge_missing",
                },
              ],
            },
          ],
        },
      },
      target: "revision",
      environment: "development",
    });

    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "cloudmarkup.validation.broken-workload-v2-edge-reference",
        "cloudmarkup.validation.broken-workload-v2-operation-reference",
      ]),
    );
  });

  it("routes Architecture v3 AI extension and ModelGateway authority findings", async () => {
    const document = await representativeDocumentV3();
    const workload = document.workloadBehavior.workloads[0];
    if (
      workload === undefined ||
      workload.implementation.mode === "infrastructure-only"
    ) {
      throw new Error("Representative v3 fixture must expose a handler.");
    }
    const extension = {
      digest:
        "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      extensionContractVersion: 1,
      extensionId: "extension_custom_handler",
      ownership: "ai-authored",
      validationEvidenceIds: ["evidence_static_1"],
    } as const;
    const implementation = {
      extension,
      handler: workload.implementation.handler,
      mode: "ai-assisted-custom",
      runtimeFamily: workload.implementation.runtimeFamily,
      sourceOwnership: "ai-authored",
    } as const;
    const aiProvenance = {
      acceptedAt: document.revision.createdAt,
      acceptedBy: document.revision.createdBy,
      modelGatewayId: "cloudmarkup.model-gateway",
      modelId: "model-example-1",
      modelProviderId: "provider.example.model",
      outputDigest:
        "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      promptDigest:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      promptTemplateId: "cloudmarkup.prompt.workload",
      promptVersion: "1.0.0",
      source: "ai-assisted",
    } as const;
    const aiCandidate = {
      ...workload,
      compatibility: {
        ...workload.compatibility,
        modelGateways: [],
      },
      extensions: [],
      implementation,
      provenance: aiProvenance,
    };
    const missingReport = validateArchitectureDocumentWithRules({
      document: {
        ...document,
        workloadBehavior: {
          ...document.workloadBehavior,
          workloads: [aiCandidate],
        },
      },
      target: "revision",
      environment: "development",
    });
    const duplicateReport = validateArchitectureDocumentWithRules({
      document: {
        ...document,
        workloadBehavior: {
          ...document.workloadBehavior,
          workloads: [
            {
              ...aiCandidate,
              extensions: [extension, extension],
            },
          ],
        },
      },
      target: "revision",
      environment: "development",
    });
    const invalidProvenanceReport = validateArchitectureDocumentWithRules({
      document: {
        ...document,
        workloadBehavior: {
          ...document.workloadBehavior,
          workloads: [
            {
              ...aiCandidate,
              extensions: [extension],
              provenance: {
                recordedAt: document.revision.createdAt,
                recordedBy: document.revision.createdBy,
                source: "manual",
              },
            },
          ],
        },
      },
      target: "revision",
      environment: "development",
    });

    expect(missingReport.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "cloudmarkup.validation.broken-workload-extension-reference",
        "cloudmarkup.validation.missing-workload-model-compatibility",
      ]),
    );
    expect(duplicateReport.findings.map((finding) => finding.code)).toContain(
      "cloudmarkup.validation.duplicate-workload-extension-id",
    );
    expect(
      invalidProvenanceReport.findings.map((finding) => finding.code),
    ).toContain("cloudmarkup.validation.invalid-workload-model-compatibility");
  });

  it("accepts Architecture v3 and reports v4 as unsupported with a deterministic report hash", async () => {
    const current = await representativeDocumentV3();
    const currentReport = validateArchitectureDocumentWithRules({
      document: current,
      target: "revision",
      environment: "unknown",
    });
    const unsupported = { ...current, schemaVersion: 4 };
    const first = validateArchitectureDocumentWithRules({
      document: unsupported,
      target: "revision",
      environment: "unknown",
    });
    const second = validateArchitectureDocumentWithRules({
      document: unsupported,
      target: "revision",
      environment: "unknown",
    });

    expect(currentReport.findings.map((finding) => finding.code)).not.toContain(
      "cloudmarkup.validation.unsupported-document-version",
    );
    expect(second).toEqual(first);
    expect(first.documentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    const versionFinding = first.findings.find(
      (finding) =>
        finding.code === "cloudmarkup.validation.unsupported-document-version",
    );
    expect(versionFinding).toEqual(
      expect.objectContaining({
        technicalExplanation:
          "The validation engine supports Architecture Document schema versions 1, 2, and 3 and does not reinterpret unknown versions.",
      }),
    );
  });
});
