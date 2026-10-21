import {
  evidenceRecordV1Schema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";

export const CUSTOMER_CI_WORKFLOW_PATHS = Object.freeze({
  deploy: ".github/workflows/cloudmarkup-deploy.yml",
  drift: ".github/workflows/cloudmarkup-drift.yml",
  plan: ".github/workflows/cloudmarkup-plan.yml",
  smoke: ".github/workflows/cloudmarkup-smoke.yml",
  validate: ".github/workflows/cloudmarkup-validate.yml",
});

export const CUSTOMER_CI_LIMITS_V1 = Object.freeze({
  artifactRetentionDays: 30,
  environments: 3,
  planExpiryMinutes: 1_440,
  planResources: 2_000,
  smokeAttempts: 10,
  smokeExtensions: 16,
  smokePathBytes: 160,
  workflowBytes: 128 * 1024,
  workflowFiles: 5,
});

const stableIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "Must be a stable ID.");
const repositoryPartSchema = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/);
const repositoryOwnerSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/,
    "Invalid repository owner.",
  );
const branchSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/)
  .refine(
    (value) =>
      !value.includes("..") &&
      !value.includes("//") &&
      !value.includes("@{") &&
      !value.endsWith(".lock"),
    "Branch must be a literal safe Git ref name.",
  );
const repositoryPathSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9._@()+,= -]+(?:\/[A-Za-z0-9._@()+,= -]+)*$/)
  .refine(
    (value) =>
      !value.split("/").some((part) => part === "." || part === "..") &&
      !value.includes("${{") &&
      !value.includes("\\"),
    "Path must be a literal repository-relative path.",
  );
const variableNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/);
const commitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);

const githubNumericIdSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,19}$/, "Use the canonical decimal GitHub ID.");

export const CUSTOMER_CI_LEGACY_OIDC_RISK_ACKNOWLEDGEMENT_V1 =
  "repository-renames-transfers-or-name-reuse-require-trust-review" as const;

export const customerCiOidcSubjectModeV1Schema = z.enum([
  "immutable-owner-and-repository-ids",
  "legacy-name-based-explicit",
]);

const oidcSubjectPrefixSchema = z.string().min(1).max(384);

export const customerCiOidcSubjectV1Schema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("immutable-owner-and-repository-ids"),
      repositoryId: githubNumericIdSchema,
      repositoryOwnerId: githubNumericIdSchema,
      subjectPrefix: oidcSubjectPrefixSchema,
    })
    .strict(),
  z
    .object({
      legacyRiskAcknowledgement: z.literal(
        CUSTOMER_CI_LEGACY_OIDC_RISK_ACKNOWLEDGEMENT_V1,
      ),
      mode: z.literal("legacy-name-based-explicit"),
      repositoryId: githubNumericIdSchema,
      repositoryOwnerId: githubNumericIdSchema,
      subjectPrefix: oidcSubjectPrefixSchema,
    })
    .strict(),
]);

export function expectedCustomerCiOidcSubjectPrefixV1(input: {
  readonly mode: z.output<typeof customerCiOidcSubjectModeV1Schema>;
  readonly name: string;
  readonly owner: string;
  readonly repositoryId: string;
  readonly repositoryOwnerId: string;
}): string {
  return input.mode === "immutable-owner-and-repository-ids"
    ? `repo:${input.owner}@${input.repositoryOwnerId}/${input.name}@${input.repositoryId}:environment:`
    : `repo:${input.owner}/${input.name}:environment:`;
}

export const customerCiEnvironmentIdV1Schema = z.enum([
  "dev",
  "staging",
  "production",
]);

export const customerCiEnvironmentV1Schema = z
  .object({
    approvedBranches: z.array(branchSchema).min(1).max(8),
    githubEnvironment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    id: customerCiEnvironmentIdV1Schema,
    protected: z.boolean(),
    requiredApprovals: z.number().int().min(0).max(6),
    smokeBaseUrlDigest: sha256DigestSchema,
    workspace: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,89}$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.approvedBranches).size !== value.approvedBranches.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Approved branches must be unique within each environment.",
        path: ["approvedBranches"],
      });
    }
    if (
      value.id === "production" &&
      (!value.protected || value.requiredApprovals < 1)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Production must use a protected GitHub Environment with at least one approval.",
        path: ["requiredApprovals"],
      });
    }
  });

