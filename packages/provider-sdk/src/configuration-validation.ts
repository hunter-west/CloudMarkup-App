import {
  configurationValueSchema,
  type ConfigurationValue,
} from "@cloudmarkup/schemas";

import type {
  ProviderConfigurationPropertyJsonSchemaV1,
  ProviderConfigurationUiHintV1,
  ProviderServiceConfigurationV1,
  ProviderServiceDefinitionV1,
} from "./catalog-contract-v1.js";

export type ProviderConfigurationValidationIssueCode =
  | "invalid-configuration-record"
  | "invalid-value"
  | "invalid-value-kind"
  | "missing-required-property"
  | "unknown-property";

export interface ProviderConfigurationValidationIssueV1 {
  readonly code: ProviderConfigurationValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export type ProviderValidatedConfigurationV1 = Readonly<
  Record<string, Readonly<ConfigurationValue>>
>;

export type ProviderConfigurationValidationResultV1 =
  | {
      readonly success: true;
      readonly values: ProviderValidatedConfigurationV1;
    }
  | {
      readonly success: false;
      readonly issues: readonly ProviderConfigurationValidationIssueV1[];
    };

const issueMessages: Readonly<
  Record<ProviderConfigurationValidationIssueCode, string>
> = Object.freeze({
  "invalid-configuration-record":
    "Configuration values must be a strict object record.",
  "invalid-value":
    "The configuration value does not satisfy its catalog schema.",
  "invalid-value-kind":
    "The configuration value kind does not match its catalog field.",
  "missing-required-property":
    "A required configuration property is missing and has no default.",
  "unknown-property":
    "The configuration property is not declared by this service.",
});

function issue(
  code: ProviderConfigurationValidationIssueCode,
  path: string,
): ProviderConfigurationValidationIssueV1 {
  return Object.freeze({ code, path, message: issueMessages[code] });
}

function propertyPath(property: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(property)
    ? `$.values.${property}`
    : `$.values[${JSON.stringify(property)}]`;
}

function compareIssues(
  left: ProviderConfigurationValidationIssueV1,
  right: ProviderConfigurationValidationIssueV1,
): number {
  if (left.path !== right.path) {
    return left.path < right.path ? -1 : 1;
  }
  return left.code === right.code ? 0 : left.code < right.code ? -1 : 1;
}

function freezeValue(value: ConfigurationValue): Readonly<ConfigurationValue> {
  if ("value" in value && Array.isArray(value.value)) {
    Object.freeze(value.value);
  }
  return Object.freeze(value);
}

function defaultValue(
  property: ProviderConfigurationPropertyJsonSchemaV1,
): ConfigurationValue | undefined {
  if (!("default" in property) || property.default === undefined) {
    return undefined;
  }
  switch (property.type) {
    case "string":
      return { kind: "string", value: property.default };
    case "number":
      return { kind: "number", value: property.default };
    case "integer":
      return { kind: "integer", value: property.default };
    case "boolean":
      return { kind: "boolean", value: property.default };
    case "array":
      return property.items.type === "string"
        ? { kind: "string-list", value: [...property.default] as string[] }
        : { kind: "number-list", value: [...property.default] as number[] };
  }
}

function valueSource(
  hint: ProviderConfigurationUiHintV1 | undefined,
): ProviderConfigurationUiHintV1["valueSource"] {
  return hint?.valueSource ?? "literal";
}

function matchesReferenceSource(
  source: ProviderConfigurationUiHintV1["valueSource"],
  value: ConfigurationValue,
): boolean {
  switch (source) {
    case "node-reference":
      return value.kind === "node-reference";
    case "secret-reference":
      return value.kind === "secret-reference";
    case "sensitive-variable-reference":
      return value.kind === "variable-reference";
    case "literal":
      return false;
  }
}

function literalValue(
  property: ProviderConfigurationPropertyJsonSchemaV1,
  value: ConfigurationValue,
): string | number | boolean | readonly (string | number)[] | undefined {
  switch (property.type) {
    case "string":
      return value.kind === "string" ? value.value : undefined;
    case "number":
      return value.kind === "number" ? value.value : undefined;
    case "integer":
      return value.kind === "integer" ? value.value : undefined;
    case "boolean":
      return value.kind === "boolean" ? value.value : undefined;
    case "array":
      if (property.items.type === "string") {
        return value.kind === "string-list" ? value.value : undefined;
      }
      return value.kind === "number-list" ? value.value : undefined;
  }
}

function literalSatisfiesSchema(
  property: ProviderConfigurationPropertyJsonSchemaV1,
  value: string | number | boolean | readonly (string | number)[],
): boolean {
  switch (property.type) {
    case "string":
      return (
        typeof value === "string" &&
        (property.enum === undefined || property.enum.includes(value)) &&
        (property.minLength === undefined ||
          value.length >= property.minLength) &&
        (property.maxLength === undefined ||
          value.length <= property.maxLength) &&
        (property.pattern === undefined ||
          (() => {
            try {
              return new RegExp(property.pattern, "u").test(value);
            } catch {
              return false;
            }
          })())
      );
    case "number":
    case "integer":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (property.type !== "integer" || Number.isInteger(value)) &&
        (property.enum === undefined || property.enum.includes(value)) &&
        (property.minimum === undefined || value >= property.minimum) &&
        (property.maximum === undefined || value <= property.maximum)
      );
    case "boolean":
      return (
        typeof value === "boolean" &&
        (property.const === undefined || value === property.const)
      );
    case "array": {
      if (!Array.isArray(value)) {
        return false;
      }
      const itemsValid = value.every((item) => {
        if (property.items.type === "string") {
          return (
            typeof item === "string" &&
            (property.items.enum === undefined ||
              property.items.enum.includes(item))
          );
        }
        return (
          typeof item === "number" &&
          Number.isFinite(item) &&
          (property.items.type !== "integer" || Number.isInteger(item)) &&
          (property.items.enum === undefined ||
            property.items.enum.includes(item))
        );
      });
      return (
        itemsValid &&
        (property.minItems === undefined ||
          value.length >= property.minItems) &&
        (property.maxItems === undefined ||
          value.length <= property.maxItems) &&
        (property.uniqueItems !== true || new Set(value).size === value.length)
      );
    }
  }
}

