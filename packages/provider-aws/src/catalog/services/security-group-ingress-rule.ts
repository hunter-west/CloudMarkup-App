import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";
import { securityGroupRuleDescriptionPattern } from "./security-group-description.js";

/** A graph-owned ingress rule rendered only through its security group. */
export const securityGroupIngressRule = defineProviderServiceV1({
  id: "aws.ec2.security-group-ingress-rule",
  definitionVersion: "1.1.0",
  supportLevel: "production-oriented",
  displayName: "Security group ingress rule",
  description:
    "One bounded IPv4 inbound rule owned by a security group policy.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.ec2.security-group-ingress-rule",
    deployable: false,
  },
  iconId: null,
  placement: {
    rootPlacement: "forbidden",
    allowedParentTypes: [
      {
        serviceId: "aws.ec2.security-group",
        relationshipType: "aws.ec2.security-group-owns-ingress-rule",
      },
    ],
    maximumDepth: 2,
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.ec2.security-group-ingress-rule.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.ec2.security-group-ingress-rule.configuration:1.0.0",
      type: "object",
      title: "Security group ingress rule configuration",
      description:
        "A protocol, port or ICMP range, IPv4 source, and human-readable purpose.",
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
        sourceIpv4Cidr: {
          type: "string",
          minLength: 9,
          maxLength: 18,
          pattern:
            "^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}/(?:[0-9]|[12][0-9]|3[0-2])$",
        },
        description: {
          type: "string",
          default: "Reviewed inbound traffic",
          minLength: 1,
          maxLength: 255,
          pattern: securityGroupRuleDescriptionPattern,
        },
      },
      required: [
        "protocol",
        "fromPort",
        "toPort",
        "sourceIpv4Cidr",
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
        property: "sourceIpv4Cidr",
        control: "text",
        label: "Source IPv4 CIDR",
        helpText:
          "Use the narrowest trusted source. 0.0.0.0/0 is public internet ingress and produces a finding.",
        order: 3,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
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
      id: "aws.ec2.security-group-ingress-rule.security-group",
      displayName: "Security group",
      description: "Provides this ingress rule to its owning security group.",
      direction: "output",
      capability: "aws.ec2.security-group.ingress-rule",
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
      "Allows one reviewed IPv4 source and protocol or port range into a security group.",
    guidedExplanation:
      "Start with the workload listener, then allow only the source and port it actually needs. A public source such as 0.0.0.0/0 is never automatically safe; review whether the workload is intentionally internet-facing and protected at higher layers.",
    professionalExplanation:
      "This nondeployable owned configuration maps to standalone Terraform and CloudFormation ingress resources. Validation handles port ordering, protocol-specific -1 semantics, broad CIDRs, all-protocol access, and same-owner lifecycle.",
    considerations: [
      "Connections: Attach the rule to exactly one security group and align it with an actual workload listener or trusted path.",
      "Security: Prefer narrow sources and ports; public, all-protocol, and broad administrative access remain active findings.",
      "Cost: The rule has no direct charge, but permitted traffic can consume billable workload, transfer, logging, and gateway capacity.",
      "Operations: Give every rule one documented purpose and remove it through reviewed owner operations when that purpose ends.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.ec2.security-group-ingress-rule.documentation.rules",
        title: "Security group rules",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.ec2.security-group-ingress-rule.unsupported.non-cidr-sources",
      title: "Security-group and prefix-list sources",
      explanation:
        "Referenced security groups, managed prefix lists, IPv6 CIDRs, and arbitrary provider source types require separate typed relationships.",
    },
    {
      id: "aws.ec2.security-group-ingress-rule.unsupported.inline-rules",
      title: "Inline and unmanaged rules",
      explanation:
        "Inline security-group rule blocks, default rules, and out-of-band rule adoption are not accepted as parallel configuration sources.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.ec2.security-group-ingress-rule.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_vpc_security_group_ingress_rule",
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
        { configurationKey: "sourceIpv4Cidr", targetName: "cidr_ipv4" },
        { configurationKey: "description", targetName: "description" },
      ],
      portBindings: [
        {
          portId: "aws.ec2.security-group-ingress-rule.security-group",
          targetAttribute: "security_group_id",
        },
      ],
    },
    {
      mappingId: "aws.ec2.security-group-ingress-rule.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::EC2::SecurityGroupIngress",
      configurationBindings: [
        { configurationKey: "protocol", targetName: "IpProtocol" },
        { configurationKey: "fromPort", targetName: "FromPort" },
        { configurationKey: "toPort", targetName: "ToPort" },
        { configurationKey: "sourceIpv4Cidr", targetName: "CidrIp" },
        { configurationKey: "description", targetName: "Description" },
      ],
      portBindings: [
        {
          portId: "aws.ec2.security-group-ingress-rule.security-group",
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