export const customerCiVariableNamesV1Schema = z
  .object({
    awsAccountId: variableNameSchema,
    awsRegion: variableNameSchema,
    deployEnabled: variableNameSchema,
    deployedCommit: variableNameSchema,
    deployedRevisionDigest: variableNameSchema,
    deploymentReceiptDigest: variableNameSchema,
    deploymentRunId: variableNameSchema,
    deployRoleArn: variableNameSchema,
    driftRoleArn: variableNameSchema,
    planRoleArn: variableNameSchema,
    smokeBaseUrl: variableNameSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const firstFieldByName = new Map<string, string>();
    for (const [field, variableName] of Object.entries(value)) {
      const firstField = firstFieldByName.get(variableName);
      if (firstField !== undefined) {
        context.addIssue({
          code: "custom",
          message: `Every GitHub variable must have a unique name; this duplicates ${firstField}.`,
          path: [field],
        });
      } else {
        firstFieldByName.set(variableName, field);
      }
    }
  });

export const customerCiTerraformBackendV1Schema = z
  .object({
    configPath: repositoryPathSchema,
    contractVersion: z.literal(1),
    encryption: z.literal("required"),
    locking: z.literal("s3-native-lockfile"),
    type: z.literal("aws-s3"),
    workspaceIsolation: z.literal("workspace-key-prefix"),
  })
  .strict();

export const customerCiSmokeTestExtensionV1Schema = z
  .object({
    contractVersion: z.literal(1),
    id: stableIdSchema,
    specificationChecksum: sha256DigestSchema,
    specificationPath: repositoryPathSchema.refine(
      (value) => value.endsWith(".json"),
      "Smoke-test specifications must be JSON documents.",
    ),
    workloadId: stableIdSchema,
  })
  .strict();

