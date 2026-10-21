import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { generateCustomerCiWorkflowSetV1 } from "./generator.js";
import { canonicalJson, sha256 } from "./security.js";
import { createCustomerCiWorkflowTestConfigV1 } from "./testing.js";
import {
  conformanceDeploymentRecordScriptV1,
  conformanceDriftRecordScriptV1,
} from "./workflow-scripts.js";

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const OBSERVED_AT = "2026-08-29T12:00:00.000Z";
const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map(async (root) => {
      await rm(root, { force: true, recursive: true });
    }),
  );
  temporaryRoots.clear();
});

function extractHeredocBody(script: string, marker: string): string {
  const lines = script.split("\n");
  const start = lines.indexOf(`node --input-type=module <<'${marker}'`);
  const end = lines.indexOf(marker, start + 1);
  if (start < 0 || end <= start) {
    throw new Error(`Missing generated ${marker} script body.`);
  }
  return lines.slice(start + 1, end).join("\n");
}

function executeNodeBody(
  body: string,
  env: Readonly<Record<string, string>>,
  cwd: string,
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ["--input-type=module", "--eval", body], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 10_000,
  });
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cloudmarkup-conformance-script-"));
  temporaryRoots.add(root);
  return root;
}

interface DeploymentFixture {
  readonly deployment: Record<string, unknown>;
  readonly receiptBytes: Buffer;
  readonly root: string;
}

