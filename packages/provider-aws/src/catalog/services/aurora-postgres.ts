import {
  defineProviderServiceV1,
  type ProviderServiceDefinitionV1,
  type ProviderServiceDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";
type Properties =
  ProviderServiceDefinitionV1Input["configuration"]["jsonSchema"]["properties"];
const fixed = (value: string) => ({
  type: "string" as const,
  enum: [value],
  default: value,
});
const yes = { type: "boolean" as const, const: true, default: true };
const no = { type: "boolean" as const, const: false, default: false };
const name = {
  type: "string" as const,
  minLength: 1,
  maxLength: 63,
  pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
};
export const auroraRuleId =
  "aws.cloudmarkup.validation.aurora-postgres-readiness";
export const auroraProperties: Record<string, Properties> = {
  "aws.aurora.postgresql-cluster": {
    identifier: name,
    engine: fixed("aurora-postgresql"),
    engineVersion: { type: "string", pattern: "^16\\.[1-9][0-9]?$" },
    engineMode: fixed("provisioned"),
    capacityMode: fixed("serverless-v2"),
    minimumCapacityAcus: {
      type: "string",
      enum: ["0.5", "1", "2", "4", "8", "16", "32", "64"],
      default: "0.5",
    },
    maximumCapacityAcus: {
      type: "string",
      enum: ["1", "2", "4", "8", "16", "32", "64"],
      default: "4",
    },
    autoPause: no,
    databaseName: {
      type: "string",
      minLength: 1,
      maxLength: 63,
      pattern: "^[A-Za-z][A-Za-z0-9]*$",
    },
    masterUsername: {
      type: "string",
      minLength: 1,
      maxLength: 16,
      pattern: "^[A-Za-z][A-Za-z0-9_]*$",
    },
    masterAuthMode: fixed("rds-managed"),
    storageType: fixed("aurora"),
    storageEncrypted: yes,
    encryptionMode: fixed("aws-managed"),
    port: { type: "integer", enum: [5432], default: 5432 },
    backupRetentionDays: {
      type: "integer",
      minimum: 1,
      maximum: 35,
      default: 7,
    },
    backupWindow: {
      type: "string",
      pattern:
        "^(?:[01][0-9]|2[0-3]):[0-5][0-9]-(?:[01][0-9]|2[0-3]):[0-5][0-9]$",
      default: "02:00-02:30",
    },
    maintenanceWindow: {
      type: "string",
      pattern:
        "^(?:mon|tue|wed|thu|fri|sat|sun):(?:[01][0-9]|2[0-3]):[0-5][0-9]-(?:mon|tue|wed|thu|fri|sat|sun):(?:[01][0-9]|2[0-3]):[0-5][0-9]$",
      default: "sun:03:00-sun:03:30",
    },
    deletionProtection: yes,
    retain: yes,
    autoMinorUpgrade: no,
    allowMajorUpgrade: no,
    extendedSupport: fixed("disabled"),
    iamAuthentication: no,
    dataApi: no,
  },
  "aws.aurora.postgresql-instance": {
    identifier: name,
    instanceClass: fixed("db.serverless"),
    availabilityZone: {
      type: "string",
      pattern: "^[a-z]{2}(?:-[a-z]+)+-[1-9][a-z]$",
    },
    promotionTier: { type: "integer", minimum: 0, maximum: 15, default: 0 },
    caIdentifier: {
      type: "string",
      enum: ["rds-ca-rsa2048-g1", "rds-ca-rsa4096-g1", "rds-ca-ecc384-g1"],
    },
    publicAccess: no,
    retain: yes,
    autoMinorUpgrade: no,
    performanceInsights: no,
    monitoringInterval: { type: "integer", enum: [0], default: 0 },
  },
  "aws.aurora.postgresql-cluster-parameter-group": {
    name,
    description: { type: "string", minLength: 1, maxLength: 255 },
    family: fixed("aurora-postgresql16"),
    forceTls: yes,
    retain: yes,
  },
};
export const auroraBindings = [
  [
    "aws.aurora.cluster-uses-subnet-group",
    "aws.rds.db-subnet-group",
    "aurora-cluster",
    "aws.aurora.postgresql-cluster",
    "subnet-group",
    128,
    1,
    "Uses Aurora DB subnet group",
  ],
  [
    "aws.aurora.cluster-uses-parameter-group",
    "aws.aurora.postgresql-cluster-parameter-group",
    "cluster",
    "aws.aurora.postgresql-cluster",
    "parameter-group",
    128,
    1,
    "Uses Aurora cluster TLS parameters",
  ],
  [
    "aws.aurora.cluster-has-instance",
    "aws.aurora.postgresql-cluster",
    "instance",
    "aws.aurora.postgresql-instance",
    "cluster",
    2,
    1,
    "Contains Aurora member",
  ],
  [
    "aws.aurora.cluster-uses-security-group",
    "aws.aurora.postgresql-cluster",
    "security-group",
    "aws.ec2.security-group",
    "aurora-cluster",
    5,
    128,
    "Uses Aurora security group",
  ],
] as const;
export const auroraDocumentation = [
  {
    kind: "official" as const,
    id: "aws.aurora.documentation.instance",
    title: "Aurora PostgreSQL DB cluster",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbcluster.html",
  },
  {
    kind: "official" as const,
    id: "aws.aurora.documentation.credentials",
    title: "RDS-managed master credentials",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-secrets-manager.html",
  },
];
export const auroraPorts = (id: string) =>
  auroraBindings.flatMap((b) => [
    ...(b[1] === id
      ? [
          {
            id: id + "." + b[2],
            displayName: b[7],
            description:
              "Exact caller-modeled native dependency; no access grant or runtime verification.",
            direction: "output" as const,
            capability: b[0],
            category: "network-and-security" as const,
            cardinality: "many" as const,
            required:
              b[0] === "aws.aurora.cluster-has-instance" ||
              b[0] === "aws.aurora.cluster-uses-security-group",
          },
        ]
      : []),
    ...(b[3] === id
      ? [
          {
            id: id + "." + b[4],
            displayName: b[7],
            description:
              "Exact reviewed native dependency with independent availability and authority.",
            direction: "input" as const,
            capability: b[0],
            category: "network-and-security" as const,
            cardinality: b[6] === 1 ? ("one" as const) : ("many" as const),
            required: b[6] === 1,
          },
        ]
      : []),
  ]);
const labels: Record<string, string> = {
  "aws.aurora.postgresql-cluster": "Aurora PostgreSQL Serverless v2 cluster",
  "aws.aurora.postgresql-instance": "Aurora PostgreSQL Serverless v2 member",
  "aws.aurora.postgresql-cluster-parameter-group":
    "Aurora PostgreSQL cluster TLS parameters",
};
const native: Record<string, [string, string]> = {
  "aws.aurora.postgresql-cluster": ["aws_rds_cluster", "AWS::RDS::DBCluster"],
  "aws.aurora.postgresql-instance": [
    "aws_rds_cluster_instance",
    "AWS::RDS::DBInstance",
  ],
  "aws.aurora.postgresql-cluster-parameter-group": [
    "aws_rds_cluster_parameter_group",
    "AWS::RDS::DBClusterParameterGroup",
  ],
};
const help: Record<string, string> = {
  engineVersion:
    "Supply an exact Aurora PostgreSQL 16 minor version. Regional/version/class availability is external; no latest lookup occurs.",
  engineMode:
    "AWS uses provisioned engine mode for Serverless v2. Serverless v1 and provisioned instance classes are outside this contract.",
  minimumCapacityAcus:
    "Minimum ACUs per member, from 0.5 to 64 in reviewed choices. Every member continues to incur compute charges when idle; zero capacity and auto-pause are unsupported.",
  maximumCapacityAcus:
    "Maximum ACUs per member, from 1 to 64. Must be at least the minimum. Capacity changes can require a reboot; this range is not a cost or workload suitability guarantee.",
  autoPause:
    "Fixed off. This contract supplies no zero minimum, pause interval, cold-resume policy or savings evidence.",
  masterAuthMode:
    "RDS creates and manages the cluster master password and managed secret. Values and application read grants stay outside this graph.",
  storageType:
    "Aurora Standard automatic cluster storage, separate from member compute. No gp3 allocation, IOPS, I/O-Optimized or size guarantee is modeled.",
  availabilityZone:
    "Choose a canonical declared AZ represented in the cluster subnet group. Two members must occupy distinct declared AZs.",
  promotionTier:
    "Failover preference only, not a promised initial writer identity. A two-member cluster requires distinct tiers and one tier 0; AWS selects and changes writer/reader roles.",
  caIdentifier:
    "Review engine/Region CA availability and verify-full client CA/hostname validation externally. The cluster parameter group requires TLS.",
  backupWindow: "UTC daily same-day 30-120 minute window outside maintenance.",
  maintenanceWindow:
    "UTC same-weekday 30-120 minute window outside backups. Changes may require maintenance/reboot.",
  retain:
    "Protected retained cluster, members, parameters and subnet group require deliberate external cleanup; paid resources and backups persist.",
};
export const awsAuroraServices = Object.entries(auroraProperties).map(
  ([id, properties]) =>
    defineProviderServiceV1({
      id,
      definitionVersion: "1.0.0",
      supportLevel: "production-oriented",
      displayName: labels[id] ?? id,
      description:
        "Bounded private Aurora PostgreSQL 16 Serverless v2 cluster/member intent with explicit capacity, TLS, managed credentials and retained lifecycle.",
      nodeKind: { kind: "resource", resourceType: id, deployable: true },
      iconId:
        "aws.cloudmarkup.icons." + id.replace("aws.", "").replaceAll(".", "-"),
      placement: {
        rootPlacement: "allowed",
        allowedParentTypes: [],
        maximumDepth: 1,
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
            .replace(/^[a-z]/, (l) => l.toUpperCase())
            .replace(/[A-Z]/g, (l, position: number) =>
              position === 0 ? l : ` ${l.toLowerCase()}`,
            ),
          helpText:
            help[key] ??
            "Explicit reviewed native configuration. Provisioning authority, availability, replacement and costs require external review.",
          order,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "cost-sensitive",
        })),
      },
      ports: auroraPorts(id),
      validationRuleIds: [
        auroraRuleId,
        "aws.cloudmarkup.validation.connection-cardinality",
        "aws.cloudmarkup.validation.compiler-readiness",
        "aws.cloudmarkup.validation.region-availability",
      ],
      education: {
        summary:
          "Models retained private Aurora infrastructure without provisioning or runnable application claims.",
        guidedExplanation:
          "Configure an exact Aurora PostgreSQL 16 version, per-member ACU bounds, one or two explicit Serverless v2 members, a two-AZ subnet group, cluster TLS parameters and same-VPC security groups. RDS manages the future cluster credential.",
        professionalExplanation:
          "Exact root identities preserve native cluster/member separation, Serverless v2 under provisioned engine mode, Aurora Standard encrypted automatic storage, managed credentials and protected lifecycle. No pause, runtime or provisioning evidence is inferred.",
        considerations: [
          "Connections: Members bind exactly one cluster. Cluster subnet, cluster TLS parameters and security groups are explicit; member AZs must belong to its subnets. No ingress or application client is inferred.",
          "Security: Managed credentials and AWS-managed encryption only. Master secret ARN is metadata; no secret value or app read permission is inferred. Clients must verify CA and hostname.",
          "Cost: Each Serverless v2 member has a nonzero compute floor. Aurora Standard storage/I/O, backups and managed secrets add costs; no auto-pause or savings evidence. Retained resources need external cleanup.",
          "Operations: Check actual engine/class/CA/Region availability, deployer/service-linked-role authority, capacity, backups, TLS and maintenance externally. No queries, migrations or runtime health checks occur.",
        ],
        documentation: auroraDocumentation,
      },
      unsupportedCapabilities: [
        {
          id: id + ".unsupported.expanded-database",
          title: "Expanded database and runtime integration pending",
          explanation:
            "Provisioned classes, Serverless v1/zero-capacity auto-pause, more than two members, custom endpoints, proxy, other engines/majors, global/Limitless, restore/import, I/O-Optimized, custom KMS, arbitrary/instance parameters, public access, IAM DB auth, Data API, app clients/read grants, queries and cleanup need separate contracts.",
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
          resourceType: native[id]?.[0] ?? "",
          projection: {
            kind: "relationship-resource",
            rendererContractId: "cloudmarkup.iac.aurora-terraform",
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
          typeName: native[id]?.[1] ?? "",
          projection: {
            kind: "relationship-resource",
            rendererContractId: "cloudmarkup.iac.aurora-cloudformation",
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
          "No live engine/class/capacity/CA availability lookup; verify target Region externally.",
      },
    }),
);
export function extendServiceForAurora(
  s: ProviderServiceDefinitionV1,
): ProviderServiceDefinitionV1 {
  if (
    s.id !== "aws.ec2.subnet" &&
    !auroraBindings.some((b) => b[1] === s.id || b[3] === s.id)
  )
    return s;
  return defineProviderServiceV1({
    ...s,
    ports: [...s.ports, ...auroraPorts(s.id)],
    validationRuleIds: [...s.validationRuleIds, auroraRuleId],
  });
}
