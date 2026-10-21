import {
  providerCatalogArtifactV1Schema,
  providerConnectionRuleDescriptorV1Schema,
  providerServiceExtensionArtifactV1Schema,
  providerServiceDefinitionV1Schema,
  type ProviderConfigurationPropertyJsonSchemaV1,
  type ProviderServiceConfigurationV1,
  validateProviderConfigurationV1,
} from "@cloudmarkup/provider-sdk";
import { configurationValueSchema } from "@cloudmarkup/schemas";

import type {
  EditorCatalog,
  EditorCatalogConfiguration,
  EditorCatalogConfigurationField,
  EditorCatalogConfigurationFieldSchema,
  EditorCatalogConfigurationValidationIssue,
  EditorCatalogConfigurationValidationIssueCode,
  EditorCatalogConfigurationValidationResult,
  EditorCatalogDefaultConfiguration,
  EditorCatalogDocumentationReference,
  EditorCatalogEducation,
  EditorCatalogInvalidEntry,
  EditorCatalogMapping,
  EditorCatalogPlacement,
  EditorCatalogPort,
  EditorConnectionCategory,
  EditorConnectionGroup,
  EditorConnectionGroupCategory,
  EditorCatalogRegionAvailability,
  EditorCatalogRelationship,
  EditorCatalogService,
  EditorCatalogSupportLevel,
  EditorCatalogUnsupportedCapability,
  EditorOwnedConfigurationSlot,
  EditorTargetReadiness,
  EditorNodeKind,
} from "./editor-catalog.js";
import {
  deriveEditorConnectionGroups,
  validateEditorConnectionGroups,
} from "./connection-docks.js";

type UnknownRecord = Readonly<Record<string, unknown>>;

export interface ProviderCatalogEditorSource {
  readonly artifact: unknown;
  listConnectionRules(): readonly unknown[];
  listServices(): readonly unknown[];
  validateConfiguration(serviceId: string, values: unknown): unknown;
}

export interface ProviderConnectionPresentationEditorSource {
  readonly artifact: unknown;
}

export interface ProviderServiceExtensionEditorSource {
  readonly artifact: unknown;
}

const SEMANTIC_VERSION_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function neutralizeUserFacingText(value: string): string {
  return value
    .replaceAll("CloudMarkup catalogs", "service catalogs")
    .replaceAll("unless CloudMarkup", "unless the editor")
    .replaceAll("so CloudMarkup", "so the editor")
    .replaceAll("; CloudMarkup", "; the editor")
    .replaceAll(". CloudMarkup", ". The editor")
    .replaceAll("CloudMarkup", "The editor");
}

function userFacingString(value: unknown): string | undefined {
  const parsed = nonEmptyString(value);
  return parsed === undefined ? undefined : neutralizeUserFacingText(parsed);
}

function userFacingStringArray(value: unknown): readonly string[] | undefined {
  const parsed = stringArray(value);
  return parsed?.map(neutralizeUserFacingText);
}

function stringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.map(nonEmptyString);
  return strings.every((item) => item !== undefined) ? strings : undefined;
}

function recordArray(value: unknown): readonly UnknownRecord[] | undefined {
  return Array.isArray(value) && value.every(isRecord) ? value : undefined;
}

function supportLevel(value: unknown): EditorCatalogSupportLevel | undefined {
  return value === "proof" ||
    value === "production-oriented" ||
    value === "curated"
    ? value
    : undefined;
}

