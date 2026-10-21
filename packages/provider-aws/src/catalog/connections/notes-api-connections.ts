import { defineProviderConnectionRuleV1 } from "@cloudmarkup/provider-sdk";

import { emptyConfiguration } from "./empty-configuration.js";

const lifecycle = {
  provenance: "connection-rule",
  deletion: "release-generated-resources",
  adoption: "required-before-customization",
  sharedResource: "retain-while-referenced",
} as const;

function implemented(implementationId: string) {
  return {
    status: "implemented" as const,
    interfaceVersion: 1 as const,
    implementationId,
  };
}

function descriptorOnly(reason: string) {
  return {
    status: "not-implemented" as const,
    reason,
  };
}

export const apiInvokesLambda = defineProviderConnectionRuleV1({
  id: "aws.apigateway.http-api-invokes-lambda",
  ruleVersion: "1.0.0",
  relationshipType: "aws.apigateway.integrates-lambda",
  category: "receives-events-from",
  source: {
    serviceId: "aws.apigateway.http-api",
    portId: "aws.apigateway.http-api.invocation",
  },
  target: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.synchronous-invocation",
  },
  maximumConnectionsPerSource: 32,
  maximumConnectionsPerTarget: 8,
  maximumConnectionsPerEndpointPair: 8,
  configuration: {
    schemaId: "aws.apigateway.lambda-integration.connection",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.apigateway.lambda-integration.connection:1.0.0",
      type: "object",
      title: "HTTP API route and Lambda integration",
      description:
        "A curated HTTP route with the reviewed Lambda payload format and timeout.",
      additionalProperties: false,
      properties: {
        routeKey: {
          type: "string",
          minLength: 6,
          maxLength: 128,
          pattern: "^(GET|POST|PUT|PATCH|DELETE) /[A-Za-z0-9_/{}/-]*$",
        },
        payloadFormatVersion: {
          type: "string",
          enum: ["2.0"],
          default: "2.0",
        },
        timeoutMilliseconds: {
          type: "integer",
          default: 10000,
          minimum: 50,
          maximum: 30000,
        },
      },
      required: ["routeKey", "payloadFormatVersion", "timeoutMilliseconds"],
    },
    uiHints: [
      {
        property: "routeKey",
        control: "text",
        label: "Route",
        helpText: "For example, GET /notes or POST /notes.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "payloadFormatVersion",
        control: "select",
        label: "Payload format",
        order: 1,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "timeoutMilliseconds",
        control: "number",
        label: "Integration timeout",
        order: 2,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
    ],
  },
  questions: [
    {
      id: "aws.apigateway.question.route-key",
      property: "routeKey",
      prompt: "Which HTTP method and path should invoke this function?",
      explanation:
        "A route is explicit so CloudMarkup never creates a broad catch-all integration by assumption.",
      answer: {
        kind: "required-user-input",
        reason: "No route is universally safe for an application.",
      },
    },
    {
      id: "aws.apigateway.question.payload-format",
      property: "payloadFormatVersion",
      prompt: "Which HTTP API Lambda payload format should be used?",
      explanation:
        "Version 2.0 is the reviewed default for this HTTP API catalog slice.",
      answer: { kind: "catalog-default" },
    },
    {
      id: "aws.apigateway.question.integration-timeout",
      property: "timeoutMilliseconds",
      prompt: "How long may API Gateway wait for the function?",
      explanation:
        "Ten seconds is a bounded default that avoids silently selecting the maximum timeout.",
      answer: { kind: "catalog-default" },
    },
  ],
  supportingChanges: [
    {
      id: "aws.apigateway.supporting.lambda-service-grant-document-node",
      kind: "node",
      serviceId: "aws.iam.policy-document",
      ownership: "generated",
      purpose:
        "Creates one Lambda-owned service-grant document for the API Gateway invocation principal.",
    },
    {
      id: "aws.apigateway.supporting.lambda-service-grant-statement-node",
      kind: "node",
      serviceId: "aws.iam.policy-statement",
      ownership: "generated",
      purpose:
        "Creates one exact lambda:InvokeFunction statement for the API Gateway service principal.",
    },
    {
      id: "aws.apigateway.supporting.lambda-service-grant-owner-edge",
      kind: "edge",
      relationshipType: "aws.lambda.owns-invocation-permission",
      ownership: "generated",
      purpose:
        "Binds the generated service grant to the connected Lambda invocation-permission slot.",
    },
    {
      id: "aws.apigateway.supporting.lambda-service-grant-membership-edge",
      kind: "edge",
      relationshipType: "aws.iam.policy-contains-statement",
      ownership: "generated",
      purpose:
        "Adds the generated statement to its canonical service-grant document.",
    },
    {
      id: "aws.apigateway.supporting.lambda-service-grant-scope-edge",
      kind: "edge",
      relationshipType: "aws.iam.authorizes-lambda-function",
      ownership: "generated",
      purpose:
        "Scopes the invocation grant to the exact connected Lambda function.",
    },
  ],
  iamEffects: [
    {
      id: "aws.apigateway.iam.invoke-lambda",
      effect: "allow",
      actions: ["lambda:InvokeFunction"],
      resourceScope: "target-node",
      principal: "apigateway.amazonaws.com",
      explanation:
        "The future compiler may grant API Gateway invoke permission only on the connected Lambda function.",
    },
  ],
  missingInformationFindings: [
    {
      code: "aws.apigateway.finding.route-required",
      trigger: "missing-configuration",
      configurationProperties: ["routeKey"],
      guidedMessage:
        "Choose the HTTP method and path before adding this Lambda integration.",
      professionalMessage:
        "Route identity is required to prevent implicit catch-all behavior and to enforce duplicate-route exclusivity.",
    },
  ],
  lifecycle,
  implementation: implemented(
    "aws.apigateway.resolve-http-api-lambda-integration",
  ),
  validationRuleIds: [
    "aws.cloudmarkup.validation.api-route-authentication",
    "aws.cloudmarkup.validation.connection-questions",
  ],
  education: {
    summary: "Routes one HTTP API method and path to a Lambda function.",
    guidedExplanation:
      "This connection makes the Lambda function the handler for a specific notes API route and previews the required invoke permission.",
    professionalExplanation:
      "The resolver emits one version-bound integration edge. The future compiler will materialize API Gateway v2 route/integration resources and a resource-scoped Lambda permission.",
    considerations: [
      "Each API route key may have only one Lambda integration.",
      "The Lambda integration uses payload format version 2.0.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.apigateway.documentation.lambda-integration",
        title: "Lambda integrations for HTTP APIs",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html",
      },
    ],
  },
});

