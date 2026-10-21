import { createHash } from "node:crypto";

import { serializeCanonicalJson } from "@cloudmarkup/schemas";

import {
  assertAccessorModuleOptions,
  formatPath,
  sortIssues,
} from "./connection-presentation-compiler-v1.js";
import {
  PROVIDER_CATALOG_ARTIFACT_KIND,
  PROVIDER_CATALOG_CANONICALIZATION,
  providerCatalogArtifactV1Schema,
  providerCatalogSourceV1Schema,
  type ProviderCatalogArtifactContentV1,
  type ProviderCatalogArtifactV1,
  type ProviderCatalogSourceV1,
  type ProviderCompilerMappingMetadataV1,
  type ProviderConnectionRuleDescriptorV1,
  type ProviderConfigurationPropertyJsonSchemaV1,
  type ProviderConfigurationUiHintV1,
  type ProviderDocumentationReferenceV1,
  type ProviderEducationalContentV1,
  type ProviderServiceConfigurationV1,
  type ProviderServiceDefinitionV1,
} from "./catalog-contract-v1.js";

type ProviderCatalogSchemaIssue = Extract<
  ReturnType<typeof providerCatalogSourceV1Schema.safeParse>,
  { success: false }
>["error"]["issues"][number];

export type ProviderCatalogValidationIssueCode =
  | "broken-port-reference"
  | "broken-rule-reference"
  | "broken-service-reference"
  | "duplicate-documentation-id"
  | "duplicate-mapping-id"
  | "duplicate-migration-id"
  | "duplicate-port-id"
  | "duplicate-rule-id"
  | "duplicate-service-id"
  | "duplicate-unsupported-capability-id"
  | "invalid-connection-resolution"
  | "invalid-configuration-schema"
  | "invalid-contract"
  | "invalid-migration"
  | "invalid-region-availability"
  | "invalid-ui-hint"
  | "unsupported-mapping-declaration"
  | "unsupported-support-claim";

export interface ProviderCatalogValidationIssue {
  readonly code: ProviderCatalogValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface CompiledProviderCatalogV1 {
  readonly artifact: ProviderCatalogArtifactV1;
  readonly hash: ProviderCatalogArtifactV1["digest"];
  readonly canonicalJson: string;
}

export interface ProviderCatalogAccessorModuleOptions {
  readonly artifactImportPath: string;
  readonly artifactExportName: string;
  readonly accessorsExportName: string;
  readonly digestExportName: string;
}

const issueMessages: Readonly<
  Record<ProviderCatalogValidationIssueCode, string>
> = Object.freeze({
  "broken-port-reference":
    "A catalog declaration references a port that does not exist.",
  "broken-rule-reference":
    "A catalog declaration references a rule that does not exist.",
  "broken-service-reference":
    "A catalog declaration references a service that does not exist.",
  "duplicate-documentation-id":
    "Documentation IDs must be unique within their owning declaration.",
  "duplicate-mapping-id": "Compiler mapping IDs must be unique.",
  "duplicate-migration-id": "Catalog migration IDs must be unique.",
  "duplicate-port-id": "Port IDs must be unique within a service.",
  "duplicate-rule-id":
    "Connection and validation rule IDs must be globally unique.",
  "duplicate-service-id": "Service IDs must be unique within a catalog.",
  "duplicate-unsupported-capability-id":
    "Unsupported capability IDs must be unique within a service.",
  "invalid-connection-resolution":
    "Connection questions, supporting changes, IAM effects, findings, and implementation metadata must be internally consistent.",
  "invalid-configuration-schema":
    "The configuration JSON Schema is inconsistent or unsupported.",
  "invalid-contract": "The provider catalog contract is invalid.",
  "invalid-migration": "The catalog migration declaration is invalid.",
  "invalid-region-availability":
    "Region availability entries must be deterministic and unique.",
  "invalid-ui-hint":
    "A configuration UI hint is inconsistent with its JSON Schema property.",
  "unsupported-mapping-declaration":
    "The compiler mapping declaration is unsupported.",
  "unsupported-support-claim":
    "A service support level exceeds the catalog maturity.",
});

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function compareByString<T>(selector: (value: T) => string) {
  return (left: T, right: T): number =>
    compareStrings(selector(left), selector(right));
}

function structuralIssueCode(
  issue: ProviderCatalogSchemaIssue,
): ProviderCatalogValidationIssueCode {
  const path = issue.path.map(String);
  if (path.includes("mappings")) {
    return "unsupported-mapping-declaration";
  }
  if (path.includes("jsonSchema")) {
    return "invalid-configuration-schema";
  }
  if (path.includes("connectionRules")) {
    return "invalid-connection-resolution";
  }
  if (path.includes("uiHints")) {
    return "invalid-ui-hint";
  }
  if (path.includes("migrations")) {
    return "invalid-migration";
  }
  if (path.includes("regionAvailability")) {
    return "invalid-region-availability";
  }
  return "invalid-contract";
}

function createIssue(
  code: ProviderCatalogValidationIssueCode,
  path: string,
): ProviderCatalogValidationIssue {
  return Object.freeze({ code, path, message: issueMessages[code] });
}

export class ProviderCatalogCompilationError extends Error {
  readonly issues: readonly ProviderCatalogValidationIssue[];

