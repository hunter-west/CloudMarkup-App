import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyBetaPush,
  classifyPendingBetaPush,
  findDeployedBetaSource,
  isTestOnlyPath,
  requiresBetaDeployment,
} from "./classify-beta-deployment.mjs";

const before = "a".repeat(40);
const head = "b".repeat(40);

function gitFor(paths, options = {}) {
  const calls = [];
  const git = (_command, args) => {
    calls.push(args);
    if (args[0] === "rev-parse") return options.checkout ?? `${head}\n`;
    if (args[0] === "cat-file") {
      if (options.missingBefore) throw new Error("missing");
      return Buffer.alloc(0);
    }
    if (args[0] === "diff") {
      if (options.diffFails) throw new Error("diff failed");
      return Buffer.from(paths.map((path) => `${path}\0`).join(""));
    }
    throw new Error("unexpected git command");
  };
  return { git, calls };
}

test("only named test source files are deployment-neutral", () => {
  for (const path of [
    "apps/web/src/App.test.tsx",
    "apps/web/e2e/editor.spec.ts",
    "scripts/check.test.mjs",
    "services/iac-compiler/compiler_test.go",
  ])
    assert.equal(isTestOnlyPath(path), true, path);
  for (const path of [
    "apps/web/src/App.tsx",
    "packages/domain/src/graph-commands.ts",
    "infra/platform/lib/platform.ts",
    ".github/workflows/deploy-development.yml",
    "scripts/build.mjs",
    "apps/web/e2e/fixture.json",
    "services/iac-compiler/compiler.go",
  ])
    assert.equal(isTestOnlyPath(path), false, path);
});

test("empty or mixed changes require beta deployment", () => {
  assert.equal(requiresBetaDeployment([]), true);
  assert.equal(requiresBetaDeployment(["apps/web/src/App.test.tsx"]), false);
  assert.equal(
    requiresBetaDeployment([
      "apps/web/src/App.test.tsx",
      "apps/web/src/App.tsx",
    ]),
    true,
  );
});

test("classifier binds the exact checkout and complete NUL-delimited diff", () => {
  const { git, calls } = gitFor([
    "apps/web/src/App.test.tsx",
    "apps/web/src/App.tsx",
  ]);
  assert.equal(classifyBetaPush(before, head, git), true);
  assert.deepEqual(calls.at(-1), [
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    before,
    head,
  ]);
  assert.equal(
    classifyBetaPush(before, head, gitFor(["apps/web/src/App.test.tsx"]).git),
    false,
  );
});

test("uncertain histories require deployment and malformed diffs fail closed", () => {
  assert.equal(classifyBetaPush("0".repeat(40), head, gitFor([]).git), true);
  assert.equal(
    classifyBetaPush(before, head, gitFor([], { missingBefore: true }).git),
    true,
  );
  assert.throws(() =>
    classifyBetaPush(before, head, gitFor([], { checkout: `${before}\n` }).git),
  );
  assert.equal(
    classifyBetaPush(before, head, gitFor([], { diffFails: true }).git),
    true,
  );
  assert.throws(() => classifyBetaPush("bad", head, gitFor([]).git));
});

test("verification-only and documentation changes do not redeploy application bytes", () => {
  for (const path of [
    ".github/workflows/ci.yml",
    "scripts/ci-change-scope.mjs",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "BETA_READINESS.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    "scripts/ci-historical-preparation.mjs",
    "scripts/validate-workflows.mjs",
    "scripts/beta-deployment-workflow-policy.mjs",
    "scripts/classify-beta-deployment.mjs",
    "docs/roadmap/STATUS.md",
    "README.md",
    "packages/domain/AGENTS.md",
    ".agents/skills/example/SKILL.md",
  ]) {
    assert.equal(
      requiresBetaDeployment([path, "scripts/check.test.mjs"]),
      false,
      path,
    );
    assert.equal(
      classifyBetaPush(before, head, gitFor([path]).git),
      false,
      path,
    );
  }
});

test("verification-only admission cannot hide deployable, unknown or malformed paths", () => {
  for (const path of [
    ".github/workflows/deploy-development.yml",
    ".github/workflows/new-ci.yml",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "turbo.json",
    "vitest.config.ts",
    "scripts/prepare-legacy-ai-receipt-closure.mjs",
    "scripts/beta-release-gate-core.mjs",
    "scripts/unknown.mjs",
    ".github/unreviewed.md",
    "SECURITY.md.mjs",
    "infra/platform/lib/stacks/application-stack.ts",
    "apps/web/src/App.tsx",
    "docs/../apps/web/src/App.tsx",
    "/docs/status.md",
    "docs//status.md",
    "docs\\status.md",
    "docs/status.md\n",
    "./scripts/test.test.mjs",
    "SCRIPTS/CLASSIFY-BETA-DEPLOYMENT.MJS",
    "",
    null,
  ])
    assert.equal(
      requiresBetaDeployment([".github/workflows/ci.yml", path]),
      true,
      String(path),
    );
  assert.equal(requiresBetaDeployment(null), true);
});

