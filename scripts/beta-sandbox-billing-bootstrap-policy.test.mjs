import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

// Local CloudFormation/IAM projection only, not an AWS policy simulation.
// Signing references are synthetic fixtures and cannot activate the service.
const account = "000000000000";
const region = "us-east-1";
const apiKey =
  "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/api-key-EX0004";
const signing =
  "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/webhook-signing-secret-a1b2c3";
const previous =
  "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/webhook-signing-previous-d4e5f6";
const queue =
  "arn:aws:sqs:" +
  region +
  ":" +
  account +
  ":cloudmarkup-beta-billing-webhook.fifo";
const dlq = queue.replace("webhook.fifo", "webhook-dlq.fifo");
const database =
  "arn:aws:rds:" +
  region +
  ":" +
  account +
  ":cluster:cloudmarkup-beta-postgresql";
const databaseSecret =
  "arn:aws:secretsmanager:" +
  region +
  ":" +
  account +
  ":secret:cloudmarkup-beta/database/admin-a1b2c3";
const workerArn =
  "arn:aws:lambda:" +
  region +
  ":" +
  account +
  ":function:cloudmarkup-beta-billing-worker";
const mappingArn =
  "arn:aws:lambda:" +
  region +
  ":" +
  account +
  ":event-source-mapping:11111111-2222-4333-8444-555555555555";
const webhookId = "CloudMarkupBetaBillingWebhookRuntimeRole";
const workerId = "CloudMarkupBetaBillingWorkerRuntimeRole";
const boundaryId = "CloudMarkupBetaRuntimeBoundary";
const operationsId = "CloudMarkupBetaOperationsExecutionPolicy";
const apiId = "CloudMarkupBetaApiRuntimeRole";
const currentVersion = { "secretsmanager:VersionStage": "AWSCURRENT" };
const noValue = Symbol("AWS::NoValue");
const template = parse(
  await readFile(
    "infra/application-account/cloudmarkup-beta-github-dns-access.yml",
    "utf8",
  ),
  {
    customTags: [
      ["!Ref", "Ref"],
      ["!Sub", "Fn::Sub"],
      ["!GetAtt", "Fn::GetAtt"],
    ].map(([tag, key]) => ({ tag, resolve: (value) => ({ [key]: value }) })),
    logLevel: "silent",
  },
);
const enabled = {
  EnableStripeSandboxDelivery: "true",
  StripeSandboxWebhookSigningSecretArn: signing,
};

