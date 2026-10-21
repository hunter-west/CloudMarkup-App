import type { ValidationFindingCandidate } from "@cloudmarkup/domain";
import {
  s3BucketNameValidationRuleDescriptor,
  s3NotificationFiltersValidationRuleDescriptor,
} from "../catalog/validation-rules/s3-accuracy.js";
import {
  isS3SharedBucketName,
  s3NotificationFilterKey,
  s3NotificationFiltersOverlap,
} from "../s3-accuracy-contract.js";
import {
  defineAwsValidationRuleV1,
  finding,
  literalString,
  nodeConfigurationLocation,
  edgeConfigurationLocation,
  type AwsValidationCatalogV1,
} from "./rule-helpers.js";

export function createS3BucketNameRuleV1(catalog: AwsValidationCatalogV1) {
  const descriptor = s3BucketNameValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const findings: ValidationFindingCandidate[] = [];
      context.document?.nodes.forEach((node, index) => {
        if (node.semantic.serviceType !== "aws.s3.bucket") return;
        const name = literalString(
          node.semantic.configuration.values,
          "bucketName",
        );
        if (name !== undefined && isS3SharedBucketName(name)) return;
        findings.push(
          finding(descriptor, {
            code: "aws.validation.s3-bucket-name",
            severity: "error",
            title: "Choose a supported S3 bucket name",
            beginnerExplanation:
              "Use 3–63 lowercase letters, numbers, dots or hyphens, beginning and ending with a letter or number. Avoid adjacent dots, IP-style names and reserved names. Changing an existing bucket name can replace it; review the change.",
            technicalExplanation:
              "The curated shared-namespace bucket rejects reserved AWS prefixes/suffixes and account-regional -an names. Syntax validation does not establish global name availability. No name is generated or substituted.",
            affected: [nodeConfigurationLocation(node, index, "bucketName")],
          }),
        );
      });
      return findings;
    },
  });
}

export function createS3NotificationFiltersRuleV1(
  catalog: AwsValidationCatalogV1,
) {
  const descriptor = s3NotificationFiltersValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const findings: ValidationFindingCandidate[] = [];
      const entries = (context.document?.edges ?? [])
        .map((edge, index) => ({ edge, index }))
        .filter(
          ({ edge }) =>
            edge.semantic.relationshipType === "aws.s3.notifies-lambda",
        )
        .sort((a, b) =>
          a.edge.id < b.edge.id ? -1 : a.edge.id > b.edge.id ? 1 : 0,
        )
        .flatMap(({ edge, index }) => {
          const values = edge.semantic.configuration.values;
          const event = literalString(values, "eventType");
          const encodedPrefix = literalString(values, "filterPrefix");
          const encodedSuffix = literalString(values, "filterSuffix");
          const prefix =
            encodedPrefix === undefined
              ? undefined
              : s3NotificationFilterKey(encodedPrefix);
          const suffix =
            encodedSuffix === undefined
              ? undefined
              : s3NotificationFilterKey(encodedSuffix);
          const invalid = [
            ...(prefix === undefined ? ["filterPrefix"] : []),
            ...(suffix === undefined ? ["filterSuffix"] : []),
          ];
          if (invalid.length > 0)
            findings.push(
              finding(descriptor, {
                code: "aws.validation.s3-notification-filter-encoding",
                severity: "error",
                title: "Review the S3 object-key filter",
                beginnerExplanation:
                  "Use a literal prefix or suffix without wildcard characters. Encode spaces as + and special characters with percent encoding; keep each filter within 1,024 characters.",
                technicalExplanation:
                  "Notification filters require present literal strings, valid percent-encoded UTF-8 and no raw non-ASCII, whitespace, control characters or wildcard asterisk. Comparison decodes one transport layer without changing stored or emitted values.",
                affected: invalid.map((key) =>
                  edgeConfigurationLocation(edge, index, key),
                ),
              }),
            );
          if (
            prefix === undefined ||
            suffix === undefined ||
            (event !== "OBJECT_CREATED" && event !== "OBJECT_REMOVED")
          )
            return [];
          return [{ edge, index, event, prefix, suffix }];
        });
      // One stable earlier conflict per edge keeps diagnostics linear in graph size.
      const previous: typeof entries = [];
      for (const right of entries) {
        const left = previous.find(
          (candidate) =>
            candidate.edge.semantic.source.nodeId ===
              right.edge.semantic.source.nodeId &&
            candidate.event === right.event &&
            s3NotificationFiltersOverlap(candidate, right),
        );
        previous.push(right);
        if (!left) continue;
        findings.push(
          finding(descriptor, {
            code: "aws.validation.s3-overlapping-notification-filters",
            severity: "error",
            title: "S3 notification filters overlap",
            beginnerExplanation:
              "These two consumers can receive the same object event. Choose non-overlapping prefixes or suffixes, or review a separate routing design. Empty filters match every key.",
            technicalExplanation:
              "Two direct Lambda notifications from one bucket have intersecting event families and overlapping decoded prefixes and suffixes. Different destinations do not make an overlapping S3 configuration valid. No consumer or filter is removed automatically.",
            affected: [left, right].flatMap(({ edge, index }) =>
              ["eventType", "filterPrefix", "filterSuffix"].map((key) =>
                edgeConfigurationLocation(edge, index, key),
              ),
            ),
          }),
        );
      }
      return findings;
    },
  });
}
