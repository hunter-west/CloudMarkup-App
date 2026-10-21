import reservedWords from "../catalog/services/rds-postgres-reserved-v1.json" with { type: "json" };
import type { ValidationFindingCandidate } from "@cloudmarkup/domain";
import {
  auroraProperties,
  auroraBindings,
} from "../catalog/services/aurora-postgres.js";
import { auroraReadinessValidationRuleDescriptor as descriptor } from "../catalog/validation-rules/aurora-postgres-readiness.js";
import {
  configurationValue,
  defineAwsValidationRuleV1,
  finding,
  literalString,
  nodeLocation,
  type AwsValidationCatalogV1,
  type AwsValidationNode,
} from "./rule-helpers.js";
export function createAuroraReadinessRuleV1(catalog: AwsValidationCatalogV1) {
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
      const user = (n: AwsValidationNode) =>
        n.semantic.lifecycle.ownership === "user" &&
        ["user", "template", "ai-accepted", "migration"].includes(
          n.semantic.lifecycle.origin,
        );
      const add = (
        n: AwsValidationNode,
        code: string,
        message: string,
        warning = false,
      ) =>
        results.push(
          finding(descriptor, {
            code: "aws.validation.aurora-" + code,
            severity: warning ? "warning" : "security-error",
            title: warning
              ? "Review external Aurora PostgreSQL readiness"
              : "Correct Aurora PostgreSQL configuration",
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
            Object.keys(e.semantic.configuration.values).length === 0
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
        const props = auroraProperties[n.semantic.serviceType];
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

      const groupVpc = (n: AwsValidationNode) => {
        const subnets = related(
          "aws.rds.subnet-group-uses-subnet",
          n.id,
          false,
        );
        const networks = subnets.map(vpc);
        const zones = subnets.map((s) =>
          d.nodes.find((a) => a.id === s.semantic.parent?.nodeId),
        );
        return subnets.length >= 2 &&
          subnets.length <= 16 &&
          edges("aws.rds.subnet-group-uses-subnet", n.id).length ===
            subnets.length &&
          new Set(subnets.map((s) => s.id)).size === subnets.length &&
          networks[0] !== undefined &&
          networks.every((v) => v === networks[0]) &&
          new Set(zones.map((z) => z?.id)).size >= 2 &&
          zones.every(
            (z) =>
              z !== undefined &&
              text(z, "zoneName")?.startsWith(d.provider.region) &&
              /^[a-z]$/u.test(
                text(z, "zoneName")?.slice(d.provider.region.length) ?? "",
              ),
          ) &&
          new Set(zones.map((z) => (z ? text(z, "zoneName") : undefined)))
            .size >= 2
          ? networks[0]
          : undefined;
      };
      const minutes = (s: string) =>
        Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
      for (const n of d.nodes) {
        const type = n.semantic.serviceType;
        if (!auroraProperties[type]) continue;
        if (
          !user(n) ||
          String(n.semantic.resourceType) !== String(type) ||
          n.semantic.parent
        )
          add(
            n,
            "ownership",
            "Exact reviewed user-owned root identities are required; imports, generated or adopted resources are unsupported.",
          );
        if (!schemaValid(n))
          add(
            n,
            "configuration",
            "Supply every exact reviewed literal field, schema, type, enum and bound. Unknown properties, passwords and references are rejected.",
          );
        const name = text(
          n,
          type === "aws.aurora.postgresql-cluster-parameter-group"
            ? "name"
            : "identifier",
        );
        if (
          name &&
          d.nodes.some(
            (x) =>
              x.id !== n.id &&
              (x.semantic.serviceType === type ||
                (type === "aws.aurora.postgresql-instance" &&
                  x.semantic.serviceType === "aws.rds.db-instance")) &&
              text(
                x,
                type === "aws.aurora.postgresql-cluster-parameter-group"
                  ? "name"
                  : "identifier",
              ) === name,
          )
        )
          add(
            n,
            "name",
            "Resource names must be unique within this modeled Region and native type.",
          );
        if (
          type === "aws.aurora.postgresql-cluster-parameter-group" &&
          name?.startsWith("default")
        )
          add(
            n,
            "name",
            "Default/reserved native parameter and subnet group names are unsupported.",
          );
        if (type === "aws.aurora.postgresql-cluster") {
          const subnetGroups = related(
              "aws.aurora.cluster-uses-subnet-group",
              n.id,
              true,
            ),
            parameters = related(
              "aws.aurora.cluster-uses-parameter-group",
              n.id,
              true,
            ),
            groups = related(
              "aws.aurora.cluster-uses-security-group",
              n.id,
              false,
            ),
            network = subnetGroups[0] ? groupVpc(subnetGroups[0]) : undefined;
          if (
            subnetGroups.length !== 1 ||
            parameters.length !== 1 ||
            !network ||
            groups.length < 1 ||
            groups.length > 5 ||
            new Set(groups.map((g) => g.id)).size !== groups.length ||
            groups.some((g) => vpc(g) !== network) ||
            edges("aws.aurora.cluster-uses-subnet-group", undefined, n.id)
              .length !== subnetGroups.length ||
            edges("aws.aurora.cluster-uses-parameter-group", undefined, n.id)
              .length !== parameters.length ||
            edges("aws.aurora.cluster-uses-security-group", n.id).length !==
              groups.length
          )
            add(
              n,
              "dependencies",
              "Bind one exact DB subnet group, one Aurora PostgreSQL 16 cluster TLS parameter group and 1-5 distinct security groups in the same canonical VPC/Region. No ingress or application authority is inferred.",
            );
          const username = text(n, "masterUsername")?.toLowerCase(),
            db = text(n, "databaseName")?.toLowerCase();
          if (
            reservedWords.includes(username ?? "") ||
            reservedWords.includes(db ?? "") ||
            username === "rdsadmin" ||
            username?.startsWith("pg_") ||
            ["rdsadmin", "postgres", "template0", "template1"].includes(
              db ?? "",
            )
          )
            add(
              n,
              "reserved-name",
              "Use an explicit non-system database and master username; reserved PostgreSQL identities are unsupported.",
            );
          const backup = text(n, "backupWindow") ?? "",
            maintenance = text(n, "maintenanceWindow") ?? "";
          const [b0, b1] = backup.split("-"),
            [m0, m1] = maintenance.split("-");
          const sameWeekday = m0?.slice(0, 3) === m1?.slice(0, 3);
          if (!b0 || !b1 || !m0 || !m1 || !sameWeekday)
            add(
              n,
              "windows",
              "Use same-day UTC backup and same-weekday maintenance windows of 30-120 minutes without overlap.",
            );
          else {
            const bs = minutes(b0),
              be = minutes(b1),
              ms = minutes(m0.slice(4)),
              me = minutes(m1.slice(4));
            if (
              [bs, be, ms, me].some((x) => !Number.isFinite(x)) ||
              be - bs < 30 ||
              be - bs > 120 ||
              me - ms < 30 ||
              me - ms > 120 ||
              (bs < me && ms < be)
            )
              add(
                n,
                "windows",
                "Use same-day UTC backup and same-weekday maintenance windows of 30-120 minutes without overlap.",
              );
          }
          const members = related(
            "aws.aurora.cluster-has-instance",
            n.id,
            false,
          );
          const tiers = members.map((member) =>
            scalar(member, "promotionTier"),
          );
          const zones = members.map((member) =>
            text(member, "availabilityZone"),
          );
          if (
            members.length < 1 ||
            members.length > 2 ||
            edges("aws.aurora.cluster-has-instance", n.id).length !==
              members.length ||
            new Set(members.map((member) => member.id)).size !==
              members.length ||
            !tiers.includes(0) ||
            new Set(tiers).size !== members.length ||
            new Set(zones).size !== members.length
          )
            add(
              n,
              "members",
              "Bind one or two exact members, including one tier 0, with distinct failover priorities and declared AZs. Tiers do not promise initial writer identity.",
            );
          if (
            Number(text(n, "minimumCapacityAcus")) >
            Number(text(n, "maximumCapacityAcus"))
          )
            add(
              n,
              "capacity",
              "Maximum reviewed per-member ACUs must be at least the nonzero minimum; auto-pause is unsupported.",
            );
          add(
            n,
            "external-readiness",
            "Export describes private retained Aurora Serverless v2 infrastructure with nonzero compute per member and Aurora Standard storage. Verify actual Region/engine/class/CA/capacity, deployer/service-linked-role authority, managed-secret/TLS/client readiness, backups, maintenance/reboot, writer/failover state and cleanup externally. No pause savings, provisioning or application health is verified.",
            true,
          );
        }
        if (type === "aws.aurora.postgresql-instance") {
          const clusters = related(
            "aws.aurora.cluster-has-instance",
            n.id,
            true,
          );
          const cluster = clusters[0];
          const subnetGroups = cluster
            ? related("aws.aurora.cluster-uses-subnet-group", cluster.id, true)
            : [];
          const group = subnetGroups[0];
          const zones = group
            ? related("aws.rds.subnet-group-uses-subnet", group.id, false)
                .map((subnet) =>
                  d.nodes.find(
                    (zone) => zone.id === subnet.semantic.parent?.nodeId,
                  ),
                )
                .map((zone) => (zone ? text(zone, "zoneName") : undefined))
            : [];
          if (
            clusters.length !== 1 ||
            edges("aws.aurora.cluster-has-instance", undefined, n.id).length !==
              1 ||
            subnetGroups.length !== 1 ||
            !group ||
            !groupVpc(group) ||
            !zones.includes(text(n, "availabilityZone"))
          )
            add(
              n,
              "member-placement",
              "Bind one exact cluster and choose a canonical declared AZ represented in its same-VPC/Region DB subnet group. Engine, credentials, storage and ACU bounds are cluster-owned.",
            );
        }
      }
      for (const b of auroraBindings) {
        for (const e of edges(b[0])) {
          const n =
            d.nodes.find((n) => n.id === e.semantic.source.nodeId) ??
            d.nodes.find((n) => n.id === e.semantic.target.nodeId);
          if (
            n &&
            (!exact(
              b[0],
              e.semantic.source.nodeId,
              e.semantic.target.nodeId,
            ).includes(e) ||
              edges(b[0], e.semantic.source.nodeId).length > b[5] ||
              edges(b[0], undefined, e.semantic.target.nodeId).length > b[6] ||
              edges(b[0], e.semantic.source.nodeId, e.semantic.target.nodeId)
                .length > 1)
          )
            add(
              n,
              "connection",
              "Use exact typed native dependency ports with empty versioned configuration and reviewed cardinality.",
            );
        }
      }
      return results;
    },
  });
}