export const userPoolAuthorizesApi = defineProviderConnectionRuleV1({
  id: "aws.cognito.user-pool-authorizes-http-api",
  ruleVersion: "1.0.0",
  relationshipType: "aws.cognito.provides-jwt-issuer",
  category: "network-and-security",
  source: {
    serviceId: "aws.cognito.user-pool",
    portId: "aws.cognito.user-pool.jwt-issuer",
  },
  target: {
    serviceId: "aws.apigateway.http-api",
    portId: "aws.apigateway.http-api.jwt-issuer",
  },
  maximumConnectionsPerSource: 100,
  maximumConnectionsPerTarget: 1,
  maximumConnectionsPerEndpointPair: 1,
  configuration: {
    schemaId: "aws.cognito.jwt-issuer.connection",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.cognito.jwt-issuer.connection:1.0.0",
      type: "object",
      title: "Cognito JWT issuer connection",
      description:
        "The reviewed JWT authorizer name and Authorization header identity source.",
      additionalProperties: false,
      properties: {
        authorizerName: {
          type: "string",
          default: "notesJwt",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z][A-Za-z0-9_-]*$",
        },
        identitySource: {
          type: "string",
          enum: ["$request.header.Authorization"],
          default: "$request.header.Authorization",
        },
      },
      required: ["authorizerName", "identitySource"],
    },
    uiHints: [
      {
        property: "authorizerName",
        control: "text",
        label: "Authorizer name",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "identitySource",
        control: "select",
        label: "Token source",
        order: 1,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
    ],
  },
  questions: [
    {
      id: "aws.cognito.question.authorizer-name",
      property: "authorizerName",
      prompt: "What should the API JWT authorizer be called?",
      explanation:
        "The stable notesJwt default is descriptive without containing account or tenant data.",
      answer: { kind: "catalog-default" },
    },
    {
      id: "aws.cognito.question.identity-source",
      property: "identitySource",
      prompt: "Where should API Gateway read the bearer token?",
      explanation:
        "The Authorization header is the only reviewed identity source in this catalog.",
      answer: { kind: "catalog-default" },
    },
  ],
  supportingChanges: [],
  iamEffects: [],
  missingInformationFindings: [
    {
      code: "aws.cognito.finding.jwt-audience-required",
      trigger: "missing-prerequisite",
      configurationProperties: [],
      guidedMessage:
        "Connect a Cognito app client as the JWT audience before treating the API as fully authenticated.",
      professionalMessage:
        "A complete API Gateway JWT authorizer requires both issuer and audience relationships.",
    },
  ],
  lifecycle,
  implementation: implemented("aws.cognito.resolve-user-pool-api-authorizer"),
  validationRuleIds: ["aws.cloudmarkup.validation.api-route-authentication"],
  education: {
    summary: "Uses a Cognito user pool as the HTTP API JWT issuer.",
    guidedExplanation:
      "API Gateway checks that bearer tokens came from this user pool before the notes function is invoked.",
    professionalExplanation:
      "The relationship supplies the user-pool issuer to an API Gateway v2 JWT authorizer; a separate app-client edge supplies the audience.",
    considerations: [
      "The API also needs one reviewed app-client audience.",
      "The issuer and API use the same catalog-bound region.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.apigateway.documentation.jwt-authorizer",
        title: "Control access to HTTP APIs with JWT authorizers",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html",
      },
    ],
  },
});

