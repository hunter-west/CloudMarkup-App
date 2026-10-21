import {
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  configurationValueSchema,
  type ConfigurationValue,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { serviceCreationDefaults } from "../model/placement-rules.js";
import { loadAwsEditorArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import type {
  EditorCatalog,
  EditorCatalogConfigurationField,
} from "../model/editor-catalog.js";
import {
  convertConfigurationFormValues,
  createConfigurationFormModel,
} from "./configuration-form-model.js";
import {
  resolveSelectedResourceInspectorModel,
  type SelectedNodeInspectorModel,
} from "./selected-resource-model.js";

function lambdaNode(document: ArchitectureDocument) {
  const node = document.nodes.find(
    (candidate) => candidate.semantic.serviceType === "aws.lambda.function",
  );
  if (node === undefined) {
    throw new TypeError("Expected the deterministic Lambda fixture node.");
  }
  return node;
}

function valueAt(
  values: unknown,
  property: string,
): Readonly<ConfigurationValue> | undefined {
  return (values as Readonly<Record<string, Readonly<ConfigurationValue>>>)[
    property
  ];
}

function lambdaInspectorModel(
  document: ArchitectureDocument,
  catalog: EditorCatalog = awsEditorCatalog,
): SelectedNodeInspectorModel {
  const resolution = resolveSelectedResourceInspectorModel(document, catalog, {
    id: lambdaNode(document).id,
    kind: "node",
  });
  if (resolution.kind !== "ready" || resolution.model.kind !== "node") {
    throw new TypeError("Expected an editable Lambda inspector model.");
  }
  return resolution.model;
}

function extendLambdaCatalog(
  field: EditorCatalogConfigurationField,
): EditorCatalog {
  return {
    ...awsEditorCatalog,
    services: awsEditorCatalog.services.map((service) =>
      service.serviceType === "aws.lambda.function"
        ? {
            ...service,
            configuration: {
              ...service.configuration,
              fields: [...service.configuration.fields, field],
              validate: (values: unknown) => ({
                success: true as const,
                values: values as Readonly<
                  Record<string, Readonly<ConfigurationValue>>
                >,
              }),
            },
          }
        : service,
    ),
  };
}

function withLambdaValue(
  document: ArchitectureDocument,
  property: string,
  value: Readonly<ConfigurationValue>,
): ArchitectureDocument {
  const lambda = lambdaNode(document);
  return parseArchitectureDocument({
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === lambda.id
        ? {
            ...node,
            semantic: {
              ...node.semantic,
              configuration: {
                ...node.semantic.configuration,
                values: {
                  ...node.semantic.configuration.values,
                  [property]: value,
                },
              },
            },
          }
        : node,
    ),
  });
}

describe("selected-resource configuration form model", () => {
  it.each([
    [
      "aws.route53.public-hosted-zone",
      "domainControlAttested",
      { domainName: "example.test", comment: "Synthetic owned domain" },
    ],
    [
      "aws.cloudfront.distribution",
      "publicContentAttested",
      {
        enabled: true,
        comment: "Synthetic public content",
        defaultRootObject: "index.html",
        priceClass: "PriceClass_100",
      },
    ],
  ] as const)(
    "requires an explicit attestation when creating %s",
    (serviceType, property, entered) => {
      const document = loadAwsEditorArchitectureDocument();
      const service = awsEditorCatalog.services.find(
        (candidate) => candidate.serviceType === serviceType,
      );
      if (service === undefined) throw new Error("Missing attestation service");
      const defaults = serviceCreationDefaults(document, service);
      expect(defaults[property]).toBeUndefined();
      const model = createConfigurationFormModel(document, {
        configuration: service.configuration,
        currentConfiguration: { values: defaults },
        target: { kind: "creation", id: serviceType },
      });
      expect(
        model.fields.find(({ field }) => field.property === property)?.editable,
      ).toBe(true);
      const unconfirmed = convertConfigurationFormValues(model, {
        ...model.initialValues,
        ...entered,
      });
      expect(unconfirmed.success).toBe(false);
      const rejected = convertConfigurationFormValues(model, {
        ...model.initialValues,
        ...entered,
        [property]: false,
      });
      expect(rejected.success).toBe(false);
      const confirmed = convertConfigurationFormValues(model, {
        ...model.initialValues,
        ...entered,
        [property]: true,
      });
      expect(confirmed.success).toBe(true);
      if (confirmed.success)
        expect(confirmed.edits[property]).toEqual({
          kind: "boolean",
          value: true,
        });
    },
  );

  it("derives ordered fields, advanced grouping, and defaults from the bound schema", () => {
    const document = loadAwsEditorArchitectureDocument();
    const model = createConfigurationFormModel(
      document,
      lambdaInspectorModel(document),
    );

    expect(model.fields.map(({ field }) => field.property)).toEqual([
      "functionName",
      "runtime",
      "architecture",
      "handler",
      "timeoutSeconds",
      "memoryMegabytes",
      "tracingEnabled",
      "reservedConcurrency",
    ]);
    expect(model.recommendedFields.map(({ field }) => field.property)).toEqual([
      "functionName",
      "runtime",
      "timeoutSeconds",
      "memoryMegabytes",
    ]);
    expect(model.advancedFields.map(({ field }) => field.property)).toEqual([
      "architecture",
      "handler",
      "tracingEnabled",
      "reservedConcurrency",
    ]);
    expect(model.initialValues).toMatchObject({
      functionName: "notes-api-handler",
      memoryMegabytes: "256",
      runtime: "nodejs24.x",
      timeoutSeconds: "10",
      tracingEnabled: true,
    });
  });

  it("returns field-addressable catalog validation errors for invalid values", () => {
    const document = loadAwsEditorArchitectureDocument();
    const model = createConfigurationFormModel(
      document,
      lambdaInspectorModel(document),
    );
    const result = convertConfigurationFormValues(model, {
      ...model.initialValues,
      timeoutSeconds: "0",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.issues.some(
          (validationIssue) =>
            validationIssue.path === "$.values.timeoutSeconds" &&
            validationIssue.property === "timeoutSeconds",
        ),
      ).toBe(true);
    }
  });

  it("keeps unknown future values in preservation context without making them editable", () => {
    const document = withLambdaValue(
      loadAwsEditorArchitectureDocument(),
      "futureSupportedField",
      { kind: "string", value: "preserve-me" },
    );
    const model = createConfigurationFormModel(
      document,
      lambdaInspectorModel(document),
    );
    const result = convertConfigurationFormValues(model, {
      ...model.initialValues,
      memoryMegabytes: "512",
    });

    expect(model.currentValues["futureSupportedField"]).toEqual({
      kind: "string",
      value: "preserve-me",
    });
    expect(
      model.fields.some(
        ({ field }) => field.property === "futureSupportedField",
      ),
    ).toBe(false);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.edits).not.toHaveProperty("futureSupportedField");
      expect(result.edits["memoryMegabytes"]).toEqual({
        kind: "integer",
        value: 512,
      });
    }
    expect(
      valueAt(
        lambdaNode(document).semantic.configuration.values,
        "futureSupportedField",
      ),
    ).toEqual({ kind: "string", value: "preserve-me" });
  });

  it("converts only a declared deployment-time variable into a tagged sensitive reference", () => {
    const sensitiveField: EditorCatalogConfigurationField = {
      advanced: true,
      control: "select",
      costImpact: "none",
      label: "Signing variable",
      order: 999,
      property: "signingVariable",
      required: true,
      schema: { kind: "string" },
      securityImpact: "security-sensitive",
      valueSource: "sensitive-variable-reference",
    };
    const catalog = extendLambdaCatalog(sensitiveField);
    const base = loadAwsEditorArchitectureDocument();
    const document = parseArchitectureDocument({
      ...base,
      variables: [
        {
          description: "Deployment-time signing key.",
          id: "variable_signing_key",
          key: "signing_key",
          required: true,
          valueType: "string",
        },
        {
          description: "A deliberately incompatible numeric value.",
          id: "variable_retry_count",
          key: "retry_count",
          required: true,
          valueType: "integer",
        },
      ],
    });
    const model = createConfigurationFormModel(
      document,
      lambdaInspectorModel(document, catalog),
    );
    const signingField = model.fields.find(
      ({ field }) => field.property === "signingVariable",
    );
    expect(
      signingField?.compatibleVariables.map((variable) => variable.id),
    ).toEqual(["variable_signing_key"]);

    const valid = convertConfigurationFormValues(model, {
      ...model.initialValues,
      signingVariable: "variable_signing_key",
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.edits["signingVariable"]).toEqual({
        kind: "variable-reference",
        variableId: "variable_signing_key",
      });
    }

    const invalid = convertConfigurationFormValues(model, {
      ...model.initialValues,
      signingVariable: "variable_not_declared",
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.issues).toHaveLength(1);
      expect(invalid.issues[0]).toMatchObject({
        message: "Choose a variable declared by this Architecture Document.",
        property: "signingVariable",
      });
    }

    const incompatible = convertConfigurationFormValues(model, {
      ...model.initialValues,
      signingVariable: "variable_retry_count",
    });
    expect(incompatible.success).toBe(false);
    if (!incompatible.success) {
      expect(incompatible.issues[0]).toMatchObject({
        message:
          "Choose a variable whose string value type matches this field.",
        property: "signingVariable",
      });
    }
  });

  it("converts list controls deterministically and rejects non-integer list entries", () => {
    const base = loadAwsEditorArchitectureDocument();
    const stringListField: EditorCatalogConfigurationField = {
      advanced: true,
      control: "textarea",
      costImpact: "none",
      label: "Allowed origins",
      order: 999,
      property: "allowedOrigins",
      required: true,
      schema: {
        kind: "string-list",
        uniqueItems: true,
      },
      securityImpact: "none",
      valueSource: "literal",
    };
    const stringModel = createConfigurationFormModel(
      base,
      lambdaInspectorModel(base, extendLambdaCatalog(stringListField)),
    );
    const strings = convertConfigurationFormValues(stringModel, {
      ...stringModel.initialValues,
      allowedOrigins: "https://one.example\n\n https://two.example ",
    });
    expect(strings.success).toBe(true);
    if (strings.success) {
      expect(strings.edits["allowedOrigins"]).toEqual({
        kind: "string-list",
        value: ["https://one.example", "https://two.example"],
      });
    }

    const integerListField: EditorCatalogConfigurationField = {
      advanced: true,
      control: "textarea",
      costImpact: "none",
      label: "Retry schedule",
      order: 999,
      property: "retrySchedule",
      required: true,
      schema: {
        kind: "integer-list",
        uniqueItems: false,
      },
      securityImpact: "none",
      valueSource: "literal",
    };
    const integerModel = createConfigurationFormModel(
      base,
      lambdaInspectorModel(base, extendLambdaCatalog(integerListField)),
    );
    const integers = convertConfigurationFormValues(integerModel, {
      ...integerModel.initialValues,
      retrySchedule: "1\n2.5",
    });
    expect(integers.success).toBe(false);
    if (!integers.success) {
      expect(integers.issues[0]).toMatchObject({
        message: "Enter one whole number per line.",
        property: "retrySchedule",
      });
    }
  });

  it("keeps node and secret references read-only without exposing secret identifiers", () => {
    const base = loadAwsEditorArchitectureDocument();
    const nodeReferenceField: EditorCatalogConfigurationField = {
      advanced: true,
      control: "select",
      costImpact: "none",
      label: "Source resource",
      order: 999,
      property: "sourceResource",
      required: true,
      schema: { kind: "string" },
      securityImpact: "none",
      valueSource: "node-reference",
    };
    const nodeDocument = withLambdaValue(
      base,
      "sourceResource",
      configurationValueSchema.parse({
        attribute: "aws.resource.arn",
        kind: "node-reference",
        nodeId: "node_notes_table",
      }),
    );
    const nodeModel = createConfigurationFormModel(
      nodeDocument,
      lambdaInspectorModel(
        nodeDocument,
        extendLambdaCatalog(nodeReferenceField),
      ),
    );
    expect(nodeModel.initialValues["sourceResource"]).toBe(
      "node_notes_table · aws.resource.arn",
    );
    expect(
      nodeModel.fields.find(({ field }) => field.property === "sourceResource")
        ?.editable,
    ).toBe(false);

    const secretReferenceField: EditorCatalogConfigurationField = {
      advanced: true,
      control: "select",
      costImpact: "none",
      label: "Signing secret",
      order: 999,
      property: "signingSecret",
      required: true,
      schema: { kind: "string" },
      securityImpact: "secret-reference",
      valueSource: "secret-reference",
    };
    const secretDocument = withLambdaValue(
      base,
      "signingSecret",
      configurationValueSchema.parse({
        kind: "secret-reference",
        reference: "secret_ref_fixture",
      }),
    );
    const secretModel = createConfigurationFormModel(
      secretDocument,
      lambdaInspectorModel(
        secretDocument,
        extendLambdaCatalog(secretReferenceField),
      ),
    );
    expect(secretModel.initialValues["signingSecret"]).toBe(
      "Configured (value hidden)",
    );
    expect(JSON.stringify(secretModel.initialValues)).not.toContain(
      "secret_ref_fixture",
    );
  });

  it("does not invent false for a missing required boolean", () => {
    const requiredBoolean: EditorCatalogConfigurationField = {
      advanced: false,
      control: "checkbox",
      costImpact: "none",
      label: "Confirm protection",
      order: 999,
      property: "protectionConfirmed",
      required: true,
      schema: { kind: "boolean" },
      securityImpact: "security-sensitive",
      valueSource: "literal",
    };
    const document = loadAwsEditorArchitectureDocument();
    const model = createConfigurationFormModel(
      document,
      lambdaInspectorModel(document, extendLambdaCatalog(requiredBoolean)),
    );

    expect(model.initialValues["protectionConfirmed"]).toBe("");
    const result = convertConfigurationFormValues(model, model.initialValues);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0]).toMatchObject({
        message: "Choose true or false.",
        property: "protectionConfirmed",
      });
    }
  });

  it("keeps optional checkbox defaults as booleans instead of truthy strings", () => {
    const optionalCheckbox: EditorCatalogConfigurationField = {
      advanced: false,
      control: "checkbox",
      costImpact: "none",
      label: "Enable optional protection",
      order: 999,
      property: "optionalProtection",
      required: false,
      schema: { default: false, kind: "boolean" },
      securityImpact: "security-sensitive",
      valueSource: "literal",
    };
    const document = loadAwsEditorArchitectureDocument();
    const model = createConfigurationFormModel(
      document,
      lambdaInspectorModel(document, extendLambdaCatalog(optionalCheckbox)),
    );

    expect(model.initialValues["optionalProtection"]).toBe(false);
    const result = convertConfigurationFormValues(model, model.initialValues);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.edits["optionalProtection"]).toEqual({
        kind: "boolean",
        value: false,
      });
    }
  });

  it("fails closed and never exposes an existing literal credential through form values", () => {
    const credentialField: EditorCatalogConfigurationField = {
      advanced: true,
      control: "text",
      costImpact: "none",
      label: "Access key",
      order: 999,
      property: "accessKey",
      required: false,
      schema: { kind: "string" },
      securityImpact: "secret-reference",
      valueSource: "literal",
    };
    const catalog = extendLambdaCatalog(credentialField);
    const document = withLambdaValue(
      loadAwsEditorArchitectureDocument(),
      "accessKey",
      { kind: "string", value: "AKIA-not-a-real-key" },
    );
    const model = createConfigurationFormModel(
      document,
      lambdaInspectorModel(document, catalog),
    );
    const field = model.fields.find(
      ({ field: candidate }) => candidate.property === "accessKey",
    );

    expect(field?.editable).toBe(false);
    expect(field?.reason).toContain(
      "Literal cloud credentials are not accepted",
    );
    expect(model.initialValues["accessKey"]).toBe("Configured (value hidden)");
    expect(JSON.stringify(model.initialValues)).not.toContain(
      "AKIA-not-a-real-key",
    );

    const result = convertConfigurationFormValues(model, model.initialValues);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.message).toContain(
        "must be replaced by a supported reference",
      );
      expect(result.issues[0]?.property).toBe("accessKey");
    }
  });
});