function projection(overrides = {}) {
  const refs = Object.fromEntries(
    Object.entries(template.Parameters).map(([key, value]) => [
      key,
      value.Default,
    ]),
  );
  Object.assign(refs, overrides, {
    "AWS::Partition": "aws",
    "AWS::Region": region,
    "AWS::AccountId": account,
  });
  for (const [key, parameter] of Object.entries(template.Parameters)) {
    if (parameter.AllowedValues)
      assert.ok(parameter.AllowedValues.includes(refs[key]), key);
    if (parameter.AllowedPattern)
      assert.match(refs[key], new RegExp(parameter.AllowedPattern), key);
  }
  const attributes = {
    "CloudMarkupBetaCdkAssets.Arn":
      "arn:aws:s3:::cloudmarkup-beta-cdk-assets-" + account + "-" + region,
  };
  for (const [key, resource] of Object.entries(template.Resources)) {
    if (resource.Type === "AWS::IAM::Role") {
      refs[key] = resource.Properties.RoleName;
      attributes[key + ".Arn"] =
        "arn:aws:iam::" + account + ":role/" + resource.Properties.RoleName;
    }
    if (resource.Type === "AWS::IAM::ManagedPolicy")
      refs[key] =
        "arn:aws:iam::" +
        account +
        ":policy/" +
        resource.Properties.ManagedPolicyName;
  }
  function resolve(value) {
    if (Array.isArray(value))
      return value.map(resolve).filter((item) => item !== noValue);
    if (value === null || typeof value !== "object") return value;
    if (value.Ref === "AWS::NoValue") return noValue;
    if (Object.hasOwn(value, "Ref")) {
      assert.ok(Object.hasOwn(refs, value.Ref), "unknown Ref " + value.Ref);
      return refs[value.Ref];
    }
    if (Object.hasOwn(value, "Fn::GetAtt")) {
      const key = Array.isArray(value["Fn::GetAtt"])
        ? value["Fn::GetAtt"].join(".")
        : value["Fn::GetAtt"];
      assert.ok(Object.hasOwn(attributes, key), "unknown attribute " + key);
      return attributes[key];
    }
    if (Object.hasOwn(value, "Fn::Sub")) {
      let text = value["Fn::Sub"];
      assert.equal(typeof text, "string");
      for (const [key, replacement] of Object.entries({
        ...refs,
        ...attributes,
      }))
        text = text.replaceAll("$" + "{" + key + "}", replacement);
      assert.ok(!text.includes("$" + "{"), "unresolved substitution " + text);
      return text;
    }
    if (Object.hasOwn(value, "Fn::Equals")) {
      const [left, right] = value["Fn::Equals"].map(resolve);
      return left === right;
    }
    if (Object.hasOwn(value, "Fn::Not")) return !resolve(value["Fn::Not"][0]);
    if (Object.hasOwn(value, "Fn::And"))
      return value["Fn::And"].every((item) => resolve(item) === true);
    if (Object.hasOwn(value, "Fn::If")) {
      const [condition, yes, no] = value["Fn::If"];
      assert.ok(
        Object.hasOwn(template.Conditions, condition),
        "unknown condition",
      );
      return resolve(resolve(template.Conditions[condition]) ? yes : no);
    }
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, resolve(item)])
        .filter(([, item]) => item !== noValue),
    );
  }
  for (const rule of Object.values(template.Rules)) {
    if (rule.RuleCondition === undefined || resolve(rule.RuleCondition))
      for (const assertion of rule.Assertions)
        assert.equal(
          resolve(assertion.Assert),
          true,
          assertion.AssertDescription,
        );
  }
  return {
    statements(id) {
      const properties = template.Resources[id].Properties;
      return (
        properties.PolicyDocument
          ? [properties.PolicyDocument]
          : properties.Policies.map((item) => item.PolicyDocument)
      ).flatMap((document) => resolve(document).Statement);
    },
    resolve,
  };
}
function array(value) {
  return Array.isArray(value) ? value : [value];
}
function allowed(statements, action, resource, context = {}) {
  return statements.some((statement) => {
    assert.equal(
      statement.Effect,
      "Allow",
      "reviewed projection only accepts Allow",
    );
    if (!array(statement.Action).includes(action)) return false;
    if (
      !array(statement.Resource).some((pattern) =>
        new RegExp(
          "^" + pattern.split("*").map(RegExp.escape).join(".*") + "$",
          "u",
        ).test(resource),
      )
    )
      return false;
    return Object.entries(statement.Condition ?? {}).every(
      ([operator, terms]) => {
        assert.ok(
          ["StringEquals", "StringEqualsIfExists", "ArnEquals"].includes(
            operator,
          ),
          "unreviewed IAM condition " + operator,
        );
        return Object.entries(terms).every(
          ([key, expected]) =>
            (operator === "StringEqualsIfExists" &&
              !Object.hasOwn(context, key)) ||
            array(expected).includes(context[key]),
        );
      },
    );
  });
}
function roleAllows(state, role, action, resource, context = {}) {
  return (
    allowed(state.statements(role), action, resource, context) &&
    allowed(state.statements(boundaryId), action, resource, context)
  );
}
function actions(statements) {
  return statements.flatMap((statement) => array(statement.Action)).sort();
}
function sid(state, id, name) {
  const value = state
    .statements(id)
    .find((statement) => statement.Sid === name);
  assert.ok(value, name);
  return value;
}

test("sandbox bootstrap defaults off and rejects incomplete or widened activation inputs", () => {
  for (const key of [
    "EnableStripeSandboxDelivery",
    "EnableStripeSandboxSessions",
  ]) {
    assert.equal(template.Parameters[key].Default, "false");
    assert.deepEqual(template.Parameters[key].AllowedValues, ["false", "true"]);
  }
  assert.doesNotThrow(() => projection());
  assert.doesNotThrow(() => projection(enabled));
  for (const overrides of [
    { EnableStripeSandboxSessions: "true" },
    { EnableStripeSandboxDelivery: "true" },
    { ...enabled, EnableStripeSandboxDelivery: true },
    { ...enabled, StripeSandboxWebhookSigningSecretArn: apiKey },
    { ...enabled, StripeSandboxWebhookSigningSecretArn: signing + "*" },
    {
      ...enabled,
      StripeSandboxWebhookSigningSecretArn: signing.replace(
        account,
        "111122223333",
      ),
    },
    {
      ...enabled,
      StripeSandboxWebhookSigningSecretArn: signing.replace(
        region,
        "eu-west-1",
      ),
    },
    { ...enabled, StripeSandboxPreviousWebhookSigningSecretArn: signing },
  ])
    assert.throws(() => projection(overrides));
});

