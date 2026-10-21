import {
  defineProviderConnectionRuleV1,
  defineProviderServiceV1,
  defineProviderValidationRuleDescriptorV1,
  type ProviderServiceDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";

// Regional WAF is a bounded CloudFormation proof slice in the current catalog.
export const WAF_WEB_ACL = "aws.wafv2.web-acl";
export const WAF_ASSOCIATION = "aws.wafv2.alb-association";
export const WAF_ALB = "aws.elb.application-load-balancer";
export const WAF_OWNER = "aws.wafv2.association-uses-web-acl";
export const WAF_PROTECTS = "aws.wafv2.association-protects-alb";
export const WAF_VALIDATION =
  "aws.cloudmarkup.validation.regional-waf-readiness";
export const wafDocumentation = (
  [
    [
      "resources",
      "Resources protected by AWS WAF",
      "https://docs.aws.amazon.com/waf/latest/developerguide/how-aws-waf-works-resources.html",
    ],
    [
      "association",
      "WAF associations and testing",
      "https://docs.aws.amazon.com/waf/latest/developerguide/web-acl-associating-aws-resource.html",
    ],
    [
      "web-acl",
      "CloudFormation Web ACL",
      "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-wafv2-webacl.html",
    ],
    [
      "association-cfn",
      "CloudFormation Web ACL association",
      "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-wafv2-webaclassociation.html",
    ],
    [
      "rules",
      "AWS managed baseline rules",
      "https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html",
    ],
    [
      "rate",
      "CloudFormation rate rule",
      "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-wafv2-webacl-ratebasedstatement.html",
    ],
    [
      "visibility",
      "Metrics and sampling",
      "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-wafv2-webacl-visibilityconfig.html",
    ],
  ] as const
).map(([id, title, url]) => ({
  kind: "official" as const,
  id: "aws.wafv2.documentation." + id,
  title,
  publisher: "Amazon Web Services",
  url,
}));

type Properties =
  ProviderServiceDefinitionV1Input["configuration"]["jsonSchema"]["properties"];
export const wafProperties: Properties = {
  name: {
    type: "string",
    minLength: 1,
    maxLength: 100,
    pattern: "^[A-Za-z0-9_-]+$",
  },
  webAclRegion: {
    type: "string",
    minLength: 9,
    maxLength: 32,
    pattern: "^(?:af|ap|ca|eu|il|me|mx|sa|us)-[a-z]+-[0-9]+$",
  },
  scope: { type: "string", enum: ["REGIONAL"], default: "REGIONAL" },
  defaultAction: { type: "string", enum: ["allow"], default: "allow" },
  managedRuleGroup: {
    type: "string",
    enum: ["AWSManagedRulesKnownBadInputsRuleSet"],
    default: "AWSManagedRulesKnownBadInputsRuleSet",
  },
  managedRuleVersionPolicy: {
    type: "string",
    enum: ["vendor-default"],
    default: "vendor-default",
  },
  managedRuleMode: {
    type: "string",
    enum: ["count", "enforce"],
    default: "count",
  },
  managedRulePriority: {
    type: "integer",
    minimum: 0,
    maximum: 100,
    default: 10,
  },
  rateLimit: {
    type: "integer",
    minimum: 10,
    maximum: 2000000000,
    default: 2000,
  },
  rateWindowSeconds: {
    type: "integer",
    enum: [60, 120, 300, 600],
    default: 300,
  },
  rateAction: { type: "string", enum: ["count", "block"], default: "count" },
  ratePriority: { type: "integer", minimum: 0, maximum: 100, default: 0 },
  aggregateKey: { type: "string", enum: ["IP"], default: "IP" },
  cloudWatchMetricsEnabled: { type: "boolean", default: true },
  sampledRequestsEnabled: { type: "boolean", const: false, default: false },
  requestLogging: { type: "string", enum: ["disabled"], default: "disabled" },
  retain: { type: "boolean", const: true, default: true },
};
const labels: Record<string, string> = {
  name: "Web ACL name",
  webAclRegion: "Web ACL Region",
  scope: "Scope",
  defaultAction: "Default action",
  managedRuleGroup: "Managed rule group",
  managedRuleVersionPolicy: "Managed rule version policy",
  managedRuleMode: "Managed group mode",
  managedRulePriority: "Managed rule priority",
  rateLimit: "Rate limit",
  rateWindowSeconds: "Rate window seconds",
  rateAction: "Rate rule action",
  ratePriority: "Rate rule priority",
  aggregateKey: "Aggregation key",
  cloudWatchMetricsEnabled: "CloudWatch metrics enabled",
  sampledRequestsEnabled: "Sampled requests enabled",
  requestLogging: "Request logging",
  retain: "Retain Web ACL",
};
const help: Record<string, string> = {
  name: "Explicit Web ACL name. Renaming replaces the retained ACL; review cleanup separately. Metric suffixes are derived from this name.",
  webAclRegion:
    "Must equal this project's AWS Region and the ALB's modeled Region. WAF availability remains unknown until separately checked.",
  scope:
    "Regional ALBs only. CloudFront global/us-east-1, Outposts and other resource types are deferred.",
  defaultAction:
    "Allow requests that do not match an enforcing rule. Count mode observes traffic and does not block it.",
  managedRuleGroup:
    "One reviewed AWS Known Bad Inputs group. This is bounded protection, not a complete application security guarantee. ALB body inspection is limited to 8 KB.",
  managedRuleVersionPolicy:
    "Uses the AWS vendor default, which can change independently of this saved graph. No static rule-content version or fixed WCU claim is made.",
  managedRuleMode:
    "Count overrides the group's result to count. Enforce retains each vendor rule's own actions. Test/tune in count mode before enforcement; a group override does not count every internal rule independently.",
  managedRulePriority:
    "Unique integer priority; lower values evaluate first. Must differ from the rate priority.",
  rateLimit:
    "Approximate requests per origin IP over the selected lookback window. This is not an exact application quota. NAT/proxy users can share an origin IP.",
  rateWindowSeconds:
    "Lookback window: 60, 120, 300 or 600 seconds. It is not the interval between WAF evaluations.",
  rateAction:
    "Count observes over-limit requests; block can interrupt legitimate clients. Review the threshold against traffic before blocking.",
  ratePriority:
    "Unique integer priority; lower values evaluate first. Must differ from the managed-rule priority.",
  aggregateKey:
    "Use request origin IP only. Forwarded headers, custom keys and scope-down expressions are deferred.",
  cloudWatchMetricsEnabled:
    "Enable metrics on the ACL and each rule. Metrics do not enable full request logging or prove traffic was inspected.",
  sampledRequestsEnabled:
    "Request sampling is disabled in this slice. Logging redaction would not redact sampled requests.",
  requestLogging:
    "Full request logging is disabled. No log destination, logging resource, resource policy or service-linked role is generated.",
  retain:
    "Retain the Web ACL on stack removal/replacement. Associations follow explicit graph removal and can disassociate traffic; review separately deployed changes.",
};
function requiredMetadata(
  values: Readonly<Record<string, string>>,
  key: string,
): string {
  const value = values[key];
  if (value === undefined)
    throw new Error("Missing WAF field metadata: " + key);
  return value;
}
export const wafBindings = [
  [
    WAF_OWNER,
    WAF_ASSOCIATION,
    "web-acl",
    WAF_WEB_ACL,
    "association",
    1,
    128,
    "Uses regional Web ACL",
  ],
  [WAF_PROTECTS, WAF_ASSOCIATION, "alb", WAF_ALB, "waf", 1, 1, "Protects ALB"],
] as const;
export const wafPorts = (
  id: string,
): ProviderServiceDefinitionV1Input["ports"] =>
  wafBindings.flatMap((b) => [
    ...(b[1] === id
      ? [
          {
            id: id + "." + b[2],
            displayName: b[7],
            description:
              "Exact regional WAF association; no IAM or traffic rules are inferred.",
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
            description: "Accept an exact same-Region WAF association.",
            direction: "input" as const,
            capability: b[0],
            category: "network-and-security" as const,
            cardinality: b[6] === 1 ? ("one" as const) : ("many" as const),
            required: id === WAF_WEB_ACL,
          },
        ]
      : []),
  ]);
export const wafValidationDescriptor = defineProviderValidationRuleDescriptorV1(
  {
    id: WAF_VALIDATION,
    interfaceVersion: 1,
    ruleVersion: "1.0.0",
    implementationId: WAF_VALIDATION + ".evaluate",
    serviceIds: [WAF_WEB_ACL, WAF_ASSOCIATION, WAF_ALB],
    documentation: wafDocumentation,
  },
);
export const wafServices = [WAF_WEB_ACL, WAF_ASSOCIATION].map((id) => {
  const association = id === WAF_ASSOCIATION;
  const properties = association ? {} : wafProperties;
  return defineProviderServiceV1({
    id,
    definitionVersion: "1.0.0",
    supportLevel: "proof",
    displayName: association
      ? "WAF ALB association (proof)"
      : "Regional WAF Web ACL (proof)",
    description:
      "Bounded regional WAFv2 intent for a modeled ALB; CloudFormation infrastructure proof only. Terraform and live traffic qualification remain unavailable.",
    nodeKind: { kind: "resource", resourceType: id, deployable: true },
    iconId: id + ".icon",
    placement: {
      rootPlacement: association ? "forbidden" : "allowed",
      allowedParentTypes: association
        ? [{ serviceId: WAF_WEB_ACL, relationshipType: WAF_OWNER }]
        : [],
      maximumDepth: association ? 2 : 1,
      regionConstraint: "same-region",
    },
    configuration: {
      schemaId: id + ".configuration",
      schemaVersion: "1.0.0",
      jsonSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:cloudmarkup:configuration:" + id + ".configuration:1.0.0",
        type: "object",
        title: association ? "Regional ALB association" : "Regional WAF intent",
        additionalProperties: false,
        properties,
        required: Object.keys(properties),
      },
      uiHints: Object.entries(properties).map(([key, p], order) => ({
        property: key,
        control:
          p.type === "boolean"
            ? "checkbox"
            : p.type === "integer"
              ? "number"
              : "enum" in p
                ? "select"
                : "text",
        label: requiredMetadata(labels, key),
        helpText: requiredMetadata(help, key),
        order,
        advanced: [
          "managedRulePriority",
          "ratePriority",
          "managedRuleVersionPolicy",
          "scope",
          "aggregateKey",
          "sampledRequestsEnabled",
          "requestLogging",
          "retain",
        ].includes(key),
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      })),
    },
    ports: wafPorts(id),
    validationRuleIds: [
      WAF_VALIDATION,
      "aws.cloudmarkup.validation.connection-cardinality",
      "aws.cloudmarkup.validation.compiler-readiness",
      "aws.cloudmarkup.validation.region-availability",
    ],
    education: {
      summary:
        "Candidate infrastructure only; no deployment, live traffic proof or application code.",
      guidedExplanation:
        "Create a regional ACL, start both rules in count mode and add an owned association to your existing ALB. Metrics are separate from request logs. Review traffic before changing enforcement.",
      professionalExplanation:
        "Closed REGIONAL WebACL and canonical owned WebACLAssociation. Exact typed ARN bindings, unique ordered priorities, origin-IP approximate rate limit and one AWS managed group. Vendor default rules can evolve outside the graph.",
      considerations: [
        "Connections: Use one explicit owned association from the regional Web ACL to an existing modeled ALB in this project; no permissions are inferred.",
        "Cost: Separately deploying WAF incurs ACL and request-processing charges; deterministic offline exports do not call AWS or establish live protection.",
        "Operations: Same project/account/Region modeled ALBs only. Verify regional availability, quotas, managed-group availability and traffic effects externally.",
        "Security: Count mode does not block or replace application authorization, input validation or network controls. Request sampling and logging stay disabled; metrics are independent.",
      ],
      documentation: wafDocumentation,
    },
    unsupportedCapabilities: [
      {
        id: id + ".unsupported.expanded",
        title: "Expanded WAF support deferred",
        explanation:
          "CloudFront/global scope, API Gateway HTTP APIs, REST stages, other AWS targets, Outposts, cross-account/Region, external/adopted resources, custom/IP/regex rules, forwarded-IP/custom aggregation, scope-down expressions, rule exceptions, pinned managed versions, CAPTCHA/challenge, Bot/Fraud Control, request sampling/log destinations, Terraform/provider execution and application generation are unavailable.",
      },
    ],
    mappings: [
      {
        target: "cloudformation",
        mappingId: id + ".cloudformation",
        declarationVersion: 1,
        implementationStatus: "implemented",
        kind: "resource",
        typeName: association
          ? "AWS::WAFv2::WebACLAssociation"
          : "AWS::WAFv2::WebACL",
        projection: {
          kind: "relationship-resource",
          rendererContractId: "cloudmarkup.iac.regional-waf-cloudformation",
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
        "No version-bound regional WAF availability inventory or live AWS check is installed.",
    },
  });
});
export const wafConnectionRules = wafBindings.map(
  ([id, source, sourcePort, target, targetPort, sourceMax, targetMax, label]) =>
    defineProviderConnectionRuleV1({
      id,
      ruleVersion: "1.0.0",
      relationshipType: id,
      category: "network-and-security",
      source: { serviceId: source, portId: source + "." + sourcePort },
      target: { serviceId: target, portId: target + "." + targetPort },
      maximumConnectionsPerSource: sourceMax,
      maximumConnectionsPerTarget: targetMax,
      maximumConnectionsPerEndpointPair: 1,
      configuration: {
        schemaId: id + ".connection",
        schemaVersion: "1.0.0",
        jsonSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          $id: "urn:cloudmarkup:configuration:" + id + ".connection:1.0.0",
          type: "object",
          title: label,
          additionalProperties: false,
          properties: {},
          required: [],
        },
        uiHints: [],
      },
      questions: [],
      supportingChanges: [],
      iamEffects: [],
      missingInformationFindings: [],
      lifecycle: {
        provenance: "connection-rule",
        deletion: "release-generated-resources",
        adoption: "required-before-customization",
        sharedResource: "retain-while-referenced",
      },
      implementation: {
        status: "implemented",
        interfaceVersion: 1,
        implementationId: id + ".resolve",
      },
      validationRuleIds: [
        WAF_VALIDATION,
        "aws.cloudmarkup.validation.connection-cardinality",
      ],
      education: {
        summary: label,
        guidedExplanation:
          "Associate one explicit regional ACL with an ALB in this project. Count mode observes only.",
        professionalExplanation:
          "Exact typed endpoints, canonical owned association, bounded cardinality and closed empty binding; no IAM generation.",
        considerations: [
          "Security: One Web ACL per ALB; no HTTP API or CloudFront targets.",
          "Operations: Graph changes are export intent; separately deploying removal can disassociate protection.",
        ],
        documentation: wafDocumentation,
      },
    }),
);

export function extendServiceForRegionalWaf(
  service: (typeof wafServices)[number],
) {
  return service.id === WAF_ALB
    ? defineProviderServiceV1({
        ...service,
        ports: [...service.ports, ...wafPorts(service.id)],
        validationRuleIds: [...service.validationRuleIds, WAF_VALIDATION],
        unsupportedCapabilities: service.unsupportedCapabilities.map(
          (value) => ({
            ...value,
            explanation: value.explanation.replace(
              "WAF/logging/LCU",
              "expanded WAF/logging/LCU",
            ),
          }),
        ),
      })
    : service;
}
