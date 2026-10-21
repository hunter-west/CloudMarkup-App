import {
  defineValidationRuleV1,
  migrateWorkloadBehaviorV1ToV2,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  parseArchitectureDocumentV1,
  workloadBehaviorV1Schema,
  type ArchitectureDocumentV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { createProviderCatalogAccessorsV1 } from "./accessors.js";
import {
  defineProviderValidationRuleRegistrationV1,
  providerConnectionRuleDescriptorV1Schema,
} from "./catalog-contract-v1.js";
import { validateProviderServiceConfigurationV1 } from "./configuration-validation.js";
import {
  composeProviderConnectionIamRequirementsV1,
  createProviderConnectionResolverV1,
  defineProviderConnectionRuleRegistrationV1,
} from "./connection-resolution.js";
import {
  ProviderCatalogCompilationError,
  compileProviderCatalogV1,
  renderProviderCatalogAccessorModuleV1,
} from "./compiler.js";

function createValidCatalogSource() {
  const connectionRuleId = "example.cloud.connection.self";
  const validationRuleId = "example.cloud.validation.configuration";
  const serviceId = "example.cloud.service";

  return {
    contractVersion: 1,
    provider: {
      id: "example.cloud",
      displayName: "Example Cloud",
      description: "A synthetic provider used for provider SDK tests.",
      iconNamespace: "example.cloud.icons",
      homepage: "https://example.com/",
      documentation: [
        {
          kind: "official",
          id: "example.cloud.documentation.home",
          title: "Example Cloud documentation",
          publisher: "Example Cloud",
          url: "https://example.com/docs",
        },
      ],
    },
    catalog: {
      id: "example.cloud.catalog",
      version: "1.0.0",
      maturity: "proof",
      description: "A synthetic provider SDK test catalog.",
      architectureDocumentSchemaVersions: [1],
      runtimeRetrieval: "forbidden",
    },
    services: [
      {
        id: serviceId,
        definitionVersion: "1.0.0",
        supportLevel: "proof",
        displayName: "Example service",
        description: "A synthetic resource for provider SDK tests.",
        nodeKind: {
          kind: "resource",
          resourceType: "example.cloud.resource",
          deployable: true,
        },
        iconId: "example.cloud.icons.resource",
        placement: {
          rootPlacement: "allowed",
          allowedParentTypes: [
            {
              serviceId,
              relationshipType: "example.cloud.contains",
            },
          ],
          maximumDepth: 2,
          regionConstraint: "same-region",
        },
        configuration: {
          schemaId: "example.cloud.configuration",
          schemaVersion: "1.0.0",
          jsonSchema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            $id: "urn:cloudmarkup:configuration:example.cloud.configuration:1.0.0",
            type: "object",
            title: "Example configuration",
            additionalProperties: false,
            properties: {
              mode: {
                type: "string",
                enum: ["safe", "fast"],
                default: "safe",
                pattern: "^(safe|fast)$",
              },
            },
            required: ["mode"],
          },
          uiHints: [
            {
              property: "mode",
              control: "select",
              label: "Mode",
              order: 0,
              advanced: false,
              valueSource: "literal",
              securityImpact: "none",
              costImpact: "none",
            },
          ],
        },
        ports: [
          {
            id: "example.cloud.port.output",
            displayName: "Output",
            description: "Synthetic output.",
            direction: "output",
            capability: "example.cloud.capability.send",
            category: "sends-messages-or-events",
            cardinality: "many",
            required: false,
          },
          {
            id: "example.cloud.port.input",
            displayName: "Input",
            description: "Synthetic input.",
            direction: "input",
            capability: "example.cloud.capability.receive",
            category: "sends-messages-or-events",
            cardinality: "many",
            required: false,
          },
        ],
        validationRuleIds: [validationRuleId],
        education: {
          summary: "Synthetic education.",
          guidedExplanation: "A guided synthetic explanation.",
          professionalExplanation: "A technical synthetic explanation.",
          considerations: ["Review the synthetic setting."],
          documentation: [
            {
              kind: "cloudmarkup",
              id: "example.cloud.documentation.service",
              title: "Example service",
              path: "docs/development/PROVIDER_CATALOG.md",
            },
          ],
        },
        unsupportedCapabilities: [],
        mappings: [
          {
            mappingId: "example.cloud.mapping.terraform",
            declarationVersion: 1,
            implementationStatus: "metadata-only",
            target: "terraform",
            kind: "resource",
            providerSource: "example/cloud",
            resourceType: "example_cloud_resource",
            configurationBindings: [
              {
                configurationKey: "mode",
                targetName: "mode",
              },
            ],
            portBindings: [
              {
                portId: "example.cloud.port.output",
                targetAttribute: "output",
              },
            ],
          },
          {
            mappingId: "example.cloud.mapping.cloudformation",
            declarationVersion: 1,
            implementationStatus: "metadata-only",
            target: "cloudformation",
            kind: "resource",
            typeName: "Example::Cloud::Resource",
            configurationBindings: [
              {
                configurationKey: "mode",
                targetName: "Mode",
              },
            ],
            portBindings: [],
          },
        ],
        regionAvailability: {
          state: "known",
          coverage: "complete",
          regions: [
            {
              region: "example-east-1",
              availability: "available",
            },
          ],
        },
      },
    ],
    connectionRules: [
      {
        id: connectionRuleId,
        ruleVersion: "1.0.0",
        relationshipType: "example.cloud.relationship",
        category: "sends-messages-or-events",
        source: {
          serviceId,
          portId: "example.cloud.port.output",
        },
        target: {
          serviceId,
          portId: "example.cloud.port.input",
        },
        maximumConnectionsPerSource: 10,
        maximumConnectionsPerTarget: 10,
        maximumConnectionsPerEndpointPair: 10,
        configuration: {
          schemaId: "example.cloud.connection.configuration",
          schemaVersion: "1.0.0",
          jsonSchema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            $id: "urn:cloudmarkup:configuration:example.cloud.connection.configuration:1.0.0",
            type: "object",
            title: "Example connection configuration",
            additionalProperties: false,
            properties: {
              mode: {
                type: "string",
                enum: ["safe"],
                default: "safe",
              },
            },
            required: ["mode"],
          },
          uiHints: [
            {
              property: "mode",
              control: "select",
              label: "Mode",
              order: 0,
              advanced: false,
              valueSource: "literal",
              securityImpact: "none",
              costImpact: "none",
            },
          ],
        },
        questions: [
          {
            id: "example.cloud.question.connection-mode",
            property: "mode",
            prompt: "Which reviewed connection mode should be used?",
            explanation:
              "The synthetic safe mode proves deterministic question defaults.",
            answer: { kind: "catalog-default" },
          },
        ],
        supportingChanges: [],
        iamEffects: [],
        missingInformationFindings: [],
        lifecycle: {
          provenance: "connection-rule",
          deletion: "release-generated-resources",
          adoption: "required-before-customization",
          sharedResource: "retain-while-referenced",
        },
        implementation: {
          status: "not-implemented",
          reason:
            "The synthetic SDK compiler fixture does not register executable provider behavior.",
        },
        validationRuleIds: [validationRuleId],
        education: {
          summary: "Synthetic connection education.",
          guidedExplanation: "A guided synthetic connection explanation.",
          professionalExplanation:
            "A technical synthetic connection explanation.",
          considerations: [],
          documentation: [],
        },
      },
    ],
    validationRules: [
      {
        id: validationRuleId,
        interfaceVersion: 1,
        ruleVersion: "1.0.0",
        implementationId: "example.cloud.validation.implementation",
        serviceIds: [serviceId],
        documentation: [
          {
            kind: "cloudmarkup",
            id: "example.cloud.documentation.validation",
            title: "Example validation",
            path: "docs/development/PROVIDER_CATALOG.md",
          },
        ],
      },
    ],
    migrations: [
      {
        id: "example.cloud.migration.initial",
        interfaceVersion: 1,
        fromCatalogVersion: "0.9.0",
        toCatalogVersion: "1.0.0",
        description: "Synthetic migration metadata.",
      },
    ],
  };
}

