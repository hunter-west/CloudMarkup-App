import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBetaServiceProfileReceipt,
  betaServiceCdkContext,
  parseBetaServiceProfile,
  serializeBetaServiceProfile,
  validateBetaSandboxDelivery,
} from "./beta-sandbox-delivery-admission.mjs";
import {
  validateBetaAssembly,
  validateBetaReleaseEnvironment,
} from "./beta-release-gate-core.mjs";

const current =
  "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/webhook-signing-secret-a1b2c3";
const previous =
  "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/webhook-signing-previous-d4e5f6";
const sandbox = {
  BETA_SERVICE_PROFILE: "stripe-sandbox-v1",
  BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN: current,
};
const connections = {
  ...sandbox,
  BETA_SERVICE_PROFILE: "stripe-sandbox-github-connections-v1",
};
const githubEnvironment = {
  CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED: "true",
  CLOUDMARKUP_GITHUB_APP_ID: "123456",
  CLOUDMARKUP_GITHUB_APP_SLUG: "cloudmarkup-example-beta",
  CLOUDMARKUP_GITHUB_CLIENT_ID: "IvEXAMPLE000000000000",
  CLOUDMARKUP_GITHUB_PRIVATE_KEY_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/github/app-private-key-EX0002",
  CLOUDMARKUP_GITHUB_CLIENT_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:000000000000:secret:Github-App-Client-Secret-EX0001",
  CLOUDMARKUP_GITHUB_CLIENT_SECRET_JSON_FIELD: "Client secret",
};
const environment = {
  AWS_ACCOUNT_ID: "000000000000",
  AWS_REGION: "us-east-1",
  AWS_ROLE_ARN: "arn:aws:iam::000000000000:role/CloudMarkup-Beta-GitHub",
  BETA_BASE_URL: "https://beta.example.invalid",
  BETA_CERTIFICATE_ARN:
    "arn:aws:acm:us-east-1:000000000000:certificate/12345678-1234-1234-1234-123456789abc",
  BETA_CREATE_DNS_RECORDS: "false",
  CLOUDMARKUP_ENVIRONMENT: "beta",
  GITHUB_SHA: "d".repeat(40),
  SOURCE_REVISION: "d".repeat(40),
  DEPLOYMENT_BUNDLE_SHA256: "c".repeat(64),
};
test("service profile defaults to a canonical inactive receipt and exact CDK context", () => {
  const value = {
    contractVersion: 1,
    profile: "core-v1",
    sessionsEnabled: false,
    signingArn: "",
    previousArn: "",
  };
  assert.deepEqual(parseBetaServiceProfile({}), value);
  assert.ok(Object.isFrozen(parseBetaServiceProfile({})));
  assert.equal(serializeBetaServiceProfile({}), JSON.stringify(value) + "\n");
  assert.deepEqual(betaServiceCdkContext({}), [
    ["serviceProfile", "core-v1"],
    ["stripeSandboxSessionsEnabled", "false"],
  ]);
  assert.equal(
    serializeBetaServiceProfile({
      BETA_SERVICE_PROFILE: "",
      BETA_STRIPE_SANDBOX_SESSIONS_ENABLED: "",
    }),
    serializeBetaServiceProfile({}),
  );
});
test("sandbox selectors independently bind sessions and optional signing rotation to the synth context", () => {
  assert.deepEqual(betaServiceCdkContext(sandbox), [
    ["serviceProfile", "stripe-sandbox-v1"],
    ["stripeSandboxSessionsEnabled", "false"],
    ["stripeWebhookSigningSecretArn", current],
  ]);
  const selected = {
    ...sandbox,
    BETA_STRIPE_SANDBOX_SESSIONS_ENABLED: "true",
    BETA_STRIPE_PREVIOUS_WEBHOOK_SIGNING_SECRET_ARN: previous,
  };
  assert.deepEqual(parseBetaServiceProfile(selected), {
    contractVersion: 1,
    profile: "stripe-sandbox-v1",
    sessionsEnabled: true,
    signingArn: current,
    previousArn: previous,
  });
  assert.deepEqual(betaServiceCdkContext(selected).at(-1), [
    "stripePreviousWebhookSigningSecretArn",
    previous,
  ]);
  assert.doesNotThrow(() =>
    assertBetaServiceProfileReceipt(
      serializeBetaServiceProfile(selected),
      selected,
    ),
  );
});
test("connections are one explicit additive profile with the unchanged receipt field set", () => {
  for (const sessionsEnabled of [false, true]) {
    const selected = {
      ...connections,
      BETA_STRIPE_SANDBOX_SESSIONS_ENABLED: String(sessionsEnabled),
      BETA_STRIPE_PREVIOUS_WEBHOOK_SIGNING_SECRET_ARN: previous,
    };
    assert.deepEqual(parseBetaServiceProfile(selected), {
      contractVersion: 1,
      profile: "stripe-sandbox-github-connections-v1",
      sessionsEnabled,
      signingArn: current,
      previousArn: previous,
    });
    assert.deepEqual(betaServiceCdkContext(selected), [
      ["serviceProfile", "stripe-sandbox-github-connections-v1"],
      ["stripeSandboxSessionsEnabled", String(sessionsEnabled)],
      ["stripeWebhookSigningSecretArn", current],
      ["stripePreviousWebhookSigningSecretArn", previous],
    ]);
    assert.doesNotThrow(() =>
      assertBetaServiceProfileReceipt(
        serializeBetaServiceProfile(selected),
        selected,
      ),
    );
    for (const other of [{}, sandbox]) {
      assert.throws(() =>
        assertBetaServiceProfileReceipt(
          serializeBetaServiceProfile(selected),
          other,
        ),
      );
      assert.throws(() =>
        assertBetaServiceProfileReceipt(
          serializeBetaServiceProfile(other),
          selected,
        ),
      );
    }
  }
  assert.equal(parseBetaServiceProfile(connections).sessionsEnabled, false);
  assert.throws(() =>
    parseBetaServiceProfile({
      ...connections,
      BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN: "",
    }),
  );
  assert.throws(() =>
    parseBetaServiceProfile({ BETA_SERVICE_PROFILE: "github-connections-v1" }),
  );
});

