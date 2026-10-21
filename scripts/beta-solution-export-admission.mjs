import { isDeepStrictEqual as equal } from "node:util";

export const BETA_CLOUDFORMATION_PROFILE =
  "stripe-sandbox-github-cloudformation-v1";
export const BETA_LIVE_PROFILE = "stripe-live-github-cloudformation-v1";
export const BETA_EXPORT_QUEUE = "cloudmarkup-beta-solution-exports.fifo";
export const BETA_EXPORT_DLQ = "cloudmarkup-beta-solution-exports-dlq.fifo";
export const BETA_EXPORT_WORKER = "cloudmarkup-beta-solution-export-worker";
export const BETA_EXPORT_LAYER = "cloudmarkup-beta-solution-export-runtime";
const application = "cloudmarkup-beta-application";
const observability = "cloudmarkup-beta-observability";
const bucket = "cloudmarkup-beta-cdk-assets-000000000000-us-east-1";
const ref = (id) => ({ Ref: id });
const arn = (id) => ({ "Fn::GetAtt": [id, "Arn"] });
const keys = (value, expected) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  equal(Object.keys(value).sort(), [...expected].sort());
const variables = (item) =>
  item?.resource.Properties?.Environment?.Variables ?? {};
const runtimePaths = [
  "cloudmarkup-export/cloudmarkup-iac",
  "cloudmarkup-export/diagram-icons.json",
  "cloudmarkup-export/fonts/inter-latin-400-normal.ttf",
  "cloudmarkup-export/fonts/inter-latin-600-normal.ttf",
  "nodejs/node_modules/@resvg/resvg-js/package.json",
  "nodejs/node_modules/@resvg/resvg-js/index.js",
  "nodejs/node_modules/@resvg/resvg-js/js-binding.js",
  "nodejs/node_modules/@resvg/resvg-js/LICENSE",
  "nodejs/node_modules/@resvg/resvg-js-linux-arm64-gnu/package.json",
  "nodejs/node_modules/@resvg/resvg-js-linux-arm64-gnu/resvgjs.linux-arm64-gnu.node",
  "nodejs/node_modules/@fontsource/inter/package.json",
  "nodejs/node_modules/@fontsource/inter/LICENSE",
  "nodejs/node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2",
  "nodejs/node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2",
].sort();
// Independent pins from the locked resvg 2.6.2 and Inter 5.3.0 packages.
// A layer manifest cannot authorize replacement JavaScript or package entrypoints.
const reviewedRuntimeCodeHashes = Object.freeze({
  "nodejs/node_modules/@resvg/resvg-js/package.json":
    "2669617af27d91b0dfc0828cc2190ba87b8d8ea6e4cf08619a23784a2f1d8c95",
  "nodejs/node_modules/@resvg/resvg-js/index.js":
    "b670803d88b380b0610edf743d8b74dcc132d9e2aa6aaa04cfaa06b2fcad397d",
  "nodejs/node_modules/@resvg/resvg-js/js-binding.js":
    "d5fbe3b7450d1e393ea9856e86e16465d25be8743cae7db03e2f3249aed61e56",
  "nodejs/node_modules/@resvg/resvg-js-linux-arm64-gnu/package.json":
    "b6aacc28e1dc53db8bda6345c35b698e5b211a47d28f3e55704045780687cca8",
  "nodejs/node_modules/@fontsource/inter/package.json":
    "05d03ec21754e37cf7da007c840e2f0a893c8161a53ee782d7c810e8a99c7cc5",
});
function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
function ownedLog(stacks, item) {
  const reference = item.resource.Properties?.LoggingConfig?.LogGroup;
  if (
    !keys(reference, ["Fn::ImportValue"]) ||
    typeof reference["Fn::ImportValue"] !== "string" ||
    reference["Fn::ImportValue"].length === 0
  )
    return false;
  const owners = stacks.filter((value) => value.stackName === observability);
  if (owners.length !== 1) return false;
  const stack = owners[0];
  const logs = Object.entries(stack.template.Resources ?? {}).filter(
    ([, value]) =>
      value.Type === "AWS::Logs::LogGroup" &&
      value.Properties?.LogGroupName === "/aws/lambda/" + BETA_EXPORT_WORKER,
  );
  if (
    logs.length !== 1 ||
    logs[0][1].Condition !== undefined ||
    logs[0][1].Properties.RetentionInDays !== 90 ||
    logs[0][1].DeletionPolicy !== "RetainExceptOnCreate" ||
    logs[0][1].UpdateReplacePolicy !== "Retain"
  )
    return false;
  const outputs = Object.values(stack.template.Outputs ?? {}).filter(
    (output) => output.Export?.Name === reference["Fn::ImportValue"],
  );
  return (
    outputs.length === 1 &&
    outputs[0].Condition === undefined &&
    equal(outputs[0].Value, ref(logs[0][0]))
  );
}
function sharedContentBucket(stacks, api, worker) {
  const value = variables(api).CLOUDMARKUP_CONTENT_BUCKET;
  if (
    !keys(value, ["Fn::ImportValue"]) ||
    typeof value["Fn::ImportValue"] !== "string" ||
    value["Fn::ImportValue"].length === 0 ||
    !equal(value, variables(worker).CLOUDMARKUP_CONTENT_BUCKET)
  )
    return false;
  const owners = stacks.filter(
    (stack) => stack.stackName === "cloudmarkup-beta-stateful",
  );
  if (owners.length !== 1) return false;
  const owner = owners[0];
  const buckets = Object.entries(owner.template.Resources ?? {}).filter(
    ([, resource]) =>
      resource.Type === "AWS::S3::Bucket" &&
      resource.Properties?.BucketName ===
        "cloudmarkup-beta-000000000000-us-east-1-content",
  );
  if (buckets.length !== 1 || buckets[0][1].Condition !== undefined)
    return false;
  const outputs = Object.values(owner.template.Outputs ?? {}).filter(
    (output) => output.Export?.Name === value["Fn::ImportValue"],
  );
  return (
    outputs.length === 1 &&
    outputs[0].Condition === undefined &&
    equal(outputs[0].Value, ref(buckets[0][0]))
  );
}
/** The export profile admits one fixed offline worker and its exact local assets. */
export function validateBetaSolutionExport(stacks, profile, assets = []) {
  const findings = [];
  const fail = (suffix, detail) =>
    findings.push({
      code: "BETA_SOLUTION_EXPORT_" + suffix,
      path: application,
      detail,
    });
  const resources = stacks.flatMap((stack) =>
    Object.entries(stack.template.Resources ?? {}).map(([id, resource]) => ({
      id,
      resource,
      stack: stack.stackName,
    })),
  );
  const named = (type, property, name) =>
    resources.filter(
      (item) =>
        item.resource.Type === type &&
        item.resource.Properties?.[property] === name,
    );
  const functions = resources.filter(
    (item) => item.resource.Type === "AWS::Lambda::Function",
  );
  const queues = named("AWS::SQS::Queue", "QueueName", BETA_EXPORT_QUEUE);
  const dlqs = named("AWS::SQS::Queue", "QueueName", BETA_EXPORT_DLQ);
  const workers = named(
    "AWS::Lambda::Function",
    "FunctionName",
    BETA_EXPORT_WORKER,
  );
  const layers = named(
    "AWS::Lambda::LayerVersion",
    "LayerName",
    BETA_EXPORT_LAYER,
  );
  const enabled = [BETA_CLOUDFORMATION_PROFILE, BETA_LIVE_PROFILE].includes(
    profile.profile,
  );
  const exportKeys = functions.flatMap((item) =>
    Object.keys(variables(item)).filter((key) =>
      key.startsWith("CLOUDMARKUP_SOLUTION_EXPORT"),
    ),
  );
  if (!enabled) {
    if (
      queues.length ||
      dlqs.length ||
      workers.length ||
      layers.length ||
      exportKeys.length
    )
      fail(
        "INACTIVE",
        "Historical service profiles must omit all export runtime resources and activation inputs.",
      );
    return findings;
  }
  const groups = [
    queues,
    dlqs,
    workers,
    layers,
    named("AWS::Lambda::Function", "FunctionName", "cloudmarkup-beta-api"),
  ];
  if (
    groups.some(
      (group) =>
        group.length !== 1 ||
        group[0].stack !== application ||
        group[0].resource.Condition !== undefined,
    )
  ) {
    fail(
      "IDENTITY",
      "Export resources require one unconditional resource of each exact name in the application stack.",
    );
    return findings;
  }
  const [queue, dlq, worker, layer, api] = groups.map((group) => group[0]);
  const apiEnv = variables(api);
  const expectedEnv = {
    CLOUDMARKUP_SOLUTION_EXPORTS_ENABLED: "true",
    CLOUDMARKUP_SOLUTION_EXPORT_PROFILE:
      "cloudformation-infrastructure-only-v1",
    CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_PATH:
      "/opt/cloudmarkup-export/cloudmarkup-iac",
    CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_SHA256:
      apiEnv.CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_SHA256,
    CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_PATH:
      "/opt/cloudmarkup-export/diagram-icons.json",
    CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_SHA256:
      apiEnv.CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_SHA256,
    CLOUDMARKUP_SOLUTION_EXPORT_TARGET_SETTINGS_DIGEST:
      apiEnv.CLOUDMARKUP_SOLUTION_EXPORT_TARGET_SETTINGS_DIGEST,
    CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_ARN: arn(queue.id),
    CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_URL: ref(queue.id),
  };
  if (
    ![
      expectedEnv.CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_SHA256,
      expectedEnv.CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_SHA256,
    ].every(
      (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value),
    ) ||
    !/^sha256:[a-f0-9]{64}$/u.test(
      expectedEnv.CLOUDMARKUP_SOLUTION_EXPORT_TARGET_SETTINGS_DIGEST ?? "",
    ) ||
    functions.some((item) => {
      const selected = Object.fromEntries(
        Object.entries(variables(item)).filter(([key]) =>
          key.startsWith("CLOUDMARKUP_SOLUTION_EXPORT"),
        ),
      );
      return !equal(
        selected,
        item === api || item === worker ? expectedEnv : {},
      );
    })
  )
    fail(
      "ENVIRONMENT",
      "Only the API and dedicated worker may carry the exact digest-bound export selector and queue references.",
    );
  for (const item of [queue, dlq]) {
    const p = item.resource.Properties;
    const expected = {
      QueueName: item === queue ? BETA_EXPORT_QUEUE : BETA_EXPORT_DLQ,
      FifoQueue: true,
      SqsManagedSseEnabled: true,
      MessageRetentionPeriod: 1209600,
      ...(item === queue
        ? {
            ContentBasedDeduplication: false,
            VisibilityTimeout: 3600,
            RedrivePolicy: {
              deadLetterTargetArn: arn(dlq.id),
              maxReceiveCount: 5,
            },
          }
        : {}),
    };
    if (
      item.resource.DeletionPolicy !== "RetainExceptOnCreate" ||
      item.resource.UpdateReplacePolicy !== "Retain" ||
      !keys(p, [...Object.keys(expected), "Tags"]) ||
      !Object.entries(expected).every(([key, value]) => equal(p[key], value))
    )
      fail(
        "QUEUE",
        "Export FIFO queues must retain their exact encryption, retry, visibility and retention settings.",
      );
    const policies = resources.filter(
      (entry) =>
        entry.resource.Type === "AWS::SQS::QueuePolicy" &&
        equal(entry.resource.Properties?.Queues, [ref(item.id)]),
    );
    if (
      policies.length !== 1 ||
      policies[0].stack !== application ||
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
      fail(
        "QUEUE_POLICY",
        "Only the exact queue TLS denial is admitted; runtime grants remain in the owner bootstrap.",
      );
  }
  const mappings = resources.filter(
    (item) =>
      item.resource.Type === "AWS::Lambda::EventSourceMapping" &&
      (equal(item.resource.Properties?.FunctionName, ref(worker.id)) ||
        equal(item.resource.Properties?.EventSourceArn, arn(queue.id))),
  );
  if (
    mappings.length !== 1 ||
    mappings[0].stack !== application ||
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
      "CONSUMER",
      "Exactly one private partial-batch consumer must bind the export FIFO queue and worker.",
    );
  for (const [
    name,
    namespace,
    metric,
    dimension,
    value,
    threshold,
    statistic,
  ] of [
    [
      "cloudmarkup-beta-solution-export-worker-errors",
      "AWS/Lambda",
      "Errors",
      "FunctionName",
      BETA_EXPORT_WORKER,
      1,
      "Sum",
    ],
    [
      "cloudmarkup-beta-solution-export-dead-letters",
      "AWS/SQS",
      "ApproximateNumberOfMessagesVisible",
      "QueueName",
      BETA_EXPORT_DLQ,
      1,
      "Maximum",
    ],
    [
      "cloudmarkup-beta-solution-export-queue-age",
      "AWS/SQS",
      "ApproximateAgeOfOldestMessage",
      "QueueName",
      BETA_EXPORT_QUEUE,
      1800,
      "Maximum",
    ],
  ]) {
    const alarms = named("AWS::CloudWatch::Alarm", "AlarmName", name);
    const item = alarms[0];
    const properties = item?.resource.Properties ?? {};
    if (
      alarms.length !== 1 ||
      item.stack !== observability ||
      item.resource.Condition !== undefined ||
      properties.Namespace !== namespace ||
      properties.MetricName !== metric ||
      !equal(properties.Dimensions, [{ Name: dimension, Value: value }]) ||
      properties.Threshold !== threshold ||
      properties.Statistic !== statistic ||
      properties.Period !== 300 ||
      properties.EvaluationPeriods !== 1 ||
      properties.ComparisonOperator !== "GreaterThanOrEqualToThreshold" ||
      properties.TreatMissingData !== "notBreaching" ||
      properties.ActionsEnabled === false ||
      !equal(properties.AlarmActions, [
        { "Fn::ImportValue": "cloudmarkup-beta-bootstrap:AlarmTopicArn" },
      ])
    )
      fail(
        "ALARM",
        "All three enabled export alarms must retain their exact metrics, thresholds and existing notification topic.",
      );
  }
  const p = worker.resource.Properties;
  const workerEnv = {
    ...expectedEnv,
    CLOUDMARKUP_ENVIRONMENT: "beta",
    CLOUDMARKUP_DATABASE_ARN: apiEnv.CLOUDMARKUP_DATABASE_ARN,
    CLOUDMARKUP_DATABASE_SECRET_ARN: apiEnv.CLOUDMARKUP_DATABASE_SECRET_ARN,
    CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
    CLOUDMARKUP_CONTENT_BUCKET: apiEnv.CLOUDMARKUP_CONTENT_BUCKET,
    CLOUDMARKUP_OBJECT_DOCUMENT_PREFIX: "documents/v1/organizations/",
    CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: "0138",
    NODE_OPTIONS: "--enable-source-maps",
  };
  if (
    !keys(p, [
      "Architectures",
      "Code",
      "Environment",
      "FunctionName",
      "Handler",
      "Layers",
      "LoggingConfig",
      "MemorySize",
      "ReservedConcurrentExecutions",
      "Role",
      "Runtime",
      "Tags",
      "Timeout",
    ]) ||
    !equal(p.Architectures, ["arm64"]) ||
    p.Runtime !== "nodejs24.x" ||
    p.Handler !== "index.handler" ||
    p.MemorySize !== 1024 ||
    p.Timeout !== 600 ||
    p.ReservedConcurrentExecutions !== 2 ||
    !equal(p.Role, {
      "Fn::Join": [
        "",
        [
          "arn:",
          ref("AWS::Partition"),
          ":iam::000000000000:role/CloudMarkup-Beta-Solution-Export-Worker-Runtime",
        ],
      ],
    }) ||
    !equal(p.Layers, [ref(layer.id)]) ||
    !equal(variables(worker), workerEnv) ||
    !sharedContentBucket(stacks, api, worker) ||
    !ownedLog(stacks, worker)
  )
    fail(
      "WORKER",
      "The worker must retain its exact private role, bounded execution, environment, layer and owned logging configuration.",
    );
  const migrations = resources.filter(
    (item) =>
      item.stack === application &&
      item.resource.Type === "AWS::CloudFormation::CustomResource" &&
      item.resource.Properties?.ExpectedSchemaVersion === "0138",
  );
  if (
    migrations.length !== 1 ||
    ![worker.resource.DependsOn].flat().includes(migrations[0]?.id)
  )
    fail(
      "MIGRATION",
      "Export execution must wait for the admitted schema migration.",
    );
  const parser = named(
    "AWS::Lambda::LayerVersion",
    "LayerName",
    "cloudmarkup-beta-repository-import-parser",
  );
  if (
    parser.length !== 1 ||
    !equal(api.resource.Properties?.Layers, [
      ref(parser[0]?.id),
      ref(layer.id),
    ]) ||
    functions.some(
      (item) =>
        item !== api &&
        item !== worker &&
        (item.resource.Properties?.Layers ?? []).some((value) =>
          equal(value, ref(layer.id)),
        ),
    ) ||
    !equal(layer.resource.Properties?.CompatibleArchitectures, ["arm64"]) ||
    !equal(layer.resource.Properties?.CompatibleRuntimes, ["nodejs24.x"])
  )
    fail(
      "LAYER",
      "Only the API and export worker may reference the exact ARM64 runtime layer.",
    );
  const assetFor = (content, name) => {
    const id =
      keys(content, ["S3Bucket", "S3Key"]) && content.S3Bucket === bucket
        ? /^assets\/([a-f0-9]{64})\.zip$/u.exec(content.S3Key ?? "")?.[1]
        : undefined;
    const matches = assets.filter(
      (asset) =>
        asset.id === id &&
        asset.displayName === name &&
        asset.packaging === "zip" &&
        asset.fingerprint === id,
    );
    return matches.length === 1 && Array.isArray(matches[0].files)
      ? matches[0]
      : undefined;
  };
  const runtime = assetFor(
    layer.resource.Properties?.Content,
    "SolutionExport/SolutionExportRuntime/Code",
  );
  const manifestPath = "cloudmarkup-export/asset-manifest.json";
  const manifestFile = runtime?.files.find(
    (file) => file.path === manifestPath,
  );
  const manifest = parse(manifestFile?.text);
  const fileByPath = new Map(runtime?.files.map((file) => [file.path, file]));
  const records = manifest?.files;
  const inventory =
    Array.isArray(records) &&
    equal(records.map((file) => file.path).sort(), runtimePaths) &&
    records.every(
      (file) =>
        keys(file, ["path", "sha256", "sizeBytes"]) &&
        fileByPath.get(file.path)?.sha256 === file.sha256 &&
        fileByPath.get(file.path)?.byteLength === file.sizeBytes &&
        /^[a-f0-9]{64}$/u.test(file.sha256),
    );
  const compiler = fileByPath.get(
    runtimePaths.find((path) => path.endsWith("/cloudmarkup-iac")),
  );
  const native = fileByPath.get(
    runtimePaths.find((path) => path.endsWith(".node")),
  );
  if (
    !runtime ||
    !equal(
      runtime.files.map((file) => file.path).sort(),
      [...runtimePaths, manifestPath].sort(),
    ) ||
    !keys(manifest, [
      "contractVersion",
      "profile",
      "targetSettingsDigest",
      "files",
    ]) ||
    manifest.contractVersion !== 1 ||
    manifest.profile !== "cloudformation-infrastructure-only-v1" ||
    manifest.targetSettingsDigest !==
      expectedEnv.CLOUDMARKUP_SOLUTION_EXPORT_TARGET_SETTINGS_DIGEST ||
    !inventory ||
    fileByPath.get("cloudmarkup-export/fonts/inter-latin-400-normal.ttf")
      ?.sha256 !==
      "27396a89e10048c8e76096b1b4a5500bdc54d3b04d200f267ed6bf0d5466b2ba" ||
    fileByPath.get("cloudmarkup-export/fonts/inter-latin-600-normal.ttf")
      ?.sha256 !==
      "85c5903688f4329aaeebfc050fe6c3cb373f75ef1ff0a6f68d2640a870573584" ||
    !Object.entries(reviewedRuntimeCodeHashes).every(
      ([path, digest]) => fileByPath.get(path)?.sha256 === digest,
    ) ||
    native?.sha256 !==
      "e32d9868d6d5407af3d2a5bca404bcd3b92a53816e3c6d807dcf23d93592c153" ||
    fileByPath.get(
      "nodejs/node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2",
    )?.sha256 !==
      "8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc" ||
    fileByPath.get(
      "nodejs/node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2",
    )?.sha256 !==
      "f9a06e79cd3a2a20951c0f0e28f66dd0e6d3fda73911d640a2125c8fcb78f21a" ||
    compiler?.sha256 !==
      expectedEnv.CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_SHA256 ||
    fileByPath.get("cloudmarkup-export/diagram-icons.json")?.sha256 !==
      expectedEnv.CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_SHA256 ||
    ![compiler, native].every((file) =>
      /^7f454c460201[a-f0-9]{24}b700$/u.test(file?.headerHex ?? ""),
    )
  )
    fail(
      "ASSET",
      "The actual export layer must match its complete manifest, compiler/icon/settings pins and Linux ARM64 native binaries.",
    );
  for (const [name, version] of [
    ["@resvg/resvg-js", "2.6.2"],
    ["@resvg/resvg-js-linux-arm64-gnu", "2.6.2"],
    ["@fontsource/inter", "5.3.0"],
  ]) {
    const metadata = parse(
      fileByPath.get("nodejs/node_modules/" + name + "/package.json")?.text,
    );
    if (metadata?.name !== name || metadata?.version !== version)
      fail(
        "PACKAGE",
        "Export layer packages must retain the reviewed names and versions.",
      );
  }
  const code = assetFor(p.Code, "SolutionExport/WorkerFunction/Code");
  const text =
    code?.files
      .filter((file) => /\.m?js$/u.test(file.path))
      .map((file) => file.text)
      .join("\n") ?? "";
  if (
    !text.includes("cloudformation-infrastructure-only") ||
    !text.includes("current-commercial-admission-denied") ||
    !text.includes("cloudmarkup.solution-export")
  )
    fail(
      "WORKER_ASSET",
      "The deployed worker asset must contain the restricted workflow, current commercial admission and durable export composition.",
    );
  return findings;
}
