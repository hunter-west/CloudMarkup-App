import { reviewedRepositoryWorkflowsV1Schema } from "@cloudmarkup/solution-export";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { generateCustomerCiWorkflowSetV1 } from "./generator.js";
import { sha256 } from "./security.js";
import { createReviewedCustomerCiRepositoryWorkflowsV1 } from "./solution-export-adapter.js";
import {
  CUSTOMER_CI_TEST_BACKEND_CONFIG_V1,
  createCustomerCiWorkflowTestConfigV1,
} from "./testing.js";

function packageFiles() {
  return [
    {
      checksum: sha256("terraform {}\n"),
      path: "infrastructure/terraform/main.tf",
    },
    {
      checksum: sha256(CUSTOMER_CI_TEST_BACKEND_CONFIG_V1),
      path: "infrastructure/terraform/backend.hcl",
    },
    {
      checksum: sha256("provider lock\n"),
      path: "infrastructure/terraform/.terraform.lock.hcl",
    },
    {
      checksum: sha256("# unrelated\n"),
      path: "README.md",
    },
  ];
}

function configForPackageFiles(files = packageFiles()) {
  const config = createCustomerCiWorkflowTestConfigV1();
  const terraformFiles = files
    .filter(({ path }) => path.startsWith("infrastructure/terraform/"))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  config.terraform.packageTreeDigest = sha256(
    serializeCanonicalJson(
      terraformFiles.map(({ checksum, path }) => ({ checksum, path })),
    ),
  );
  return config;
}

describe("customer CI Solution Export adapter", () => {
  it("seals exact workflows, repository truth, review rows, and Terraform tree", () => {
    const config = configForPackageFiles();
    const result = generateCustomerCiWorkflowSetV1(config);

    const reviewed = createReviewedCustomerCiRepositoryWorkflowsV1({
      config,
      packageFiles: packageFiles(),
      result,
    });

    expect(reviewedRepositoryWorkflowsV1Schema.parse(reviewed)).toEqual(
      reviewed,
    );
    expect(reviewed.files.map(({ path }) => path)).toEqual(
      result.manifest.files.map(({ path }) => path),
    );
    expect(reviewed.repository).toEqual({
      defaultBranch: config.repository.defaultBranch,
      destinationFolder: config.repository.destinationFolder,
      name: config.repository.name,
      owner: config.repository.owner,
      repositoryId: config.repository.oidcSubject.repositoryId,
      repositoryOwnerId: config.repository.oidcSubject.repositoryOwnerId,
      state: "bound",
    });
    expect(reviewed.requiredPackageTrees).toEqual([
      {
        files: packageFiles()
          .slice(0, 3)
          .sort((left, right) => left.path.localeCompare(right.path, "en")),
        root: "infrastructure/terraform",
      },
    ]);
    expect(reviewed.review.environments).toHaveLength(3);
    expect(reviewed.review.roles).toHaveLength(9);
    expect(reviewed.review.secrets).toEqual([
      {
        name: config.plan.artifactEncryption.privateKeySecretName,
        purpose:
          "Customer-controlled private key used only inside the approved deployment environment to decrypt the exact saved plan.",
      },
    ]);
    expect(reviewed.review.permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          access: "write",
          scope: "id-token",
          workflowPath: ".github/workflows/cloudmarkup-plan.yml",
        }),
      ]),
    );
    expect(reviewed.review.warnings[0]?.code).toBe(
      "workflow-permission-required",
    );
    expect(reviewed.dependencyLockDigests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "terraform-provider-lock" }),
        expect.objectContaining({ id: "workflow-action-pin-registry" }),
      ]),
    );
  });

  it("fails closed for changed workflow bytes or an incomplete Terraform tree", () => {
    const config = configForPackageFiles();
    const result = generateCustomerCiWorkflowSetV1(config);
    const tampered = structuredClone(result);
    const firstWorkflow = tampered.manifest.files[0];
    if (firstWorkflow === undefined) {
      throw new Error("Missing workflow fixture.");
    }
    firstWorkflow.content += "# changed\n";

    expect(() =>
      createReviewedCustomerCiRepositoryWorkflowsV1({
        config,
        packageFiles: packageFiles(),
        result: tampered,
      }),
    ).toThrow("failed deterministic validation");

    expect(() =>
      createReviewedCustomerCiRepositoryWorkflowsV1({
        config,
        packageFiles: packageFiles().filter(
          ({ path }) => !path.endsWith(".terraform.lock.hcl"),
        ),
        result,
      }),
    ).toThrow("exact provider lock");
  });

  it("rejects portable-path collisions in caller-supplied package truth", () => {
    const config = configForPackageFiles();
    const result = generateCustomerCiWorkflowSetV1(config);
    expect(() =>
      createReviewedCustomerCiRepositoryWorkflowsV1({
        config,
        packageFiles: [
          ...packageFiles(),
          {
            checksum: sha256("collision\n"),
            path: "Infrastructure/Terraform/main.tf",
          },
        ],
        result,
      }),
    ).toThrow("portable filesystems");
  });

  it("rejects a Terraform package tree that differs from the reviewed digest", () => {
    const config = configForPackageFiles();
    const result = generateCustomerCiWorkflowSetV1(config);
    const changedFiles = packageFiles();
    changedFiles[0] = {
      checksum: sha256('terraform { required_version = "1.15.8" }\n'),
      path: "infrastructure/terraform/main.tf",
    };

    expect(() =>
      createReviewedCustomerCiRepositoryWorkflowsV1({
        config,
        packageFiles: changedFiles,
        result,
      }),
    ).toThrow("does not match the workflow configuration digest");
  });
});
