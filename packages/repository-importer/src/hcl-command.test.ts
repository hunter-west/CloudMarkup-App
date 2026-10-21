import { describe, expect, it } from "vitest";
import { createTerraformHCLInspectorCommand } from "./hcl-command.js";

const encodedResult = new TextEncoder().encode(
  JSON.stringify({
    contractVersion: 1,
    parser: { id: "cloudmarkup.terraform-hcl-inspector", version: "1.0.0" },
    succeeded: true,
    diagnostics: [],
    blocks: [],
  }),
);

describe("Terraform HCL inspector command adapter", () => {
  it("uses a fixed argument array and sends repository bytes only over stdin", async () => {
    let invocation: unknown;
    const inspector = createTerraformHCLInspectorCommand({
      executable: "C:/approved/cloudmarkup-iac.exe",
      executor: {
        run(input) {
          invocation = input;
          return Promise.resolve({
            exitCode: 0,
            stdout: encodedResult,
            stderr: new Uint8Array(),
            termination: "completed" as const,
          });
        },
      },
    });
    await inspector.inspect({
      path: "infrastructure/$(malicious).tf",
      source: new TextEncoder().encode('resource "x" "y" {}'),
    });
    expect(invocation).toMatchObject({
      executable: "C:/approved/cloudmarkup-iac.exe",
      args: [
        "inspect-terraform-hcl",
        "--input",
        "-",
        "--output",
        "-",
        "--max-input-bytes",
        "8388608",
        "--max-output-bytes",
        "8388608",
      ],
    });
    expect(JSON.stringify(invocation)).not.toContain("$(malicious)");
  });

  it("fails closed on timeout, malformed output, and oversized input", async () => {
    const timedOut = createTerraformHCLInspectorCommand({
      executable: "approved",
      executor: {
        run() {
          return Promise.resolve({
            exitCode: -1,
            stdout: new Uint8Array(),
            stderr: new Uint8Array(),
            termination: "timeout" as const,
          });
        },
      },
    });
    await expect(
      timedOut.inspect({ path: "main.tf", source: new Uint8Array() }),
    ).rejects.toThrow(/complete safely/u);
    const malformed = createTerraformHCLInspectorCommand({
      executable: "approved",
      executor: {
        run() {
          return Promise.resolve({
            exitCode: 0,
            stdout: new TextEncoder().encode("not-json"),
            stderr: new Uint8Array(),
            termination: "completed" as const,
          });
        },
      },
    });
    await expect(
      malformed.inspect({ path: "main.tf", source: new Uint8Array() }),
    ).rejects.toThrow(/malformed/u);
    const bounded = createTerraformHCLInspectorCommand({
      executable: "approved",
      maximumInputBytes: 1,
      executor: {
        run() {
          return Promise.reject(new Error("must not execute"));
        },
      },
    });
    await expect(
      bounded.inspect({ path: "main.tf", source: new Uint8Array(2) }),
    ).rejects.toThrow(/approved limit/u);
  });
});
