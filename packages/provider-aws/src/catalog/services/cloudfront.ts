import {
  defineProviderServiceV1,
  type ProviderServiceDefinitionV1,
  type ProviderServiceDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";
type Properties =
  ProviderServiceDefinitionV1Input["configuration"]["jsonSchema"]["properties"];
export const cloudfrontRuleId =
  "aws.cloudmarkup.validation.cloudfront-readiness";
export const cloudfrontProperties: Record<string, Properties> = {
  "aws.cloudfront.distribution": {
    comment: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    enabled: {
      type: "boolean",
    },
    publicContentAttested: {
      type: "boolean",
      const: true,
    },
    defaultRootObject: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
    },
    priceClass: {
      type: "string",
      enum: ["PriceClass_100", "PriceClass_200", "PriceClass_All"],
    },
    viewerCertificateMode: {
      type: "string",
      enum: ["default", "acm-alias"],
      default: "default",
    },
    viewerProtocolPolicy: {
      type: "string",
      enum: ["redirect-to-https"],
      default: "redirect-to-https",
    },
    httpVersion: {
      type: "string",
      enum: ["http2"],
      default: "http2",
    },
    ipv6Enabled: {
      type: "boolean",
      const: true,
      default: true,
    },
    compress: {
      type: "boolean",
      const: true,
      default: true,
    },
    originAccessMode: {
      type: "string",
      enum: ["oac-signed-readonly"],
      default: "oac-signed-readonly",
    },
    retain: {
      type: "boolean",
      const: true,
      default: true,
    },
  },
  "aws.cloudfront.cache-policy": {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z][A-Za-z0-9_-]*$",
    },
    comment: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    minTtl: {
      type: "integer",
      minimum: 0,
      maximum: 0,
      default: 0,
    },
    defaultTtl: {
      type: "integer",
      minimum: 0,
      maximum: 86400,
    },
    maxTtl: {
      type: "integer",
      minimum: 60,
      maximum: 86400,
    },
    forwardViewerCookies: { type: "boolean", const: false, default: false },
    headers: {
      type: "string",
      enum: ["none"],
      default: "none",
    },
    queryStrings: {
      type: "string",
      enum: ["none"],
      default: "none",
    },
    gzip: {
      type: "boolean",
      const: true,
      default: true,
    },
    brotli: {
      type: "boolean",
      const: true,
      default: true,
    },
    retain: {
      type: "boolean",
      const: true,
      default: true,
    },
  },
  "aws.cloudfront.alias-configuration": {
    domainName: {
      type: "string",
      minLength: 3,
      maxLength: 253,
      pattern:
        "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$",
    },
    dnsRecords: {
      type: "string",
      enum: ["A_AND_AAAA"],
      default: "A_AND_AAAA",
    },
    retain: {
      type: "boolean",
      const: true,
      default: true,
    },
  },
};
export const cloudfrontBindings = [
  [
    "aws.cloudfront.reads-s3-origin",
    "aws.cloudfront.distribution",
    "s3-origin",
    "aws.s3.bucket",
    "cloudfront-origin",
    1,
    1,
    "Reads private S3 origin",
  ],
  [
    "aws.cloudfront.uses-cache-policy",
    "aws.cloudfront.distribution",
    "cache-policy",
    "aws.cloudfront.cache-policy",
    "distribution",
    1,
    128,
    "Uses cache policy",
  ],
  [
    "aws.cloudfront.distribution-owns-alias",
    "aws.cloudfront.alias-configuration",
    "distribution",
    "aws.cloudfront.distribution",
    "alias",
    1,
    1,
    "Owns alias configuration",
  ],
  [
    "aws.cloudfront.alias-uses-certificate",
    "aws.cloudfront.alias-configuration",
    "certificate",
    "aws.acm.public-dns-certificate",
    "cloudfront-alias",
    1,
    1,
    "Uses viewer certificate",
  ],
] as const;
export const cloudfrontDocumentation = [
  {
    kind: "official" as const,
    id: "aws.cloudfront.documentation.distribution",
    title: "CloudFront distribution",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-distribution.html",
  },
  {
    kind: "official" as const,
    id: "aws.cloudfront.documentation.oac",
    title: "Private S3 origin access",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html",
  },
  {
    kind: "official" as const,
    id: "aws.cloudfront.documentation.viewer",
    title: "Viewer certificate requirements",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html",
  },
];
export const cloudfrontPorts = (id: string) =>
  cloudfrontBindings.flatMap((b) => [
    ...(b[1] === id
      ? [
          {
            id: id + "." + b[2],
            displayName: b[7],
            description:
              "Exact private S3/cache/alias dependency; no live readiness or provisioning is proven.",
            direction: "output" as const,
            capability: b[0],
            category: "network-and-security" as const,
            cardinality: "one" as const,
            required: true,
          },
        ]
      : []),
    ...(b[3] === id
      ? [
          {
            id: id + "." + b[4],
            displayName: b[7],
            description:
              "Accept the exact bounded CloudFront dependency. Owned aliases require matching parent and certificate identity.",
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
  "aws.cloudfront.distribution": "CloudFront distribution",
  "aws.cloudfront.cache-policy": "CloudFront static cache policy",
  "aws.cloudfront.alias-configuration": "CloudFront alias configuration",
};
const help: Record<string, string> = {
  enabled:
    "Explicit future serving intent. Export never provisions or enables a distribution.",
  publicContentAttested:
    "You declare that every object in this dedicated origin bucket is intended for public viewer delivery. The app does not inspect content. OAC restricts direct origin access, not viewer access.",
  viewerCertificateMode:
    "Default uses the CloudFront hostname and managed certificate with no alias. ACM alias requires one owned alias, an exact matching single-domain certificate with CloudFront-viewer intent in us-east-1, and its caller-attested zone. Custom alias graphs stay in us-east-1; cross-region stacks are unsupported.",
  defaultRootObject:
    "One object filename without slash or traversal. No SPA fallback or application generation.",
  minTtl:
    "Fixed zero so origin no-cache/no-store/private directives are not overridden by a positive minimum TTL.",
  defaultTtl:
    "Fallback seconds only when origin freshness headers are absent. Must not exceed max TTL.",
  maxTtl:
    "Bounded maximum 60-86400 seconds. Cache-disabled policies, arbitrary cache keys and origin request policies are unsupported.",
  forwardViewerCookies:
    "No viewer cookies, query strings or custom headers are forwarded or included; normalized Accept-Encoding is included for gzip/Brotli. This slice serves public static objects, not authenticated/dynamic responses.",
  domainName:
    "One canonical lowercase alias must exactly equal the certificate primary domain and be covered by its most-specific caller-attested public zone. Alias A/AAAA records are explicit owned projections, never live DNS changes.",
  retain:
    "Distribution, cache policy, OAC, generated origin policy and alias records are protected/retained. Removing graph dependencies never proves cloud cleanup; retained serving/access and deliberate cleanup require external review.",
};
export const awsCloudfrontServices = Object.entries(cloudfrontProperties).map(
  ([id, properties]) => {
    const owned = id === "aws.cloudfront.alias-configuration";
    return defineProviderServiceV1({
      id,
      definitionVersion: "1.0.0",
      supportLevel: "production-oriented",
      displayName: labels[id] ?? id,
      description:
        "Bounded standard global distribution with one dedicated private S3 REST origin, explicit public content intent, one default static cache behavior and optional owned single-domain alias.",
      nodeKind: { kind: "resource", resourceType: id, deployable: !owned },
      iconId: owned
        ? null
        : "aws.cloudmarkup.icons." +
          id.replace("aws.", "").replaceAll(".", "-"),
      placement: {
        rootPlacement: owned ? "forbidden" : "allowed",
        allowedParentTypes: owned
          ? [
              {
                serviceId: "aws.cloudfront.distribution",
                relationshipType: "aws.cloudfront.distribution-owns-alias",
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
            .replace(/^[a-z]/, (l) => l.toUpperCase())
            .replace(/[A-Z]/g, (l, position: number) =>
              position === 0 ? l : " " + l.toLowerCase(),
            ),
          helpText:
            help[key] ??
            help["forwardViewerCookies"] ??
            "Reviewed bounded static distribution intent; verify external authority and readiness separately.",
          order,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "cost-sensitive",
        })),
      },
      ports: cloudfrontPorts(id),
      validationRuleIds: [
        cloudfrontRuleId,
        "aws.cloudmarkup.validation.connection-cardinality",
        "aws.cloudmarkup.validation.compiler-readiness",
        "aws.cloudmarkup.validation.region-availability",
      ],
      education: {
        summary:
          "Models public static delivery through a private S3 origin; no live distribution, content, DNS or TLS readiness is verified.",
        guidedExplanation:
          "Create one dedicated private S3 origin and connect a user-owned static cache policy. Explicitly attest public content. Optionally add one owned alias with an exact us-east-1 viewer certificate and its public zone.",
        professionalExplanation:
          "OAC always signs SigV4 requests; generated s3:GetObject policy is scoped to exact bucket objects and exact distribution SourceArn. One default GET/HEAD cache behavior, min TTL zero, no cookies/query/custom headers, HTTPS redirect, HTTP2 and IPv6 preserve the reviewed public static contract.",
        considerations: [
          "Connections: One dedicated private S3 origin and static cache policy bind explicitly; canonical alias and generated policy provenance preserve reversible ownership. Protected cloud cleanup remains external.",
          "Cost: Distribution delivery, requests and retained resources incur charges only after separate provisioning; price class and enabled intent are explicit.",
          "Security: Private origin access does not authenticate viewers. No broader IAM actions, custom/raw policy merge, KMS access or direct origin/public ACL is inferred.",
          "Operations: Verify alias exclusivity, delegation, certificate eligibility/issuance, content population, response headers, quotas and deployer authority externally. No object upload, invalidation, TLS probe or deployment occurs.",
        ],
        documentation: cloudfrontDocumentation,
      },
      unsupportedCapabilities: [
        {
          id: id + ".unsupported.expanded",
          title: "Expanded origins and behavior pending",
          explanation:
            "Dynamic/custom/website/VPC/access-point origins, multi-origin/failover/ordered behavior, methods beyond GET/HEAD, origin request/response policies, cookies/query/custom headers, signed viewers, functions/Lambda@Edge, WAF/logging/georestriction/custom errors, staging/continuous deployment, SAN/wildcard/imported certificates, cross-account/Region orchestration, existing/adopted policy merge and live health need separate contracts.",
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
              resourceType:
                id === "aws.cloudfront.distribution"
                  ? "aws_cloudfront_distribution"
                  : "aws_cloudfront_cache_policy",
              projection: {
                kind: "relationship-resource",
                rendererContractId: "cloudmarkup.iac.cloudfront-terraform",
                rendererContractVersion: "1.0.0",
                generatedResourceTypes:
                  id === "aws.cloudfront.distribution"
                    ? ["aws_cloudfront_origin_access_control"]
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
                id === "aws.cloudfront.distribution"
                  ? "AWS::CloudFront::Distribution"
                  : "AWS::CloudFront::CachePolicy",
              projection: {
                kind: "relationship-resource",
                rendererContractId: "cloudmarkup.iac.cloudfront-cloudformation",
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
          "Global standard distribution modeled in the commercial AWS partition; no live origin/issuer/account/alias/Region lookup.",
      },
    });
  },
);
export function extendServiceForCloudfront(
  s: ProviderServiceDefinitionV1,
): ProviderServiceDefinitionV1 {
  const ports = cloudfrontPorts(s.id);
  if (!ports.length) return s;
  return defineProviderServiceV1({
    ...s,
    unsupportedCapabilities: s.unsupportedCapabilities.map((c) => ({
      ...c,
      explanation: c.explanation.replace(
        "CloudFront/ELB/API consumers",
        "Expanded CloudFront/ELB/API consumers",
      ),
    })),
    ports: [...s.ports, ...ports],
    validationRuleIds: [...s.validationRuleIds, cloudfrontRuleId],
  });
}