function connectionCategory(
  value: unknown,
): Exclude<EditorConnectionCategory, "other"> | undefined {
  switch (value) {
    case "receives-events-from":
    case "reads-or-writes-data":
    case "sends-messages-or-events":
    case "invokes-another-workload":
    case "uses-secrets-or-configuration":
    case "network-and-security":
    case "observability":
      return value;
    default:
      return undefined;
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function normalizeSearchPart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[._:/-]+/gu, " ")
    .replace(/[^\p{Letter}\p{Number}\s]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function uniqueSortedText(values: readonly string[]): readonly string[] {
  return [
    ...new Set(
      values.map((value) => value.trim()).filter((value) => value !== ""),
    ),
  ].sort(compareText);
}

function maturityLabel(level: EditorCatalogSupportLevel): string {
  switch (level) {
    case "proof":
      return "Proof metadata";
    case "production-oriented":
      return "Production-oriented";
    case "curated":
      return "Curated";
  }
}

function maturityDetail(level: EditorCatalogSupportLevel): string {
  switch (level) {
    case "proof":
      return "This catalog definition is proof metadata and is not a product support claim.";
    case "production-oriented":
      return "This catalog definition is production-oriented metadata, not curated service support.";
    case "curated":
      return "This definition meets the catalog's curated metadata level. Target and Region status remain separate.";
  }
}

function parseCatalogMetadata(source: ProviderCatalogEditorSource): {
  readonly catalogDescription: string;
  readonly catalogId: string;
  readonly catalogMaturity: EditorCatalogSupportLevel;
  readonly catalogVersion: string;
  readonly digest: string;
  readonly providerId: string;
  readonly providerName: string;
} {
  const parsed = providerCatalogArtifactV1Schema.safeParse(source.artifact);
  if (!parsed.success) {
    throw new TypeError("The provider catalog artifact is invalid.");
  }
  const { catalog, digest, provider } = parsed.data;
  const catalogMaturity = supportLevel(catalog.maturity);
  if (catalogMaturity === undefined) {
    throw new TypeError("The provider catalog identity is invalid.");
  }

  return {
    catalogDescription: neutralizeUserFacingText(catalog.description),
    catalogId: catalog.id,
    catalogMaturity,
    catalogVersion: catalog.version,
    digest,
    providerId: provider.id,
    providerName: provider.displayName,
  };
}

function parseDocumentation(
  value: unknown,
): readonly EditorCatalogDocumentationReference[] | undefined {
  const records = recordArray(value);
  if (records === undefined) {
    return undefined;
  }

  const references: EditorCatalogDocumentationReference[] = [];
  for (const record of records) {
    const title = userFacingString(record["title"]);
    if (title === undefined) {
      return undefined;
    }
    if (record["kind"] === "official") {
      const href = nonEmptyString(record["url"]);
      if (!href?.startsWith("https://")) {
        return undefined;
      }
      references.push({ href, kind: "official", title });
      continue;
    }
    if (record["kind"] === "cloudmarkup") {
      const path = nonEmptyString(record["path"]);
      if (!path?.startsWith("docs/")) {
        return undefined;
      }
      references.push({ kind: "cloudmarkup", path, title });
      continue;
    }
    return undefined;
  }
  return references;
}

function parseEducation(value: unknown): EditorCatalogEducation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const summary = userFacingString(value["summary"]);
  const guidedExplanation = userFacingString(value["guidedExplanation"]);
  const professionalExplanation = userFacingString(
    value["professionalExplanation"],
  );
  const considerations = userFacingStringArray(value["considerations"]);
  const documentation = parseDocumentation(value["documentation"]);
  if (
    summary === undefined ||
    guidedExplanation === undefined ||
    professionalExplanation === undefined ||
    considerations === undefined ||
    documentation === undefined
  ) {
    return undefined;
  }

  return {
    considerations,
    documentation,
    guidedExplanation,
    professionalExplanation,
    summary,
  };
}

function parsePorts(value: unknown): readonly EditorCatalogPort[] | undefined {
  const records = recordArray(value);
  if (records === undefined) {
    return undefined;
  }

  const seen = new Set<string>();
  const ports: EditorCatalogPort[] = [];
  for (const record of records) {
    const id = nonEmptyString(record["id"]);
    const displayName = nonEmptyString(record["displayName"]);
    const description = nonEmptyString(record["description"]);
    const capability = nonEmptyString(record["capability"]);
    const category = connectionCategory(record["category"]);
    const direction = record["direction"];
    const cardinality = record["cardinality"];
    const required = record["required"];
    if (
      id === undefined ||
      displayName === undefined ||
      description === undefined ||
      capability === undefined ||
      category === undefined ||
      (direction !== "input" && direction !== "output") ||
      (cardinality !== "one" && cardinality !== "many") ||
      typeof required !== "boolean" ||
      seen.has(id)
    ) {
      return undefined;
    }
    seen.add(id);
    ports.push({
      capability,
      cardinality,
      category,
      connectionSupport: "unsupported",
      description,
      direction,
      displayName,
      id,
      required,
    });
  }
  return ports.sort((left, right) => compareText(left.id, right.id));
}

function parsePlacement(value: unknown): EditorCatalogPlacement | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const rootPlacement = value["rootPlacement"];
  const allowedParentRecords = recordArray(value["allowedParentTypes"]);
  const maximumDepth = value["maximumDepth"];
  const regionConstraint = value["regionConstraint"];
  if (
    (rootPlacement !== "allowed" &&
      rootPlacement !== "required" &&
      rootPlacement !== "forbidden") ||
    allowedParentRecords === undefined ||
    (regionConstraint !== "same-region" &&
      regionConstraint !== "provider-defined" &&
      regionConstraint !== "not-applicable") ||
    (maximumDepth !== undefined &&
      (typeof maximumDepth !== "number" ||
        !Number.isInteger(maximumDepth) ||
        maximumDepth <= 0))
  ) {
    return undefined;
  }

  const allowedParents = allowedParentRecords.map((parent) => ({
    relationshipType: nonEmptyString(parent["relationshipType"]),
    serviceType: nonEmptyString(parent["serviceId"]),
  }));
  if (
    allowedParents.some(
      (parent) =>
        parent.relationshipType === undefined ||
        parent.serviceType === undefined,
    )
  ) {
    return undefined;
  }

  return {
    allowedParents: allowedParents as readonly {
      readonly relationshipType: string;
      readonly serviceType: string;
    }[],
    ...(maximumDepth === undefined ? {} : { maximumDepth }),
    regionConstraint,
    rootPlacement,
  };
}

function parseMappings(
  value: unknown,
): readonly EditorCatalogMapping[] | undefined {
  const records = recordArray(value);
  if (records === undefined) {
    return undefined;
  }
  const mappings: EditorCatalogMapping[] = [];
  for (const record of records) {
    const mappingId = nonEmptyString(record["mappingId"]);
    const target = nonEmptyString(record["target"]);
    const implementationStatus = record["implementationStatus"];
    const configurationBindingRecords = recordArray(
      record["configurationBindings"],
    );
    const portBindingRecords = recordArray(record["portBindings"]);
    const mappingKind = record["kind"];
    const targetResourceType =
      mappingKind === "nested-block"
        ? nonEmptyString(record["blockName"])
        : (nonEmptyString(record["resourceType"]) ??
          nonEmptyString(record["typeName"]));
    if (
      mappingId === undefined ||
      target === undefined ||
      targetResourceType === undefined ||
      (implementationStatus !== "metadata-only" &&
        implementationStatus !== "implemented") ||
      configurationBindingRecords === undefined ||
      portBindingRecords === undefined
    ) {
      return undefined;
    }
    const configurationBindings = configurationBindingRecords.map(
      (binding) => ({
        property: nonEmptyString(binding["configurationKey"]),
        targetName: nonEmptyString(binding["targetName"]),
      }),
    );
    const portBindings = portBindingRecords.map((binding) => ({
      portId: nonEmptyString(binding["portId"]),
      targetAttribute: nonEmptyString(binding["targetAttribute"]),
    }));
    if (
      configurationBindings.some(
        (binding) =>
          binding.property === undefined || binding.targetName === undefined,
      ) ||
      portBindings.some(
        (binding) =>
          binding.portId === undefined || binding.targetAttribute === undefined,
      )
    ) {
      return undefined;
    }
    mappings.push({
      configurationBindings: (
        configurationBindings as {
          readonly property: string;
          readonly targetName: string;
        }[]
      ).sort(
        (left, right) =>
          compareText(left.property, right.property) ||
          compareText(left.targetName, right.targetName),
      ),
      implementationStatus,
      mappingId,
      portBindings: (
        portBindings as {
          readonly portId: string;
          readonly targetAttribute: string;
        }[]
      ).sort(
        (left, right) =>
          compareText(left.portId, right.portId) ||
          compareText(left.targetAttribute, right.targetAttribute),
      ),
      target,
      targetResourceType,
      targetResourceTypeLabel:
        mappingKind === "nested-block"
          ? `${target} nested block`
          : `${target} resource type`,
    });
  }
  return mappings.sort(
    (left, right) =>
      compareText(left.target, right.target) ||
      compareText(left.mappingId, right.mappingId),
  );
}

