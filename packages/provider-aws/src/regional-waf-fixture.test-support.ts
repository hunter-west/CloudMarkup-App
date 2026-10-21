import { awsCatalogArtifactV1 } from "./catalog-v1-accessors.js";
import {
  applyGraphCommand,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import type { ProviderCatalogArtifactV1 } from "@cloudmarkup/provider-sdk";
import { elbFixture } from "./elb-fixture.test-support.js";
import { awsConnectionResolverV1 } from "./connection-resolution.js";
import {
  wafProperties,
  WAF_WEB_ACL,
  WAF_ASSOCIATION,
  WAF_OWNER,
  WAF_PROTECTS,
} from "./catalog/services/regional-waf.js";

export function regionalWafResolver(catalog: ProviderCatalogArtifactV1) {
  if (catalog.digest !== awsCatalogArtifactV1.digest)
    throw Error("Exact current WAF catalog required");
  return awsConnectionResolverV1;
}
export function regionalWafFixture(catalog: ProviderCatalogArtifactV1) {
  const template = elbFixture(false, true);
  // A new synthetic candidate revision; no saved/user revision is upgraded.
  let d = parseArchitectureDocument({
    ...template,
    documentId: "doc_regional_waf_synthetic",
    architectureId: "architecture_regional_waf_synthetic",
    revision: {
      ...template.revision,
      revisionId: "revision_regional_waf_1",
      revisionNumber: 1,
      sourceDraftId: "draft_regional_waf_synthetic",
    },
    applicationContracts: {
      ...template.applicationContracts,
      documentId: "doc_regional_waf_synthetic",
      contractSetId: "contracts_regional_waf_synthetic",
      revision: {
        ...template.applicationContracts.revision,
        revisionId: "revision_regional_waf_1",
        revisionNumber: 1,
      },
    },
    externalResources: {
      ...template.externalResources,
      documentId: "doc_regional_waf_synthetic",
      architectureId: "architecture_regional_waf_synthetic",
      revision: {
        ...template.externalResources.revision,
        revisionId: "revision_regional_waf_1",
        revisionNumber: 1,
      },
    },
    catalog: {
      id: catalog.catalog.id,
      version: catalog.catalog.version,
      digest: catalog.digest,
    },
  });
  const base = d.nodes.find((n) => n.id === "alb");
  if (base === undefined) throw new Error("Missing existing synthetic ALB.");
  const values = Object.fromEntries(
    Object.entries(wafProperties).map(([key, s]) => [
      key,
      {
        kind: s.type,
        value:
          key === "name"
            ? "synthetic_web_waf"
            : key === "webAclRegion"
              ? d.provider.region
              : s.default,
      },
    ]),
  );
  const waf = {
    ...base,
    id: "web_waf",
    presentation: {
      label: "Regional WAF · count mode",
      position: { x: -320, y: 40 },
    },
    semantic: {
      ...base.semantic,
      serviceType: WAF_WEB_ACL,
      resourceType: WAF_WEB_ACL,
      deploymentKey: "web_waf",
      configuration: {
        schemaId: WAF_WEB_ACL + ".configuration",
        schemaVersion: "1.0.0",
        values,
      },
    },
  };
  const association = {
    ...base,
    id: "waf_alb",
    presentation: {
      label: "Protects existing ALB",
      position: { x: -100, y: 40 },
    },
    semantic: {
      ...base.semantic,
      serviceType: WAF_ASSOCIATION,
      resourceType: WAF_ASSOCIATION,
      deploymentKey: "waf_alb",
      parent: { nodeId: "web_waf", relationshipType: WAF_OWNER },
      configuration: {
        schemaId: WAF_ASSOCIATION + ".configuration",
        schemaVersion: "1.0.0",
        values: {},
      },
    },
  };
  const envelope = {
    schemaVersion: 1,
    commandId: "waf_add_nodes",
    inverseCommandId: "waf_remove_nodes",
    origin: "user",
    target: {
      documentId: d.documentId,
      architectureId: d.architectureId,
      revisionId: d.revision.revisionId,
    },
  };
  d = applyGraphCommand(d, {
    ...envelope,
    kind: "batch",
    commands: [
      {
        ...envelope,
        commandId: "waf_add_acl",
        inverseCommandId: "waf_remove_acl",
        kind: "add-node",
        node: waf,
      },
      {
        ...envelope,
        commandId: "waf_add_association",
        inverseCommandId: "waf_remove_association",
        kind: "add-node",
        node: association,
      },
    ],
  }).document;
  const resolver = regionalWafResolver(catalog);
  for (const [rule, port, target, targetPort] of [
    [WAF_OWNER, "web-acl", "web_waf", "association"],
    [WAF_PROTECTS, "alb", "alb", "waf"],
  ] as const) {
    const result = resolver.resolve({
      document: d,
      ruleId: rule,
      source: { nodeId: "waf_alb", portId: WAF_ASSOCIATION + "." + port },
      target: {
        nodeId: target,
        portId:
          (target === "alb" ? base.semantic.serviceType : WAF_WEB_ACL) +
          "." +
          targetPort,
      },
      configuration: {},
      operationId: rule === WAF_OWNER ? "waf_bind_owner" : "waf_bind_alb",
    });
    if (!result.success) throw Error(JSON.stringify(result));
    d = applyGraphCommand(d, result.batch).document;
  }
  return d;
}
