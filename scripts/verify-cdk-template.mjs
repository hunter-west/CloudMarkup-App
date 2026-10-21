import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

const assemblyRoot = resolve("infra", "platform", "cdk.out");
const expectedStackNames = [
  "cloudmarkup-dev-application",
  "cloudmarkup-dev-edge",
  "cloudmarkup-dev-observability",
  "cloudmarkup-dev-stateful",
];
const expectedPlatformTarget = Object.freeze({
  account: "000000000000",
  region: "us-east-1",
});
// DefaultStackSynthesizer emits this CloudFormation rule description for asset
// compatibility. It documents an operator prerequisite; this repository still
// exposes and executes no bootstrap command.
const generatedBootstrapVersionAssertion =
  "CDK bootstrap stack version 6 required. Please run 'cdk bootstrap' with a recent version of the CDK CLI.";
// DefaultStackSynthesizer also emits this exact SSM parameter description. Its
// capitalized "CDK Bootstrap" label is metadata, not an executable command.
const generatedBootstrapVersionParameterDescription =
  "Version of the CDK Bootstrap resources in this environment, automatically retrieved from SSM Parameter Store. [cdk:skip]";
const resourceStarActionAllowlist = new Set([
  "logs:CreateLogDelivery",
  "logs:DeleteLogDelivery",
  "logs:DescribeLogGroups",
  "logs:DescribeResourcePolicies",
  "logs:GetLogDelivery",
  "logs:ListLogDeliveries",
  "logs:PutResourcePolicy",
  "logs:UpdateLogDelivery",
  "xray:GetSamplingRules",
  "xray:GetSamplingStatisticSummaries",
  "xray:GetSamplingTargets",
  "xray:PutTelemetryRecords",
  "xray:PutTraceSegments",
]);
const sandboxEcrAuthorizationActions = new Set(["ecr:GetAuthorizationToken"]);
const sandboxVpcNetworkActions = new Set([
  "ec2:CreateNetworkInterface",
  "ec2:DeleteNetworkInterface",
  "ec2:DescribeDhcpOptions",
  "ec2:DescribeNetworkInterfaces",
  "ec2:DescribeSecurityGroups",
  "ec2:DescribeSubnets",
  "ec2:DescribeVpcs",
]);
const kmsKeyAdministratorActions = new Set([
  "kms:CancelKeyDeletion",
  "kms:CreateAlias",
  "kms:CreateGrant",
  "kms:DeleteAlias",
  "kms:DescribeKey",
  "kms:DisableKey",
  "kms:DisableKeyRotation",
  "kms:EnableKey",
  "kms:EnableKeyRotation",
  "kms:GetKeyPolicy",
  "kms:GetKeyRotationStatus",
  "kms:ListAliases",
  "kms:ListGrants",
  "kms:ListKeyPolicies",
  "kms:ListResourceTags",
  "kms:PutKeyPolicy",
  "kms:RetireGrant",
  "kms:RevokeGrant",
  "kms:ScheduleKeyDeletion",
  "kms:TagResource",
  "kms:UntagResource",
  "kms:UpdateAlias",
  "kms:UpdateKeyDescription",
]);
const kmsServicePublisherActions = new Set([
  "kms:Decrypt",
  "kms:GenerateDataKey",
  "kms:GenerateDataKeyWithoutPlaintext",
]);
if (
  [...kmsKeyAdministratorActions, ...kmsServicePublisherActions].some(
    (action) => action.includes("*"),
  )
) {
  throw new Error(
    "The KMS key-policy action sets must contain exact actions only.",
  );
}
const forbiddenAssemblyPatterns = [
  {
    label: "customer compiler path",
    pattern: /(?:services[/\\]iac-compiler|@cloudmarkup[/\\]iac-compiler)/iu,
  },
  {
    label: "deployment command",
    pattern:
      /\b(?:cdk\s+(?:bootstrap|deploy)|terraform\s+apply|aws\s+cloudformation\s+deploy|cloudformation\s+deploy|pnpm\s+deploy|npm\s+run\s+deploy)\b/iu,
  },
  {
    label: "AWS access-key literal",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  },
  {
    label: "private-key literal",
    pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u,
  },
  {
    label: "GitHub access-token literal",
    pattern: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b/u,
  },
  {
    label: "Stripe secret literal",
    pattern: /\b(?:sk_(?:live|test)|whsec)_[A-Za-z0-9]{12,}\b/u,
  },
];
const secretLiteralPropertyNames = new Set([
  "accesstoken",
  "apikey",
  "idtoken",
  "password",
  "privatekey",
  "refreshtoken",
  "secretstring",
  "secretvalue",
]);

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat().sort();
}

