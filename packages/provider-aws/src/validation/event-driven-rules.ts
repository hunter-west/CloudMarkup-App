import {
  eventDeliveryValidationRuleDescriptor,
  eventTopologyValidationRuleDescriptor,
} from "../catalog/validation-rules/event-driven-validation-rules.js";
import {
  defineAwsValidationRuleV1,
  edgeConfigurationLocation,
  edgeLocation,
  finding,
  literalBoolean,
  literalInteger,
  literalString,
  nodeConfigurationLocation,
  nodeLocation,
  type AwsValidationCatalogV1,
  type AwsValidationDocument,
  type AwsValidationEdge,
  type AwsValidationNode,
} from "./rule-helpers.js";

const RELATIONSHIPS = Object.freeze({
  s3Lambda: "aws.s3.notifies-lambda",
  s3EventBridge: "aws.s3.sends-events-to-eventbridge",
  lambdaSqs: "aws.lambda.sends-message-to-sqs",
  sqsLambda: "aws.sqs.triggers-lambda",
  sqsDlq: "aws.sqs.uses-dead-letter-queue",
  lambdaSns: "aws.lambda.publishes-to-sns",
  snsOwnsSubscription: "aws.sns.topic-owns-subscription",
  snsLambda: "aws.sns.subscription-invokes-lambda",
  snsSqs: "aws.sns.subscription-sends-to-sqs",
  lambdaEventBridge: "aws.lambda.puts-events-on-eventbridge",
  busRule: "aws.eventbridge.event-bus-associates-rule",
  ruleTarget: "aws.eventbridge.rule-owns-target",
  targetLambda: "aws.eventbridge.target-invokes-lambda",
  targetSqs: "aws.eventbridge.target-sends-to-sqs",
  targetSns: "aws.eventbridge.target-publishes-to-sns",
  targetSfn: "aws.eventbridge.target-starts-state-machine",
  targetDlq: "aws.eventbridge.target-uses-dead-letter-queue",
  targetRole: "aws.iam.role-assumed-by-eventbridge-target",
  lambdaSfn: "aws.lambda.starts-step-functions-state-machine",
  sfnLambda: "aws.stepfunctions.state-machine-invokes-lambda",
  lambdaDlq: "aws.lambda.uses-sqs-dead-letter-queue",
});

const SNS_PRIMARY_RELATIONSHIPS: ReadonlySet<string> = new Set([
  RELATIONSHIPS.snsLambda,
  RELATIONSHIPS.snsSqs,
]);

const EVENTBRIDGE_PRIMARY_RELATIONSHIPS: ReadonlySet<string> = new Set([
  RELATIONSHIPS.targetLambda,
  RELATIONSHIPS.targetSqs,
  RELATIONSHIPS.targetSns,
  RELATIONSHIPS.targetSfn,
]);

const EVENT_FLOW_RELATIONSHIPS = new Set([
  RELATIONSHIPS.s3Lambda,
  RELATIONSHIPS.s3EventBridge,
  RELATIONSHIPS.lambdaSqs,
  RELATIONSHIPS.sqsLambda,
  RELATIONSHIPS.lambdaSns,
  RELATIONSHIPS.snsLambda,
  RELATIONSHIPS.snsSqs,
  RELATIONSHIPS.lambdaEventBridge,
  RELATIONSHIPS.targetLambda,
  RELATIONSHIPS.targetSqs,
  RELATIONSHIPS.targetSns,
  RELATIONSHIPS.targetSfn,
  RELATIONSHIPS.lambdaSfn,
  RELATIONSHIPS.sfnLambda,
]);

interface IndexedNode {
  readonly node: AwsValidationNode;
  readonly index: number;
}

interface IndexedEdge {
  readonly edge: AwsValidationEdge;
  readonly index: number;
}

function nodes(document: AwsValidationDocument): readonly IndexedNode[] {
  return document.nodes.map((node, index) => ({ node, index }));
}

function edges(document: AwsValidationDocument): readonly IndexedEdge[] {
  return document.edges.map((edge, index) => ({ edge, index }));
}

function nodeMap(
  document: AwsValidationDocument,
): ReadonlyMap<string, IndexedNode> {
  return new Map(
    nodes(document).map((entry) => [String(entry.node.id), entry]),
  );
}

function relationship(edge: AwsValidationEdge): string {
  return String(edge.semantic.relationshipType);
}

function stringList(
  node: AwsValidationNode,
  key: string,
): readonly string[] | undefined {
  const value = (
    node.semantic.configuration.values as Readonly<
      Record<string, { readonly kind: string; readonly value?: unknown }>
    >
  )[key];
  return value?.kind === "string-list" &&
    Array.isArray(value.value) &&
    value.value.every((item) => typeof item === "string")
    ? value.value
    : undefined;
}

function queueType(node: AwsValidationNode): string | undefined {
  return literalString(node.semantic.configuration.values, "queueType");
}

