import { isDeepStrictEqual as equal } from "node:util";
export const BETA_PROPOSAL_WORKER = "cloudmarkup-beta-proposal-worker";
export const BETA_PROPOSAL_QUEUE = "cloudmarkup-beta-proposals.fifo";
export const BETA_PROPOSAL_DLQ = "cloudmarkup-beta-proposals-dlq.fifo";
const ref = (id) => ({ Ref: id }),
  arn = (id) => ({ "Fn::GetAtt": [id, "Arn"] });
const vars = (item) => item?.resource.Properties?.Environment?.Variables ?? {};
/** Closed transport contract; runtime grants remain in the reviewed owner bootstrap. */
export function validateBetaProposalDelivery(resources, enabled) {
  const findings = [];
  const fail = (detail) =>
    findings.push({
      code: "BETA_PROPOSAL_DELIVERY_INVALID",
      path: "cloudmarkup-beta-application",
      detail,
    });
  const named = (type, key, value) =>
    resources.filter(
      (item) =>
        item.resource.Type === type &&
        item.resource.Properties?.[key] === value,
    );
  const workers = named(
      "AWS::Lambda::Function",
      "FunctionName",
      BETA_PROPOSAL_WORKER,
    ),
    queues = named("AWS::SQS::Queue", "QueueName", BETA_PROPOSAL_QUEUE),
    dlqs = named("AWS::SQS::Queue", "QueueName", BETA_PROPOSAL_DLQ);
  const configured = resources.filter((item) =>
    Object.keys(vars(item)).some((key) =>
      key.startsWith("CLOUDMARKUP_BETA_PROPOSAL_"),
    ),
  );
  if (!enabled) {
    if (workers.length || queues.length || dlqs.length || configured.length)
      fail("Background proposals require the explicit beta export profile.");
    return findings;
  }
  const [worker] = workers,
    [queue] = queues,
    [dlq] = dlqs,
    [api] = named(
      "AWS::Lambda::Function",
      "FunctionName",
      "cloudmarkup-beta-api",
    );
  if (
    workers.length !== 1 ||
    queues.length !== 1 ||
    dlqs.length !== 1 ||
    !api ||
    [worker, queue, dlq].some(
      (item) =>
        item.stack !== "cloudmarkup-beta-application" ||
        item.resource.Condition !== undefined,
    )
  ) {
    fail(
      "Exactly one proposal worker and two retained FIFO queues are required.",
    );
    return findings;
  }
  const bindings = {
    CLOUDMARKUP_BETA_PROPOSAL_QUEUE_ARN: arn(queue.id),
  };
  if (
    configured.length !== 2 ||
    configured.some((item) => item !== worker && item !== api) ||
    configured.some((item) =>
      Object.keys(vars(item)).some(
        (key) =>
          key.startsWith("CLOUDMARKUP_BETA_PROPOSAL_") &&
          !Object.hasOwn(bindings, key),
      ),
    ) ||
    !Object.entries(bindings).every(([key, value]) =>
      equal(vars(api)[key], value),
    )
  )
    fail(
      "Only the API and proposal worker may carry their exact queue references.",
    );
  const apiVars = vars(api),
    p = worker.resource.Properties;
  const expectedEnvironment = {
    ...bindings,
    CLOUDMARKUP_BETA_AI_ENABLED: "true",
    CLOUDMARKUP_ENVIRONMENT: "beta",
    CLOUDMARKUP_DATABASE_ARN: apiVars.CLOUDMARKUP_DATABASE_ARN,
    CLOUDMARKUP_DATABASE_SECRET_ARN: apiVars.CLOUDMARKUP_DATABASE_SECRET_ARN,
    CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
    CLOUDMARKUP_CONTENT_BUCKET: apiVars.CLOUDMARKUP_CONTENT_BUCKET,
    CLOUDMARKUP_OBJECT_DOCUMENT_PREFIX:
      apiVars.CLOUDMARKUP_OBJECT_DOCUMENT_PREFIX,
    NODE_OPTIONS: "--enable-source-maps",
  };
  if (
    !equal(vars(worker), expectedEnvironment) ||
    p.Runtime !== "nodejs24.x" ||
    p.Handler !== "index.handler" ||
    p.Timeout !== 240 ||
    p.MemorySize !== 1024 ||
    p.ReservedConcurrentExecutions !== 2 ||
    !equal(p.Architectures, ["arm64"]) ||
    !equal(p.Role, {
      "Fn::Join": [
        "",
        [
          "arn:",
          ref("AWS::Partition"),
          ":iam::000000000000:role/CloudMarkup-Beta-Proposal-Worker-Runtime",
        ],
      ],
    }) ||
    p.VpcConfig !== undefined ||
    p.Layers !== undefined ||
    p.FileSystemConfigs !== undefined
  )
    fail(
      "The proposal worker must retain its exact role, environment, execution limits and isolated transport.",
    );
  for (const item of [queue, dlq]) {
    const expected = {
      QueueName: item === queue ? BETA_PROPOSAL_QUEUE : BETA_PROPOSAL_DLQ,
      FifoQueue: true,
      SqsManagedSseEnabled: true,
      MessageRetentionPeriod: item === queue ? 86400 : 1209600,
      ...(item === queue
        ? {
            ContentBasedDeduplication: false,
            VisibilityTimeout: 1500,
            RedrivePolicy: {
              deadLetterTargetArn: arn(dlq.id),
              maxReceiveCount: 5,
            },
          }
        : {}),
    };
    const props = item.resource.Properties;
    if (
      item.resource.DeletionPolicy !== "RetainExceptOnCreate" ||
      item.resource.UpdateReplacePolicy !== "Retain" ||
      !equal(
        Object.keys(props).sort(),
        [...Object.keys(expected), "Tags"].sort(),
      ) ||
      !Object.entries(expected).every(([key, value]) =>
        equal(props[key], value),
      )
    )
      fail(
        "Proposal queues require the exact encrypted retained FIFO settings.",
      );
    const policies = resources.filter(
      (entry) =>
        entry.resource.Type === "AWS::SQS::QueuePolicy" &&
        equal(entry.resource.Properties?.Queues, [ref(item.id)]),
    );
    if (
      policies.length !== 1 ||
      policies[0].resource.Condition !== undefined ||
      !equal(policies[0].resource.Properties, {
        Queues: [ref(item.id)],
        PolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Action: "sqs:*",
              Effect: "Deny",
              Principal: { AWS: "*" },
              Resource: arn(item.id),
              Condition: { Bool: { "aws:SecureTransport": "false" } },
            },
          ],
        },
      })
    )
      fail("Proposal queue policies permit only the exact TLS denial.");
  }
  const mappings = resources.filter(
    (item) =>
      item.resource.Type === "AWS::Lambda::EventSourceMapping" &&
      (equal(item.resource.Properties?.FunctionName, ref(worker.id)) ||
        equal(item.resource.Properties?.EventSourceArn, arn(queue.id))),
  );
  if (
    mappings.length !== 1 ||
    mappings[0].resource.Condition !== undefined ||
    !equal(mappings[0].resource.Properties, {
      BatchSize: 1,
      EventSourceArn: arn(queue.id),
      FunctionName: ref(worker.id),
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      ScalingConfig: { MaximumConcurrency: 2 },
    })
  )
    fail(
      "Exactly one untagged partial-batch consumer must bind the proposal queue and worker.",
    );
  return findings;
}