function assertWithinAssembly(path) {
  const localPath = relative(assemblyRoot, path);
  if (
    localPath === "" ||
    localPath.startsWith("..") ||
    resolve(assemblyRoot, localPath) !== path
  ) {
    throw new Error("CDK assembly reference escapes cdk.out: " + path);
  }
}

function parseObject(text, location) {
  const value = JSON.parse(text);
  if (!isObject(value)) {
    throw new Error(location + " must contain a JSON object.");
  }
  return value;
}

function literalStrings(value, location) {
  if (typeof value === "string") {
    return [value];
  }
  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  ) {
    return value;
  }
  throw new Error(location + " must use reviewable literal strings.");
}

function containsLiteralStar(value) {
  if (value === "*") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsLiteralStar(entry));
  }
  return (
    isObject(value) &&
    Object.values(value).some((entry) => containsLiteralStar(entry))
  );
}

function containsLiteralResourceStar(value) {
  return (
    value === "*" ||
    (Array.isArray(value) && value.some((entry) => entry === "*"))
  );
}

function hasExactKeys(value, expectedKeys) {
  if (!isObject(value)) {
    return false;
  }
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function isExactActionSet(actions, expectedActions) {
  return (
    actions.length === expectedActions.size &&
    new Set(actions).size === actions.length &&
    actions.every((action) => expectedActions.has(action))
  );
}

function isAwsPartitionArn(value, suffix) {
  if (!hasExactKeys(value, ["Fn::Join"])) {
    return false;
  }
  const join = value["Fn::Join"];
  if (
    !Array.isArray(join) ||
    join.length !== 2 ||
    join[0] !== "" ||
    !Array.isArray(join[1]) ||
    join[1].length !== 3
  ) {
    return false;
  }
  const [prefix, partition, actualSuffix] = join[1];
  return (
    prefix === "arn:" &&
    hasExactKeys(partition, ["Ref"]) &&
    partition.Ref === "AWS::Partition" &&
    actualSuffix === suffix
  );
}

function isTargetAccountRootPrincipal(principal) {
  return (
    hasExactKeys(principal, ["AWS"]) &&
    isAwsPartitionArn(
      principal.AWS,
      `:iam::${expectedPlatformTarget.account}:root`,
    )
  );
}

const kmsPublisherSourceArnSuffixes = new Map([
  [
    "cloudwatch.amazonaws.com",
    `:cloudwatch:${expectedPlatformTarget.region}:${expectedPlatformTarget.account}:alarm:*`,
  ],
  ["budgets.amazonaws.com", `:budgets::${expectedPlatformTarget.account}:*`],
  [
    "costalerts.amazonaws.com",
    `:ce::${expectedPlatformTarget.account}:anomalysubscription/*`,
  ],
]);

function isExactServicePrincipal(principal, service) {
  return hasExactKeys(principal, ["Service"]) && principal.Service === service;
}

function hasExactPublisherConditions(condition, sourceArnSuffix) {
  if (!hasExactKeys(condition, ["ArnLike", "StringEquals"])) {
    return false;
  }
  const arnLike = condition.ArnLike;
  const stringEquals = condition.StringEquals;
  return (
    hasExactKeys(arnLike, ["aws:SourceArn"]) &&
    isAwsPartitionArn(arnLike["aws:SourceArn"], sourceArnSuffix) &&
    hasExactKeys(stringEquals, ["aws:SourceAccount"]) &&
    stringEquals["aws:SourceAccount"] === expectedPlatformTarget.account
  );
}

if (
  !containsLiteralStar({ AWS: "*" }) ||
  !containsLiteralStar({ AWS: ["arn:aws:iam::111111111111:root", "*"] }) ||
  containsLiteralStar({ Service: "lambda.amazonaws.com" }) ||
  containsLiteralStar({ AWS: { Ref: "TrustedPrincipalArn" } })
) {
  throw new Error(
    "The wildcard-principal detector is not recursive and exact.",
  );
}

const cognitoTokenValidityUnitKeys = new Set([
  "AccessToken",
  "IdToken",
  "RefreshToken",
]);
const cognitoTokenValidityUnitValues = new Set([
  "seconds",
  "minutes",
  "hours",
  "days",
]);

function isCognitoTokenValidityUnit(location, key, value) {
  return (
    location.endsWith(".TokenValidityUnits") &&
    cognitoTokenValidityUnitKeys.has(key) &&
    typeof value === "string" &&
    cognitoTokenValidityUnitValues.has(value)
  );
}

if (
  !isCognitoTokenValidityUnit(
    "template.Resources.Client.Properties.TokenValidityUnits",
    "AccessToken",
    "minutes",
  ) ||
  isCognitoTokenValidityUnit(
    "template.Resources.Client.Properties.OtherUnits",
    "AccessToken",
    "minutes",
  ) ||
  isCognitoTokenValidityUnit(
    "template.Resources.Client.Properties.TokenValidityUnits",
    "AccessToken",
    "literal-token",
  ) ||
  isCognitoTokenValidityUnit(
    "template.Resources.Client.Properties.TokenValidityUnits",
    "OtherToken",
    "minutes",
  )
) {
  throw new Error("The Cognito token-validity-unit exception is not exact.");
}

function isSandboxServiceRoleStatement(location) {
  return /^cloudmarkup-dev-application\.Resources\.(?:TerraformValidation|ApplicationBuild)ServiceRoleDefaultPolicy[A-Za-z0-9]+\.Properties\.PolicyDocument\.Statement\[\d+\]$/u.test(
    location,
  );
}

function hasExactRequestedRegionCondition(condition) {
  return (
    hasExactKeys(condition, ["StringEquals"]) &&
    hasExactKeys(condition.StringEquals, ["aws:RequestedRegion"]) &&
    condition.StringEquals["aws:RequestedRegion"] ===
      expectedPlatformTarget.region
  );
}

function reviewPolicyDocument(
  policyDocument,
  location,
  isKmsKeyPolicy = false,
) {
  if (!isObject(policyDocument)) {
    throw new Error(location + " must be an object.");
  }
  const statements = Array.isArray(policyDocument.Statement)
    ? policyDocument.Statement
    : [policyDocument.Statement];

  for (const [index, statement] of statements.entries()) {
    const statementLocation = location + ".Statement[" + String(index) + "]";
    if (!isObject(statement)) {
      throw new Error(statementLocation + " must be an object.");
    }
    if (statement.Effect !== "Allow") {
      continue;
    }
    if (
      "NotAction" in statement ||
      "NotPrincipal" in statement ||
      "NotResource" in statement
    ) {
      throw new Error(
        statementLocation +
          " uses NotAction, NotPrincipal, or NotResource in an Allow statement.",
      );
    }
    if (containsLiteralStar(statement.Principal)) {
      throw new Error(statementLocation + " allows a wildcard principal.");
    }

    const actions = literalStrings(
      statement.Action,
      statementLocation + ".Action",
    );
    for (const action of actions) {
      if (action.includes("*")) {
        throw new Error(
          statementLocation +
            " contains wildcard action " +
            JSON.stringify(action) +
            ".",
        );
      }
    }

    if (isKmsKeyPolicy) {
      if (statement.Resource !== "*") {
        throw new Error(
          statementLocation +
            ' must use the exact reviewed AWS::KMS::Key policy Resource "*".',
        );
      }
      if (isExactActionSet(actions, kmsKeyAdministratorActions)) {
        if (
          !isTargetAccountRootPrincipal(statement.Principal) ||
          "Condition" in statement
        ) {
          throw new Error(
            statementLocation +
              " must bind the exact KMS administrator actions only to the target account root without an alternate condition.",
          );
        }
        continue;
      }
      if (isExactActionSet(actions, kmsServicePublisherActions)) {
        const service = isObject(statement.Principal)
          ? statement.Principal.Service
          : undefined;
        const sourceArnSuffix =
          typeof service === "string"
            ? kmsPublisherSourceArnSuffixes.get(service)
            : undefined;
        if (
          sourceArnSuffix === undefined ||
          !isExactServicePrincipal(statement.Principal, service) ||
          !hasExactPublisherConditions(statement.Condition, sourceArnSuffix)
        ) {
          throw new Error(
            statementLocation +
              " must bind the exact KMS publisher actions only to CloudWatch alarms, AWS Budgets, or Cost Anomaly subscriptions with the exact target SourceAccount and SourceArn conditions.",
          );
        }
        continue;
      }
      throw new Error(
        statementLocation +
          " does not match an exact reviewed AWS::KMS::Key policy action set.",
      );
    }

    if (containsLiteralResourceStar(statement.Resource)) {
      if (
        isExactActionSet(actions, sandboxEcrAuthorizationActions) &&
        isSandboxServiceRoleStatement(statementLocation) &&
        !("Condition" in statement)
      ) {
        continue;
      }
      if (
        isExactActionSet(actions, sandboxVpcNetworkActions) &&
        isSandboxServiceRoleStatement(statementLocation) &&
        hasExactRequestedRegionCondition(statement.Condition)
      ) {
        continue;
      }
      const disallowedActions = actions.filter(
        (action) => !resourceStarActionAllowlist.has(action),
      );
      if (disallowedActions.length > 0) {
        throw new Error(
          statementLocation +
            ' grants literal Resource "*" to actions that require narrower review: ' +
            disallowedActions.join(", ") +
            ".",
        );
      }
    }
  }
}

function awsPartitionArnFixture(suffix) {
  return {
    "Fn::Join": ["", ["arn:", { Ref: "AWS::Partition" }, suffix]],
  };
}

function publisherConditionsFixture(sourceArnSuffix, sourceAccount) {
  return {
    ArnLike: {
      "aws:SourceArn": awsPartitionArnFixture(sourceArnSuffix),
    },
    StringEquals: { "aws:SourceAccount": sourceAccount },
  };
}

function publisherStatementFixture(service, sourceArnSuffix) {
  return {
    Action: [...kmsServicePublisherActions],
    Condition: publisherConditionsFixture(
      sourceArnSuffix,
      expectedPlatformTarget.account,
    ),
    Effect: "Allow",
    Principal: { Service: service },
    Resource: "*",
  };
}

function assertPolicyRejected(policyDocument, location, isKmsKeyPolicy) {
  let rejected = false;
  try {
    reviewPolicyDocument(policyDocument, location, isKmsKeyPolicy);
  } catch {
    rejected = true;
  }
  if (!rejected) {
    throw new Error(location + " must fail closed.");
  }
}

const terraformValidationPolicyLocation =
  "cloudmarkup-dev-application.Resources.TerraformValidationServiceRoleDefaultPolicyFixture.Properties.PolicyDocument";
reviewPolicyDocument(
  {
    Statement: {
      Action: [...sandboxVpcNetworkActions],
      Condition: {
        StringEquals: {
          "aws:RequestedRegion": expectedPlatformTarget.region,
        },
      },
      Effect: "Allow",
      Resource: "*",
    },
  },
  terraformValidationPolicyLocation,
);
reviewPolicyDocument(
  {
    Statement: {
      Action: [...sandboxEcrAuthorizationActions],
      Effect: "Allow",
      Resource: "*",
    },
  },
  terraformValidationPolicyLocation,
);
assertPolicyRejected(
  {
    Statement: {
      Action: [...sandboxVpcNetworkActions],
      Effect: "Allow",
      Resource: "*",
    },
  },
  terraformValidationPolicyLocation,
);
assertPolicyRejected(
  {
    Statement: {
      Action: [...sandboxEcrAuthorizationActions],
      Effect: "Allow",
      Resource: "*",
    },
  },
  "verifier.ArbitraryEcrAuthorizationFixture",
);

const accountRootPrincipalFixture = {
  AWS: awsPartitionArnFixture(`:iam::${expectedPlatformTarget.account}:root`),
};
const cloudWatchSourceArnSuffix = kmsPublisherSourceArnSuffixes.get(
  "cloudwatch.amazonaws.com",
);
const budgetSourceArnSuffix = kmsPublisherSourceArnSuffixes.get(
  "budgets.amazonaws.com",
);
const costAnomalySourceArnSuffix = kmsPublisherSourceArnSuffixes.get(
  "costalerts.amazonaws.com",
);
if (
  cloudWatchSourceArnSuffix === undefined ||
  budgetSourceArnSuffix === undefined ||
  costAnomalySourceArnSuffix === undefined
) {
  throw new Error(
    "The KMS publisher fixtures require exact CloudWatch, AWS Budgets, and Cost Anomaly source ARNs.",
  );
}
const validCloudWatchPublisherStatement = publisherStatementFixture(
  "cloudwatch.amazonaws.com",
  cloudWatchSourceArnSuffix,
);

reviewPolicyDocument(
  {
    Statement: [
      {
        Action: [...kmsKeyAdministratorActions],
        Effect: "Allow",
        Principal: accountRootPrincipalFixture,
        Resource: "*",
      },
      validCloudWatchPublisherStatement,
      publisherStatementFixture("budgets.amazonaws.com", budgetSourceArnSuffix),
      publisherStatementFixture(
        "costalerts.amazonaws.com",
        costAnomalySourceArnSuffix,
      ),
    ],
  },
  "verifier.ValidKmsKeyPolicyFixture",
  true,
);

assertPolicyRejected(
  {
    Statement: {
      Action: [...kmsKeyAdministratorActions],
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Resource: "*",
    },
  },
  "verifier.ArbitraryServiceAdministratorFixture",
  true,
);
assertPolicyRejected(
  {
    Statement: {
      ...validCloudWatchPublisherStatement,
      Principal: accountRootPrincipalFixture,
    },
  },
  "verifier.AccountRootPublisherFixture",
  true,
);
assertPolicyRejected(
  {
    Statement: {
      Action: [...kmsServicePublisherActions],
      Effect: "Allow",
      Principal: { Service: "cloudwatch.amazonaws.com" },
      Resource: "*",
    },
  },
  "verifier.MissingPublisherConditionFixture",
  true,
);
assertPolicyRejected(
  {
    Statement: {
      ...validCloudWatchPublisherStatement,
      Condition: publisherConditionsFixture(
        cloudWatchSourceArnSuffix,
        "111111111111",
      ),
    },
  },
  "verifier.WrongPublisherSourceAccountFixture",
  true,
);
assertPolicyRejected(
  {
    Statement: {
      ...validCloudWatchPublisherStatement,
      Condition: publisherConditionsFixture(
        `:cloudwatch:${expectedPlatformTarget.region}:${expectedPlatformTarget.account}:alarm:wrong`,
        expectedPlatformTarget.account,
      ),
    },
  },
  "verifier.WrongPublisherSourceArnFixture",
  true,
);
assertPolicyRejected(
  {
    Statement: {
      ...publisherStatementFixture(
        "costalerts.amazonaws.com",
        costAnomalySourceArnSuffix,
      ),
      Condition: publisherConditionsFixture(
        `:ce::${expectedPlatformTarget.account}:anomalymonitor/*`,
        expectedPlatformTarget.account,
      ),
    },
  },
  "verifier.WrongCostAnomalyPublisherSourceArnFixture",
  true,
);

assertPolicyRejected(
  { Statement: validCloudWatchPublisherStatement },
  "verifier.KmsResourceStarOutsideKeyPolicyFixture",
  false,
);

function reviewObject(value, location, inheritedResourceType) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      reviewObject(
        entry,
        location + "[" + String(index) + "]",
        inheritedResourceType,
      );
    });
    return;
  }
  if (!isObject(value)) {
    return;
  }

  const resourceType =
    typeof value.Type === "string" ? value.Type : inheritedResourceType;
  for (const [key, child] of Object.entries(value)) {
    const childLocation = location + "." + key;
    if (
      (key === "PolicyDocument" ||
        key === "AssumeRolePolicyDocument" ||
        key === "KeyPolicy") &&
      isObject(child)
    ) {
      reviewPolicyDocument(
        child,
        childLocation,
        key === "KeyPolicy" && resourceType === "AWS::KMS::Key",
      );
    }
    if (
      secretLiteralPropertyNames.has(key.toLowerCase()) &&
      typeof child === "string" &&
      !isCognitoTokenValidityUnit(location, key, child) &&
      !child.startsWith("arn:") &&
      !child.startsWith("{{resolve:")
    ) {
      throw new Error(childLocation + " contains a literal secret value.");
    }
    reviewObject(child, childLocation, resourceType);
  }
}