function topicType(node: AwsValidationNode): string | undefined {
  return literalString(node.semantic.configuration.values, "topicType");
}

function findCycleEdges(
  document: AwsValidationDocument,
  acceptedRelationships: ReadonlySet<string>,
): readonly IndexedEdge[] {
  const adjacency = new Map<string, IndexedEdge[]>();
  for (const entry of edges(document)) {
    if (!acceptedRelationships.has(relationship(entry.edge))) continue;
    const source = String(entry.edge.semantic.source.nodeId);
    adjacency.set(source, [...(adjacency.get(source) ?? []), entry]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: IndexedEdge[] = [];
  function visit(nodeId: string): readonly IndexedEdge[] | undefined {
    if (visiting.has(nodeId)) {
      const start = path.findIndex(
        ({ edge }) => String(edge.semantic.source.nodeId) === nodeId,
      );
      return path.slice(Math.max(start, 0));
    }
    if (visited.has(nodeId)) return undefined;
    visiting.add(nodeId);
    for (const entry of adjacency.get(nodeId) ?? []) {
      path.push(entry);
      const cycle = visit(String(entry.edge.semantic.target.nodeId));
      if (cycle !== undefined) return cycle;
      path.pop();
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return undefined;
  }
  for (const nodeId of adjacency.keys()) {
    const cycle = visit(nodeId);
    if (cycle !== undefined) return cycle;
  }
  return [];
}

export function createEventTopologyRuleV1(catalog: AwsValidationCatalogV1) {
  const descriptor = eventTopologyValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) return [];
      const findings = [];
      const byId = nodeMap(document);
      const allEdges = edges(document);

      const cycle = findCycleEdges(document, EVENT_FLOW_RELATIONSHIPS);
      if (cycle.length > 0) {
        findings.push(
          finding(descriptor, {
            code: "aws.validation.event-flow-cycle",
            severity: "error",
            title: "Event flow contains a direct processing cycle",
            beginnerExplanation:
              "Break the loop or place a reviewed queue and idempotent operation at the feedback boundary.",
            technicalExplanation:
              "The curated producer/consumer graph contains a directed cycle. Automatic recursion controls and inferred payload guards are unsupported.",
            affected: cycle.map(({ edge, index }) => edgeLocation(edge, index)),
          }),
        );
      }

      const redriveCycle = findCycleEdges(
        document,
        new Set([RELATIONSHIPS.sqsDlq]),
      );
      if (redriveCycle.length > 0) {
        findings.push(
          finding(descriptor, {
            code: "aws.validation.sqs-dead-letter-cycle",
            severity: "error",
            title: "Dead-letter queues cannot form a cycle",
            beginnerExplanation:
              "Choose a terminal review queue instead of sending failed messages back around a loop.",
            technicalExplanation:
              "The exact aws.sqs.uses-dead-letter-queue graph is cyclic; automatic replay is unsupported.",
            affected: redriveCycle.map(({ edge, index }) =>
              edgeLocation(edge, index),
            ),
          }),
        );
      }

      const notificationKeys = new Map<string, IndexedEdge>();
      for (const entry of allEdges.filter(
        ({ edge }) => relationship(edge) === RELATIONSHIPS.s3Lambda,
      )) {
        const values = entry.edge.semantic.configuration.values;
        const key = [
          String(entry.edge.semantic.source.nodeId),
          literalString(values, "eventType") ?? "",
          literalString(values, "filterPrefix") ?? "",
          literalString(values, "filterSuffix") ?? "",
        ].join("|");
        const duplicate = notificationKeys.get(key);
        if (duplicate !== undefined) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.s3-duplicate-notification",
              severity: "error",
              title: "S3 notification duplicates an existing filter",
              beginnerExplanation:
                "Keep one destination for each exact event and object-key filter, or make the filters distinct.",
              technicalExplanation:
                "Two direct S3 notifications share the same bucket, eventType, filterPrefix, and filterSuffix tuple.",
              affected: [
                edgeLocation(duplicate.edge, duplicate.index),
                edgeLocation(entry.edge, entry.index),
              ],
            }),
          );
        } else {
          notificationKeys.set(key, entry);
        }
      }

      for (const entry of allEdges.filter(
        ({ edge }) => relationship(edge) === RELATIONSHIPS.s3EventBridge,
      )) {
        const target = byId.get(String(entry.edge.semantic.target.nodeId));
        if (
          target === undefined ||
          literalString(
            target.node.semantic.configuration.values,
            "busType",
          ) !== "DEFAULT" ||
          literalString(
            target.node.semantic.configuration.values,
            "busName",
          ) !== "default"
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.s3-eventbridge-default-bus-required",
              severity: "error",
              title: "S3 service events require the default EventBridge bus",
              beginnerExplanation:
                "Connect S3 events to the default bus. Use a Lambda producer for a custom application bus.",
              technicalExplanation:
                "Native S3 EventBridge delivery targets the account default bus; custom-bus routing requires a separate reviewed rule/target path.",
              affected: [edgeLocation(entry.edge, entry.index)],
            }),
          );
        }
      }
      return findings;
    },
  });
}

