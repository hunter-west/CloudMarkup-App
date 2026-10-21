import { createHash } from "node:crypto";

import { z } from "zod";

import type { DeploymentInputsV1 } from "./schema.js";
import {
  type DeploymentInputIssueV1,
  validateDeploymentInputsV1,
} from "./validator.js";

export const BETA_SETUP_DISCOVERY_SCHEMA_VERSION = 1 as const;

const APPLICATION_ACCOUNT_ID = "000000000000" as const;
const APPLICATION_REGION = "us-east-1" as const;
const APPLICATION_GITHUB_ROLE_ARN =
  "arn:aws:iam::000000000000:role/CloudMarkup-Beta-GitHub" as const;
// Public distribution example; private operations owns its exact DNS coordinates.
const DNS_ACCOUNT_ID = "000000000001" as const;
const DNS_HOSTED_ZONE_NAME = "cloudmarkup.com" as const;
const DNS_ROLE_ARN =
  "arn:aws:iam::000000000001:role/CloudMarkup-Beta-DNS" as const;
const BETA_RECORD_NAME = "beta.example.invalid" as const;
const SOURCE_REPOSITORY = "hunter-west/CloudMarkup" as const;

const literalSecretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/u,
  /\bsk_(?:live|test)_[A-Za-z0-9]{8,}\b/u,
  /\bwhsec_[A-Za-z0-9_]{8,}\b/u,
  /\bxox[a-z]-[A-Za-z0-9-]{10,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}\b/iu,
] as const;
const secretKeyFragments = [
  "accesskey",
  "apikey",
  "clientsecret",
  "credential",
  "password",
  "privatekey",
  "secret",
  "sessiontoken",
  "token",
] as const;
const placeholderPattern =
  /(?:\b(?:change[-_ ]?me|placeholder|replace[-_ ]?me|tbd|todo|pending)\b|example|0{12})/iu;
const sha256DigestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u)
  .refine(
    (value) => value !== `sha256:${"0".repeat(64)}`,
    "Use an observed non-zero SHA-256 digest.",
  );
const bareSha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .refine(
    (value) => value !== "0".repeat(64),
    "Use an observed non-zero SHA-256 value.",
  );
const gitRevisionSchema = z
  .string()
  .regex(/^[a-f0-9]{40}$/u)
  .refine(
    (value) => value !== "0".repeat(40),
    "Use the exact non-zero source revision.",
  );
const hostedZoneIdSchema = z
  .string()
  .regex(/^Z[A-Z0-9]{1,63}$/u)
  .refine(
    (value) => !placeholderPattern.test(value),
    "Use the observed authoritative hosted-zone ID.",
  );

const bootstrapRolesSchema = z
  .object({
    cloudFormationExecution: z.literal(
      "arn:aws:iam::000000000000:role/cdk-hnb659fds-cfn-exec-role-000000000000-us-east-1",
    ),
    deploymentAction: z.literal(
      "arn:aws:iam::000000000000:role/cdk-hnb659fds-deploy-role-000000000000-us-east-1",
    ),
    filePublishing: z.literal(
      "arn:aws:iam::000000000000:role/cdk-hnb659fds-file-publishing-role-000000000000-us-east-1",
    ),
    imagePublishing: z.literal(
      "arn:aws:iam::000000000000:role/cdk-hnb659fds-image-publishing-role-000000000000-us-east-1",
    ),
    lookup: z.literal(
      "arn:aws:iam::000000000000:role/cdk-hnb659fds-lookup-role-000000000000-us-east-1",
    ),
  })
  .strict();

