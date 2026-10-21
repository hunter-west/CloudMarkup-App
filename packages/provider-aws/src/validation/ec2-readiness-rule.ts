import type { ValidationFindingCandidate } from "@cloudmarkup/domain";
import {
  ec2InstanceProperties,
  ec2InstanceTypes,
} from "../catalog/services/ec2-compute.js";
import { ec2ReadinessValidationRuleDescriptor as descriptor } from "../catalog/validation-rules/ec2-readiness.js";
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
export function createEc2ReadinessRuleV1(catalog: AwsValidationCatalogV1) {
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const d = context.document;
      if (!d) return [];
      const result: ValidationFindingCandidate[] = [];
      const text = (n: AwsValidationNode, key: string) =>
        literalString(n.semantic.configuration.values, key);
      const scalar = (n: AwsValidationNode, key: string) => {
        const v = configurationValue(n.semantic.configuration.values, key);
        return v &&
          ["string", "integer", "boolean"].includes(v.kind) &&
          "value" in v
          ? v.value
          : undefined;
      };
      const list = (n: AwsValidationNode, key: string) => {
        const v = configurationValue(n.semantic.configuration.values, key);
        return v?.kind === "string-list" ? v.value : [];
      };
      const owned = (n: AwsValidationNode) =>
        n.semantic.lifecycle.ownership === "user" &&
        n.semantic.lifecycle.origin === "user";
      const add = (
        n: AwsValidationNode,
        code: string,
        message: string,
        property?: string,
        severity: "security-error" | "warning" = "security-error",
      ) => {
        const index = d.nodes.indexOf(n);
        result.push(
          finding(descriptor, {
            code:
              "aws.validation.ec2-" +
              code.replace(
                /[A-Z]/gu,
                (character) => "-" + character.toLowerCase(),
              ),
            severity,
            title:
              severity === "warning"
                ? "Review external EC2 readiness"
                : "Correct EC2 launch configuration",
            beginnerExplanation: message,
            technicalExplanation: message,
            affected: [
              property
                ? nodeConfigurationLocation(n, index, property)
                : nodeLocation(n, index),
            ],
          }),
        );
      };
      const edges = (rel: string, source?: string, target?: string) =>
        d.edges.filter(
          (e) =>
            e.semantic.relationshipType === rel &&
            (source === undefined || e.semantic.source.nodeId === source) &&
            (target === undefined || e.semantic.target.nodeId === target),
        );
      const exact = (rel: string, source?: string, target?: string) =>
        edges(rel, source, target).filter((e) => {
          const rule = catalog.connectionRules.find(
            (r) => r.relationshipType === rel,
          );
          if (!rule) return false;
          return (
            e.semantic.source.port === rule.source.portId &&
            e.semantic.target.port === rule.target.portId &&
            e.semantic.configuration.schemaId === rule.configuration.schemaId &&
            e.semantic.configuration.schemaVersion ===
              rule.configuration.schemaVersion &&
            Object.keys(e.semantic.configuration.values).length === 0 &&
            d.nodes.find((n) => n.id === e.semantic.source.nodeId)?.semantic
              .serviceType === rule.source.serviceId &&
            d.nodes.find((n) => n.id === e.semantic.target.nodeId)?.semantic
              .serviceType === rule.target.serviceId
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
      const ancestryVpc = (n: AwsValidationNode): string | undefined => {
        const chain = [
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
        ] as const;
        let current = n;
        let vpc: string | undefined;
        for (const [childType, parentType, rel] of chain) {
          const parent = d.nodes.find(
            (candidate) => candidate.id === current.semantic.parent?.nodeId,
          );
          if (
            current.semantic.serviceType !== childType ||
            parent?.semantic.serviceType !== parentType ||
            current.semantic.parent?.relationshipType !== rel ||
            edges(rel, undefined, current.id).length !== 1 ||
            exact(rel, parent.id, current.id).length !== 1
          )
            return undefined;
          if (parentType === "aws.ec2.vpc") vpc = parent.id;
          current = parent;
        }
        return text(current, "regionName") === d.provider.region
          ? vpc
          : undefined;
      };
      for (const n of d.nodes) {
        if (
          !["aws.ec2.instance", "aws.iam.instance-profile"].includes(
            n.semantic.serviceType,
          )
        )
          continue;
        const values = n.semantic.configuration.values;
        if (
          n.semantic.configuration.schemaId !==
            n.semantic.serviceType + ".configuration" ||
          n.semantic.configuration.schemaVersion !== "1.0.0"
        )
          add(
            n,
            "schema",
            "Use the exact reviewed configuration schema and version.",
          );
        if (
          !owned(n) ||
          n.semantic.parent ||
          String(n.semantic.resourceType) !== String(n.semantic.serviceType)
        )
          add(
            n,
            "ownership",
            "This slice requires exact user-owned root instance/profile identities. Imported, generated, adopted and reference-only ownership need separate reviewed contracts.",
          );
        if (n.semantic.serviceType === "aws.iam.instance-profile") {
          const name = text(n, "name");
          if (
            !name ||
            !/^[A-Za-z0-9+=,.@_-]{1,128}$/u.test(name) ||
            text(n, "path") !== "/" ||
            Object.keys(values).sort().join(",") !== "name,path"
          )
            add(
              n,
              "profile-config",
              "Use an explicit 1-128 character IAM profile name and the reviewed root path. No role ARN, arbitrary path or unreviewed properties are accepted.",
              "name",
            );
          if (
            d.nodes.some(
              (other) =>
                other.id !== n.id &&
                other.semantic.serviceType === n.semantic.serviceType &&
                text(other, "name") === name,
            )
          )
            add(
              n,
              "profile-name",
              "Profile names must be unique account-wide; two modeled profiles cannot share one name.",
              "name",
            );
          const roles = related(
            "aws.iam.role-binds-instance-profile",
            n.id,
            true,
          );
          if (
            roles.length !== 1 ||
            edges("aws.iam.role-binds-instance-profile", undefined, n.id)
              .length !== 1 ||
            !roles[0] ||
            !owned(roles[0]) ||
            roles[0].semantic.parent
          )
            add(
              n,
              "profile-role",
              "Connect exactly one user-owned IAM role through the exact role/profile binding.",
            );
          else {
            const role = roles[0];
            const trusts = related(
              "aws.iam.role-owns-trust-policy",
              role.id,
              true,
            );
            const trust = trusts[0];
            const statements = trust
              ? related("aws.iam.policy-contains-statement", trust.id, true)
              : [];
            const s = statements[0];
            if (
              trusts.length !== 1 ||
              edges("aws.iam.role-owns-trust-policy", undefined, role.id)
                .length !== 1 ||
              d.edges.filter(
                (e) =>
                  e.semantic.source.nodeId === role.id &&
                  e.semantic.source.port === "aws.iam.role.assumable-role",
              ).length !== 1 ||
              !trust ||
              !owned(trust) ||
              text(trust, "policyKind") !== "trust" ||
              trust.semantic.parent?.nodeId !== role.id ||
              trust.semantic.parent.relationshipType !==
                "aws.iam.role-owns-trust-policy" ||
              statements.length !== 1 ||
              edges("aws.iam.policy-contains-statement", undefined, trust.id)
                .length !== 1 ||
              !s ||
              !owned(s) ||
              s.semantic.parent?.nodeId !== trust.id ||
              s.semantic.parent.relationshipType !==
                "aws.iam.policy-contains-statement" ||
              text(s, "effect") !== "allow" ||
              text(s, "principalKind") !== "service" ||
              list(s, "principals").join(",") !== "ec2.amazonaws.com" ||
              list(s, "actions").join(",") !== "sts:AssumeRole" ||
              configurationValue(
                s.semantic.configuration.values,
                "resourceExpressions",
              )?.kind !== "string-list" ||
              list(s, "resourceExpressions").length !== 0 ||
              configurationValue(
                s.semantic.configuration.values,
                "resourceNode",
              ) !== undefined ||
              edges("aws.iam.statement-owns-condition", undefined, s.id)
                .length !== 0 ||
              d.edges.some(
                (e) =>
                  e.semantic.source.nodeId === s.id &&
                  e.semantic.relationshipType.startsWith("aws.iam.authorizes-"),
              )
            )
              add(
                n,
                "trust",
                "The profile role needs one canonical user-owned unconditional EC2 service trust statement, with only sts:AssumeRole and no resource scope or inferred permissions.",
              );
          }
          add(
            n,
            "profile-authority",
            "Offline export cannot establish account-wide name availability, IAM propagation, deploying-caller creation or iam:PassRole authority. Review these externally before execution.",
            undefined,
            "warning",
          );
          continue;
        }
        for (const [key, schema] of Object.entries(ec2InstanceProperties)) {
          const v = configurationValue(values, key);
          const expected = schema.type === "integer" ? "integer" : schema.type;
          const value = scalar(n, key);
          if (
            v?.kind !== expected ||
            ("const" in schema && value !== schema.const) ||
            ("enum" in schema &&
              schema.enum !== undefined &&
              !(schema.enum as readonly unknown[]).includes(value))
          )
            add(
              n,
              "field-" + key,
              "Supply the exact reviewed literal field; this launch variant rejects omitted, reference-valued or unsupported mode settings.",
              key,
            );
        }
        if (Object.keys(values).some((key) => !(key in ec2InstanceProperties)))
          add(
            n,
            "unsupported-field",
            "No unreviewed launch properties, user data, bootstrap code, credentials or alternate storage ownership can be exported.",
          );
        if (!/^ami-[0-9a-f]{17}$/u.test(text(n, "imageId") ?? ""))
          add(
            n,
            "image-id",
            "Provide an exact static regional AMI ID. Live lookup, latest, parameter resolution and guessed image identities are unsupported.",
            "imageId",
          );
        if (text(n, "imageRegion") !== d.provider.region)
          add(
            n,
            "image-region",
            "Declared AMI Region must match the immutable architecture export Region.",
            "imageRegion",
          );
        const machine = text(n, "instanceType");
        if (
          !ec2InstanceTypes.includes(
            machine as (typeof ec2InstanceTypes)[number],
          ) ||
          text(n, "imageArchitecture") !==
            (machine?.startsWith("t4g.") ? "arm64" : "x86_64")
        )
          add(
            n,
            "image-type",
            "Choose an admitted T3/x86_64 or T4g/arm64 pair and supply externally verified image compatibility.",
            "imageArchitecture",
          );
        if (
          !["/dev/xvda", "/dev/sda1"].includes(
            text(n, "imageRootDeviceName") ?? "",
          )
        )
          add(
            n,
            "root-device",
            "Supply the actual reviewed AMI root device from the supported mappings; never infer it from the operating system label.",
            "imageRootDeviceName",
          );
        const size = scalar(n, "rootSizeGiB"),
          minimum = scalar(n, "imageRootMinimumGiB"),
          hop = scalar(n, "metadataHopLimit");
        if (
          typeof size !== "number" ||
          typeof minimum !== "number" ||
          !Number.isInteger(size) ||
          !Number.isInteger(minimum) ||
          size < minimum ||
          minimum < 1 ||
          size > 16384 ||
          minimum > 16384
        )
          add(
            n,
            "root-size",
            "Root size must be a whole 1-16384 GiB value at least as large as the declared AMI root snapshot minimum.",
            "rootSizeGiB",
          );
        if (
          typeof hop !== "number" ||
          !Number.isInteger(hop) ||
          hop < 1 ||
          hop > 64
        )
          add(
            n,
            "metadata-hop",
            "Metadata token hop limit must be a whole value from 1 to 64; the security baseline is 1.",
            "metadataHopLimit",
          );
        const subnets = related("aws.ec2.instance-uses-subnet", n.id, false),
          subnet = subnets[0];
        const groups = related(
          "aws.ec2.instance-uses-security-group",
          n.id,
          false,
        );
        const vpc = subnet ? ancestryVpc(subnet) : undefined;
        if (
          subnets.length !== 1 ||
          edges("aws.ec2.instance-uses-subnet", n.id).length !== 1 ||
          !subnet ||
          !vpc
        )
          add(
            n,
            "subnet",
            "Connect one exact modeled subnet with canonical Availability Zone/VPC ancestry. Placement is derived from that subnet.",
          );
        if (
          groups.length < 1 ||
          groups.length > 5 ||
          groups.length !==
            edges("aws.ec2.instance-uses-security-group", n.id).length ||
          groups.some(
            (g) =>
              related("aws.ec2.vpc-associates-security-group", g.id, true)[0]
                ?.id !== vpc ||
              related("aws.ec2.vpc-associates-security-group", g.id, true)
                .length !== 1 ||
              edges("aws.ec2.vpc-associates-security-group", undefined, g.id)
                .length !== 1,
          )
        )
          add(
            n,
            "security-groups",
            "Connect one to five exact security groups, each associated with the same VPC as the selected subnet. No ingress/egress rules are inferred.",
          );
        if (
          related("aws.iam.instance-profile-supplies-instance", n.id, true)
            .length !== 1 ||
          edges("aws.iam.instance-profile-supplies-instance", undefined, n.id)
            .length !== 1
        )
          add(
            n,
            "instance-profile",
            "Connect one real typed instance profile, not a role ARN or pasted name.",
          );
        const keys = related("aws.kms.encrypts-instance-root", n.id, true),
          mode = text(n, "rootEncryptionMode");
        const key = keys[0];
        if (
          (mode === "default-key" &&
            edges("aws.kms.encrypts-instance-root", undefined, n.id).length !==
              0) ||
          (mode === "customer-managed" &&
            (keys.length !== 1 ||
              edges("aws.kms.encrypts-instance-root", undefined, n.id)
                .length !== 1 ||
              !key ||
              scalar(key, "enabled") !== true)) ||
          !["default-key", "customer-managed"].includes(mode ?? "")
        )
          add(
            n,
            "root-key",
            "Select the EBS account default key or exactly one explicit enabled regional customer-managed KMS key. A key connection grants no usage permissions.",
            "rootEncryptionMode",
          );
        if (hop !== 1)
          add(
            n,
            "metadata-exposure",
            "The token hop limit exceeds the security baseline of 1. Review the required metadata reach before external execution.",
            "metadataHopLimit",
            "warning",
          );
        add(
          n,
          "image-external",
          "Image existence, launch/snapshot/key permissions, actual Region/architecture/boot/root mapping, root-only declaration and workload capacity are caller-supplied external evidence. Export never contacts AWS or proves a deployable image.",
          undefined,
          "warning",
        );
        add(
          n,
          "launch-external",
          "Private networking and a profile are configuration intent, not a running application. Review deployment/PassRole/key authority, traffic/egress, replacement effects and retained-disk recovery/cost externally; no bootstrap or grants are generated.",
          undefined,
          "warning",
        );
      }
      return result;
    },
  });
}
