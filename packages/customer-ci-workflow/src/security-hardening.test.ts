import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { parse as parseYaml } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import { generateCustomerCiWorkflowSetV1 } from "./generator.js";
import { sha256 } from "./security.js";
import { createCustomerCiWorkflowTestConfigV1 } from "./testing.js";
import { generatedSourceSecurityVerificationScriptV1 } from "./workflow-scripts.js";

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map(async (root) => {
      await rm(root, { force: true, recursive: true });
    }),
  );
  temporaryRoots.clear();
});

function extractBody(script: string): string {
  const lines = script.split("\n");
  const marker = "CLOUDMARKUP_GENERATED_SOURCE_SECURITY";
  expect(lines[0]).toBe(`node --input-type=module <<'${marker}'`);
  expect(lines.at(-1)).toBe(marker);
  return lines.slice(1, -1).join("\n");
}

async function executeSourceScan(
  source: string,
  ownership:
    "generated-replaceable" | "user-owned-extension" = "generated-replaceable",
) {
  const config = createCustomerCiWorkflowTestConfigV1();
  const root = await mkdtemp(join(tmpdir(), "cloudmarkup-source-scan-"));
  temporaryRoots.add(root);
  const packageRoot = join(root, config.repository.destinationFolder);
  const sourcePath = "application/src/functions/fixture/handler.ts";
  const sourceFile = join(packageRoot, ...sourcePath.split("/"));
  const manifestFile = join(
    packageRoot,
    "cloudmarkup",
    "cloudmarkup.manifest.json",
  );
  await mkdir(dirname(sourceFile), { recursive: true });
  await mkdir(dirname(manifestFile), { recursive: true });
  await writeFile(sourceFile, source, { flag: "wx" });
  await writeFile(
    manifestFile,
    `${JSON.stringify({
      contractVersion: 1,
      files: [
        {
          checksum: sha256(source),
          mediaType: "text/typescript",
          ownership,
          path: sourcePath,
          sizeBytes: Buffer.byteLength(source),
        },
      ],
      kind: "cloudmarkup.solution-export-manifest",
    })}\n`,
    { flag: "wx" },
  );
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      extractBody(generatedSourceSecurityVerificationScriptV1(config)),
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
}

describe("customer workflow supply-chain hardening", () => {
  it("adds a credentialless manifest-bound application source scan to PR validation", () => {
    const generated = generateCustomerCiWorkflowSetV1(
      createCustomerCiWorkflowTestConfigV1(),
    );
    const validate = generated.manifest.files.find(
      ({ workflowKind }) => workflowKind === "validate",
    )?.content;
    expect(validate).toBeDefined();
    const workflow = parseYaml(validate ?? "") as {
      jobs: { validate: { steps: { name: string; run?: string }[] } };
    };
    const step = workflow.jobs.validate.steps.find(
      ({ name }) =>
        name ===
        "Scan exact manifest-bound application source without credentials",
    );
    expect(step?.run).toContain("CLOUDMARKUP_GENERATED_SOURCE_SECURITY");
    expect(step?.run).toContain("generated-replaceable");
    expect(validate).not.toContain("id-token: write");
    expect(validate).not.toContain("configure-aws-credentials");
    expect(validate).not.toContain("secrets.");
  });

  it("accepts exact safe source and rejects redacted secret or execution findings", async () => {
    const accepted = await executeSourceScan(
      "export const handler = async () => ({ statusCode: 200 });\n",
    );
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(accepted.stdout).toContain(
      "exact manifest-bound application source",
    );

    const secret = ["whsec", "D".repeat(24)].join("_");
    const rejectedSecret = await executeSourceScan(
      `export const value = ${JSON.stringify(secret)};\n`,
    );
    expect(rejectedSecret.status).not.toBe(0);
    expect(rejectedSecret.stderr).toContain("matched content is redacted");
    expect(rejectedSecret.stderr).not.toContain(secret);

    const rejectedExecution = await executeSourceScan(
      'import { exec } from "node:child_process";\nexport { exec };\n',
    );
    expect(rejectedExecution.status).not.toBe(0);
    expect(rejectedExecution.stderr).toContain("matched content is redacted");
  });

  it("uses restrictive file modes and always removes drift raw material", () => {
    const generated = generateCustomerCiWorkflowSetV1(
      createCustomerCiWorkflowTestConfigV1(),
    );
    const byKind = new Map(
      generated.manifest.files.map((file) => [file.workflowKind, file.content]),
    );
    const plan = byKind.get("plan") ?? "";
    const deploy = byKind.get("deploy") ?? "";
    const drift = byKind.get("drift") ?? "";
    expect(plan).toContain("umask 077");
    expect(plan).toContain('chmod 600 "$GITHUB_WORKSPACE/cloudmarkup.tfplan"');
    expect(deploy).toContain("umask 077");
    expect(drift).toContain("umask 077");
    expect(drift).toContain(
      'chmod 600 "$GITHUB_WORKSPACE/cloudmarkup-drift.tfplan"',
    );

    const parsed = parseYaml(drift) as {
      jobs: { drift: { steps: { if?: string; name: string; run?: string }[] } };
    };
    const cleanup = parsed.jobs.drift.steps.find(
      ({ name }) =>
        name === "Remove drift plan and raw material from the runner",
    );
    expect(cleanup?.if).toBe("always()");
    expect(cleanup?.run).toContain("cloudmarkup-drift.tfplan");
    expect(cleanup?.run).toContain("cloudmarkup-plan.raw.json");
  });
});
