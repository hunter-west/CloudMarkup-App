import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  BETA_CLOUDFORMATION_PROFILE,
  BETA_EXPORT_QUEUE,
  BETA_EXPORT_DLQ,
  BETA_EXPORT_WORKER,
  BETA_EXPORT_LAYER,
  validateBetaSolutionExport,
} from "./beta-solution-export-admission.mjs";

const ref = (id) => ({ Ref: id });
const arn = (id) => ({ "Fn::GetAtt": [id, "Arn"] });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assetBucket = "cloudmarkup-beta-cdk-assets-000000000000-us-east-1";
const profile = { profile: BETA_CLOUDFORMATION_PROFILE };
const settings = "sha256:" + "c".repeat(64);
const diagramRequire = createRequire(
  new URL("../packages/diagram-export/package.json", import.meta.url),
);
const resvgRoot = dirname(
  diagramRequire.resolve("@resvg/resvg-js/package.json"),
);
const resvgRequire = createRequire(join(resvgRoot, "package.json"));
const nativeRoot = dirname(
  resvgRequire.resolve("@resvg/resvg-js-linux-arm64-gnu/package.json"),
);
const fontRoot = dirname(
  diagramRequire.resolve("@fontsource/inter/package.json"),
);
const nativeBytes = readFileSync(
  join(nativeRoot, "resvgjs.linux-arm64-gnu.node"),
);
const regularBytes = readFileSync(
  join(fontRoot, "files/inter-latin-400-normal.woff2"),
);
const semiboldBytes = readFileSync(
  join(fontRoot, "files/inter-latin-600-normal.woff2"),
);
const elf = Buffer.from("7f454c460201" + "00".repeat(12) + "b700", "hex");

function file(path, content) {
  const bytes = typeof content === "string" ? Buffer.from(content) : content;
  return {
    path,
    sha256: sha(bytes),
    byteLength: bytes.byteLength,
    headerHex: bytes.subarray(0, 20).toString("hex"),
    ...(typeof content === "string" ? { text: content } : {}),
  };
}
function asset(displayName, files) {
  const id = sha(JSON.stringify(files));
  return { id, displayName, packaging: "zip", fingerprint: id, files };
}
const reviewedPackageFiles = [
  [
    "@resvg/resvg-js",
    resvgRoot,
    ["package.json", "index.js", "js-binding.js", "LICENSE"],
  ],
  ["@resvg/resvg-js-linux-arm64-gnu", nativeRoot, ["package.json"]],
  ["@fontsource/inter", fontRoot, ["package.json", "LICENSE"]],
].flatMap(([name, root, paths]) =>
  paths.map((path) =>
    file(
      "nodejs/node_modules/" + name + "/" + path,
      readFileSync(join(root, path), "utf8"),
    ),
  ),
);

/** Synthetic inventory only: the ELF headers exercise architecture admission;
 * these bytes are never executable or evidence of an actual compiler run. */