export const customerCiWorkflowConfigV1Schema = z
  .object({
    contractVersion: z.literal(1),
    drift: z
      .object({
        cron: z
          .string()
          .regex(
            /^(?:0?[0-9]|[1-5][0-9]) (?:0?[0-9]|1[0-9]|2[0-3]) \* \* [0-6]$/,
            "Use a bounded weekly UTC cron expression.",
          ),
        evidencePolicy: z.literal("artifact-only"),
      })
      .strict(),
    environments: z
      .array(customerCiEnvironmentV1Schema)
      .length(CUSTOMER_CI_LIMITS_V1.environments),
    generatorProfile: z.literal("github-actions-aws-terraform-v1"),
    plan: z
      .object({
        artifactEncryption: z
          .object({
            algorithm: z.literal("rsa-oaep-sha256-aes-256-gcm-v1"),
            privateKeySecretName: variableNameSchema,
            publicKeyPem: z
              .string()
              .min(1)
              .max(4_096)
              .regex(
                /^-----BEGIN PUBLIC KEY-----\n(?:[A-Za-z0-9+/]{64}\n)*(?:(?:[A-Za-z0-9+/]{4}){1,16}|(?:[A-Za-z0-9+/]{4}){0,15}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=))\n-----END PUBLIC KEY-----\n$/,
              ),
          })
          .strict(),
        artifactRetentionDays: z
          .number()
          .int()
          .min(1)
          .max(CUSTOMER_CI_LIMITS_V1.artifactRetentionDays),
        expiresAfterMinutes: z
          .number()
          .int()
          .min(15)
          .max(CUSTOMER_CI_LIMITS_V1.planExpiryMinutes),
      })
      .strict(),
    repository: z
      .object({
        defaultBranch: branchSchema,
        destinationFolder: z.union([z.literal(""), repositoryPathSchema]),
        name: repositoryPartSchema,
        oidcSubject: customerCiOidcSubjectV1Schema,
        owner: repositoryOwnerSchema,
        visibility: z.literal("private"),
      })
      .strict(),
    smoke: z
      .object({
        allowEphemeral: z.literal(false),
        extensions: z
          .array(customerCiSmokeTestExtensionV1Schema)
          .max(CUSTOMER_CI_LIMITS_V1.smokeExtensions)
          .default([]),
        healthPath: z
          .string()
          .min(1)
          .max(CUSTOMER_CI_LIMITS_V1.smokePathBytes)
          .regex(/^\/[A-Za-z0-9._~!&'*+,;=:@/-]*$/)
          .refine((value) => !value.includes("..") && !value.includes("//")),
        maxAttempts: z
          .number()
          .int()
          .min(1)
          .max(CUSTOMER_CI_LIMITS_V1.smokeAttempts),
        requestTimeoutSeconds: z.number().int().min(1).max(30),
      })
      .strict(),
    solutionRevision: z
      .object({ id: stableIdSchema, digest: sha256DigestSchema })
      .strict(),
    terraform: z
      .object({
        allowedProviderSources: z.array(z.literal("hashicorp/aws")).length(1),
        backend: customerCiTerraformBackendV1Schema,
        cliSha256LinuxAmd64: sha256DigestSchema,
        packageTreeDigest: sha256DigestSchema,
        providerLockPath: repositoryPathSchema,
        rootDirectory: repositoryPathSchema,
        version: z.string().regex(/^1\.\d{1,2}\.\d{1,2}$/),
      })
      .strict(),
    variables: customerCiVariableNamesV1Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const requiredOrder = ["dev", "staging", "production"] as const;
    const byId = new Map(value.environments.map((item) => [item.id, item]));
    const normalizedGithubEnvironments = value.environments.map(
      ({ githubEnvironment }) => githubEnvironment.toLocaleLowerCase("en-US"),
    );
    if (
      new Set(normalizedGithubEnvironments).size !==
      normalizedGithubEnvironments.length
    ) {
      context.addIssue({
        code: "custom",
        message: "GitHub environment names must be unique ignoring case.",
        path: ["environments"],
      });
    }
    if (
      value.environments.some(
        (environment, index) => environment.id !== requiredOrder[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Environments must use the exact deterministic order dev, staging, production.",
        path: ["environments"],
      });
    }
    for (const id of requiredOrder) {
      if (!byId.has(id)) {
        context.addIssue({
          code: "custom",
          message: `Environment ${id} is required.`,
          path: ["environments"],
        });
      }
    }
    for (const field of ["githubEnvironment", "workspace"] as const) {
      const values = value.environments.map((item) => item[field]);
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: `Each environment must use a distinct ${field}.`,
          path: ["environments"],
        });
      }
    }
    if (
      value.environments.some(
        ({ approvedBranches }) =>
          !approvedBranches.includes(value.repository.defaultBranch),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The selected default branch must be explicitly approved for every environment so scheduled drift cannot assume a role from an unapproved ref.",
        path: ["repository", "defaultBranch"],
      });
    }
    const oidcSubject = value.repository.oidcSubject;
    const expectedSubjectPrefix = expectedCustomerCiOidcSubjectPrefixV1({
      mode: oidcSubject.mode,
      name: value.repository.name,
      owner: value.repository.owner,
      repositoryId: oidcSubject.repositoryId,
      repositoryOwnerId: oidcSubject.repositoryOwnerId,
    });
    if (oidcSubject.subjectPrefix !== expectedSubjectPrefix) {
      context.addIssue({
        code: "custom",
        message:
          "The reviewed OIDC subject prefix must exactly match the selected GitHub subject mode, repository names, and immutable IDs.",
        path: ["repository", "oidcSubject", "subjectPrefix"],
      });
    }
    const expectedBackendConfigPath = `${value.terraform.rootDirectory}/backend.hcl`;
    if (value.terraform.backend.configPath !== expectedBackendConfigPath) {
      context.addIssue({
        code: "custom",
        message:
          "The AWS S3 backend configuration must be the exact backend.hcl at the reviewed Terraform root.",
        path: ["terraform", "backend", "configPath"],
      });
    }
    if (
      value.terraform.providerLockPath !==
      `${value.terraform.rootDirectory}/.terraform.lock.hcl`
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The provider lock must be the exact .terraform.lock.hcl at the reviewed Terraform root.",
        path: ["terraform", "providerLockPath"],
      });
    }
    if (
      value.repository.destinationFolder !== "" &&
      ![
        value.terraform.rootDirectory,
        value.terraform.backend.configPath,
        value.terraform.providerLockPath,
      ].every((path) =>
        path.startsWith(`${value.repository.destinationFolder}/`),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Terraform paths must remain inside the selected GitHub export destination.",
        path: ["terraform"],
      });
    }
    const extensionIds = new Set<string>();
    const extensionPaths = new Set<string>();
    for (const [index, extension] of value.smoke.extensions.entries()) {
      if (extensionIds.has(extension.id)) {
        context.addIssue({
          code: "custom",
          message: "Smoke-test extension IDs must be unique.",
          path: ["smoke", "extensions", index, "id"],
        });
      }
      if (extensionPaths.has(extension.specificationPath)) {
        context.addIssue({
          code: "custom",
          message: "Smoke-test specification paths must be unique.",
          path: ["smoke", "extensions", index, "specificationPath"],
        });
      }
      extensionIds.add(extension.id);
      extensionPaths.add(extension.specificationPath);
      const previous = value.smoke.extensions[index - 1];
      if (previous !== undefined && previous.id >= extension.id) {
        context.addIssue({
          code: "custom",
          message:
            "Smoke-test extensions must be uniquely UTF-16 sorted by stable ID.",
          path: ["smoke", "extensions", index, "id"],
        });
      }
    }
  });

