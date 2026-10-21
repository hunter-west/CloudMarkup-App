import {
  createValidationDocumentPath,
  type ValidationAffectedLocation,
  type ValidationFindingCandidate,
} from "@cloudmarkup/domain";

import {
  connectionCardinalityValidationRuleDescriptor,
  lambdaTriggerCompatibilityValidationRuleDescriptor,
} from "../catalog/validation-rules/index.js";
import {
  defineAwsValidationRuleV1,
  edgeLocation,
  finding,
  type AwsValidationCatalogV1,
  type AwsValidationDocument,
  type AwsValidationEdge,
} from "./rule-helpers.js";

interface IndexedEdge {
  readonly edge: AwsValidationEdge;
  readonly index: number;
}

function compareStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function groupedEdges(
  entries: readonly IndexedEdge[],
  keyOf: (entry: IndexedEdge) => string,
): readonly (readonly IndexedEdge[])[] {
  const groups = new Map<string, IndexedEdge[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([, group]) => group);
}

function affectedEdges(
  entries: readonly IndexedEdge[],
  suffix: string,
): readonly ValidationAffectedLocation[] {
  return entries.map(({ edge, index }) => edgeLocation(edge, index, suffix));
}

export function createConnectionCardinalityRuleV1(
  catalog: AwsValidationCatalogV1,
) {
  const descriptor = connectionCardinalityValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) {
        return [];
      }
      const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
      const serviceById = new Map(
        catalog.services.map((service) => [service.id, service]),
      );
      const indexedEdges = document.edges.map((edge, index) => ({
        edge,
        index,
      }));
      const findings: ValidationFindingCandidate[] = [];

      const sourcePortGroups = groupedEdges(
        indexedEdges.filter(({ edge }) => {
          const node = nodeById.get(edge.semantic.source.nodeId);
          return (
            node !== undefined &&
            serviceById
              .get(node.semantic.serviceType)
              ?.ports.some(
                (port) =>
                  port.id === edge.semantic.source.port &&
                  port.cardinality === "one",
              ) === true
          );
        }),
        ({ edge }) =>
          `${String(edge.semantic.source.nodeId)}\u0000${String(edge.semantic.source.port)}`,
      );
      for (const group of sourcePortGroups.filter(
        (candidate) => candidate.length > 1,
      )) {
        findings.push(
          finding(descriptor, {
            code: "aws.validation.connection-source-port-cardinality-exceeded",
            severity: "error",
            title: "Exclusive output has multiple connections",
            beginnerExplanation:
              "This output allows only one relationship, but the architecture contains several.",
            technicalExplanation:
              "The loaded document exceeds a source port whose catalog cardinality is one, aggregated across all connection rules.",
            affected: affectedEdges(group, ".semantic.source.port"),
          }),
        );
      }

      const targetPortGroups = groupedEdges(
        indexedEdges.filter(({ edge }) => {
          const node = nodeById.get(edge.semantic.target.nodeId);
          return (
            node !== undefined &&
            serviceById
              .get(node.semantic.serviceType)
              ?.ports.some(
                (port) =>
                  port.id === edge.semantic.target.port &&
                  port.cardinality === "one",
              ) === true
          );
        }),
        ({ edge }) =>
          `${String(edge.semantic.target.nodeId)}\u0000${String(edge.semantic.target.port)}`,
      );
      for (const group of targetPortGroups.filter(
        (candidate) => candidate.length > 1,
      )) {
        findings.push(
          finding(descriptor, {
            code: "aws.validation.connection-target-port-cardinality-exceeded",
            severity: "error",
            title: "Exclusive input has multiple connections",
            beginnerExplanation:
              "This input allows only one relationship, but the architecture contains several.",
            technicalExplanation:
              "The loaded document exceeds a target port whose catalog cardinality is one, aggregated across all connection rules.",
            affected: affectedEdges(group, ".semantic.target.port"),
          }),
        );
      }

      for (const rule of catalog.connectionRules) {
        const matching = indexedEdges.filter(({ edge }) => {
          const sourceNode = nodeById.get(edge.semantic.source.nodeId);
          const targetNode = nodeById.get(edge.semantic.target.nodeId);
          return (
            sourceNode?.semantic.serviceType === rule.source.serviceId &&
            targetNode?.semantic.serviceType === rule.target.serviceId &&
            edge.semantic.relationshipType === rule.relationshipType &&
            edge.semantic.source.port === rule.source.portId &&
            edge.semantic.target.port === rule.target.portId
          );
        });
        const constraints = [
          {
            groups: groupedEdges(matching, ({ edge }) =>
              String(edge.semantic.source.nodeId),
            ),
            maximum: rule.maximumConnectionsPerSource,
            code: "aws.validation.connection-source-cardinality-exceeded",
            title: "Relationship exceeds its source limit",
            explanation:
              "The loaded document exceeds the connection rule's per-source cardinality.",
          },
          {
            groups: groupedEdges(matching, ({ edge }) =>
              String(edge.semantic.target.nodeId),
            ),
            maximum: rule.maximumConnectionsPerTarget,
            code: "aws.validation.connection-target-cardinality-exceeded",
            title: "Relationship exceeds its destination limit",
            explanation:
              "The loaded document exceeds the connection rule's per-target cardinality.",
          },
          {
            groups: groupedEdges(
              matching,
              ({ edge }) =>
                `${String(edge.semantic.source.nodeId)}\u0000${String(edge.semantic.target.nodeId)}`,
            ),
            maximum: rule.maximumConnectionsPerEndpointPair,
            code: "aws.validation.connection-endpoint-pair-cardinality-exceeded",
            title: "Relationship exceeds its endpoint-pair limit",
            explanation:
              "The loaded document exceeds the connection rule's per-endpoint-pair cardinality.",
          },
        ] as const;
        for (const constraint of constraints) {
          for (const group of constraint.groups.filter(
            (candidate) => candidate.length > constraint.maximum,
          )) {
            findings.push(
              finding(descriptor, {
                code: constraint.code,
                severity: "error",
                title: constraint.title,
                beginnerExplanation:
                  "This relationship appears more times than its reviewed catalog rule allows.",
                technicalExplanation: `${constraint.explanation} Rule: ${String(rule.id)}; maximum: ${String(constraint.maximum)}.`,
                affected: affectedEdges(group, ".semantic.relationshipType"),
              }),
            );
          }
        }
      }

      return findings;
    },
  });
}