function imageDiscoverySchema(
  repositoryName:
    "cloudmarkup/application-build" | "cloudmarkup/terraform-validation",
) {
  return z
    .object({
      contextSha256: bareSha256Schema,
      criticalFindings: z.literal(0),
      digest: sha256DigestSchema,
      highFindings: z.literal(0),
      provenance: z.literal("attached"),
      provenanceDigest: sha256DigestSchema,
      provenanceIdentity: z.literal(
        "https://github.com/hunter-west/CloudMarkup/.github/workflows/beta-setup.yml@refs/heads/main",
      ),
      provenancePredicateType: z.literal(
        "https://cloudmarkup.com/attestations/beta-image-build/v1",
      ),
      provenanceSourceRevision: gitRevisionSchema,
      repositoryName: z.literal(repositoryName),
      repositoryUri: z.literal(
        `${APPLICATION_ACCOUNT_ID}.dkr.ecr.${APPLICATION_REGION}.amazonaws.com/${repositoryName}`,
      ),
      sbom: z.literal("attached"),
      sbomDigest: sha256DigestSchema,
      sbomFormat: z.literal("cyclonedx-json"),
      scanDigest: sha256DigestSchema,
      scanStatus: z.literal("COMPLETE"),
      scanner: z.literal("trivy@0.74.0"),
      signatureIdentity: z.literal(
        "https://github.com/hunter-west/CloudMarkup/.github/workflows/beta-setup.yml@refs/heads/main",
      ),
      signatureIssuer: z.literal("https://token.actions.githubusercontent.com"),
      signatureStatus: z.literal("VERIFIED"),
      signatureVerificationDigest: sha256DigestSchema,
      tag: z.string().regex(/^git-[a-f0-9]{40}$/u),
    })
    .strict();
}

export const betaSetupDiscoveryV1Schema = z
  .object({
    application: z
      .object({
        accountId: z.literal(APPLICATION_ACCOUNT_ID),
        bootstrap: z
          .object({
            roles: bootstrapRolesSchema,
            stackName: z.literal("CDKToolkit"),
            stackStatus: z.enum(["CREATE_COMPLETE", "UPDATE_COMPLETE"]),
            version: z.string().regex(/^[1-9][0-9]{0,5}$/u),
          })
          .strict(),
        githubRoleArn: z.literal(APPLICATION_GITHUB_ROLE_ARN),
        region: z.literal(APPLICATION_REGION),
      })
      .strict(),
    certificate: z
      .object({
        arn: z
          .string()
          .regex(
            /^arn:aws:acm:us-east-1:000000000000:certificate\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
          ),
        domainName: z.literal(BETA_RECORD_NAME),
        status: z.literal("ISSUED"),
        validationMethod: z.literal("DNS"),
      })
      .strict(),
    dns: z
      .object({
        accountId: z.literal(DNS_ACCOUNT_ID),
        createApplicationRecords: z.literal(false),
        hostedZoneId: hostedZoneIdSchema,
        hostedZoneName: z.literal(DNS_HOSTED_ZONE_NAME),
        recordName: z.literal(BETA_RECORD_NAME),
        roleArn: z.literal(DNS_ROLE_ARN),
      })
      .strict(),
    images: z
      .object({
        applicationBuild: imageDiscoverySchema("cloudmarkup/application-build"),
        terraformValidation: imageDiscoverySchema(
          "cloudmarkup/terraform-validation",
        ),
      })
      .strict(),
    kind: z.literal("cloudmarkup.beta-setup-discovery"),
    schemaVersion: z.literal(BETA_SETUP_DISCOVERY_SCHEMA_VERSION),
    source: z
      .object({
        generatedAt: z.iso.datetime(),
        ref: z.literal("refs/heads/main"),
        repository: z.literal(SOURCE_REPOSITORY),
        revision: gitRevisionSchema,
        runAttempt: z.number().int().min(1).max(1_000),
        runId: z.string().regex(/^[1-9][0-9]{0,19}$/u),
        workflow: z.literal("beta-setup.yml"),
      })
      .strict(),
  })
  .strict()
  .superRefine((data, context) => {
    const expectedTag = `git-${data.source.revision}`;
    for (const [name, image] of Object.entries(data.images)) {
      if (image.tag !== expectedTag) {
        context.addIssue({
          code: "custom",
          message: "Every image tag must bind the exact source revision.",
          path: ["images", name, "tag"],
        });
      }
      if (image.provenanceSourceRevision !== data.source.revision) {
        context.addIssue({
          code: "custom",
          message:
            "Every provenance record must bind the exact source revision.",
          path: ["images", name, "provenanceSourceRevision"],
        });
      }
    }
  });