export const customerCiWorkflowKindV1Schema = z.enum([
  "validate",
  "plan",
  "deploy",
  "smoke",
  "drift",
]);

export const customerCiActionPinV1Schema = z
  .object({
    action: z.string().regex(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/),
    commit: commitShaSchema,
    version: z.string().regex(/^v\d+\.\d+\.\d+$/),
  })
  .strict();

export const customerCiWorkflowFileV1Schema = z
  .object({
    checksum: sha256DigestSchema,
    content: z.string().max(CUSTOMER_CI_LIMITS_V1.workflowBytes),
    mediaType: z.literal("application/yaml"),
    path: z.enum([
      CUSTOMER_CI_WORKFLOW_PATHS.validate,
      CUSTOMER_CI_WORKFLOW_PATHS.plan,
      CUSTOMER_CI_WORKFLOW_PATHS.deploy,
      CUSTOMER_CI_WORKFLOW_PATHS.smoke,
      CUSTOMER_CI_WORKFLOW_PATHS.drift,
    ]),
    semanticChecksum: sha256DigestSchema,
    workflowKind: customerCiWorkflowKindV1Schema,
  })
  .strict();

export const customerCiWorkflowPreviewV1Schema = z
  .object({
    environments: z.array(
      z
        .object({
          approvedRefs: z.array(z.string()).min(1).max(8),
          githubEnvironment: z.string(),
          id: customerCiEnvironmentIdV1Schema,
          protected: z.boolean(),
          requiredApprovals: z.number().int().nonnegative(),
          smokeBaseUrlDigest: sha256DigestSchema,
          workspace: z.string(),
        })
        .strict(),
    ),
    permissionExplanation: z.string().min(1).max(500),
    oidcSubject: z
      .object({
        audience: z.literal("sts.amazonaws.com"),
        issuer: z.literal("https://token.actions.githubusercontent.com"),
        mode: customerCiOidcSubjectModeV1Schema,
        repositoryId: githubNumericIdSchema,
        repositoryOwnerId: githubNumericIdSchema,
        subjectPrefix: oidcSubjectPrefixSchema,
        trustConditionOperator: z.literal("StringEquals"),
      })
      .strict(),
    requiredSecrets: z.array(variableNameSchema).max(16),
    smokeTestExtensions: z
      .array(customerCiSmokeTestExtensionV1Schema)
      .max(CUSTOMER_CI_LIMITS_V1.smokeExtensions),
    requiredVariables: z.array(variableNameSchema).max(32),
    roles: z.array(
      z
        .object({
          audience: z.literal("sts.amazonaws.com"),
          environment: customerCiEnvironmentIdV1Schema,
          purpose: z.enum(["plan", "deploy", "drift-read-only"]),
          subject: z.string().max(384),
          variable: variableNameSchema,
        })
        .strict(),
    ),
    warnings: z.array(z.string().min(1).max(500)).max(32),
    workflowPermissionRequired: z.literal(true),
    workflows: z.array(
      z
        .object({
          environmentScoped: z.boolean(),
          kind: customerCiWorkflowKindV1Schema,
          path: z.string(),
          permissions: z.array(z.string()).max(8),
          purpose: z.string().min(1).max(300),
          triggers: z.array(z.string()).min(1).max(8),
        })
        .strict(),
    ),
  })
  .strict();

