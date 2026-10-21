import {
  computeReviewedRepositoryWorkflowsResultDigestV1,
  reviewedRepositoryWorkflowsDigestPayloadV1Schema,
  reviewedRepositoryWorkflowsV1Schema,
  type ReviewedRepositoryWorkflowsV1,
} from "@cloudmarkup/solution-export";
import {
  repositoryRelativePathSchema,
  serializeCanonicalJson,
  sha256DigestSchema,
  type RepositoryRelativePath,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import {
  customerCiWorkflowConfigV1Schema,
  customerCiWorkflowResultV1Schema,
  type CustomerCiWorkflowConfigV1,
} from "./contracts.js";
import { validateCustomerCiWorkflowSetV1 } from "./generator.js";
import { sha256 } from "./security.js";

const packageFileV1Schema = z
  .object({
    checksum: sha256DigestSchema,
    path: repositoryRelativePathSchema,
  })
  .strict();

const packageFilesV1Schema = z
  .array(packageFileV1Schema)
  .min(1)
  .max(2_048)
  .superRefine((files, context) => {
    const seen = new Set<string>();
    files.forEach(({ path }, index) => {
      const portable = path.normalize("NFC").toLocaleLowerCase("en-US");
      if (seen.has(portable)) {
        context.addIssue({
          code: "custom",
          message:
            "Package file paths must be unique across portable filesystems.",
          path: [index, "path"],
        });
      }
      seen.add(portable);
    });
  });

const VALIDATOR_ID = "cloudmarkup.customer-ci-workflow-validator";
const VALIDATOR_VERSION = "1.0.0";
const VALIDATOR_DIGEST = sha256(
  serializeCanonicalJson({
    contractVersion: 1,
    id: VALIDATOR_ID,
    policy:
      "exact-five-files/config/pins/revision/repository/package-tree/review",
    version: VALIDATOR_VERSION,
  }),
);

function packagePath(
  repositoryPath: string,
  destinationFolder: string,
): RepositoryRelativePath {
  if (destinationFolder === "") {
    return repositoryRelativePathSchema.parse(repositoryPath);
  }
  const prefix = `${destinationFolder}/`;
  if (!repositoryPath.startsWith(prefix)) {
    throw new TypeError(
      "Customer CI paths must stay inside the export destination.",
    );
  }
  return repositoryRelativePathSchema.parse(
    repositoryPath.slice(prefix.length),
  );
}

function permissionExplanation(scope: string, access: string): string {
  if (scope === "id-token" && access === "write") {
    return "Requests a short-lived GitHub OIDC token only in the reviewed customer-cloud job.";
  }
  if (scope === "actions" && access === "read") {
    return "Reads the exact prior workflow run and restricted artifact named by the reviewed receipt.";
  }
  if (scope === "contents" && access === "read") {
    return "Reads the reviewed repository commit without persisting checkout credentials.";
  }
  return "Uses only the access shown by this reviewed workflow.";
}

function variablePurposes(
  config: CustomerCiWorkflowConfigV1,
): Readonly<Record<string, string>> {
  return {
    [config.variables.awsAccountId]:
      "Expected customer AWS account ID used to fail closed before role assumption.",
    [config.variables.awsRegion]:
      "Approved AWS region for the customer-owned environment.",
    [config.variables.deployEnabled]:
      "Customer kill switch that must explicitly allow deployment.",
    [config.variables.deployedCommit]:
      "Exact commit recorded by the approved deployment receipt.",
    [config.variables.deployedRevisionDigest]:
      "Exact immutable Solution Revision digest recorded by deployment.",
    [config.variables.deploymentReceiptDigest]:
      "Checksum of the exact approved deployment receipt.",
    [config.variables.deploymentRunId]:
      "Exact successful deployment workflow run used by smoke and drift checks.",
    [config.variables.deployRoleArn]:
      "Customer-owned deployment-only OIDC role ARN.",
    [config.variables.driftRoleArn]:
      "Customer-owned read-only drift OIDC role ARN.",
    [config.variables.planRoleArn]:
      "Customer-owned planning-only OIDC role ARN.",
    [config.variables.smokeBaseUrl]:
      "Explicit approved HTTPS endpoint for bounded smoke checks; no discovery is performed.",
  };
}

/**
 * Converts a validated provider-specific workflow result into the provider-neutral,
 * sealed Solution Export extension boundary. The caller supplies the already reviewed
 * package inventory; this function never reads a repository or invents file checksums.
 */
export function createReviewedCustomerCiRepositoryWorkflowsV1(input: {
  readonly config: unknown;
  readonly packageFiles: readonly unknown[];
  readonly result: unknown;
}): ReviewedRepositoryWorkflowsV1 {
  const config = customerCiWorkflowConfigV1Schema.parse(input.config);
  const result = customerCiWorkflowResultV1Schema.parse(input.result);
  const packageFiles = packageFilesV1Schema.parse(input.packageFiles);
  const validation = validateCustomerCiWorkflowSetV1(config, result);
  if (!validation.valid) {
    throw new TypeError(
      "Customer CI workflows failed deterministic validation.",
    );
  }

  const terraformRoot = packagePath(
    config.terraform.rootDirectory,
    config.repository.destinationFolder,
  );
  const backendConfigPath = packagePath(
    config.terraform.backend.configPath,
    config.repository.destinationFolder,
  );
  const providerLockPath = packagePath(
    config.terraform.providerLockPath,
    config.repository.destinationFolder,
  );
  const requiredTerraformFiles = packageFiles
    .filter(({ path }) => path.startsWith(`${terraformRoot}/`))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const packageTreeDigest = sha256(
    serializeCanonicalJson(
      requiredTerraformFiles.map(({ checksum, path }) => ({ checksum, path })),
    ),
  );

  const byPath = new Map(
    requiredTerraformFiles.map((file) => [file.path, file]),
  );
  if (
    !byPath.has(backendConfigPath) ||
    !byPath.has(providerLockPath) ||
    !requiredTerraformFiles.some(({ path }) => /\.tf(?:\.json)?$/u.test(path))
  ) {
    throw new TypeError(
      "The reviewed Terraform tree must include its backend configuration, exact provider lock, and Terraform source.",
    );
  }
  if (packageTreeDigest !== config.terraform.packageTreeDigest) {
    throw new TypeError(
      "The reviewed Terraform package tree does not match the workflow configuration digest.",
    );
  }

  const workflowFiles = result.manifest.files.map((file) => ({
    checksum: file.checksum,
    content: { encoding: "utf8" as const, value: file.content },
    kind: "regular-file" as const,
    mediaType: "application/yaml" as const,
    ownership: "generated-replaceable" as const,
    path: file.path,
    provenance: {
      producer: result.manifest.generator,
      solutionRevisionId: result.manifest.solutionRevision.id,
      sourceReferences: [
        {
          id: result.manifest.solutionRevision.id,
          kind: "solution-revision" as const,
        },
      ],
    },
    semanticChecksum: file.semanticChecksum,
  }));

  const review = {
    environments: result.preview.environments,
    permissions: result.preview.workflows.flatMap((workflow) =>
      workflow.permissions.map((permission) => {
        const [scope, access] = permission.split(": ");
        if (
          scope === undefined ||
          access === undefined ||
          !["none", "read", "write"].includes(access)
        ) {
          throw new TypeError(
            "Customer CI workflow permissions are malformed.",
          );
        }
        return {
          access: access as "none" | "read" | "write",
          explanation: permissionExplanation(scope, access),
          scope,
          workflowPath: workflow.path,
        };
      }),
    ),
    roles: result.preview.roles.map((role) => ({
      ...role,
      reference: `vars.${role.variable}`,
    })),
    secrets: result.preview.requiredSecrets.map((name) => ({
      name,
      purpose:
        name === config.plan.artifactEncryption.privateKeySecretName
          ? "Customer-controlled private key used only inside the approved deployment environment to decrypt the exact saved plan."
          : "Customer-controlled secret explicitly required by the reviewed workflow.",
    })),
    triggers: result.preview.workflows.map((workflow) => ({
      events: workflow.triggers,
      workflowPath: workflow.path,
    })),
    variables: result.preview.requiredVariables.map((name) => ({
      name,
      purpose:
        variablePurposes(config)[name] ??
        "Customer-owned non-secret GitHub Environment configuration.",
    })),
    workflows: result.preview.workflows.map((workflow) => ({
      environmentScoped: workflow.environmentScoped,
      path: workflow.path,
      purpose: workflow.purpose,
    })),
    warnings: [
      {
        code: "workflow-permission-required",
        message: result.preview.permissionExplanation,
      },
      ...result.preview.warnings.map((message, index) => ({
        code: `customer-ci-warning-${String(index + 1)}`,
        message,
      })),
    ],
  };

  const providerLock = byPath.get(providerLockPath);
  if (providerLock === undefined) {
    throw new TypeError("The exact Terraform provider lock is missing.");
  }
  const dependencyLockDigests = [
    {
      digest: result.manifest.pinRegistryDigest,
      id: "workflow-action-pin-registry",
    },
    { digest: providerLock.checksum, id: "terraform-provider-lock" },
  ].sort((left, right) => left.id.localeCompare(right.id, "en"));

  const payload = reviewedRepositoryWorkflowsDigestPayloadV1Schema.parse({
    configDigest: result.manifest.configDigest,
    contractVersion: 1,
    dependencyLockDigests,
    files: workflowFiles,
    generator: result.manifest.generator,
    kind: "cloudmarkup.reviewed-repository-workflows",
    pinRegistryDigest: result.manifest.pinRegistryDigest,
    policyDigest: result.manifest.policyDigest,
    repository: {
      defaultBranch: config.repository.defaultBranch,
      destinationFolder: config.repository.destinationFolder,
      name: config.repository.name,
      owner: config.repository.owner,
      repositoryId: config.repository.oidcSubject.repositoryId,
      repositoryOwnerId: config.repository.oidcSubject.repositoryOwnerId,
      state: "bound",
    },
    requiredPackageTrees: [
      { files: requiredTerraformFiles, root: terraformRoot },
    ],
    review,
    solutionRevision: result.manifest.solutionRevision,
    validator: {
      digest: VALIDATOR_DIGEST,
      id: VALIDATOR_ID,
      version: VALIDATOR_VERSION,
    },
  });

  return reviewedRepositoryWorkflowsV1Schema.parse({
    ...payload,
    resultDigest: computeReviewedRepositoryWorkflowsResultDigestV1(payload),
  });
}