export type BetaSetupDiscoveryV1 = z.output<typeof betaSetupDiscoveryV1Schema>;

export type BetaSetupDiscoveryValidationResultV1 =
  | {
      readonly data: BetaSetupDiscoveryV1;
      readonly digest: `sha256:${string}`;
      readonly issues: readonly [];
      readonly valid: true;
    }
  | {
      readonly issues: readonly DeploymentInputIssueV1[];
      readonly valid: false;
    };

export type BetaSetupDeploymentInputsMergeResultV1 =
  | {
      readonly data: DeploymentInputsV1;
      readonly deploymentInputsDigest: `sha256:${string}`;
      readonly discoveryDigest: `sha256:${string}`;
      readonly issues: readonly [];
      readonly valid: true;
      readonly warnings: readonly DeploymentInputIssueV1[];
    }
  | {
      readonly issues: readonly DeploymentInputIssueV1[];
      readonly valid: false;
      readonly warnings: readonly DeploymentInputIssueV1[];
    };

function issue(
  code: string,
  path: string,
  message: string,
): DeploymentInputIssueV1 {
  return Object.freeze({ code, message, path });
}

function joinPath(parent: string, child: string | number): string {
  return typeof child === "number"
    ? `${parent}[${String(child)}]`
    : parent.length === 0
      ? child
      : `${parent}.${child}`;
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(",")}}`;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(canonicalize(value))
    .digest("hex")}`;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

function safeChildPath(parent: string, key: string): string {
  const unsafeKey =
    containsControlCharacter(key) ||
    literalSecretPatterns.some((pattern) => pattern.test(key));
  return joinPath(parent, unsafeKey ? "<redacted-field>" : key);
}

function scanUnsafeDiscoveryValue(
  value: unknown,
  issues: DeploymentInputIssueV1[],
  path = "",
): void {
  if (typeof value === "string") {
    if (containsControlCharacter(value)) {
      issues.push(
        issue(
          "beta-setup-discovery.control-character",
          path,
          "Setup discovery strings cannot contain control characters.",
        ),
      );
    }
    if (literalSecretPatterns.some((pattern) => pattern.test(value))) {
      issues.push(
        issue(
          "beta-setup-discovery.literal-secret",
          path,
          "Setup discovery cannot contain literal secret material.",
        ),
      );
    }
    if (placeholderPattern.test(value)) {
      issues.push(
        issue(
          "beta-setup-discovery.placeholder-prohibited",
          path,
          "Setup discovery must contain observed values, not placeholders.",
        ),
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      scanUnsafeDiscoveryValue(entry, issues, joinPath(path, index));
    });
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    const childPath = safeChildPath(path, key);
    const normalizedKey = key.replaceAll(/[^a-z0-9]/giu, "").toLowerCase();
    const literalSecretKey = literalSecretPatterns.some((pattern) =>
      pattern.test(key),
    );
    if (containsControlCharacter(key)) {
      issues.push(
        issue(
          "beta-setup-discovery.control-character",
          childPath,
          "Setup discovery keys cannot contain control characters.",
        ),
      );
    }
    if (
      literalSecretKey ||
      secretKeyFragments.some(
        (fragment) =>
          normalizedKey === fragment || normalizedKey.endsWith(fragment),
      )
    ) {
      issues.push(
        issue(
          "beta-setup-discovery.secret-field",
          childPath,
          "Secret-shaped fields are prohibited in setup discovery.",
        ),
      );
    }
    scanUnsafeDiscoveryValue(entry, issues, childPath);
  }
}