export const customerCiWorkflowManifestV1Schema = z
  .object({
    actionPins: z.array(customerCiActionPinV1Schema).min(1).max(16),
    configDigest: sha256DigestSchema,
    contractVersion: z.literal(1),
    files: z.array(customerCiWorkflowFileV1Schema).length(5),
    generator: z
      .object({
        digest: sha256DigestSchema,
        id: z.literal("cloudmarkup.customer-ci-workflow"),
        version: z.literal("1.0.0"),
      })
      .strict(),
    kind: z.literal("cloudmarkup.customer-ci-workflow-manifest"),
    pinRegistryDigest: sha256DigestSchema,
    policyDigest: sha256DigestSchema,
    solutionRevision: z
      .object({
        id: stableIdSchema,
        digest: sha256DigestSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const expected = CUSTOMER_CI_WORKFLOW_PATHS;
    const seenKinds = new Set<CustomerCiWorkflowKindV1>();
    const seenPaths = new Set<string>();
    for (const file of value.files) {
      if (file.path !== expected[file.workflowKind]) {
        context.addIssue({
          code: "custom",
          message: "Each workflow kind must use its exact reviewed path.",
          path: ["files"],
        });
      }
      if (seenKinds.has(file.workflowKind) || seenPaths.has(file.path)) {
        context.addIssue({
          code: "custom",
          message: "Workflow kinds and paths must be unique.",
          path: ["files"],
        });
      }
      seenKinds.add(file.workflowKind);
      seenPaths.add(file.path);
    }
    if (
      seenKinds.size !== Object.keys(expected).length ||
      Object.values(expected).some((path) => !seenPaths.has(path))
    ) {
      context.addIssue({
        code: "custom",
        message: "The manifest must contain the exact five reviewed workflows.",
        path: ["files"],
      });
    }
  });

export const customerCiWorkflowResultV1Schema = z
  .object({
    contractVersion: z.literal(1),
    manifest: customerCiWorkflowManifestV1Schema,
    preview: customerCiWorkflowPreviewV1Schema,
  })
  .strict();

export const customerCiIssueV1Schema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,95}$/),
    field: z.string().max(240).optional(),
    message: z.string().min(1).max(500),
    severity: z.enum(["error", "warning", "info"]),
  })
  .strict();

