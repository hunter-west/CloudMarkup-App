import {
  getArchitectureDocumentHashes,
  hashCanonicalValue,
  migrateCloudMarkupDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  parseArchitectureDocumentV1,
  parseArchitectureDocumentV2,
  serializeArchitectureDocumentV1,
  serializeArchitectureDocumentV2,
  serializeArchitectureDocumentV3,
  type ArchitectureDocumentV1,
  type ArchitectureDocumentV2,
  serializeCanonicalJson,
  type ConfigurationValue,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import { isCredentialLiteralProperty } from "../model/configuration-command.js";
import type {
  EditorRecoveryBindingV1,
  EditorRecoveryDiagnosticClassification,
  EditorRecoveryDiagnosticEntry,
  EditorRecoveryDiagnosticV1,
  EditorRecoveryEnvelopeV1,
  EditorRecoveryReady,
} from "./editor-recovery-store.js";

export const EDITOR_RECOVERY_ENVELOPE_KIND =
  "cloudmarkup.editor-recovery" as const;
export const EDITOR_RECOVERY_ENVELOPE_SCHEMA_VERSION = 1 as const;
export const EDITOR_RECOVERY_MAX_CANONICAL_BYTES = 2 * 1024 * 1024;
export const EDITOR_RECOVERY_MAX_DIAGNOSTIC_BYTES = 64 * 1024;

const MAX_DIAGNOSTIC_ENTRIES = 32;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-(0[1-9]|1[0-2])-(3[01]|[12]\d|0[1-9])T(2[0-3]|[01]\d):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/;

export interface CreateEditorRecoveryBindingInput {
  readonly scopeKey: string;
  readonly seedDocument: ArchitectureDocument;
}

export interface PreparedEditorRecoverySnapshotV1 {
  readonly binding: EditorRecoveryBindingV1;
  readonly canonicalDocument: string;
  readonly document: ArchitectureDocument;
  readonly integrity: Omit<
    EditorRecoveryEnvelopeV1["integrity"],
    "snapshotDigest"
  > & {
    readonly snapshotDigest: Sha256Digest;
  };
}

export type EditorRecoverySnapshotPreparation =
  | {
      readonly ok: true;
      readonly snapshot: PreparedEditorRecoverySnapshotV1;
    }
  | {
      readonly diagnostic: EditorRecoveryDiagnosticV1;
      readonly ok: false;
    };

export interface CreateEditorRecoveryEnvelopeMetadata {
  readonly generation: number;
  readonly savedAt: string;
  readonly writerId: string;
}

type LegacyEditorRecoveryBindingV1 = Omit<
  EditorRecoveryBindingV1,
  "documentSchemaVersion"
> & {
  readonly documentSchemaVersion: 1 | 2;
};

type LegacyEditorRecoveryEnvelopeV1 = Omit<
  EditorRecoveryEnvelopeV1,
  "binding"
> & {
  readonly binding: LegacyEditorRecoveryBindingV1;
};

export type EditorRecoveryEnvelopeInspection =
  | EditorRecoveryReady
  | {
      readonly classification: EditorRecoveryDiagnosticClassification;
      readonly diagnostic: EditorRecoveryDiagnosticV1;
      readonly status: "rejected";
    };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const permitted = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => permitted.has(key))
  );
}

function isSha256Digest(value: unknown): value is Sha256Digest {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID_PATTERN.test(value);
}

function isUtcTimestamp(value: unknown): value is string {
  return typeof value === "string" && UTC_TIMESTAMP_PATTERN.test(value);
}

function canonicalBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hashCanonicalDocument(canonicalDocument: string): Sha256Digest {
  return hashCanonicalValue(JSON.parse(canonicalDocument) as unknown);
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function boundedEntry(
  code: string,
  message: string,
  path: string,
): EditorRecoveryDiagnosticEntry {
  return {
    code: code.replaceAll(/[^a-z0-9_-]/g, "_").slice(0, 96) || "rejected",
    message: message.slice(0, 512),
    path: path.slice(0, 160),
  };
}

function createDiagnostic(
  classification: EditorRecoveryDiagnosticClassification,
  code: string,
  message: string,
  path: string,
  metadata: Readonly<
    Pick<
      EditorRecoveryDiagnosticV1,
      | "canonicalBytes"
      | "documentSchemaVersion"
      | "envelopeSchemaVersion"
      | "generation"
      | "savedAt"
      | "scopeFingerprint"
    >
  > = {},
  additionalEntries: readonly EditorRecoveryDiagnosticEntry[] = [],
): EditorRecoveryDiagnosticV1 {
  return {
    kind: "cloudmarkup.editor-recovery-diagnostic",
    schemaVersion: 1,
    classification,
    diagnostics: [
      boundedEntry(code, message, path),
      ...additionalEntries
        .slice(0, MAX_DIAGNOSTIC_ENTRIES - 1)
        .map((entry) => boundedEntry(entry.code, entry.message, entry.path)),
    ],
    ...metadata,
  };
}

function reject(
  classification: EditorRecoveryDiagnosticClassification,
  code: string,
  message: string,
  path: string,
  metadata: Readonly<
    Pick<
      EditorRecoveryDiagnosticV1,
      | "canonicalBytes"
      | "documentSchemaVersion"
      | "envelopeSchemaVersion"
      | "generation"
      | "savedAt"
      | "scopeFingerprint"
    >
  > = {},
  additionalEntries: readonly EditorRecoveryDiagnosticEntry[] = [],
): Exclude<EditorRecoveryEnvelopeInspection, EditorRecoveryReady> {
  return {
    classification,
    diagnostic: createDiagnostic(
      classification,
      code,
      message,
      path,
      metadata,
      additionalEntries,
    ),
    status: "rejected",
  };
}

function bindingMatchesDocument(
  binding: EditorRecoveryBindingV1,
  document: ArchitectureDocument,
): boolean {
  return (
    binding.architectureId === document.architectureId &&
    binding.documentId === document.documentId &&
    binding.revisionId === document.revision.revisionId &&
    binding.sourceDraftId === document.revision.sourceDraftId &&
    binding.provider.id === document.provider.id &&
    binding.provider.region === document.provider.region &&
    binding.catalog.id === document.catalog.id &&
    binding.catalog.version === document.catalog.version &&
    binding.catalog.digest === document.catalog.digest
  );
}

function bindingsEqual(
  left: EditorRecoveryBindingV1,
  right: EditorRecoveryBindingV1,
): boolean {
  return serializeCanonicalJson(left) === serializeCanonicalJson(right);
}

function findCredentialLiteral(
  document: ArchitectureDocument,
): string | undefined {
  const hasCredentialLiteral = (
    values: Readonly<Record<string, Readonly<ConfigurationValue>>>,
  ): boolean =>
    Object.entries(values).some(([property, value]) =>
      isCredentialLiteralProperty(property, value),
    );

  const nodeIndex = document.nodes.findIndex((node) =>
    hasCredentialLiteral(node.semantic.configuration.values),
  );
  if (nodeIndex >= 0) {
    return `$.nodes[${String(nodeIndex)}].semantic.configuration.values`;
  }

  const edgeIndex = document.edges.findIndex((edge) =>
    hasCredentialLiteral(edge.semantic.configuration.values),
  );
  if (edgeIndex >= 0) {
    return `$.edges[${String(edgeIndex)}].semantic.configuration.values`;
  }

  const variableIndex = document.variables.findIndex(
    (variable) =>
      variable.defaultValue !== undefined &&
      isCredentialLiteralProperty(variable.key, variable.defaultValue),
  );
  return variableIndex < 0
    ? undefined
    : `$.variables[${String(variableIndex)}].defaultValue`;
}

function migrationEntries(
  diagnostics: readonly {
    readonly code: string;
    readonly path: string;
  }[],
): readonly EditorRecoveryDiagnosticEntry[] {
  return diagnostics
    .slice(0, MAX_DIAGNOSTIC_ENTRIES - 1)
    .map((diagnostic) =>
      boundedEntry(
        diagnostic.code,
        "The saved document did not pass the registered document migration and validation path.",
        diagnostic.path === "$.kind" || diagnostic.path === "$.schemaVersion"
          ? diagnostic.path
          : "$.document",
      ),
    );
}

function readSchemaVersion(value: unknown): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const schemaVersion = value["schemaVersion"];
  return Number.isSafeInteger(schemaVersion)
    ? (schemaVersion as number)
    : undefined;
}

