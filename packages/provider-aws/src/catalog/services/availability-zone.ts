import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

export const availabilityZone = defineProviderServiceV1({
  id: "aws.ec2.availability-zone",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "Availability Zone",
  description:
    "A provider-semantic failure-domain boundary for subnet placement inside one VPC.",
  nodeKind: {
    kind: "boundary",
    boundaryType: "aws.ec2.availability-zone",
    containmentModel: "provider-semantic",
  },
  iconId: "aws.cloudmarkup.icons.availability-zone",
  placement: {
    rootPlacement: "forbidden",
    allowedParentTypes: [
      {
        serviceId: "aws.ec2.vpc",
        relationshipType: "aws.ec2.vpc-contains-availability-zone",
      },
    ],
    maximumDepth: 3,
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.ec2.availability-zone.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.ec2.availability-zone.configuration:1.0.0",
      type: "object",
      title: "Availability Zone configuration",
      description:
        "The exact account-facing Availability Zone name used for subnet placement.",
      additionalProperties: false,
      properties: {
        zoneName: {
          type: "string",
          minLength: 9,
          maxLength: 33,
          pattern: "^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]+[a-z]$",
        },
      },
      required: ["zoneName"],
    },
    uiHints: [
      {
        property: "zoneName",
        control: "text",
        label: "Availability Zone name",
        helpText:
          "Enter an exact name such as us-east-1a. Lettered zone names can map to different physical zones across accounts.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
    ],
  },
  ports: [
    {
      id: "aws.ec2.availability-zone.vpc",
      displayName: "VPC",
      description: "Accepts the VPC boundary that contains this zone.",
      direction: "input",
      capability: "aws.ec2.vpc.availability-zone-placement",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.availability-zone.subnet-placement",
      displayName: "Subnets",
      description: "Places subnets in this one Availability Zone.",
      direction: "output",
      capability: "aws.ec2.availability-zone.subnet-placement",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
  ],
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.network-placement",
    "aws.cloudmarkup.validation.region-availability",
  ],
  education: {
    summary:
      "Represents one isolated AWS failure domain used to place subnets and spread workloads.",
    guidedExplanation:
      "An Availability Zone is a separate failure domain within a Region. Give each subnet exactly one zone, and use multiple zones when the workload must remain available during a zone-level disruption.",
    professionalExplanation:
      "This is placement metadata, not an AWS resource. The account-facing zone name is explicit, while cross-account physical-zone equivalence requires Availability Zone IDs that this bounded catalog does not yet model.",
    considerations: [
      "Connections: Place each subnet in exactly one Availability Zone and keep the zone inside the subnet's VPC.",
      "Security: A zone is not a security boundary; routing, security groups, identity, and encryption remain separate controls.",
      "Cost: Cross-zone data transfer and one-per-zone managed resources can materially change networking cost.",
      "Operations: Spread production workloads and required egress paths across zones instead of treating one zone as highly available.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.ec2.availability-zone.documentation.ids",
        title: "AWS Regions and Availability Zones",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions-availability-zones.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.ec2.availability-zone.unsupported.zone-id-portability",
      title: "Cross-account zone-ID portability",
      explanation:
        "This slice records a zone name only; it does not resolve stable Availability Zone IDs across different AWS accounts.",
    },
    {
      id: "aws.ec2.availability-zone.unsupported.extended-zones",
      title: "Local, Wavelength, and Outpost placement",
      explanation:
        "Local Zones, Wavelength Zones, Outposts, and zonal service-capacity discovery require separate provider semantics.",
    },
  ],
  mappings: [],
  regionAvailability: {
    state: "unknown",
    reason:
      "Availability Zones are account- and Region-scoped, and no reviewed version-bound zone inventory is bundled with this catalog.",
  },
});
