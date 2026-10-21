import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import type { CustomerCiWorkflowConfigV1 } from "./contracts.js";
import { generateCustomerCiWorkflowSetV1 } from "./generator.js";
import { canonicalJson, sha256 } from "./security.js";
import { createCustomerCiWorkflowTestConfigV1 } from "./testing.js";
import {
  deployReceiptScriptV1,
  predecessorReceiptInspectionScriptV1,
  predecessorSmokeReceiptInspectionScriptV1,
  promotionAdmissionScriptV1,
} from "./workflow-scripts.js";

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const DEPLOYMENT_RECEIPT_DIGEST = sha256("deployment-receipt");
const TARGET_AUTHORITY_DIGEST = sha256("target-authority");
const DEPLOYMENT_RUN_ID = "400200";
const SMOKE_RUN_ID = "400300";
const GITHUB_TOKEN_FIXTURE = ["runtime", "github", "credential"].join("-");
const REPOSITORY_ADMISSION_ERROR =
  "The reviewed private GitHub repository identity or visibility could not be confirmed.";
const PROMOTION_DEPLOYMENT_RECEIPT_DIGEST = sha256("promotion-deployment");
const PROMOTION_SMOKE_RECEIPT_DIGEST = sha256("promotion-smoke");
const PREDECESSOR_DEPLOYMENT_RUN_ID = "500100";

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map(async (root) => {
      await rm(root, { force: true, recursive: true });
    }),
  );
  temporaryRoots.clear();
});

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cloudmarkup-runtime-script-"));
  temporaryRoots.add(root);
  return root;
}

function extractHeredocBody(script: string, marker: string): string {
  const lines = script.split("\n");
  const opening = `node --input-type=module <<'${marker}'`;
  const start = lines.indexOf(opening);
  const end = lines.indexOf(marker, start + 1);
  if (start < 0 || end <= start) {
    throw new Error(`Missing generated ${marker} script body.`);
  }
  return lines.slice(start + 1, end).join("\n");
}

function executeNodeBody(
  body: string,
  env: Readonly<Record<string, string>>,
  cwd?: string,
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ["--input-type=module", "--eval", body], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
    timeout: 10_000,
  });
}

function smokeStepRun(
  config: CustomerCiWorkflowConfigV1,
  stepName: string,
): string {
  const result = generateCustomerCiWorkflowSetV1(config);
  const content = result.manifest.files.find(
    ({ workflowKind }) => workflowKind === "smoke",
  )?.content;
  if (content === undefined) {
    throw new Error("Missing generated smoke workflow fixture.");
  }
  const workflow = parseYaml(content) as {
    jobs: Record<string, { steps: { name: string; run?: string }[] }>;
  };
  const run = workflow.jobs["smoke"]?.steps.find(
    ({ name }) => name === stepName,
  )?.run;
  if (run === undefined) {
    throw new Error(`Missing generated smoke step: ${stepName}.`);
  }
  return run;
}

interface GeneratedWorkflowStep {
  readonly name: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly run?: string;
  readonly uses?: string;
}

function workflowJobSteps(
  config: CustomerCiWorkflowConfigV1,
  kind: "plan" | "deploy" | "smoke" | "drift",
): readonly GeneratedWorkflowStep[] {
  const result = generateCustomerCiWorkflowSetV1(config);
  const content = result.manifest.files.find(
    ({ workflowKind }) => workflowKind === kind,
  )?.content;
  if (content === undefined) {
    throw new Error(`Missing generated ${kind} workflow fixture.`);
  }
  const workflow = parseYaml(content) as {
    jobs: Record<string, { steps: GeneratedWorkflowStep[] }>;
  };
  const steps = workflow.jobs[kind]?.steps;
  if (steps === undefined) {
    throw new Error(`Missing generated ${kind} job fixture.`);
  }
  return steps;
}

function repositoryVisibilityAdmissionBody(
  config = createCustomerCiWorkflowTestConfigV1(),
): string {
  const step = workflowJobSteps(config, "plan").find(
    ({ name }) => name === "Confirm the reviewed repository is still private",
  );
  if (step?.run === undefined) {
    throw new Error("Missing generated repository visibility admission step.");
  }
  return extractHeredocBody(step.run, "CLOUDMARKUP_REPOSITORY_VISIBILITY");
}

interface RepositoryFetchScenario {
  readonly body?: Readonly<Record<string, unknown>>;
  readonly declaredLength?: number;
  readonly failure?: "network" | "timeout";
  readonly oversizedBody?: boolean;
  readonly redirected?: boolean;
  readonly responseUrl?: string;
}

