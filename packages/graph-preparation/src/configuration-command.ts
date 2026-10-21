import {
  applyGraphCommand,
  getArchitectureDocumentHashes,
  type ArchitectureDocument,
  type ArchitectureDocumentHashes,
  type ArchitectureEdge,
  type ArchitectureNode,
  type GraphCommandApplicationResult,
} from "@cloudmarkup/domain";
import {
  parseGraphCommandV1,
  serializeCanonicalJson,
  type ConfigurationValue,
  type UpdateEdgeConfigurationCommandV1,
  type UpdateNodeConfigurationCommandV1,
} from "@cloudmarkup/schemas";

import {
  resolveExactEditorCatalogRelationship,
  resolveExactEditorCatalogService,
} from "./catalog-selection.js";
import type {
  EditorCatalog,
  EditorCatalogConfiguration,
  EditorCatalogConfigurationValidationIssue,
} from "./editor-catalog.js";

export type ConfigurationCommandTarget =
  | {
      readonly id: ArchitectureNode["id"] | string;
      readonly kind: "node";
    }
  | {
      readonly id: ArchitectureEdge["id"] | string;
      readonly kind: "edge";
    };

export type ConfigurationEdit = Readonly<ConfigurationValue> | undefined;

export interface PrepareConfigurationCommandInput {
  readonly catalog: EditorCatalog;
  readonly createId: () => string;
  readonly document: ArchitectureDocument;
  readonly edits: Readonly<Record<string, ConfigurationEdit>>;
  readonly target: ConfigurationCommandTarget;
}

export type PreparedConfigurationGraphCommand =
  UpdateEdgeConfigurationCommandV1 | UpdateNodeConfigurationCommandV1;

export interface ConfigurationPreviewChange {
  readonly after: string;
  readonly before: string;
  readonly property: string;
  readonly sensitive: boolean;
}

export interface PreparedConfigurationCommand {
  readonly baseHashes: ArchitectureDocumentHashes;
  readonly changes: readonly ConfigurationPreviewChange[];
  readonly command: PreparedConfigurationGraphCommand;
  readonly previewDocument: ArchitectureDocument;
  readonly previewHashes: ArchitectureDocumentHashes;
  readonly target: ConfigurationCommandTarget;
}

export type ConfigurationCommandPreparationIssueCode =
  | "catalog-mismatch"
  | "configuration-schema-mismatch"
  | "credential-literal-forbidden"
  | "duplicate-command-identity"
  | "invalid-configuration"
  | "no-changes"
  | "target-unavailable"
  | "unknown-property";

export interface ConfigurationCommandPreparationIssue {
  readonly code: ConfigurationCommandPreparationIssueCode;
  readonly message: string;
  readonly path: string;
  readonly property?: string;
}

export class ConfigurationCommandPreparationError extends Error {
  public readonly issues: readonly ConfigurationCommandPreparationIssue[];

  public constructor(issues: readonly ConfigurationCommandPreparationIssue[]) {
    super(
      issues[0]?.message ??
        "The configuration command could not be prepared safely.",
    );
    this.issues = Object.freeze([...issues]);
    this.name = "ConfigurationCommandPreparationError";
  }
}

export function createConfigurationFormBufferKey(
  target: ConfigurationCommandTarget,
  schemaId: string,
  schemaVersion: string,
): string {
  return `${target.kind}:${target.id}:${schemaId}@${schemaVersion}`;
}

interface ResolvedConfigurationTarget {
  readonly configuration: ArchitectureNode["semantic"]["configuration"];
  readonly definition: EditorCatalogConfiguration;
  readonly id: string;
  readonly kind: "edge" | "node";
}

function fail(
  code: ConfigurationCommandPreparationIssueCode,
  message: string,
  path: string,
  property?: string,
): never {
  throw new ConfigurationCommandPreparationError([
    {
      code,
      message,
      path,
      ...(property === undefined ? {} : { property }),
    },
  ]);
}

