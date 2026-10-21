import { portTypeSchema, sha256DigestSchema } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  defineProviderConnectionPresentationSourceV1,
  type ProviderConnectionPresentationSourceV1,
} from "./connection-presentation-contract-v1.js";
import {
  ProviderConnectionPresentationCompilationError,
  compileProviderConnectionPresentationV1,
  createProviderConnectionPresentationAccessorsV1,
  renderProviderConnectionPresentationAccessorModuleV1,
} from "./connection-presentation-compiler-v1.js";
import { compileProviderCatalogV1 } from "./compiler.js";

function createSemanticCatalog(options?: {
  readonly outputCardinality?: "one" | "many";
  readonly outputRequired?: boolean;
  readonly maximumConnectionsPerSource?: number;
}) {
  return compileProviderCatalogV1({
    contractVersion: 1,
    provider: {
      id: "example.cloud",
      displayName: "Example Cloud",
      description: "A synthetic provider for connection presentation tests.",
      iconNamespace: "example.cloud.icons",
      homepage: "https://example.com/",
      documentation: [
        {
          kind: "official",
          id: "example.cloud.documentation.home",
          title: "Example Cloud documentation",
          publisher: "Example Cloud",
          url: "https://example.com/docs",
        },
      ],
    },
    catalog: {
      id: "example.cloud.catalog",
      version: "1.0.0",
      maturity: "proof",
      description: "A synthetic semantic catalog.",
      architectureDocumentSchemaVersions: [1],
      runtimeRetrieval: "forbidden",
    },
    services: [
      {
        id: "example.cloud.service",
        definitionVersion: "1.0.0",
        supportLevel: "proof",
        displayName: "Example service",
        description: "A synthetic service with exact semantic ports.",
        nodeKind: {
          kind: "resource",
          resourceType: "example.cloud.resource",
          deployable: true,
        },
        iconId: "example.cloud.icons.service",
        placement: {
          rootPlacement: "allowed",
          allowedParentTypes: [],
          regionConstraint: "not-applicable",
        },
        configuration: {
          schemaId: "example.cloud.configuration.service",
          schemaVersion: "1.0.0",
          jsonSchema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            $id: "urn:cloudmarkup:configuration:example.cloud.configuration.service:1.0.0",
            type: "object",
            title: "Example service configuration",
            additionalProperties: false,
            properties: {},
            required: [],
          },
          uiHints: [],
        },
        ports: [
          {
            id: "example.cloud.port.output",
            displayName: "Output",
            description: "An exact semantic output port.",
            direction: "output",
            capability: "example.cloud.capability.output",
            category: "sends-messages-or-events",
            cardinality: options?.outputCardinality ?? "many",
            required: options?.outputRequired ?? false,
          },
          {
            id: "example.cloud.port.input",
            displayName: "Input",
            description: "An exact semantic input port.",
            direction: "input",
            capability: "example.cloud.capability.input",
            category: "sends-messages-or-events",
            cardinality: "many",
            required: false,
          },
          {
            id: "example.cloud.port.secondary-input",
            displayName: "Secondary input",
            description: "Another exact semantic input port.",
            direction: "input",
            capability: "example.cloud.capability.secondary-input",
            category: "sends-messages-or-events",
            cardinality: "many",
            required: false,
          },
        ],
        validationRuleIds: [],
        education: {
          summary: "Synthetic service education.",
          guidedExplanation: "Guided synthetic service explanation.",
          professionalExplanation:
            "Professional synthetic service explanation.",
          considerations: [],
          documentation: [],
        },
        unsupportedCapabilities: [],
        mappings: [],
        regionAvailability: {
          state: "unknown",
          reason: "Synthetic tests do not claim a provider region inventory.",
        },
      },
    ],
    connectionRules: [
      {
        id: "example.cloud.connection.self",
        ruleVersion: "1.0.0",
        relationshipType: "example.cloud.relationship",
        category: "sends-messages-or-events",
        source: {
          serviceId: "example.cloud.service",
          portId: "example.cloud.port.output",
        },
        target: {
          serviceId: "example.cloud.service",
          portId: "example.cloud.port.input",
        },
        maximumConnectionsPerSource: options?.maximumConnectionsPerSource ?? 16,
        maximumConnectionsPerTarget: 16,
        maximumConnectionsPerEndpointPair: 1,
        configuration: {
          schemaId: "example.cloud.configuration.connection",
          schemaVersion: "1.0.0",
          jsonSchema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            $id: "urn:cloudmarkup:configuration:example.cloud.configuration.connection:1.0.0",
            type: "object",
            title: "Example connection configuration",
            additionalProperties: false,
            properties: {},
            required: [],
          },
          uiHints: [],
        },
        questions: [],
        supportingChanges: [],
        iamEffects: [],
        missingInformationFindings: [],
        lifecycle: {
          provenance: "connection-rule",
          deletion: "release-generated-resources",
          adoption: "required-before-customization",
          sharedResource: "retain-while-referenced",
        },
        implementation: {
          status: "not-implemented",
          reason: "The synthetic rule exists only for contract tests.",
        },
        validationRuleIds: [],
        education: {
          summary: "Synthetic relationship education.",
          guidedExplanation: "Guided synthetic relationship explanation.",
          professionalExplanation:
            "Professional synthetic relationship explanation.",
          considerations: [],
          documentation: [],
        },
      },
    ],
    validationRules: [],
    migrations: [],
  });
}

