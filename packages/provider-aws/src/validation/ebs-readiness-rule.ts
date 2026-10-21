import type { ValidationFindingCandidate } from "@cloudmarkup/domain";
import { ebsProperties, ebsBindings } from "../catalog/services/ebs.js";
import { ebsReadinessValidationRuleDescriptor as descriptor } from "../catalog/validation-rules/ebs-readiness.js";
import {
  configurationValue,
  defineAwsValidationRuleV1,
  finding,
  literalString,
  nodeLocation,
  type AwsValidationCatalogV1,
  type AwsValidationNode,
  type AwsValidationEdge,
} from "./rule-helpers.js";
export function createEbsReadinessRuleV1(catalog: AwsValidationCatalogV1) {
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const d = context.document;
      if (!d) return [];
      const findings: ValidationFindingCandidate[] = [];
      const text = (n: AwsValidationNode, k: string) =>
        literalString(n.semantic.configuration.values, k);
      const external = (n: AwsValidationNode) =>
        "externalResources" in d &&
        d.externalResources.resources.some((r) =>
          r.architectureNodeIds.includes(n.id),
        );
      const user = (n: AwsValidationNode) =>
        n.semantic.lifecycle.ownership === "user" &&
        ["user", "template", "ai-accepted", "migration"].includes(
          n.semantic.lifecycle.origin,
        );
      const emit = (
        n: AwsValidationNode,
        code: string,
        message: string,
        warning = false,
      ) => {
        findings.push(
          finding(descriptor, {
            code: "aws.validation.ebs-" + code,
            severity: warning ? "warning" : "security-error",
            title: warning
              ? "Review external storage readiness"
              : "Correct EBS intent",
            beginnerExplanation: message,
            technicalExplanation: message,
            affected: [nodeLocation(n, d.nodes.indexOf(n))],
          }),
        );
      };
      const exactFields = (n: AwsValidationNode) => {
        const schema = ebsProperties[n.semantic.serviceType];
        if (!schema) return false;
        const v = n.semantic.configuration.values;
        return (
          n.semantic.configuration.schemaId ===
            n.semantic.serviceType + ".configuration" &&
          n.semantic.configuration.schemaVersion === "1.0.0" &&
          Object.keys(v).length === Object.keys(schema).length &&
          Object.entries(schema).every(([k, s]) => {
            const x = configurationValue(v, k);
            if (x?.kind !== s.type || !("value" in x)) return false;
            const raw = x.value;
            if (
              s.type === "string" &&
              (typeof raw !== "string" ||
                (s.minLength !== undefined && raw.length < s.minLength) ||
                (s.maxLength !== undefined && raw.length > s.maxLength) ||
                (s.pattern !== undefined &&
                  !new RegExp(s.pattern, "u").test(raw)))
            )
              return false;
            if (
              s.type === "integer" &&
              (typeof raw !== "number" ||
                !Number.isSafeInteger(raw) ||
                (s.minimum !== undefined && raw < s.minimum) ||
                (s.maximum !== undefined && raw > s.maximum))
            )
              return false;
            return (
              (!("enum" in s) || !s.enum || s.enum.includes(raw as never)) &&
              (!("const" in s) || s.const === undefined || raw === s.const)
            );
          })
        );
      };
      const exactEdge = (e: AwsValidationEdge) => {
        const b = ebsBindings.find((b) => b[0] === e.semantic.relationshipType);
        if (!b) return false;
        const l = e.semantic.lifecycle;
        return (
          d.nodes.some(
            (n) =>
              n.id === e.semantic.source.nodeId &&
              n.semantic.serviceType === b[1] &&
              n.semantic.resourceType === b[1],
          ) &&
          d.nodes.some(
            (n) =>
              n.id === e.semantic.target.nodeId &&
              n.semantic.serviceType === b[3] &&
              n.semantic.resourceType === b[3],
          ) &&
          e.semantic.source.port === b[1] + "." + b[2] &&
          e.semantic.target.port === b[3] + "." + b[4] &&
          e.semantic.configuration.schemaId === b[0] + ".connection" &&
          e.semantic.configuration.schemaVersion === "1.0.0" &&
          Object.keys(e.semantic.configuration.values).length === 0 &&
          ((l.ownership === "user" &&
            ["user", "template", "ai-accepted", "migration"].includes(
              l.origin,
            )) ||
            (l.ownership === "generated" &&
              l.origin === "connection-rule" &&
              l.provenance.generatorKind === "connection-rule" &&
              l.provenance.generatorId === b[0] &&
              l.provenance.generatorVersion === "1.0.0" &&
              l.provenance.operationId.length > 0 &&
              l.provenance.dependentNodeIds.length === 2 &&
              l.provenance.dependentNodeIds.includes(
                e.semantic.source.nodeId,
              ) &&
              l.provenance.dependentNodeIds.includes(
                e.semantic.target.nodeId,
              ) &&
              l.provenance.dependentEdgeIds.length === 0))
        );
      };
      const safe = (n: AwsValidationNode | undefined) =>
        !!n &&
        user(n) &&
        !external(n) &&
        String(n.semantic.resourceType) === String(n.semantic.serviceType);
      const allEdges = (n: AwsValidationNode, rel: string, incoming = false) =>
        d.edges.filter(
          (e) =>
            e.semantic.relationshipType === rel &&
            (incoming ? e.semantic.target.nodeId : e.semantic.source.nodeId) ===
              n.id,
        );
      const support = (e: AwsValidationEdge) => {
        const rule = catalog.connectionRules.find(
            (x) => x.relationshipType === e.semantic.relationshipType,
          ),
          l = e.semantic.lifecycle;
        const source = d.nodes.find((x) => x.id === e.semantic.source.nodeId),
          target = d.nodes.find((x) => x.id === e.semantic.target.nodeId);
        return (
          !!rule &&
          safe(source) &&
          safe(target) &&
          source?.semantic.serviceType === rule.source.serviceId &&
          target?.semantic.serviceType === rule.target.serviceId &&
          e.semantic.source.port === rule.source.portId &&
          e.semantic.target.port === rule.target.portId &&
          e.semantic.configuration.schemaId === rule.configuration.schemaId &&
          e.semantic.configuration.schemaVersion ===
            rule.configuration.schemaVersion &&
          ((l.ownership === "user" &&
            ["user", "template", "ai-accepted", "migration"].includes(
              l.origin,
            )) ||
            (l.ownership === "generated" &&
              l.origin === "connection-rule" &&
              l.provenance.generatorKind === "connection-rule" &&
              String(l.provenance.generatorId) === String(rule.id) &&
              l.provenance.generatorVersion === rule.ruleVersion &&
              l.provenance.operationId.length > 0 &&
              l.provenance.dependentNodeIds.length === 2 &&
              l.provenance.dependentNodeIds.includes(
                e.semantic.source.nodeId,
              ) &&
              l.provenance.dependentNodeIds.includes(
                e.semantic.target.nodeId,
              ) &&
              l.provenance.dependentEdgeIds.length === 0))
        );
      };
      const related = (n: AwsValidationNode, rel: string, incoming = false) =>
        allEdges(n, rel, incoming).flatMap((e) => {
          const x = d.nodes.find(
            (x) =>
              x.id ===
              (incoming ? e.semantic.source.nodeId : e.semantic.target.nodeId),
          );
          return x && support(e) ? [x] : [];
        });
      const one = (
        n: AwsValidationNode | undefined,
        rel: string,
        incoming = false,
      ) => {
        if (!n) return undefined;
        const xs = related(n, rel, incoming);
        return xs.length === 1 ? xs[0] : undefined;
      };
      const parent = (
        n: AwsValidationNode | undefined,
        service: string,
        rel: string,
        incoming = false,
      ) => {
        if (!n) return undefined;
        const p = d.nodes.find((x) => x.id === n.semantic.parent?.nodeId);
        return p &&
          safe(p) &&
          p.semantic.serviceType === service &&
          n.semantic.parent?.relationshipType === rel &&
          one(n, rel, incoming)?.id === p.id
          ? p
          : undefined;
      };
      const az = (n: AwsValidationNode | undefined) =>
        parent(
          n,
          "aws.ec2.availability-zone",
          "aws.ec2.availability-zone-contains-subnet",
          true,
        );
      const isEbs = (n: AwsValidationNode) =>
        Object.hasOwn(ebsProperties, n.semantic.serviceType);
      if (!d.nodes.some(isEbs)) return [];
      for (const e of d.edges) {
        const b = ebsBindings.find((b) => b[0] === e.semantic.relationshipType);
        if (!b) continue;
        const n =
          d.nodes.find((x) => x.id === e.semantic.source.nodeId) ??
          d.nodes.find(isEbs);
        if (
          n &&
          (!exactEdge(e) ||
            allEdges(n, b[0]).length > b[5] ||
            d.edges.filter(
              (x) =>
                x.semantic.relationshipType === b[0] &&
                x.semantic.target.nodeId === e.semantic.target.nodeId,
            ).length > b[6] ||
            d.edges.filter(
              (x) =>
                x.semantic.relationshipType === b[0] &&
                x.semantic.target.nodeId === e.semantic.target.nodeId &&
                x.semantic.source.nodeId === e.semantic.source.nodeId,
            ).length > 1)
        )
          emit(
            n,
            "binding",
            "Require exact closed endpoint ports/schema, bounded cardinality and reviewed connection provenance.",
          );
      }
      for (const n of d.nodes) {
        if (
          (n.semantic.serviceType.startsWith("aws.ec2.") ||
            n.semantic.serviceType === "aws.region.boundary") &&
          !safe(n)
        )
          emit(
            n,
            "network-ownership",
            "EBS networking requires exact modeled user ownership; no external/adopted/generated network dependency.",
          );
      }
      for (const n of d.nodes.filter(isEbs)) {
        if (
          !/^(?:af|ap|ca|eu|il|me|mx|sa|us)-/u.test(d.provider.region) ||
          /^(?:cn-|us-gov-|us-iso|eu-iso|eusc-)/u.test(d.provider.region)
        )
          emit(n, "region", "Use a modeled commercial AWS Region.");
        if (!safe(n))
          emit(
            n,
            "ownership",
            "Require exact user-owned modeled volume/attachment; no imports/adoption/external/generated resource ownership.",
          );
        if (!exactFields(n)) {
          emit(
            n,
            "fields",
            "Provide every exact reviewed literal field; unknown fields, references, alternate modes and out-of-bound values are unsupported.",
          );
          continue;
        }
        if (n.semantic.serviceType === "aws.ebs.volume") {
          const z = parent(
            n,
            "aws.ec2.availability-zone",
            "aws.ebs.availability-zone-contains-volume",
          );
          const v = parent(
            z,
            "aws.ec2.vpc",
            "aws.ec2.vpc-contains-availability-zone",
            true,
          );

          // Existing network readiness supplies the exact Region/zone configuration check.
          if (!z || !v)
            emit(
              n,
              "az",
              "Volume requires one canonical user-owned modeled AZ with exact VPC ancestry; no free-form zone name.",
            );

          const keys = related(n, "aws.ebs.volume-uses-key");
          const key = keys.at(0);
          const mode = text(n, "encryptionMode");
          if (
            mode === "account-default" &&
            allEdges(n, "aws.ebs.volume-uses-key").length !== 0
          )
            emit(
              n,
              "key",
              "Account-default mode omits the native key ID; no selected customer key is allowed.",
            );
          if (
            mode === "customer-managed" &&
            (keys.length !== 1 ||
              !key ||
              !safe(key) ||
              key.semantic.serviceType !== "aws.kms.key" ||
              key.semantic.parent ||
              !(() => {
                const x = configurationValue(
                  key.semantic.configuration.values,
                  "enabled",
                );
                return x?.kind === "boolean" && x.value;
              })())
          )
            emit(
              n,
              "key",
              "Select one enabled exact modeled regional symmetric customer KMS key; authority and grants stay external.",
            );
          const xs = allEdges(n, "aws.ebs.volume-owns-attachment", true);
          if (xs.length > 1)
            emit(
              n,
              "attachment",
              "A gp3 volume supports at most one canonical owned attachment in this profile.",
            );
        } else {
          const volume = parent(
            n,
            "aws.ebs.volume",
            "aws.ebs.volume-owns-attachment",
          );
          const instance = one(n, "aws.ebs.attachment-uses-instance");
          const z = parent(
            volume,
            "aws.ec2.availability-zone",
            "aws.ebs.availability-zone-contains-volume",
          );
          const subnet = one(instance, "aws.ec2.instance-uses-subnet");
          const iz = az(subnet);
          if (
            !volume ||
            !safe(instance) ||
            instance?.semantic.serviceType !== "aws.ec2.instance" ||
            !z ||
            z.id !== iz?.id ||
            text(z, "zoneName") !== text(iz, "zoneName")
          )
            emit(
              n,
              "placement",
              "Canonical volume owner and one existing modeled Linux EC2 instance must use the exact same AZ and Region; volume attachment has no cross-AZ mode.",
            );
          if (instance) {
            const xs = related(
              instance,
              "aws.ebs.attachment-uses-instance",
              true,
            );
            const names = xs.map((x) => text(x, "deviceName"));
            if (
              xs.length > 4 ||
              new Set(names).size !== names.length ||
              text(instance, "imageRootDeviceName") === text(n, "deviceName")
            )
              emit(
                n,
                "device",
                "Use at most four additional devices, distinct /dev/sdf-/dev/sdi per instance, never the AMI root mapping. Nitro guest names remain external.",
              );
          }
        }
        emit(
          n,
          "external",
          "Verify capacity/quotas, exact AZ/account/key and deployer/grant authority, guest NVMe identity and filesystem/mount, termination behavior, backups and safe cleanup separately. Export attaches storage only; it does not format or mount it. TF protection applies while configured and skip_destroy retains attachment; CF retains volume/attachment.",
          true,
        );
      }
      return findings;
    },
  });
}
