import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { parse } from "yaml";

export const BETA_DEPLOYMENT_WORKFLOW_PATH =
  ".github/workflows/deploy-development.yml";

const reviewedTestCompilerBuild =
  'set -euo pipefail\ngo -C services/iac-compiler build -trimpath -o "$RUNNER_TEMP/cloudmarkup-test-compiler" ./cmd/cloudmarkup-iac\nnode scripts/verify-test-compiler.mjs "$RUNNER_TEMP/cloudmarkup-test-compiler"\ncompiler_sha="$(sha256sum "$RUNNER_TEMP/cloudmarkup-test-compiler" | cut -d \' \' -f 1)"\nprintf \'CLOUDMARKUP_TEST_COMPILER_EXECUTABLE=%s\\n\' "$RUNNER_TEMP/cloudmarkup-test-compiler" >> "$GITHUB_ENV"\nprintf \'CLOUDMARKUP_TEST_COMPILER_SHA256=%s\\n\' "$compiler_sha" >> "$GITHUB_ENV"\n';

const historicalCheckoutName =
  "Check out the exact historical AI receipt source";
const historicalPrepareName = "Prepare the closed historical AI receipt bundle";
const historicalPrepareBaseCommand = "pnpm test:legacy-ai:prepare";
const historicalPrepareCommand =
  historicalPrepareBaseCommand + " --fetch-dependencies";
const historicalSourcePath = ".cache/legacy-ai-a979e325";
const historicalSourceCommit = "a979e325b6584642d5d5a9b58631bd3599d85591";
const historicalCheckoutAction =
  "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd";
function exactHistoricalKeys(value, keys) {
  return (
    JSON.stringify(Object.keys(record(value)).sort()) ===
    JSON.stringify([...keys].sort())
  );
}
/** A test-only contents checkout. No provider/role authority, runtime module or
 * deployment artifact is obtained from this historical source. */
export function assertHistoricalAiReceiptPreparation(document, jobName) {
  const jobs = record(document.jobs),
    job = record(jobs[jobName]);
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const checkoutSteps = steps.filter((step) =>
    String(record(step).uses ?? "").startsWith("actions/checkout@"),
  );
  const sources = steps.filter(
    (step) => record(step).name === historicalCheckoutName,
  );
  const preparations = steps.filter(
    (step) => record(step).name === historicalPrepareName,
  );
  const installs = steps.filter(
    (step) => record(step).run === "pnpm install --frozen-lockfile",
  );
  const compilers = steps.filter(
    (step) => record(step).run === reviewedTestCompilerBuild,
  );
  const source = record(sources[0]),
    preparation = record(preparations[0]);
  const options = record(source.with),
    initial = record(checkoutSteps[0]);
  const checkoutIndex = steps.indexOf(sources[0]),
    prepIndex = steps.indexOf(preparations[0]);
  const allowedOptions = {
    ref: historicalSourceCommit,
    path: historicalSourcePath,
    "persist-credentials": false,
    "fetch-depth": 1,
    submodules: false,
    lfs: false,
  };
  const decisionSteps = steps.filter(
    (step) => record(step).id === "historical",
  );
  const decision = record(decisionSteps[0]);
  const condition =
    "$" + "{{ steps.historical.outputs.historical-required == 'true' }}";
  const decisionRun =
    "node scripts/ci-historical-preparation.mjs " +
    "$" +
    "{{ matrix.shard }}/8";
  if (jobName === "quality") {
    if (
      sources.length !== 0 ||
      preparations.length !== 0 ||
      decisionSteps.length !== 0 ||
      checkoutSteps.length !== 1 ||
      installs.length !== 1 ||
      compilers.length !== 1 ||
      initial.uses !== historicalCheckoutAction ||
      !exactHistoricalKeys(initial, ["name", "uses", "with"]) ||
      !exactHistoricalKeys(initial.with, ["persist-credentials"]) ||
      record(initial.with)["persist-credentials"] !== false ||
      steps.indexOf(compilers[0]) !== steps.indexOf(installs[0]) + 1
    )
      throw new Error(
        "Historical AI receipt preparation is owned only by its selected test shard.",
      );
    return;
  }
  const wrongOtherJob = Object.entries(jobs).some(
    ([name, value]) =>
      name !== "tests" &&
      [
        historicalCheckoutName,
        historicalPrepareName,
        historicalPrepareBaseCommand,
        historicalSourcePath,
        historicalSourceCommit,
      ].some((marker) => JSON.stringify(value).includes(marker)),
  );
  if (
    jobName !== "tests" ||
    decisionSteps.length !== 1 ||
    steps.filter(
      (step) =>
        record(step).name ===
        "Determine historical preparation for the selected shard",
    ).length !== 1 ||
    !exactHistoricalKeys(decision, [
      "name",
      "id",
      "timeout-minutes",
      "run",
      "env",
    ]) ||
    !exactHistoricalKeys(decision.env, [
      "CLOUDMARKUP_TEST_PROJECTS",
      "CLOUDMARKUP_TEST_COVERAGE_DISCOVERY",
    ]) ||
    record(decision.env).CLOUDMARKUP_TEST_PROJECTS !==
      "$" + "{{ needs.changes.outputs.test-projects }}" ||
    record(decision.env).CLOUDMARKUP_TEST_COVERAGE_DISCOVERY !==
      "$" +
        "{{ (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') && 'true' || 'false' }}" ||
    decision.name !==
      "Determine historical preparation for the selected shard" ||
    decision.run !== decisionRun ||
    decision["timeout-minutes"] !== 2 ||
    steps.indexOf(decisionSteps[0]) !== steps.indexOf(installs[0]) + 1 ||
    checkoutIndex !== steps.indexOf(decisionSteps[0]) + 1 ||
    source.if !== condition ||
    preparation.if !== condition ||
    sources.length !== 1 ||
    preparations.length !== 1 ||
    installs.length !== 1 ||
    compilers.length !== 1 ||
    checkoutSteps.length !== 2 ||
    checkoutSteps[1] !== sources[0] ||
    initial.uses !== historicalCheckoutAction ||
    !exactHistoricalKeys(initial, ["name", "uses", "with"]) ||
    !exactHistoricalKeys(initial.with, ["persist-credentials"]) ||
    record(initial.with)["persist-credentials"] !== false ||
    steps.indexOf(checkoutSteps[0]) >= steps.indexOf(installs[0]) ||
    !exactHistoricalKeys(source, ["name", "uses", "with", "if"]) ||
    source.uses !== historicalCheckoutAction ||
    !exactHistoricalKeys(options, Object.keys(allowedOptions)) ||
    Object.entries(allowedOptions).some(
      ([key, value]) => options[key] !== value,
    ) ||
    !exactHistoricalKeys(preparation, ["name", "run", "if"]) ||
    preparation.run !== historicalPrepareCommand ||
    steps.filter((step) => record(step).run === historicalPrepareCommand)
      .length !== 1 ||
    checkoutIndex <= steps.indexOf(installs[0]) ||
    prepIndex !== checkoutIndex + 1 ||
    steps.indexOf(compilers[0]) !== prepIndex + 1 ||
    wrongOtherJob
  )
    throw new Error(
      "Historical AI receipt preparation must use only the exact credentialless source and closed preparation for the selected historical test before the real compiler and test gate.",
    );
}