function reviewForbiddenText(text, location) {
  if (/placeholder/iu.test(text)) {
    throw new Error(location + " still contains placeholder infrastructure.");
  }
  const normalizedText = text
    .replaceAll(
      generatedBootstrapVersionAssertion,
      "[generated DefaultStackSynthesizer bootstrap-version assertion]",
    )
    .replaceAll(
      generatedBootstrapVersionParameterDescription,
      "[generated DefaultStackSynthesizer bootstrap-version parameter]",
    );
  for (const { label, pattern } of forbiddenAssemblyPatterns) {
    if (pattern.test(normalizedText)) {
      throw new Error(location + " contains a forbidden " + label + ".");
    }
  }
}

async function collectStackArtifacts(manifestPaths) {
  const stackArtifacts = [];
  for (const manifestPath of manifestPaths) {
    const manifestText = await readFile(manifestPath, "utf8");
    reviewForbiddenText(manifestText, manifestPath);
    const manifest = parseObject(manifestText, manifestPath);
    if (!isObject(manifest.artifacts)) {
      continue;
    }

    for (const [artifactId, artifact] of Object.entries(manifest.artifacts)) {
      if (!isObject(artifact) || artifact.type !== "aws:cloudformation:stack") {
        continue;
      }
      if (!isObject(artifact.properties)) {
        throw new Error(
          manifestPath + " artifact " + artifactId + " has no properties.",
        );
      }
      const { stackName, templateFile } = artifact.properties;
      if (typeof stackName !== "string" || stackName.length === 0) {
        throw new Error(
          manifestPath + " artifact " + artifactId + " has no stackName.",
        );
      }
      if (typeof templateFile !== "string" || templateFile.length === 0) {
        throw new Error(
          manifestPath + " artifact " + artifactId + " has no templateFile.",
        );
      }
      const templatePath = resolve(dirname(manifestPath), templateFile);
      assertWithinAssembly(templatePath);
      stackArtifacts.push({ stackName, templatePath });
    }
  }
  return stackArtifacts;
}

