import type { ArchitectureDocument } from "@cloudmarkup/domain";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import type { FieldErrors } from "react-hook-form";

import { isCredentialLiteralProperty } from "../model/configuration-command.js";
import type {
  EditorCatalogConfigurationField,
  EditorCatalogConfigurationValidationIssue,
} from "../model/editor-catalog.js";
import type { SelectedResourceInspectorModel } from "./selected-resource-model.js";

export type ConfigurationFormScalar = boolean | string | readonly string[];
export type MutableConfigurationFormValues = Record<
  string,
  boolean | string | string[]
>;

export function fieldErrorMessage(
  errors: FieldErrors<MutableConfigurationFormValues>,
  property: string,
): string | undefined {
  const message = errors[property]?.message;
  return typeof message === "string" ? message : undefined;
}
export type ConfigurationFormValues = Readonly<
  Record<string, ConfigurationFormScalar>
>;

export interface ConfigurationFormFieldModel {
  readonly compatibleVariables: ArchitectureDocument["variables"];
  readonly editable: boolean;
  readonly field: EditorCatalogConfigurationField;
  readonly inputId: string;
  readonly reason?: string;
}

export interface ConfigurationFormModel {
  readonly advancedFields: readonly ConfigurationFormFieldModel[];
  readonly currentValues: Readonly<
    Record<string, Readonly<ConfigurationValue>>
  >;
  readonly document: ArchitectureDocument;
  readonly fields: readonly ConfigurationFormFieldModel[];
  readonly initialValues: ConfigurationFormValues;
  readonly recommendedFields: readonly ConfigurationFormFieldModel[];
  readonly selected: ConfigurationFormSubject;
}

export type ConfigurationFormSubject = Pick<
  SelectedResourceInspectorModel,
  "configuration"
> & {
  readonly currentConfiguration: Pick<
    SelectedResourceInspectorModel["currentConfiguration"],
    "values"
  >;
  readonly target:
    | SelectedResourceInspectorModel["target"]
    | { readonly kind: "creation"; readonly id: string };
};

export interface ConfigurationFormIssue {
  readonly message: string;
  readonly path: string;
  readonly property?: string;
}

export type ConfigurationFormConversion =
  | {
      readonly edits: Readonly<
        Record<string, Readonly<ConfigurationValue> | undefined>
      >;
      readonly success: true;
    }
  | {
      readonly issues: readonly ConfigurationFormIssue[];
      readonly success: false;
    };

function valueAt(
  values: unknown,
  property: string,
): Readonly<ConfigurationValue> | undefined {
  return (values as Readonly<Record<string, Readonly<ConfigurationValue>>>)[
    property
  ];
}

export function isCredentialConfigurationField(
  field: EditorCatalogConfigurationField,
): boolean {
  return (
    field.valueSource === "literal" &&
    field.schema.kind === "string" &&
    isCredentialLiteralProperty(field.property, { kind: "string", value: "" })
  );
}

function fieldEditability(
  field: EditorCatalogConfigurationField,
): Pick<ConfigurationFormFieldModel, "editable" | "reason"> {
  if (isCredentialConfigurationField(field)) {
    return {
      editable: false,
      reason:
        "Literal cloud credentials are not accepted. Use a catalog-supported sensitive variable or secret reference.",
    };
  }
  if (field.valueSource === "secret-reference") {
    return {
      editable: false,
      reason:
        "Secret values and opaque secret identifiers are never exposed by this editor foundation.",
    };
  }
  if (field.valueSource === "node-reference") {
    return {
      editable: false,
      reason:
        "This catalog version does not declare safe node and attribute choices for this reference.",
    };
  }
  if (
    field.schema.kind === "boolean" &&
    field.schema.const !== undefined &&
    field.schema.default !== undefined
  ) {
    return {
      editable: false,
      reason: `The catalog fixes this value to ${String(field.schema.const)}.`,
    };
  }
  return { editable: true };
}

