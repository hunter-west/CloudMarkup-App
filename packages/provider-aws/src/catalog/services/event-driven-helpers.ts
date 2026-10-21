import type { ProviderServiceDefinitionV1Input } from "@cloudmarkup/provider-sdk";

type Mapping = ProviderServiceDefinitionV1Input["mappings"][number];
type ConfigurationBinding = Mapping["configurationBindings"][number];
type PortBinding = Mapping["portBindings"][number];

export const eventDrivenValidationRuleIds = Object.freeze([
  "aws.cloudmarkup.validation.connection-cardinality",
  "aws.cloudmarkup.validation.compiler-readiness",
  "aws.cloudmarkup.validation.connection-questions",
  "aws.cloudmarkup.validation.event-delivery",
  "aws.cloudmarkup.validation.event-topology",
  "aws.cloudmarkup.validation.network-placement",
  "aws.cloudmarkup.validation.region-availability",
]);

export const eventDrivenRegionAvailability = Object.freeze({
  state: "unknown" as const,
  reason:
    "No reviewed, version-bound AWS regional availability inventory is bundled for this event-driven catalog slice.",
});

export function eventMetadataMappings(
  input: Readonly<{
    mappingIdPrefix: string;
    terraformResourceType: string;
    cloudFormationTypeName: string;
    terraformConfigurationBindings: readonly ConfigurationBinding[];
    cloudFormationConfigurationBindings: readonly ConfigurationBinding[];
    terraformPortBindings: readonly PortBinding[];
    cloudFormationPortBindings: readonly PortBinding[];
    semanticConfigurationKeys?: readonly string[];
    terraformProjection?: Mapping["projection"];
    cloudFormationProjection?: Mapping["projection"];
  }>,
): ProviderServiceDefinitionV1Input["mappings"] {
  return [
    {
      mappingId: `${input.mappingIdPrefix}.terraform`,
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: input.terraformResourceType,
      configurationBindings: [...input.terraformConfigurationBindings],
      portBindings: [...input.terraformPortBindings],
      ...(input.semanticConfigurationKeys === undefined
        ? {}
        : { semanticConfigurationKeys: [...input.semanticConfigurationKeys] }),
      ...(input.terraformProjection === undefined
        ? {}
        : { projection: input.terraformProjection }),
    },
    ...(input.cloudFormationProjection?.kind === "owner-nested-block"
      ? []
      : [
          {
            mappingId: `${input.mappingIdPrefix}.cloudformation`,
            declarationVersion: 1 as const,
            implementationStatus: "metadata-only" as const,
            target: "cloudformation" as const,
            kind: "resource" as const,
            typeName: input.cloudFormationTypeName,
            configurationBindings: [
              ...input.cloudFormationConfigurationBindings,
            ],
            portBindings: [...input.cloudFormationPortBindings],
            ...(input.semanticConfigurationKeys === undefined
              ? {}
              : {
                  semanticConfigurationKeys: [
                    ...input.semanticConfigurationKeys,
                  ],
                }),
            ...(input.cloudFormationProjection === undefined
              ? {}
              : { projection: input.cloudFormationProjection }),
          },
        ]),
  ];
}

export function internalEventConfiguration(
  input: Readonly<{
    serviceId: string;
    resourceType: string;
    displayName: string;
    description: string;
    ownerServiceId: string;
    ownerRelationshipType: string;
    configuration: ProviderServiceDefinitionV1Input["configuration"];
    ports: ProviderServiceDefinitionV1Input["ports"];
    education: ProviderServiceDefinitionV1Input["education"];
    unsupportedCapabilities: ProviderServiceDefinitionV1Input["unsupportedCapabilities"];
    mappings: ProviderServiceDefinitionV1Input["mappings"];
  }>,
): ProviderServiceDefinitionV1Input {
  return {
    id: input.serviceId,
    definitionVersion: "1.0.0",
    supportLevel: "production-oriented",
    displayName: input.displayName,
    description: input.description,
    nodeKind: {
      kind: "resource",
      resourceType: input.resourceType,
      deployable: false,
    },
    iconId: null,
    placement: {
      rootPlacement: "forbidden",
      allowedParentTypes: [
        {
          serviceId: input.ownerServiceId,
          relationshipType: input.ownerRelationshipType,
        },
      ],
      maximumDepth: 2,
      regionConstraint: "same-region",
    },
    configuration: input.configuration,
    ports: input.ports,
    validationRuleIds: [...eventDrivenValidationRuleIds],
    education: input.education,
    unsupportedCapabilities: input.unsupportedCapabilities,
    mappings: input.mappings,
    regionAvailability: eventDrivenRegionAvailability,
  };
}
