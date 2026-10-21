import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import { awsConnectionPresentationV1 } from "@cloudmarkup/provider-aws/connection-presentation";
import { awsServiceExtensionV1 } from "@cloudmarkup/provider-aws/service-extension";
import { describe, expect, it } from "vitest";

import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import {
  adaptProviderCatalogForEditor,
  type ProviderCatalogEditorSource,
} from "./provider-catalog-adapter.js";

function injectedSource(
  services: readonly unknown[],
): ProviderCatalogEditorSource {
  return {
    artifact: structuredClone(awsCatalogV1.artifact),
    listConnectionRules: () =>
      structuredClone(awsCatalogV1.listConnectionRules()),
    listServices: () => services,
    validateConfiguration: (serviceId, values) =>
      awsCatalogV1.validateConfiguration(serviceId, values),
  };
}

describe("adaptProviderCatalogForEditor", () => {
  it("projects the exact AWS catalog truth without upgrading readiness claims", () => {
    expect(awsEditorCatalog).toMatchObject({
      catalogMaturity: "curated",
      providerId: "aws.cloudmarkup",
      providerName: "Amazon Web Services",
      identity: {
        id: awsCatalogV1.artifact.catalog.id,
        version: awsCatalogV1.artifact.catalog.version,
        digest: awsCatalogV1.artifact.digest,
      },
    });
    expect(JSON.stringify(awsEditorCatalog)).not.toContain("CloudMarkup");
    expect(awsEditorCatalog.services).toHaveLength(
      awsCatalogV1.listServices().length,
    );

    for (const service of awsEditorCatalog.services) {
      const wafProof = service.serviceType.startsWith("aws.wafv2.");
      expect(service.supportLevel).toBe(
        wafProof ? "proof" : "production-oriented",
      );
      expect(service.supportLabel).toBe(
        wafProof ? "Proof metadata" : "Production-oriented",
      );
      expect(service.supportDetail).toBe(
        wafProof
          ? "This catalog definition is proof metadata and is not a product support claim."
          : "This catalog definition is production-oriented metadata, not curated service support.",
      );
      expect(service.regionAvailability.state).toBe("unknown");
      const mappings = service.mappings.map(
        ({ implementationStatus, target }) => ({
          implementationStatus,
          target,
        }),
      );
      const sourceService = awsCatalogV1
        .listServices()
        .find((candidate) => candidate.id === service.serviceType);
      if (sourceService === undefined) {
        throw new Error(`Expected source service ${service.serviceType}.`);
      }
      expect(mappings).toEqual(
        sourceService.mappings
          .map(({ implementationStatus, target }) => ({
            implementationStatus,
            target,
          }))
          .sort(
            (left, right) =>
              left.target.localeCompare(right.target) ||
              left.implementationStatus.localeCompare(
                right.implementationStatus,
              ),
          ),
      );
    }
  });

  it("projects ordered field schemas and validates through the catalog accessor", () => {
    const lambda = awsEditorCatalog.services.find(
      (service) => service.serviceType === "aws.lambda.function",
    );
    if (lambda === undefined) {
      throw new Error("Expected the Lambda catalog projection.");
    }

    expect(lambda.configuration.fields.map((field) => field.property)).toEqual([
      "functionName",
      "runtime",
      "architecture",
      "handler",
      "timeoutSeconds",
      "memoryMegabytes",
      "tracingEnabled",
      "reservedConcurrency",
    ]);
    expect(lambda.configuration.fields[0]).toEqual({
      advanced: false,
      control: "text",
      costImpact: "none",
      label: "Function name",
      order: 0,
      property: "functionName",
      required: true,
      schema: {
        default: "notes-api-handler",
        kind: "string",
        maximumLength: 64,
        minimumLength: 1,
        pattern: "^[A-Za-z0-9_-]+$",
      },
      securityImpact: "none",
      valueSource: "literal",
    });
    expect(lambda.configuration.fields[5]?.schema).toEqual({
      default: 256,
      enum: [128, 256, 512, 1024],
      kind: "integer",
    });

    const invalid = lambda.configuration.validate({
      timeoutSeconds: { kind: "integer", value: 31 },
    });
    expect(invalid).toEqual({
      issues: [
        {
          code: "invalid-value",
          message:
            "The configuration value does not satisfy its catalog schema.",
          path: "$.values.timeoutSeconds",
          property: "timeoutSeconds",
        },
      ],
      success: false,
    });
    expect(Object.isFrozen(invalid)).toBe(true);
    expect(
      Object.isFrozen(invalid.success ? invalid.values : invalid.issues),
    ).toBe(true);
  });

  it("keeps generic Lambda capabilities visible while enabling only implemented rule endpoints", () => {
    const lambda = awsEditorCatalog.services.find(
      (service) => service.serviceType === "aws.lambda.function",
    );
    if (lambda === undefined) {
      throw new Error("Expected the Lambda catalog projection.");
    }

    expect(
      lambda.ports
        .filter((port) => port.connectionSupport === "supported")
        .map((port) => port.id),
    ).toEqual([
      "aws.lambda.function.asynchronous-invocation",
      "aws.lambda.function.data-read",
      "aws.lambda.function.data-write",
      "aws.lambda.function.dead-letter-destination",
      "aws.lambda.function.event-publish",
      "aws.lambda.function.event-source",
      "aws.lambda.function.execution-role",
      "aws.lambda.function.logging",
      "aws.lambda.function.message-send",
      "aws.lambda.function.synchronous-invocation",
      "aws.lambda.function.telemetry",
      "aws.lambda.function.workload-invocation",
    ]);
    expect(
      lambda.ports
        .filter((port) => port.connectionSupport === "unsupported")
        .map((port) => port.id),
    ).toEqual([
      "aws.lambda.function.configuration-read",
      "aws.lambda.function.invocation-permission",
      "aws.lambda.function.object-access",
      "aws.lambda.function.policy-resource",
      "aws.lambda.function.schedule",
      "aws.lambda.function.vpc-access",
    ]);
    expect(
      lambda.ports.find(
        (port) => port.id === "aws.lambda.function.execution-role",
      ),
    ).toMatchObject({
      capability: "aws.lambda.execution-role",
      cardinality: "one",
      category: "network-and-security",
      connectionSupport: "supported",
      required: true,
    });
    expect(
      lambda.ports.find(
        (port) => port.id === "aws.lambda.function.event-source",
      ),
    ).toMatchObject({
      cardinality: "many",
      category: "receives-events-from",
      connectionSupport: "supported",
      required: false,
    });
  });

  it("projects relationship configuration, education, effects, and lifecycle facts", () => {
    const relationship = awsEditorCatalog.relationships?.find(
      (candidate) =>
        candidate.descriptorId === "aws.apigateway.http-api-invokes-lambda",
    );
    if (relationship === undefined) {
      throw new Error("Expected the HTTP API to Lambda relationship.");
    }

    expect(relationship).toMatchObject({
      descriptorId: "aws.apigateway.http-api-invokes-lambda",
      id: "aws.apigateway.integrates-lambda",
      implementation: {
        status: "implemented",
      },
      lifecycle: {
        adoption: "required-before-customization",
        deletion: "release-generated-resources",
        provenance: "connection-rule",
        sharedResource: "retain-while-referenced",
      },
      category: "receives-events-from",
      maximumConnectionsPerEndpointPair: 8,
      maximumConnectionsPerSource: 32,
      maximumConnectionsPerTarget: 8,
      ruleVersion: "1.0.0",
    });
    expect(relationship.questions.map((question) => question.property)).toEqual(
      ["timeoutMilliseconds", "payloadFormatVersion", "routeKey"],
    );
    expect(relationship.iamEffects[0]).toMatchObject({
      actions: ["lambda:InvokeFunction"],
      effect: "allow",
      resourceScope: "target-node",
    });
    expect(relationship.missingInformation[0]).toMatchObject({
      configurationProperties: ["routeKey"],
      trigger: "missing-configuration",
    });

    const validation = relationship.configuration.validate({});
    expect(validation).toMatchObject({
      issues: [
        {
          code: "missing-required-property",
          property: "routeKey",
        },
      ],
      success: false,
    });
  });

  it("projects split DynamoDB read and write rules with exact least-privilege effects", () => {
    const read = awsEditorCatalog.relationships?.find(
      (relationship) => relationship.id === "aws.lambda.reads-dynamodb-table",
    );
    const write = awsEditorCatalog.relationships?.find(
      (relationship) => relationship.id === "aws.lambda.writes-dynamodb-table",
    );

    expect(read).toMatchObject({
      category: "reads-or-writes-data",
      configuration: { schemaId: "aws.lambda.dynamodb-read.connection" },
      maximumConnectionsPerEndpointPair: 1,
      sourcePortId: "aws.lambda.function.data-read",
      targetPortId: "aws.dynamodb.table.table-api",
    });
    expect(read?.iamEffects).toEqual([
      expect.objectContaining({
        actions: ["dynamodb:GetItem", "dynamodb:Query"],
        id: "aws.lambda.iam.dynamodb-read",
      }),
    ]);
    expect(write).toMatchObject({
      category: "reads-or-writes-data",
      configuration: { schemaId: "aws.lambda.dynamodb-write.connection" },
      maximumConnectionsPerEndpointPair: 1,
      sourcePortId: "aws.lambda.function.data-write",
      targetPortId: "aws.dynamodb.table.table-api",
    });
    expect(write?.iamEffects).toEqual([
      expect.objectContaining({
        actions: [
          "dynamodb:DeleteItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
        ],
        id: "aws.lambda.iam.dynamodb-write",
      }),
    ]);
  });

  it("derives useful root and parent-required categories from placement metadata", () => {
    const categoryByPlacement = {
      allowed: "root-placeable",
      forbidden: "parent-required",
      required: "root-placeable",
    } as const;

    for (const source of awsCatalogV1.listServices()) {
      const service = awsEditorCatalog.services.find(
        (candidate) => candidate.serviceType === source.id,
      );
      expect(service?.placement.rootPlacement, source.id).toBe(
        source.placement.rootPlacement,
      );
      expect(service?.category.id, source.id).toBe(
        categoryByPlacement[source.placement.rootPlacement],
      );
    }
  });

  it("uses validated catalog defaults and keeps unsafe required input unavailable", () => {
    const policy = awsEditorCatalog.services.find(
      (service) => service.serviceType === "aws.iam.policy-statement",
    );
    const lambda = awsEditorCatalog.services.find(
      (service) => service.serviceType === "aws.lambda.function",
    );

    for (const service of awsEditorCatalog.services) {
      const sourceDefaults = awsCatalogV1.validateConfiguration(
        service.serviceType,
        {},
      );
      expect(service.configuration.defaults.kind, service.serviceType).toBe(
        sourceDefaults.success ? "ready" : "unavailable",
      );
      if (sourceDefaults.success) {
        expect(service.configuration.defaults, service.serviceType).toEqual({
          kind: "ready",
          values: sourceDefaults.values,
        });
      }
    }
    expect(policy?.configuration.defaults.kind).toBe("unavailable");
    if (policy?.configuration.defaults.kind !== "unavailable") {
      throw new Error("Expected unavailable policy statement defaults.");
    }
    expect(policy.configuration.defaults.reason).toMatch(
      /^Required catalog input has no safe default: \$\.values\.[A-Za-z0-9_-]+\.$/u,
    );
    expect(lambda?.configuration.defaults).toMatchObject({
      kind: "ready",
      values: {
        architecture: { kind: "string", value: "arm64" },
        runtime: { kind: "string", value: "nodejs24.x" },
        tracingEnabled: { kind: "boolean", value: true },
      },
    });
  });

  it("consumes exact generated AWS dock presentation without deriving production groups", () => {
    const lambda = awsEditorCatalog.services.find(
      (service) => service.serviceType === "aws.lambda.function",
    );
    const source = awsConnectionPresentationV1.requireServicePresentation(
      "aws.lambda.function",
    );
    if (lambda === undefined) {
      throw new Error("Expected the Lambda editor projection.");
    }

    const direction = {
      "input-only": "input",
      "output-only": "output",
      mixed: "mixed",
    } as const;
    expect(lambda.connectionGroups).toHaveLength(source.docks.length);
    expect(
      lambda.connectionGroups
        ?.map((group) => ({
          allowsMultipleEdges: group.allowsMultipleEdges,
          cardinality: group.cardinality,
          category: group.category,
          containsExclusiveRelationships: group.containsExclusiveRelationships,
          description: group.description,
          direction: group.direction,
          guidedAssistance: group.guidedAssistance,
          id: group.id,
          label: group.label,
          order: group.order,
          portIds: group.portIds,
          professionalMetadata: group.professionalMetadata,
          side: group.side,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    ).toEqual(
      source.docks
        .map((dock) => ({
          allowsMultipleEdges: dock.allowsMultipleEdges,
          cardinality: dock.cardinality,
          category: dock.category,
          containsExclusiveRelationships: dock.containsExclusiveRelationships,
          description: dock.description,
          direction: direction[dock.directionPolicy],
          guidedAssistance: dock.guidedExplanation,
          id: dock.id,
          label: dock.label,
          order: dock.order,
          portIds: dock.portIds,
          professionalMetadata: dock.professionalExplanation,
          side: dock.placement,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    );
    const lambdaGroups = lambda.connectionGroups ?? [];
    expect(
      lambdaGroups.filter((group) => group.direction === "input"),
    ).toHaveLength(5);
    expect(
      lambdaGroups.filter((group) => group.direction === "output"),
    ).toHaveLength(5);
    expect(
      lambdaGroups.every(
        (group) =>
          (group.direction === "input" && group.side === "left") ||
          (group.direction === "output" && group.side === "right"),
      ),
    ).toBe(true);
    expect(
      lambdaGroups.find(
        (group) => group.id === "aws.lambda.function.dock.invocation",
      ),
    ).toMatchObject({
      direction: "output",
      label: "Invokes",
      side: "right",
    });
    expect(
      awsEditorCatalog.relationships?.find(
        (relationship) =>
          relationship.descriptorId ===
          "aws.apigateway.http-api-invokes-lambda",
      )?.presentationLabel,
    ).toBe(
      awsConnectionPresentationV1.relationshipLabel(
        "aws.apigateway.http-api-invokes-lambda",
      ),
    );
  });

  it("fails closed instead of deriving docks when presentation identity is stale", () => {
    const artifact = {
      ...structuredClone(awsConnectionPresentationV1.artifact),
      catalog: {
        ...structuredClone(awsConnectionPresentationV1.artifact.catalog),
        digest:
          "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
    };
    const catalog = adaptProviderCatalogForEditor(awsCatalogV1, { artifact });

    expect(
      catalog.services.every(
        (service) => service.connectionGroups?.length === 0,
      ),
    ).toBe(true);
    expect(
      catalog.relationships?.every(
        (relationship) => relationship.presentationLabel === undefined,
      ),
    ).toBe(true);
  });

  it("projects exact six-part readiness and owner-slot bindings", () => {
    const role = awsEditorCatalog.services.find(
      (service) => service.serviceType === "aws.iam.role",
    );
    const policyDocument = awsEditorCatalog.services.find(
      (service) => service.serviceType === "aws.iam.policy-document",
    );
    const source =
      awsServiceExtensionV1.requireServiceExtension("aws.iam.role");

    expect(policyDocument?.deployable).toBe(false);
    expect(role?.targetReadiness).toEqual(source.targetReadiness);
    expect(
      role?.ownedConfigurationSlots?.map((slot) => slot.displayName),
    ).toEqual(source.ownedConfigurationSlots.map((slot) => slot.displayName));
    expect(
      role?.ownedConfigurationSlots?.find(
        (slot) => slot.id === "aws.iam.role.slot.trust-policy",
      ),
    ).toMatchObject({
      allowedOwnership: source.ownedConfigurationSlots.find(
        (slot) => slot.id === "aws.iam.role.slot.trust-policy",
      )?.allowedOwnership,
      cardinality: {
        enforcement: "provider-rule",
        maximum: 1,
        minimum: 1,
      },
      generatedAdoption: "allowed",
      graphBinding: {
        configurationEndpoint: "source",
        configurationPortId: "aws.iam.policy-document.role-trust-policy",
        configurationServiceType: "aws.iam.policy-document",
        ownerPortId: "aws.iam.role.trust-policy",
        ownershipRelationshipType: "aws.iam.role-owns-trust-policy",
      },
      policyKinds: ["trust"],
      targetReadiness: {
        cloudformation: { status: "supported" },
        configuration: { status: "supported" },
        generatedCode: { status: "not-applicable" },
        modeling: { status: "supported" },
        terraform: { status: "supported" },
        validation: { status: "supported" },
      },
    });
  });

  it("fails closed when the service-extension catalog binding is stale", () => {
    const artifact = {
      ...structuredClone(awsServiceExtensionV1.artifact),
      catalog: {
        ...structuredClone(awsServiceExtensionV1.artifact.catalog),
        digest:
          "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
    };
    const catalog = adaptProviderCatalogForEditor(
      awsCatalogV1,
      awsConnectionPresentationV1,
      { artifact },
    );

    expect(
      catalog.services.every(
        (service) =>
          service.targetReadiness === undefined &&
          service.ownedConfigurationSlots === undefined,
      ),
    ).toBe(true);
  });

  it.each(["missing", "ambiguous"] as const)(
    "fails closed when an ownership relationship is %s",
    (relationshipState) => {
      const relationshipType = "aws.iam.role-owns-trust-policy";
      const rules = structuredClone(awsCatalogV1.listConnectionRules());
      const trustRule = rules.find(
        (rule) => rule.relationshipType === relationshipType,
      );
      const source: ProviderCatalogEditorSource = {
        artifact: structuredClone(awsCatalogV1.artifact),
        listConnectionRules: () => [
          ...rules.filter((rule) => rule.relationshipType !== relationshipType),
          ...(relationshipState === "ambiguous" && trustRule !== undefined
            ? [trustRule, structuredClone(trustRule)]
            : []),
        ],
        listServices: () => structuredClone(awsCatalogV1.listServices()),
        validateConfiguration: (serviceId, values) =>
          awsCatalogV1.validateConfiguration(serviceId, values),
      };
      const catalog = adaptProviderCatalogForEditor(
        source,
        awsConnectionPresentationV1,
        awsServiceExtensionV1,
      );

      expect(
        catalog.services.every(
          (service) => service.ownedConfigurationSlots === undefined,
        ),
      ).toBe(true);
    },
  );

  it("turns an invalid injected entry into a stable disabled fallback", () => {
    const validService = structuredClone(awsCatalogV1.listServices()[0]);
    const catalog = adaptProviderCatalogForEditor(
      injectedSource([
        validService,
        {
          displayName: "Broken catalog service",
        },
      ]),
    );

    expect(catalog.services).toHaveLength(1);
    expect(catalog.invalidEntries).toEqual([
      {
        id: "invalid-catalog-entry-0002",
        reason:
          "This catalog entry is malformed or incomplete and cannot be added.",
        title: "Broken catalog service",
      },
    ]);
    expect(Object.isFrozen(catalog.invalidEntries[0])).toBe(true);
  });

  it("fails closed when a configuration property has no matching UI hint", () => {
    const service = structuredClone(
      awsCatalogV1
        .listServices()
        .find((candidate) => candidate.id === "aws.lambda.function"),
    );
    if (service === undefined) {
      throw new Error("Expected the Lambda service definition.");
    }
    service.configuration.uiHints = service.configuration.uiHints.slice(1);

    const catalog = adaptProviderCatalogForEditor(injectedSource([service]));

    expect(catalog.services).toEqual([]);
    expect(catalog.invalidEntries).toEqual([
      {
        id: "invalid-catalog-entry-0001",
        reason:
          "This catalog entry is malformed or incomplete and cannot be added.",
        title: "Lambda function",
      },
    ]);
  });

  it("rejects malformed contract identifiers and required placement metadata", () => {
    const invalidServiceId = structuredClone(
      awsCatalogV1.listServices()[0],
    ) as unknown as Record<string, unknown>;
    invalidServiceId["id"] = "AWS Lambda";

    const invalidIconId = structuredClone(
      awsCatalogV1.listServices()[1],
    ) as unknown as Record<string, unknown>;
    invalidIconId["iconId"] = "AWS Lambda";

    const missingRegionConstraint = structuredClone(
      awsCatalogV1.listServices()[2],
    ) as unknown as Record<string, unknown>;
    const placement = missingRegionConstraint["placement"];
    if (typeof placement !== "object" || placement === null) {
      throw new Error("Expected catalog placement metadata.");
    }
    delete (placement as Record<string, unknown>)["regionConstraint"];

    const catalog = adaptProviderCatalogForEditor(
      injectedSource([
        invalidServiceId,
        invalidIconId,
        missingRegionConstraint,
      ]),
    );

    expect(catalog.services).toHaveLength(0);
    expect(catalog.invalidEntries).toEqual([
      {
        id: "invalid-catalog-entry-0001",
        reason:
          "This catalog entry is malformed or incomplete and cannot be added.",
        title: invalidServiceId["displayName"],
      },
      {
        id: "invalid-catalog-entry-0002",
        reason:
          "This catalog entry is malformed or incomplete and cannot be added.",
        title: invalidIconId["displayName"],
      },
      {
        id: "invalid-catalog-entry-0003",
        reason:
          "This catalog entry is malformed or incomplete and cannot be added.",
        title: missingRegionConstraint["displayName"],
      },
    ]);
  });

  it("retains valid provider-defined Region placement for fail-closed command handling", () => {
    const service = structuredClone(
      awsCatalogV1
        .listServices()
        .find((candidate) => candidate.id === "aws.lambda.function"),
    ) as unknown as Record<string, unknown>;
    const placement = service["placement"];
    if (typeof placement !== "object" || placement === null) {
      throw new Error("Expected catalog placement metadata.");
    }
    (placement as Record<string, unknown>)["regionConstraint"] =
      "provider-defined";

    const catalog = adaptProviderCatalogForEditor(injectedSource([service]));

    expect(catalog.services[0]?.placement.regionConstraint).toBe(
      "provider-defined",
    );
  });

  it("distinguishes an essential service-list failure from an empty catalog", () => {
    const source = injectedSource([]);
    const catalog = adaptProviderCatalogForEditor({
      ...source,
      listServices: () => {
        throw new Error("Synthetic catalog failure.");
      },
    });

    expect(catalog.services).toEqual([]);
    expect(catalog.serviceListState).toEqual({
      kind: "failed",
      reason:
        "The bundled catalog service list could not be loaded. No service can be added.",
    });
  });

  it("validates the complete catalog artifact contract before projection", () => {
    const source = injectedSource([]);
    const invalidArtifact = structuredClone(source.artifact) as Record<
      string,
      unknown
    >;
    invalidArtifact["kind"] = "cloudmarkup.invalid-catalog";

    expect(() =>
      adaptProviderCatalogForEditor({
        ...source,
        artifact: invalidArtifact,
      }),
    ).toThrow("The provider catalog artifact is invalid.");
  });

  it("gives duplicated catalog identities distinct stable fallback IDs", () => {
    const sourceService = awsCatalogV1
      .listServices()
      .find((service) => service.id === "aws.apigateway.http-api");
    if (sourceService === undefined) {
      throw new Error("Expected the API Gateway catalog definition.");
    }
    const duplicatedService = structuredClone(sourceService);
    const catalog = adaptProviderCatalogForEditor(
      injectedSource([
        structuredClone(duplicatedService),
        structuredClone(duplicatedService),
      ]),
    );

    expect(catalog.services).toHaveLength(0);
    expect(catalog.invalidEntries.map((entry) => entry.id)).toEqual([
      "duplicate-catalog-entry-aws-apigateway-http-api-0001",
      "duplicate-catalog-entry-aws-apigateway-http-api-0002",
    ]);
  });
});