function cloneSource(): ReturnType<typeof createValidCatalogSource> {
  return structuredClone(createValidCatalogSource());
}

function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) {
    throw new Error("The valid catalog fixture unexpectedly has no entry.");
  }
  return value;
}

function expectCompilationCodes(
  source: unknown,
  expectedCodes: readonly string[],
): void {
  try {
    compileProviderCatalogV1(source);
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderCatalogCompilationError);
    if (error instanceof ProviderCatalogCompilationError) {
      expect(error.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining([...expectedCodes]),
      );
      return;
    }
  }
  throw new Error("Expected provider catalog compilation to fail.");
}

function createResolverFixture(options?: {
  readonly sourcePortCardinality?: "one" | "many";
  readonly maximumConnectionsPerSource?: number;
  readonly maximumConnectionsPerTarget?: number;
  readonly maximumConnectionsPerEndpointPair?: number;
  readonly secondRule?: boolean;
  readonly iamEffect?: boolean;
  readonly supportingResource?: boolean;
}) {
  const source = cloneSource();
  const service = first(source.services);
  const sourcePort = service.ports.find((port) => port.direction === "output");
  if (sourcePort === undefined) {
    throw new Error("Expected the synthetic source port.");
  }
  sourcePort.cardinality = options?.sourcePortCardinality ?? "many";
  const rule = first(source.connectionRules);
  Object.assign(rule, {
    maximumConnectionsPerSource: options?.maximumConnectionsPerSource ?? 10,
    maximumConnectionsPerTarget: options?.maximumConnectionsPerTarget ?? 10,
    maximumConnectionsPerEndpointPair:
      options?.maximumConnectionsPerEndpointPair ?? 10,
    iamEffects: options?.iamEffect
      ? [
          {
            id: "example.cloud.iam.read-target",
            effect: "allow",
            actions: ["example:Read"],
            resourceScope: "connected-target",
            explanation:
              "The synthetic effect proves deterministic whole-document composition.",
          },
        ]
      : [],
    supportingChanges: options?.supportingResource
      ? [
          {
            id: "example.cloud.supporting.iam-node",
            kind: "node",
            serviceId: service.id,
            ownership: "generated",
            purpose:
              "Creates one edge-owned synthetic permission support node for lifecycle tests.",
          },
        ]
      : [],
    implementation: {
      status: "implemented",
      interfaceVersion: 1,
      implementationId: "example.cloud.resolve-primary",
    },
  });
  if (options?.secondRule) {
    const alternateRule = providerConnectionRuleDescriptorV1Schema.parse({
      ...structuredClone(rule),
      id: "example.cloud.connection.alternate",
      relationshipType: "example.cloud.relationship.alternate",
      implementation: {
        status: "implemented",
        interfaceVersion: 1,
        implementationId: "example.cloud.resolve-alternate",
      },
    });
    Object.assign(source, {
      connectionRules: [...source.connectionRules, alternateRule],
    });
  }
  const artifact = compileProviderCatalogV1(source).artifact;
  const registrations = artifact.connectionRules
    .filter((candidate) => candidate.implementation.status === "implemented")
    .map((candidate) => {
      if (candidate.implementation.status !== "implemented") {
        throw new Error("Expected an implemented synthetic rule.");
      }
      return defineProviderConnectionRuleRegistrationV1({
        interfaceVersion: 1,
        ruleId: candidate.id,
        ruleVersion: candidate.ruleVersion,
        implementationId: candidate.implementation.implementationId,
        resolve: (context) => {
          if (!options?.supportingResource) {
            return {
              success: true,
              commands: [],
              generatedResources: [],
            };
          }
          const supportingNodeId = context.nodeId("iam-support");
          return {
            success: true,
            commands: [
              {
                ...context.commandEnvelope("add-iam-support"),
                kind: "add-node",
                node: {
                  id: supportingNodeId,
                  semantic: {
                    deploymentKey: `${context.operationId}_iam_support`,
                    serviceType: context.sourceNode.semantic.serviceType,
                    resourceType: context.sourceNode.semantic.resourceType,
                    configuration: context.serviceConfiguration(
                      context.sourceNode.semantic.serviceType,
                      context.sourceNode.semantic.configuration.values,
                    ),
                    lifecycle: context.generatedLifecycle([
                      { kind: "edge", edgeId: context.connectionEdgeId },
                    ]),
                  },
                  presentation: {
                    label: "Synthetic permission support",
                    position: {
                      x: context.sourceNode.presentation.position.x + 50,
                      y: context.sourceNode.presentation.position.y + 50,
                    },
                  },
                },
              },
            ],
            generatedResources: [
              { kind: "node" as const, nodeId: supportingNodeId },
            ],
          };
        },
      });
    });
  return {
    artifact,
    resolver: createProviderConnectionResolverV1(artifact, registrations),
  };
}

