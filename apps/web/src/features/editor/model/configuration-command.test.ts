import {
  getArchitectureDocumentHashes,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadAwsEditorArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import type {
  EditorCatalog,
  EditorCatalogConfigurationField,
} from "./editor-catalog.js";
import {
  applyPreparedConfigurationCommand,
  ConfigurationCommandPreparationError,
  prepareConfigurationCommand,
} from "./configuration-command.js";

function deterministicIds(...ids: readonly string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `operation_configuration_${String(index)}`;
}

function lambdaNode(document: ArchitectureDocument) {
  const node = document.nodes.find(
    (candidate) => candidate.semantic.serviceType === "aws.lambda.function",
  );
  if (node === undefined) {
    throw new TypeError("Expected the AWS fixture Lambda node.");
  }
  return node;
}

function configurationValueAt(
  values: unknown,
  property: string,
): Readonly<ConfigurationValue> | undefined {
  return (values as Readonly<Record<string, Readonly<ConfigurationValue>>>)[
    property
  ];
}

function withLambdaField(
  field: EditorCatalogConfigurationField,
  validate: (values: unknown) =>
    | {
        readonly success: true;
        readonly values: Readonly<Record<string, Readonly<ConfigurationValue>>>;
      }
    | {
        readonly success: false;
        readonly issues: readonly [];
      },
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
              validate,
            },
          }
        : service,
    ),
  };
}