async function createDeploymentFixture(
  target: "terraform" | "cloudformation",
): Promise<DeploymentFixture> {
  const root = await createRoot();
  const savedPlanDirectory = join(root, "saved-plan");
  await mkdir(savedPlanDirectory);
  const solutionRevision =
    createCustomerCiWorkflowTestConfigV1().solutionRevision;
  const generatedManifestDigest = sha256("generated-manifest");
  const planProjection = {
    backendConfigDigest: sha256("backend"),
    changes: [],
    commitSha: COMMIT_SHA,
    contractVersion: 1,
    createdAt: OBSERVED_AT,
    environmentId: "dev",
    expiresAt: "2026-08-30T12:00:00.000Z",
    generatedManifestDigest,
    kind: "cloudmarkup.normalized-conformance-plan",
    planChecksum: sha256("plan"),
    scope: "partial",
    solutionRevision,
    sourceRepresentationChecksum: sha256("plan"),
    target,
    tool: {
      digest: sha256("tool"),
      id: target === "terraform" ? "hashicorp.terraform" : "aws.cloudformation",
      version: "1.0.0",
    },
    ...(target === "terraform" ? { workspace: "notes_dev" } : {}),
  };
  const plan = {
    ...planProjection,
    evidenceChecksum: sha256(canonicalJson(planProjection)),
  };
  const manifest = { solutionExportManifestDigest: generatedManifestDigest };
  const receipt = {
    commitSha: COMMIT_SHA,
    createdAt: OBSERVED_AT,
    environment: "dev",
    solutionRevision,
  };
  const receiptBytes = Buffer.from(canonicalJson(receipt));
  await Promise.all([
    writeFile(
      join(savedPlanDirectory, "cloudmarkup-conformance.plan.json"),
      canonicalJson(plan),
    ),
    writeFile(
      join(savedPlanDirectory, "cloudmarkup-plan.manifest.json"),
      canonicalJson(manifest),
    ),
    writeFile(join(root, "cloudmarkup-deployment.receipt.json"), receiptBytes),
  ]);

  const result = executeNodeBody(
    extractHeredocBody(
      conformanceDeploymentRecordScriptV1(),
      "CLOUDMARKUP_CONFORMANCE_DEPLOYMENT",
    ),
    {
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_RUN_ID: "700100",
      GITHUB_WORKFLOW_REF:
        "customer/repository/.github/workflows/deploy.yml@refs/heads/main",
      SAVED_PLAN_DIRECTORY: savedPlanDirectory,
    },
    root,
  );
  expect(result.status, result.stderr).toBe(0);
  const deployment = JSON.parse(
    await readFile(
      join(root, "cloudmarkup-conformance.deployment.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  return { deployment, receiptBytes, root };
}

describe("generated conformance workflow records", () => {
  it("keeps deployment evidence target-neutral and explicitly partial when deployment attestations are unavailable", async () => {
    const fixture = await createDeploymentFixture("cloudformation");

    expect(fixture.deployment).toMatchObject({
      artifactAttestations: [],
      completeness: "partial",
      issues: [
        {
          code: "CONFORMANCE_DEPLOYMENT_ARTIFACT_ATTESTATIONS_UNAVAILABLE",
          field: "artifactAttestations",
          severity: "warning",
        },
        {
          code: "CONFORMANCE_DEPLOYMENT_SMOKE_MISSING",
          field: "smoke",
          severity: "warning",
        },
      ],
      target: "cloudformation",
    });
  });

  it("binds refresh-only drift to normalized deployment evidence and keeps inventory scope partial", async () => {
    const fixture = await createDeploymentFixture("terraform");
    const deploymentEvidenceChecksum = String(
      fixture.deployment["evidenceChecksum"],
    );
    const deploymentReceiptDigest = sha256(fixture.receiptBytes);
    const solutionRevision =
      createCustomerCiWorkflowTestConfigV1().solutionRevision;
    await Promise.all([
      writeFile(
        join(fixture.root, "cloudmarkup-plan.analysis.json"),
        canonicalJson({
          changes: [],
          counts: {
            create: 0,
            delete: 0,
            noOp: 1,
            replace: 0,
            update: 0,
          },
          issues: [],
        }),
      ),
      writeFile(
        join(fixture.root, "cloudmarkup-drift.result.json"),
        canonicalJson({
          deploymentReceiptDigest,
          driftDetected: false,
          environment: "dev",
          solutionRevision,
        }),
      ),
      writeFile(
        join(fixture.root, "cloudmarkup-drift.receipt.json"),
        canonicalJson({
          createdAt: OBSERVED_AT,
          environment: "dev",
          predecessorReceiptDigest: deploymentReceiptDigest,
          solutionRevision,
        }),
      ),
    ]);

    const body = extractHeredocBody(
      conformanceDriftRecordScriptV1(),
      "CLOUDMARKUP_CONFORMANCE_DRIFT",
    );
    const result = executeNodeBody(
      body,
      {
        DEPLOYMENT_DIRECTORY: fixture.root,
        DEPLOYMENT_EVIDENCE_CHECKSUM: deploymentEvidenceChecksum,
      },
      fixture.root,
    );
    expect(result.status, result.stderr).toBe(0);
    const drift = JSON.parse(
      await readFile(
        join(fixture.root, "cloudmarkup-conformance.drift.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(drift).toMatchObject({
      baselineDeploymentEvidenceChecksum: deploymentEvidenceChecksum,
      issues: [
        {
          code: "CONFORMANCE_DRIFT_SCOPE_INCOMPLETE",
          field: "scope",
          severity: "warning",
        },
      ],
      scope: "partial",
      source: "terraform-refresh-only",
      target: "terraform",
    });
    expect(drift["baselineDeploymentEvidenceChecksum"]).not.toBe(
      deploymentReceiptDigest,
    );

    await unlink(join(fixture.root, "cloudmarkup-conformance.drift.json"));
    const substituted = executeNodeBody(
      body,
      {
        DEPLOYMENT_DIRECTORY: fixture.root,
        DEPLOYMENT_EVIDENCE_CHECKSUM: deploymentReceiptDigest,
      },
      fixture.root,
    );
    expect(substituted.status).not.toBe(0);
    expect(substituted.stderr).toContain(
      "The bounded conformance drift record could not be verified.",
    );
  });

  it("wires the verified deployment conformance checksum into the generated drift workflow", () => {
    const result = generateCustomerCiWorkflowSetV1(
      createCustomerCiWorkflowTestConfigV1(),
    );
    const drift =
      result.manifest.files.find(({ workflowKind }) => workflowKind === "drift")
        ?.content ?? "";

    expect(drift).toContain("DEPLOYMENT_EVIDENCE_CHECKSUM");
    expect(drift).toContain(
      "steps.deployment.outputs.conformance_evidence_checksum",
    );
    expect(drift).toContain("CONFORMANCE_DRIFT_SCOPE_INCOMPLETE");
    expect(drift).toContain(
      "CONFORMANCE_DEPLOYMENT_ARTIFACT_ATTESTATIONS_UNAVAILABLE",
    );
  });
});
