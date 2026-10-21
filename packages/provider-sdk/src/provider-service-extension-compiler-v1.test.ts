import { semanticVersionSchema } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { defineProviderServiceV1 } from "./catalog-contract-v1.js";
import { compileProviderCatalogV1 } from "./compiler.js";
import {
  defineProviderOwnedConfigurationSlotV1,
  type ProviderOwnedConfigurationSlotV1Input,
} from "./provider-extension-contract-v1.js";
import {
  defineProviderServiceExtensionSourceV1,
  defineProviderServiceExtensionV1,
} from "./provider-service-extension-contract-v1.js";
import {
  ProviderServiceExtensionCompilationError,
  compileProviderServiceExtensionV1,
  createProviderServiceExtensionAccessorsV1,
  renderProviderServiceExtensionAccessorModuleV1,
} from "./provider-service-extension-compiler-v1.js";

function targetReadiness() {
  const supported = {
    status: "supported" as const,
    reason: "The synthetic fixture supports this bounded target.",
  };
  return {
    modeling: supported,
    configuration: supported,
    validation: supported,
    terraform: {
      status: "pending" as const,
      reason: "Terraform remains metadata-only in this fixture.",
    },
    cloudformation: {
      status: "pending" as const,
      reason: "CloudFormation remains metadata-only in this fixture.",
    },
    generatedCode: {
      status: "not-applicable" as const,
      reason: "The fixture does not produce application code.",
    },
  };
}

function semanticCatalog(ownershipRuleCount = 0) {
  return compileProviderCatalogV1({
    contractVersion: 1,
    provider: {
      id: "example.cloud",
      displayName: "Example Cloud",
      description: "A synthetic provider for service extension tests.",
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
      description: "A synthetic semantic catalog.",
      architectureDocumentSchemaVersions: [1],
      runtimeRetrieval: "forbidden",
    },
    services: [
      {
        id: "example.cloud.service",
        definitionVersion: "1.0.0",
        supportLevel: "proof",
        displayName: "Example service",
        description: "A synthetic graph service.",
        nodeKind: {
          kind: "resource",
          resourceType: "example.cloud.resource",
          deployable: true,
        },
        iconId: "example.cloud.icons.service",
        placement: {
          rootPlacement: "allowed",
          allowedParentTypes: [],
          regionConstraint: "not-applicable",
        },
        configuration: {
          schemaId: "example.cloud.configuration.service",
          schemaVersion: "1.0.0",
          jsonSchema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            $id: "urn:cloudmarkup:configuration:example.cloud.configuration.service:1.0.0",
            type: "object",
            title: "Example service configuration",
            additionalProperties: false,
            properties: {},
            required: [],
          },
          uiHints: [],
        },
        ports: [
          {
            id: "example.cloud.port.owns-configuration",
            displayName: "Owns configuration",
            description: "Owns a graph-backed configuration resource.",
            direction: "output",
            capability: "example.cloud.capability.owns-configuration",
            category: "network-and-security",
            cardinality: "many",
            required: false,
          },
          {
            id: "example.cloud.port.owned-configuration",
            displayName: "Owned configuration",
            description: "Is owned by a graph resource.",
            direction: "input",
            capability: "example.cloud.capability.owned-configuration",
            category: "network-and-security",
            cardinality: "many",
            required: false,
          },
        ],
        validationRuleIds: [],
        education: {
          summary: "Synthetic service education.",
          guidedExplanation: "Guided synthetic service explanation.",
          professionalExplanation:
            "Professional synthetic service explanation.",
          considerations: [],
          documentation: [],
        },
        unsupportedCapabilities: [],
        mappings: [],
        regionAvailability: {
          state: "unknown",
          reason: "Synthetic tests do not claim provider availability.",
        },
      },
    ],
    connectionRules: Array.from({ length: ownershipRuleCount }, (_, index) => ({
      id: `example.cloud.connection.owns-configuration-${String(index)}`,
      ruleVersion: "1.0.0",
      relationshipType: "example.cloud.owns-configuration",
      category: "network-and-security",
      source: {
        serviceId: "example.cloud.service",
        portId: "example.cloud.port.owns-configuration",
      },
      target: {
        serviceId: "example.cloud.service",
        portId: "example.cloud.port.owned-configuration",
      },
      maximumConnectionsPerSource: 10,
      maximumConnectionsPerTarget: 10,
      maximumConnectionsPerEndpointPair: 10,
      configuration: {
        schemaId: `example.cloud.connection.owns-configuration-${String(index)}`,
        schemaVersion: "1.0.0",
        jsonSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          $id: `urn:cloudmarkup:configuration:example.cloud.connection.owns-configuration-${String(index)}:1.0.0`,
          type: "object",
          title: "Synthetic ownership connection",
          additionalProperties: false,
          properties: {},
          required: [],
        },
        uiHints: [],
      },
      questions: [],
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
          "The synthetic service-extension fixture has no executable provider resolver.",
      },
      validationRuleIds: [],
      education: {
        summary: "Synthetic ownership relationship.",
        guidedExplanation: "The service owns this graph-backed configuration.",
        professionalExplanation:
          "The exact relationship binds an owner to configuration state.",
        considerations: [],
        documentation: [],
      },
    })),
    validationRules: [],
    migrations: [],
  });
}