test("export profile preserves the explicit sandbox-session selector and receipt binding", () => {
  for (const sessions of ["false", "true"]) {
    const selected = {
      ...sandbox,
      BETA_SERVICE_PROFILE: "stripe-sandbox-github-cloudformation-v1",
      BETA_STRIPE_SANDBOX_SESSIONS_ENABLED: sessions,
    };
    assert.equal(
      parseBetaServiceProfile(selected).sessionsEnabled,
      sessions === "true",
    );
    assert.doesNotThrow(() =>
      assertBetaServiceProfileReceipt(
        serializeBetaServiceProfile(selected),
        selected,
      ),
    );
    assert.throws(() =>
      assertBetaServiceProfileReceipt(serializeBetaServiceProfile(selected), {
        ...selected,
        BETA_STRIPE_SANDBOX_SESSIONS_ENABLED:
          sessions === "true" ? "false" : "true",
      }),
    );
  }
});

// These deliberately incomplete resources isolate GitHub configuration admission.
// They do not stand in for successful full assembly or code-asset admission.
function githubFindings(selectors, apiValues = githubEnvironment, other = {}) {
  const stacks = [
    {
      stackName: "cloudmarkup-beta-application",
      template: {
        Resources: {
          Api: {
            Type: "AWS::Lambda::Function",
            Properties: {
              FunctionName: "cloudmarkup-beta-api",
              Environment: { Variables: apiValues },
            },
          },
          Other: {
            Type: "AWS::Lambda::Function",
            Properties: {
              FunctionName: "cloudmarkup-beta-database-migrator",
              Environment: { Variables: other },
            },
          },
        },
      },
    },
  ];
  return validateBetaSandboxDelivery(
    stacks,
    parseBetaServiceProfile(selectors),
  ).filter(
    ({ code }) => code === "BETA_SANDBOX_GITHUB_CONNECTION_CONFIGURATION",
  );
}
test("only the selected API admits the exact GitHub connection environment", () => {
  assert.deepEqual(githubFindings(connections), []);
  for (const old of [{}, sandbox]) {
    assert.deepEqual(
      githubFindings(old, { CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED: "false" }),
      [],
    );
    assert.equal(githubFindings(old).length, 1);
  }
  assert.equal(
    githubFindings(connections, {
      CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED: "false",
    }).length,
    1,
  );
  for (const key of Object.keys(githubEnvironment)) {
    const { [key]: omitted, ...missing } = githubEnvironment;
    assert.equal(typeof omitted, "string");
    assert.equal(
      githubFindings(connections, missing).length,
      1,
      key + " absent",
    );
    assert.equal(
      githubFindings(connections, { ...githubEnvironment, [key]: "changed" })
        .length,
      1,
      key + " changed",
    );
    assert.equal(
      githubFindings(connections, githubEnvironment, {
        [key]: githubEnvironment[key],
      }).length,
      1,
      key + " on another runtime",
    );
  }
  for (const key of [
    "CLOUDMARKUP_GITHUB_WEBHOOK_SECRET_NAME",
    "CLOUDMARKUP_GITHUB_PRIVATE_KEY_SECRET_NAME",
    "CLOUDMARKUP_GITHUB_EXPORT_ENABLED",
    "CLOUDMARKUP_GITHUB_UNREVIEWED",
  ])
    assert.equal(
      githubFindings(connections, { ...githubEnvironment, [key]: "true" })
        .length,
      1,
      key,
    );
  for (const key of [
    "CLOUDMARKUP_GITHUB_PRIVATE_KEY_SECRET_ARN",
    "CLOUDMARKUP_GITHUB_CLIENT_SECRET_ARN",
  ]) {
    for (const value of [
      githubEnvironment[key].replace("000000000000", "111122223333"),
      githubEnvironment[key].replace("us-east-1", "eu-west-1"),
      githubEnvironment[key] + "*",
    ])
      assert.equal(
        githubFindings(connections, { ...githubEnvironment, [key]: value })
          .length,
        1,
      );
  }
});
for (const [name, override] of [
  ["unknown profile", { BETA_SERVICE_PROFILE: "full-beta" }],
  ["live profile", { BETA_SERVICE_PROFILE: "stripe-live-v1" }],
  ["boolean session", { BETA_STRIPE_SANDBOX_SESSIONS_ENABLED: true }],
  ["capitalized session", { BETA_STRIPE_SANDBOX_SESSIONS_ENABLED: "True" }],
  ["padded profile", { BETA_SERVICE_PROFILE: " stripe-sandbox-v1" }],
  ["padded ARN", { BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN: current + " " }],
  ["missing signing ARN", { BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN: "" }],
  [
    "wrong account",
    {
      BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN: current.replace(
        "000000000000",
        "111122223333",
      ),
    },
  ],
  [
    "wrong region",
    {
      BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN: current.replace(
        "us-east-1",
        "us-west-2",
      ),
    },
  ],
  [
    "wildcard signing ARN",
    { BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN: current + "*" },
  ],
  [
    "API key substituted for signing",
    {
      BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN: current.replace(
        "webhook-signing-secret",
        "api-key",
      ),
    },
  ],
  [
    "same secret as previous",
    { BETA_STRIPE_PREVIOUS_WEBHOOK_SIGNING_SECRET_ARN: current },
  ],
  [
    "padded previous ARN",
    { BETA_STRIPE_PREVIOUS_WEBHOOK_SIGNING_SECRET_ARN: previous + " " },
  ],
  ["core plus signing", { BETA_SERVICE_PROFILE: "core-v1" }],
]) {
  test("closed selector rejects " + name, () => {
    assert.throws(() => parseBetaServiceProfile({ ...sandbox, ...override }));
    assert.ok(
      validateBetaReleaseEnvironment({
        ...environment,
        ...sandbox,
        ...override,
      }).some(({ code }) => code === "BETA_SERVICE_PROFILE_INVALID"),
    );
  });
}
test("core cannot select sessions or retain a rotation reference without delivery", () => {
  for (const input of [
    { BETA_STRIPE_SANDBOX_SESSIONS_ENABLED: "true" },
    { BETA_STRIPE_PREVIOUS_WEBHOOK_SIGNING_SECRET_ARN: previous },
  ])
    assert.throws(() => parseBetaServiceProfile(input));
});
test("canonical receipt rejects missing, extra, reordered, padded or changed fields", () => {
  const receipt = serializeBetaServiceProfile(sandbox);
  const parsed = JSON.parse(receipt);
  const { previousArn: omitted, ...missing } = parsed;
  assert.equal(omitted, "");
  for (const candidate of [
    "",
    undefined,
    receipt.trim(),
    receipt + "\n",
    JSON.stringify(missing) + "\n",
    JSON.stringify({ ...parsed, extra: true }) + "\n",
    JSON.stringify({ ...parsed, contractVersion: 2 }) + "\n",
    JSON.stringify({ ...parsed, sessionsEnabled: true }) + "\n",
    JSON.stringify({
      ...parsed,
      signingArn: current.replace("a1b2c3", "d4e5f6"),
    }) + "\n",
    JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse())) + "\n",
    "x".repeat(2049),
  ])
    assert.throws(() => assertBetaServiceProfileReceipt(candidate, sandbox));
  assert.throws(() => assertBetaServiceProfileReceipt(receipt, {}));
  assert.throws(() =>
    assertBetaServiceProfileReceipt(serializeBetaServiceProfile({}), sandbox),
  );
});
test("real environment and assembly admission consume the selected profile rather than an unused alternate", () => {
  for (const selectors of [
    {},
    sandbox,
    connections,
    { ...sandbox, BETA_STRIPE_SANDBOX_SESSIONS_ENABLED: "true" },
  ])
    assert.deepEqual(
      validateBetaReleaseEnvironment({ ...environment, ...selectors }),
      [],
    );
  const stacks = [
    {
      stackName: "cloudmarkup-beta-application",
      template: {
        Resources: {
          ExtraQueue: { Type: "AWS::SQS::Queue", Properties: {} },
        },
      },
    },
  ];
  assert.ok(
    validateBetaAssembly(stacks, environment).some(
      ({ code }) => code === "BETA_SANDBOX_CORE_ACTIVATION",
    ),
  );
  assert.ok(
    validateBetaAssembly(stacks, { ...environment, ...sandbox }).some(
      ({ code }) => code === "BETA_SANDBOX_RESOURCE_SET",
    ),
  );
  assert.ok(
    validateBetaAssembly(stacks, {
      ...environment,
      BETA_SERVICE_PROFILE: "unreviewed",
    }).some(({ code }) => code === "BETA_SERVICE_PROFILE_INVALID"),
  );
});

test("live release receipt pins the exact signing reference and refuses mixed-mode rotation", () => {
  const selected = {
    BETA_SERVICE_PROFILE: "stripe-live-github-cloudformation-v1",
    BETA_STRIPE_SANDBOX_SESSIONS_ENABLED: "true",
    BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN:
      "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/live/webhook-signing-secret-EX0005",
  };
  assert.equal(
    parseBetaServiceProfile(selected).profile,
    selected.BETA_SERVICE_PROFILE,
  );
  assert.equal(parseBetaServiceProfile(selected).sessionsEnabled, true);
  assert.doesNotThrow(() =>
    assertBetaServiceProfileReceipt(
      serializeBetaServiceProfile(selected),
      selected,
    ),
  );
  for (const patch of [
    { BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN: current },
    { BETA_STRIPE_PREVIOUS_WEBHOOK_SIGNING_SECRET_ARN: previous },
    { BETA_SERVICE_PROFILE: "stripe-sandbox-github-cloudformation-v1" },
  ])
    assert.throws(() => parseBetaServiceProfile({ ...selected, ...patch }));
});