export const appClientAuthorizesApi = defineProviderConnectionRuleV1({
  id: "aws.cognito.app-client-authorizes-http-api",
  ruleVersion: "1.0.0",
  relationshipType: "aws.cognito.provides-jwt-audience",
  category: "network-and-security",
  source: {
    serviceId: "aws.cognito.user-pool-client",
    portId: "aws.cognito.user-pool-client.jwt-audience",
  },
  target: {
    serviceId: "aws.apigateway.http-api",
    portId: "aws.apigateway.http-api.jwt-audience",
  },
  maximumConnectionsPerSource: 100,
  maximumConnectionsPerTarget: 1,
  maximumConnectionsPerEndpointPair: 1,
  configuration: emptyConfiguration(
    "aws.cognito.jwt-audience.connection",
    "Cognito JWT audience connection",
    "The app-client ID is resolved from graph identity; no secret or inline value is accepted.",
  ),
  questions: [],
  supportingChanges: [],
  iamEffects: [],
  missingInformationFindings: [
    {
      code: "aws.cognito.finding.jwt-issuer-required",
      trigger: "missing-prerequisite",
      configurationProperties: [],
      guidedMessage:
        "Connect the app client's Cognito user pool as the API JWT issuer.",
      professionalMessage:
        "A complete API Gateway JWT authorizer requires both audience and issuer relationships.",
    },
  ],
  lifecycle,
  implementation: implemented("aws.cognito.resolve-app-client-api-audience"),
  validationRuleIds: ["aws.cloudmarkup.validation.api-route-authentication"],
  education: {
    summary: "Uses the Cognito app-client ID as the HTTP API JWT audience.",
    guidedExplanation:
      "API Gateway accepts tokens only when they were created for this secretless notes app client.",
    professionalExplanation:
      "The resolver adds the typed audience relationship without accepting a pasted client ID or client secret.",
    considerations: [
      "A separate user-pool relationship supplies the issuer.",
      "Do not substitute a client secret for the audience ID.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.apigateway.documentation.jwt-audience",
        title: "JWT authorizer workflow",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html",
      },
    ],
  },
});

export const userPoolConfiguresClient = defineProviderConnectionRuleV1({
  id: "aws.cognito.user-pool-configures-app-client",
  ruleVersion: "1.0.0",
  relationshipType: "aws.cognito.contains-app-client",
  category: "network-and-security",
  source: {
    serviceId: "aws.cognito.user-pool",
    portId: "aws.cognito.user-pool.app-client-parent",
  },
  target: {
    serviceId: "aws.cognito.user-pool-client",
    portId: "aws.cognito.user-pool-client.user-pool",
  },
  maximumConnectionsPerSource: 100,
  maximumConnectionsPerTarget: 1,
  maximumConnectionsPerEndpointPair: 1,
  configuration: emptyConfiguration(
    "aws.cognito.user-pool-client.connection",
    "User pool app-client containment",
    "Containment is derived from the two graph nodes and has no inline configuration.",
  ),
  questions: [],
  supportingChanges: [],
  iamEffects: [],
  missingInformationFindings: [],
  lifecycle,
  implementation: descriptorOnly(
    "App-client containment remains a descriptor because the current task implements API authorization, not parent creation or reparenting.",
  ),
  validationRuleIds: ["aws.cloudmarkup.validation.api-route-authentication"],
  education: {
    summary: "Registers the app client in its containing user pool.",
    guidedExplanation:
      "The app client belongs to this user directory and cannot exist at the catalog root.",
    professionalExplanation:
      "This relationship supplies UserPoolId and matches the required semantic parent relationship.",
    considerations: ["The app client and user pool must share a region."],
    documentation: [
      {
        kind: "official",
        id: "aws.cognito.documentation.app-client-relationship",
        title: "User pool app clients",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html",
      },
    ],
  },
});