function parseRegionAvailability(
  value: unknown,
): EditorCatalogRegionAvailability | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value["state"] === "unknown") {
    const reason = nonEmptyString(value["reason"]);
    return reason === undefined ? undefined : { reason, state: "unknown" };
  }
  if (value["state"] !== "known") {
    return undefined;
  }

  const coverage = value["coverage"];
  const records = recordArray(value["regions"]);
  if (
    (coverage !== "complete" && coverage !== "partial") ||
    records === undefined
  ) {
    return undefined;
  }
  const regions = records.map((record) => ({
    availability: record["availability"],
    region: nonEmptyString(record["region"]),
  }));
  if (
    regions.some(
      (region) =>
        region.region === undefined ||
        (region.availability !== "available" &&
          region.availability !== "unavailable"),
    )
  ) {
    return undefined;
  }
  return {
    coverage,
    regions: regions as readonly {
      readonly availability: "available" | "unavailable";
      readonly region: string;
    }[],
    state: "known",
  };
}

function parseUnsupportedCapabilities(
  value: unknown,
): readonly EditorCatalogUnsupportedCapability[] | undefined {
  const records = recordArray(value);
  if (records === undefined) {
    return undefined;
  }
  const capabilities = records.map((record) => ({
    explanation: nonEmptyString(record["explanation"]),
    id: nonEmptyString(record["id"]),
    title: nonEmptyString(record["title"]),
  }));
  if (
    capabilities.some(
      (capability) =>
        capability.explanation === undefined ||
        capability.id === undefined ||
        capability.title === undefined,
    )
  ) {
    return undefined;
  }
  return capabilities as readonly EditorCatalogUnsupportedCapability[];
}

const VALIDATION_ISSUE_CODES =
  new Set<EditorCatalogConfigurationValidationIssueCode>([
    "invalid-configuration-record",
    "invalid-value",
    "invalid-value-kind",
    "missing-required-property",
    "unknown-property",
  ]);

function propertyPath(property: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(property)
    ? `$.values.${property}`
    : `$.values[${JSON.stringify(property)}]`;
}

function validationUnavailable(): EditorCatalogConfigurationValidationResult {
  const issue: EditorCatalogConfigurationValidationIssue = {
    code: "validation-unavailable",
    message: "Catalog configuration validation is unavailable.",
    path: "$.values",
    property: undefined,
  };
  return deepFreeze({
    issues: [issue],
    success: false,
  });
}

function issueProperty(
  path: string,
  properties: readonly string[],
): string | undefined {
  return properties.find((property) => propertyPath(property) === path);
}

function normalizeValidationResult(
  result: unknown,
  properties: readonly string[],
): EditorCatalogConfigurationValidationResult {
  if (!isRecord(result)) {
    return validationUnavailable();
  }
  if (result["success"] === true && isRecord(result["values"])) {
    const values: Record<
      string,
      ReturnType<typeof configurationValueSchema.parse>
    > = {};
    for (const property of Object.keys(result["values"]).sort(compareText)) {
      const parsed = configurationValueSchema.safeParse(
        result["values"][property],
      );
      if (!parsed.success) {
        return validationUnavailable();
      }
      values[property] = structuredClone(parsed.data);
    }
    return deepFreeze({ success: true, values });
  }
  if (result["success"] !== false) {
    return validationUnavailable();
  }

  const issueRecords = recordArray(result["issues"]);
  if (issueRecords === undefined || issueRecords.length === 0) {
    return validationUnavailable();
  }
  const issues: EditorCatalogConfigurationValidationIssue[] = [];
  for (const issueRecord of issueRecords.slice(0, 256)) {
    const code = nonEmptyString(issueRecord["code"]);
    const path = nonEmptyString(issueRecord["path"]);
    const message = nonEmptyString(issueRecord["message"]);
    if (
      code === undefined ||
      !VALIDATION_ISSUE_CODES.has(
        code as EditorCatalogConfigurationValidationIssueCode,
      ) ||
      path === undefined ||
      message === undefined
    ) {
      return validationUnavailable();
    }
    issues.push({
      code: code as EditorCatalogConfigurationValidationIssueCode,
      message,
      path,
      property: issueProperty(path, properties),
    });
  }
  return deepFreeze({ issues, success: false });
}

function configurationFieldSchema(
  property: ProviderConfigurationPropertyJsonSchemaV1,
): EditorCatalogConfigurationFieldSchema | undefined {
  switch (property.type) {
    case "string":
      return {
        kind: "string",
        ...(property.default === undefined
          ? {}
          : { default: property.default }),
        ...(property.enum === undefined ? {} : { enum: [...property.enum] }),
        ...(property.minLength === undefined
          ? {}
          : { minimumLength: property.minLength }),
        ...(property.maxLength === undefined
          ? {}
          : { maximumLength: property.maxLength }),
        ...(property.pattern === undefined
          ? {}
          : { pattern: property.pattern }),
      };
    case "number":
    case "integer":
      return {
        kind: property.type,
        ...(property.default === undefined
          ? {}
          : { default: property.default }),
        ...(property.enum === undefined ? {} : { enum: [...property.enum] }),
        ...(property.minimum === undefined
          ? {}
          : { minimum: property.minimum }),
        ...(property.maximum === undefined
          ? {}
          : { maximum: property.maximum }),
      };
    case "boolean":
      return {
        kind: "boolean",
        ...(property.default === undefined
          ? {}
          : { default: property.default }),
        ...(property.const === undefined ? {} : { const: property.const }),
      };
    case "array": {
      const defaultValues = property.default;
      if (
        defaultValues !== undefined &&
        (property.items.type === "string"
          ? !defaultValues.every((item) => typeof item === "string")
          : !defaultValues.every((item) => typeof item === "number"))
      ) {
        return undefined;
      }
      const constraints = {
        ...(property.minItems === undefined
          ? {}
          : { minimumItems: property.minItems }),
        ...(property.maxItems === undefined
          ? {}
          : { maximumItems: property.maxItems }),
        uniqueItems: property.uniqueItems === true,
      };
      if (property.items.type === "string") {
        const stringDefaults =
          defaultValues === undefined
            ? undefined
            : (defaultValues as readonly string[]);
        return {
          ...constraints,
          ...(stringDefaults === undefined
            ? {}
            : { default: [...stringDefaults] }),
          ...(property.items.enum === undefined
            ? {}
            : { enum: [...property.items.enum] }),
          kind: "string-list",
        };
      }
      const numberDefaults =
        defaultValues === undefined
          ? undefined
          : (defaultValues as readonly number[]);
      return {
        ...constraints,
        ...(numberDefaults === undefined
          ? {}
          : { default: [...numberDefaults] }),
        ...(property.items.enum === undefined
          ? {}
          : { enum: [...property.items.enum] }),
        kind:
          property.items.type === "integer" ? "integer-list" : "number-list",
      };
    }
  }
  return undefined;
}