function safeInitialValue(
  field: EditorCatalogConfigurationField,
  value: Readonly<ConfigurationValue> | undefined,
): ConfigurationFormScalar {
  if (
    isCredentialConfigurationField(field) ||
    field.valueSource === "secret-reference"
  ) {
    return value === undefined ? "" : "Configured (value hidden)";
  }
  if (field.valueSource === "node-reference") {
    return value?.kind === "node-reference"
      ? `${value.nodeId} · ${value.attribute}`
      : "";
  }
  if (field.valueSource === "sensitive-variable-reference") {
    return value?.kind === "variable-reference" ? value.variableId : "";
  }

  switch (field.schema.kind) {
    case "string":
      return value?.kind === "string"
        ? value.value
        : (field.schema.default ?? "");
    case "number":
    case "integer":
      return value?.kind === field.schema.kind
        ? String(value.value)
        : field.schema.default === undefined
          ? ""
          : String(field.schema.default);
    case "boolean":
      if (value?.kind === "boolean") {
        return field.control === "checkbox" || field.required
          ? value.value
          : String(value.value);
      }
      if (field.schema.default !== undefined) {
        return field.control === "checkbox" || field.required
          ? field.schema.default
          : String(field.schema.default);
      }
      return "";
    case "string-list":
      if (value?.kind === "string-list") {
        return field.control === "multi-select"
          ? value.value
          : value.value.join("\n");
      }
      return field.schema.default === undefined
        ? field.control === "multi-select"
          ? []
          : ""
        : field.control === "multi-select"
          ? field.schema.default
          : field.schema.default.join("\n");
    case "number-list":
    case "integer-list":
      if (value?.kind === "number-list") {
        return value.value.map(String).join("\n");
      }
      return field.schema.default?.map(String).join("\n") ?? "";
  }
}

function compatibleVariableValueType(
  field: EditorCatalogConfigurationField,
): ArchitectureDocument["variables"][number]["valueType"] {
  switch (field.schema.kind) {
    case "string":
    case "number":
    case "integer":
    case "boolean":
    case "string-list":
    case "number-list":
      return field.schema.kind;
    case "integer-list":
      return "number-list";
  }
}

export function createConfigurationFormModel(
  document: ArchitectureDocument,
  selected: ConfigurationFormSubject,
): ConfigurationFormModel {
  const currentValues = selected.currentConfiguration.values as Readonly<
    Record<string, Readonly<ConfigurationValue>>
  >;
  const fields = selected.configuration.fields.map((field) => {
    const editability = fieldEditability(field);
    return {
      ...editability,
      compatibleVariables:
        field.valueSource === "sensitive-variable-reference"
          ? document.variables.filter(
              (variable) =>
                variable.valueType === compatibleVariableValueType(field),
            )
          : [],
      field,
      inputId: `inspector-configuration-${selected.target.kind}-${selected.target.id}-${field.property}`,
    };
  });
  const initialValues = Object.fromEntries(
    fields.map(({ field }) => [
      field.property,
      safeInitialValue(field, valueAt(currentValues, field.property)),
    ]),
  );

  return {
    advancedFields: fields.filter(({ field }) => field.advanced),
    currentValues,
    document,
    fields,
    initialValues,
    recommendedFields: fields.filter(({ field }) => !field.advanced),
    selected,
  };
}

function issue(property: string, message: string): ConfigurationFormIssue {
  return {
    message,
    path: `$.values.${property}`,
    property,
  };
}

function splitList(value: ConfigurationFormScalar | undefined): string[] {
  if (value === undefined || typeof value === "boolean") {
    return [];
  }
  return typeof value === "string"
    ? value
        .split(/\r?\n/u)
        .map((item) => item.trim())
        .filter(Boolean)
    : value.slice();
}

