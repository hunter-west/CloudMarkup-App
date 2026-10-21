import {
  defineProviderServiceV1,
  type ProviderServiceDefinitionV1,
  type ProviderServiceDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";
type Properties =
  ProviderServiceDefinitionV1Input["configuration"]["jsonSchema"]["properties"];
export const ebsRuleId = "aws.cloudmarkup.validation.ebs-readiness";
export const ebsProperties: Record<string, Properties> = {
  "aws.ebs.volume": {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z][A-Za-z0-9._-]*$",
    },
    sizeGiB: { type: "integer", minimum: 1, maximum: 16384 },
    volumeType: { type: "string", enum: ["gp3"], default: "gp3" },
    iops: { type: "integer", minimum: 3000, maximum: 3000, default: 3000 },
    throughputMiBps: {
      type: "integer",
      minimum: 125,
      maximum: 125,
      default: 125,
    },
    encrypted: { type: "boolean", const: true, default: true },
    encryptionMode: {
      type: "string",
      enum: ["account-default", "customer-managed"],
    },
    multiAttach: { type: "boolean", const: false, default: false },
    retain: { type: "boolean", const: true, default: true },
  },
  "aws.ebs.volume-attachment": {
    deviceName: {
      type: "string",
      enum: ["/dev/sdf", "/dev/sdg", "/dev/sdh", "/dev/sdi"],
    },
    guestPreparation: {
      type: "string",
      enum: ["external"],
      default: "external",
    },
    retain: { type: "boolean", const: true, default: true },
    forceDetach: { type: "boolean", const: false, default: false },
  },
};
export const ebsBindings = [
  [
    "aws.ebs.availability-zone-contains-volume",
    "aws.ebs.volume",
    "availability-zone",
    "aws.ec2.availability-zone",
    "ebs-volume",
    1,
    128,
    "Places volume in exact AZ",
  ],
  [
    "aws.ebs.volume-owns-attachment",
    "aws.ebs.volume-attachment",
    "volume",
    "aws.ebs.volume",
    "attachment",
    1,
    1,
    "Owns volume attachment",
  ],
  [
    "aws.ebs.attachment-uses-instance",
    "aws.ebs.volume-attachment",
    "instance",
    "aws.ec2.instance",
    "data-volume",
    1,
    4,
    "Attaches to Linux EC2 instance",
  ],
  [
    "aws.ebs.volume-uses-key",
    "aws.ebs.volume",
    "encryption-key",
    "aws.kms.key",
    "ebs-volume",
    1,
    128,
    "Uses exact volume encryption key",
  ],
] as const;
export const ebsDocumentation = [
  {
    kind: "official",
    id: "aws.ebs.volume.cfn",
    publisher: "AWS",
    title: "EBS native volume",
    url: "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-volume.html",
  },
  {
    kind: "official",
    id: "aws.ebs.devices",
    publisher: "AWS",
    title: "Linux EC2 device naming",
    url: "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/device_naming.html",
  },
] satisfies ProviderServiceDefinitionV1Input["education"]["documentation"];
export const ebsPorts = (id: string) =>
  ebsBindings.flatMap((b) => [
    ...(b[1] === id
      ? [
          {
            id: id + "." + b[2],
            displayName: b[7],
            description:
              "Exact bounded EBS dependency; validation checks placement, ownership, encryption and attachment intent.",
            direction: "output" as const,
            capability: b[0],
            category: "network-and-security" as const,
            cardinality: "one" as const,
            required: b[0] !== "aws.ebs.volume-uses-key",
          },
        ]
      : []),
    ...(b[3] === id
      ? [
          {
            id: id + "." + b[4],
            displayName: b[7],
            description:
              "Bind exact EBS placement/owner/instance/key; no IAM or guest preparation is inferred.",
            direction: "input" as const,
            capability: b[0],
            category: "network-and-security" as const,
            cardinality: b[6] === 1 ? ("one" as const) : ("many" as const),
            required: false,
          },
        ]
      : []),
  ]);
