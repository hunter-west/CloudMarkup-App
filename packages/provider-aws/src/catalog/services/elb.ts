import {
  defineProviderServiceV1,
  type ProviderServiceDefinitionV1,
  type ProviderServiceDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";
import { dnsProperties } from "./dns-acm.js";
import { securityGroupRuleDescriptionPattern } from "./security-group-description.js";
type Properties =
  ProviderServiceDefinitionV1Input["configuration"]["jsonSchema"]["properties"];
export const elbRuleId = "aws.cloudmarkup.validation.elb-readiness";
export const elbProperties: Record<string, Properties> = {
  "aws.elb.application-load-balancer": {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 32,
      pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
    },
    scheme: { type: "string", enum: ["internal", "internet-facing"] },
    loadBalancerType: {
      type: "string",
      enum: ["application"],
      default: "application",
    },
    ipAddressType: { type: "string", enum: ["ipv4"], default: "ipv4" },
    idleTimeoutSeconds: {
      type: "integer",
      minimum: 30,
      maximum: 300,
      default: 60,
    },
    http2: { type: "boolean", const: true, default: true },
    dropInvalidHeaders: { type: "boolean", const: true, default: true },
    desyncMitigation: {
      type: "string",
      enum: ["defensive"],
      default: "defensive",
    },
    deletionProtection: { type: "boolean", const: true, default: true },
    retain: { type: "boolean", const: true, default: true },
  },
  "aws.elb.target-group": {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 32,
      pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
    },
    backendMode: { type: "string", enum: ["ec2-instance", "ecs-fargate"] },
    port: { type: "integer", minimum: 1, maximum: 65535 },
    protocol: { type: "string", enum: ["HTTP"], default: "HTTP" },
    protocolVersion: { type: "string", enum: ["HTTP1"], default: "HTTP1" },
    healthPath: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^/[A-Za-z0-9._~/-]*$",
    },
    healthStatus: { type: "string", enum: ["200"], default: "200" },
    healthIntervalSeconds: {
      type: "integer",
      minimum: 30,
      maximum: 30,
      default: 30,
    },
    healthTimeoutSeconds: {
      type: "integer",
      minimum: 5,
      maximum: 5,
      default: 5,
    },
    healthyThreshold: { type: "integer", minimum: 2, maximum: 2, default: 2 },
    unhealthyThreshold: { type: "integer", minimum: 2, maximum: 2, default: 2 },
    deregistrationDelaySeconds: {
      type: "integer",
      minimum: 30,
      maximum: 300,
      default: 60,
    },
    startupGraceSeconds: { type: "integer", minimum: 0, maximum: 300 },
    retain: { type: "boolean", const: true, default: true },
  },
  "aws.elb.https-listener": {
    serverName: dnsProperties["aws.acm.public-dns-certificate"]?.[
      "domainName"
    ] ?? { type: "string" },
    port: { type: "integer", minimum: 443, maximum: 443, default: 443 },
    protocol: { type: "string", enum: ["HTTPS"], default: "HTTPS" },
    securityPolicy: {
      type: "string",
      enum: ["ELBSecurityPolicy-TLS13-1-2-2021-06"],
      default: "ELBSecurityPolicy-TLS13-1-2-2021-06",
    },
    defaultAction: { type: "string", enum: ["forward"], default: "forward" },
    domainMappingMode: {
      type: "string",
      enum: ["external"],
      default: "external",
    },
    retain: { type: "boolean", const: true, default: true },
  },
  "aws.elb.backend-access-configuration": {
    description: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: securityGroupRuleDescriptionPattern,
    },
    protocol: { type: "string", enum: ["tcp"], default: "tcp" },
    retain: { type: "boolean", const: true, default: true },
  },
};
export const elbBindings = [
  [
    "aws.elb.alb-uses-vpc",
    "aws.elb.application-load-balancer",
    "vpc",
    "aws.ec2.vpc",
    "alb",
    1,
    128,
    "Uses ALB VPC",
  ],
  [
    "aws.elb.alb-uses-subnet",
    "aws.elb.application-load-balancer",
    "subnet",
    "aws.ec2.subnet",
    "alb",
    16,
    128,
    "Uses ALB subnet",
  ],
  [
    "aws.elb.alb-uses-security-group",
    "aws.elb.application-load-balancer",
    "security-group",
    "aws.ec2.security-group",
    "alb",
    1,
    128,
    "Uses ALB security group",
  ],
  [
    "aws.elb.alb-owns-listener",
    "aws.elb.https-listener",
    "alb",
    "aws.elb.application-load-balancer",
    "listener",
    1,
    1,
    "Owns HTTPS listener",
  ],
  [
    "aws.elb.listener-forwards-to-target-group",
    "aws.elb.https-listener",
    "target-group",
    "aws.elb.target-group",
    "listener",
    1,
    1,
    "Forwards to target group",
  ],
  [
    "aws.elb.listener-uses-certificate",
    "aws.elb.https-listener",
    "certificate",
    "aws.acm.public-dns-certificate",
    "alb-listener",
    1,
    128,
    "Uses regional certificate",
  ],
  [
    "aws.elb.target-group-uses-vpc",
    "aws.elb.target-group",
    "vpc",
    "aws.ec2.vpc",
    "alb-target-group",
    1,
    128,
    "Uses target VPC",
  ],
  [
    "aws.elb.target-group-targets-ec2",
    "aws.elb.target-group",
    "ec2-backend",
    "aws.ec2.instance",
    "alb-target",
    1,
    1,
    "Targets private EC2 instance",
  ],
  [
    "aws.elb.target-group-targets-ecs",
    "aws.elb.target-group",
    "ecs-backend",
    "aws.ecs.service",
    "alb-target",
    1,
    1,
    "Targets Fargate service",
  ],
  [
    "aws.elb.target-group-owns-backend-access",
    "aws.elb.backend-access-configuration",
    "target-group",
    "aws.elb.target-group",
    "backend-access",
    1,
    1,
    "Owns backend access",
  ],
  [
    "aws.elb.backend-access-uses-alb-group",
    "aws.elb.backend-access-configuration",
    "alb-group",
    "aws.ec2.security-group",
    "alb-access-source",
    1,
    128,
    "Uses exact ALB source group",
  ],
  [
    "aws.elb.backend-access-uses-target-group",
    "aws.elb.backend-access-configuration",
    "backend-group",
    "aws.ec2.security-group",
    "alb-access-target",
    1,
    128,
    "Uses exact backend group",
  ],
] as const;
export const elbDocumentation = [
  {
    kind: "official" as const,
    id: "aws.elb.documentation.alb",
    title: "ALB native contract",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-loadbalancer.html",
  },
  {
    kind: "official" as const,
    id: "aws.elb.documentation.targets",
    title: "ALB target group",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-targetgroup.html",
  },
  {
    kind: "official" as const,
    id: "aws.elb.documentation.listener",
    title: "HTTPS listener",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listener.html",
  },
  {
    kind: "official" as const,
    id: "aws.elb.documentation.access",
    title: "ALB security group paths",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-update-security-groups.html",
  },
  {
    kind: "official" as const,
    id: "aws.elb.documentation.ecs",
    title: "ECS ALB integration",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html",
  },
];
export const elbPorts = (id: string) =>
  elbBindings.flatMap((b) => [
    ...(b[1] === id
      ? [
          {
            id: id + "." + b[2],
            displayName: b[7],
            description:
              "Exact bounded ALB dependency; validation checks topology, ownership and backend mode.",
            direction: "output" as const,
            capability: b[0],
            category: "network-and-security" as const,
            cardinality: b[5] === 1 ? ("one" as const) : ("many" as const),
            required: ![
              "aws.elb.target-group-targets-ec2",
              "aws.elb.target-group-targets-ecs",
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
              "Accept a reviewed explicit ALB dependency; no IAM or client ingress is inferred.",
            direction: "input" as const,
            capability: b[0],
            category: "network-and-security" as const,
            cardinality: b[6] === 1 ? ("one" as const) : ("many" as const),
            required: ["aws.elb.alb-owns-listener"].includes(b[0]),
          },
        ]
      : []),
  ]);
const labels: Record<string, string> = {
  "aws.elb.application-load-balancer": "Application Load Balancer",
  "aws.elb.target-group": "ALB target group",
  "aws.elb.https-listener": "ALB HTTPS listener",
  "aws.elb.backend-access-configuration": "ALB backend access",
};
const help: Record<string, string> = {
  name: "Explicit native name; unique in the modeled account/Region. ALB names cannot start internal-. Name/scheme/target mode changes can require protected replacement.",
  scheme:
    "Internal serves VPC-reachable clients. Internet-facing requires exact graph-backed internet-gateway routes on all selected ALB subnets. No AWS resource is created by configuration/export.",
  backendMode:
    "Choose exactly one existing private EC2 instance or one existing Linux Fargate service. No arbitrary IP/Lambda targets, shared groups or other capacity modes.",
  port: "One HTTP backend and health-check TCP port. Fargate must exactly match its one essential container port. Viewer TLS ends at the ALB; backend HTTP is explicitly unencrypted.",
  healthPath:
    "An explicit HTTP path returning 200 on the same backend port. Configure the application separately; declaring the path does not verify health.",
  startupGraceSeconds:
    "For ECS, ignore unhealthy load-balancer checks during this declared startup period (0-300 seconds). EC2 has no service startup grace and requires zero.",
  deregistrationDelaySeconds:
    "Drain 30-300 seconds before deregistration; application shutdown and in-flight request handling remain external.",
  serverName:
    "Exact canonical primary domain of the regional DNS ACM certificate. Configure client hostname mapping to the ALB externally. Its generated DNS name does not match this custom certificate automatically.",
  securityPolicy:
    "One reviewed TLS 1.2/1.3 policy; no mTLS, extra SNI certificates, authentication or arbitrary policies.",
  domainMappingMode:
    "This slice exports the HTTPS certificate/listener and ALB DNS output, but creates no ALB DNS alias. Actual delegation, hostname mapping, issuance/renewal and TLS health stay external.",
  description:
    "Purpose for the two exact ALB/backend group TCP peer rules. Use 1-128 AWS-supported ASCII letters, digits, spaces or ._-:/()#,@[]+=;{}!$*. Ampersands, line breaks and other characters are not supported. Canonical ownership and selected groups prevent arbitrary access inference; CloudFormation owns exact egress inline, and Terraform emits dedicated peer rules.",
  retain:
    "Native ALB, targets, listener, peer rules and the two dedicated peer groups are protected/retained. Serving/access can remain after graph removal; deliberate cleanup must be reviewed separately.",
};
const nativeTypes: Record<string, [string, string]> = {
  "aws.elb.application-load-balancer": [
    "aws_lb",
    "AWS::ElasticLoadBalancingV2::LoadBalancer",
  ],
  "aws.elb.target-group": [
    "aws_lb_target_group",
    "AWS::ElasticLoadBalancingV2::TargetGroup",
  ],
  "aws.elb.https-listener": [
    "aws_lb_listener",
    "AWS::ElasticLoadBalancingV2::Listener",
  ],
};
export const awsElbServices = Object.entries(elbProperties).map(
  ([id, properties]) => {
    const access = id === "aws.elb.backend-access-configuration",
      listener = id === "aws.elb.https-listener",
      owned = access || listener;
    return defineProviderServiceV1({
      id,
      definitionVersion: "1.0.0",
      supportLevel: "production-oriented",
      displayName: labels[id] ?? id,
      description:
        "Bounded IPv4 ALB with exact same-VPC/AZ/subnet/SG dependencies, one HTTPS default listener and one dedicated HTTP target group for private EC2 or Linux Fargate.",
      nodeKind: { kind: "resource", resourceType: id, deployable: !access },
      iconId: access ? null : id + ".icon",
      placement: {
        rootPlacement: owned ? "forbidden" : "allowed",
        allowedParentTypes: owned
          ? [
              {
                serviceId: listener
                  ? "aws.elb.application-load-balancer"
                  : "aws.elb.target-group",
                relationshipType: listener
                  ? "aws.elb.alb-owns-listener"
                  : "aws.elb.target-group-owns-backend-access",
              },
            ]
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
            "Reviewed bounded ALB intent; verify external application, authority and availability separately.",
          order,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: access ? "none" : "cost-sensitive",
        })),
      },
      ports: elbPorts(id),
      validationRuleIds: [
        elbRuleId,
        "aws.cloudmarkup.validation.connection-cardinality",
        "aws.cloudmarkup.validation.compiler-readiness",
        "aws.cloudmarkup.validation.region-availability",
      ],
      education: {
        summary:
          "Models and exports bounded ALB delivery; does not provision resources or prove DNS/TLS/backend health.",
        guidedExplanation:
          "Choose explicit scheme, connect distinct-AZ subnets and exact SG, create one HTTPS listener/certificate and one target group with an exact private backend and owned group-to-group access.",
        professionalExplanation:
          "One HTTPS/443 default forward listener uses the exact regional ACM certificate; HTTP1 backend/health traffic uses the declared TCP port. EC2 has native instance attachment; Fargate uses native IP registration with exact container identity and listener dependency. No IAM/client ingress or DNS alias is inferred.",
        considerations: [
          "Connections: Dedicated listener, target group and backend-access parent/edges must agree. Do not share groups/backends or merge imported/custom access.",
          "Security: Viewer TLS does not encrypt the HTTP backend or authenticate application viewers. Explicit selected SG paths and client ingress are graph intent, not live network assurance.",
          "Cost: Separately provisioning an ALB incurs hourly/capacity/network and backend charges; exports perform no AWS call.",
          "Operations: Verify quotas, subnet free IPs/AZ availability, route/NACLs, deployer/service-linked role authority, hostname mapping, certificate issuance/renewal, application HTTP health and retained cleanup externally.",
        ],
        documentation: elbDocumentation,
      },
      unsupportedCapabilities: [
        {
          id: id + ".unsupported.expanded",
          title: "Expanded load balancing pending",
          explanation:
            "NLB/GWLB, IPv6, Outposts/Local Zones, imported/external/adopted resources, arbitrary IP/Lambda/cross-VPC/shared/multiple targets, multiple listeners/groups, rules/redirects/weighted routing/authentication/mTLS, extra SNI certificates, backend HTTPS/HTTP2/gRPC, other ECS capacity/deployments, WAF/logging/LCU reservations, Auto Scaling, ALB DNS aliases, application generation and live health require separate contracts.",
        },
      ],
      mappings: access
        ? []
        : [
            {
              target: "terraform",
              mappingId: id + ".terraform",
              declarationVersion: 1,
              implementationStatus: "implemented",
              kind: "resource",
              providerSource: "hashicorp/aws",
              resourceType: nativeTypes[id]?.[0] ?? "aws_lb",
              projection: {
                kind: "relationship-resource",
                rendererContractId: "cloudmarkup.iac.elb-terraform",
                rendererContractVersion: "1.0.0",
                generatedResourceTypes:
                  id === "aws.elb.target-group"
                    ? ["aws_lb_target_group_attachment"]
                    : [],
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
              typeName:
                nativeTypes[id]?.[1] ??
                "AWS::ElasticLoadBalancingV2::LoadBalancer",
              projection: {
                kind: "relationship-resource",
                rendererContractId: "cloudmarkup.iac.elb-cloudformation",
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
          "Commercial partition modeled without a live/versioned service-AZ/IP/certificate availability inventory.",
      },
    });
  },
);
export function extendServiceForElb(
  s: ProviderServiceDefinitionV1,
): ProviderServiceDefinitionV1 {
  const ports = elbPorts(s.id);
  if (!ports.length) return s;
  return defineProviderServiceV1({
    ...s,
    ports: [...s.ports, ...ports],
    validationRuleIds: [...s.validationRuleIds, elbRuleId],
    unsupportedCapabilities: s.unsupportedCapabilities.map((c) => ({
      ...c,
      explanation: c.explanation
        .replace("load balancers,", "expanded load-balancer modes,")
        .replace(
          "CloudFront/ELB/API consumers",
          "Expanded CloudFront/ELB/API consumers",
        ),
    })),
  });
}