test("sandbox roles are always retained owner-managed resources with exact Lambda trust", () => {
  for (const [id, name] of [
    [webhookId, "CloudMarkup-Beta-Billing-Webhook-Runtime"],
    [workerId, "CloudMarkup-Beta-Billing-Worker-Runtime"],
  ]) {
    const role = template.Resources[id];
    assert.equal(role.Type, "AWS::IAM::Role");
    assert.equal(role.Condition, undefined);
    assert.equal(role.DeletionPolicy, "RetainExceptOnCreate");
    assert.equal(role.UpdateReplacePolicy, "Retain");
    assert.equal(role.Properties.RoleName, name);
    assert.deepEqual(role.Properties.PermissionsBoundary, { Ref: boundaryId });
    assert.equal(role.Properties.ManagedPolicyArns, undefined);
    assert.equal(role.Properties.Policies.length, 1);
    assert.deepEqual(role.Properties.AssumeRolePolicyDocument, {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Service: "lambda.amazonaws.com" },
          Action: "sts:AssumeRole",
        },
      ],
    });
  }
});

test("disabling delivery removes queue, secret and database grants without removing the roles", () => {
  for (const configuration of [
    {},
    {
      StripeSandboxWebhookSigningSecretArn: signing,
      StripeSandboxPreviousWebhookSigningSecretArn: previous,
    },
  ]) {
    const state = projection(configuration);
    for (const id of [webhookId, workerId]) {
      assert.deepEqual(actions(state.statements(id)), [
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "xray:PutTelemetryRecords",
        "xray:PutTraceSegments",
      ]);
      assert.equal(state.statements(id).length, 2);
    }
    assert.ok(
      !JSON.stringify(state.statements(operationsId)).includes("Sandbox"),
    );
    assert.ok(
      !JSON.stringify(state.statements(boundaryId)).includes("stripe/"),
    );
    assert.ok(!JSON.stringify(state.statements(apiId)).includes("stripe/"));
  }
});

test("webhook can read only exact current signing versions and send only normalized delivery", () => {
  const state = projection({
    ...enabled,
    StripeSandboxPreviousWebhookSigningSecretArn: previous,
  });
  const statements = state.statements(webhookId);
  assert.deepEqual(actions(statements), [
    "logs:CreateLogStream",
    "logs:PutLogEvents",
    "secretsmanager:GetSecretValue",
    "secretsmanager:GetSecretValue",
    "sqs:SendMessage",
    "xray:PutTelemetryRecords",
    "xray:PutTraceSegments",
  ]);
  for (const arn of [signing, previous]) {
    assert.equal(
      roleAllows(
        state,
        webhookId,
        "secretsmanager:GetSecretValue",
        arn,
        currentVersion,
      ),
      true,
    );
    for (const context of [
      {},
      { "secretsmanager:VersionStage": "AWSPREVIOUS" },
    ])
      assert.equal(
        roleAllows(
          state,
          webhookId,
          "secretsmanager:GetSecretValue",
          arn,
          context,
        ),
        false,
      );
  }
  for (const arn of [
    apiKey,
    databaseSecret,
    signing.replace(account, "111122223333"),
    signing.replace("a1b2c3", "d4e5f6"),
  ])
    assert.equal(
      roleAllows(
        state,
        webhookId,
        "secretsmanager:GetSecretValue",
        arn,
        currentVersion,
      ),
      false,
    );
  assert.equal(roleAllows(state, webhookId, "sqs:SendMessage", queue), true);
  for (const arn of [dlq, queue.replace(region, "eu-west-1"), queue + "-other"])
    assert.equal(roleAllows(state, webhookId, "sqs:SendMessage", arn), false);
  assert.equal(
    roleAllows(state, webhookId, "sqs:ReceiveMessage", queue),
    false,
  );
  assert.equal(
    roleAllows(state, webhookId, "rds-data:ExecuteStatement", database),
    false,
  );
  assert.equal(
    roleAllows(
      projection(enabled),
      webhookId,
      "secretsmanager:GetSecretValue",
      previous,
      currentVersion,
    ),
    false,
  );
});