function validateBindingForDocumentVersion(
  value: unknown,
  documentSchemaVersion: 1 | 2 | 3,
): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      [
        "architectureId",
        "catalog",
        "documentId",
        "documentKind",
        "documentSchemaVersion",
        "provider",
        "revisionId",
        "scopeFingerprint",
        "seedSnapshotDigest",
      ],
      ["sourceDraftId"],
    )
  ) {
    return false;
  }

  const catalog = value["catalog"];
  const provider = value["provider"];
  return (
    isOpaqueId(value["architectureId"]) &&
    isRecord(catalog) &&
    hasExactKeys(catalog, ["digest", "id", "version"]) &&
    typeof catalog["id"] === "string" &&
    typeof catalog["version"] === "string" &&
    isSha256Digest(catalog["digest"]) &&
    isOpaqueId(value["documentId"]) &&
    value["documentKind"] === "cloudmarkup.architecture-document" &&
    value["documentSchemaVersion"] === documentSchemaVersion &&
    isRecord(provider) &&
    hasExactKeys(provider, ["id", "region"]) &&
    typeof provider["id"] === "string" &&
    typeof provider["region"] === "string" &&
    isOpaqueId(value["revisionId"]) &&
    isSha256Digest(value["scopeFingerprint"]) &&
    isSha256Digest(value["seedSnapshotDigest"]) &&
    (value["sourceDraftId"] === undefined || isOpaqueId(value["sourceDraftId"]))
  );
}

function validateBinding(value: unknown): value is EditorRecoveryBindingV1 {
  return validateBindingForDocumentVersion(value, 3);
}

function validateLegacyBinding(
  value: unknown,
): value is LegacyEditorRecoveryBindingV1 {
  return (
    validateBindingForDocumentVersion(value, 1) ||
    validateBindingForDocumentVersion(value, 2)
  );
}

function validateEnvelopeStructure(
  value: unknown,
  bindingIsValid: (binding: unknown) => boolean,
): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "binding",
      "canonicalDocument",
      "checkpoint",
      "integrity",
      "kind",
      "schemaVersion",
    ]) ||
    value["kind"] !== EDITOR_RECOVERY_ENVELOPE_KIND ||
    value["schemaVersion"] !== EDITOR_RECOVERY_ENVELOPE_SCHEMA_VERSION ||
    typeof value["canonicalDocument"] !== "string" ||
    !bindingIsValid(value["binding"])
  ) {
    return false;
  }

  const checkpoint = value["checkpoint"];
  const integrity = value["integrity"];
  return (
    isRecord(checkpoint) &&
    hasExactKeys(checkpoint, [
      "generation",
      "savedAt",
      "snapshotDigest",
      "writerId",
    ]) &&
    safeInteger(checkpoint["generation"]) &&
    isUtcTimestamp(checkpoint["savedAt"]) &&
    isSha256Digest(checkpoint["snapshotDigest"]) &&
    isOpaqueId(checkpoint["writerId"]) &&
    isRecord(integrity) &&
    hasExactKeys(integrity, [
      "canonicalBytes",
      "contentHash",
      "snapshotDigest",
      "visualHash",
    ]) &&
    Number.isSafeInteger(integrity["canonicalBytes"]) &&
    (integrity["canonicalBytes"] as number) >= 0 &&
    isSha256Digest(integrity["contentHash"]) &&
    isSha256Digest(integrity["snapshotDigest"]) &&
    isSha256Digest(integrity["visualHash"])
  );
}

function validateEnvelope(value: unknown): value is EditorRecoveryEnvelopeV1 {
  return validateEnvelopeStructure(value, validateBinding);
}

function validateLegacyEnvelope(
  value: unknown,
): value is LegacyEditorRecoveryEnvelopeV1 {
  return validateEnvelopeStructure(value, validateLegacyBinding);
}

function legacyBindingMatchesDocument(
  binding: LegacyEditorRecoveryBindingV1,
  document: ArchitectureDocumentV1 | ArchitectureDocumentV2,
): boolean {
  return (
    binding.architectureId === document.architectureId &&
    binding.documentId === document.documentId &&
    binding.revisionId === document.revision.revisionId &&
    binding.sourceDraftId === document.revision.sourceDraftId &&
    binding.provider.id === document.provider.id &&
    binding.provider.region === document.provider.region &&
    binding.catalog.id === document.catalog.id &&
    binding.catalog.version === document.catalog.version &&
    binding.catalog.digest === document.catalog.digest
  );
}