function serviceExtensionSource(catalog = semanticCatalog().artifact) {
  return defineProviderServiceExtensionSourceV1({
    contractVersion: 1,
    catalog: {
      id: catalog.catalog.id,
      version: catalog.catalog.version,
      digest: catalog.digest,
    },
    services: [
      {
        serviceId: "example.cloud.service",
        targetReadiness: targetReadiness(),
        ownedConfigurationSlots: [],
      },
    ],
  });
}

function distinctOwnershipCatalog() {
  const base = semanticCatalog(1).artifact;
  const source = {
    contractVersion: base.contractVersion,
    provider: structuredClone(base.provider),
    catalog: structuredClone(base.catalog),
    services: structuredClone(base.services),
    connectionRules: structuredClone(base.connectionRules),
    validationRules: structuredClone(base.validationRules),
    migrations: structuredClone(base.migrations),
  };
  const owner = source.services[0];
  const relationship = source.connectionRules[0];
  if (owner === undefined || relationship === undefined) {
    throw new Error("The ownership fixture must declare a service and rule.");
  }
  const ownerPort = owner.ports[0];
  const configurationPort = owner.ports[1];
  if (ownerPort === undefined || configurationPort === undefined) {
    throw new Error("The ownership fixture must declare both endpoint ports.");
  }
  const configuration = defineProviderServiceV1({
    ...owner,
    id: "example.cloud.configuration",
    nodeKind: {
      kind: "resource",
      resourceType: "example.cloud.configuration-resource",
      deployable: false,
    },
    configuration: {
      schemaId: "example.cloud.configuration.owned",
      schemaVersion: "1.0.0",
      jsonSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:cloudmarkup:configuration:example.cloud.configuration.owned:1.0.0",
        type: "object",
        title: "Owned configuration",
        additionalProperties: false,
        properties: {
          policyKind: {
            type: "string",
            enum: ["identity-inline"],
          },
        },
        required: ["policyKind"],
      },
      uiHints: [
        {
          property: "policyKind",
          control: "select",
          label: "Policy kind",
          order: 0,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "none",
        },
      ],
    },
    ports: [
      {
        ...configurationPort,
        direction: "output",
        cardinality: "one",
        required: false,
      },
    ],
  });
  source.services[0] = defineProviderServiceV1({
    ...owner,
    ports: [
      {
        ...ownerPort,
        direction: "input",
        cardinality: "many",
        required: false,
      },
    ],
  });
  source.services.push(configuration);
  relationship.source = {
    serviceId: configuration.id,
    portId: configurationPort.id,
  };
  relationship.target = {
    serviceId: owner.id,
    portId: ownerPort.id,
  };
  relationship.maximumConnectionsPerSource = 1;
  relationship.maximumConnectionsPerTarget = 10;
  relationship.maximumConnectionsPerEndpointPair = 1;
  return compileProviderCatalogV1(source);
}