function createPresentationSource(
  catalog = createSemanticCatalog().artifact,
): ProviderConnectionPresentationSourceV1 {
  return defineProviderConnectionPresentationSourceV1({
    contractVersion: 1,
    catalog: {
      id: catalog.catalog.id,
      version: catalog.catalog.version,
      digest: catalog.digest,
    },
    services: [
      {
        serviceId: "example.cloud.service",
        docks: [
          {
            id: "example.cloud.dock.output",
            category: "messaging",
            label: "Sends",
            description: "Outgoing message relationships.",
            placement: "right",
            order: 0,
            directionPolicy: "output-only",
            portIds: ["example.cloud.port.output"],
            cardinality: {
              minimum: 0,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: false,
            guidedExplanation: "Connect a supported destination.",
            professionalExplanation:
              "The exact semantic output port remains authoritative.",
          },
          {
            id: "example.cloud.dock.input",
            category: "triggers",
            label: "Receives",
            description: "Incoming message relationships.",
            placement: "left",
            order: 0,
            directionPolicy: "input-only",
            portIds: [
              "example.cloud.port.secondary-input",
              "example.cloud.port.input",
            ],
            cardinality: {
              minimum: 0,
              maximum: "many",
              enforcement: "provider-rule",
            },
            allowsMultipleEdges: true,
            containsExclusiveRelationships: false,
            guidedExplanation: "Connect a supported source.",
            professionalExplanation:
              "Both exact semantic input ports share one stable dock.",
          },
        ],
      },
    ],
    relationshipLabels: [
      {
        ruleId: "example.cloud.connection.self",
        label: "Sends to",
      },
    ],
  });
}

function compilationIssues(action: () => unknown) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(
      ProviderConnectionPresentationCompilationError,
    );
    return (error as ProviderConnectionPresentationCompilationError).issues;
  }
  throw new Error("Expected presentation compilation to fail.");
}

function compilationIssueCodes(action: () => unknown): string[] {
  return compilationIssues(action).map((issue) => issue.code);
}