function legacyBindingMatchesExpectedScope(
  binding: LegacyEditorRecoveryBindingV1,
  expected: EditorRecoveryBindingV1,
): boolean {
  return (
    binding.architectureId === expected.architectureId &&
    binding.documentId === expected.documentId &&
    binding.revisionId === expected.revisionId &&
    binding.sourceDraftId === expected.sourceDraftId &&
    binding.provider.id === expected.provider.id &&
    binding.provider.region === expected.provider.region &&
    binding.catalog.id === expected.catalog.id &&
    binding.catalog.version === expected.catalog.version &&
    binding.catalog.digest === expected.catalog.digest &&
    binding.scopeFingerprint === expected.scopeFingerprint
  );
}

function inspectLegacyArchitectureEnvelope(
  envelope: LegacyEditorRecoveryEnvelopeV1,
  expectedBinding: EditorRecoveryBindingV1,
): Exclude<EditorRecoveryEnvelopeInspection, EditorRecoveryReady> {
  const bytes = canonicalBytes(envelope.canonicalDocument);
  const diagnosticMetadata = {
    canonicalBytes: bytes,
    documentSchemaVersion: envelope.binding.documentSchemaVersion,
    generation: envelope.checkpoint.generation,
    savedAt: envelope.checkpoint.savedAt,
    scopeFingerprint: envelope.binding.scopeFingerprint,
  } as const;
  if (
    bytes > EDITOR_RECOVERY_MAX_CANONICAL_BYTES ||
    envelope.integrity.canonicalBytes > EDITOR_RECOVERY_MAX_CANONICAL_BYTES
  ) {
    return reject(
      "payload-too-large",
      "canonical-document-too-large",
      "The saved legacy recovery document exceeds the local recovery size limit.",
      "$.canonicalDocument",
      diagnosticMetadata,
    );
  }
  if (bytes !== envelope.integrity.canonicalBytes) {
    return reject(
      "integrity-mismatch",
      "canonical-byte-count-mismatch",
      "The saved legacy recovery document byte count does not match its integrity metadata.",
      "$.integrity.canonicalBytes",
      diagnosticMetadata,
    );
  }

  let document: ArchitectureDocumentV1 | ArchitectureDocumentV2;
  let canonicalDocument: string;
  try {
    const rawDocument = JSON.parse(envelope.canonicalDocument) as unknown;
    if (envelope.binding.documentSchemaVersion === 1) {
      const parsed = parseArchitectureDocumentV1(rawDocument);
      document = parsed;
      canonicalDocument = serializeArchitectureDocumentV1(parsed);
    } else {
      const parsed = parseArchitectureDocumentV2(rawDocument);
      document = parsed;
      canonicalDocument = serializeArchitectureDocumentV2(parsed);
    }
  } catch {
    return reject(
      "document-incompatible",
      "legacy-document-invalid",
      `The saved Architecture v${String(envelope.binding.documentSchemaVersion)} recovery document is not valid.`,
      "$.canonicalDocument",
      diagnosticMetadata,
    );
  }
  if (canonicalDocument !== envelope.canonicalDocument) {
    return reject(
      "integrity-mismatch",
      "noncanonical-document",
      "The saved legacy recovery document is not in its required canonical serialization.",
      "$.canonicalDocument",
      diagnosticMetadata,
    );
  }
  if (
    !legacyBindingMatchesDocument(envelope.binding, document) ||
    !legacyBindingMatchesExpectedScope(envelope.binding, expectedBinding)
  ) {
    return reject(
      "binding-mismatch",
      "recovery-binding-mismatch",
      "The saved legacy draft does not match this exact recovery scope and Architecture Document binding.",
      "$.binding",
      diagnosticMetadata,
    );
  }

  const snapshotDigest = hashCanonicalDocument(envelope.canonicalDocument);
  if (
    envelope.integrity.snapshotDigest !== snapshotDigest ||
    envelope.checkpoint.snapshotDigest !== snapshotDigest
  ) {
    return reject(
      "integrity-mismatch",
      "recovery-digest-mismatch",
      "The saved legacy recovery document does not match its recorded snapshot digest.",
      "$.integrity.snapshotDigest",
      diagnosticMetadata,
    );
  }

  return reject(
    "document-incompatible",
    "older-document-version",
    `This intact local recovery snapshot uses Architecture v${String(envelope.binding.documentSchemaVersion)}. Automatic recovery does not migrate persisted older drafts; discard or explicitly replace it before saving Architecture v3.`,
    "$.binding.documentSchemaVersion",
    diagnosticMetadata,
  );
}