function fixture() {
  const runtimeFiles = [
    file("cloudmarkup-export/cloudmarkup-iac", elf),
    file("cloudmarkup-export/diagram-icons.json", '{"synthetic":true}'),
    // Synthetic reader metadata only; converter/native/actual-assembly tests
    // independently establish these derived font bytes. No font executes here.
    {
      path: "cloudmarkup-export/fonts/inter-latin-400-normal.ttf",
      sha256:
        "27396a89e10048c8e76096b1b4a5500bdc54d3b04d200f267ed6bf0d5466b2ba",
      byteLength: 67952,
      headerHex: "00010000",
    },
    {
      path: "cloudmarkup-export/fonts/inter-latin-600-normal.ttf",
      sha256:
        "85c5903688f4329aaeebfc050fe6c3cb373f75ef1ff0a6f68d2640a870573584",
      byteLength: 68060,
      headerHex: "00010000",
    },
    ...structuredClone(reviewedPackageFiles),
    file(
      "nodejs/node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2",
      regularBytes,
    ),
    file(
      "nodejs/node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2",
      semiboldBytes,
    ),
    file(
      "nodejs/node_modules/@resvg/resvg-js-linux-arm64-gnu/resvgjs.linux-arm64-gnu.node",
      nativeBytes,
    ),
  ];
  const manifest = {
    contractVersion: 1,
    profile: "cloudformation-infrastructure-only-v1",
    targetSettingsDigest: settings,
    files: runtimeFiles.map(({ path, sha256, byteLength }) => ({
      path,
      sha256,
      sizeBytes: byteLength,
    })),
  };
  const runtime = asset("SolutionExport/SolutionExportRuntime/Code", [
    ...runtimeFiles,
    file("cloudmarkup-export/asset-manifest.json", JSON.stringify(manifest)),
  ]);
  const workerCode = asset("SolutionExport/WorkerFunction/Code", [
    file(
      "index.mjs",
      'export const synthetic = "cloudformation-infrastructure-only current-commercial-admission-denied cloudmarkup.solution-export";',
    ),
  ]);
  const content = (value) => ({
    S3Bucket: assetBucket,
    S3Key: "assets/" + value.id + ".zip",
  });
  const exportEnv = {
    CLOUDMARKUP_SOLUTION_EXPORTS_ENABLED: "true",
    CLOUDMARKUP_SOLUTION_EXPORT_PROFILE:
      "cloudformation-infrastructure-only-v1",
    CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_PATH:
      "/opt/cloudmarkup-export/cloudmarkup-iac",
    CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_SHA256: runtimeFiles[0].sha256,
    CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_PATH:
      "/opt/cloudmarkup-export/diagram-icons.json",
    CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_SHA256: runtimeFiles[1].sha256,
    CLOUDMARKUP_SOLUTION_EXPORT_TARGET_SETTINGS_DIGEST: settings,
    CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_ARN: arn("Queue"),
    CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_URL: ref("Queue"),
  };
  const common = {
    CLOUDMARKUP_CONTENT_BUCKET: { "Fn::ImportValue": "SyntheticContentBucket" },
    CLOUDMARKUP_DATABASE_ARN:
      "arn:aws:rds:us-east-1:000000000000:cluster:synthetic",
    CLOUDMARKUP_DATABASE_SECRET_ARN:
      "arn:aws:secretsmanager:us-east-1:000000000000:secret:synthetic",
  };
  const queue = (name, main) => ({
    Type: "AWS::SQS::Queue",
    DeletionPolicy: "RetainExceptOnCreate",
    UpdateReplacePolicy: "Retain",
    Properties: {
      QueueName: name,
      FifoQueue: true,
      SqsManagedSseEnabled: true,
      MessageRetentionPeriod: 1209600,
      Tags: [],
      ...(main
        ? {
            ContentBasedDeduplication: false,
            VisibilityTimeout: 3600,
            RedrivePolicy: {
              deadLetterTargetArn: arn("Dlq"),
              maxReceiveCount: 5,
            },
          }
        : {}),
    },
  });
  const queuePolicy = (id) => ({
    Type: "AWS::SQS::QueuePolicy",
    Properties: {
      Queues: [ref(id)],
      PolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Action: "sqs:*",
            Effect: "Deny",
            Principal: { AWS: "*" },
            Resource: arn(id),
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          },
        ],
      },
    },
  });
  const resources = {
    Queue: queue(BETA_EXPORT_QUEUE, true),
    Dlq: queue(BETA_EXPORT_DLQ, false),
    QueuePolicy: queuePolicy("Queue"),
    DlqPolicy: queuePolicy("Dlq"),
    Parser: {
      Type: "AWS::Lambda::LayerVersion",
      Properties: { LayerName: "cloudmarkup-beta-repository-import-parser" },
    },
    Layer: {
      Type: "AWS::Lambda::LayerVersion",
      Properties: {
        LayerName: BETA_EXPORT_LAYER,
        CompatibleArchitectures: ["arm64"],
        CompatibleRuntimes: ["nodejs24.x"],
        Content: content(runtime),
      },
    },
    Api: {
      Type: "AWS::Lambda::Function",
      Properties: {
        FunctionName: "cloudmarkup-beta-api",
        Environment: { Variables: { ...common, ...exportEnv } },
        Layers: [ref("Parser"), ref("Layer")],
      },
    },
    Worker: {
      Type: "AWS::Lambda::Function",
      DependsOn: ["Migration"],
      Properties: {
        Architectures: ["arm64"],
        Code: content(workerCode),
        Environment: {
          Variables: {
            ...common,
            ...exportEnv,
            CLOUDMARKUP_ENVIRONMENT: "beta",
            CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
            CLOUDMARKUP_OBJECT_DOCUMENT_PREFIX: "documents/v1/organizations/",
            CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: "0138",
            NODE_OPTIONS: "--enable-source-maps",
          },
        },
        FunctionName: BETA_EXPORT_WORKER,
        Handler: "index.handler",
        Layers: [ref("Layer")],
        LoggingConfig: {
          LogGroup: { "Fn::ImportValue": "SyntheticExportWorkerLog" },
        },
        MemorySize: 1024,
        ReservedConcurrentExecutions: 2,
        Role: {
          "Fn::Join": [
            "",
            [
              "arn:",
              ref("AWS::Partition"),
              ":iam::000000000000:role/CloudMarkup-Beta-Solution-Export-Worker-Runtime",
            ],
          ],
        },
        Runtime: "nodejs24.x",
        Tags: [],
        Timeout: 600,
      },
    },
    Mapping: {
      Type: "AWS::Lambda::EventSourceMapping",
      Properties: {
        BatchSize: 1,
        EventSourceArn: arn("Queue"),
        FunctionName: ref("Worker"),
        FunctionResponseTypes: ["ReportBatchItemFailures"],
        ScalingConfig: { MaximumConcurrency: 2 },
      },
    },
    Migration: {
      Type: "AWS::CloudFormation::CustomResource",
      Properties: { ExpectedSchemaVersion: "0138" },
    },
  };
  const stacks = [
    {
      stackName: "cloudmarkup-beta-application",
      template: { Resources: resources },
    },
    {
      stackName: "cloudmarkup-beta-observability",
      template: {
        Resources: {
          ...Object.fromEntries(
            [
              [
                "worker-errors",
                "AWS/Lambda",
                "Errors",
                "FunctionName",
                BETA_EXPORT_WORKER,
                1,
                "Sum",
              ],
              [
                "dead-letters",
                "AWS/SQS",
                "ApproximateNumberOfMessagesVisible",
                "QueueName",
                BETA_EXPORT_DLQ,
                1,
                "Maximum",
              ],
              [
                "queue-age",
                "AWS/SQS",
                "ApproximateAgeOfOldestMessage",
                "QueueName",
                BETA_EXPORT_QUEUE,
                1800,
                "Maximum",
              ],
            ].map(
              ([
                suffix,
                namespace,
                metric,
                dimension,
                value,
                threshold,
                statistic,
              ]) => [
                suffix,
                {
                  Type: "AWS::CloudWatch::Alarm",
                  Properties: {
                    AlarmName: "cloudmarkup-beta-solution-export-" + suffix,
                    Namespace: namespace,
                    MetricName: metric,
                    Dimensions: [{ Name: dimension, Value: value }],
                    Threshold: threshold,
                    Statistic: statistic,
                    Period: 300,
                    EvaluationPeriods: 1,
                    ComparisonOperator: "GreaterThanOrEqualToThreshold",
                    TreatMissingData: "notBreaching",
                    AlarmActions: [
                      {
                        "Fn::ImportValue":
                          "cloudmarkup-beta-bootstrap:AlarmTopicArn",
                      },
                    ],
                  },
                },
              ],
            ),
          ),
          WorkerLog: {
            Type: "AWS::Logs::LogGroup",
            Properties: {
              LogGroupName: "/aws/lambda/" + BETA_EXPORT_WORKER,
              RetentionInDays: 90,
            },
            DeletionPolicy: "RetainExceptOnCreate",
            UpdateReplacePolicy: "Retain",
          },
        },
        Outputs: {
          WorkerLog: {
            Value: ref("WorkerLog"),
            Export: { Name: "SyntheticExportWorkerLog" },
          },
        },
      },
    },
  ];
  stacks.push({
    stackName: "cloudmarkup-beta-stateful",
    template: {
      Resources: {
        Content: {
          Type: "AWS::S3::Bucket",
          Properties: {
            BucketName: "cloudmarkup-beta-000000000000-us-east-1-content",
          },
        },
      },
      Outputs: {
        Content: {
          Value: ref("Content"),
          Export: { Name: "SyntheticContentBucket" },
        },
      },
    },
  });
  return {
    stacks,
    resources,
    assets: [runtime, workerCode],
    runtime,
    workerCode,
  };
}
function replaceDeclaredRuntimeFile(f, path, bytes) {
  const index = f.runtime.files.findIndex((value) => value.path === path);
  assert.ok(index >= 0);
  f.runtime.files[index] = file(path, bytes);
  const manifestIndex = f.runtime.files.findIndex((value) =>
    value.path.endsWith("/asset-manifest.json"),
  );
  const manifest = JSON.parse(f.runtime.files[manifestIndex].text);
  manifest.files = f.runtime.files
    .filter((_, i) => i !== manifestIndex)
    .map(({ path, sha256, byteLength }) => ({
      path,
      sha256,
      sizeBytes: byteLength,
    }));
  f.runtime.files[manifestIndex] = file(
    "cloudmarkup-export/asset-manifest.json",
    JSON.stringify(manifest),
  );
  Object.assign(f.runtime, asset(f.runtime.displayName, f.runtime.files));
  f.resources.Layer.Properties.Content.S3Key =
    "assets/" + f.runtime.id + ".zip";
}
function assertDenied(change, code) {
  const f = fixture();
  // The dedicated positive case owns this unchanged fixture. Each denial still
  // starts from a fresh independent copy and pins its specific refusal code.
  change(f);
  assert.ok(
    validateBetaSolutionExport(f.stacks, profile, f.assets).some(
      (finding) => finding.code === "BETA_SOLUTION_EXPORT_" + code,
    ),
    code,
  );
}
test("admits the exact complete synthetic restricted assembly and inventory", () => {
  const f = fixture();
  assert.deepEqual(validateBetaSolutionExport(f.stacks, profile, f.assets), []);
});
test("rejects the previous worker timeout and queue visibility bounds", () => {
  assertDenied((f) => {
    f.resources.Worker.Properties.Timeout = 300;
  }, "WORKER");
  assertDenied((f) => {
    f.resources.Queue.Properties.VisibilityTimeout = 1800;
  }, "QUEUE");
});
test("legacy profiles require all hosted export resources and selectors to be absent", () => {
  const f = fixture();
  assert.equal(
    validateBetaSolutionExport(
      f.stacks,
      { profile: "stripe-sandbox-github-connections-v1" },
      f.assets,
    )[0]?.code,
    "BETA_SOLUTION_EXPORT_INACTIVE",
  );
  assert.deepEqual(validateBetaSolutionExport([], { profile: "core-v1" }), []);
});
for (const [name, change, code] of [
  [
    "worker role",
    (f) => {
      f.resources.Worker.Properties.Role =
        "arn:aws:iam::000000000000:role/Administrator";
    },
    "WORKER",
  ],
  [
    "queue encryption",
    (f) => {
      f.resources.Queue.Properties.SqsManagedSseEnabled = false;
    },
    "QUEUE",
  ],
  [
    "DLQ encryption",
    (f) => {
      f.resources.Dlq.Properties.SqsManagedSseEnabled = false;
    },
    "QUEUE",
  ],
  [
    "extra queue grant",
    (f) => {
      f.resources.QueuePolicy.Properties.PolicyDocument.Statement.push({
        Effect: "Allow",
        Action: "sqs:SendMessage",
        Principal: "*",
        Resource: arn("Queue"),
      });
    },
    "QUEUE_POLICY",
  ],
  [
    "consumer concurrency",
    (f) => {
      f.resources.Mapping.Properties.ScalingConfig.MaximumConcurrency = 3;
    },
    "CONSUMER",
  ],
  [
    "second consumer",
    (f) => {
      f.resources.SecondMapping = structuredClone(f.resources.Mapping);
    },
    "CONSUMER",
  ],
  [
    "other function activation",
    (f) => {
      f.resources.Other = {
        Type: "AWS::Lambda::Function",
        Properties: {
          FunctionName: "synthetic-other",
          Environment: {
            Variables: { CLOUDMARKUP_SOLUTION_EXPORTS_ENABLED: "true" },
          },
        },
      };
    },
    "ENVIRONMENT",
  ],
  [
    "different API queue",
    (f) => {
      f.resources.Api.Properties.Environment.Variables.CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_URL =
        ref("Dlq");
    },
    "ENVIRONMENT",
  ],
  [
    "worker layer assignment",
    (f) => {
      f.resources.Worker.Properties.Layers = [ref("Parser")];
    },
    "WORKER",
  ],
  [
    "layer on another function",
    (f) => {
      f.resources.Other = {
        Type: "AWS::Lambda::Function",
        Properties: { Layers: [ref("Layer")] },
      };
    },
    "LAYER",
  ],
  [
    "conditional worker",
    (f) => {
      f.resources.Worker.Condition = "Unreviewed";
    },
    "IDENTITY",
  ],
  [
    "missing migration dependency",
    (f) => {
      f.resources.Worker.DependsOn = [];
    },
    "MIGRATION",
  ],
  [
    "forged manifest settings",
    (f) => {
      const item = f.runtime.files.find((value) =>
        value.path.endsWith("/asset-manifest.json"),
      );
      const value = JSON.parse(item.text);
      value.targetSettingsDigest = "sha256:" + "d".repeat(64);
      Object.assign(item, file(item.path, JSON.stringify(value)));
    },
    "ASSET",
  ],
  [
    "native architecture",
    (f) => {
      f.runtime.files.find((value) => value.path.endsWith(".node")).headerHex =
        "7f454c460201" + "00".repeat(12) + "3e00";
    },
    "ASSET",
  ],
  [
    "undeclared runtime asset",
    (f) => {
      f.runtime.files.push(
        file("cloudmarkup-export/extra-script.sh", "echo unsafe"),
      );
    },
    "ASSET",
  ],
  [
    "duplicate runtime inventory",
    (f) => {
      f.assets.push(structuredClone(f.runtime));
    },
    "ASSET",
  ],
  [
    "worker without restricted admission",
    (f) => {
      f.workerCode.files[0] = file(
        "index.mjs",
        "export const unrelated = true;",
      );
    },
    "WORKER_ASSET",
  ],
]) {
  test("rejects " + name, () => {
    assertDenied(change, code);
  });
}
for (const [name, path, original] of [
  [
    "native rasterizer",
    "nodejs/node_modules/@resvg/resvg-js-linux-arm64-gnu/resvgjs.linux-arm64-gnu.node",
    nativeBytes,
  ],
  [
    "regular font",
    "nodejs/node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2",
    regularBytes,
  ],
  [
    "semibold font",
    "nodejs/node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2",
    semiboldBytes,
  ],
]) {
  test("rejects self-consistent replacement of the reviewed " + name, () => {
    assertDenied((f) => {
      const replacement = Buffer.from(original);
      replacement[replacement.length - 1] ^= 1;
      replaceDeclaredRuntimeFile(f, path, replacement);
    }, "ASSET");
  });
}
test("rejects an unreviewed package version even when inventory hashes agree", () => {
  assertDenied(
    (f) =>
      replaceDeclaredRuntimeFile(
        f,
        "nodejs/node_modules/@resvg/resvg-js/package.json",
        JSON.stringify({ name: "@resvg/resvg-js", version: "99.0.0" }),
      ),
    "PACKAGE",
  );
});

