import type { ValidationFindingCandidate } from "@cloudmarkup/domain";

import {
  compilerReadinessValidationRuleDescriptor,
  regionAvailabilityValidationRuleDescriptor,
} from "../catalog/validation-rules/index.js";
import { AWS_CURRENT_CATALOG_BINDING_V1 } from "../current-catalog.js";
import {
  defineAwsValidationRuleV1,
  finding,
  isLowerEnvironment,
  literalInteger,
  nodeConfigurationLocation,
  nodeLocation,
  type AwsValidationCatalogV1,
} from "./rule-helpers.js";

export function createRegionAvailabilityRuleV1(
  catalog: AwsValidationCatalogV1,
) {
  const descriptor = regionAvailabilityValidationRuleDescriptor;
  const serviceById = new Map(
    catalog.services.map((service) => [service.id, service]),
  );

  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) {
        return [];
      }
      const findings: ValidationFindingCandidate[] = [];
      const unknownLocations: ReturnType<typeof nodeLocation>[] = [];
      const unknownServiceIds = new Set<string>();

      document.nodes.forEach((node, nodeIndex) => {
        const service = serviceById.get(node.semantic.serviceType);
        if (
          service === undefined ||
          service.placement.regionConstraint === "not-applicable"
        ) {
          return;
        }
        const availability = service.regionAvailability;
        if (availability.state === "unknown") {
          unknownLocations.push(
            nodeLocation(node, nodeIndex, ".semantic.serviceType"),
          );
          unknownServiceIds.add(service.id);
          return;
        }

        const regionalEntry = availability.regions.find(
          (entry) => entry.region === document.provider.region,
        );
        if (
          regionalEntry?.availability === "unavailable" ||
          (regionalEntry === undefined && availability.coverage === "complete")
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.region-unsupported",
              severity: "error",
              title: "Service is unavailable in the selected AWS Region",
              beginnerExplanation:
                "This catalog version says the service cannot be used in the selected Region.",
              technicalExplanation:
                "The pinned known region-availability metadata marks the document Region unavailable or omits it from a complete inventory.",
              affected: [
                nodeLocation(node, nodeIndex, ".semantic.serviceType"),
              ],
            }),
          );
        } else if (regionalEntry === undefined) {
          unknownLocations.push(
            nodeLocation(node, nodeIndex, ".semantic.serviceType"),
          );
          unknownServiceIds.add(service.id);
        }
      });

      if (unknownLocations.length > 0) {
        findings.push(
          finding(descriptor, {
            code: "aws.validation.region-availability-unknown",
            severity: isLowerEnvironment(context.environment)
              ? "recommendation"
              : "warning",
            title: "AWS Region availability is not verified",
            beginnerExplanation:
              "The catalog has not verified " +
              String(unknownServiceIds.size) +
              (unknownServiceIds.size === 1
                ? " service type"
                : " service types") +
              " in this Region. Review availability before export.",
            technicalExplanation:
              "The pinned catalog has unknown or partial Region coverage for " +
              String(unknownLocations.length) +
              (unknownLocations.length === 1
                ? " affected resource"
                : " affected resources") +
              ". No live AWS availability claim is inferred.",
            affected: unknownLocations,
          }),
        );
      }
      return findings;
    },
  });
}

export function createCompilerReadinessRuleV1(catalog: AwsValidationCatalogV1) {
  const descriptor = compilerReadinessValidationRuleDescriptor;
  const serviceById = new Map(
    catalog.services.map((service) => [service.id, service]),
  );

  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    targets: ["compilation"],
    evaluate(context) {
      const document = context.document;
      if (document === undefined) {
        return [];
      }
      const findings: ValidationFindingCandidate[] = [];

      document.nodes.forEach((node, nodeIndex) => {
        const service = serviceById.get(node.semantic.serviceType);
        if (service === undefined) {
          return;
        }
        if (node.semantic.serviceType === "aws.cloudwatch.metric-alarm") {
          const m = literalInteger(
            node.semantic.configuration.values,
            "datapointsToAlarm",
          );
          const n = literalInteger(
            node.semantic.configuration.values,
            "evaluationPeriods",
          );
          if (m !== undefined && n !== undefined && m > n) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.alarm-datapoints-exceed-periods",
                severity: "error",
                title: "Alarm datapoints must not exceed evaluation periods",
                beginnerExplanation:
                  "For an M-out-of-N alarm, choose no more breaching datapoints than the number of evaluation periods.",
                technicalExplanation:
                  "datapointsToAlarm (M) must be less than or equal to evaluationPeriods (N). The compiler cannot rewrite either explicit alarm setting.",
                affected: [
                  nodeConfigurationLocation(
                    node,
                    nodeIndex,
                    "datapointsToAlarm",
                  ),
                  nodeConfigurationLocation(
                    node,
                    nodeIndex,
                    "evaluationPeriods",
                  ),
                ],
              }),
            );
          }
        }
        if (
          service.nodeKind.kind === "resource" &&
          !service.nodeKind.deployable
        ) {
          return;
        }
        const implementedMappings = service.mappings.filter(
          (mapping) => mapping.implementationStatus === "implemented",
        );
        // These exact semantic boundaries are consumed by the reviewed Go
        // networking renderer; they intentionally have no resource mapping.
        // Do not extend this to arbitrary boundaries or metadata-only catalogs.
        const semanticKey =
          catalog.provider.id === "aws.cloudmarkup" &&
          catalog.catalog.id === AWS_CURRENT_CATALOG_BINDING_V1.id &&
          catalog.catalog.version === AWS_CURRENT_CATALOG_BINDING_V1.version &&
          service.definitionVersion === "1.0.0" &&
          service.nodeKind.kind === "boundary" &&
          service.configuration.schemaId === service.id + ".configuration" &&
          service.configuration.schemaVersion === "1.0.0"
            ? service.id === "aws.region.boundary"
              ? "regionName"
              : service.id === "aws.ec2.availability-zone"
                ? "zoneName"
                : undefined
            : undefined;
        if (implementedMappings.length === 0 && semanticKey === undefined) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.compiler-target-not-implemented",
              severity: "error",
              title: "No declared compiler target can compile this service",
              beginnerExplanation:
                "This service has reviewed mapping notes, but no working IaC compiler mapping yet.",
              technicalExplanation:
                "Every declared Terraform or CloudFormation mapping is metadata-only; compilation must fail closed.",
              affected: [
                nodeLocation(node, nodeIndex, ".semantic.serviceType"),
              ],
            }),
          );
          return;
        }

        Object.keys(node.semantic.configuration.values)
          .sort()
          .forEach((key) => {
            const isBound =
              key === semanticKey ||
              implementedMappings.some(
                (mapping) =>
                  mapping.configurationBindings.some(
                    (binding) => binding.configurationKey === key,
                  ) ||
                  mapping.semanticConfigurationKeys?.some(
                    (configurationKey) => String(configurationKey) === key,
                  ) === true,
              );
            if (isBound) {
              return;
            }
            findings.push(
              finding(descriptor, {
                code: "aws.validation.configuration-binding-missing",
                severity: "error",
                title: "Configuration cannot be compiled by a declared target",
                beginnerExplanation:
                  "A configured field has no reviewed output mapping in any implemented target.",
                technicalExplanation:
                  "The tagged configuration key is absent from every implemented mapping declaration for this service.",
                affected: [nodeConfigurationLocation(node, nodeIndex, key)],
              }),
            );
          });
      });

      return findings;
    },
  });
}
