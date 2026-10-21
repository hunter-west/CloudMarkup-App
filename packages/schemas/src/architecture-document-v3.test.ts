import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  normalizeArchitectureDocumentV3,
  parseArchitectureDocumentV3,
  parseArchitectureDocumentV3Json,
  serializeArchitectureDocumentV3,
} from "./index.js";
import { ArchitectureDocumentSchemaError } from "./validation.js";

async function readRepositoryFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
}

async function readFixture(): Promise<string> {
  return readRepositoryFile(
    "packages/test-fixtures/fixtures/architecture-document/v3/valid/representative.json",
  );
}

describe("Architecture Document v3", () => {
  it("reads the migration-equivalent Workload v2 and empty new truth collections", async () => {
    const document = parseArchitectureDocumentV3Json(await readFixture());
    const workload = document.workloadBehavior.workloads[0];

    expect(document.schemaVersion).toBe(3);
    expect(document.applicationContracts.contracts).toEqual([]);
    expect(document.externalResources.resources).toEqual([]);
    expect(workload?.provenance).toEqual({
      source: "deterministic-migration",
      migrationId: "cloudmarkup.workload.v1-to-v2",
      migrationVersion: "1.0.0",
    });
    expect(workload?.behaviorContracts).toEqual([]);
    expect(workload?.observability).toEqual({
      signals: [],
      healthChecks: [],
      smokeTests: [],
    });
  });

  it("canonicalizes graph and Workload v2 ordering without mutating input", async () => {
    const document = parseArchitectureDocumentV3Json(await readFixture());
    const reordered = parseArchitectureDocumentV3({
      ...document,
      nodes: [...document.nodes].reverse(),
      edges: [...document.edges].reverse(),
      variables: [...document.variables].reverse(),
      workloadBehavior: {
        ...document.workloadBehavior,
        workloads: [...document.workloadBehavior.workloads]
          .reverse()
          .map((workload) => ({
            ...workload,
            operations: [...workload.operations].reverse(),
            triggers: [...workload.triggers].reverse(),
            downstreamActions: [...workload.downstreamActions].reverse(),
            environment: [...workload.environment].reverse(),
            unresolvedRequirementIds: [
              ...workload.unresolvedRequirementIds,
            ].reverse(),
          })),
      },
    });
    const expected = await readRepositoryFile(
      "packages/test-fixtures/fixtures/document-versioning/snapshots/architecture-document-v3.canonical.json",
    );
    const before = JSON.stringify(reordered);

    expect(normalizeArchitectureDocumentV3(reordered)).toEqual(
      normalizeArchitectureDocumentV3(document),
    );
    expect(serializeArchitectureDocumentV3(reordered)).toBe(expected);
    expect(
      new Set(
        Array.from({ length: 8 }, () =>
          serializeArchitectureDocumentV3(reordered),
        ),
      ),
    ).toEqual(new Set([expected]));
    expect(JSON.stringify(reordered)).toBe(before);
  });

  it("binds embedded contracts to the architecture revision and rejects future versions", async () => {
    const document = parseArchitectureDocumentV3Json(await readFixture());

    expect(() =>
      parseArchitectureDocumentV3({
        ...document,
        applicationContracts: {
          ...document.applicationContracts,
          revision: {
            ...document.applicationContracts.revision,
            revisionId: "revision_other",
          },
        },
      }),
    ).toThrow(ArchitectureDocumentSchemaError);
    expect(() =>
      parseArchitectureDocumentV3({ ...document, schemaVersion: 4 }),
    ).toThrow(ArchitectureDocumentSchemaError);
  });

  it("rejects the legacy product document kind without an alias", async () => {
    const document = JSON.parse(await readFixture()) as Record<string, unknown>;

    expect(() =>
      parseArchitectureDocumentV3({
        ...document,
        kind: "cloudcanvas.architecture-document",
      }),
    ).toThrow(ArchitectureDocumentSchemaError);
  });
});
