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
export const rdsRuleId = "aws.cloudmarkup.validation.rds-postgres-readiness";
export const rdsProperties: Record<string, Properties> = {
  "aws.rds.db-instance": {
    identifier: name,
    engine: fixed("postgres"),
    engineVersion: { type: "string", pattern: "^16\\.[1-9][0-9]?$" },
    instanceClass: {
      type: "string",
      enum: ["db.t4g.micro", "db.t4g.small", "db.t4g.medium"],
    },
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
    storageType: fixed("gp3"),
    storageGiB: { type: "integer", minimum: 20, maximum: 399 },
    storageEncrypted: yes,
    encryptionMode: fixed("aws-managed"),
    multiAz: { type: "boolean", default: false },
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
    caIdentifier: {
      type: "string",
      enum: ["rds-ca-rsa2048-g1", "rds-ca-rsa4096-g1", "rds-ca-ecc384-g1"],
    },
    publicAccess: no,
    deletionProtection: yes,
    retain: yes,
    autoMinorUpgrade: no,
    allowMajorUpgrade: no,
    extendedSupport: fixed("disabled"),
    iamAuthentication: no,
    performanceInsights: no,
    monitoringInterval: { type: "integer", enum: [0], default: 0 },
  },
  "aws.rds.db-subnet-group": {
    retain: yes,
    name,
    description: { type: "string", minLength: 1, maxLength: 255 },
  },
  "aws.rds.db-parameter-group": {
    retain: yes,
    name,
    description: { type: "string", minLength: 1, maxLength: 255 },
    family: fixed("postgres16"),
    forceTls: yes,
  },
};
export const rdsBindings = [
  [
    "aws.rds.subnet-group-uses-subnet",
    "aws.rds.db-subnet-group",
    "subnet",
    "aws.ec2.subnet",
    "rds-subnet-group",
    16,
    128,
    "Uses DB subnet",
  ],
  [
    "aws.rds.instance-uses-subnet-group",
    "aws.rds.db-subnet-group",
    "instance",
    "aws.rds.db-instance",
    "subnet-group",
    128,
    1,
    "Uses DB subnet group",
  ],
  [
    "aws.rds.instance-uses-parameter-group",
    "aws.rds.db-parameter-group",
    "instance",
    "aws.rds.db-instance",
    "parameter-group",
    128,
    1,
    "Uses TLS parameter group",
  ],
  [
    "aws.rds.instance-uses-security-group",
    "aws.rds.db-instance",
    "security-group",
    "aws.ec2.security-group",
    "rds-instance",
    5,
    128,
    "Uses DB security group",
  ],
] as const;
export const rdsDocumentation = [
  {
    kind: "official" as const,
    id: "aws.rds.documentation.instance",
    title: "RDS PostgreSQL DB instance",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbinstance.html",
  },
  {
    kind: "official" as const,
    id: "aws.rds.documentation.credentials",
    title: "RDS-managed master credentials",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html",
  },
];
export const rdsPorts = (id: string) =>
  rdsBindings.flatMap((b) => [
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
              b[0] === "aws.rds.subnet-group-uses-subnet" ||
              b[0] === "aws.rds.instance-uses-security-group",
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
  "aws.rds.db-instance": "RDS PostgreSQL instance",
  "aws.rds.db-subnet-group": "RDS DB subnet group",
  "aws.rds.db-parameter-group": "RDS PostgreSQL TLS parameters",
};
const native: Record<string, [string, string]> = {
  "aws.rds.db-instance": ["aws_db_instance", "AWS::RDS::DBInstance"],
  "aws.rds.db-subnet-group": ["aws_db_subnet_group", "AWS::RDS::DBSubnetGroup"],
  "aws.rds.db-parameter-group": [
    "aws_db_parameter_group",
    "AWS::RDS::DBParameterGroup",
  ],
};
const help: Record<string, string> = {
  engineVersion:
    "Supply an exact reviewed PostgreSQL 16 minor version. No latest/version lookup occurs; Region/class/version availability remains external.",
  storageGiB:
    "Encrypted gp3 20-399 GiB baseline. IOPS/throughput overrides and autoscaling are unsupported; paid storage starts only when you provision elsewhere.",
  masterAuthMode:
    "RDS creates and manages its master password/secret at provisioning. No password or secret value enters this graph; application read grants are not inferred.",
  backupWindow:
    "UTC daily same-day window, 30-120 minutes. Must not overlap the maintenance window.",
  maintenanceWindow:
    "UTC same-weekday window, 30-120 minutes, outside the daily backup window. Changes may wait for maintenance or require a reboot.",
  caIdentifier:
    "Review current engine/Region CA support and client verify-full hostname/CA handling externally. Parameter groups require TLS; no client code is generated.",
  multiAz:
    "Classic DB-instance primary/standby deployment only; additional costs apply when provisioned. Aurora and Multi-AZ DB clusters need separate contracts.",
  retain:
    "Deletion protection/retention keep paid databases and backups. Cleanup, restore and replacement require separate external review.",
};
export const awsRdsServices = Object.entries(rdsProperties).map(
  ([id, properties]) =>
    defineProviderServiceV1({
      id,
      definitionVersion: "1.0.0",
      supportLevel: "production-oriented",
      displayName: labels[id] ?? id,
      description:
        "Bounded private PostgreSQL 16 infrastructure intent with explicit networking, TLS, retained lifecycle and RDS-managed credentials.",
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
      ports: rdsPorts(id),
      validationRuleIds: [
        rdsRuleId,
        "aws.cloudmarkup.validation.connection-cardinality",
        "aws.cloudmarkup.validation.compiler-readiness",
        "aws.cloudmarkup.validation.region-availability",
      ],
      education: {
        summary:
          "Models private retained RDS PostgreSQL infrastructure without provisioning or claiming runnable business behavior.",
        guidedExplanation:
          "Configure an exact PostgreSQL 16 version/class, subnet group spanning two AZs, TLS parameter group and same-VPC security groups. RDS owns its future master credential; no application or password is generated here.",
        professionalExplanation:
          "Exact user-owned root identities and typed dependency references preserve native managed credentials, protected lifecycle, encrypted gp3 baseline and bounded UTC windows. Export support is not live resource, database health or client-authority evidence.",
        considerations: [
          "Connections: Exact subnet, TLS parameter and same-VPC security-group references are required; no ingress or application client is inferred.",
          "Security: Managed credentials and AWS-managed encryption only. Master secret ARN is metadata; no secret value or app read permission is inferred. Clients must verify CA and hostname.",
          "Cost: Provisioned instances, storage, backups, standby and managed secrets incur charges. Retained resources require deliberate external cleanup.",
          "Operations: Check actual engine/class/CA/Region availability, deployer/service-linked-role authority, capacity, backups, TLS and maintenance externally. No queries, migrations or runtime health checks occur.",
        ],
        documentation: rdsDocumentation,
      },
      unsupportedCapabilities: [
        {
          id: id + ".unsupported.expanded-database",
          title: "Expanded database and runtime integration pending",
          explanation:
            "Aurora, proxy, other engines/majors, replicas, restores/imports, custom KMS, arbitrary parameters, public access, IAM DB auth, scaling/insights, app clients/read grants, queries and lifecycle cleanup need separate contracts.",
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
            rendererContractId: "cloudmarkup.iac.rds-terraform",
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
            rendererContractId: "cloudmarkup.iac.rds-cloudformation",
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
export function extendServiceForRds(
  s: ProviderServiceDefinitionV1,
): ProviderServiceDefinitionV1 {
  if (!rdsBindings.some((b) => b[1] === s.id || b[3] === s.id)) return s;
  return defineProviderServiceV1({
    ...s,
    ports: [...s.ports, ...rdsPorts(s.id)],
    validationRuleIds: [...s.validationRuleIds, rdsRuleId],
  });
}
