import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

export const cognitoUserPoolClient = defineProviderServiceV1({
  id: "aws.cognito.user-pool-client",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "Cognito user pool app client",
  description:
    "A public Cognito app client that supplies the JWT audience without a client secret.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.cognito.user-pool-client",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.cognito-app-client",
  placement: {
    rootPlacement: "forbidden",
    allowedParentTypes: [
      {
        serviceId: "aws.cognito.user-pool",
        relationshipType: "aws.cognito.contains-app-client",
      },
    ],
    maximumDepth: 2,
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.cognito.user-pool-client.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.cognito.user-pool-client.configuration:1.0.0",
      type: "object",
      title: "Cognito app client configuration",
      description:
        "A secretless public client configuration for notes API JWTs.",
      additionalProperties: false,
      properties: {
        clientName: {
          type: "string",
          default: "notes-web",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9._ -]+$",
        },
        generateClientSecret: {
          type: "boolean",
          const: false,
          default: false,
        },
        allowUserSrpAuth: {
          type: "boolean",
          const: true,
          default: true,
        },
        allowRefreshTokenAuth: {
          type: "boolean",
          const: true,
          default: true,
        },
        preventUserExistenceErrors: {
          type: "boolean",
          const: true,
          default: true,
        },
        accessTokenValidityMinutes: {
          type: "integer",
          default: 15,
          minimum: 5,
          maximum: 60,
        },
        idTokenValidityMinutes: {
          type: "integer",
          default: 15,
          minimum: 5,
          maximum: 60,
        },
        refreshTokenValidityDays: {
          type: "integer",
          default: 30,
          minimum: 1,
          maximum: 90,
        },
      },
      required: [
        "clientName",
        "generateClientSecret",
        "allowUserSrpAuth",
        "allowRefreshTokenAuth",
        "preventUserExistenceErrors",
        "accessTokenValidityMinutes",
        "idTokenValidityMinutes",
        "refreshTokenValidityDays",
      ],
    },
    uiHints: [
      {
        property: "clientName",
        control: "text",
        label: "App client name",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "generateClientSecret",
        control: "checkbox",
        label: "Generate client secret",
        helpText:
          "Client secrets cannot be safely embedded in browser or mobile applications and are disabled.",
        order: 1,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "allowUserSrpAuth",
        control: "checkbox",
        label: "Allow SRP authentication",
        order: 2,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "allowRefreshTokenAuth",
        control: "checkbox",
        label: "Allow refresh tokens",
        order: 3,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "preventUserExistenceErrors",
        control: "checkbox",
        label: "Prevent user-existence errors",
        order: 4,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "accessTokenValidityMinutes",
        control: "number",
        label: "Access token lifetime (minutes)",
        order: 5,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "idTokenValidityMinutes",
        control: "number",
        label: "ID token lifetime (minutes)",
        order: 6,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "refreshTokenValidityDays",
        control: "number",
        label: "Refresh token lifetime (days)",
        order: 7,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
    ],
  },
  ports: [
    {
      id: "aws.cognito.user-pool-client.user-pool",
      displayName: "User pool",
      description: "Accepts the containing Cognito user-pool ID.",
      direction: "input",
      capability: "aws.cognito.user-pool.client-registration",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.cognito.user-pool-client.jwt-audience",
      displayName: "JWT audience",
      description: "Provides the app-client ID to an HTTP API authorizer.",
      direction: "output",
      capability: "aws.cognito.jwt-audience",
      category: "network-and-security",
      cardinality: "many",
      required: true,
    },
  ],
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.api-route-authentication",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.region-availability",
  ],
  education: {
    summary:
      "Identifies a public application when it authenticates with the user pool.",
    guidedExplanation:
      "The app client is registered inside one user pool. Its generated client ID becomes the JWT audience expected by API Gateway, while its token lifetimes control how long issued credentials remain useful.",
    professionalExplanation:
      "Models a secretless public user-pool client with SRP and refresh-token authentication, bounded access, ID, and refresh token validity, plus user-existence error prevention. Client secrets, OAuth grants, callback URLs, and hosted UI behavior are deliberately excluded.",
    considerations: [
      "Connections: The client belongs to exactly one user pool, and its generated ID supplies the API authorizer audience.",
      "Security: Public browser or mobile clients must not embed a client secret; shorter access and ID token lifetimes reduce exposure.",
      "Cost: This definition makes no pricing claim; authentication usage belongs to the connected identity service and must be reviewed separately.",
      "Operations: Balance short access tokens against refresh-token lifetime, revocation, session renewal, and user support expectations.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.cognito.documentation.user-pool-client",
        title: "User pool app clients",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.cognito.unsupported.client-secret",
      title: "Client secrets",
      explanation:
        "The client secret setting is fixed to false; no secret value can enter the catalog or architecture document.",
    },
    {
      id: "aws.cognito.unsupported.oauth-hosted-ui",
      title: "OAuth grants and hosted UI callbacks",
      explanation:
        "OAuth scopes, callback URLs, logout URLs, client credentials, and hosted UI behavior are outside this slice.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.cognito.user-pool-client.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_cognito_user_pool_client",
      configurationBindings: [
        { configurationKey: "clientName", targetName: "name" },
        {
          configurationKey: "generateClientSecret",
          targetName: "generate_secret",
        },
        {
          configurationKey: "allowUserSrpAuth",
          targetName: "explicit_auth_flows.allow_user_srp_auth",
        },
        {
          configurationKey: "allowRefreshTokenAuth",
          targetName: "explicit_auth_flows.allow_refresh_token_auth",
        },
        {
          configurationKey: "preventUserExistenceErrors",
          targetName: "prevent_user_existence_errors",
        },
        {
          configurationKey: "accessTokenValidityMinutes",
          targetName: "access_token_validity",
        },
        {
          configurationKey: "idTokenValidityMinutes",
          targetName: "id_token_validity",
        },
        {
          configurationKey: "refreshTokenValidityDays",
          targetName: "refresh_token_validity",
        },
      ],
      portBindings: [
        {
          portId: "aws.cognito.user-pool-client.user-pool",
          targetAttribute: "user_pool_id",
        },
        {
          portId: "aws.cognito.user-pool-client.jwt-audience",
          targetAttribute: "id",
        },
      ],
    },
    {
      mappingId: "aws.cognito.user-pool-client.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::Cognito::UserPoolClient",
      configurationBindings: [
        { configurationKey: "clientName", targetName: "ClientName" },
        {
          configurationKey: "generateClientSecret",
          targetName: "GenerateSecret",
        },
        {
          configurationKey: "preventUserExistenceErrors",
          targetName: "PreventUserExistenceErrors",
        },
        {
          configurationKey: "accessTokenValidityMinutes",
          targetName: "AccessTokenValidity",
        },
        {
          configurationKey: "idTokenValidityMinutes",
          targetName: "IdTokenValidity",
        },
        {
          configurationKey: "refreshTokenValidityDays",
          targetName: "RefreshTokenValidity",
        },
      ],
      portBindings: [
        {
          portId: "aws.cognito.user-pool-client.user-pool",
          targetAttribute: "UserPoolId",
        },
      ],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed, version-bound regional feature matrix for Cognito is bundled with this catalog.",
  },
});