function resolveTarget(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  target: ConfigurationCommandTarget,
): ResolvedConfigurationTarget {
  if (target.kind === "node") {
    const node = document.nodes.find((candidate) => candidate.id === target.id);
    if (node === undefined) {
      return fail(
        "target-unavailable",
        "The selected resource is no longer available.",
        "$.target.id",
      );
    }

    const service = resolveExactEditorCatalogService(document, node, catalog);
    if (service?.supportState !== "available") {
      return fail(
        "catalog-mismatch",
        "The selected resource is not described by the exact catalog bound to this document.",
        "$.catalog",
      );
    }

    return {
      configuration: node.semantic.configuration,
      definition: service.configuration,
      id: node.id,
      kind: "node",
    };
  }

  const edge = document.edges.find((candidate) => candidate.id === target.id);
  if (edge === undefined) {
    return fail(
      "target-unavailable",
      "The selected relationship is no longer available.",
      "$.target.id",
    );
  }

  const relationship = resolveExactEditorCatalogRelationship(
    document,
    edge,
    catalog,
  );
  if (relationship === undefined) {
    return fail(
      "catalog-mismatch",
      "The selected relationship is not described by the exact catalog bound to this document.",
      "$.catalog",
    );
  }

  return {
    configuration: edge.semantic.configuration,
    definition: relationship.configuration,
    id: edge.id,
    kind: "edge",
  };
}

function validationIssues(
  issues: readonly EditorCatalogConfigurationValidationIssue[],
): readonly ConfigurationCommandPreparationIssue[] {
  return issues.map((issue) => ({
    code: "invalid-configuration",
    message: issue.message,
    path: issue.path,
    ...(issue.property === undefined ? {} : { property: issue.property }),
  }));
}

/**
 * Literal credential-shaped properties are not an editor input surface. This
 * is deliberately provider-neutral and applies only to string or string-list
 * values, so policy settings such as password length and generate-secret
 * booleans remain
 * configurable.
 */
export function isCredentialLiteralProperty(
  property: string,
  value: Readonly<ConfigurationValue>,
): boolean {
  if (value.kind !== "string" && value.kind !== "string-list") {
    return false;
  }

  const normalized = property.replaceAll(/[^A-Za-z0-9]/g, "").toLowerCase();
  return (
    normalized.includes("accesskey") ||
    normalized.includes("apikey") ||
    normalized.includes("authorizationheader") ||
    normalized.includes("authheader") ||
    normalized.includes("cookie") ||
    normalized.includes("credential") ||
    normalized.includes("password") ||
    normalized.includes("privatekey") ||
    normalized.includes("secret") ||
    normalized.includes("token")
  );
}

function formatPreviewValue(value: Readonly<ConfigurationValue> | undefined): {
  readonly sensitive: boolean;
  readonly text: string;
} {
  if (value === undefined) {
    return { sensitive: false, text: "Not set" };
  }

  switch (value.kind) {
    case "secret-reference":
      return { sensitive: true, text: "Secret reference (value hidden)" };
    case "variable-reference":
      return {
        sensitive: true,
        text: "Sensitive IaC variable reference (value hidden)",
      };
    default:
      return {
        sensitive: false,
        text: serializeCanonicalJson(value),
      };
  }
}

function configurationChanges(
  before: Readonly<Record<string, Readonly<ConfigurationValue>>>,
  after: Readonly<Record<string, Readonly<ConfigurationValue>>>,
): readonly ConfigurationPreviewChange[] {
  const properties = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort((left, right) => (left === right ? 0 : left < right ? -1 : 1));

  return properties.flatMap((property) => {
    const previous = before[property];
    const next = after[property];
    if (
      serializeCanonicalJson(previous ?? null) ===
      serializeCanonicalJson(next ?? null)
    ) {
      return [];
    }

    const beforePreview = formatPreviewValue(previous);
    const afterPreview = formatPreviewValue(next);
    return [
      {
        after: afterPreview.text,
        before: beforePreview.text,
        property,
        sensitive: beforePreview.sensitive || afterPreview.sensitive,
      },
    ];
  });
}

