import type { ValidationFindingCandidate } from "@cloudmarkup/domain";
import { secretReadinessValidationRuleDescriptor } from "../catalog/validation-rules/secret-readiness.js";
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

const secretReadActions = new Set([
  "secretsmanager:GetSecretValue",
  "secretsmanager:DescribeSecret",
]);
export function createSecretReadinessRuleV1(catalog: AwsValidationCatalogV1) {
  const descriptor = secretReadinessValidationRuleDescriptor;
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
        property?: string,
        severity: "security-error" | "warning" = "security-error",
      ) =>
        findings.push(
          finding(descriptor, {
            code: "aws.validation.secret-" + suffix,
            severity,
            title,
            beginnerExplanation: message,
            technicalExplanation: message,
            affected: [
              property
                ? nodeConfigurationLocation(node, index, property)
                : nodeLocation(node, index),
            ],
          }),
        );
      const edges = (relationship: string, source?: string, target?: string) =>
        document.edges.filter(
          (edge) =>
            edge.semantic.relationshipType === relationship &&
            (source === undefined || edge.semantic.source.nodeId === source) &&
            (target === undefined || edge.semantic.target.nodeId === target),
        );
      const exact = (relationship: string, source: string, target: string) =>
        edges(relationship, source, target).filter((edge) => {
          const rule = catalog.connectionRules.find(
            (entry) => entry.relationshipType === relationship,
          );
          if (!rule) return false;
          return (
            edge.semantic.source.port === rule.source.portId &&
            edge.semantic.target.port === rule.target.portId &&
            edge.semantic.configuration.schemaId ===
              rule.configuration.schemaId &&
            edge.semantic.configuration.schemaVersion ===
              rule.configuration.schemaVersion &&
            Object.keys(edge.semantic.configuration.values).length === 0
          );
        });
      const list = (node: AwsValidationNode, property: string) => {
        const value = configurationValue(
          node.semantic.configuration.values,
          property,
        );
        return value?.kind === "string-list" ? value.value : undefined;
      };
      const enabled = (node: AwsValidationNode, property: string) => {
        const value = configurationValue(
          node.semantic.configuration.values,
          property,
        );
        return value?.kind === "boolean" && value.value;
      };
      document.nodes.forEach((secret, index) => {
        if (secret.semantic.serviceType !== "aws.secretsmanager.secret") return;
        const values = secret.semantic.configuration.values;
        const name = literalString(values, "name");
        if (
          !name ||
          name.length > 512 ||
          !/^[A-Za-z0-9/_+=.@-]+$/u.test(name) ||
          /-[A-Za-z0-9/_+=.@-]{6}$/u.test(name)
        )
          add(
            secret,
            index,
            "name",
            "Choose an unambiguous secret name",
            "Use 1-512 supported ASCII characters and avoid a trailing hyphen plus six characters. Local validity does not establish name availability.",
            "name",
          );
        if (
          document.nodes.some(
            (other) =>
              other.id !== secret.id &&
              other.semantic.serviceType === secret.semantic.serviceType &&
              literalString(other.semantic.configuration.values, "name") ===
                name,
          )
        )
          add(
            secret,
            index,
            "duplicate-name",
            "Use a distinct regional secret name",
            "Two graph-owned secrets cannot share the same exact name in this regional export.",
            "name",
          );
        if (
          literalString(values, "valueMode") !== "external-population" ||
          !enabled(secret, "preventDestroy") ||
          Object.keys(values).some(
            (key) =>
              ![
                "name",
                "description",
                "encryptionMode",
                "valueMode",
                "recoveryWindowDays",
                "preventDestroy",
              ].includes(key),
          )
        )
          add(
            secret,
            index,
            "mode",
            "Keep secret contents outside the graph",
            "This variant supports retained metadata and external population only. Values, versions, password generation, rotation, replicas and unreviewed fields cannot be exported.",
          );
        const recovery = configurationValue(values, "recoveryWindowDays");
        if (
          recovery?.kind !== "integer" ||
          !Number.isInteger(recovery.value) ||
          recovery.value < 7 ||
          recovery.value > 30
        )
          add(
            secret,
            index,
            "recovery",
            "Choose a safe recovery window",
            "Terraform recovery windows require 7-30 whole days. CloudFormation retains the secret; this choice does not schedule deletion.",
            "recoveryWindowDays",
          );
        const mode = literalString(values, "encryptionMode");
        const bindings = edges("aws.kms.encrypts-secret", undefined, secret.id);
        const key = document.nodes.find(
          (node) => node.id === bindings[0]?.semantic.source.nodeId,
        );
        if (
          (mode === "aws-managed" && bindings.length !== 0) ||
          (mode === "customer-managed" &&
            (bindings.length !== 1 ||
              key?.semantic.serviceType !== "aws.kms.key" ||
              exact("aws.kms.encrypts-secret", key.id, secret.id).length !==
                1 ||
              !enabled(key, "enabled"))) ||
          !["aws-managed", "customer-managed"].includes(mode ?? "")
        )
          add(
            secret,
            index,
            "encryption",
            "Match encryption mode to one enabled key",
            "AWS-managed mode has no key connection. Customer-managed mode requires one exact enabled regional symmetric KMS key; no pasted or external key is inferred.",
            "encryptionMode",
          );
        if (
          secret.semantic.parent ||
          secret.semantic.lifecycle.ownership !== "user"
        )
          add(
            secret,
            index,
            "ownership",
            "Keep secret metadata user-owned in this region",
            "This foundation supports user-owned root regional secret metadata. Import, generated/adopted ownership and foreign placement need separate reviewed contracts.",
          );
        add(
          secret,
          index,
          "external-population",
          "Populate the empty secret externally before use",
          "Export creates metadata without a secret value. Use an approved external secret-management process before an application retrieves it; runtime retrieval and rotation are not generated.",
          "valueMode",
          "warning",
        );
        if (mode === "customer-managed")
          add(
            secret,
            index,
            "key-authority",
            "Review key-user authority separately",
            "The KMS association grants no permissions. Review GenerateDataKey/Decrypt for external population and Decrypt for readers in the explicit key policy. Export cannot verify the deployment caller or effective live access.",
            "encryptionMode",
            "warning",
          );
      });
      document.nodes.forEach((statement, index) => {
        if (statement.semantic.serviceType !== "aws.iam.policy-statement")
          return;
        const actions = list(statement, "actions") ?? [];
        const reference = configurationValue(
          statement.semantic.configuration.values,
          "resourceNode",
        );
        const scope = edges("aws.iam.authorizes-secret", statement.id);
        if (
          scope.length === 0 &&
          !actions.some((action) => action.startsWith("secretsmanager:")) &&
          !(
            reference?.kind === "node-reference" &&
            reference.attribute === "aws.secretsmanager.secret.arn"
          )
        )
          return;
        const secret = document.nodes.find(
          (node) => node.id === scope[0]?.semantic.target.nodeId,
        );
        const allScopes = document.edges.filter(
          (edge) =>
            edge.semantic.source.nodeId === statement.id &&
            String(edge.semantic.relationshipType).startsWith(
              "aws.iam.authorizes-",
            ),
        );
        if (
          secret?.semantic.serviceType !== "aws.secretsmanager.secret" ||
          scope.length !== 1 ||
          allScopes.length !== 1 ||
          exact("aws.iam.authorizes-secret", statement.id, secret.id).length !==
            1 ||
          reference?.kind !== "node-reference" ||
          reference.nodeId !== secret.id ||
          reference.attribute !== "aws.secretsmanager.secret.arn" ||
          (list(statement, "resourceExpressions")?.length ?? -1) !== 0
        )
          add(
            statement,
            index,
            "policy-scope",
            "Scope access to one exact secret",
            "Secret access requires one typed secret ARN reference with its exact scope edge. Pasted ARNs, wildcards, mixed scopes and mismatched references are unsupported.",
            "resourceNode",
          );
        const policy = document.nodes.find(
          (node) => node.id === statement.semantic.parent?.nodeId,
        );
        const role = document.nodes.find(
          (node) => node.id === policy?.semantic.parent?.nodeId,
        );
        if (
          !policy ||
          !role ||
          policy.semantic.serviceType !== "aws.iam.policy-document" ||
          role.semantic.serviceType !== "aws.iam.role" ||
          role.semantic.lifecycle.ownership !== "user" ||
          role.semantic.parent !== undefined ||
          policy.semantic.lifecycle.ownership !== "user" ||
          statement.semantic.lifecycle.ownership !== "user" ||
          literalString(policy.semantic.configuration.values, "policyKind") !==
            "identity-inline" ||
          policy.semantic.parent?.relationshipType !==
            "aws.iam.role-owns-inline-policy" ||
          exact("aws.iam.role-owns-inline-policy", policy.id, role.id)
            .length !== 1 ||
          statement.semantic.parent?.relationshipType !==
            "aws.iam.policy-contains-statement" ||
          exact("aws.iam.policy-contains-statement", statement.id, policy.id)
            .length !== 1 ||
          edges("aws.iam.policy-contains-statement", statement.id).length !== 1
        )
          add(
            statement,
            index,
            "policy-owner",
            "Keep access in its exact user-owned role policy",
            "Secret access belongs to an explicit identity-inline role policy with matching user-owned policy/statement parents and canonical owner/membership edges.",
          );
        if (
          actions.length === 0 ||
          actions.some((action) => !secretReadActions.has(action)) ||
          literalString(statement.semantic.configuration.values, "effect") !==
            "allow" ||
          literalString(
            statement.semantic.configuration.values,
            "principalKind",
          ) !== "none" ||
          (list(statement, "principals")?.length ?? -1) !== 0 ||
          edges("aws.iam.statement-owns-condition", undefined, statement.id)
            .length !== 0
        )
          add(
            statement,
            index,
            "policy-actions",
            "Choose explicit read-value or read-metadata access",
            "This variant allows only separately chosen GetSecretValue and DescribeSecret in an unconditional role identity policy. Writes, administration, wildcard actions, resource policies and inferred principals are unsupported.",
            "actions",
          );
      });
      return findings;
    },
  });
}