function createResolverDocument(
  artifact: ReturnType<typeof createResolverFixture>["artifact"],
): ArchitectureDocumentV1 {
  const service = first(artifact.services);
  const configuration = {
    schemaId: service.configuration.schemaId,
    schemaVersion: service.configuration.schemaVersion,
    values: { mode: { kind: "string" as const, value: "safe" } },
  };
  return parseArchitectureDocumentV1({
    kind: "cloudmarkup.architecture-document",
    schemaVersion: 1,
    documentId: "document_provider_sdk",
    architectureId: "architecture_provider_sdk",
    revision: {
      revisionId: "revision_provider_sdk",
      revisionNumber: 1,
      createdAt: "2026-07-31T12:00:00Z",
      createdBy: "actor_provider_sdk",
    },
    provider: { id: artifact.provider.id, region: "example-east-1" },
    catalog: {
      id: artifact.catalog.id,
      version: artifact.catalog.version,
      digest: artifact.digest,
    },
    compilerCompatibility: {
      inputContractVersion: 1,
      minimumCompilerVersion: "0.1.0",
    },
    metadata: {
      source: "user",
      serialization: {
        mediaType: "application/json",
        encoding: "utf-8",
        canonicalization: "cloudmarkup.canonical-json.v1",
      },
    },
    nodes: ["node_a", "node_b", "node_c"].map((id, index) => ({
      id,
      semantic: {
        deploymentKey: id,
        serviceType: service.id,
        resourceType:
          service.nodeKind.kind === "resource"
            ? service.nodeKind.resourceType
            : "example.cloud.resource",
        configuration,
        lifecycle: { ownership: "user" as const, origin: "user" as const },
      },
      presentation: { label: id, position: { x: index * 100, y: 0 } },
    })),
    edges: [],
    variables: [],
    outputs: [],
    assumptions: [],
    unresolvedRequirements: [],
  });
}

function resolveSynthetic(
  fixture: ReturnType<typeof createResolverFixture>,
  document: Parameters<
    ReturnType<typeof createResolverFixture>["resolver"]["resolve"]
  >[0]["document"],
  options: {
    readonly ruleId?: string;
    readonly sourceNodeId: string;
    readonly targetNodeId: string;
    readonly operationId: string;
  },
) {
  return fixture.resolver.resolve({
    document,
    ruleId: options.ruleId ?? "example.cloud.connection.self",
    source: {
      nodeId: options.sourceNodeId,
      portId: "example.cloud.port.output",
    },
    target: {
      nodeId: options.targetNodeId,
      portId: "example.cloud.port.input",
    },
    configuration: { mode: { kind: "string", value: "safe" } },
    operationId: options.operationId,
  });
}

function withWorkloadEdgeBinding(
  document: ArchitectureDocument,
  edgeId: string,
  bindingKind: "trigger" | "downstream",
): ArchitectureDocument {
  const operationId = "operation_main";
  return parseArchitectureDocument({
    ...document,
    workloadBehavior: migrateWorkloadBehaviorV1ToV2(
      workloadBehaviorV1Schema.parse({
        contractVersion: 1,
        workloads: [
          {
            id: "workload_main",
            owningNodeId: bindingKind === "trigger" ? "node_b" : "node_a",
            implementation: {
              mode: "user-provided",
              runtimeFamily: "example.cloud.runtime.nodejs",
              handler: "index.handler",
              sourceOwnership: "user",
            },
            operations: [
              {
                id: operationId,
                capability: "example.cloud.operation.main",
                inputContract: { kind: "none" },
                outputContract: { kind: "none" },
              },
            ],
            triggers:
              bindingKind === "trigger"
                ? [
                    {
                      id: "trigger_main",
                      edgeId,
                      targetOperationId: operationId,
                    },
                  ]
                : [],
            downstreamActions:
              bindingKind === "downstream"
                ? [
                    {
                      id: "downstream_main",
                      edgeId,
                      sourceOperationId: operationId,
                    },
                  ]
                : [],
            environment: [],
            errorBehavior: { mode: "fail-invocation" },
            executionAssumptions: {
              timeout: { kind: "unresolved" },
              retry: { kind: "unresolved" },
            },
            triggerDispatch: { mode: "single" },
            unresolvedRequirementIds: [],
          },
        ],
      }),
    ),
  });
}

function withGeneratedConnectionClosure(
  document: ArchitectureDocument,
  operationId: string,
): ArchitectureDocument {
  const directEdgeId = operationId + ".edge.connection";
  const baseSupport = document.nodes.find(
    (node) => node.id === operationId + ".node.iam-support",
  );
  if (baseSupport?.semantic.lifecycle.ownership !== "generated") {
    throw new TypeError("Expected a generated connection support node.");
  }
  const baseLifecycle = baseSupport.semantic.lifecycle;
  const createNode = (
    suffix: string,
    index: number,
    dependentNodeIds: readonly string[] = [],
    options?: {
      readonly parentNodeId?: string;
      readonly configurationNodeId?: string;
    },
  ) => ({
    ...structuredClone(baseSupport),
    id: operationId + ".node." + suffix,
    semantic: {
      ...structuredClone(baseSupport.semantic),
      deploymentKey: (operationId + "_" + suffix).replaceAll("-", "_"),
      configuration: {
        ...structuredClone(baseSupport.semantic.configuration),
        values: {
          ...structuredClone(baseSupport.semantic.configuration.values),
          ...(options?.configurationNodeId === undefined
            ? {}
            : {
                linkedNode: {
                  kind: "node-reference" as const,
                  nodeId: options.configurationNodeId,
                  attribute: "example.cloud.attribute.id",
                },
              }),
        },
      },
      lifecycle: {
        ...structuredClone(baseLifecycle),
        provenance: {
          ...structuredClone(baseLifecycle.provenance),
          dependentNodeIds: [...dependentNodeIds],
          dependentEdgeIds: [directEdgeId],
        },
      },
      ...(options?.parentNodeId === undefined
        ? {}
        : {
            parent: {
              nodeId: options.parentNodeId,
              relationshipType: "example.cloud.relationship.parent",
            },
          }),
    },
    presentation: {
      ...structuredClone(baseSupport.presentation),
      label: "Closure " + suffix,
      position: {
        x: baseSupport.presentation.position.x + index * 25,
        y: baseSupport.presentation.position.y + index * 25,
      },
    },
  });

  const parentNodeId = operationId + ".node.parent";
  const configurationTargetNodeId = operationId + ".node.configuration-target";
  const provenanceTargetNodeId = operationId + ".node.provenance-target";
  const parent = createNode("parent", 1);
  const child = createNode("child", 2, [], { parentNodeId });
  const configurationTarget = createNode("configuration-target", 3);
  const configurationSource = createNode("configuration-source", 4, [], {
    configurationNodeId: configurationTargetNodeId,
  });
  const provenanceTarget = createNode("provenance-target", 5);
  const provenanceSource = createNode("provenance-source", 6, [
    provenanceTargetNodeId,
  ]);
  const endpointOwned = createNode("endpoint-owned", 7, ["node_a"]);

  return parseArchitectureDocument({
    ...document,
    nodes: [
      ...document.nodes,
      configurationTarget,
      parent,
      provenanceTarget,
      endpointOwned,
      child,
      configurationSource,
      provenanceSource,
    ],
  });
}