export const roleAssumedByLambda = defineProviderConnectionRuleV1({
  id: "aws.iam.role-assumed-by-lambda",
  ruleVersion: "1.0.0",
  relationshipType: "aws.iam.role-assumed-by-lambda",
  category: "network-and-security",
  source: {
    serviceId: "aws.iam.role",
    portId: "aws.iam.role.assumable-role",
  },
  target: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.execution-role",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 1,
  maximumConnectionsPerEndpointPair: 1,
  configuration: emptyConfiguration(
    "aws.iam.lambda-role.connection",
    "Lambda execution-role attachment",
    "The role and function are selected through typed graph ports.",
  ),
  questions: [],
  supportingChanges: [
    {
      id: "aws.iam.supporting.lambda-trust-policy-document-node",
      kind: "node",
      serviceId: "aws.iam.policy-document",
      ownership: "generated",
      purpose:
        "Creates one canonical trust-policy document when the selected role does not already have a compatible trust policy.",
    },
    {
      id: "aws.iam.supporting.lambda-trust-policy-statement-node",
      kind: "node",
      serviceId: "aws.iam.policy-statement",
      ownership: "generated",
      purpose:
        "Creates one exact sts:AssumeRole statement for the Lambda service principal.",
    },
    {
      id: "aws.iam.supporting.lambda-trust-policy-owner-edge",
      kind: "edge",
      relationshipType: "aws.iam.role-owns-trust-policy",
      ownership: "generated",
      purpose:
        "Binds the generated trust document to the role's exclusive trust-policy slot.",
    },
    {
      id: "aws.iam.supporting.lambda-trust-policy-membership-edge",
      kind: "edge",
      relationshipType: "aws.iam.policy-contains-statement",
      ownership: "generated",
      purpose:
        "Adds the generated trust statement to its canonical trust-policy document.",
    },
  ],
  iamEffects: [
    {
      id: "aws.iam.effect.lambda-assume-role",
      effect: "trust",
      actions: ["sts:AssumeRole"],
      resourceScope: "source-node",
      principal: "lambda.amazonaws.com",
      explanation:
        "The role trust policy is limited to the Lambda service principal.",
    },
  ],
  missingInformationFindings: [
    {
      code: "aws.iam.finding.lambda-trust-policy-incompatible",
      trigger: "missing-prerequisite",
      configurationProperties: [],
      guidedMessage:
        "Use a trust policy that allows only the Lambda service to assume this role.",
      professionalMessage:
        "The role's existing trust document is not the exact canonical Lambda sts:AssumeRole trust required by this connection.",
    },
    {
      code: "aws.iam.finding.lambda-trust-policy-ambiguous",
      trigger: "ambiguous-prerequisite",
      configurationProperties: [],
      guidedMessage:
        "Keep exactly one compatible trust policy on this role before assigning it to Lambda.",
      professionalMessage:
        "Multiple trust-policy candidates make canonical trust reuse ambiguous.",
    },
    {
      code: "aws.iam.finding.lambda-trust-policy-generated-collision",
      trigger: "ambiguous-prerequisite",
      configurationProperties: [],
      guidedMessage:
        "Remove or finish cleaning up the conflicting generated trust policy before assigning this role.",
      professionalMessage:
        "A generated trust-policy resource already occupies the role slot but does not belong to this connection operation.",
    },
  ],
  lifecycle,
  implementation: implemented("aws.iam.resolve-lambda-role-attachment"),
  validationRuleIds: ["aws.cloudmarkup.validation.lambda-execution-role"],
  education: {
    summary: "Assigns one dedicated IAM execution role to a Lambda function.",
    guidedExplanation:
      "Lambda assumes this role when the notes function calls DynamoDB or writes logs.",
    professionalExplanation:
      "The relationship supplies the role ARN and exposes the fixed Lambda service trust effect; it does not infer application permissions.",
    considerations: [
      "One role is intentionally dedicated to one notes function.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.lambda.documentation.execution-role",
        title: "Lambda execution role",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html",
      },
    ],
  },
});