describe("provider connection presentation compiler v1", () => {
  it("compiles an exact semantic binding and exposes deterministic accessors", () => {
    const semantic = createSemanticCatalog();
    const compilation = compileProviderConnectionPresentationV1(
      createPresentationSource(),
      semantic.artifact,
    );
    const accessors = createProviderConnectionPresentationAccessorsV1(
      compilation.artifact,
    );

    expect(compilation.hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(compilation.artifact.catalog.digest).toBe(semantic.artifact.digest);
    expect(
      accessors.dockForPort("example.cloud.service", "example.cloud.port.input")
        ?.id,
    ).toBe("example.cloud.dock.input");
    expect(
      accessors.getDock("example.cloud.service", "example.cloud.dock.output")
        ?.label,
    ).toBe("Sends");
    expect(accessors.relationshipLabel("example.cloud.connection.self")).toBe(
      "Sends to",
    );
    expect(accessors.getServicePresentation("example.cloud.unknown")).toBe(
      undefined,
    );
    expect(() =>
      accessors.requireServicePresentation("example.cloud.unknown"),
    ).toThrow("not present");

    const moduleSource = renderProviderConnectionPresentationAccessorModuleV1(
      compilation,
      {
        artifactImportPath: "./generated/connection-presentation-v1.json",
        artifactExportName: "presentationArtifactV1",
        accessorsExportName: "presentationAccessorsV1",
        digestExportName: "presentationDigestV1",
      },
    );
    expect(moduleSource).toContain(
      "createProviderConnectionPresentationAccessorsV1",
    );
    expect(moduleSource).toContain("presentationAccessorsV1");
    expect(moduleSource).toContain(compilation.hash);
  });

  it("normalizes source ordering before hashing", () => {
    const semantic = createSemanticCatalog();
    const firstSource = createPresentationSource();
    const reordered = structuredClone(firstSource);
    reordered.services[0]?.docks.reverse();
    reordered.services[0]?.docks.forEach((dock) => dock.portIds.reverse());
    reordered.relationshipLabels.reverse();

    const first = compileProviderConnectionPresentationV1(
      firstSource,
      semantic.artifact,
    );
    const second = compileProviderConnectionPresentationV1(
      reordered,
      semantic.artifact,
    );

    expect(second.hash).toBe(first.hash);
    expect(second.canonicalJson).toBe(first.canonicalJson);
    expect(
      second.artifact.services[0]?.docks.find(
        (dock) => dock.id === "example.cloud.dock.input",
      )?.portIds,
    ).toEqual([
      "example.cloud.port.input",
      "example.cloud.port.secondary-input",
    ]);
  });

  it("fails closed on a mismatched semantic catalog binding", () => {
    const semantic = createSemanticCatalog();
    const source = structuredClone(createPresentationSource());
    source.catalog.digest = sha256DigestSchema.parse(
      `sha256:${"0".repeat(64)}`,
    );

    expect(
      compilationIssueCodes(() =>
        compileProviderConnectionPresentationV1(source, semantic.artifact),
      ),
    ).toContain("catalog-binding-mismatch");
  });

  it("rejects a semantic catalog artifact whose content no longer matches its digest", () => {
    const semantic = createSemanticCatalog();
    const tamperedCatalog = structuredClone(semantic.artifact);
    const firstService = tamperedCatalog.services[0];
    if (firstService === undefined) {
      throw new Error("The semantic fixture must declare a service.");
    }
    firstService.displayName = "Tampered service";

    expect(
      compilationIssueCodes(() =>
        compileProviderConnectionPresentationV1(
          createPresentationSource(),
          tamperedCatalog,
        ),
      ),
    ).toContain("invalid-catalog-artifact");
  });

  it("rejects missing, duplicate, and unknown semantic port assignments", () => {
    const semantic = createSemanticCatalog();
    const missing = structuredClone(createPresentationSource());
    missing.services[0]?.docks[1]?.portIds.pop();
    expect(
      compilationIssueCodes(() =>
        compileProviderConnectionPresentationV1(missing, semantic.artifact),
      ),
    ).toContain("missing-port-assignment");

    const duplicate = structuredClone(createPresentationSource());
    duplicate.services[0]?.docks[0]?.portIds.push(
      portTypeSchema.parse("example.cloud.port.input"),
    );
    expect(
      compilationIssueCodes(() =>
        compileProviderConnectionPresentationV1(duplicate, semantic.artifact),
      ),
    ).toContain("duplicate-port-assignment");

    const unknown = structuredClone(createPresentationSource());
    const inputPorts = unknown.services[0]?.docks[1]?.portIds;
    if (inputPorts !== undefined) {
      inputPorts[0] = portTypeSchema.parse("example.cloud.port.unknown");
    }
    const unknownCodes = compilationIssueCodes(() =>
      compileProviderConnectionPresentationV1(unknown, semantic.artifact),
    );
    expect(unknownCodes).toContain("unknown-port");
    expect(unknownCodes).toContain("missing-port-assignment");
  });

  it("rejects direction, order, cardinality, and relationship contradictions", () => {
    const semantic = createSemanticCatalog();
    const contradicted = structuredClone(createPresentationSource());
    const outputDock = contradicted.services[0]?.docks[0];
    const inputDock = contradicted.services[0]?.docks[1];
    if (outputDock !== undefined && inputDock !== undefined) {
      outputDock.directionPolicy = "input-only";
      outputDock.allowsMultipleEdges = false;
      outputDock.id = inputDock.id;
      outputDock.placement = inputDock.placement;
      outputDock.order = inputDock.order;
    }
    const relationshipLabel = contradicted.relationshipLabels[0];
    if (relationshipLabel === undefined) {
      throw new Error(
        "The presentation fixture must declare its relationship label.",
      );
    }
    contradicted.relationshipLabels.push({
      ...relationshipLabel,
      label: "Also sends to",
    });

    const codes = compilationIssueCodes(() =>
      compileProviderConnectionPresentationV1(contradicted, semantic.artifact),
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "direction-policy-mismatch",
        "duplicate-dock-id",
        "duplicate-dock-order",
        "duplicate-relationship-label",
        "invalid-cardinality",
      ]),
    );
  });

  it("rejects a mixed dock even when its policy matches its exact ports", () => {
    const semantic = createSemanticCatalog();
    const contradicted = structuredClone(createPresentationSource());
    const outputDock = contradicted.services[0]?.docks[0];
    const inputDock = contradicted.services[0]?.docks[1];
    if (outputDock === undefined || inputDock === undefined) {
      throw new Error("The presentation fixture must declare both docks.");
    }
    inputDock.directionPolicy = "mixed";
    inputDock.placement = "bottom";
    inputDock.portIds.push(...outputDock.portIds);
    contradicted.services[0]?.docks.splice(0, 1);

    expect(
      compilationIssues(() =>
        compileProviderConnectionPresentationV1(
          contradicted,
          semantic.artifact,
        ),
      ),
    ).toContainEqual(
      expect.objectContaining({
        code: "mixed-direction-dock",
        path: "$.services[0].docks[0].directionPolicy",
      }),
    );
  });

  it("reconciles exclusivity and dock ranges with exact semantic ports and rules", () => {
    const semantic = createSemanticCatalog({
      outputCardinality: "one",
      outputRequired: true,
      maximumConnectionsPerSource: 1,
    });
    const contradicted = structuredClone(
      createPresentationSource(semantic.artifact),
    );

    const issues = compilationIssues(() =>
      compileProviderConnectionPresentationV1(contradicted, semantic.artifact),
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "exclusive-relationship-mismatch",
          path: "$.services[0].docks[0].containsExclusiveRelationships",
        }),
        expect.objectContaining({
          code: "invalid-cardinality",
          path: "$.services[0].docks[0].cardinality",
        }),
      ]),
    );
  });

  it("rejects a one-edge dock when its port and exact rule permit many", () => {
    const semantic = createSemanticCatalog();
    const contradicted = structuredClone(
      createPresentationSource(semantic.artifact),
    );
    const outputDock = contradicted.services[0]?.docks[0];
    if (outputDock === undefined) {
      throw new Error("The presentation fixture must declare its output dock.");
    }
    outputDock.cardinality.maximum = 1;
    outputDock.allowsMultipleEdges = false;
    outputDock.containsExclusiveRelationships = true;

    const issues = compilationIssues(() =>
      compileProviderConnectionPresentationV1(contradicted, semantic.artifact),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-cardinality",
          path: "$.services[0].docks[0].cardinality",
        }),
      ]),
    );
  });

  it("rejects a many-edge dock when its sole semantic port permits one", () => {
    const semantic = createSemanticCatalog({
      outputCardinality: "one",
      maximumConnectionsPerSource: 1,
    });
    const contradicted = structuredClone(
      createPresentationSource(semantic.artifact),
    );
    const outputDock = contradicted.services[0]?.docks[0];
    if (outputDock === undefined) {
      throw new Error("The presentation fixture must declare its output dock.");
    }
    outputDock.containsExclusiveRelationships = true;

    const issues = compilationIssues(() =>
      compileProviderConnectionPresentationV1(contradicted, semantic.artifact),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-cardinality",
          path: "$.services[0].docks[0].cardinality",
        }),
      ]),
    );
  });

  it("rejects semantic-port ranges that claim provider-only minimums", () => {
    const semantic = createSemanticCatalog();
    const contradicted = structuredClone(
      createPresentationSource(semantic.artifact),
    );
    const outputDock = contradicted.services[0]?.docks[0];
    if (outputDock === undefined) {
      throw new Error("The presentation fixture must declare its output dock.");
    }
    outputDock.cardinality.minimum = 1;
    outputDock.cardinality.enforcement = "semantic-port";

    expect(
      compilationIssueCodes(() =>
        compileProviderConnectionPresentationV1(
          contradicted,
          semantic.artifact,
        ),
      ),
    ).toContain("invalid-cardinality");
  });
});
