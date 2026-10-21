import {
  defineProviderServiceV1,
  type ProviderServiceDefinitionV1,
  type ProviderServiceDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";

export const ecsRuleId = "aws.cloudmarkup.validation.ecs-fargate-readiness";
export const ecsDocumentation = [
  {
    kind: "official" as const,
    id: "aws.ecs.documentation.task",
    title: "ECS task definition parameters",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html",
  },
  {
    kind: "official" as const,
    id: "aws.ecr.documentation.repository",
    title: "ECR repository native contract",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecr-repository.html",
  },
];
type Properties =
  ProviderServiceDefinitionV1Input["configuration"]["jsonSchema"]["properties"];
const fixed = (value: string) => ({
  type: "string" as const,
  enum: [value],
  default: value,
});
const name = {
  type: "string" as const,
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z][A-Za-z0-9_-]*$",
};
export const ecsProperties: Record<string, Properties> = {
  "aws.ecr.repository": {
    name: {
      type: "string",
      minLength: 2,
      maxLength: 256,
      pattern: "^[a-z0-9]+(?:[._/-][a-z0-9]+)*$",
    },
    tagMutability: fixed("IMMUTABLE"),
    encryption: fixed("AES256"),
    scanOnPush: { type: "boolean", default: true },
    retain: { type: "boolean", const: true, default: true },
  },
  "aws.ecr.image-reference": {
    digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    architecture: { type: "string", enum: ["x86_64", "arm64"] },
    manifestType: { type: "string", enum: ["docker-v2-image", "oci-image"] },
    publicationStatus: {
      type: "string",
      enum: ["external-publication-required", "externally-confirmed"],
      default: "external-publication-required",
    },
  },
  "aws.ecs.cluster": { name, containerInsights: fixed("disabled") },
  "aws.ecs.task-definition": {
    family: name,
    cpu: { type: "integer", enum: [256, 512, 1024] },
    memoryMiB: {
      type: "integer",
      enum: [512, 1024, 2048, 3072, 4096, 5120, 6144, 7168, 8192],
    },
    architecture: { type: "string", enum: ["x86_64", "arm64"] },
    operatingSystem: fixed("LINUX"),
    networkMode: fixed("awsvpc"),
    capacity: fixed("FARGATE"),
  },
  "aws.ecs.container-definition": {
    name,
    containerPort: { type: "integer", minimum: 1024, maximum: 65535 },
    protocol: fixed("tcp"),
    essential: { type: "boolean", const: true, default: true },
    user: { type: "string", pattern: "^[1-9][0-9]{0,5}:[1-9][0-9]{0,5}$" },
    readOnlyRoot: { type: "boolean", const: true, default: true },
    healthExecutable: {
      type: "string",
      minLength: 2,
      maxLength: 128,
      pattern: "^/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+$",
    },
    healthIntervalSeconds: {
      type: "integer",
      minimum: 5,
      maximum: 300,
      default: 30,
    },
    healthTimeoutSeconds: {
      type: "integer",
      minimum: 2,
      maximum: 60,
      default: 5,
    },
    healthRetries: { type: "integer", minimum: 1, maximum: 10, default: 3 },
    healthStartPeriodSeconds: {
      type: "integer",
      minimum: 0,
      maximum: 300,
      default: 0,
    },
    logStreamPrefix: name,
    logMode: fixed("non-blocking"),
    logBufferSize: fixed("10m"),
  },
  "aws.ecs.service": {
    name,
    desiredCount: { type: "integer", minimum: 0, maximum: 20, default: 0 },
    platformVersion: fixed("1.4.0"),
    publicIpv4: { type: "boolean", const: false, default: false },
    executeCommand: { type: "boolean", const: false, default: false },
    availabilityZoneRebalancing: fixed("DISABLED"),
  },
};
// Canonical owned children point to their owner; all other bindings are explicit
// references. Fargate is an ECS capacity mode, not another service family.
export const ecsBindings = [
  [
    "aws.ecr.repository-owns-image",
    "aws.ecr.image-reference",
    "repository",
    "aws.ecr.repository",
    "image",
    1,
    64,
    "Owns image identity",
  ],
  [
    "aws.ecs.task-owns-container",
    "aws.ecs.container-definition",
    "task",
    "aws.ecs.task-definition",
    "container",
    1,
    1,
    "Owns container",
  ],
  [
    "aws.ecs.container-uses-image",
    "aws.ecr.image-reference",
    "container",
    "aws.ecs.container-definition",
    "image",
    128,
    1,
    "Uses immutable image",
  ],
  [
    "aws.ecs.service-uses-cluster",
    "aws.ecs.cluster",
    "service",
    "aws.ecs.service",
    "cluster",
    128,
    1,
    "Uses cluster",
  ],
  [
    "aws.ecs.service-uses-task",
    "aws.ecs.task-definition",
    "service",
    "aws.ecs.service",
    "task",
    128,
    1,
    "Uses task definition",
  ],
  [
    "aws.ecs.task-uses-execution-role",
    "aws.iam.role",
    "assumable-role",
    "aws.ecs.task-definition",
    "execution-role",
    1,
    1,
    "Uses execution role",
  ],
  [
    "aws.ecs.task-uses-application-role",
    "aws.iam.role",
    "assumable-role",
    "aws.ecs.task-definition",
    "application-role",
    1,
    1,
    "Uses task role",
  ],
  [
    "aws.ecs.service-uses-subnet",
    "aws.ecs.service",
    "subnet",
    "aws.ec2.subnet",
    "ecs-service",
    16,
    128,
    "Uses subnet",
  ],
  [
    "aws.ecs.service-uses-security-group",
    "aws.ecs.service",
    "security-group",
    "aws.ec2.security-group",
    "ecs-service",
    5,
    128,
    "Uses security group",
  ],
  [
    "aws.ecs.container-writes-logs",
    "aws.ecs.container-definition",
    "log-group",
    "aws.cloudwatch.log-group",
    "ecs-container",
    1,
    128,
    "Writes container logs",
  ],
  [
    "aws.ecs.container-uses-secret",
    "aws.secretsmanager.secret",
    "ecs-container",
    "aws.ecs.container-definition",
    "secret",
    128,
    8,
    "Injects whole secret",
  ],
] as const;
const commonRules = [
  ecsRuleId,
  "aws.cloudmarkup.validation.connection-cardinality",
  "aws.cloudmarkup.validation.compiler-readiness",
  "aws.cloudmarkup.validation.region-availability",
];
const labels: Record<string, string> = {
  "aws.ecr.repository": "ECR repository",
  "aws.ecr.image-reference": "Published image identity",
  "aws.ecs.cluster": "ECS cluster",
  "aws.ecs.task-definition": "Fargate task definition",
  "aws.ecs.container-definition": "Container definition",
  "aws.ecs.service": "Fargate service",
};
export const ecsPorts = (id: string) =>
  ecsBindings
    .flatMap((b) => [
      ...(b[1] === id
        ? [
            {
              id: id + "." + b[2],
              displayName: b[7],
              description:
                "Explicit typed binding; grants no permissions or application behavior.",
              direction: "output" as const,
              capability: b[0],
              category: "network-and-security" as const,
              cardinality: b[5] === 1 ? ("one" as const) : ("many" as const),
              required: [
                "aws.ecr.repository-owns-image",
                "aws.ecs.task-owns-container",
                "aws.ecs.service-uses-subnet",
                "aws.ecs.service-uses-security-group",
                "aws.ecs.container-writes-logs",
              ].includes(b[0]),
            },
          ]
        : []),
      ...(b[3] === id
        ? [
            {
              id: id + "." + b[4],
              displayName: b[7],
              description:
                "Explicit typed binding; external authority and runtime suitability remain separate.",
              direction: "input" as const,
              capability: b[0],
              category: "network-and-security" as const,
              cardinality: b[6] === 1 ? ("one" as const) : ("many" as const),
              required: [
                "aws.ecs.container-uses-image",
                "aws.ecs.service-uses-cluster",
                "aws.ecs.service-uses-task",
                "aws.ecs.task-uses-execution-role",
                "aws.ecs.task-uses-application-role",
              ].includes(b[0]),
            },
          ]
        : []),
    ])
    .filter((p, i, a) => a.findIndex((q) => q.id === p.id) === i);