function defaultConfiguration(
  validate: (values: unknown) => EditorCatalogConfigurationValidationResult,
): EditorCatalogDefaultConfiguration {
  const result = validate({});
  if (result.success) {
    return {
      kind: "ready",
      values: result.values,
    };
  }
  const missingPaths = result.issues
    .filter((issue) => issue.code === "missing-required-property")
    .map((issue) => issue.path)
    .sort(compareText);
  return {
    kind: "unavailable",
    reason:
      missingPaths.length === 0
        ? "Catalog defaults do not form a safe valid configuration."
        : `Required catalog input has no safe default: ${missingPaths.join(", ")}.`,
  };
}

function projectConfiguration(
  configuration: ProviderServiceConfigurationV1,
  validateInput: (values: unknown) => unknown,
): EditorCatalogConfiguration | undefined {
  if (!SEMANTIC_VERSION_PATTERN.test(configuration.schemaVersion)) {
    return undefined;
  }
  const properties = configuration.jsonSchema.properties as Readonly<
    Record<string, ProviderConfigurationPropertyJsonSchemaV1>
  >;
  const propertyNames = Object.keys(properties).sort(compareText);
  const required = new Set<string>(
    configuration.jsonSchema.required.map(String),
  );
  const hints = new Map<
    string,
    ProviderServiceConfigurationV1["uiHints"][number]
  >();
  for (const hint of configuration.uiHints) {
    if (hints.has(hint.property) || !Object.hasOwn(properties, hint.property)) {
      return undefined;
    }
    hints.set(hint.property, hint);
  }
  if (hints.size !== propertyNames.length) {
    return undefined;
  }

  const fields: EditorCatalogConfigurationField[] = [];
  for (const property of propertyNames) {
    const propertySchema = properties[property];
    const hint = hints.get(property);
    if (propertySchema === undefined || hint === undefined) {
      return undefined;
    }
    const schema = configurationFieldSchema(propertySchema);
    if (schema === undefined) {
      return undefined;
    }
    fields.push({
      advanced: hint.advanced,
      control: hint.control,
      costImpact: hint.costImpact,
      ...(hint.helpText === undefined
        ? {}
        : { helpText: neutralizeUserFacingText(hint.helpText) }),
      label: hint.label,
      order: hint.order,
      property,
      required: required.has(property),
      schema,
      securityImpact: hint.securityImpact,
      valueSource: hint.valueSource,
    });
  }
  fields.sort(
    (left, right) =>
      left.order - right.order || compareText(left.property, right.property),
  );
  const validate = (
    values: unknown,
  ): EditorCatalogConfigurationValidationResult => {
    try {
      return normalizeValidationResult(validateInput(values), propertyNames);
    } catch {
      return validationUnavailable();
    }
  };
  const propertyLabels = uniqueSortedText(
    fields.flatMap((field) => [field.property, field.label]),
  );

  return {
    defaults: defaultConfiguration(validate),
    fields,
    hasCostSensitiveFields: fields.some(
      (field) => field.costImpact === "cost-sensitive",
    ),
    hasSecuritySensitiveFields: fields.some(
      (field) =>
        field.securityImpact === "security-sensitive" ||
        field.securityImpact === "secret-reference",
    ),
    propertyLabels,
    schemaId: configuration.schemaId,
    schemaVersion: configuration.schemaVersion,
    validate,
  };
}

function parseNodeKind(value: unknown):
  | {
      readonly deployable: boolean;
      readonly nodeKind: EditorNodeKind;
      readonly resourceType: string;
    }
  | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value["kind"] === "resource") {
    const resourceType = nonEmptyString(value["resourceType"]);
    const deployable = value["deployable"];
    return resourceType === undefined || typeof deployable !== "boolean"
      ? undefined
      : { deployable, nodeKind: "resource", resourceType };
  }
  if (value["kind"] === "boundary") {
    const resourceType = nonEmptyString(value["boundaryType"]);
    return resourceType === undefined
      ? undefined
      : {
          // Boundaries remain independently visible editor elements. Only an
          // explicit resource deployable:false marks owner-surfaced internals.
          deployable: true,
          nodeKind: "boundary",
          resourceType,
        };
  }
  return undefined;
}