const serviceProfileSelectors = [
  "BETA_SERVICE_PROFILE",
  "BETA_STRIPE_SANDBOX_SESSIONS_ENABLED",
  "BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN",
  "BETA_STRIPE_PREVIOUS_WEBHOOK_SIGNING_SECRET_ARN",
];
const profileHelperCopy =
  'cp "$GITHUB_WORKSPACE/scripts/beta-sandbox-delivery-admission.mjs" "$bundle/runtime/beta-sandbox-delivery-admission.mjs"';
const exportHelperCopy =
  'cp "$GITHUB_WORKSPACE/scripts/beta-solution-export-admission.mjs" "$bundle/runtime/beta-solution-export-admission.mjs"';
const proposalHelperCopy =
  'cp "$GITHUB_WORKSPACE/scripts/beta-proposal-admission.mjs" "$bundle/runtime/beta-proposal-admission.mjs"';
const profileReceiptBind =
  "node scripts/verify-beta-release.mjs --bind-service-profile";
const deploymentAssemblyCopy =
  'cp -R "$GITHUB_WORKSPACE/artifacts/platform/cdk.out" "$bundle/cdk.out"';
const profileReceiptCheck = `node --input-type=module -e 'import{readFileSync}from"node:fs";import{assertBetaServiceProfileReceipt}from"./runtime/beta-sandbox-delivery-admission.mjs";assertBetaServiceProfileReceipt(readFileSync("SERVICE_PROFILE.json","utf8"),process.env);'`;
const bundleHashCommand =
  "find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS";

async function calculateDeploymentTreeDigest(rootPath, label) {
  const root = resolve(rootPath);
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new TypeError(`${label} root must be a real directory.`);
  }
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory)) {
      const absolutePath = resolve(directory, entry);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        throw new TypeError(`${label} cannot contain symbolic links.`);
      }
      if (metadata.isDirectory()) {
        await visit(absolutePath);
      } else if (metadata.isFile()) {
        const localPath = relative(root, absolutePath).split(sep).join("/");
        if (localPath === "" || localPath.startsWith("../")) {
          throw new TypeError(`${label} path escaped its root.`);
        }
        files.push({ absolutePath, localPath });
      } else {
        throw new TypeError(`${label} cannot contain special files.`);
      }
    }
  }
  await visit(root);
  files.sort(({ localPath: left }, { localPath: right }) =>
    left === right ? 0 : left < right ? -1 : 1,
  );
  if (files.length === 0) {
    throw new TypeError(`${label} cannot be empty.`);
  }
  const aggregate = createHash("sha256");
  for (const { absolutePath, localPath } of files) {
    const digest = createHash("sha256")
      .update(await readFile(absolutePath))
      .digest("hex");
    aggregate.update(localPath, "utf8");
    aggregate.update("\0", "utf8");
    aggregate.update(digest, "utf8");
    aggregate.update("\n", "utf8");
  }
  return aggregate.digest("hex");
}

export function calculateDeploymentRuntimeTreeDigest(rootPath) {
  return calculateDeploymentTreeDigest(rootPath, "Deployment runtime");
}

export function calculateDeploymentAssemblyTreeDigest(rootPath) {
  return calculateDeploymentTreeDigest(rootPath, "Deployment assembly");
}

function finding(code, detail) {
  return { code, detail };
}

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
}

function actionSteps(job) {
  return Array.isArray(job.steps)
    ? job.steps.filter(
        (step) =>
          typeof step === "object" &&
          step !== null &&
          !Array.isArray(step) &&
          typeof step.uses === "string",
      )
    : [];
}