function executeRepositoryVisibilityAdmission(
  scenario: RepositoryFetchScenario = {},
): SpawnSyncReturns<string> {
  const config = createCustomerCiWorkflowTestConfigV1();
  const canonicalResponse = {
    full_name: `${config.repository.owner}/${config.repository.name}`,
    id: Number(config.repository.oidcSubject.repositoryId),
    name: config.repository.name,
    owner: {
      id: Number(config.repository.oidcSubject.repositoryOwnerId),
      login: config.repository.owner,
    },
    private: true,
    visibility: "private",
  };
  const requestUrl = `https://api.github.com/repos/${config.repository.owner}/${config.repository.name}`;
  const fakeFetch = [
    `const fakeScenario = ${JSON.stringify(scenario)};`,
    `const fakeCanonicalResponse = ${JSON.stringify(canonicalResponse)};`,
    `const fakeRequestUrl = ${JSON.stringify(requestUrl)};`,
    "globalThis.fetch = async (url, options) => {",
    "  if (url !== fakeRequestUrl || options?.redirect !== 'error' || !(options.signal instanceof AbortSignal)) throw new Error('The generated fetch options are unsafe.');",
    "  if (options.headers?.Authorization !== `Bearer ${process.env.GITHUB_TOKEN}`) throw new Error('The generated authorization header is malformed.');",
    "  console.log('FAKE_FETCH_OPTIONS_OK');",
    "  if (fakeScenario.failure === 'network') throw new Error('simulated-network-failure');",
    "  if (fakeScenario.failure === 'timeout') throw new DOMException('simulated-timeout', 'TimeoutError');",
    "  const raw = fakeScenario.oversizedBody ? 'x'.repeat(262145) : JSON.stringify(fakeScenario.body ?? fakeCanonicalResponse);",
    "  return { headers: { get: (name) => name.toLowerCase() === 'content-length' ? String(fakeScenario.declaredLength ?? Buffer.byteLength(raw, 'utf8')) : null }, ok: true, redirected: fakeScenario.redirected ?? false, text: async () => raw, url: fakeScenario.responseUrl ?? fakeRequestUrl };",
    "};",
  ].join("\n");
  return executeNodeBody(
    `${fakeFetch}\n${repositoryVisibilityAdmissionBody(config)}`,
    { GITHUB_TOKEN: GITHUB_TOKEN_FIXTURE },
  );
}

function expectGenericRepositoryRejection(
  result: SpawnSyncReturns<string>,
): void {
  const output = `${result.stdout}\n${result.stderr}`;
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain("FAKE_FETCH_OPTIONS_OK");
  expect(result.stderr).toContain(REPOSITORY_ADMISSION_ERROR);
  expect(output).not.toContain(GITHUB_TOKEN_FIXTURE);
  expect(output).not.toContain("simulated-network-failure");
  expect(output).not.toContain("simulated-timeout");
}

function configWithReviewedDevUrl(raw: string): CustomerCiWorkflowConfigV1 {
  const config = createCustomerCiWorkflowTestConfigV1();
  return {
    ...config,
    environments: config.environments.map((environment) =>
      environment.id === "dev"
        ? { ...environment, smokeBaseUrlDigest: sha256(raw) }
        : environment,
    ),
  };
}

interface SmokeDnsScenario {
  readonly ipv4?: readonly string[];
  readonly ipv4Error?: "ENODATA" | "ENOTFOUND" | "ETIMEOUT";
  readonly ipv6?: readonly string[];
  readonly ipv6Error?: "ENODATA" | "ENOTFOUND" | "ETIMEOUT";
}

async function executeSmokeAdmission(
  raw: string,
  config = createCustomerCiWorkflowTestConfigV1(),
  dns: SmokeDnsScenario = { ipv4: ["93.184.216.34"], ipv6: [] },
): Promise<
  Readonly<{
    resolveEntry: string | undefined;
    result: SpawnSyncReturns<string>;
  }>
> {
  const run = smokeStepRun(
    config,
    "Probe only the approved HTTPS health endpoint",
  );
  expect(run.indexOf("CLOUDMARKUP_ENDPOINT\n")).toBeLessThan(
    run.indexOf("curl --disable --silent"),
  );
  const root = await createTemporaryRoot();
  const resolveFile = join(root, "smoke-resolve");
  const resolverFake = [
    `const fakeDns = ${JSON.stringify(dns)};`,
    "class Resolver {",
    "  cancel() {}",
    "  async resolve4() { if (fakeDns.ipv4Error) { const error = new Error('fake-dns-failure'); error.code = fakeDns.ipv4Error; throw error; } return fakeDns.ipv4 ?? []; }",
    "  async resolve6() { if (fakeDns.ipv6Error) { const error = new Error('fake-dns-failure'); error.code = fakeDns.ipv6Error; throw error; } return fakeDns.ipv6 ?? []; }",
    "}",
  ].join("\n");
  const body = extractHeredocBody(run, "CLOUDMARKUP_ENDPOINT").replace(
    "import { Resolver } from 'node:dns/promises';",
    resolverFake,
  );
  expect(body).not.toContain("node:dns/promises");
  const result = executeNodeBody(
    body,
    {
      CLOUDMARKUP_ENVIRONMENT: "dev",
      CLOUDMARKUP_SMOKE_BASE_URL: raw,
      CLOUDMARKUP_SMOKE_RESOLVE_FILE: resolveFile,
      RUNNER_TEMP: root,
    },
    root,
  );
  let resolveEntry: string | undefined;
  try {
    resolveEntry = await readFile(resolveFile, "utf8");
  } catch {
    resolveEntry = undefined;
  }
  return { resolveEntry, result };
}

