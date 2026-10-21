import type { ValidationFindingCandidate } from "@cloudmarkup/domain";

import {
  apiRouteAuthenticationValidationRuleDescriptor,
  connectionQuestionsValidationRuleDescriptor,
  lambdaExecutionRoleValidationRuleDescriptor,
} from "../catalog/validation-rules/index.js";
import {
  defineAwsValidationRuleV1,
  edgeConfigurationLocation,
  edgeLocation,
  finding,
  isLowerEnvironment,
  literalBoolean,
  nodeLocation,
  type AwsValidationCatalogV1,
  type AwsValidationDocument,
} from "./rule-helpers.js";

export function createApiRouteAuthenticationRuleV1(
  catalog: AwsValidationCatalogV1,
) {
  const descriptor = apiRouteAuthenticationValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) {
        return [];
      }

      const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
      const findings: ValidationFindingCandidate[] = [];
      document.edges.forEach((edge, edgeIndex) => {
        if (
          edge.semantic.relationshipType !==
            "aws.apigateway.integrates-lambda" ||
          edge.semantic.source.port !== "aws.apigateway.http-api.invocation" ||
          edge.semantic.target.port !==
            "aws.lambda.function.synchronous-invocation"
        ) {
          return;
        }

        const apiNode = nodeById.get(edge.semantic.source.nodeId);
        if (apiNode?.semantic.serviceType !== "aws.apigateway.http-api") {
          return;
        }
        const values = apiNode.semantic.configuration.values;
        const requiresJwt =
          literalBoolean(values, "jwtAuthorizationRequired") === true;
        const issuerPoolIds = new Set(
          document.edges
            .filter((candidate) => {
              const sourceNode = nodeById.get(candidate.semantic.source.nodeId);
              return (
                sourceNode?.semantic.serviceType === "aws.cognito.user-pool" &&
                candidate.semantic.relationshipType ===
                  "aws.cognito.provides-jwt-issuer" &&
                candidate.semantic.source.port ===
                  "aws.cognito.user-pool.jwt-issuer" &&
                candidate.semantic.target.nodeId === apiNode.id &&
                candidate.semantic.target.port ===
                  "aws.apigateway.http-api.jwt-issuer"
              );
            })
            .map((candidate) => candidate.semantic.source.nodeId),
        );
        const hasCompleteAuthentication = document.edges.some((candidate) => {
          const appClientNode = nodeById.get(candidate.semantic.source.nodeId);
          const parent = appClientNode?.semantic.parent;
          if (
            appClientNode?.semantic.serviceType !==
              "aws.cognito.user-pool-client" ||
            candidate.semantic.relationshipType !==
              "aws.cognito.provides-jwt-audience" ||
            candidate.semantic.source.port !==
              "aws.cognito.user-pool-client.jwt-audience" ||
            candidate.semantic.target.nodeId !== apiNode.id ||
            candidate.semantic.target.port !==
              "aws.apigateway.http-api.jwt-audience" ||
            parent?.relationshipType !== "aws.cognito.contains-app-client" ||
            !issuerPoolIds.has(parent.nodeId)
          ) {
            return false;
          }

          return document.edges.some(
            (containment) =>
              containment.semantic.relationshipType ===
                "aws.cognito.contains-app-client" &&
              containment.semantic.source.nodeId === parent.nodeId &&
              containment.semantic.source.port ===
                "aws.cognito.user-pool.app-client-parent" &&
              containment.semantic.target.nodeId === appClientNode.id &&
              containment.semantic.target.port ===
                "aws.cognito.user-pool-client.user-pool",
          );
        });
        if (requiresJwt && hasCompleteAuthentication) {
          return;
        }

        findings.push(
          finding(descriptor, {
            code: "aws.validation.public-api-route-without-authentication",
            severity: isLowerEnvironment(context.environment)
              ? "warning"
              : "security-error",
            title: "Public API route lacks complete JWT authentication",
            beginnerExplanation:
              "This route can reach the notes function without a complete Cognito issuer and app-client audience.",
            technicalExplanation:
              "The API-to-Lambda route requires jwtAuthorizationRequired=true plus exactly typed Cognito issuer and audience relationships on the source HTTP API.",
            affected: [edgeLocation(edge, edgeIndex)],
          }),
        );
      });

      return findings;
    },
  });
}