const help: Record<string, string> = {
  digest:
    "Supply the actual externally published single-platform image digest. No tag/latest resolution, image build or registry lookup occurs.",
  publicationStatus:
    "Confirm publication only after external evidence. A new repository is empty; keep desired task count at zero until the exact digest is published.",
  architecture:
    "Declare the actual Linux image architecture and match the task definition. Export cannot inspect the image.",
  manifestType:
    "Single-platform image manifests only. Multi-platform indexes need a separate selection/verification contract.",
  desiredCount:
    "Zero exports staged infrastructure. Positive count requires declared external image publication and secret population; neither proves a runnable application.",
  user: "Supply the image's compatible nonzero numeric UID:GID. This baseline requires nonroot and a read-only root filesystem.",
  healthExecutable:
    "Declare an existing absolute executable in the image. ECS invokes direct CMD with no shell or arguments. Export never executes it; compatibility and health behavior require external evidence.",
  containerPort:
    "Declare the application's actual unprivileged TCP listening port. This creates no ingress, load balancer or DNS endpoint.",
  scanOnPush:
    "Basic scan-on-push intent only. Registry scan settings may override this; scan completion and vulnerability approval remain external.",
  retain:
    "Retained repositories and stored images continue to incur charges. Image cleanup/deletion is an external lifecycle decision.",
};
export const awsEcsServices = Object.entries(ecsProperties).map(
  ([id, properties]) => {
    const owned =
      id === "aws.ecr.image-reference" || id === "aws.ecs.container-definition";
    const owner =
      id === "aws.ecr.image-reference"
        ? "aws.ecr.repository"
        : "aws.ecs.task-definition";
    const ownerRel =
      id === "aws.ecr.image-reference"
        ? "aws.ecr.repository-owns-image"
        : "aws.ecs.task-owns-container";
    const native: Record<string, [string, string]> = {
      "aws.ecr.repository": ["aws_ecr_repository", "AWS::ECR::Repository"],
      "aws.ecs.cluster": ["aws_ecs_cluster", "AWS::ECS::Cluster"],
      "aws.ecs.task-definition": [
        "aws_ecs_task_definition",
        "AWS::ECS::TaskDefinition",
      ],
      "aws.ecs.service": ["aws_ecs_service", "AWS::ECS::Service"],
    };
    return defineProviderServiceV1({
      id,
      definitionVersion: "1.0.0",
      supportLevel: "production-oriented",
      displayName: labels[id] ?? id,
      description:
        "Bounded Linux Fargate/ECR foundation with explicit caller-declared image, ownership, identity and runtime dependencies.",
      nodeKind: { kind: "resource", resourceType: id, deployable: !owned },
      iconId: owned
        ? null
        : "aws.cloudmarkup.icons." +
          id.replace("aws.", "").replaceAll(".", "-"),
      placement: {
        rootPlacement: owned ? "forbidden" : "allowed",
        allowedParentTypes: owned
          ? [{ serviceId: owner, relationshipType: ownerRel }]
          : [],
        maximumDepth: owned ? 2 : 1,
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
        uiHints: Object.entries(properties).map(([key, value], order) => ({
          property: key,
          control:
            value.type === "boolean"
              ? "checkbox"
              : value.type === "integer"
                ? "number"
                : "enum" in value
                  ? "select"
                  : "text",
          label:
            key === "cpu"
              ? "CPU units"
              : key === "memoryMiB"
                ? "Memory (MiB)"
                : key === "user"
                  ? "Container UID:GID"
                  : key
                      .replace(/^[a-z]/, (letter) => letter.toUpperCase())
                      .replace(/[A-Z]/g, (letter, position: number) =>
                        position === 0 ? letter : ` ${letter.toLowerCase()}`,
                      ),
          helpText:
            help[key] ??
            "Explicit reviewed native intent. Provider availability, permissions, replacement behavior and application compatibility require external review.",
          order,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "cost-sensitive",
        })),
      },
      ports: ecsPorts(id),
      validationRuleIds: commonRules,
      education: {
        summary:
          "Models deliberate ECR/Linux Fargate infrastructure intent with exact external image and runtime dependencies.",
        guidedExplanation:
          "Create reviewed resources, configure an owned immutable image identity and one essential container, then connect explicit roles, logs and private networking. Keep tasks at zero until image and secret readiness is confirmed externally.",
        professionalExplanation:
          "Exact user-owned root resources and canonical owned configurations preserve native typed references. Distinct execution/task roles, immutable single-platform digests, finite CPU/memory tuples, direct executable health checks and explicit whole-secret bindings are validated offline without generating application artifacts or deployment authority.",
        considerations: [
          "Connections: Exact owner edges, image, roles, logs and same-VPC subnet/security-group bindings are required; canvas layout has no deployment meaning.",
          "Security: Execution policy is an explicit user-owned managed attachment. Secret injection requires exact GetSecretValue identity scope and AWS-managed secret encryption; CMK injection remains unsupported.",
          "Cost: Positive desired counts, image storage, log ingestion/retention and network egress incur charges; zero tasks still permit storage and supporting infrastructure costs.",
          "Operations: Publish images and populate secrets externally, review nonroot/read-only/health/port compatibility, PassRole and network egress before starting tasks. No application or live-provider evidence is generated.",
        ],
        documentation: ecsDocumentation,
      },
      unsupportedCapabilities: [
        {
          id: id + ".unsupported.expanded-runtime",
          title: "Expanded runtime and live verification pending",
          explanation:
            "The reviewed contract supports explicit ALB target-group bindings and whole-secret environment references for one essential Linux Fargate container. Multi-container tasks, image builds/pushes/lookups, manifest indexes, imports, Windows/EC2/Spot capacity, volumes, shell commands, Exec, scaling, public task addressing, expanded load-balancer modes, service discovery, CMK secret injection and application generation require separate contracts.",
        },
      ],
      mappings: owned
        ? []
        : [
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
                rendererContractId: "cloudmarkup.iac.ecs-terraform",
                rendererContractVersion: "1.0.0",
                generatedResourceTypes: [],
              },
              configurationBindings: [],
              semanticConfigurationKeys: Object.keys(properties),
              portBindings: [],
            },
            {
              target: "cloudformation",
              kind: "resource",
              mappingId: id + ".cloudformation",
              declarationVersion: 1,
              implementationStatus: "implemented",
              typeName: native[id]?.[1] ?? "",
              projection: {
                kind: "relationship-resource",
                rendererContractId: "cloudmarkup.iac.ecs-cloudformation",
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
          "No live service/capacity/image availability lookup is performed; verify the target Region externally.",
      },
    });
  },
);
export function extendServiceForEcs(
  s: ProviderServiceDefinitionV1,
): ProviderServiceDefinitionV1 {
  if (!ecsBindings.some((b) => b[1] === s.id || b[3] === s.id)) return s;
  const additions = ecsPorts(s.id).filter(
    (p) => !s.ports.some((q) => p.id === q.id),
  );
  return defineProviderServiceV1({
    ...s,
    ports: [...s.ports, ...additions],
    validationRuleIds: [...s.validationRuleIds, ecsRuleId],
  });
}
