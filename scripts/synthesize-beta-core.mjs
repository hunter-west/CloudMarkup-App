export const AWS_CREDENTIAL_PROVIDER_ENVIRONMENT_KEYS = Object.freeze([
  "AWS_ACCESS_KEY_ID",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_CONFIG_FILE",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_DEFAULT_PROFILE",
  "AWS_EC2_METADATA_SERVICE_ENDPOINT",
  "AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE",
  "AWS_PROFILE",
  "AWS_ROLE_ARN",
  "AWS_ROLE_SESSION_NAME",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SECURITY_TOKEN",
  "AWS_SDK_LOAD_CONFIG",
  "AWS_SESSION_TOKEN",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "CDK_DEFAULT_ACCOUNT",
  "CDK_DEFAULT_REGION",
]);

export function createCredentiallessSynthesisEnvironment(
  environment,
  { configFile, credentialsFile },
) {
  if (
    typeof configFile !== "string" ||
    configFile.length === 0 ||
    typeof credentialsFile !== "string" ||
    credentialsFile.length === 0 ||
    configFile === credentialsFile
  ) {
    throw new Error(
      "Credentialless synthesis requires distinct empty AWS config and credentials files.",
    );
  }
  const denied = new Set(AWS_CREDENTIAL_PROVIDER_ENVIRONMENT_KEYS);
  return {
    ...Object.fromEntries(
      Object.entries(environment).filter(
        ([key]) => !denied.has(key.toUpperCase()),
      ),
    ),
    AWS_CONFIG_FILE: configFile,
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_SHARED_CREDENTIALS_FILE: credentialsFile,
    CDK_DISABLE_VERSION_CHECK: "1",
  };
}

export function createBetaCdkSynthesisArguments({ context, output, pnpmCli }) {
  return [
    pnpmCli,
    "--filter",
    "@cloudmarkup/platform",
    "exec",
    "cdk",
    "synth",
    "--quiet",
    "--no-lookups",
    ...context.flatMap(([key, value]) => ["-c", `${key}=${value}`]),
    "--output",
    output,
  ];
}

export function assertCredentiallessCloudAssemblyManifest(manifest) {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest)
  ) {
    throw new Error("The beta cloud-assembly manifest is invalid.");
  }
  if (
    Object.hasOwn(manifest, "missing") &&
    (!Array.isArray(manifest.missing) || manifest.missing.length > 0)
  ) {
    throw new Error(
      "The beta cloud assembly contains unresolved AWS context lookups.",
    );
  }
}