export const savedTerraformPlanManifestV1Schema = z
  .object({
    artifactName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    backendConfigDigest: sha256DigestSchema,
    commitSha: commitShaSchema,
    contractVersion: z.literal(1),
    createdAt: utcTimestampSchema,
    encryptedPlanChecksum: sha256DigestSchema,
    environment: customerCiEnvironmentIdV1Schema,
    environmentConfigDigest: sha256DigestSchema,
    infrastructureArtifactDigest: sha256DigestSchema,
    expiresAt: utcTimestampSchema,
    kind: z.literal("cloudmarkup.saved-terraform-plan"),
    planChecksum: sha256DigestSchema,
    planRunAttempt: z.number().int().min(1).max(100),
    planRunEvent: z.enum(["push", "workflow_dispatch"]),
    planRunId: z.string().regex(/^[1-9][0-9]{0,15}$/),
    planRunPath: z.literal(CUSTOMER_CI_WORKFLOW_PATHS.plan),
    planRunRef: z
      .string()
      .regex(/^refs\/heads\/[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/),
    planEncryption: z
      .object({
        algorithm: z.literal("rsa-oaep-sha256-aes-256-gcm-v1"),
        publicKeyDigest: sha256DigestSchema,
      })
      .strict(),
    providerLockHash: sha256DigestSchema,
    sanitizedPlanChecksum: sha256DigestSchema,
    semanticAnalysisChecksum: sha256DigestSchema,
    solutionExportManifestDigest: sha256DigestSchema,
    solutionRepositoryLockDigest: sha256DigestSchema,
    solutionRevision: z
      .object({
        id: stableIdSchema,
        digest: sha256DigestSchema,
      })
      .strict(),
    targetAuthority: z
      .object({
        accountId: z.string().regex(/^[0-9]{12}$/),
        deployRoleArnDigest: sha256DigestSchema,
        driftRoleArnDigest: sha256DigestSchema,
        oidcSubject: z.string().min(1).max(512),
        partition: z.literal("aws"),
        planRoleArnDigest: sha256DigestSchema,
        region: z
          .string()
          .regex(/^[a-z]{2}(?:-[a-z0-9]{1,16}){1,3}-[1-9][0-9]?$/),
      })
      .strict(),
    terraformVersion: z.string().regex(/^1\.\d{1,2}\.\d{1,2}$/),
    workflowConfigDigest: sha256DigestSchema,
    workflowPolicyDigest: sha256DigestSchema,
    workspace: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,89}$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "Saved plan expiry must be later than its creation time.",
        path: ["expiresAt"],
      });
    }
  });

export const savedTerraformPlanExpectedV1Schema = z
  .object({
    artifactName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    backendConfigDigest: sha256DigestSchema,
    commitSha: commitShaSchema,
    encryptedPlanChecksum: sha256DigestSchema,
    environment: customerCiEnvironmentIdV1Schema,
    environmentConfigDigest: sha256DigestSchema,
    infrastructureArtifactDigest: sha256DigestSchema,
    now: utcTimestampSchema,
    planChecksum: sha256DigestSchema,
    planRunAttempt: z.number().int().min(1).max(100),
    planRunEvent: z.enum(["push", "workflow_dispatch"]),
    planRunId: z.string().regex(/^[1-9][0-9]{0,15}$/),
    planRunPath: z.literal(CUSTOMER_CI_WORKFLOW_PATHS.plan),
    planRunRef: z
      .string()
      .regex(/^refs\/heads\/[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/),
    planEncryption: z
      .object({
        algorithm: z.literal("rsa-oaep-sha256-aes-256-gcm-v1"),
        publicKeyDigest: sha256DigestSchema,
      })
      .strict(),
    providerLockHash: sha256DigestSchema,
    sanitizedPlanChecksum: sha256DigestSchema,
    semanticAnalysisChecksum: sha256DigestSchema,
    solutionExportManifestDigest: sha256DigestSchema,
    solutionRepositoryLockDigest: sha256DigestSchema,
    solutionRevision: z
      .object({
        id: stableIdSchema,
        digest: sha256DigestSchema,
      })
      .strict(),
    targetAuthority: z
      .object({
        accountId: z.string().regex(/^[0-9]{12}$/),
        deployRoleArnDigest: sha256DigestSchema,
        driftRoleArnDigest: sha256DigestSchema,
        oidcSubject: z.string().min(1).max(512),
        partition: z.literal("aws"),
        planRoleArnDigest: sha256DigestSchema,
        region: z
          .string()
          .regex(/^[a-z]{2}(?:-[a-z0-9]{1,16}){1,3}-[1-9][0-9]?$/),
      })
      .strict(),
    terraformVersion: z.string().regex(/^1\.\d{1,2}\.\d{1,2}$/),
    workflowConfigDigest: sha256DigestSchema,
    workflowPolicyDigest: sha256DigestSchema,
    workspace: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,89}$/),
  })
  .strict();