test("worker can consume only the main queue and refresh exact sandbox API/database state", () => {
  const state = projection({
    ...enabled,
    StripeSandboxPreviousWebhookSigningSecretArn: previous,
  });
  assert.deepEqual(actions(state.statements(workerId)), [
    "logs:CreateLogStream",
    "logs:PutLogEvents",
    "rds-data:BeginTransaction",
    "rds-data:CommitTransaction",
    "rds-data:ExecuteStatement",
    "rds-data:RollbackTransaction",
    "secretsmanager:GetSecretValue",
    "secretsmanager:GetSecretValue",
    "sqs:ChangeMessageVisibility",
    "sqs:DeleteMessage",
    "sqs:GetQueueAttributes",
    "sqs:ReceiveMessage",
    "xray:PutTelemetryRecords",
    "xray:PutTraceSegments",
  ]);
  for (const action of [
    "sqs:ReceiveMessage",
    "sqs:DeleteMessage",
    "sqs:ChangeMessageVisibility",
    "sqs:GetQueueAttributes",
  ]) {
    assert.equal(roleAllows(state, workerId, action, queue), true);
    assert.equal(roleAllows(state, workerId, action, dlq), false);
  }
  assert.equal(roleAllows(state, workerId, "sqs:SendMessage", queue), false);
  assert.equal(
    roleAllows(
      state,
      workerId,
      "secretsmanager:GetSecretValue",
      apiKey,
      currentVersion,
    ),
    true,
  );
  assert.equal(
    roleAllows(state, workerId, "secretsmanager:GetSecretValue", apiKey),
    false,
  );
  assert.equal(
    roleAllows(
      state,
      workerId,
      "secretsmanager:GetSecretValue",
      databaseSecret,
    ),
    true,
  );
  for (const arn of [signing, previous, apiKey.replace("EX0004", "a1b2c3")])
    assert.equal(
      roleAllows(
        state,
        workerId,
        "secretsmanager:GetSecretValue",
        arn,
        currentVersion,
      ),
      false,
    );
  assert.equal(
    roleAllows(state, workerId, "rds-data:ExecuteStatement", database),
    true,
  );
  assert.equal(
    roleAllows(
      state,
      workerId,
      "rds-data:ExecuteStatement",
      database + "-other",
    ),
    false,
  );
  for (const role of [webhookId, workerId])
    assert.ok(
      !actions(state.statements(role)).some((action) =>
        /^(?:s3|bedrock|iam|sts|lambda|kms):/u.test(action),
      ),
    );
});

test("API receives a current-version API-key read only with both sandbox switches", () => {
  const delivery = projection(enabled);
  const sessions = projection({
    ...enabled,
    EnableStripeSandboxSessions: "true",
  });
  assert.equal(
    roleAllows(
      delivery,
      apiId,
      "secretsmanager:GetSecretValue",
      apiKey,
      currentVersion,
    ),
    false,
  );
  assert.equal(
    roleAllows(
      sessions,
      apiId,
      "secretsmanager:GetSecretValue",
      apiKey,
      currentVersion,
    ),
    true,
  );
  assert.equal(
    roleAllows(
      sessions,
      apiId,
      "secretsmanager:GetSecretValue",
      signing,
      currentVersion,
    ),
    false,
  );
  assert.equal(roleAllows(sessions, apiId, "sqs:SendMessage", queue), false);
  assert.equal(
    roleAllows(sessions, apiId, "secretsmanager:GetSecretValue", apiKey),
    false,
  );
});

test("conditional execution adds exactly two queue lifecycles, fixed-worker mapping and two passroles", () => {
  const state = projection(enabled);
  const queuePolicy = sid(
    state,
    operationsId,
    "ManageExactSandboxDeliveryQueues",
  );
  assert.deepEqual(queuePolicy.Resource, [queue, dlq]);
  assert.deepEqual(queuePolicy.Action, [
    "sqs:CreateQueue",
    "sqs:DeleteQueue",
    "sqs:GetQueueAttributes",
    "sqs:GetQueueUrl",
    "sqs:ListQueueTags",
    "sqs:SetQueueAttributes",
    "sqs:TagQueue",
    "sqs:UntagQueue",
  ]);
  assert.equal(queuePolicy.Condition, undefined);
  const create = sid(state, operationsId, "CreateOnlySandboxWorkerMapping");
  assert.equal(create.Action, "lambda:CreateEventSourceMapping");
  assert.equal(create.Resource, "*");
  assert.deepEqual(create.Condition, {
    ArnEquals: { "lambda:FunctionArn": workerArn },
  });
  const manage = sid(state, operationsId, "ManageOnlySandboxWorkerMappings");
  assert.deepEqual(manage.Action, [
    "lambda:DeleteEventSourceMapping",
    "lambda:GetEventSourceMapping",
    "lambda:UpdateEventSourceMapping",
  ]);
  assert.equal(manage.Resource, mappingArn.replace(/:[^:]+$/u, ":*"));
  assert.deepEqual(manage.Condition, create.Condition);
  const pass = sid(state, operationsId, "PassExactSandboxRuntimeRoles");
  assert.equal(pass.Action, "iam:PassRole");
  assert.deepEqual(pass.Resource, [
    "arn:aws:iam::" +
      account +
      ":role/CloudMarkup-Beta-Billing-Webhook-Runtime",
    "arn:aws:iam::" + account + ":role/CloudMarkup-Beta-Billing-Worker-Runtime",
  ]);
  assert.deepEqual(pass.Condition, {
    StringEquals: { "iam:PassedToService": "lambda.amazonaws.com" },
  });
  for (const policy of [create, manage]) {
    const resource = policy === create ? "*" : mappingArn;
    for (const action of array(policy.Action)) {
      assert.equal(
        allowed([policy], action, resource, {
          "lambda:FunctionArn": workerArn,
        }),
        true,
      );
      for (const functionArn of [
        workerArn + "-other",
        workerArn.replace(account, "111122223333"),
        workerArn + ":1",
      ])
        assert.equal(
          allowed([policy], action, resource, {
            "lambda:FunctionArn": functionArn,
          }),
          false,
        );
      assert.equal(allowed([policy], action, resource), false);
    }
  }
  const added = state
    .statements(operationsId)
    .filter((item) => item.Sid.includes("Sandbox"));
  assert.equal(added.length, 5);
  assert.ok(
    !actions(added).some((action) =>
      /^(?:sqs:(?:PurgeQueue|SendMessage|ReceiveMessage)|iam:(?!PassRole))/u.test(
        action,
      ),
    ),
  );
});