for (const [label, mutate] of [
  [
    "missing alarm",
    (resources) => {
      delete resources["worker-errors"];
    },
  ],
  [
    "disabled alarm",
    (resources) => {
      resources["worker-errors"].Properties.ActionsEnabled = false;
    },
  ],
  [
    "higher dead-letter threshold",
    (resources) => {
      resources["dead-letters"].Properties.Threshold = 10;
    },
  ],
  [
    "foreign notification",
    (resources) => {
      resources["queue-age"].Properties.AlarmActions = [
        { Ref: "ForeignTopic" },
      ];
    },
  ],
  [
    "wrong queue",
    (resources) => {
      resources["queue-age"].Properties.Dimensions[0].Value = "other.fifo";
    },
  ],
])
  test("requires export observability: " + label, () => {
    const f = fixture();
    mutate(f.stacks[1].template.Resources);
    assert.ok(
      validateBetaSolutionExport(f.stacks, profile, f.assets).some(
        (entry) => entry.code === "BETA_SOLUTION_EXPORT_ALARM",
      ),
    );
  });

for (const [name, mutate] of [
  [
    "worker points to another import",
    (f) => {
      f.resources.Worker.Properties.Environment.Variables.CLOUDMARKUP_CONTENT_BUCKET =
        { "Fn::ImportValue": "ForeignContent" };
    },
  ],
  [
    "missing shared output",
    (f) => {
      delete f.stacks[2].template.Outputs.Content;
    },
  ],
  [
    "output points to another resource",
    (f) => {
      f.stacks[2].template.Outputs.Content.Value = ref("ForeignContent");
    },
  ],
  [
    "conditional shared output",
    (f) => {
      f.stacks[2].template.Outputs.Content.Condition = "Unreviewed";
    },
  ],
  [
    "foreign content bucket name",
    (f) => {
      f.stacks[2].template.Resources.Content.Properties.BucketName =
        "foreign-content";
    },
  ],
  [
    "conditional content bucket",
    (f) => {
      f.stacks[2].template.Resources.Content.Condition = "Unreviewed";
    },
  ],
  [
    "duplicate shared output",
    (f) => {
      f.stacks[2].template.Outputs.Duplicate = structuredClone(
        f.stacks[2].template.Outputs.Content,
      );
    },
  ],
  [
    "literal name bypasses shared resource",
    (f) => {
      for (const item of [f.resources.Api, f.resources.Worker])
        item.Properties.Environment.Variables.CLOUDMARKUP_CONTENT_BUCKET =
          "cloudmarkup-beta-000000000000-us-east-1-content";
    },
  ],
])
  test("requires the canonical shared content bucket: " + name, () =>
    assertDenied(mutate, "WORKER"),
  );

