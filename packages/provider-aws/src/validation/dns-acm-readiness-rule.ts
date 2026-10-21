import type { ValidationFindingCandidate } from "@cloudmarkup/domain";
import { dnsProperties, dnsBindings } from "../catalog/services/dns-acm.js";
import { dnsReadinessValidationRuleDescriptor as descriptor } from "../catalog/validation-rules/dns-acm-readiness.js";
import {
  configurationValue,
  defineAwsValidationRuleV1,
  finding,
  literalString,
  nodeLocation,
  type AwsValidationCatalogV1,
  type AwsValidationNode,
} from "./rule-helpers.js";

export function createDnsReadinessRuleV1(catalog: AwsValidationCatalogV1) {
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const d = context.document;
      if (!d) return [];
      const results: ValidationFindingCandidate[] = [];
      const text = (n: AwsValidationNode, key: string) =>
        literalString(n.semantic.configuration.values, key);
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
            code: "aws.validation.dns-" + code,
            severity: warning ? "warning" : "security-error",
            title: warning
              ? "Review external DNS and certificate readiness"
              : "Correct DNS/certificate intent",
            beginnerExplanation: message,
            technicalExplanation: message,
            affected: [nodeLocation(n, d.nodes.indexOf(n))],
          }),
        );
      const exactFields = (n: AwsValidationNode) => {
        const schema = dnsProperties[n.semantic.serviceType];
        if (!schema) return false;
        const values = n.semantic.configuration.values,
          keys = Object.keys(schema);
        if (
          n.semantic.configuration.schemaId !==
            n.semantic.serviceType + ".configuration" ||
          n.semantic.configuration.schemaVersion !== "1.0.0" ||
          Object.keys(values).length !== keys.length
        )
          return false;
        return keys.every((key) => {
          const s = schema[key];
          const v = configurationValue(values, key);
          if (!s || v?.kind !== s.type || !("value" in v)) return false;
          const raw = v.value;
          if (
            s.type === "string" &&
            (typeof raw !== "string" ||
              (s.minLength !== undefined && raw.length < s.minLength) ||
              (s.maxLength !== undefined && raw.length > s.maxLength) ||
              (s.pattern !== undefined &&
                !new RegExp(s.pattern, "u").test(raw)))
          )
            return false;
          return (
            (!("enum" in s) ||
              !s.enum ||
              s.enum.some((value) => value === raw)) &&
            (!("const" in s) || raw === s.const)
          );
        });
      };
      const zones = d.nodes.filter(
        (n) => n.semantic.serviceType === "aws.route53.public-hosted-zone",
      );
      const covers = (domain: string, zone: string) =>
        domain === zone || domain.endsWith("." + zone);
      for (const n of d.nodes) {
        if (!dnsProperties[n.semantic.serviceType]) continue;
        if (
          !user(n) ||
          n.semantic.parent ||
          String(n.semantic.resourceType) !== String(n.semantic.serviceType)
        )
          add(
            n,
            "ownership",
            "Require exact user-owned root public zones/certificates; generated, adopted, imported, external and private authority are unsupported.",
          );
        if (!exactFields(n))
          add(
            n,
            "configuration",
            "Supply every reviewed literal field, type, enum, domain/Region bound and required domain-control attestation. Unknown fields, references and credential/key material are unsupported.",
          );
        const domain = text(n, "domainName");
        if (
          domain &&
          d.nodes.some(
            (other) =>
              other.id !== n.id &&
              other.semantic.serviceType === n.semantic.serviceType &&
              text(other, "domainName") === domain,
          )
        )
          add(
            n,
            "duplicate-domain",
            "Use one exact domain identity per native zone/certificate namespace in this graph; validation-record ownership cannot overlap.",
          );
        if (n.semantic.serviceType === "aws.acm.public-dns-certificate") {
          const binding = dnsBindings[0],
            edges = d.edges.filter(
              (e) =>
                e.semantic.relationshipType === binding[0] &&
                e.semantic.source.nodeId === n.id,
            );
          const edge = edges[0],
            zone = zones.find((z) => z.id === edge?.semantic.target.nodeId);
          const lifecycle = edge?.semantic.lifecycle;
          const bindingOwned =
            lifecycle &&
            ((lifecycle.ownership === "user" &&
              ["user", "template", "ai-accepted", "migration"].includes(
                lifecycle.origin,
              )) ||
              (lifecycle.ownership === "generated" &&
                lifecycle.origin === "connection-rule" &&
                lifecycle.provenance.generatorKind === "connection-rule" &&
                lifecycle.provenance.generatorId === binding[0] &&
                lifecycle.provenance.generatorVersion === "1.0.0" &&
                lifecycle.provenance.dependentNodeIds.length === 2 &&
                lifecycle.provenance.dependentNodeIds.includes(n.id) &&
                lifecycle.provenance.dependentNodeIds.includes(
                  edge.semantic.target.nodeId,
                ) &&
                lifecycle.provenance.dependentEdgeIds.length === 0));
          const valid =
            edges.length === 1 &&
            edge &&
            zone &&
            user(zone) &&
            exactFields(zone) &&
            !zone.semantic.parent &&
            edge.semantic.source.port === binding[1] + "." + binding[2] &&
            edge.semantic.target.port === binding[3] + "." + binding[4] &&
            edge.semantic.configuration.schemaId ===
              binding[0] + ".connection" &&
            edge.semantic.configuration.schemaVersion === "1.0.0" &&
            Object.keys(edge.semantic.configuration.values).length === 0 &&
            bindingOwned;
          const name = zone ? text(zone, "domainName") : undefined;
          if (
            !valid ||
            !domain ||
            !name ||
            !covers(domain, name) ||
            zones.some(
              (z) =>
                z.id !== zone.id &&
                text(z, "domainName") !== undefined &&
                covers(domain, text(z, "domainName") ?? "") &&
                (text(z, "domainName")?.length ?? 0) > name.length,
            )
          )
            add(
              n,
              "zone-authority",
              "Bind one exact caller-attested public zone containing the certificate domain and use the most-specific modeled authority. External account/zone IDs and registrar delegation are unsupported.",
            );
          const region = text(n, "certificateRegion");
          if (
            region !== d.provider.region ||
            (text(n, "intendedUse") === "cloudfront-viewer" &&
              region !== "us-east-1")
          )
            add(
              n,
              "region",
              "Certificate Region must exactly match this graph; CloudFront viewer intent requires us-east-1. Cross-region aliases or stack orchestration need a separate contract.",
            );
        }
        add(
          n,
          "external-readiness",
          "Domain control is caller-attested. Verify registrar/parent NS delegation, public DNS/CAA/issuer eligibility, existing validation records, deployer authority and exact deployment Region externally. Native validation may remain pending. Protected retained zones/certificates/CNAMEs need external renewal and cleanup review; no DNS change, issuance, consumer TLS or runtime health is proven.",
          true,
        );
      }
      return results;
    },
  });
}