export const lambdaReadsTable = defineProviderConnectionRuleV1({
  id: "aws.lambda.reads-dynamodb-table",
  ruleVersion: "1.0.0",
  relationshipType: "aws.lambda.reads-dynamodb-table",
  category: "reads-or-writes-data",
  source: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.data-read",
  },
  target: {
    serviceId: "aws.dynamodb.table",
    portId: "aws.dynamodb.table.table-api",
  },
  maximumConnectionsPerSource: 16,
  maximumConnectionsPerTarget: 64,
  maximumConnectionsPerEndpointPair: 1,
  configuration: {
    schemaId: "aws.lambda.dynamodb-read.connection",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.lambda.dynamodb-read.connection:1.0.0",
      type: "object",
      title: "Lambda DynamoDB read access",
      description:
        "A bounded read-consistency choice for the explicit data-read capability.",
      additionalProperties: false,
      properties: {
        consistentRead: {
          type: "boolean",
          default: false,
        },
      },
      required: ["consistentRead"],
    },
    uiHints: [
      {
        property: "consistentRead",
        control: "checkbox",
        label: "Use strongly consistent reads",
        order: 0,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
    ],
  },
  questions: [
    {
      id: "aws.lambda.question.dynamodb-consistent-read",
      property: "consistentRead",
      prompt: "Does the function require strongly consistent reads?",
      explanation:
        "Eventually consistent reads are the safer cost default for the initial notes API.",
      answer: { kind: "catalog-default" },
    },
  ],
  supportingChanges: [
    {
      id: "aws.lambda.supporting.dynamodb-read-policy-document-node",
      kind: "node",
      serviceId: "aws.iam.policy-document",
      ownership: "generated",
      purpose:
        "Creates one generated-permission document owned by the Lambda function's execution role.",
    },
    {
      id: "aws.lambda.supporting.dynamodb-read-policy-node",
      kind: "node",
      serviceId: "aws.iam.policy-statement",
      ownership: "generated",
      purpose:
        "Creates one bounded statement containing only the exact DynamoDB read actions declared by this rule.",
    },
    {
      id: "aws.lambda.supporting.dynamodb-read-policy-role-edge",
      kind: "edge",
      relationshipType: "aws.iam.role-owns-generated-permission",
      ownership: "generated",
      purpose:
        "Attaches the generated policy document to the Lambda function's existing execution role.",
    },
    {
      id: "aws.lambda.supporting.dynamodb-read-policy-statement-edge",
      kind: "edge",
      relationshipType: "aws.iam.policy-contains-statement",
      ownership: "generated",
      purpose:
        "Adds the generated statement to its canonical generated-permission document.",
    },
    {
      id: "aws.lambda.supporting.dynamodb-read-policy-table-edge",
      kind: "edge",
      relationshipType: "aws.iam.authorizes-dynamodb-table",
      ownership: "generated",
      purpose:
        "Scopes the generated statement to the connected table node instead of a wildcard or pasted ARN.",
    },
  ],
  iamEffects: [
    {
      id: "aws.lambda.iam.dynamodb-read",
      effect: "allow",
      actions: ["dynamodb:GetItem", "dynamodb:Query"],
      resourceScope: "connected-target",
      explanation:
        "The data-read relationship grants only item lookup and query on the connected table.",
    },
  ],
  missingInformationFindings: [
    {
      code: "aws.lambda.finding.execution-role-required",
      trigger: "missing-prerequisite",
      configurationProperties: [],
      guidedMessage:
        "Attach one IAM execution role to the Lambda function before connecting the table.",
      professionalMessage:
        "The resolver needs exactly one role attachment to place the generated least-privilege statement.",
    },
    {
      code: "aws.lambda.finding.execution-role-ambiguous",
      trigger: "ambiguous-prerequisite",
      configurationProperties: [],
      guidedMessage:
        "Keep exactly one execution role attached to this Lambda function.",
      professionalMessage:
        "Multiple matching role attachments make generated-policy placement ambiguous.",
    },
  ],
  lifecycle,
  implementation: implemented("aws.lambda.resolve-dynamodb-read"),
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-questions",
    "aws.cloudmarkup.validation.lambda-dynamodb-actions",
  ],
  education: {
    summary:
      "Connects a Lambda data-read capability to a table and generates bounded read permission.",
    guidedExplanation:
      "The function reads from this table. CloudMarkup also previews one generated read-only policy statement attached to the function's role.",
    professionalExplanation:
      "The atomic recipe adds the read edge, one generated IAM statement, and role/table scope edges. The read action set is fixed and resource scope is a typed node reference.",
    considerations: [
      "Application access and IAM authorization are generated together.",
      "Wildcard actions and resources are never emitted.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.lambda.documentation.dynamodb",
        title: "Using Lambda with Amazon DynamoDB",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html",
      },
    ],
  },
});

export const lambdaWritesTable = defineProviderConnectionRuleV1({
  id: "aws.lambda.writes-dynamodb-table",
  ruleVersion: "1.0.0",
  relationshipType: "aws.lambda.writes-dynamodb-table",
  category: "reads-or-writes-data",
  source: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.data-write",
  },
  target: {
    serviceId: "aws.dynamodb.table",
    portId: "aws.dynamodb.table.table-api",
  },
  maximumConnectionsPerSource: 16,
  maximumConnectionsPerTarget: 64,
  maximumConnectionsPerEndpointPair: 1,
  configuration: emptyConfiguration(
    "aws.lambda.dynamodb-write.connection",
    "Lambda DynamoDB write access",
    "The explicit data-write capability selects a fixed bounded action set.",
  ),
  questions: [],
  supportingChanges: [
    {
      id: "aws.lambda.supporting.dynamodb-write-policy-document-node",
      kind: "node",
      serviceId: "aws.iam.policy-document",
      ownership: "generated",
      purpose:
        "Creates one generated-permission document owned by the Lambda function's execution role.",
    },
    {
      id: "aws.lambda.supporting.dynamodb-write-policy-node",
      kind: "node",
      serviceId: "aws.iam.policy-statement",
      ownership: "generated",
      purpose:
        "Creates one bounded statement containing only the exact DynamoDB write actions declared by this rule.",
    },
    {
      id: "aws.lambda.supporting.dynamodb-write-policy-role-edge",
      kind: "edge",
      relationshipType: "aws.iam.role-owns-generated-permission",
      ownership: "generated",
      purpose:
        "Attaches the generated policy document to the Lambda function's existing execution role.",
    },
    {
      id: "aws.lambda.supporting.dynamodb-write-policy-statement-edge",
      kind: "edge",
      relationshipType: "aws.iam.policy-contains-statement",
      ownership: "generated",
      purpose:
        "Adds the generated statement to its canonical generated-permission document.",
    },
    {
      id: "aws.lambda.supporting.dynamodb-write-policy-table-edge",
      kind: "edge",
      relationshipType: "aws.iam.authorizes-dynamodb-table",
      ownership: "generated",
      purpose:
        "Scopes the generated statement to the connected table node instead of a wildcard or pasted ARN.",
    },
  ],
  iamEffects: [
    {
      id: "aws.lambda.iam.dynamodb-write",
      effect: "allow",
      actions: [
        "dynamodb:DeleteItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
      ],
      resourceScope: "connected-target",
      explanation:
        "The data-write relationship grants only item creation, update, and deletion on the connected table.",
    },
  ],
  missingInformationFindings: [
    {
      code: "aws.lambda.finding.execution-role-required",
      trigger: "missing-prerequisite",
      configurationProperties: [],
      guidedMessage:
        "Attach one IAM execution role to the Lambda function before connecting the table.",
      professionalMessage:
        "The resolver needs exactly one role attachment to place the generated least-privilege statement.",
    },
    {
      code: "aws.lambda.finding.execution-role-ambiguous",
      trigger: "ambiguous-prerequisite",
      configurationProperties: [],
      guidedMessage:
        "Keep exactly one execution role attached to this Lambda function.",
      professionalMessage:
        "Multiple matching role attachments make generated-policy placement ambiguous.",
    },
  ],
  lifecycle,
  implementation: implemented("aws.lambda.resolve-dynamodb-write"),
  validationRuleIds: ["aws.cloudmarkup.validation.lambda-dynamodb-actions"],
  education: {
    summary:
      "Connects a Lambda data-write capability to a table and generates bounded write permission.",
    guidedExplanation:
      "The function writes to this table. CloudMarkup also previews one generated write-only policy statement attached to the function's role.",
    professionalExplanation:
      "The atomic recipe adds the write edge, one generated IAM statement, and role/table scope edges. The write action set is fixed and resource scope is a typed node reference.",
    considerations: [
      "Application access and IAM authorization are generated together.",
      "Read actions are intentionally absent from this relationship.",
      "Wildcard actions and resources are never emitted.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.lambda.documentation.dynamodb-write",
        title: "Using Lambda with Amazon DynamoDB",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html",
      },
    ],
  },
});