export function validateProviderConfigurationV1(
  configuration: Readonly<ProviderServiceConfigurationV1>,
  valuesInput: unknown,
): ProviderConfigurationValidationResultV1 {
  if (
    typeof valuesInput !== "object" ||
    valuesInput === null ||
    Array.isArray(valuesInput)
  ) {
    return Object.freeze({
      success: false,
      issues: Object.freeze([
        issue("invalid-configuration-record", "$.values"),
      ]),
    });
  }

  const values = valuesInput as Record<string, unknown>;
  const properties: Readonly<
    Record<string, ProviderConfigurationPropertyJsonSchemaV1>
  > = configuration.jsonSchema.properties;
  const required = new Set<string>(configuration.jsonSchema.required);
  const hints = new Map<string, ProviderConfigurationUiHintV1>(
    configuration.uiHints.map((hint) => [hint.property, hint]),
  );
  const issues: ProviderConfigurationValidationIssueV1[] = [];
  const normalized: Record<string, Readonly<ConfigurationValue>> = {};

  for (const key of Object.keys(values).sort()) {
    if (!Object.hasOwn(properties, key)) {
      issues.push(issue("unknown-property", propertyPath(key)));
    }
  }

  for (const key of Object.keys(properties).sort()) {
    const property = properties[key];
    if (property === undefined) {
      continue;
    }
    const path = propertyPath(key);
    const candidate = values[key];
    if (candidate === undefined) {
      const fallback = defaultValue(property);
      if (fallback !== undefined) {
        normalized[key] = freezeValue(fallback);
      } else if (required.has(key)) {
        issues.push(issue("missing-required-property", path));
      }
      continue;
    }

    const parsed = configurationValueSchema.safeParse(candidate);
    if (!parsed.success) {
      issues.push(issue("invalid-value-kind", path));
      continue;
    }

    const source = valueSource(hints.get(key));
    if (source !== "literal") {
      if (matchesReferenceSource(source, parsed.data)) {
        normalized[key] = freezeValue(parsed.data);
      } else {
        issues.push(issue("invalid-value-kind", path));
      }
      continue;
    }

    const literal = literalValue(property, parsed.data);
    if (literal === undefined) {
      issues.push(issue("invalid-value-kind", path));
    } else if (!literalSatisfiesSchema(property, literal)) {
      issues.push(issue("invalid-value", path));
    } else {
      normalized[key] = freezeValue(parsed.data);
    }
  }

  if (issues.length > 0) {
    return Object.freeze({
      success: false,
      issues: Object.freeze(issues.sort(compareIssues)),
    });
  }

  return Object.freeze({
    success: true,
    values: Object.freeze(normalized),
  });
}

export function validateProviderServiceConfigurationV1(
  service: Readonly<ProviderServiceDefinitionV1>,
  valuesInput: unknown,
): ProviderConfigurationValidationResultV1 {
  return validateProviderConfigurationV1(service.configuration, valuesInput);
}
