import {
  defineProviderServiceV1,
  type ProviderServiceDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";
type Properties =
  ProviderServiceDefinitionV1Input["configuration"]["jsonSchema"]["properties"];
export const dnsRuleId = "aws.cloudmarkup.validation.dns-certificate-readiness";
export const dnsProperties: Record<string, Properties> = {
  "aws.route53.public-hosted-zone": {
    domainName: {
      type: "string",
      minLength: 3,
      maxLength: 253,
      pattern:
        "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$",
    },
    comment: {
      type: "string",
      minLength: 1,
      maxLength: 256,
    },
    domainControlAttested: {
      type: "boolean",
      const: true,
    },
    zoneType: {
      type: "string",
      enum: ["public"],
      default: "public",
    },
    delegationMode: {
      type: "string",
      enum: ["external"],
      default: "external",
    },
    retain: {
      type: "boolean",
      const: true,
      default: true,
    },
    forceDestroy: {
      type: "boolean",
      const: false,
      default: false,
    },
  },
  "aws.acm.public-dns-certificate": {
    domainName: {
      type: "string",
      minLength: 3,
      maxLength: 253,
      pattern:
        "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$",
    },
    certificateRegion: {
      type: "string",
      pattern: "^[a-z]{2}(?:-[a-z]+)+-[1-9]$",
    },
    intendedUse: {
      type: "string",
      enum: ["regional", "cloudfront-viewer"],
      default: "regional",
    },
    certificateType: {
      type: "string",
      enum: ["public"],
      default: "public",
    },
    validationMethod: {
      type: "string",
      enum: ["DNS"],
      default: "DNS",
    },
    keyAlgorithm: {
      type: "string",
      enum: ["RSA_2048"],
      default: "RSA_2048",
    },
    certificateExport: {
      type: "string",
      enum: ["DISABLED"],
      default: "DISABLED",
    },
    transparencyLogging: {
      type: "string",
      enum: ["ENABLED"],
      default: "ENABLED",
    },
    validationRecordsMode: {
      type: "string",
      enum: ["managed-dns"],
      default: "managed-dns",
    },
    retain: {
      type: "boolean",
      const: true,
      default: true,
    },
  },
};
export const dnsBindings = [
  [
    "aws.acm.certificate-validates-in-zone",
    "aws.acm.public-dns-certificate",
    "validation-zone",
    "aws.route53.public-hosted-zone",
    "certificate",
    1,
    128,
    "Validates certificate in zone",
  ],
] as const;
export const dnsDocumentation = [
  {
    kind: "official" as const,
    id: "aws.route53.documentation.hosted-zone",
    title: "Public hosted zone",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-route53-hostedzone.html",
  },
  {
    kind: "official" as const,
    id: "aws.acm.documentation.certificate",
    title: "Public DNS certificate",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-certificatemanager-certificate.html",
  },
  {
    kind: "official" as const,
    id: "aws.acm.documentation.viewer-region",
    title: "CloudFront viewer certificate Region",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html",
  },
];
export const dnsPorts = (id: string) =>
  dnsBindings.flatMap((b) => [
    ...(b[1] === id
      ? [
          {
            id: id + "." + b[2],
            displayName: b[7],
            description:
              "Bind one exact modeled public zone for managed certificate DNS validation; domain authority remains caller-attested.",
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
              "Accept exact certificate validation bindings; external delegation and issuer readiness are not verified.",
            direction: "input" as const,
            capability: b[0],
            category: "network-and-security" as const,
            cardinality: "many" as const,
            required: false,
          },
        ]
      : []),
  ]);
const labels: Record<string, string> = {
  "aws.route53.public-hosted-zone": "Route53 public hosted zone",
  "aws.acm.public-dns-certificate": "ACM public DNS certificate",
};
const native: Record<string, [string, string]> = {
  "aws.route53.public-hosted-zone": [
    "aws_route53_zone",
    "AWS::Route53::HostedZone",
  ],
  "aws.acm.public-dns-certificate": [
    "aws_acm_certificate",
    "AWS::CertificateManager::Certificate",
  ],
};
const help: Record<string, string> = {
  domainName:
    "Canonical lowercase ASCII FQDN with no trailing dot, wildcard, Unicode or SANs. Certificate name must belong to its chosen public zone; syntactic validity does not prove registration or issuer eligibility.",
  domainControlAttested:
    "You attest control of the registrar or authoritative parent zone. This declaration is not verified evidence. Register or delegate externally; the app never changes NS records.",
  delegationMode:
    "Delegation remains external. Exported zone name servers must be installed through the registrar or authoritative parent zone before certificate validation can succeed.",
  certificateRegion:
    "Exactly match the graph Region. CloudFront viewer intent requires us-east-1. Cross-region stacks/provider aliases are unsupported; CloudFormation must be deployed in that declared Region externally.",
  intendedUse:
    "Regional intent uses this graph Region. CloudFront viewer intent requires us-east-1 but creates no distribution or consumer binding.",
  validationRecordsMode:
    "The future export models certificate CNAME validation: a Terraform record and waiter, or CloudFormation inline DNS validation. External registrar delegation and existing DNS/CAA eligibility must be reviewed; no live lookup occurs.",
  certificateExport:
    "Private-key export is disabled. Imported keys, private CA certificates and exportable paid certificates are unsupported.",
  retain:
    "Native zone, certificate and Terraform validation CNAME are protected/retained. Renewal records and paid hosted-zone cleanup remain external; no silent record deletion or adoption.",
};
export const awsDnsServices = Object.entries(dnsProperties).map(
  ([id, properties]) =>
    defineProviderServiceV1({
      id,
      definitionVersion: "1.0.0",
      supportLevel: "production-oriented",
      displayName: labels[id] ?? id,
      description:
        "Bounded new public-zone and single-domain managed DNS certificate intent with explicit external domain authority, declared Region and retained ownership.",
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
            s.type === "boolean" ? "checkbox" : "enum" in s ? "select" : "text",
          label: key
            .replace(/^[a-z]/, (l) => l.toUpperCase())
            .replace(/[A-Z]/g, (l, position: number) =>
              position === 0 ? l : " " + l.toLowerCase(),
            ),
          helpText:
            help[key] ??
            "Explicit reviewed native configuration; domain/issuer/deployer authority, DNS, retention and Region availability require external review.",
          order,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "cost-sensitive",
        })),
      },
      ports: dnsPorts(id),
      validationRuleIds: [
        dnsRuleId,
        "aws.cloudmarkup.validation.connection-cardinality",
        "aws.cloudmarkup.validation.compiler-readiness",
        "aws.cloudmarkup.validation.region-availability",
      ],
      education: {
        summary:
          "Models public DNS zone and certificate validation intent without verifying domain control, issuance or changing live DNS.",
        guidedExplanation:
          "Create a retained public zone for a domain you control and bind a single-domain ACM certificate to it. Supply the certificate Region and install the exported name servers through your registrar or parent-zone owner externally.",
        professionalExplanation:
          "Exact root ownership, closed literal schemas, canonical DNS suffix authority, managed validation projection and declared regional/viewer use preserve target-specific validation and retention. Cross-region provider/stack orchestration and live issuance are outside this contract.",
        considerations: [
          "Connections: A certificate binds one exact public zone containing its domain. Most-specific modeled zone authority is required; no application alias, viewer distribution or TLS listener is inferred.",
          "Cost: Public hosted zones and DNS queries incur charges after separately authorized provisioning. Certificate export is disabled; retained zones and validation records need deliberate external cleanup.",
          "Operations: Delegate through your registrar or parent zone, verify public DNS/CAA/issuer eligibility and use the declared stack Region externally. Validation may remain pending; no issuance or renewal health is proven.",
          "Security: Domain control is caller-attested, never verified by this graph. No credential, private key, certificate import, private CA, DNSSEC change, provider execution or generated IAM authority is included.",
        ],
        documentation: dnsDocumentation,
      },
      unsupportedCapabilities: [
        {
          id: id + ".unsupported.expanded-edge",
          title: "Expanded DNS and certificate consumers pending",
          explanation:
            "Existing/external zones, cross-account/provider/Region orchestration, domain registration/delegation, private zones, arbitrary/alias/routing/health records, DNSSEC/query logging, wildcard/SAN/email/private/import/exportable certificates, CloudFront/ELB/API consumers and live issuance/renewal checks need separate contracts.",
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
            rendererContractId: "cloudmarkup.iac.dns-acm-terraform",
            rendererContractVersion: "1.0.0",
            generatedResourceTypes:
              id === "aws.acm.public-dns-certificate"
                ? ["aws_route53_record", "aws_acm_certificate_validation"]
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
          typeName: native[id]?.[1] ?? "",
          projection: {
            kind: "relationship-resource",
            rendererContractId: "cloudmarkup.iac.dns-acm-cloudformation",
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
          "No live public DNS, ACM/Region/issuer, registrar, delegation, CAA or deployer availability lookup.",
      },
    }),
);