test("mapping metadata is an explicit delivery-only regional allowance, not a function-scoped lifecycle grant", () => {
  const state = projection(enabled);
  const metadata = sid(
    state,
    operationsId,
    "ManageRegionalSandboxMappingMetadata",
  );
  const metadataActions = [
    "lambda:TagResource",
    "lambda:UntagResource",
    "lambda:ListTags",
  ];
  assert.deepEqual(metadata.Action, metadataActions);
  assert.equal(metadata.Resource, mappingArn.replace(/:[^:]+$/u, ":*"));
  // No unsupported FunctionArn/CalledVia or guessed tag-context condition.
  // This is only the local action/resource projection, not an AWS simulation.
  assert.equal(metadata.Condition, undefined);
  for (const action of metadataActions) {
    assert.equal(allowed([metadata], action, mappingArn), true);
    assert.equal(
      allowed(
        [metadata],
        action,
        mappingArn.replace(
          "11111111-2222-4333-8444-555555555555",
          "66666666-7777-4888-8999-000000000000",
        ),
      ),
      true,
    );
    for (const foreign of [
      mappingArn.replace(account, "111122223333"),
      mappingArn.replace(region, "us-west-2"),
      mappingArn.replace("arn:aws:", "arn:aws-cn:"),
      workerArn,
      workerArn.replace(":function:", ":layer:"),
    ])
      assert.equal(allowed([metadata], action, foreign), false);
    for (const role of [apiId, webhookId, workerId])
      assert.equal(roleAllows(state, role, action, mappingArn), false);
    assert.equal(
      allowed(state.statements(boundaryId), action, mappingArn),
      false,
    );
  }
  for (const action of [
    "lambda:CreateEventSourceMapping",
    "lambda:GetEventSourceMapping",
    "lambda:UpdateEventSourceMapping",
    "lambda:DeleteEventSourceMapping",
    "lambda:InvokeFunction",
    "lambda:UpdateFunctionCode",
  ])
    assert.equal(allowed([metadata], action, mappingArn), false);
  for (const disabled of [
    projection(),
    projection({ ...enabled, EnableStripeSandboxDelivery: "false" }),
  ]) {
    assert.equal(
      disabled
        .statements(operationsId)
        .some((item) => item.Sid === metadata.Sid),
      false,
    );
    for (const action of metadataActions)
      assert.equal(
        allowed(disabled.statements(operationsId), action, mappingArn),
        false,
      );
  }
  const metadataStatements = state
    .statements(operationsId)
    .filter((statement) =>
      array(statement.Action).some((action) =>
        metadataActions.includes(action),
      ),
    );
  assert.deepEqual(metadataStatements, [metadata]);
});

test("sandbox rollout preserves immutable properties of the deployed Operations policy", () => {
  const policy = template.Resources[operationsId];
  assert.equal(
    policy.Properties.ManagedPolicyName,
    "CloudMarkup-Beta-CFN-Operations",
  );
  assert.equal(
    policy.Properties.Description,
    "Lifecycle access only to beta logs, alarms, notification topic, dashboard, and budget.",
  );
  assert.equal(policy.Properties.Path, undefined);
  assert.equal(policy.UpdateReplacePolicy, "Retain");
});