function withGeneratedConnectionCycle(
  document: ArchitectureDocument,
  operationId: string,
): ArchitectureDocument {
  const baseSupport = document.nodes.find(
    (node) => node.id === operationId + ".node.iam-support",
  );
  if (baseSupport?.semantic.lifecycle.ownership !== "generated") {
    throw new TypeError("Expected a generated connection support node.");
  }
  const baseLifecycle = baseSupport.semantic.lifecycle;
  const createCycleNode = (suffix: string, dependencySuffix: string) => ({
    ...structuredClone(baseSupport),
    id: operationId + ".node." + suffix,
    semantic: {
      ...structuredClone(baseSupport.semantic),
      deploymentKey: (operationId + "_" + suffix).replaceAll("-", "_"),
      lifecycle: {
        ...structuredClone(baseLifecycle),
        provenance: {
          ...structuredClone(baseLifecycle.provenance),
          dependentNodeIds: [operationId + ".node." + dependencySuffix],
        },
      },
    },
    presentation: {
      ...structuredClone(baseSupport.presentation),
      label: "Cycle " + suffix,
    },
  });

  return parseArchitectureDocument({
    ...document,
    nodes: [
      ...document.nodes,
      createCycleNode("cycle-a", "cycle-b"),
      createCycleNode("cycle-b", "cycle-a"),
    ],
  });
}