const labels: Record<string, string> = {
  "aws.ebs.volume": "EBS data volume",
  "aws.ebs.volume-attachment": "EBS volume attachment",
};
const help: Record<string, string> = {
  name: "Explicit Name tag; not a native unique volume name. Stable graph identity determines its address.",
  sizeGiB:
    "Explicit 1-16384 GiB empty gp3 capacity in this bounded profile; not the complete AWS maximum. Shrinking or resizing a guest filesystem is unsupported.",
  encryptionMode:
    "Account-default omits a key ID and uses the actual account default EBS encryption key; do not assume it is AWS managed. Customer-managed requires one enabled exact modeled regional symmetric KMS key. Verify key/grant/deployer authority externally.",
  deviceName:
    "Choose /dev/sdf through /dev/sdi, distinct per target instance and never the root device. This is the EC2 API mapping; Nitro exposes NVMe names and order may differ in the guest.",
  guestPreparation:
    "Attachment does not format, partition or mount the disk. Discover it by volume identity and prepare it in the guest through a separate reviewed workflow.",
  retain:
    "CloudFormation retains volume/attachment. Terraform protects resources while configured and skips attachment detach on destroy; removed configuration can lose that protection. No backup or automatic safe cleanup is promised.",
  forceDetach:
    "Forced detach is rejected. Safe unmount, guest data integrity and termination behavior require separate review.",
};
const nativeTypes: Record<string, [string, string]> = {
  "aws.ebs.volume": ["aws_ebs_volume", "AWS::EC2::Volume"],
  "aws.ebs.volume-attachment": [
    "aws_volume_attachment",
    "AWS::EC2::VolumeAttachment",
  ],
};
export const awsEbsServices = Object.entries(ebsProperties).map(
  ([id, properties]) => {
    const attachment = id === "aws.ebs.volume-attachment";
    return defineProviderServiceV1({
      id,
      definitionVersion: "1.0.0",
      supportLevel: "production-oriented",
      displayName: labels[id] ?? id,
      description:
        "Explicit encrypted empty gp3 data volume in one canonical AZ, optionally singly attached to an existing Linux EC2 instance in that exact AZ.",
      nodeKind: { kind: "resource", resourceType: id, deployable: true },
      iconId: id + ".icon",
      placement: {
        rootPlacement: "forbidden",
        allowedParentTypes: [
          {
            serviceId: attachment
              ? "aws.ebs.volume"
              : "aws.ec2.availability-zone",
            relationshipType: attachment
              ? "aws.ebs.volume-owns-attachment"
              : "aws.ebs.availability-zone-contains-volume",
          },
        ],
        maximumDepth: 8,
        regionConstraint: "same-region",
      },
      configuration: {
        schemaId: id + ".configuration",
        schemaVersion: "1.0.0",
        jsonSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          $id: "urn:cloudmarkup:configuration:" + id + ".configuration:1.0.0",
          type: "object",
          title: labels[id] ?? id,
          additionalProperties: false,
          properties,
          required: Object.keys(properties),
        },
        uiHints: Object.entries(properties).map(([key, s], order) => ({
          property: key,
          control:
            s.type === "boolean"
              ? "checkbox"
              : s.type === "integer"
                ? "number"
                : "enum" in s
                  ? "select"
                  : "text",
          label: key
            .replace(/^[a-z]/u, (l) => l.toUpperCase())
            .replace(/[A-Z]/gu, (l, pos: number) =>
              pos === 0 ? l : " " + l.toLowerCase(),
            ),
          helpText:
            help[key] ??
            "Reviewed bounded EBS intent; verify external application, authority and availability separately.",
          order,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "cost-sensitive",
        })),
      },
      ports: ebsPorts(id),
      validationRuleIds: [
        ebsRuleId,
        "aws.cloudmarkup.validation.connection-cardinality",
        "aws.cloudmarkup.validation.compiler-readiness",
        "aws.cloudmarkup.validation.region-availability",
      ],
      education: {
        summary:
          "Models empty encrypted gp3 data volumes and explicit native attachments; no provisioning, formatting, mounting or application behavior.",
        guidedExplanation:
          "Create a volume under its exact Availability Zone, choose encryption and size, then create its native attachment child and bind the exact same-AZ EC2 instance. Prepare the disk inside the guest separately.",
        professionalExplanation:
          "New empty gp3, single attach and gp3 baseline 3000 IOPS/125 MiB/s; exact AZ parent/edge, enabled graph KMS key when selected and one user-owned Linux EC2 instance. Four explicit API device names bound extra attachments; Nitro guest NVMe ordering is external. No instance inline block device, IAM, key policy, user data, filesystem or mount is inferred.",
        considerations: [
          "Connections: Exact canonical AZ and volume ownership plus one EC2 attachment; same modeled AZ and declared physical AZ/Region; no imports, snapshots or multi-attach.",
          "Cost: Provisioning elsewhere incurs provisioned storage charges even when unattached. Export performs no AWS call.",
          "Operations: Verify AZ capacity, device limits, guest NVMe identity, filesystem/mount, safe cleanup, backups and termination behavior. TF protection requires retained configuration; skip_destroy skips detach. CF retains storage and attachment.",
          "Security: Encryption uses the actual account default key when omitted or a graph-bound KMS key; deployer/KMS grant authority is external. No key/account changes or generated IAM.",
        ],
        documentation: ebsDocumentation,
      },
      unsupportedCapabilities: [
        {
          id: id + ".unsupported.expanded",
          title: "Expanded block storage pending",
          explanation:
            "Snapshots/restores/copies, other volume types or gp3 performance tuning, Multi-Attach, Outposts/Local Zones, imported/adopted/external volumes/instances/keys, root-device replacement, extra attachments beyond four, forced detach, guest disk discovery/format/mount/resize, backup policy and live storage/authority assurance need separate contracts.",
        },
      ],
      mappings: [
        {
          target: "terraform",
          mappingId: id + ".terraform",
          declarationVersion: 1,
          implementationStatus: "implemented",
          kind: "resource",
          providerSource: "hashicorp/aws",
          resourceType: nativeTypes[id]?.[0] ?? "aws_ebs_volume",
          projection: {
            kind: "relationship-resource",
            rendererContractId: "cloudmarkup.iac.ebs-terraform",
            rendererContractVersion: "1.0.0",
            generatedResourceTypes: [],
          },
          configurationBindings: [],
          semanticConfigurationKeys: Object.keys(properties),
          portBindings: [],
        },
        {
          target: "cloudformation",
          mappingId: id + ".cloudformation",
          declarationVersion: 1,
          implementationStatus: "implemented",
          kind: "resource",
          typeName: nativeTypes[id]?.[1] ?? "AWS::EC2::Volume",
          projection: {
            kind: "relationship-resource",
            rendererContractId: "cloudmarkup.iac.ebs-cloudformation",
            rendererContractVersion: "1.0.0",
            generatedResourceTypes: [],
          },
          configurationBindings: [],
          semanticConfigurationKeys: Object.keys(properties),
          portBindings: [],
        },
      ],
      regionAvailability: {
        state: "unknown",
        reason:
          "Commercial partition modeled without a live/versioned service-AZ/storage availability inventory.",
      },
    });
  },
);
export function extendServiceForEbs(
  s: ProviderServiceDefinitionV1,
): ProviderServiceDefinitionV1 {
  const ports = ebsPorts(s.id);
  if (!ports.length) return s;
  return defineProviderServiceV1({
    ...s,
    ports: [...s.ports, ...ports],
    validationRuleIds: [...s.validationRuleIds, ebsRuleId],
    unsupportedCapabilities: s.unsupportedCapabilities,
  });
}