test("all activation variants preserve four execution families and stay within IAM policy limits", (context) => {
  const execution =
    template.Resources.CloudMarkupBetaCloudFormationExecutionRole;
  assert.deepEqual(execution.Properties.ManagedPolicyArns, [
    { Ref: "CloudMarkupBetaDataExecutionPolicy" },
    { Ref: operationsId },
    { Ref: "CloudMarkupBetaApplicationExecutionPolicy" },
    { Ref: "CloudMarkupBetaEdgeExecutionPolicy" },
  ]);
  const maxima = {};
  for (const configuration of [
    {},
    enabled,
    {
      ...enabled,
      EnableStripeSandboxSessions: "true",
      StripeSandboxPreviousWebhookSigningSecretArn: previous,
      EnableGitHubConnections: "true",
    },
  ]) {
    const state = projection(configuration);
    for (const [id, resource] of Object.entries(template.Resources)) {
      if (resource.Type === "AWS::IAM::ManagedPolicy") {
        const length = JSON.stringify(
          state.resolve(resource.Properties.PolicyDocument),
        ).length;
        assert.ok(length <= 6144, id + " exceeds 6144 characters: " + length);
        maxima[id] = Math.max(maxima[id] ?? 0, length);
      }
      if (resource.Type === "AWS::IAM::Role") {
        const length = (resource.Properties.Policies ?? []).reduce(
          (sum, item) =>
            sum + JSON.stringify(state.resolve(item.PolicyDocument)).length,
          0,
        );
        assert.ok(
          length <= 10240,
          id + " inline policies exceed 10240 characters",
        );
        if ([webhookId, workerId].includes(id))
          maxima[id] = Math.max(maxima[id] ?? 0, length);
      }
    }
  }
  context.diagnostic(
    "Resolved IAM document character maxima: " + JSON.stringify(maxima),
  );
});
const exportEnabled = {
  ...enabled,
  EnableGitHubConnections: "true",
  EnableCloudFormationExports: "true",
};
const exportWorkerId = "CloudMarkupBetaSolutionExportWorkerRuntimeRole";
const exportQueue = queue.replace("billing-webhook", "solution-exports");
const exportWorkerArn = workerArn.replace(
  "billing-worker",
  "solution-export-worker",
);

test("restricted export activation is independent, default off, and requires the exact service combination", () => {
  assert.equal(
    template.Parameters.EnableCloudFormationExports.Default,
    "false",
  );
  assert.deepEqual(
    template.Parameters.EnableCloudFormationExports.AllowedValues,
    ["false", "true"],
  );
  assert.doesNotThrow(() => projection(exportEnabled));
  for (const config of [
    { EnableCloudFormationExports: "true" },
    { ...enabled, EnableCloudFormationExports: "true" },
    { ...exportEnabled, EnableGitHubConnections: "false" },
    { ...exportEnabled, EnableCloudFormationExports: true },
  ])
    assert.throws(() => projection(config));
  const role = template.Resources[exportWorkerId];
  assert.equal(role.Condition, undefined);
  assert.equal(role.DeletionPolicy, "RetainExceptOnCreate");
  assert.equal(role.UpdateReplacePolicy, "Retain");
  assert.deepEqual(role.Properties.PermissionsBoundary, { Ref: boundaryId });
});

test("sandbox checkout and export preserve separate exact runtime permissions", () => {
  const state = projection({
    ...exportEnabled,
    EnableStripeSandboxSessions: "true",
  });
  assert.equal(
    roleAllows(
      state,
      apiId,
      "secretsmanager:GetSecretValue",
      apiKey,
      currentVersion,
    ),
    true,
  );
  assert.equal(roleAllows(state, apiId, "sqs:SendMessage", exportQueue), true);
  assert.equal(
    roleAllows(
      state,
      apiId,
      "secretsmanager:GetSecretValue",
      signing,
      currentVersion,
    ),
    false,
  );
  assert.equal(
    roleAllows(
      state,
      exportWorkerId,
      "secretsmanager:GetSecretValue",
      apiKey,
      currentVersion,
    ),
    false,
  );
  assert.equal(
    roleAllows(state, exportWorkerId, "sqs:ReceiveMessage", exportQueue),
    true,
  );
});

test("export consumer and API publisher have different exact queue capabilities", () => {
  const state = projection(exportEnabled);
  assert.equal(roleAllows(state, apiId, "sqs:SendMessage", exportQueue), true);
  assert.equal(
    roleAllows(state, apiId, "sqs:ReceiveMessage", exportQueue),
    false,
  );
  assert.equal(
    roleAllows(state, exportWorkerId, "sqs:SendMessage", exportQueue),
    false,
  );
  for (const action of [
    "sqs:ReceiveMessage",
    "sqs:DeleteMessage",
    "sqs:ChangeMessageVisibility",
    "sqs:GetQueueAttributes",
  ]) {
    assert.equal(roleAllows(state, exportWorkerId, action, exportQueue), true);
    for (const other of [
      queue,
      exportQueue.replace("exports.fifo", "exports-dlq.fifo"),
      exportQueue.replace(account, "111122223333"),
    ])
      assert.equal(roleAllows(state, exportWorkerId, action, other), false);
  }
  const forbidden = actions(state.statements(exportWorkerId)).filter((action) =>
    /^(cloudformation|codebuild|sts|iam):/u.test(action),
  );
  assert.deepEqual(forbidden, []);
});

