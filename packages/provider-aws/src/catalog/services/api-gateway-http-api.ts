import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

export const apiGatewayHttpApi = defineProviderServiceV1({
  id: "aws.apigateway.http-api",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "API Gateway HTTP API",
  description:
    "A curated HTTP API surface for routing authenticated notes requests to one Lambda function.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.apigateway.http-api",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.apigateway",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.apigateway.http-api.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.apigateway.http-api.configuration:1.0.0",
      type: "object",
      title: "API Gateway HTTP API configuration",
      description:
        "Safe initial settings for the authenticated notes HTTP API.",
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          default: "notes-api",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9._-]+$",
        },
        protocolType: {
          type: "string",
          enum: ["HTTP"],
          default: "HTTP",
        },
        corsEnabled: { type: "boolean", const: false, default: false },
        jwtAuthorizationRequired: {
          type: "boolean",
          const: true,
          default: true,
        },
      },
      required: [
        "name",
        "protocolType",
        "corsEnabled",
        "jwtAuthorizationRequired",
      ],
    },
    uiHints: [
      {
        property: "name",
        control: "text",
        label: "API name",
        helpText: "A stable name for the notes HTTP API.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "protocolType",
        control: "select",
        label: "Protocol",
        helpText: "This slice supports HTTP APIs only.",
        order: 1,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "corsEnabled",
        control: "checkbox",
        label: "Enable CORS",
        helpText:
          "CORS remains disabled until allowed origins, methods, and headers have reviewed catalog semantics.",
        order: 2,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "jwtAuthorizationRequired",
        control: "checkbox",
        label: "Require JWT authorization",
        helpText:
          "The authenticated notes API cannot disable JWT authorization.",
        order: 3,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
    ],
  },
  ports: [
    {
      id: "aws.apigateway.http-api.invocation",
      displayName: "Route invocation",
      description: "Routes notes API requests to a Lambda integration.",
      direction: "output",
      capability: "aws.apigateway.invoke.lambda",
      category: "receives-events-from",
      cardinality: "many",
      required: true,
    },
    {
      id: "aws.apigateway.http-api.jwt-issuer",
      displayName: "JWT issuer",
      description: "Accepts the Cognito user-pool issuer for JWT validation.",
      direction: "input",
      capability: "aws.apigateway.authorizer.jwt-issuer",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.apigateway.http-api.jwt-audience",
      displayName: "JWT audience",
      description: "Accepts the Cognito app-client ID as the JWT audience.",
      direction: "input",
      capability: "aws.apigateway.authorizer.jwt-audience",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
  ],
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.api-route-authentication",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.connection-questions",
    "aws.cloudmarkup.validation.region-availability",
  ],
  education: {
    summary:
      "Routes authenticated HTTP requests into the supported notes workload.",
    guidedExplanation:
      "This is the public entry point. It validates the issuer and audience in each JWT against the connected Cognito resources, then sends authorized requests through reviewed routes to connected Lambda integrations.",
    professionalExplanation:
      "Models an API Gateway v2 HTTP API with required JWT-issuer and JWT-audience inputs plus Lambda route integrations. Only catalog-defined routes and connections are supported; CORS policy, custom domains, WAF, and non-HTTP API types remain outside this definition.",
    considerations: [
      "Connections: Supply one Cognito issuer, one app-client audience, and only reviewed Lambda route integrations.",
      "Security: JWT authorization is required and CORS remains off until origins, methods, headers, and credentials have explicit policy.",
      "Cost: Request volume and connected Lambda execution can incur provider charges; this catalog does not calculate a bill.",
      "Operations: Review each method, path, authorizer, and integration before export; an API resource alone does not create a usable route.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.apigateway.documentation.http-api",
        title: "Working with HTTP APIs",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.apigateway.unsupported.cors-policy",
      title: "CORS policy",
      explanation:
        "Cross-origin policy needs explicit allowed origins, methods, headers, credentials, and cache behavior; a boolean switch is not compiled.",
    },
    {
      id: "aws.apigateway.unsupported.rest-websocket-private",
      title: "REST, WebSocket, and private APIs",
      explanation:
        "This slice supports only a regional API Gateway v2 HTTP API.",
    },
    {
      id: "aws.apigateway.unsupported.custom-domain-mtls-waf",
      title: "Custom domains, mutual TLS, and WAF",
      explanation:
        "Domain mappings, certificates, mutual TLS, and web ACLs require later catalog and compiler definitions.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.apigateway.http-api.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_apigatewayv2_api",
      configurationBindings: [
        { configurationKey: "name", targetName: "name" },
        { configurationKey: "protocolType", targetName: "protocol_type" },
      ],
      portBindings: [
        {
          portId: "aws.apigateway.http-api.invocation",
          targetAttribute: "integration.lambda",
        },
        {
          portId: "aws.apigateway.http-api.jwt-issuer",
          targetAttribute: "authorizer.issuer",
        },
        {
          portId: "aws.apigateway.http-api.jwt-audience",
          targetAttribute: "authorizer.audience",
        },
      ],
    },
    {
      mappingId: "aws.apigateway.http-api.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::ApiGatewayV2::Api",
      configurationBindings: [
        { configurationKey: "name", targetName: "Name" },
        { configurationKey: "protocolType", targetName: "ProtocolType" },
      ],
      portBindings: [],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound AWS regional availability dataset is bundled with this catalog.",
  },
});
