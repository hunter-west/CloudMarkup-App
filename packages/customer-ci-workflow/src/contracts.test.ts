import { describe, expect, it } from "vitest";

import {
  customerCiWorkflowConfigV1Schema,
  savedTerraformPlanExpectedV1Schema,
  savedTerraformPlanManifestV1Schema,
} from "./contracts.js";
import {
  createCustomerCiWorkflowTestConfigV1,
  createSavedTerraformPlanTestPairV1,
} from "./testing.js";

describe("customer CI workflow contract boundaries", () => {
  it("requires unique approved branches within each environment", () => {
    const config = structuredClone(createCustomerCiWorkflowTestConfigV1());
    const dev = config.environments[0];
    if (dev === undefined) throw new Error("Missing dev fixture.");
    dev.approvedBranches = ["main", "main"];

    const result = customerCiWorkflowConfigV1Schema.safeParse(config);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Approved branches must be unique within each environment.",
          path: ["environments", 0, "approvedBranches"],
        }),
      ]),
    );
  });

  it("requires every GitHub variable name to be unique, not only role variables", () => {
    const config = structuredClone(createCustomerCiWorkflowTestConfigV1());
    config.variables.awsRegion = config.variables.awsAccountId;

    const result = customerCiWorkflowConfigV1Schema.safeParse(config);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some(
        ({ message, path }) =>
          message.includes("Every GitHub variable") &&
          path.join(".") === "variables.awsRegion",
      ),
    ).toBe(true);
  });

  it("requires the exact versioned encrypted and workspace-isolated AWS S3 backend profile", () => {
    const config = createCustomerCiWorkflowTestConfigV1();

    expect(config.terraform.backend).toEqual({
      configPath: "solutions/notes/infrastructure/terraform/backend.hcl",
      contractVersion: 1,
      encryption: "required",
      locking: "s3-native-lockfile",
      type: "aws-s3",
      workspaceIsolation: "workspace-key-prefix",
    });
  });

  it.each([
    ["contract version", "contractVersion", 2],
    ["backend type", "type", "local"],
    ["encryption", "encryption", "optional"],
    ["locking", "locking", "disabled"],
    ["workspace isolation", "workspaceIsolation", "none"],
  ])("rejects a weakened backend %s", (_label, field, value) => {
    const config = structuredClone(createCustomerCiWorkflowTestConfigV1());
    Reflect.set(config.terraform.backend, field, value);

    expect(customerCiWorkflowConfigV1Schema.safeParse(config).success).toBe(
      false,
    );
  });

  it("rejects unknown backend authority fields and the legacy loose path field", () => {
    const backendAuthority = structuredClone(
      createCustomerCiWorkflowTestConfigV1(),
    );
    Reflect.set(
      backendAuthority.terraform.backend,
      "accessKey",
      "must-never-exist",
    );
    const backendResult =
      customerCiWorkflowConfigV1Schema.safeParse(backendAuthority);
    expect(backendResult.success).toBe(false);
    if (!backendResult.success) {
      expect(backendResult.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unrecognized_keys",
            path: ["terraform", "backend"],
            keys: ["accessKey"],
          }),
        ]),
      );
    }

    const legacyPath = structuredClone(createCustomerCiWorkflowTestConfigV1());
    Reflect.set(
      legacyPath.terraform,
      "backendConfigPath",
      legacyPath.terraform.backend.configPath,
    );
    const legacyResult = customerCiWorkflowConfigV1Schema.safeParse(legacyPath);
    expect(legacyResult.success).toBe(false);
    if (!legacyResult.success) {
      expect(legacyResult.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "unrecognized_keys",
            path: ["terraform"],
            keys: ["backendConfigPath"],
          }),
        ]),
      );
    }
  });

  it("requires the exact backend.hcl path at the reviewed Terraform root", () => {
    const config = structuredClone(createCustomerCiWorkflowTestConfigV1());
    config.terraform.backend.configPath =
      "solutions/notes/infrastructure/terraform/state/backend.hcl";

    const result = customerCiWorkflowConfigV1Schema.safeParse(config);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["terraform", "backend", "configPath"],
        }),
      ]),
    );
  });

  it("uses the canonical GitHub owner shape and rejects repository-name punctuation", () => {
    for (const owner of ["customer.organization", "customer_organization"]) {
      const config = structuredClone(createCustomerCiWorkflowTestConfigV1());
      config.repository.owner = owner;

      expect(customerCiWorkflowConfigV1Schema.safeParse(config).success).toBe(
        false,
      );
    }
  });

  it("rejects unverified saved-plan attestation extensions", () => {
    const { manifest } = createSavedTerraformPlanTestPairV1();

    expect(
      savedTerraformPlanManifestV1Schema.safeParse({
        ...manifest,
        attestation: {
          digest: manifest.planChecksum,
          kind: "customer-attestation-v1",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown nested Solution Revision fields in saved-plan bindings", () => {
    const { expected, manifest } = createSavedTerraformPlanTestPairV1();
    expect(
      savedTerraformPlanManifestV1Schema.safeParse({
        ...manifest,
        solutionRevision: { ...manifest.solutionRevision, extra: true },
      }).success,
    ).toBe(false);
    expect(
      savedTerraformPlanExpectedV1Schema.safeParse({
        ...expected,
        solutionRevision: { ...expected.solutionRevision, extra: true },
      }).success,
    ).toBe(false);
  });
});