function ownedConfigurationSlot(
  overrides: Partial<ProviderOwnedConfigurationSlotV1Input> = {},
) {
  return defineProviderOwnedConfigurationSlotV1({
    id: "example.cloud.slot.policy",
    slotVersion: "1.0.0",
    configurationKind: "example.cloud.configuration.policy",
    displayName: "Policy",
    description: "A graph-backed owned policy configuration.",
    graphBinding: {
      configurationServiceId: "example.cloud.configuration",
      ownershipRelationshipType: "example.cloud.owns-configuration",
    },
    cardinality: {
      minimum: 0,
      maximum: "many",
      enforcement: "provider-rule",
    },
    allowedOwnership: ["user"],
    generatedAdoption: "not-applicable",
    policyKinds: ["identity-inline"],
    targetReadiness: targetReadiness(),
    guidedExplanation: "Add only the policy this service needs.",
    professionalExplanation:
      "The slot resolves to one exact catalog ownership relationship.",
    ...overrides,
  });
}

function distinctOwnershipExtensionSource(
  catalog = distinctOwnershipCatalog().artifact,
) {
  const source = structuredClone(serviceExtensionSource(catalog));
  const owner = source.services[0];
  if (owner === undefined) {
    throw new Error("The extension fixture must declare its owner service.");
  }
  owner.ownedConfigurationSlots.push(ownedConfigurationSlot());
  source.services.push(
    defineProviderServiceExtensionV1({
      serviceId: "example.cloud.configuration",
      targetReadiness: targetReadiness(),
      ownedConfigurationSlots: [],
    }),
  );
  return source;
}

function issueCodes(action: () => unknown): string[] {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderServiceExtensionCompilationError);
    return (error as ProviderServiceExtensionCompilationError).issues.map(
      (issue) => issue.code,
    );
  }
  throw new Error("Expected service extension compilation to fail.");
}

