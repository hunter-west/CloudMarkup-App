import type { ValidationFindingCandidate } from "@cloudmarkup/domain";
import { ecsProperties, ecsBindings } from "../catalog/services/ecs-fargate.js";
import { ecsReadinessValidationRuleDescriptor as descriptor } from "../catalog/validation-rules/ecs-fargate-readiness.js";
import {
  configurationValue,
  defineAwsValidationRuleV1,
  finding,
  literalString,
  nodeLocation,
  type AwsValidationCatalogV1,
  type AwsValidationNode,
} from "./rule-helpers.js";
export function createEcsReadinessRuleV1(catalog: AwsValidationCatalogV1) {
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const d = context.document;
      if (!d) return [];
      const results: ValidationFindingCandidate[] = [];
      const text = (n: AwsValidationNode, k: string) =>
        literalString(n.semantic.configuration.values, k);
      const scalar = (n: AwsValidationNode, k: string) => {
        const v = configurationValue(n.semantic.configuration.values, k);
        return v && "value" in v ? v.value : undefined;
      };
      const list = (n: AwsValidationNode, k: string) => {
        const v = configurationValue(n.semantic.configuration.values, k);
        return v?.kind === "string-list" ? v.value : [];
      };
      const user = (n: AwsValidationNode) =>
        n.semantic.lifecycle.ownership === "user" &&
        n.semantic.lifecycle.origin === "user";
      const add = (
        n: AwsValidationNode,
        code: string,
        message: string,
        warning = false,
      ) =>
        results.push(
          finding(descriptor, {
            code: "aws.validation.ecs-" + code,
            severity: warning ? "warning" : "security-error",
            title: warning
              ? "Review external Fargate readiness"
              : "Correct Fargate configuration",
            beginnerExplanation: message,
            technicalExplanation: message,
            affected: [nodeLocation(n, d.nodes.indexOf(n))],
          }),
        );
      const edges = (rel: string, s?: string, t?: string) =>
        d.edges.filter(
          (e) =>
            e.semantic.relationshipType === rel &&
            (s === undefined || e.semantic.source.nodeId === s) &&
            (t === undefined || e.semantic.target.nodeId === t),
        );
      const exact = (rel: string, s?: string, t?: string) =>
        edges(rel, s, t).filter((e) => {
          const rule = catalog.connectionRules.find(
            (r) => r.relationshipType === rel,
          );
          if (rule === undefined) return false;
          return (
            e.semantic.source.port === rule.source.portId &&
            e.semantic.target.port === rule.target.portId &&
            e.semantic.configuration.schemaId === rule.configuration.schemaId &&
            e.semantic.configuration.schemaVersion ===
              rule.configuration.schemaVersion &&
            d.nodes.find((n) => n.id === e.semantic.source.nodeId)?.semantic
              .serviceType === rule.source.serviceId &&
            d.nodes.find((n) => n.id === e.semantic.target.nodeId)?.semantic
              .serviceType === rule.target.serviceId &&
            (rel === "aws.ecs.container-uses-secret" ||
              Object.keys(e.semantic.configuration.values).length === 0)
          );
        });
      const related = (rel: string, id: string, target: boolean) =>
        exact(rel, target ? undefined : id, target ? id : undefined)
          .map((e) =>
            d.nodes.find(
              (n) =>
                n.id ===
                (target ? e.semantic.source.nodeId : e.semantic.target.nodeId),
            ),
          )
          .filter((n): n is AwsValidationNode => n !== undefined);
      const schemaValid = (n: AwsValidationNode) => {
        const props = ecsProperties[n.semantic.serviceType];
        if (!props) return false;
        const values = n.semantic.configuration.values;
        return (
          n.semantic.configuration.schemaId ===
            n.semantic.serviceType + ".configuration" &&
          n.semantic.configuration.schemaVersion === "1.0.0" &&
          Object.keys(values).sort().join(",") ===
            Object.keys(props).sort().join(",") &&
          Object.entries(props).every(([key, s]) => {
            const v = configurationValue(values, key),
              x = scalar(n, key);
            return (
              v?.kind === s.type &&
              (!("const" in s) || x === s.const) &&
              (!("enum" in s) || !s.enum || s.enum.includes(x as never)) &&
              (!("pattern" in s) ||
                !s.pattern ||
                (typeof x === "string" &&
                  new RegExp(s.pattern, "u").test(x))) &&
              (!("minLength" in s) ||
                s.minLength === undefined ||
                (typeof x === "string" && x.length >= s.minLength)) &&
              (!("maxLength" in s) ||
                s.maxLength === undefined ||
                (typeof x === "string" && x.length <= s.maxLength)) &&
              (s.type !== "integer" ||
                (typeof x === "number" &&
                  Number.isInteger(x) &&
                  (!("minimum" in s) ||
                    s.minimum === undefined ||
                    x >= s.minimum) &&
                  (!("maximum" in s) ||
                    s.maximum === undefined ||
                    x <= s.maximum)))
            );
          })
        );
      };
      const vpc = (n: AwsValidationNode): string | undefined => {
        if (n.semantic.serviceType === "aws.ec2.security-group") {
          const a = related(
            "aws.ec2.vpc-associates-security-group",
            n.id,
            true,
          );
          return a.length === 1 ? a[0]?.id : undefined;
        }
        let current = n,
          result: string | undefined;
        for (const [child, parent, rel] of [
          [
            "aws.ec2.subnet",
            "aws.ec2.availability-zone",
            "aws.ec2.availability-zone-contains-subnet",
          ],
          [
            "aws.ec2.availability-zone",
            "aws.ec2.vpc",
            "aws.ec2.vpc-contains-availability-zone",
          ],
          ["aws.ec2.vpc", "aws.region.boundary", "aws.region.contains-vpc"],
        ]) {
          const p = d.nodes.find(
            (a) => a.id === current.semantic.parent?.nodeId,
          );
          if (
            !p ||
            !rel ||
            current.semantic.serviceType !== child ||
            p.semantic.serviceType !== parent ||
            current.semantic.parent?.relationshipType !== rel ||
            edges(rel, undefined, current.id).length !== 1 ||
            exact(rel, p.id, current.id).length !== 1
          )
            return undefined;
          if (parent === "aws.ec2.vpc") result = p.id;
          current = p;
        }
        return text(current, "regionName") === d.provider.region
          ? result
          : undefined;
      };
      const trust = (role: AwsValidationNode) => {
        const a = related("aws.iam.role-owns-trust-policy", role.id, true),
          p = a[0];
        const ss = p
            ? related("aws.iam.policy-contains-statement", p.id, true)
            : [],
          s = ss[0];
        return (
          user(role) &&
          !role.semantic.parent &&
          d.edges.filter(
            (e) =>
              e.semantic.source.nodeId === role.id &&
              e.semantic.source.port === "aws.iam.role.assumable-role",
          ).length === 1 &&
          a.length === 1 &&
          edges("aws.iam.role-owns-trust-policy", undefined, role.id).length ===
            1 &&
          p &&
          user(p) &&
          p.semantic.configuration.schemaId ===
            "aws.iam.policy-document.configuration" &&
          p.semantic.configuration.schemaVersion === "1.0.0" &&
          Object.keys(p.semantic.configuration.values).sort().join(",") ===
            "policyKind,policyName" &&
          p.semantic.parent?.nodeId === role.id &&
          p.semantic.parent.relationshipType ===
            "aws.iam.role-owns-trust-policy" &&
          text(p, "policyKind") === "trust" &&
          ss.length === 1 &&
          edges("aws.iam.policy-contains-statement", undefined, p.id).length ===
            1 &&
          s &&
          user(s) &&
          s.semantic.configuration.schemaId ===
            "aws.iam.policy-statement.configuration" &&
          s.semantic.configuration.schemaVersion === "2.0.0" &&
          Object.keys(s.semantic.configuration.values).sort().join(",") ===
            "actions,effect,principalKind,principals,resourceExpressions,statementId" &&
          configurationValue(
            s.semantic.configuration.values,
            "resourceExpressions",
          )?.kind === "string-list" &&
          s.semantic.parent?.nodeId === p.id &&
          s.semantic.parent.relationshipType ===
            "aws.iam.policy-contains-statement" &&
          text(s, "effect") === "allow" &&
          text(s, "principalKind") === "service" &&
          list(s, "principals").join(",") === "ecs-tasks.amazonaws.com" &&
          list(s, "actions").join(",") === "sts:AssumeRole" &&
          list(s, "resourceExpressions").length === 0 &&
          !configurationValue(
            s.semantic.configuration.values,
            "resourceNode",
          ) &&
          !edges("aws.iam.statement-owns-condition", undefined, s.id).length &&
          !d.edges.some(
            (e) =>
              e.semantic.source.nodeId === s.id &&
              e.semantic.relationshipType.startsWith("aws.iam.authorizes-"),
          )
        );
      };
      for (const n of d.nodes) {
        if (!ecsProperties[n.semantic.serviceType]) continue;
        const type = n.semantic.serviceType;
        if (!user(n) || String(n.semantic.resourceType) !== String(type))
          add(
            n,
            "ownership",
            "Exact user-origin/user-owned resources are required; imported, generated or adopted configurations need separate contracts.",
          );
        if (!schemaValid(n))
          add(
            n,
            "configuration",
            "Supply every reviewed literal field with exact type, bounds, enum and schema; unknown properties and references are rejected.",
          );
        if (
          type === "aws.ecr.image-reference" ||
          type === "aws.ecs.container-definition"
        ) {
          const rel =
              type === "aws.ecr.image-reference"
                ? "aws.ecr.repository-owns-image"
                : "aws.ecs.task-owns-container",
            owner = related(rel, n.id, false);
          if (
            owner.length !== 1 ||
            owner[0]?.id !== n.semantic.parent?.nodeId ||
            n.semantic.parent?.relationshipType !== rel ||
            edges(rel, n.id).length !== 1
          )
            add(
              n,
              "owner",
              "One exact canonical owner edge must match the configuration parent.",
            );
        } else if (n.semantic.parent)
          add(
            n,
            "root",
            "Native ECR/ECS resources require root identities; network placement comes from explicit subnet bindings.",
          );
        if (
          (type === "aws.ecr.repository" ||
            type === "aws.ecs.cluster" ||
            type === "aws.ecs.task-definition") &&
          d.nodes.some(
            (q) =>
              q.id !== n.id &&
              q.semantic.serviceType === type &&
              text(
                q,
                type === "aws.ecs.task-definition" ? "family" : "name",
              ) ===
                text(n, type === "aws.ecs.task-definition" ? "family" : "name"),
          )
        )
          add(
            n,
            "name",
            "Repository/cluster/task family names must be unique within the modeled Region.",
          );
        if (type === "aws.ecs.task-definition") {
          const cpu = scalar(n, "cpu"),
            memory = scalar(n, "memoryMiB");
          if (
            typeof memory !== "number" ||
            !(
              cpu === 256
                ? [512, 1024, 2048]
                : cpu === 512
                  ? [1024, 2048, 3072, 4096]
                  : cpu === 1024
                    ? [2048, 3072, 4096, 5120, 6144, 7168, 8192]
                    : []
            ).includes(memory)
          )
            add(n, "sizing", "Choose an admitted Fargate CPU/memory pair.");
          const containers = related("aws.ecs.task-owns-container", n.id, true);
          if (containers.length !== 1)
            add(
              n,
              "container",
              "One canonical essential container is required.",
            );
          const exec = related("aws.ecs.task-uses-execution-role", n.id, true),
            task = related("aws.ecs.task-uses-application-role", n.id, true);
          if (
            exec.length !== 1 ||
            task.length !== 1 ||
            exec[0]?.id === task[0]?.id ||
            !exec[0] ||
            !task[0] ||
            !trust(exec[0]) ||
            !trust(task[0])
          )
            add(
              n,
              "roles",
              "Use distinct user-owned root execution/task roles, each with one canonical unconditional ECS-tasks-only trust and no borrowed consumer.",
            );
          if (exec[0]) {
            const a = related(
              "aws.iam.role-owns-managed-policy-attachment",
              exec[0].id,
              true,
            );
            if (
              a.length !== 1 ||
              edges("aws.iam.role-owns-managed-policy-attachment", a[0]?.id)
                .length !== 1 ||
              !a[0] ||
              !user(a[0]) ||
              a[0].semantic.parent?.nodeId !== exec[0].id ||
              a[0].semantic.parent.relationshipType !==
                "aws.iam.role-owns-managed-policy-attachment" ||
              text(a[0], "attachmentKind") !== "managed-policy-attachment" ||
              text(a[0], "managedPolicyReference") !==
                "aws-managed:service-role/AmazonECSTaskExecutionRolePolicy"
            )
              add(
                n,
                "execution-policy",
                "Attach the explicit reviewed AmazonECSTaskExecutionRolePolicy managed reference to the execution role. This managed policy is broad and is not a least-privilege claim.",
              );
          }
        }
        if (type === "aws.ecs.container-definition") {
          const image = related("aws.ecs.container-uses-image", n.id, true),
            task = related("aws.ecs.task-owns-container", n.id, false);
          if (
            image.length !== 1 ||
            !image[0] ||
            text(image[0], "architecture") !==
              text(task[0] ?? n, "architecture")
          )
            add(
              n,
              "image",
              "Connect one exact single-platform digest identity matching the task architecture.",
            );
          const logs = related("aws.ecs.container-writes-logs", n.id, false);
          if (
            logs.length !== 1 ||
            !logs[0] ||
            !user(logs[0]) ||
            logs[0].semantic.parent ||
            text(logs[0], "logClass") !== "STANDARD"
          )
            add(
              n,
              "logs",
              "Connect one user-owned root STANDARD AWS-managed-encrypted log group.",
            );
          const names = new Set<string>();
          for (const e of edges(
            "aws.ecs.container-uses-secret",
            undefined,
            n.id,
          )) {
            const values = e.semantic.configuration.values,
              env = literalString(values, "environmentName") ?? "",
              status = literalString(values, "populationStatus"),
              secret = d.nodes.find((q) => q.id === e.semantic.source.nodeId);
            if (
              Object.keys(values).sort().join(",") !==
                "environmentName,populationStatus" ||
              !exact(
                "aws.ecs.container-uses-secret",
                e.semantic.source.nodeId,
                n.id,
              ).includes(e) ||
              !secret ||
              !user(secret) ||
              secret.semantic.parent ||
              text(secret, "encryptionMode") !== "aws-managed" ||
              !/^[A-Z][A-Z0-9_]{0,63}$/u.test(env) ||
              /^(AWS_|ECS_|LD_|NODE_OPTIONS$|PATH$|HOME$|SHELL$|BASH_ENV$|ENV$)/u.test(
                env,
              ) ||
              names.has(env) ||
              ![
                "external-population-required",
                "externally-confirmed",
              ].includes(status ?? "")
            )
              add(
                n,
                "secret",
                "Whole-secret injection requires unique allowed environment names, exact AWS-managed secret bindings and explicit population status.",
              );
            names.add(env);
            const role = task[0]
              ? related("aws.ecs.task-uses-execution-role", task[0].id, true)[0]
              : undefined;
            const authorized =
              secret &&
              role &&
              d.nodes.some((s) => {
                if (
                  s.semantic.serviceType !== "aws.iam.policy-statement" ||
                  !user(s) ||
                  text(s, "effect") !== "allow" ||
                  text(s, "principalKind") !== "none" ||
                  !list(s, "actions").includes("secretsmanager:GetSecretValue")
                )
                  return false;
                const ref = configurationValue(
                    s.semantic.configuration.values,
                    "resourceNode",
                  ),
                  p = d.nodes.find((q) => q.id === s.semantic.parent?.nodeId);
                return (
                  p &&
                  user(p) &&
                  p.semantic.parent?.nodeId === role.id &&
                  p.semantic.parent.relationshipType ===
                    "aws.iam.role-owns-inline-policy" &&
                  text(p, "policyKind") === "identity-inline" &&
                  exact("aws.iam.role-owns-inline-policy", p.id, role.id)
                    .length === 1 &&
                  exact("aws.iam.policy-contains-statement", s.id, p.id)
                    .length === 1 &&
                  ref?.kind === "node-reference" &&
                  ref.nodeId === secret.id &&
                  ref.attribute === "aws.secretsmanager.secret.arn" &&
                  exact("aws.iam.authorizes-secret", s.id, secret.id).length ===
                    1
                );
              });
            if (!authorized)
              add(
                n,
                "secret-read",
                "Execution role needs an explicit canonical GetSecretValue identity policy scoped to each injected secret; task-role access does not substitute.",
              );
          }
        }
        if (type === "aws.ecs.service") {
          const clusters = related("aws.ecs.service-uses-cluster", n.id, true),
            tasks = related("aws.ecs.service-uses-task", n.id, true),
            subnets = related("aws.ecs.service-uses-subnet", n.id, false),
            groups = related(
              "aws.ecs.service-uses-security-group",
              n.id,
              false,
            );
          const firstVpc = subnets[0] ? vpc(subnets[0]) : undefined;
          if (clusters.length !== 1 || tasks.length !== 1)
            add(
              n,
              "dependencies",
              "One exact cluster and task definition are required.",
            );
          if (
            subnets.length < 1 ||
            subnets.length > 16 ||
            groups.length < 1 ||
            groups.length > 5 ||
            !firstVpc ||
            subnets.some((s) => vpc(s) !== firstVpc) ||
            groups.some((g) => vpc(g) !== firstVpc)
          )
            add(
              n,
              "network",
              "Use 1-16 subnets and 1-5 security groups in one canonical regional VPC.",
            );
          if (
            d.nodes.some(
              (q) =>
                q.id !== n.id &&
                q.semantic.serviceType === type &&
                text(q, "name") === text(n, "name") &&
                related("aws.ecs.service-uses-cluster", q.id, true)[0]?.id ===
                  clusters[0]?.id,
            )
          )
            add(
              n,
              "service-name",
              "Service names must be unique within their selected cluster.",
            );
          if (
            typeof scalar(n, "desiredCount") === "number" &&
            Number(scalar(n, "desiredCount")) > 0
          ) {
            const c = tasks[0]
                ? related("aws.ecs.task-owns-container", tasks[0].id, true)[0]
                : undefined,
              image = c
                ? related("aws.ecs.container-uses-image", c.id, true)[0]
                : undefined;
            if (
              !image ||
              text(image, "publicationStatus") !== "externally-confirmed" ||
              (c &&
                edges("aws.ecs.container-uses-secret", undefined, c.id).some(
                  (e) =>
                    literalString(
                      e.semantic.configuration.values,
                      "populationStatus",
                    ) !== "externally-confirmed",
                ))
            )
              add(
                n,
                "start-readiness",
                "Positive task counts require explicit external publication and secret-population confirmation. Empty repositories/secrets are staged infrastructure.",
              );
          }
        }
        add(
          n,
          "external-readiness",
          "Review actual image existence/digest/platform, nonroot/read-only/health/port behavior, execution/PassRole authority, secrets, deployment/replacement, capacity and private egress externally. No application is generated or verified. Managed policy scope, retained image/log costs and secret restart semantics require review.",
          true,
        );
      }
      for (const b of ecsBindings) {
        const es = edges(b[0]);
        for (const e of es) {
          const n =
            d.nodes.find((q) => q.id === e.semantic.source.nodeId) ??
            d.nodes.find((q) => q.id === e.semantic.target.nodeId);
          if (
            n &&
            (!exact(
              b[0],
              e.semantic.source.nodeId,
              e.semantic.target.nodeId,
            ).includes(e) ||
              es.filter(
                (q) => q.semantic.source.nodeId === e.semantic.source.nodeId,
              ).length > b[5] ||
              es.filter(
                (q) => q.semantic.target.nodeId === e.semantic.target.nodeId,
              ).length > b[6])
          )
            add(
              n,
              "binding",
              "Use exact typed endpoints, versioned configuration and bounded connection cardinality.",
            );
        }
      }
      return results;
    },
  });
}
