import {
  defineProviderServiceV1,
  type ProviderServiceDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";

type Service = ProviderServiceDefinitionV1Input;
type Properties = Service["configuration"]["jsonSchema"]["properties"];
export const fsxValidationRuleId = "aws.cloudmarkup.validation.fsx-readiness";
export const fsxDocumentation = [
  {
    kind: "official" as const,
    id: "aws.fsx.documentation.filesystems",
    title: "Amazon FSx file systems",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/fsx/latest/APIReference/API_CreateFileSystem.html",
  },
];
export const fsxFamilies: {
  family: string;
  name: string;
  protocol: string;
  terraform: string;
  description: string;
  properties: Properties;
}[] = [
  {
    family: "lustre",
    name: "FSx for Lustre",
    protocol: "Lustre",
    terraform: "aws_fsx_lustre_file_system",
    description:
      "Parallel file storage with native S3 import. Recommended for the S3-to-file-system workflow when SMB or NFS is not required.",
    properties: {
      storageCapacity: {
        type: "integer",
        minimum: 1200,
        maximum: 2400000,
        default: 1200,
      },
      perUnitStorageThroughput: {
        type: "integer",
        enum: [125, 250, 500, 1000],
        default: 125,
      },
      dataCompressionType: {
        type: "string",
        enum: ["NONE", "LZ4"],
        default: "LZ4",
      },
    },
  },
  {
    family: "windows",
    name: "FSx for Windows File Server",
    protocol: "SMB",
    terraform: "aws_fsx_windows_file_system",
    description:
      "Windows SMB shares joined to an existing AWS Managed Microsoft AD directory. Choose for Windows applications and domain-based access.",
    properties: {
      storageCapacity: {
        type: "integer",
        minimum: 32,
        maximum: 65536,
        default: 32,
      },
      throughputCapacity: {
        type: "integer",
        enum: [8, 16, 32, 64, 128, 256, 512, 1024, 2048],
        default: 32,
      },
      deploymentType: {
        type: "string",
        enum: ["SINGLE_AZ_2", "MULTI_AZ_1"],
        default: "SINGLE_AZ_2",
      },
      activeDirectoryId: {
        type: "string",
        pattern: "^d-[0-9a-f]{10}$",
        minLength: 12,
        maxLength: 12,
      },
      automaticBackupRetentionDays: {
        type: "integer",
        minimum: 1,
        maximum: 90,
        default: 7,
      },
    },
  },
  {
    family: "openzfs",
    name: "FSx for OpenZFS",
    protocol: "NFS",
    terraform: "aws_fsx_openzfs_file_system",
    description:
      "Managed NFS storage for Linux applications. Explicitly configure the root-volume client CIDR before granting file access.",
    properties: {
      storageCapacity: {
        type: "integer",
        minimum: 64,
        maximum: 524288,
        default: 64,
      },
      throughputCapacity: {
        type: "integer",
        enum: [160, 320, 640, 1280, 2560, 3840, 5120, 7680, 10240],
        default: 160,
      },
      automaticBackupRetentionDays: {
        type: "integer",
        minimum: 1,
        maximum: 90,
        default: 7,
      },
      clientCidr: {
        type: "string",
        minLength: 9,
        maxLength: 18,
        pattern: "^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}/[0-9]{1,2}$",
      },
    },
  },
  {
    family: "ontap",
    name: "FSx for NetApp ONTAP",
    protocol: "NFS / SMB",
    terraform: "aws_fsx_ontap_file_system",
    description:
      "NetApp storage with separate storage virtual machines and volumes. The curated volume configuration uses NFS with UNIX permissions; SMB needs directory integration.",
    properties: {
      storageCapacity: {
        type: "integer",
        minimum: 1024,
        maximum: 1048576,
        default: 1024,
      },
      throughputCapacity: {
        type: "integer",
        enum: [1536, 3072, 6144],
      },
      automaticBackupRetentionDays: {
        type: "integer",
        minimum: 1,
        maximum: 90,
        default: 7,
      },
    },
  },
];

function service(input: {
  id: string;
  name: string;
  description: string;
  terraform: string;
  cloudformation: string;
  properties: Properties;
  required?: string[];
  ports: Service["ports"];
  semanticKeys?: string[];
}): ReturnType<typeof defineProviderServiceV1> {
  const keys = Object.keys(input.properties);
  const targetNames: Record<string, [string, string]> = {
    storageCapacity: ["storage_capacity", "StorageCapacity"],
    throughputCapacity: ["throughput_capacity", "ThroughputCapacity"],
    perUnitStorageThroughput: [
      "per_unit_storage_throughput",
      "PerUnitStorageThroughput",
    ],
    dataCompressionType: ["data_compression_type", "DataCompressionType"],
    deploymentType: ["deployment_type", "DeploymentType"],
    activeDirectoryId: ["active_directory_id", "ActiveDirectoryId"],
    automaticBackupRetentionDays: [
      "automatic_backup_retention_days",
      "AutomaticBackupRetentionDays",
    ],
    name: ["name", "Name"],
    sizeInMegabytes: ["size_in_megabytes", "SizeInMegabytes"],
    junctionPath: ["junction_path", "JunctionPath"],
  };
  return defineProviderServiceV1({
    id: input.id,
    definitionVersion: "1.0.0",
    supportLevel: "production-oriented",
    displayName: input.name,
    description: input.description,
    nodeKind: { kind: "resource", resourceType: input.id, deployable: true },
    iconId: "aws.cloudmarkup.icons.fsx-" + input.id.slice("aws.fsx.".length),
    placement: {
      rootPlacement: "allowed",
      allowedParentTypes: [],
      regionConstraint: "same-region",
    },
    configuration: {
      schemaId: input.id + ".configuration",
      schemaVersion: "1.0.0",
      jsonSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id:
          "urn:cloudmarkup:configuration:" + input.id + ".configuration:1.0.0",
        type: "object",
        title: input.name + " configuration",
        additionalProperties: false,
        properties: input.properties,
        required:
          input.required ??
          keys.filter(
            (key) => !["activeDirectoryId", "clientCidr"].includes(key),
          ),
      },
      uiHints: keys.map((property, order) => ({
        property,
        control:
          input.properties[property]?.type === "integer"
            ? "number"
            : "enum" in (input.properties[property] ?? {})
              ? "select"
              : "text",
        label:
          input.id === "aws.fsx.ontap-file-system" &&
          property === "throughputCapacity"
            ? "Throughput per HA pair (MBps)"
            : property
                .replace(/([A-Z])/gu, " $1")
                .replace(/^./u, (x) => x.toUpperCase()),
        helpText:
          input.id === "aws.fsx.ontap-file-system" &&
          property === "throughputCapacity"
            ? "SINGLE_AZ_2 with one HA pair supports 1,536, 3,072 or 6,144 MBps. Choose explicitly after reviewing throughput cost; saved 384/768 values require correction and are never upgraded automatically."
            : property === "clientCidr"
              ? "Allow only the specific IPv4 network that needs NFS access. No client network is assumed."
              : property === "activeDirectoryId"
                ? "ID of an existing AWS Managed Microsoft AD directory in the same VPC. Never enter a password."
                : "Review this file-system setting before export; changing capacity or deployment mode may affect cost or replacement.",
        order,
        advanced: false,
        valueSource: "literal",
        securityImpact: ["clientCidr", "activeDirectoryId"].includes(property)
          ? "security-sensitive"
          : "none",
        costImpact: /Capacity|Throughput/u.test(property)
          ? "cost-sensitive"
          : "none",
      })),
    },
    ports: input.ports,
    validationRuleIds: [fsxValidationRuleId],
    education: {
      summary: input.description,
      guidedExplanation:
        input.description +
        " Connect subnet and security-group resources from one VPC. Review capacity and access before exporting.",
      professionalExplanation:
        "Deterministic Terraform and CloudFormation mappings retain stable deployment keys. Lambda cannot natively mount FSx; use an S3 data-repository association for Lustre, or a reviewed transfer client for SMB/NFS.",
      considerations: [
        "Connections: Networking associations select exact graph resources; they do not create implicit ingress rules.",
        "Cost: File-system capacity and provisioned throughput incur ongoing charges; review them for your workload.",
        "Operations: FSx for Lustre imports S3 metadata and loads file contents on access. ONTAP needs a storage virtual machine and volume.",
        "Security: No credentials, inline passwords, or public NFS exports are generated by these reviewed mappings.",
      ],
      documentation: fsxDocumentation,
    },
    unsupportedCapabilities: [
      {
        id: input.id + ".unsupported.advanced",
        title: "Advanced file-system modes",
        explanation:
          "Cross-Region associations, restore/backup sources, self-managed Active Directory credentials, custom KMS keys and unreviewed deployment/storage modes are outside this curated definition.",
      },
    ],
    mappings: [
      {
        mappingId: input.id + ".terraform",
        declarationVersion: 1,
        implementationStatus: "implemented",
        target: "terraform",
        kind: "resource",
        providerSource: "hashicorp/aws",
        resourceType: input.terraform,
        projection: {
          kind: "relationship-resource",
          rendererContractId: "cloudmarkup.iac.fsx-terraform",
          rendererContractVersion: "1.0.0",
          generatedResourceTypes:
            input.id === "aws.fsx.lustre-file-system"
              ? ["aws_fsx_data_repository_association"]
              : [],
        },
        configurationBindings: keys
          .filter((k) => targetNames[k])
          .map((k) => ({
            configurationKey: k,
            targetName:
              input.id === "aws.fsx.ontap-file-system" &&
              k === "throughputCapacity"
                ? "throughput_capacity_per_ha_pair"
                : requireTargetNames(targetNames, k)[0],
          })),
        semanticConfigurationKeys: keys.filter((k) => !targetNames[k]),
        portBindings: input.ports.map((p) => ({
          portId: p.id,
          targetAttribute: p.id.endsWith(".subnets")
            ? "subnet_ids"
            : p.id.endsWith(".security-groups")
              ? "security_group_ids"
              : p.id.endsWith(".file-system")
                ? "file_system_id"
                : p.id.endsWith(".storage-virtual-machine")
                  ? "storage_virtual_machine_id"
                  : p.direction === "input"
                    ? "id"
                    : "data_repository_path",
        })),
      },
      {
        mappingId: input.id + ".cloudformation",
        declarationVersion: 1,
        implementationStatus: "implemented",
        target: "cloudformation",
        kind: "resource",
        typeName: input.cloudformation,
        projection: {
          kind: "relationship-resource",
          rendererContractId: "cloudmarkup.iac.fsx-cloudformation",
          rendererContractVersion: "1.0.0",
          generatedResourceTypes: [],
        },
        configurationBindings: keys
          .filter((k) => targetNames[k])
          .map((k) => ({
            configurationKey: k,
            targetName:
              (input.id.endsWith("-file-system") && k !== "storageCapacity"
                ? input.id.includes("lustre")
                  ? "LustreConfiguration."
                  : input.id.includes("windows")
                    ? "WindowsConfiguration."
                    : input.id.includes("openzfs")
                      ? "OpenZFSConfiguration."
                      : "OntapConfiguration."
                : input.id === "aws.fsx.ontap-volume" && k !== "name"
                  ? "OntapConfiguration."
                  : "") +
              (input.id === "aws.fsx.ontap-file-system" &&
              k === "throughputCapacity"
                ? "ThroughputCapacityPerHAPair"
                : requireTargetNames(targetNames, k)[1]),
          })),
        semanticConfigurationKeys: keys.filter((k) => !targetNames[k]),
        portBindings: input.ports.map((p) => ({
          portId: p.id,
          targetAttribute: p.id.endsWith(".subnets")
            ? "SubnetIds"
            : p.id.endsWith(".security-groups")
              ? "SecurityGroupIds"
              : p.id.endsWith(".file-system")
                ? "FileSystemId"
                : p.id.endsWith(".storage-virtual-machine")
                  ? "OntapConfiguration.StorageVirtualMachineId"
                  : p.direction === "input"
                    ? "Ref"
                    : "DataRepositoryPath",
        })),
      },
    ],
    regionAvailability: {
      state: "unknown",
      reason:
        "FSx family and deployment-type availability must be verified in the selected Region; no complete regional inventory is bundled.",
    },
  });
}
function port(
  id: string,
  name: string,
  capability: string,
  direction: "input" | "output",
  required = false,
): Service["ports"][number] {
  return {
    id,
    displayName: name,
    description: name + " using an explicit typed relationship.",
    direction,
    capability,
    category: id.endsWith(".s3-repository")
      ? "reads-or-writes-data"
      : "network-and-security",
    cardinality:
      id.endsWith(".file-system") || id.endsWith(".storage-virtual-machine")
        ? "one"
        : "many",
    required,
  };
}
export const awsFsxServices = [
  ...fsxFamilies.map((f) => {
    const id = "aws.fsx." + f.family + "-file-system";
    return service({
      id,
      name: f.name,
      description: f.description,
      terraform: f.terraform,
      cloudformation: "AWS::FSx::FileSystem",
      properties: f.properties,
      ports: [
        port(id + ".subnets", "Subnets", "aws.fsx.subnet", "output", true),
        port(
          id + ".security-groups",
          "Security groups",
          "aws.fsx.security-group",
          "output",
          true,
        ),
        ...(f.family === "lustre"
          ? [
              port(
                id + ".s3-repository",
                "S3 data repository",
                "aws.s3.object.read-write",
                "output",
              ),
            ]
          : []),
        ...(f.family === "ontap"
          ? [
              port(
                id + ".storage-virtual-machines",
                "Storage virtual machines",
                "aws.fsx.storage-virtual-machine",
                "input",
              ),
            ]
          : []),
      ],
    });
  }),
  service({
    id: "aws.fsx.ontap-storage-virtual-machine",
    name: "FSx ONTAP storage virtual machine",
    description:
      "An explicit UNIX-security storage virtual machine for NFS volumes on FSx for ONTAP.",
    terraform: "aws_fsx_ontap_storage_virtual_machine",
    cloudformation: "AWS::FSx::StorageVirtualMachine",
    properties: {
      name: {
        type: "string",
        pattern: "^[A-Za-z][A-Za-z0-9_]{0,46}$",
        default: "svm",
      },
    },
    ports: [
      port(
        "aws.fsx.ontap-storage-virtual-machine.file-system",
        "File system",
        "aws.fsx.storage-virtual-machine",
        "output",
        true,
      ),
      port(
        "aws.fsx.ontap-storage-virtual-machine.volumes",
        "Volumes",
        "aws.fsx.volume",
        "input",
      ),
    ],
  }),
  service({
    id: "aws.fsx.ontap-volume",
    name: "FSx ONTAP volume",
    description:
      "A read-write NFS volume with an explicit junction path on one ONTAP storage virtual machine.",
    terraform: "aws_fsx_ontap_volume",
    cloudformation: "AWS::FSx::Volume",
    properties: {
      name: {
        type: "string",
        pattern: "^[A-Za-z][A-Za-z0-9_]{0,202}$",
        default: "share",
      },
      sizeInMegabytes: {
        type: "integer",
        minimum: 20,
        maximum: 314572800,
        default: 102400,
      },
      junctionPath: {
        type: "string",
        pattern: "^/[A-Za-z0-9_/-]{1,127}$",
        default: "/share",
      },
    },
    ports: [
      port(
        "aws.fsx.ontap-volume.storage-virtual-machine",
        "Storage virtual machine",
        "aws.fsx.volume",
        "output",
        true,
      ),
    ],
  }),
];