describe("provider service extension compiler v1", () => {
  it("compiles exact service coverage with deterministic accessors", () => {
    const catalog = semanticCatalog();
    const compilation = compileProviderServiceExtensionV1(
      serviceExtensionSource(),
      catalog.artifact,
    );
    const accessors = createProviderServiceExtensionAccessorsV1(
      compilation.artifact,
    );

    expect(compilation.hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(compilation.artifact.catalog.digest).toBe(catalog.artifact.digest);
    expect(
      accessors.requireServiceExtension("example.cloud.service").targetReadiness
        .terraform.status,
    ).toBe("pending");
    expect(
      accessors.getOwnedConfigurationSlots("example.cloud.service"),
    ).toEqual([]);
    expect(
      accessors.getOwnedConfigurationSlot(
        "example.cloud.service",
        "example.cloud.slot.unknown",
      ),
    ).toBe(undefined);

    const moduleSource = renderProviderServiceExtensionAccessorModuleV1(
      compilation,
      {
        artifactImportPath: "./generated/service-extension-v1.json",
        artifactExportName: "serviceExtensionArtifactV1",
        accessorsExportName: "serviceExtensionAccessorsV1",
        digestExportName: "serviceExtensionDigestV1",
      },
    );
    expect(moduleSource).toContain("createProviderServiceExtensionAccessorsV1");
    expect(moduleSource).toContain(compilation.hash);
  });

  it("fails closed on binding and exact service coverage mismatches", () => {
    const catalog = semanticCatalog();
    const mismatched = structuredClone(serviceExtensionSource());
    mismatched.catalog.version = semanticVersionSchema.parse("2.0.0");
    expect(
      issueCodes(() =>
        compileProviderServiceExtensionV1(mismatched, catalog.artifact),
      ),
    ).toContain("catalog-binding-mismatch");

    const missing = structuredClone(serviceExtensionSource());
    missing.services = [];
    expect(
      issueCodes(() =>
        compileProviderServiceExtensionV1(missing, catalog.artifact),
      ),
    ).toContain("missing-service-extension");
  });

  it("rejects a semantic catalog artifact whose content no longer matches its digest", () => {
    const catalog = semanticCatalog();
    const tamperedCatalog = structuredClone(catalog.artifact);
    const firstService = tamperedCatalog.services[0];
    if (firstService === undefined) {
      throw new Error("The semantic fixture must declare a service.");
    }
    firstService.displayName = "Tampered service";

    expect(
      issueCodes(() =>
        compileProviderServiceExtensionV1(
          serviceExtensionSource(),
          tamperedCatalog,
        ),
      ),
    ).toContain("invalid-catalog-artifact");
  });

  it("rejects slots without a catalog relationship binding", () => {
    const catalog = semanticCatalog();
    const source = structuredClone(serviceExtensionSource());
    source.services[0]?.ownedConfigurationSlots.push(
      ownedConfigurationSlot({
        graphBinding: {
          configurationServiceId: "example.cloud.service",
          ownershipRelationshipType: "example.cloud.owns-policy",
        },
        professionalExplanation:
          "The slot requires an exact catalog ownership relationship.",
      }),
    );

    expect(
      issueCodes(() =>
        compileProviderServiceExtensionV1(source, catalog.artifact),
      ),
    ).toContain("unknown-ownership-relationship");
  });

  it("rejects an ownership binding that resolves to multiple catalog rules", () => {
    const catalog = semanticCatalog(2);
    const source = structuredClone(serviceExtensionSource(catalog.artifact));
    source.services[0]?.ownedConfigurationSlots.push(
      ownedConfigurationSlot({
        graphBinding: {
          configurationServiceId: "example.cloud.service",
          ownershipRelationshipType: "example.cloud.owns-configuration",
        },
        professionalExplanation:
          "The slot must resolve to one exact catalog relationship.",
      }),
    );

    expect(
      issueCodes(() =>
        compileProviderServiceExtensionV1(source, catalog.artifact),
      ),
    ).toContain("ambiguous-ownership-relationship");
  });

  it("reconciles a slot with its exact ownership endpoints and supported kind", () => {
    const catalog = distinctOwnershipCatalog();
    const compilation = compileProviderServiceExtensionV1(
      distinctOwnershipExtensionSource(catalog.artifact),
      catalog.artifact,
    );

    expect(
      compilation.artifact.services.find(
        (service) => service.serviceId === "example.cloud.service",
      )?.ownedConfigurationSlots[0]?.configurationKind,
    ).toBe("example.cloud.configuration.policy");
  });

  it("rejects slot cardinality that drifts from the exact ownership rule", () => {
    const catalog = distinctOwnershipCatalog();
    const source = distinctOwnershipExtensionSource(catalog.artifact);
    const slot = source.services[0]?.ownedConfigurationSlots[0];
    if (slot === undefined) {
      throw new Error("The extension fixture must declare its owned slot.");
    }
    slot.cardinality.maximum = 1;

    expect(
      issueCodes(() =>
        compileProviderServiceExtensionV1(source, catalog.artifact),
      ),
    ).toContain("ownership-cardinality-mismatch");
  });

  it("rejects unsupported and ambiguously bound owned-configuration kinds", () => {
    const catalog = distinctOwnershipCatalog();
    const source = distinctOwnershipExtensionSource(catalog.artifact);
    const owner = source.services[0];
    const slot = owner?.ownedConfigurationSlots[0];
    if (owner === undefined || slot === undefined) {
      throw new Error("The extension fixture must declare its owned slot.");
    }
    slot.policyKinds = ["trust"];
    owner.ownedConfigurationSlots.push(
      ownedConfigurationSlot({
        id: "example.cloud.slot.second-policy",
        policyKinds: ["trust"],
      }),
    );

    const codes = issueCodes(() =>
      compileProviderServiceExtensionV1(source, catalog.artifact),
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "duplicate-configuration-kind-binding",
        "duplicate-policy-kind-binding",
        "unsupported-policy-kind",
      ]),
    );
  });
});
