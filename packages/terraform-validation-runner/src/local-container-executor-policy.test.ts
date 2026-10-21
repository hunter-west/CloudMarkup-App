import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const executorSource = readFileSync(
  new URL("./local-container-executor.ts", import.meta.url),
  "utf8",
);

describe("local validation container policy", () => {
  it("uses a private engine volume for validation and exact root staging only", () => {
    expect(executorSource).toContain(
      "type=volume,source=${input.volumeName},target=/workspace,volume-nocopy",
    );
    expect(executorSource).toContain(
      "type=bind,source=${root},target=/input,readonly",
    );
    expect(executorSource).not.toContain("target=/workspace,readonly");
    expect(executorSource).toContain(
      '"/opt/cloudmarkup/bin/terraform-validation-stage"',
    );
    expect(executorSource).toContain('"0:0"');
  });

  it("keeps validation non-root, networkless, capability-free, and read-only", () => {
    expect(executorSource).toContain("TERRAFORM_VALIDATION_RUNTIME_UID");
    expect(executorSource).toContain("TERRAFORM_VALIDATION_RUNTIME_GID");
    expect(executorSource).toContain('"--network",\n    "none"');
    expect(executorSource).toContain('"--read-only"');
    expect(executorSource).toContain('"--cap-drop",\n    "ALL"');
    expect(executorSource).toContain('"no-new-privileges:true"');
  });

  it("grants staging only CHOWN and DAC_OVERRIDE and verifies exact cleanup", () => {
    const addedCapabilities = [
      ...executorSource.matchAll(/"--cap-add",\s*\n\s*"([A-Z_]+)"/gu),
    ].map((match) => match[1]);
    expect(addedCapabilities).toEqual(["CHOWN", "DAC_OVERRIDE"]);
    expect(executorSource).toContain('["rm", "--force", input.containerName]');
    expect(executorSource).toContain(
      '["volume", "rm", "--force", input.volumeName]',
    );
    expect(executorSource).toContain(
      'containerNames: [input.volumeName + "-stage"]',
    );
    expect(executorSource).toContain('"{{.Names}}"');
    expect(executorSource).toContain('"{{.Name}}"');
    const failedOpenCleanup = executorSource.slice(
      executorSource.indexOf("async function cleanupFailedValidationOpen"),
      executorSource.indexOf("class LocalContainerSession"),
    );
    expect(
      failedOpenCleanup.indexOf("cleanupExactValidationEngineResources"),
    ).toBeLessThan(
      failedOpenCleanup.indexOf("seam.removeDirectory(input.root)"),
    );
    expect(executorSource).not.toContain("0o777");
    expect(executorSource).not.toContain("chmod(root");
  });
});