function runText(job) {
  return Array.isArray(job.steps)
    ? job.steps
        .map((step) =>
          typeof step === "object" &&
          step !== null &&
          !Array.isArray(step) &&
          typeof step.run === "string"
            ? step.run
            : "",
        )
        .join("\n")
    : "";
}

function exactPermissions(value, expected) {
  const actual = record(value);
  return (
    JSON.stringify(Object.keys(actual).sort()) ===
      JSON.stringify(Object.keys(expected).sort()) &&
    Object.entries(expected).every(([key, access]) => actual[key] === access)
  );
}

function serviceProfileWorkflowFindings({
  document,
  prepare,
  deploy,
  profilePrepareSteps,
  assemblyStep,
}) {
  const findings = [];
  const prepareSteps = Array.isArray(prepare.steps) ? prepare.steps : [];
  const deploySteps = Array.isArray(deploy.steps) ? deploy.steps : [];
  const hasSelector = (environment) =>
    serviceProfileSelectors.some((key) =>
      Object.hasOwn(record(environment), key),
    );
  const exactSelectors = (environment) =>
    serviceProfileSelectors.every(
      (key) => record(environment)[key] === `\${{ vars.${key} }}`,
    );
  if (
    hasSelector(document.env) ||
    hasSelector(prepare.env) ||
    profilePrepareSteps.some((step) => !exactSelectors(record(step).env)) ||
    prepareSteps.some(
      (step) =>
        !profilePrepareSteps.includes(step) && hasSelector(record(step).env),
    ) ||
    !exactSelectors(deploy.env) ||
    deploySteps.some((step) => hasSelector(record(step).env)) ||
    serviceProfileSelectors.some(
      (key) => runText(prepare).includes(key) || runText(deploy).includes(key),
    )
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_SERVICE_PROFILE_SCOPE_INVALID",
        "Service selectors must use identical protected Development variables only in beta preparation/admission steps and the deployment job; product tests and step overrides cannot select services.",
      ),
    );
  }
  const lines = (step) =>
    String(record(step).run ?? "")
      .trim()
      .split("\n")
      .map((line) => line.trim());
  const assemblyLines = lines(assemblyStep);
  const expectedHashTail = [
    profileReceiptBind,
    "(",
    'cd "$bundle"',
    bundleHashCommand,
    "sha256sum --check SHA256SUMS",
    ")",
  ];
  const admissionSteps = deploySteps.filter(
    (step) => record(step).name === "Admit the exact commit-bound bundle",
  );
  const admissionStep = admissionSteps[0];
  const admissionIndex = deploySteps.indexOf(admissionStep);
  const firstCdkIndex = deploySteps.findIndex((step) =>
    /runtime\/aws-cdk\/bin\/cdk/u.test(String(record(step).run ?? "")),
  );
  const downloadIndex = deploySteps.findIndex((step) =>
    String(record(step).uses ?? "").startsWith("actions/download-artifact@"),
  );
  const expectedAdmission = [
    "set -euo pipefail",
    'bundle="$GITHUB_WORKSPACE/artifacts/platform/deployment-bundle"',
    'test "$(cat "$bundle/SOURCE_REVISION")" = "$GITHUB_SHA"',
    'test "$SOURCE_REVISION" = "$GITHUB_SHA"',
    'test "${#DEPLOYMENT_BUNDLE_SHA256}" -eq 64',
    "(",
    'cd "$bundle"',
    "sha256sum --check SHA256SUMS",
    `node --input-type=module -e 'import("./runtime/beta-release-gate-core.mjs").then(({validateBetaReleaseEnvironment})=>{const findings=validateBetaReleaseEnvironment(process.env);if(findings.length>0){throw new Error(JSON.stringify(findings));}})'`,
    profileReceiptCheck,
    ")",
  ];
  if (
    record(assemblyStep).shell !== "bash" ||
    Object.hasOwn(record(assemblyStep), "working-directory") ||
    Object.hasOwn(record(record(prepare.defaults).run), "working-directory") ||
    Object.hasOwn(record(record(document.defaults).run), "working-directory") ||
    assemblyLines[0] !== "set -euo pipefail" ||
    !assemblyLines.includes(profileHelperCopy) ||
    assemblyLines.filter((line) => line === proposalHelperCopy).length !== 1 ||
    assemblyLines.indexOf(proposalHelperCopy) >=
      assemblyLines.indexOf(profileReceiptBind) ||
    assemblyLines.filter((line) => line === exportHelperCopy).length !== 1 ||
    assemblyLines.indexOf(exportHelperCopy) >=
      assemblyLines.indexOf(profileReceiptBind) ||
    !assemblyLines.includes(deploymentAssemblyCopy) ||
    assemblyLines.indexOf(deploymentAssemblyCopy) >=
      assemblyLines.indexOf(profileReceiptBind) ||
    assemblyLines.indexOf(profileHelperCopy) >=
      assemblyLines.indexOf(profileReceiptBind) ||
    assemblyLines.filter((line) => line === profileReceiptBind).length !== 1 ||
    assemblyLines.some((line) =>
      line.includes("serializeBetaServiceProfile"),
    ) ||
    assemblyLines
      .slice(0, -expectedHashTail.length)
      .some((line) => /(?:^|[;&|])\s*(?:cd|pushd|popd)(?:\s|$)/u.test(line)) ||
    JSON.stringify(assemblyLines.slice(-expectedHashTail.length)) !==
      JSON.stringify(expectedHashTail) ||
    admissionSteps.length !== 1 ||
    record(admissionStep).shell !== "bash" ||
    Object.hasOwn(record(admissionStep), "if") ||
    Object.hasOwn(record(admissionStep), "continue-on-error") ||
    JSON.stringify(lines(admissionStep)) !==
      JSON.stringify(expectedAdmission) ||
    downloadIndex < 0 ||
    admissionIndex <= downloadIndex ||
    firstCdkIndex <= admissionIndex
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_SERVICE_PROFILE_BINDING_INVALID",
        "The repository-root binder must admit the copied deployment assembly and bind its exact service profile before hashing; the reviewed verifier must compare fresh protected inputs after checksum validation and before any CDK command, without bypasses.",
      ),
    );
  }
  return findings;
}