export const policyAuthorizesTable = defineProviderConnectionRuleV1({
  id: "aws.iam.policy-statement-authorizes-dynamodb-table",
  ruleVersion: "1.0.0",
  relationshipType: "aws.iam.authorizes-dynamodb-table",
  category: "network-and-security",
  source: {
    serviceId: "aws.iam.policy-statement",
    portId: "aws.iam.policy-statement.dynamodb-resource",
  },
  target: {
    serviceId: "aws.dynamodb.table",
    portId: "aws.dynamodb.table.policy-resource",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 64,
  maximumConnectionsPerEndpointPair: 1,
  configuration: emptyConfiguration(
    "aws.iam.policy-table.connection",
    "IAM statement table scope",
    "The table ARN is resolved from a typed target node reference.",
  ),
  questions: [],
  supportingChanges: [],
  iamEffects: [],
  missingInformationFindings: [],
  lifecycle,
  implementation: descriptorOnly(
    "This scope edge is emitted only as a reviewed supporting change of the Lambda-to-DynamoDB recipe.",
  ),
  validationRuleIds: ["aws.cloudmarkup.validation.lambda-dynamodb-actions"],
  education: {
    summary: "Scopes an IAM statement to one connected DynamoDB table.",
    guidedExplanation:
      "CloudMarkup uses the selected table instead of accepting a typed or pasted ARN.",
    professionalExplanation:
      "The relationship resolves resource scope from graph identity and prevents wildcard or free-form resource declarations.",
    considerations: [
      "The statement resourceNode configuration references this table.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.dynamodb.documentation.iam-actions",
        title: "Identity-based policy examples for DynamoDB",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/security_iam_id-based-policy-examples.html",
      },
    ],
  },
});

export const policyAuthorizesLambda = defineProviderConnectionRuleV1({
  id: "aws.iam.policy-statement-authorizes-lambda-function",
  ruleVersion: "1.0.0",
  relationshipType: "aws.iam.authorizes-lambda-function",
  category: "network-and-security",
  source: {
    serviceId: "aws.iam.policy-statement",
    portId: "aws.iam.policy-statement.lambda-resource",
  },
  target: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.policy-resource",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 64,
  maximumConnectionsPerEndpointPair: 1,
  configuration: emptyConfiguration(
    "aws.iam.policy-lambda.connection",
    "IAM statement Lambda scope",
    "The function ARN is resolved from a typed target node reference.",
  ),
  questions: [],
  supportingChanges: [],
  iamEffects: [],
  missingInformationFindings: [],
  lifecycle,
  implementation: descriptorOnly(
    "This scope edge is emitted only as a reviewed supporting change of an invocation-permission recipe.",
  ),
  validationRuleIds: ["aws.cloudmarkup.validation.iam-policy-safety"],
  education: {
    summary: "Scopes an IAM statement to one connected Lambda function.",
    guidedExplanation:
      "CloudMarkup uses the selected function instead of accepting a typed or pasted ARN.",
    professionalExplanation:
      "The relationship resolves the exact function ARN from graph identity and keeps resource-side service grants canonical.",
    considerations: [
      "The statement resourceNode configuration references this function.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.lambda.documentation.resource-based-policy",
        title: "Using resource-based policies for Lambda",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/lambda/latest/dg/access-control-resource-based.html",
      },
    ],
  },
});

