import {
  defineProviderServiceV1,
  type ProviderServiceDefinitionV1,
  type ProviderServiceDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";

export const ec2ReadinessRuleId = "aws.cloudmarkup.validation.ec2-readiness";
export const ec2Documentation = [
  {
    kind: "official" as const,
    id: "aws.ec2.documentation.instance",
    title: "EC2 instance properties and replacement",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html",
  },
  {
    kind: "official" as const,
    id: "aws.ec2.documentation.image",
    title: "AMI identity and compatibility",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AMIs.html",
  },
  {
    kind: "official" as const,
    id: "aws.ec2.documentation.profile",
    title: "EC2 instance profile",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-instanceprofile.html",
  },
];
export const ec2InstanceTypes = [
  "t3.micro",
  "t3.small",
  "t3.medium",
  "t4g.micro",
  "t4g.small",
  "t4g.medium",
] as const;
type Properties =
  ProviderServiceDefinitionV1Input["configuration"]["jsonSchema"]["properties"];
const fixed = (value: string) => ({
  type: "string" as const,
  enum: [value],
  default: value,
});
export const ec2InstanceProperties: Properties = {
  imageId: { type: "string", pattern: "^ami-[0-9a-f]{17}$" },
  imageRegion: {
    type: "string",
    minLength: 1,
    maxLength: 64,
    pattern: "^[a-z]{2}(?:-[a-z]+)+-[0-9]+$",
  },
  imageArchitecture: { type: "string", enum: ["x86_64", "arm64"] },
  imageOperatingSystem: fixed("linux"),
  imageVirtualization: fixed("hvm"),
  imageRootDeviceType: fixed("ebs"),
  imageRootDeviceName: { type: "string", enum: ["/dev/xvda", "/dev/sda1"] },
  imageRootMinimumGiB: { type: "integer", minimum: 1, maximum: 16384 },
  imageRootOnly: { type: "boolean", const: true, default: true },
  instanceType: { type: "string", enum: [...ec2InstanceTypes] },
  tenancy: fixed("default"),
  cpuCreditMode: fixed("standard"),
  publicIpv4: { type: "boolean", const: false, default: false },
  rootSizeGiB: { type: "integer", minimum: 1, maximum: 16384 },
  rootVolumeType: fixed("gp3"),
  rootEncrypted: { type: "boolean", const: true, default: true },
  rootIops: { type: "integer", enum: [3000], default: 3000 },
  rootThroughputMiBps: { type: "integer", enum: [125], default: 125 },
  rootDeleteOnTermination: { type: "boolean", default: false },
  rootEncryptionMode: {
    type: "string",
    enum: ["default-key", "customer-managed"],
    default: "default-key",
  },
  metadataAuthentication: fixed("required"),
  metadataEndpoint: fixed("enabled"),
  metadataHopLimit: { type: "integer", minimum: 1, maximum: 64, default: 1 },
  metadataIpv6: fixed("disabled"),
  metadataTags: fixed("disabled"),
  detailedMonitoring: { type: "boolean", default: false },
};
const help: Record<string, [string, string]> = {
  imageId: [
    "AMI ID",
    "Supply an exact regional AMI ID from your reviewed image inventory. The editor does not look up images, select latest or establish permission to launch.",
  ],
  imageRegion: [
    "AMI Region",
    "Declare the AMI's Region; it must match the immutable export Region.",
  ],
  imageArchitecture: [
    "AMI architecture",
    "Declare verified image architecture. T3 requires x86_64 and T4g requires arm64; offline export cannot inspect the image.",
  ],
  imageRootDeviceName: [
    "AMI root device",
    "Supply the image's actual root device mapping, /dev/xvda or /dev/sda1. A guessed device may create a different disk in CloudFormation.",
  ],
  imageRootMinimumGiB: [
    "AMI minimum root size (GiB)",
    "Supply the reviewed image root snapshot minimum. The requested root disk cannot be smaller.",
  ],
  imageRootOnly: [
    "Image has only one root mapping",
    "This variant requires a reviewed Linux HVM EBS image with only its root mapping. Other AMI disks, boot compatibility and encrypted-snapshot permissions require external review.",
  ],
  instanceType: [
    "Instance type",
    "Choose a reviewed burstable machine and verify availability and workload/image compatibility externally. Standard credits limit sustained CPU to its baseline after credits are exhausted.",
  ],
  rootSizeGiB: [
    "Root disk size (GiB)",
    "Choose at least the declared AMI minimum. Encryption/key and image/network changes may replace the instance; filesystem resizing is external.",
  ],
  rootEncryptionMode: [
    "Root encryption key",
    "Default-key uses the account's EBS default key. Customer-managed requires one explicit enabled regional KMS key and separate deployment/snapshot/key-policy permission review.",
  ],
  rootDeleteOnTermination: [
    "Delete root disk on termination",
    "False retains storage and ongoing charges after instance termination. True permits root data deletion. Neither choice is a backup or replacement-safety guarantee.",
  ],
  rootThroughputMiBps: [
    "Root throughput (MiB/s)",
    "Only gp3's 125 MiB/s baseline is supported. Terraform sets it; CloudFormation inline EBS has no throughput field and uses the gp3 baseline. Alternate throughput is rejected.",
  ],
  metadataHopLimit: [
    "Metadata token hop limit",
    "Choose 1-64; the security baseline is 1. Increasing it allows tokens to travel farther. IMDSv2 is required; instance-tag and IPv6 metadata access remain disabled.",
  ],
  detailedMonitoring: [
    "Detailed monitoring",
    "Enable one-minute EC2 monitoring explicitly; additional charges can apply. This does not install an agent or collect application logs.",
  ],
};
const commonRules = [
  ec2ReadinessRuleId,
  "aws.cloudmarkup.validation.connection-cardinality",
  "aws.cloudmarkup.validation.compiler-readiness",
  "aws.cloudmarkup.validation.region-availability",
];
const ports = [
  {
    id: "aws.ec2.instance.subnet",
    displayName: "Subnet",
    direction: "output" as const,
    capability: "aws.ec2.instance.subnet",
    cardinality: "one" as const,
    required: true,
  },
  {
    id: "aws.ec2.instance.security-group",
    displayName: "Security groups",
    direction: "output" as const,
    capability: "aws.ec2.instance.security-group",
    cardinality: "many" as const,
    required: true,
  },
  {
    id: "aws.ec2.instance.instance-profile",
    displayName: "Instance profile",
    direction: "input" as const,
    capability: "aws.ec2.instance.profile",
    cardinality: "one" as const,
    required: true,
  },
  {
    id: "aws.ec2.instance.root-encryption-key",
    displayName: "Root encryption key",
    direction: "input" as const,
    capability: "aws.ec2.instance.root-encryption",
    cardinality: "one" as const,
    required: false,
  },
].map((p) => ({
  ...p,
  description:
    "Explicit typed launch dependency; no topology, image validity or permission is inferred.",
  category: "network-and-security" as const,
}));
function instancePortId(index: number): string {
  const port = ports[index];
  if (!port) throw Error("Missing reviewed EC2 port");
  return port.id;
}
export const ec2Instance = defineProviderServiceV1({
  id: "aws.ec2.instance",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "EC2 instance",
  description:
    "Private Linux EC2 instance with explicit image provenance, profile, networking, IMDSv2 and encrypted baseline gp3 root storage.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.ec2.instance",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.ec2-instance",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.ec2.instance.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.ec2.instance.configuration:1.0.0",
      type: "object",
      title: "Private Linux instance",
      additionalProperties: false,
      properties: ec2InstanceProperties,
      required: Object.keys(ec2InstanceProperties),
    },
    uiHints: Object.entries(ec2InstanceProperties).map(
      ([property, schema], order) => ({
        property,
        label:
          help[property]?.[0] ??
          property
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (c) => c.toUpperCase()),
        helpText:
          help[property]?.[1] ??
          "Fixed reviewed Linux/private/IMDSv2/root-storage variant. Other modes require separate admission.",
        control:
          schema.type === "boolean"
            ? "checkbox"
            : schema.type === "integer"
              ? "number"
              : "enum" in schema
                ? "select"
                : "text",
        order,
        advanced: !(property in help) || property === "metadataHopLimit",
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: [
          "instanceType",
          "rootSizeGiB",
          "rootDeleteOnTermination",
          "detailedMonitoring",
          "rootEncryptionMode",
        ].includes(property)
          ? "cost-sensitive"
          : "none",
      }),
    ),
  },
  ports,
  validationRuleIds: commonRules,
  education: {
    summary:
      "Launch a private Linux instance only from explicit reviewed image and network choices.",
    guidedExplanation:
      "Provide a verified AMI, its architecture, root device and minimum disk size. Connect one subnet, security groups and a real instance profile. The image and policies are yours to review; this resource does not create a working application.",
    professionalExplanation:
      "One user-owned regional EC2 instance owns its primary interface and inline encrypted gp3 root mapping. Image provenance is caller-declared, never fetched. Exact profile/role trust and same-VPC network contracts are checked; no user data, SSH credentials, public addressing or runtime permission is generated.",
    considerations: [
      "Security: IMDSv2 is required; private addressing does not prove safe ingress, routing or application security. KMS links do not grant key use.",
      "Operations: Image/root-device/minimum-size and launch permission validity need external evidence. Image, encryption and network updates can replace resources; retained root disks require external recovery/cleanup.",
      "Cost: On-demand burstable compute, retained storage, monitoring and customer keys incur charges. Standard CPU credits can constrain sustained CPU. Region availability and capacity are unknown.",
      "Connections: One modeled subnet, one to five same-VPC groups and a real typed instance profile are required. Explicit EC2 role trust and runtime permissions remain separate.",
    ],
    documentation: ec2Documentation,
  },
  unsupportedCapabilities: [
    {
      id: "aws.ec2.instance.unsupported.launch-modes",
      title: "Other launch and storage modes",
      explanation:
        "Windows, Spot/fleets, imports, existing ENIs, IPv6/public addresses, launch templates, Auto Scaling, data disks, non-root image mappings and alternate gp3 performance are unsupported.",
    },
    {
      id: "aws.ec2.instance.unsupported.application",
      title: "Bootstrap and application execution",
      explanation:
        "No SSH keys, passwords, user data, provisioners, live AMI resolution, generated boot scripts or application generation/retrieval. Export cannot inspect image provenance or establish deployment authority.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.ec2.instance.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_instance",
      projection: {
        kind: "relationship-resource",
        rendererContractId: "cloudmarkup.iac.ec2-terraform",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: [],
      semanticConfigurationKeys: Object.keys(ec2InstanceProperties),
      portBindings: [
        { portId: instancePortId(0), targetAttribute: "subnet_id" },
        {
          portId: instancePortId(1),
          targetAttribute: "vpc_security_group_ids",
        },
        { portId: instancePortId(2), targetAttribute: "iam_instance_profile" },
        { portId: instancePortId(3), targetAttribute: "kms_key_id" },
      ],
    },
    {
      mappingId: "aws.ec2.instance.cloudformation",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::EC2::Instance",
      projection: {
        kind: "relationship-resource",
        rendererContractId: "cloudmarkup.iac.ec2-cloudformation",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: [],
      semanticConfigurationKeys: Object.keys(ec2InstanceProperties),
      portBindings: [
        { portId: instancePortId(0), targetAttribute: "SubnetId" },
        { portId: instancePortId(1), targetAttribute: "GroupSet" },
        { portId: instancePortId(2), targetAttribute: "IamInstanceProfile" },
        { portId: instancePortId(3), targetAttribute: "KmsKeyId" },
      ],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed version-bound regional instance/image/capacity inventory is installed.",
  },
});
export const iamInstanceProfile = defineProviderServiceV1({
  id: "aws.iam.instance-profile",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "IAM instance profile",
  description:
    "An explicit named user-owned profile containing one EC2-trusted role, shareable by modeled instances.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.iam.instance-profile",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.iam-instance-profile",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "not-applicable",
  },
  configuration: {
    schemaId: "aws.iam.instance-profile.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.iam.instance-profile.configuration:1.0.0",
      type: "object",
      title: "EC2 instance profile",
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9+=,.@_-]+$",
        },
        path: fixed("/"),
      },
      required: ["name", "path"],
    },
    uiHints: [
      {
        property: "name",
        label: "Instance profile name",
        helpText:
          "Choose an explicit unique account-wide profile name. This is a profile name, not a role ARN. Changes replace the profile; offline checks cannot prove availability.",
        control: "text",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "path",
        label: "IAM path",
        helpText: "The first reviewed profile variant uses the root IAM path.",
        control: "select",
        order: 1,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
    ],
  },
  ports: [
    {
      id: "aws.iam.instance-profile.role",
      displayName: "EC2 role",
      description: "Exactly one explicit role with reviewed EC2 service trust.",
      direction: "input",
      capability: "aws.iam.role.assume.service",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.iam.instance-profile.instance",
      displayName: "Instances",
      description:
        "Supplies this profile name to explicitly connected instances.",
      direction: "output",
      capability: "aws.ec2.instance.profile",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
  ],
  validationRuleIds: commonRules,
  education: {
    summary:
      "Pass a real profile to EC2 rather than confusing a role ARN with a profile name.",
    guidedExplanation:
      "Connect one role whose trust policy explicitly allows EC2, then connect the profile to each instance. Runtime API permissions are separately chosen in the role's policies.",
    professionalExplanation:
      "A user-owned AWS IAM InstanceProfile contains one canonical EC2-trusted graph role. Both exporters use typed role/profile names. No role, trust statement, policy or iam:PassRole authority is inferred.",
    considerations: [
      "Security: The deploying caller needs independently reviewed iam:PassRole and resource-creation authority.",
      "Connections: Role/profile/instance edges are explicit, shared profiles remain user-owned, and imports/generated adoption are unsupported.",
      "Operations: Profile names are unique account-wide; offline export cannot prove availability or IAM propagation readiness.",
      "Cost: This catalog gives no profile price estimate; the running instances and separately chosen runtime permissions enabled by the profile may incur charges.",
    ],
    documentation: ec2Documentation,
  },
  unsupportedCapabilities: [
    {
      id: "aws.iam.instance-profile.unsupported.ownership",
      title: "Imported or generated profile ownership",
      explanation:
        "Imports, reference-only profiles, automatically generated roles/trust, non-root IAM paths and inferred runtime grants require separate contracts.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.iam.instance-profile.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_iam_instance_profile",
      projection: {
        kind: "relationship-resource",
        rendererContractId: "cloudmarkup.iac.ec2-profile-terraform",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: [
        { configurationKey: "name", targetName: "name" },
        { configurationKey: "path", targetName: "path" },
      ],
      portBindings: [
        { portId: "aws.iam.instance-profile.role", targetAttribute: "role" },
        {
          portId: "aws.iam.instance-profile.instance",
          targetAttribute: "name",
        },
      ],
    },
    {
      mappingId: "aws.iam.instance-profile.cloudformation",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::IAM::InstanceProfile",
      projection: {
        kind: "relationship-resource",
        rendererContractId: "cloudmarkup.iac.ec2-profile-cloudformation",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: [
        { configurationKey: "name", targetName: "InstanceProfileName" },
        { configurationKey: "path", targetName: "Path" },
      ],
      portBindings: [
        { portId: "aws.iam.instance-profile.role", targetAttribute: "Roles" },
        { portId: "aws.iam.instance-profile.instance", targetAttribute: "Ref" },
      ],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "IAM is global; no reviewed inventory establishes profile/name/propagation readiness.",
  },
});
export function extendServiceForEc2(
  service: ProviderServiceDefinitionV1,
): ProviderServiceDefinitionV1 {
  const additions: Record<string, [string, string, string]> = {
    "aws.ec2.subnet": [
      "aws.ec2.subnet.instance",
      "Instances",
      "aws.ec2.instance.subnet",
    ],
    "aws.ec2.security-group": [
      "aws.ec2.security-group.instance",
      "Instances",
      "aws.ec2.instance.security-group",
    ],
    "aws.kms.key": [
      "aws.kms.key.root-volume-encryption",
      "Root volume encryption",
      "aws.ec2.instance.root-encryption",
    ],
  };
  const port = additions[service.id];
  if (!port && service.id !== "aws.iam.role") return service;
  return defineProviderServiceV1({
    ...service,
    definitionVersion: service.definitionVersion
      .split(".")
      .map((part, index) => (index === 1 ? String(Number(part) + 1) : part))
      .join("."),
    ports: port
      ? [
          ...service.ports,
          {
            id: port[0],
            displayName: port[1],
            description:
              "Explicit EC2 launch association; no resource or permission is generated.",
            direction: service.id === "aws.kms.key" ? "output" : "input",
            capability: port[2],
            category: "network-and-security",
            cardinality: "many",
            required: false,
          },
        ]
      : service.ports.map((p) =>
          p.id === "aws.iam.role.assumable-role"
            ? {
                ...p,
                description:
                  p.description +
                  " Also binds one explicit EC2 instance profile with separately reviewed service trust.",
              }
            : p,
        ),
    validationRuleIds: [...service.validationRuleIds, ec2ReadinessRuleId],
    ...(service.id === "aws.kms.key"
      ? {
          unsupportedCapabilities: service.unsupportedCapabilities.map(
            (entry) =>
              entry.id === "aws.kms.key.unsupported.integrations"
                ? {
                    ...entry,
                    title: "Aliases, grants and other service encryption",
                    explanation:
                      "Only explicit Secrets Manager metadata, EC2 inline root and standalone EBS encryption associations are supported. Aliases, grants, cross-account access, service principals and other integrations remain outside this variant; export cannot establish live effective key permissions.",
                  }
                : entry,
          ),
        }
      : {}),
    ...(service.id === "aws.iam.role"
      ? {
          education: {
            ...service.education,
            professionalExplanation:
              service.education.professionalExplanation +
              " An explicit EC2 instance-profile connection requires separately reviewed EC2-only trust; runtime grants are not inferred.",
            considerations: service.education.considerations.map((entry) =>
              entry.startsWith("Connections:")
                ? "Connections: Bind one reviewed Lambda, Step Functions, EventBridge consumer or EC2 profile. Trust, custom, generated, managed and boundary policies retain their exact owner slots; EC2 trust is reviewed separately."
                : entry,
            ),
          },
        }
      : {}),
  });
}
