import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

export const regionBoundary = defineProviderServiceV1({
  id: "aws.region.boundary",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "AWS Region",
  description:
    "A provider-semantic boundary that pins regional AWS resources to one explicit Region.",
  nodeKind: {
    kind: "boundary",
    boundaryType: "aws.region.boundary",
    containmentModel: "provider-semantic",
  },
  iconId: "aws.cloudmarkup.icons.region",
  placement: {
    rootPlacement: "required",
    allowedParentTypes: [],
    regionConstraint: "provider-defined",
  },
  configuration: {
    schemaId: "aws.region.boundary.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.region.boundary.configuration:1.0.0",
      type: "object",
      title: "AWS Region configuration",
      description:
        "The explicit AWS Region name used as the placement context for contained resources.",
      additionalProperties: false,
      properties: {
        regionName: {
          type: "string",
          minLength: 8,
          maxLength: 32,
          pattern: "^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]+$",
        },
      },
      required: ["regionName"],
    },
    uiHints: [
      {
        property: "regionName",
        control: "text",
        label: "Region name",
        helpText:
          "Enter an exact Region such as us-east-1. CloudMarkup does not query an AWS account for Regions.",
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
      id: "aws.region.boundary.vpc-placement",
      displayName: "VPC placement",
      description: "Places VPC boundaries in this Region.",
      direction: "output",
      capability: "aws.region.vpc-placement",
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
      "Groups regional AWS architecture without pretending the Region is a deployable resource.",
    guidedExplanation:
      "A Region is the broad AWS location for a design. Place each VPC under one Region so later networking choices have an explicit location, but treat the boundary as design context rather than infrastructure that CloudMarkup creates.",
    professionalExplanation:
      "This provider-semantic boundary carries an explicit Region name and scopes contained VPCs. It has no Terraform or CloudFormation resource mapping, and availability remains unknown until a reviewed, version-bound inventory exists.",
    considerations: [
      "Connections: Place each VPC under exactly one Region; cross-Region networking requires separate reviewed semantics.",
      "Security: Region choice affects residency and service availability, but this boundary grants no access and holds no credentials.",
      "Cost: Prices and inter-Region data transfer vary by Region; compare the exact workload location before export.",
      "Operations: Choose Regions from latency, resilience, compliance, and recovery requirements, then record cross-Region plans separately.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.region.documentation.regions-and-zones",
        title: "AWS Regions and Availability Zones",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions-availability-zones.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.region.boundary.unsupported.live-discovery",
      title: "Live Region discovery",
      explanation:
        "The static catalog does not call AWS, inspect an account, or claim that an entered Region supports every modeled service.",
    },
    {
      id: "aws.region.boundary.unsupported.edge-zone-containment",
      title: "Local, Wavelength, and Outpost zones",
      explanation:
        "Local Zones, Wavelength Zones, Outposts, partitions, and cross-Region topology need separate reviewed placement contracts.",
    },
  ],
  mappings: [],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound AWS Region and service availability inventory is bundled with this catalog.",
  },
});