function triggerContractIdentity(
  document: AwsValidationDocument,
  workloadIndex: number,
  triggerIndex: number,
): string | undefined {
  if (!("workloadBehavior" in document)) {
    return undefined;
  }
  const workload = document.workloadBehavior.workloads[workloadIndex];
  const trigger = workload?.triggers[triggerIndex];
  const operation = workload?.operations.find(
    (candidate) => candidate.id === trigger?.targetOperationId,
  );
  if (operation?.inputContract.kind !== "contract-reference") {
    return undefined;
  }
  const reference = operation.inputContract.reference;
  return [
    reference.contractId,
    reference.contractVersion,
    reference.digest,
  ].join("\u0000");
}

function workloadLocation(
  workloadIndex: number,
  suffix: string,
): ValidationAffectedLocation {
  return {
    kind: "document",
    path: createValidationDocumentPath(
      `$.workloadBehavior.workloads[${String(workloadIndex)}]${suffix}`,
    ),
  };
}

export function createLambdaTriggerCompatibilityRuleV1(
  catalog: AwsValidationCatalogV1,
) {
  const descriptor = lambdaTriggerCompatibilityValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined || !("workloadBehavior" in document)) {
        return [];
      }
      const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
      const findings: ValidationFindingCandidate[] = [];

      document.workloadBehavior.workloads.forEach((workload, workloadIndex) => {
        const owningNode = nodeById.get(workload.owningNodeId);
        if (owningNode === undefined) {
          return;
        }
        if (owningNode.semantic.serviceType !== "aws.lambda.function") {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.workload-owner-unsupported",
              severity: "error",
              title: "Workload owner is not supported",
              beginnerExplanation:
                "Move this implementation intent to a Lambda function. This AWS catalog does not support workloads on other resources.",
              technicalExplanation:
                "This exact AWS catalog supports Workload Behavior only for nodes whose service type is aws.lambda.function.",
              affected: [workloadLocation(workloadIndex, ".owningNodeId")],
            }),
          );
          return;
        }
        const triggerFindings = workload.triggers.flatMap(
          (trigger, triggerIndex) => {
            const edge = document.edges.find(
              (candidate) => candidate.id === trigger.edgeId,
            );
            const sourceNode =
              edge === undefined
                ? undefined
                : nodeById.get(edge.semantic.source.nodeId);
            const targetNode =
              edge === undefined
                ? undefined
                : nodeById.get(edge.semantic.target.nodeId);
            const matchingRules =
              edge === undefined
                ? []
                : catalog.connectionRules.filter(
                    (rule) =>
                      sourceNode?.semantic.serviceType ===
                        rule.source.serviceId &&
                      targetNode?.semantic.serviceType ===
                        rule.target.serviceId &&
                      edge.semantic.relationshipType ===
                        rule.relationshipType &&
                      edge.semantic.source.port === rule.source.portId &&
                      edge.semantic.target.port === rule.target.portId,
                  );
            if (
              matchingRules.length === 1 &&
              matchingRules[0]?.category === "receives-events-from" &&
              edge?.semantic.target.nodeId === workload.owningNodeId
            ) {
              return [];
            }
            return [
              finding(descriptor, {
                code: "aws.validation.lambda-trigger-edge-incompatible",
                severity: "error",
                title: "Workload trigger does not use a supported trigger edge",
                beginnerExplanation:
                  "Bind this trigger to a reviewed event or invocation connection targeting the function.",
                technicalExplanation:
                  matchingRules.length > 1
                    ? "The trigger edge matches multiple catalog rules and is ambiguous."
                    : "The trigger edge does not resolve to one exact receives-events-from catalog rule; role, data, logging, and other associations cannot masquerade as triggers.",
                affected: [
                  workloadLocation(
                    workloadIndex,
                    `.triggers[${String(triggerIndex)}].edgeId`,
                  ),
                ],
              }),
            ];
          },
        );
        const triggerEdgeIds = new Set(
          workload.triggers.map((trigger) => trigger.edgeId),
        );
        const missingBindingFindings = document.edges.flatMap(
          (edge, edgeIndex) => {
            if (edge.semantic.target.nodeId !== workload.owningNodeId) {
              return [];
            }
            const sourceNode = nodeById.get(edge.semantic.source.nodeId);
            const matchingRules = catalog.connectionRules.filter(
              (rule) =>
                sourceNode?.semantic.serviceType === rule.source.serviceId &&
                owningNode.semantic.serviceType === rule.target.serviceId &&
                edge.semantic.relationshipType === rule.relationshipType &&
                edge.semantic.source.port === rule.source.portId &&
                edge.semantic.target.port === rule.target.portId,
            );
            if (
              matchingRules.length !== 1 ||
              matchingRules[0]?.category !== "receives-events-from" ||
              triggerEdgeIds.has(edge.id)
            ) {
              return [];
            }
            return [
              finding(descriptor, {
                code: "aws.validation.lambda-trigger-binding-missing",
                severity: context.target === "draft" ? "warning" : "error",
                title: "Lambda trigger is missing a workload binding",
                beginnerExplanation:
                  "Bind this incoming trigger to an explicit workload operation before treating the function implementation as ready.",
                technicalExplanation:
                  "Every exact receives-events-from catalog edge targeting a declared Lambda workload must appear once in that workload's trigger bindings.",
                affected: [
                  edgeLocation(edge, edgeIndex),
                  workloadLocation(workloadIndex, ".triggers"),
                ],
              }),
            ];
          },
        );
        findings.push(...triggerFindings, ...missingBindingFindings);
        if (triggerFindings.length > 0 || missingBindingFindings.length > 0) {
          return;
        }
        if (workload.triggers.length <= 1) {
          return;
        }
        const contractIdentities = workload.triggers.map((_, triggerIndex) =>
          triggerContractIdentity(document, workloadIndex, triggerIndex),
        );
        const firstIdentity = contractIdentities[0];
        const homogeneous =
          firstIdentity !== undefined &&
          contractIdentities.every((identity) => identity === firstIdentity);

        if (
          homogeneous &&
          workload.triggerDispatch.mode !== "generated-supported"
        ) {
          return;
        }

        if (workload.triggerDispatch.mode !== "generated-supported") {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.lambda-incompatible-trigger-contracts",
              severity: context.target === "draft" ? "warning" : "error",
              title: "Lambda triggers have incompatible input contracts",
              beginnerExplanation:
                "Use separate functions for these event types unless a generated dispatcher is explicitly supported.",
              technicalExplanation:
                "Multiple triggers are compatible with one handler only when every target operation has the same explicit contract-reference identity. Heterogeneous, none, or missing input contracts require a reviewed generated-supported dispatcher.",
              affected: [workloadLocation(workloadIndex, ".triggers")],
            }),
          );
          return;
        }

        findings.push(
          finding(descriptor, {
            code: "aws.validation.lambda-trigger-dispatcher-not-reviewed",
            severity: "error",
            title: "Lambda dispatcher is not supported",
            beginnerExplanation:
              "A dispatcher cannot be generated for this connection yet. Use user-provided dispatch for matching contracts or separate functions.",
            technicalExplanation: `No reviewed AWS Lambda dispatcher registration matches ${String(workload.triggerDispatch.dispatcherId)} at ${String(workload.triggerDispatch.dispatcherVersion)}; generated source is not implemented in this milestone.`,
            affected: [workloadLocation(workloadIndex, ".triggerDispatch")],
          }),
        );
      });

      return findings;
    },
  });
}
