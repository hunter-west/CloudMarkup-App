import assert from "node:assert/strict";
import test from "node:test";

import {
  AWS_CREDENTIAL_PROVIDER_ENVIRONMENT_KEYS,
  assertCredentiallessCloudAssemblyManifest,
  createBetaCdkSynthesisArguments,
  createCredentiallessSynthesisEnvironment,
} from "./synthesize-beta-core.mjs";

test("isolates every reviewed AWS credential-provider input and disables metadata", () => {
  const source = Object.fromEntries(
    AWS_CREDENTIAL_PROVIDER_ENVIRONMENT_KEYS.map((key) => [key, "untrusted"]),
  );
  const result = createCredentiallessSynthesisEnvironment(
    {
      ...source,
      Aws_Secret_Access_Key: "mixed-case-must-not-survive",
      AWS_BEARER_TOKEN_BEDROCK: "must-not-survive",
      aws_access_key_id: "lowercase-must-not-survive",
      aws_bearer_token_bedrock: "lowercase-must-not-survive",
      SAFE_MARKER: "retained",
    },
    {
      configFile: "C:/isolated/aws-config",
      credentialsFile: "C:/isolated/aws-credentials",
    },
  );
  for (const key of AWS_CREDENTIAL_PROVIDER_ENVIRONMENT_KEYS) {
    if (key === "AWS_CONFIG_FILE" || key === "AWS_SHARED_CREDENTIALS_FILE") {
      continue;
    }
    assert.equal(Object.hasOwn(result, key), false, key);
  }
  assert.equal(result.AWS_CONFIG_FILE, "C:/isolated/aws-config");
  assert.equal(
    result.AWS_SHARED_CREDENTIALS_FILE,
    "C:/isolated/aws-credentials",
  );
  assert.equal(result.AWS_EC2_METADATA_DISABLED, "true");
  assert.equal(result.AWS_BEARER_TOKEN_BEDROCK, undefined);
  assert.equal(result.Aws_Secret_Access_Key, undefined);
  assert.equal(result.aws_access_key_id, undefined);
  assert.equal(result.aws_bearer_token_bedrock, undefined);
  assert.equal(Object.hasOwn(result, "AWS_SDK_LOAD_CONFIG"), false);
  assert.equal(result.CDK_DISABLE_VERSION_CHECK, "1");
  assert.equal(result.SAFE_MARKER, "retained");
});

test("rejects missing or aliased credential-isolation files", () => {
  assert.throws(
    () =>
      createCredentiallessSynthesisEnvironment(
        {},
        {
          configFile: "",
          credentialsFile: "C:/isolated/aws-credentials",
        },
      ),
    /requires distinct empty AWS config and credentials files/u,
  );
  assert.throws(
    () =>
      createCredentiallessSynthesisEnvironment(
        {},
        {
          configFile: "C:/isolated/same",
          credentialsFile: "C:/isolated/same",
        },
      ),
    /requires distinct empty AWS config and credentials files/u,
  );
});

test("requires CDK no-lookups for the exact output assembly", () => {
  const result = createBetaCdkSynthesisArguments({
    context: [["environment", "beta"]],
    output: "C:/reviewed/cdk.out",
    pnpmCli: "C:/reviewed/pnpm.cjs",
  });
  assert.equal(result.filter((value) => value === "--no-lookups").length, 1);
  assert.deepEqual(result.slice(-2), ["--output", "C:/reviewed/cdk.out"]);
});

test("rejects malformed or unresolved cloud-assembly context", () => {
  assert.doesNotThrow(() => assertCredentiallessCloudAssemblyManifest({}));
  assert.doesNotThrow(() =>
    assertCredentiallessCloudAssemblyManifest({ missing: [] }),
  );
  assert.throws(
    () => assertCredentiallessCloudAssemblyManifest({ missing: [{}] }),
    /unresolved AWS context lookups/u,
  );
  assert.throws(
    () => assertCredentiallessCloudAssemblyManifest({ missing: "invalid" }),
    /unresolved AWS context lookups/u,
  );
  assert.throws(
    () => assertCredentiallessCloudAssemblyManifest(null),
    /manifest is invalid/u,
  );
});
