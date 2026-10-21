import { fullBetaEvaluationCatalogV1 } from "./full-beta-evaluation-dataset.js";

/** Frozen successor input: retain the exact predecessor projection and add only
 * the reviewed WAF entries. This does not install a provider or admit a model. */
export const regionalWafEvaluationCatalogProjectionV1 = {
  id: fullBetaEvaluationCatalogV1.id,
  version: fullBetaEvaluationCatalogV1.version,
  digest:
    "sha256:8e9b1b23bbcdf723352044baddd8e79468d70ed5a719af914036992daf91fb94",
  services: [
    ...fullBetaEvaluationCatalogV1.services,
    ...[
      {
        id: "aws.wafv2.alb-association",
        configurationSchemaId: "aws.wafv2.alb-association.configuration",
        configurationSchemaVersion: "1.0.0",
        configurationKeys: [],
      },
      {
        id: "aws.wafv2.web-acl",
        configurationSchemaId: "aws.wafv2.web-acl.configuration",
        configurationSchemaVersion: "1.0.0",
        configurationKeys: [
          "aggregateKey",
          "cloudWatchMetricsEnabled",
          "defaultAction",
          "managedRuleGroup",
          "managedRuleMode",
          "managedRulePriority",
          "managedRuleVersionPolicy",
          "name",
          "rateAction",
          "rateLimit",
          "ratePriority",
          "rateWindowSeconds",
          "requestLogging",
          "retain",
          "sampledRequestsEnabled",
          "scope",
          "webAclRegion",
        ],
      },
    ],
  ].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  ),
} as const;
