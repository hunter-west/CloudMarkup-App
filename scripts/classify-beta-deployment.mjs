import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const commitPattern = /^[0-9a-f]{40}$/u;
const testSourcePattern = /(?:^|\/)[^/]+\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u;
const goTestPattern = /(?:^|\/)[^/]+_test\.go$/u;

export function isTestOnlyPath(path) {
  return testSourcePattern.test(path) || goTestPattern.test(path);
}

// These exact files affect verification scheduling/policy only, not a deployable
// application, asset, runtime helper, dependency or infrastructure template.
const verificationOnlyPaths = new Set([
  "CONTRIBUTING.md",
  "SECURITY.md",
  "BETA_READINESS.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/workflows/ci.yml",
  "scripts/ci-historical-preparation.mjs",
  "scripts/ci-change-scope.mjs",
  "scripts/validate-workflows.mjs",
  "scripts/beta-deployment-workflow-policy.mjs",
  "scripts/classify-beta-deployment.mjs",
]);

export function isDeploymentNeutralPath(path) {
  if (
    typeof path !== "string" ||
    !path ||
    path.includes("\\") ||
    [...path].some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    }) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    return false;
  return (
    isTestOnlyPath(path) ||
    verificationOnlyPaths.has(path) ||
    path.startsWith("docs/") ||
    path.startsWith(".agents/skills/") ||
    /(?:^|\/)(?:README|AGENTS)\.md$/u.test(path)
  );
}

export function requiresBetaDeployment(paths) {
  return (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    paths.some((path) => !isDeploymentNeutralPath(path))
  );
}

export function classifyBetaPush(before, head, git = execFileSync) {
  if (!commitPattern.test(before) || !commitPattern.test(head)) {
    throw new Error("Push revisions must be full lowercase commit hashes.");
  }
  const checkedOutHead = git("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (checkedOutHead !== head) {
    throw new Error("Checkout does not match the triggering push.");
  }
  if (/^0+$/u.test(before)) return true;
  try {
    git("git", ["cat-file", "-e", `${before}^{commit}`]);
  } catch {
    return true;
  }
  let changed;
  try {
    changed = git("git", [
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      before,
      head,
    ]);
  } catch {
    return true;
  }
  if (!Buffer.isBuffer(changed)) {
    throw new Error("Git diff must return NUL-delimited path bytes.");
  }
  return requiresBetaDeployment(
    changed
      .toString("utf8")
      .split("\0")
      .filter((path) => path.length > 0),
  );
}

export async function findDeployedBetaSource(
  repository,
  readJson = readDeploymentJson,
) {
  if (repository !== "hunter-west/CloudMarkup") return undefined;
  try {
    const root = `https://api.github.com/repos/${repository}`;
    const value = await readJson(
      `${root}/actions/workflows/deploy-development.yml/runs?branch=main&event=push&status=success&per_page=10`,
    );
    if (!Array.isArray(value.workflow_runs)) return undefined;
    for (const run of value.workflow_runs.slice(0, 10)) {
      if (
        run.head_branch !== "main" ||
        run.event !== "push" ||
        run.conclusion !== "success" ||
        !commitPattern.test(run.head_sha) ||
        !Number.isSafeInteger(run.id) ||
        run.id <= 0
      )
        continue;
      const jobs = await readJson(
        `${root}/actions/runs/${run.id}/jobs?per_page=100`,
      );
      if (
        jobs.jobs?.some(
          (job) =>
            job.name === "Deploy application, DNS, and smoke" &&
            job.conclusion === "success",
        )
      )
        return run.head_sha;
    }
  } catch {
    // An unavailable deployment baseline must retain full protected admission.
  }
  return undefined;
}

async function readDeploymentJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Deployment history read failed.");
  return response.json();
}

export async function classifyPendingBetaPush(
  before,
  head,
  repository,
  git = execFileSync,
  readJson = readDeploymentJson,
) {
  if (classifyBetaPush(before, head, git)) return true;
  const deployed = await findDeployedBetaSource(repository, readJson);
  return classifyBetaPush(deployed ?? "0".repeat(40), head, git);
}

if (process.argv[1]?.endsWith("classify-beta-deployment.mjs")) {
  const required = await classifyPendingBetaPush(
    process.env.BEFORE_SHA ?? "",
    process.env.GITHUB_SHA ?? "",
    process.env.GITHUB_REPOSITORY ?? "",
  );
  if (!process.env.GITHUB_OUTPUT)
    throw new Error("Missing GitHub output path.");
  appendFileSync(process.env.GITHUB_OUTPUT, `deploy-required=${required}\n`);
  console.log(
    required
      ? "Deployable files changed since the push or the last successful beta delivery."
      : "Verification, documentation or test-only change; deployed application bytes are current.",
  );
}