function targetRelationship(
  targetType: string | undefined,
): string | undefined {
  return targetType === "LAMBDA"
    ? RELATIONSHIPS.targetLambda
    : targetType === "SQS"
      ? RELATIONSHIPS.targetSqs
      : targetType === "SNS"
        ? RELATIONSHIPS.targetSns
        : targetType === "STEP_FUNCTIONS"
          ? RELATIONSHIPS.targetSfn
          : undefined;
}

export function createEventDeliveryRuleV1(catalog: AwsValidationCatalogV1) {
  const descriptor = eventDeliveryValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) return [];
      const findings = [];
      const byId = nodeMap(document);
      const allEdges = edges(document);

      const notificationNames = new Map<
        string,
        { entry: IndexedEdge; child?: IndexedNode }
      >();
      for (const entry of allEdges.filter(
        ({ edge }) => relationship(edge) === RELATIONSHIPS.s3Lambda,
      )) {
        const owned = allEdges
          .filter(
            ({ edge }) =>
              relationship(edge) ===
                "aws.s3.bucket-owns-notification-configuration" &&
              String(edge.semantic.target.nodeId) ===
                String(entry.edge.semantic.source.nodeId),
          )
          .map(({ edge }) => byId.get(String(edge.semantic.source.nodeId)))
          .filter(
            (child): child is IndexedNode =>
              child !== undefined &&
              String(child.node.semantic.serviceType) ===
                "aws.s3.bucket-notification-configuration" &&
              literalString(
                child.node.semantic.configuration.values,
                "destinationKind",
              ) === "LAMBDA" &&
              [
                "eventType",
                "filterPrefix",
                "filterSuffix",
                "deliverySemantics",
              ].every(
                (key) =>
                  literalString(
                    child.node.semantic.configuration.values,
                    key,
                  ) !== undefined &&
                  literalString(
                    child.node.semantic.configuration.values,
                    key,
                  ) ===
                    literalString(
                      entry.edge.semantic.configuration.values,
                      key,
                    ),
              ),
          );
        let name: string | undefined;
        const child = owned.length === 1 ? owned[0] : undefined;
        if (child !== undefined)
          name = literalString(
            child.node.semantic.configuration.values,
            "notificationName",
          );
        else if (owned.length === 0) {
          const grants = nodes(document).filter(
            ({ node }) =>
              String(node.semantic.serviceType) === "aws.iam.policy-document" &&
              node.semantic.lifecycle.ownership === "generated" &&
              node.semantic.lifecycle.provenance.dependentEdgeIds.some(
                (id) => String(id) === String(entry.edge.id),
              ) &&
              literalString(
                node.semantic.configuration.values,
                "policyKind",
              ) === "service-grant",
          );
          if (grants.length === 1) {
            const members = allEdges.filter(
              ({ edge }) =>
                relationship(edge) === "aws.iam.policy-contains-statement" &&
                String(edge.semantic.target.nodeId) ===
                  String(grants[0]?.node.id),
            );
            const statement =
              members.length === 1
                ? byId.get(String(members[0]?.edge.semantic.source.nodeId))
                    ?.node
                : undefined;
            if (
              statement !== undefined &&
              String(statement.semantic.serviceType) ===
                "aws.iam.policy-statement"
            ) {
              const sid = literalString(
                statement.semantic.configuration.values,
                "statementId",
              );
              if (sid !== undefined && /^[A-Za-z0-9]+$/.test(sid)) name = sid;
            }
          }
        }
        if (name === undefined || name === "") continue;
        const key = `${String(entry.edge.semantic.source.nodeId)}\u0000${name}`;
        const previous = notificationNames.get(key);
        if (previous !== undefined) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.s3-notification-name-conflict",
              severity:
                previous.child === undefined && child === undefined
                  ? "warning"
                  : "error",
              title:
                "Terraform S3 notification identifiers must be unique within a bucket",
              beginnerExplanation:
                "Choose distinct owned notification names for Terraform. Edge-only Terraform notifications use exact generated permission statement IDs; CloudFormation edge-only notifications omit those identifiers and remain available. Correct the typed conflict explicitly.",
              technicalExplanation:
                "Two notifications under the same bucket have the same effective identifier from notificationName or the exact generated service-grant statementId. Identifiers are neither renamed nor selected automatically.",
              affected: [
                edgeLocation(previous.entry.edge, previous.entry.index),
                edgeLocation(entry.edge, entry.index),
                ...(previous.child === undefined
                  ? []
                  : [
                      nodeConfigurationLocation(
                        previous.child.node,
                        previous.child.index,
                        "notificationName",
                      ),
                    ]),
                ...(child === undefined
                  ? []
                  : [
                      nodeConfigurationLocation(
                        child.node,
                        child.index,
                        "notificationName",
                      ),
                    ]),
              ],
            }),
          );
        } else
          notificationNames.set(key, {
            entry,
            ...(child === undefined ? {} : { child }),
          });
      }

      for (const { node, index } of nodes(document)) {
        const service = String(node.semantic.serviceType);
        const values = node.semantic.configuration.values;
        if (
          (service === "aws.eventbridge.rule" ||
            service === "aws.sns.subscription") &&
          ((stringList(node, "filterKeys")?.length ?? 0) !== 0 ||
            (service === "aws.sns.subscription" &&
              literalString(values, "filterScope") !== "NONE"))
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.event-filter-unrepresentable",
              severity: "error",
              title:
                "Additional event filters need a supported typed value contract",
              beginnerExplanation:
                "Clear additional filter keys and select no SNS filter scope before export. EventBridge source and detail-type choices remain supported.",
              technicalExplanation:
                "The current filterKeys list stores names without filter values. SNS attribute/body filters and EventBridge detail-key filters cannot be rendered faithfully; the compiler rejects them rather than broadening event delivery.",
              affected: [
                nodeConfigurationLocation(node, index, "filterKeys"),
                ...(service === "aws.sns.subscription"
                  ? [nodeConfigurationLocation(node, index, "filterScope")]
                  : []),
              ],
            }),
          );
        }
        if (service === "aws.s3.bucket-notification-configuration") {
          const ownerEdges = allEdges.filter(
            ({ edge }) =>
              relationship(edge) ===
                "aws.s3.bucket-owns-notification-configuration" &&
              String(edge.semantic.source.nodeId) === String(node.id),
          );
          const ownerId =
            ownerEdges.length === 1
              ? String(ownerEdges[0]?.edge.semantic.target.nodeId)
              : undefined;
          const sameSettings = (
            other: AwsValidationNode["semantic"]["configuration"]["values"],
          ) =>
            [
              "eventType",
              "filterPrefix",
              "filterSuffix",
              "deliverySemantics",
            ].every(
              (key) =>
                literalString(values, key) !== undefined &&
                literalString(values, key) === literalString(other, key),
            );
          const matches = allEdges.filter(
            ({ edge }) =>
              String(edge.semantic.source.nodeId) === ownerId &&
              relationship(edge) === RELATIONSHIPS.s3Lambda &&
              sameSettings(edge.semantic.configuration.values),
          );
          const siblings = allEdges
            .filter(
              ({ edge }) =>
                relationship(edge) ===
                  "aws.s3.bucket-owns-notification-configuration" &&
                String(edge.semantic.target.nodeId) === ownerId,
            )
            .map(
              ({ edge }) => byId.get(String(edge.semantic.source.nodeId))?.node,
            )
            .filter(
              (other) =>
                other !== undefined &&
                literalString(
                  other.semantic.configuration.values,
                  "destinationKind",
                ) === "LAMBDA" &&
                sameSettings(other.semantic.configuration.values),
            );
          if (
            literalString(values, "destinationKind") !== "LAMBDA" ||
            ownerId === undefined ||
            matches.length !== 1 ||
            siblings.length !== 1
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.s3-owned-notification-unrepresented",
                severity: "error",
                title:
                  "Owned S3 notification settings need one matching Lambda destination",
                beginnerExplanation:
                  "Connect one bucket-to-Lambda notification with the same event, prefix, suffix and delivery settings. Remove conflicting or duplicate owned entries explicitly; per-object EventBridge settings are unsupported.",
                technicalExplanation:
                  "Each owned LAMBDA notification must correspond to one unique typed delivery edge and one unique owned settings entry. Standalone, conflicting, duplicate or EVENTBRIDGE child intent cannot be silently omitted or replaced by edge values.",
                affected: [
                  nodeLocation(node, index),
                  ...ownerEdges.map(({ edge, index: edgeIndex }) =>
                    edgeLocation(edge, edgeIndex),
                  ),
                ],
              }),
            );
          }
        }
        if (service === "aws.sqs.redrive-configuration") {
          const ownerEdges = allEdges.filter(
            ({ edge }) =>
              relationship(edge) ===
                "aws.sqs.queue-owns-redrive-configuration" &&
              String(edge.semantic.source.nodeId) === String(node.id),
          );
          const ownerId =
            ownerEdges.length === 1
              ? String(ownerEdges[0]?.edge.semantic.target.nodeId)
              : undefined;
          const destinations = allEdges.filter(
            ({ edge }) =>
              relationship(edge) === RELATIONSHIPS.sqsDlq &&
              String(edge.semantic.source.nodeId) === ownerId,
          );
          const destination =
            destinations.length === 1 ? destinations[0] : undefined;
          if (
            ownerId === undefined ||
            destination === undefined ||
            literalString(values, "redrivePermission") !== "BY_QUEUE" ||
            literalInteger(values, "maximumReceiveCount") !==
              literalInteger(
                destination.edge.semantic.configuration.values,
                "maximumReceiveCount",
              ) ||
            literalString(values, "replayMode") !==
              literalString(
                destination.edge.semantic.configuration.values,
                "replayMode",
              )
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.sqs-owned-redrive-unrepresented",
                severity: "error",
                title:
                  "Owned redrive settings must match one explicit dead-letter connection",
                beginnerExplanation:
                  "Choose one DLQ and make the owned attempts and replay settings agree with its connection. Conflicting settings must be corrected explicitly.",
                technicalExplanation:
                  "The owned source-queue redrive configuration requires one exact DLQ edge, identical maximumReceiveCount and replayMode, and the closed BY_QUEUE allow posture. Export cannot choose between conflicting representations or discard standalone settings.",
                affected: [
                  nodeLocation(node, index),
                  ...destinations.map(({ edge, index: edgeIndex }) =>
                    edgeLocation(edge, edgeIndex),
                  ),
                ],
              }),
            );
          }
        }
        if (service === "aws.sqs.queue" || service === "aws.sns.topic") {
          const kindKey =
            service === "aws.sqs.queue" ? "queueType" : "topicType";
          const nameKey =
            service === "aws.sqs.queue" ? "queueName" : "topicName";
          const kind = literalString(values, kindKey);
          const name = literalString(values, nameKey) ?? "";
          const fifo = kind === "FIFO";
          if (fifo !== name.endsWith(".fifo")) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.event-fifo-name-mismatch",
                severity: "error",
                title: "FIFO type and resource name do not match",
                beginnerExplanation:
                  "FIFO queues and topics must end in .fifo; Standard resources must not.",
                technicalExplanation: `${kindKey} and ${nameKey} encode conflicting AWS FIFO semantics.`,
                affected: [
                  nodeConfigurationLocation(node, index, kindKey),
                  nodeConfigurationLocation(node, index, nameKey),
                ],
              }),
            );
          }
          if (
            literalBoolean(values, "contentBasedDeduplication") === true &&
            !fifo
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.event-deduplication-requires-fifo",
                severity: "error",
                title: "Content-based deduplication requires FIFO",
                beginnerExplanation:
                  "Choose FIFO before enabling content-based deduplication.",
                technicalExplanation:
                  "AWS exposes content-based deduplication only for FIFO queues and topics.",
                affected: [
                  nodeConfigurationLocation(
                    node,
                    index,
                    "contentBasedDeduplication",
                  ),
                ],
              }),
            );
          }
        }

        if (service === "aws.sns.subscription") {
          const protocol = literalString(values, "protocol");
          const filters = stringList(node, "filterKeys") ?? [];
          const scope = literalString(values, "filterScope");
          if ((scope === "NONE") !== (filters.length === 0)) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.sns-filter-scope-mismatch",
                severity: "error",
                title: "SNS filter scope and keys do not match",
                beginnerExplanation:
                  "Choose no filter with no keys, or choose attributes/body and list the reviewed keys.",
                technicalExplanation:
                  "filterScope NONE requires an empty filterKeys list and a non-NONE scope requires at least one bounded key.",
                affected: [
                  nodeConfigurationLocation(node, index, "filterScope"),
                  nodeConfigurationLocation(node, index, "filterKeys"),
                ],
              }),
            );
          }
          if (
            literalBoolean(values, "rawMessageDelivery") === true &&
            protocol !== "SQS"
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.sns-raw-delivery-requires-sqs",
                severity: "error",
                title: "Raw SNS delivery is supported only for SQS",
                beginnerExplanation:
                  "Turn raw delivery off for Lambda subscriptions.",
                technicalExplanation:
                  "The curated rawMessageDelivery option is valid only for protocol SQS.",
                affected: [
                  nodeConfigurationLocation(node, index, "rawMessageDelivery"),
                ],
              }),
            );
          }
          const outgoing = allEdges.filter(
            ({ edge }) =>
              String(edge.semantic.source.nodeId) === String(node.id),
          );
          const primaryEdges = outgoing.filter(({ edge }) =>
            SNS_PRIMARY_RELATIONSHIPS.has(relationship(edge)),
          );
          const expected =
            protocol === "LAMBDA"
              ? RELATIONSHIPS.snsLambda
              : protocol === "SQS"
                ? RELATIONSHIPS.snsSqs
                : undefined;
          if (
            expected === undefined ||
            primaryEdges.length !== 1 ||
            primaryEdges[0] === undefined ||
            relationship(primaryEdges[0].edge) !== expected
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.sns-subscription-protocol-target-mismatch",
                severity: "error",
                title: "SNS subscription protocol does not match its target",
                beginnerExplanation:
                  "Connect exactly one Lambda or queue that matches the selected protocol.",
                technicalExplanation:
                  "The subscription protocol must match one exact typed destination edge.",
                affected: [nodeLocation(node, index)],
              }),
            );
          }
          const ownerEdge = allEdges.find(
            ({ edge }) =>
              String(edge.semantic.target.nodeId) === String(node.id) &&
              relationship(edge) === RELATIONSHIPS.snsOwnsSubscription,
          );
          const ownerTopic =
            ownerEdge === undefined
              ? undefined
              : byId.get(String(ownerEdge.edge.semantic.source.nodeId));
          if (
            protocol === "LAMBDA" &&
            ownerTopic !== undefined &&
            topicType(ownerTopic.node) === "FIFO"
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.sns-fifo-lambda-unsupported",
                severity: "error",
                title: "FIFO SNS topics cannot invoke Lambda directly",
                beginnerExplanation:
                  "Use a Standard topic, or put an SQS queue between the FIFO topic and Lambda.",
                technicalExplanation:
                  "The curated Lambda subscription protocol is unsupported for FIFO SNS topics; FIFO-to-Lambda delivery requires an SQS intermediary.",
                affected: [nodeLocation(node, index)],
              }),
            );
          }
        }

        if (service === "aws.eventbridge.target") {
          const targetType = literalString(values, "targetType");
          const expected = targetRelationship(targetType);
          const outgoing = allEdges.filter(
            ({ edge }) =>
              String(edge.semantic.source.nodeId) === String(node.id),
          );
          const primaryEdges = outgoing.filter(({ edge }) =>
            EVENTBRIDGE_PRIMARY_RELATIONSHIPS.has(relationship(edge)),
          );
          if (
            expected === undefined ||
            primaryEdges.length !== 1 ||
            primaryEdges[0] === undefined ||
            relationship(primaryEdges[0].edge) !== expected
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.eventbridge-target-type-mismatch",
                severity: "error",
                title: "EventBridge target type does not match its destination",
                beginnerExplanation:
                  "Connect exactly one destination that matches the selected target type.",
                technicalExplanation:
                  "targetType must correspond to one exact target relationship and service endpoint.",
                affected: [nodeLocation(node, index)],
              }),
            );
          }
          const roleEdges = allEdges.filter(
            ({ edge }) =>
              String(edge.semantic.target.nodeId) === String(node.id) &&
              relationship(edge) === RELATIONSHIPS.targetRole,
          );
          const requiresRole = targetType === "STEP_FUNCTIONS";
          if (
            (requiresRole && roleEdges.length !== 1) ||
            (!requiresRole && roleEdges.length !== 0)
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.eventbridge-execution-role-mismatch",
                severity: "error",
                title:
                  "EventBridge execution role does not match the target type",
                beginnerExplanation:
                  "Connect one EventBridge role for Step Functions, and remove it for Lambda, SNS, or SQS targets.",
                technicalExplanation:
                  "STEP_FUNCTIONS requires exactly one events.amazonaws.com execution-role edge; the curated resource-policy targets require none.",
                affected: [
                  nodeLocation(node, index),
                  ...roleEdges.map(({ edge, index: edgeIndex }) =>
                    edgeLocation(edge, edgeIndex),
                  ),
                ],
              }),
            );
          }
          const sqsTargetEdge = primaryEdges.find(
            ({ edge }) => relationship(edge) === RELATIONSHIPS.targetSqs,
          );
          const sqsTarget =
            sqsTargetEdge === undefined
              ? undefined
              : byId.get(String(sqsTargetEdge.edge.semantic.target.nodeId));
          if (
            sqsTargetEdge !== undefined &&
            sqsTarget !== undefined &&
            queueType(sqsTarget.node) === "FIFO"
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.eventbridge-fifo-sqs-target-unsupported",
                severity: "error",
                title: "FIFO SQS EventBridge targets are not yet supported",
                beginnerExplanation:
                  "Use a Standard queue until the target can store a reviewed FIFO message-group setting.",
                technicalExplanation:
                  "The curated target rejects FIFO SQS because target-specific SqsParameters.MessageGroupId is outside the current schema.",
                affected: [
                  edgeLocation(sqsTargetEdge.edge, sqsTargetEdge.index),
                ],
              }),
            );
          }
          const dlqEdges = outgoing.filter(
            ({ edge }) => relationship(edge) === RELATIONSHIPS.targetDlq,
          );
          if (
            (literalString(values, "deadLetterMode") === "SQS") !==
            (dlqEdges.length === 1)
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.eventbridge-dead-letter-policy-mismatch",
                severity: "error",
                title:
                  "EventBridge DLQ setting and queue connection do not match",
                beginnerExplanation:
                  "Choose SQS and connect one DLQ, or choose no DLQ and remove the DLQ connection.",
                technicalExplanation:
                  "deadLetterMode SQS requires exactly one typed dead-letter edge; NONE requires zero.",
                affected: [
                  nodeConfigurationLocation(node, index, "deadLetterMode"),
                ],
              }),
            );
          }
          for (const dlqEdge of dlqEdges) {
            const dlq = byId.get(String(dlqEdge.edge.semantic.target.nodeId));
            if (dlq !== undefined && queueType(dlq.node) === "FIFO") {
              findings.push(
                finding(descriptor, {
                  code: "aws.validation.eventbridge-dead-letter-fifo-unsupported",
                  severity: "error",
                  title: "EventBridge dead-letter queues must be Standard",
                  beginnerExplanation:
                    "Choose a Standard SQS queue for failed EventBridge deliveries.",
                  technicalExplanation:
                    "EventBridge target dead-letter configuration does not support FIFO queues.",
                  affected: [edgeLocation(dlqEdge.edge, dlqEdge.index)],
                }),
              );
            }
          }
          if (
            literalInteger(values, "maximumRetryAttempts") === 0 &&
            literalString(values, "deadLetterMode") === "NONE"
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.eventbridge-no-retry-or-dlq",
                severity: "warning",
                title: "EventBridge target has no retry or dead-letter path",
                beginnerExplanation:
                  "Add bounded retries or an SQS dead-letter queue unless dropping a failed delivery is intentional.",
                technicalExplanation:
                  "maximumRetryAttempts is zero and deadLetterMode is NONE, so failed delivery has no retained recovery path.",
                affected: [nodeLocation(node, index)],
              }),
            );
          }
        }
      }

      for (const entry of allEdges) {
        const rel = relationship(entry.edge);
        const source = byId.get(String(entry.edge.semantic.source.nodeId));
        const target = byId.get(String(entry.edge.semantic.target.nodeId));
        if (source === undefined || target === undefined) continue;
        if (
          rel === RELATIONSHIPS.busRule &&
          literalString(
            target.node.semantic.configuration.values,
            "triggerMode",
          ) === "SCHEDULE" &&
          literalString(
            source.node.semantic.configuration.values,
            "busType",
          ) !== "DEFAULT"
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.eventbridge-schedule-default-bus-required",
              severity: "error",
              title: "Scheduled EventBridge rules require the default bus",
              beginnerExplanation:
                "Connect this scheduled rule to the default EventBridge bus, or explicitly choose an event-pattern rule for a custom bus.",
              technicalExplanation:
                "EventBridge scheduled rules are supported only on the default event bus. Export cannot discard or reinterpret the explicit custom-bus association.",
              affected: [
                edgeLocation(entry.edge, entry.index),
                nodeConfigurationLocation(
                  target.node,
                  target.index,
                  "triggerMode",
                ),
              ],
            }),
          );
        }
        if (rel === RELATIONSHIPS.targetSns) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.eventbridge-sns-encryption-unsupported",
              severity: "error",
              title:
                "EventBridge delivery to the current SNS topic is unsupported",
              beginnerExplanation:
                "Current SNS topics use AWS-managed KMS keys, which cannot grant EventBridge access. Choose a supported Lambda or Standard SQS target.",
              technicalExplanation:
                "EventBridge-to-encrypted-SNS delivery requires a customer-managed topic key and explicit KMS service permissions. The current closed SNS contract supports only AWS_MANAGED_KMS and cannot represent those permissions.",
              affected: [
                edgeLocation(entry.edge, entry.index),
                nodeConfigurationLocation(
                  target.node,
                  target.index,
                  "encryption",
                ),
              ],
            }),
          );
        }
        if (
          rel === RELATIONSHIPS.sqsDlq &&
          queueType(source.node) !== queueType(target.node)
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.sqs-dead-letter-fifo-mismatch",
              severity: "error",
              title: "Source queue and dead-letter queue types must match",
              beginnerExplanation:
                "Use Standard with Standard or FIFO with FIFO for the dead-letter queue.",
              technicalExplanation:
                "AWS redrive requires compatible queue types; the curated catalog rejects mixed FIFO/Standard pairs.",
              affected: [edgeLocation(entry.edge, entry.index)],
            }),
          );
        }
        if (rel === RELATIONSHIPS.lambdaSqs) {
          const ordering = literalString(
            entry.edge.semantic.configuration.values,
            "ordering",
          );
          if (
            (queueType(target.node) === "FIFO") !==
            (ordering === "EVENT_CONTRACT_KEY")
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.sqs-producer-ordering-mismatch",
                severity: "error",
                title: "Queue ordering and producer key do not match",
                beginnerExplanation:
                  "FIFO needs a reviewed event-contract group key; Standard must use unordered delivery.",
                technicalExplanation:
                  "FIFO SendMessage requires EVENT_CONTRACT_KEY while Standard uses NOT_GUARANTEED.",
                affected: [
                  edgeConfigurationLocation(
                    entry.edge,
                    entry.index,
                    "ordering",
                  ),
                ],
              }),
            );
          }
        }
        if (rel === RELATIONSHIPS.lambdaSns) {
          const ordering = literalString(
            entry.edge.semantic.configuration.values,
            "ordering",
          );
          if (
            (topicType(target.node) === "FIFO") !==
            (ordering === "EVENT_CONTRACT_KEY")
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.sns-producer-ordering-mismatch",
                severity: "error",
                title: "Topic ordering and producer key do not match",
                beginnerExplanation:
                  "FIFO needs a reviewed event-contract group key; Standard must use unordered delivery.",
                technicalExplanation:
                  "FIFO Publish requires EVENT_CONTRACT_KEY while Standard uses NOT_GUARANTEED.",
                affected: [
                  edgeConfigurationLocation(
                    entry.edge,
                    entry.index,
                    "ordering",
                  ),
                ],
              }),
            );
          }
        }
        if (
          rel === RELATIONSHIPS.lambdaDlq &&
          queueType(target.node) === "FIFO"
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.lambda-dead-letter-fifo-unsupported",
              severity: "error",
              title: "Lambda dead-letter queues must be Standard",
              beginnerExplanation:
                "Choose a Standard SQS queue for failed asynchronous Lambda invocations.",
              technicalExplanation:
                "Lambda asynchronous dead-letter configuration does not support FIFO SQS queues.",
              affected: [edgeLocation(entry.edge, entry.index)],
            }),
          );
        }
        if (rel === RELATIONSHIPS.sqsLambda) {
          const visibility =
            literalInteger(
              source.node.semantic.configuration.values,
              "visibilityTimeoutSeconds",
            ) ?? 0;
          const timeout =
            literalInteger(
              target.node.semantic.configuration.values,
              "timeoutSeconds",
            ) ?? 0;
          const window =
            literalInteger(
              entry.edge.semantic.configuration.values,
              "batchingWindowSeconds",
            ) ?? 0;
          if (queueType(source.node) === "FIFO" && window !== 0) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.sqs-fifo-batching-window-unsupported",
                severity: "error",
                title: "FIFO queues require a zero batching window",
                beginnerExplanation:
                  "Set the Lambda consumer batching window to zero for a FIFO queue.",
                technicalExplanation:
                  "Lambda SQS event-source mappings do not support batching windows for FIFO queues; batchingWindowSeconds must be zero.",
                affected: [
                  edgeConfigurationLocation(
                    entry.edge,
                    entry.index,
                    "batchingWindowSeconds",
                  ),
                  nodeConfigurationLocation(
                    source.node,
                    source.index,
                    "queueType",
                  ),
                ],
              }),
            );
          }
          if (visibility <= timeout + window) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.sqs-visibility-timeout-conflict",
                severity: "error",
                title: "Queue visibility timeout is too short for the consumer",
                beginnerExplanation:
                  "Increase queue visibility beyond the function timeout plus its batching window.",
                technicalExplanation:
                  "visibilityTimeoutSeconds must exceed Lambda timeoutSeconds + batchingWindowSeconds to reduce overlapping redelivery.",
                affected: [
                  nodeConfigurationLocation(
                    source.node,
                    source.index,
                    "visibilityTimeoutSeconds",
                  ),
                  edgeConfigurationLocation(
                    entry.edge,
                    entry.index,
                    "batchingWindowSeconds",
                  ),
                  nodeConfigurationLocation(
                    target.node,
                    target.index,
                    "timeoutSeconds",
                  ),
                ],
              }),
            );
          }
        }
        if (rel === RELATIONSHIPS.sfnLambda) {
          const taskTimeout =
            literalInteger(
              entry.edge.semantic.configuration.values,
              "taskTimeoutSeconds",
            ) ?? 0;
          const lambdaTimeout =
            literalInteger(
              target.node.semantic.configuration.values,
              "timeoutSeconds",
            ) ?? 0;
          const retryMode = literalString(
            entry.edge.semantic.configuration.values,
            "retryMode",
          );
          const attempts =
            literalInteger(
              entry.edge.semantic.configuration.values,
              "maximumAttempts",
            ) ?? 0;
          if (
            taskTimeout < lambdaTimeout ||
            (retryMode === "NONE" ? attempts !== 1 : attempts <= 1)
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.step-functions-retry-timeout-conflict",
                severity: "error",
                title: "Workflow task timeout or retry settings conflict",
                beginnerExplanation:
                  "Keep the task timeout at least as long as the function and match the attempt count to the retry choice.",
                technicalExplanation:
                  "taskTimeoutSeconds must cover Lambda timeoutSeconds; NONE requires one attempt and bounded exponential retry requires more than one.",
                affected: [edgeLocation(entry.edge, entry.index)],
              }),
            );
          }
        }
      }
      return findings;
    },
  });
}