export const policyAuthorizesLogGroup = defineProviderConnectionRuleV1({
  id: "aws.iam.policy-statement-authorizes-log-group",
  ruleVersion: "1.0.0",
  relationshipType: "aws.iam.authorizes-log-group",
  category: "network-and-security",
  source: {
    serviceId: "aws.iam.policy-statement",
    portId: "aws.iam.policy-statement.log-group-resource",
  },
  target: {
    serviceId: "aws.cloudwatch.log-group",
    portId: "aws.cloudwatch.log-group.policy-resource",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 64,
  maximumConnectionsPerEndpointPair: 1,
  configuration: emptyConfiguration(
    "aws.iam.policy-log-group.connection",
    "IAM statement log-group scope",
    "The log-group ARN is resolved from a typed target node reference.",
  ),
  questions: [],
  supportingChanges: [],
  iamEffects: [],
  missingInformationFindings: [],
  lifecycle,
  implementation: descriptorOnly(
    "This scope edge is emitted only as a reviewed supporting change of the Lambda-to-CloudWatch Logs recipe.",
  ),
  validationRuleIds: ["aws.cloudmarkup.validation.iam-policy-safety"],
  education: {
    summary: "Scopes an IAM statement to one connected CloudWatch log group.",
    guidedExplanation:
      "CloudMarkup uses the selected log group instead of accepting a typed or pasted ARN.",
    professionalExplanation:
      "The relationship resolves the exact log-group ARN from graph identity and prevents wildcard resource scope.",
    considerations: [
      "The statement resourceNode configuration references this log group.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.logs.documentation.permissions-reference",
        title: "Permissions reference for CloudWatch Logs",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/permissions-reference-cwl.html",
      },
    ],
  },
});

export const lambdaWritesLogs = defineProviderConnectionRuleV1({
  id: "aws.lambda.writes-log-group",
  ruleVersion: "1.0.0",
  relationshipType: "aws.lambda.writes-log-group",
  category: "observability",
  source: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.logging",
  },
  target: {
    serviceId: "aws.cloudwatch.log-group",
    portId: "aws.cloudwatch.log-group.logs",
  },
  maximumConnectionsPerSource: 1,
  maximumConnectionsPerTarget: 1,
  maximumConnectionsPerEndpointPair: 1,
  configuration: {
    schemaId: "aws.lambda.cloudwatch-logs.connection",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.lambda.cloudwatch-logs.connection:1.0.0",
      type: "object",
      title: "Lambda log delivery",
      description:
        "The reviewed application-log delivery mode for the selected log group.",
      additionalProperties: false,
      properties: {
        deliveryMode: {
          type: "string",
          enum: ["application-logs"],
          default: "application-logs",
        },
      },
      required: ["deliveryMode"],
    },
    uiHints: [
      {
        property: "deliveryMode",
        control: "select",
        label: "Log delivery",
        order: 0,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
    ],
  },
  questions: [
    {
      id: "aws.lambda.question.log-delivery",
      property: "deliveryMode",
      prompt: "Which reviewed logs should this function deliver?",
      explanation:
        "Application logs are enabled with a fixed default; subscriptions and audit trails require separate concepts.",
      answer: { kind: "catalog-default" },
    },
  ],
  supportingChanges: [
    {
      id: "aws.lambda.supporting.logs-policy-document-node",
      kind: "node",
      serviceId: "aws.iam.policy-document",
      ownership: "generated",
      purpose:
        "Creates one generated-permission document owned by the Lambda execution role.",
    },
    {
      id: "aws.lambda.supporting.logs-policy-statement-node",
      kind: "node",
      serviceId: "aws.iam.policy-statement",
      ownership: "generated",
      purpose:
        "Creates one exact statement for log-stream creation and event delivery.",
    },
    {
      id: "aws.lambda.supporting.logs-policy-role-edge",
      kind: "edge",
      relationshipType: "aws.iam.role-owns-generated-permission",
      ownership: "generated",
      purpose:
        "Binds the generated permission document to the Lambda execution role.",
    },
    {
      id: "aws.lambda.supporting.logs-policy-membership-edge",
      kind: "edge",
      relationshipType: "aws.iam.policy-contains-statement",
      ownership: "generated",
      purpose:
        "Adds the generated statement to its canonical generated-permission document.",
    },
    {
      id: "aws.lambda.supporting.logs-policy-scope-edge",
      kind: "edge",
      relationshipType: "aws.iam.authorizes-log-group",
      ownership: "generated",
      purpose:
        "Scopes the generated statement to the exact connected log group.",
    },
  ],
  iamEffects: [
    {
      id: "aws.lambda.iam.cloudwatch-log-delivery",
      effect: "allow",
      actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
      resourceScope: "target-node",
      explanation:
        "The future compiler may allow stream creation and event writes only under the connected log group.",
    },
  ],
  missingInformationFindings: [
    {
      code: "aws.lambda.finding.logging-role-required",
      trigger: "missing-prerequisite",
      configurationProperties: [],
      guidedMessage:
        "Attach one IAM execution role before enabling CloudWatch log delivery.",
      professionalMessage:
        "The logs permissions effect requires exactly one Lambda execution-role attachment.",
    },
    {
      code: "aws.lambda.finding.logging-role-ambiguous",
      trigger: "ambiguous-prerequisite",
      configurationProperties: [],
      guidedMessage:
        "Keep exactly one execution role attached to this Lambda function.",
      professionalMessage:
        "Multiple role attachments make least-privilege log permission placement ambiguous.",
    },
  ],
  lifecycle,
  implementation: implemented("aws.lambda.resolve-cloudwatch-logging"),
  validationRuleIds: ["aws.cloudmarkup.validation.log-retention"],
  education: {
    summary: "Associates a Lambda function with its retained log group.",
    guidedExplanation:
      "The notes function can create a stream and write application log events only in this selected group.",
    professionalExplanation:
      "The connection exposes the exact logs:CreateLogStream and logs:PutLogEvents effects scoped to the log-group target.",
    considerations: ["Do not record tokens, secrets, or note contents."],
    documentation: [
      {
        kind: "official",
        id: "aws.lambda.documentation.logging",
        title: "Sending Lambda logs to CloudWatch Logs",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs.html",
      },
    ],
  },
});