function workflowCommitAdmissionBody(
  kind: "plan" | "deploy" | "smoke" | "drift",
): string {
  const step = workflowJobSteps(
    createCustomerCiWorkflowTestConfigV1(),
    kind,
  ).find(
    ({ name }) =>
      name === "Bind this workflow and run to the exact reviewed commit",
  );
  if (step?.run === undefined) {
    throw new Error(
      `Missing generated ${kind} workflow-commit admission step.`,
    );
  }
  expect(step.env).toEqual({
    CLOUDMARKUP_EXPECTED_EXECUTION_COMMIT:
      kind === "plan"
        ? "${{ github.sha }}"
        : kind === "deploy"
          ? "${{ inputs.expected_commit }}"
          : "${{ vars.CLOUDMARKUP_DEPLOYED_COMMIT }}",
    CLOUDMARKUP_EXECUTION_RUN_SHA: "${{ github.sha }}",
    CLOUDMARKUP_EXECUTION_WORKFLOW_SHA: "${{ github.workflow_sha }}",
  });
  return extractHeredocBody(step.run, "CLOUDMARKUP_WORKFLOW_COMMIT");
}

async function executePromotion(
  environment: "dev" | "staging" | "production",
  overrides: Readonly<Record<string, string>> = {},
): Promise<Readonly<{ output: string; result: SpawnSyncReturns<string> }>> {
  const root = await createTemporaryRoot();
  const output = join(root, "github-output.txt");
  const result = executeNodeBody(
    extractHeredocBody(promotionAdmissionScriptV1(), "CLOUDMARKUP_PROMOTION"),
    {
      CLOUDMARKUP_ENVIRONMENT: environment,
      GITHUB_OUTPUT: output,
      PREDECESSOR_RECEIPT_DIGEST: "",
      PREDECESSOR_RUN_ID: "",
      PREDECESSOR_SMOKE_RECEIPT_DIGEST: "",
      PREDECESSOR_SMOKE_RUN_ID: "",
      RUNNER_TEMP: root,
      ...overrides,
    },
  );
  let outputValue = "";
  try {
    outputValue = await readFile(output, "utf8");
  } catch {
    // A rejected admission is not allowed to create an output file.
  }
  return { output: outputValue, result };
}

interface SmokeArtifactFixture {
  readonly artifactDirectory: string;
  readonly config: CustomerCiWorkflowConfigV1;
  readonly root: string;
}

async function createGeneratedSmokeArtifacts(
  outcome: "success" | "failure" = "success",
): Promise<SmokeArtifactFixture> {
  const config = createCustomerCiWorkflowTestConfigV1();
  const root = await createTemporaryRoot();
  const artifactDirectory = join(root, "predecessor-smoke");
  await mkdir(artifactDirectory);
  const deploymentDirectory = join(root, "deployment");
  await mkdir(deploymentDirectory);
  await writeFile(
    join(deploymentDirectory, "cloudmarkup-deployment.receipt.json"),
    "deployment-receipt",
    "utf8",
  );
  const deploymentProjection = {
    artifactAttestations: [],
    commitSha: COMMIT_SHA,
    completeness: "partial",
    contractVersion: 1,
    environmentId: "dev",
    generatedManifestDigest: sha256("generated-manifest"),
    issues: [
      {
        code: "CONFORMANCE_DEPLOYMENT_SMOKE_MISSING",
        field: "smoke",
        severity: "warning",
      },
    ],
    kind: "cloudmarkup.normalized-deployment-conformance",
    observedAt: "2026-08-29T12:00:00.000Z",
    planEvidenceChecksum: sha256("plan-evidence"),
    planIdentityDigest: sha256("plan-identity"),
    smoke: { state: "not-run" },
    solutionRevision: config.solutionRevision,
    target: "terraform",
    workflow: {
      runAttempt: 1,
      runId: DEPLOYMENT_RUN_ID,
      workflowDigest: sha256("deployment-workflow"),
    },
  } as const;
  await writeFile(
    join(deploymentDirectory, "cloudmarkup-conformance.deployment.json"),
    `${canonicalJson({ ...deploymentProjection, evidenceChecksum: sha256(canonicalJson(deploymentProjection)) })}\n`,
    "utf8",
  );
  const producerRun = smokeStepRun(
    config,
    "Record sanitized smoke result, stage receipt, and Evidence",
  );
  const produced = executeNodeBody(
    extractHeredocBody(producerRun, "CLOUDMARKUP_SMOKE_RESULT"),
    {
      DEPLOYMENT_DIRECTORY: deploymentDirectory,
      CLOUDMARKUP_ENVIRONMENT: "dev",
      DEPLOYED_COMMIT: COMMIT_SHA,
      DEPLOYED_REVISION_DIGEST: config.solutionRevision.digest,
      DEPLOYED_REVISION_ID: config.solutionRevision.id,
      DEPLOYMENT_RECEIPT_DIGEST,
      DEPLOYMENT_RUN_ID,
      GITHUB_REPOSITORY: `${config.repository.owner}/${config.repository.name}`,
      GITHUB_RUN_ID: SMOKE_RUN_ID,
      SMOKE_OUTCOME: outcome,
      SMOKE_TARGET_MODE: "read-only",
      TARGET_AUTHORITY_DIGEST,
    },
    artifactDirectory,
  );
  if (produced.status !== 0) {
    throw new Error(
      `Could not create generated smoke fixture: ${produced.stderr}`,
    );
  }
  return { artifactDirectory, config, root };
}