function scanUnsafeBaseValue(
  value: unknown,
  issues: DeploymentInputIssueV1[],
  path = "",
): void {
  if (typeof value === "string") {
    if (containsControlCharacter(value)) {
      issues.push(
        issue(
          "beta-setup-merge.base-control-character",
          path,
          "The operator base cannot contain control characters.",
        ),
      );
    }
    if (literalSecretPatterns.some((pattern) => pattern.test(value))) {
      issues.push(
        issue(
          "beta-setup-merge.base-literal-secret",
          path,
          "The operator base cannot contain literal secret material.",
        ),
      );
    }
    if (placeholderPattern.test(value)) {
      issues.push(
        issue(
          "beta-setup-merge.base-placeholder-prohibited",
          path,
          "The operator base must contain reviewed values, not placeholders.",
        ),
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      scanUnsafeBaseValue(entry, issues, joinPath(path, index));
    });
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    scanUnsafeBaseValue(entry, issues, safeChildPath(path, key));
  }
}

function compareIssues(
  left: DeploymentInputIssueV1,
  right: DeploymentInputIssueV1,
): number {
  return left.path === right.path
    ? left.code === right.code
      ? 0
      : left.code < right.code
        ? -1
        : 1
    : left.path < right.path
      ? -1
      : 1;
}

function deduplicateIssues(
  issues: readonly DeploymentInputIssueV1[],
): readonly DeploymentInputIssueV1[] {
  return Object.freeze(
    [
      ...new Map(
        issues.map((entry) => [
          `${entry.code}|${entry.path}|${entry.message}`,
          entry,
        ]),
      ).values(),
    ].sort(compareIssues),
  );
}