function literalValue(
  field: EditorCatalogConfigurationField,
  raw: ConfigurationFormScalar | undefined,
): Readonly<ConfigurationValue> | undefined | ConfigurationFormIssue {
  switch (field.schema.kind) {
    case "string": {
      const value = typeof raw === "string" ? raw : "";
      return !field.required && value.trim() === ""
        ? undefined
        : { kind: "string", value };
    }
    case "number":
    case "integer": {
      const source = typeof raw === "string" ? raw.trim() : "";
      if (source === "") {
        return field.required
          ? issue(field.property, "Enter a number.")
          : undefined;
      }
      const value = Number(source);
      if (!Number.isFinite(value)) {
        return issue(field.property, "Enter a finite number.");
      }
      if (field.schema.kind === "integer" && !Number.isInteger(value)) {
        return issue(field.property, "Enter a whole number.");
      }
      return { kind: field.schema.kind, value };
    }
    case "boolean": {
      if (typeof raw === "boolean") {
        return { kind: "boolean", value: raw };
      }
      if (raw === "true" || raw === "false") {
        return { kind: "boolean", value: raw === "true" };
      }
      return field.required
        ? issue(field.property, "Choose true or false.")
        : undefined;
    }
    case "string-list": {
      const values = splitList(raw);
      return !field.required && values.length === 0
        ? undefined
        : { kind: "string-list", value: values };
    }
    case "number-list":
    case "integer-list": {
      const items = splitList(raw);
      if (!field.required && items.length === 0) {
        return undefined;
      }
      const values = items.map(Number);
      if (values.some((value) => !Number.isFinite(value))) {
        return issue(field.property, "Enter one finite number per line.");
      }
      if (
        field.schema.kind === "integer-list" &&
        values.some((value) => !Number.isInteger(value))
      ) {
        return issue(field.property, "Enter one whole number per line.");
      }
      return { kind: "number-list", value: values };
    }
  }
}

function validationIssues(
  issues: readonly EditorCatalogConfigurationValidationIssue[],
): readonly ConfigurationFormIssue[] {
  return issues.map((validationIssue) => ({
    message: validationIssue.message,
    path: validationIssue.path,
    ...(validationIssue.property === undefined
      ? {}
      : { property: validationIssue.property }),
  }));
}

export function convertConfigurationFormValues(
  model: ConfigurationFormModel,
  values: ConfigurationFormValues,
): ConfigurationFormConversion {
  const edits: Record<string, Readonly<ConfigurationValue> | undefined> = {};
  const issues: ConfigurationFormIssue[] = [];

  for (const { compatibleVariables, editable, field } of model.fields) {
    const current = valueAt(model.currentValues, field.property);
    if (isCredentialConfigurationField(field)) {
      issues.push(
        issue(
          field.property,
          current === undefined
            ? "Literal cloud credentials cannot be configured here."
            : "This literal credential must be replaced by a supported reference before saving.",
        ),
      );
      continue;
    }
    if (!editable) {
      edits[field.property] = current;
      continue;
    }
    if (field.valueSource === "sensitive-variable-reference") {
      const rawValue = values[field.property];
      const variableId = typeof rawValue === "string" ? rawValue.trim() : "";
      if (variableId === "") {
        if (field.required) {
          issues.push(
            issue(
              field.property,
              "Choose a deployment-time sensitive variable.",
            ),
          );
        } else {
          edits[field.property] = undefined;
        }
        continue;
      }
      const variable = model.document.variables.find(
        (candidate) => candidate.id === variableId,
      );
      if (variable === undefined) {
        issues.push(
          issue(
            field.property,
            "Choose a variable declared by this Architecture Document.",
          ),
        );
        continue;
      }
      if (
        !compatibleVariables.some((candidate) => candidate.id === variable.id)
      ) {
        issues.push(
          issue(
            field.property,
            `Choose a variable whose ${compatibleVariableValueType(field)} value type matches this field.`,
          ),
        );
        continue;
      }
      edits[field.property] = {
        kind: "variable-reference",
        variableId: variable.id,
      };
      continue;
    }

    const converted = literalValue(field, values[field.property]);
    if (
      converted !== undefined &&
      "message" in converted &&
      "path" in converted
    ) {
      issues.push(converted);
    } else {
      edits[field.property] = converted;
    }
  }

  if (issues.length > 0) {
    return { issues, success: false };
  }

  const knownProperties = new Set(
    model.fields.map(({ field }) => field.property),
  );
  let candidate: Record<
    string,
    Readonly<ConfigurationValue>
  > = Object.fromEntries(
    Object.entries(model.currentValues).filter(([property]) =>
      knownProperties.has(property),
    ),
  );
  for (const [property, value] of Object.entries(edits)) {
    if (value === undefined) {
      candidate = Object.fromEntries(
        Object.entries(candidate).filter(
          ([candidateProperty]) => candidateProperty !== property,
        ),
      );
    } else {
      candidate[property] = value;
    }
  }
  const validation = model.selected.configuration.validate(candidate);
  if (!validation.success) {
    return {
      issues: validationIssues(validation.issues),
      success: false,
    };
  }

  return { edits, success: true };
}