const terraformActionSchema = z.enum([
  "create",
  "read",
  "update",
  "delete",
  "replace",
  "no-op",
]);
export const sanitizedTerraformPlanV1Schema = z
  .object({
    formatVersion: z.string().min(1).max(32),
    resourceChanges: z
      .array(
        z
          .object({
            actions: z.array(terraformActionSchema).min(1).max(3),
            address: sha256DigestSchema,
            mode: z.enum(["managed", "data"]),
            providerName: z.literal("registry.terraform.io/hashicorp/aws"),
            type: z.string().min(1).max(256),
          })
          .strict(),
      )
      .max(CUSTOMER_CI_LIMITS_V1.planResources),
    terraformVersion: z.string().min(1).max(32),
  })
  .strict();

export const terraformSemanticPlanAnalysisV1Schema = z
  .object({
    changes: z.array(
      z
        .object({
          actions: z.array(terraformActionSchema).min(1).max(3),
          address: sha256DigestSchema,
          type: z.string().min(1).max(256),
        })
        .strict(),
    ),
    contractVersion: z.literal(1),
    counts: z
      .object({
        create: z.number().int().nonnegative(),
        delete: z.number().int().nonnegative(),
        noOp: z.number().int().nonnegative(),
        read: z.number().int().nonnegative(),
        replace: z.number().int().nonnegative(),
        update: z.number().int().nonnegative(),
      })
      .strict(),
    issues: z.array(customerCiIssueV1Schema).max(256),
    kind: z.literal("cloudmarkup.terraform-semantic-plan-analysis"),
    unresolvedBehavior: z.string().min(1).max(500),
  })
  .strict();