function parseService(
  source: ProviderCatalogEditorSource,
  input: unknown,
  index: number,
): EditorCatalogService | EditorCatalogInvalidEntry {
  const fallbackId = `invalid-catalog-entry-${String(index + 1).padStart(4, "0")}`;
  const invalid = (
    title = "Invalid catalog entry",
  ): EditorCatalogInvalidEntry => ({
    id: fallbackId,
    reason:
      "This catalog entry is malformed or incomplete and cannot be added.",
    title,
  });
  if (!isRecord(input)) {
    return invalid();
  }
  const parsedDefinition = providerServiceDefinitionV1Schema.safeParse(input);
  if (!parsedDefinition.success) {
    return invalid(nonEmptyString(input["displayName"]));
  }
  const parsedInput: unknown = parsedDefinition.data;
  if (!isRecord(parsedInput)) {
    return invalid();
  }

  const serviceType = nonEmptyString(parsedInput["id"]);
  const displayName = nonEmptyString(parsedInput["displayName"]);
  const description = nonEmptyString(parsedInput["description"]);
  const rawIconId = parsedInput["iconId"];
  const iconId = rawIconId === null ? null : nonEmptyString(rawIconId);
  const level = supportLevel(parsedInput["supportLevel"]);
  const kind = parseNodeKind(parsedInput["nodeKind"]);
  const placement = parsePlacement(parsedInput["placement"]);
  const ports = parsePorts(parsedInput["ports"]);
  const education = parseEducation(parsedInput["education"]);
  const mappings = parseMappings(parsedInput["mappings"]);
  const regionAvailability = parseRegionAvailability(
    parsedInput["regionAvailability"],
  );
  const unsupportedCapabilities = parseUnsupportedCapabilities(
    parsedInput["unsupportedCapabilities"],
  );
  if (
    serviceType === undefined ||
    displayName === undefined ||
    description === undefined ||
    iconId === undefined ||
    level === undefined ||
    kind === undefined ||
    placement === undefined ||
    ports === undefined ||
    education === undefined ||
    mappings === undefined ||
    regionAvailability === undefined ||
    unsupportedCapabilities === undefined ||
    (iconId === null && kind.deployable)
  ) {
    return invalid(displayName);
  }

  const configuration = projectConfiguration(
    parsedDefinition.data.configuration,
    (values) => source.validateConfiguration(serviceType, values),
  );
  if (configuration === undefined) {
    return invalid(displayName);
  }

  const category =
    placement.rootPlacement === "forbidden"
      ? {
          guidedLabel: "Needs a parent",
          id: "parent-required" as const,
          professionalLabel: "Parent-required",
        }
      : {
          guidedLabel: "Add directly",
          id: "root-placeable" as const,
          professionalLabel: "Root-placeable",
        };
  const advancedSearchTerms = uniqueSortedText([
    serviceType,
    kind.resourceType,
    ...ports.flatMap((port) => [port.id, port.capability]),
    ...configuration.propertyLabels,
    ...mappings.map((mapping) => mapping.target),
  ]);
  const searchText = normalizeSearchPart(
    [
      displayName,
      description,
      serviceType,
      kind.resourceType,
      category.guidedLabel,
      category.professionalLabel,
      education.summary,
      education.guidedExplanation,
      education.professionalExplanation,
      ...education.considerations,
      ...education.documentation.map((reference) => reference.title),
      ...ports.flatMap((port) => [
        port.displayName,
        port.description,
        port.capability,
      ]),
      ...unsupportedCapabilities.flatMap((capability) => [
        capability.title,
        capability.explanation,
      ]),
      ...advancedSearchTerms,
    ].join(" "),
  );
  return {
    advancedSearchTerms,
    category,
    configuration,
    connectionGroups: deriveEditorConnectionGroups(ports),
    deployable: kind.deployable,
    description,
    displayName,
    education,
    iconId,
    mappings,
    nodeKind: kind.nodeKind,
    placement,
    ports,
    regionAvailability,
    resourceType: kind.resourceType,
    searchText,
    serviceType,
    supportDetail: maturityDetail(level),
    supportLabel: maturityLabel(level),
    supportLevel: level,
    supportState: "available",
    unsupportedCapabilities,
  };
}

function parseRelationship(
  input: unknown,
): EditorCatalogRelationship | undefined {
  const parsedDefinition =
    providerConnectionRuleDescriptorV1Schema.safeParse(input);
  if (!parsedDefinition.success) {
    return undefined;
  }
  const rule = parsedDefinition.data;
  const education = parseEducation(rule.education);
  const configuration = projectConfiguration(rule.configuration, (values) =>
    validateProviderConfigurationV1(rule.configuration, values),
  );
  if (education === undefined || configuration === undefined) {
    return undefined;
  }

  const implementation =
    rule.implementation.status === "not-implemented"
      ? {
          reason: rule.implementation.reason,
          status: "not-implemented" as const,
        }
      : {
          implementationId: rule.implementation.implementationId,
          interfaceVersion: rule.implementation.interfaceVersion,
          status: "implemented" as const,
        };
  const questions = rule.questions
    .map((question) => ({
      answer:
        question.answer.kind === "catalog-default"
          ? { kind: "catalog-default" as const }
          : {
              kind: "required-user-input" as const,
              reason: neutralizeUserFacingText(question.answer.reason),
            },
      explanation: neutralizeUserFacingText(question.explanation),
      id: question.id,
      prompt: neutralizeUserFacingText(question.prompt),
      property: question.property,
    }))
    .sort((left, right) => compareText(left.id, right.id));
  const supportingChanges = rule.supportingChanges
    .map((change) =>
      change.kind === "node"
        ? {
            id: change.id,
            kind: "node" as const,
            ownership: change.ownership,
            purpose: change.purpose,
            serviceType: change.serviceId,
          }
        : {
            id: change.id,
            kind: "edge" as const,
            ownership: change.ownership,
            purpose: change.purpose,
            relationshipType: change.relationshipType,
          },
    )
    .sort((left, right) => compareText(left.id, right.id));
  const iamEffects = rule.iamEffects
    .map((effect) => ({
      actions: [...effect.actions].sort(compareText),
      effect: effect.effect,
      explanation: effect.explanation,
      id: effect.id,
      ...(effect.principal === undefined
        ? {}
        : { principal: effect.principal }),
      resourceScope: effect.resourceScope,
      ...(effect.when === undefined
        ? {}
        : {
            when: {
              equals: effect.when.equals,
              property: effect.when.property,
            },
          }),
    }))
    .sort((left, right) => compareText(left.id, right.id));
  const missingInformation = rule.missingInformationFindings
    .map((finding) => ({
      code: finding.code,
      configurationProperties: [...finding.configurationProperties].sort(
        compareText,
      ),
      guidedMessage: finding.guidedMessage,
      professionalMessage: finding.professionalMessage,
      trigger: finding.trigger,
    }))
    .sort((left, right) => compareText(left.code, right.code));

  return {
    category: rule.category,
    configuration,
    descriptorId: rule.id,
    description: education.summary,
    displayName: education.summary,
    education,
    iamEffects,
    id: rule.relationshipType,
    implementation,
    lifecycle: {
      adoption: rule.lifecycle.adoption,
      deletion: rule.lifecycle.deletion,
      provenance: rule.lifecycle.provenance,
      sharedResource: rule.lifecycle.sharedResource,
    },
    maximumConnectionsPerSource: rule.maximumConnectionsPerSource,
    maximumConnectionsPerTarget: rule.maximumConnectionsPerTarget,
    maximumConnectionsPerEndpointPair: rule.maximumConnectionsPerEndpointPair,
    missingInformation,
    questions,
    ruleVersion: rule.ruleVersion,
    sourcePortId: rule.source.portId,
    sourceServiceType: rule.source.serviceId,
    supportingChanges,
    targetPortId: rule.target.portId,
    targetServiceType: rule.target.serviceId,
    validationRuleIds: [...rule.validationRuleIds].sort(compareText),
  };
}