for (const path of [
  "nodejs/node_modules/@resvg/resvg-js/index.js",
  "nodejs/node_modules/@resvg/resvg-js/js-binding.js",
  "nodejs/node_modules/@resvg/resvg-js/package.json",
  "nodejs/node_modules/@resvg/resvg-js-linux-arm64-gnu/package.json",
  "nodejs/node_modules/@fontsource/inter/package.json",
])
  test(
    "rejects coherent replacement of reviewed executable bytes: " + path,
    () => {
      assertDenied((f) => {
        const original = f.runtime.files.find(
          (entry) => entry.path === path,
        ).text;
        const replacement = path.endsWith("package.json")
          ? JSON.stringify({ ...JSON.parse(original), main: "./LICENSE" })
          : original +
            '\nthrow new Error("Synthetic changed runtime wrapper");\n';
        replaceDeclaredRuntimeFile(f, path, replacement);
      }, "ASSET");
    },
  );

for (const [label, mutate] of [
  [
    "shortened retention",
    (f) => {
      f.stacks[1].template.Resources.WorkerLog.Properties.RetentionInDays = 1;
    },
  ],
  [
    "deletable log",
    (f) => {
      f.stacks[1].template.Resources.WorkerLog.DeletionPolicy = "Delete";
    },
  ],
  [
    "replaceable log",
    (f) => {
      f.stacks[1].template.Resources.WorkerLog.UpdateReplacePolicy = "Delete";
    },
  ],
  [
    "conditional log",
    (f) => {
      f.stacks[1].template.Resources.WorkerLog.Condition = "Unreviewed";
    },
  ],
  [
    "conditional duplicate log",
    (f) => {
      f.stacks[1].template.Resources.Duplicate = {
        ...structuredClone(f.stacks[1].template.Resources.WorkerLog),
        Condition: "Unreviewed",
      };
    },
  ],
  [
    "missing output",
    (f) => {
      delete f.stacks[1].template.Outputs.WorkerLog;
    },
  ],
  [
    "conditional output",
    (f) => {
      f.stacks[1].template.Outputs.WorkerLog.Condition = "Unreviewed";
    },
  ],
  [
    "conditional duplicate output",
    (f) => {
      f.stacks[1].template.Outputs.Duplicate = {
        ...structuredClone(f.stacks[1].template.Outputs.WorkerLog),
        Condition: "Unreviewed",
      };
    },
  ],
  [
    "foreign output target",
    (f) => {
      f.stacks[1].template.Outputs.WorkerLog.Value = ref("ForeignLog");
    },
  ],
  [
    "duplicate observability owner",
    (f) => {
      f.stacks.push(structuredClone(f.stacks[1]));
    },
  ],
  [
    "literal log bypass",
    (f) => {
      f.resources.Worker.Properties.LoggingConfig.LogGroup =
        "/aws/lambda/" + BETA_EXPORT_WORKER;
    },
  ],
])
  test("requires unique retained worker logging: " + label, () =>
    assertDenied(mutate, "WORKER"),
  );

for (const conditional of [true])
  test(
    "rejects " +
      (conditional ? "conditional " : "") +
      "duplicate fixed-name content buckets",
    () => {
      assertDenied((f) => {
        f.stacks[2].template.Resources.Duplicate = {
          ...structuredClone(f.stacks[2].template.Resources.Content),
          ...(conditional ? { Condition: "Unreviewed" } : {}),
        };
      }, "WORKER");
    },
  );

for (const weight of [400, 600])
  test("rejects coherently substituted derived font " + weight, () => {
    assertDenied((f) => {
      replaceDeclaredRuntimeFile(
        f,
        "cloudmarkup-export/fonts/inter-latin-" + weight + "-normal.ttf",
        "Synthetic substituted font bytes.",
      );
    }, "ASSET");
  });
