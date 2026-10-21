import {
  AWS_IAM_POLICY_INTERNAL_BINDINGS_V1,
  AWS_IAM_POLICY_RESOURCE_SCOPES_V1,
} from "@cloudmarkup/provider-aws/policy";

import { createOwnedPolicyGraphDescriptorSet } from "@cloudmarkup/graph-preparation/owned-policy-descriptor-composition";
import { awsEditorCatalog } from "./aws-editor-catalog.js";

export const awsOwnedPolicyGraphDescriptors =
  createOwnedPolicyGraphDescriptorSet(awsEditorCatalog, {
    conditionMembership: {
      childPort:
        AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.conditionMembership.childPort,
      id: AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.conditionMembership.slotId,
      parentPort:
        AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.conditionMembership.ownerPort,
      relationshipType:
        AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.conditionMembership
          .relationshipType,
    },
    resourceScopeCardinality: {
      maximum: 1,
      minimum: 0,
    },
    resourceScopes: AWS_IAM_POLICY_RESOURCE_SCOPES_V1.map((scope) => ({
      id: scope.id,
      relationshipType: scope.relationshipType,
      resourcePort: scope.resourcePort,
      resourceResourceType: scope.resourceResourceType,
      resourceServiceType: scope.resourceServiceType,
      statementPort: scope.statementPort,
      ...(scope.resourceServiceType === "aws.secretsmanager.secret"
        ? {
            statementReferenceBinding: {
              property: "resourceNode",
              attribute: scope.resourceAttribute,
            },
          }
        : {}),
    })),
    statementMembership: {
      childPort:
        AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.statementMembership.childPort,
      id: AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.statementMembership.slotId,
      parentPort:
        AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.statementMembership.ownerPort,
      relationshipType:
        AWS_IAM_POLICY_INTERNAL_BINDINGS_V1.statementMembership
          .relationshipType,
    },
  });