  constructor(issues: readonly ProviderCatalogValidationIssue[]) {
    super("Provider catalog compilation failed.");
    this.name = "ProviderCatalogCompilationError";
    this.issues = Object.freeze(sortIssues(issues));
  }
}

function collectDuplicateIssues<T>(
  values: readonly T[],
  getKey: (value: T) => string,
  getPath: (index: number) => string,
  code: ProviderCatalogValidationIssueCode,
): ProviderCatalogValidationIssue[] {
  const seen = new Set<string>();
  const duplicateKeys = new Set<string>();
  const issues: ProviderCatalogValidationIssue[] = [];

  values.forEach((value, index) => {
    const key = getKey(value);
    if (seen.has(key)) {
      duplicateKeys.add(key);
      issues.push(createIssue(code, getPath(index)));
    } else {
      seen.add(key);
    }
  });

  if (duplicateKeys.size > 0) {
    values.forEach((value, index) => {
      if (duplicateKeys.has(getKey(value))) {
        issues.push(createIssue(code, getPath(index)));
      }
    });
  }

  return issues;
}

function validateDocumentation(
  documentation: readonly ProviderDocumentationReferenceV1[],
  path: string,
): ProviderCatalogValidationIssue[] {
  return collectDuplicateIssues(
    documentation,
    (reference) => reference.id,
    (index) => `${path}[${String(index)}].id`,
    "duplicate-documentation-id",
  );
}

function validateEducation(
  education: ProviderEducationalContentV1,
  path: string,
): ProviderCatalogValidationIssue[] {
  return validateDocumentation(
    education.documentation,
    `${path}.documentation`,
  );
}

function isPropertyDefaultValid(
  property: ProviderConfigurationPropertyJsonSchemaV1,
): boolean {
  if (!("default" in property) || property.default === undefined) {
    return true;
  }
  if (property.type === "string") {
    if (
      (property.enum !== undefined &&
        !property.enum.includes(property.default)) ||
      (property.minLength !== undefined &&
        property.default.length < property.minLength) ||
      (property.maxLength !== undefined &&
        property.default.length > property.maxLength)
    ) {
      return false;
    }
    if (property.pattern !== undefined) {
      try {
        return new RegExp(property.pattern, "u").test(property.default);
      } catch {
        return false;
      }
    }
    return true;
  }
  if (property.type === "number" || property.type === "integer") {
    return (
      (property.type !== "integer" || Number.isInteger(property.default)) &&
      (property.enum === undefined ||
        property.enum.includes(property.default)) &&
      (property.minimum === undefined ||
        property.default >= property.minimum) &&
      (property.maximum === undefined || property.default <= property.maximum)
    );
  }
  if (property.type === "boolean" && property.const !== undefined) {
    return property.default === property.const;
  }
  if (property.type === "array") {
    return (
      property.default.every((item) => {
        if (property.items.type === "string") {
          return (
            typeof item === "string" &&
            (property.items.enum === undefined ||
              property.items.enum.includes(item))
          );
        }
        return (
          typeof item === "number" &&
          (property.items.type !== "integer" || Number.isInteger(item)) &&
          (property.items.enum === undefined ||
            property.items.enum.includes(item))
        );
      }) &&
      (property.minItems === undefined ||
        property.default.length >= property.minItems) &&
      (property.maxItems === undefined ||
        property.default.length <= property.maxItems) &&
      (property.uniqueItems !== true ||
        new Set(property.default).size === property.default.length)
    );
  }
  return true;
}

function isUiControlCompatible(
  property: ProviderConfigurationPropertyJsonSchemaV1,
  control: ProviderConfigurationUiHintV1["control"],
): boolean {
  switch (property.type) {
    case "string":
      return property.enum === undefined
        ? control === "text" || control === "textarea"
        : control === "select";
    case "number":
    case "integer":
      return control === "number";
    case "boolean":
      return control === "checkbox";
    case "array":
      return control === "multi-select";
  }
}

function validateConfiguration(
  configuration: ProviderServiceConfigurationV1,
  ownerPath: string,
): ProviderCatalogValidationIssue[] {
  const issues: ProviderCatalogValidationIssue[] = [];
  const schema = configuration.jsonSchema;
  const properties = schema.properties;
  const expectedSchemaId = `urn:cloudmarkup:configuration:${configuration.schemaId}:${configuration.schemaVersion}`;

  if (schema.$id !== expectedSchemaId) {
    issues.push(
      createIssue(
        "invalid-configuration-schema",
        `${ownerPath}.configuration.jsonSchema.$id`,
      ),
    );
  }

  issues.push(
    ...collectDuplicateIssues(
      schema.required,
      (property) => property,
      (index) =>
        `${ownerPath}.configuration.jsonSchema.required[${String(index)}]`,
      "invalid-configuration-schema",
    ),
  );

  for (const [propertyName, property] of Object.entries(properties)) {
    const propertyPath = `${ownerPath}.configuration.jsonSchema.properties[${JSON.stringify(propertyName)}]`;
    if (
      ("minLength" in property &&
        "maxLength" in property &&
        property.minLength !== undefined &&
        property.maxLength !== undefined &&
        property.minLength > property.maxLength) ||
      ("minimum" in property &&
        "maximum" in property &&
        property.minimum !== undefined &&
        property.maximum !== undefined &&
        property.minimum > property.maximum) ||
      ("minItems" in property &&
        "maxItems" in property &&
        property.minItems !== undefined &&
        property.maxItems !== undefined &&
        property.minItems > property.maxItems) ||
      !isPropertyDefaultValid(property)
    ) {
      issues.push(createIssue("invalid-configuration-schema", propertyPath));
    }

    if (property.type === "string") {
      if (
        property.enum !== undefined &&
        new Set(property.enum).size !== property.enum.length
      ) {
        issues.push(
          createIssue("invalid-configuration-schema", `${propertyPath}.enum`),
        );
      }
      if (property.pattern !== undefined) {
        try {
          new RegExp(property.pattern, "u");
        } catch {
          issues.push(
            createIssue(
              "invalid-configuration-schema",
              `${propertyPath}.pattern`,
            ),
          );
        }
      }
    }
    if (
      (property.type === "number" || property.type === "integer") &&
      property.enum !== undefined &&
      (new Set(property.enum).size !== property.enum.length ||
        (property.type === "integer" &&
          property.enum.some((value) => !Number.isInteger(value))) ||
        property.enum.some(
          (value) =>
            (property.minimum !== undefined && value < property.minimum) ||
            (property.maximum !== undefined && value > property.maximum),
        ))
    ) {
      issues.push(
        createIssue("invalid-configuration-schema", `${propertyPath}.enum`),
      );
    }
    if (
      property.type === "array" &&
      property.items.enum !== undefined &&
      (new Set<unknown>(property.items.enum).size !==
        property.items.enum.length ||
        (property.items.type === "integer" &&
          property.items.enum.some((value) => !Number.isInteger(value))))
    ) {
      issues.push(
        createIssue(
          "invalid-configuration-schema",
          `${propertyPath}.items.enum`,
        ),
      );
    }
  }

  schema.required.forEach((propertyName, index) => {
    if (!Object.hasOwn(properties, propertyName)) {
      issues.push(
        createIssue(
          "invalid-configuration-schema",
          `${ownerPath}.configuration.jsonSchema.required[${String(index)}]`,
        ),
      );
    }
  });

  issues.push(
    ...collectDuplicateIssues(
      configuration.uiHints,
      (hint) => hint.property,
      (index) =>
        `${ownerPath}.configuration.uiHints[${String(index)}].property`,
      "invalid-ui-hint",
    ),
    ...collectDuplicateIssues(
      configuration.uiHints,
      (hint) => String(hint.order),
      (index) => `${ownerPath}.configuration.uiHints[${String(index)}].order`,
      "invalid-ui-hint",
    ),
  );

  configuration.uiHints.forEach((hint, index) => {
    const property = Object.hasOwn(properties, hint.property)
      ? properties[hint.property]
      : undefined;
    if (
      property === undefined ||
      !isUiControlCompatible(property, hint.control) ||
      (hint.valueSource !== "literal" && property.type !== "string") ||
      (hint.valueSource === "secret-reference" &&
        hint.securityImpact !== "secret-reference") ||
      (hint.valueSource !== "secret-reference" &&
        hint.securityImpact === "secret-reference") ||
      (hint.valueSource !== "literal" &&
        "default" in property &&
        property.default !== undefined)
    ) {
      issues.push(
        createIssue(
          "invalid-ui-hint",
          `${ownerPath}.configuration.uiHints[${String(index)}]`,
        ),
      );
    }
  });
  for (const propertyName of Object.keys(properties)) {
    if (!configuration.uiHints.some((hint) => hint.property === propertyName)) {
      issues.push(
        createIssue(
          "invalid-ui-hint",
          `${ownerPath}.configuration.jsonSchema.properties[${JSON.stringify(propertyName)}]`,
        ),
      );
    }
  }

  return issues;
}

function validateMapping(
  service: ProviderServiceDefinitionV1,
  mapping: ProviderCompilerMappingMetadataV1,
  path: string,
  servicesById: ReadonlyMap<string, ProviderServiceDefinitionV1>,
): ProviderCatalogValidationIssue[] {
  const issues: ProviderCatalogValidationIssue[] = [];
  const configurationKeys = new Set(
    Object.keys(service.configuration.jsonSchema.properties),
  );
  const portIds = new Set(service.ports.map((port) => String(port.id)));

  issues.push(
    ...collectDuplicateIssues(
      mapping.configurationBindings,
      (binding) => binding.configurationKey,
      (index) =>
        `${path}.configurationBindings[${String(index)}].configurationKey`,
      "unsupported-mapping-declaration",
    ),
    ...collectDuplicateIssues(
      mapping.configurationBindings,
      (binding) => binding.targetName,
      (index) => `${path}.configurationBindings[${String(index)}].targetName`,
      "unsupported-mapping-declaration",
    ),
    ...collectDuplicateIssues(
      mapping.semanticConfigurationKeys ?? [],
      (configurationKey) => configurationKey,
      (index) => `${path}.semanticConfigurationKeys[${String(index)}]`,
      "unsupported-mapping-declaration",
    ),
    ...collectDuplicateIssues(
      mapping.portBindings,
      (binding) => binding.portId,
      (index) => `${path}.portBindings[${String(index)}].portId`,
      "unsupported-mapping-declaration",
    ),
  );
  const directlyBoundConfigurationKeys = new Set(
    mapping.configurationBindings.map((binding) => binding.configurationKey),
  );

  mapping.configurationBindings.forEach((binding, index) => {
    if (!configurationKeys.has(binding.configurationKey)) {
      issues.push(
        createIssue(
          "unsupported-mapping-declaration",
          `${path}.configurationBindings[${String(index)}].configurationKey`,
        ),
      );
    }
  });
  (mapping.semanticConfigurationKeys ?? []).forEach(
    (configurationKey, index) => {
      if (
        !configurationKeys.has(configurationKey) ||
        directlyBoundConfigurationKeys.has(configurationKey)
      ) {
        issues.push(
          createIssue(
            "unsupported-mapping-declaration",
            `${path}.semanticConfigurationKeys[${String(index)}]`,
          ),
        );
      }
    },
  );
  mapping.portBindings.forEach((binding, index) => {
    if (!portIds.has(binding.portId)) {
      issues.push(
        createIssue(
          "broken-port-reference",
          `${path}.portBindings[${String(index)}].portId`,
        ),
      );
    }
  });

  if (mapping.kind === "nested-block") {
    if (!servicesById.has(mapping.ownerServiceId)) {
      issues.push(
        createIssue("broken-service-reference", `${path}.ownerServiceId`),
      );
    }
    if (
      service.nodeKind.kind !== "resource" ||
      service.nodeKind.deployable ||
      mapping.projection?.kind !== "owner-nested-block"
    ) {
      issues.push(createIssue("unsupported-mapping-declaration", path));
    }
  } else if (mapping.projection?.kind === "owner-nested-block") {
    issues.push(createIssue("unsupported-mapping-declaration", path));
  }

  if (
    service.nodeKind.kind === "resource" &&
    !service.nodeKind.deployable &&
    mapping.implementationStatus === "implemented" &&
    mapping.projection?.kind !== "owned-resource" &&
    mapping.projection?.kind !== "owner-nested-block"
  ) {
    issues.push(createIssue("unsupported-mapping-declaration", path));
  }

  if (
    mapping.projection !== undefined &&
    mapping.projection.kind !== "owner-nested-block" &&
    mapping.kind !== "resource"
  ) {
    issues.push(createIssue("unsupported-mapping-declaration", path));
  }

  return issues;
}

function connectionConditionMatchesProperty(
  property: ProviderConfigurationPropertyJsonSchemaV1,
  value: string | number | boolean,
): boolean {
  if (property.type === "array") {
    return false;
  }
  if (property.type !== typeof value) {
    return property.type === "integer" && typeof value === "number";
  }
  if ("enum" in property && property.enum !== undefined) {
    return (property.enum as readonly unknown[]).includes(value);
  }
  if (
    property.type === "boolean" &&
    property.const !== undefined &&
    value !== property.const
  ) {
    return false;
  }
  return true;
}

function validateConnectionResolution(
  rule: ProviderConnectionRuleDescriptorV1,
  path: string,
  serviceById: ReadonlyMap<string, ProviderServiceDefinitionV1>,
): ProviderCatalogValidationIssue[] {
  const issues: ProviderCatalogValidationIssue[] = [
    ...validateConfiguration(rule.configuration, path),
    ...collectDuplicateIssues(
      rule.questions,
      (question) => question.id,
      (index) => `${path}.questions[${String(index)}].id`,
      "invalid-connection-resolution",
    ),
    ...collectDuplicateIssues(
      rule.questions,
      (question) => question.property,
      (index) => `${path}.questions[${String(index)}].property`,
      "invalid-connection-resolution",
    ),
    ...collectDuplicateIssues(
      rule.supportingChanges,
      (change) => change.id,
      (index) => `${path}.supportingChanges[${String(index)}].id`,
      "invalid-connection-resolution",
    ),
    ...collectDuplicateIssues(
      rule.iamEffects,
      (effect) => effect.id,
      (index) => `${path}.iamEffects[${String(index)}].id`,
      "invalid-connection-resolution",
    ),
    ...collectDuplicateIssues(
      rule.missingInformationFindings,
      (finding) => finding.code,
      (index) => `${path}.missingInformationFindings[${String(index)}].code`,
      "invalid-connection-resolution",
    ),
  ];
  const properties = rule.configuration.jsonSchema.properties;
  const required = new Set(rule.configuration.jsonSchema.required);

  rule.questions.forEach((question, index) => {
    const property = properties[question.property];
    const hasDefault =
      property !== undefined &&
      "default" in property &&
      property.default !== undefined;
    if (
      property === undefined ||
      (question.answer.kind === "catalog-default" && !hasDefault) ||
      (question.answer.kind === "required-user-input" &&
        (!required.has(question.property) || hasDefault))
    ) {
      issues.push(
        createIssue(
          "invalid-connection-resolution",
          `${path}.questions[${String(index)}]`,
        ),
      );
    }
  });

  rule.supportingChanges.forEach((change, index) => {
    if (change.kind === "node" && !serviceById.has(change.serviceId)) {
      issues.push(
        createIssue(
          "broken-service-reference",
          `${path}.supportingChanges[${String(index)}].serviceId`,
        ),
      );
    }
  });

  rule.iamEffects.forEach((effect, index) => {
    if (new Set(effect.actions).size !== effect.actions.length) {
      issues.push(
        createIssue(
          "invalid-connection-resolution",
          `${path}.iamEffects[${String(index)}].actions`,
        ),
      );
    }
    if (effect.when !== undefined) {
      const property = properties[effect.when.property];
      if (
        property === undefined ||
        !connectionConditionMatchesProperty(property, effect.when.equals)
      ) {
        issues.push(
          createIssue(
            "invalid-connection-resolution",
            `${path}.iamEffects[${String(index)}].when`,
          ),
        );
      }
    }
  });

  rule.missingInformationFindings.forEach((finding, index) => {
    if (
      (finding.trigger === "missing-configuration" &&
        finding.configurationProperties.length === 0) ||
      finding.configurationProperties.some(
        (property) => !Object.hasOwn(properties, property),
      )
    ) {
      issues.push(
        createIssue(
          "invalid-connection-resolution",
          `${path}.missingInformationFindings[${String(index)}].configurationProperties`,
        ),
      );
    }
  });

  return issues;
}

function validateSourceSemantics(
  source: ProviderCatalogSourceV1,
): ProviderCatalogValidationIssue[] {
  const issues: ProviderCatalogValidationIssue[] = [];
  const serviceById = new Map(
    source.services.map((service) => [String(service.id), service]),
  );
  const validationById = new Map(
    source.validationRules.map((rule) => [String(rule.id), rule]),
  );

  issues.push(
    ...collectDuplicateIssues(
      source.services,
      (service) => service.id,
      (index) => `$.services[${String(index)}].id`,
      "duplicate-service-id",
    ),
    ...collectDuplicateIssues(
      [...source.connectionRules, ...source.validationRules],
      (rule) => rule.id,
      (index) =>
        index < source.connectionRules.length
          ? `$.connectionRules[${String(index)}].id`
          : `$.validationRules[${String(index - source.connectionRules.length)}].id`,
      "duplicate-rule-id",
    ),
    ...collectDuplicateIssues(
      source.migrations,
      (migration) => migration.id,
      (index) => `$.migrations[${String(index)}].id`,
      "duplicate-migration-id",
    ),
    ...collectDuplicateIssues(
      source.migrations,
      (migration) => migration.fromCatalogVersion,
      (index) => `$.migrations[${String(index)}].fromCatalogVersion`,
      "invalid-migration",
    ),
    ...collectDuplicateIssues(
      source.connectionRules.filter(
        (rule) => rule.implementation.status === "implemented",
      ),
      (rule) =>
        rule.implementation.status === "implemented"
          ? rule.implementation.implementationId
          : rule.id,
      (index) =>
        `$.connectionRules[${String(index)}].implementation.implementationId`,
      "invalid-connection-resolution",
    ),
    ...validateDocumentation(
      source.provider.documentation,
      "$.provider.documentation",
    ),
  );

  source.services.forEach((service, serviceIndex) => {
    const servicePath = `$.services[${String(serviceIndex)}]`;
    issues.push(
      ...collectDuplicateIssues(
        service.ports,
        (port) => port.id,
        (index) => `${servicePath}.ports[${String(index)}].id`,
        "duplicate-port-id",
      ),
      ...collectDuplicateIssues(
        service.validationRuleIds,
        (ruleId) => ruleId,
        (index) => `${servicePath}.validationRuleIds[${String(index)}]`,
        "duplicate-rule-id",
      ),
      ...collectDuplicateIssues(
        service.mappings,
        (mapping) => mapping.mappingId,
        (index) => `${servicePath}.mappings[${String(index)}].mappingId`,
        "duplicate-mapping-id",
      ),
      ...collectDuplicateIssues(
        service.unsupportedCapabilities,
        (capability) => capability.id,
        (index) =>
          `${servicePath}.unsupportedCapabilities[${String(index)}].id`,
        "duplicate-unsupported-capability-id",
      ),
      ...collectDuplicateIssues(
        service.placement.allowedParentTypes,
        (parent) => `${parent.serviceId}\u0000${parent.relationshipType}`,
        (index) =>
          `${servicePath}.placement.allowedParentTypes[${String(index)}]`,
        "broken-service-reference",
      ),
      ...validateConfiguration(service.configuration, servicePath),
      ...validateEducation(service.education, `${servicePath}.education`),
    );

    const maturityRank = {
      proof: 0,
      "production-oriented": 1,
      curated: 2,
    } as const;
    if (
      maturityRank[service.supportLevel] > maturityRank[source.catalog.maturity]
    ) {
      issues.push(
        createIssue("unsupported-support-claim", `${servicePath}.supportLevel`),
      );
    }

    if (
      service.placement.rootPlacement === "required" &&
      service.placement.allowedParentTypes.length > 0
    ) {
      issues.push(
        createIssue(
          "broken-service-reference",
          `${servicePath}.placement.allowedParentTypes`,
        ),
      );
    }
    if (
      service.placement.rootPlacement === "forbidden" &&
      service.placement.allowedParentTypes.length === 0
    ) {
      issues.push(
        createIssue(
          "broken-service-reference",
          `${servicePath}.placement.allowedParentTypes`,
        ),
      );
    }

    service.placement.allowedParentTypes.forEach((parent, index) => {
      if (!serviceById.has(parent.serviceId)) {
        issues.push(
          createIssue(
            "broken-service-reference",
            `${servicePath}.placement.allowedParentTypes[${String(index)}].serviceId`,
          ),
        );
      }
    });

    service.validationRuleIds.forEach((ruleId, index) => {
      if (!validationById.has(ruleId)) {
        issues.push(
          createIssue(
            "broken-rule-reference",
            `${servicePath}.validationRuleIds[${String(index)}]`,
          ),
        );
      }
    });

    service.mappings.forEach((mapping, mappingIndex) => {
      issues.push(
        ...validateMapping(
          service,
          mapping,
          `${servicePath}.mappings[${String(mappingIndex)}]`,
          serviceById,
        ),
      );
    });

    if (service.regionAvailability.state === "known") {
      issues.push(
        ...collectDuplicateIssues(
          service.regionAvailability.regions,
          (region) => region.region,
          (index) =>
            `${servicePath}.regionAvailability.regions[${String(index)}].region`,
          "invalid-region-availability",
        ),
      );
    }
  });

  source.connectionRules.forEach((rule, ruleIndex) => {
    const rulePath = `$.connectionRules[${String(ruleIndex)}]`;
    const sourceService = serviceById.get(rule.source.serviceId);
    const targetService = serviceById.get(rule.target.serviceId);
    issues.push(
      ...collectDuplicateIssues(
        rule.validationRuleIds,
        (ruleId) => ruleId,
        (index) => `${rulePath}.validationRuleIds[${String(index)}]`,
        "duplicate-rule-id",
      ),
      ...validateEducation(rule.education, `${rulePath}.education`),
      ...validateConnectionResolution(rule, rulePath, serviceById),
    );
    if (
      rule.maximumConnectionsPerEndpointPair >
        rule.maximumConnectionsPerSource ||
      rule.maximumConnectionsPerEndpointPair > rule.maximumConnectionsPerTarget
    ) {
      issues.push(
        createIssue(
          "invalid-connection-resolution",
          `${rulePath}.maximumConnectionsPerEndpointPair`,
        ),
      );
    }

    if (sourceService === undefined) {
      issues.push(
        createIssue("broken-service-reference", `${rulePath}.source.serviceId`),
      );
    } else {
      const port = sourceService.ports.find(
        (candidate) => candidate.id === rule.source.portId,
      );
      if (port?.direction !== "output") {
        issues.push(
          createIssue("broken-port-reference", `${rulePath}.source.portId`),
        );
      } else {
        if (port.category !== rule.category) {
          issues.push(
            createIssue(
              "invalid-connection-resolution",
              `${rulePath}.category`,
            ),
          );
        }
        if (
          port.cardinality === "one" &&
          rule.maximumConnectionsPerSource !== 1
        ) {
          issues.push(
            createIssue(
              "invalid-connection-resolution",
              `${rulePath}.maximumConnectionsPerSource`,
            ),
          );
        }
      }
    }

    if (targetService === undefined) {
      issues.push(
        createIssue("broken-service-reference", `${rulePath}.target.serviceId`),
      );
    } else {
      const port = targetService.ports.find(
        (candidate) => candidate.id === rule.target.portId,
      );
      if (port?.direction !== "input") {
        issues.push(
          createIssue("broken-port-reference", `${rulePath}.target.portId`),
        );
      } else {
        if (port.category !== rule.category) {
          issues.push(
            createIssue(
              "invalid-connection-resolution",
              `${rulePath}.category`,
            ),
          );
        }
        if (
          port.cardinality === "one" &&
          rule.maximumConnectionsPerTarget !== 1
        ) {
          issues.push(
            createIssue(
              "invalid-connection-resolution",
              `${rulePath}.maximumConnectionsPerTarget`,
            ),
          );
        }
      }
    }

    rule.validationRuleIds.forEach((ruleId, index) => {
      if (!validationById.has(ruleId)) {
        issues.push(
          createIssue(
            "broken-rule-reference",
            `${rulePath}.validationRuleIds[${String(index)}]`,
          ),
        );
      }
    });
  });

  source.validationRules.forEach((rule, ruleIndex) => {
    const rulePath = `$.validationRules[${String(ruleIndex)}]`;
    issues.push(
      ...collectDuplicateIssues(
        rule.serviceIds,
        (serviceId) => serviceId,
        (index) => `${rulePath}.serviceIds[${String(index)}]`,
        "broken-service-reference",
      ),
      ...validateDocumentation(rule.documentation, `${rulePath}.documentation`),
    );
    rule.serviceIds.forEach((serviceId, index) => {
      const service = serviceById.get(serviceId);
      if (service === undefined) {
        issues.push(
          createIssue(
            "broken-service-reference",
            `${rulePath}.serviceIds[${String(index)}]`,
          ),
        );
      } else if (!service.validationRuleIds.includes(rule.id)) {
        issues.push(
          createIssue(
            "broken-rule-reference",
            `${rulePath}.serviceIds[${String(index)}]`,
          ),
        );
      }
    });
  });

  source.migrations.forEach((migration, migrationIndex) => {
    if (migration.fromCatalogVersion === migration.toCatalogVersion) {
      issues.push(
        createIssue(
          "invalid-migration",
          `$.migrations[${String(migrationIndex)}].toCatalogVersion`,
        ),
      );
    }
  });

  return sortIssues(issues);
}

function normalizeDocumentation(
  documentation: readonly ProviderDocumentationReferenceV1[],
): ProviderDocumentationReferenceV1[] {
  return [...documentation].sort(compareByString((reference) => reference.id));
}

function normalizeEducation(
  education: ProviderEducationalContentV1,
): ProviderEducationalContentV1 {
  return {
    ...education,
    considerations: [...education.considerations].sort(compareStrings),
    documentation: normalizeDocumentation(education.documentation),
  };
}

function normalizeMapping(
  mapping: ProviderCompilerMappingMetadataV1,
): ProviderCompilerMappingMetadataV1 {
  return {
    ...mapping,
    configurationBindings: [...mapping.configurationBindings].sort(
      compareByString(
        (binding) => `${binding.configurationKey}\u0000${binding.targetName}`,
      ),
    ),
    ...(mapping.semanticConfigurationKeys === undefined
      ? {}
      : {
          semanticConfigurationKeys: [
            ...mapping.semanticConfigurationKeys,
          ].sort(compareStrings),
        }),
    portBindings: [...mapping.portBindings].sort(
      compareByString(
        (binding) => `${binding.portId}\u0000${binding.targetAttribute}`,
      ),
    ),
  };
}

function normalizeConfiguration(
  configuration: ProviderServiceConfigurationV1,
): ProviderServiceConfigurationV1 {
  return {
    ...configuration,
    jsonSchema: {
      ...configuration.jsonSchema,
      properties: Object.fromEntries(
        Object.entries(configuration.jsonSchema.properties).sort(
          ([left], [right]) => compareStrings(left, right),
        ),
      ),
      required: [...configuration.jsonSchema.required].sort(compareStrings),
    },
    uiHints: [...configuration.uiHints].sort((left, right) => {
      const order = left.order - right.order;
      return order === 0
        ? compareStrings(left.property, right.property)
        : order;
    }),
  };
}

function normalizeService(
  service: ProviderServiceDefinitionV1,
): ProviderServiceDefinitionV1 {
  return {
    ...service,
    placement: {
      ...service.placement,
      allowedParentTypes: [...service.placement.allowedParentTypes].sort(
        compareByString(
          (parent) => `${parent.serviceId}\u0000${parent.relationshipType}`,
        ),
      ),
    },
    configuration: normalizeConfiguration(service.configuration),
    ports: [...service.ports].sort(compareByString((port) => port.id)),
    validationRuleIds: [...service.validationRuleIds].sort(compareStrings),
    education: normalizeEducation(service.education),
    unsupportedCapabilities: [...service.unsupportedCapabilities].sort(
      compareByString((capability) => capability.id),
    ),
    mappings: [...service.mappings]
      .map(normalizeMapping)
      .sort(compareByString((mapping) => mapping.mappingId)),
    regionAvailability:
      service.regionAvailability.state === "known"
        ? {
            ...service.regionAvailability,
            regions: [...service.regionAvailability.regions].sort(
              compareByString((region) => region.region),
            ),
          }
        : service.regionAvailability,
  };
}

export function validateProviderCatalogSourceV1(
  input: unknown,
): ProviderCatalogSourceV1 {
  const parsed = providerCatalogSourceV1Schema.safeParse(input);
  if (!parsed.success) {
    throw new ProviderCatalogCompilationError(
      parsed.error.issues.map((issue) => {
        const code = structuralIssueCode(issue);
        return createIssue(code, formatPath(issue.path));
      }),
    );
  }

  const semanticIssues = validateSourceSemantics(parsed.data);
  if (semanticIssues.length > 0) {
    throw new ProviderCatalogCompilationError(semanticIssues);
  }

  return {
    ...parsed.data,
    provider: {
      ...parsed.data.provider,
      documentation: normalizeDocumentation(parsed.data.provider.documentation),
    },
    catalog: {
      ...parsed.data.catalog,
      architectureDocumentSchemaVersions: [
        ...parsed.data.catalog.architectureDocumentSchemaVersions,
      ].sort((left, right) => left - right),
    },
    services: [...parsed.data.services]
      .map(normalizeService)
      .sort(compareByString((service) => service.id)),
    connectionRules: [...parsed.data.connectionRules]
      .map((rule) => ({
        ...rule,
        configuration: normalizeConfiguration(rule.configuration),
        questions: [...rule.questions].sort(
          compareByString(
            (question) => `${question.property}\u0000${question.id}`,
          ),
        ),
        supportingChanges: [...rule.supportingChanges].sort(
          compareByString((change) => change.id),
        ),
        iamEffects: [...rule.iamEffects]
          .map((effect) => ({
            ...effect,
            actions: [...effect.actions].sort(compareStrings),
          }))
          .sort(compareByString((effect) => effect.id)),
        missingInformationFindings: [...rule.missingInformationFindings]
          .map((finding) => ({
            ...finding,
            configurationProperties: [...finding.configurationProperties].sort(
              compareStrings,
            ),
          }))
          .sort(compareByString((finding) => finding.code)),
        validationRuleIds: [...rule.validationRuleIds].sort(compareStrings),
        education: normalizeEducation(rule.education),
      }))
      .sort(compareByString((rule) => rule.id)),
    validationRules: [...parsed.data.validationRules]
      .map((rule) => ({
        ...rule,
        serviceIds: [...rule.serviceIds].sort(compareStrings),
        documentation: normalizeDocumentation(rule.documentation),
      }))
      .sort(compareByString((rule) => rule.id)),
    migrations: [...parsed.data.migrations].sort(
      compareByString(
        (migration) =>
          `${migration.fromCatalogVersion}\u0000${migration.toCatalogVersion}\u0000${migration.id}`,
      ),
    ),
  };
}

export function parseVerifiedProviderCatalogArtifactV1(
  input: unknown,
): ProviderCatalogArtifactV1 | undefined {
  const parsed = providerCatalogArtifactV1Schema.safeParse(input);
  if (!parsed.success) {
    return undefined;
  }

  const { digest, ...content } = parsed.data;
  const expectedDigest = `sha256:${createHash("sha256")
    .update(serializeCanonicalJson(content), "utf8")
    .digest("hex")}`;

  return digest === expectedDigest ? parsed.data : undefined;
}

export function compileProviderCatalogV1(
  input: unknown,
): CompiledProviderCatalogV1 {
  const source = validateProviderCatalogSourceV1(input);
  const content: ProviderCatalogArtifactContentV1 = {
    kind: PROVIDER_CATALOG_ARTIFACT_KIND,
    canonicalization: PROVIDER_CATALOG_CANONICALIZATION,
    ...source,
  };
  const contentCanonicalJson = serializeCanonicalJson(content);
  const digest = `sha256:${createHash("sha256")
    .update(contentCanonicalJson, "utf8")
    .digest("hex")}` as ProviderCatalogArtifactV1["digest"];
  const artifact = providerCatalogArtifactV1Schema.parse({
    ...content,
    digest,
  });

  return Object.freeze({
    artifact,
    hash: digest,
    canonicalJson: serializeCanonicalJson(artifact),
  });
}

export function renderProviderCatalogAccessorModuleV1(
  compilation: CompiledProviderCatalogV1,
  options: ProviderCatalogAccessorModuleOptions,
): string {
  assertAccessorModuleOptions(options);

  return `// Generated by @cloudmarkup/provider-sdk. Do not edit by hand.
import {
  createProviderCatalogAccessorsV1,
  providerCatalogArtifactV1Schema,
} from "@cloudmarkup/provider-sdk";

import catalogArtifactJson from ${JSON.stringify(options.artifactImportPath)} with { type: "json" };

export const ${options.digestExportName} = ${JSON.stringify(compilation.hash)} as const;

export const ${options.artifactExportName} =
  providerCatalogArtifactV1Schema.parse(catalogArtifactJson);

export const ${options.accessorsExportName} = createProviderCatalogAccessorsV1(
  ${options.artifactExportName},
);
`;
}

export {
  ProviderConnectionPresentationCompilationError,
  compileProviderConnectionPresentationV1,
  createProviderConnectionPresentationAccessorsV1,
  renderProviderConnectionPresentationAccessorModuleV1,
  validateProviderConnectionPresentationSourceV1,
  type CompiledProviderConnectionPresentationV1,
  type ProviderConnectionPresentationAccessorModuleOptions,
  type ProviderConnectionPresentationAccessorsV1,
  type ProviderConnectionPresentationValidationIssueCode,
  type ProviderConnectionPresentationValidationIssueV1,
} from "./connection-presentation-compiler-v1.js";
export {
  ProviderServiceExtensionCompilationError,
  compileProviderServiceExtensionV1,
  createProviderServiceExtensionAccessorsV1,
  renderProviderServiceExtensionAccessorModuleV1,
  validateProviderServiceExtensionSourceV1,
  type CompiledProviderServiceExtensionV1,
  type ProviderServiceExtensionAccessorModuleOptions,
  type ProviderServiceExtensionAccessorsV1,
  type ProviderServiceExtensionValidationIssueCode,
  type ProviderServiceExtensionValidationIssueV1,
} from "./provider-service-extension-compiler-v1.js";