interface EditorConnectionPresentationProjection {
  readonly groupsByServiceId: ReadonlyMap<
    string,
    readonly EditorConnectionGroup[]
  >;
  readonly relationshipLabelsByRuleId: ReadonlyMap<string, string>;
}

const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function presentationCategory(
  value: unknown,
): EditorConnectionGroupCategory | undefined {
  switch (value) {
    case "triggers":
    case "data":
    case "messaging":
    case "invocation":
    case "identity":
    case "networking":
    case "observability":
    case "other":
      return value;
    default:
      return undefined;
  }
}

function presentationDirection(
  value: unknown,
): EditorConnectionGroup["direction"] | undefined {
  switch (value) {
    case "input-only":
      return "input";
    case "output-only":
      return "output";
    case "mixed":
      return "mixed";
    default:
      return undefined;
  }
}

function parsePresentationDock(
  input: UnknownRecord,
  service: EditorCatalogService,
): EditorConnectionGroup | undefined {
  const cardinality = input["cardinality"];
  const id = nonEmptyString(input["id"]);
  const category = presentationCategory(input["category"]);
  const label = nonEmptyString(input["label"]);
  const description = nonEmptyString(input["description"]);
  const side = input["placement"];
  const order = input["order"];
  const direction = presentationDirection(input["directionPolicy"]);
  const portIds = stringArray(input["portIds"]);
  const allowsMultipleEdges = input["allowsMultipleEdges"];
  const containsExclusiveRelationships =
    input["containsExclusiveRelationships"];
  const guidedAssistance = nonEmptyString(input["guidedExplanation"]);
  const professionalMetadata = nonEmptyString(input["professionalExplanation"]);
  if (
    !isRecord(cardinality) ||
    id === undefined ||
    category === undefined ||
    label === undefined ||
    description === undefined ||
    (side !== "bottom" &&
      side !== "left" &&
      side !== "right" &&
      side !== "top") ||
    typeof order !== "number" ||
    !Number.isSafeInteger(order) ||
    order < 0 ||
    direction === undefined ||
    portIds === undefined ||
    portIds.length === 0 ||
    new Set(portIds).size !== portIds.length ||
    typeof allowsMultipleEdges !== "boolean" ||
    typeof containsExclusiveRelationships !== "boolean" ||
    guidedAssistance === undefined ||
    professionalMetadata === undefined
  ) {
    return undefined;
  }
  const minimum = cardinality["minimum"];
  const maximum = cardinality["maximum"];
  const enforcement = cardinality["enforcement"];
  if (
    (minimum !== 0 && minimum !== 1) ||
    (maximum !== 1 && maximum !== "many") ||
    (enforcement !== "semantic-port" && enforcement !== "provider-rule") ||
    allowsMultipleEdges !== (maximum === "many")
  ) {
    return undefined;
  }
  const ports = portIds.map((portId) =>
    service.ports.find((port) => port.id === portId),
  );
  if (ports.some((port) => port === undefined)) {
    return undefined;
  }

  return {
    allowsMultipleEdges,
    cardinality: { enforcement, maximum, minimum },
    category,
    containsExclusiveRelationships,
    description,
    direction,
    exclusivePortIds: ports.flatMap((port) =>
      port?.cardinality === "one" ? [port.id] : [],
    ),
    guidedAssistance,
    id,
    label,
    order,
    portIds,
    professionalMetadata,
    side,
  };
}