export const lambdaMonitoredByAlarm = defineProviderConnectionRuleV1({
  id: "aws.lambda.monitored-by-alarm",
  ruleVersion: "1.0.0",
  relationshipType: "aws.lambda.monitored-by-alarm",
  category: "observability",
  source: {
    serviceId: "aws.lambda.function",
    portId: "aws.lambda.function.telemetry",
  },
  target: {
    serviceId: "aws.cloudwatch.metric-alarm",
    portId: "aws.cloudwatch.metric-alarm.metric",
  },
  maximumConnectionsPerSource: 16,
  maximumConnectionsPerTarget: 1,
  maximumConnectionsPerEndpointPair: 1,
  configuration: {
    schemaId: "aws.lambda.cloudwatch-alarm.connection",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.lambda.cloudwatch-alarm.connection:1.0.0",
      type: "object",
      title: "Lambda metric alarm target",
      description:
        "The reviewed Errors metric and FunctionName dimension binding.",
      additionalProperties: false,
      properties: {
        metricName: {
          type: "string",
          enum: ["Errors"],
          default: "Errors",
        },
        dimensionName: {
          type: "string",
          enum: ["FunctionName"],
          default: "FunctionName",
        },
      },
      required: ["metricName", "dimensionName"],
    },
    uiHints: [
      {
        property: "metricName",
        control: "select",
        label: "Metric",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "cost-sensitive",
      },
      {
        property: "dimensionName",
        control: "select",
        label: "Metric dimension",
        order: 1,
        advanced: true,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
    ],
  },
  questions: [
    {
      id: "aws.lambda.question.alarm-metric",
      property: "metricName",
      prompt: "Which supported Lambda metric should this alarm watch?",
      explanation:
        "Errors is the only reviewed metric in this initial catalog slice.",
      answer: { kind: "catalog-default" },
    },
    {
      id: "aws.lambda.question.alarm-dimension",
      property: "dimensionName",
      prompt: "How should the metric be scoped?",
      explanation:
        "FunctionName binds the alarm to only the connected Lambda function.",
      answer: { kind: "catalog-default" },
    },
  ],
  supportingChanges: [],
  iamEffects: [],
  missingInformationFindings: [],
  lifecycle,
  implementation: implemented("aws.lambda.resolve-cloudwatch-errors-alarm"),
  validationRuleIds: [],
  education: {
    summary: "Scopes a CloudWatch Errors alarm to one Lambda function.",
    guidedExplanation:
      "The alarm watches errors from this function instead of every Lambda function.",
    professionalExplanation:
      "The relationship supplies the Lambda FunctionName dimension to the catalog's bounded AWS/Lambda Errors metric alarm.",
    considerations: [
      "A later notification resource is required to alert people.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.lambda.documentation.metrics",
        title: "Types of metrics for Lambda functions",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html",
      },
    ],
  },
});

export const awsNotesApiConnectionRulesV1 = [
  apiInvokesLambda,
  userPoolAuthorizesApi,
  appClientAuthorizesApi,
  userPoolConfiguresClient,
  roleAssumedByLambda,
  lambdaReadsTable,
  lambdaWritesTable,
  policyAuthorizesTable,
  policyAuthorizesLambda,
  policyAuthorizesLogGroup,
  lambdaWritesLogs,
  lambdaMonitoredByAlarm,
];
