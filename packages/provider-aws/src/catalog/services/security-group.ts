import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";
import { securityGroupDescriptionPattern } from "./security-group-description.js";

export const securityGroup = defineProviderServiceV1({
  id: "aws.ec2.security-group",
  definitionVersion: "1.1.0",
  supportLevel: "production-oriented",
  displayName: "Security group",
  description:
    "A stateful VPC network policy with explicit owned ingress and egress rules.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.ec2.security-group",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.security-group",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.ec2.security-group.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.ec2.security-group.configuration:1.0.0",
      type: "object",
      title: "Security group configuration",
      description:
        "A stable group name and purpose; traffic rules remain separate typed owned configurations.",
      additionalProperties: false,
      properties: {
        groupName: {
          type: "string",
          default: "application-security-group",
          minLength: 1,
          maxLength: 255,
          pattern: "^(?!sg-)[A-Za-z0-9 _.-]+$",
        },
        description: {
          type: "string",
          default: "Reviewed application traffic",
          minLength: 1,
          maxLength: 255,
          pattern: securityGroupDescriptionPattern,
        },
      },
      required: ["groupName", "description"],
    },
    uiHints: [
      {
        property: "groupName",
        control: "text",
        label: "Security group name",
        helpText: "Use a stable workload or trust-purpose name.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "description",
        control: "textarea",
        label: "Purpose",
        helpText:
          "Describe the workload or trust boundary using 1-255 ASCII letters, digits, spaces or ._-:/()#,@[]+=&;{}!$*. Line breaks and other characters are not supported.",
        order: 1,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
    ],
  },
  ports: [
    {
      id: "aws.ec2.security-group.vpc",
      displayName: "VPC association",
      description: "Accepts association with exactly one VPC.",
      direction: "input",
      capability: "aws.ec2.vpc.security-group-association",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.ec2.security-group.lambda-vpc-access",
      displayName: "Lambda VPC access",
      description:
        "Accepts Lambda VPC access configurations that select this policy.",
      direction: "input",
      capability: "aws.lambda.vpc-access.security-group",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.security-group.ingress-rule",
      displayName: "Ingress rules",
      description: "Accepts explicit inbound rules owned by this group.",
      direction: "input",
      capability: "aws.ec2.security-group.ingress-rule",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.ec2.security-group.egress-rule",
      displayName: "Egress rules",
      description: "Accepts explicit outbound rules owned by this group.",
      direction: "input",
      capability: "aws.ec2.security-group.egress-rule",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
  ],
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.lambda-vpc-access",
    "aws.cloudmarkup.validation.network-placement",
    "aws.cloudmarkup.validation.region-availability",
    "aws.cloudmarkup.validation.security-group-policy",
  ],
  education: {
    summary:
      "Applies stateful inbound and outbound network policy to associated VPC resources.",
    guidedExplanation:
      "A security group is a policy, not a box that contains services. Associate it with a workload through an explicit configuration, then add only the inbound and outbound rules that workload needs. Return traffic for allowed flows is statefully permitted.",
    professionalExplanation:
      "Models one VPC-scoped stateful policy with standalone owned rule resources in Terraform and CloudFormation. CloudFormation uses an explicit localhost-only placeholder to suppress default outbound IPv4/IPv6 rules at creation; reviewed traffic rules remain separate owned resources.",
    considerations: [
      "Connections: Associate the group with one VPC and attach it to workloads through explicit configuration, never visual containment.",
      "Security: Prefer narrow CIDRs, protocols, and ports; review broad ingress, broad egress, and all-protocol rules as active findings.",
      "Cost: Security groups have no direct charge, but allowed paths can reach billable endpoints, NAT gateways, and data-transfer routes.",
      "Operations: Keep one trust purpose per group and review explicit rules. Default-egress suppression is a renderer behavior, not an additional graph traffic permission or live AWS verification.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.ec2.security-group.documentation.overview",
        title: "Control traffic to your AWS resources using security groups",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.ec2.security-group.unsupported.inline-and-default-rules",
      title: "Inline and implicit default rules",
      explanation:
        "User traffic rules are standalone owned configurations. Implicit allow-all defaults and arbitrary inline traffic rules are not modeled intent; the CloudFormation renderer's localhost-only placeholder suppresses AWS defaults at creation.",
    },
    {
      id: "aws.ec2.security-group.unsupported.shared-and-cross-vpc",
      title: "Shared and cross-VPC security groups",
      explanation:
        "Default-group adoption, shared VPC groups, cross-VPC associations, rule sharing, and stale-rule cleanup need separate semantics.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.ec2.security-group.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_security_group",
      projection: {
        kind: "relationship-resource",
        rendererContractId: "cloudmarkup.iac.networking-terraform",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: [
        { configurationKey: "groupName", targetName: "name" },
        { configurationKey: "description", targetName: "description" },
      ],
      portBindings: [
        {
          portId: "aws.ec2.security-group.vpc",
          targetAttribute: "vpc_id",
        },
      ],
    },
    {
      mappingId: "aws.ec2.security-group.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::EC2::SecurityGroup",
      configurationBindings: [
        { configurationKey: "groupName", targetName: "GroupName" },
        {
          configurationKey: "description",
          targetName: "GroupDescription",
        },
      ],
      portBindings: [
        {
          portId: "aws.ec2.security-group.vpc",
          targetAttribute: "VpcId",
        },
      ],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound Amazon VPC security-group availability inventory is bundled with this catalog.",
  },
});
