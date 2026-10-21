import type { ValidationFindingCandidate } from "@cloudmarkup/domain";
import {
  cloudfrontProperties,
  cloudfrontBindings,
} from "../catalog/services/cloudfront.js";
import { cloudfrontReadinessValidationRuleDescriptor as descriptor } from "../catalog/validation-rules/cloudfront-readiness.js";
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
export function createCloudfrontReadinessRuleV1(
  catalog: AwsValidationCatalogV1,
) {
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const d = context.document;
      if (!d) return [];
      const findings: ValidationFindingCandidate[] = [];
      const text = (n: AwsValidationNode, k: string) =>
        literalString(n.semantic.configuration.values, k);
      const number = (n: AwsValidationNode, k: string) => {
        const v = configurationValue(n.semantic.configuration.values, k);
        return v?.kind === "integer" ? v.value : undefined;
      };
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
            code: "aws.validation.cloudfront-" + code,
            severity: warning ? "warning" : "security-error",
            title: warning
              ? "Review external distribution readiness"
              : "Correct CloudFront intent",
            beginnerExplanation: message,
            technicalExplanation: message,
            affected: [nodeLocation(n, d.nodes.indexOf(n))],
          }),
        );
      };
      const exactFields = (n: AwsValidationNode) => {
        const schema = cloudfrontProperties[n.semantic.serviceType];
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
        const b = cloudfrontBindings.find(
          (b) => b[0] === e.semantic.relationshipType,
        );
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
      const exactSupport = (e: AwsValidationEdge | undefined) => {
        if (!e) return false;
        const rule = catalog.connectionRules.find(
          (r) => r.relationshipType === e.semantic.relationshipType,
        );
        const l = e.semantic.lifecycle;
        return (
          !!rule &&
          e.semantic.source.port === rule.source.portId &&
          e.semantic.target.port === rule.target.portId &&
          e.semantic.configuration.schemaId === rule.configuration.schemaId &&
          e.semantic.configuration.schemaVersion ===
            rule.configuration.schemaVersion &&
          Object.keys(e.semantic.configuration.values).length === 0 &&
          l.ownership === "generated" &&
          l.origin === "connection-rule" &&
          l.provenance.generatorKind === "connection-rule" &&
          l.provenance.generatorId === "aws.cloudfront.reads-s3-origin" &&
          l.provenance.generatorVersion === "1.0.0" &&
          l.provenance.operationId.length > 0 &&
          l.provenance.dependentNodeIds.length === 0 &&
          l.provenance.dependentEdgeIds.length === 1
        );
      };
      for (const e of d.edges) {
        if (
          cloudfrontBindings.some(
            (b) => b[0] === e.semantic.relationshipType,
          ) &&
          !exactEdge(e)
        ) {
          const node =
            d.nodes.find((n) => n.id === e.semantic.source.nodeId) ??
            d.nodes[0];
          if (node)
            emit(
              node,
              "binding",
              "CloudFront bindings require exact endpoint types, ports, closed schema and authorized lifecycle/provenance.",
            );
        }
      }
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
            const other = d.nodes.find(
              (x) =>
                x.id ===
                (incoming
                  ? e.semantic.source.nodeId
                  : e.semantic.target.nodeId),
            );
            return other && exactEdge(e) ? [other] : [];
          });
      const generatedFor = (n: AwsValidationNode, e: AwsValidationEdge) => {
        const l = n.semantic.lifecycle;
        return (
          l.ownership === "generated" &&
          l.origin === "connection-rule" &&
          l.provenance.generatorKind === "connection-rule" &&
          l.provenance.generatorId === "aws.cloudfront.reads-s3-origin" &&
          l.provenance.generatorVersion === "1.0.0" &&
          l.provenance.operationId.length > 0 &&
          l.provenance.dependentEdgeIds.length === 1 &&
          l.provenance.dependentEdgeIds[0] === e.id &&
          l.provenance.dependentNodeIds.length === 0 &&
          (e.semantic.lifecycle.ownership !== "generated" ||
            l.provenance.operationId ===
              e.semantic.lifecycle.provenance.operationId)
        );
      };
      for (const n of d.nodes) {
        if (!cloudfrontProperties[n.semantic.serviceType]) continue;
        if (
          !user(n) ||
          external(n) ||
          String(n.semantic.resourceType) !== String(n.semantic.serviceType)
        )
          emit(
            n,
            "ownership",
            "Use exact user-owned distribution/cache/alias resources; generated, adopted or external resource ownership is unsupported.",
          );
        if (!exactFields(n))
          emit(
            n,
            "configuration",
            "Supply every exact reviewed literal field and required attestation; unknown fields, references and unsupported values fail closed.",
          );
        if (
          n.semantic.serviceType !== "aws.cloudfront.alias-configuration" &&
          n.semantic.parent
        )
          emit(
            n,
            "placement",
            "Distribution and cache policy must be user-owned roots.",
          );
        if (
          !/^(?:af|ap|ca|eu|il|me|mx|sa|us)-/u.test(d.provider.region) ||
          /^(?:cn-|us-gov-|us-iso|eu-iso|eusc-)/u.test(d.provider.region)
        )
          emit(
            n,
            "partition",
            "This slice models the commercial AWS partition only; other partitions need native contracts.",
          );
        if (n.semantic.serviceType === "aws.cloudfront.cache-policy") {
          if (
            (number(n, "defaultTtl") ?? Infinity) > (number(n, "maxTtl") ?? -1)
          )
            emit(
              n,
              "ttl-order",
              "Cache fallback TTL must not exceed maximum TTL; minimum TTL stays zero.",
            );
          if (
            d.nodes.some(
              (x) =>
                x.id !== n.id &&
                x.semantic.serviceType === n.semantic.serviceType &&
                text(x, "name") === text(n, "name"),
            )
          )
            emit(
              n,
              "duplicate-cache",
              "Cache policy names must be unique in this modeled account namespace.",
            );
        }
        if (n.semantic.serviceType === "aws.cloudfront.distribution") {
          const origins = related(n, "aws.cloudfront.reads-s3-origin"),
            caches = related(n, "aws.cloudfront.uses-cache-policy"),
            aliases = related(
              n,
              "aws.cloudfront.distribution-owns-alias",
              true,
            );
          const bucket = origins[0],
            cache = caches[0];
          if (
            origins.length !== 1 ||
            bucket?.semantic.serviceType !== "aws.s3.bucket" ||
            !user(bucket) ||
            external(bucket) ||
            bucket.semantic.parent ||
            d.edges.filter(
              (e) =>
                e.semantic.relationshipType ===
                  "aws.cloudfront.reads-s3-origin" &&
                e.semantic.target.nodeId === bucket.id,
            ).length !== 1
          )
            emit(
              n,
              "origin",
              "Bind one dedicated user-owned private S3 REST bucket; shared, website, dynamic and external origins are unsupported.",
            );
          if (
            caches.length !== 1 ||
            cache?.semantic.serviceType !== "aws.cloudfront.cache-policy" ||
            !user(cache) ||
            !exactFields(cache) ||
            cache.semantic.parent
          )
            emit(
              n,
              "cache",
              "Bind one exact user-owned bounded static cache policy.",
            );
          if (
            (text(n, "viewerCertificateMode") === "default" &&
              aliases.length !== 0) ||
            (text(n, "viewerCertificateMode") === "acm-alias" &&
              aliases.length !== 1)
          )
            emit(
              n,
              "viewer-mode",
              "Default viewer mode has no alias; ACM mode requires one exact owned alias.",
            );
          if (bucket) {
            const origin = d.edges.find(
              (e) =>
                e.semantic.relationshipType ===
                  "aws.cloudfront.reads-s3-origin" &&
                e.semantic.source.nodeId === n.id,
            );
            const owners = d.edges.filter(
              (e) =>
                e.semantic.relationshipType ===
                  "aws.s3.bucket-owns-resource-policy" &&
                e.semantic.target.nodeId === bucket.id,
            );
            const policy = d.nodes.find(
                (x) => x.id === owners[0]?.semantic.source.nodeId,
              ),
              membership = policy
                ? d.edges.filter(
                    (e) =>
                      e.semantic.relationshipType ===
                        "aws.iam.policy-contains-statement" &&
                      e.semantic.target.nodeId === policy.id,
                  )
                : [],
              statement = d.nodes.find(
                (x) => x.id === membership[0]?.semantic.source.nodeId,
              );
            const list = (k: string) => {
              const v = statement
                ? configurationValue(statement.semantic.configuration.values, k)
                : undefined;
              return v?.kind === "string-list" ? v.value : undefined;
            };
            const scopes = statement
              ? d.edges.filter(
                  (e) =>
                    e.semantic.relationshipType ===
                      "aws.iam.authorizes-s3-bucket" &&
                    e.semantic.source.nodeId === statement.id,
                )
              : [];
            const ref = statement
              ? configurationValue(
                  statement.semantic.configuration.values,
                  "resourceNode",
                )
              : undefined;
            const policyOperation =
              policy?.semantic.lifecycle.ownership === "generated"
                ? policy.semantic.lifecycle.provenance.operationId
                : undefined;
            const privateFields = [
              ["blockPublicAccess", true],
              ["versioningEnabled", true],
              ["deletionProtectionEnabled", true],
              ["objectOwnership", "BUCKET_OWNER_ENFORCED"],
              ["encryption", "SSE-S3"],
            ] as const;
            if (
              privateFields.some(([k, v]) => {
                const x = configurationValue(
                  bucket.semantic.configuration.values,
                  k,
                );
                return !x || !("value" in x) || x.value !== v;
              })
            )
              emit(
                n,
                "private-origin",
                "Origin must retain public-access blocking, enforced ownership, SSE-S3, versioning and deletion protection.",
              );
            if (
              !origin ||
              !exactSupport(owners[0]) ||
              !exactSupport(membership[0]) ||
              !exactSupport(scopes[0]) ||
              [owners[0], membership[0], scopes[0]].some(
                (e) =>
                  e?.semantic.lifecycle.ownership !== "generated" ||
                  e.semantic.lifecycle.provenance.dependentEdgeIds[0] !==
                    origin.id,
              ) ||
              policy?.semantic.serviceType !== "aws.iam.policy-document" ||
              statement?.semantic.serviceType !== "aws.iam.policy-statement" ||
              owners.length !== 1 ||
              policy.semantic.resourceType !== "aws.iam.policy-document" ||
              statement.semantic.resourceType !== "aws.iam.policy-statement" ||
              policy.semantic.configuration.schemaId !==
                "aws.iam.policy-document.configuration" ||
              policy.semantic.configuration.schemaVersion !== "1.0.0" ||
              Object.keys(policy.semantic.configuration.values)
                .sort()
                .join() !== "policyKind,policyName" ||
              statement.semantic.configuration.schemaId !==
                "aws.iam.policy-statement.configuration" ||
              statement.semantic.configuration.schemaVersion !== "2.0.0" ||
              Object.keys(statement.semantic.configuration.values)
                .sort()
                .join() !==
                "actions,effect,principalKind,principals,resourceExpressions,resourceNode,statementId" ||
              (policy.semantic.lifecycle.ownership === "generated" &&
                statement.semantic.lifecycle.ownership === "generated" &&
                (policy.semantic.lifecycle.provenance.operationId !==
                  statement.semantic.lifecycle.provenance.operationId ||
                  [owners[0], membership[0], scopes[0]].some(
                    (e) =>
                      e?.semantic.lifecycle.ownership !== "generated" ||
                      e.semantic.lifecycle.provenance.operationId !==
                        policyOperation,
                  ))) ||
              membership.length !== 1 ||
              !generatedFor(policy, origin) ||
              !generatedFor(statement, origin) ||
              text(policy, "policyKind") !== "resource" ||
              policy.semantic.parent?.nodeId !== bucket.id ||
              policy.semantic.parent.relationshipType !==
                "aws.s3.bucket-owns-resource-policy" ||
              statement.semantic.parent?.nodeId !== policy.id ||
              statement.semantic.parent.relationshipType !==
                "aws.iam.policy-contains-statement" ||
              text(statement, "effect") !== "allow" ||
              text(statement, "principalKind") !== "service" ||
              list("actions")?.join() !== "s3:GetObject" ||
              list("principals")?.join() !== "cloudfront.amazonaws.com" ||
              list("resourceExpressions")?.length !== 0 ||
              scopes.length !== 1 ||
              scopes[0]?.semantic.target.nodeId !== bucket.id ||
              ref?.kind !== "node-reference" ||
              ref.nodeId !== bucket.id ||
              ref.attribute !== "aws.s3.bucket.arn" ||
              d.edges.some(
                (e) =>
                  e.semantic.relationshipType ===
                    "aws.iam.statement-owns-condition" &&
                  e.semantic.target.nodeId === statement.id,
              )
            )
              emit(
                n,
                "origin-policy",
                "Require the exact provenance-bound generated read-only bucket policy, scope and owner membership. SourceArn derives only from this distribution. Custom/adopted/extra actions, conditions, scopes and policy merges are unsupported.",
              );
          }
        }
        if (n.semantic.serviceType === "aws.cloudfront.alias-configuration") {
          const owner = related(n, "aws.cloudfront.distribution-owns-alias"),
            certs = related(n, "aws.cloudfront.alias-uses-certificate"),
            dist = owner[0],
            cert = certs[0];
          if (
            owner.length !== 1 ||
            dist?.semantic.serviceType !== "aws.cloudfront.distribution" ||
            !user(dist) ||
            n.semantic.parent?.nodeId !== dist.id ||
            n.semantic.parent.relationshipType !==
              "aws.cloudfront.distribution-owns-alias" ||
            text(dist, "viewerCertificateMode") !== "acm-alias"
          )
            emit(
              n,
              "alias-owner",
              "One canonical alias parent and exact owner edge must bind the same ACM-mode distribution.",
            );
          if (
            certs.length !== 1 ||
            cert?.semantic.serviceType !== "aws.acm.public-dns-certificate" ||
            !user(cert) ||
            external(cert) ||
            text(cert, "intendedUse") !== "cloudfront-viewer" ||
            text(cert, "certificateRegion") !== "us-east-1" ||
            d.provider.region !== "us-east-1" ||
            text(cert, "domainName") !== text(n, "domainName")
          )
            emit(
              n,
              "alias-certificate",
              "Alias must exactly match one public single-domain CloudFront-viewer ACM certificate in this us-east-1 graph; no wildcard/SAN/import/cross-region inference.",
            );
          if (
            d.nodes.some(
              (x) =>
                x.id !== n.id &&
                x.semantic.serviceType === n.semantic.serviceType &&
                text(x, "domainName") === text(n, "domainName"),
            )
          )
            emit(
              n,
              "duplicate-alias",
              "Each exact modeled viewer alias has one owner; existing external alias exclusivity must be checked separately.",
            );
        }
        emit(
          n,
          "external-readiness",
          "Public content is caller-attested. Verify objects, freshness headers, alias exclusivity/delegation, certificate eligibility/issuance/renewal, quotas, deployment Region and authority externally. OAC protects origin access, not viewers. Retained serving/access and deliberate cleanup remain external; no upload, invalidation, live DNS or TLS/serving health is proven.",
          true,
        );
      }
      return findings;
    },
  });
}