describe("configuration commands", () => {
  it("previews a node update without committing and preserves visual hashes", () => {
    const document = loadAwsEditorArchitectureDocument();
    const node = lambdaNode(document);
    const originalHashes = getArchitectureDocumentHashes(document);

    const prepared = prepareConfigurationCommand({
      catalog: awsEditorCatalog,
      createId: deterministicIds(
        "operation_configuration_0001",
        "operation_configuration_inverse_0001",
      ),
      document,
      edits: {
        memoryMegabytes: { kind: "integer", value: 512 },
      },
      target: { id: node.id, kind: "node" },
    });

    expect(prepared.command).toMatchObject({
      commandId: "operation_configuration_0001",
      inverseCommandId: "operation_configuration_inverse_0001",
      kind: "update-node-configuration",
      nodeId: node.id,
      expectedConfiguration: node.semantic.configuration,
      configuration: {
        values: {
          memoryMegabytes: { kind: "integer", value: 512 },
        },
      },
    });
    expect(lambdaNode(document).semantic.configuration.values).toEqual(
      node.semantic.configuration.values,
    );
    expect(prepared.baseHashes).toEqual(originalHashes);
    expect(prepared.previewHashes.contentHash).not.toBe(
      originalHashes.contentHash,
    );
    expect(prepared.previewHashes.visualHash).toBe(originalHashes.visualHash);

    const applied = applyPreparedConfigurationCommand(document, prepared);
    expect(
      configurationValueAt(
        lambdaNode(applied.document).semantic.configuration.values,
        "memoryMegabytes",
      ),
    ).toEqual({ kind: "integer", value: 512 });
  });

  it("orders preview changes by stable code units instead of the host locale", () => {
    const fields: readonly EditorCatalogConfigurationField[] = [
      {
        advanced: true,
        control: "text",
        costImpact: "none",
        label: "Mixed-case suffix",
        order: 998,
        property: "aB",
        required: false,
        schema: { kind: "string" },
        securityImpact: "none",
        valueSource: "literal",
      },
      {
        advanced: true,
        control: "text",
        costImpact: "none",
        label: "Lowercase suffix",
        order: 999,
        property: "aa",
        required: false,
        schema: { kind: "string" },
        securityImpact: "none",
        valueSource: "literal",
      },
    ];
    const catalog: EditorCatalog = {
      ...awsEditorCatalog,
      services: awsEditorCatalog.services.map((service) =>
        service.serviceType === "aws.lambda.function"
          ? {
              ...service,
              configuration: {
                ...service.configuration,
                fields: [...service.configuration.fields, ...fields],
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
    const document = loadAwsEditorArchitectureDocument();
    const prepared = prepareConfigurationCommand({
      catalog,
      createId: deterministicIds(
        "operation_configuration_order",
        "operation_configuration_order_inverse",
      ),
      document,
      edits: {
        aa: { kind: "string", value: "second" },
        aB: { kind: "string", value: "first" },
      },
      target: { id: lambdaNode(document).id, kind: "node" },
    });

    expect(
      prepared.changes
        .filter(
          (change) => change.property === "aB" || change.property === "aa",
        )
        .map((change) => change.property),
    ).toEqual(["aB", "aa"]);
  });

  it("prepares and applies the same exact command for relationship configuration", () => {
    const base = loadAwsEditorArchitectureDocument();
    const document = parseArchitectureDocument({
      ...base,
      edges: [
        ...base.edges,
        {
          id: "edge_lambda_table",
          semantic: {
            source: {
              nodeId: "node_api_handler",
              port: "aws.lambda.function.data-read",
            },
            target: {
              nodeId: "node_notes_table",
              port: "aws.dynamodb.table.table-api",
            },
            relationshipType: "aws.lambda.reads-dynamodb-table",
            configuration: {
              schemaId: "aws.lambda.dynamodb-read.connection",
              schemaVersion: "1.0.0",
              values: {
                consistentRead: { kind: "boolean", value: false },
              },
            },
            lifecycle: {
              ownership: "user",
              origin: "template",
            },
          },
        },
      ],
    });

    const prepared = prepareConfigurationCommand({
      catalog: awsEditorCatalog,
      createId: deterministicIds(
        "operation_relationship_configuration",
        "operation_relationship_configuration_inverse",
      ),
      document,
      edits: {
        consistentRead: { kind: "boolean", value: true },
      },
      target: { id: "edge_lambda_table", kind: "edge" },
    });

    expect(prepared.command).toMatchObject({
      commandId: "operation_relationship_configuration",
      edgeId: "edge_lambda_table",
      kind: "update-edge-configuration",
      configuration: {
        values: {
          consistentRead: { kind: "boolean", value: true },
        },
      },
    });
    const applied = applyPreparedConfigurationCommand(document, prepared);
    const edge = applied.document.edges.find(
      (candidate) => candidate.id === "edge_lambda_table",
    );
    expect(
      configurationValueAt(
        edge?.semantic.configuration.values,
        "consistentRead",
      ),
    ).toEqual({ kind: "boolean", value: true });
  });

  it("preserves an unknown future value during an unrelated known-field edit", () => {
    const base = loadAwsEditorArchitectureDocument();
    const sourceNode = lambdaNode(base);
    const input = {
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === sourceNode.id
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                configuration: {
                  ...node.semantic.configuration,
                  values: {
                    ...node.semantic.configuration.values,
                    futureSupportedField: {
                      kind: "string",
                      value: "preserve-me",
                    },
                  },
                },
              },
            }
          : node,
      ),
    };
    const document = parseArchitectureDocument(input);
    const node = lambdaNode(document);

    const prepared = prepareConfigurationCommand({
      catalog: awsEditorCatalog,
      createId: deterministicIds(
        "operation_configuration_future",
        "operation_configuration_future_inverse",
      ),
      document,
      edits: {
        timeoutSeconds: { kind: "integer", value: 20 },
      },
      target: { id: node.id, kind: "node" },
    });

    expect(
      configurationValueAt(
        prepared.command.configuration.values,
        "futureSupportedField",
      ),
    ).toEqual({
      kind: "string",
      value: "preserve-me",
    });
  });

  it("fails closed when an unknown future field contains a credential literal", () => {
    const base = loadAwsEditorArchitectureDocument();
    const sourceNode = lambdaNode(base);
    const document = parseArchitectureDocument({
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === sourceNode.id
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                configuration: {
                  ...node.semantic.configuration,
                  values: {
                    ...node.semantic.configuration.values,
                    futureSecretKey: {
                      kind: "string",
                      value: "not-a-real-secret",
                    },
                  },
                },
              },
            }
          : node,
      ),
    });

    expect(() =>
      prepareConfigurationCommand({
        catalog: awsEditorCatalog,
        createId: deterministicIds(
          "operation_configuration_future_credential",
          "operation_configuration_future_credential_inverse",
        ),
        document,
        edits: {
          timeoutSeconds: { kind: "integer", value: 20 },
        },
        target: { id: sourceNode.id, kind: "node" },
      }),
    ).toThrow(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "credential-literal-forbidden",
            property: "futureSecretKey",
          }),
        ],
      }),
    );
  });

  it("returns catalog validation issues and allocates no preview document", () => {
    const document = loadAwsEditorArchitectureDocument();
    const node = lambdaNode(document);

    expect(() =>
      prepareConfigurationCommand({
        catalog: awsEditorCatalog,
        createId: deterministicIds(
          "operation_configuration_invalid",
          "operation_configuration_invalid_inverse",
        ),
        document,
        edits: {
          timeoutSeconds: { kind: "integer", value: 0 },
        },
        target: { id: node.id, kind: "node" },
      }),
    ).toThrow(ConfigurationCommandPreparationError);

    try {
      prepareConfigurationCommand({
        catalog: awsEditorCatalog,
        createId: deterministicIds(
          "operation_configuration_invalid_2",
          "operation_configuration_invalid_inverse_2",
        ),
        document,
        edits: {
          timeoutSeconds: { kind: "integer", value: 0 },
        },
        target: { id: node.id, kind: "node" },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationCommandPreparationError);
      expect((error as ConfigurationCommandPreparationError).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "invalid-configuration",
            property: "timeoutSeconds",
          }),
        ]),
      );
    }
  });

  it("fails closed before a credential-shaped literal reaches validation", () => {
    const field: EditorCatalogConfigurationField = {
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
    const catalog = withLambdaField(field, (values) => ({
      success: true,
      values: values as Readonly<Record<string, Readonly<ConfigurationValue>>>,
    }));
    const document = loadAwsEditorArchitectureDocument();

    expect(() =>
      prepareConfigurationCommand({
        catalog,
        createId: deterministicIds(
          "operation_configuration_credential",
          "operation_configuration_credential_inverse",
        ),
        document,
        edits: {
          accessKey: { kind: "string", value: "AKIA-not-a-real-key" },
        },
        target: { id: lambdaNode(document).id, kind: "node" },
      }),
    ).toThrow(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "credential-literal-forbidden",
            property: "accessKey",
          }),
        ],
      }),
    );
  });

  it("uses catalog security metadata to reject credential string lists", () => {
    const field: EditorCatalogConfigurationField = {
      advanced: true,
      control: "multi-select",
      costImpact: "none",
      label: "Signing material",
      order: 999,
      property: "signingMaterial",
      required: false,
      schema: { kind: "string-list", uniqueItems: true },
      securityImpact: "secret-reference",
      valueSource: "secret-reference",
    };
    const catalog = withLambdaField(field, (values) => ({
      success: true,
      values: values as Readonly<Record<string, Readonly<ConfigurationValue>>>,
    }));
    const document = loadAwsEditorArchitectureDocument();

    expect(() =>
      prepareConfigurationCommand({
        catalog,
        createId: deterministicIds(
          "operation_configuration_secret_list",
          "operation_configuration_secret_list_inverse",
        ),
        document,
        edits: {
          signingMaterial: {
            kind: "string-list",
            value: ["literal-value-that-must-not-be-stored"],
          },
        },
        target: { id: lambdaNode(document).id, kind: "node" },
      }),
    ).toThrow(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "credential-literal-forbidden",
            property: "signingMaterial",
          }),
        ],
      }),
    );
  });
  it("uses only a tagged variable reference and redacts its preview", () => {
    const field: EditorCatalogConfigurationField = {
      advanced: true,
      control: "select",
      costImpact: "none",
      label: "Signing variable",
      order: 999,
      property: "signingVariable",
      required: false,
      schema: { kind: "string" },
      securityImpact: "security-sensitive",
      valueSource: "sensitive-variable-reference",
    };
    const catalog = withLambdaField(field, (values) => ({
      success: true,
      values: values as Readonly<Record<string, Readonly<ConfigurationValue>>>,
    }));
    const base = loadAwsEditorArchitectureDocument();
    const input = {
      ...base,
      variables: [
        ...base.variables,
        {
          id: "variable_signing_key",
          key: "signing_key",
          valueType: "string",
          required: true,
          description: "Deployment-time signing key.",
        },
      ],
    };
    const document = parseArchitectureDocument(input);
    const variableId = document.variables[0]?.id;
    if (variableId === undefined) {
      throw new TypeError("Expected the sensitive variable fixture.");
    }

    const prepared = prepareConfigurationCommand({
      catalog,
      createId: deterministicIds(
        "operation_configuration_sensitive",
        "operation_configuration_sensitive_inverse",
      ),
      document,
      edits: {
        signingVariable: {
          kind: "variable-reference",
          variableId,
        },
      },
      target: { id: lambdaNode(document).id, kind: "node" },
    });

    expect(
      configurationValueAt(
        prepared.command.configuration.values,
        "signingVariable",
      ),
    ).toEqual({
      kind: "variable-reference",
      variableId: "variable_signing_key",
    });
    expect(prepared.changes).toContainEqual({
      after: "Sensitive IaC variable reference (value hidden)",
      before: "Not set",
      property: "signingVariable",
      sensitive: true,
    });
    expect(JSON.stringify(prepared.changes)).not.toContain(
      "variable_signing_key",
    );
  });

  it("rejects stale prepared commands instead of overwriting intervening edits", () => {
    const document = loadAwsEditorArchitectureDocument();
    const node = lambdaNode(document);
    const first = prepareConfigurationCommand({
      catalog: awsEditorCatalog,
      createId: deterministicIds(
        "operation_configuration_first",
        "operation_configuration_first_inverse",
      ),
      document,
      edits: {
        memoryMegabytes: { kind: "integer", value: 512 },
      },
      target: { id: node.id, kind: "node" },
    });
    const second = prepareConfigurationCommand({
      catalog: awsEditorCatalog,
      createId: deterministicIds(
        "operation_configuration_second",
        "operation_configuration_second_inverse",
      ),
      document,
      edits: {
        memoryMegabytes: { kind: "integer", value: 1024 },
      },
      target: { id: node.id, kind: "node" },
    });
    const intervening = applyPreparedConfigurationCommand(document, first);

    expect(() =>
      applyPreparedConfigurationCommand(intervening.document, second),
    ).toThrow(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "precondition_failed",
          }),
        ],
      }),
    );
  });
});