function prepareValues(
  target: ResolvedConfigurationTarget,
  edits: Readonly<Record<string, ConfigurationEdit>>,
): Readonly<Record<string, Readonly<ConfigurationValue>>> {
  if (
    target.configuration.schemaId !== target.definition.schemaId ||
    target.configuration.schemaVersion !== target.definition.schemaVersion
  ) {
    return fail(
      "configuration-schema-mismatch",
      "The selected configuration schema does not match the bound catalog.",
      "$.configuration",
    );
  }

  const fieldsByProperty = new Map(
    target.definition.fields.map((field) => [field.property, field] as const),
  );
  const knownProperties = new Set(fieldsByProperty.keys());
  const refusesCredentialLiteral = (
    property: string,
    value: Readonly<ConfigurationValue>,
  ): boolean =>
    ((value.kind === "string" || value.kind === "string-list") &&
      fieldsByProperty.get(property)?.securityImpact === "secret-reference") ||
    isCredentialLiteralProperty(property, value);
  for (const [property, value] of Object.entries(edits)) {
    if (!knownProperties.has(property)) {
      return fail(
        "unknown-property",
        "This property is not editable through the bound catalog.",
        `$.configuration.values.${property}`,
        property,
      );
    }
    if (value !== undefined && refusesCredentialLiteral(property, value)) {
      return fail(
        "credential-literal-forbidden",
        "Literal cloud credentials cannot be entered or stored in an Architecture Document.",
        `$.configuration.values.${property}`,
        property,
      );
    }
  }

  const knownCurrentValues = Object.fromEntries(
    Object.entries(target.configuration.values).filter(([property]) =>
      knownProperties.has(property),
    ),
  );
  let editedKnownValues: Record<string, Readonly<ConfigurationValue>> = {
    ...knownCurrentValues,
  };
  for (const [property, value] of Object.entries(edits)) {
    if (value === undefined) {
      editedKnownValues = Object.fromEntries(
        Object.entries(editedKnownValues).filter(
          ([candidate]) => candidate !== property,
        ),
      );
    } else {
      editedKnownValues[property] = value;
    }
  }
  for (const [property, value] of Object.entries(editedKnownValues)) {
    if (refusesCredentialLiteral(property, value)) {
      return fail(
        "credential-literal-forbidden",
        "Literal cloud credentials must be replaced by a supported reference before this configuration can be saved.",
        `$.configuration.values.${property}`,
        property,
      );
    }
  }

  const validation = target.definition.validate(editedKnownValues);
  if (!validation.success) {
    throw new ConfigurationCommandPreparationError(
      validationIssues(validation.issues),
    );
  }

  // Existing properties unknown to this UI projection are carried through
  // byte-for-byte and cannot be edited here. This prevents an unrelated edit
  // from discarding a forward-compatible value.
  const preservedUnknownValues = Object.fromEntries(
    Object.entries(target.configuration.values).filter(
      ([property]) => !knownProperties.has(property),
    ),
  );

  const mergedValues = {
    ...preservedUnknownValues,
    ...validation.values,
  };
  for (const [property, value] of Object.entries(mergedValues)) {
    if (refusesCredentialLiteral(property, value)) {
      return fail(
        "credential-literal-forbidden",
        "Literal cloud credentials must be replaced by a supported reference before this configuration can be saved.",
        `$.configuration.values.${property}`,
        property,
      );
    }
  }

  return mergedValues;
}

export function prepareConfigurationCommand(
  input: PrepareConfigurationCommandInput,
): PreparedConfigurationCommand {
  const target = resolveTarget(input.document, input.catalog, input.target);
  const values = prepareValues(target, input.edits);
  const changes = configurationChanges(target.configuration.values, values);
  if (changes.length === 0) {
    return fail(
      "no-changes",
      "No configuration values changed.",
      "$.configuration.values",
    );
  }

  const commandId = input.createId();
  const inverseCommandId = input.createId();
  if (commandId === inverseCommandId) {
    return fail(
      "duplicate-command-identity",
      "Configuration command and inverse command IDs must be distinct.",
      "$.commandId",
    );
  }

  const configuration = {
    schemaId: target.configuration.schemaId,
    schemaVersion: target.configuration.schemaVersion,
    values,
  };
  const envelope = {
    commandId,
    inverseCommandId,
    origin: "user" as const,
    schemaVersion: 1 as const,
    target: {
      architectureId: input.document.architectureId,
      documentId: input.document.documentId,
      revisionId: input.document.revision.revisionId,
    },
  };
  const parsed = parseGraphCommandV1(
    target.kind === "node"
      ? {
          ...envelope,
          configuration,
          expectedConfiguration: target.configuration,
          kind: "update-node-configuration",
          nodeId: target.id,
        }
      : {
          ...envelope,
          configuration,
          edgeId: target.id,
          expectedConfiguration: target.configuration,
          kind: "update-edge-configuration",
        },
  );
  if (
    parsed.kind !== "update-node-configuration" &&
    parsed.kind !== "update-edge-configuration"
  ) {
    return fail(
      "invalid-configuration",
      "The command parser did not return a configuration command.",
      "$.kind",
    );
  }

  const preview = applyGraphCommand(input.document, parsed);
  return Object.freeze({
    baseHashes: getArchitectureDocumentHashes(input.document),
    changes: Object.freeze(changes),
    command: parsed,
    previewDocument: preview.document,
    previewHashes: getArchitectureDocumentHashes(preview.document),
    target: Object.freeze({ ...input.target }),
  });
}

export function applyPreparedConfigurationCommand(
  document: ArchitectureDocument,
  prepared: PreparedConfigurationCommand,
): GraphCommandApplicationResult {
  return applyGraphCommand(document, prepared.command);
}