function parseConnectionPresentation(
  source: ProviderConnectionPresentationEditorSource,
  metadata: ReturnType<typeof parseCatalogMetadata>,
  services: readonly EditorCatalogService[],
  relationships: readonly EditorCatalogRelationship[],
): EditorConnectionPresentationProjection | null {
  const artifact = source.artifact;
  if (
    !isRecord(artifact) ||
    artifact["kind"] !== "cloudmarkup.provider-connection-presentation" ||
    artifact["canonicalization"] !==
      "cloudmarkup.provider-connection-presentation.canonical-json.v1" ||
    artifact["contractVersion"] !== 1
  ) {
    return null;
  }
  const catalog = artifact["catalog"];
  const serviceRecords = recordArray(artifact["services"]);
  const relationshipRecords = recordArray(artifact["relationshipLabels"]);
  if (
    !isRecord(catalog) ||
    catalog["id"] !== metadata.catalogId ||
    catalog["version"] !== metadata.catalogVersion ||
    catalog["digest"] !== metadata.digest ||
    typeof artifact["digest"] !== "string" ||
    !SHA256_DIGEST_PATTERN.test(artifact["digest"]) ||
    serviceRecords === undefined ||
    relationshipRecords === undefined
  ) {
    return null;
  }

  const serviceById = new Map(
    services.map((service) => [service.serviceType, service] as const),
  );
  const groupsByServiceId = new Map<string, readonly EditorConnectionGroup[]>();
  for (const record of serviceRecords) {
    const serviceId = nonEmptyString(record["serviceId"]);
    const docks = recordArray(record["docks"]);
    const service =
      serviceId === undefined ? undefined : serviceById.get(serviceId);
    if (
      serviceId === undefined ||
      service === undefined ||
      docks === undefined ||
      groupsByServiceId.has(serviceId)
    ) {
      return null;
    }
    const groups = docks.map((dock) => parsePresentationDock(dock, service));
    if (groups.some((group) => group === undefined)) {
      return null;
    }
    const validated = validateEditorConnectionGroups(
      service.ports,
      groups.filter(
        (group): group is EditorConnectionGroup => group !== undefined,
      ),
    );
    if (validated === null) {
      return null;
    }
    groupsByServiceId.set(serviceId, validated);
  }
  if (services.some((service) => !groupsByServiceId.has(service.serviceType))) {
    return null;
  }

  const relationshipLabelsByRuleId = new Map<string, string>();
  for (const record of relationshipRecords) {
    const ruleId = nonEmptyString(record["ruleId"]);
    const label = nonEmptyString(record["label"]);
    if (
      ruleId === undefined ||
      label === undefined ||
      relationshipLabelsByRuleId.has(ruleId)
    ) {
      return null;
    }
    relationshipLabelsByRuleId.set(ruleId, label);
  }
  const relationshipRuleIds = new Set(
    relationships.map((relationship) => relationship.descriptorId),
  );
  if (
    relationships.some(
      (relationship) =>
        !relationshipLabelsByRuleId.has(relationship.descriptorId),
    ) ||
    [...relationshipLabelsByRuleId.keys()].some(
      (ruleId) => !relationshipRuleIds.has(ruleId),
    )
  ) {
    return null;
  }

  return { groupsByServiceId, relationshipLabelsByRuleId };
}

interface EditorServiceExtensionProjection {
  readonly ownedConfigurationSlots: readonly EditorOwnedConfigurationSlot[];
  readonly targetReadiness: EditorTargetReadiness;
}

function parseServiceExtension(
  source: ProviderServiceExtensionEditorSource,
  metadata: ReturnType<typeof parseCatalogMetadata>,
  services: readonly EditorCatalogService[],
  relationships: readonly EditorCatalogRelationship[],
): ReadonlyMap<string, EditorServiceExtensionProjection> | null {
  const rawArtifact = source.artifact;
  if (
    !isRecord(rawArtifact) ||
    rawArtifact["kind"] !== "cloudmarkup.provider-service-extension" ||
    rawArtifact["canonicalization"] !==
      "cloudmarkup.provider-service-extension.canonical-json.v1"
  ) {
    return null;
  }
  const parsed =
    providerServiceExtensionArtifactV1Schema.safeParse(rawArtifact);
  if (!parsed.success) {
    return null;
  }
  const artifact = parsed.data;
  if (
    artifact.catalog.id !== metadata.catalogId ||
    artifact.catalog.version !== metadata.catalogVersion ||
    artifact.catalog.digest !== metadata.digest
  ) {
    return null;
  }

  const servicesById = new Map<string, EditorCatalogService[]>();
  services.forEach((service) => {
    const current = servicesById.get(service.serviceType) ?? [];
    current.push(service);
    servicesById.set(service.serviceType, current);
  });
  const extensionsByServiceId = new Map<string, typeof artifact.services>();
  artifact.services.forEach((extension) => {
    const serviceId = String(extension.serviceId);
    const current = extensionsByServiceId.get(serviceId) ?? [];
    current.push(extension);
    extensionsByServiceId.set(serviceId, current);
  });
  if (
    servicesById.size !== extensionsByServiceId.size ||
    [...servicesById.entries()].some(
      ([serviceId, candidates]) =>
        candidates.length !== 1 ||
        extensionsByServiceId.get(serviceId)?.length !== 1,
    ) ||
    [...extensionsByServiceId.keys()].some(
      (serviceId) => !servicesById.has(serviceId),
    )
  ) {
    return null;
  }

  const relationshipsByType = new Map<string, EditorCatalogRelationship[]>();
  relationships.forEach((relationship) => {
    const current = relationshipsByType.get(relationship.id) ?? [];
    current.push(relationship);
    relationshipsByType.set(relationship.id, current);
  });
  const seenSlotIds = new Set<string>();
  const projection = new Map<string, EditorServiceExtensionProjection>();
  for (const extension of artifact.services) {
    const ownerServiceId = String(extension.serviceId);
    const owner = servicesById.get(ownerServiceId)?.[0];
    if (owner === undefined) {
      return null;
    }
    const slots: EditorOwnedConfigurationSlot[] = [];
    for (const slot of extension.ownedConfigurationSlots) {
      const slotId = String(slot.id);
      const configurationServiceId = String(
        slot.graphBinding.configurationServiceId,
      );
      const configurationService = servicesById.get(
        configurationServiceId,
      )?.[0];
      const ownershipRelationshipType = String(
        slot.graphBinding.ownershipRelationshipType,
      );
      const candidates =
        relationshipsByType.get(ownershipRelationshipType) ?? [];
      if (
        seenSlotIds.has(slotId) ||
        configurationService === undefined ||
        configurationService.deployable ||
        candidates.length !== 1
      ) {
        return null;
      }
      seenSlotIds.add(slotId);
      const relationship = candidates[0];
      if (relationship === undefined) {
        return null;
      }
      const configurationIsSource =
        relationship.sourceServiceType === configurationServiceId &&
        relationship.targetServiceType === ownerServiceId;
      const configurationIsTarget =
        relationship.targetServiceType === configurationServiceId &&
        relationship.sourceServiceType === ownerServiceId;
      if (configurationIsSource === configurationIsTarget) {
        return null;
      }
      const configurationEndpoint = configurationIsSource
        ? ("source" as const)
        : ("target" as const);
      const configurationPortId = configurationIsSource
        ? relationship.sourcePortId
        : relationship.targetPortId;
      const ownerPortId = configurationIsSource
        ? relationship.targetPortId
        : relationship.sourcePortId;
      if (
        !configurationService.ports.some(
          (port) => port.id === configurationPortId,
        ) ||
        !owner.ports.some((port) => port.id === ownerPortId)
      ) {
        return null;
      }
      slots.push({
        allowedOwnership: [...slot.allowedOwnership],
        cardinality: { ...slot.cardinality },
        configurationKind: String(slot.configurationKind),
        description: neutralizeUserFacingText(slot.description),
        displayName: neutralizeUserFacingText(slot.displayName),
        generatedAdoption: slot.generatedAdoption,
        graphBinding: {
          configurationEndpoint,
          configurationPortId,
          configurationServiceType: configurationServiceId,
          ownerPortId,
          ownershipRelationshipType,
        },
        guidedExplanation: neutralizeUserFacingText(slot.guidedExplanation),
        id: slotId,
        policyKinds: [...slot.policyKinds],
        professionalExplanation: neutralizeUserFacingText(
          slot.professionalExplanation,
        ),
        slotVersion: slot.slotVersion,
        targetReadiness: { ...slot.targetReadiness },
      });
    }
    projection.set(ownerServiceId, {
      ownedConfigurationSlots: slots,
      targetReadiness: { ...extension.targetReadiness },
    });
  }
  return projection;
}

