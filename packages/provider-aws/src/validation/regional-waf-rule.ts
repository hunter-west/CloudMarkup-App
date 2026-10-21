import { resolveAwsCurrentCatalogV1 } from "../current-catalog.js";
import type { ValidationFindingCandidate } from "@cloudmarkup/domain";
import { validateProviderConfigurationV1 } from "@cloudmarkup/provider-sdk";
import {
  finding,
  nodeLocation,
  edgeLocation,
  configurationValue,
  type AwsValidationNode,
  type AwsValidationCatalogV1,
  defineAwsValidationRuleV1,
} from "./rule-helpers.js";
import {
  WAF_WEB_ACL,
  WAF_ASSOCIATION,
  WAF_ALB,
  WAF_OWNER,
  WAF_PROTECTS,
  wafServices,
  wafValidationDescriptor as descriptor,
} from "../catalog/services/regional-waf.js";

export function createRegionalWafReadinessRule(
  catalog: AwsValidationCatalogV1,
) {
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const d = context.document;
      if (!d) return [];
      const findings: ValidationFindingCandidate[] = [];
      const emit = (
        n: AwsValidationNode,
        code: string,
        message: string,
        warning = false,
      ) =>
        findings.push(
          finding(descriptor, {
            code: "aws.validation.waf-" + code,
            severity: warning ? "warning" : "security-error",
            title: warning
              ? "Review WAF traffic readiness"
              : "Correct regional WAF intent",
            beginnerExplanation: message,
            technicalExplanation: message,
            affected: [nodeLocation(n, d.nodes.indexOf(n))],
          }),
        );
      const text = (n: AwsValidationNode, key: string) => {
        const v = configurationValue(n.semantic.configuration.values, key);
        return v?.kind === "string" ? v.value : undefined;
      };
      const integer = (n: AwsValidationNode, key: string) => {
        const v = configurationValue(n.semantic.configuration.values, key);
        return v?.kind === "integer" ? v.value : undefined;
      };
      const safe = (n: AwsValidationNode) =>
        String(n.semantic.serviceType) === String(n.semantic.resourceType) &&
        n.semantic.lifecycle.ownership === "user" &&
        ["user", "template", "ai-accepted", "migration"].includes(
          n.semantic.lifecycle.origin,
        ) &&
        !(
          "externalResources" in d &&
          d.externalResources.resources.some((x) =>
            x.architectureNodeIds.includes(n.id),
          )
        );
      const related = (n: AwsValidationNode, rel: string, incoming = false) =>
        d.edges
          .filter(
            (e) =>
              e.semantic.relationshipType === rel &&
              (incoming
                ? e.semantic.target.nodeId
                : e.semantic.source.nodeId) === n.id,
          )
          .flatMap((e) => {
            const id = incoming
              ? e.semantic.source.nodeId
              : e.semantic.target.nodeId;
            const other = d.nodes.find((x) => x.id === id);
            return other ? [other] : [];
          });
      for (const n of d.nodes) {
        if (![WAF_WEB_ACL, WAF_ASSOCIATION].includes(n.semantic.serviceType))
          continue;
        if (
          d.catalog.id !== catalog.catalog.id ||
          d.catalog.version !== catalog.catalog.version ||
          d.catalog.digest !==
            resolveAwsCurrentCatalogV1().catalog.artifact.digest
        ) {
          emit(
            n,
            "catalog",
            "Use the exact current catalog ID, version and digest.",
          );
          continue;
        }
        if (!safe(n))
          emit(
            n,
            "ownership",
            "Use exact user-owned modeled WAF resources; external, adopted and generated resources are unsupported.",
          );
        const service = wafServices.find(
          (s) => s.id === n.semantic.serviceType,
        );
        if (service === undefined)
          throw new Error("Missing staged WAF definition.");
        const config = n.semantic.configuration;
        if (
          config.schemaId !== service.configuration.schemaId ||
          config.schemaVersion !== "1.0.0" ||
          !validateProviderConfigurationV1(service.configuration, config.values)
            .success
        )
          emit(
            n,
            "configuration",
            "Supply all closed literal WAF fields with reviewed values and bounds.",
          );
        if (n.semantic.serviceType === WAF_WEB_ACL) {
          if (n.semantic.parent !== undefined)
            emit(n, "placement", "The regional Web ACL is a root resource.");
          if (
            text(n, "webAclRegion") !== d.provider.region ||
            /^(?:cn-|us-gov-|us-iso|eu-iso|eusc-)/u.test(d.provider.region)
          )
            emit(
              n,
              "region",
              "The Web ACL and ALB must use this project's commercial AWS Region.",
            );
          if (integer(n, "ratePriority") === integer(n, "managedRulePriority"))
            emit(
              n,
              "priorities",
              "Rate and managed rule priorities must be different; lower values evaluate first.",
            );
          if (related(n, WAF_OWNER, true).length === 0)
            emit(
              n,
              "association",
              "Add at least one owned ALB association to this Web ACL.",
            );
          if (
            d.nodes.some(
              (x) =>
                x.id !== n.id &&
                x.semantic.serviceType === WAF_WEB_ACL &&
                text(x, "name") === text(n, "name"),
            )
          )
            emit(
              n,
              "name",
              "Use distinct Web ACL names in this account and Region.",
            );
          emit(
            n,
            "readiness",
            "Count mode does not block. Test/tune traffic before enforcement; origin-IP rate limits are approximate. AWS vendor-default rules can change independently. Metrics are separate from disabled request logs/sampling; verify regional availability and quotas externally.",
            true,
          );
        } else {
          const owners = related(n, WAF_OWNER),
            albs = related(n, WAF_PROTECTS),
            owner = owners[0],
            alb = albs[0];
          if (
            owners.length !== 1 ||
            owner?.semantic.serviceType !== WAF_WEB_ACL ||
            !safe(owner) ||
            n.semantic.parent?.nodeId !== owner.id ||
            n.semantic.parent.relationshipType !== WAF_OWNER
          )
            emit(
              n,
              "owner",
              "The association's parent and exact owner edge must identify one user-owned regional Web ACL.",
            );
          if (
            albs.length !== 1 ||
            alb?.semantic.serviceType !== WAF_ALB ||
            !safe(alb)
          )
            emit(
              n,
              "target",
              "Associate exactly one modeled ALB; HTTP APIs, CloudFront and other target types are unsupported.",
            );
          if (alb && related(alb, WAF_PROTECTS, true).length !== 1)
            emit(
              n,
              "cardinality",
              "An ALB can have only one Web ACL association across all ACLs.",
            );
        }
      }
      for (const e of d.edges) {
        if (![WAF_OWNER, WAF_PROTECTS].includes(e.semantic.relationshipType))
          continue;
        const target =
          e.semantic.relationshipType === WAF_OWNER ? WAF_WEB_ACL : WAF_ALB;
        const sourceNode = d.nodes.find(
            (n) => n.id === e.semantic.source.nodeId,
          ),
          targetNode = d.nodes.find((n) => n.id === e.semantic.target.nodeId);
        const l = e.semantic.lifecycle;
        const user =
          l.ownership === "user" &&
          ["user", "template", "ai-accepted", "migration"].includes(l.origin);
        const generated =
          l.ownership === "generated" &&
          l.origin === "connection-rule" &&
          l.provenance.generatorKind === "connection-rule" &&
          String(l.provenance.generatorId) ===
            String(e.semantic.relationshipType) &&
          l.provenance.generatorVersion === "1.0.0" &&
          typeof l.provenance.operationId === "string" &&
          l.provenance.operationId.length > 0 &&
          l.provenance.dependentNodeIds.length === 2 &&
          l.provenance.dependentNodeIds.includes(e.semantic.source.nodeId) &&
          l.provenance.dependentNodeIds.includes(e.semantic.target.nodeId) &&
          l.provenance.dependentEdgeIds.length === 0;
        if (
          sourceNode?.semantic.serviceType !== WAF_ASSOCIATION ||
          targetNode?.semantic.serviceType !== target ||
          e.semantic.source.port !==
            WAF_ASSOCIATION + (target === WAF_WEB_ACL ? ".web-acl" : ".alb") ||
          e.semantic.target.port !==
            target + (target === WAF_WEB_ACL ? ".association" : ".waf") ||
          e.semantic.configuration.schemaId !==
            e.semantic.relationshipType + ".connection" ||
          e.semantic.configuration.schemaVersion !== "1.0.0" ||
          Object.keys(e.semantic.configuration.values).length !== 0 ||
          (!user && !generated)
        )
          findings.push(
            finding(descriptor, {
              code: "aws.validation.waf-binding",
              severity: "security-error",
              title: "Correct WAF binding",
              beginnerExplanation:
                "Use exact typed endpoints, empty configuration and canonical association bindings.",
              technicalExplanation:
                "Invalid endpoint, schema or ownership; no inferred ARN or permission is admitted.",
              affected: [edgeLocation(e, d.edges.indexOf(e))],
            }),
          );
      }
      return findings;
    },
  });
}