const assemblyFiles = await listFiles(assemblyRoot);
const manifestPaths = assemblyFiles.filter(
  (path) => basename(path) === "manifest.json",
);
if (manifestPaths.length === 0) {
  throw new Error("The synthesized CDK assembly contains no manifest.json.");
}

for (const jsonPath of assemblyFiles.filter((path) => path.endsWith(".json"))) {
  const fileStats = await stat(jsonPath);
  if (fileStats.size > 10 * 1024 * 1024) {
    throw new Error("CDK assembly JSON exceeds 10 MiB: " + jsonPath);
  }
  reviewForbiddenText(await readFile(jsonPath, "utf8"), jsonPath);
}

const stackArtifacts = await collectStackArtifacts(manifestPaths);
const actualStackNames = stackArtifacts
  .map(({ stackName }) => stackName)
  .sort();
if (JSON.stringify(actualStackNames) !== JSON.stringify(expectedStackNames)) {
  throw new Error(
    "Expected exactly " +
      expectedStackNames.join(", ") +
      "; found " +
      (actualStackNames.join(", ") || "no stacks") +
      ".",
  );
}

const referencedTemplates = new Set(
  stackArtifacts.map(({ templatePath }) => templatePath),
);
const unreferencedTemplates = assemblyFiles
  .filter((path) => path.endsWith(".template.json"))
  .filter((path) => !referencedTemplates.has(path));
if (
  referencedTemplates.size !== expectedStackNames.length ||
  unreferencedTemplates.length > 0
) {
  throw new Error(
    "The assembly must contain exactly four referenced stack templates; unreferenced: " +
      (unreferencedTemplates.join(", ") || "none") +
      ".",
  );
}

for (const { stackName, templatePath } of stackArtifacts) {
  const templateText = await readFile(templatePath, "utf8");
  const template = parseObject(templateText, templatePath);
  if (
    !isObject(template.Resources) ||
    Object.keys(template.Resources).length === 0
  ) {
    throw new Error(stackName + " must synthesize at least one AWS resource.");
  }
  reviewObject(template, stackName);
}

console.log(
  "cdk:synth: reviewed " +
    String(stackArtifacts.length) +
    " nonempty CloudMarkup dev stacks, secret boundaries, customer-IaC separation, and synthesized IAM.",
);
