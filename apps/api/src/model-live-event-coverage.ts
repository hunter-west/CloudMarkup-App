import {
  getArchitectureDocumentContentHash,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import { resolveAwsCurrentCatalogV1 } from "@cloudmarkup/provider-aws";
import { validateProviderConfigurationV1 } from "@cloudmarkup/provider-sdk";
import {
  digestCanonicalValue,
  type ArchitectureDocumentV3,
} from "@cloudmarkup/schemas";

type Node = ArchitectureDocumentV3["nodes"][number];
type Values = Node["semantic"]["configuration"]["values"];
const value = (values: Values | undefined, key: string) =>
  Object.entries(values ?? {}).find(([name]) => name === key)?.[1];
const literal = (values: Values | undefined, key: string) => {
  const v = value(values, key);
  return v?.kind === "string" || v?.kind === "integer" || v?.kind === "boolean"
    ? v.value
    : undefined;
};
const settings = (node: Node | undefined) =>
  node?.semantic.configuration.values;
const one = <T>(items: readonly T[]) =>
  items.length === 1 ? items[0] : undefined;

/** Inspect actual typed topology and IAM bindings for the frozen image event case.
 * Coverage does not establish provider-rule safety, working image transformation,
 * compiler readiness, receipt issuance or promotion. Labels never assign a role. */
export function inspectModelLiveEventCoverage(raw: unknown) {
  const document = parseArchitectureDocument(raw);
  const awsCatalogV1 = (() => {
    try {
      return resolveAwsCurrentCatalogV1(document.catalog).catalog;
    } catch {
      throw Error("The current event evaluation catalog is unavailable.");
    }
  })();
  if (
    document.provider.id !== "aws.cloudmarkup" ||
    document.catalog.id !== awsCatalogV1.artifact.catalog.id ||
    document.catalog.version !== awsCatalogV1.artifact.catalog.version ||
    document.catalog.digest !== awsCatalogV1.artifact.digest
  )
    throw Error("The current event evaluation catalog is unavailable.");
  const nodes = new Map<string, Node>(document.nodes.map((n) => [n.id, n]));
  const rules = new Map(
    awsCatalogV1
      .listConnectionRules()
      .map((r) => [String(r.relationshipType), r]),
  );
  const edges = document.edges.filter((e) => {
    const rule = rules.get(e.semantic.relationshipType);
    return (
      rule !== undefined &&
      nodes.get(e.semantic.source.nodeId)?.semantic.serviceType ===
        rule.source.serviceId &&
      nodes.get(e.semantic.target.nodeId)?.semantic.serviceType ===
        rule.target.serviceId &&
      e.semantic.source.port === rule.source.portId &&
      e.semantic.target.port === rule.target.portId &&
      e.semantic.configuration.schemaId === rule.configuration.schemaId &&
      e.semantic.configuration.schemaVersion ===
        rule.configuration.schemaVersion &&
      validateProviderConfigurationV1(
        rule.configuration,
        e.semantic.configuration.values,
      ).success
    );
  });
  const linked = (id: string, relation: string, reverse = false) =>
    edges
      .filter(
        (e) =>
          e.semantic.relationshipType === relation &&
          (reverse ? e.semantic.target.nodeId : e.semantic.source.nodeId) ===
            id,
      )
      .flatMap((e) => {
        const n = nodes.get(
          reverse ? e.semantic.source.nodeId : e.semantic.target.nodeId,
        );
        return n ? [n] : [];
      });
  const children = (id: string, relation: string) =>
    linked(id, relation, true).filter(
      (n) =>
        n.semantic.parent?.nodeId === id &&
        n.semantic.parent.relationshipType === relation,
    );
  const statements = (policy: Node) =>
    children(policy.id, "aws.iam.policy-contains-statement");
  const notification = one(
    edges.filter(
      (e) => e.semantic.relationshipType === "aws.s3.notifies-lambda",
    ),
  );
  const input = notification
    ? nodes.get(notification.semantic.source.nodeId)
    : undefined;
  const fn = notification
    ? nodes.get(notification.semantic.target.nodeId)
    : undefined;
  const role = fn
    ? one(linked(fn.id, "aws.iam.role-assumed-by-lambda", true))
    : undefined;
  const policies = role
    ? [
        ...children(role.id, "aws.iam.role-owns-inline-policy"),
        ...children(role.id, "aws.iam.role-owns-generated-permission"),
      ]
    : [];
  const grants = policies
    .flatMap((p) => statements(p))
    .filter(
      (s) =>
        literal(settings(s), "effect") === "allow" &&
        literal(settings(s), "principalKind") === "none" &&
        value(settings(s), "principals")?.kind === "string-list" &&
        (value(settings(s), "principals") as { value: string[] }).value
          .length === 0 &&
        value(settings(s), "resourceExpressions")?.kind === "string-list" &&
        (value(settings(s), "resourceExpressions") as { value: string[] }).value
          .length === 0,
    );
  const authorizes = (
    statement: Node,
    action: string,
    resource: Node,
    relation: string,
  ) => {
    const actions = value(settings(statement), "actions"),
      target = value(settings(statement), "resourceNode");
    return (
      actions?.kind === "string-list" &&
      actions.value.length === 1 &&
      actions.value[0] === action &&
      target?.kind === "node-reference" &&
      target.nodeId === resource.id &&
      target.attribute === resource.semantic.serviceType + ".arn" &&
      one(linked(statement.id, relation))?.id === resource.id
    );
  };
  const outputs = document.nodes.filter(
    (n) =>
      n.semantic.serviceType === "aws.s3.bucket" &&
      n.id !== input?.id &&
      grants.some((s) =>
        authorizes(s, "s3:PutObject", n, "aws.iam.authorizes-s3-bucket"),
      ),
  );
  const output = one(outputs);
  const dlq = fn
    ? one(linked(fn.id, "aws.lambda.uses-sqs-dead-letter-queue"))
    : undefined;
  const log = fn
    ? one(linked(fn.id, "aws.lambda.writes-log-group"))
    : undefined;
  const notificationSettings = notification?.semantic.configuration.values;
  const timeout = literal(settings(fn), "timeoutSeconds"),
    concurrency = literal(settings(fn), "reservedConcurrency"),
    retention = literal(settings(dlq), "messageRetentionSeconds");
  const invocations = fn
    ? children(fn.id, "aws.lambda.owns-invocation-permission")
        .filter((p) => literal(settings(p), "policyKind") === "service-grant")
        .flatMap(statements)
    : [];
  const invocationPermission =
    fn !== undefined &&
    input !== undefined &&
    invocations.some((s) => {
      const principals = value(settings(s), "principals");
      const conditions = children(s.id, "aws.iam.statement-owns-condition");
      return (
        literal(settings(s), "effect") === "allow" &&
        literal(settings(s), "principalKind") === "service" &&
        principals?.kind === "string-list" &&
        principals.value.length === 1 &&
        principals.value[0] === "s3.amazonaws.com" &&
        authorizes(
          s,
          "lambda:InvokeFunction",
          fn,
          "aws.iam.authorizes-lambda-function",
        ) &&
        conditions.some((c) => {
          const values = value(settings(c), "values");
          return (
            literal(settings(c), "operator") === "ArnEquals" &&
            literal(settings(c), "key") === "AWS:SourceArn" &&
            values?.kind === "string-list" &&
            values.value.length === 1 &&
            values.value[0] ===
              "arn:aws:s3:::" + String(literal(settings(input), "bucketName"))
          );
        })
      );
    });
  const criteria = [
    [
      "object-created-asynchronous-invocation",
      input !== undefined &&
        fn !== undefined &&
        literal(notificationSettings, "eventType") === "OBJECT_CREATED" &&
        literal(notificationSettings, "deliverySemantics") ===
          "AT_LEAST_ONCE_UNORDERED",
    ],
    [
      "separate-output-bucket",
      output !== undefined &&
        input !== undefined &&
        typeof literal(settings(input), "bucketName") === "string" &&
        typeof literal(settings(output), "bucketName") === "string" &&
        literal(settings(input), "bucketName") !==
          literal(settings(output), "bucketName"),
    ],
    [
      "scoped-input-object-read",
      input !== undefined &&
        grants.some((s) =>
          authorizes(s, "s3:GetObject", input, "aws.iam.authorizes-s3-bucket"),
        ),
    ],
    ["explicit-execution-role", role !== undefined],
    ["scoped-s3-invocation-permission", invocationPermission],
    [
      "nonrecursive-output",
      output !== undefined &&
        !edges.some(
          (e) =>
            e.semantic.source.nodeId === output.id &&
            e.semantic.relationshipType === "aws.s3.notifies-lambda",
        ),
    ],
    [
      "bounded-failure-destination",
      dlq?.semantic.serviceType === "aws.sqs.queue" &&
        literal(settings(dlq), "queueType") === "STANDARD" &&
        grants.some((s) =>
          authorizes(s, "sqs:SendMessage", dlq, "aws.iam.authorizes-sqs-queue"),
        ) &&
        typeof retention === "number" &&
        [3600, 86400, 345600, 1209600].includes(retention) &&
        typeof timeout === "number" &&
        timeout >= 1 &&
        timeout <= 30 &&
        typeof concurrency === "number" &&
        concurrency >= 1 &&
        concurrency <= 100,
    ],
    [
      "explicit-log-destination",
      log?.semantic.serviceType === "aws.cloudwatch.log-group",
    ],
    [
      "private-encrypted-buckets",
      input !== undefined &&
        output !== undefined &&
        [input, output].every(
          (n) =>
            literal(settings(n), "blockPublicAccess") === true &&
            literal(settings(n), "encryption") === "SSE-S3" &&
            literal(settings(n), "versioningEnabled") === true,
        ),
    ],
  ] as const;
  const measured = criteria.map(([criterion, satisfied]) => ({
    criterion,
    satisfied,
  }));
  const body = {
    inspectorId: "cloudmarkup.event-requirement-coverage.v1",
    inspectorVersion: "1.0.0",
    architectureContentDigest: getArchitectureDocumentContentHash(document),
    criteria: measured,
    numerator: measured.filter((c) => c.satisfied).length,
    denominator: measured.length,
  };
  return { ...body, inspectionDigest: digestCanonicalValue(body) };
}
