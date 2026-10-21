import {
  applyGraphCommand,
  executeArchitectureValidationRules,
} from "@cloudmarkup/domain";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws";
import { awsValidationRulesV1 } from "@cloudmarkup/provider-aws/validation";
import { describe, expect, it } from "vitest";
import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadBlankAwsEditorArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import { awsOwnedPolicyGraphDescriptors } from "../../../provider-catalog/aws-owned-policy-descriptors.js";
import { dispatchAddServiceCommand } from "./add-service-command.js";
import { projectOwnedPolicyConfigurations } from "./owned-configuration-policy-model.js";
import { createOwnedPolicyGraphDescriptorSet } from "@cloudmarkup/graph-preparation/owned-policy-descriptor-composition";
import {
  prepareUserPolicyCreation,
  preparePolicyResourceScopeSet,
  policyResourceScopeSetCommandCount,
  type GraphCommandBatchOperationIdentities,
} from "./owned-policy-commands.js";

function operations(
  count: number,
  prefix: string,
): GraphCommandBatchOperationIdentities {
  return {
    batch: {
      commandId: "operation_" + prefix,
      inverseCommandId: "inverse_" + prefix,
    },
    actions: Array.from({ length: count }, (_, index) => ({
      commandId: "operation_" + prefix + "_" + String(index),
      inverseCommandId: "inverse_" + prefix + "_" + String(index),
    })),
  };
}
function configuration(serviceId: string, values: unknown) {
  const service = awsCatalogV1.requireService(serviceId),
    result = awsCatalogV1.validateConfiguration(serviceId, values);
  if (!result.success) throw Error("Invalid synthetic configuration");
  return {
    schemaId: service.configuration.schemaId,
    schemaVersion: service.configuration.schemaVersion,
    values: result.values,
  };
}
function fixture() {
  let sequence = 0;
  const common = {
    catalog: awsEditorCatalog,
    createId: () => "operation_secret_policy_" + String(++sequence),
  };
  const role = dispatchAddServiceCommand({
    ...common,
    document: loadBlankAwsEditorArchitectureDocument(),
    serviceId: "aws.iam.role",
  });
  const first = dispatchAddServiceCommand({
    ...common,
    document: role.document,
    serviceId: "aws.secretsmanager.secret",
    configurationValues: {
      name: { kind: "string", value: "application/first" },
    },
  });
  const second = dispatchAddServiceCommand({
    ...common,
    document: first.document,
    serviceId: "aws.secretsmanager.secret",
    configurationValues: {
      name: { kind: "string", value: "application/second" },
    },
  });
  const trust = prepareUserPolicyCreation({
    document: second.document,
    descriptors: awsOwnedPolicyGraphDescriptors,
    ownerNodeId: role.nodeId,
    slotId: "aws.iam.role.slot.trust-policy",
    policyOwnedKindId: "aws.iam.policy-document",
    policy: {
      nodeId: "reader_trust",
      deploymentKey: "reader_trust",
      label: "Explicit service trust",
      position: { x: 0, y: 0 },
      configuration: configuration("aws.iam.policy-document", {
        policyName: { kind: "string", value: "ReaderTrust" },
        policyKind: { kind: "string", value: "trust" },
      }),
    },
    initialStatement: {
      nodeId: "reader_trust_statement",
      deploymentKey: "reader_trust_statement",
      label: "Explicit assume-role trust",
      position: { x: 0, y: 0 },
      configuration: configuration("aws.iam.policy-statement", {
        actions: { kind: "string-list", value: ["sts:AssumeRole"] },
        principalKind: { kind: "string", value: "service" },
        principals: { kind: "string-list", value: ["lambda.amazonaws.com"] },
      }),
    },
    ownerBindingEdgeId: "reader_trust_owner",
    statementMembershipEdgeId: "reader_trust_member",
    operationIdentities: operations(4, "create_reader_trust"),
  });
  if (trust.status !== "ready")
    throw Error("Explicit trust preparation failed");
  const prepared = prepareUserPolicyCreation({
    document: trust.previewDocument,
    descriptors: awsOwnedPolicyGraphDescriptors,
    ownerNodeId: role.nodeId,
    slotId: "aws.iam.role.slot.custom-inline-policy",
    policyOwnedKindId: "aws.iam.policy-document",
    policy: {
      nodeId: "secret_policy",
      deploymentKey: "secret_policy",
      label: "Secret read",
      position: { x: 0, y: 0 },
      configuration: configuration("aws.iam.policy-document", {
        policyName: { kind: "string", value: "SecretRead" },
        policyKind: { kind: "string", value: "identity-inline" },
      }),
    },
    initialStatement: {
      nodeId: "secret_read",
      deploymentKey: "secret_read",
      label: "Read value",
      position: { x: 0, y: 0 },
      configuration: configuration("aws.iam.policy-statement", {
        actions: {
          kind: "string-list",
          value: ["secretsmanager:GetSecretValue"],
        },
      }),
    },
    ownerBindingEdgeId: "secret_policy_owner",
    statementMembershipEdgeId: "secret_read_member",
    operationIdentities: operations(4, "create_secret_policy"),
  });
  if (prepared.status !== "ready")
    throw Error("Policy preparation failed: " + JSON.stringify(prepared));
  return {
    document: prepared.previewDocument,
    first: first.nodeId,
    second: second.nodeId,
    role: role.nodeId,
  };
}
describe("explicit secret role-policy resource selection", () => {
  it("sets edge and typed ARN reference atomically, changes only the selected scope, and reverses both", () => {
    const input = fixture(),
      before = structuredClone(input.document);
    const projected = projectOwnedPolicyConfigurations(
      input.document,
      awsOwnedPolicyGraphDescriptors,
    );
    const statement = projected.policies.find(
      (p) => p.configurationNode.id === "secret_policy",
    )?.statements[0];
    const descriptor = awsOwnedPolicyGraphDescriptors.resourceScopes.find(
      (d) => d.id === "aws.iam.policy-scope.secret",
    );
    if (!statement || !descriptor)
      throw Error("Missing secret scope projection");
    expect(
      policyResourceScopeSetCommandCount({
        statement,
        descriptor,
        resourceNodeId: input.first,
        scopeEdgeId: "secret_scope",
      }),
    ).toBe(2);
    const set = preparePolicyResourceScopeSet({
      document: input.document,
      descriptors: awsOwnedPolicyGraphDescriptors,
      policyNodeId: "secret_policy",
      statementNodeId: "secret_read",
      scopeEdgeId: "secret_scope",
      resourceScopeDescriptorId: descriptor.id,
      resourceNodeId: input.first,
      operationIdentities: operations(2, "set_secret_scope"),
    });
    if (set.status !== "ready") throw Error("Secret scope rejected");
    expect(set.command.commands.map((c) => c.kind)).toEqual([
      "add-edge",
      "update-node-configuration",
    ]);
    expect(
      set.previewDocument.nodes.find((n) => n.id === "secret_read")?.semantic
        .configuration.values,
    ).toMatchObject({
      resourceNode: {
        kind: "node-reference",
        nodeId: input.first,
        attribute: "aws.secretsmanager.secret.arn",
      },
      actions: {
        kind: "string-list",
        value: ["secretsmanager:GetSecretValue"],
      },
      principalKind: { kind: "string", value: "none" },
    });
    const report = executeArchitectureValidationRules(
      {
        document: set.previewDocument,
        target: "compilation",
        environment: "production",
      },
      awsValidationRulesV1,
    );
    expect(report.diagnostics).toEqual([]);
    expect(
      report.findings.filter(
        (f) =>
          String(f.code).startsWith("aws.validation.secret-") &&
          f.severity === "security-error",
      ),
    ).toEqual([]);
    const applied = applyGraphCommand(input.document, set.command);
    if (applied.inversion.kind !== "available")
      throw Error("Missing scope inverse");
    expect(
      applyGraphCommand(applied.document, applied.inversion.command).document,
    ).toEqual(input.document);
    const nextStatement = projectOwnedPolicyConfigurations(
      set.previewDocument,
      awsOwnedPolicyGraphDescriptors,
    ).policies.find((p) => p.configurationNode.id === "secret_policy")
      ?.statements[0];
    if (!nextStatement) throw Error("Missing selected statement");
    expect(
      policyResourceScopeSetCommandCount({
        statement: nextStatement,
        descriptor,
        resourceNodeId: input.second,
        scopeEdgeId: "secret_scope",
      }),
    ).toBe(3);
    const changed = preparePolicyResourceScopeSet({
      document: set.previewDocument,
      descriptors: awsOwnedPolicyGraphDescriptors,
      policyNodeId: "secret_policy",
      statementNodeId: "secret_read",
      scopeEdgeId: "secret_scope",
      resourceScopeDescriptorId: descriptor.id,
      resourceNodeId: input.second,
      operationIdentities: operations(3, "change_secret_scope"),
    });
    if (changed.status !== "ready") throw Error("Secret scope change rejected");
    expect(changed.command.commands.map((c) => c.kind)).toEqual([
      "remove-edge",
      "add-edge",
      "update-node-configuration",
    ]);
    expect(
      changed.previewDocument.nodes.find((n) => n.id === "secret_read")
        ?.semantic.configuration.values,
    ).toMatchObject({
      resourceNode: {
        kind: "node-reference",
        nodeId: input.second,
        attribute: "aws.secretsmanager.secret.arn",
      },
    });
    expect(
      preparePolicyResourceScopeSet({
        document: input.document,
        descriptors: awsOwnedPolicyGraphDescriptors,
        policyNodeId: "secret_policy",
        statementNodeId: "secret_read",
        scopeEdgeId: "secret_scope",
        resourceScopeDescriptorId: descriptor.id,
        resourceNodeId: input.role,
        operationIdentities: operations(2, "wrong_secret_scope"),
      }),
    ).toMatchObject({ status: "invalid" });
    expect(input.document).toEqual(before);
  });
  it("rejects a reference recipe for a catalog field that is not a node reference", () => {
    expect(() =>
      createOwnedPolicyGraphDescriptorSet(awsEditorCatalog, {
        statementMembership: {
          id: "member",
          relationshipType: "aws.iam.policy-contains-statement",
          childPort: "aws.iam.policy-statement.policy-document",
          parentPort: "aws.iam.policy-document.statement",
        },
        conditionMembership: {
          id: "condition",
          relationshipType: "aws.iam.statement-owns-condition",
          childPort: "aws.iam.policy-condition.statement-condition",
          parentPort: "aws.iam.policy-statement.condition",
        },
        resourceScopeCardinality: { minimum: 0, maximum: 1 },
        resourceScopes: [
          {
            id: "bad",
            relationshipType: "aws.iam.authorizes-secret",
            statementPort: "aws.iam.policy-statement.secret-resource",
            resourceServiceType: "aws.secretsmanager.secret",
            resourceResourceType: "aws.secretsmanager.secret",
            resourcePort: "aws.secretsmanager.secret.policy-resource",
            statementReferenceBinding: {
              property: "actions",
              attribute: "aws.secretsmanager.secret.arn",
            },
          },
        ],
      }),
    ).toThrow("exact catalog node-reference field");
  });
});