export function extendServiceForFsx(
  existing: ReturnType<typeof defineProviderServiceV1>,
): ReturnType<typeof defineProviderServiceV1> {
  if (
    !["aws.ec2.subnet", "aws.ec2.security-group", "aws.s3.bucket"].includes(
      existing.id,
    )
  )
    return existing;
  const additional =
    existing.id === "aws.s3.bucket"
      ? []
      : [
          port(
            existing.id + ".fsx",
            "FSx file systems",
            existing.id === "aws.ec2.subnet"
              ? "aws.fsx.subnet"
              : "aws.fsx.security-group",
            "input",
          ),
        ];
  return defineProviderServiceV1({
    ...existing,
    definitionVersion: "1.2.0",
    ports: [...existing.ports, ...additional],
    validationRuleIds: [...existing.validationRuleIds, fsxValidationRuleId],
    mappings: existing.mappings.map((m) => ({
      ...m,
      portBindings: [
        ...m.portBindings,
        ...additional.map((p) => ({
          portId: p.id,
          targetAttribute: m.target === "cloudformation" ? "Ref" : "id",
        })),
      ],
    })),
  });
}

function requireTargetNames(
  targetNames: Record<string, [string, string]>,
  key: string,
) {
  const names = targetNames[key];
  if (!names) throw new Error("Missing FSx target mapping.");
  return names;
}