test("a runtime file renamed into a neutral path remains deployable", () => {
  const { git, calls } = gitFor(["apps/api/src/app.ts", "docs/app.ts"]);
  assert.equal(classifyBetaPush(before, head, git), true);
  assert.ok(calls.at(-1).includes("--no-renames"));
});

test("a neutral recovery still admits runtime changes missing from beta", async () => {
  const deployed = "c".repeat(40);
  const calls = [];
  const git = (_command, args) => {
    calls.push(args);
    if (args[0] === "rev-parse") return `${head}\n`;
    if (args[0] === "cat-file") return Buffer.alloc(0);
    if (args[0] === "diff")
      return Buffer.from(
        args[4] === deployed
          ? "apps/web/src/App.tsx\0"
          : "apps/web/e2e/editor.spec.ts\0",
      );
    throw new Error("unexpected git command");
  };
  const readJson = async (url) =>
    url.includes("/workflows/")
      ? {
          workflow_runs: [
            {
              id: 7,
              head_sha: deployed,
              head_branch: "main",
              event: "push",
              conclusion: "success",
            },
          ],
        }
      : {
          jobs: [
            {
              name: "Deploy application, DNS, and smoke",
              conclusion: "success",
            },
          ],
        };
  assert.equal(
    await classifyPendingBetaPush(
      before,
      head,
      "hunter-west/CloudMarkup",
      git,
      readJson,
    ),
    true,
  );
  assert.equal(calls.at(-1)[4], deployed);
});

test("a neutral push skips deployment only when delivered runtime is current", async () => {
  const readJson = async (url) =>
    url.includes("/workflows/")
      ? {
          workflow_runs: [
            {
              id: 7,
              head_sha: before,
              head_branch: "main",
              event: "push",
              conclusion: "success",
            },
          ],
        }
      : {
          jobs: [
            {
              name: "Deploy application, DNS, and smoke",
              conclusion: "success",
            },
          ],
        };
  assert.equal(
    await classifyPendingBetaPush(
      before,
      head,
      "hunter-west/CloudMarkup",
      gitFor(["apps/web/e2e/editor.spec.ts"]).git,
      readJson,
    ),
    false,
  );
});

test("a successful workflow with a skipped deploy is not a delivered baseline", async () => {
  const runs = [9, 7].map((id) => ({
    id,
    head_sha: id === 9 ? head : before,
    head_branch: "main",
    event: "push",
    conclusion: "success",
  }));
  const readJson = async (url) =>
    url.includes("/workflows/")
      ? { workflow_runs: runs }
      : {
          jobs: [
            {
              name: "Deploy application, DNS, and smoke",
              conclusion: url.includes("/9/") ? "skipped" : "success",
            },
          ],
        };
  assert.equal(
    await findDeployedBetaSource("hunter-west/CloudMarkup", readJson),
    before,
  );
});

test("unavailable or malformed deployment evidence retains protected admission", async () => {
  for (const readJson of [
    async () => {
      throw new Error("unavailable");
    },
    async () => ({}),
    async () => ({ workflow_runs: [] }),
    async () => ({
      workflow_runs: [
        {
          id: -1,
          head_sha: head,
          head_branch: "main",
          event: "push",
          conclusion: "success",
        },
      ],
    }),
  ]) {
    assert.equal(
      await classifyPendingBetaPush(
        before,
        head,
        "hunter-west/CloudMarkup",
        gitFor(["apps/web/e2e/editor.spec.ts"]).git,
        readJson,
      ),
      true,
    );
  }
});

test("runtime pushes need no deployment history and foreign repositories are never queried", async () => {
  const readJson = async () => {
    throw new Error("must not query");
  };
  assert.equal(
    await classifyPendingBetaPush(
      before,
      head,
      "hunter-west/CloudMarkup",
      gitFor(["apps/web/src/App.tsx"]).git,
      readJson,
    ),
    true,
  );
  assert.equal(
    await findDeployedBetaSource("other/repository", readJson),
    undefined,
  );
});
