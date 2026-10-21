import type { ValidationFindingCandidate } from "@cloudmarkup/domain";
import { kmsKeyReadinessValidationRuleDescriptor } from "../catalog/validation-rules/kms-key-readiness.js";
import {
  kmsKeyAdminActions,
  kmsKeyUserActions,
  kmsRoleAccount,
} from "../kms-key-contract.js";
import {
  configurationValue,
  defineAwsValidationRuleV1,
  finding,
  literalString,
  nodeConfigurationLocation,
  nodeLocation,
  type AwsValidationCatalogV1,
  type AwsValidationNode,
} from "./rule-helpers.js";

function list(
  node: AwsValidationNode,
  key: string,
): readonly string[] | undefined {
  const value = configurationValue(node.semantic.configuration.values, key);
  return value?.kind === "string-list" ? value.value : undefined;
}
export function createKmsKeyReadinessRuleV1(catalog: AwsValidationCatalogV1) {
  const descriptor = kmsKeyReadinessValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (!document) return [];
      const findings: ValidationFindingCandidate[] = [];
      const add = (
        node: AwsValidationNode,
        index: number,
        suffix: string,
        title: string,
        message: string,
        key?: string,
      ) => {
        findings.push(
          finding(descriptor, {
            code: "aws.validation.kms-" + suffix,
            severity: "security-error",
            title,
            beginnerExplanation: message,
            technicalExplanation: message,
            affected: [
              key
                ? nodeConfigurationLocation(node, index, key)
                : nodeLocation(node, index),
            ],
          }),
        );
      };
      const exactEdge = (id: string, source: string, target: string) =>
        document.edges.filter((edge) => {
          const rule = catalog.connectionRules.find(
            (candidate) => candidate.relationshipType === id,
          );
          return (
            rule &&
            edge.semantic.relationshipType === id &&
            edge.semantic.source.nodeId === source &&
            edge.semantic.target.nodeId === target &&
            edge.semantic.source.port === rule.source.portId &&
            edge.semantic.target.port === rule.target.portId &&
            edge.semantic.configuration.schemaId ===
              rule.configuration.schemaId &&
            edge.semantic.configuration.schemaVersion ===
              rule.configuration.schemaVersion &&
            Object.keys(edge.semantic.configuration.values).length === 0
          );
        });
      document.nodes.forEach((statement, index) => {
        const resource = configurationValue(
          statement.semantic.configuration.values,
          "resourceNode",
        );
        const hasKmsScope =
          document.edges.some(
            (edge) =>
              edge.semantic.source.nodeId === statement.id &&
              edge.semantic.relationshipType === "aws.iam.authorizes-kms-key",
          ) ||
          (resource?.kind === "node-reference" &&
            resource.attribute === "aws.kms.key.arn");
        if (
          statement.semantic.serviceType !== "aws.iam.policy-statement" ||
          (!hasKmsScope &&
            !(list(statement, "actions") ?? []).some((action) =>
              action.startsWith("kms:"),
            ))
        )
          return;
        const policy = document.nodes.find(
          (node) =>
            node.id === statement.semantic.parent?.nodeId &&
            node.semantic.serviceType === "aws.iam.policy-document",
        );
        const key = document.nodes.find(
          (node) =>
            node.id === policy?.semantic.parent?.nodeId &&
            node.semantic.serviceType === "aws.kms.key",
        );
        if (
          !policy ||
          !key ||
          exactEdge("aws.kms.key-owns-resource-policy", policy.id, key.id)
            .length !== 1
        )
          add(
            statement,
            index,
            "policy-owner",
            "Keep KMS permissions in their exact owning key policy",
            "This foundation supports reviewed KMS actions only inside the explicit user-owned policy of their exact key. Other policy owners and service encryption integrations require separate review.",
          );
      });
      document.nodes.forEach((key, keyIndex) => {
        if (key.semantic.serviceType !== "aws.kms.key") return;
        const values = key.semantic.configuration.values;
        const fixed: Record<string, string | boolean> = {
          keySpec: "SYMMETRIC_DEFAULT",
          keyUsage: "ENCRYPT_DECRYPT",
          origin: "AWS_KMS",
          multiRegion: false,
          preventDestroy: true,
        };
        for (const [property, expected] of Object.entries(fixed)) {
          const value = configurationValue(values, property);
          if (
            value?.kind !==
              (typeof expected === "boolean" ? "boolean" : "string") ||
            value.value !== expected
          )
            add(
              key,
              keyIndex,
              "key-mode",
              "Choose the supported retained symmetric key variant",
              "This key supports AWS-generated regional symmetric encryption with retained lifecycle only. Unsupported key modes cannot be substituted during export.",
              property,
            );
        }
        for (const [property, minimum, maximum] of [
          ["rotationPeriodDays", 90, 2560],
          ["deletionWindowDays", 7, 30],
        ] as const) {
          const value = configurationValue(values, property);
          if (
            value?.kind !== "integer" ||
            !Number.isInteger(value.value) ||
            value.value < minimum ||
            value.value > maximum
          )
            add(
              key,
              keyIndex,
              "key-bounds",
              "Review the key lifecycle period",
              "Rotation requires 90–2,560 whole days and deletion waiting periods require 7–30 whole days. Retaining the key does not schedule deletion.",
              property,
            );
        }
        const policies = document.nodes.filter(
          (node) =>
            node.semantic.serviceType === "aws.iam.policy-document" &&
            exactEdge("aws.kms.key-owns-resource-policy", node.id, key.id)
              .length === 1,
        );
        if (policies.length !== 1) {
          add(
            key,
            keyIndex,
            "policy-owner",
            "Attach one explicit key policy",
            "This key requires exactly one user-owned canonical key policy. No default administrator or wildcard repair is inferred.",
          );
          return;
        }
        const policy = policies[0];
        if (!policy) return;
        const policyIndex = document.nodes.indexOf(policy);
        const owners = document.edges.filter(
          (edge) =>
            edge.semantic.source.nodeId === policy.id &&
            catalog.connectionRules.some(
              (rule) =>
                rule.source.serviceId === "aws.iam.policy-document" &&
                rule.relationshipType === edge.semantic.relationshipType,
            ),
        );
        if (
          owners.length !== 1 ||
          policy.semantic.parent?.nodeId !== key.id ||
          policy.semantic.parent.relationshipType !==
            "aws.kms.key-owns-resource-policy" ||
          policy.semantic.lifecycle.ownership !== "user" ||
          literalString(policy.semantic.configuration.values, "policyKind") !==
            "resource"
        )
          add(
            policy,
            policyIndex,
            "policy-owner",
            "Keep the key policy owned by its exact key",
            "Key policies require one matching semantic parent and owner edge, the resource policy kind, and explicit user ownership.",
          );
        const statements = document.nodes.filter(
          (node) =>
            node.semantic.serviceType === "aws.iam.policy-statement" &&
            exactEdge("aws.iam.policy-contains-statement", node.id, policy.id)
              .length === 1,
        );
        let administrator = false;
        const accounts = new Set<string>();
        for (const statement of statements) {
          const index = document.nodes.indexOf(statement);
          const actions = list(statement, "actions") ?? [];
          const principals = list(statement, "principals") ?? [];
          const admin = actions.includes("kms:PutKeyPolicy");
          const reviewed = admin ? kmsKeyAdminActions : kmsKeyUserActions;
          const resource = configurationValue(
            statement.semantic.configuration.values,
            "resourceNode",
          );
          const scopeEdges = document.edges.filter(
            (edge) =>
              edge.semantic.source.nodeId === statement.id &&
              String(edge.semantic.relationshipType).startsWith(
                "aws.iam.authorizes-",
              ),
          );
          const memberships = document.edges.filter(
            (edge) =>
              edge.semantic.source.nodeId === statement.id &&
              edge.semantic.relationshipType ===
                "aws.iam.policy-contains-statement",
          );
          if (
            memberships.length !== 1 ||
            statement.semantic.parent?.nodeId !== policy.id ||
            statement.semantic.parent.relationshipType !==
              "aws.iam.policy-contains-statement" ||
            statement.semantic.lifecycle.ownership !== "user"
          )
            add(
              statement,
              index,
              "statement-owner",
              "Keep the statement owned by its exact key policy",
              "Each key-policy statement requires one matching membership edge and semantic parent with explicit user ownership.",
            );
          if (
            scopeEdges.length !== 1 ||
            exactEdge("aws.iam.authorizes-kms-key", statement.id, key.id)
              .length !== 1 ||
            resource?.kind !== "node-reference" ||
            resource.nodeId !== key.id ||
            resource.attribute !== "aws.kms.key.arn" ||
            (list(statement, "resourceExpressions")?.length ?? -1) !== 0
          )
            add(
              statement,
              index,
              "policy-self-scope",
              "Scope the statement to its owning key",
              "Key-policy statements require one exact typed reference to their owning key and no pasted or wildcard resource expressions.",
              "resourceNode",
            );
          const conditions = document.edges.some(
            (edge) =>
              edge.semantic.relationshipType ===
                "aws.iam.statement-owns-condition" &&
              edge.semantic.target.nodeId === statement.id,
          );
          if (
            literalString(statement.semantic.configuration.values, "effect") !==
              "allow" ||
            actions.length === 0 ||
            actions.some((action) => !reviewed.has(action)) ||
            conditions
          )
            add(
              statement,
              index,
              "policy-actions",
              "Separate reviewed key administration and key use",
              "Use explicit allow actions from the reviewed administrator or encryption/decryption set. Mixed administration/use, denies, grants and conditions require a later variant.",
              "actions",
            );
          const principalValid =
            literalString(
              statement.semantic.configuration.values,
              "principalKind",
            ) === "provider-identity" &&
            principals.length > 0 &&
            principals.every(
              (principal) => kmsRoleAccount(principal) !== undefined,
            );
          if (!principalValid)
            add(
              statement,
              index,
              "policy-principal",
              "Choose explicit IAM role principals",
              "The foundation accepts exact IAM role ARNs only. Account-root, wildcard, service, assumed-role session and inferred principals are unsupported.",
              "principals",
            );
          for (const principal of principals) {
            const account = kmsRoleAccount(principal);
            if (account) accounts.add(account);
          }
          if (
            admin &&
            principalValid &&
            actions.every((action) => kmsKeyAdminActions.has(action)) &&
            !conditions &&
            literalString(statement.semantic.configuration.values, "effect") ===
              "allow"
          )
            administrator = true;
        }
        if (!administrator)
          add(
            policy,
            policyIndex,
            "policy-administrator",
            "Name an explicit key administrator",
            "At least one unconditional reviewed administrator statement must allow kms:PutKeyPolicy for an explicit role. Deployment must use a principal covered by that authority; the provider lockout check remains enabled.",
          );
        if (accounts.size > 1)
          add(
            policy,
            policyIndex,
            "policy-cross-account",
            "Keep key principals in one deployment account",
            "All reviewed role principals must belong to one account and partition. Cross-account access is outside this foundation; confirm that this account matches deployment before using the export.",
          );
      });
      return findings;
    },
  });
}