test("export worker can access only the current project document tree and loses data grants when disabled", () => {
  const state = projection(exportEnabled);
  const object =
    "arn:aws:s3:::cloudmarkup-beta-000000000000-us-east-1-content/documents/v1/organizations/v1/organizations/org-a/projects/project-a/export-package/artifact-a/" +
    "a".repeat(64);
  for (const action of [
    "s3:GetObjectVersion",
    "s3:PutObject",
    "s3:PutObjectVersionTagging",
    "s3:DeleteObjectVersion",
  ]) {
    assert.equal(roleAllows(state, exportWorkerId, action, object), true);
    assert.equal(
      roleAllows(
        state,
        exportWorkerId,
        action,
        object.replace("-content/documents/", "-content/artifacts/"),
      ),
      false,
    );
    assert.equal(
      roleAllows(
        state,
        exportWorkerId,
        action,
        object.replace("-content/documents/", "-web/documents/"),
      ),
      false,
    );
    assert.equal(
      roleAllows(projection(enabled), exportWorkerId, action, object),
      false,
    );
  }
  assert.equal(
    roleAllows(state, exportWorkerId, "rds-data:ExecuteStatement", database),
    true,
  );
  assert.equal(
    roleAllows(
      state,
      exportWorkerId,
      "secretsmanager:GetSecretValue",
      databaseSecret,
      currentVersion,
    ),
    true,
  );
  assert.equal(
    roleAllows(
      state,
      exportWorkerId,
      "secretsmanager:GetSecretValue",
      apiKey,
      currentVersion,
    ),
    false,
  );
  assert.equal(
    roleAllows(
      projection(enabled),
      exportWorkerId,
      "rds-data:ExecuteStatement",
      database,
    ),
    false,
  );
  assert.equal(
    roleAllows(projection(enabled), apiId, "sqs:SendMessage", exportQueue),
    false,
  );
});

test("export deployment lifecycle binds its worker mapping and role without worker publication authority", () => {
  const state = projection(exportEnabled);
  const statements = state.statements(operationsId);
  assert.equal(
    allowed(statements, "lambda:CreateEventSourceMapping", "*", {
      "lambda:FunctionArn": exportWorkerArn,
    }),
    true,
  );
  assert.equal(
    allowed(statements, "lambda:CreateEventSourceMapping", "*", {
      "lambda:FunctionArn": exportWorkerArn + "-other",
    }),
    false,
  );
  const roleArn =
    "arn:aws:iam::" +
    account +
    ":role/CloudMarkup-Beta-Solution-Export-Worker-Runtime";
  assert.equal(
    allowed(statements, "iam:PassRole", roleArn, {
      "iam:PassedToService": "lambda.amazonaws.com",
    }),
    true,
  );
  assert.equal(
    allowed(statements, "iam:PassRole", roleArn, {
      "iam:PassedToService": "ec2.amazonaws.com",
    }),
    false,
  );
  assert.equal(
    allowed(
      projection(enabled).statements(operationsId),
      "iam:PassRole",
      roleArn,
      { "iam:PassedToService": "lambda.amazonaws.com" },
    ),
    false,
  );
  for (const resource of Object.values(template.Resources)) {
    if (resource.Type === "AWS::IAM::ManagedPolicy")
      assert.ok(
        JSON.stringify(state.resolve(resource.Properties.PolicyDocument))
          .length <= 6144,
        resource.Properties.ManagedPolicyName,
      );
    if (resource.Type === "AWS::IAM::Role")
      assert.ok(
        (resource.Properties.Policies ?? []).reduce(
          (sum, policy) =>
            sum + JSON.stringify(state.resolve(policy.PolicyDocument)).length,
          0,
        ) <= 10240,
        resource.Properties.RoleName,
      );
  }
});

test("export database access admits the Data API request without a secret version selector", () => {
  const state = projection(exportEnabled);
  assert.equal(
    roleAllows(
      state,
      exportWorkerId,
      "secretsmanager:GetSecretValue",
      databaseSecret,
    ),
    true,
  );
  assert.equal(
    roleAllows(
      state,
      exportWorkerId,
      "secretsmanager:GetSecretValue",
      databaseSecret,
      currentVersion,
    ),
    true,
  );
  assert.equal(
    roleAllows(
      state,
      exportWorkerId,
      "secretsmanager:GetSecretValue",
      databaseSecret,
      { "secretsmanager:VersionStage": "AWSPREVIOUS" },
    ),
    false,
  );
  for (const secret of [
    apiKey,
    signing,
    databaseSecret.replace(account, "111122223333"),
    databaseSecret.replace("database/admin-", "database/other-"),
  ]) {
    assert.equal(
      roleAllows(
        state,
        exportWorkerId,
        "secretsmanager:GetSecretValue",
        secret,
      ),
      false,
    );
  }
  assert.equal(
    roleAllows(
      projection(enabled),
      exportWorkerId,
      "secretsmanager:GetSecretValue",
      databaseSecret,
    ),
    false,
  );
});