function validateEnvelopeMetadata(
  metadata: CreateEditorRecoveryEnvelopeMetadata,
): void {
  if (
    !safeInteger(metadata.generation) ||
    !isUtcTimestamp(metadata.savedAt) ||
    !isOpaqueId(metadata.writerId)
  ) {
    throw new TypeError(
      "Recovery checkpoint metadata must contain a positive generation, a UTC timestamp, and a bounded writer ID.",
    );
  }
}

export function createEditorRecoveryBindingV1(
  input: CreateEditorRecoveryBindingInput,
): EditorRecoveryBindingV1 {
  if (input.scopeKey.length === 0) {
    throw new TypeError("Recovery scope keys must not be empty.");
  }

  const document = input.seedDocument;
  const canonicalDocument = serializeArchitectureDocumentV3(document);
  return {
    architectureId: document.architectureId,
    catalog: {
      digest: document.catalog.digest,
      id: document.catalog.id,
      version: document.catalog.version,
    },
    documentId: document.documentId,
    documentKind: document.kind,
    documentSchemaVersion: document.schemaVersion,
    provider: {
      id: document.provider.id,
      region: document.provider.region,
    },
    revisionId: document.revision.revisionId,
    scopeFingerprint: hashCanonicalValue({
      kind: "cloudmarkup.editor-recovery-scope",
      scopeKey: input.scopeKey,
    }),
    seedSnapshotDigest: hashCanonicalDocument(canonicalDocument),
    ...(document.revision.sourceDraftId === undefined
      ? {}
      : { sourceDraftId: document.revision.sourceDraftId }),
  };
}

export function prepareEditorRecoverySnapshotV1(
  binding: EditorRecoveryBindingV1,
  input: ArchitectureDocument,
): EditorRecoverySnapshotPreparation {
  const migration = migrateCloudMarkupDocument(input);
  if (
    !migration.ok ||
    migration.classification !== "current" ||
    migration.document.kind !== "cloudmarkup.architecture-document"
  ) {
    const diagnostics = migrationEntries(migration.diagnostics);
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "document-incompatible",
        "document-not-current",
        "The draft is not a current, valid Architecture Document.",
        "$.document",
        {
          ...(migration.sourceVersion === undefined
            ? {}
            : { documentSchemaVersion: migration.sourceVersion }),
          scopeFingerprint: binding.scopeFingerprint,
        },
        diagnostics,
      ),
    };
  }

  const document = migration.document;
  if (!bindingMatchesDocument(binding, document)) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "binding-mismatch",
        "document-binding-mismatch",
        "The draft does not match the exact document, revision, provider, region, and catalog binding for this recovery scope.",
        "$.binding",
        { scopeFingerprint: binding.scopeFingerprint },
      ),
    };
  }

  const credentialPath = findCredentialLiteral(document);
  if (credentialPath !== undefined) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "credential-literal",
        "credential-literal-refused",
        "Recovery storage refuses literal values in credential-shaped configuration fields. Use a typed secret or variable reference instead.",
        credentialPath,
        { scopeFingerprint: binding.scopeFingerprint },
      ),
    };
  }

  const canonicalDocument = serializeArchitectureDocumentV3(document);
  const bytes = canonicalBytes(canonicalDocument);
  if (bytes > EDITOR_RECOVERY_MAX_CANONICAL_BYTES) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "payload-too-large",
        "canonical-document-too-large",
        "The canonical recovery document exceeds the local recovery size limit.",
        "$.canonicalDocument",
        {
          canonicalBytes: bytes,
          scopeFingerprint: binding.scopeFingerprint,
        },
      ),
    };
  }

  return {
    ok: true,
    snapshot: {
      binding,
      canonicalDocument,
      document,
      integrity: {
        canonicalBytes: bytes,
        ...getArchitectureDocumentHashes(document),
        snapshotDigest: hashCanonicalDocument(canonicalDocument),
      },
    },
  };
}

