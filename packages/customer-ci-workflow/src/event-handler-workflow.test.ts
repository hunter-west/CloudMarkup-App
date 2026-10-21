import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { parse as parseYaml } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import {
  customerCiWorkflowConfigV1Schema,
  type CustomerCiWorkflowConfigV1,
} from "./contracts.js";
import { generateCustomerCiWorkflowSetV1 } from "./generator.js";
import { sha256 } from "./security.js";
import { createCustomerCiWorkflowTestConfigV1 } from "./testing.js";
import { smokeTestExtensionVerificationScriptV1 } from "./workflow-scripts.js";

const temporaryRoots = new Set<string>();
const EVENT_DEPLOYMENT_KEY = "event_sns_fanout_consumer_primary";
const EVENT_WORKLOAD_ID = `workload_${EVENT_DEPLOYMENT_KEY}`;
const EVENT_SMOKE_SPECIFICATION_PATH = `application/test-specifications/${EVENT_DEPLOYMENT_KEY}.smoke.json`;
const EVENT_SMOKE_EXTENSION_ID = `smoke_${EVENT_DEPLOYMENT_KEY}`;

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map(async (root) => {
      await rm(root, { force: true, recursive: true });
    }),
  );
  temporaryRoots.clear();
});

function specification(extensionId: string, workloadId: string): string {
  return `${JSON.stringify({
    contractVersion: 1,
    extensionId,
    kind: "cloudmarkup.smoke-test-extension-specification",
    state: "customer-implementation-required",
    workloadId,
  })}\n`;
}

function eventConfig(): {
  readonly config: CustomerCiWorkflowConfigV1;
  readonly content: string;
} {
  const content = specification(EVENT_SMOKE_EXTENSION_ID, EVENT_WORKLOAD_ID);
  const config = structuredClone(createCustomerCiWorkflowTestConfigV1());
  config.smoke.extensions = [
    {
      contractVersion: 1,
      id: EVENT_SMOKE_EXTENSION_ID,
      specificationChecksum: sha256(content),
      specificationPath: EVENT_SMOKE_SPECIFICATION_PATH,
      workloadId: EVENT_WORKLOAD_ID,
    },
  ];
  return {
    config: customerCiWorkflowConfigV1Schema.parse(config),
    content,
  };
}

function onlyExtension(config: CustomerCiWorkflowConfigV1) {
  const extension = config.smoke.extensions[0];
  if (extension === undefined) {
    throw new Error("Event workflow fixture requires one smoke extension.");
  }
  return extension;
}

function verifierBody(script: string): string {
  const lines = script.split("\n");
  if (
    lines[0] !== "node --input-type=module <<'CLOUDMARKUP_SMOKE_EXTENSIONS'" ||
    lines.at(-1) !== "CLOUDMARKUP_SMOKE_EXTENSIONS"
  ) {
    throw new Error("Malformed smoke-test extension verifier fixture.");
  }
  return lines.slice(1, -1).join("\n");
}

describe("event handler CI workflow boundaries", () => {
  it("keeps PR handler Evidence and smoke metadata checks credentialless and adds bounded plan/deploy hooks", () => {
    const { config } = eventConfig();
    const generated = generateCustomerCiWorkflowSetV1(config);
    const byKind = new Map(
      generated.manifest.files.map((file) => [file.workflowKind, file.content]),
    );
    const validate = byKind.get("validate") ?? "";

    expect(generated.preview.smokeTestExtensions).toEqual(
      config.smoke.extensions,
    );
    expect(validate).toContain("generated handler build/test Evidence");
    expect(validate).toContain("application-build-and-tests");
    expect(validate).toContain("application-security-checks");
    expect(validate).not.toContain("id-token: write");
    expect(validate).not.toContain("secrets.");
    expect(validate).not.toContain("configure-aws-credentials");

    for (const phase of ["validate", "plan", "deploy", "smoke"] as const) {
      const workflow = byKind.get(phase) ?? "";
      const parsed = parseYaml(workflow) as {
        jobs: Record<string, { steps: { name: string }[] }>;
      };
      const names = Object.values(parsed.jobs).flatMap(({ steps }) =>
        steps.map(({ name }) => name),
      );
      expect(names).toContain(
        `Validate declarative smoke-test extension metadata for ${phase}`,
      );
      expect(workflow).toContain(EVENT_SMOKE_SPECIFICATION_PATH);
      expect(workflow).toContain(
        config.smoke.extensions[0]?.specificationChecksum,
      );
      expect(workflow).toContain("no customer command was executed");
    }
  });

  it("rejects arbitrary commands and path traversal in extension metadata", () => {
    const { config } = eventConfig();
    const command = structuredClone(config) as unknown as {
      smoke: { extensions: Record<string, unknown>[] };
    };
    command.smoke.extensions[0] = {
      ...command.smoke.extensions[0],
      command: "pnpm run customer-smoke",
    };
    expect(customerCiWorkflowConfigV1Schema.safeParse(command).success).toBe(
      false,
    );

    const traversal = structuredClone(config);
    onlyExtension(traversal).specificationPath = "../smoke.json";
    expect(customerCiWorkflowConfigV1Schema.safeParse(traversal).success).toBe(
      false,
    );
  });

  it("verifies exact declarative specification bytes without executing customer code", async () => {
    const { config, content } = eventConfig();
    const root = await mkdtemp(join(tmpdir(), "cloudmarkup-smoke-extension-"));
    temporaryRoots.add(root);
    const relativePath = onlyExtension(config).specificationPath;
    const target = join(
      root,
      config.repository.destinationFolder,
      ...relativePath.split("/"),
    );
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { flag: "wx" });
    const script = verifierBody(
      smokeTestExtensionVerificationScriptV1(config, "deploy"),
    );
    const accepted = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(accepted.stdout).toContain("no customer command was executed");

    await writeFile(target, `${content} `, "utf8");
    const rejected = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain(
      "declarative smoke-test extension metadata failed exact validation",
    );
  });
});