export const customerCiLifecycleResultV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidence: z.array(evidenceRecordV1Schema).min(1).max(5),
    issues: z.array(customerCiIssueV1Schema).max(32),
    receipts: z
      .array(
        z
          .object({
            commitSha: commitShaSchema,
            contractVersion: z.literal(1),
            createdAt: utcTimestampSchema,
            environment: customerCiEnvironmentIdV1Schema,
            idempotencyKey: stableIdSchema,
            inputDigests: z.array(sha256DigestSchema).max(16),
            kind: z.literal("cloudmarkup.customer-ci-stage-receipt"),
            outputDigests: z.array(sha256DigestSchema).max(16),
            predecessorReceiptDigest: sha256DigestSchema.optional(),
            promotionPredecessorReceiptDigest: sha256DigestSchema.optional(),
            promotionPredecessorSmokeReceiptDigest:
              sha256DigestSchema.optional(),
            receiptId: stableIdSchema,
            solutionRevision: z
              .object({ id: stableIdSchema, digest: sha256DigestSchema })
              .strict(),
            stage: z.enum(["plan", "deploy", "smoke", "drift"]),
            status: z.enum(["passed", "failed", "blocked"]),
            targetAuthorityDigest: sha256DigestSchema,
          })
          .strict(),
      )
      .min(1)
      .max(5)
      .superRefine((receipts, context) => {
        const receiptIds = new Set<string>();
        const idempotencyKeys = new Set<string>();
        for (const [index, receipt] of receipts.entries()) {
          if (receiptIds.has(receipt.receiptId)) {
            context.addIssue({
              code: "custom",
              message: "Lifecycle receipt IDs must be unique.",
              path: [index, "receiptId"],
            });
          }
          receiptIds.add(receipt.receiptId);
          if (idempotencyKeys.has(receipt.idempotencyKey)) {
            context.addIssue({
              code: "custom",
              message: "Lifecycle receipt idempotency keys must be unique.",
              path: [index, "idempotencyKey"],
            });
          }
          idempotencyKeys.add(receipt.idempotencyKey);

          const hasPromotionPredecessor =
            receipt.promotionPredecessorReceiptDigest !== undefined;
          const hasPromotionSmokePredecessor =
            receipt.promotionPredecessorSmokeReceiptDigest !== undefined;
          if (
            receipt.stage === "plan" &&
            receipt.predecessorReceiptDigest !== undefined
          ) {
            context.addIssue({
              code: "custom",
              message: "A plan receipt cannot have a predecessor receipt.",
              path: [index, "predecessorReceiptDigest"],
            });
          }
          if (
            receipt.stage !== "deploy" &&
            (hasPromotionPredecessor || hasPromotionSmokePredecessor)
          ) {
            context.addIssue({
              code: "custom",
              message:
                "Only deployment receipts can carry promotion predecessor bindings.",
              path: [index],
            });
          }
          if (
            receipt.stage !== "plan" &&
            receipt.predecessorReceiptDigest === undefined
          ) {
            context.addIssue({
              code: "custom",
              message:
                "This stage requires an exact predecessor receipt digest.",
              path: [index, "predecessorReceiptDigest"],
            });
          }
          if (receipt.stage === "deploy" && receipt.environment === "dev") {
            if (hasPromotionPredecessor || hasPromotionSmokePredecessor) {
              context.addIssue({
                code: "custom",
                message:
                  "Development deployment receipts cannot claim a promotion predecessor.",
                path: [index],
              });
            }
          }
          if (
            receipt.stage === "deploy" &&
            receipt.environment !== "dev" &&
            (!hasPromotionPredecessor || !hasPromotionSmokePredecessor)
          ) {
            context.addIssue({
              code: "custom",
              message:
                "Staging and production deployment receipts require exact predecessor deployment and smoke receipt digests.",
              path: [index],
            });
          }
        }
      }),
    state: z.enum([
      "planned",
      "deployment-blocked",
      "deployed",
      "smoke-failed",
      "verified",
    ]),
  })
  .strict();

export type CustomerCiActionPinV1 = z.output<
  typeof customerCiActionPinV1Schema
>;
export type CustomerCiEnvironmentIdV1 = z.output<
  typeof customerCiEnvironmentIdV1Schema
>;
export type CustomerCiIssueV1 = z.output<typeof customerCiIssueV1Schema>;
export type CustomerCiOidcSubjectModeV1 = z.output<
  typeof customerCiOidcSubjectModeV1Schema
>;
export type CustomerCiOidcSubjectV1 = z.output<
  typeof customerCiOidcSubjectV1Schema
>;
export type CustomerCiSmokeTestExtensionV1 = z.output<
  typeof customerCiSmokeTestExtensionV1Schema
>;
export type CustomerCiLifecycleResultV1 = z.output<
  typeof customerCiLifecycleResultV1Schema
>;
export type CustomerCiTerraformBackendV1 = z.output<
  typeof customerCiTerraformBackendV1Schema
>;
export type CustomerCiWorkflowConfigV1 = z.output<
  typeof customerCiWorkflowConfigV1Schema
>;
export type CustomerCiWorkflowFileV1 = z.output<
  typeof customerCiWorkflowFileV1Schema
>;
export type CustomerCiWorkflowKindV1 = z.output<
  typeof customerCiWorkflowKindV1Schema
>;
export type CustomerCiWorkflowResultV1 = z.output<
  typeof customerCiWorkflowResultV1Schema
>;
export type SanitizedTerraformPlanV1 = z.output<
  typeof sanitizedTerraformPlanV1Schema
>;
export type SavedTerraformPlanExpectedV1 = z.output<
  typeof savedTerraformPlanExpectedV1Schema
>;
export type SavedTerraformPlanManifestV1 = z.output<
  typeof savedTerraformPlanManifestV1Schema
>;
export type TerraformSemanticPlanAnalysisV1 = z.output<
  typeof terraformSemanticPlanAnalysisV1Schema
>;
