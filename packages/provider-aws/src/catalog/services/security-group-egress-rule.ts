import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";
import { securityGroupRuleDescriptionPattern } from "./security-group-description.js";

/** A graph-owned egress rule rendered only through its security group. */
export const securityGroupEgressRule = defineProviderServiceV1({
  id: "aws.ec2.security-group-egress-rule",
  definitionVersion: "1.1.0",
  supportLevel: "production-oriented",
  displayName: "Security group egress rule",
  description:
    "One bounded IPv4 outbound rule owned by a security group policy.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.ec2.security-group-egress-rule",
    deployable: false,
  },
  iconId: null,
  placement: {
    rootPlacement: "forbidden",
    allowedParentTypes: [
      {
        serviceId: "aws.ec2.security-group",
        relationshipType: "aws.ec2.security-group-owns-egress-rule",
      },
    ],
    maximumDepth: 2,
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.ec2.security-group-egress-rule.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.ec2.security-group-egress-rule.configuration:1.0.0",
      type: "object",
      title: "Security group egress rule configuration",
      description:
        "A protocol, port or ICMP range, IPv4 destination, and human-readable purpose.",
      additionalProperties: false,
      properties: {
        protocol: {
          type: "string",
          enum: ["tcp", "udp", "icmp", "-1"],
          default: "tcp",
        },
        fromPort: {
          type: "integer",
          default: 443,
          minimum: -1,
          maximum: 65535,
        },
        toPort: {
          type: "integer",
          default: 443,
          minimum: -1,
          maximum: 65535,
        },
        destinationIpv4Cidr: {
          type: "string",
          minLength: 9,
          maxLength: 18,
          pattern:
            "^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}/(?:[0-9]|[12][0-9]|3[0-2])$",
        },
        description: {
          type: "string",
          default: "Reviewed outbound traffic",
          minLength: 1,
          maxLength: 255,
          pattern: securityGroupRuleDescriptionPattern,
        },
      },
      required: [
        "protocol",
        "fromPort",
        "toPort",
        "destinationIpv4Cidr",
        "description",
      ],
    },
    uiHints: [
      {
        property: "protocol",
        control: "select",
        label: "Protocol",
        helpText:
          "Choose TCP, UDP, ICMP, or all protocols. All-protocol rules require -1 for both port fields.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "fromPort",
        control: "number",
        label: "From port or ICMP type",
        order: 1,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "toPort",
        control: "number",
        label: "To port or ICMP code",
        order: 2,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "destinationIpv4Cidr",
        control: "text",
        label: "Destination IPv4 CIDR",
        helpText:
          "Use the narrowest required destination. 0.0.0.0/0 permits outbound connections to any IPv4 destination.",
        order: 3,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "description",
        control: "textarea",
        label: "Purpose",
        helpText:
          "Use 1-255 ASCII letters, digits, spaces or ._-:/()#,@[]+=;{}!$*. Ampersands, line breaks and other characters are not supported in rule descriptions.",
        order: 4,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
    ],
  },
  ports: [
    {
      id: "aws.ec2.security-group-egress-rule.security-group",
      displayName: "Security group",
      description: "Provides this egress rule to its owning security group.",
      direction: "output",
      capability: "aws.ec2.security-group.egress-rule",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
  ],
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.network-placement",
    "aws.cloudmarkup.validation.region-availability",
    "aws.cloudmarkup.validation.security-group-policy",
  ],
  education: {
    summary:
      "Allows one reviewed IPv4 destination and protocol or port range out of a security group.",
    guidedExplanation:
      "Describe the destination and port the workload actually needs. Avoid relying on AWS's broad default egress rule. CloudFormation suppresses default outbound IPv4/IPv6 rules at group creation before adding reviewed standalone traffic rules.",
    professionalExplanation:
      "This nondeployable graph-owned configuration renders as a standalone Terraform or CloudFormation egress rule. The owning CloudFormation group suppresses default outbound IPv4/IPv6 rules at creation; validation checks port ordering, protocol-specific -1 semantics, broad destinations, all-protocol access and explicit no-rule posture.",
    considerations: [
      "Connections: Attach the rule to exactly one security group and align it with a declared downstream dependency or update path.",
      "Security: Prefer narrow destinations and ports; unrestricted 0.0.0.0/0 all-protocol egress remains an active finding.",
      "Cost: Allowed egress can traverse NAT, public, endpoint, and cross-zone paths that incur processing or transfer charges.",
      "Operations: Keep rules explicit and review updates separately from creation-time default-egress suppression. Local export does not establish effective live network policy.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.ec2.security-group-egress-rule.documentation.rules",
        title: "Security group rules",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.ec2.security-group-egress-rule.unsupported.non-cidr-destinations",
      title: "Security-group and prefix-list destinations",
      explanation:
        "Referenced security groups, managed prefix lists, IPv6 CIDRs, and arbitrary provider destination types require separate typed relationships.",
    },
    {
      id: "aws.ec2.security-group-egress-rule.unsupported.implicit-default-egress",
      title: "Implicit default egress",
      explanation:
        "Provider-created allow-all egress is not modeled as intent. The CloudFormation renderer suppresses creation defaults with an explicit localhost-only placeholder; user traffic permissions remain standalone reviewed rules.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.ec2.security-group-egress-rule.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_vpc_security_group_egress_rule",
      projection: {
        kind: "owned-resource",
        rendererContractId: "cloudmarkup.iac.networking-terraform",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: [
        { configurationKey: "protocol", targetName: "ip_protocol" },
        { configurationKey: "fromPort", targetName: "from_port" },
        { configurationKey: "toPort", targetName: "to_port" },
        {
          configurationKey: "destinationIpv4Cidr",
          targetName: "cidr_ipv4",
        },
        { configurationKey: "description", targetName: "description" },
      ],
      portBindings: [
        {
          portId: "aws.ec2.security-group-egress-rule.security-group",
          targetAttribute: "security_group_id",
        },
      ],
    },
    {
      mappingId: "aws.ec2.security-group-egress-rule.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::EC2::SecurityGroupEgress",
      configurationBindings: [
        { configurationKey: "protocol", targetName: "IpProtocol" },
        { configurationKey: "fromPort", targetName: "FromPort" },
        { configurationKey: "toPort", targetName: "ToPort" },
        {
          configurationKey: "destinationIpv4Cidr",
          targetName: "CidrIp",
        },
        { configurationKey: "description", targetName: "Description" },
      ],
      portBindings: [
        {
          portId: "aws.ec2.security-group-egress-rule.security-group",
          targetAttribute: "GroupId",
        },
      ],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound Amazon VPC security-group-rule availability inventory is bundled with this catalog.",
  },
});