async function executePredecessorSmokeInspection(
  fixture: SmokeArtifactFixture,
  overrides: Readonly<Record<string, string>> = {},
): Promise<SpawnSyncReturns<string>> {
  const receiptBytes = await readFile(
    join(fixture.artifactDirectory, "cloudmarkup-smoke.receipt.json"),
  );
  return executeNodeBody(
    extractHeredocBody(
      predecessorSmokeReceiptInspectionScriptV1(fixture.config),
      "CLOUDMARKUP_PREDECESSOR_SMOKE",
    ),
    {
      EXPECTED_COMMIT: COMMIT_SHA,
      EXPECTED_REVISION_DIGEST: fixture.config.solutionRevision.digest,
      EXPECTED_REVISION_ID: fixture.config.solutionRevision.id,
      GITHUB_OUTPUT: join(fixture.root, "inspection-output.txt"),
      PREDECESSOR_ENVIRONMENT: "dev",
      PREDECESSOR_RECEIPT_DIGEST: DEPLOYMENT_RECEIPT_DIGEST,
      PREDECESSOR_RUN_ID: DEPLOYMENT_RUN_ID,
      PREDECESSOR_SMOKE_DIRECTORY: fixture.artifactDirectory,
      PREDECESSOR_SMOKE_RECEIPT_DIGEST: sha256(receiptBytes),
      PREDECESSOR_SMOKE_RUN_ID: SMOKE_RUN_ID,
      PREDECESSOR_TARGET_AUTHORITY_DIGEST: TARGET_AUTHORITY_DIGEST,
      RUNNER_TEMP: fixture.root,
      ...overrides,
    },
  );
}

interface DeploymentArtifactFixture {
  readonly artifactDirectory: string;
  readonly config: CustomerCiWorkflowConfigV1;
  readonly environment: "dev" | "staging";
  readonly root: string;
}

async function createGeneratedDeploymentArtifact(
  environment: "dev" | "staging",
): Promise<DeploymentArtifactFixture> {
  const config = createCustomerCiWorkflowTestConfigV1();
  const root = await createTemporaryRoot();
  const artifactDirectory = join(root, "predecessor-deployment");
  const savedPlanDirectory = join(root, "saved-plan");
  await mkdir(artifactDirectory);
  await mkdir(savedPlanDirectory);
  const planChecksum = sha256(`plan-${environment}`);
  await writeFile(
    join(savedPlanDirectory, "cloudmarkup-plan.manifest.json"),
    `${JSON.stringify({
      commitSha: COMMIT_SHA,
      environment,
      environmentConfigDigest: sha256(`target-${environment}`),
      planChecksum,
      solutionRevision: config.solutionRevision,
    })}\n`,
    "utf8",
  );
  await writeFile(
    join(savedPlanDirectory, "cloudmarkup-plan.receipt.json"),
    `${JSON.stringify({ kind: "canonical-plan-receipt" })}\n`,
    "utf8",
  );
  const produced = executeNodeBody(
    extractHeredocBody(deployReceiptScriptV1(), "CLOUDMARKUP_DEPLOY_RECEIPT"),
    {
      GITHUB_RUN_ID: PREDECESSOR_DEPLOYMENT_RUN_ID,
      PREDECESSOR_RECEIPT_DIGEST:
        environment === "dev" ? "" : PROMOTION_DEPLOYMENT_RECEIPT_DIGEST,
      PROMOTION_PREDECESSOR_SMOKE_RECEIPT_DIGEST:
        environment === "dev" ? "" : PROMOTION_SMOKE_RECEIPT_DIGEST,
      SAVED_PLAN_DIRECTORY: savedPlanDirectory,
    },
    artifactDirectory,
  );
  if (produced.status !== 0) {
    throw new Error(
      `Could not create generated deployment fixture: ${produced.stderr}`,
    );
  }
  await writeFile(
    join(artifactDirectory, "cloudmarkup-conformance.deployment.json"),
    "{}\n",
    "utf8",
  );
  return { artifactDirectory, config, environment, root };
}

async function executePredecessorDeploymentInspection(
  fixture: DeploymentArtifactFixture,
): Promise<SpawnSyncReturns<string>> {
  const receiptBytes = await readFile(
    join(fixture.artifactDirectory, "cloudmarkup-deployment.receipt.json"),
  );
  return executeNodeBody(
    extractHeredocBody(
      predecessorReceiptInspectionScriptV1(fixture.config),
      "CLOUDMARKUP_PREDECESSOR_RECEIPT",
    ),
    {
      EXPECTED_COMMIT: COMMIT_SHA,
      EXPECTED_REVISION_DIGEST: fixture.config.solutionRevision.digest,
      EXPECTED_REVISION_ID: fixture.config.solutionRevision.id,
      GITHUB_OUTPUT: join(fixture.root, "deployment-inspection-output.txt"),
      PREDECESSOR_DIRECTORY: fixture.artifactDirectory,
      PREDECESSOR_ENVIRONMENT: fixture.environment,
      PREDECESSOR_RECEIPT_DIGEST: sha256(receiptBytes),
      PREDECESSOR_RUN_ID: PREDECESSOR_DEPLOYMENT_RUN_ID,
      RUNNER_TEMP: fixture.root,
    },
  );
}

