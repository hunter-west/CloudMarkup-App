import { describe, expect, it } from "vitest";
import { parseArchitectureDocument } from "@cloudmarkup/domain";
import { prepareEditorCatalogOpening } from "@cloudmarkup/graph-preparation/catalog-opening";
import { serializeArchitectureDocumentV3 } from "@cloudmarkup/schemas";

import { awsEditorCatalog } from "./aws-editor-catalog.js";
import {
  loadManualNotesApiArchitectureDocument,
  loadAwsNetworkingVisualArchitectureDocument,
} from "./aws-editor-fixture.js";
import { awsEditorValidationEvaluator } from "./aws-editor-validation.js";

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined)
    throw new Error("Expected a synthetic fixture entry.");
  return value;
}

function older(document = loadManualNotesApiArchitectureDocument()) {
  return parseArchitectureDocument({
    ...document,
    catalog: {
      ...document.catalog,
      version: "0.16.0",
      digest: "sha256:" + "a".repeat(64),
    },
  });
}

describe("saved project catalog opening", () => {
  it("opens v1/v2 projects after catalog additions, changing only the binding", () => {
    const current = loadManualNotesApiArchitectureDocument();
    const legacy = structuredClone(current) as unknown as Record<
      string,
      unknown
    >;
    delete legacy["applicationContracts"];
    delete legacy["externalResources"];
    for (const schemaVersion of [1, 2]) {
      legacy["schemaVersion"] = schemaVersion;
      if (schemaVersion === 1) delete legacy["workloadBehavior"];
      else legacy["workloadBehavior"] = { contractVersion: 1, workloads: [] };
      const source = older(parseArchitectureDocument(legacy));
      const before = serializeArchitectureDocumentV3(source);
      const result = prepareEditorCatalogOpening(source, awsEditorCatalog);
      expect(result.issues).toEqual([]);
      expect(result.status).toBe("compatible");
      expect(result.document).toEqual({
        ...source,
        catalog: awsEditorCatalog.identity,
      });
      expect(serializeArchitectureDocumentV3(source)).toBe(before);
      expect(
        prepareEditorCatalogOpening(result.document, awsEditorCatalog).status,
      ).toBe("current");
    }
  });

  it("preserves nested service parents, node identities, configuration and all connections through save/reload", () => {
    const source = older(loadAwsNetworkingVisualArchitectureDocument());
    expect(
      source.nodes.some((node) => node.semantic.parent !== undefined),
    ).toBe(true);
    expect(source.edges.length).toBeGreaterThan(0);
    const result = prepareEditorCatalogOpening(source, awsEditorCatalog);
    expect(result.issues).toEqual([]);
    expect(result.status).toBe("compatible");
    const reloaded = parseArchitectureDocument(
      JSON.parse(serializeArchitectureDocumentV3(result.document)) as unknown,
    );
    const canonicalSource = parseArchitectureDocument(
      JSON.parse(serializeArchitectureDocumentV3(source)) as unknown,
    );
    expect(reloaded.nodes).toEqual(canonicalSource.nodes);
    expect(reloaded.edges).toEqual(canonicalSource.edges);
    expect(reloaded.workloadBehavior).toEqual(source.workloadBehavior);
    expect(reloaded.applicationContracts).toEqual(source.applicationContracts);
  });

  it("previews a lossless node and connection schema adaptation for explicit review", () => {
    const source = older();
    const serviceType = first(source.nodes).semantic.serviceType;
    const relationshipType = first(source.edges).semantic.relationshipType;
    const catalog = {
      ...awsEditorCatalog,
      services: awsEditorCatalog.services.map((service) =>
        service.serviceType === serviceType
          ? {
              ...service,
              configuration: {
                ...service.configuration,
                schemaVersion: "2.0.0",
              },
            }
          : service,
      ),
      relationships: (awsEditorCatalog.relationships ?? []).map(
        (relationship) =>
          relationship.id === relationshipType
            ? {
                ...relationship,
                configuration: {
                  ...relationship.configuration,
                  schemaVersion: "2.0.0",
                },
              }
            : relationship,
      ),
    };
    const before = structuredClone(source);
    const result = prepareEditorCatalogOpening(source, catalog);
    expect(result.status).toBe("review-required");
    expect(
      result.issues.some((issue) => issue.path.startsWith("$.nodes")),
    ).toBe(true);
    expect(
      result.issues.some((issue) => issue.path.startsWith("$.edges")),
    ).toBe(true);
    expect(
      result.document.nodes.map((node) => node.semantic.configuration.values),
    ).toEqual(source.nodes.map((node) => node.semantic.configuration.values));
    expect(
      result.document.edges.map((edge) => edge.semantic.configuration.values),
    ).toEqual(source.edges.map((edge) => edge.semantic.configuration.values));
    expect(
      first(result.document.nodes).semantic.configuration.schemaVersion,
    ).toBe("2.0.0");
    expect(
      first(result.document.edges).semantic.configuration.schemaVersion,
    ).toBe("2.0.0");
    expect(source).toEqual(before);
  });

  it("retains unknown configuration fields, removed services, and removed ports without rebinding", () => {
    const baseline = older();
    const unknownField = parseArchitectureDocument({
      ...baseline,
      nodes: baseline.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                configuration: {
                  ...node.semantic.configuration,
                  values: {
                    ...node.semantic.configuration.values,
                    futureSetting: { kind: "string", value: "retain-me" },
                  },
                },
              },
            }
          : node,
      ),
    });
    const removedService = {
      ...awsEditorCatalog,
      services: awsEditorCatalog.services.filter(
        (service) =>
          service.serviceType !== first(baseline.nodes).semantic.serviceType,
      ),
    };
    const removedPort = {
      ...awsEditorCatalog,
      services: awsEditorCatalog.services.map((service) => ({
        ...service,
        ports: [],
      })),
    };
    for (const [source, catalog] of [
      [unknownField, awsEditorCatalog],
      [baseline, removedService],
      [baseline, removedPort],
    ] as const) {
      const before = serializeArchitectureDocumentV3(source);
      const result = prepareEditorCatalogOpening(source, catalog);
      expect(result.status).toBe("unavailable");
      expect(result.issues.length).toBeGreaterThan(0);
      expect(serializeArchitectureDocumentV3(result.document)).toBe(before);
      expect(serializeArchitectureDocumentV3(source)).toBe(before);
    }
  });

  it("keeps foreign, future and structurally unknown document versions intact instead of guessing a migration", () => {
    const source = older();
    for (const catalog of [
      { ...source.catalog, id: "different.provider.catalog" },
      { ...source.catalog, version: "999.0.0" },
      { ...source.catalog, version: "0.30.0-preview" },
    ]) {
      const document = parseArchitectureDocument({ ...source, catalog });
      expect(
        prepareEditorCatalogOpening(document, awsEditorCatalog),
      ).toMatchObject({ status: "unavailable", document });
    }
    const future = {
      ...source,
      schemaVersion: 999,
      futureMetadata: { retain: true },
    };
    const before = structuredClone(future);
    expect(() => parseArchitectureDocument(future)).toThrow();
    expect(future).toEqual(before);
  });

  it("requires an adapted exact catalog for export validation and retains normal validation findings", async () => {
    const source = older();
    expect(() =>
      awsEditorValidationEvaluator.evaluate({
        document: source,
        target: "compilation",
      }),
    ).toThrow("exact bundled provider catalog");
    const opened = prepareEditorCatalogOpening(source, awsEditorCatalog);
    expect(opened.status).toBe("compatible");
    const report = await awsEditorValidationEvaluator.evaluate({
      document: opened.document,
      target: "compilation",
    });
    expect(report.catalog).toEqual(awsEditorCatalog.identity);
    expect(report.target).toBe("compilation");
    expect(report).toEqual(
      await awsEditorValidationEvaluator.evaluate({
        document: parseArchitectureDocument(opened.document),
        target: "compilation",
      }),
    );
  });
});