describe("provider catalog compiler v1", () => {
  it("emits deterministic canonical artifacts and hashes", () => {
    const firstCompilation = compileProviderCatalogV1(
      createValidCatalogSource(),
    );
    const reordered = cloneSource();
    first(reordered.services).ports.reverse();
    first(reordered.services).mappings.reverse();
    reordered.provider.documentation.reverse();

    const second = compileProviderCatalogV1(reordered);

    expect(second.canonicalJson).toBe(firstCompilation.canonicalJson);
    expect(second.hash).toBe(firstCompilation.hash);
    expect(firstCompilation.hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(firstCompilation.artifact.digest).toBe(firstCompilation.hash);
    expect(
      first(firstCompilation.artifact.services).ports.map((port) => port.id),
    ).toEqual(["example.cloud.port.input", "example.cloud.port.output"]);
  });

  it("permits iconless nondeployable internal configuration resources", () => {
    const source = cloneSource();
    const service = first(source.services);
    service.nodeKind.deployable = false;
    Object.assign(service, { iconId: null });

    const compilation = compileProviderCatalogV1(source);

    expect(first(compilation.artifact.services).iconId).toBeNull();
  });

  it("creates read-only web/API accessors and version-bound port inventories", () => {
    const compilation = compileProviderCatalogV1(createValidCatalogSource());
    const accessors = createProviderCatalogAccessorsV1(compilation.artifact);
    const nodeId = "node-example" as never;

    expect(accessors.requireService("example.cloud.service").displayName).toBe(
      "Example service",
    );
    expect(accessors.getConnectionRule("example.cloud.connection.self")).toBe(
      accessors.listConnectionRules()[0],
    );
    expect(
      accessors.listConnectionRulesForService("example.cloud.service"),
    ).toEqual(accessors.listConnectionRules());
    expect(
      accessors.listConnectionRulesForPort(
        "example.cloud.service",
        "example.cloud.port.output",
      ),
    ).toEqual(accessors.listConnectionRules());
    expect(
      accessors.createPortInventory(
        [{ nodeId, serviceId: "example.cloud.service" }],
        "complete",
      ),
    ).toEqual({
      providerId: "example.cloud",
      catalogId: "example.cloud.catalog",
      catalogVersion: "1.0.0",
      coverage: "complete",
      nodes: [
        {
          nodeId,
          ports: ["example.cloud.port.input", "example.cloud.port.output"],
        },
      ],
    });
    expect(() =>
      accessors.createPortInventory(
        [
          { nodeId, serviceId: "example.cloud.service" },
          { nodeId, serviceId: "example.cloud.service" },
        ],
        "complete",
      ),
    ).toThrow(/duplicate node IDs/u);
    expect(Object.isFrozen(accessors.artifact)).toBe(true);
  });

  it("validates typed configuration values and applies defaults deterministically", () => {
    const service = first(
      compileProviderCatalogV1(createValidCatalogSource()).artifact.services,
    );

    expect(validateProviderServiceConfigurationV1(service, {})).toEqual({
      success: true,
      values: {
        mode: {
          kind: "string",
          value: "safe",
        },
      },
    });
    expect(
      validateProviderServiceConfigurationV1(service, {
        mode: {
          kind: "string",
          value: "unsafe",
        },
      }),
    ).toEqual({
      success: false,
      issues: [
        {
          code: "invalid-value",
          path: "$.values.mode",
          message:
            "The configuration value does not satisfy its catalog schema.",
        },
      ],
    });
    expect(
      validateProviderServiceConfigurationV1(service, {
        unexpected: {
          kind: "string",
          value: "safe",
        },
      }),
    ).toMatchObject({
      success: false,
      issues: [
        {
          code: "unknown-property",
          path: "$.values.unexpected",
        },
      ],
    });
    expect(
      validateProviderServiceConfigurationV1(service, {
        toString: {
          kind: "string",
          value: "safe",
        },
      }),
    ).toMatchObject({
      success: false,
      issues: [
        {
          code: "unknown-property",
          path: "$.values.toString",
        },
      ],
    });
  });

  it("rejects duplicate service IDs, ports, and rule IDs", () => {
    const duplicateService = cloneSource();
    duplicateService.services.push(
      structuredClone(first(duplicateService.services)),
    );
    expectCompilationCodes(duplicateService, ["duplicate-service-id"]);

    const duplicatePort = cloneSource();
    const duplicatePortService = first(duplicatePort.services);
    duplicatePortService.ports.push(
      structuredClone(first(duplicatePortService.ports)),
    );
    expectCompilationCodes(duplicatePort, ["duplicate-port-id"]);

    const duplicateRule = cloneSource();
    first(duplicateRule.validationRules).id = first(
      duplicateRule.connectionRules,
    ).id;
    expectCompilationCodes(duplicateRule, ["duplicate-rule-id"]);
  });

  it("rejects inconsistent configuration JSON Schemas and UI hints", () => {
    const legacyProductSchemaId = cloneSource();
    first(legacyProductSchemaId.services).configuration.jsonSchema.$id =
      "urn:cloudcanvas:configuration:example.cloud.configuration:1.0.0";
    expectCompilationCodes(legacyProductSchemaId, [
      "invalid-configuration-schema",
    ]);

    const missingProperty = cloneSource();
    first(missingProperty.services).configuration.jsonSchema.required.push(
      "missing",
    );
    expectCompilationCodes(missingProperty, ["invalid-configuration-schema"]);

    const invalidPattern = cloneSource();
    first(
      invalidPattern.services,
    ).configuration.jsonSchema.properties.mode.pattern = "[";
    expectCompilationCodes(invalidPattern, ["invalid-configuration-schema"]);

    const prototypeProperty = cloneSource();
    first(prototypeProperty.services).configuration.jsonSchema.required.push(
      "toString",
    );
    expectCompilationCodes(prototypeProperty, ["invalid-configuration-schema"]);

    const incompatibleHint = cloneSource();
    first(first(incompatibleHint.services).configuration.uiHints).control =
      "checkbox";
    expectCompilationCodes(incompatibleHint, ["invalid-ui-hint"]);

    const invalidRisk = cloneSource();
    first(first(invalidRisk.services).configuration.uiHints).securityImpact =
      "secret-reference";
    expectCompilationCodes(invalidRisk, ["invalid-ui-hint"]);
  });

  it("rejects broken service, port, and rule references", () => {
    const parentReference = cloneSource();
    first(parentReference.services).placement.allowedParentTypes.push({
      serviceId: "example.cloud.missing",
      relationshipType: "example.cloud.contains",
    });
    expectCompilationCodes(parentReference, ["broken-service-reference"]);

    const portReference = cloneSource();
    first(portReference.connectionRules).target.portId =
      "example.cloud.port.missing";
    expectCompilationCodes(portReference, ["broken-port-reference"]);

    const ruleReference = cloneSource();
    first(ruleReference.services).validationRuleIds.push(
      "example.cloud.validation.missing",
    );
    expectCompilationCodes(ruleReference, ["broken-rule-reference"]);
  });

  it("rejects connection category drift and one-port rule-cap drift", () => {
    const categoryDrift = cloneSource();
    first(categoryDrift.connectionRules).category = "invokes-another-workload";
    expectCompilationCodes(categoryDrift, ["invalid-connection-resolution"]);

    const sourceCardinalityDrift = cloneSource();
    first(
      first(sourceCardinalityDrift.services).ports.filter(
        (port) => port.direction === "output",
      ),
    ).cardinality = "one";
    expectCompilationCodes(sourceCardinalityDrift, [
      "invalid-connection-resolution",
    ]);

    const targetCardinalityDrift = cloneSource();
    first(
      first(targetCardinalityDrift.services).ports.filter(
        (port) => port.direction === "input",
      ),
    ).cardinality = "one";
    expectCompilationCodes(targetCardinalityDrift, [
      "invalid-connection-resolution",
    ]);
  });

  it("accepts reviewed owned-resource and owner-nested-block projections", () => {
    const owned = cloneSource();
    const ownedService = first(owned.services);
    ownedService.nodeKind.deployable = false;
    Object.assign(ownedService, { iconId: null });
    Object.assign(first(ownedService.mappings), {
      implementationStatus: "implemented",
      projection: {
        kind: "owned-resource",
        rendererContractId: "example.cloud.renderer.terraform",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
    });
    expect(() => compileProviderCatalogV1(owned)).not.toThrow();

    const nested = cloneSource();
    const nestedService = first(nested.services);
    nestedService.nodeKind.deployable = false;
    Object.assign(nestedService, { iconId: null });
    Object.assign(first(nestedService.mappings), {
      implementationStatus: "implemented",
      kind: "nested-block",
      ownerServiceId: nestedService.id,
      ownerRelationshipType: "example.cloud.relationship.owner",
      blockName: "network_config",
      projection: {
        kind: "owner-nested-block",
        rendererContractId: "example.cloud.renderer.terraform",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
    });
    const nestedMapping = first(nestedService.mappings) as Record<
      string,
      unknown
    >;
    delete nestedMapping["resourceType"];
    expect(() => compileProviderCatalogV1(nested)).not.toThrow();
  });

  it("rejects unreviewed or broken nondeployable projections", () => {
    const unreviewed = cloneSource();
    const service = first(unreviewed.services);
    service.nodeKind.deployable = false;
    Object.assign(service, { iconId: null });
    first(service.mappings).implementationStatus = "implemented";
    expectCompilationCodes(unreviewed, ["unsupported-mapping-declaration"]);

    const missingOwner = cloneSource();
    const nested = first(first(missingOwner.services).mappings) as Record<
      string,
      unknown
    >;
    Object.assign(nested, {
      kind: "nested-block",
      ownerServiceId: "example.cloud.missing-owner",
      ownerRelationshipType: "example.cloud.relationship.owner",
      blockName: "network_config",
      projection: {
        kind: "owner-nested-block",
        rendererContractId: "example.cloud.renderer.terraform",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
    });
    delete nested["resourceType"];
    expectCompilationCodes(missingOwner, ["broken-service-reference"]);
  });

  it("rejects unsupported compiler mapping declarations", () => {
    const unsupportedTarget = cloneSource();
    first(first(unsupportedTarget.services).mappings).target = "pulumi";
    expectCompilationCodes(unsupportedTarget, [
      "unsupported-mapping-declaration",
    ]);

    const badBinding = cloneSource();
    first(
      first(first(badBinding.services).mappings).configurationBindings,
    ).configurationKey = "missing";
    expectCompilationCodes(badBinding, ["unsupported-mapping-declaration"]);

    const badSemanticInput = cloneSource();
    Object.assign(first(first(badSemanticInput.services).mappings), {
      semanticConfigurationKeys: ["missing"],
    });
    expectCompilationCodes(badSemanticInput, [
      "unsupported-mapping-declaration",
    ]);
  });

  it("rejects invalid migrations and proof catalogs that claim support", () => {
    const migration = cloneSource();
    const firstMigration = first(migration.migrations);
    firstMigration.toCatalogVersion = firstMigration.fromCatalogVersion;
    expectCompilationCodes(migration, ["invalid-migration"]);

    const supportClaim = cloneSource();
    first(supportClaim.services).supportLevel = "curated";
    expectCompilationCodes(supportClaim, ["unsupported-support-claim"]);
  });

  it("renders deterministic local JSON accessor modules", () => {
    const compilation = compileProviderCatalogV1(createValidCatalogSource());
    const source = renderProviderCatalogAccessorModuleV1(compilation, {
      artifactImportPath: "./compiled/catalog-v1.json",
      artifactExportName: "exampleArtifact",
      accessorsExportName: "exampleCatalog",
      digestExportName: "EXAMPLE_CATALOG_DIGEST",
    });

    expect(source).toContain(compilation.hash);
    expect(source).toContain('from "./compiled/catalog-v1.json"');
    expect(source).not.toContain("http");
    expect(() =>
      renderProviderCatalogAccessorModuleV1(compilation, {
        artifactImportPath: "../outside/catalog-v1.json",
        artifactExportName: "exampleArtifact",
        accessorsExportName: "exampleCatalog",
        digestExportName: "EXAMPLE_CATALOG_DIGEST",
      }),
    ).toThrow(/non-traversing/u);
  });

  it("binds validation descriptors to matching reviewed rule registrations", () => {
    const compilation = compileProviderCatalogV1(createValidCatalogSource());
    const descriptor = first(compilation.artifact.validationRules);
    const rule = defineValidationRuleV1({
      interfaceVersion: 1,
      id: "example.cloud.validation.configuration",
      ruleVersion: "1.0.0",
      input: "architecture-document",
      applicability: {
        providers: { kind: "all" },
        catalogs: { kind: "all" },
        targets: ["draft"],
        environments: ["unknown"],
      },
      evaluate: () => [],
    });

    expect(
      defineProviderValidationRuleRegistrationV1({ descriptor, rule }).rule,
    ).toBe(rule);
    expect(() =>
      defineProviderValidationRuleRegistrationV1({
        descriptor: {
          ...descriptor,
          ruleVersion: "2.0.0",
        },
        rule,
      }),
    ).toThrow(/must match/u);
  });
});

describe("provider connection resolver cardinality and IAM contracts", () => {
  it("aggregates one-port occupancy across distinct connection rules", () => {
    const fixture = createResolverFixture({
      sourcePortCardinality: "one",
      maximumConnectionsPerSource: 1,
      maximumConnectionsPerTarget: 10,
      maximumConnectionsPerEndpointPair: 1,
      secondRule: true,
    });
    const firstResult = resolveSynthetic(
      fixture,
      createResolverDocument(fixture.artifact),
      {
        sourceNodeId: "node_a",
        targetNodeId: "node_b",
        operationId: "first_rule",
      },
    );
    expect(firstResult.success).toBe(true);
    if (!firstResult.success) {
      return;
    }
    const secondResult = resolveSynthetic(
      fixture,
      firstResult.preview.document,
      {
        ruleId: "example.cloud.connection.alternate",
        sourceNodeId: "node_a",
        targetNodeId: "node_c",
        operationId: "second_rule",
      },
    );
    expect(secondResult.success).toBe(false);
    if (!secondResult.success) {
      expect(secondResult.findings.map((item) => item.code)).toEqual([
        "cloudmarkup.connection.source-port-cardinality-exceeded",
      ]);
    }
  });

  it("reports source, target, and endpoint-pair rule caps independently", () => {
    const cases = [
      {
        fixture: createResolverFixture({
          maximumConnectionsPerSource: 1,
          maximumConnectionsPerTarget: 10,
          maximumConnectionsPerEndpointPair: 1,
        }),
        first: ["node_a", "node_b"],
        second: ["node_a", "node_c"],
        code: "cloudmarkup.connection.source-cardinality-exceeded",
      },
      {
        fixture: createResolverFixture({
          maximumConnectionsPerSource: 10,
          maximumConnectionsPerTarget: 1,
          maximumConnectionsPerEndpointPair: 1,
        }),
        first: ["node_a", "node_b"],
        second: ["node_c", "node_b"],
        code: "cloudmarkup.connection.target-cardinality-exceeded",
      },
      {
        fixture: createResolverFixture({
          maximumConnectionsPerSource: 10,
          maximumConnectionsPerTarget: 10,
          maximumConnectionsPerEndpointPair: 1,
        }),
        first: ["node_a", "node_b"],
        second: ["node_a", "node_b"],
        code: "cloudmarkup.connection.endpoint-pair-cardinality-exceeded",
      },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      const firstResult = resolveSynthetic(
        testCase.fixture,
        createResolverDocument(testCase.fixture.artifact),
        {
          sourceNodeId: testCase.first[0],
          targetNodeId: testCase.first[1],
          operationId: `cap_first_${String(index)}`,
        },
      );
      expect(firstResult.success).toBe(true);
      if (!firstResult.success) {
        continue;
      }
      const secondResult = resolveSynthetic(
        testCase.fixture,
        firstResult.preview.document,
        {
          sourceNodeId: testCase.second[0],
          targetNodeId: testCase.second[1],
          operationId: `cap_second_${String(index)}`,
        },
      );
      expect(secondResult.success).toBe(false);
      if (!secondResult.success) {
        expect(secondResult.findings.map((item) => item.code)).toEqual([
          testCase.code,
        ]);
      }
    }
  });

  it("composes every edge IAM effect in stable order independent of edge order", () => {
    const fixture = createResolverFixture({ iamEffect: true });
    const firstResult = resolveSynthetic(
      fixture,
      createResolverDocument(fixture.artifact),
      {
        sourceNodeId: "node_a",
        targetNodeId: "node_b",
        operationId: "z_permission",
      },
    );
    expect(firstResult.success).toBe(true);
    if (!firstResult.success) {
      return;
    }
    const secondResult = resolveSynthetic(
      fixture,
      firstResult.preview.document,
      {
        sourceNodeId: "node_c",
        targetNodeId: "node_b",
        operationId: "a_permission",
      },
    );
    expect(secondResult.success).toBe(true);
    if (!secondResult.success) {
      return;
    }
    expect(secondResult.preview.document.schemaVersion).toBe(3);
    const expectedKeys = [
      [
        "a_permission.edge.connection",
        "example.cloud.connection.self",
        "example.cloud.iam.read-target",
      ],
      [
        "z_permission.edge.connection",
        "example.cloud.connection.self",
        "example.cloud.iam.read-target",
      ],
    ];
    expect(
      secondResult.iamRequirements.map((requirement) => [
        requirement.sourceEdgeId,
        requirement.ruleId,
        requirement.effectId,
      ]),
    ).toEqual(expectedKeys);

    const reorderedDocument = {
      ...secondResult.preview.document,
      edges: [...secondResult.preview.document.edges].reverse(),
    };
    const recomposed = composeProviderConnectionIamRequirementsV1(
      fixture.artifact,
      reorderedDocument,
    );
    expect(recomposed.success).toBe(true);
    if (recomposed.success) {
      expect(recomposed.requirements).toEqual(secondResult.iamRequirements);
    }
  });

  it.each(["trigger", "downstream"] as const)(
    "preflight-rejects cleanup of a workload-bound %s edge before permission release",
    (bindingKind) => {
      const fixture = createResolverFixture({
        iamEffect: true,
        supportingResource: true,
      });
      const operationId = `bound_${bindingKind}`;
      const resolved = resolveSynthetic(
        fixture,
        createResolverDocument(fixture.artifact),
        {
          sourceNodeId: "node_a",
          targetNodeId: "node_b",
          operationId,
        },
      );
      expect(resolved.success).toBe(true);
      if (!resolved.success) {
        return;
      }
      const connectionEdgeId = `${operationId}.edge.connection`;
      const supportingNodeId = `${operationId}.node.iam-support`;
      const boundDocument = withWorkloadEdgeBinding(
        resolved.preview.document,
        connectionEdgeId,
        bindingKind,
      );
      const before = structuredClone(boundDocument);
      const iamBefore = composeProviderConnectionIamRequirementsV1(
        fixture.artifact,
        boundDocument,
      );
      expect(iamBefore.success).toBe(true);

      const cleanup = fixture.resolver.cleanup({
        document: boundDocument,
        connectionEdgeId,
        operationId: `cleanup_${bindingKind}`,
      });

      expect(cleanup).toEqual({
        success: false,
        findings: [
          expect.objectContaining({
            code: "cloudmarkup.connection.workload-binding-blocks-cleanup",
            severity: "error",
            path: "$.connectionEdgeId",
          }),
        ],
      });
      expect(cleanup).not.toHaveProperty("batch");
      expect(cleanup).not.toHaveProperty("preview");
      expect(boundDocument).toEqual(before);
      expect(
        boundDocument.nodes.some((node) => node.id === supportingNodeId),
      ).toBe(true);
      expect(
        composeProviderConnectionIamRequirementsV1(
          fixture.artifact,
          boundDocument,
        ),
      ).toEqual(iamBefore);
    },
  );

  it("removes an unbound connection and its edge-owned permission support atomically", () => {
    const fixture = createResolverFixture({
      iamEffect: true,
      supportingResource: true,
    });
    const operationId = "unbound_permission";
    const resolved = resolveSynthetic(
      fixture,
      createResolverDocument(fixture.artifact),
      {
        sourceNodeId: "node_a",
        targetNodeId: "node_b",
        operationId,
      },
    );
    expect(resolved.success).toBe(true);
    if (!resolved.success) {
      return;
    }
    const connectionEdgeId = `${operationId}.edge.connection`;
    const supportingNodeId = `${operationId}.node.iam-support`;
    const before = structuredClone(resolved.preview.document);

    const cleanup = fixture.resolver.cleanup({
      document: resolved.preview.document,
      connectionEdgeId,
      operationId: "cleanup_unbound",
    });

    expect(cleanup.success).toBe(true);
    if (!cleanup.success) {
      return;
    }
    expect(
      cleanup.batch.commands.map((command) => [
        command.kind,
        command.kind === "release-generated-resource"
          ? command.resource
          : undefined,
        command.kind === "release-generated-resource"
          ? command.requiredDisposition
          : undefined,
      ]),
    ).toEqual([
      [
        "release-generated-resource",
        { kind: "node", nodeId: supportingNodeId },
        "removed",
      ],
      [
        "release-generated-resource",
        { kind: "edge", edgeId: connectionEdgeId },
        "removed",
      ],
    ]);
    expect(
      cleanup.preview.document.nodes.some(
        (node) => node.id === supportingNodeId,
      ),
    ).toBe(false);
    expect(
      cleanup.preview.document.edges.some(
        (edge) => edge.id === connectionEdgeId,
      ),
    ).toBe(false);
    const iamAfter = composeProviderConnectionIamRequirementsV1(
      fixture.artifact,
      cleanup.preview.document,
    );
    expect(iamAfter).toEqual({
      success: true,
      requirements: [],
      findings: [],
    });
    expect(resolved.preview.document).toEqual(before);
  });

  it("releases the complete same-operation closure in deterministic dependency order", () => {
    const fixture = createResolverFixture({ supportingResource: true });
    const operationId = "closure_release";
    const resolved = resolveSynthetic(
      fixture,
      createResolverDocument(fixture.artifact),
      {
        sourceNodeId: "node_a",
        targetNodeId: "node_b",
        operationId,
      },
    );
    expect(resolved.success).toBe(true);
    if (!resolved.success) {
      return;
    }
    const connectionEdgeId = operationId + ".edge.connection";
    const closureDocument = withGeneratedConnectionClosure(
      resolved.preview.document,
      operationId,
    );
    const reorderedDocument = parseArchitectureDocument({
      ...closureDocument,
      nodes: [...closureDocument.nodes].reverse(),
      edges: [...closureDocument.edges].reverse(),
    });
    const before = structuredClone(closureDocument);

    const cleanup = fixture.resolver.cleanup({
      document: closureDocument,
      connectionEdgeId,
      operationId: "cleanup_closure",
    });
    const reorderedCleanup = fixture.resolver.cleanup({
      document: reorderedDocument,
      connectionEdgeId,
      operationId: "cleanup_closure",
    });

    expect(cleanup.success).toBe(true);
    expect(reorderedCleanup.success).toBe(true);
    if (!cleanup.success || !reorderedCleanup.success) {
      return;
    }
    expect(reorderedCleanup.batch).toEqual(cleanup.batch);
    const releases = cleanup.batch.commands.filter(
      (command) => command.kind === "release-generated-resource",
    );
    const releasedKeys = releases.map((command) =>
      command.resource.kind === "node"
        ? "node:" + command.resource.nodeId
        : "edge:" + command.resource.edgeId,
    );
    const indexOf = (key: string) => releasedKeys.indexOf(key);
    expect(indexOf("node:" + operationId + ".node.child")).toBeLessThan(
      indexOf("node:" + operationId + ".node.parent"),
    );
    expect(
      indexOf("node:" + operationId + ".node.configuration-source"),
    ).toBeLessThan(
      indexOf("node:" + operationId + ".node.configuration-target"),
    );
    expect(
      indexOf("node:" + operationId + ".node.provenance-source"),
    ).toBeLessThan(indexOf("node:" + operationId + ".node.provenance-target"));
    expect(releasedKeys).toContain(
      "node:" + operationId + ".node.endpoint-owned",
    );
    expect(releasedKeys.at(-1)).toBe("edge:" + connectionEdgeId);
    expect(releases.map((command) => command.requiredDisposition)).toEqual(
      releases.map(() => "removed"),
    );
    expect(
      cleanup.preview.document.nodes.some((node) => {
        const lifecycle = node.semantic.lifecycle;
        return (
          lifecycle.ownership !== "user" &&
          lifecycle.provenance.operationId === operationId
        );
      }),
    ).toBe(false);
    expect(
      cleanup.preview.document.edges.some(
        (edge) => edge.id === connectionEdgeId,
      ),
    ).toBe(false);
    expect(closureDocument).toEqual(before);
  });

  it("fails closed when the same-operation closure contains a dependency cycle", () => {
    const fixture = createResolverFixture({ supportingResource: true });
    const operationId = "cyclic_release";
    const resolved = resolveSynthetic(
      fixture,
      createResolverDocument(fixture.artifact),
      {
        sourceNodeId: "node_a",
        targetNodeId: "node_b",
        operationId,
      },
    );
    expect(resolved.success).toBe(true);
    if (!resolved.success) {
      return;
    }
    const cyclicDocument = withGeneratedConnectionCycle(
      resolved.preview.document,
      operationId,
    );
    const before = structuredClone(cyclicDocument);

    const cleanup = fixture.resolver.cleanup({
      document: cyclicDocument,
      connectionEdgeId: operationId + ".edge.connection",
      operationId: "cleanup_cycle",
    });

    expect(cleanup).toEqual({
      success: false,
      findings: [
        expect.objectContaining({
          code: "cloudmarkup.connection.cleanup-dependency-cycle",
          severity: "error",
          path: "$.connectionEdgeId",
        }),
      ],
    });
    expect(cleanup).not.toHaveProperty("batch");
    expect(cleanup).not.toHaveProperty("preview");
    expect(cyclicDocument).toEqual(before);
  });

  it("retains a legitimately shared generated resource while requiring direct-edge removal", () => {
    const fixture = createResolverFixture({ supportingResource: true });
    const operationId = "shared_release";
    const resolved = resolveSynthetic(
      fixture,
      createResolverDocument(fixture.artifact),
      {
        sourceNodeId: "node_a",
        targetNodeId: "node_b",
        operationId,
      },
    );
    expect(resolved.success).toBe(true);
    if (!resolved.success) {
      return;
    }
    const supportingNodeId = operationId + ".node.iam-support";
    const sharedDocument = parseArchitectureDocument({
      ...resolved.preview.document,
      outputs: [
        ...resolved.preview.document.outputs,
        {
          id: "output_shared_support",
          key: "shared_support",
          valueType: "string",
          sensitive: false,
          source: {
            kind: "node-attribute",
            nodeId: supportingNodeId,
            attribute: "example.cloud.attribute.id",
          },
        },
      ],
    });

    const cleanup = fixture.resolver.cleanup({
      document: sharedDocument,
      connectionEdgeId: operationId + ".edge.connection",
      operationId: "cleanup_shared",
    });

    expect(cleanup.success).toBe(true);
    if (!cleanup.success) {
      return;
    }
    expect(
      cleanup.batch.commands.map((command) =>
        command.kind === "release-generated-resource"
          ? [command.resource, command.requiredDisposition]
          : [undefined, undefined],
      ),
    ).toEqual([
      [{ kind: "node", nodeId: supportingNodeId }, "retained"],
      [{ kind: "edge", edgeId: operationId + ".edge.connection" }, "removed"],
    ]);
    expect(
      cleanup.preview.document.nodes.some(
        (node) => node.id === supportingNodeId,
      ),
    ).toBe(true);
    expect(cleanup.preview.document.outputs).toEqual(sharedDocument.outputs);
  });

  it("rejects cleanup and edit when direct-edge provenance no longer matches the catalog rule version", () => {
    const fixture = createResolverFixture({ supportingResource: true });
    const operationId = "identity_guard";
    const resolved = resolveSynthetic(
      fixture,
      createResolverDocument(fixture.artifact),
      {
        sourceNodeId: "node_a",
        targetNodeId: "node_b",
        operationId,
      },
    );
    expect(resolved.success).toBe(true);
    if (!resolved.success) {
      return;
    }
    const connectionEdgeId = operationId + ".edge.connection";
    const mismatchedDocument = parseArchitectureDocument({
      ...resolved.preview.document,
      edges: resolved.preview.document.edges.map((edge) =>
        edge.id !== connectionEdgeId ||
        edge.semantic.lifecycle.ownership === "user"
          ? edge
          : {
              ...edge,
              semantic: {
                ...edge.semantic,
                lifecycle: {
                  ...edge.semantic.lifecycle,
                  provenance: {
                    ...edge.semantic.lifecycle.provenance,
                    generatorVersion: "9.9.9",
                  },
                },
              },
            },
      ),
    });

    const cleanup = fixture.resolver.cleanup({
      document: mismatchedDocument,
      connectionEdgeId,
      operationId: "cleanup_identity_guard",
    });
    const edit = fixture.resolver.edit({
      document: mismatchedDocument,
      connectionEdgeId,
      ruleId: "example.cloud.connection.self",
      source: {
        nodeId: "node_a",
        portId: "example.cloud.port.output",
      },
      target: {
        nodeId: "node_b",
        portId: "example.cloud.port.input",
      },
      configuration: { mode: { kind: "string", value: "safe" } },
      operationId: "edit_identity_guard",
    });

    expect(cleanup.success).toBe(false);
    expect(edit.success).toBe(false);
    if (!cleanup.success && !edit.success) {
      expect(cleanup.findings[0]?.code).toBe(
        "cloudmarkup.connection.cleanup-not-generated",
      );
      expect(edit.findings[0]?.code).toBe(
        "cloudmarkup.connection.edit-not-generated",
      );
    }
  });
});