export function createEditorRecoveryEnvelopeV1(
  snapshot: PreparedEditorRecoverySnapshotV1,
  metadata: CreateEditorRecoveryEnvelopeMetadata,
): EditorRecoveryEnvelopeV1 {
  validateEnvelopeMetadata(metadata);

  return {
    kind: EDITOR_RECOVERY_ENVELOPE_KIND,
    schemaVersion: EDITOR_RECOVERY_ENVELOPE_SCHEMA_VERSION,
    binding: snapshot.binding,
    canonicalDocument: snapshot.canonicalDocument,
    checkpoint: {
      generation: metadata.generation,
      savedAt: metadata.savedAt,
      snapshotDigest: snapshot.integrity.snapshotDigest,
      writerId: metadata.writerId,
    },
    integrity: snapshot.integrity,
  };
}

export function inspectEditorRecoveryEnvelopeV1(
  input: unknown,
  expectedBinding: EditorRecoveryBindingV1,
): EditorRecoveryEnvelopeInspection {
  if (
    isRecord(input) &&
    Number.isSafeInteger(input["schemaVersion"]) &&
    (input["schemaVersion"] as number) > EDITOR_RECOVERY_ENVELOPE_SCHEMA_VERSION
  ) {
    return reject(
      "envelope-unsupported-future",
      "unsupported-envelope-version",
      "The saved recovery envelope was written by a newer unsupported version.",
      "$.schemaVersion",
      { envelopeSchemaVersion: input["schemaVersion"] as number },
    );
  }

  if (validateLegacyEnvelope(input)) {
    return inspectLegacyArchitectureEnvelope(input, expectedBinding);
  }

  if (!validateEnvelope(input)) {
    return reject(
      "envelope-malformed",
      "malformed-envelope",
      "The saved recovery envelope does not match the strict v1 contract.",
      "$",
    );
  }

  const envelope = input;
  const bytes = canonicalBytes(envelope.canonicalDocument);
  const diagnosticMetadata = {
    canonicalBytes: bytes,
    generation: envelope.checkpoint.generation,
    savedAt: envelope.checkpoint.savedAt,
    scopeFingerprint: envelope.binding.scopeFingerprint,
  } as const;

  if (
    bytes > EDITOR_RECOVERY_MAX_CANONICAL_BYTES ||
    envelope.integrity.canonicalBytes > EDITOR_RECOVERY_MAX_CANONICAL_BYTES
  ) {
    return reject(
      "payload-too-large",
      "canonical-document-too-large",
      "The saved canonical recovery document exceeds the local recovery size limit.",
      "$.canonicalDocument",
      diagnosticMetadata,
    );
  }

  if (bytes !== envelope.integrity.canonicalBytes) {
    return reject(
      "integrity-mismatch",
      "canonical-byte-count-mismatch",
      "The saved recovery document byte count does not match its integrity metadata.",
      "$.integrity.canonicalBytes",
      diagnosticMetadata,
    );
  }

  let rawDocument: unknown;
  try {
    rawDocument = JSON.parse(envelope.canonicalDocument) as unknown;
  } catch {
    return reject(
      "document-incompatible",
      "canonical-document-invalid-json",
      "The saved recovery document is not valid JSON.",
      "$.canonicalDocument",
      diagnosticMetadata,
    );
  }

  const documentSchemaVersion = readSchemaVersion(rawDocument);
  const migration = migrateCloudMarkupDocument(rawDocument);
  if (
    !migration.ok ||
    migration.classification !== "current" ||
    migration.document.kind !== "cloudmarkup.architecture-document"
  ) {
    return reject(
      "document-incompatible",
      "document-not-current",
      "The saved draft is not a current, valid Architecture Document.",
      "$.canonicalDocument",
      {
        ...diagnosticMetadata,
        ...(documentSchemaVersion === undefined
          ? {}
          : { documentSchemaVersion }),
      },
      migrationEntries(migration.diagnostics),
    );
  }

  const document = migration.document;
  if (migration.canonicalSerialization !== envelope.canonicalDocument) {
    return reject(
      "integrity-mismatch",
      "noncanonical-document",
      "The saved recovery document is not in the required canonical serialization.",
      "$.canonicalDocument",
      diagnosticMetadata,
    );
  }

  if (
    !bindingsEqual(envelope.binding, expectedBinding) ||
    !bindingMatchesDocument(envelope.binding, document)
  ) {
    return reject(
      "binding-mismatch",
      "recovery-binding-mismatch",
      "The saved draft does not match the exact recovery scope and Architecture Document binding.",
      "$.binding",
      diagnosticMetadata,
    );
  }

  const credentialPath = findCredentialLiteral(document);
  if (credentialPath !== undefined) {
    return reject(
      "credential-literal",
      "credential-literal-refused",
      "Recovery storage refuses literal values in credential-shaped configuration fields.",
      credentialPath,
      diagnosticMetadata,
    );
  }

  const hashes = getArchitectureDocumentHashes(document);
  const snapshotDigest = hashCanonicalDocument(envelope.canonicalDocument);
  if (
    envelope.integrity.contentHash !== hashes.contentHash ||
    envelope.integrity.visualHash !== hashes.visualHash ||
    envelope.integrity.snapshotDigest !== snapshotDigest ||
    envelope.checkpoint.snapshotDigest !== snapshotDigest
  ) {
    return reject(
      "integrity-mismatch",
      "recovery-digest-mismatch",
      "The saved recovery document does not match its recorded deterministic digests.",
      "$.integrity",
      diagnosticMetadata,
    );
  }

  return {
    diagnostic: null,
    document,
    envelope,
    head: {
      generation: envelope.checkpoint.generation,
      snapshotDigest,
    },
    migrationClassification: "current",
    status: "ready",
  };
}

