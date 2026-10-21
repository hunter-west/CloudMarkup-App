import {
  applyGraphCommand,
  executeArchitectureValidationRules,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";
import { awsCatalogArtifactV1, awsCatalogV1 } from "./catalog-v1-accessors.js";
import { ecsBindings, ecsProperties } from "./catalog/services/ecs-fargate.js";
import { awsConnectionResolverV1 } from "./connection-resolution.js";
import { ecsFixture } from "./ecs-fixture.test-support.js";
import { awsServiceExtensionV1 } from "./service-extension-v1-accessors.js";
import { createEcsReadinessRuleV1 } from "./validation/ecs-readiness-rule.js";
const rule = createEcsReadinessRuleV1(awsCatalogArtifactV1);
const findings = (d: ArchitectureDocument) =>
  executeArchitectureValidationRules(
    { document: d, target: "draft", environment: "development" },
    [rule],
  ).findings;
const errors = (d: ArchitectureDocument) =>
  findings(d).filter((f) => f.severity !== "warning");
describe("ECR and Linux Fargate foundation", () => {
  it.each([false, true])(
    "validates honest staged/declared-ready intent %s",
    (ready) => {
      const d = ecsFixture(ready);
      const actual = findings(d);
      expect(
        actual.filter((finding) => finding.severity !== "warning"),
      ).toEqual([]);
      expect(
        actual.every(
          (finding) => finding.code === "aws.validation.ecs-external-readiness",
        ),
      ).toBe(true);
      expect(actual).toHaveLength(6);
      expect(actual).toEqual(findings(d));
    },
  );
  it("keeps four deployable cards and two owned configurations distinct", () => {
    const services = Object.keys(ecsProperties).map((id) =>
      awsCatalogV1.getService(id),
    );
    expect(
      services.filter(
        (s) => s?.nodeKind.kind === "resource" && s.nodeKind.deployable,
      ),
    ).toHaveLength(4);
    expect(services.filter((s) => s?.iconId === null)).toHaveLength(2);
    expect(
      awsServiceExtensionV1.getOwnedConfigurationSlots("aws.ecr.repository"),
    ).toHaveLength(1);
    expect(
      awsServiceExtensionV1.getOwnedConfigurationSlots(
        "aws.ecs.task-definition",
      )[0]?.cardinality,
    ).toMatchObject({ minimum: 0, maximum: 1 });
    expect(
      awsCatalogV1
        .getService("aws.ecs.task-definition")
        ?.ports.find((p) => p.id === "aws.ecs.task-definition.container"),
    ).toMatchObject({ required: false, cardinality: "one" });
  });
  it.each(ecsBindings)(
    "resolves %s atomically and reversibly without inferred effects",
    (rel, sourceType, sourceSuffix, targetType, targetSuffix) => {
      const original = ecsFixture();
      const e = original.edges.find((e) => e.semantic.relationshipType === rel);
      if (!e) throw Error("Missing edge");
      const d = parseArchitectureDocument({
        ...original,
        edges: original.edges.filter((q) => q.id !== e.id),
      });
      const source = d.nodes.find(
          (n) =>
            n.semantic.serviceType === sourceType &&
            n.id === e.semantic.source.nodeId,
        ),
        target = d.nodes.find(
          (n) =>
            n.semantic.serviceType === targetType &&
            n.id === e.semantic.target.nodeId,
        );
      if (!source || !target) throw Error("Missing endpoints");
      const request = {
        document: d,
        ruleId: rel,
        source: { nodeId: source.id, portId: sourceType + "." + sourceSuffix },
        target: { nodeId: target.id, portId: targetType + "." + targetSuffix },
        configuration: e.semantic.configuration.values,
        operationId: "operation_ecs",
      };
      const result = awsConnectionResolverV1.resolve(request);
      expect(result.success).toBe(true);
      expect(result).toEqual(awsConnectionResolverV1.resolve(request));
      if (!result.success) throw Error("Missing successful plan");
      expect(result.batch.commands).toHaveLength(1);
      expect(result.preview.document.nodes).toEqual(d.nodes);
      const applied = applyGraphCommand(d, result.batch);
      if (applied.inversion.kind !== "available")
        throw Error("Missing inverse");
      expect(
        applyGraphCommand(applied.document, applied.inversion.command).document,
      ).toEqual(d);
      expect(
        awsConnectionResolverV1.resolve({
          ...request,
          source: request.target,
          target: request.source,
        }).success,
      ).toBe(false);
    },
  );
  it.each(Object.keys(ecsProperties))(
    "rejects every missing/wrong-kind/unknown literal field of %s",
    (type) => {
      const d = ecsFixture(),
        n = d.nodes.find((n) => n.semantic.serviceType === type);
      if (!n) throw Error("Missing fixture");
      for (const key of Object.keys(ecsProperties[type] ?? {})) {
        const { [key]: removed, ...remaining } = n.semantic.configuration
          .values as Record<string, ConfigurationValue>;
        expect(removed).toBeDefined();
        if (!removed) throw Error("Missing reviewed fixture field");
        const missing = parseArchitectureDocument({
          ...d,
          nodes: d.nodes.map((q) =>
            q.id === n.id
              ? {
                  ...q,
                  semantic: {
                    ...q.semantic,
                    configuration: {
                      ...q.semantic.configuration,
                      values: remaining,
                    },
                  },
                }
              : q,
          ),
        });
        expect(
          errors(missing).some(
            (f) => f.code === "aws.validation.ecs-configuration",
          ),
        ).toBe(true);
        expect(
          awsCatalogV1.validateConfiguration(type, {
            ...n.semantic.configuration.values,
            [key]:
              removed.kind === "string"
                ? { kind: "boolean", value: false }
                : { kind: "string", value: "invalid" },
          }).success,
        ).toBe(false);
      }
      expect(
        awsCatalogV1.validateConfiguration(type, {
          ...n.semantic.configuration.values,
          unreviewed: { kind: "string", value: "invalid" },
        }).success,
      ).toBe(false);
    },
  );
  it.each([
    ["image-owner", "owner", "image"],
    ["container-owner", "owner", "container"],
    ["duplicate-execution-binding", "roles", "task"],
    ["same-role", "roles", "task"],
    ["wrong-trust", "roles", "task"],
    ["trust-resource-kind", "roles", "task"],
    ["trust-scope", "roles", "task"],
    ["duplicate-attachment", "execution-policy", "task"],
    ["missing-policy", "execution-policy", "task"],
    ["image-platform", "image", "container"],
    ["bad-size", "sizing", "task"],
    ["unpublished", "start-readiness", "service"],
    ["unpopulated", "start-readiness", "service"],
    ["missing-network", "network", "service"],
    ["missing-logs", "logs", "container"],
    ["cmk-secret", "secret", "container"],
    ["duplicate-env", "secret", "container"],
    ["reserved-env", "secret", "container"],
    ["task-only-secret", "secret-read", "container"],
    ["metadata-only-secret", "secret-read", "container"],
  ] as const)("rejects %s", (kind, expectedCode, affectedNode) => {
    let d = ecsFixture(true);
    const change = (id: string, key: string, value: unknown) => {
      d = parseArchitectureDocument({
        ...d,
        nodes: d.nodes.map((n) =>
          n.id === id
            ? {
                ...n,
                semantic: {
                  ...n.semantic,
                  configuration: {
                    ...n.semantic.configuration,
                    values: {
                      ...n.semantic.configuration.values,
                      [key]: value,
                    },
                  },
                },
              }
            : n,
        ),
      });
    };
    const remove = (id: string) => {
      d = parseArchitectureDocument({
        ...d,
        edges: d.edges.filter((e) => e.id !== id),
      });
    };
    switch (kind) {
      case "image-owner":
        remove("image_owner");
        break;
      case "container-owner":
        remove("container_owner");
        break;
      case "duplicate-execution-binding": {
        const e = d.edges.find((e) => e.id === "execution_binding");
        if (e)
          d = parseArchitectureDocument({
            ...d,
            edges: [...d.edges, { ...e, id: "borrowed" }],
          });
        break;
      }
      case "same-role":
        d = parseArchitectureDocument({
          ...d,
          edges: d.edges.map((e) =>
            e.id === "application_binding"
              ? {
                  ...e,
                  semantic: {
                    ...e.semantic,
                    source: { ...e.semantic.source, nodeId: "execution_role" },
                  },
                }
              : e,
          ),
        });
        break;
      case "wrong-trust":
        change("execution_role_statement", "principals", {
          kind: "string-list",
          value: ["lambda.amazonaws.com"],
        });
        break;
      case "trust-resource-kind":
        change("execution_role_statement", "resourceExpressions", {
          kind: "string",
          value: "",
        });
        break;
      case "trust-scope":
        change("execution_role_statement", "statementScope", {
          kind: "string",
          value: "resource",
        });
        break;
      case "duplicate-attachment": {
        const e = d.edges.find((e) => e.id === "attachment_owner");
        if (e)
          d = parseArchitectureDocument({
            ...d,
            edges: [...d.edges, { ...e, id: "duplicate_attachment" }],
          });
        break;
      }
      case "missing-policy":
        remove("attachment_owner");
        break;
      case "image-platform":
        change("image", "architecture", { kind: "string", value: "arm64" });
        break;
      case "bad-size":
        change("task", "memoryMiB", { kind: "integer", value: 8192 });
        break;
      case "unpublished":
        change("image", "publicationStatus", {
          kind: "string",
          value: "external-publication-required",
        });
        break;
      case "unpopulated":
        d = parseArchitectureDocument({
          ...d,
          edges: d.edges.map((e) =>
            e.id === "secret_binding"
              ? {
                  ...e,
                  semantic: {
                    ...e.semantic,
                    configuration: {
                      ...e.semantic.configuration,
                      values: {
                        ...e.semantic.configuration.values,
                        populationStatus: {
                          kind: "string",
                          value: "external-population-required",
                        },
                      },
                    },
                  },
                }
              : e,
          ),
        });
        break;
      case "missing-network":
        remove("subnet_binding");
        break;
      case "missing-logs":
        remove("logs_binding");
        break;
      case "cmk-secret":
        change("secret", "encryptionMode", {
          kind: "string",
          value: "customer-managed",
        });
        break;
      case "duplicate-env": {
        const e = d.edges.find((e) => e.id === "secret_binding");
        if (e)
          d = parseArchitectureDocument({
            ...d,
            edges: [...d.edges, { ...e, id: "duplicate_env" }],
          });
        break;
      }
      case "reserved-env":
        d = parseArchitectureDocument({
          ...d,
          edges: d.edges.map((e) =>
            e.id === "secret_binding"
              ? {
                  ...e,
                  semantic: {
                    ...e.semantic,
                    configuration: {
                      ...e.semantic.configuration,
                      values: {
                        ...e.semantic.configuration.values,
                        environmentName: {
                          kind: "string",
                          value: "AWS_ACCESS_KEY_ID",
                        },
                      },
                    },
                  },
                }
              : e,
          ),
        });
        break;
      case "task-only-secret":
        d = parseArchitectureDocument({
          ...d,
          nodes: d.nodes.map((n) =>
            n.id === "secret_policy"
              ? {
                  ...n,
                  semantic: {
                    ...n.semantic,
                    parent: {
                      nodeId: "application_role",
                      relationshipType: "aws.iam.role-owns-inline-policy",
                    },
                  },
                }
              : n,
          ),
          edges: d.edges.map((e) =>
            e.id === "secret_policy_owner"
              ? {
                  ...e,
                  semantic: {
                    ...e.semantic,
                    target: {
                      ...e.semantic.target,
                      nodeId: "application_role",
                    },
                  },
                }
              : e,
          ),
        });
        break;
      case "metadata-only-secret":
        change("secret_statement", "actions", {
          kind: "string-list",
          value: ["secretsmanager:DescribeSecret"],
        });
        break;
    }
    expect(
      errors(d).some(
        (finding) =>
          finding.code === "aws.validation.ecs-" + expectedCode &&
          finding.affected.some(
            (location) =>
              location.kind === "node" && location.nodeId === affectedNode,
          ),
      ),
    ).toBe(true);
  });
});
