import { describe, expect, it } from "vitest";

import { projectOwnedPolicyConfigurations } from "../features/editor/model/owned-configuration-policy-model.js";
import { loadBlankAwsEditorArchitectureDocument } from "./aws-editor-fixture.js";
import { awsOwnedPolicyGraphDescriptors } from "./aws-owned-policy-descriptors.js";

describe("awsOwnedPolicyGraphDescriptors", () => {
  it("composes exact owner slots and policy child bindings without provider rules in React", () => {
    expect(
      awsOwnedPolicyGraphDescriptors.ownedConfigurations.slots.map(
        (slot) => slot.id,
      ),
    ).toEqual([
      "aws.cloudfront.distribution.slot.alias",
      "aws.ec2.gateway-vpc-endpoint.slot.resource-policy",
      "aws.ec2.route-table.slot.routes",
      "aws.ec2.route-table.slot.subnet-associations",
      "aws.ec2.security-group.slot.egress-rules",
      "aws.ec2.security-group.slot.ingress-rules",
      "aws.ecr.repository.slot.image",
      "aws.ecs.task-definition.slot.container",
      "aws.elb.target-group.slot.backend-access",
      "aws.eventbridge.event-bus.slot.resource-policy",
      "aws.eventbridge.rule.slot.targets",
      "aws.iam.role.slot.custom-inline-policy",
      "aws.iam.role.slot.generated-permission",
      "aws.iam.role.slot.managed-policy",
      "aws.iam.role.slot.permissions-boundary",
      "aws.iam.role.slot.trust-policy",
      "aws.kms.key.slot.resource-policy",
      "aws.lambda.function.slot.invocation-permission",
      "aws.lambda.function.slot.vpc-access-configuration",
      "aws.s3.bucket.slot.cors",
      "aws.s3.bucket.slot.lifecycle",
      "aws.s3.bucket.slot.notifications",
      "aws.s3.bucket.slot.resource-policy",
      "aws.sns.topic.slot.resource-policy",
      "aws.sns.topic.slot.subscriptions",
      "aws.sqs.queue.slot.redrive",
      "aws.sqs.queue.slot.resource-policy",
    ]);
    expect(awsOwnedPolicyGraphDescriptors.policyOwnedKindIds).toEqual([
      "aws.iam.policy-document",
    ]);
    expect(awsOwnedPolicyGraphDescriptors.statementMembership).toMatchObject({
      cardinality: { maximum: 256, minimum: 1 },
      childEndpoint: "source",
      relationshipType: "aws.iam.policy-contains-statement",
    });
    expect(awsOwnedPolicyGraphDescriptors.conditionMembership).toMatchObject({
      cardinality: { maximum: 128, minimum: 0 },
      childEndpoint: "source",
      relationshipType: "aws.iam.statement-owns-condition",
    });
    expect(
      awsOwnedPolicyGraphDescriptors.resourceScopes
        .map((scope) => scope.id)
        .sort(),
    ).toEqual([
      "aws.iam.policy-scope.dynamodb-table",
      "aws.iam.policy-scope.kms-key",
      "aws.iam.policy-scope.lambda-function",
      "aws.iam.policy-scope.log-group",
      "aws.iam.policy-scope.s3-bucket",
      "aws.iam.policy-scope.secret",
      "aws.iam.policy-scope.sqs-queue",
    ]);
  });

  it("projects a document with no owners as an exact empty policy model", () => {
    expect(
      projectOwnedPolicyConfigurations(
        loadBlankAwsEditorArchitectureDocument(),
        awsOwnedPolicyGraphDescriptors,
      ),
    ).toEqual({
      configurations: [],
      findings: [],
      policies: [],
      success: true,
    });
  });
});
