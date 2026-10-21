import {
  ArchitectureDocumentSchemaError,
  IntentDocumentSchemaError,
  serializeArchitectureDocumentV3,
  serializeIntentDocumentV1,
  type ArchitectureDocumentV3,
} from "@cloudmarkup/schemas";

import {
  migrateArchitectureDocumentV1ToV2,
  migrateArchitectureDocumentV2ToV3,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "./architecture-document.js";
import {
  ArchitectureDocumentSemanticError,
  type ArchitectureDocumentSemanticIssue,
} from "./semantic-validation.js";
import { parseIntentDocument, type IntentDocument } from "./intent-document.js";
import {
  IntentDocumentSemanticError,
  type IntentDocumentSemanticIssue,
} from "./intent-semantic-validation.js";

export const ARCHITECTURE_DOCUMENT_SCHEMA_TYPE =
  "cloudmarkup.architecture-document";
export const INTENT_DOCUMENT_SCHEMA_TYPE = "cloudmarkup.intent-document";

export type DocumentSchemaType =
  typeof ARCHITECTURE_DOCUMENT_SCHEMA_TYPE | typeof INTENT_DOCUMENT_SCHEMA_TYPE;

export type VersionedCloudMarkupDocument =
  ArchitectureDocument | IntentDocument;

export type DocumentVersionClassification =
  | "current"
  | "older"
  | "unsupported-future"
  | "malformed"
  | "unknown-document-type"
  | "unknown-version";

export type DocumentMigrationDiagnosticCode =
  | "current_version_validated"
  | "malformed_document"
  | "malformed_schema_type"
  | "malformed_schema_version"
  | "migration_failed"
  | "older_version_migrated"
  | "older_version_without_migration"
  | "unknown_document_type"
  | "unknown_schema_version"
  | "unsupported_future_version"
  | `schema_${string}`
  | `semantic_${string}`;

export interface DocumentMigrationDiagnostic {
  readonly code: DocumentMigrationDiagnosticCode;
  readonly message: string;
  readonly path: string;
  readonly severity: "error" | "info";
}

export interface ArchitectureDocumentCompatibilityMetadata {
  readonly schemaType: typeof ARCHITECTURE_DOCUMENT_SCHEMA_TYPE;
  readonly schemaVersion: 3;
  readonly catalog: {
    readonly kind: "pinned";
    readonly id: ArchitectureDocumentV3["catalog"]["id"];
    readonly version: ArchitectureDocumentV3["catalog"]["version"];
    readonly digest: ArchitectureDocumentV3["catalog"]["digest"];
  };
  readonly compiler: {
    readonly kind: "bounded";
    readonly inputContractVersion: 1;
    readonly minimumVersion: ArchitectureDocumentV3["compilerCompatibility"]["minimumCompilerVersion"];
    readonly maximumVersionExclusive?: ArchitectureDocumentV3["compilerCompatibility"]["maximumCompilerVersionExclusive"];
  };
}

export interface IntentDocumentCompatibilityMetadata {
  readonly schemaType: typeof INTENT_DOCUMENT_SCHEMA_TYPE;
  readonly schemaVersion: 1;
  readonly catalog: {
    readonly kind: "not-applicable";
    readonly reason: "provider-neutral-intent";
  };
  readonly compiler: {
    readonly kind: "not-applicable";
    readonly reason: "intent-is-not-compiler-input";
  };
}

export type DocumentCompatibilityMetadata =
  | ArchitectureDocumentCompatibilityMetadata
  | IntentDocumentCompatibilityMetadata;

export interface DocumentMigrationSuccess {
  readonly ok: true;
  readonly classification: "current" | "older";
  readonly schemaType: DocumentSchemaType;
  readonly sourceVersion: number;
  readonly targetVersion: number;
  readonly migrated: boolean;
  readonly document: VersionedCloudMarkupDocument;
  readonly canonicalSerialization: string;
  readonly compatibility: DocumentCompatibilityMetadata;
  readonly diagnostics: readonly DocumentMigrationDiagnostic[];
}

export interface DocumentMigrationFailure {
  readonly ok: false;
  readonly classification: Exclude<DocumentVersionClassification, "current">;
  readonly schemaType?: DocumentSchemaType;
  readonly sourceVersion?: number;
  readonly targetVersion?: number;
  readonly diagnostics: readonly DocumentMigrationDiagnostic[];
}

export type DocumentMigrationResult =
  DocumentMigrationFailure | DocumentMigrationSuccess;

export interface DocumentMigrationRegistryEntry {
  readonly schemaType: DocumentSchemaType;
  readonly sourceVersion: number;
  readonly targetVersion: number;
  readonly migrate: (source: unknown) => unknown;
}

export interface DocumentMigrationRegistryOptions {
  readonly currentVersions: Readonly<Record<DocumentSchemaType, number>>;
  readonly entries: readonly DocumentMigrationRegistryEntry[];
}

function migrationKey(schemaType: DocumentSchemaType, version: number): string {
  return `${schemaType}@${String(version)}`;
}

function compareUtf16(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorDiagnostic(
  code: DocumentMigrationDiagnosticCode,
  message: string,
  path: string,
): DocumentMigrationDiagnostic {
  return {
    code,
    message,
    path,
    severity: "error",
  };
}

function infoDiagnostic(
  code: DocumentMigrationDiagnosticCode,
  message: string,
  path: string,
): DocumentMigrationDiagnostic {
  return {
    code,
    message,
    path,
    severity: "info",
  };
}

function validationDiagnostics(
  error: unknown,
): readonly DocumentMigrationDiagnostic[] {
  if (
    error instanceof ArchitectureDocumentSchemaError ||
    error instanceof IntentDocumentSchemaError
  ) {
    return error.issues.map((issue) =>
      errorDiagnostic(`schema_${issue.code}`, issue.message, issue.path),
    );
  }

  if (error instanceof ArchitectureDocumentSemanticError) {
    return error.issues.map((issue: ArchitectureDocumentSemanticIssue) =>
      errorDiagnostic(`semantic_${issue.code}`, issue.message, issue.path),
    );
  }

  if (error instanceof IntentDocumentSemanticError) {
    return error.issues.map((issue: IntentDocumentSemanticIssue) =>
      errorDiagnostic(`semantic_${issue.code}`, issue.message, issue.path),
    );
  }

  return [
    errorDiagnostic(
      "migration_failed",
      "Document migration failed without exposing source content.",
      "$",
    ),
  ];
}

function parseCurrentDocument(
  schemaType: DocumentSchemaType,
  input: unknown,
): VersionedCloudMarkupDocument {
  return schemaType === ARCHITECTURE_DOCUMENT_SCHEMA_TYPE
    ? parseArchitectureDocument(input)
    : parseIntentDocument(input);
}

function serializeDocument(document: VersionedCloudMarkupDocument): string {
  return document.kind === ARCHITECTURE_DOCUMENT_SCHEMA_TYPE
    ? serializeArchitectureDocumentV3(document)
    : serializeIntentDocumentV1(document);
}

export function getDocumentCompatibilityMetadata(
  document: VersionedCloudMarkupDocument,
): DocumentCompatibilityMetadata {
  if (document.kind === ARCHITECTURE_DOCUMENT_SCHEMA_TYPE) {
    return {
      schemaType: ARCHITECTURE_DOCUMENT_SCHEMA_TYPE,
      schemaVersion: document.schemaVersion,
      catalog: {
        kind: "pinned",
        id: document.catalog.id,
        version: document.catalog.version,
        digest: document.catalog.digest,
      },
      compiler: {
        kind: "bounded",
        inputContractVersion:
          document.compilerCompatibility.inputContractVersion,
        minimumVersion: document.compilerCompatibility.minimumCompilerVersion,
        ...(document.compilerCompatibility.maximumCompilerVersionExclusive ===
        undefined
          ? {}
          : {
              maximumVersionExclusive:
                document.compilerCompatibility.maximumCompilerVersionExclusive,
            }),
      },
    };
  }

  return {
    schemaType: INTENT_DOCUMENT_SCHEMA_TYPE,
    schemaVersion: document.schemaVersion,
    catalog: {
      kind: "not-applicable",
      reason: "provider-neutral-intent",
    },
    compiler: {
      kind: "not-applicable",
      reason: "intent-is-not-compiler-input",
    },
  };
}

export function formatDocumentMigrationDiagnostics(
  diagnostics: readonly DocumentMigrationDiagnostic[],
): string {
  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.path}: ${diagnostic.message} [${diagnostic.code}]`,
    )
    .join("\n");
}

function cloneMigrationInput(input: unknown): unknown {
  return JSON.parse(JSON.stringify(input)) as unknown;
}

export class DocumentMigrationRegistry {
  readonly #currentVersions: Readonly<Record<DocumentSchemaType, number>>;
  readonly #entries: ReadonlyMap<string, DocumentMigrationRegistryEntry>;

  public constructor(options: DocumentMigrationRegistryOptions) {
    this.#currentVersions = Object.freeze({ ...options.currentVersions });
    const entries = new Map<string, DocumentMigrationRegistryEntry>();

    options.entries.forEach((entry) => {
      if (
        !Number.isSafeInteger(entry.sourceVersion) ||
        !Number.isSafeInteger(entry.targetVersion) ||
        entry.sourceVersion < 1 ||
        entry.targetVersion < entry.sourceVersion ||
        entry.targetVersion > this.#currentVersions[entry.schemaType]
      ) {
        throw new TypeError("Migration registry entry has invalid versions.");
      }

      if (
        entry.sourceVersion === entry.targetVersion &&
        entry.sourceVersion !== this.#currentVersions[entry.schemaType]
      ) {
        throw new TypeError(
          "Only the current-version baseline may be a no-op migration.",
        );
      }

      const key = migrationKey(entry.schemaType, entry.sourceVersion);
      if (entries.has(key)) {
        throw new TypeError("Migration registry entries must be unique.");
      }

      entries.set(key, Object.freeze({ ...entry }));
    });

    this.#entries = entries;
  }

  public listEntries(): readonly Readonly<
    Omit<DocumentMigrationRegistryEntry, "migrate">
  >[] {
    return [...this.#entries.values()]
      .map(({ schemaType, sourceVersion, targetVersion }) => ({
        schemaType,
        sourceVersion,
        targetVersion,
      }))
      .sort(
        (left, right) =>
          compareUtf16(left.schemaType, right.schemaType) ||
          left.sourceVersion - right.sourceVersion ||
          left.targetVersion - right.targetVersion,
      );
  }

  public migrate(input: unknown): DocumentMigrationResult {
    if (!isRecord(input)) {
      return {
        ok: false,
        classification: "malformed",
        diagnostics: [
          errorDiagnostic(
            "malformed_document",
            "Document must be a JSON object.",
            "$",
          ),
        ],
      };
    }

    const rawSchemaType = input["kind"];
    if (typeof rawSchemaType !== "string") {
      return {
        ok: false,
        classification: "malformed",
        diagnostics: [
          errorDiagnostic(
            "malformed_schema_type",
            "Document kind must be a string.",
            "$.kind",
          ),
        ],
      };
    }

    if (
      rawSchemaType !== ARCHITECTURE_DOCUMENT_SCHEMA_TYPE &&
      rawSchemaType !== INTENT_DOCUMENT_SCHEMA_TYPE
    ) {
      return {
        ok: false,
        classification: "unknown-document-type",
        diagnostics: [
          errorDiagnostic(
            "unknown_document_type",
            "Document kind is not registered.",
            "$.kind",
          ),
        ],
      };
    }

    const schemaType = rawSchemaType;
    const rawVersion = input["schemaVersion"];
    if (!Number.isSafeInteger(rawVersion)) {
      return {
        ok: false,
        classification: "malformed",
        schemaType,
        targetVersion: this.#currentVersions[schemaType],
        diagnostics: [
          errorDiagnostic(
            "malformed_schema_version",
            "Schema version must be a safe integer.",
            "$.schemaVersion",
          ),
        ],
      };
    }

    const sourceVersion = rawVersion as number;
    const targetVersion = this.#currentVersions[schemaType];

    if (sourceVersion > targetVersion) {
      return {
        ok: false,
        classification: "unsupported-future",
        schemaType,
        sourceVersion,
        targetVersion,
        diagnostics: [
          errorDiagnostic(
            "unsupported_future_version",
            `Schema version ${String(sourceVersion)} is newer than supported version ${String(targetVersion)}.`,
            "$.schemaVersion",
          ),
        ],
      };
    }

    let working: unknown;
    try {
      working = cloneMigrationInput(input);
    } catch {
      return {
        ok: false,
        classification: "malformed",
        schemaType,
        sourceVersion,
        targetVersion,
        diagnostics: [
          errorDiagnostic(
            "malformed_document",
            "Document must contain cloneable JSON data.",
            "$",
          ),
        ],
      };
    }

    let workingVersion = sourceVersion;
    const diagnostics: DocumentMigrationDiagnostic[] = [];

    while (workingVersion <= targetVersion) {
      const entry = this.#entries.get(migrationKey(schemaType, workingVersion));
      if (entry === undefined) {
        return {
          ok: false,
          classification:
            sourceVersion < targetVersion ? "older" : "unknown-version",
          schemaType,
          sourceVersion,
          targetVersion,
          diagnostics: [
            errorDiagnostic(
              sourceVersion < targetVersion
                ? "older_version_without_migration"
                : "unknown_schema_version",
              sourceVersion < targetVersion
                ? `Older schema version ${String(sourceVersion)} has no reviewed migration path to version ${String(targetVersion)}.`
                : `Schema version ${String(sourceVersion)} has no registered baseline migration.`,
              "$.schemaVersion",
            ),
          ],
        };
      }

      try {
        working = entry.migrate(working);
      } catch (error) {
        return {
          ok: false,
          classification: "malformed",
          schemaType,
          sourceVersion,
          targetVersion,
          diagnostics: validationDiagnostics(error),
        };
      }

      if (entry.targetVersion === targetVersion) {
        break;
      }

      workingVersion = entry.targetVersion;
    }

    let document: VersionedCloudMarkupDocument;
    try {
      document = parseCurrentDocument(schemaType, working);
    } catch (error) {
      return {
        ok: false,
        classification: "malformed",
        schemaType,
        sourceVersion,
        targetVersion,
        diagnostics: validationDiagnostics(error),
      };
    }

    diagnostics.push(
      sourceVersion === targetVersion
        ? infoDiagnostic(
            "current_version_validated",
            `Schema version ${String(sourceVersion)} is current and passed its no-op baseline migration.`,
            "$.schemaVersion",
          )
        : infoDiagnostic(
            "older_version_migrated",
            `Schema version ${String(sourceVersion)} migrated to version ${String(targetVersion)}.`,
            "$.schemaVersion",
          ),
    );

    return {
      ok: true,
      classification: sourceVersion === targetVersion ? "current" : "older",
      schemaType,
      sourceVersion,
      targetVersion,
      migrated: sourceVersion !== targetVersion,
      document,
      canonicalSerialization: serializeDocument(document),
      compatibility: getDocumentCompatibilityMetadata(document),
      diagnostics,
    };
  }
}

const currentVersions = Object.freeze({
  [ARCHITECTURE_DOCUMENT_SCHEMA_TYPE]: 3,
  [INTENT_DOCUMENT_SCHEMA_TYPE]: 1,
} as const);

const noOpMigration = (source: unknown): unknown => source;

export const documentMigrationRegistry = new DocumentMigrationRegistry({
  currentVersions,
  entries: [
    {
      schemaType: ARCHITECTURE_DOCUMENT_SCHEMA_TYPE,
      sourceVersion: 1,
      targetVersion: 2,
      migrate: migrateArchitectureDocumentV1ToV2,
    },
    {
      schemaType: ARCHITECTURE_DOCUMENT_SCHEMA_TYPE,
      sourceVersion: 2,
      targetVersion: 3,
      migrate: migrateArchitectureDocumentV2ToV3,
    },
    {
      schemaType: ARCHITECTURE_DOCUMENT_SCHEMA_TYPE,
      sourceVersion: 3,
      targetVersion: 3,
      migrate: noOpMigration,
    },
    {
      schemaType: INTENT_DOCUMENT_SCHEMA_TYPE,
      sourceVersion: 1,
      targetVersion: 1,
      migrate: noOpMigration,
    },
  ],
});

export function migrateCloudMarkupDocument(
  input: unknown,
): DocumentMigrationResult {
  return documentMigrationRegistry.migrate(input);
}