export function validateBetaSetupDiscoveryV1(
  value: unknown,
): BetaSetupDiscoveryValidationResultV1 {
  const issues: DeploymentInputIssueV1[] = [];
  scanUnsafeDiscoveryValue(value, issues);
  const parsed = betaSetupDiscoveryV1Schema.safeParse(value);
  if (!parsed.success) {
    for (const zodIssue of parsed.error.issues) {
      issues.push(
        issue(
          "beta-setup-discovery.schema-invalid",
          zodIssue.path.reduce<string>(
            (path, part) =>
              joinPath(path, typeof part === "symbol" ? String(part) : part),
            "",
          ),
          zodIssue.code === "unrecognized_keys"
            ? "Unknown setup discovery fields are prohibited."
            : zodIssue.message,
        ),
      );
    }
  }
  const resultIssues = deduplicateIssues(issues);
  if (!parsed.success || resultIssues.length > 0) {
    return Object.freeze({ issues: resultIssues, valid: false });
  }
  return Object.freeze({
    data: parsed.data,
    digest: digest(parsed.data),
    issues: [] as const,
    valid: true,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function atPath(
  value: Record<string, unknown>,
  ...path: readonly string[]
): unknown {
  let current: unknown = value;
  for (const part of path) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function mergeBoundaryIssues(
  base: Record<string, unknown>,
): readonly DeploymentInputIssueV1[] {
  const expected: readonly (readonly [readonly string[], unknown, string])[] = [
    [["environment", "name"], "beta", "The input must target beta."],
    [["environment", "stage"], "beta", "The input must target beta."],
    [
      ["aws", "partition"],
      "aws",
      "Beta setup targets the commercial AWS partition.",
    ],
    [
      ["aws", "platformDeployment", "githubEnvironment"],
      "Development",
      "Beta deployment uses the protected Development GitHub Environment.",
    ],
    [
      ["aws", "platformDeployment", "roleArn"],
      APPLICATION_GITHUB_ROLE_ARN,
      "The deployment role must equal the setup workflow role.",
    ],
    [
      ["aws", "platformDeployment", "repository", "owner"],
      "hunter-west",
      "The input must bind the reviewed repository owner.",
    ],
    [
      ["aws", "platformDeployment", "repository", "name"],
      "CloudMarkup",
      "The input must bind the reviewed repository name.",
    ],
    [
      ["domains", "rootDomain"],
      DNS_HOSTED_ZONE_NAME,
      "The input root domain must equal the authoritative hosted zone.",
    ],
    [
      ["domains", "applicationDomain"],
      BETA_RECORD_NAME,
      "The application domain must equal the reviewed beta record.",
    ],
    [
      ["domains", "apiDomain"],
      BETA_RECORD_NAME,
      "The beta API must remain on the reviewed same-origin hostname.",
    ],
  ];
  const issues: DeploymentInputIssueV1[] = [];
  for (const [path, expectedValue, message] of expected) {
    if (atPath(base, ...path) !== expectedValue) {
      issues.push(
        issue("beta-setup-merge.boundary-mismatch", path.join("."), message),
      );
    }
  }
  const approvedBranches = atPath(
    base,
    "aws",
    "platformDeployment",
    "repository",
    "approvedBranches",
  );
  if (
    !Array.isArray(approvedBranches) ||
    approvedBranches.length !== 1 ||
    approvedBranches[0] !== "main"
  ) {
    issues.push(
      issue(
        "beta-setup-merge.boundary-mismatch",
        "aws.platformDeployment.repository.approvedBranches",
        "Beta deployment must bind only the reviewed main branch.",
      ),
    );
  }
  return Object.freeze(issues.sort(compareIssues));
}

export function mergeBetaSetupDiscoveryV1(
  base: unknown,
  discovery: unknown,
): BetaSetupDeploymentInputsMergeResultV1 {
  const discoveryResult = validateBetaSetupDiscoveryV1(discovery);
  if (!discoveryResult.valid) {
    return Object.freeze({
      issues: discoveryResult.issues,
      valid: false,
      warnings: [] as const,
    });
  }
  if (!isRecord(base)) {
    return Object.freeze({
      issues: Object.freeze([
        issue(
          "beta-setup-merge.base-invalid",
          "",
          "The operator base must be a complete deployment-input JSON object.",
        ),
      ]),
      valid: false,
      warnings: [] as const,
    });
  }
  const baseSafetyIssues: DeploymentInputIssueV1[] = [];
  scanUnsafeBaseValue(base, baseSafetyIssues);
  if (baseSafetyIssues.length > 0) {
    return Object.freeze({
      issues: deduplicateIssues(baseSafetyIssues),
      valid: false,
      warnings: [] as const,
    });
  }
  const boundaryIssues = mergeBoundaryIssues(base);
  if (boundaryIssues.length > 0) {
    return Object.freeze({
      issues: boundaryIssues,
      valid: false,
      warnings: [] as const,
    });
  }

  const baseAws = isRecord(base["aws"]) ? base["aws"] : {};
  const baseDomains = isRecord(base["domains"]) ? base["domains"] : {};
  const candidate: Record<string, unknown> = {
    ...base,
    aws: {
      ...baseAws,
      accountId: discoveryResult.data.application.accountId,
      primaryRegion: discoveryResult.data.application.region,
    },
    domains: {
      ...baseDomains,
      certificateArn: discoveryResult.data.certificate.arn,
      hostedZoneId: discoveryResult.data.dns.hostedZoneId,
    },
  };
  const validated = validateDeploymentInputsV1(candidate);
  if (!validated.valid) {
    return Object.freeze({
      issues: validated.issues,
      valid: false,
      warnings: validated.warnings,
    });
  }
  return Object.freeze({
    data: validated.data,
    deploymentInputsDigest: validated.digest,
    discoveryDigest: discoveryResult.digest,
    issues: [] as const,
    valid: true,
    warnings: validated.warnings,
  });
}