/**
 * Converts the strict provider accessor into a frozen, provider-neutral editor
 * contract. React components never receive provider implementation records.
 */
export function adaptProviderCatalogForEditor(
  source: ProviderCatalogEditorSource,
  presentationSource?: ProviderConnectionPresentationEditorSource,
  serviceExtensionSource?: ProviderServiceExtensionEditorSource,
): EditorCatalog {
  const metadata = parseCatalogMetadata(source);
  let rawServices: readonly unknown[];
  let serviceListState: EditorCatalog["serviceListState"] = { kind: "ready" };
  try {
    rawServices = source.listServices();
  } catch {
    rawServices = [];
    serviceListState = {
      kind: "failed",
      reason:
        "The bundled catalog service list could not be loaded. No service can be added.",
    };
  }
  const parsed = rawServices.map((service, index) =>
    parseService(source, service, index),
  );
  const invalidEntries = parsed.filter(
    (entry): entry is EditorCatalogInvalidEntry => "reason" in entry,
  );
  const candidateServices = parsed.filter(
    (entry): entry is EditorCatalogService => "serviceType" in entry,
  );
  const counts = new Map<string, number>();
  for (const service of candidateServices) {
    counts.set(service.serviceType, (counts.get(service.serviceType) ?? 0) + 1);
  }
  const duplicateOccurrences = new Map<string, number>();
  const services = candidateServices.filter((service) => {
    if (counts.get(service.serviceType) === 1) {
      return true;
    }
    const occurrence = (duplicateOccurrences.get(service.serviceType) ?? 0) + 1;
    duplicateOccurrences.set(service.serviceType, occurrence);
    invalidEntries.push({
      id: `duplicate-catalog-entry-${normalizeSearchPart(service.serviceType).replace(/\s+/gu, "-")}-${String(occurrence).padStart(4, "0")}`,
      reason:
        "This catalog service identity is duplicated and cannot be added safely.",
      title: service.displayName,
    });
    return false;
  });

  let rawRelationships: readonly unknown[] = [];
  try {
    rawRelationships = source.listConnectionRules();
  } catch {
    // Relationship presentation is optional. Invalid relationship metadata
    // cannot make a service addable or crash the catalog.
  }
  const baseRelationships = rawRelationships
    .map(parseRelationship)
    .filter(
      (relationship): relationship is EditorCatalogRelationship =>
        relationship !== undefined,
    )
    .sort((left, right) => compareText(left.id, right.id));

  const actionableEndpoints = new Set(
    baseRelationships.flatMap((relationship) =>
      relationship.implementation.status === "implemented"
        ? [
            `${relationship.sourceServiceType}|${relationship.sourcePortId}`,
            `${relationship.targetServiceType}|${relationship.targetPortId}`,
          ]
        : [],
    ),
  );
  const servicesWithActionablePorts = services.map((service) => ({
    ...service,
    ports: service.ports.map((port) => ({
      ...port,
      connectionSupport: actionableEndpoints.has(
        `${service.serviceType}|${port.id}`,
      )
        ? ("supported" as const)
        : ("unsupported" as const),
    })),
  }));
  const presentationProjection =
    presentationSource === undefined
      ? undefined
      : parseConnectionPresentation(
          presentationSource,
          metadata,
          servicesWithActionablePorts,
          baseRelationships,
        );
  const projectedServices = servicesWithActionablePorts.map((service) => ({
    ...service,
    connectionGroups:
      presentationSource === undefined
        ? deriveEditorConnectionGroups(service.ports)
        : (presentationProjection?.groupsByServiceId.get(service.serviceType) ??
          []),
  }));
  const serviceExtensionProjection =
    serviceExtensionSource === undefined
      ? undefined
      : parseServiceExtension(
          serviceExtensionSource,
          metadata,
          projectedServices,
          baseRelationships,
        );
  const servicesWithExtensions = projectedServices.map((service) => {
    const extension = serviceExtensionProjection?.get(service.serviceType);
    return extension === undefined ? service : { ...service, ...extension };
  });
  const relationships = baseRelationships.map((relationship) => {
    const presentationLabel =
      presentationProjection?.relationshipLabelsByRuleId.get(
        relationship.descriptorId,
      );
    return presentationLabel === undefined
      ? relationship
      : { ...relationship, presentationLabel };
  });

  return deepFreeze({
    catalogDescription: metadata.catalogDescription,
    catalogMaturity: metadata.catalogMaturity,
    identity: {
      digest: metadata.digest,
      id: metadata.catalogId,
      version: metadata.catalogVersion,
    },
    invalidEntries: invalidEntries.sort((left, right) =>
      compareText(left.id, right.id),
    ),
    providerId: metadata.providerId,
    providerName: metadata.providerName,
    relationships,
    serviceListState,
    services: servicesWithExtensions.sort(
      (left, right) =>
        compareText(left.category.id, right.category.id) ||
        compareText(left.displayName, right.displayName) ||
        compareText(left.serviceType, right.serviceType),
    ),
  });
}

export function normalizeCatalogSearchQuery(query: string): string {
  return normalizeSearchPart(query);
}