test("functional beta invokes only the exact model through reviewed API, proposal and opt-in source roles", () => {
  const state = projection(exportEnabled);
  const resources = [
    "arn:aws:bedrock:us-east-1:000000000000:inference-profile/global.anthropic.claude-sonnet-4-6",
    "arn:aws:bedrock:::foundation-model/anthropic.claude-sonnet-4-6",
    "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-6",
  ];
  for (const resource of resources) {
    for (const role of [
      exportWorkerId,
      "CloudMarkupBetaProposalWorkerRuntimeRole",
    ]) {
      assert.equal(
        roleAllows(state, role, "bedrock:InvokeModel", resource),
        true,
      );
      assert.equal(
        roleAllows(
          state,
          role,
          "bedrock:InvokeModel",
          resource.replace("sonnet-4-6", "opus-4-6"),
        ),
        false,
      );
      assert.equal(
        roleAllows(
          state,
          role,
          "bedrock:InvokeModelWithResponseStream",
          resource,
        ),
        false,
      );
    }
    assert.equal(
      roleAllows(state, apiId, "bedrock:InvokeModel", resource),
      true,
    );
    for (const role of [workerId, webhookId])
      assert.equal(
        roleAllows(state, role, "bedrock:InvokeModel", resource),
        false,
      );
    assert.equal(
      roleAllows(
        state,
        apiId,
        "bedrock:InvokeModelWithResponseStream",
        resource,
      ),
      false,
    );
  }
  for (const resource of [
    resources[0].replace("000000000000", "111122223333"),
    resources[0].replace("sonnet-4-6", "opus-4-6"),
    resources[2].replace("us-east-1", "eu-west-1"),
  ])
    assert.equal(
      roleAllows(state, apiId, "bedrock:InvokeModel", resource),
      false,
    );
});

test("branding deployment is confined to tagged beta pools and the application execution policy", () => {
  const statements = projection(enabled).statements(
    "CloudMarkupBetaApplicationExecutionPolicy",
  );
  const pool =
    "arn:aws:cognito-idp:" +
    region +
    ":" +
    account +
    ":userpool/us-east-1_Example";
  const tags = {
    "aws:ResourceTag/Environment": "beta",
    "aws:ResourceTag/Project": "CloudMarkup",
  };
  for (const operation of [
    "CreateManagedLoginBranding",
    "DeleteManagedLoginBranding",
    "DescribeManagedLoginBranding",
    "DescribeManagedLoginBrandingByClient",
    "UpdateManagedLoginBranding",
  ]) {
    const action = "cognito-idp:" + operation;
    assert.equal(allowed(statements, action, pool, tags), true);
    for (const invalidTags of [
      {},
      { ...tags, "aws:ResourceTag/Environment": "prod" },
      { ...tags, "aws:ResourceTag/Project": "Other" },
    ])
      assert.equal(allowed(statements, action, pool, invalidTags), false);
    for (const invalidPool of [
      pool.replace(account, "111111111111"),
      pool.replace(":" + region + ":", ":us-west-2:"),
    ])
      assert.equal(allowed(statements, action, invalidPool, tags), false);
    for (const id of [apiId, webhookId, workerId, operationsId])
      assert.equal(
        allowed(projection(enabled).statements(id), action, pool, tags),
        false,
      );
  }
});

test("live bootstrap grants exactly live secrets and removes sandbox secret authority", () => {
  const liveKey =
      "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/live/api-key-EX0003",
    liveSigning =
      "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/live/webhook-signing-secret-EX0005";
  const config = {
    ...enabled,
    EnableStripeSandboxSessions: "true",
    StripeBillingEnvironment: "live",
    StripeSandboxWebhookSigningSecretArn: liveSigning,
  };
  const state = projection(config);
  for (const role of [apiId, workerId]) {
    assert.equal(
      roleAllows(
        state,
        role,
        "secretsmanager:GetSecretValue",
        liveKey,
        currentVersion,
      ),
      true,
    );
    for (const denied of [apiKey, signing, liveSigning, liveKey + "x"])
      assert.equal(
        roleAllows(
          state,
          role,
          "secretsmanager:GetSecretValue",
          denied,
          currentVersion,
        ),
        false,
      );
  }
  assert.equal(
    roleAllows(
      state,
      webhookId,
      "secretsmanager:GetSecretValue",
      liveSigning,
      currentVersion,
    ),
    true,
  );
  for (const denied of [liveKey, apiKey, signing, previous])
    assert.equal(
      roleAllows(
        state,
        webhookId,
        "secretsmanager:GetSecretValue",
        denied,
        currentVersion,
      ),
      false,
    );
  for (const patch of [
    { StripeBillingEnvironment: "test" },
    { StripeSandboxWebhookSigningSecretArn: signing },
    { StripeSandboxPreviousWebhookSigningSecretArn: previous },
    { EnableStripeSandboxDelivery: "false" },
  ])
    assert.throws(() => projection({ ...config, ...patch }));
});