export function createLambdaExecutionRoleRuleV1(
  catalog: AwsValidationCatalogV1,
) {
  const descriptor = lambdaExecutionRoleValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) {
        return [];
      }
      const nodeById = new Map(document.nodes.map((node) => [node.id, node]));

      return document.nodes.flatMap((node, nodeIndex) => {
        if (node.semantic.serviceType !== "aws.lambda.function") {
          return [];
        }
        const roleEdges = document.edges
          .map((edge, edgeIndex) => ({ edge, edgeIndex }))
          .filter(
            ({ edge }) =>
              edge.semantic.relationshipType ===
                "aws.iam.role-assumed-by-lambda" &&
              edge.semantic.source.port === "aws.iam.role.assumable-role" &&
              edge.semantic.target.nodeId === node.id &&
              edge.semantic.target.port ===
                "aws.lambda.function.execution-role" &&
              nodeById.get(edge.semantic.source.nodeId)?.semantic
                .serviceType === "aws.iam.role",
          );
        if (roleEdges.length === 1) {
          return [];
        }

        if (roleEdges.length > 1) {
          return [
            finding(descriptor, {
              code: "aws.validation.lambda-execution-role-duplicate",
              severity: "error",
              title: "Lambda function has multiple execution roles",
              beginnerExplanation:
                "Keep exactly one execution role attached to this function.",
              technicalExplanation:
                "Multiple exact aws.iam.role-assumed-by-lambda edges target the exclusive Lambda execution-role port.",
              affected: roleEdges.map(({ edge, edgeIndex }) =>
                edgeLocation(edge, edgeIndex, ".semantic.target.port"),
              ),
            }),
          ];
        }

        return [
          finding(descriptor, {
            code: "aws.validation.lambda-execution-role-missing",
            severity: "error",
            title: "Lambda function has no execution role",
            beginnerExplanation:
              "The function needs one IAM role before it can run or receive bounded service permissions.",
            technicalExplanation:
              "No aws.iam.role-assumed-by-lambda edge targets the Lambda execution-role port.",
            affected: [
              nodeLocation(node, nodeIndex, ".semantic.configuration"),
            ],
          }),
        ];
      });
    },
  });
}

function matchingConnectionRule(
  catalog: AwsValidationCatalogV1,
  document: AwsValidationDocument,
  edgeIndex: number,
) {
  const edge = document.edges[edgeIndex];
  if (edge === undefined) {
    return undefined;
  }
  const sourceNode = document.nodes.find(
    (node) => node.id === edge.semantic.source.nodeId,
  );
  const targetNode = document.nodes.find(
    (node) => node.id === edge.semantic.target.nodeId,
  );
  if (sourceNode === undefined || targetNode === undefined) {
    return undefined;
  }

  return catalog.connectionRules.find(
    (rule) =>
      rule.relationshipType === edge.semantic.relationshipType &&
      rule.source.serviceId === sourceNode.semantic.serviceType &&
      rule.source.portId === edge.semantic.source.port &&
      rule.target.serviceId === targetNode.semantic.serviceType &&
      rule.target.portId === edge.semantic.target.port,
  );
}

export function createConnectionQuestionsRuleV1(
  catalog: AwsValidationCatalogV1,
) {
  const descriptor = connectionQuestionsValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) {
        return [];
      }
      const findings: ValidationFindingCandidate[] = [];

      document.edges.forEach((edge, edgeIndex) => {
        const rule = matchingConnectionRule(catalog, document, edgeIndex);
        if (rule === undefined) {
          return;
        }
        rule.questions
          .filter((question) => question.answer.kind === "required-user-input")
          .forEach((question) => {
            if (
              Object.hasOwn(
                edge.semantic.configuration.values,
                question.property,
              )
            ) {
              return;
            }
            findings.push(
              finding(descriptor, {
                code: "aws.validation.connection-question-unresolved",
                severity: "error",
                title: "Required connection question is unresolved",
                beginnerExplanation:
                  "An explicit answer is required before this connection is safe to use.",
                technicalExplanation:
                  "A required-user-input catalog question has no matching tagged configuration value on the connection edge.",
                affected: [
                  edgeConfigurationLocation(edge, edgeIndex, question.property),
                ],
              }),
            );
          });
      });

      return findings;
    },
  });
}