async function mutateJsonFile(
  path: string,
  mutate: (value: Record<string, unknown>) => void,
): Promise<void> {
  const value = JSON.parse(await readFile(path, "utf8")) as Record<
    string,
    unknown
  >;
  mutate(value);
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

describe("generated smoke endpoint admission", () => {
  it("accepts and pins the exact reviewed development URL", async () => {
    const { resolveEntry, result } = await executeSmokeAdmission(
      "https://dev.example.test",
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "The exact reviewed public HTTPS smoke target passed admission.",
    );
    expect(resolveEntry).toBe("dev.example.test:443:93.184.216.34\n");
  });

  it("rejects a changed URL even when it otherwise uses public HTTPS", async () => {
    const { result } = await executeSmokeAdmission(
      "https://changed.example.test",
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "The smoke target does not match the reviewed environment configuration.",
    );
  });

  const credentialUrl = new URL("https://dev.example.test");
  credentialUrl.username = "review-user";
  credentialUrl.password = "review-password";

  it.each([
    ["localhost", "https://localhost"],
    ["private host", "https://service.internal"],
    ["private IPv4 literal", "https://10.0.0.1"],
    ["non-443 port", "https://dev.example.test:8443"],
    ["URL credentials", credentialUrl.toString()],
    ["query", "https://dev.example.test?opaque=value"],
    ["fragment", "https://dev.example.test#fragment"],
  ])("rejects an independently reviewed %s candidate", async (_label, raw) => {
    const { result } = await executeSmokeAdmission(
      raw,
      configWithReviewedDevUrl(raw),
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "The approved smoke base URL must use public DNS over HTTPS port 443 with no credentials, query, or fragment.",
    );
  });

  it.each([
    ["unspecified IPv4", { ipv4: ["0.0.0.1"] }],
    ["private IPv4", { ipv4: ["10.2.3.4"] }],
    ["carrier-grade NAT IPv4", { ipv4: ["100.64.0.1"] }],
    ["loopback IPv4", { ipv4: ["127.0.0.1"] }],
    ["link-local IPv4", { ipv4: ["169.254.169.254"] }],
    ["private 172 IPv4", { ipv4: ["172.16.0.1"] }],
    ["protocol-assignment IPv4", { ipv4: ["192.0.0.9"] }],
    ["documentation IPv4", { ipv4: ["192.0.2.1"] }],
    ["deprecated relay IPv4", { ipv4: ["192.88.99.1"] }],
    ["private 192 IPv4", { ipv4: ["192.168.0.1"] }],
    ["benchmark IPv4", { ipv4: ["198.18.0.1"] }],
    ["documentation 198 IPv4", { ipv4: ["198.51.100.1"] }],
    ["documentation 203 IPv4", { ipv4: ["203.0.113.1"] }],
    ["multicast IPv4", { ipv4: ["224.0.0.1"] }],
    ["loopback IPv6", { ipv6: ["::1"] }],
    ["unique-local IPv6", { ipv6: ["fd00::1"] }],
    ["link-local IPv6", { ipv6: ["fe80::1"] }],
    ["IETF-special IPv6", { ipv6: ["2001::1"] }],
    ["documentation IPv6", { ipv6: ["2001:db8::1"] }],
    ["6to4 IPv6", { ipv6: ["2002:c000:0201::"] }],
    ["retired 6bone IPv6", { ipv6: ["3ffe::1"] }],
    ["documentation 3fff IPv6", { ipv6: ["3fff::1"] }],
  ] satisfies readonly (readonly [string, SmokeDnsScenario])[])(
    "rejects a reviewed hostname resolving to %s",
    async (_label, dns) => {
      const { resolveEntry, result } = await executeSmokeAdmission(
        "https://dev.example.test",
        createCustomerCiWorkflowTestConfigV1(),
        dns,
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "The approved smoke hostname did not resolve exclusively to global addresses.",
      );
      expect(resolveEntry).toBeUndefined();
    },
  );

  it("rejects mixed global and retired 6bone IPv6 answers without writing a resolve pin", async () => {
    const { resolveEntry, result } = await executeSmokeAdmission(
      "https://dev.example.test",
      createCustomerCiWorkflowTestConfigV1(),
      { ipv6: ["2606:4700:4700::1111", "3ffe::1"] },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "The approved smoke hostname did not resolve exclusively to global addresses.",
    );
    expect(resolveEntry).toBeUndefined();
  });

  it("rejects a mixed global and private DNS answer", async () => {
    const { result } = await executeSmokeAdmission(
      "https://dev.example.test",
      createCustomerCiWorkflowTestConfigV1(),
      { ipv4: ["93.184.216.34", "127.0.0.1"] },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "The approved smoke hostname did not resolve exclusively to global addresses.",
    );
  });

  it("pins a valid IPv6 address using curl's bracketed resolve form", async () => {
    const { resolveEntry, result } = await executeSmokeAdmission(
      "https://dev.example.test",
      createCustomerCiWorkflowTestConfigV1(),
      { ipv6: ["2606:4700:4700::1111"] },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(resolveEntry).toBe("dev.example.test:443:[2606:4700:4700::1111]\n");
  });

  it("fails closed on an unexpected DNS resolver error", async () => {
    const { result } = await executeSmokeAdmission(
      "https://dev.example.test",
      createCustomerCiWorkflowTestConfigV1(),
      { ipv4Error: "ETIMEOUT", ipv6: [] },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "The approved smoke hostname did not resolve exclusively to global addresses.",
    );
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(
      "fake-dns-failure",
    );
  });
});

describe("generated workflow revision admission", () => {
  it.each(["plan", "deploy", "smoke", "drift"] as const)(
    "binds the %s workflow and run SHA to the exact expected commit",
    (kind) => {
      const body = workflowCommitAdmissionBody(kind);
      const exact = executeNodeBody(body, {
        CLOUDMARKUP_EXPECTED_EXECUTION_COMMIT: COMMIT_SHA,
        CLOUDMARKUP_EXECUTION_RUN_SHA: COMMIT_SHA,
        CLOUDMARKUP_EXECUTION_WORKFLOW_SHA: COMMIT_SHA,
      });
      expect(exact.status, exact.stderr).toBe(0);

      for (const field of [
        "CLOUDMARKUP_EXECUTION_RUN_SHA",
        "CLOUDMARKUP_EXECUTION_WORKFLOW_SHA",
      ] as const) {
        const changed = executeNodeBody(body, {
          CLOUDMARKUP_EXPECTED_EXECUTION_COMMIT: COMMIT_SHA,
          CLOUDMARKUP_EXECUTION_RUN_SHA: COMMIT_SHA,
          CLOUDMARKUP_EXECUTION_WORKFLOW_SHA: COMMIT_SHA,
          [field]: "abcdef0123456789abcdef0123456789abcdef01",
        });
        expect(changed.status).not.toBe(0);
        expect(changed.stderr).toContain(
          "The executing workflow revision and run commit must exactly match the reviewed plan or deployment commit.",
        );
      }
    },
  );
});

describe("generated private-repository admission", () => {
  it("accepts the exact private repository and immutable owner identities", () => {
    const result = executeRepositoryVisibilityAdmission();
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("FAKE_FETCH_OPTIONS_OK");
    expect(result.stdout).toContain(
      "The exact reviewed GitHub repository is still private.",
    );
    expect(output).not.toContain(GITHUB_TOKEN_FIXTURE);
  });

  const config = createCustomerCiWorkflowTestConfigV1();
  const canonical = {
    full_name: `${config.repository.owner}/${config.repository.name}`,
    id: Number(config.repository.oidcSubject.repositoryId),
    name: config.repository.name,
    owner: {
      id: Number(config.repository.oidcSubject.repositoryOwnerId),
      login: config.repository.owner,
    },
    private: true,
    visibility: "private",
  };

  it.each([
    [
      "public visibility",
      { body: { ...canonical, private: false, visibility: "public" } },
    ],
    ["changed repository ID", { body: { ...canonical, id: canonical.id + 1 } }],
    [
      "changed owner login",
      {
        body: {
          ...canonical,
          owner: { ...canonical.owner, login: "changed-owner" },
        },
      },
    ],
    [
      "changed owner ID",
      {
        body: {
          ...canonical,
          owner: { ...canonical.owner, id: canonical.owner.id + 1 },
        },
      },
    ],
    [
      "changed full name",
      { body: { ...canonical, full_name: "changed/repository" } },
    ],
    ["redirect", { redirected: true }],
    [
      "response URL rewrite",
      { responseUrl: "https://api.github.test/rewritten" },
    ],
    ["oversized declared response", { declaredLength: 262145 }],
    ["oversized actual response", { oversizedBody: true }],
    ["network failure", { failure: "network" }],
    ["timeout", { failure: "timeout" }],
  ] satisfies readonly (readonly [string, RepositoryFetchScenario])[])(
    "rejects %s with only the generic failure",
    (_label, scenario) => {
      expectGenericRepositoryRejection(
        executeRepositoryVisibilityAdmission(scenario),
      );
    },
  );

  it("runs before OIDC or any artifact download in every credentialed workflow", () => {
    const generatedConfig = createCustomerCiWorkflowTestConfigV1();
    for (const kind of ["plan", "deploy", "smoke", "drift"] as const) {
      const steps = workflowJobSteps(generatedConfig, kind);
      const admissionIndex = steps.findIndex(
        ({ name }) =>
          name === "Confirm the reviewed repository is still private",
      );
      const guardedIndexes = steps
        .map((step, index) => ({ index, step }))
        .filter(
          ({ step }) =>
            step.name.includes("OIDC") ||
            step.name.startsWith("Download ") ||
            step.uses?.startsWith("actions/download-artifact@") === true ||
            step.uses?.startsWith("aws-actions/configure-aws-credentials@") ===
              true,
        )
        .map(({ index }) => index);

      expect(
        admissionIndex,
        `${kind} is missing repository admission`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        guardedIndexes.length,
        `${kind} has no guarded step`,
      ).toBeGreaterThan(0);
      expect(
        guardedIndexes.every((index) => admissionIndex < index),
        `${kind} repository admission must precede OIDC and downloads`,
      ).toBe(true);
    }
  });
});

describe("generated deployment promotion admission", () => {
  const validPair = {
    PREDECESSOR_RECEIPT_DIGEST: sha256("predecessor-deployment-receipt"),
    PREDECESSOR_RUN_ID: "500100",
    PREDECESSOR_SMOKE_RECEIPT_DIGEST: sha256("predecessor-smoke-receipt"),
    PREDECESSOR_SMOKE_RUN_ID: "500200",
  };

  it("accepts dev only when every predecessor input is absent", async () => {
    const accepted = await executePromotion("dev");

    expect(accepted.result.status, accepted.result.stderr).toBe(0);
    expect(accepted.output).toBe("");
  });

  it.each([
    ["deployment run", { PREDECESSOR_RUN_ID: validPair.PREDECESSOR_RUN_ID }],
    [
      "deployment receipt",
      { PREDECESSOR_RECEIPT_DIGEST: validPair.PREDECESSOR_RECEIPT_DIGEST },
    ],
    [
      "smoke run",
      { PREDECESSOR_SMOKE_RUN_ID: validPair.PREDECESSOR_SMOKE_RUN_ID },
    ],
    [
      "smoke receipt",
      {
        PREDECESSOR_SMOKE_RECEIPT_DIGEST:
          validPair.PREDECESSOR_SMOKE_RECEIPT_DIGEST,
      },
    ],
  ])("rejects dev with a predecessor %s input", async (_label, inputs) => {
    const rejected = await executePromotion("dev", inputs);

    expect(rejected.result.status).not.toBe(0);
    expect(rejected.result.stderr).toContain(
      "The deployment promotion predecessor inputs are invalid.",
    );
    expect(rejected.output).toBe("");
  });

  it.each([
    ["staging", "dev"],
    ["production", "staging"],
  ] as const)(
    "requires and accepts exact deployment and smoke pairs for %s",
    async (environment, predecessorEnvironment) => {
      const missingAll = await executePromotion(environment);
      const missingSmoke = await executePromotion(environment, {
        PREDECESSOR_RECEIPT_DIGEST: validPair.PREDECESSOR_RECEIPT_DIGEST,
        PREDECESSOR_RUN_ID: validPair.PREDECESSOR_RUN_ID,
      });
      const missingDeployment = await executePromotion(environment, {
        PREDECESSOR_SMOKE_RECEIPT_DIGEST:
          validPair.PREDECESSOR_SMOKE_RECEIPT_DIGEST,
        PREDECESSOR_SMOKE_RUN_ID: validPair.PREDECESSOR_SMOKE_RUN_ID,
      });
      const malformed = await executePromotion(environment, {
        ...validPair,
        PREDECESSOR_SMOKE_RECEIPT_DIGEST: "sha256:not-a-digest",
      });
      const accepted = await executePromotion(environment, validPair);

      for (const rejected of [
        missingAll,
        missingSmoke,
        missingDeployment,
        malformed,
      ]) {
        expect(rejected.result.status).not.toBe(0);
        expect(rejected.output).toBe("");
      }
      expect(accepted.result.status, accepted.result.stderr).toBe(0);
      expect(accepted.output).toBe(
        `predecessor_environment=${predecessorEnvironment}\n`,
      );
    },
  );
});

describe("generated predecessor deployment artifact inspection", () => {
  it.each(["dev", "staging"] as const)(
    "accepts an exact canonical %s deployment receipt",
    async (environment) => {
      const fixture = await createGeneratedDeploymentArtifact(environment);

      const result = await executePredecessorDeploymentInspection(fixture);

      expect(result.status, result.stderr).toBe(0);
    },
  );

  it.each(["remove", "swap", "substitute"] as const)(
    "rejects a staging receipt whose promotion input digests %s canonical positions even with a recomputed receipt digest",
    async (mutation) => {
      const fixture = await createGeneratedDeploymentArtifact("staging");
      await mutateJsonFile(
        join(fixture.artifactDirectory, "cloudmarkup-deployment.receipt.json"),
        (receipt) => {
          const inputDigests = receipt["inputDigests"] as string[];
          const deploymentDigest = inputDigests[3];
          const smokeDigest = inputDigests[4];
          if (deploymentDigest === undefined || smokeDigest === undefined) {
            throw new Error("Generated promotion inputs are incomplete.");
          }
          if (mutation === "remove") {
            inputDigests.splice(4, 1);
          } else if (mutation === "swap") {
            inputDigests[3] = smokeDigest;
            inputDigests[4] = deploymentDigest;
          } else {
            inputDigests[3] = sha256("substituted-promotion-deployment");
          }
        },
      );

      const result = await executePredecessorDeploymentInspection(fixture);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "The predecessor deployment receipt failed exact promotion validation.",
      );
    },
  );
});

describe("generated predecessor smoke artifact inspection", () => {
  it("accepts the exact canonical passing artifacts emitted by the smoke workflow", async () => {
    const fixture = await createGeneratedSmokeArtifacts();

    const result = await executePredecessorSmokeInspection(fixture);

    expect(result.status, result.stderr).toBe(0);
    const output = await readFile(
      join(fixture.root, "inspection-output.txt"),
      "utf8",
    );
    expect(output).toMatch(/^receipt_digest=sha256:[a-f0-9]{64}\n$/);
  });

  it("rejects an internally generated failed smoke result", async () => {
    const fixture = await createGeneratedSmokeArtifacts("failure");

    const result = await executePredecessorSmokeInspection(fixture);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "The predecessor smoke receipt failed exact promotion validation.",
    );
  });

  it.each([
    "cloudmarkup-smoke.result.json",
    "cloudmarkup-smoke.receipt.json",
    "cloudmarkup-smoke.evidence.json",
    "cloudmarkup-conformance.deployment.smoke.json",
  ])("rejects tampering with %s", async (name) => {
    const fixture = await createGeneratedSmokeArtifacts();
    const path = join(fixture.artifactDirectory, name);
    await mutateJsonFile(path, (value) => {
      if (name === "cloudmarkup-smoke.result.json") {
        value["deployedCommit"] = "ffffffffffffffffffffffffffffffffffffffff";
      } else if (name === "cloudmarkup-smoke.receipt.json") {
        value["receiptId"] = "receipt-smoke-tampered-dev";
      } else if (name === "cloudmarkup-smoke.evidence.json") {
        const checks = value["checks"] as Record<string, unknown>[];
        const firstCheck = checks[0];
        if (firstCheck === undefined) {
          throw new Error("Generated smoke Evidence has no checks.");
        }
        checks[0] = { ...firstCheck, summary: "tampered" };
      } else {
        const smoke = value["smoke"] as Record<string, unknown>;
        smoke["evidenceDigest"] = sha256("tampered-smoke-evidence");
      }
    });

    const result = await executePredecessorSmokeInspection(fixture);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "The predecessor smoke receipt failed exact promotion validation.",
    );
  });

  it("rejects a target-authority digest different from the deployment receipt binding", async () => {
    const fixture = await createGeneratedSmokeArtifacts();

    const result = await executePredecessorSmokeInspection(fixture, {
      PREDECESSOR_TARGET_AUTHORITY_DIGEST: sha256("different-target-authority"),
    });

    expect(result.status).not.toBe(0);
  });

  it.each(["cloudmarkup-smoke.receipt.json"])(
    "rejects a missing required artifact: %s",
    async (name) => {
      const fixture = await createGeneratedSmokeArtifacts();
      await unlink(join(fixture.artifactDirectory, name));

      if (name === "cloudmarkup-smoke.receipt.json") {
        const result = executeNodeBody(
          extractHeredocBody(
            predecessorSmokeReceiptInspectionScriptV1(fixture.config),
            "CLOUDMARKUP_PREDECESSOR_SMOKE",
          ),
          {
            EXPECTED_COMMIT: COMMIT_SHA,
            EXPECTED_REVISION_DIGEST: fixture.config.solutionRevision.digest,
            EXPECTED_REVISION_ID: fixture.config.solutionRevision.id,
            GITHUB_OUTPUT: join(fixture.root, "inspection-output.txt"),
            PREDECESSOR_ENVIRONMENT: "dev",
            PREDECESSOR_RECEIPT_DIGEST: DEPLOYMENT_RECEIPT_DIGEST,
            PREDECESSOR_RUN_ID: DEPLOYMENT_RUN_ID,
            PREDECESSOR_SMOKE_DIRECTORY: fixture.artifactDirectory,
            PREDECESSOR_SMOKE_RECEIPT_DIGEST: sha256("missing-receipt"),
            PREDECESSOR_SMOKE_RUN_ID: SMOKE_RUN_ID,
            PREDECESSOR_TARGET_AUTHORITY_DIGEST: TARGET_AUTHORITY_DIGEST,
            RUNNER_TEMP: fixture.root,
          },
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
          "The predecessor smoke receipt failed exact promotion validation.",
        );
        return;
      }

      const result = await executePredecessorSmokeInspection(fixture);
      expect(result.status).not.toBe(0);
    },
  );

  it("rejects an extra artifact", async () => {
    const fixture = await createGeneratedSmokeArtifacts();
    await writeFile(
      join(fixture.artifactDirectory, "unexpected.json"),
      "{}\n",
      "utf8",
    );

    const result = await executePredecessorSmokeInspection(fixture);

    expect(result.status).not.toBe(0);
  });

  it("rejects an oversized artifact before parsing it", async () => {
    const fixture = await createGeneratedSmokeArtifacts();
    await writeFile(
      join(fixture.artifactDirectory, "cloudmarkup-smoke.evidence.json"),
      Buffer.alloc(8 * 1024 * 1024 + 1, 0x20),
    );

    const result = await executePredecessorSmokeInspection(fixture);

    expect(result.status).not.toBe(0);
  });

  it.skipIf(process.platform === "win32")(
    "rejects a symlinked artifact",
    async () => {
      const fixture = await createGeneratedSmokeArtifacts();
      const target = join(fixture.root, "outside-evidence.json");
      const artifact = join(
        fixture.artifactDirectory,
        "cloudmarkup-smoke.evidence.json",
      );
      await writeFile(target, await readFile(artifact));
      await unlink(artifact);
      await symlink(target, artifact, "file");

      const result = await executePredecessorSmokeInspection(fixture);

      expect(result.status).not.toBe(0);
    },
  );
});
