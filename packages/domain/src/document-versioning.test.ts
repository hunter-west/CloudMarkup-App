import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  ARCHITECTURE_DOCUMENT_SCHEMA_TYPE,
  DocumentMigrationRegistry,
  INTENT_DOCUMENT_SCHEMA_TYPE,
  documentMigrationRegistry,
  formatDocumentMigrationDiagnostics,
  migrateCloudMarkupDocument,
} from "./index.js";

async function readFixture(path: string): Promise<unknown> {
  return JSON.parse(
    await readFile(
      new URL(`../../test-fixtures/fixtures/${path}`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}

describe("document migration registry", () => {
  it("registers reviewed Architecture v1-to-v2-to-v3 migrations and current baselines", () => {
    expect(documentMigrationRegistry.listEntries()).toEqual([
      {
        schemaType: ARCHITECTURE_DOCUMENT_SCHEMA_TYPE,
        sourceVersion: 1,
        targetVersion: 2,
      },
      {
        schemaType: ARCHITECTURE_DOCUMENT_SCHEMA_TYPE,
        sourceVersion: 2,
        targetVersion: 3,
      },
      {
        schemaType: ARCHITECTURE_DOCUMENT_SCHEMA_TYPE,
        sourceVersion: 3,
        targetVersion: 3,
      },
      {
        schemaType: INTENT_DOCUMENT_SCHEMA_TYPE,
        sourceVersion: 1,
        targetVersion: 1,
      },
    ]);
  });

  it.each([
    [
      ARCHITECTURE_DOCUMENT_SCHEMA_TYPE,
      "architecture-document/v3/valid/representative.json",
      3,
    ],
    [
      INTENT_DOCUMENT_SCHEMA_TYPE,
      "intent-document/v1/valid/representative.json",
      1,
    ],
  ] as const)(
    "validates and clones the current %s document through its baseline",
    async (schemaType, fixturePath, currentVersion) => {
      const source = await readFixture(fixturePath);
      const before = JSON.stringify(source);
      const result = migrateCloudMarkupDocument(source);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("Expected current version migration to succeed.");
      }

      expect(result).toEqual(
        expect.objectContaining({
          classification: "current",
          migrated: false,
          schemaType,
          sourceVersion: currentVersion,
          targetVersion: currentVersion,
        }),
      );
      expect(result.document).not.toBe(source);
      expect(result.canonicalSerialization.endsWith("\n")).toBe(true);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: "current_version_validated",
          path: "$.schemaVersion",
          severity: "info",
        }),
      ]);
      expect(JSON.stringify(source)).toBe(before);
    },
  );

  it("migrates Architecture Document v1 through v2 to v3 additively without inference", async () => {
    const source = (await readFixture(
      "architecture-document/v1/valid/representative.json",
    )) as Readonly<Record<string, unknown>>;
    const before = JSON.stringify(source);
    const first = migrateCloudMarkupDocument(source);
    const second = migrateCloudMarkupDocument(source);

    expect(first).toEqual(second);
    expect(first).toEqual(
      expect.objectContaining({
        ok: true,
        classification: "older",
        migrated: true,
        sourceVersion: 1,
        targetVersion: 3,
        diagnostics: [
          expect.objectContaining({
            code: "older_version_migrated",
            path: "$.schemaVersion",
          }),
        ],
      }),
    );
    if (
      !first.ok ||
      first.document.kind !== ARCHITECTURE_DOCUMENT_SCHEMA_TYPE
    ) {
      throw new Error("Expected Architecture Document migration to succeed.");
    }

    const {
      applicationContracts,
      externalResources,
      schemaVersion: migratedSchemaVersion,
      workloadBehavior,
      ...migratedFields
    } = first.document;
    const { schemaVersion: sourceSchemaVersion, ...sourceFields } = source;
    expect(sourceSchemaVersion).toBe(1);
    expect(migratedSchemaVersion).toBe(3);
    expect(workloadBehavior).toEqual({
      contractVersion: 2,
      workloads: [],
    });
    expect(applicationContracts).toEqual(
      expect.objectContaining({
        contractSetId: source["architectureId"],
        contracts: [],
        documentId: source["documentId"],
      }),
    );
    expect(externalResources).toEqual(
      expect.objectContaining({
        architectureId: source["architectureId"],
        documentId: source["documentId"],
        resources: [],
      }),
    );
    expect(migratedFields).toEqual(sourceFields);
    expect(first.canonicalSerialization).not.toContain("runtimeFamily");
    expect(first.canonicalSerialization).not.toContain("handler");
    expect(JSON.stringify(source)).toBe(before);
  });

  it("reports older versions without inventing a migration path", async () => {
    const source = await readFixture(
      "architecture-document/v1/valid/representative.json",
    );
    const result = migrateCloudMarkupDocument({
      ...(source as Readonly<Record<string, unknown>>),
      schemaVersion: 0,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        classification: "older",
        sourceVersion: 0,
        targetVersion: 3,
        diagnostics: [
          expect.objectContaining({
            code: "older_version_without_migration",
          }),
        ],
      }),
    );
  });

  it("reports unsupported future versions without treating them as malformed", async () => {
    const source = await readFixture(
      "intent-document/v1/valid/representative.json",
    );
    const result = migrateCloudMarkupDocument({
      ...(source as Readonly<Record<string, unknown>>),
      schemaVersion: 2,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        classification: "unsupported-future",
        sourceVersion: 2,
        targetVersion: 1,
        diagnostics: [
          expect.objectContaining({
            code: "unsupported_future_version",
            path: "$.schemaVersion",
          }),
        ],
      }),
    );
  });

  it("reports Architecture Document v4 as an unsupported future version", async () => {
    const source = (await readFixture(
      "architecture-document/v3/valid/representative.json",
    )) as Readonly<Record<string, unknown>>;
    const result = migrateCloudMarkupDocument({
      ...source,
      schemaVersion: 4,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        classification: "unsupported-future",
        sourceVersion: 4,
        targetVersion: 3,
        diagnostics: [
          expect.objectContaining({
            code: "unsupported_future_version",
            path: "$.schemaVersion",
          }),
        ],
      }),
    );
  });

  it("separates malformed envelopes from unknown document types", () => {
    expect(migrateCloudMarkupDocument(null)).toEqual(
      expect.objectContaining({
        ok: false,
        classification: "malformed",
      }),
    );
    expect(
      migrateCloudMarkupDocument({
        kind: ARCHITECTURE_DOCUMENT_SCHEMA_TYPE,
        schemaVersion: "1",
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        classification: "malformed",
        diagnostics: [
          expect.objectContaining({ code: "malformed_schema_version" }),
        ],
      }),
    );
    expect(
      migrateCloudMarkupDocument({
        kind: "cloudmarkup.unknown-document",
        schemaVersion: 1,
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        classification: "unknown-document-type",
        diagnostics: [
          expect.objectContaining({ code: "unknown_document_type" }),
        ],
      }),
    );
  });

  it("formats migration diagnostics without echoing document values", () => {
    expect(
      formatDocumentMigrationDiagnostics([
        {
          code: "unsupported_future_version",
          message: "Schema version 2 is newer than supported version 1.",
          path: "$.schemaVersion",
          severity: "error",
        },
      ]),
    ).toBe(
      "$.schemaVersion: Schema version 2 is newer than supported version 1. [unsupported_future_version]",
    );
  });

  it("reports a registry gap as an unknown version", async () => {
    const source = await readFixture(
      "architecture-document/v3/valid/representative.json",
    );
    const registryWithGap = new DocumentMigrationRegistry({
      currentVersions: {
        [ARCHITECTURE_DOCUMENT_SCHEMA_TYPE]: 3,
        [INTENT_DOCUMENT_SCHEMA_TYPE]: 1,
      },
      entries: [],
    });

    expect(registryWithGap.migrate(source)).toEqual(
      expect.objectContaining({
        ok: false,
        classification: "unknown-version",
        diagnostics: [
          expect.objectContaining({ code: "unknown_schema_version" }),
        ],
      }),
    );
  });

  it("rejects malformed current documents with path-based validation diagnostics", async () => {
    const source = await readFixture(
      "architecture-document/v3/valid/representative.json",
    );
    const result = migrateCloudMarkupDocument({
      ...(source as Readonly<Record<string, unknown>>),
      nodes: [],
      unreviewedExtension: {
        secretLikeValue: "must-not-be-retained",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.classification).toBe("malformed");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "schema_unrecognized_keys",
          path: "$",
          severity: "error",
        }),
      ]),
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain(
      "must-not-be-retained",
    );
  });

  it("returns pinned architecture compatibility and explicit intent non-applicability", async () => {
    const architectureResult = migrateCloudMarkupDocument(
      await readFixture("architecture-document/v1/valid/representative.json"),
    );
    const intentResult = migrateCloudMarkupDocument(
      await readFixture("intent-document/v1/valid/representative.json"),
    );

    if (!architectureResult.ok || !intentResult.ok) {
      throw new Error("Expected both representative documents to migrate.");
    }

    const architectureCompatibility = architectureResult.compatibility;
    const intentCompatibility = intentResult.compatibility;
    if (
      architectureCompatibility.schemaType !==
        ARCHITECTURE_DOCUMENT_SCHEMA_TYPE ||
      intentCompatibility.schemaType !== INTENT_DOCUMENT_SCHEMA_TYPE
    ) {
      throw new Error("Expected compatibility metadata to match each fixture.");
    }

    expect(architectureCompatibility.catalog.kind).toBe("pinned");
    expect(architectureCompatibility.schemaVersion).toBe(3);
    expect(architectureCompatibility.catalog.digest).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(architectureCompatibility.compiler.kind).toBe("bounded");
    expect(architectureCompatibility.compiler.inputContractVersion).toBe(1);
    expect(intentCompatibility.catalog).toEqual({
      kind: "not-applicable",
      reason: "provider-neutral-intent",
    });
    expect(intentCompatibility.compiler).toEqual({
      kind: "not-applicable",
      reason: "intent-is-not-compiler-input",
    });
  });
});