export function serializeEditorRecoveryDiagnosticV1(
  diagnostic: EditorRecoveryDiagnosticV1,
): string {
  let rawDiagnosticTooLarge = true;
  try {
    rawDiagnosticTooLarge =
      canonicalBytes(serializeCanonicalJson(diagnostic)) >
      EDITOR_RECOVERY_MAX_DIAGNOSTIC_BYTES;
  } catch {
    // An adapter-provided diagnostic is untrusted. Fall through to a fixed,
    // bounded diagnostic rather than serializing arbitrary data.
  }
  if (rawDiagnosticTooLarge) {
    return serializeCanonicalJson(
      createDiagnostic(
        diagnostic.classification,
        "diagnostic-truncated",
        "Recovery diagnostics were truncated to the bounded redacted form.",
        "$",
      ),
    );
  }

  const safePathPattern = /^\$(?:\.[A-Za-z0-9_-]+|\[\d+\])*$/u;
  const redacted: EditorRecoveryDiagnosticV1 = {
    kind: "cloudmarkup.editor-recovery-diagnostic",
    schemaVersion: 1,
    classification: diagnostic.classification,
    diagnostics: diagnostic.diagnostics
      .slice(0, MAX_DIAGNOSTIC_ENTRIES)
      .map((entry) =>
        boundedEntry(
          "diagnostic-redacted",
          "Raw diagnostic details were omitted from this safe local copy.",
          safePathPattern.test(entry.path) ? entry.path : "$",
        ),
      ),
    ...(typeof diagnostic.canonicalBytes === "number" &&
    Number.isSafeInteger(diagnostic.canonicalBytes) &&
    diagnostic.canonicalBytes >= 0
      ? { canonicalBytes: diagnostic.canonicalBytes }
      : {}),
    ...(typeof diagnostic.documentSchemaVersion === "number" &&
    Number.isSafeInteger(diagnostic.documentSchemaVersion) &&
    diagnostic.documentSchemaVersion >= 0
      ? { documentSchemaVersion: diagnostic.documentSchemaVersion }
      : {}),
    ...(typeof diagnostic.envelopeSchemaVersion === "number" &&
    Number.isSafeInteger(diagnostic.envelopeSchemaVersion) &&
    diagnostic.envelopeSchemaVersion >= 0
      ? { envelopeSchemaVersion: diagnostic.envelopeSchemaVersion }
      : {}),
    ...(typeof diagnostic.generation === "number" &&
    safeInteger(diagnostic.generation)
      ? { generation: diagnostic.generation }
      : {}),
    ...(typeof diagnostic.savedAt === "string" &&
    isUtcTimestamp(diagnostic.savedAt)
      ? { savedAt: diagnostic.savedAt }
      : {}),
    ...(isSha256Digest(diagnostic.scopeFingerprint)
      ? { scopeFingerprint: diagnostic.scopeFingerprint }
      : {}),
  };
  return serializeCanonicalJson(redacted);
}