export function validateBetaDeploymentWorkflowText(text) {
  const findings = [];
  if (/\+\s{2,}\S/u.test(text)) {
    findings.push(
      finding(
        "BETA_WORKFLOW_PATCH_ARTIFACT",
        "Workflow commands cannot contain literal patch-marker continuations.",
      ),
    );
  }
  let workflow;
  try {
    workflow = parse(text);
  } catch {
    return [
      finding(
        "BETA_WORKFLOW_PARSE_INVALID",
        "The beta deployment workflow must be valid YAML.",
      ),
    ];
  }
  const document = record(workflow);
  const trigger = record(document.on);
  const push = record(trigger.push);
  if (
    JSON.stringify(push.branches) !== JSON.stringify(["main"]) ||
    Object.hasOwn(push, "paths") ||
    JSON.stringify(push["paths-ignore"]) !==
      JSON.stringify([
        "docs/**",
        "**/README.md",
        "README.md",
        "**/AGENTS.md",
        "AGENTS.md",
        ".agents/skills/**",
      ]) ||
    Object.keys(trigger).length !== 1
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_TRIGGER_INVALID",
        "Delivery must run only for pushes to main.",
      ),
    );
  }
  if (!exactPermissions(document.permissions, { contents: "read" })) {
    findings.push(
      finding(
        "BETA_WORKFLOW_TOP_LEVEL_PERMISSIONS_INVALID",
        "Top-level permissions must be contents: read only.",
      ),
    );
  }
  const jobs = record(document.jobs);
  if (
    JSON.stringify(Object.keys(jobs).sort()) !==
    JSON.stringify(["changes", "deploy", "prepare", "verify"])
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_JOB_SET_INVALID",
        "Delivery must contain only credentialless change classification, verification, preparation, and privileged deployment.",
      ),
    );
  }
  const changes = record(jobs.changes);
  if (
    JSON.stringify(changes) !==
    JSON.stringify({
      name: "Classify deployable changes",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
      permissions: { contents: "read", actions: "read" },
      outputs: {
        "deploy-required": "$" + "{{ steps.classify.outputs.deploy-required }}",
      },
      steps: [
        {
          name: "Check out triggering commit and history",
          uses: "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
          with: { "fetch-depth": 0, "persist-credentials": false },
        },
        {
          name: "Classify complete push diff",
          id: "classify",
          env: {
            BEFORE_SHA: "$" + "{{ github.event.before }}",
            GITHUB_TOKEN: "$" + "{{ github.token }}",
          },
          run: "node scripts/classify-beta-deployment.mjs",
        },
      ],
    })
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_CHANGES_INVALID",
        "Change classification must inspect the exact push and successful delivery baseline with only a read-only Actions token and no deployment credentials or skip controls.",
      ),
    );
  }
  const verify = record(jobs.verify);
  if (
    JSON.stringify(Object.keys(verify).sort()) !==
      JSON.stringify(["if", "name", "needs", "permissions", "uses", "with"]) ||
    verify.needs !== "changes" ||
    verify.if !== "needs.changes.outputs.deploy-required == 'true'" ||
    JSON.stringify(verify.with) !== JSON.stringify({ functional_beta: true }) ||
    verify.uses !== "./.github/workflows/ci.yml" ||
    !exactPermissions(verify.permissions, { contents: "read" })
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_VERIFY_INVALID",
        "Verification must call this exact commit CI workflow with the reviewed functional-beta profile, read-only permissions, and no secrets or bypass.",
      ),
    );
  }
  const prepare = record(jobs.prepare);
  const deploy = record(jobs.deploy);
  if (prepare["timeout-minutes"] !== 120 || deploy["timeout-minutes"] !== 90) {
    findings.push(
      finding(
        "BETA_WORKFLOW_TIMEOUT_INVALID",
        "Credentialless preparation must retain its 120-minute bound and AWS deployment its 90-minute bound.",
      ),
    );
  }
  const prepareActions = actionSteps(prepare);
  const prepareText = JSON.stringify(prepare);
  if (
    prepare.environment !== "Development" ||
    JSON.stringify(prepare.needs) !== JSON.stringify(["changes", "verify"]) ||
    prepare.if !==
      "needs.changes.outputs.deploy-required == 'true' && github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository == 'hunter-west/CloudMarkup'" ||
    !exactPermissions(prepare.permissions, { contents: "read" }) ||
    !String(prepare.if ?? "").includes("refs/heads/main") ||
    !String(prepare.if ?? "").includes("hunter-west/CloudMarkup") ||
    /(?:\bsecrets\.|"(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN)"\s*:)/iu.test(
      prepareText,
    ) ||
    prepareActions.some((step) =>
      String(step.uses).startsWith("aws-actions/configure-aws-credentials@"),
    )
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_PREPARE_BOUNDARY_INVALID",
        "Preparation must be credentialless and bound to the trusted main repository.",
      ),
    );
  }
  if (
    deploy.environment !== "Development" ||
    deploy.if !==
      "github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository == 'hunter-west/CloudMarkup'" ||
    Object.hasOwn(deploy, "continue-on-error") ||
    JSON.stringify(deploy.needs) !== JSON.stringify(["prepare", "verify"]) ||
    !exactPermissions(deploy.permissions, {
      contents: "read",
      "id-token": "write",
    })
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_DEPLOY_BOUNDARY_INVALID",
        "Deploy must require preparation and the successful same-run verification workflow and hold only read plus OIDC permissions in Development.",
      ),
    );
  }
  for (const [jobName, job] of Object.entries({ prepare, deploy })) {
    for (const step of actionSteps(job)) {
      if (!/^[^/\s]+\/[^@\s]+@[0-9a-f]{40}$/u.test(step.uses)) {
        findings.push(
          finding(
            "BETA_WORKFLOW_ACTION_NOT_PINNED",
            `${jobName} uses an action that is not pinned to a full commit SHA.`,
          ),
        );
      }
    }
  }
  const goSetup = actionSteps(prepare).find((step) =>
    String(step.uses).startsWith("actions/setup-go@"),
  );
  if (
    record(goSetup?.with)["go-version-file"] !==
      "services/iac-compiler/go.mod" ||
    record(goSetup?.with)["cache-dependency-path"] !==
      "services/iac-compiler/go.sum"
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_GO_SETUP_INVALID",
        "Preparation must use the tracked compiler Go module for its version and cache authorities.",
      ),
    );
  }
  const obsoleteInputs = [
    "APPLICATION_BUILD_IMAGE_DIGEST",
    "TERRAFORM_VALIDATION_IMAGE_DIGEST",
    "DEPLOYMENT_ASSEMBLY_SHA256",
    "DEPLOYMENT_RUNTIME_SHA256",
    "CLOUDMARKUP_DEPLOYMENT_ENABLED",
  ];
  if (obsoleteInputs.some((input) => text.includes(input))) {
    findings.push(
      finding(
        "BETA_WORKFLOW_OBSOLETE_INPUT",
        "Delivery cannot depend on manual image, assembly, runtime, or activation variables.",
      ),
    );
  }
  if (/(?:secrets\.AWS_|aws-access-key-id\s*:)/iu.test(text)) {
    findings.push(
      finding(
        "BETA_WORKFLOW_STATIC_CREDENTIAL",
        "Delivery must not reference static AWS credentials.",
      ),
    );
  }
  const prepareRuns = runText(prepare);
  const prepareSteps = Array.isArray(prepare.steps) ? prepare.steps : [];
  const dependencyInstallIndexes = prepareSteps.flatMap((step, index) =>
    record(step).run === "pnpm install --frozen-lockfile" ? [index] : [],
  );
  const exactRunSteps = (command) =>
    prepareSteps.filter((step) => record(step).run === command);
  const releaseGateSteps = exactRunSteps("pnpm beta:release-gate:policy");
  const compilerSteps = exactRunSteps(reviewedTestCompilerBuild);
  const compilerStep = compilerSteps[0];
  const buildSteps = exactRunSteps("pnpm build");
  const synthSteps = exactRunSteps("pnpm beta:synth");
  const artifactGateSteps = exactRunSteps("pnpm beta:release-gate:artifacts");
  const assemblySteps = prepareSteps.filter(
    (step) => record(step).name === "Assemble the same-run deployment bundle",
  );
  const deploymentUploads = prepareActions.filter((step) =>
    String(step.uses).startsWith("actions/upload-artifact@"),
  );
  const deployActions = actionSteps(deploy);
  const deploymentDownloads = deployActions.filter((step) =>
    String(step.uses).startsWith("actions/download-artifact@"),
  );
  const releaseGateStep = releaseGateSteps[0];
  if (
    Object.hasOwn(prepare, "services") ||
    Object.hasOwn(deploy, "services") ||
    JSON.stringify({ prepare, deploy, env: document.env }).includes(
      "CLOUDMARKUP_TEST_DATABASE_URL",
    ) ||
    Object.hasOwn(prepare, "container") ||
    Object.hasOwn(prepare, "continue-on-error")
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_PREPARE_DATABASE_INVALID",
        "Test databases belong only to credentialless verification jobs; artifact and privileged jobs must not carry test database configuration.",
      ),
    );
  }
  const assemblyStep = assemblySteps[0];
  const deploymentUpload = deploymentUploads[0];
  const deploymentDownload = deploymentDownloads[0];
  const releaseGateIndex = prepareSteps.indexOf(releaseGateStep);
  if (
    dependencyInstallIndexes.length !== 1 ||
    releaseGateIndex < 0 ||
    dependencyInstallIndexes[0] >= releaseGateIndex
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_PREPARE_SETUP_INVALID",
        "Preparation must install locked dependencies before the beta policy gate.",
      ),
    );
  }
  const buildCacheSteps = prepareSteps.filter(
    (step) =>
      record(step).name === "Restore this release's verified build cache",
  );
  if (
    buildCacheSteps.length !== 1 ||
    JSON.stringify(buildCacheSteps[0]) !==
      JSON.stringify({
        name: "Restore this release's verified build cache",
        uses: "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
        with: { name: "ci-build-cache", path: ".turbo/cache/" },
      })
  )
    findings.push(
      finding(
        "BETA_WORKFLOW_PREPARE_CACHE_INVALID",
        "Preparation requires the successful same-run build cache with no cross-run selector or failure bypass.",
      ),
    );
  const orderedPrepareSteps = [
    releaseGateStep,
    compilerStep,
    buildCacheSteps[0],
    buildSteps[0],
    synthSteps[0],
    artifactGateSteps[0],
    assemblyStep,
    deploymentUpload,
  ];
  const orderedPrepareIndexes = orderedPrepareSteps.map((step) =>
    prepareSteps.indexOf(step),
  );
  if (
    releaseGateSteps.length !== 1 ||
    compilerSteps.length !== 1 ||
    JSON.stringify(Object.keys(record(compilerStep)).sort()) !==
      '["name","run","shell"]' ||
    record(compilerStep).shell !== "bash" ||
    buildSteps.length !== 1 ||
    synthSteps.length !== 1 ||
    artifactGateSteps.length !== 1 ||
    assemblySteps.length !== 1 ||
    deploymentUploads.length !== 1 ||
    !orderedPrepareIndexes.every(
      (index, position, indexes) =>
        index >= 0 && (position === 0 || indexes[position - 1] + 1 === index),
    ) ||
    orderedPrepareSteps.some((step) => {
      const value = record(step);
      return (
        Object.hasOwn(value, "continue-on-error") || Object.hasOwn(value, "if")
      );
    })
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_PREPARE_ORDER_INVALID",
        "Preparation must run policy, the exact source-built compiler pin, one authoritative build/synthesis/admission, bundle assembly, and upload in exact fail-closed order.",
      ),
    );
  }
  if (/pnpm (?:check|test):e2e/u.test(prepareRuns)) {
    findings.push(
      finding(
        "BETA_WORKFLOW_DUPLICATE_BROWSER_GATE",
        "Browser interaction and visual tests belong only in the pinned parallel CI browser job.",
      ),
    );
  }
  if (
    Object.hasOwn(record(prepare.env), "CLOUDMARKUP_ENVIRONMENT") ||
    record(record(releaseGateStep).env).CLOUDMARKUP_ENVIRONMENT !==
      "${{ vars.CLOUDMARKUP_ENVIRONMENT }}" ||
    synthSteps.length !== 1 ||
    synthSteps.some(
      (step) =>
        record(record(step).env).CLOUDMARKUP_ENVIRONMENT !==
        "${{ vars.CLOUDMARKUP_ENVIRONMENT }}",
    ) ||
    artifactGateSteps.length !== 1 ||
    artifactGateSteps.some(
      (step) =>
        record(record(step).env).CLOUDMARKUP_ENVIRONMENT !==
        "${{ vars.CLOUDMARKUP_ENVIRONMENT }}",
    ) ||
    record(record(assemblyStep).env).CLOUDMARKUP_ENVIRONMENT !==
      "${{ vars.CLOUDMARKUP_ENVIRONMENT }}"
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_ENVIRONMENT_SCOPE_INVALID",
        "The beta runtime selector must be scoped to beta policy, synthesis, artifact verification, and copied-assembly binding, never ordinary product tests.",
      ),
    );
  }
  findings.push(
    ...serviceProfileWorkflowFindings({
      document,
      prepare,
      deploy,
      profilePrepareSteps: [
        ...releaseGateSteps,
        ...synthSteps,
        ...artifactGateSteps,
        assemblyStep,
      ],
      assemblyStep,
    }),
  );
  for (const marker of [
    "pnpm install --frozen-lockfile",
    "pnpm beta:release-gate:policy",
    "pnpm build",
    "pnpm beta:synth",
    "pnpm beta:release-gate:artifacts",
    'printf \'%s\\n\' "$GITHUB_SHA" > "$bundle/SOURCE_REVISION"',
    "sha256sum --check SHA256SUMS",
    "cloudmarkup-beta-dns-records.yml",
    "for asset in cloudmarkup-logo.png app-icon-192.png app-icon-512.png apple-touch-icon.png favicon.ico site.webmanifest; do",
    'cp "$GITHUB_WORKSPACE/apps/web/src/assets/brand/public/$asset" "$bundle/reviewed-public-assets/$asset"',
  ]) {
    if (!prepareRuns.includes(marker)) {
      findings.push(
        finding(
          "BETA_WORKFLOW_PREPARE_GATE_MISSING",
          `Preparation is missing required commit/build binding: ${marker}.`,
        ),
      );
    }
  }
  const deploymentBundleName = "cloudmarkup-beta-deployment-${{ github.sha }}";
  const deploymentDownloadInputs = record(deploymentDownload?.with);
  if (
    deploymentUpload?.id !== "upload" ||
    record(deploymentUpload?.with).name !== deploymentBundleName ||
    deploymentDownloads.length !== 1 ||
    deploymentDownloadInputs.name !== deploymentBundleName ||
    deploymentDownloadInputs.path !== "artifacts/platform/deployment-bundle" ||
    ["github-token", "repository", "run-id"].some((input) =>
      Object.hasOwn(deploymentDownloadInputs, input),
    ) ||
    record(prepare.outputs)["deployment-bundle-sha256"] !==
      "${{ steps.upload.outputs.artifact-digest }}" ||
    record(deploy.env).DEPLOYMENT_BUNDLE_SHA256 !==
      "${{ needs.prepare.outputs.deployment-bundle-sha256 }}" ||
    record(deploy.env).SOURCE_REVISION !== "${{ github.sha }}"
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_BUNDLE_BINDING_INVALID",
        "The exact current-run SHA-bound artifact, upload digest, and triggering commit must bind prepare to deploy.",
      ),
    );
  }
  if (
    record(deploymentUpload?.with).overwrite !== true ||
    record(deploymentUpload?.with)["include-hidden-files"] !== true ||
    record(deploymentUpload?.with)["if-no-files-found"] !== "error"
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_BUNDLE_UPLOAD_INCOMPLETE",
        "The hashed deployment bundle must replace a prior run-attempt artifact, upload hidden files, and fail when empty.",
      ),
    );
  }
  const firstStep = Array.isArray(deploy.steps) ? deploy.steps[0] : undefined;
  if (
    firstStep?.uses !==
      "aws-actions/configure-aws-credentials@e6de054238d6b7531b4efff3b6587d9aade6a06c" ||
    firstStep?.with?.["allowed-account-ids"] !== "000000000000" ||
    firstStep?.with?.["aws-region"] !== "us-east-1" ||
    firstStep?.with?.["role-duration-seconds"] !== 3600 ||
    firstStep?.with?.["role-to-assume"] !==
      "arn:aws:iam::000000000000:role/CloudMarkup-Beta-GitHub"
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_APPLICATION_OIDC_INVALID",
        "The privileged job must acquire the exact application role first.",
      ),
    );
  }
  const applicationOidcActions = deployActions.filter(
    (step) =>
      step.with?.["role-to-assume"] ===
      "arn:aws:iam::000000000000:role/CloudMarkup-Beta-GitHub",
  );
  if (
    applicationOidcActions.length !== 5 ||
    applicationOidcActions.some(
      (step) =>
        step.uses !==
          "aws-actions/configure-aws-credentials@e6de054238d6b7531b4efff3b6587d9aade6a06c" ||
        step.with?.["allowed-account-ids"] !== "000000000000" ||
        step.with?.audience !== "sts.amazonaws.com" ||
        step.with?.["aws-region"] !== "us-east-1" ||
        step.with?.["mask-aws-account-id"] !== true ||
        step.with?.["role-duration-seconds"] !== 3600 ||
        step.with?.["unset-current-credentials"] !== true,
    )
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_APPLICATION_OIDC_INVALID",
        "Each beta stack and the DNS handoff must use a freshly acquired one-hour application role.",
      ),
    );
  }
  if (
    deployActions.some((step) =>
      String(step.uses).startsWith("actions/checkout@"),
    )
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_PRIVILEGED_CHECKOUT",
        "Deploy must consume only the checked same-run bundle, not a checkout.",
      ),
    );
  }
  const deployRuns = runText(deploy);
  for (const marker of [
    'test "$(cat "$bundle/SOURCE_REVISION")" = "$GITHUB_SHA"',
    "sha256sum --check SHA256SUMS",
    "validateBetaReleaseEnvironment(process.env)",
    "aws sts get-caller-identity",
    "aws apigateway get-account",
    'node "$bundle/runtime/aws-cdk/bin/cdk" deploy',
    '--app "$bundle/cdk.out"',
    "--outputs-file",
    "--require-approval never",
    "--rollback",
    "render-deployment-handoff.js",
  ]) {
    if (!deployRuns.includes(marker)) {
      findings.push(
        finding(
          "BETA_WORKFLOW_DEPLOY_GATE_MISSING",
          `Deploy is missing required admission or CloudFormation marker: ${marker}.`,
        ),
      );
    }
  }
  if (/--hotswap|--no-rollback/iu.test(deployRuns)) {
    findings.push(
      finding(
        "BETA_WORKFLOW_UNSAFE_CDK_COMMAND",
        "CDK deployment cannot use hotswap or disable rollback.",
      ),
    );
  }
  const splitStacks = [
    { selector: "CloudMarkup-beta/Observability", shortName: "observability" },
    { selector: "CloudMarkup-beta/Stateful", shortName: "stateful" },
    { selector: "CloudMarkup-beta/Application", shortName: "application" },
    { selector: "CloudMarkup-beta/Edge", shortName: "edge" },
  ];
  const privilegedSequence = [];
  let splitDeployStepInvalid = false;
  for (const step of Array.isArray(deploy.steps) ? deploy.steps : []) {
    if (typeof step !== "object" || step === null || Array.isArray(step)) {
      continue;
    }
    const assumedRole = record(step.with)["role-to-assume"];
    if (
      assumedRole === "arn:aws:iam::000000000000:role/CloudMarkup-Beta-GitHub"
    ) {
      privilegedSequence.push("oidc:application");
    } else if (
      assumedRole === "arn:aws:iam::000000000001:role/CloudMarkup-Beta-DNS"
    ) {
      privilegedSequence.push("oidc:dns");
    }
    const stepRun = typeof step.run === "string" ? step.run : "";
    const deployLaunchers =
      stepRun.match(/node "\$bundle\/runtime\/aws-cdk\/bin\/cdk" deploy/gu) ??
      [];
    if (deployLaunchers.length === 0) {
      continue;
    }
    const deployInvocation =
      /(?:^|\r?\n)node "\$bundle\/runtime\/aws-cdk\/bin\/cdk" deploy \\\r?\n[ \t]+([^\s\\]+)[ \t]+\\(?:\r?\n|$)/u.exec(
        stepRun,
      );
    const matchingStack = splitStacks.find(
      ({ selector }) => selector === deployInvocation?.[1],
    );
    const shortName = matchingStack?.shortName;
    if (
      deployLaunchers.length !== 1 ||
      deployInvocation === null ||
      (stepRun.match(/--exclusively/gu) ?? []).length !== 1 ||
      !shortName ||
      !stepRun.includes(`cdk-outputs-${shortName}.json`)
    ) {
      splitDeployStepInvalid = true;
      continue;
    }
    privilegedSequence.push(`deploy:${shortName}`);
  }
  const expectedPrivilegedSequence = [
    "oidc:application",
    "deploy:observability",
    "oidc:application",
    "deploy:stateful",
    "oidc:application",
    "deploy:application",
    "oidc:application",
    "deploy:edge",
    "oidc:application",
    "oidc:dns",
  ];
  const exclusiveDeployments = deployRuns.match(/--exclusively/gu) ?? [];
  if (
    splitDeployStepInvalid ||
    JSON.stringify(privilegedSequence) !==
      JSON.stringify(expectedPrivilegedSequence) ||
    splitStacks.some(({ selector }) => !deployRuns.includes(selector)) ||
    splitStacks.some(
      ({ shortName }) => !deployRuns.includes(`cdk-outputs-${shortName}.json`),
    ) ||
    exclusiveDeployments.length !== splitStacks.length ||
    deployRuns.includes("--all") ||
    !deployRuns.includes("Incomplete split-stack CDK outputs.")
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_SPLIT_DEPLOY_INVALID",
        "The four beta stacks must deploy exclusively in order with separate output files and refreshed credentials.",
      ),
    );
  }
  const dnsAction = deployActions.find(
    (step) =>
      step.with?.["role-to-assume"] ===
      "arn:aws:iam::000000000001:role/CloudMarkup-Beta-DNS",
  );
  if (
    dnsAction?.with?.["allowed-account-ids"] !== "000000000001" ||
    dnsAction?.with?.["aws-region"] !== "us-east-1" ||
    dnsAction?.with?.["role-chaining"] !== true ||
    dnsAction?.with?.["role-skip-session-tagging"] === true
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_DNS_ROLE_INVALID",
        "DNS updates must role-chain with session tags to the exact DNS-account delivery role.",
      ),
    );
  }
  for (const marker of [
    "cloudmarkup-beta-dns-records",
    "arn:aws:iam::000000000001:role/CloudMarkup-Beta-DNS-CloudFormation",
    "ZSYNTHETIC123456",
    "aws cloudformation update-stack",
    "aws cloudformation wait stack-update-complete",
    "ParameterKey=HostedZoneId,UsePreviousValue=true",
    "ParameterKey=CertificateValidationRecordName,UsePreviousValue=true",
    "ParameterKey=CertificateValidationRecordValue,UsePreviousValue=true",
    'ParameterKey=CloudFrontDomainName,ParameterValue="$dns_target"',
    "outputs.AliasTarget!==handoff.DnsTarget",
  ]) {
    if (!deployRuns.includes(marker) && !text.includes(marker)) {
      findings.push(
        finding(
          "BETA_WORKFLOW_DNS_CLOUDFORMATION_INVALID",
          `DNS CloudFormation update is missing required exact binding: ${marker}.`,
        ),
      );
    }
  }
  if (/aws\s+route53\s+change-resource-record-sets/iu.test(text)) {
    findings.push(
      finding(
        "BETA_WORKFLOW_DIRECT_DNS_MUTATION",
        "Canonical DNS changes must go through the exact CloudFormation records stack.",
      ),
    );
  }
  for (const marker of [
    "$BETA_BASE_URL/",
    "$BETA_BASE_URL/api/health",
    "$BETA_BASE_URL/api/ready",
    "$BETA_BASE_URL/api/runtime-config",
    "$BETA_BASE_URL/favicon.ico",
    "$BETA_BASE_URL/site.webmanifest",
    "$BETA_BASE_URL/$asset",
    'href="/favicon.ico"',
    'href="/app-icon-192.png"',
    'href="/apple-touch-icon.png"',
    'href="/site.webmanifest"',
    'reviewed_public_assets="$bundle/reviewed-public-assets"',
    'cmp -s "$public_assets/$asset" "$reviewed_public_assets/$asset"',
    'cmp -s "$public_assets/favicon.ico" "$reviewed_public_assets/favicon.ico"',
    'cmp -s "$public_assets/site.webmanifest" "$reviewed_public_assets/site.webmanifest"',
    "image/(x-icon|vnd\\.microsoft\\.icon)",
    "application/(manifest\\+json|json)",
    "cache-control:.*no-store",
    "cloudmarkup-api/access",
    "assert.deepStrictEqual(health, expectedHealth)",
    "assert.deepStrictEqual(readiness, expectedReadiness)",
    "assert.deepStrictEqual(actual, expected)",
  ]) {
    if (!deployRuns.includes(marker)) {
      findings.push(
        finding(
          "BETA_WORKFLOW_SMOKE_INVALID",
          `Public smoke is missing required check: ${marker}.`,
        ),
      );
    }
  }
  if (
    !text.includes(
      "cloudmarkup-beta-handoff-${{ github.sha }}-${{ github.run_attempt }}",
    ) ||
    !deployRuns.includes("AWS_ACCESS_KEY_ID=")
  ) {
    findings.push(
      finding(
        "BETA_WORKFLOW_EVIDENCE_INVALID",
        "Sanitized evidence must be commit-bound and uploaded only after credentials are cleared.",
      ),
    );
  }
  return findings;
}
